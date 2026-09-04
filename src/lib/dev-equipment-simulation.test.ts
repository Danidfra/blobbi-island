/**
 * The dev-equipment simulation reducer, pure, deterministic, max-stack-safe.
 *
 * The item universe and identity rules are the canonical Lab projection, so
 * coverage tests here double as "no second hand-maintained list" proof.
 */
import { describe, it, expect } from 'vitest';

import {
  INITIAL_DEV_SIM_STATE,
  devSimReducer,
  type DevSimState,
} from './dev-equipment-simulation';
import {
  LAB_OFFICIAL_ITEMS,
  LAB_TEST_LOADOUT,
} from '@/tools/game-items/inventory-equipment-lab';
import { officialItemAddress } from '@/protocol/event-registry';
import { buildGameItemAddress } from '@/inventory/package';

const CAP = officialItemAddress('blobbi:cosmetic:block-builder-cap');
const AURA = officialItemAddress('blobbi:effect:celestial-aura');
const RADIANCE = officialItemAddress('blobbi:effect:solar-radiance');

function reduce(state: DevSimState, ...actions: Parameters<typeof devSimReducer>[1][]) {
  return actions.reduce(devSimReducer, state);
}

describe('coverage: the canonical sixteen', () => {
  it('the universe is the Lab projection: four wearables, twelve effects, unique addresses, max stack one', () => {
    expect(LAB_OFFICIAL_ITEMS).toHaveLength(16);
    expect(LAB_OFFICIAL_ITEMS.filter((i) => i.kind === 'wearable')).toHaveLength(4);
    expect(LAB_OFFICIAL_ITEMS.filter((i) => i.kind === 'effect')).toHaveLength(12);
    expect(new Set(LAB_OFFICIAL_ITEMS.map((i) => i.address)).size).toBe(16);
    for (const item of LAB_OFFICIAL_ITEMS) {
      expect(item.maxStack, item.d).toBe(1);
      expect(item.address).toMatch(/^31632:/);
    }
  });
});

describe('simulated inventory', () => {
  it('own one / remove one, capped at max stack; never above one', () => {
    let state = reduce(INITIAL_DEV_SIM_STATE, { type: 'set-owned', address: CAP, owned: true });
    expect(state.quantities.get(CAP)).toBe(1);
    // Owning again stays 1; there is no increment path at all.
    state = reduce(state, { type: 'set-owned', address: CAP, owned: true });
    expect(state.quantities.get(CAP)).toBe(1);
    state = reduce(state, { type: 'set-owned', address: CAP, owned: false });
    expect(state.quantities.has(CAP)).toBe(false);
  });

  it('ignores addresses outside the official registry', () => {
    const copied = buildGameItemAddress('f'.repeat(64), 'blobbi:effect:celestial-aura');
    const state = reduce(INITIAL_DEV_SIM_STATE, {
      type: 'set-owned',
      address: copied,
      owned: true,
    });
    expect(state.quantities.size).toBe(0);
  });

  it('bulk own/clear by kind and for all sixteen', () => {
    let state = reduce(INITIAL_DEV_SIM_STATE, { type: 'bulk-own', kind: 'wearables' });
    expect(state.quantities.size).toBe(4);
    state = reduce(state, { type: 'bulk-own', kind: 'effects' });
    expect(state.quantities.size).toBe(16);
    expect([...state.quantities.values()].every((q) => q === 1)).toBe(true);
    state = reduce(state, { type: 'bulk-clear', kind: 'effects' });
    expect(state.quantities.size).toBe(4);
    state = reduce(state, { type: 'bulk-clear', kind: 'all' });
    expect(state.quantities.size).toBe(0);
  });
});

describe('simulated equipment', () => {
  const owned = reduce(INITIAL_DEV_SIM_STATE, { type: 'bulk-own', kind: 'all' });

  it('equip requires simulated ownership by default', () => {
    const refused = reduce(INITIAL_DEV_SIM_STATE, {
      type: 'equip',
      address: AURA,
      slot: 'aura',
    });
    expect(refused.placements).toEqual([]);
  });

  it('the diagnostic override permits an unowned (stale) placement', () => {
    const state = reduce(
      INITIAL_DEV_SIM_STATE,
      { type: 'set-allow-unowned', value: true },
      { type: 'equip', address: AURA, slot: 'aura' },
    );
    expect(state.placements).toEqual([
      { id: 'aura', item: AURA, mode: 'equip', slot: 'aura' },
    ]);
  });

  it('replacing a slot preserves every unrelated slot', () => {
    const state = reduce(
      owned,
      { type: 'equip', address: CAP, slot: 'headwear' },
      { type: 'equip', address: AURA, slot: 'aura' },
      { type: 'equip', address: RADIANCE, slot: 'aura' },
    );
    expect(state.placements.map((p) => `${p.slot}:${p.item}`).sort()).toEqual([
      `aura:${RADIANCE}`,
      `headwear:${CAP}`,
    ]);
  });

  it('unequip removes only the named slot', () => {
    const state = reduce(
      owned,
      { type: 'equip', address: CAP, slot: 'headwear' },
      { type: 'equip', address: AURA, slot: 'aura' },
      { type: 'unequip', slot: 'aura' },
    );
    expect(state.placements.map((p) => p.slot)).toEqual(['headwear']);
  });

  it('the seven-slot loadout applies owned steps and skips unowned ones', () => {
    const full = reduce(owned, { type: 'apply-loadout' });
    expect(full.placements.map((p) => p.slot).sort()).toEqual(
      LAB_TEST_LOADOUT.map((s) => s.slot).sort(),
    );
    for (const { slot, d } of LAB_TEST_LOADOUT) {
      expect(full.placements.find((p) => p.slot === slot)?.item).toBe(
        officialItemAddress(d),
      );
    }
    // Unowned: nothing applies without the override.
    const none = reduce(INITIAL_DEV_SIM_STATE, { type: 'apply-loadout' });
    expect(none.placements).toEqual([]);
  });

  it('clear-loadout empties placements; reset restores the deterministic initial state', () => {
    const dirty = reduce(
      owned,
      { type: 'apply-loadout' },
      { type: 'set-stage', stage: 'baby' },
      { type: 'set-allow-unowned', value: true },
    );
    expect(reduce(dirty, { type: 'clear-loadout' }).placements).toEqual([]);
    expect(reduce(dirty, { type: 'reset' })).toEqual(INITIAL_DEV_SIM_STATE);
  });
});
