/**
 * The generic prize-DELIVERY contract, plus a local reference implementation.
 *
 * ## What survives, and why
 *
 * {@link ArcadePrizeOwnership} is the seam that lets ONE hardened redemption
 * flow deliver two very different things. Both live implementations satisfy it:
 *
 *  - the six cosmetics, delivered into kind:31633 by the SPEND'S OWN event
 *    (`src/inventory/arcade-cosmetic-redeemer.ts`, `atomicWithSpend: true`) —
 *    there `grantPrize` writes nothing and verifies instead;
 *  - the Arcade Pass, delivered into the expiring entitlement store
 *    (`src/arcade/prizes/arcade-pass-prize.ts`), which genuinely is a second
 *    write and genuinely needs the paid-but-undelivered recovery path.
 *
 * ## {@link createLocalPrizeOwnership} is NOT a production delivery
 *
 * It is the contract's reference implementation, kept for the redemption
 * machinery's tests and for any future prize whose real home does not exist
 * yet. NO production surface wires it: `useArcadePrizeRedemption` requires an
 * explicit `ownership`, precisely so a delivery can never silently land in
 * local storage. What it is, stated honestly:
 *
 *  - it is **namespaced local storage**, per owner pubkey, under a key that
 *    says `temp` out loud;
 *  - it is **not** the kind:31633 inventory, is never mixed into the ticket
 *    event, and must never be presented as authoritative — another device
 *    knows nothing about it;
 *  - it sits behind {@link ArcadePrizeOwnership} precisely so the real
 *    deliveries can replace it writer-by-writer without the Prize Counter
 *    changing shape — which is exactly what the cosmetics and the Pass did.
 *
 * ## Idempotency is PER DELIVERY ATTEMPT, not per prize
 *
 * Every grant carries the redemption id it delivers, and the record remembers
 * every id it has delivered. That distinction is what makes repeatable prizes
 * correct: retrying the delivery of ONE redemption (the recovery path may
 * legitimately run several times) never increments the count, while a NEW
 * confirmed redemption of a repeatable prize increments it exactly once. A
 * non-repeatable prize additionally never counts past one, whatever ids
 * arrive — preventing the duplicate purchase is the redemption boundary's job
 * (eligibility refuses an owned prize; the ledger blocks a second redemption),
 * and this store is the belt-and-braces behind it.
 *
 * ## Migration safety
 *
 * Records written before delivery identity existed lack
 * `deliveredRedemptionIds`; they are normalised to an empty list on read, so
 * an old record keeps its count and simply starts remembering ids from now on.
 */

import type { ArcadePrize } from '@/arcade/prizes/prize-catalogue';

/** One owned prize, as persisted. Plain JSON. */
export interface OwnedPrizeRecord {
  readonly prizeId: string;
  /** How many times it was granted. Never above `1` for non-repeatable prizes. */
  readonly count: number;
  /** Epoch ms of the first grant. */
  readonly firstGrantedAt: number;
  /** Every redemption id this record has already delivered. */
  readonly deliveredRedemptionIds: readonly string[];
}

/**
 * The delivery capability the redemption hook holds. Async by contract even
 * though the temporary implementation is synchronous storage — the real
 * writers (inventory, badges, effects, furniture) will not be.
 */
export interface ArcadePrizeOwnership {
  /**
   * `true` when this delivery rides on the SPEND'S OWN kind:31633 event — the
   * debit and the grant are one replacement event, so they land together or
   * not at all (`src/inventory/arcade-cosmetic-redeemer.ts`).
   *
   * The redemption hook reads this to choose its reconciliation evidence: an
   * atomic redemption is reconciled against the PRIZE, which only that event
   * could have granted, instead of against a ticket balance other writers also
   * move. Absent/false keeps the two-stage semantics the Arcade Pass needs.
   */
  readonly atomicWithSpend?: boolean;
  hasPrize(pubkey: string, prizeId: string): Promise<boolean>;
  /**
   * Was THIS delivery attempt recorded? The verification the hook runs after
   * every grant, and the question that makes per-attempt idempotency testable.
   */
  hasDelivery(pubkey: string, prizeId: string, redemptionId: string): Promise<boolean>;
  /** Deliver one redemption. Idempotent per `redemptionId` — see the header. */
  grantPrize(pubkey: string, prize: ArcadePrize, redemptionId: string): Promise<void>;
  listOwnedPrizes(pubkey: string): Promise<readonly OwnedPrizeRecord[]>;
}

