/**
 * The redemption ledger — durable, per-owner records of Prize Counter
 * redemptions, plus the synchronous same-document lock.
 *
 * The sibling of `arcade-claim-ledger.ts`, kept separate because the two
 * ledgers answer different questions ("was this RUN paid?" vs "was this PRIZE
 * bought?") and will be replaced by different things. The storage rules are
 * the ones the claim ledger established:
 *
 *  - **`localStorage`, keyed by owner pubkey** — two tabs must see the same
 *    records, or the same prize could be spent for twice;
 *  - **persist means write AND read back** — a record that did not survive the
 *    write does not exist, and the caller must treat that as a refusal to
 *    proceed rather than a warning;
 *  - **this is bug protection, not anti-fraud** — a modified client can edit
 *    all of it. Its job is to stop double-clicks, remounts and refreshes from
 *    double-spending an honest player's tickets.
 */

import type { ArcadePrizeRedemption } from '@/arcade/prizes/prize-redemption';
import { blocksNewRedemption, needsDelivery } from '@/arcade/prizes/prize-redemption';

export const ARCADE_REDEMPTIONS_STORAGE_KEY = 'blobbi:arcade:prize-redemptions:v1';

type LedgerShape = Record<string, Record<string, ArcadePrizeRedemption>>;

function readLedger(): LedgerShape {
  try {
    const raw = localStorage.getItem(ARCADE_REDEMPTIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as LedgerShape;
  } catch {
    return {};
  }
}

/** Every redemption recorded for this owner, keyed by redemption id. */
export function readRedemptions(
  pubkey: string | undefined,
): Record<string, ArcadePrizeRedemption> {
  if (!pubkey) return {};
  return readLedger()[pubkey] ?? {};
}

export function readRedemption(
  pubkey: string | undefined,
  redemptionId: string,
): ArcadePrizeRedemption | null {
  if (!pubkey) return null;
  return readRedemptions(pubkey)[redemptionId] ?? null;
}

/**
 * Write a redemption record durably. Returns `false` when the record did not
 * survive the write (quota, private mode, a hostile environment) — and the
 * caller must then refuse to publish anything, because a spend with no durable
 * record would be offered again after a refresh.
 */
export function persistRedemption(
  pubkey: string | undefined,
  redemption: ArcadePrizeRedemption,
): boolean {
  if (!pubkey) return false;
  try {
    const ledger = readLedger();
    const forOwner = { ...(ledger[pubkey] ?? {}), [redemption.redemptionId]: redemption };
    localStorage.setItem(
      ARCADE_REDEMPTIONS_STORAGE_KEY,
      JSON.stringify({ ...ledger, [pubkey]: forOwner }),
    );
    const readBack = readRedemption(pubkey, redemption.redemptionId);
    return readBack !== null && readBack.status === redemption.status;
  } catch {
    return false;
  }
}

/**
 * The record that FORBIDS starting a new redemption of this prize, if any.
 * Spending, unresolved, spent and delivering always block; `confirmed` blocks
 * only a NON-repeatable prize (a repeatable prize's confirmed attempts are
 * finished purchases, not locks). Abandoned reservations and provably-failed
 * attempts never block.
 */
export function blockingRedemptionForPrize(
  pubkey: string | undefined,
  prizeId: string,
  prizeRepeatable = false,
): ArcadePrizeRedemption | null {
  const records = Object.values(readRedemptions(pubkey)).filter((r) => r.prizeId === prizeId);
  const blocking = records.filter((r) => blocksNewRedemption(r, prizeRepeatable));
  if (blocking.length === 0) return null;
  // The most recently updated one is the one the UI should represent.
  return blocking.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

/** Redemptions whose tickets are spent but whose delivery has not completed. */
export function pendingDeliveries(pubkey: string | undefined): readonly ArcadePrizeRedemption[] {
  return Object.values(readRedemptions(pubkey))
    .filter(needsDelivery)
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

/** Prize ids with a CONFIRMED redemption for this owner. */
export function confirmedPrizeIds(pubkey: string | undefined): readonly string[] {
  return [
    ...new Set(
      Object.values(readRedemptions(pubkey))
        .filter((r) => r.status === 'confirmed')
        .map((r) => r.prizeId),
    ),
  ];
}

/** Test/DEV helper. */
export function clearRedemptions(pubkey?: string): void {
  if (!pubkey) {
    localStorage.removeItem(ARCADE_REDEMPTIONS_STORAGE_KEY);
    return;
  }
  const ledger = readLedger();
  if (!(pubkey in ledger)) return;
  const next = { ...ledger };
  delete next[pubkey];
  localStorage.setItem(ARCADE_REDEMPTIONS_STORAGE_KEY, JSON.stringify(next));
}

// ── The synchronous same-document lock ─────────────────────────────────────
//
// Two clicks in one tick race ahead of any persisted record, so the first
// guard must be synchronous module state: no await, no re-render, no storage
// read between check and set. Keyed by owner + prize, because the thing being
// protected is "one spend per prize at a time", not one per attempt.

const activeLocks = new Set<string>();

const lockKey = (pubkey: string, prizeId: string) => `${pubkey}:${prizeId}`;

export function acquireRedemptionLock(pubkey: string, prizeId: string): boolean {
  const key = lockKey(pubkey, prizeId);
  if (activeLocks.has(key)) return false;
  activeLocks.add(key);
  return true;
}

export function releaseRedemptionLock(pubkey: string, prizeId: string): void {
  activeLocks.delete(lockKey(pubkey, prizeId));
}

/** Test helper: forget every in-flight lock. */
export function resetRedemptionLocks(): void {
  activeLocks.clear();
}
