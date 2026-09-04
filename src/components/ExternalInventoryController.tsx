/**
 * Keeps the inventories OTHER games write for the signed-in player live for
 * the whole session, and tells the player when something new arrives in one.
 *
 * Sits beside the other account-level controllers, outside the `playing`
 * gate, because a harvest made in another game's tab belongs to the account
 * and must reach the Island whether the player is walking around, sitting in
 * the Station or looking at their bag. Before this controller the live tail
 * and the visibility refetch only existed while the My Blobbi window was
 * open, so a player returning from the Farm saw nothing until they opened
 * it.
 *
 * The arrival notice is an in-game notice at the top-right of the game
 * window, in the paper-chip style the Farm uses for the same moment:
 *
 * ```
 *   [🍓] +1 Strawberry
 *        Received from Nostr Farm
 * ```
 *
 * Renders nothing and never publishes.
 */

import { useCallback } from 'react';

import { describeArrivals, type ResolvedArrival } from '@/inventory/external-arrivals';
import { showGameNotice } from '@/lib/game-notices';
import { useExternalInventoryArrivals } from '@/inventory/useExternalInventoryArrivals';
import { useExternalInventorySync } from '@/inventory/useExternalInventoryEvents';

export function ExternalInventoryController(): null {
  const view = useExternalInventorySync();

  const onArrivals = useCallback((arrivals: ResolvedArrival[]) => {
    const notice = describeArrivals(arrivals);
    if (!notice) return;
    // An in-game notice, not an app toast: it renders inside the game
    // window (see `GameNoticeLayer`), and the stack it joins is bounded.
    showGameNotice({
      title: notice.title,
      description: notice.description,
      ...(notice.imageUrl ? { imageUrl: notice.imageUrl } : {}),
      ...(notice.emoji ? { emoji: notice.emoji } : {}),
    });
  }, []);

  useExternalInventoryArrivals(view, { onArrivals });
  return null;
}
