/**
 * The pet-energy operation ledger, the durable half of "one energy
 * subtraction per operation, ever".
 *
 * Modelled on `src/lib/coin-op-ledger.ts`, for the same reason it exists: a
 * fresh read before a write prevents stale clobbering, but it does NOT make a
 * DELTA idempotent. `-30` applied to an energy value that already reflects the
 * first `-30` is `-60`, and kind:31124 carries a scalar `energy` and nothing
 * else, so the relay cannot know an operation was already applied. That
 * knowledge can only live in a durable record keyed by operation id.
 *
 * Energy is harder to reconcile than Coins: observing a value proves nothing
 * on its own, because care actions move energy too. The settler therefore
 * writes an opaque marker tag onto the replacement event and reconciles by
 * looking for it; see `src/mine/energy-settlement.ts`. This ledger stores the
 * evidence that reconciliation needs.
 *
 * ## Status lifecycle
 *
 * ```
 *              ┌────────► failed ──(retry = new attempt, SAME opId)──┐
 *              │                                                      ▼
 *   prepared ─►┴─► publishing ─┬─► applied            (terminal, sticky)
 *                              └─► ambiguous ─(read-only reconcile)─► applied
 * ```
 *
 * - `failed` = PROVABLY not published. The only retryable state.
 * - `ambiguous` = MAY have landed. Reaches `applied` only through read-only
 *   reconciliation, never by re-publishing.
 * - `applied` is a one-way door.
 *
 * ## Honest limits
 *
 * Durable per browser profile only, exactly like the Coin and Beach ledgers. A
 * different device has an empty ledger, and also no opId to replay, because
 * ids are minted where the operation runs. Storage that silently drops writes
 * is caught by read-back, and a failed read-back REFUSES the publish rather
 * than proceeding unrecorded.
 */

export type PetEnergyOpStatus =
  | 'prepared'
  | 'publishing'
  | 'applied'
  | 'ambiguous'
  | 'failed';

export interface PetEnergyOpRecord {
  readonly opId: string;
  readonly petId: string;
  /** Positive integer energy the operation asked to subtract. */
  readonly requestedDelta: number;
  readonly status: PetEnergyOpStatus;
  /** Short debug context, e.g. 'mine-energy'. */
  readonly label: string;
  /** Authoritative energy read immediately before publishing. */
  readonly energyBefore: number | null;
  /** Energy the publish was expected to produce (clamped at 0). */
  readonly energyAfter: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly note?: string;
}

const STORAGE_KEY = 'blobbi:pet-energy:ops';

const STATUSES = new Set<PetEnergyOpStatus>([
  'prepared',
  'publishing',
  'applied',
  'ambiguous',
  'failed',
]);

type Ledger = Record<string, Record<string, PetEnergyOpRecord>>;

function isRecord(value: unknown): value is PetEnergyOpRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PetEnergyOpRecord>;
  return (
    typeof record.opId === 'string' &&
    typeof record.petId === 'string' &&
    typeof record.requestedDelta === 'number' &&
    typeof record.status === 'string' &&
    STATUSES.has(record.status as PetEnergyOpStatus) &&
    typeof record.label === 'string'
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
    for (const [pubkey, ops] of Object.entries(parsed as Record<string, unknown>)) {
      if (!ops || typeof ops !== 'object' || Array.isArray(ops)) continue;
      const kept: Record<string, PetEnergyOpRecord> = {};
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

function writeLedger(ledger: Ledger): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
    return true;
  } catch {
    return false;
  }
}

export function readPetEnergyOp(
  pubkey: string | undefined,
  opId: string,
): PetEnergyOpRecord | null {
  if (!pubkey) return null;
  return readLedger()[pubkey]?.[opId] ?? null;
}

/** A record in a state where a NEW publish must not be attempted. */
export function petEnergyOpBlocksPublish(record: PetEnergyOpRecord | null): boolean {
  return record?.status === 'publishing' || record?.status === 'ambiguous';
}

/**
 * Persist a record and VERIFY it by reading back. Returns false when storage
 * refused: callers must then refuse to publish.
 *
 * `applied` is sticky: a late callback can never downgrade it.
 */
export function persistPetEnergyOp(
  pubkey: string | undefined,
  record: PetEnergyOpRecord,
): boolean {
  if (!pubkey) return false;
  const ledger = readLedger();
  const existing = ledger[pubkey]?.[record.opId];
  if (existing?.status === 'applied' && record.status !== 'applied') return true;
  ledger[pubkey] = { ...(ledger[pubkey] ?? {}), [record.opId]: record };
  if (!writeLedger(ledger)) return false;
  return readPetEnergyOp(pubkey, record.opId)?.status === record.status;
}

/** Operations that are neither settled nor provably unsent. */
export function unresolvedPetEnergyOps(
  pubkey: string | undefined,
): PetEnergyOpRecord[] {
  if (!pubkey) return [];
  return Object.values(readLedger()[pubkey] ?? {}).filter(
    (record) => record.status === 'publishing' || record.status === 'ambiguous',
  );
}

export function deletePetEnergyOp(pubkey: string | undefined, opId: string): boolean {
  if (!pubkey) return false;
  const ledger = readLedger();
  if (!ledger[pubkey]?.[opId]) return true;
  const { [opId]: _removed, ...rest } = ledger[pubkey];
  ledger[pubkey] = rest;
  return writeLedger(ledger);
}

/** Test/diagnostic helper. */
export function clearPetEnergyOps(pubkey?: string): void {
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
