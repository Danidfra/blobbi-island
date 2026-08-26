/**
 * Mounts the Coin-operation recovery sweep at the authenticated app root.
 *
 * The one production consumer of the unresolved-operation scan: ambiguous
 * Coin spends/grants left behind by a publish timeout are reconciled
 * READ-ONLY against the authoritative inventory on login. Sits next to
 * `EconomyEntryController`, outside the `playing` gate, for the same reason —
 * an unresolved charge belongs to the account, not to any particular screen.
 * Renders nothing, never publishes, never blocks rendering.
 */

import { useCoinOpRecovery } from '@/inventory/useCoinOpRecovery';

export function CoinOpRecoveryController(): null {
  useCoinOpRecovery();
  return null;
}
