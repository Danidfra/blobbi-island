/**
 * Blobbi Island — item consumption / Blobbi actions (Phase 8).
 *
 * Resolves the gameplay behavior of an item from its kind:31632 definition
 * (fetched or bundled fallback) and applies it:
 *   - action mapping: feed | play | medicine | clean | boost;
 *   - eligibility: item owned (>=1 in 31633), current Blobbi exists, stage
 *     allowed;
 *   - stat effects come from the resolved definition (never inferred from
 *     names);
 *   - stat clamping / central state behavior is applied via the existing Island
 *     pet-state layer (`mergePetStateTags` + the shared clamp), not a new
 *     reimplementation.
 *
 * Event ordering (documented, NON-ATOMIC):
 *   1. publish the Blobbi interaction (kind:1124) + Blobbi state (kind:31124);
 *   2. decrement the inventory (kind:31633).
 *
 * Rationale: these are independent events across kinds and cannot be made
 * atomic. Applying the effect BEFORE decrementing means the less-harmful
 * partial failure is "effect applied but item not consumed" (a small
 * favor-the-user leak) rather than "item consumed but no effect" (item lost for
 * nothing). We surface partial-failure state to the caller.
 *
 * Never writes kind:11125.storage. Never depends on the legacy consumable
 * model, which no longer exists in this client.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { createEquipTag } from '@/components/blobbi/lib/accessory-utils';
import type { EquipmentConfig } from '@/components/blobbi/lib/accessory-types';
import { KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';
import { mergePetStateTags } from '@/lib/blobbi-parsers';
import type { PetState } from '@/lib/blobbi-types';
import { buildInteractionEventTemplate } from '@blobbi-kit/core/blobbi-interaction';
import { calculateInventoryActionXP } from '@blobbi-kit/react/lib/blobbi-xp';
import { calculateStreakUpdate } from '@blobbi-kit/react/lib/blobbi-streak';

import { useInventoryMutation, getQuantity } from './useInventoryMutation';
import { fetchInventory, inventoryQueryKey } from './useIslandInventory';
import type { ItemAction, ResolvedBlobbiItemDefinition } from './catalog-fallback';

/** Map our catalog action to the shared kind:1124 interaction action name. */
const ACTION_TO_INTERACTION: Record<
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
function xpForAction(action: ItemAction, quantity: number): number {
  if (action === 'feed') return calculateInventoryActionXP('feed', quantity);
  if (action === 'play') return calculateInventoryActionXP('play', quantity);
  // Other actions currently grant no inventory XP in the shared table.
  return 0;
}

function clampStat(value: number, change: number): number {
  return Math.max(0, Math.min(100, value + change));
}

export interface UseItemInput {
  /** Canonical kind:31632 address of the item. */
  address: string;
  /** Resolved catalog definition (fetched or fallback). */
  definition: ResolvedBlobbiItemDefinition;
  /** Pet to apply the effect to. */
  petId: string;
  /** Units to consume (default 1). */
  quantity?: number;
}

export interface UseItemResult {
  address: string;
  petId: string;
  quantity: number;
  action: ItemAction;
  experienceGained: number;
  /** True when the inventory decrement also succeeded. */
  inventoryDecremented: boolean;
  warning?: string;
}

/**
 * Consume an item and apply its gameplay effect to the current Blobbi.
 */
