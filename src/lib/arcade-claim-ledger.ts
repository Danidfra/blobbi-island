/**
 * The arcade's claim ledger and claim lock — the durable half of "one reward per
 * run, ever".
 *
 * ## The defect this file was rebuilt around
 *
 * A manual test produced a **duplicate grant: a 3-ticket reward was added twice,
 * for 6 tickets.** The path was not a double-click and not a race. It was the
 * ordinary, expected one:
 *
 * ```
 *   publish resolves → read the balance back → the relay has not caught up yet
 *   → "verify-mismatch" → recorded as `failed` → `failed` is retryable
 *   → the UI offers "Try again" → a SECOND additive +3 is published
 * ```
 *
 * Reading fresh state before each write prevents stale-state clobbering. It does
 * **not** make an additive mutation idempotent: `+3` applied to a balance that
 * already includes the first `+3` is simply `+6`. kind:31633 carries item
 * addresses and quantities and nothing else, so the relay has no way to know
 * this run was already paid. The only place that knowledge can live is here.
 *
 * ## What this file now guarantees
 *
 * | scope | guarantee | mechanism |
 * | --- | --- | --- |
 * | same component | one publish per run | React state + the reducer |
 * | same document (all mounts, all hook instances) | one publish per run, even in one tick | {@link acquireClaimLock}, a synchronous module-level `Set` |
 * | same browser profile, after the first ledger write | no second grant for a claim that is claimed / publishing / verifying / ambiguous | the `localStorage` ledger, checked before every attempt |
 * | across tabs, for the whole check → persist → publish → verify window | one owner | {@link withClaimLock} — Web Locks where available, a verified `localStorage` lease otherwise |
 * | after a refresh | an ambiguous or claimed run stays blocked | the ledger is durable |
 * | across devices | **nothing** | see below |
 * | protocol level | **nothing** | see below |
 *
 * ## What is NOT guaranteed, stated plainly
 *
 * **Cross-device: nothing.** A different browser or device starts with an empty
 * ledger. The practical exposure is bounded — a `runId` is minted per run and
 * never leaves the device that minted it, so another device has no run id to
 * re-claim — but that is an obstacle, not a guarantee.
 *
 * **Protocol level: nothing.** There is nowhere in a kind:31633 event to record
 * "run X has been paid" without inventing tags the canonical parser drops and
 * other clients would not understand. Rejected deliberately; documented instead.
 *
 * **Two tabs that race before EITHER has written to the ledger** are excluded by
 * {@link withClaimLock}. Where the Web Locks API exists that exclusion is real
 * and atomic. Where it does not, the `localStorage` lease is a
 * write-then-read-back protocol, which is strong in practice but is **not** an
 * atomic compare-and-swap — two tabs writing in the same millisecond could both
 * believe they own it. That residual window is a limitation, not a guarantee,
 * and no copy anywhere may describe it as one.
 */

import type { ArcadeRewardClaim } from '@/arcade/arcade-reward-boundary';
import { ARCADE_CLAIMS_STORAGE_KEY, blocksNewGrant } from '@/arcade/arcade-reward-boundary';

/** `{ [pubkey]: { [runId]: claim } }`. Scoped by owner so accounts never mix. */
type ClaimLedger = Record<string, Record<string, ArcadeRewardClaim>>;

const CLAIM_STATUSES = new Set([
  'pending',
  'publishing',
  'verifying',
  'claimed',
  'failed',
  'ambiguous',
]);

function isClaim(value: unknown): value is ArcadeRewardClaim {
  if (!value || typeof value !== 'object') return false;
  const claim = value as Partial<ArcadeRewardClaim>;
  return (
    typeof claim.runId === 'string' &&
    typeof claim.gameId === 'string' &&
    typeof claim.tickets === 'number' &&
    typeof claim.status === 'string' &&
    CLAIM_STATUSES.has(claim.status)
  );
}

/** Fill in fields an older stored record predates, without trusting the rest. */
function normalise(claim: ArcadeRewardClaim): ArcadeRewardClaim {
  return {
    ...claim,
    quantityBefore:
      typeof claim.quantityBefore === 'number' && Number.isFinite(claim.quantityBefore)
        ? claim.quantityBefore
        : null,
    reconcileAttempts:
      typeof claim.reconcileAttempts === 'number' && claim.reconcileAttempts >= 0
        ? claim.reconcileAttempts
        : 0,
  };
}

