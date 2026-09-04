/**
 * What it costs to start an arcade game, the ONE place that decides.
 *
 * Costs live here rather than in each machine for the same reason the Mine's
 * gem values were pulled out of its component: three games with three private
 * numbers is three economies, and the third one drifts.
 *
 * A play currently costs one Token everywhere. That is deliberate rather than
 * lazy: the three games pay out on the same Ticket scale (max 8 per run), so
 * charging them differently would price identical rewards differently. When a
 * game's payout changes, its entry cost is the lever, and it is right here.
 */

import {
  BLOBBI_AIR_HOCKEY_GAME_ID,
  BLOBBI_DANCE_GAME_ID,
  BLOBBI_POOL_GAME_ID,
} from '@/arcade/catalogue';

/** Arcade Tokens charged to start one run, by canonical game id. */
export const ARCADE_GAME_TOKEN_COSTS: Readonly<Record<string, number>> = Object.freeze({
  [BLOBBI_DANCE_GAME_ID]: 1,
  [BLOBBI_AIR_HOCKEY_GAME_ID]: 1,
  [BLOBBI_POOL_GAME_ID]: 1,
});

/**
 * Tokens needed to start `gameId`.
 *
 * An unknown game costs nothing rather than a guessed number: charging for
 * something this policy has never heard of would be inventing a price at the
 * till. A game that should cost Tokens must say so here.
 */
export function tokenCostForGame(gameId: string): number {
  return ARCADE_GAME_TOKEN_COSTS[gameId] ?? 0;
}
