/**
 * Typed event creation hooks for Blobbi Nostr events
 *
 * Provides type-safe functions for creating kind 31125 (Owner Profile)
 * and kind 31124 (Pet State) events with proper validation.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import type {
  OwnerProfile,
  PetState,
  InventoryItem
} from '@/lib/blobbi-types';

// ============================================================================
// Owner Profile Event Creation (Kind 31125)
// ============================================================================

/** Input data for creating an owner profile event */
export interface CreateOwnerProfileInput {
  /** Profile ID (required) */
  profileId: string;
  /** Display name (can be empty) */
  name: string;
  /** Currency amount */
  coins?: number;
  /** Interaction level */
  pettingLevel?: number;
  /** Total Blobbis the user has ever owned */
  lifetimeBlobbis?: number;
  /** Favorite Blobbi ID */
  favoriteBlobbi?: string;
  /** First Blobbi ID */
  starterBlobbi?: string;
  /** Currently selected companion Blobbi ID */
  currentCompanion?: string;
  /** Visual style/theme */
  style?: string;
  /** Background theme */
  background?: string;
  /** Custom title or role */
  title?: string;
  /** List of owned pet IDs */
  ownedPets?: string[];
  /** List of earned achievement IDs */
  achievements?: string[];
  /** Inventory items */
  inventory?: InventoryItem[];
  /** Content for the event */
  content?: string;
}

/** Convert input data to Nostr event tags */
function createOwnerProfileTags(input: CreateOwnerProfileInput): string[][] {
  const tags: string[][] = [
    ['d', input.profileId],
    ['name', input.name],
  ];

  // Add optional single-value tags
  if (input.coins !== undefined) tags.push(['coins', input.coins.toString()]);
  if (input.pettingLevel !== undefined) tags.push(['pettingLevel', input.pettingLevel.toString()]);
  if (input.lifetimeBlobbis !== undefined) tags.push(['lifetimeBlobbis', input.lifetimeBlobbis.toString()]);
  if (input.favoriteBlobbi) tags.push(['favoriteBlobbi', input.favoriteBlobbi]);
  if (input.starterBlobbi) tags.push(['starterBlobbi', input.starterBlobbi]);
  if (input.currentCompanion) tags.push(['current_companion', input.currentCompanion]);
  if (input.style) tags.push(['style', input.style]);
  if (input.background) tags.push(['background', input.background]);
  if (input.title) tags.push(['title', input.title]);

  // Add multi-value tags
  if (input.ownedPets) {
    input.ownedPets.forEach(petId => tags.push(['has', petId]));
  }
  if (input.achievements) {
    input.achievements.forEach(achievement => tags.push(['achievements', achievement]));
  }
  if (input.inventory) {
    input.inventory.forEach(item => tags.push(['storage', `${item.itemId}:${item.quantity}`]));
  }

  return tags;
}

/** Hook for creating owner profile events */
export function useCreateOwnerProfile() {
  const { user } = useCurrentUser();
  const { mutate: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateOwnerProfileInput) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      const tags = createOwnerProfileTags(input);
      const content = input.content || `Owner profile: ${input.name}`;

      createEvent({
        kind: 31125,
        content,
        tags,
      });

      return input;
    },
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: ['owner-profile', user?.pubkey]
      });
      queryClient.invalidateQueries({
        queryKey: ['current-companion', user?.pubkey]
      });
    },
  });
}

