/**
 * Hook for feeding Blobbi pets with proper Nostr event creation
 *
 * Creates Kind 14919 interaction events and updates Kind 31124 pet state
 * and Kind 31125 owner profile according to Blobbi specification
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { useOptimizedStatus } from './useOptimizedStatus';
import { useBlobbonautProfile } from './useBlobbonautProfile';


interface FeedActionInput {
  /** Pet ID to feed */
  petId: string;
  /** Food item ID */
  itemId: string;
  /** Quantity to consume */
  quantity: number;
}

interface FoodEffects {
  hunger?: number;
  energy?: number;
  hygiene?: number;
  happiness?: number;
  health?: number;
}

// Food effects database - matches the ConsumeItemModal data
const FOOD_EFFECTS: Record<string, FoodEffects> = {
  apple: { hunger: 15, energy: 5, hygiene: -2 },
  pizza: { hunger: 35, happiness: 10, energy: -9 },
  burger: { hunger: 40, happiness: 10, energy: 8, hygiene: -8 },
  cake: { hunger: 20, happiness: 30, energy: -10 },
  sushi: { hunger: 30, health: 10, hygiene: -6, energy: 7 },
  // Support prefixed versions
  food_apple: { hunger: 15, energy: 5, hygiene: -2 },
  food_pizza: { hunger: 35, happiness: 10, energy: -9 },
  food_burger: { hunger: 40, happiness: 10, energy: 8, hygiene: -8 },
  food_cake: { hunger: 20, happiness: 30, energy: -10 },
  food_sushi: { hunger: 30, health: 10, hygiene: -6, energy: 7 },
};

// Helper to get clean item name for display
function getItemDisplayName(itemId: string): string {
  return itemId.replace('food_', '').replace('_', ' ');
}

// Helper to calculate stat change with bounds checking
function calculateStatChange(currentValue: number, change: number): number {
  return Math.max(0, Math.min(100, currentValue + change));
}

export function useBlobbiFeedAction() {
  const { user } = useCurrentUser();
  const { mutate: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { status, updatePetStats, updatePetCareTimestamp } = useOptimizedStatus();
  const { data: profile } = useBlobbonautProfile();

  return useMutation({
    mutationFn: async ({ petId, itemId, quantity }: FeedActionInput) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      // Find the pet being fed
      const pet = status.allPets.find(p => p.id === petId);
      if (!pet) {
        throw new Error(`Pet with ID ${petId} not found`);
      }

      // Get food effects
      const effects = FOOD_EFFECTS[itemId];
      if (!effects) {
        throw new Error(`Unknown food item: ${itemId}`);
      }

      // Check inventory quantity
      const inventoryItem = profile?.inventory.find(item =>
        item.itemId === itemId ||
        item.itemId === `food_${itemId}` ||
        item.itemId === itemId.replace('food_', '')
      );

      if (!inventoryItem || inventoryItem.quantity < quantity) {
        throw new Error(`Not enough ${getItemDisplayName(itemId)} in inventory`);
      }

      // Calculate total effects for this quantity
      const totalEffects: FoodEffects = {};
      Object.entries(effects).forEach(([stat, value]) => {
        totalEffects[stat as keyof FoodEffects] = value * quantity;
      });

      // Calculate new stats
      const newStats = {
        hunger: calculateStatChange(pet.hunger, totalEffects.hunger || 0),
        happiness: calculateStatChange(pet.happiness, totalEffects.happiness || 0),
        health: calculateStatChange(pet.health, totalEffects.health || 0),
        hygiene: calculateStatChange(pet.hygiene, totalEffects.hygiene || 0),
        energy: calculateStatChange(pet.energy, totalEffects.energy || 0),
      };

      // Experience gained (5 points per item used)
      const experienceGained = quantity * 5;
      const newExperience = pet.experience + experienceGained;

      // Care points (2 points per feeding action, regardless of quantity)
      const carePoints = 2;

      // Update care streak if this is a new day
      const lastMeal = pet.lastMeal;
      const now = new Date();
      const isNewDay = !lastMeal ||
        (now.getTime() - lastMeal.getTime()) > (20 * 60 * 60 * 1000); // 20+ hours = new day
      const newCareStreak = isNewDay ? pet.careStreak + 1 : pet.careStreak;

      // 1. Create Kind 14919 Interaction Event
      const interactionTags = [
        ['blobbi_id', petId],
        ['action', 'feed'],
        ['action_category', 'enrichment'],
        ['stat_change', `hunger:+${totalEffects.hunger || 0}`],
        ['item_used', getItemDisplayName(itemId)],
        ['experience_gained', experienceGained.toString()],
        ['care_streak', newCareStreak.toString()],
        ['care_points', carePoints.toString()],
      ];

      // Add additional stat changes to tags
      Object.entries(totalEffects).forEach(([stat, value]) => {
        if (stat !== 'hunger' && value !== 0) {
          interactionTags.push(['stat_change', `${stat}:${value > 0 ? '+' : ''}${value}`]);
        }
      });

      createEvent({
        kind: 14919,
        content: `Blobbi fed interaction`,
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
        ['last_meal', Math.floor(now.getTime() / 1000).toString()],
        ['last_interaction', Math.floor(now.getTime() / 1000).toString()],
      ];

      // Add existing optional tags
      if (pet.baseColor) petStateTags.push(['base_color', pet.baseColor]);
      if (pet.secondaryColor) petStateTags.push(['secondary_color', pet.secondaryColor]);
      if (pet.pattern) petStateTags.push(['pattern', pet.pattern]);
      if (pet.eyeColor) petStateTags.push(['eye_color', pet.eyeColor]);
      if (pet.personality) petStateTags.push(['personality', pet.personality]);
      if (pet.trait) petStateTags.push(['trait', pet.trait]);
      if (pet.mood) petStateTags.push(['mood', pet.mood]);
      if (pet.favoriteFood) petStateTags.push(['favorite_food', pet.favoriteFood]);
      if (pet.size) petStateTags.push(['size', pet.size]);
      if (pet.currentLocation) petStateTags.push(['current_location', pet.currentLocation]);
      if (pet.isSleeping !== undefined) petStateTags.push(['is_sleeping', pet.isSleeping ? 'true' : 'false']);
      if (pet.isDirty !== undefined) petStateTags.push(['is_dirty', pet.isDirty ? 'true' : 'false']);
      if (pet.inParty !== undefined) petStateTags.push(['in_party', pet.inParty ? 'true' : 'false']);
      if (pet.visibleToOthers !== undefined) petStateTags.push(['visible_to_others', pet.visibleToOthers ? 'true' : 'false']);

      createEvent({
        kind: 31124,
        content: pet.name || petId,
        tags: petStateTags,
      });

      // 3. Update Kind 31125 Owner Profile (reduce inventory)
      if (profile) {
        // Create updated inventory
        const updatedInventory = profile.inventory.map(item => {
          if (item.itemId === inventoryItem.itemId) {
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
          kind: 31125,
          content: `Owner profile: ${profile.name}`,
          tags: ownerTags,
        });
      }

      // Apply optimistic updates
      updatePetStats(petId, newStats);
      updatePetCareTimestamp(petId, 'lastMeal');

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
      // Invalidate related queries to refetch fresh data
      queryClient.invalidateQueries({
        queryKey: ['pet-states', user?.pubkey]
      });
      queryClient.invalidateQueries({
        queryKey: ['blobbonaut-profile', user?.pubkey]
      });
      queryClient.invalidateQueries({
        queryKey: ['owner-profile', user?.pubkey]
      });
    },
    onError: (error) => {
      console.error('Failed to feed Blobbi:', error);
    },
  });
}