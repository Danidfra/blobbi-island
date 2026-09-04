/**
 * The durable Mine session record.
 *
 * This is an ECONOMIC record, not a savegame. It exists so that the two
 * value-bearing writes at the end of a run, the Coin reward and the energy
 * cost: survive an unmount, a reload, a backgrounded phone, and can be
 * finished or reconciled later under the SAME operation ids.
 *
 * Gameplay state (holes, mined items, animation, each click) is deliberately
 * NOT persisted. If the app closes mid-run the session is abandoned and the
 * player loses nothing, because nothing was durable yet:
 *
 * ```
 *   app closes mid-run  →  durable energy cost 0, Coins 0, session abandoned
 * ```
 *
 * ## Status lifecycle
 *
 * ```
 *   open ──(gameplay ends)──► finalized ──► coin-pending ──► energy-pending ──► settled
 *    │                                          │                  │
 *    └──(app closed mid-run)──► abandoned       └── recovery resumes either, same ids
 * ```
 *
 * `finalized` is the point of no return for the NUMBERS: `energyDelta` and
 * `coinReward` are frozen there and are never recomputed, so a retry after a
 * reload settles exactly what the run earned rather than whatever the UI
 * happens to hold.
 *
 * Durable per browser profile only, like every other ledger here.
 */

export type MineSessionStatus =
  /** Gameplay is running. Nothing is owed yet. */
  | 'open'
  /** Gameplay ended; reward and energy delta are frozen. Nothing published. */
  | 'finalized'
  /** The Coin grant is in flight or unresolved. */
  | 'coin-pending'
  /** Coins are settled; the energy write is in flight or unresolved. */
  | 'energy-pending'
  /** Both sides settled. */
  | 'settled'
  /** Never finalized: no reward, no cost. */
  | 'abandoned';

export interface MineSessionRecord {
  readonly sessionId: string;
  readonly petId: string;
  readonly status: MineSessionStatus;
  readonly startedAt: number;
  /** Energy shown when the run began. Gameplay only; never a write base. */
  readonly startEnergy: number;
  /** Frozen at finalization. Positive integer. */
  readonly energyDelta?: number;
  /** Frozen at finalization. Non-negative integer. */
  readonly coinReward?: number;
  readonly finishedAt?: number;
  readonly coinStatus?: 'applied' | 'ambiguous' | 'failed';
  readonly energyStatus?: 'applied' | 'ambiguous' | 'failed';
  readonly updatedAt: number;
  readonly note?: string;
}

const STORAGE_KEY = 'blobbi:mine:sessions';

/** Settled/abandoned records are kept this long for diagnostics, then pruned. */
export const MINE_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * How often a tab playing a run refreshes its `open` record's `updatedAt`.
 *
 * The heartbeat is what tells other tabs the run is still being played, so
 * "one run at a time" can be enforced without holding a Web Lock for the whole
 * of gameplay.
 */
export const MINE_SESSION_HEARTBEAT_MS = 15 * 1000;

/**
 * An `open` record untouched for longer than this is not being played any
 * more: the tab was closed, crashed, or the process was killed before it could
 * abandon its session.
 *
 * Comfortably more than {@link MINE_SESSION_HEARTBEAT_MS} because background
 * tabs have their timers throttled to roughly once a minute, a live but
 * backgrounded run must not be mistaken for a dead one. The flip side is that
 * a hard crash keeps the Mine closed for at most this long, which is the
 * trade-off: an occasional short wait after a crash, versus one tab silently
 * voiding another tab's run.
 */
export const MINE_ACTIVE_SESSION_TTL_MS = 90 * 1000;

const STATUSES = new Set<MineSessionStatus>([
  'open',
  'finalized',
  'coin-pending',
  'energy-pending',
  'settled',
  'abandoned',
]);

type Ledger = Record<string, Record<string, MineSessionRecord>>;

function isRecord(value: unknown): value is MineSessionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<MineSessionRecord>;
  return (
    typeof record.sessionId === 'string' &&
    typeof record.petId === 'string' &&
    typeof record.status === 'string' &&
    STATUSES.has(record.status as MineSessionStatus) &&
    typeof record.startedAt === 'number' &&
    typeof record.startEnergy === 'number'
  );
}

/** Corruption-tolerant: one malformed entry never hides the others. */
function readLedger(): Ledger {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const ledger: Ledger = {};
    for (const [pubkey, sessions] of Object.entries(parsed as Record<string, unknown>)) {
      if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)) continue;
      const kept: Record<string, MineSessionRecord> = {};
      for (const [id, record] of Object.entries(sessions as Record<string, unknown>)) {
        if (isRecord(record)) kept[id] = record;
      }
      ledger[pubkey] = kept;
    }
    return ledger;
  } catch {
    return {};
  }
}

