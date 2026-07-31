/**
 * Blobbi Island — kind:31634 equipment write API.
 *
 * The single mutation layer for equipment. It deliberately mirrors
 * `useInventoryMutation`: per-subject serialization, a FRESH relay read as the
 * base of every write, complete-replacement publish, optimistic cache update,
 * rollback on failure, and post-settlement invalidation. Two protocols with the
 * same lost-update problem get the same solution rather than two half-solutions.
 *
 * ALL PLACEMENT MATH IS THE PACKAGE'S. This module never edits a `placements`
 * array by hand: `setEquippedPlacementForSlot` and
 * `removeEquippedPlacementFromSlot` do it immutably, preserving unrelated
 * entries and unknown fields, and `toBuildGameItemPlacementInput` carries
 * unknown content and unrelated tags into the next event.
 *
 * WHAT EQUIPPING DOES NOT DO: it does not touch kind:31633. Quantity is not
 * consumed by wearing something and not returned by taking it off. Possession
 * and placement are different questions with different events.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';

import {
  buildGameItemPlacementEvent,
  compareGameItemPlacementRevisions,
  removeEquippedPlacementFromSlot,
  setEquippedPlacementForSlot,
  toBuildGameItemPlacementInput,
  type GameItemPlacement,
  type GameItemPlacementEntry,
  type UnsignedEventTemplate,
} from '@/inventory/package';
import { fetchInventory } from '@/inventory/useIslandInventory';
import { getInventoryItemQuantity } from '@/inventory/package';

import {
  ISLAND_PLACEMENT_CONTEXT,
  ISLAND_PLACEMENT_TOPIC,
  characterEquipmentAlt,
  placementTargetForCharacter,
} from './identity';
import {
  buildEmptyPlacement,
  fetchPlacement,
  placementQueryKey,
  type PlacementState,
} from './usePlacementState';
import { isEquippableSlot } from './policy';

// --- Per-document serialization -------------------------------------------
//
// Keyed by the placement document, not by user: dressing two different Blobbis
// at once writes two different replaceable events and cannot conflict, so
// serializing them together would only add latency.

const mutationChains = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = mutationChains.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  mutationChains.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

// --- Pure transforms -------------------------------------------------------

export type EquipmentMutation =
  | { type: 'equip'; slot: string; entry: GameItemPlacementEntry }
  | { type: 'unequip'; slot: string };

/**
 * Apply an equipment mutation purely (no I/O).
 *
 * Both branches delegate to the package, so slot conflict handling is the
 * documented last-wins behavior and nothing else in the document moves.
 */
