/**
 * Accessory Management Hooks
 *
 * Provides hooks for managing accessories in Blobbi events:
 * - Reading inventory from kind 11125
 * - Reading equipment from kind 31124
 * - Creating/updating equipment in kind 31124
 * - Updating inventory in kind 11125
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useNostr } from '../../../hooks/useNostr';
import { useOptimizedStatus } from '../../../hooks/useOptimizedStatus';
import { useNostrPublish } from '../../../hooks/useNostrPublish';
import type {
  AccessoryItem,
  EquipmentConfig,
  AccessoryEditData
} from '../lib/accessory-types';
import {
  AccessoryInventoryError
} from '../lib/accessory-types';

import {
  parseInvTags,
  parseEquipTags,
  mergeInventoryTags,
  validateAccessoryEditData,
  checkInventoryQuantity,
  updateInventoryQuantity,
  findEquipmentBySlot,
  removeEquipmentByCode,
  updateInvTags,
  updateEquipTags,
  inferSlotFromCode
} from '../lib/accessory-utils';
import { BLOBBONAUT_PROFILE_KINDS, KIND_BLOBBONAUT_PROFILE, KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';

// ============================================================================
// Query Keys
// ============================================================================

export const ACCESSORY_QUERY_KEYS = {
  inventory: (pubkey?: string) => ['accessory-inventory', pubkey],
  equipment: (petId?: string) => ['accessory-equipment', petId],
} as const;

// ============================================================================
// Inventory Query (Kind 11125)
// ============================================================================

/** Hook for fetching user's accessory inventory */
export function useAccessoryInventory() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ACCESSORY_QUERY_KEYS.inventory(user?.pubkey),
    queryFn: async (c) => {
      if (!user?.pubkey) {
        return [];
      }

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);

      const events = await nostr.query([{
        kinds: [...BLOBBONAUT_PROFILE_KINDS],
        authors: [user.pubkey],
        limit: 1,
      }], { signal });

      if (events.length === 0) {
        return [];
      }

      const inventory = parseInvTags(events[0].tags);
      return mergeInventoryTags(inventory);
    },
    enabled: !!user?.pubkey,
  });
}

// ============================================================================
// Equipment Query (Kind 31124)
// ============================================================================

/** Hook for fetching a pet's equipment configuration */
export function usePetEquipment(petId?: string) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ACCESSORY_QUERY_KEYS.equipment(petId),
    queryFn: async (c) => {
      if (!user?.pubkey || !petId) {
        return [];
      }

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);

      const events = await nostr.query([{
        kinds: [KIND_BLOBBI_STATE],
        authors: [user.pubkey],
        '#d': [petId],
        limit: 1,
      }], { signal });

      if (events.length === 0) {
        return [];
      }

      return parseEquipTags(events[0].tags);
    },
    enabled: !!user?.pubkey && !!petId,
  });
}

// ============================================================================
// Equipment Management Mutations
// ============================================================================

