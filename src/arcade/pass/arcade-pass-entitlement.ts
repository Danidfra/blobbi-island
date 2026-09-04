/**
 * The Arcade Pass, an account-scoped entitlement with TWO limits.
 *
 * ```
 *   24 hours from redemption          ── whichever runs out first
 *   15 free game starts               ──
 * ```
 *
 * Both are enforced here. {@link hasUsableArcadePass}, time left AND plays
 * left: is the question the turnstile asks; {@link hasActiveArcadePass} asks
 * only about time, and answers "is there still a pass record worth showing",
 * which is a display question, not a billing one. Confusing the two is how a
 * pass with zero plays left would keep waiving Token costs forever.
 *
 * ## What changed, and why the storage changed with it
 *
 * The old pass was floor ACCESS bought for Coins, and it lived in
 * `sessionStorage` because it was scoped to one visit. The new pass is a
 * premium REWARD redeemed with Arcade Tickets that covers a set number of
 * plays within a day. Both of its limits outlive a tab, so `sessionStorage` is
 * now the wrong shape: the entitlement has to survive a reload, a closed tab, a
 * new tab and a browser restart, with the allowance it was left with.
 *
 * ```
 *   old   sessionStorage boolean   "do I have floor access this visit?"
 *   new   localStorage record      "how many free plays do I have left, and
 *                                   until when?"
 * ```
 *
 * ## Not inventory, deliberately
 *
 * The pass is NOT a kind:31633 quantity. That inventory is durable item
 * OWNERSHIP: a thing you have until you spend it, and an expiring
 * entitlement is a different domain. Modelling it as `arcade-pass: 1` would
 * mean either a quantity that silently rots (an item that stops working while
 * still sitting in the bag) or a background writer deleting the player's
 * property on a timer. Neither is something the inventory should learn to do.
 *
 * What IS durable and on-relay is the Ticket spend that bought it. The
 * entitlement is the local consequence of that spend.
 *
 * ## Scoped by pubkey
 *
 * One browser, many accounts. The record is keyed by pubkey so signing in as
 * somebody else never inherits their pass, and signing back in recovers your
 * own, if it has not expired.
 *
 * ## Honest limits
 *
 * Local to this browser profile: a pass redeemed here does not follow the
 * player to another device. That is the same limitation every ledger in this
 * app has. It is also why the redemption records its Ticket spend durably
 * first: see `src/arcade/prizes/arcade-pass-prize.ts` and the redemption
 * ledger behind it, which is what makes a paid-but-not-delivered pass
 * recoverable rather than lost.
 */

export interface ArcadePassRecord {
  /** Epoch ms when the pass expires, whatever plays are left. */
  readonly expiresAt: number;
  /** Epoch ms it was granted. Diagnostics and copy ("redeemed today"). */
  readonly redeemedAt: number;
  /**
   * The redemption that paid for it. Lets a repeated delivery recognise a pass
   * it has already granted instead of granting a second one.
   */
  readonly redemptionId: string;
  /** Free game starts left. Counts down to 0 and never below. */
  readonly remainingFreePlays: number;
}

import { withQueuedCrossTabLock } from '@/lib/cross-tab-op-lock';
import {
  ARCADE_PASS_DURATION_MS,
  ARCADE_PASS_FREE_PLAYS,
} from './arcade-pass-terms';

/** Re-exported so callers reason about the pass through one module. */
export { ARCADE_PASS_DURATION_MS, ARCADE_PASS_FREE_PLAYS };

const STORAGE_KEY = 'blobbi:arcade:pass';

/**
 * The cross-tab lock namespace. Per pubkey, so two accounts in two tabs never
 * queue behind each other, and deliberately NOT the inventory lock: consuming
 * a free play writes no inventory, and sharing that lock would make every
 * Pass-admitted game wait behind unrelated relay round-trips.
 */
const PASS_LOCK_PREFIX = 'blobbi-arcade-pass:';

type PassStore = Record<string, ArcadePassRecord>;

const listeners = new Set<() => void>();

function emit(): void {
  [...listeners].forEach((listener) => listener());
}

