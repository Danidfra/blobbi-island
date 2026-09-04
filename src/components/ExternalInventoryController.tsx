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
 * The arrival notice uses the same toast every other Island moment uses:
 *
 * ```
 *   +1 Strawberry
 *   [🍓] Received from Nostr Farm
 * ```
 *
 * Renders nothing and never publishes.
 */

import { useCallback } from 'react';

import { toast } from '@/hooks/useToast';
import { describeArrivals, type ResolvedArrival } from '@/inventory/external-arrivals';
import { useExternalInventoryArrivals } from '@/inventory/useExternalInventoryArrivals';
import { useExternalInventorySync } from '@/inventory/useExternalInventoryEvents';

export function ExternalInventoryController(): null {
  const view = useExternalInventorySync();

  const onArrivals = useCallback((arrivals: ResolvedArrival[]) => {
    const notice = describeArrivals(arrivals);
    if (!notice) return;
    // The title slot is text (it doubles as the Radix root's `title`), so
    // the item's picture sits beside the source line.
    toast({
      title: notice.title,
      description: (
        <span className="flex items-center gap-2" data-testid="external-arrival">
          {notice.imageUrl ? (
            <img src={notice.imageUrl} alt="" className="size-6 shrink-0 object-contain" />
          ) : notice.emoji ? (
            <span aria-hidden className="text-base leading-none">{notice.emoji}</span>
          ) : null}
          <span>{notice.description}</span>
        </span>
      ),
    });
  }, []);

  useExternalInventoryArrivals(view, { onArrivals });
  return null;
}
