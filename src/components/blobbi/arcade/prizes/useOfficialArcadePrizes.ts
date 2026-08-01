/**
 * Resolve the official Arcade Prize catalog for display.
 *
 * The catalog itself (`official-prize-catalog.ts`) is stable identity + price
 * only. Everything a shelf card SHOWS is joined here, in resolution order:
 *
 *   name / artwork / rarity / description → the kind:31632 catalog
 *     (fetched definition first, bundled registry fallback second — the same
 *      `useItemCatalog` map every other item surface reads);
 *   slot                                  → the effect registry for effects,
 *                                           the published `visual.slot` for
 *                                           wearables;
 *   owned / quantity                      → the player's kind:31633 inventory;
 *   equipped                              → the shared equipment context
 *                                           (kind:31634, policy-filtered);
 *   ticket balance                        → the Arcade Ticket entry of the
 *                                           same inventory.
 *
 * READ-ONLY BY CONSTRUCTION. This hook consumes queries and context that
 * already exist app-wide; it adds no subscription, and it imports no mutation
 * of any kind — the reward-flow boundary test pins that for the whole Prize
 * Counter import graph.
 */

import { useMemo } from 'react';

import type { BlobbiVisualEffectId } from '@blobbi/react';
import {
  OFFICIAL_ARCADE_PRIZE_CATALOG,
  orderedOfficialArcadePrizes,
  type OfficialArcadePrize,
} from '@/arcade/prizes/official-prize-catalog';
import { useIslandInventory } from '@/inventory/useIslandInventory';
import { useItemCatalog } from '@/inventory/useItemCatalog';
import { getInventoryItemQuantity } from '@/inventory/package';
import { primaryItemImageUrl } from '@/inventory/item-image-resolution';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';
import {
  ARCADE_TICKET_D,
  officialCosmeticByAddress,
  officialEffectItemByAddress,
  officialItemAddress,
} from '@/protocol/event-registry';
import { resolveOfficialVisualEffectItem } from '@/effects/official-visual-effect-items';
import { useCharacterEquipmentContext } from '@/hooks/useCharacterEquipmentContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

/** One prize, fully resolved for display. Plain data — no callbacks. */
export interface ResolvedArcadePrize {
  readonly prize: OfficialArcadePrize;
  /** Display name: published definition first, registry fallback second. */
  readonly name: string;
  /** Primary artwork URL, when either source knows one. */
  readonly image: string | undefined;
  /** Emoji fallback, always present. */
  readonly emoji: string;
  /** Published rarity, or `undefined` when the definition is unresolved. */
  readonly rarity: string | undefined;
  /** Published description, when the fetched definition carries one. */
  readonly description: string | undefined;
  /** Where it goes: the wearable `visual.slot` or the effect slot. */
  readonly slot: string | null;
  /** The local effect an effect prize activates; `null` for accessories. */
  readonly effectId: BlobbiVisualEffectId | null;
  /** The catalog view of the item, for the preview's source resolution. */
  readonly definition: ResolvedBlobbiItemDefinition | undefined;
  readonly ownedQuantity: number;
  readonly owned: boolean;
  /** Currently worn/active on the companion (kind:31634, policy-filtered). */
  readonly equipped: boolean;
  /**
   * Ticket affordability: `null` while the balance is unknown — "we could not
   * check" must never be presented as "you cannot afford it".
   */
  readonly affordable: boolean | null;
}

export interface OfficialArcadePrizes {
  readonly prizes: readonly ResolvedArcadePrize[];
  /** Arcade Ticket balance, or `null` while unknown. */
  readonly balance: number | null;
  readonly balanceError: boolean;
  readonly isLoggedIn: boolean;
  readonly isLoading: boolean;
}

export function useOfficialArcadePrizes(
  catalog: readonly OfficialArcadePrize[] = OFFICIAL_ARCADE_PRIZE_CATALOG,
): OfficialArcadePrizes {
  const { user } = useCurrentUser();
  const inventoryQuery = useIslandInventory();
  const catalogQuery = useItemCatalog();
  const { accessories, activeEffects } = useCharacterEquipmentContext();

  const inventory = inventoryQuery.data;
  const itemCatalog = catalogQuery.data;

  return useMemo((): OfficialArcadePrizes => {
    const wornAddresses = new Set(accessories.map((a) => a.code));
    const activeEffectAddresses = new Set(
      activeEffects.map((a) => a.registration.address),
    );

    const prizes = orderedOfficialArcadePrizes(catalog).map(
      (prize): ResolvedArcadePrize => {
        const definition = itemCatalog?.byAddress.get(prize.itemAddress);
        // Two registry views of the same effect item: the TYPED one — the same
        // full-address trust gate the activation path uses — for
        // `effectId`/`effectSlot` as renderer types, and the canonical one for
        // display fallbacks (primary image lives only there).
        const effectRegistration = resolveOfficialVisualEffectItem(prize.itemAddress);
        const effectEntry = officialEffectItemByAddress(prize.itemAddress);
        const cosmetic = officialCosmeticByAddress(prize.itemAddress);

        const name =
          definition?.name ?? effectEntry?.name ?? cosmetic?.name ?? prize.d;
        const image =
          (definition ? primaryItemImageUrl(definition) : undefined) ??
          effectEntry?.primaryImage ??
          cosmetic?.primaryImage ??
          undefined;
        const emoji =
          definition?.emoji ?? effectEntry?.symbol ?? cosmetic?.symbol ?? '🎁';
        const rarity = definition?.rarity ?? effectEntry?.rarity;
        const slot =
          prize.kind === 'effect'
            ? (effectRegistration?.effectSlot ?? null)
            : (definition?.slot ?? null);

        const ownedQuantity = inventory
          ? getInventoryItemQuantity(inventory, prize.itemAddress)
          : 0;
        const equipped =
          prize.kind === 'effect'
            ? activeEffectAddresses.has(prize.itemAddress)
            : wornAddresses.has(prize.itemAddress);

        const balance = inventory
          ? getInventoryItemQuantity(inventory, TICKET_ADDRESS)
          : null;

        return {
          prize,
          name,
          image,
          emoji,
          rarity,
          description: definition?.description,
          slot,
          effectId: effectRegistration?.effectId ?? null,
          definition,
          ownedQuantity,
          owned: ownedQuantity > 0,
          equipped,
          affordable: balance === null ? null : balance >= prize.tickets,
        };
      },
    );

    return {
      prizes,
      balance: inventory
        ? getInventoryItemQuantity(inventory, TICKET_ADDRESS)
        : null,
      balanceError: inventoryQuery.isError,
      isLoggedIn: Boolean(user?.pubkey),
      isLoading: inventoryQuery.isLoading || catalogQuery.isLoading,
    };
  }, [
    catalog,
    inventory,
    itemCatalog,
    accessories,
    activeEffects,
    user?.pubkey,
    inventoryQuery.isError,
    inventoryQuery.isLoading,
    catalogQuery.isLoading,
  ]);
}
