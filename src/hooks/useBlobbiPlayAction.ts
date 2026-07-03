/**
 * Hook for playing with Blobbi pets using toys with proper Nostr event creation
 *
 * Creates Kind 1124 interaction events and updates Kind 31124 pet state
 * and Kind 11125 owner profile according to Blobbi specification
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { useOptimizedStatus } from './useOptimizedStatus';
import { useBlobbonautProfile } from './useBlobbonautProfile';
import { createEquipTag } from '@/components/blobbi/lib/accessory-utils';
import type { EquipmentConfig } from '@/components/blobbi/lib/accessory-types';
import { ITEM_DATA } from '@/components/blobbi/ConsumeItemModal';
import { KIND_BLOBBI_STATE, KIND_BLOBBONAUT_PROFILE } from '@/lib/blobbi-kinds';
import { mergeOwnerProfileTags, mergePetStateTags } from '@/lib/blobbi-parsers';
import { buildInteractionEventTemplate } from '@blobbi-kit/core/blobbi-interaction';
import { calculateInventoryActionXP } from '@blobbi-kit/react/lib/blobbi-xp';


interface PlayActionInput {
  /** Pet ID to play with */
  petId: string;
  /** Toy item ID */
  itemId: string;
  /** Quantity to use */
  quantity: number;
}

interface ToyEffects {
  hunger?: number;
  energy?: number;
  hygiene?: number;
  happiness?: number;
  health?: number;
}

// Helper to get clean item name for display
function getItemDisplayName(itemId: string): string {
  const cleaned = itemId.replace('toy_', '').replace('_', ' ');
  // Convert 'teddy' to 'teddy bear' for better display
  if (cleaned === 'teddy') return 'teddy bear';
  return cleaned;
}

// Helper to calculate stat change with bounds checking
function calculateStatChange(currentValue: number, change: number): number {
  return Math.max(0, Math.min(100, currentValue + change));
}