/** Hook for equipping an accessory to a pet */
export function useEquipAccessory() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { data: inventory } = useAccessoryInventory();

  return useMutation({
    mutationFn: async ({ petId, editData }: { petId: string; editData: AccessoryEditData }) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      // Validate edit data
      validateAccessoryEditData(editData);

      // Check inventory quantity
      if (!checkInventoryQuantity(inventory || [], editData.code, 1)) {
        throw new AccessoryInventoryError(`Insufficient quantity for accessory: ${editData.code}`);
      }

      // Get current pet event
      const signal = AbortSignal.timeout(5000);
      const petEvents = await nostr.query([{
        kinds: [KIND_BLOBBI_STATE],
        authors: [user.pubkey],
        '#d': [petId],
        limit: 1,
      }], { signal });

      if (petEvents.length === 0) {
        throw new Error('Pet not found');
      }

      const petEvent = petEvents[0];
      const currentEquipment = parseEquipTags(petEvent.tags);
      const slot = inferSlotFromCode(editData.code);

      // Find existing equipment in the same slot
      const existingInSlot = findEquipmentBySlot(currentEquipment, slot);

      // Get current owner event for inventory management
      const ownerEvents = await nostr.query([{
        kinds: [...BLOBBONAUT_PROFILE_KINDS],
        authors: [user.pubkey],
        limit: 1,
      }], { signal });

      if (ownerEvents.length === 0) {
        throw new Error('Owner profile not found');
      }

      const ownerEvent = ownerEvents[0];
      const currentInventory = parseInvTags(ownerEvent.tags);

      // Prepare new equipment config
      const newEquipment: EquipmentConfig = {
        code: editData.code,
        x: editData.x,
        y: editData.y,
        scale: editData.scale,
        rot: editData.rot,
        flipX: editData.flipX,
        refw: editData.refw,
        refh: editData.refh,
        form: editData.form,
        url: editData.url,
        slot,
      };

      // Update equipment: remove old in slot, add new
      let updatedEquipment = currentEquipment;
      if (existingInSlot) {
        updatedEquipment = removeEquipmentByCode(updatedEquipment, existingInSlot.code);
      }
      updatedEquipment = [...updatedEquipment, newEquipment];

      // Update inventory: decrement new item, increment old item if any
      let updatedInventory = updateInventoryQuantity(currentInventory, editData.code, -1);
      if (existingInSlot) {
        updatedInventory = updateInventoryQuantity(updatedInventory, existingInSlot.code, 1);
      }

      // Create new equipment event and wait for it to be signed/published
      const equipmentTags = updateEquipTags(petEvent.tags, updatedEquipment);
      await createEvent({
        kind: KIND_BLOBBI_STATE,
        content: petEvent.content,
        tags: equipmentTags,
      });

      // Create new inventory event and wait for it to be signed/published
      const inventoryTags = updateInvTags(ownerEvent.tags, updatedInventory);
      await createEvent({
        kind: KIND_BLOBBONAUT_PROFILE,
        content: ownerEvent.content,
        tags: inventoryTags,
      });

      return {
        newEquipment,
        updatedEquipment,
        updatedInventory,
        replacedCode: existingInSlot?.code
      };
    },
    onMutate: async ({ petId, editData }) => {
      if (!user?.pubkey) return;

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ACCESSORY_QUERY_KEYS.equipment(petId) });
      await queryClient.cancelQueries({ queryKey: ACCESSORY_QUERY_KEYS.inventory(user.pubkey) });
      await queryClient.cancelQueries({ queryKey: ['accessory-inventory-ui', user.pubkey] });

      // Snapshot the previous values
      const previousEquipment = queryClient.getQueryData<EquipmentConfig[]>(
        ACCESSORY_QUERY_KEYS.equipment(petId)
      );
      const previousInventory = queryClient.getQueryData<AccessoryItem[]>(
        ACCESSORY_QUERY_KEYS.inventory(user.pubkey)
      );
      const previousInventoryUI = queryClient.getQueryData<AccessoryItem[]>(
        ['accessory-inventory-ui', user.pubkey]
      );

      if (previousEquipment && previousInventory) {
        const slot = inferSlotFromCode(editData.code);
        const existingInSlot = findEquipmentBySlot(previousEquipment, slot);

        // Prepare new equipment config
        const newEquipment: EquipmentConfig = {
          code: editData.code,
          x: editData.x,
          y: editData.y,
          scale: editData.scale,
          rot: editData.rot,
          flipX: editData.flipX,
          refw: editData.refw,
          refh: editData.refh,
          form: editData.form,
          url: editData.url,
          slot,
        };

        // Update equipment optimistically
        let optimisticEquipment = previousEquipment;
        if (existingInSlot) {
          optimisticEquipment = removeEquipmentByCode(optimisticEquipment, existingInSlot.code);
        }
        optimisticEquipment = [...optimisticEquipment, newEquipment];

        // Update inventory optimistically
        let optimisticInventory = updateInventoryQuantity(previousInventory, editData.code, -1);
        if (existingInSlot) {
          optimisticInventory = updateInventoryQuantity(optimisticInventory, existingInSlot.code, 1);
        }

        // Update inventory UI optimistically
        let optimisticInventoryUI = previousInventoryUI || [];
        const mergedInventory = mergeInventoryTags(optimisticInventory);
        optimisticInventoryUI = mergedInventory.filter(item => item.quantity > 0);

        // Optimistically update the cache
        queryClient.setQueryData(ACCESSORY_QUERY_KEYS.equipment(petId), optimisticEquipment);
        queryClient.setQueryData(ACCESSORY_QUERY_KEYS.inventory(user.pubkey), optimisticInventory);
        queryClient.setQueryData(['accessory-inventory-ui', user.pubkey], optimisticInventoryUI);
      }

      // Return a context object with the snapshotted values
      return {
        previousEquipment,
        previousInventory,
        previousInventoryUI,
        petId,
        userPubkey: user.pubkey
      };
    },
    onError: (err, variables, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context) {
        if (context.previousEquipment) {
          queryClient.setQueryData(
            ACCESSORY_QUERY_KEYS.equipment(context.petId),
            context.previousEquipment
          );
        }
        if (context.previousInventory) {
          queryClient.setQueryData(
            ACCESSORY_QUERY_KEYS.inventory(context.userPubkey),
            context.previousInventory
          );
        }
      }
    },
    onSettled: () => {
      // Always refetch after error or success to ensure cache consistency
      // But don't await it - let it happen in the background
      if (user?.pubkey) {
        queryClient.invalidateQueries({
          queryKey: ACCESSORY_QUERY_KEYS.inventory(user.pubkey)
        });
      }
    },
  });
}