function readLedger(): ClaimLedger {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(ARCADE_CLAIMS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    // Rebuild rather than trust: a corrupted or hand-edited entry must not be
    // able to make the ledger claim something it cannot substantiate.
    const ledger: ClaimLedger = {};
    for (const [pubkey, runs] of Object.entries(parsed as Record<string, unknown>)) {
      if (!runs || typeof runs !== 'object' || Array.isArray(runs)) continue;
      const kept: Record<string, ArcadeRewardClaim> = {};
      for (const [runId, claim] of Object.entries(runs as Record<string, unknown>)) {
        if (isClaim(claim)) kept[runId] = normalise(claim);
      }
      ledger[pubkey] = kept;
    }
    return ledger;
  } catch {
    // Private mode, disabled storage, or unparseable JSON. An empty ledger is
    // reported honestly to the caller, which now REFUSES to publish rather than
    // proceeding without a durable record.
    return {};
  }
}

function writeLedger(ledger: ClaimLedger): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(ARCADE_CLAIMS_STORAGE_KEY, JSON.stringify(ledger));
    return true;
  } catch {
    return false;
  }
}

/** Every claim recorded for an owner, newest state per run. */
export function readClaims(pubkey: string | undefined): Record<string, ArcadeRewardClaim> {
  if (!pubkey) return {};
  return readLedger()[pubkey] ?? {};
}

export function readClaim(
  pubkey: string | undefined,
  runId: string,
): ArcadeRewardClaim | null {
  return readClaims(pubkey)[runId] ?? null;
}

/** Run ids this owner has FULLY claimed. */
export function claimedRunIds(pubkey: string | undefined): string[] {
  return Object.values(readClaims(pubkey))
    .filter((claim) => claim.status === 'claimed')
    .map((claim) => claim.runId);
}

export function hasClaimed(pubkey: string | undefined, runId: string): boolean {
  return readClaim(pubkey, runId)?.status === 'claimed';
}

/**
 * Is there a durable record forbidding a new grant for this run?
 *
 * Wider than `hasClaimed` on purpose: an in-flight or ambiguous record blocks
 * too, because a claim that MAY have been published is exactly as dangerous to
 * repeat as one that certainly was.
 */
export function isGrantBlocked(pubkey: string | undefined, runId: string): boolean {
  const claim = readClaim(pubkey, runId);
  return claim !== null && blocksNewGrant(claim);
}

/**
 * Record (or update) a claim, and prove the write landed.
 *
 * Returns `true` only when the record could be read back from storage with the
 * expected status. A caller that gets `false` **must not publish**: without a
 * durable record, the claim would be offered again after a remount or a refresh,
 * which is how one additive grant becomes two.
 */
export function persistClaim(pubkey: string | undefined, claim: ArcadeRewardClaim): boolean {
  if (!pubkey) return false;
  const ledger = readLedger();
  const owner = { ...(ledger[pubkey] ?? {}) };
  const existing = owner[claim.runId];

  // `claimed` is a one-way door in storage too. A late `failed` or `ambiguous`
  // arriving after a confirmed success — a retry that raced, a stale callback —
  // must not reopen a paid claim. Reported as success: the durable state is
  // already at least as strong as what the caller asked for.
  if (existing?.status === 'claimed' && claim.status !== 'claimed') return true;

  /*
   * An `ambiguous` record may only ever become `claimed` (through read-only
   * reconciliation) or stay `ambiguous`. Anything else would let a
   * possibly-published claim be re-expressed as a fresh, publishable one — the
   * exact shape of the duplicate-grant defect, one refactor away.
   *
   * Likewise, an in-flight `publishing`/`verifying` record may not be replaced
   * by a brand-new `pending` claim. (It MAY become `failed`: the writer's own
   * pre-publish guards — a refusing signer — throw after the record has already
   * moved to `publishing`, and that is a legitimate, provably-unsent outcome.)
   *
   * `advanceClaim` already refuses these transitions. This makes the refusal
   * structural rather than a property of one caller, and it returns FALSE so a
   * caller that somehow reached here publishes nothing.
   */
  const downgradesAPossiblyPublishedClaim =
    (existing?.status === 'ambiguous' &&
      claim.status !== 'ambiguous' &&
      claim.status !== 'claimed') ||
    ((existing?.status === 'publishing' || existing?.status === 'verifying') &&
      claim.status === 'pending');
  if (downgradesAPossiblyPublishedClaim) return false;

  owner[claim.runId] = claim;
  ledger[pubkey] = owner;
  if (!writeLedger(ledger)) return false;

  // Read-back verification, not just "setItem did not throw". Storage can accept
  // a write and drop it (quota eviction, private mode, an extension), and a
  // silently-lost claim record is precisely the state that allows a second grant.
  const stored = readClaim(pubkey, claim.runId);
  return stored !== null && stored.status === claim.status;
}

