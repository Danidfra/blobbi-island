/**
 * The external-spend ledger, the durable half of "one kind:1416 per player
 * action, and one Blobbi effect per kind:1416".
 *
 * A kind:1416 Game Inventory Spend is immutable and identified by its event
 * id. That id is the durable identity of a consumption: it is what a retry
 * republishes, what the Blobbi effect is keyed to, and what a reconciliation
 * looks for. This ledger keeps, per signed-in pubkey, every spend this browser
 * signed together with the SIGNED EVENT ITSELF, so a retry after an
 * ambiguous publish can offer the exact same bytes again instead of signing a
 * semantically equivalent second spend, which would be a second debit.
 *
 * ## Status lifecycle
 *
 * ```
 *   signed ─► publishing ─┬─► established ─┬─► applied            (terminal)
 *                         │                └─► effect-ambiguous ─► applied
 *                         ├─► unconfirmed ──(republish SAME event)─► established
 *                         └─► failed                                (terminal)
 * ```
 *
 * - `unconfirmed`: the publish was ambiguous (every relay silent) and the id
 *   was not found. The event MAY exist. The only allowed retry is to publish
 *   the same signed event again; it may become `failed` only through a
 *   DEFINITE rejection by every relay on that republish.
 * - `established`: at least one relay accepted the event, or it was found by
 *   id. The debit exists. The Blobbi effect for it has not been confirmed.
 * - `effect-ambiguous`: the kind:31124 publish carrying this spend's marker
 *   may have landed. Reconcile against the pet's newest state; never sign a
 *   second spend.
 * - `applied`: the effect is confirmed on kind:31124. One-way door.
 * - `failed`: provably never published (signer refused, or every relay
 *   answered with a definite rejection). Terminal: a new player action signs
 *   a NEW spend; this one is never offered again.
 *
 * ## Honest limits
 *
 * Durable per browser profile only. Another device has an empty ledger, and
 * also no signed event to replay, so it cannot duplicate this one; it can
 * only sign its own, which the protocol's deterministic order then applies or
 * rejects. Storage that silently drops writes is detected by read-back, and a
 * failed read-back refuses to publish rather than proceeding unrecorded.
 */

import type { NostrEvent } from '@nostrify/nostrify';

export type ExternalSpendStatus =
  | 'signed'
  | 'publishing'
  | 'unconfirmed'
  | 'established'
  | 'effect-ambiguous'
  | 'applied'
  | 'failed';

export interface ExternalSpendRecord {
  /** The kind:1416 event id. THE identity of the consumption. */
  readonly spendId: string;
  /** The full `31633:<owner>:<d>` inventory the spend debits. */
  readonly inventoryAddress: string;
  /** The full `31632:<issuer>:<d>` item the spend debits. */
  readonly itemAddress: string;
  readonly quantity: number;
  /** The Blobbi the effect is for. */
  readonly petId: string;
  readonly status: ExternalSpendStatus;
  /** The signed event, verbatim, so a retry republishes exactly this. */
  readonly event: NostrEvent;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly note?: string;
}

const STORAGE_KEY = 'blobbi:external-spend:ops';

const STATUSES = new Set<ExternalSpendStatus>([
  'signed',
  'publishing',
  'unconfirmed',
  'established',
  'effect-ambiguous',
  'applied',
  'failed',
]);

type Ledger = Record<string, Record<string, ExternalSpendRecord>>;

function isRecord(value: unknown): value is ExternalSpendRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.spendId === 'string' &&
    typeof r.inventoryAddress === 'string' &&
    typeof r.itemAddress === 'string' &&
    typeof r.quantity === 'number' &&
    typeof r.petId === 'string' &&
    typeof r.status === 'string' &&
    STATUSES.has(r.status as ExternalSpendStatus) &&
    !!r.event &&
    typeof r.event === 'object' &&
    typeof (r.event as { id?: unknown }).id === 'string' &&
    typeof r.createdAt === 'number' &&
    typeof r.updatedAt === 'number'
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
      const kept: Record<string, ExternalSpendRecord> = {};
      for (const [id, record] of Object.entries(ops as Record<string, unknown>)) {
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

export function readExternalSpendOps(
  pubkey: string | undefined,
): Record<string, ExternalSpendRecord> {
  if (!pubkey) return {};
  return readLedger()[pubkey] ?? {};
}

export function readExternalSpendOp(
  pubkey: string | undefined,
  spendId: string,
): ExternalSpendRecord | null {
  return readExternalSpendOps(pubkey)[spendId] ?? null;
}

/** A record whose consumption is not finished: something remains to be done. */
export function isOpenExternalSpend(record: ExternalSpendRecord): boolean {
  return record.status !== 'applied' && record.status !== 'failed';
}

/**
 * The unfinished consumptions of one item from one inventory for one Blobbi,
 * oldest first. A new player action on that row RESUMES the oldest of these
 * instead of signing a new spend: the debit (or its possibility) already
 * exists, and only the remaining steps are owed.
 */
export function openExternalSpendOps(
  pubkey: string | undefined,
  inventoryAddress: string,
  itemAddress: string,
  petId: string,
): ExternalSpendRecord[] {
  return Object.values(readExternalSpendOps(pubkey))
    .filter(
      (record) =>
        isOpenExternalSpend(record) &&
        record.inventoryAddress === inventoryAddress &&
        record.itemAddress === itemAddress &&
        record.petId === petId,
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Rank used by the one-way doors: a record never moves to a lower rank. */
const RANK: Record<ExternalSpendStatus, number> = {
  signed: 0,
  publishing: 1,
  unconfirmed: 2,
  established: 3,
  'effect-ambiguous': 4,
  applied: 5,
  failed: 5,
};

/**
 * Record (or advance) a spend, and prove the write landed.
 *
 * Returns `true` only when the record was read back with the expected status.
 * A `false` before a publish means DO NOT PUBLISH: without a durable record
 * of the signed event, an ambiguous outcome could never be reconciled and a
 * refresh would offer the player a second signature.
 *
 * One-way doors:
 * - `applied` and `failed` are terminal;
 * - a possibly-published record (`publishing`, `unconfirmed`, `established`,
 *   `effect-ambiguous`) never regresses to `signed`;
 * - `failed` is reachable from `signed`/`publishing` (definite refusal) and
 *   from `unconfirmed` (definite refusal on republish): never from
 *   `established` or later, because the debit exists.
 */
export function persistExternalSpendOp(
  pubkey: string | undefined,
  record: ExternalSpendRecord,
): boolean {
  if (!pubkey) return false;
  const ledger = readLedger();
  const owner = { ...(ledger[pubkey] ?? {}) };
  const existing = owner[record.spendId];
  if (existing) {
    if (existing.status === 'applied' || existing.status === 'failed') {
      return existing.status === record.status;
    }
    if (record.status === 'failed' && RANK[existing.status] >= RANK.established) return false;
    if (record.status !== 'failed' && RANK[record.status] < RANK[existing.status]) return false;
  }
  owner[record.spendId] = record;
  ledger[pubkey] = owner;
  if (!writeLedger(ledger)) return false;
  const stored = readExternalSpendOp(pubkey, record.spendId);
  return stored !== null && stored.status === record.status;
}

/** Tests and the DEV harness only. */
export function clearExternalSpendOps(pubkey?: string): void {
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
    // Nothing to clear.
  }
}
