/**
 * Accessory Management Hooks
 *
 * Provides hooks for managing accessories in Blobbi events:
 * - Reading inventory from kind 31125
 * - Reading equipment from kind 31124
 * - Creating/updating equipment in kind 31124
 * - Updating inventory in kind 31125
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

// ============================================================================
// Query Keys
// ============================================================================

export const ACCESSORY_QUERY_KEYS = {
  inventory: (pubkey?: string) => ['accessory-inventory', pubkey],
  equipment: (petId?: string) => ['accessory-equipment', petId],
} as const;

// ============================================================================
// Inventory Query (Kind 31125)
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
        kinds: [31125],
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
    staleTime: 30000, // 30 seconds
  });
}

/** Hook for fetching user's accessory inventory for UI-only display (optimized for Inventory tab) */
export function useAccessoryInventoryUI() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['accessory-inventory-ui', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) {
        return [];
      }

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);

      const events = await nostr.query([{
        kinds: [31125],
        authors: [user.pubkey],
        limit: 1,
      }], { signal });

      if (events.length === 0) {
        return [];
      }

      // Parse inv tags with resilient parsing - never throw, skip malformed tags
      const inventory = events[0].tags
        .filter(([name]) => name === 'inv')
        .map((invTag) => {
          try {
            const tagEntries = Object.fromEntries(
              invTag.slice(1).map((value, index) => {
                const key = invTag[index * 2 + 1];
                const val = invTag[index * 2 + 2];
                return [key, val];
              })
            );

            const code = tagEntries[''] || '';
            const qty = parseInt(tagEntries.qty || '0', 10);

            // Skip if quantity is 0 or invalid
            if (qty <= 0 || isNaN(qty)) {
              return null;
            }

            // Infer slot from code prefix (with back-compat for glasses- -> eyewear-)
            let slot = 'unknown';
            if (code.startsWith('glasses-')) {
              slot = 'eyewear';
            } else if (code.startsWith('headwear-')) {
              slot = 'headwear';
            } else if (code.startsWith('eyewear-')) {
              slot = 'eyewear';
            } else if (code.startsWith('back-')) {
              slot = 'back';
            } else if (code.startsWith('neckwear-')) {
              slot = 'neckwear';
            } else if (code.startsWith('handheld-')) {
              slot = 'handheld';
            } else if (code.startsWith('face-mark-')) {
              slot = 'face-mark';
            } else if (code.startsWith('aura-')) {
              slot = 'aura';
            } else if (code.startsWith('color-overlay-')) {
              slot = 'color-overlay';
            }

            return {
              code,
              quantity: qty,
              slot,
              // No URL needed for UI-only display - will use local assets
              url: '',
            };
          } catch (error) {
            console.warn(`Failed to parse inv tag for UI display:`, invTag, error);
            return null;
          }
        })
        .filter((item): item is AccessoryItem => item !== null);

      return inventory;
    },
    enabled: !!user?.pubkey,
    staleTime: 30000, // 30 seconds
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
        kinds: [31124],
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
    staleTime: 30000, // 30 seconds
  });
}

// ============================================================================
// Equipment Management Mutations
// ============================================================================

/** Hook for equipping an accessory to a pet */
export function useEquipAccessory() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutate: createEvent } = useNostrPublish();
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
        kinds: [31124],
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
        kinds: [31125],
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

      // Create new equipment event
      const equipmentTags = updateEquipTags(petEvent.tags, updatedEquipment);
      createEvent({
        kind: 31124,
        content: petEvent.content,
        tags: equipmentTags,
      });

      // Create new inventory event
      const inventoryTags = updateInvTags(ownerEvent.tags, updatedInventory);
      createEvent({
        kind: 31125,
        content: ownerEvent.content,
        tags: inventoryTags,
      });

      return { newEquipment, updatedInventory, replacedCode: existingInSlot?.code };
    },
    onSuccess: (data, variables) => {
      // Invalidate queries
      queryClient.invalidateQueries({
        queryKey: ACCESSORY_QUERY_KEYS.inventory(user?.pubkey)
      });
      queryClient.invalidateQueries({
        queryKey: ACCESSORY_QUERY_KEYS.equipment(variables.petId)
      });
    },
  });
}

/** Hook for unequipping an accessory from a pet */
export function useUnequipAccessory() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutate: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ petId, code }: { petId: string; code: string }) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      // Get current pet event
      const signal = AbortSignal.timeout(5000);
      const petEvents = await nostr.query([{
        kinds: [31124],
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
        kinds: [31125],
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

      // Create new equipment event
      const equipmentTags = updateEquipTags(petEvent.tags, updatedEquipment);
      createEvent({
        kind: 31124,
        content: petEvent.content,
        tags: equipmentTags,
      });

      // Create new inventory event
      const inventoryTags = updateInvTags(ownerEvent.tags, updatedInventory);
      createEvent({
        kind: 31125,
        content: ownerEvent.content,
        tags: inventoryTags,
      });

      return { updatedEquipment, updatedInventory };
    },
    onSuccess: (data, variables) => {
      // Invalidate queries
      queryClient.invalidateQueries({
        queryKey: ACCESSORY_QUERY_KEYS.inventory(user?.pubkey)
      });
      queryClient.invalidateQueries({
        queryKey: ACCESSORY_QUERY_KEYS.equipment(variables.petId)
      });
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

  return {
    // Data
    inventory: inventory || [],
    equipment: equipment || [],
    currentPet: status?.currentPet || null,

    // Actions
    equipAccessory,
    unequipAccessory,

    // Loading states
    isEquipping: equipMutation.isPending,
    isUnequipping: unequipMutation.isPending,

    // Errors
    equipError: equipMutation.error,
    unequipError: unequipMutation.error,
  };
}