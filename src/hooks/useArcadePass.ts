/**
 * Live view of the player's Arcade Pass entitlement.
 *
 * Subscribes to the entitlement store rather than polling it, and re-derives
 * on a slow tick so an expiry that passes while the player is looking at the
 * screen actually takes effect. One minute is the right granularity: the
 * remaining time is shown in hours and minutes, and a pass that lapses is
 * re-checked at every game start regardless — this tick only keeps the DISPLAY
 * honest, never the entitlement itself.
 */

import { useEffect, useState } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  arcadePassRemainingMs,
  hasActiveArcadePass,
  subscribeArcadePassEntitlement,
} from '@/arcade/pass/arcade-pass-entitlement';

const TICK_MS = 60 * 1000;

export interface ArcadePassView {
  /** True while the pass is waiving Arcade Token costs. */
  readonly isActive: boolean;
  /** Milliseconds left, or `0` when there is no active pass. */
  readonly remainingMs: number;
}

export function useArcadePass(): ArcadePassView {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const unsubscribe = subscribeArcadePassEntitlement(refresh);
    const timer = setInterval(refresh, TICK_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);

  return {
    isActive: hasActiveArcadePass(pubkey, now),
    remainingMs: arcadePassRemainingMs(pubkey, now),
  };
}

/** "18h 42m", or "under a minute" near the end. Player-facing, never exact ms. */
export function formatPassRemaining(remainingMs: number): string {
  const totalMinutes = Math.floor(remainingMs / 60_000);
  if (totalMinutes < 1) return 'under a minute';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
