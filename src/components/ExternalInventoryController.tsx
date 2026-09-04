/**
 * Keeps the inventories OTHER games write for the signed-in player live for
 * the whole session.
 *
 * Sits beside the other account-level controllers, outside the `playing`
 * gate, because a harvest made in another game's tab belongs to the account
 * and must reach the Island whether the player is walking around, sitting in
 * the Station or looking at their bag. Before this controller the live tail
 * and the visibility refetch only existed while the My Blobbi window was
 * open, so a player returning from the Farm saw nothing until they opened
 * it.
 *
 * Renders nothing and never publishes.
 */

import { useExternalInventorySync } from '@/inventory/useExternalInventoryEvents';

export function ExternalInventoryController(): null {
  useExternalInventorySync();
  return null;
}
