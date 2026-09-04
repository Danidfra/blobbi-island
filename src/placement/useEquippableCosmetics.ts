/**
 * Blobbi Island: the cosmetics a player may actually equip right now.
 *
 * This is the production catalog for the equipment UI, and it is built by
 * INTERSECTION rather than by listing:
 *
 *   trusted official kind:31632 cosmetic definitions   (who may define it)
 * ∩ kind:31633 quantity > 0                            (do they own it)
 * ∩ a supported `content.visual.slot`                  (where does it go)
 * ∩ a usable `content.visual.forms`                    (does it fit this Blobbi)
 *
 * There is deliberately NO hardcoded accessory list behind this. If no official
 * cosmetic definition has been published, the list is empty and the UI says so
 * honestly: it does not fall back to a bundled catalogue of legacy accessories
 * that nobody can prove ownership of.
 *
 * Items that fail a gate are not silently dropped: they are returned in
 * `unavailable` with a reason, so the UI can explain "you own this but it does
 * not fit a baby" instead of showing an unexplained gap.
 */

import { useMemo } from 'react';

import { useIslandInventory } from '@/inventory/useIslandInventory';
import { useItemCatalog } from '@/inventory/useItemCatalog';
import { getInventoryItems } from '@/inventory/package';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';
import { ADDRESSED_OFFICIAL_COSMETICS } from '@/protocol/event-registry';
import type { AccessorySlot } from '@blobbi/react';

import { definitionSlot, formCompatibility } from './policy';

/** Why an owned or official cosmetic cannot be equipped right now. */
export type CosmeticUnavailableReason =
  | 'not-owned'
  | 'definition-unresolved'
  | 'no-supported-slot'
  | 'malformed-slot'
  | 'malformed-forms'
  | 'incompatible-form';

export interface EquippableCosmetic {
  address: string;
  definition: ResolvedBlobbiItemDefinition;
  slot: AccessorySlot;
  quantity: number;
}

export interface UnavailableCosmetic {
  address: string;
  /** `undefined` when the definition itself could not be resolved. */
  definition: ResolvedBlobbiItemDefinition | undefined;
  reason: CosmeticUnavailableReason;
  quantity: number;
}

export interface EquippableCosmetics {
  /** Cosmetics the player owns and may equip on this Blobbi, right now. */
  available: EquippableCosmetic[];
  /** Official cosmetics that exist but cannot be equipped, with the reason. */
  unavailable: UnavailableCosmetic[];
  /**
   * `true` when the trusted issuer has published no cosmetic definitions at
   * all. Distinct from "you own none": one is an empty catalog, the other is an
   * empty inventory, and the UI must not conflate them.
   */
  catalogIsEmpty: boolean;
  /** `true` when the catalog is non-empty but the player owns none of it. */
  ownsNothing: boolean;
  isLoading: boolean;
}

/**
 * Resolve the equippable cosmetics for a Blobbi of the given form.
 *
 * `form` gates form-restricted cosmetics. An unknown form is treated as no
 * restriction so nothing disappears while the Blobbi list loads.
 */
export function useEquippableCosmetics(form?: string): EquippableCosmetics {
  const inventoryQuery = useIslandInventory();
  const catalogQuery = useItemCatalog();

  const inventory = inventoryQuery.data;
  const catalog = catalogQuery.data;

  return useMemo((): EquippableCosmetics => {
    const quantityByAddress = new Map<string, number>(
      inventory
        ? getInventoryItems(inventory).map((i) => [i.address, i.quantity])
        : [],
    );

    const available: EquippableCosmetic[] = [];
    const unavailable: UnavailableCosmetic[] = [];

    // The trusted set is the registry's official cosmetics, an address, not a
    // `d`. Anyone may publish `blobbi:cosmetic:<anything>`; only the official
    // issuer's address counts.
    for (const official of ADDRESSED_OFFICIAL_COSMETICS) {
      const address = official.address;
      const definition = catalog?.byAddress.get(address);
      const quantity = quantityByAddress.get(address) ?? 0;

      if (!definition || definition.source !== 'definition') {
        // A bundled fallback is not a published definition: it carries no slot
        // and no images beyond a single primary, so it cannot be equipped.
        unavailable.push({
          address,
          definition,
          reason: 'definition-unresolved',
          quantity,
        });
        continue;
      }

      const slotState = definition.visualDiagnostics.slot;
      const slot = definitionSlot(definition);
      if (slot === null) {
        unavailable.push({
          address,
          definition,
          reason:
            slotState === 'malformed' ? 'malformed-slot' : 'no-supported-slot',
          quantity,
        });
        continue;
      }

      const forms = formCompatibility(definition, form);
      if (forms === 'malformed') {
        unavailable.push({
          address,
          definition,
          reason: 'malformed-forms',
          quantity,
        });
        continue;
      }
      if (forms === 'incompatible') {
        unavailable.push({
          address,
          definition,
          reason: 'incompatible-form',
          quantity,
        });
        continue;
      }

      // Ownership last, so an item you do not own still reports the more
      // specific problem when it has one.
      if (quantity <= 0) {
        unavailable.push({ address, definition, reason: 'not-owned', quantity });
        continue;
      }

      available.push({ address, definition, slot, quantity });
    }

    return {
      available,
      unavailable,
      catalogIsEmpty: ADDRESSED_OFFICIAL_COSMETICS.length === 0,
      ownsNothing:
        ADDRESSED_OFFICIAL_COSMETICS.length > 0 && available.length === 0,
      isLoading: inventoryQuery.isLoading || catalogQuery.isLoading,
    };
  }, [inventory, catalog, form, inventoryQuery.isLoading, catalogQuery.isLoading]);
}

/** Human-readable explanation for an unavailable cosmetic. */
export function explainUnavailable(reason: CosmeticUnavailableReason): string {
  switch (reason) {
    case 'not-owned':
      return 'You do not own this yet.';
    case 'definition-unresolved':
      return 'Its official definition has not been published or could not be fetched.';
    case 'no-supported-slot':
      return 'Its definition does not say where it is worn.';
    case 'malformed-slot':
      return 'Its definition declares a slot this client does not support.';
    case 'malformed-forms':
      return 'Its definition declares an unusable list of Blobbi forms.';
    case 'incompatible-form':
      return 'It does not fit this Blobbi’s current form.';
    default: {
      const exhaustive: never = reason;
      return String(exhaustive);
    }
  }
}
