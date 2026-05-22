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
import { KIND_BLOBBI_INTERACTION, KIND_BLOBBI_STATE, KIND_BLOBBONAUT_PROFILE } from '@/lib/blobbi-kinds';


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

      // Experience gained (3 points per item used for playing)
      const experienceGained = quantity * 3;
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

      // 1. Create Kind 1124 Interaction Event (Ditto-compatible)
      const coordinate = `31124:${user.pubkey}:${petId}`;
      const interactionTags: string[][] = [
        ['a', coordinate],
        ['p', user.pubkey],
        ['action', 'play'],
        ['source', 'blobbi-island'],
        ['alt', 'Blobbi interaction: play'],
      ];

      if (itemId) {
        interactionTags.push(['item', itemId]);
      }

      createEvent({
        kind: KIND_BLOBBI_INTERACTION,
        content: '',
        tags: interactionTags,
      });

      // 2. Update Kind 31124 Pet State
      const petStateTags = [
        ['d', petId],
        ['stage', pet.stage],
        ['breeding_ready', pet.breedingReady ? 'true' : 'false'],
        ['generation', pet.generation.toString()],
        ['hunger', newStats.hunger.toString()],
        ['happiness', newStats.happiness.toString()],
        ['health', newStats.health.toString()],
        ['hygiene', newStats.hygiene.toString()],
        ['energy', newStats.energy.toString()],
        ['experience', newExperience.toString()],
        ['care_streak', newCareStreak.toString()],
        // Update interaction timestamp
        ['last_interaction', Math.floor(now.getTime() / 1000).toString()],
      ];

      // Preserve all existing last_* timestamps (except the one we're updating above)
      if (pet.lastMeal) petStateTags.push(['last_meal', Math.floor(pet.lastMeal.getTime() / 1000).toString()]);
      if (pet.lastClean) petStateTags.push(['last_clean', Math.floor(pet.lastClean.getTime() / 1000).toString()]);
      if (pet.lastWarm) petStateTags.push(['last_warm', Math.floor(pet.lastWarm.getTime() / 1000).toString()]);
      if (pet.lastTalk) petStateTags.push(['last_talk', Math.floor(pet.lastTalk.getTime() / 1000).toString()]);
      if (pet.lastCheck) petStateTags.push(['last_check', Math.floor(pet.lastCheck.getTime() / 1000).toString()]);
      if (pet.lastSing) petStateTags.push(['last_sing', Math.floor(pet.lastSing.getTime() / 1000).toString()]);
      if (pet.lastMedicine) petStateTags.push(['last_medicine', Math.floor(pet.lastMedicine.getTime() / 1000).toString()]);

      // Add existing optional tags
      if (pet.baseColor) petStateTags.push(['base_color', pet.baseColor]);
      if (pet.secondaryColor) petStateTags.push(['secondary_color', pet.secondaryColor]);
      if (pet.pattern) petStateTags.push(['pattern', pet.pattern]);
      if (pet.eyeColor) petStateTags.push(['eye_color', pet.eyeColor]);
      if (pet.specialMark) petStateTags.push(['special_mark', pet.specialMark]);
      if (pet.adultType) petStateTags.push(['adult_type', pet.adultType]);
      if (pet.personality) petStateTags.push(['personality', pet.personality]);
      if (pet.trait) petStateTags.push(['trait', pet.trait]);
      if (pet.mood) petStateTags.push(['mood', pet.mood]);
      if (pet.favoriteFood) petStateTags.push(['favorite_food', pet.favoriteFood]);
      if (pet.voiceType) petStateTags.push(['voice_type', pet.voiceType]);
      if (pet.size) petStateTags.push(['size', pet.size]);
      if (pet.currentLocation) petStateTags.push(['current_location', pet.currentLocation]);
      if (pet.isSleeping !== undefined) petStateTags.push(['is_sleeping', pet.isSleeping ? 'true' : 'false']);
      if (pet.isDirty !== undefined) petStateTags.push(['is_dirty', pet.isDirty ? 'true' : 'false']);
      if (pet.inParty !== undefined) petStateTags.push(['in_party', pet.inParty ? 'true' : 'false']);
      if (pet.visibleToOthers !== undefined) petStateTags.push(['visible_to_others', pet.visibleToOthers ? 'true' : 'false']);
      if (pet.client !== undefined) petStateTags.push(['client', pet.client]);

      // Add current equipment as equip tags
      equipTags.forEach(equipTag => {
        petStateTags.push(equipTag);
      });

      createEvent({
        kind: KIND_BLOBBI_STATE,
        content: pet.name || petId,
        tags: petStateTags,
      });

      // 3. Update Kind 31125 Owner Profile (reduce inventory)
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

        // Create owner profile tags
        const ownerTags = [
          ['d', profile.id],
          ['name', profile.name],
          ['coins', profile.coins.toString()],
          ['pettingLevel', profile.pettingLevel.toString()],
          ['lifetimeBlobbis', profile.lifetimeBlobbis.toString()],
        ];

        // Add optional single-value tags
        if (profile.favoriteBlobbi) ownerTags.push(['favoriteBlobbi', profile.favoriteBlobbi]);
        if (profile.starterBlobbi) ownerTags.push(['starterBlobbi', profile.starterBlobbi]);
        if (profile.currentCompanion) ownerTags.push(['current_companion', profile.currentCompanion]);
        if (profile.style) ownerTags.push(['style', profile.style]);
        if (profile.background) ownerTags.push(['background', profile.background]);
        if (profile.title) ownerTags.push(['title', profile.title]);

        // Add multi-value tags
        profile.ownedPets.forEach(petId => ownerTags.push(['has', petId]));
        profile.achievements.forEach(achievement => ownerTags.push(['achievements', achievement]));
        updatedInventory.forEach(item => ownerTags.push(['storage', `${item.itemId}:${item.quantity}`]));

        createEvent({
          kind: KIND_BLOBBONAUT_PROFILE,
          content: `Owner profile: ${profile.name}`,
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