export function applyEquipmentMutation(
  base: GameItemPlacement,
  mutation: EquipmentMutation,
): GameItemPlacement {
  if (!isEquippableSlot(mutation.slot)) {
    throw new Error(`Unknown equipment slot: ${mutation.slot}`);
  }
  switch (mutation.type) {
    case 'equip':
      return setEquippedPlacementForSlot(base, mutation.slot, mutation.entry);
    case 'unequip':
      return removeEquippedPlacementFromSlot(base, mutation.slot);
    default: {
      const _exhaustive: never = mutation;
      throw new Error(`Unknown mutation ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Build the complete replacement kind:31634 event for a placement document.
 *
 * COMPLETE REPLACEMENT, never a diff: kind:31634 is addressable, so the newest
 * event IS the state. `toBuildGameItemPlacementInput` supplies the unknown
 * content fields and unrelated tags of the document this one supersedes, which
 * is what stops an Island release from quietly deleting data written by a newer
 * client.
 *
 * The revision is incremented from the state actually read from the relay, so
 * two clients that both write from revision 4 produce two revision-5 documents
 * with different content — which `compareGameItemPlacementRevisions` reports as
 * a `conflict` rather than silently letting the later `created_at` win.
 */
export function buildEquipmentTemplate(
  next: GameItemPlacement,
  options: {
    ownerPubkey: string;
    characterId: string;
    characterName?: string;
    /** Revision of the state this event replaces. */
    baseRevision: number | undefined;
    relays?: Record<string, string>;
  },
): UnsignedEventTemplate<31634> {
  const input = toBuildGameItemPlacementInput(next);
  return buildGameItemPlacementEvent({
    ...input,
    // The target is re-asserted from Island identity rather than trusted from
    // the previous document: a document that arrived with a target pointing at
    // somebody else's Blobbi must not have that target carried forward.
    target: placementTargetForCharacter(options.ownerPubkey, options.characterId),
    revision: (options.baseRevision ?? 0) + 1,
    contexts: dedupe([...(input.contexts ?? []), ISLAND_PLACEMENT_CONTEXT]),
    topics: dedupe([...(input.topics ?? []), ISLAND_PLACEMENT_TOPIC]),
    alt: input.alt ?? characterEquipmentAlt(options.characterName ?? ''),
    ...(options.relays ? { relays: options.relays } : {}),
  });
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.trim() !== ''))];
}

// --- Hook ------------------------------------------------------------------

export interface EquipmentMutationVariables {
  characterId: string;
  characterName?: string;
  mutation: EquipmentMutation;
}

/**
 * The canonical equipment mutation hook.
 *
 * Ownership gate: equipping requires the item in the player's kind:31633
 * inventory with quantity > 0, checked against a FRESH inventory read at write
 * time rather than a cached one. Unequipping has no such gate — a player must
 * always be able to take off something they no longer own.
 */
export function useEquipmentMutation() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: publish } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      characterId,
      characterName,
      mutation,
    }: EquipmentMutationVariables): Promise<GameItemPlacement> => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }
      const pubkey = user.pubkey;

      return serialize(`${pubkey}:${characterId}`, async () => {
        const [state, inventory] = await Promise.all([
          fetchPlacement(nostr, pubkey, characterId, AbortSignal.timeout(3000)),
          mutation.type === 'equip'
            ? fetchInventory(nostr, pubkey, AbortSignal.timeout(3000))
            : Promise.resolve(null),
        ]);

        if (mutation.type === 'equip' && inventory !== null) {
          const held = getInventoryItemQuantity(inventory, mutation.entry.item);
          if (held <= 0) {
            throw new Error(
              `Cannot equip an item you do not own: ${mutation.entry.item}`,
            );
          }
        }

        const next = applyEquipmentMutation(state.placement, mutation);
        const template = buildEquipmentTemplate(next, {
          ownerPubkey: pubkey,
          characterId,
          ...(characterName === undefined ? {} : { characterName }),
          baseRevision: state.isEmpty ? undefined : state.placement.revision,
        });

        await publish(template);
        return next;
      });
    },

    onMutate: async ({
      characterId,
      mutation,
    }): Promise<{ previous?: PlacementState; key: readonly unknown[] }> => {
      const key = placementQueryKey(user?.pubkey, characterId);
      if (!user?.pubkey) return { key };

      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PlacementState>(key);

      const base =
        previous?.placement ?? buildEmptyPlacement(user.pubkey, characterId);
      try {
        const optimistic = applyEquipmentMutation(base, mutation);
        queryClient.setQueryData<PlacementState>(key, {
          placement: optimistic,
          warnings: previous?.warnings ?? [],
          // Optimistic state is not a published event; keep the flag honest so
          // a concurrent write still starts its revision from the real base.
          isEmpty: previous?.isEmpty ?? true,
        });
      } catch {
        // An invalid mutation leaves the cache untouched; mutationFn throws and
        // surfaces the error.
      }
      return previous === undefined ? { key } : { previous, key };
    },

    onError: (_error, _variables, context) => {
      if (!context) return;
      // Roll back the optimistic update. No relay rollback exists for a
      // replaceable event, and none is attempted.
      queryClient.setQueryData(context.key, context.previous);
    },

    onSettled: (_data, _error, { characterId }) => {
      if (!user?.pubkey) return;
      queryClient.invalidateQueries({
        queryKey: placementQueryKey(user.pubkey, characterId),
      });
    },
  });
}

export { compareGameItemPlacementRevisions };
