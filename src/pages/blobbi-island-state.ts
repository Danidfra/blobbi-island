/**
 * The Island's player-state routing rule, pure, so the resilience invariant
 * can be tested behaviourally instead of by reading the component's source.
 *
 * Lives outside `BlobbiIsland.tsx` so that file exports only its component
 * (Fast Refresh) and so the rule can be exercised without React.
 */

import type { Blobbi } from "@/hooks/useBlobbis";

export type GameState = 'login' | 'loading' | 'selection' | 'hatching' | 'playing';

/** Everything the routing decision is allowed to look at. */
export interface GameStateInputs {
  /** A first load is in flight and nothing is known yet. */
  isLoading: boolean;
  /**
   * The latest read could not be completed. Since `relay-read.ts`, this means
   * UNKNOWN: not "empty", and React Query still holds the last good data.
   */
  hasReadError: boolean;
  /** The known pet list. `undefined` = never successfully read. */
  blobbis: Blobbi[] | undefined;
  /** Whether a companion could be resolved from the known list. */
  hasSelectedBlobbi: boolean;
}

/**
 * The Island's routing rule.
 *
 * ## RESILIENCE INVARIANT, an active world is never torn down by doubt
 *
 * A relay read that could not be completed now surfaces as an ERROR (see
 * `src/lib/relay-read.ts`) with the last good data retained behind it. So
 * while playing we leave the world only on KNOWLEDGE:
 *
 *   - a CONFIRMED-empty pet list (`[]` can no longer come from a timeout), or
 *   - a known list that no longer contains a selectable companion.
 *
 * Uncertainty: loading, an unusable read, nothing read yet, keeps the player
 * exactly where they are. That is what stops a background refetch from
 * destroying a live Mine session.
 *
 * Before the world is entered the rule is unchanged: route to the selection
 * screen, which renders its OWN loading / unknown / confirmed-empty states and
 * never shows the destructive empty-nest copy for an unusable read.
 *
 * Exported as a pure function so the invariant is tested behaviourally.
 */
export function nextGameState(
  current: GameState,
  { isLoading, hasReadError, blobbis, hasSelectedBlobbi }: GameStateInputs,
): GameState {
  if (current === 'hatching') return current;

  if (current === 'playing') {
    if (isLoading) return 'playing';
    if (hasReadError) return 'playing';
    if (!blobbis) return 'playing';
    if (blobbis.length === 0) return 'selection'; // confirmed empty
    return hasSelectedBlobbi ? 'playing' : 'selection';
  }

  if (isLoading) return 'loading';
  if (hasReadError) return 'selection';
  if (!blobbis || blobbis.length === 0) return 'selection';
  if (!hasSelectedBlobbi) return 'selection';
  return 'playing';
}

