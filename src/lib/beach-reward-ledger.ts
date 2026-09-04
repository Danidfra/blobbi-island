/**
 * The Beach reward ledger, durable reservations and reward operations for
 * the Treasure Hunt's daily rewarded-hunt window.
 *
 * Third sibling of the arcade claim ledger and the Coin op ledger, for the
 * same reason those exist: nothing on a relay can say "hunt N of today's 10
 * was already rewarded", so that knowledge must live in a durable local
 * record, written BEFORE anything irreversible happens.
 *
 * ## Reservation-first
 *
 * A rewarded hunt RESERVES one of the window's slots when it STARTS (inside
 * a queued cross-tab lock, so two tabs cannot both take slot 10). The
 * reservation carries the operation id that will later be the wallet
 * grant's exactly-once identity; one id from start to Coins.
 *
 * ## Status lifecycle
 *
 * ```
 *   reserved ──finalize(amount)──► finalized ──grant──► applied
 *       │                             │                    ▲
 *       │                             └──► ambiguous ──────┘ (read-only reconcile)
 *       └──abandon──► abandoned (slot consumed)  /  released (record deleted)
 * ```
 *
 * - `reserved`: hunt started; counts against the window.
 * - `finalized`: a legitimate result exists and the amount is fixed; the
 *   grant may still be pending (this state survives refresh and is resumed).
 * - `applied` / `ambiguous`: the wallet grant's outcome (the wallet's own
 *   ledger holds the publish-level detail under the same opId).
 * - `abandoned`: the hunt was abandoned AFTER crossing the minimum
 *   participation threshold: the slot stays consumed, per the documented
 *   anti-farming rule.
 * - released: an abandonment BEFORE meaningful participation deletes the
 *   record and frees the slot (start-and-quit must not burn the day).
 *
 * ## Window monotonicity
 *
 * The effective window never moves backwards past a window that already has
 * operations: winding the system clock back a day does not mint ten fresh
 * slots. This is a speed bump for honest-client accidents, not anti-cheat,
 * the whole feature is client-trusted, as documented everywhere.
 */

export type BeachRewardOpStatus =
  | 'reserved'
  | 'finalized'
  | 'applied'
  | 'ambiguous'
  | 'abandoned';

