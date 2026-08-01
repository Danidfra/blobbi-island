/**
 * Blobbi Island — the visual effects a player may actually manage right now.
 *
 * The effect-management UI's catalog, built by INTERSECTION exactly like
 * `useEquippableCosmetics` builds the wearable one:
 *
 *   trusted official effect registry (full address)   (who may define it)
 * ∩ kind:31633 quantity > 0                           (do they own it)
 * ∩ registered forms include the current stage        (does it fit this Blobbi)
 *
 * The catalog definition (kind:31632) is joined for DISPLAY — name, artwork,
 * rarity, description — and deliberately not for eligibility: activation trust
 * lives in the registry, so a relay outage costs description text, never a
 * wrongly-active or wrongly-blocked effect.
 *
 * Items that fail a gate are returned in `unavailable` with the reason, so the
 * UI can explain "you own this but an egg cannot use it" instead of showing an
 * unexplained gap. Items the player does not own are reported too (the
 * catalog/locked view), but the UI must never present them as actionable.
 */

import { useMemo } from 'react';

import { useIslandInventory } from '@/inventory/useIslandInventory';
import { useItemCatalog } from '@/inventory/useItemCatalog';
import { getInventoryItems } from '@/inventory/package';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';

import {
  ADDRESSED_VISUAL_EFFECT_ITEMS,
  type AddressedVisualEffectItem,
} from './official-visual-effect-items';

/** Why an official effect item cannot be equipped right now. */
export type EffectUnavailableReason = 'not-owned' | 'incompatible-form';

export interface OwnedVisualEffect {
  address: string;
  registration: AddressedVisualEffectItem;
  /**
   * The catalog view of the item — fetched definition when available, bundled
   * fallback otherwise. Display only; never an activation input.
   */
  definition: ResolvedBlobbiItemDefinition | undefined;
  quantity: number;
}

export interface UnavailableVisualEffect extends OwnedVisualEffect {
  reason: EffectUnavailableReason;
}

export interface OwnedVisualEffects {
  /** Effects the player owns and may activate on this Blobbi, right now. */
  available: OwnedVisualEffect[];
  /** Official effects that exist but cannot be activated, with the reason. */
  unavailable: UnavailableVisualEffect[];
  /** `true` when the player owns none of the official effect items. */
  ownsNothing: boolean;
  isLoading: boolean;
}

/**
 * Resolve the manageable visual effects for a Blobbi of the given stage.
 *
 * An unknown stage is treated as no restriction, mirroring the wearable rule:
 * nothing should flicker to "unavailable" while the Blobbi list loads.
 */
export function useOwnedVisualEffects(stage?: string): OwnedVisualEffects {
  const inventoryQuery = useIslandInventory();
  const catalogQuery = useItemCatalog();

  const inventory = inventoryQuery.data;
  const catalog = catalogQuery.data;

  return useMemo((): OwnedVisualEffects => {
    const quantityByAddress = new Map<string, number>(
      inventory
        ? getInventoryItems(inventory).map((i) => [i.address, i.quantity])
        : [],
    );

    const available: OwnedVisualEffect[] = [];
    const unavailable: UnavailableVisualEffect[] = [];

    for (const registration of ADDRESSED_VISUAL_EFFECT_ITEMS) {
      const address = registration.address;
      const quantity = quantityByAddress.get(address) ?? 0;
      const definition = catalog?.byAddress.get(address);
      const base: OwnedVisualEffect = {
        address,
        registration,
        definition,
        quantity,
      };

      // Ownership first: an unowned item belongs in the locked/catalog view
      // whatever the Blobbi's form, and reporting a form problem on something
      // the player cannot use anyway would bury the actionable fact.
      if (quantity <= 0) {
        unavailable.push({ ...base, reason: 'not-owned' });
        continue;
      }

      const compatible =
        stage === undefined ||
        stage === '' ||
        registration.forms.includes(
          stage as (typeof registration.forms)[number],
        );
      if (!compatible) {
        unavailable.push({ ...base, reason: 'incompatible-form' });
        continue;
      }

      available.push(base);
    }

    return {
      available,
      unavailable,
      ownsNothing: available.length === 0 &&
        unavailable.every((u) => u.reason === 'not-owned'),
      isLoading: inventoryQuery.isLoading || catalogQuery.isLoading,
    };
  }, [inventory, catalog, stage, inventoryQuery.isLoading, catalogQuery.isLoading]);
}

/** Human-readable explanation for an unavailable effect. */
export function explainEffectUnavailable(
  reason: EffectUnavailableReason,
): string {
  switch (reason) {
    case 'not-owned':
      return 'You do not own this yet.';
    case 'incompatible-form':
      return 'It does not support this Blobbi’s current form.';
    default: {
      const exhaustive: never = reason;
      return String(exhaustive);
    }
  }
}
