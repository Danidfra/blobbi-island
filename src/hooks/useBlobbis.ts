import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import type { PetState } from '@/lib/blobbi-types';
import { parsePetState, validatePetStateEvent } from '@/lib/blobbi-parsers';

// Legacy interface for backward compatibility
export interface Blobbi {
  id: string;
  stage: 'egg' | 'baby' | 'adult';
  generation: number;
  hunger: number;
  happiness: number;
  health: number;
  hygiene: number;
  energy: number;
  experience: number;
  careStreak: number;
  baseColor?: string;
  secondaryColor?: string;
  pattern?: string;
  eyeColor?: string;
  specialMark?: string;
  personality?: string[];
  traits?: string[];
  mood?: string;
  favoriteFood?: string;
  voiceType?: string;
  size?: string;
  title?: string;
  skill?: string;
  name?: string;
  adultType?: string; // For adult stage Blobbis (bloomi, breezy, etc.)
}

/** Convert PetState to legacy Blobbi interface */
function petStateToLegacyBlobbi(petState: PetState): Blobbi {
  return {
    id: petState.id,
    stage: petState.stage,
    generation: petState.generation,
    hunger: petState.hunger,
    happiness: petState.happiness,
    health: petState.health,
    hygiene: petState.hygiene,
    energy: petState.energy,
    experience: petState.experience,
    careStreak: petState.careStreak,
    baseColor: petState.baseColor,
    secondaryColor: petState.secondaryColor,
    pattern: petState.pattern,
    eyeColor: petState.eyeColor,
    specialMark: petState.specialMark,
    personality: petState.personality ? [petState.personality] : undefined,
    traits: petState.trait ? [petState.trait] : undefined,
    mood: petState.mood,
    favoriteFood: petState.favoriteFood,
    voiceType: petState.voiceType,
    size: petState.size,
    title: petState.title,
    skill: petState.skill,
    name: petState.name,
    adultType: petState.adultType,
  };
}

export function useBlobbis() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['blobbis', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);

      // Query for kind 31124 events (Pet State)
      const events = await nostr.query([{
        kinds: [31124],
        authors: [user.pubkey],
        limit: 50
      }], { signal });

      // Transform events to typed PetState objects, then convert to legacy format
      const petStates = events
        .filter(validatePetStateEvent)
        .map(parsePetState)
        .filter((pet): pet is PetState => pet !== null)
        .filter(pet => pet.stage !== 'egg'); // Only include non-egg pets

      // Convert to legacy Blobbi format for backward compatibility
      const blobbis: Blobbi[] = petStates.map(petStateToLegacyBlobbi);

      return blobbis;
    },
    enabled: !!user?.pubkey,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // 1 minute
  });
}