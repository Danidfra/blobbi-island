/**
 * Blobbi Island — the one hook the renderer asks "what is this Blobbi wearing?".
 *
 * It joins the three events that answer that question, in the order their
 * responsibilities require:
 *
 *   kind:31634  where items are equipped        → `usePlacementState`
 *   kind:31633  which items are actually owned  → `useIslandInventory`
 *   kind:31632  what those items look like      → `useItemCatalog`
 *
 * and then applies Island policy (`policy.ts`) to decide which entries may be
 * drawn. Every rejection is kept, not discarded: `hidden` is what lets the dev
 * inspector answer "why is my hat not showing?" without a debugger.
 *
 * The separation is the point. A placement is not ownership, ownership is not a
 * definition, and none of the three is authorization.
 */

import { useMemo } from 'react';

import { useIslandInventory } from '@/inventory/useIslandInventory';
import { useItemCatalog } from '@/inventory/useItemCatalog';
import { getInventoryItems } from '@/inventory/package';
import type { GameItemPlacementEntry, ParseWarning } from '@/inventory/package';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';
import type { AccessoryPlacementInput, BlobbiVisualEffect } from '@blobbi/react';
import {
  isEffectItemPlacement,
  resolveActiveBlobbiEffects,
  type ActiveEffectPlacement,
  type RejectedEffectPlacement,
} from '@/effects/active-effects';

import { usePlacementState } from './usePlacementState';
import {
  selectRenderablePlacements,
  decidePlacementEntry,
  mayModifyCharacter,
  type PlacementPolicyContext,
  type PlacementRejectionReason,
} from './policy';
import {
  toAccessoryPlacementInput,
  type UnsupportedTransformReason,
} from './render-model';

/** A placement entry that will not be drawn, and why. */
export interface HiddenPlacement {
  entry: GameItemPlacementEntry;
  reason: PlacementRejectionReason | UnsupportedTransformReason;
}

export interface CharacterEquipment {
  /** Renderer input for every drawable accessory, in slot paint order. */
  accessories: AccessoryPlacementInput[];
  /**
   * Renderer input for the ACTIVE visual effects, in the renderer's canonical
   * slot order. Plain `{ id }` data — exactly what `BlobbiRendererView.effects`
   * takes. Empty (the same frozen array) whenever nothing is active, so the
   * no-effect render path stays byte-identical to the Phase-8 baseline.
   */
  effects: readonly BlobbiVisualEffect[];
  /** The effect placements behind {@link effects}, for the management UI. */
  activeEffects: readonly ActiveEffectPlacement[];
  /** Effect-item placements that were refused, with the reason. */
  rejectedEffects: readonly RejectedEffectPlacement[];
  /** `itemAddress → definition` for the drawable accessories' artwork. */
  definitionsByAddress: ReadonlyMap<string, ResolvedBlobbiItemDefinition>;
  /** Entries that exist in the document but are not drawn, with the reason. */
  hidden: HiddenPlacement[];
  /** Parse warnings from the placement document, passed through verbatim. */
  warnings: ParseWarning[];
  /** `true` while any of the three underlying queries is still loading. */
  isLoading: boolean;
  /** `true` when no kind:31634 event exists yet for this character. */
  isEmpty: boolean;
}

const NO_EFFECTS: readonly BlobbiVisualEffect[] = Object.freeze([]);
const NO_ACTIVE_EFFECTS: readonly ActiveEffectPlacement[] = Object.freeze([]);
const NO_REJECTED_EFFECTS: readonly RejectedEffectPlacement[] = Object.freeze([]);

const EMPTY_EQUIPMENT: CharacterEquipment = {
  accessories: [],
  effects: NO_EFFECTS,
  activeEffects: NO_ACTIVE_EFFECTS,
  rejectedEffects: NO_REJECTED_EFFECTS,
  definitionsByAddress: new Map(),
  hidden: [],
  warnings: [],
  isLoading: false,
  isEmpty: true,
};

/**
 * Resolve a character's drawable equipment.
 *
 * `ownerPubkey` defaults to the logged-in user. When another player's Blobbi is
 * rendered (the multiplayer layer), pass their pubkey: the placement is read
 * from them, and — because Island policy requires author === owner — a
 * placement they did not sign is not drawn.
 *
 * NOTE on ownership for other players: their kind:31633 inventory is not read,
 * so `quantityByAddress` is empty and every entry is refused as `not-owned`.
 * That is intentional for now — rendering a stranger's claim that they own a
 * hat, without checking, is exactly the trust hole this architecture avoids.
 * Widening it means reading their inventory too, which is a deliberate change
 * to make here rather than an accident to inherit.
 */
