/**
 * The Arcade Pass — a 24-hour, account-scoped entitlement.
 *
 * ## What changed, and why the storage changed with it
 *
 * The old pass was floor ACCESS bought for Coins, and it lived in
 * `sessionStorage` because it was scoped to one visit. The new pass is a
 * premium REWARD redeemed with Arcade Tickets that waives the Token cost of
 * playing for a full day. A day outlives a tab, so `sessionStorage` is now the
 * wrong shape: the entitlement has to survive a reload, a closed tab, a new
 * tab and a browser restart for the remainder of its 24 hours.
 *
 * ```
 *   old   sessionStorage boolean   "do I have floor access this visit?"
 *   new   localStorage expiry      "are my plays free until <timestamp>?"
 * ```
 *
 * ## Not inventory, deliberately
 *
 * The pass is NOT a kind:31633 quantity. That inventory is durable item
 * OWNERSHIP — a thing you have until you spend it — and an expiring
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
 * somebody else never inherits their pass — and signing back in recovers your
 * own, if it has not expired.
 *
 * ## Honest limits
 *
 * Local to this browser profile: a pass redeemed here does not follow the
 * player to another device. That is the same limitation every ledger in this
 * app has. It is also why the redemption records its Ticket spend durably
 * first — see `arcade-pass-redemption.ts`, which is what makes a
 * paid-but-not-delivered pass recoverable rather than lost.
 */

/** How long a redeemed pass lasts. */
export const ARCADE_PASS_DURATION_MS = 24 * 60 * 60 * 1000;

export interface ArcadePassRecord {
  /** Epoch ms when the pass stops waiving Token costs. */
  readonly expiresAt: number;
  /** Epoch ms it was granted. Diagnostics and copy ("redeemed today"). */
  readonly redeemedAt: number;
  /**
   * The redemption that paid for it. Lets a repeated delivery recognise a pass
   * it has already granted instead of granting a second one.
   */
  readonly redemptionId: string;
}

const STORAGE_KEY = 'blobbi:arcade:pass';

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
    typeof record.redemptionId === 'string'
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

/** Is a pass currently waiving Token costs for this account? */
export function hasActiveArcadePass(pubkey: string | undefined, nowMs: number): boolean {
  const record = readArcadePass(pubkey);
  return record !== null && record.expiresAt > nowMs;
}

/** Milliseconds of pass left, or `0` when there is none. For copy only. */
export function arcadePassRemainingMs(pubkey: string | undefined, nowMs: number): number {
  const record = readArcadePass(pubkey);
  if (!record) return 0;
  return Math.max(0, record.expiresAt - nowMs);
}

/**
 * Grant a pass, and prove the write landed.
 *
 * Returns `false` when storage refused — the caller MUST treat that as
 * undelivered and keep its redemption open, because a player charged Tickets
 * for a pass they did not get is the one outcome worth engineering against.
 *
 * Delivering the SAME redemption twice is idempotent. A NEW redemption while
 * one is still running extends from the existing expiry rather than
 * truncating it, so buying early never costs the player time.
 */
export function grantArcadePass(
  pubkey: string | undefined,
  input: { redemptionId: string; nowMs: number },
): boolean {
  if (!pubkey) return false;
  const store = readStore();
  const existing = store[pubkey];

  if (existing?.redemptionId === input.redemptionId) return true;

  const base = existing && existing.expiresAt > input.nowMs ? existing.expiresAt : input.nowMs;
  store[pubkey] = {
    expiresAt: base + ARCADE_PASS_DURATION_MS,
    redeemedAt: input.nowMs,
    redemptionId: input.redemptionId,
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
