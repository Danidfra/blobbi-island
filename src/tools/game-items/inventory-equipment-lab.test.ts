/**
 * The Inventory & Equipment Lab's pure half: registry projection, bulk
 * planning and the documented test loadout; no signer, no relay, no React.
 */
import { describe, it, expect } from 'vitest';

import {
  LAB_OFFICIAL_ITEMS,
  LAB_WEARABLE_ADDRESSES,
  LAB_EFFECT_ADDRESSES,
  LAB_TEST_LOADOUT,
  labItemByAddress,
  planBulkInventoryAction,
  planMissingLoadoutItems,
  planTestLoadout,
} from './inventory-equipment-lab';
import {
  ADDRESSED_OFFICIAL_COSMETICS,
  ADDRESSED_OFFICIAL_EFFECT_ITEMS,
  officialItemAddress,
} from '@/protocol/event-registry';
import type { GameItemPlacementEntry } from '@/inventory/package';

const CAP = officialItemAddress('blobbi:cosmetic:block-builder-cap');
const AURA = officialItemAddress('blobbi:effect:celestial-aura');
const SPARKLES = officialItemAddress('blobbi:effect:golden-sparkles');

function equip(address: string, slot: string): GameItemPlacementEntry {
  return { id: slot, item: address, mode: 'equip', slot };
}

describe('the official item list derives from the Phase-9 registries', () => {
  it('is exactly the sixteen published items: four wearables, twelve effects', () => {
    expect(LAB_OFFICIAL_ITEMS).toHaveLength(16);
    expect(LAB_WEARABLE_ADDRESSES).toHaveLength(4);
    expect(LAB_EFFECT_ADDRESSES).toHaveLength(12);
    // No manual copy: every entry matches a canonical registry record exactly.
    for (const item of LAB_OFFICIAL_ITEMS) {
      const canonical =
        item.kind === 'wearable'
          ? ADDRESSED_OFFICIAL_COSMETICS.find((c) => c.address === item.address)
          : ADDRESSED_OFFICIAL_EFFECT_ITEMS.find((e) => e.address === item.address);
      expect(canonical, item.d).toBeDefined();
      expect(item.name).toBe(canonical!.name);
      expect(item.d).toBe(canonical!.d);
    }
  });

  it('effects carry their registered slot and effect id; wearables defer to the definition', () => {
    for (const item of LAB_OFFICIAL_ITEMS) {
      if (item.kind === 'effect') {
        expect(item.expectedSlot, item.d).not.toBeNull();
        expect(item.effectId, item.d).not.toBeNull();
      } else {
        expect(item.expectedSlot, item.d).toBeNull();
        expect(item.effectId, item.d).toBeNull();
      }
    }
  });

  it('looks up by exact full address only', () => {
    expect(labItemByAddress(CAP)?.name).toBe('Block Builder Cap');
    expect(labItemByAddress('blobbi:cosmetic:block-builder-cap')).toBeNull();
    expect(labItemByAddress(`31632:${'f'.repeat(64)}:blobbi:cosmetic:block-builder-cap`)).toBeNull();
  });
});

describe('max stack is item policy, not a UI constant', () => {
  it('all sixteen official lab items resolve an effective max stack of one', () => {
    expect(LAB_OFFICIAL_ITEMS).toHaveLength(16);
    for (const item of LAB_OFFICIAL_ITEMS) {
      expect(item.maxStack, item.d).toBe(1);
    }
  });
});