export interface BeachRewardOp {
  /** The exactly-once operation id: SAME id used for the wallet grant. */
  readonly opId: string;
  /** The simulation round this op paid (`TreasureHuntResult.roundId`). */
  readonly roundKey: string;
  readonly windowKey: string;
  readonly status: BeachRewardOpStatus;
  /** Fixed at finalization. */
  readonly amount: number | null;
  /** Best-known participation, updated as the round progresses. */
  readonly digs: number;
  readonly activeSeconds: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const STORAGE_KEY = 'blobbi:beach:reward-ops';

const STATUSES = new Set<BeachRewardOpStatus>([
  'reserved',
  'finalized',
  'applied',
  'ambiguous',
  'abandoned',
]);

/** Statuses that consume a slot in their window. (Released ops are deleted.) */
const COUNTING_STATUSES: ReadonlySet<BeachRewardOpStatus> = STATUSES;

type Ledger = Record<string, Record<string, BeachRewardOp>>;

function isOp(value: unknown): value is BeachRewardOp {
  if (!value || typeof value !== 'object') return false;
  const op = value as Partial<BeachRewardOp>;
  return (
    typeof op.opId === 'string' &&
    typeof op.roundKey === 'string' &&
    typeof op.windowKey === 'string' &&
    typeof op.status === 'string' &&
    STATUSES.has(op.status as BeachRewardOpStatus)
  );
}

function readLedger(): Ledger {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const ledger: Ledger = {};
    for (const [pubkey, ops] of Object.entries(parsed as Record<string, unknown>)) {
      if (!ops || typeof ops !== 'object' || Array.isArray(ops)) continue;
      const kept: Record<string, BeachRewardOp> = {};
      for (const [opId, op] of Object.entries(ops as Record<string, unknown>)) {
        if (isOp(op)) {
          const partial = op as Partial<BeachRewardOp> & BeachRewardOp;
          kept[opId] = {
            ...partial,
            amount: typeof partial.amount === 'number' ? partial.amount : null,
            digs: typeof partial.digs === 'number' ? partial.digs : 0,
            activeSeconds:
              typeof partial.activeSeconds === 'number' ? partial.activeSeconds : 0,
            createdAt: typeof partial.createdAt === 'number' ? partial.createdAt : 0,
            updatedAt: typeof partial.updatedAt === 'number' ? partial.updatedAt : 0,
          };
        }
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

export function readBeachRewardOps(pubkey: string | undefined): Record<string, BeachRewardOp> {
  if (!pubkey) return {};
  return readLedger()[pubkey] ?? {};
}

export function readBeachRewardOp(
  pubkey: string | undefined,
  opId: string,
): BeachRewardOp | null {
  return readBeachRewardOps(pubkey)[opId] ?? null;
}

/**
 * The effective window key: today's, unless a LATER window already holds
 * operations (clock rolled back): then the later one keeps counting.
 */
export function effectiveBeachWindowKey(
  pubkey: string | undefined,
  todayKey: string,
): string {
  const keys = Object.values(readBeachRewardOps(pubkey)).map((op) => op.windowKey);
  const latest = keys.sort().at(-1);
  return latest && latest > todayKey ? latest : todayKey;
}

/** How many of the window's slots are consumed. */
export function beachRewardedCount(pubkey: string | undefined, windowKey: string): number {
  return Object.values(readBeachRewardOps(pubkey)).filter(
    (op) => op.windowKey === windowKey && COUNTING_STATUSES.has(op.status),
  ).length;
}

function persist(pubkey: string, op: BeachRewardOp): boolean {
  const ledger = readLedger();
  const owner = { ...(ledger[pubkey] ?? {}) };

  const existing = owner[op.opId];
  // One-way doors: applied is terminal; ambiguous only advances to applied.
  if (existing?.status === 'applied' && op.status !== 'applied') return true;
  if (
    existing?.status === 'ambiguous' &&
    op.status !== 'ambiguous' &&
    op.status !== 'applied'
  ) {
    return false;
  }

  owner[op.opId] = op;
  ledger[pubkey] = owner;
  if (!writeLedger(ledger)) return false;
  const stored = readBeachRewardOp(pubkey, op.opId);
  return stored !== null && stored.status === op.status;
}

export type ReserveOutcome =
  | { readonly ok: true; readonly op: BeachRewardOp }
  | { readonly ok: false; readonly reason: 'limit-reached' | 'ledger-unavailable' };

/**
 * Consume one slot of `windowKey` (call INSIDE the cross-tab lock). Counts
 * and inserts atomically with a read-back, so a slot is either durably
 * reserved or not reserved at all.
 */
export function reserveBeachReward(args: {
  pubkey: string;
  opId: string;
  roundKey: string;
  windowKey: string;
  limit: number;
  now: number;
}): ReserveOutcome {
  const { pubkey, opId, roundKey, windowKey, limit, now } = args;
  if (beachRewardedCount(pubkey, windowKey) >= limit) {
    return { ok: false, reason: 'limit-reached' };
  }
  const op: BeachRewardOp = {
    opId,
    roundKey,
    windowKey,
    status: 'reserved',
    amount: null,
    digs: 0,
    activeSeconds: 0,
    createdAt: now,
    updatedAt: now,
  };
  if (!persist(pubkey, op)) return { ok: false, reason: 'ledger-unavailable' };
  return { ok: true, op };
}

/** Track best-known participation while the round runs (refresh-safe). */
export function updateBeachRewardParticipation(
  pubkey: string,
  opId: string,
  participation: { digs: number; activeSeconds: number },
  now: number,
): void {
  const existing = readBeachRewardOp(pubkey, opId);
  if (!existing || existing.status !== 'reserved') return;
  persist(pubkey, {
    ...existing,
    digs: Math.max(existing.digs, participation.digs),
    activeSeconds: Math.max(existing.activeSeconds, participation.activeSeconds),
    updatedAt: now,
  });
}

/** Fix the amount BEFORE granting. Must land durably or the grant must not run. */
export function finalizeBeachReward(
  pubkey: string,
  opId: string,
  amount: number,
  now: number,
): boolean {
  const existing = readBeachRewardOp(pubkey, opId);
  if (!existing) return false;
  if (existing.status === 'finalized' && existing.amount === amount) return true;
  if (existing.status !== 'reserved' && existing.status !== 'finalized') return false;
  return persist(pubkey, { ...existing, status: 'finalized', amount, updatedAt: now });
}

/** Record the wallet grant's outcome. */
export function resolveBeachReward(
  pubkey: string,
  opId: string,
  status: 'applied' | 'ambiguous',
  now: number,
): boolean {
  const existing = readBeachRewardOp(pubkey, opId);
  if (!existing) return false;
  return persist(pubkey, { ...existing, status, updatedAt: now });
}

/**
 * Abandon a reserved hunt. Past the participation threshold the slot stays
 * consumed (`abandoned`); before it, the record is RELEASED (deleted) so an
 * accidental open-and-close does not burn the day. Finalized/applied ops are
 * never abandoned: their reward intent must survive.
 */
export function abandonBeachReward(
  pubkey: string,
  opId: string,
  crossedThreshold: boolean,
  now: number,
): void {
  const existing = readBeachRewardOp(pubkey, opId);
  if (!existing || existing.status !== 'reserved') return;
  if (crossedThreshold) {
    persist(pubkey, { ...existing, status: 'abandoned', updatedAt: now });
    return;
  }
  const ledger = readLedger();
  const owner = { ...(ledger[pubkey] ?? {}) };
  delete owner[opId];
  ledger[pubkey] = owner;
  writeLedger(ledger);
}

/** Operations needing attention on startup/entry (recovery scan). */
export function unresolvedBeachRewardOps(pubkey: string | undefined): BeachRewardOp[] {
  return Object.values(readBeachRewardOps(pubkey)).filter(
    (op) =>
      op.status === 'finalized' ||
      op.status === 'ambiguous' ||
      op.status === 'reserved',
  );
}

/** Tests and the DEV harness only. */
export function clearBeachRewardOps(pubkey?: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!pubkey) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const ledger = readLedger();
    delete ledger[pubkey];
    writeLedger(ledger);
  } catch {
    /* nothing to clear */
  }
}