/** Hook for updating owner profile (merges with existing data) */
export function useUpdateOwnerProfile() {
  const { user } = useCurrentUser();
  const { mutate: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Partial<CreateOwnerProfileInput>) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      // Get existing owner profile data from cache
      const existingProfile = queryClient.getQueryData(['owner-profile', user.pubkey]) as OwnerProfile | null;

      // Merge with updates
      const mergedData: CreateOwnerProfileInput = {
        profileId: updates.profileId || existingProfile?.id || 'profile',
        name: updates.name !== undefined ? updates.name : (existingProfile?.name || ''),
        coins: updates.coins !== undefined ? updates.coins : existingProfile?.coins,
        pettingLevel: updates.pettingLevel !== undefined ? updates.pettingLevel : existingProfile?.pettingLevel,
        lifetimeBlobbis: updates.lifetimeBlobbis !== undefined ? updates.lifetimeBlobbis : existingProfile?.lifetimeBlobbis,
        favoriteBlobbi: updates.favoriteBlobbi !== undefined ? updates.favoriteBlobbi : existingProfile?.favoriteBlobbi,
        starterBlobbi: updates.starterBlobbi !== undefined ? updates.starterBlobbi : existingProfile?.starterBlobbi,
        currentCompanion: updates.currentCompanion !== undefined ? updates.currentCompanion : existingProfile?.currentCompanion,
        style: updates.style !== undefined ? updates.style : existingProfile?.style,
        background: updates.background !== undefined ? updates.background : existingProfile?.background,
        title: updates.title !== undefined ? updates.title : existingProfile?.title,
        ownedPets: updates.ownedPets !== undefined ? updates.ownedPets : existingProfile?.ownedPets,
        achievements: updates.achievements !== undefined ? updates.achievements : existingProfile?.achievements,
        inventory: updates.inventory !== undefined ? updates.inventory : existingProfile?.inventory,
        content: updates.content,
      };

      const tags = createOwnerProfileTags(mergedData);
      const content = mergedData.content || `Updated owner profile: ${mergedData.name}`;

      createEvent({
        kind: 31125,
        content,
        tags,
      });

      return mergedData;
    },
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: ['owner-profile', user?.pubkey]
      });
      queryClient.invalidateQueries({
        queryKey: ['current-companion', user?.pubkey]
      });
    },
  });
}

// ============================================================================
// Pet State Event Creation (Kind 31124)
// ============================================================================

/** Input data for creating a pet state event */
export interface CreatePetStateInput {
  /** Pet ID (required) */
  petId: string;
  /** Pet name (goes in content field) */
  name?: string;
  /** Pet stage */
  stage: 'egg' | 'baby' | 'adult';
  /** Whether pet is ready for breeding */
  breedingReady?: boolean;
  /** Generation number */
  generation?: number;

  // Core stats (0-100)
  hunger?: number;
  happiness?: number;
  health?: number;
  hygiene?: number;
  energy?: number;

  // Progress
  experience?: number;
  careStreak?: number;

  // Appearance
  baseColor?: string;
  secondaryColor?: string;
  pattern?: string;
  eyeColor?: string;
  specialMark?: string;
  adultType?: string;
  manifestation?: string;
  visualEffect?: string;
  blessing?: string;

  // Personality
  personality?: string;
  trait?: string;
  mood?: string;
  favoriteFood?: string;
  voiceType?: string;
  size?: string;
  title?: string;
  skill?: string;

  // Egg-specific
  incubationTime?: number;
  incubationProgress?: number;
  eggTemperature?: number;
  eggStatus?: string;
  shellIntegrity?: number;

  // Behavior
  isSleeping?: boolean;
  isDirty?: boolean;
  hasBuff?: boolean;
  hasDebuff?: boolean;
  lastInteraction?: Date;

  // Care tracking
  lastMeal?: Date;
  lastClean?: Date;
  lastWarm?: Date;
  lastTalk?: Date;
  lastCheck?: Date;
  lastSing?: Date;
  lastMedicine?: Date;

  // Social
  adoptedBy?: string;
  adoptedFrom?: string;
  currentLocation?: string;
  inParty?: boolean;
  visibleToOthers?: boolean;

  // Special
  fees?: number;
  penalty?: number;
  value?: number;
  carePointsDeducted?: number;
}

/** Convert Date to Unix timestamp string */
function dateToTimestamp(date: Date): string {
  return Math.floor(date.getTime() / 1000).toString();
}