/** Hook for unequipping an accessory from a pet */
export function useUnequipAccessory() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ petId, code }: { petId: string; code: string }) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      // Get current pet event
      const signal = AbortSignal.timeout(5000);
      const petEvents = await nostr.query([{
        kinds: [KIND_BLOBBI_STATE],
        authors: [user.pubkey],
        '#d': [petId],
        limit: 1,
      }], { signal });

      if (petEvents.length === 0) {
        throw new Error('Pet not found');
      }

      const petEvent = petEvents[0];
      const currentEquipment = parseEquipTags(petEvent.tags);
      const equipmentToRemove = currentEquipment.find(eq => eq.code === code);

      if (!equipmentToRemove) {
        throw new Error('Accessory not equipped');
      }

      // Get current owner event for inventory management
      const ownerEvents = await nostr.query([{
        kinds: [...BLOBBONAUT_PROFILE_KINDS],
        authors: [user.pubkey],
        limit: 1,
      }], { signal });

      if (ownerEvents.length === 0) {
        throw new Error('Owner profile not found');
      }

      const ownerEvent = ownerEvents[0];
      const currentInventory = parseInvTags(ownerEvent.tags);

      // Remove equipment from pet
      const updatedEquipment = removeEquipmentByCode(currentEquipment, code);

      // Add item back to inventory
      const updatedInventory = updateInventoryQuantity(currentInventory, code, 1);

      // Create new equipment event and wait for it to be signed/published
      const equipmentTags = updateEquipTags(petEvent.tags, updatedEquipment);
      await createEvent({
        kind: KIND_BLOBBI_STATE,
        content: petEvent.content,
        tags: equipmentTags,
      });

      // Create new inventory event and wait for it to be signed/published
      const inventoryTags = updateInvTags(ownerEvent.tags, updatedInventory);
      await createEvent({
        kind: KIND_BLOBBONAUT_PROFILE,
        content: ownerEvent.content,
        tags: inventoryTags,
      });

      return { updatedEquipment, updatedInventory };
    },
    onMutate: async ({ petId, code }) => {
      if (!user?.pubkey) return;

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ACCESSORY_QUERY_KEYS.equipment(petId) });
      await queryClient.cancelQueries({ queryKey: ACCESSORY_QUERY_KEYS.inventory(user.pubkey) });

      // Snapshot the previous values
      const previousEquipment = queryClient.getQueryData<EquipmentConfig[]>(
        ACCESSORY_QUERY_KEYS.equipment(petId)
      );
      const previousInventory = queryClient.getQueryData<AccessoryItem[]>(
        ACCESSORY_QUERY_KEYS.inventory(user.pubkey)
      );

      if (previousEquipment && previousInventory) {
        // Remove equipment optimistically
        const optimisticEquipment = removeEquipmentByCode(previousEquipment, code);

        // Add item back to inventory optimistically
        const optimisticInventory = updateInventoryQuantity(previousInventory, code, 1);

        // Optimistically update the cache
        queryClient.setQueryData(ACCESSORY_QUERY_KEYS.equipment(petId), optimisticEquipment);
        queryClient.setQueryData(ACCESSORY_QUERY_KEYS.inventory(user.pubkey), optimisticInventory);
      }

      // Return a context object with the snapshotted values
      return {
        previousEquipment,
        previousInventory,
        petId,
        userPubkey: user.pubkey
      };
    },
    onError: (err, variables, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context) {
        if (context.previousEquipment) {
          queryClient.setQueryData(
            ACCESSORY_QUERY_KEYS.equipment(context.petId),
            context.previousEquipment
          );
        }
        if (context.previousInventory) {
          queryClient.setQueryData(
            ACCESSORY_QUERY_KEYS.inventory(context.userPubkey),
            context.previousInventory
          );
        }
      }
    },
    onSettled: () => {
      // Always refetch after error or success to ensure cache consistency
      // But don't await it - let it happen in the background
      if (user?.pubkey) {
        queryClient.invalidateQueries({
          queryKey: ACCESSORY_QUERY_KEYS.inventory(user.pubkey)
        });
      }
    },
  });
}

