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
  getLastEquippedPlacementBySlot,
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
import { isPlacementSlot } from './policy';
import { buildEquipEntry, ISLAND_PLACEMENT_REFERENCE } from './render-model';

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

/** The 2D transform fields the Island editor can change. */
export interface PlacementTransformPatch {
  x?: number;
  y?: number;
  scale?: number;
  rot?: number;
  flipX?: boolean;
}

export type EquipmentMutation =
  | { type: 'equip'; slot: string; entry: GameItemPlacementEntry }
  | { type: 'unequip'; slot: string }
  /**
   * Equip and/or unequip SEVERAL slots in ONE canonical publish.
   *
   * The Inventory & Equipment Lab's bulk actions (apply the test loadout,
   * unequip all effects) fold their changes through this so a seven-slot
   * change is one replaceable event with one incremented revision — never
   * seven racing writes to the same address. Slot semantics per slot are
   * identical to the single-slot mutations: `setEquippedPlacementForSlot`
   * last-wins replacement, `removeEquippedPlacementFromSlot` removal;
   * unrelated placements and unknown fields are untouched.
   */
  | {
      type: 'apply-set';
      equips: { slot: string; entry: GameItemPlacementEntry }[];
      unequips: string[];
    }
  /**
   * Apply transform edits to several equipped slots in ONE publish.
   *
   * The editor lets a player drag three accessories and then save. Publishing
   * once per slot would emit three replaceable events for the same address,
   * each superseding the last, so the first two would be pure noise and a
   * mid-sequence failure would leave a partially-applied state.
   */
  | { type: 'set-transforms'; transforms: Record<string, PlacementTransformPatch> };

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
  switch (mutation.type) {
    case 'equip':
      assertEquippableSlot(mutation.slot);
      return setEquippedPlacementForSlot(base, mutation.slot, mutation.entry);
    case 'unequip':
      assertEquippableSlot(mutation.slot);
      return removeEquippedPlacementFromSlot(base, mutation.slot);
    case 'apply-set': {
      if (mutation.equips.length === 0 && mutation.unequips.length === 0) {
        throw new Error('apply-set mutation requires at least one change');
      }
      // Refuse a slot equipped AND unequipped in one set: the caller's intent
      // is ambiguous and fold order should not decide a player-visible state.
      const equipSlots = new Set(mutation.equips.map((e) => e.slot));
      for (const slot of mutation.unequips) {
        if (equipSlots.has(slot)) {
          throw new Error(`apply-set both equips and unequips slot: ${slot}`);
        }
      }
      let next = base;
      for (const { slot, entry } of mutation.equips) {
        assertEquippableSlot(slot);
        next = setEquippedPlacementForSlot(next, slot, entry);
      }
      for (const slot of mutation.unequips) {
        assertEquippableSlot(slot);
        next = removeEquippedPlacementFromSlot(next, slot);
      }
      return next;
    }
    case 'set-transforms': {
      // Folded over one snapshot, so every edit lands in a single document.
      // A slot with no equipped entry is skipped rather than invented: a
      // transform is an edit to something worn, never a way to wear something.
      let next = base;
      for (const [slot, patch] of Object.entries(mutation.transforms)) {
        assertEquippableSlot(slot);
        const current = getLastEquippedPlacementBySlot(next, slot);
        if (current === undefined) continue;
        next = setEquippedPlacementForSlot(
          next,
          slot,
          applyTransformPatch(current, patch),
        );
      }
      return next;
    }
    default: {
      const _exhaustive: never = mutation;
      throw new Error(`Unknown mutation ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function assertEquippableSlot(slot: string): asserts slot is string {
  // Wearable accessory slots AND visual-effect slots: both live in the same
  // per-character equipment document since Phase 9. Anything outside the
  // combined vocabulary is still refused before a byte is published.
  if (!isPlacementSlot(slot)) {
    throw new Error(`Unknown equipment slot: ${slot}`);
  }
}

/**
 * Merge a transform patch into an equipped entry.
 *
 * Rebuilt through `buildEquipEntry` so the "omit what equals the default" rule
 * is applied once, in one place: an accessory dragged back to the centre stops
 * carrying a `position` rather than carrying a redundant one forever.
 *
 * Unknown fields on the existing entry are carried across explicitly, because
 * the rebuild only knows the fields Island understands and a newer client's
 * data must survive an older client's drag.
 */
function applyTransformPatch(
  entry: GameItemPlacementEntry,
  patch: PlacementTransformPatch,
): GameItemPlacementEntry {
  const slot = entry.slot as string;
  const known = new Set([
    'id',
    'item',
    'mode',
    'slot',
    'position',
    'rotation',
    'scale',
    'flip',
    'layer',
    'form',
    'view',
  ]);
  const preserved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!known.has(key)) preserved[key] = value;
  }

  const rebuilt = buildEquipEntry({
    itemAddress: entry.item,
    slot: slot as Parameters<typeof buildEquipEntry>[0]['slot'],
    x: patch.x ?? entry.position?.x,
    y: patch.y ?? entry.position?.y,
    scale: patch.scale ?? entry.scale?.x,
    rot:
      patch.rot ??
      (entry.rotation?.type === 'euler' && typeof entry.rotation.z === 'number'
        ? entry.rotation.z
        : undefined),
    flipX: patch.flipX ?? entry.flip?.x,
    ...(entry.form === undefined ? {} : { form: entry.form }),
    ...(entry.view === undefined ? {} : { view: entry.view }),
  });

  // `layer` is not editable in this UI but must not be dropped by an edit.
  if (entry.layer !== undefined) rebuilt.layer = entry.layer;

  return { ...preserved, ...rebuilt };
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
    // Island always states its own coordinate system, for the same reason it
    // re-asserts the target: an entry that carries a position and no reference
    // is uninterpretable, and inheriting a reference written by another client
    // would silently reinterpret Island's own percentages.
    reference: ISLAND_PLACEMENT_REFERENCE,
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

      // Every entry being EQUIPPED this write, whatever the mutation shape —
      // the ownership gate below applies to all of them uniformly.
      const equippedEntries =
        mutation.type === 'equip'
          ? [mutation.entry]
          : mutation.type === 'apply-set'
            ? mutation.equips.map((e) => e.entry)
            : [];

      return serialize(`${pubkey}:${characterId}`, async () => {
        const [state, inventory] = await Promise.all([
          fetchPlacement(nostr, pubkey, characterId, AbortSignal.timeout(3000)),
          equippedEntries.length > 0
            ? fetchInventory(nostr, pubkey, AbortSignal.timeout(3000))
            : Promise.resolve(null),
        ]);

        if (inventory !== null) {
          for (const entry of equippedEntries) {
            const held = getInventoryItemQuantity(inventory, entry.item);
            if (held <= 0) {
              throw new Error(
                `Cannot equip an item you do not own: ${entry.item}`,
              );
            }
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
