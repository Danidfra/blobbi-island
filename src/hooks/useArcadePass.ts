/**
 * Live view of the player's Arcade Pass entitlement.
 *
 * Subscribes to the entitlement store rather than polling it, and re-derives
 * on a slow tick so an expiry that passes while the player is looking at the
 * screen actually takes effect. One minute is the right granularity: the
 * remaining time is shown in hours and minutes, and a pass that lapses is
 * re-checked at every game start regardless — this tick only keeps the DISPLAY
 * honest, never the entitlement itself.
 *
 * The PLAY count needs no tick at all: it only changes when a play is
 * consumed, and consuming one notifies every subscriber. So the count is
 * always current the instant it changes, and the timer exists purely for the
 * clock.
 */

import { useEffect, useState } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  arcadePassRemainingFreePlays,
  arcadePassRemainingMs,
  hasActiveArcadePass,
  hasUsableArcadePass,
  subscribeArcadePassEntitlement,
} from '@/arcade/pass/arcade-pass-entitlement';

const TICK_MS = 60 * 1000;

export interface ArcadePassView {
  /**
   * The pass has not expired. Says nothing about whether it still buys
   * anything — an exhausted pass is `isActive` right up to its expiry, which
   * is what lets the UI show "free plays used" instead of silently vanishing.
   */
  readonly isActive: boolean;
  /**
   * The pass will waive the next play: unexpired AND with an allowance left.
   * This is the one to branch copy on. Anything that says "plays are free"
   * must read THIS, never {@link isActive}.
   */
  readonly isUsable: boolean;
  /** Milliseconds left, or `0` when there is no active pass. */
  readonly remainingMs: number;
  /** Free plays left, or `0` when there is none or the pass has expired. */
  readonly remainingFreePlays: number;
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
    isUsable: hasUsableArcadePass(pubkey, now),
    remainingMs: arcadePassRemainingMs(pubkey, now),
    remainingFreePlays: arcadePassRemainingFreePlays(pubkey, now),
  };
}

/** "15 free plays", "1 free play", "no free plays left". Player-facing. */
export function formatFreePlays(remaining: number): string {
  if (remaining <= 0) return 'no free plays left';
  return `${remaining} free play${remaining === 1 ? '' : 's'}`;
}

/** "18h 42m", or "under a minute" near the end. Player-facing, never exact ms. */
export function formatPassRemaining(remainingMs: number): string {
  const totalMinutes = Math.floor(remainingMs / 60_000);
  if (totalMinutes < 1) return 'under a minute';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
