/**
 * Optimized Status Layer Hook
 *
 * Provides a real-time, optimistically updated status object that combines
 * owner profile (kind 31125) and pet state (kind 31124) data for fast UI rendering.
 *
 * This hook:
 * - Loads initial data from Nostr relays
 * - Maintains an optimized status object for immediate UI updates
 * - Applies optimistic updates when actions are performed
 * - Syncs with relay responses when they arrive
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { useNostr } from './useNostr';
import { useCurrentUser } from './useCurrentUser';
import type {
  OptimizedStatus,
  StatusUpdate,
  PetState
} from '@/lib/blobbi-types';
import {
  parseOwnerProfile,
  parsePetState,
  validateOwnerProfileEvent,
  validatePetStateEvent
} from '@/lib/blobbi-parsers';

// ============================================================================
// Main Hook
// ============================================================================

export function useOptimizedStatus() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  // Ref to store optimistic updates that haven't been confirmed by relay
  const pendingUpdatesRef = useRef<StatusUpdate[]>([]);

  // Query for owner profile (kind 31125)
  const ownerQuery = useQuery({
    queryKey: ['owner-profile', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) return null;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);

      const events = await nostr.query([{
        kinds: [31125],
        authors: [user.pubkey],
        limit: 1
      }], { signal });

      const validEvents = events.filter(validateOwnerProfileEvent);
      return validEvents.length > 0 ? parseOwnerProfile(validEvents[0]) : null;
    },
    enabled: !!user?.pubkey,
    staleTime: 30000, // 30 seconds
  });

  // Query for all pet states (kind 31124)
  const petsQuery = useQuery({
    queryKey: ['pet-states', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) return [];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);

      const events = await nostr.query([{
        kinds: [31124],
        authors: [user.pubkey],
        limit: 50
      }], { signal });

      const validEvents = events.filter(validatePetStateEvent);
      return validEvents
        .map(parsePetState)
        .filter((pet): pet is PetState => pet !== null);
    },
    enabled: !!user?.pubkey,
    staleTime: 30000, // 30 seconds
  });

  // Calculate optimized status with pending updates applied
  const optimizedStatus: OptimizedStatus = useMemo(() => {
    const owner = ownerQuery.data;
    const allPets = petsQuery.data || [];
    const currentPet = owner?.currentCompanion
      ? allPets.find(pet => pet.id === owner.currentCompanion) || null
      : allPets[0] || null;

    let optimizedOwner = owner;
    let optimizedCurrentPet = currentPet;
    let optimizedAllPets = allPets;

    // Apply pending updates
    for (const update of pendingUpdatesRef.current) {
      if (update.ownerUpdates && optimizedOwner) {
        optimizedOwner = { ...optimizedOwner, ...update.ownerUpdates };
      }

      if (update.petUpdates && update.petId) {
        // Update the specific pet
        optimizedAllPets = optimizedAllPets.map(pet =>
          pet.id === update.petId
            ? { ...pet, ...update.petUpdates }
            : pet
        );

        // Update current pet if it's the one being updated
        if (optimizedCurrentPet?.id === update.petId) {
          optimizedCurrentPet = { ...optimizedCurrentPet, ...update.petUpdates };
        }
      }
    }

    return {
      owner: optimizedOwner || null,
      currentPet: optimizedCurrentPet,
      allPets: optimizedAllPets,
      lastUpdated: new Date(),
      isLoading: ownerQuery.isLoading || petsQuery.isLoading,
      error: ownerQuery.error?.message || petsQuery.error?.message,
    };
  }, [ownerQuery.data, petsQuery.data, ownerQuery.isLoading, petsQuery.isLoading, ownerQuery.error, petsQuery.error]);

  // Function to apply optimistic updates
  const applyOptimisticUpdate = useCallback((update: Omit<StatusUpdate, 'timestamp'>) => {
    const timestampedUpdate: StatusUpdate = {
      ...update,
      timestamp: new Date(),
    };

    pendingUpdatesRef.current.push(timestampedUpdate);

    // Force re-render by invalidating queries (but don't refetch)
    queryClient.invalidateQueries({
      queryKey: ['owner-profile', user?.pubkey],
      refetchType: 'none'
    });
    queryClient.invalidateQueries({
      queryKey: ['pet-states', user?.pubkey],
      refetchType: 'none'
    });

    // Clean up old pending updates (older than 30 seconds)
    const thirtySecondsAgo = new Date(Date.now() - 30000);
    pendingUpdatesRef.current = pendingUpdatesRef.current.filter(
      u => u.timestamp > thirtySecondsAgo
    );
  }, [queryClient, user?.pubkey]);

  // Function to clear pending updates (called when relay confirms changes)
  const clearPendingUpdates = useCallback(() => {
    pendingUpdatesRef.current = [];
  }, []);

  // Convenience functions for common updates
  const updatePetStats = useCallback((petId: string, stats: Partial<Pick<PetState, 'hunger' | 'happiness' | 'health' | 'hygiene' | 'energy'>>) => {
    applyOptimisticUpdate({
      petId,
      petUpdates: stats,
    });
  }, [applyOptimisticUpdate]);

  const updateOwnerCoins = useCallback((coins: number) => {
    applyOptimisticUpdate({
      ownerUpdates: { coins },
    });
  }, [applyOptimisticUpdate]);

  const updatePetCareTimestamp = useCallback((petId: string, careType: keyof Pick<PetState, 'lastMeal' | 'lastClean' | 'lastWarm' | 'lastTalk' | 'lastCheck' | 'lastSing' | 'lastMedicine'>) => {
    applyOptimisticUpdate({
      petId,
      petUpdates: { [careType]: new Date() },
    });
  }, [applyOptimisticUpdate]);

  const updatePetBehavior = useCallback((petId: string, behavior: Partial<Pick<PetState, 'isSleeping' | 'isDirty' | 'hasBuff' | 'hasDebuff'>>) => {
    applyOptimisticUpdate({
      petId,
      petUpdates: behavior,
    });
  }, [applyOptimisticUpdate]);

  const setCurrentCompanion = useCallback((companionId: string) => {
    applyOptimisticUpdate({
      ownerUpdates: { currentCompanion: companionId },
    });
  }, [applyOptimisticUpdate]);

  // Function to refresh data from relays
  const refreshFromRelay = useCallback(() => {
    clearPendingUpdates();
    ownerQuery.refetch();
    petsQuery.refetch();
  }, [clearPendingUpdates, ownerQuery, petsQuery]);

  return {
    // Main status object
    status: optimizedStatus,

    // Update functions
    updatePetStats,
    updateOwnerCoins,
    updatePetCareTimestamp,
    updatePetBehavior,
    setCurrentCompanion,
    applyOptimisticUpdate,

    // Utility functions
    clearPendingUpdates,
    refreshFromRelay,

    // Query states for advanced usage
    ownerQuery,
    petsQuery,
  };
}

// ============================================================================
// Convenience Hooks
// ============================================================================

/** Hook to get just the current pet with optimistic updates */
export function useCurrentPet() {
  const { status } = useOptimizedStatus();
  return status.currentPet;
}