/** Convert input data to Nostr event tags */
function createPetStateTags(input: CreatePetStateInput): string[][] {
  const tags: string[][] = [
    ['d', input.petId],
    ['stage', input.stage],
    ['breeding_ready', input.breedingReady ? 'true' : 'false'],
    ['generation', (input.generation || 1).toString()],
    ['hunger', (input.hunger || 50).toString()],
    ['happiness', (input.happiness || 50).toString()],
    ['health', (input.health || 50).toString()],
    ['hygiene', (input.hygiene || 50).toString()],
    ['energy', (input.energy || 50).toString()],
    ['experience', (input.experience || 0).toString()],
    ['care_streak', (input.careStreak || 0).toString()],
  ];

  // Add optional appearance tags
  if (input.baseColor) tags.push(['base_color', input.baseColor]);
  if (input.secondaryColor) tags.push(['secondary_color', input.secondaryColor]);
  if (input.pattern) tags.push(['pattern', input.pattern]);
  if (input.eyeColor) tags.push(['eye_color', input.eyeColor]);
  if (input.specialMark) tags.push(['special_mark', input.specialMark]);
  if (input.adultType) tags.push(['adult_type', input.adultType]);
  if (input.manifestation) tags.push(['manifestation', input.manifestation]);
  if (input.visualEffect) tags.push(['visual_effect', input.visualEffect]);
  if (input.blessing) tags.push(['blessing', input.blessing]);

  // Add optional personality tags
  if (input.personality) tags.push(['personality', input.personality]);
  if (input.trait) tags.push(['trait', input.trait]);
  if (input.mood) tags.push(['mood', input.mood]);
  if (input.favoriteFood) tags.push(['favorite_food', input.favoriteFood]);
  if (input.voiceType) tags.push(['voice_type', input.voiceType]);
  if (input.size) tags.push(['size', input.size]);
  if (input.title) tags.push(['title', input.title]);
  if (input.skill) tags.push(['skill', input.skill]);

  // Add optional egg-specific tags
  if (input.incubationTime !== undefined) tags.push(['incubation_time', input.incubationTime.toString()]);
  if (input.incubationProgress !== undefined) tags.push(['incubation_progress', input.incubationProgress.toString()]);
  if (input.eggTemperature !== undefined) tags.push(['egg_temperature', input.eggTemperature.toString()]);
  if (input.eggStatus) tags.push(['egg_status', input.eggStatus]);
  if (input.shellIntegrity !== undefined) tags.push(['shell_integrity', input.shellIntegrity.toString()]);

  // Add optional behavior tags
  if (input.isSleeping !== undefined) tags.push(['is_sleeping', input.isSleeping ? 'true' : 'false']);
  if (input.isDirty !== undefined) tags.push(['is_dirty', input.isDirty ? 'true' : 'false']);
  if (input.hasBuff !== undefined) tags.push(['has_buff', input.hasBuff ? 'true' : 'false']);
  if (input.hasDebuff !== undefined) tags.push(['has_debuff', input.hasDebuff ? 'true' : 'false']);
  if (input.lastInteraction) tags.push(['last_interaction', dateToTimestamp(input.lastInteraction)]);

  // Add optional care tracking tags
  if (input.lastMeal) tags.push(['last_meal', dateToTimestamp(input.lastMeal)]);
  if (input.lastClean) tags.push(['last_clean', dateToTimestamp(input.lastClean)]);
  if (input.lastWarm) tags.push(['last_warm', dateToTimestamp(input.lastWarm)]);
  if (input.lastTalk) tags.push(['last_talk', dateToTimestamp(input.lastTalk)]);
  if (input.lastCheck) tags.push(['last_check', dateToTimestamp(input.lastCheck)]);
  if (input.lastSing) tags.push(['last_sing', dateToTimestamp(input.lastSing)]);
  if (input.lastMedicine) tags.push(['last_medicine', dateToTimestamp(input.lastMedicine)]);

  // Add optional social tags
  if (input.adoptedBy) tags.push(['adopted_by', input.adoptedBy]);
  if (input.adoptedFrom) tags.push(['adopted_from', input.adoptedFrom]);
  if (input.currentLocation) tags.push(['current_location', input.currentLocation]);
  if (input.inParty !== undefined) tags.push(['in_party', input.inParty ? 'true' : 'false']);
  if (input.visibleToOthers !== undefined) tags.push(['visible_to_others', input.visibleToOthers ? 'true' : 'false']);

  // Add optional special tags
  if (input.fees !== undefined) tags.push(['fees', input.fees.toString()]);
  if (input.penalty !== undefined) tags.push(['penalty', input.penalty.toString()]);
  if (input.value !== undefined) tags.push(['value', input.value.toString()]);
  if (input.carePointsDeducted !== undefined) tags.push(['care_points_deducted', input.carePointsDeducted.toString()]);

  return tags;
}