/** Remove every claim for an owner. DEV harness and tests only. */
export function clearClaims(pubkey?: string): void {
  if (!pubkey) {
    try {
      localStorage?.removeItem(ARCADE_CLAIMS_STORAGE_KEY);
    } catch {
      /* nothing to clear */
    }
    return;
  }
  const ledger = readLedger();
  delete ledger[pubkey];
  writeLedger(ledger);
}

// ── The synchronous, same-document lock ─────────────────────────────────────

/**
 * Per-document, per-`(owner, run)` locks.
 *
 * A module-level `Set` rather than a ref, so it survives a component unmounting
 * and remounting mid-claim, and is shared by every hook instance in the
 * document. Synchronous: there is no `await` between the check and the set, so
 * two calls in the same tick cannot both succeed. A disabled button and a
 * mutation's `isPending` both only settle after a render; this does not.
 */
const inFlight = new Set<string>();

const lockKey = (pubkey: string, runId: string) => `${pubkey}:${runId}`;

export function acquireClaimLock(pubkey: string, runId: string): boolean {
  const key = lockKey(pubkey, runId);
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export function releaseClaimLock(pubkey: string, runId: string): void {
  inFlight.delete(lockKey(pubkey, runId));
}

export function isClaimLocked(pubkey: string, runId: string): boolean {
  return inFlight.has(lockKey(pubkey, runId));
}

// ── The cross-tab lock ──────────────────────────────────────────────────────

/** How long a fallback lease is considered live, in milliseconds. */
export const CLAIM_LEASE_TTL_MS = 60_000;

const LEASE_KEY_PREFIX = 'blobbi:arcade:claim-lease:';
const WEB_LOCK_PREFIX = 'blobbi-arcade-claim:';

interface ClaimLease {
  readonly owner: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** Unique per acquisition. Not security-sensitive; only needs to not collide. */
function mintOwnerToken(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function leaseKey(pubkey: string, runId: string): string {
  return `${LEASE_KEY_PREFIX}${pubkey}:${runId}`;
}

function readLease(key: string): ClaimLease | null {
  try {
    const raw = localStorage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClaimLease>;
    if (typeof parsed?.owner !== 'string' || typeof parsed?.expiresAt !== 'number') return null;
    return {
      owner: parsed.owner,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Take the fallback lease, or report that someone else holds it.
 *
 * Write-then-read-back: whoever's token survives the read owns it. This is
 * strong in practice and is **not** an atomic compare-and-swap — two tabs
 * writing within the same millisecond could interleave. That residual window is
 * documented in this module's header and must never be described as a guarantee.
 */
type LeaseOutcome =
  /** This document owns the lease. */
  | { readonly kind: 'acquired'; readonly owner: string }
  /** Another live lease exists. Refuse. */
  | { readonly kind: 'held' }
  /**
   * Storage is not usable at all, so no lease can be taken by anyone.
   *
   * Distinct from `held`, and the distinction matters: "another tab is claiming
   * this" and "this browser has no storage" call for different copy and
   * different next steps. It is NOT a refusal — the caller proceeds with no
   * cross-tab protection, and the durable-ledger requirement (which needs the
   * same storage) then refuses the publish for a reason that is actually true.
   */
  | { readonly kind: 'unavailable' };

function acquireLease(key: string, now: number): LeaseOutcome {
  let existing: ClaimLease | null;
  try {
    if (typeof localStorage === 'undefined') return { kind: 'unavailable' };
    existing = readLease(key);
  } catch {
    return { kind: 'unavailable' };
  }
  // An expired lease is reclaimable. The TTL is generous relative to a claim
  // (two relay reads and one publish), so reclaiming one means the owning tab is
  // gone, not slow.
  if (existing && existing.expiresAt > now) return { kind: 'held' };

  const owner = mintOwnerToken();
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ owner, createdAt: now, expiresAt: now + CLAIM_LEASE_TTL_MS }),
    );
  } catch {
    return { kind: 'unavailable' };
  }
  // Ownership is whatever is actually in storage after the write.
  const stored = readLease(key);
  if (stored?.owner === owner) return { kind: 'acquired', owner };
  // A DIFFERENT owner means a real race — another tab won. NOTHING stored means
  // the write silently vanished (quota eviction, private mode, an extension),
  // which is a broken-storage problem and not a contended one. Reporting it as
  // contention would tell the player to "finish it in the other tab" when there
  // is no other tab.
  return stored ? { kind: 'held' } : { kind: 'unavailable' };
}

function releaseLease(key: string, owner: string): void {
  try {
    if (readLease(key)?.owner === owner) localStorage.removeItem(key);
  } catch {
    /* storage vanished; the lease will expire on its own */
  }
}

type WebLockManager = {
  request: (
    name: string,
    options: { ifAvailable?: boolean; mode?: 'exclusive' | 'shared' },
    callback: (lock: unknown) => Promise<unknown>,
  ) => Promise<unknown>;
};

function webLocks(): WebLockManager | null {
  const nav = globalThis.navigator as (Navigator & { locks?: WebLockManager }) | undefined;
  return nav?.locks && typeof nav.locks.request === 'function' ? nav.locks : null;
}

/** Which mechanism actually guarded an attempt. Surfaced for honest reporting. */
export type ClaimLockKind = 'web-locks' | 'lease' | 'none';

export interface ClaimLockResult<T> {
  /** `false` when another tab or document holds the lock; `fn` did not run. */
  readonly acquired: boolean;
  readonly kind: ClaimLockKind;
  readonly value?: T;
}

/**
 * Run `fn` while holding the cross-tab claim lock, or refuse.
 *
 * The lock spans the WHOLE operation — ledger check, durable record, publish and
 * verification — because any narrower window lets a second tab read "no claim
 * yet" while the first is mid-publish.
 *
 * `ifAvailable: true` rather than queueing: a second tab that waited would run
 * the claim *after* the first finished, which is exactly the duplicate we are
 * preventing. Refusing immediately is correct, and the ledger check the first
 * tab has by then written makes the refusal permanent.
 */
export async function withClaimLock<T>(
  pubkey: string,
  runId: string,
  now: number,
  fn: () => Promise<T>,
): Promise<ClaimLockResult<T>> {
  const locks = webLocks();

  if (locks) {
    let ran = false;
    let value: T | undefined;
    await locks.request(`${WEB_LOCK_PREFIX}${pubkey}:${runId}`, { ifAvailable: true }, async (
      lock,
    ) => {
      // A null lock means it was already held — by another tab, or by another
      // call in this one.
      if (!lock) return;
      ran = true;
      value = await fn();
    });
    return ran ? { acquired: true, kind: 'web-locks', value } : { acquired: false, kind: 'web-locks' };
  }

  const key = leaseKey(pubkey, runId);
  const lease = acquireLease(key, now);
  if (lease.kind === 'held') return { acquired: false, kind: 'lease' };
  if (lease.kind === 'unavailable') {
    // No cross-tab protection is possible here. The same-document lock still
    // holds, and the caller's durable-ledger requirement — which needs the very
    // storage that just failed — will refuse the publish for the honest reason.
    return { acquired: true, kind: 'none', value: await fn() };
  }
  try {
    return { acquired: true, kind: 'lease', value: await fn() };
  } finally {
    releaseLease(key, lease.owner);
  }
}

/** Which cross-tab mechanism this environment will use. For docs and the harness. */
export function claimLockKind(): ClaimLockKind {
  if (webLocks()) return 'web-locks';
  try {
    return typeof localStorage === 'undefined' ? 'none' : 'lease';
  } catch {
    return 'none';
  }
}

/** Tests and the DEV harness only: drop every lock and lease. */
export function resetClaimLocks(): void {
  inFlight.clear();
  try {
    if (typeof localStorage === 'undefined') return;
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(LEASE_KEY_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* nothing to clear */
  }
}