/** Hook to get just the owner profile with optimistic updates */
export function useOwnerProfile() {
  const { status } = useOptimizedStatus();
  return status.owner;
}

/** Hook to get all pets with optimistic updates */
export function useAllPets() {
  const { status } = useOptimizedStatus();
  return status.allPets;
}

// ============================================================================
// Action Hooks for Common Operations
// ============================================================================

/** Hook for feeding a pet with optimistic updates */
export function useFeedPet() {
  const { updatePetStats, updatePetCareTimestamp } = useOptimizedStatus();

  return useCallback((petId: string) => {
    // Optimistically update pet stats
    updatePetStats(petId, {
      hunger: Math.min(100, 75), // Assume feeding brings hunger to 75 or current + 25
      happiness: Math.min(100, 60) // Small happiness boost
    });

    // Update care timestamp
    updatePetCareTimestamp(petId, 'lastMeal');

    // Note: Coin deduction would be handled by the actual Nostr event publishing
  }, [updatePetStats, updatePetCareTimestamp]);
}

/** Hook for cleaning a pet with optimistic updates */
export function useCleanPet() {
  const { updatePetStats, updatePetCareTimestamp, updatePetBehavior } = useOptimizedStatus();

  return useCallback((petId: string) => {
    // Optimistically update pet stats
    updatePetStats(petId, {
      hygiene: 100,
      happiness: Math.min(100, 65) // Small happiness boost
    });

    // Update care timestamp
    updatePetCareTimestamp(petId, 'lastClean');

    // Mark as clean
    updatePetBehavior(petId, { isDirty: false });
  }, [updatePetStats, updatePetCareTimestamp, updatePetBehavior]);
}

/** Hook for putting a pet to sleep with optimistic updates */
export function usePutPetToSleep() {
  const { updatePetBehavior } = useOptimizedStatus();

  return useCallback((petId: string) => {
    updatePetBehavior(petId, { isSleeping: true });
  }, [updatePetBehavior]);
}

/** Hook for waking up a pet with optimistic updates */
export function useWakePet() {
  const { updatePetStats, updatePetBehavior } = useOptimizedStatus();

  return useCallback((petId: string) => {
    updatePetBehavior(petId, { isSleeping: false });
    updatePetStats(petId, { energy: 100 }); // Full energy after sleep
  }, [updatePetStats, updatePetBehavior]);
}