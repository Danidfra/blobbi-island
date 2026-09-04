/**
 * The pure activation resolver, gate by gate.
 *
 * Everything here runs on plain data: hand-built placement entries, a quantity
 * map and a stage string. No queries, no signer, no relay; that the resolver
 * NEEDS none of those is itself asserted at the bottom, source-level, because
 * purity is a load-bearing property (the dev simulator and the tests depend on
 * calling this freely).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EFFECT_SLOT_ORDER, EFFECT_SLOTS } from '@blobbi/react';
import type { GameItemPlacementEntry } from '@/inventory/package';
import { buildGameItemAddress } from '@/inventory/package';

import {
  resolveActiveBlobbiEffects,
  isEffectItemPlacement,
  explainEffectRejection,
  type EffectRejectionReason,
} from './active-effects';
import {
  ADDRESSED_VISUAL_EFFECT_ITEMS,
  visualEffectItemForEffect,
} from './official-visual-effect-items';
import { officialItemAddress } from '@/protocol/event-registry';

const AURA = visualEffectItemForEffect('celestial-aura')!;
const AURA_2 = visualEffectItemForEffect('solar-radiance')!;
const PARTICLES = visualEffectItemForEffect('golden-sparkles')!;
const OVERLAY = visualEffectItemForEffect('pixel-glitch')!;
const GROUND = visualEffectItemForEffect('mystic-fog')!;

function equip(
  address: string,
  slot: string,
  extra: Partial<GameItemPlacementEntry> = {},
): GameItemPlacementEntry {
  return { id: slot, item: address, mode: 'equip', slot, ...extra };
}

function owned(...addresses: string[]): ReadonlyMap<string, number> {
  return new Map(addresses.map((a) => [a, 1]));
}

describe('resolveActiveBlobbiEffects: the twelve official items', () => {
  it('each of the twelve resolves alone, owned, on baby and on adult', () => {
    for (const item of ADDRESSED_VISUAL_EFFECT_ITEMS) {
      for (const stage of ['baby', 'adult']) {
        const result = resolveActiveBlobbiEffects({
          placements: [equip(item.address, item.effectSlot)],
          quantityByAddress: owned(item.address),
          stage,
        });
        expect(result.effects, `${item.d} on ${stage}`).toEqual([
          { id: item.effectId },
        ]);
        expect(result.rejected).toEqual([]);
      }
    }
  });

  it('four different effect slots coexist, in the renderer’s canonical order regardless of input order', () => {
    const items = [OVERLAY, AURA, GROUND, PARTICLES]; // deliberately shuffled
    const result = resolveActiveBlobbiEffects({
      placements: items.map((i) => equip(i.address, i.effectSlot)),
      quantityByAddress: owned(...items.map((i) => i.address)),
      stage: 'adult',
    });
    expect(result.effects.map((e) => e.id)).toEqual([
      'celestial-aura', // aura
      'mystic-fog', // ground-local
      'golden-sparkles', // ambient-particles
      'pixel-glitch', // body-overlay
    ]);
    expect(result.effects.map((e) => EFFECT_SLOTS[e.id])).toEqual([
      ...EFFECT_SLOT_ORDER,
    ]);
  });

  it('two auras conflict: the LAST equipped wins deterministically, the loser is diagnosed', () => {
    const result = resolveActiveBlobbiEffects({
      placements: [
        equip(AURA.address, 'aura'),
        equip(AURA_2.address, 'aura'),
      ],
      quantityByAddress: owned(AURA.address, AURA_2.address),
      stage: 'adult',
    });
    expect(result.effects).toEqual([{ id: 'solar-radiance' }]);
    expect(result.rejected).toEqual([
      expect.objectContaining({
        reason: 'slot-conflict',
        registration: expect.objectContaining({ effectId: 'celestial-aura' }),
      }),
    ]);
  });

  it('output is plain serializable renderer data', () => {
    const result = resolveActiveBlobbiEffects({
      placements: [equip(AURA.address, 'aura')],
      quantityByAddress: owned(AURA.address),
      stage: 'baby',
    });
    expect(JSON.parse(JSON.stringify(result.effects))).toEqual(result.effects);
    expect(result.effects[0]).toEqual({ id: 'celestial-aura' });
  });
});

describe('ownership gates', () => {
  it('quantity 1 activates; quantity 0 and a missing entry do not', () => {
    for (const [map, label] of [
      [new Map([[AURA.address, 0]]), 'quantity 0'],
      [new Map(), 'missing entry'],
    ] as const) {
      const result = resolveActiveBlobbiEffects({
        placements: [equip(AURA.address, 'aura')],
        quantityByAddress: map,
        stage: 'adult',
      });
      expect(result.effects, label).toEqual([]);
      expect(result.rejected[0]?.reason, label).toBe('not-owned');
    }
  });

  it('a stale placement (item no longer owned) does not render and is not cleaned up', () => {
    const placements = [equip(GROUND.address, 'ground-local')];
    const result = resolveActiveBlobbiEffects({
      placements,
      quantityByAddress: new Map(),
      stage: 'adult',
    });
    expect(result.effects).toEqual([]);
    // The input entry is untouched, resolving must never mutate or drop the
    // raw placement; cleanup is a policy decision made elsewhere, explicitly.
    expect(placements[0]).toEqual(equip(GROUND.address, 'ground-local'));
    expect(result.rejected[0]).toMatchObject({ reason: 'not-owned' });
  });

  it('placement alone is insufficient, and an official definition alone is insufficient', () => {
    // Placement without inventory:
    expect(
      resolveActiveBlobbiEffects({
        placements: [equip(PARTICLES.address, 'ambient-particles')],
        quantityByAddress: new Map(),
      }).effects,
    ).toEqual([]);
    // Registry entry + owned but never placed:
    expect(
      resolveActiveBlobbiEffects({
        placements: [],
        quantityByAddress: owned(PARTICLES.address),
        stage: 'adult',
      }).effects,
    ).toEqual([]);
  });

  it('inventory matching uses the exact full address, not the d or the effect id', () => {
    const stranger =
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const copiedAddress = buildGameItemAddress(stranger, AURA.d);
    const result = resolveActiveBlobbiEffects({
      placements: [equip(AURA.address, 'aura')],
      // The player "owns" the impostor's copy, not the official item.
      quantityByAddress: owned(copiedAddress),
      stage: 'adult',
    });
    expect(result.effects).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('not-owned');
  });
});

describe('issuer and item gates', () => {
  it('a third-party copy of an official d is not an effect item at all', () => {
    const stranger =
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const copied = buildGameItemAddress(stranger, 'blobbi:effect:celestial-aura');
    const entry = equip(copied, 'aura');
    expect(isEffectItemPlacement(entry)).toBe(false);
    const result = resolveActiveBlobbiEffects({
      placements: [entry],
      quantityByAddress: owned(copied),
      stage: 'adult',
    });
    // Ignored entirely: neither active nor rejected, the wearable policy owns
    // its diagnosis (untrusted-issuer).
    expect(result.effects).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('unsupported items (wearables, consumables, garbage) are ignored', () => {
    const wearable = officialItemAddress('blobbi:cosmetic:block-builder-cap');
    const food = officialItemAddress('blobbi:food:apple');
    const result = resolveActiveBlobbiEffects({
      placements: [
        equip(wearable, 'headwear'),
        equip(food, 'aura'),
        equip('not-an-address', 'aura'),
      ],
      quantityByAddress: owned(wearable, food),
      stage: 'adult',
    });
    expect(result.effects).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('an event id used as an item reference resolves nothing', () => {
    const entry = equip(
      'ebb2effcf21a4310be59d354ebd1958b8049673e1ae77bb8719b28162a5d6654',
      'aura',
    );
    expect(isEffectItemPlacement(entry)).toBe(false);
  });
});

describe('slot gates', () => {
  it('an effect item equipped into the wrong slot is refused, not relocated', () => {
    const result = resolveActiveBlobbiEffects({
      placements: [equip(AURA.address, 'ambient-particles')],
      quantityByAddress: owned(AURA.address),
      stage: 'adult',
    });
    expect(result.effects).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('slot-mismatch');
  });

  it('non-equip modes are refused', () => {
    const result = resolveActiveBlobbiEffects({
      placements: [
        { id: 'aura', item: AURA.address, mode: 'place', slot: 'aura' },
      ],
      quantityByAddress: owned(AURA.address),
      stage: 'adult',
    });
    expect(result.effects).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('unsupported-mode');
  });
});

describe('form gates', () => {
  it('egg activates nothing', () => {
    const result = resolveActiveBlobbiEffects({
      placements: [equip(AURA.address, 'aura')],
      quantityByAddress: owned(AURA.address),
      stage: 'egg',
    });
    expect(result.effects).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('incompatible-form');
  });

  it('an unknown or missing stage is safe and is not a restriction', () => {
    for (const stage of [undefined, '']) {
      const result = resolveActiveBlobbiEffects({
        placements: [equip(AURA.address, 'aura')],
        quantityByAddress: owned(AURA.address),
        stage,
      });
      expect(result.effects, String(stage)).toEqual([{ id: 'celestial-aura' }]);
    }
  });

  it('a stage outside the registered forms is refused without crashing', () => {
    const result = resolveActiveBlobbiEffects({
      placements: [equip(AURA.address, 'aura')],
      quantityByAddress: owned(AURA.address),
      stage: 'chrysalis-form-from-the-future',
    });
    expect(result.effects).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('incompatible-form');
  });
});

describe('diagnostics', () => {
  it('every rejection reason has a human explanation', () => {
    const reasons: EffectRejectionReason[] = [
      'unsupported-mode',
      'slot-mismatch',
      'not-owned',
      'incompatible-form',
      'slot-conflict',
    ];
    for (const reason of reasons) {
      expect(explainEffectRejection(reason)).toMatch(/\w/);
    }
  });
});

describe('purity: the resolver imports no I/O', () => {
  it('has no hook, query, signing or publishing import', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/effects/active-effects.ts'),
      'utf8',
    );
    const imports = [
      ...new Set(
        [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
      ),
    ];
    expect(imports.sort()).toEqual([
      '@/inventory/package',
      '@blobbi/react',
      './official-visual-effect-items',
    ].sort());
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const banned of [
      /useQuery/,
      /useMutation/,
      /useNostr/,
      /fetch\(/,
      /WebSocket/,
      /signEvent/,
      /publish/i,
    ]) {
      expect(banned.test(stripped), String(banned)).toBe(false);
    }
  });
});