/** `temp` is in the key on purpose: this namespace is scheduled for deletion. */
const STORAGE_PREFIX = 'blobbi:arcade:prize-ownership:temp-v1:';

function storageKey(pubkey: string): string {
  return `${STORAGE_PREFIX}${pubkey}`;
}

/** Pre-delivery-identity records lack the id list; normalise, never crash. */
function normalise(record: OwnedPrizeRecord): OwnedPrizeRecord {
  return {
    ...record,
    deliveredRedemptionIds: Array.isArray(record.deliveredRedemptionIds)
      ? record.deliveredRedemptionIds
      : [],
  };
}

function readAll(pubkey: string): Record<string, OwnedPrizeRecord> {
  try {
    const raw = localStorage.getItem(storageKey(pubkey));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const records = parsed as Record<string, OwnedPrizeRecord>;
    return Object.fromEntries(Object.entries(records).map(([id, r]) => [id, normalise(r)]));
  } catch {
    return {};
  }
}

/**
 * The temporary implementation. `now` is injectable so tests and the DEV
 * harness stay deterministic.
 */
export function createLocalPrizeOwnership(now: () => number = Date.now): ArcadePrizeOwnership {
  return {
    async hasPrize(pubkey: string, prizeId: string): Promise<boolean> {
      if (!pubkey) return false;
      return prizeId in readAll(pubkey);
    },

    async hasDelivery(pubkey: string, prizeId: string, redemptionId: string): Promise<boolean> {
      if (!pubkey) return false;
      return readAll(pubkey)[prizeId]?.deliveredRedemptionIds.includes(redemptionId) ?? false;
    },

    async grantPrize(pubkey: string, prize: ArcadePrize, redemptionId: string): Promise<void> {
      if (!pubkey) throw new Error('Cannot grant a prize without an owner');
      if (typeof redemptionId !== 'string' || redemptionId.trim().length === 0) {
        throw new Error('Cannot grant a prize without a redemption id');
      }
      const all = readAll(pubkey);
      const existing = all[prize.id];

      // The SAME attempt again — the recovery path re-running. Nothing moves.
      if (existing?.deliveredRedemptionIds.includes(redemptionId)) return;

      const record: OwnedPrizeRecord = existing
        ? {
            ...existing,
            // A NEW redemption id increments a repeatable prize exactly once;
            // a non-repeatable one records the id but never counts past 1.
            count: prize.repeatable ? existing.count + 1 : existing.count,
            deliveredRedemptionIds: [...existing.deliveredRedemptionIds, redemptionId],
          }
        : {
            prizeId: prize.id,
            count: 1,
            firstGrantedAt: now(),
            deliveredRedemptionIds: [redemptionId],
          };

      // Write AND read back, so a refused write (private mode, full quota)
      // surfaces as a delivery failure instead of a silent nothing.
      localStorage.setItem(storageKey(pubkey), JSON.stringify({ ...all, [prize.id]: record }));
      const readBack = readAll(pubkey)[prize.id];
      if (!readBack?.deliveredRedemptionIds.includes(redemptionId)) {
        throw new Error('The prize delivery could not be recorded');
      }
    },

    async listOwnedPrizes(pubkey: string): Promise<readonly OwnedPrizeRecord[]> {
      if (!pubkey) return [];
      return Object.values(readAll(pubkey));
    },
  };
}

/** Test/DEV helper: forget everything this TEMPORARY store holds. */
export function clearLocalPrizeOwnership(pubkey?: string): void {
  if (pubkey) {
    localStorage.removeItem(storageKey(pubkey));
    return;
  }
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) doomed.push(key);
  }
  for (const key of doomed) localStorage.removeItem(key);
}
