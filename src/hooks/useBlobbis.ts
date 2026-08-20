import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import type { PetState } from '@/lib/blobbi-types';
import { parsePetState, validatePetStateEvent } from '@/lib/blobbi-parsers';
import { KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';
import { readRelayConfirmedOrThrow } from '@/lib/relay-read';

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
  /**
   * Raw event tags from the original Nostr event. Preserved (read-only) so UI
   * code can inspect tags that aren't promoted to typed fields — e.g. `seed`
   * and `client` — to distinguish modern Blobbis from legacy ones without
   * re-querying or mutating any data.
   */
  rawTags?: string[][];
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
    rawTags: petState.rawTags,
  };
}

/**
 * Deadline for reaching EOSE. Unchanged from the previous implementation — the
 * fix is that exceeding it is now reported as UNKNOWN instead of as "no
 * Blobbis", not that the read is given longer.
 */
const READ_TIMEOUT_MS = 2000;

export function useBlobbis() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['blobbis', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      // CONFIRMED-EMPTY read. This list decides whether the player owns any
      // Blobbi at all, so a relay that times out (or answers partially) must
      // NOT be able to say "zero". `readRelayConfirmedOrThrow` throws on an
      // unusable read, which makes React Query keep the previously known list
      // instead of replacing it with `[]`; only a completed empty answer,
      // confirmed by a second completed read, resolves to an empty list.
      const events = await readRelayConfirmedOrThrow(
        nostr,
        [{
          kinds: [KIND_BLOBBI_STATE],
          authors: [user.pubkey],
          limit: 25, // Reduced limit for faster initial load
        }],
        { signal: c.signal, timeoutMs: READ_TIMEOUT_MS },
      );

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
    staleTime: 120000, // 2 minutes - longer cache to reduce refetches
    refetchInterval: 120000, // 2 minutes - less frequent refetching
    retry: 1, // Only retry once
    retryDelay: 1000, // Slightly slower retry to reduce load
  });
}