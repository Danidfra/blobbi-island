/**
 * The newest kind:31633 event this tab is KNOWN to have published.
 *
 * ## Why this exists
 *
 * Every inventory writer invalidates the canonical query, and that was always
 * the intent — but invalidation only asks the relay again, and a relay does
 * not serve a replaceable event the instant it accepts it. The refetch
 * therefore raced propagation and usually won: it returned the event we had
 * just replaced, React Query stored that as fresh, and `staleTime` suppressed
 * further refetches. The old quantity then sat on screen until something
 * remounted or the page was reloaded.
 *
 * The information was never missing. `runInventoryTransaction` builds, signs
 * and publishes the exact event that lands; it simply threw that away and
 * asked the relay instead. This module is where it is kept instead, so the
 * confirmed result — not a race — decides what the UI shows.
 *
 * ## What it is not
 *
 * Not a cache of relay state, and not a source of truth for publishing. Every
 * write still reads its base authoritatively from the relay inside the lock;
 * nothing here is ever a publish base. It only answers "what did we last
 * confirm?", which is strictly more recent than anything a lagging relay can
 * say, because `created_at` is monotonic per writer.
 *
 * Entries are superseded as soon as a relay answer catches up, so this holds
 * at most one event per signed-in pubkey and normally nothing at all.
 */

import type { NostrEvent } from '@nostrify/nostrify';

type Listener = (pubkey: string, event: NostrEvent) => void;

const confirmed = new Map<string, NostrEvent>();
const listeners = new Set<Listener>();

/**
 * Record an event this tab published successfully.
 *
 * Keeps only the newest: a slow callback for an older write can never
 * overwrite a newer one. Notifies subscribers so the React cache can be
 * updated immediately rather than after a round trip.
 */
export function recordConfirmedInventory(pubkey: string, event: NostrEvent): void {
  const existing = confirmed.get(pubkey);
  if (existing && existing.created_at > event.created_at) return;
  confirmed.set(pubkey, event);
  for (const listener of [...listeners]) listener(pubkey, event);
}

/** The newest locally-confirmed event for this pubkey, if any. */
export function confirmedInventoryEvent(pubkey: string | undefined): NostrEvent | null {
  if (!pubkey) return null;
  return confirmed.get(pubkey) ?? null;
}

/**
 * Drop the record once the relay's own answer is at least as new.
 *
 * Called by the reader after every completed read: from that point the relay
 * is authoritative again and there is nothing local to remember.
 */
export function forgetSupersededInventory(pubkey: string, relayCreatedAt: number): void {
  const existing = confirmed.get(pubkey);
  if (existing && relayCreatedAt >= existing.created_at) confirmed.delete(pubkey);
}

/** Subscribe to confirmations. Returns an unsubscribe function. */
export function subscribeConfirmedInventory(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests and the DEV harness only. */
export function clearConfirmedInventories(): void {
  confirmed.clear();
}