function isRecord(value: unknown): value is ArcadePassRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ArcadePassRecord>;
  return (
    typeof record.expiresAt === 'number' &&
    Number.isFinite(record.expiresAt) &&
    typeof record.redeemedAt === 'number' &&
    typeof record.redemptionId === 'string' &&
    // A record without an allowance predates the bounded Pass. It is REJECTED
    // rather than defaulted: the only records that could exist are dev-harness
    // ones (the Pass has never been purchasable), and defaulting an unknown
    // allowance to anything would be inventing free plays nobody paid for.
    typeof record.remainingFreePlays === 'number' &&
    Number.isInteger(record.remainingFreePlays) &&
    record.remainingFreePlays >= 0
  );
}

function readStore(): PassStore {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const store: PassStore = {};
    for (const [pubkey, record] of Object.entries(parsed as Record<string, unknown>)) {
      if (isRecord(record)) store[pubkey] = record;
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(store: PassStore): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/** The stored pass for this account, expired or not. */
export function readArcadePass(pubkey: string | undefined): ArcadePassRecord | null {
  if (!pubkey) return null;
  return readStore()[pubkey] ?? null;
}

/**
 * Is there an unexpired pass record for this account?
 *
 * TIME ONLY. A pass whose free plays are gone is still "active" by this
 * question: which is why this is a DISPLAY predicate ("show the pass chip,
 * it has not expired yet") and never a billing one. Use
 * {@link hasUsableArcadePass} to decide whether a play is free.
 */
export function hasActiveArcadePass(pubkey: string | undefined, nowMs: number): boolean {
  const record = readArcadePass(pubkey);
  return record !== null && record.expiresAt > nowMs;
}

/**
 * Will the next game start be free?
 *
 * Both limits, which is what makes it the billing predicate: unexpired AND at
 * least one free play left.
 */
export function hasUsableArcadePass(pubkey: string | undefined, nowMs: number): boolean {
  const record = readArcadePass(pubkey);
  return record !== null && record.expiresAt > nowMs && record.remainingFreePlays > 0;
}

/** Milliseconds of pass left, or `0` when there is none. For copy only. */
export function arcadePassRemainingMs(pubkey: string | undefined, nowMs: number): number {
  const record = readArcadePass(pubkey);
  if (!record) return 0;
  return Math.max(0, record.expiresAt - nowMs);
}

/**
 * Free plays left, or `0` when there is no pass or it has expired.
 *
 * An expired pass reports 0 rather than its leftover count: unusable plays are
 * not plays, and showing "3 free plays left" beside an expired pass would be a
 * lie the player could act on.
 */
export function arcadePassRemainingFreePlays(
  pubkey: string | undefined,
  nowMs: number,
): number {
  const record = readArcadePass(pubkey);
  if (!record || record.expiresAt <= nowMs) return 0;
  return Math.max(0, record.remainingFreePlays);
}

/**
 * May this account redeem a Pass right now?
 *
 * No stacking: while a pass is USABLE, a second one is refused. Buying two
 * would either double the window (48 hours from one shelf item) or double the
 * allowance, and both make the Pass a thing to hoard rather than a thing to
 * use.
 *
 * An EXHAUSTED pass with time still on it does not block, deliberately. Its
 * benefit is spent; the leftover hours are an expiry timer, not a product. A
 * player who has used all fifteen plays and wants fifteen more is asking to
 * buy the same thing again, and there is no reason to make them wait for a
 * clock to run down first.
 */
export function canRedeemArcadePass(pubkey: string | undefined, nowMs: number): boolean {
  if (!pubkey) return false;
  return !hasUsableArcadePass(pubkey, nowMs);
}

/**
 * Spend one free play, atomically across tabs.
 *
 * Returns `true` only when this call is the one that consumed it, the caller
 * may then start the game for free. `false` means charge Tokens instead: the
 * pass expired, ran out, or another tab took the last play first.
 *
 * ## Why this is async when a localStorage write is not
 *
 * Because two tabs are two readers. A synchronous read-modify-write can
 * interleave: both tabs read `remainingFreePlays: 1`, both write `0`, and one
 * free play admits two games. The Web Lock this borrows from the wallet
 * ({@link withQueuedCrossTabLock}) makes the whole read-decide-write one
 * critical section, and it QUEUES rather than refusing, so the loser is
 * serialised behind the winner and then correctly finds nothing left.
 *
 * Where Web Locks is unavailable the lock degrades to per-tab ordering only,
 * exactly as the wallet's does, and the honest statement of what that costs
 * is: the count can still never go negative or rise (the read-back below
 * guarantees that), but two tabs racing for the LAST play could each be told
 * they won it. One extra free play on an unsupported browser is a bounded,
 * one-off loss, and the alternative, a polled localStorage lease, is worse
 * machinery for the same guarantee.
 */
export async function consumeArcadeFreePlay(
  pubkey: string | undefined,
  nowMs: number,
): Promise<boolean> {
  if (!pubkey) return false;
  const { value } = await withQueuedCrossTabLock(
    `${PASS_LOCK_PREFIX}${pubkey}`,
    async () => consumeUnderLock(pubkey, nowMs),
  );
  return value;
}

/** The critical section of {@link consumeArcadeFreePlay}. Never call directly. */
function consumeUnderLock(pubkey: string, nowMs: number): boolean {
  const store = readStore();
  const record = store[pubkey];
  // Re-checked INSIDE the lock. Whatever the caller saw before queueing may
  // have been spent by the tab ahead of it.
  if (!record || record.expiresAt <= nowMs || record.remainingFreePlays <= 0) return false;

  const next = record.remainingFreePlays - 1;
  store[pubkey] = { ...record, remainingFreePlays: next };
  if (!writeStore(store)) return false;

  // Prove it landed. Storage that silently dropped the decrement would hand
  // out the same free play forever.
  const after = readArcadePass(pubkey);
  if (!after || after.remainingFreePlays !== next) return false;
  emit();
  return true;
}

/**
 * Grant a pass, and prove the write landed.
 *
 * Returns `false` when the pass was NOT delivered. The caller must treat that
 * as undelivered and keep its redemption open, a player charged Tickets for a
 * pass they did not get is the one outcome worth engineering against, and the
 * redemption ledger's `delivering` state exists to let a retry finish the job
 * without spending again.
 *
 * Three refusals, all of them retryable rather than terminal:
 *
 * 1. **Storage refused the write**, or dropped it silently (caught by the
 *    read-back below).
 * 2. **A usable pass is already running** under a DIFFERENT redemption. The
 *    grant does not stack and does not overwrite: overwriting would destroy
 *    plays the player still owns. Delivery waits until that pass is spent or
 *    expires, and the retry then succeeds.
 * 3. No pubkey.
 *
 * Delivering the SAME redemption twice is idempotent, the second call sees
 * its own id and reports success without touching the record, so a retried
 * delivery cannot reset an allowance the player has been spending.
 */
export function grantArcadePass(
  pubkey: string | undefined,
  input: { redemptionId: string; nowMs: number },
): boolean {
  if (!pubkey) return false;
  const store = readStore();
  const existing = store[pubkey];

  // Already delivered. Not a fresh grant, the count must not be reset.
  if (existing?.redemptionId === input.redemptionId) return true;

  // No stacking. A usable pass is untouchable; this delivery is deferred, not
  // failed, and the redemption stays recoverable.
  if (existing && existing.expiresAt > input.nowMs && existing.remainingFreePlays > 0) {
    return false;
  }

  store[pubkey] = {
    expiresAt: input.nowMs + ARCADE_PASS_DURATION_MS,
    redeemedAt: input.nowMs,
    redemptionId: input.redemptionId,
    remainingFreePlays: ARCADE_PASS_FREE_PLAYS,
  };
  if (!writeStore(store)) return false;

  // Read back: storage that silently dropped the write must not be mistaken
  // for a delivered pass.
  const delivered = readArcadePass(pubkey)?.redemptionId === input.redemptionId;
  if (delivered) emit();
  return delivered;
}

/** Subscribe to pass changes. Returns an unsubscribe function. */
export function subscribeArcadePassEntitlement(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Tests and the DEV harness only. */
export function clearArcadePasses(pubkey?: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!pubkey) {
      localStorage.removeItem(STORAGE_KEY);
      emit();
      return;
    }
    const store = readStore();
    delete store[pubkey];
    writeStore(store);
    emit();
  } catch {
    /* nothing to clear */
  }
}
