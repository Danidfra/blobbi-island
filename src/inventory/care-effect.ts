/**
 * Blobbi Island: PLANNING a care effect, shared by every consumption path.
 *
 * `useUseItem` (Island-owned consumables, debited from `blobbi:island`) and
 * `useConsumeExternalItem` (partner produce, debited by a kind:1416 spend)
 * apply an item to a Blobbi in exactly the same way: the resolved definition's
 * `action` and `effects` become stat deltas, clamped by the Island rule, plus
 * XP and the shared care-streak bookkeeping. This module is that computation,
 * lifted out so the two flows cannot drift, and so it can be tested without
 * a relay, a signer, or React.
 *
 * Pure. Nothing here publishes, reads, or mutates.
 */

import { calculateInventoryActionXP } from '@blobbi-kit/react/lib/blobbi-xp';
import { calculateStreakUpdate } from '@blobbi-kit/react/lib/blobbi-streak';

import type { PetState } from '@/lib/blobbi-types';

import type { ItemAction, ItemEffects } from './catalog-fallback';

/** Map our catalog action to the shared kind:1124 interaction action name. */
export const ACTION_TO_INTERACTION: Record<
  ItemAction,
  'feed' | 'play' | 'clean' | 'medicate' | 'boost'
> = {
  feed: 'feed',
  play: 'play',
  clean: 'clean',
  medicine: 'medicate',
  boost: 'boost',
};

/** Map our catalog action to the XP table action name (feed/play only have XP). */
export function xpForAction(action: ItemAction, quantity: number): number {
  if (action === 'feed') return calculateInventoryActionXP('feed', quantity);
  if (action === 'play') return calculateInventoryActionXP('play', quantity);
  // Other actions currently grant no inventory XP in the shared table.
  return 0;
}

/** The Island stat clamp: every care stat lives in [0, 100]. */
export function clampStat(value: number, change: number): number {
  return Math.max(0, Math.min(100, value + change));
}

export type CareStats = Pick<
  PetState,
  'hunger' | 'happiness' | 'health' | 'hygiene' | 'energy'
>;

export interface CareEffectPlan {
  /** Every care stat after the effect, clamped. */
  newStats: CareStats;
  experienceGained: number;
  newExperience: number;
  newCareStreak: number;
  /**
   * Streak-metadata overrides for `mergePetStateTags`. Empty on a same-day
   * action, so the existing metadata is preserved untouched.
   */
  streakOverrides: Record<string, string>;
  /** The pet as it should be published: stats, XP, streak and care timestamps. */
  updatedPet: PetState;
  /** The kind:1124 action name for this effect. */
  interactionAction: (typeof ACTION_TO_INTERACTION)[ItemAction];
}

export interface PlanCareEffectInput {
  pet: PetState;
  action: ItemAction;
  effects: ItemEffects;
  /** Units applied. Effects scale linearly. */
  quantity: number;
  now: Date;
}

/**
 * Compute everything a care action changes about a Blobbi.
 *
 * Effects come from the resolved definition; never inferred from names. The
 * care streak reuses the SHARED @blobbi-kit helper (`calculateStreakUpdate`)
 * that owns that behaviour: initialize→1, increment on the next local calendar
 * day, no-op on the same day, reset→1 after missing 2+ days.
 */
export function planCareEffect(input: PlanCareEffectInput): CareEffectPlan {
  const { pet, action, effects, quantity, now } = input;

  const totalEffect = (key: keyof ItemEffects) => (effects[key] ?? 0) * quantity;
  const newStats: CareStats = {
    hunger: clampStat(pet.hunger, totalEffect('hunger')),
    happiness: clampStat(pet.happiness, totalEffect('happiness')),
    health: clampStat(pet.health, totalEffect('health')),
    hygiene: clampStat(pet.hygiene, totalEffect('hygiene')),
    energy: clampStat(pet.energy, totalEffect('energy')),
  };

  const experienceGained = xpForAction(action, quantity);
  const newExperience = pet.experience + experienceGained;

  // `care_streak_last_day` is not a typed PetState field; read it from the
  // preserved raw tags.
  const careStreakLastDay = pet.rawTags.find(
    ([name]) => name === 'care_streak_last_day',
  )?.[1];
  const streakResult = calculateStreakUpdate(pet.careStreak, careStreakLastDay, now);
  const newCareStreak = streakResult.newStreak;
  const streakOverrides: Record<string, string> = streakResult.wasUpdated
    ? {
        care_streak: streakResult.newStreak.toString(),
        care_streak_last_at: streakResult.newLastAt.toString(),
        care_streak_last_day: streakResult.newLastDay,
      }
    : {};

  const updatedPet: PetState = {
    ...pet,
    ...newStats,
    experience: newExperience,
    careStreak: newCareStreak,
    lastInteraction: now,
    ...(action === 'feed' ? { lastMeal: now } : {}),
    ...(action === 'clean' ? { lastClean: now } : {}),
    ...(action === 'medicine' ? { lastMedicine: now } : {}),
  };

  return {
    newStats,
    experienceGained,
    newExperience,
    newCareStreak,
    streakOverrides,
    updatedPet,
    interactionAction: ACTION_TO_INTERACTION[action],
  };
}
