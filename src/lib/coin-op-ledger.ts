/**
 * The Coin operation ledger — the durable half of "one Coin mutation per
 * operation, ever".
 *
 * A direct generalization of the arcade claim ledger
 * (`src/lib/arcade-claim-ledger.ts`), built around the same discovered
 * defect: a fresh read before a write prevents stale clobbering but does NOT
 * make an ADDITIVE mutation idempotent — `+4` applied to a balance that
 * already includes the first `+4` is `+8`, and kind:31633 carries quantities
 * and nothing else, so the relay cannot know an operation was already paid.
 * The only place that knowledge can live is a durable local record keyed by
 * operation id.
 *
 * Every value-bearing Coin mutation (bootstrap, Mine payout, Beach reward,
 * shop spend, pass purchase) carries an `opId`; the wallet refuses to publish
 * without first landing a `publishing` record here, read-back verified.
 *
 * ## Status lifecycle
 *
 * ```
 *              ┌────────► failed ──(retry = new attempt, same opId)──┐
 *              │                                                     ▼
 *   prepared ─►┴─► publishing ─┬─► applied            (terminal, sticky)
 *                              └─► ambiguous ─(read-only reconcile)─► applied
 * ```
 *
 * - `failed` means PROVABLY not published (signer refused, pre-publish
 *   throw). It is the only retryable state.
 * - `ambiguous` means the publish MAY have landed (timeout, unclassifiable
 *   error). It can only ever become `applied` through read-only
 *   reconciliation — never re-expressed as a fresh publishable operation.
 * - `applied` is a one-way door: a late failure callback cannot reopen it.
 *
 * ## Honest limits (same as the arcade ledger)
 *
 * Durable per browser profile only. A different device has an empty ledger —
 * but also has no opId to replay, since ids are minted where the operation
 * runs. Storage that silently drops writes is detected by read-back, and a
 * failed read-back REFUSES the publish rather than proceeding unrecorded.
 */

/** Where an operation stands. See the module doc for the lifecycle. */
export type CoinOpStatus = 'prepared' | 'publishing' | 'applied' | 'ambiguous' | 'failed';

export type CoinOpKind = 'grant' | 'spend';

export interface CoinOpRecord {
  readonly opId: string;
  readonly kind: CoinOpKind;
  /** Positive integer amount of the mutation. */
  readonly amount: number;
  readonly status: CoinOpStatus;
  /** Short human/debug context: 'legacy-bootstrap', 'beach-reward', … */
  readonly label: string;
  /** Fresh balance read immediately before publishing, for reconciliation. */
  readonly balanceBefore: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly note?: string;
}

const STORAGE_KEY = 'blobbi:coin:ops';

const STATUSES = new Set<CoinOpStatus>([
  'prepared',
  'publishing',
  'applied',
  'ambiguous',
  'failed',
]);

type CoinOpLedger = Record<string, Record<string, CoinOpRecord>>;

function isRecord(value: unknown): value is CoinOpRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<CoinOpRecord>;
  return (
    typeof record.opId === 'string' &&
    (record.kind === 'grant' || record.kind === 'spend') &&
    typeof record.amount === 'number' &&
    typeof record.status === 'string' &&
    STATUSES.has(record.status as CoinOpStatus) &&
    typeof record.label === 'string'
  );
}

function readLedger(): CoinOpLedger {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const ledger: CoinOpLedger = {};
    for (const [pubkey, ops] of Object.entries(parsed as Record<string, unknown>)) {
      if (!ops || typeof ops !== 'object' || Array.isArray(ops)) continue;
      const kept: Record<string, CoinOpRecord> = {};
      for (const [opId, record] of Object.entries(ops as Record<string, unknown>)) {
        if (isRecord(record)) kept[opId] = record;
      }
      ledger[pubkey] = kept;
    }
    return ledger;
  } catch {
    return {};
  }
}

function writeLedger(ledger: CoinOpLedger): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
    return true;
  } catch {
    return false;
  }
}

export function readCoinOps(pubkey: string | undefined): Record<string, CoinOpRecord> {
  if (!pubkey) return {};
  return readLedger()[pubkey] ?? {};
}

export function readCoinOp(pubkey: string | undefined, opId: string): CoinOpRecord | null {
  return readCoinOps(pubkey)[opId] ?? null;
}

/**
 * Does a durable record forbid a NEW publish for this operation?
 *
 * `applied` (already paid), `publishing` and `ambiguous` (may already be
 * paid) all block. `prepared`/`failed` are provably-unsent and do not.
 */
export function coinOpBlocksPublish(record: CoinOpRecord | null): boolean {
  return (
    record !== null &&
    (record.status === 'applied' ||
      record.status === 'publishing' ||
      record.status === 'ambiguous')
  );
}

/**
 * Record (or advance) an operation, and prove the write landed.
 *
 * Returns `true` only when the record was read back with the expected
 * status. A caller getting `false` MUST NOT publish — without a durable
 * record, the operation would be offered again after a refresh, which is
 * exactly how one additive grant becomes two.
 *
 * One-way doors, mirroring the arcade ledger:
 * - `applied` never regresses;
 * - `ambiguous` may only become `applied` (or stay `ambiguous`);
 * - an in-flight `publishing` record may not be replaced by a fresh
 *   `prepared` one (it MAY become `failed`: pre-publish guards throw after
 *   the record advanced, and that is a provably-unsent outcome).
 */
export function persistCoinOp(pubkey: string | undefined, record: CoinOpRecord): boolean {
  if (!pubkey) return false;
  const ledger = readLedger();
  const owner = { ...(ledger[pubkey] ?? {}) };
  const existing = owner[record.opId];

  if (existing?.status === 'applied' && record.status !== 'applied') return true;

  const downgradesAPossiblyPublishedOp =
    (existing?.status === 'ambiguous' &&
      record.status !== 'ambiguous' &&
      record.status !== 'applied') ||
    (existing?.status === 'publishing' &&
      (record.status === 'prepared' || record.status === 'publishing') &&
      existing.updatedAt !== record.updatedAt);
  if (downgradesAPossiblyPublishedOp) return false;

  owner[record.opId] = record;
  ledger[pubkey] = owner;
  if (!writeLedger(ledger)) return false;

  const stored = readCoinOp(pubkey, record.opId);
  return stored !== null && stored.status === record.status;
}

/** Remove one operation record. Reservation-release and tests only. */
export function deleteCoinOp(pubkey: string | undefined, opId: string): boolean {
  if (!pubkey) return false;
  const ledger = readLedger();
  const owner = { ...(ledger[pubkey] ?? {}) };
  const existing = owner[opId];
  // Possibly-published operations are never deletable — deleting the record
  // is what would allow a second publish.
  if (existing && coinOpBlocksPublish(existing)) return false;
  delete owner[opId];
  ledger[pubkey] = owner;
  return writeLedger(ledger);
}

/** Every unresolved (publishing/ambiguous) operation, for recovery scans. */
export function unresolvedCoinOps(pubkey: string | undefined): CoinOpRecord[] {
  return Object.values(readCoinOps(pubkey)).filter(
    (record) => record.status === 'publishing' || record.status === 'ambiguous',
  );
}

/** Tests and the DEV harness only. */
export function clearCoinOps(pubkey?: string): void {
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
