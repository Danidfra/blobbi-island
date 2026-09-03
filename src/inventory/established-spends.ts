/**
 * Blobbi Island — the kind:1416 spends THIS TAB has established.
 *
 * ## Why this exists
 *
 * A spend Island publishes is immutable and lives on the relays, but a relay
 * does not serve a fresh event the instant it accepts it, and the spend
 * query for an inventory may be refetched (focus, stale time) before the
 * event propagates. Without this record the effective quantity would drop on
 * publish and then briefly BOUNCE BACK UP when a refetch answered without the
 * new spend — an inventory that appears to refund a strawberry is a bug even
 * if it corrects itself a second later.
 *
 * This is the spend-side counterpart of `confirmed-inventory.ts`: the
 * derivation always merges what this tab knows it established with what the
 * relays returned, deduplicated by id. Because a spend is immutable and
 * identified by id, merging it in forever is harmless — once the owner folds
 * it, the chain excludes it and it stops counting on its own.
 *
 * ## What it is not
 *
 * Not a cache of relay state, not a ledger (that is
 * `src/lib/external-spend-ledger.ts`, which is durable and drives retries),
 * and never a reason to believe a spend applied: the DERIVATION still decides,
 * against the current snapshot and chain, whether an established spend is
 * applied, rejected, folded or voided.
 */

import type { NostrEvent } from '@nostrify/nostrify';

type Listener = () => void;

/** inventory address → spends, as an IMMUTABLE array replaced on change. */
let established: ReadonlyMap<string, readonly NostrEvent[]> = new Map();
const listeners = new Set<Listener>();

/** Record a spend this tab knows at least one relay accepted (or found by id). */
export function recordEstablishedSpend(inventoryAddress: string, event: NostrEvent): void {
  const current = established.get(inventoryAddress) ?? [];
  if (current.some((existing) => existing.id === event.id)) return;
  const next = new Map(established);
  next.set(inventoryAddress, [...current, event]);
  established = next;
  for (const listener of [...listeners]) listener();
}

/** Every spend this tab established against one inventory. Stable reference. */
export function establishedSpendsFor(inventoryAddress: string): readonly NostrEvent[] {
  return established.get(inventoryAddress) ?? EMPTY;
}

const EMPTY: readonly NostrEvent[] = Object.freeze([]);

/** The whole store, for `useSyncExternalStore`. Changes identity on every write. */
export function establishedSpendsSnapshot(): ReadonlyMap<string, readonly NostrEvent[]> {
  return established;
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribeEstablishedSpends(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only. */
export function clearEstablishedSpends(): void {
  established = new Map();
  for (const listener of [...listeners]) listener();
}
