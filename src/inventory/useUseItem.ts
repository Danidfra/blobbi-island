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
import { KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';
import { mergePetStateTags } from '@/lib/blobbi-parsers';
import { buildInteractionEventTemplate } from '@blobbi-kit/core/blobbi-interaction';

import { planCareEffect } from './care-effect';
import { isAmbiguousInventoryPublish } from './inventory-transaction';
import { useInventoryMutation, getQuantity } from './useInventoryMutation';
import { fetchInventory, inventoryQueryKey } from './useIslandInventory';
import type { ItemAction, ResolvedBlobbiItemDefinition } from './catalog-fallback';

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
  /**
   * True when the inventory decrement was CONFIRMED. False covers both a
   * definite failure and an ambiguous publish (see `warning` for which).
   */
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
      // settles. The subsequent decrement (Step 2) runs as a shared inventory
      // transaction (cross-tab lock, per-user serialization, authoritative
      // re-read), so two rapid uses cannot both spend the same last unit.
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
      // The stat clamp, XP and the shared care-streak bookkeeping are the ONE
      // planner every consumption path uses (`care-effect.ts`).
      const now = new Date();
      const {
        newStats,
        experienceGained,
        newExperience,
        newCareStreak,
        streakOverrides,
        updatedPet,
        interactionAction,
      } = planCareEffect({ pet, action, effects: definition.effects, quantity, now });

      // Equipment lives in kind:31634 and is untouched by feeding a Blobbi:
      // there are no `equip` tags to preserve on the 31124 republish any more.

      // --- Step 1: publish Blobbi interaction (1124) + state (31124) ---
      const interactionTemplate = buildInteractionEventTemplate({
        ownerPubkey: user.pubkey,
        blobbiDTag: petId,
        action: interactionAction,
        source: 'blobbi-island',
        itemId: definition.itemId ?? undefined,
      });
      await publish(interactionTemplate);

      // Pass the streak-metadata overrides so care_streak_last_at /
      // care_streak_last_day advance in lockstep with care_streak (never stale).
      const petStateTags = mergePetStateTags(updatedPet, streakOverrides);

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
        // An ambiguous publish MAY have landed — never describe it as a
        // definite non-decrement; the settled-state invalidation reconciles
        // the cache with whatever the relay actually holds.
        warning = isAmbiguousInventoryPublish(err)
          ? 'Effect applied; the inventory update was not confirmed and may or may not have landed.'
          : err instanceof Error
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
