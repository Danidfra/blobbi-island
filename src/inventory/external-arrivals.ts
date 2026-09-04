/**
 * Blobbi Island: noticing that something ARRIVED in an inventory another
 * game writes, without ever mistaking a refetch, a fold or a reload for it.
 *
 * ```
 *   derived view (ready inventories, EFFECTIVE quantities)
 *        ↓ observeExternalInventories(baseline, view)
 *   { baseline', arrivals }      arrival = effective went UP since last seen
 * ```
 *
 * ## What is compared
 *
 * The EFFECTIVE quantity of every item in every READY inventory: the same
 * number the collection shows, after the snapshot, the pending kind:1416
 * spends and the kind:1417 fold chain (`deriveExternalInventoryStates`).
 * Never the raw snapshot. A fold that debits the snapshot and retires the
 * spend it settles leaves the effective number where it was, so it cannot
 * look like an arrival; a consumption lowers it; only a real credit raises
 * it. Event topology is invisible here on purpose.
 *
 * ## The baseline, and why hydration cannot notify
 *
 * The first observation for a player HYDRATES: it records what is there and
 * reports nothing, because everything present at startup was earned before
 * the Island was opened. An inventory that is discovered at hydration but
 * cannot be resolved yet (its fold chain is still being fetched) is marked
 * ABSORBING: its first READY observation records its numbers silently as
 * well, since those items were also already there. Only after that does a
 * higher number mean "new".
 *
 * An inventory first discovered AFTER hydration (a game the player has just
 * started playing) has no history: every item in it is an arrival from 0,
 * which is exactly the first harvest of a new Farm player.
 *
 * A quantity that goes to zero stays recorded as 0 rather than forgotten, so
 * "3 → 0 → 1" reports +1 and not a first sighting.
 *
 * ## Same state, twice
 *
 * The baseline is updated in the same step that reports an arrival, so the
 * same state observed again (a duplicate event, a refetch that returns what
 * the tail already applied, a remount) diffs to nothing.
 *
 * Pure. Nothing here knows what a strawberry, a Farm, or a toast is.
 */

import type { ExternalInventoryView } from './external-inventory-events';
import { getInventoryItems } from './package';

/** What the detector remembers for one player. Immutable value. */
export interface ArrivalBaseline {
  owner: string;
  /**
   * Inventories discovered at hydration whose first READY observation must
   * be absorbed rather than reported.
   */
  absorbing: ReadonlySet<string>;
  /** `<inventoryAddress>|<itemAddress>` → the last effective quantity seen. */
  quantities: ReadonlyMap<string, number>;
}

/** One item whose effective quantity rose. */
export interface ExternalArrival {
  inventoryAddress: string;
  inventoryId: string;
  itemAddress: string;
  /** The `a` tag's relay hint, for definition resolution. */
  itemRelay: string;
  previous: number;
  current: number;
  /** `current - previous`, always ≥ 1. */
  delta: number;
}

export function arrivalKey(inventoryAddress: string, itemAddress: string): string {
  return `${inventoryAddress}|${itemAddress}`;
}

/**
 * Observe the current view against the baseline.
 *
 * `baseline === null` means "nothing observed yet for this owner": the call
 * hydrates and reports nothing. Inventories that are not ready are left
 * exactly as remembered; they are compared again when they resolve.
 */
export function observeExternalInventories(
  baseline: ArrivalBaseline | null,
  view: ExternalInventoryView,
  owner: string,
): { baseline: ArrivalBaseline; arrivals: ExternalArrival[] } {
  const quantities = new Map(baseline?.owner === owner ? baseline.quantities : []);
  const absorbing = new Set(baseline?.owner === owner ? baseline.absorbing : []);
  const hydrating = baseline === null || baseline.owner !== owner;
  const arrivals: ExternalArrival[] = [];

  for (const inventory of view.inventories) {
    const state = view.states.get(inventory.address);
    if (!state || state.status !== 'ready' || !state.effective) {
      // Present but not resolvable yet. At hydration that makes it absorbing;
      // afterwards it simply waits: its numbers are compared when it resolves.
      if (hydrating) absorbing.add(inventory.address);
      continue;
    }

    const silent = hydrating || absorbing.has(inventory.address);
    absorbing.delete(inventory.address);

    const seen = new Set<string>();
    for (const item of getInventoryItems(state.effective)) {
      const key = arrivalKey(inventory.address, item.address);
      seen.add(key);
      const current = item.quantity;
      const previous = quantities.get(key) ?? 0;
      if (!silent && current > previous) {
        arrivals.push({
          inventoryAddress: inventory.address,
          inventoryId: inventory.id,
          itemAddress: item.address,
          itemRelay: item.relay,
          previous,
          current,
          delta: current - previous,
        });
      }
      quantities.set(key, current);
    }
    // An item that vanished is remembered as 0, never forgotten.
    const prefix = `${inventory.address}|`;
    for (const key of quantities.keys()) {
      if (key.startsWith(prefix) && !seen.has(key)) quantities.set(key, 0);
    }
  }

  return { baseline: { owner, absorbing, quantities }, arrivals };
}

// ── presentation ────────────────────────────────────────────────────────────

/** An arrival with its human-readable identity resolved. */
export interface ResolvedArrival {
  itemAddress: string;
  name: string;
  imageUrl?: string;
  emoji?: string;
  /** The trusted issuer's product name, "Nostr Farm". */
  sourceName: string;
  delta: number;
}

export interface ArrivalNotice {
  /** "+1 Strawberry", "+1 Strawberry, +2 Carrot", "4 items received" */
  title: string;
  /** "Received from Nostr Farm" */
  description: string;
  /** The single item's image, when there is one item and it has one. */
  imageUrl?: string;
  emoji?: string;
}

/** Up to this many items are named in the title; more are counted. */
const MAX_NAMED_ARRIVALS = 3;

/** "+3 Strawberry": the count leads, the name stays singular; no grammar to get wrong. */
export function formatArrival(arrival: Pick<ResolvedArrival, 'name' | 'delta'>): string {
  return `+${arrival.delta} ${arrival.name}`;
}

/** "Nostr Farm", "Nostr Farm and Guild Hall", "Nostr Farm, Guild Hall and Arcade". */
function joinSources(sources: readonly string[]): string {
  if (sources.length <= 1) return sources[0] ?? '';
  return `${sources.slice(0, -1).join(', ')} and ${sources[sources.length - 1]}`;
}

/**
 * One notice for everything that arrived in one reconciliation. The toast
 * system shows one notice at a time, so several items are one message
 * rather than a flood: a few are named, many are counted.
 */
export function describeArrivals(arrivals: readonly ResolvedArrival[]): ArrivalNotice | null {
  if (arrivals.length === 0) return null;
  const sources = [...new Set(arrivals.map((arrival) => arrival.sourceName))];
  const description = `Received from ${joinSources(sources)}`;

  if (arrivals.length === 1) {
    const [only] = arrivals;
    return {
      title: formatArrival(only),
      description,
      ...(only.imageUrl ? { imageUrl: only.imageUrl } : {}),
      ...(only.emoji ? { emoji: only.emoji } : {}),
    };
  }
  if (arrivals.length <= MAX_NAMED_ARRIVALS) {
    return { title: arrivals.map(formatArrival).join(', '), description };
  }
  return { title: `${arrivals.length} items received`, description };
}