export function useUseItem() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publish } = useNostrPublish();
  const { status, applyOptimisticUpdate } = useOptimizedStatus();
  const { mutateAsync: mutateInventory } = useInventoryMutation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      address,
      definition,
      petId,
      quantity = 1,
    }: UseItemInput): Promise<UseItemResult> => {
      if (!user?.pubkey) throw new Error('User not logged in');
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error('Quantity must be a positive integer');
      }

      const action = definition.action;
      if (!action) {
        throw new Error(`Item has no usable action: ${address}`);
      }

      // Confirm the current Blobbi exists.
      const pet = status.allPets.find((p) => p.id === petId);
      if (!pet) {
        throw new Error(`Blobbi ${petId} not found`);
      }

      // Confirm the Blobbi stage is allowed for this item.
      const stage = pet.stage;
      if (stage && !definition.stages.includes(stage)) {
        throw new Error(
          `${definition.name} cannot be used on a ${stage} Blobbi`,
        );
      }

      // Confirm the item is actually owned in kind:31633 with sufficient
      // quantity, using a FRESH relay read (not a possibly-stale cache/UI
      // snapshot). This prevents applying an effect for an item the player does
      // not own, and blocks double-using the final unit before the decrement
      // settles. The subsequent decrement (Step 2) is itself serialized per-user
      // and re-reads the newest inventory, so two rapid uses cannot both spend
      // the same last unit.
      const freshInventory = await fetchInventory(
        nostr,
        user.pubkey,
        AbortSignal.timeout(3000),
      );
      const owned = getQuantity(freshInventory, address);
      if (owned < quantity) {
        throw new Error(
          `Not enough ${definition.name} in inventory (have ${owned}, need ${quantity})`,
        );
      }

      // Effects come from the resolved definition. Never inferred from names.
      const effects = definition.effects;

      // Compute new stats using the existing Island clamp (shared behavior).
      const totalEffect = (key: keyof typeof effects) =>
        (effects[key] ?? 0) * quantity;
      const newStats = {
        hunger: clampStat(pet.hunger, totalEffect('hunger')),
        happiness: clampStat(pet.happiness, totalEffect('happiness')),
        health: clampStat(pet.health, totalEffect('health')),
        hygiene: clampStat(pet.hygiene, totalEffect('hygiene')),
        energy: clampStat(pet.energy, totalEffect('energy')),
      };

      const experienceGained = xpForAction(action, quantity);
      const newExperience = pet.experience + experienceGained;
      const now = new Date();

      // Care streak: reuse the SHARED @blobbi-kit streak helper
      // (`calculateStreakUpdate`) that owns this behavior — do NOT reimplement a
      // second algorithm. It manages all three tags consistently:
      //   - care_streak          (streak count)
      //   - care_streak_last_at  (unix seconds of last update)
      //   - care_streak_last_day (local YYYY-MM-DD of last update)
      // Rules: initialize→1, increment on the next local calendar day, no-op on
      // same day, reset→1 after missing 2+ days. The `care_streak_last_day` is
      // not a typed PetState field; read it from the preserved raw tags.
      const careStreakLastDay = pet.rawTags.find(
        ([name]) => name === 'care_streak_last_day',
      )?.[1];
      const streakResult = calculateStreakUpdate(
        pet.careStreak,
        careStreakLastDay,
        now,
      );
      const newCareStreak = streakResult.newStreak;
      // Only write streak-metadata overrides when the helper actually updated the
      // streak; on a same-day action we leave the existing metadata untouched
      // (preserved as-is by mergePetStateTags) so nothing is corrupted.
      const streakOverrides: Record<string, string> = streakResult.wasUpdated
        ? {
            care_streak: streakResult.newStreak.toString(),
            care_streak_last_at: streakResult.newLastAt.toString(),
            care_streak_last_day: streakResult.newLastDay,
          }
        : {};

      // Preserve equipped accessories on the 31124 republish.
      const currentEquipment =
        (queryClient.getQueryData([
          'accessory-equipment',
          petId,
        ]) as EquipmentConfig[]) || [];
      const equipTags = currentEquipment.map((e) => createEquipTag(e));

      // --- Step 1: publish Blobbi interaction (1124) + state (31124) ---
      const interactionTemplate = buildInteractionEventTemplate({
        ownerPubkey: user.pubkey,
        blobbiDTag: petId,
        action: ACTION_TO_INTERACTION[action],
        source: 'blobbi-island',
        itemId: definition.itemId ?? undefined,
      });
      await publish(interactionTemplate);

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
      // Pass the streak-metadata overrides so care_streak_last_at /
      // care_streak_last_day advance in lockstep with care_streak (never stale).
      const petStateTags = mergePetStateTags(updatedPet, streakOverrides);
      equipTags.forEach((t) => petStateTags.push(t));

      await publish({
        kind: KIND_BLOBBI_STATE,
        content: pet.rawContent,
        tags: petStateTags,
      });

      // Optimistically reflect the pet stat changes.
      applyOptimisticUpdate({
        petId,
        petUpdates: {
          ...newStats,
          experience: newExperience,
          careStreak: newCareStreak,
          lastInteraction: now,
        },
      });

      // --- Step 2: decrement inventory (31633) ---
      let inventoryDecremented = true;
      let warning: string | undefined;
      try {
        await mutateInventory({ type: 'remove', address, amount: quantity });
      } catch (err) {
        inventoryDecremented = false;
        warning =
          err instanceof Error
            ? `Effect applied but inventory was not decremented: ${err.message}`
            : 'Effect applied but inventory was not decremented.';
      }

      return {
        address,
        petId,
        quantity,
        action,
        experienceGained,
        inventoryDecremented,
        warning,
      };
    },
    onSettled: () => {
      if (!user?.pubkey) return;
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKey(user.pubkey),
      });
      queryClient.invalidateQueries({
        queryKey: ['pet-states', user.pubkey],
        refetchType: 'none',
      });
    },
  });
}
