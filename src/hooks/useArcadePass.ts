import { useSyncExternalStore } from 'react';

import { hasArcadePass, subscribeArcadePass } from '@/lib/arcade-pass';

/**
 * Subscribe to the Arcade Pass.
 *
 * Replaces the 1 Hz `sessionStorage` poll that ran for the whole session in
 * every location. The store notifies on write; the single `storage` listener it
 * keeps is a safety net for writes this module did not make, NOT cross-tab
 * synchronisation — the pass is deliberately tab-scoped (see `arcade-pass.ts`).
 *
 * The snapshot is a boolean, so `useSyncExternalStore` compares by value and no
 * cached object can tear or go stale. `getServerSnapshot` returns `false`, so a
 * server render and the first client render agree and nothing hydrates
 * mismatched.
 */
export function useArcadePass(): boolean {
  return useSyncExternalStore(subscribeArcadePass, hasArcadePass, () => false);
}