describe('bulk inventory planning respects max_stack', () => {
  it('add-all-effects ENSURES ownership: 0 → 1, owned omitted, over-max reported not incremented', () => {
    const plan = planBulkInventoryAction(
      'add-all-effects',
      new Map([
        [AURA, 2], // already invalid, must not become 3, must not silently become 1
        [SPARKLES, 1], // owned, omitted from the diff
      ]),
    );
    // Ten effects go 0 → 1; the owned and the anomalous ones plan nothing.
    expect(plan.changes).toHaveLength(10);
    expect(plan.changes.every((c) => c.from === 0 && c.to === 1)).toBe(true);
    expect(plan.changes.find((c) => c.address === AURA)).toBeUndefined();
    expect(plan.changes.find((c) => c.address === SPARKLES)).toBeUndefined();
    // The invalid quantity is surfaced as an anomaly for the explicit repair.
    expect(plan.anomalies).toEqual([
      { address: AURA, name: 'Celestial Aura', quantity: 2, maxStack: 1 },
    ]);
    // Ready for ONE canonical set-many write, targeting only official items.
    for (const target of plan.targets) {
      expect(labItemByAddress(target.address)).not.toBeNull();
    }
  });

  it('remove-all-wearables zeroes only held wearables and never lists a no-op', () => {
    const plan = planBulkInventoryAction(
      'remove-all-wearables',
      new Map([
        [CAP, 3],
        [AURA, 1], // an effect; not this action's business
        ['31632:beef:third-party:item', 9], // never targeted
      ]),
    );
    expect(plan.changes).toEqual([
      { address: CAP, name: 'Block Builder Cap', from: 3, to: 0 },
    ]);
    expect(plan.targets).toEqual([{ address: CAP, quantity: 0 }]);
  });

  it('remove-all-official with an empty inventory plans nothing', () => {
    const plan = planBulkInventoryAction('remove-all-official', new Map());
    expect(plan.changes).toEqual([]);
    expect(plan.targets).toEqual([]);
    expect(plan.anomalies).toEqual([]);
  });

  it('add-all-official targets all sixteen from empty, each at exactly one', () => {
    const plan = planBulkInventoryAction('add-all-official', new Map());
    expect(plan.targets).toHaveLength(16);
    expect(plan.targets.every((t) => t.quantity === 1)).toBe(true);
  });

  it('normalize-stacks repairs over-max quantities to the max, and nothing else', () => {
    const plan = planBulkInventoryAction(
      'normalize-stacks',
      new Map([
        [AURA, 3],
        [CAP, 1], // valid, untouched
        [SPARKLES, 0], // unowned, normalization never grants
        ['31632:beef:third-party:item', 9], // never targeted
      ]),
    );
    expect(plan.changes).toEqual([
      { address: AURA, name: 'Celestial Aura', from: 3, to: 1 },
    ]);
    expect(plan.targets).toEqual([{ address: AURA, quantity: 1 }]);
  });
});

describe('the documented test loadout', () => {
  it('is the seven documented slot assignments', () => {
    expect(LAB_TEST_LOADOUT.map((s) => `${s.slot}=${s.d}`)).toEqual([
      'headwear=blobbi:cosmetic:block-builder-cap',
      'eyewear=blobbi:cosmetic:stargazer-glasses',
      'neckwear=blobbi:cosmetic:starlight-bow-tie',
      'aura=blobbi:effect:celestial-aura',
      'ambient-particles=blobbi:effect:golden-sparkles',
      'ground-local=blobbi:effect:mystic-fog',
      'body-overlay=blobbi:effect:pixel-glitch',
    ]);
  });

  it('plans replacements and missing items honestly', () => {
    const owned = new Map<string, number>([
      [CAP, 1],
      [AURA, 1],
      // Sparkles equipped but NOT owned; everything else unowned.
    ]);
    const current = new Map<string, GameItemPlacementEntry>([
      ['aura', equip(officialItemAddress('blobbi:effect:solar-radiance'), 'aura')],
      ['ambient-particles', equip(SPARKLES, 'ambient-particles')],
    ]);

    const plan = planTestLoadout(current, owned);
    expect(plan.steps).toHaveLength(7);

    const auraStep = plan.steps.find((s) => s.slot === 'aura')!;
    expect(auraStep.replaces).toBe('Solar Radiance');
    expect(auraStep.alreadyEquipped).toBe(false);

    const sparklesStep = plan.steps.find((s) => s.slot === 'ambient-particles')!;
    expect(sparklesStep.alreadyEquipped).toBe(true);

    // Missing = the five loadout items with no inventory quantity (sparkles is
    // equipped but unowned, so it IS missing).
    expect(plan.missing.map((m) => m.d).sort()).toEqual([
      'blobbi:cosmetic:stargazer-glasses',
      'blobbi:cosmetic:starlight-bow-tie',
      'blobbi:effect:golden-sparkles',
      'blobbi:effect:mystic-fog',
      'blobbi:effect:pixel-glitch',
    ]);

    // Equips exclude the already-satisfied slot; addressing the missing items
    // is a SEPARATE inventory plan that grants quantity 1 each.
    expect(plan.equips).toHaveLength(6);
    expect(plan.isNoop).toBe(false);
    expect(planMissingLoadoutItems(plan)).toEqual(
      plan.missing.map((m) => ({ address: m.address, quantity: 1 })),
    );
  });

  it('recognises a fully applied loadout as a no-op', () => {
    const owned = new Map(
      LAB_TEST_LOADOUT.map((s) => [officialItemAddress(s.d), 1]),
    );
    const current = new Map(
      LAB_TEST_LOADOUT.map((s) => [s.slot, equip(officialItemAddress(s.d), s.slot)]),
    );
    const plan = planTestLoadout(current, owned);
    expect(plan.isNoop).toBe(true);
    expect(plan.equips).toEqual([]);
    expect(plan.missing).toEqual([]);
  });
});
