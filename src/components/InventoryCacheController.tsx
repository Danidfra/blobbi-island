/**
 * Mounts the canonical inventory cache reconciliation at the authenticated
 * app root.
 *
 * One confirmed kind:31633 write → one cache update, for every feature at
 * once. Sits beside the other economy controllers, outside the `playing`
 * gate, because an inventory change belongs to the account rather than to any
 * particular screen. Renders nothing and never publishes.
 */

import { useInventoryCacheSync } from '@/inventory/useInventoryCacheSync';

export function InventoryCacheController(): null {
  useInventoryCacheSync();
  return null;
}