function writeLedger(ledger: Ledger): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
    return true;
  } catch {
    return false;
  }
}

export function readMineSession(
  pubkey: string | undefined,
  sessionId: string,
): MineSessionRecord | null {
  if (!pubkey) return null;
  return readLedger()[pubkey]?.[sessionId] ?? null;
}

export function readMineSessions(pubkey: string | undefined): MineSessionRecord[] {
  if (!pubkey) return [];
  return Object.values(readLedger()[pubkey] ?? {});
}

/**
 * Persist and VERIFY by reading back. Returns false when storage refused,
 * the caller must then refuse to start (or to advance) a value-bearing
 * session: no durable identity, no value-bearing operation.
 */
export function persistMineSession(
  pubkey: string | undefined,
  record: MineSessionRecord,
): boolean {
  if (!pubkey) return false;
  const ledger = readLedger();
  const existing = ledger[pubkey]?.[record.sessionId];
  // `settled` is a one-way door.
  if (existing?.status === 'settled' && record.status !== 'settled') return true;
  ledger[pubkey] = { ...(ledger[pubkey] ?? {}), [record.sessionId]: record };
  if (!writeLedger(ledger)) return false;
  return readMineSession(pubkey, record.sessionId)?.status === record.status;
}

/**
 * `open` records: gameplay that was started and never finished.
 *
 * Split by liveness rather than returned raw, because the two halves mean
 * opposite things: a session still being heartbeaten belongs to a tab that is
 * playing right now and must be left alone, while one that went quiet is
 * debris and can be abandoned (it owes nothing; no reward was frozen and no
 * energy was ever published).
 */
export function partitionOpenMineSessions(
  pubkey: string | undefined,
  nowMs: number,
  ttlMs: number = MINE_ACTIVE_SESSION_TTL_MS,
): { active: MineSessionRecord[]; stale: MineSessionRecord[] } {
  const active: MineSessionRecord[] = [];
  const stale: MineSessionRecord[] = [];
  for (const record of readMineSessions(pubkey)) {
    if (record.status !== 'open') continue;
    // `updatedAt` is refreshed by the playing tab's heartbeat. A clock that
    // jumped backwards makes the age negative, which reads as "just touched",
    // the safe direction, since it errs toward preserving a live run.
    if (nowMs - record.updatedAt > ttlMs) stale.push(record);
    else active.push(record);
  }
  return { active, stale };
}

/**
 * Mark an `open` session as still being played. No-op for any other status, so
 * a late heartbeat can never resurrect a finalized or abandoned run.
 */
export function touchMineSession(
  pubkey: string | undefined,
  sessionId: string,
  nowMs: number,
): void {
  if (!pubkey) return;
  const record = readMineSession(pubkey, sessionId);
  if (!record || record.status !== 'open') return;
  persistMineSession(pubkey, { ...record, updatedAt: nowMs });
}

/** Sessions that still owe a settlement action. */
export function unresolvedMineSessions(
  pubkey: string | undefined,
): MineSessionRecord[] {
  return readMineSessions(pubkey).filter(
    (record) =>
      record.status === 'open' ||
      record.status === 'finalized' ||
      record.status === 'coin-pending' ||
      record.status === 'energy-pending',
  );
}

/**
 * Drop terminal records older than the retention window. Bounds growth.
 *
 * Only `settled` and `abandoned` records are ever dropped: anything still
 * `open`, `finalized` or mid-settlement owes a value-bearing action and is
 * kept however old it is, so pruning can never discard a reward.
 */
export function pruneMineSessions(pubkey: string | undefined, nowMs: number): void {
  if (!pubkey) return;
  const ledger = readLedger();
  const sessions = ledger[pubkey];
  if (!sessions) return;
  const kept: Record<string, MineSessionRecord> = {};
  for (const [id, record] of Object.entries(sessions)) {
    const terminal = record.status === 'settled' || record.status === 'abandoned';
    if (terminal && nowMs - record.updatedAt > MINE_SESSION_RETENTION_MS) continue;
    kept[id] = record;
  }
  ledger[pubkey] = kept;
  writeLedger(ledger);
}

/** Test/diagnostic helper. */
export function clearMineSessions(pubkey?: string): void {
  if (!pubkey) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  const ledger = readLedger();
  delete ledger[pubkey];
  writeLedger(ledger);
}

// ── Operation identities ───────────────────────────────────────────────────
//
// Deterministic and namespaced, so a retry after a reload derives exactly the
// same ids from the same session, never a fresh one, and so the Coin and
// energy ledgers can never collide on a shared key.

export function mineCoinOpId(sessionId: string): string {
  return `mine:${sessionId}:coin`;
}

export function mineEnergyOpId(sessionId: string): string {
  return `mine:${sessionId}:energy`;
}
