/**
 * Inventory & Equipment Lab — the PURE half.
 *
 * Everything the lab decides is computed here from plain inputs, so every
 * bulk plan, loadout diff and row status is unit-testable without a signer, a
 * relay or a component. The UI (`InventoryEquipmentLab.tsx`) renders these
 * values and hands the resulting mutations to the SAME two writers production
 * uses (`useInventoryMutation`, `useEquipmentMutation`) — this module never
 * invents a third.
 *
 * ## The three roles, kept apart
 *
 * kind:31632 author → the official Blobbi item ISSUER;
 * kind:31633 author → the PLAYER who owns items;
 * kind:31634 author → the PLAYER equipping them.
 *
 * The lab operates as the player. The issuer appears here only as the pubkey
 * every official address is derived from — the lab can never write anything
 * in the issuer's name, and the item list below is a projection of the
 * Phase-9 registries, never a hand-maintained copy.
 */

import type { BlobbiEffectSlot, BlobbiVisualEffectId } from '@blobbi/react';
import {
  ADDRESSED_OFFICIAL_COSMETICS,
  ADDRESSED_OFFICIAL_EFFECT_ITEMS,
} from '@/protocol/event-registry';
import type { InventorySetTarget } from '@/inventory/useInventoryMutation';
import type { GameItemPlacementEntry } from '@/inventory/package';
import { ADDRESSED_VISUAL_EFFECT_ITEMS } from '@/effects/official-visual-effect-items';

// ── The official test-item list, projected from the registries ─────────────

export interface LabOfficialItem {
  readonly address: string;
  readonly d: string;
  readonly kind: 'wearable' | 'effect';
  /** Display fallbacks; a fetched definition always outranks them. */
  readonly name: string;
  readonly symbol: string;
  readonly image: string | null;
  readonly rarity: string | undefined;
  /**
   * The only slot this item may be equipped into, when the lab can know it
   * without a fetched definition: effects register theirs; a wearable's slot
   * lives in its PUBLISHED `visual.slot` and is `null` here until resolved.
   */
  readonly expectedSlot: BlobbiEffectSlot | null;
  readonly effectId: BlobbiVisualEffectId | null;
}

const WEARABLE_ITEMS: readonly LabOfficialItem[] =
  ADDRESSED_OFFICIAL_COSMETICS.map((entry) => ({
    address: entry.address,
    d: entry.d,
    kind: 'wearable' as const,
    name: entry.name,
    symbol: entry.symbol,
    image: entry.primaryImage,
    rarity: undefined,
    expectedSlot: null,
    effectId: null,
  }));

const EFFECT_ITEMS: readonly LabOfficialItem[] =
  ADDRESSED_VISUAL_EFFECT_ITEMS.map((item) => {
    const canonical = ADDRESSED_OFFICIAL_EFFECT_ITEMS.find(
      (e) => e.address === item.address,
    );
    return {
      address: item.address,
      d: item.d,
      kind: 'effect' as const,
      name: item.name,
      symbol: item.symbol,
      image: canonical?.primaryImage ?? null,
      rarity: item.rarity,
      expectedSlot: item.effectSlot,
      effectId: item.effectId,
    };
  });

/** The sixteen published official items: four wearables, twelve effects. */
export const LAB_OFFICIAL_ITEMS: readonly LabOfficialItem[] = [
  ...WEARABLE_ITEMS,
  ...EFFECT_ITEMS,
];

export const LAB_WEARABLE_ADDRESSES: readonly string[] = WEARABLE_ITEMS.map(
  (i) => i.address,
);
export const LAB_EFFECT_ADDRESSES: readonly string[] = EFFECT_ITEMS.map(
  (i) => i.address,
);

export function labItemByAddress(address: string): LabOfficialItem | null {
  return LAB_OFFICIAL_ITEMS.find((i) => i.address === address) ?? null;
}

// ── Bulk inventory planning ────────────────────────────────────────────────

export type LabBulkInventoryAction =
  | 'add-all-wearables'
  | 'remove-all-wearables'
  | 'add-all-effects'
  | 'remove-all-effects'
  | 'add-all-official'
  | 'remove-all-official';