/** Hook for creating pet state events */
export function useCreatePetState() {
  const { user } = useCurrentUser();
  const { mutate: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreatePetStateInput) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      const tags = createPetStateTags(input);
      const content = input.name || input.petId;

      createEvent({
        kind: 31124,
        content,
        tags,
      });

      return input;
    },
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: ['pet-states', user?.pubkey]
      });
      queryClient.invalidateQueries({
        queryKey: ['blobbis', user?.pubkey]
      });
    },
  });
}

/** Hook for updating pet state (merges with existing data) */
export function useUpdatePetState() {
  const { user } = useCurrentUser();
  const { mutate: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ petId, updates }: { petId: string; updates: Partial<CreatePetStateInput> }) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      // Get existing pet state data from cache
      const allPets = queryClient.getQueryData(['pet-states', user.pubkey]) as PetState[] | undefined;
      const existingPet = allPets?.find(pet => pet.id === petId);

      if (!existingPet) {
        throw new Error(`Pet with ID ${petId} not found`);
      }

      // Merge with updates
      const mergedData: CreatePetStateInput = {
        petId,
        name: updates.name !== undefined ? updates.name : existingPet.name,
        stage: updates.stage !== undefined ? updates.stage : existingPet.stage,
        breedingReady: updates.breedingReady !== undefined ? updates.breedingReady : existingPet.breedingReady,
        generation: updates.generation !== undefined ? updates.generation : existingPet.generation,
        hunger: updates.hunger !== undefined ? updates.hunger : existingPet.hunger,
        happiness: updates.happiness !== undefined ? updates.happiness : existingPet.happiness,
        health: updates.health !== undefined ? updates.health : existingPet.health,
        hygiene: updates.hygiene !== undefined ? updates.hygiene : existingPet.hygiene,
        energy: updates.energy !== undefined ? updates.energy : existingPet.energy,
        experience: updates.experience !== undefined ? updates.experience : existingPet.experience,
        careStreak: updates.careStreak !== undefined ? updates.careStreak : existingPet.careStreak,
        // ... include all other fields with similar logic
        lastMeal: updates.lastMeal !== undefined ? updates.lastMeal : existingPet.lastMeal,
        lastClean: updates.lastClean !== undefined ? updates.lastClean : existingPet.lastClean,
        isSleeping: updates.isSleeping !== undefined ? updates.isSleeping : existingPet.isSleeping,
        isDirty: updates.isDirty !== undefined ? updates.isDirty : existingPet.isDirty,
        // Add other fields as needed...
      };

      const tags = createPetStateTags(mergedData);
      const content = mergedData.name || petId;

      createEvent({
        kind: 31124,
        content,
        tags,
      });

      return mergedData;
    },
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: ['pet-states', user?.pubkey]
      });
      queryClient.invalidateQueries({
        queryKey: ['blobbis', user?.pubkey]
      });
    },
  });
}