export function useBlobbiPlayAction() {
  const { user } = useCurrentUser();
  const { mutate: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { status, applyOptimisticUpdate } = useOptimizedStatus();
  const { data: profile } = useBlobbonautProfile();

  return useMutation({
    mutationFn: async ({ petId, itemId, quantity }: PlayActionInput) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      // Get current equipment for this pet
      const currentEquipment = (queryClient.getQueryData(['accessory-equipment', petId]) as EquipmentConfig[]) || [];

      // Find the pet being played with
      const pet = status.allPets.find(p => p.id === petId);
      if (!pet) {
        throw new Error(`Pet with ID ${petId} not found`);
      }

      // Get item effects from ITEM_DATA (try both prefixed and non-prefixed)
      let itemData = ITEM_DATA[itemId];
      if (!itemData && !itemId.startsWith('toy_')) {
        itemData = ITEM_DATA[`toy_${itemId}`];
      }
      if (!itemData) {
        throw new Error(`Unknown item: ${itemId}`);
      }
      const effects = itemData.effects;

      // Check inventory quantity (inventory items have prefixes)
      const prefixedItemId = itemId.startsWith('toy_') ? itemId : `toy_${itemId}`;
      const inventoryItem = profile?.inventory.find(item => item.itemId === prefixedItemId);

      if (!inventoryItem || inventoryItem.quantity < quantity) {
        throw new Error(`Not enough ${getItemDisplayName(itemId)} in inventory`);
      }

      // Calculate total effects for this quantity
      const totalEffects: ToyEffects = {};
      Object.entries(effects).forEach(([stat, value]) => {
        totalEffects[stat as keyof ToyEffects] = value * quantity;
      });

      // Calculate new stats
      const newStats = {
        hunger: calculateStatChange(pet.hunger, totalEffects.hunger || 0),
        happiness: calculateStatChange(pet.happiness, totalEffects.happiness || 0),
        health: calculateStatChange(pet.health, totalEffects.health || 0),
        hygiene: calculateStatChange(pet.hygiene, totalEffects.hygiene || 0),
        energy: calculateStatChange(pet.energy, totalEffects.energy || 0),
      };

      // Experience gained — sourced from the shared blobbi-kit XP table.
      // NOTE: this changes Island behavior from quantity * 3 to quantity * 8
      // (play = 8 XP per item in the official kit defaults).
      const experienceGained = calculateInventoryActionXP('play', quantity);
      const newExperience = pet.experience + experienceGained;

      // Care points (1 point per playing action, regardless of quantity)
      const carePoints = 1;

      // Update care streak if this is a new day
      const lastInteraction = pet.lastInteraction;
      const now = new Date();
      const isNewDay = !lastInteraction ||
        (now.getTime() - lastInteraction.getTime()) > (20 * 60 * 60 * 1000); // 20+ hours = new day
      const newCareStreak = isNewDay ? pet.careStreak + 1 : pet.careStreak;

      // Convert current equipment to equip tags
      const equipTags = currentEquipment.map(equipment => createEquipTag(equipment));

      // 1. Create Kind 1124 Interaction Event using the shared blobbi-kit builder.
      // The builder applies the official tag ordering and adds the `blobbi`
      // short-id tag when the pet's d-tag is canonical (blobbi-<12hex>-<10hex>).
      const interactionTemplate = buildInteractionEventTemplate({
        ownerPubkey: user.pubkey,
        blobbiDTag: petId,
        action: 'play',
        source: 'blobbi-island',
        itemId: itemId || undefined,
      });

      createEvent(interactionTemplate);

      // 2. Update Kind 31124 Pet State
      // Apply stat updates to the pet, then use merge to preserve unknown tags
      const updatedPet = {
        ...pet,
        ...newStats,
        experience: newExperience,
        careStreak: newCareStreak,
        lastInteraction: now,
      };
      const petStateTags = mergePetStateTags(updatedPet);

      // Add current equipment as equip tags
      equipTags.forEach(equipTag => {
        petStateTags.push(equipTag);
      });

      createEvent({
        kind: KIND_BLOBBI_STATE,
        content: pet.rawContent,
        tags: petStateTags,
      });

      // 3. Update Kind 11125 Owner Profile (reduce inventory)
      if (profile) {
        // Create updated inventory
        const updatedInventory = profile.inventory.map(item => {
          if (item.itemId === prefixedItemId) {
            return {
              ...item,
              quantity: item.quantity - quantity
            };
          }
          return item;
        }).filter(item => item.quantity > 0); // Remove items with 0 quantity

        // Use merge utility to preserve unknown tags from Ditto
        const updatedProfile = { ...profile, inventory: updatedInventory };
        const ownerTags = mergeOwnerProfileTags(updatedProfile);

        createEvent({
          kind: KIND_BLOBBONAUT_PROFILE,
          content: profile.rawContent,
          tags: ownerTags,
        });
      }

      // Apply comprehensive optimistic updates for pet
      applyOptimisticUpdate({
        petId,
        petUpdates: {
          ...newStats,
          experience: newExperience,
          careStreak: newCareStreak,
          lastInteraction: now,
        },
      });

      return {
        petId,
        itemId,
        quantity,
        newStats,
        experienceGained,
        carePoints,
        newCareStreak,
      };
    },
    onSuccess: () => {
      // Invalidate related queries to refetch fresh data in the background
      // Use refetchType: 'none' to avoid immediately overriding optimistic updates
      queryClient.invalidateQueries({
        queryKey: ['pet-states', user?.pubkey],
        refetchType: 'none'
      });
      queryClient.invalidateQueries({
        queryKey: ['blobbonaut-profile', user?.pubkey],
        refetchType: 'none'
      });
      queryClient.invalidateQueries({
        queryKey: ['owner-profile', user?.pubkey],
        refetchType: 'none'
      });

      // Trigger a background refetch after a delay to allow users to see optimistic updates
      setTimeout(() => {
        queryClient.refetchQueries({
          queryKey: ['pet-states', user?.pubkey]
        });
        queryClient.refetchQueries({
          queryKey: ['blobbonaut-profile', user?.pubkey]
        });
        queryClient.refetchQueries({
          queryKey: ['owner-profile', user?.pubkey]
        });
      }, 2000); // 2 second delay to let users see the optimistic updates
    },
    onError: (error) => {
      console.error('Failed to play with Blobbi:', error);
    },
  });
}