/** One row of a bulk-plan diff: what a quantity would become, and why. */
export interface LabInventoryChange {
  readonly address: string;
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

export interface LabInventoryPlan {
  readonly action: LabBulkInventoryAction;
  /** Only the quantities that actually change. Empty means nothing to do. */
  readonly changes: readonly LabInventoryChange[];
  /** Ready for ONE canonical `set-many` publish. */
  readonly targets: readonly InventorySetTarget[];
}

function addressesFor(action: LabBulkInventoryAction): readonly string[] {
  switch (action) {
    case 'add-all-wearables':
    case 'remove-all-wearables':
      return LAB_WEARABLE_ADDRESSES;
    case 'add-all-effects':
    case 'remove-all-effects':
      return LAB_EFFECT_ADDRESSES;
    case 'add-all-official':
    case 'remove-all-official':
      return LAB_OFFICIAL_ITEMS.map((i) => i.address);
    default: {
      const exhaustive: never = action;
      throw new Error(String(exhaustive));
    }
  }
}

/**
 * Plan a bulk inventory action against the CURRENT quantities.
 *
 * `add-*` adds one unit to each targeted item; `remove-*` sets each targeted
 * item to zero. Only OFFICIAL REGISTERED addresses are ever targeted — a
 * third-party entry in the same inventory is structurally out of reach, and
 * the resulting `set-many` touches nothing outside `targets`.
 */
export function planBulkInventoryAction(
  action: LabBulkInventoryAction,
  currentQuantities: ReadonlyMap<string, number>,
): LabInventoryPlan {
  const adds = action.startsWith('add-');
  const changes: LabInventoryChange[] = [];
  for (const address of addressesFor(action)) {
    const from = currentQuantities.get(address) ?? 0;
    const to = adds ? from + 1 : 0;
    if (to === from) continue;
    changes.push({
      address,
      name: labItemByAddress(address)?.name ?? address,
      from,
      to,
    });
  }
  return {
    action,
    changes,
    targets: changes.map((c) => ({ address: c.address, quantity: c.to })),
  };
}

// ── The documented test loadout ────────────────────────────────────────────

/** slot → the official item the documented full test loadout equips there. */
export const LAB_TEST_LOADOUT: readonly {
  readonly slot: string;
  readonly d: string;
}[] = [
  { slot: 'headwear', d: 'blobbi:cosmetic:block-builder-cap' },
  { slot: 'eyewear', d: 'blobbi:cosmetic:stargazer-glasses' },
  { slot: 'neckwear', d: 'blobbi:cosmetic:starlight-bow-tie' },
  { slot: 'aura', d: 'blobbi:effect:celestial-aura' },
  { slot: 'ambient-particles', d: 'blobbi:effect:golden-sparkles' },
  { slot: 'ground-local', d: 'blobbi:effect:mystic-fog' },
  { slot: 'body-overlay', d: 'blobbi:effect:pixel-glitch' },
];

export interface LabLoadoutStep {
  readonly slot: string;
  readonly address: string;
  readonly name: string;
  /** What currently occupies the slot and would be replaced, if anything. */
  readonly replaces: string | null;
  /** Already equipped exactly like this — the step publishes no change. */
  readonly alreadyEquipped: boolean;
}

export interface LabLoadoutPlan {
  readonly steps: readonly LabLoadoutStep[];
  /** Items the loadout needs that the inventory does NOT hold. */
  readonly missing: readonly LabOfficialItem[];
  /** The equips to fold into ONE canonical kind:31634 publish. */
  readonly equips: readonly { slot: string; entry: GameItemPlacementEntry }[];
  /** Every step already satisfied — applying would publish nothing. */
  readonly isNoop: boolean;
}

/**
 * Plan the documented full test loadout against the current placement
 * document and inventory.
 *
 * The plan NEVER mixes concerns: `missing` is what a SEPARATE, explicitly
 * confirmed inventory action must add first; `equips` touch kind:31634 only
 * and never modify a quantity.
 */
export function planTestLoadout(
  currentBySlot: ReadonlyMap<string, GameItemPlacementEntry>,
  currentQuantities: ReadonlyMap<string, number>,
): LabLoadoutPlan {
  const steps: LabLoadoutStep[] = [];
  const missing: LabOfficialItem[] = [];
  const equips: { slot: string; entry: GameItemPlacementEntry }[] = [];

  for (const { slot, d } of LAB_TEST_LOADOUT) {
    const item = LAB_OFFICIAL_ITEMS.find((i) => i.d === d);
    if (!item) continue; // unreachable while the loadout names registry items
    const occupant = currentBySlot.get(slot);
    const alreadyEquipped = occupant?.item === item.address;
    steps.push({
      slot,
      address: item.address,
      name: item.name,
      replaces:
        occupant !== undefined && !alreadyEquipped
          ? (labItemByAddress(occupant.item)?.name ?? occupant.item)
          : null,
      alreadyEquipped,
    });
    if ((currentQuantities.get(item.address) ?? 0) <= 0) {
      missing.push(item);
    }
    if (!alreadyEquipped) {
      equips.push({
        slot,
        entry: { id: slot, item: item.address, mode: 'equip', slot },
      });
    }
  }

  return { steps, missing, equips, isNoop: equips.length === 0 };
}

/** The `set-many` targets that make every missing loadout item owned (qty 1). */
export function planMissingLoadoutItems(
  plan: LabLoadoutPlan,
): readonly InventorySetTarget[] {
  return plan.missing.map((item) => ({ address: item.address, quantity: 1 }));
}
