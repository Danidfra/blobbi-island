/**
 * Blobbi Island: the "+1 Strawberry, received from Nostr Farm" moment.
 *
 * ```
 *   live view (root sync) ──► observeExternalInventories ──► arrivals
 *                                                              ↓ resolve
 *   trusted definitions (same catalog query the bag uses) ──► name, image
 *   trusted issuer table ───────────────────────────────────► source name
 *                                                              ↓
 *                                                        onArrivals(resolved)
 * ```
 *
 * Runs once, at the app root, over the view the root sync keeps current, so
 * it works while the player is anywhere on the Island. The baseline lives in
 * a ref for the lifetime of the controller and is reset only when the
 * signed-in player changes; a remount re-hydrates silently from the cached
 * store, so it can never report what was already there.
 *
 * ## Human-readable or nothing
 *
 * An arrival is held until its definition has resolved from a trusted
 * issuer and its source has a product name. The definition comes from the
 * same query the inventory browser uses (`useExternalItemCatalog`, keyed on
 * the address set), so the moment the tile can show a name, the notice can
 * too. If the catalog settles without the item (an untrusted issuer, an
 * unpublished definition), the arrival is dropped: no toast is better than
 * one naming a `31632:…` address. The baseline was already advanced, so a
 * dropped arrival is not reported later either.
 */

import { useEffect, useRef } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';

import {
  observeExternalInventories,
  type ArrivalBaseline,
  type ExternalArrival,
  type ResolvedArrival,
} from './external-arrivals';
import { referencedItemAddresses } from './external-inventories';
import { primaryItemImageUrl } from './item-image-resolution';
import { parseGameItemAddress } from './package';
import { getTrustedItemIssuer } from './trusted-issuers';
import type { ExternalInventoryViewResult } from './useExternalInventoryEvents';
import { useExternalItemCatalog } from './useExternalItemCatalog';
import { useItemCatalog } from './useItemCatalog';

export interface UseExternalInventoryArrivalsOptions {
  /** Called once per reconciliation that produced resolvable arrivals. */
  onArrivals: (arrivals: ResolvedArrival[]) => void;
}

interface Detector {
  owner: string | undefined;
  baseline: ArrivalBaseline | null;
  /** Arrivals whose definition has not resolved yet. */
  pending: ExternalArrival[];
}

export function useExternalInventoryArrivals(
  view: ExternalInventoryViewResult,
  options: UseExternalInventoryArrivalsOptions,
): void {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;
  const detector = useRef<Detector>({ owner: undefined, baseline: null, pending: [] });
  const onArrivals = useRef(options.onArrivals);
  onArrivals.current = options.onArrivals;

  // The same catalog query the bag uses: same key (the address set), same
  // cache, no second fetch. An item this game issued, held in another
  // game's inventory, is described by the official catalog instead.
  const refs = referencedItemAddresses(view.inventories);
  const external = useExternalItemCatalog(refs);
  const official = useItemCatalog();

  useEffect(() => {
    const state = detector.current;
    if (state.owner !== pubkey) {
      // Another player, or nobody: forget everything and hydrate afresh.
      state.owner = pubkey;
      state.baseline = null;
      state.pending = [];
    }
    if (!pubkey) return;
    // No trustworthy store yet: nothing to compare, and nothing to absorb.
    if (view.isLoading || view.dataUpdatedAt === 0) return;

    const observed = observeExternalInventories(state.baseline, view, pubkey);
    state.baseline = observed.baseline;
    if (observed.arrivals.length > 0) state.pending = [...state.pending, ...observed.arrivals];
    if (state.pending.length === 0) return;

    // Flush what can be named. The catalog is settled for the CURRENT
    // address set once it has data or has failed; while it is fetching a set
    // that includes a new address, its arrivals wait.
    const settled = external.data !== undefined || external.isError;
    const resolved: ResolvedArrival[] = [];
    const stillPending: ExternalArrival[] = [];
    for (const arrival of state.pending) {
      const definition =
        external.data?.byAddress.get(arrival.itemAddress) ??
        official.data?.byAddress.get(arrival.itemAddress);
      const issuer = getTrustedItemIssuer(parseGameItemAddress(arrival.itemAddress)?.pubkey);
      if (definition && issuer) {
        const imageUrl = primaryItemImageUrl(definition);
        resolved.push({
          itemAddress: arrival.itemAddress,
          name: definition.name,
          ...(imageUrl ? { imageUrl } : {}),
          ...(definition.emoji ? { emoji: definition.emoji } : {}),
          sourceName: issuer.name,
          delta: arrival.delta,
        });
      } else if (!settled || external.isFetching) {
        stillPending.push(arrival);
      }
      // Settled without a trusted, published definition: dropped. Fail closed.
    }
    state.pending = stillPending;
    if (resolved.length > 0) onArrivals.current(resolved);
  }, [view, pubkey, external.data, external.isError, external.isFetching, official.data]);
}