/** Hook for updating an already equipped accessory's position/settings */
export function useUpdateEquippedAccessory() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ petId, editData }: { petId: string; editData: AccessoryEditData }) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      // Validate edit data
      validateAccessoryEditData(editData);

      // Get current pet event
      const signal = AbortSignal.timeout(5000);
      const petEvents = await nostr.query([{
        kinds: [KIND_BLOBBI_STATE],
        authors: [user.pubkey],
        '#d': [petId],
        limit: 1,
      }], { signal });

      if (petEvents.length === 0) {
        throw new Error('Pet not found');
      }

      const petEvent = petEvents[0];
      const currentEquipment = parseEquipTags(petEvent.tags);
      const slot = inferSlotFromCode(editData.code);

      // Find the existing equipment item
      const existingEquipment = currentEquipment.find(eq => eq.code === editData.code);
      if (!existingEquipment) {
        throw new Error('Accessory is not currently equipped');
      }

      // Create updated equipment config
      const updatedEquipment: EquipmentConfig = {
        code: editData.code,
        x: editData.x,
        y: editData.y,
        scale: editData.scale,
        rot: editData.rot,
        flipX: editData.flipX,
        refw: editData.refw,
        refh: editData.refh,
        form: editData.form,
        url: editData.url,
        slot,
      };

      // Replace the existing equipment with updated version
      const newEquipmentList = currentEquipment.map(eq =>
        eq.code === editData.code ? updatedEquipment : eq
      );

      // Create new equipment event with updated tags and wait for it to be signed/published
      const equipmentTags = updateEquipTags(petEvent.tags, newEquipmentList);
      await createEvent({
        kind: KIND_BLOBBI_STATE,
        content: petEvent.content,
        tags: equipmentTags,
      });

      return { updatedEquipment, newEquipmentList };
    },
    onMutate: async ({ petId, editData }) => {
      if (!user?.pubkey) return;

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ACCESSORY_QUERY_KEYS.equipment(petId) });

      // Snapshot the previous value
      const previousEquipment = queryClient.getQueryData<EquipmentConfig[]>(
        ACCESSORY_QUERY_KEYS.equipment(petId)
      );

      if (previousEquipment) {
        const slot = inferSlotFromCode(editData.code);

        // Create updated equipment config
        const updatedEquipment: EquipmentConfig = {
          code: editData.code,
          x: editData.x,
          y: editData.y,
          scale: editData.scale,
          rot: editData.rot,
          flipX: editData.flipX,
          refw: editData.refw,
          refh: editData.refh,
          form: editData.form,
          url: editData.url,
          slot,
        };

        // Replace the existing equipment with updated version optimistically
        const optimisticEquipment = previousEquipment.map(eq =>
          eq.code === editData.code ? updatedEquipment : eq
        );

        // Optimistically update the cache
        queryClient.setQueryData(ACCESSORY_QUERY_KEYS.equipment(petId), optimisticEquipment);
      }

      // Return a context object with the snapshotted value
      return {
        previousEquipment,
        petId,
        userPubkey: user.pubkey
      };
    },
    onError: (err, variables, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousEquipment) {
        queryClient.setQueryData(
          ACCESSORY_QUERY_KEYS.equipment(context.petId),
          context.previousEquipment
        );
      }
    },
    onSettled: () => {
      // Let background refetch happen to ensure consistency
      // Don't await it to keep UI responsive
    },
  });
}

// ============================================================================
// Combined Hook for UI Components
// ============================================================================

/** Combined hook for accessory management UI */
export function useAccessoryManagement() {
  const { status } = useOptimizedStatus();
  const { data: inventory } = useAccessoryInventory();
  const { data: equipment } = usePetEquipment(status?.currentPet?.id);
  const equipMutation = useEquipAccessory();
  const unequipMutation = useUnequipAccessory();
  const updateMutation = useUpdateEquippedAccessory();

  const equipAccessory = async (editData: AccessoryEditData) => {
    if (!status?.currentPet?.id) {
      throw new Error('No pet selected');
    }

    return equipMutation.mutateAsync({
      petId: status.currentPet.id,
      editData,
    });
  };

  const unequipAccessory = async (code: string) => {
    if (!status?.currentPet?.id) {
      throw new Error('No pet selected');
    }

    return unequipMutation.mutateAsync({
      petId: status.currentPet.id,
      code,
    });
  };

  const updateEquippedAccessory = async (editData: AccessoryEditData) => {
    if (!status?.currentPet?.id) {
      throw new Error('No pet selected');
    }

    return updateMutation.mutateAsync({
      petId: status.currentPet.id,
      editData,
    });
  };

  return {
    // Data
    inventory: inventory || [],
    equipment: equipment || [],
    currentPet: status?.currentPet || null,

    // Actions
    equipAccessory,
    unequipAccessory,
    updateEquippedAccessory,

    // Loading states
    isEquipping: equipMutation.isPending,
    isUnequipping: unequipMutation.isPending,
    isUpdating: updateMutation.isPending,

    // Errors
    equipError: equipMutation.error,
    unequipError: unequipMutation.error,
    updateError: updateMutation.error,
  };
}