export function useCharacterEquipment(
  characterId: string | undefined,
  options: { ownerPubkey?: string; form?: string } = {},
): CharacterEquipment {
  const placementQuery = usePlacementState(characterId, options.ownerPubkey);
  const inventoryQuery = useIslandInventory();
  const catalogQuery = useItemCatalog();

  const state = placementQuery.data;
  const inventory = inventoryQuery.data;
  const catalog = catalogQuery.data;
  const form = options.form;

  return useMemo((): CharacterEquipment => {
    if (!state) {
      return {
        ...EMPTY_EQUIPMENT,
        isLoading: placementQuery.isLoading,
      };
    }

    const quantityByAddress = new Map<string, number>(
      inventory ? getInventoryItems(inventory).map((i) => [i.address, i.quantity]) : [],
    );
    const definitionsByAddress =
      catalog?.byAddress ?? new Map<string, ResolvedBlobbiItemDefinition>();

    const context: PlacementPolicyContext = {
      authorPubkey: state.placement.author,
      // Island writes a character's equipment document under the owner's own
      // pubkey, so the document's author IS the claimed owner. The policy check
      // is still applied rather than assumed, because a placement fetched from
      // a relay can claim anything.
      ownerPubkey: options.ownerPubkey ?? state.placement.author,
      form,
      quantityByAddress,
      definitionsByAddress,
    };

    // ONE document, TWO vocabularies. Official effect items are resolved by
    // the pure effect resolver; everything else stays on the wearable policy
    // path. Partitioned by full item address so a third-party copy of an
    // official effect `d` remains a wearable-path concern (refused there as
    // `untrusted-issuer`) and never enters the effect resolver at all.
    const effectEntries = state.placement.placements.filter(isEffectItemPlacement);
    const wearableEntries = state.placement.placements.filter(
      (entry) => !isEffectItemPlacement(entry),
    );

    const renderable = selectRenderablePlacements(wearableEntries, context);
    const renderableEntryIds = new Set(renderable.map((r) => r.entry));

    const accessories: AccessoryPlacementInput[] = [];
    const hidden: HiddenPlacement[] = [];

    for (const { entry, slot } of renderable) {
      const result = toAccessoryPlacementInput(
        entry,
        slot,
        state.placement.reference,
      );
      if (result.ok) {
        accessories.push(result.input);
      } else {
        hidden.push({ entry, reason: result.reason });
      }
    }

    // Everything policy refused, with its reason — including entries that lost
    // a slot conflict, which `selectRenderablePlacements` resolves last-wins.
    for (const entry of wearableEntries) {
      if (renderableEntryIds.has(entry)) continue;
      const decision = decidePlacementEntry(entry, context);
      hidden.push({
        entry,
        reason: decision.reason ?? 'slot-mismatch',
      });
    }

    // The AUTHOR gate is applied here, before the pure resolver, because the
    // resolver deliberately knows nothing about signatures: a document not
    // signed by the Blobbi's owner activates no effects, same as it draws no
    // accessories.
    const authorMayModify = mayModifyCharacter(
      context.authorPubkey,
      context.ownerPubkey,
    );
    const effectResolution =
      authorMayModify && effectEntries.length > 0
        ? resolveActiveBlobbiEffects({
            placements: effectEntries,
            quantityByAddress,
            stage: form,
          })
        : null;

    return {
      accessories,
      effects: effectResolution?.effects ?? NO_EFFECTS,
      activeEffects: effectResolution?.active ?? NO_ACTIVE_EFFECTS,
      rejectedEffects: effectResolution?.rejected ?? NO_REJECTED_EFFECTS,
      definitionsByAddress,
      hidden,
      warnings: state.warnings,
      isLoading:
        placementQuery.isLoading ||
        inventoryQuery.isLoading ||
        catalogQuery.isLoading,
      isEmpty: state.isEmpty,
    };
  }, [
    state,
    inventory,
    catalog,
    form,
    options.ownerPubkey,
    placementQuery.isLoading,
    inventoryQuery.isLoading,
    catalogQuery.isLoading,
  ]);
}
