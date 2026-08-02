/**
 * Mounts the economy-entry controller at the authenticated app root.
 *
 * This is the ONE place the exactly-once initial Coin allocation is driven
 * from. It sits OUTSIDE the `gameState === 'playing'` gate on purpose: the
 * allocation runs for every signed-in pubkey — no Blobbi, no owner profile,
 * selection/adoption screen, Ditto-created or legacy account alike — and
 * feature components (modals, HUD) only OBSERVE its status, never trigger it.
 * Renders nothing and never blocks login, adoption or the world on relay
 * failure.
 */

import { useEconomyEntryController } from '@/inventory/useEconomyEntry';

export function EconomyEntryController(): null {
  useEconomyEntryController();
  return null;
}
