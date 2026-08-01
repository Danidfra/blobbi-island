/**
 * The TRUST boundary for visual-effect items.
 *
 * The interesting assertions here are the negative ones. Anyone can publish a
 * kind:31632 event with the `d` of an official effect item and the right
 * `effectId` in its content; relays will serve it happily. What must be true is
 * that none of that reaches the renderer — that the only key is the full
 * address, and that the address is built from the official issuer rather than
 * taken from anything.
 *
 * The second half asserts the phase's scope: this registry is INERT. It is
 * reachable from the dev preview and from tests, and from nothing else.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  OFFICIAL_VISUAL_EFFECT_ITEMS,
  ADDRESSED_VISUAL_EFFECT_ITEMS,
  VISUAL_EFFECT_ITEM_ISSUER,
  visualEffectForItemAddress,
  visualEffectItemByAddress,
  visualEffectItemForEffect,
  isOfficialVisualEffectAddress,
  everyMappingResolvesToAKnownEffect,
} from './official-visual-effect-items';
import { BLOBBI_VISUAL_EFFECT_IDS } from '@blobbi/react';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';

const ROOT = process.cwd();
const OFFICIAL_ADDRESS = ADDRESSED_VISUAL_EFFECT_ITEMS[0].address;

describe('the registry covers the twelve effects exactly once', () => {
  it('maps every effect the renderer implements, and nothing it does not', () => {
    expect(OFFICIAL_VISUAL_EFFECT_ITEMS.map((i) => i.effectId).sort()).toEqual(
      [...BLOBBI_VISUAL_EFFECT_IDS].sort(),
    );
    expect(everyMappingResolvesToAKnownEffect()).toBe(true);
  });

  it('uses a distinct, conventionally-namespaced `d` per item', () => {
    const dTags = OFFICIAL_VISUAL_EFFECT_ITEMS.map((i) => i.d);
    expect(new Set(dTags).size).toBe(dTags.length);
    for (const item of OFFICIAL_VISUAL_EFFECT_ITEMS) {
      expect(item.d).toBe(`blobbi:effect:${item.effectId}`);
    }
  });

  it('records the rarity the catalogue committed to', () => {
    const byEffect = Object.fromEntries(
      OFFICIAL_VISUAL_EFFECT_ITEMS.map((i) => [i.effectId, i.rarity]),
    );
    expect(byEffect).toEqual({
      'bubble-bliss': 'uncommon',
      'golden-sparkles': 'rare',
      'love-burst': 'rare',
      'firefly-friends': 'rare',
      'mystic-fog': 'epic',
      'frost-breath': 'epic',
      'pixel-glitch': 'epic',
      'electric-charge': 'epic',
      'celestial-aura': 'legendary',
      'solar-radiance': 'legendary',
      'void-whispers': 'legendary',
      'rainbow-dream': 'mythic',
    });
  });
});

describe('identity is the full address, never the `d`', () => {
  it('derives every address from the official issuer', () => {
    expect(VISUAL_EFFECT_ITEM_ISSUER).toBe(OFFICIAL_ITEM_ISSUER_PUBKEY);
    for (const item of ADDRESSED_VISUAL_EFFECT_ITEMS) {
      expect(item.address).toBe(`31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:${item.d}`);
    }
  });

  it('resolves an official address to its effect', () => {
    for (const item of ADDRESSED_VISUAL_EFFECT_ITEMS) {
      expect(visualEffectForItemAddress(item.address)).toBe(item.effectId);
      expect(visualEffectItemByAddress(item.address)).toEqual(item);
      expect(isOfficialVisualEffectAddress(item.address)).toBe(true);
      expect(visualEffectItemForEffect(item.effectId)).toEqual(item);
    }
  });

  it('refuses an impostor that copies the `d` but not the issuer', () => {
    // The whole point. This is the event a third party would publish.
    const impostor =
      '31632:1111111111111111111111111111111111111111111111111111111111111111:blobbi:effect:celestial-aura';
    expect(visualEffectForItemAddress(impostor)).toBeNull();
    expect(visualEffectItemByAddress(impostor)).toBeNull();
    expect(isOfficialVisualEffectAddress(impostor)).toBe(false);
  });

  it('refuses a bare `d`, a bare effect id, and everything malformed', () => {
    for (const notAnAddress of [
      'blobbi:effect:celestial-aura',
      'celestial-aura',
      '',
      ':::',
      `31633:${OFFICIAL_ITEM_ISSUER_PUBKEY}:blobbi:effect:celestial-aura`,
      `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:blobbi:effect:not-a-real-effect`,
      `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY.toUpperCase()}:blobbi:effect:celestial-aura`,
      OFFICIAL_ADDRESS + ' ',
      ' ' + OFFICIAL_ADDRESS,
      '__proto__',
      'constructor',
      'toString',
    ]) {
      expect(visualEffectForItemAddress(notAnAddress), notAnAddress).toBeNull();
      expect(isOfficialVisualEffectAddress(notAnAddress), notAnAddress).toBe(false);
    }
  });

  it('refuses the cosmetic addresses, which are a different item family', () => {
    expect(
      visualEffectForItemAddress(
        `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:blobbi:cosmetic:block-builder-cap`,
      ),
    ).toBeNull();
  });
});

describe('the registry holds no executable anything', () => {
  it('is plain, JSON-serializable data', () => {
    const roundTripped = JSON.parse(JSON.stringify(ADDRESSED_VISUAL_EFFECT_ITEMS));
    expect(roundTripped).toEqual(ADDRESSED_VISUAL_EFFECT_ITEMS);
    for (const item of ADDRESSED_VISUAL_EFFECT_ITEMS) {
      for (const [key, value] of Object.entries(item)) {
        if (key === 'forms') {
          expect(Array.isArray(value)).toBe(true);
          for (const form of value as unknown[]) {
            expect(typeof form).toBe('string');
          }
        } else if (key === 'arcadePrize') {
          expect(typeof value).toBe('boolean');
        } else {
          expect(typeof value, key).toBe('string');
        }
      }
    }
  });

  it('never reads an effect id out of event content', () => {
    // Reading `metadata.effectId` from a fetched definition and trusting it is
    // exactly the vulnerability the address key exists to close, so the absence
    // of any such read is asserted rather than assumed.
    const source = readFileSync(
      join(ROOT, 'src/effects/official-visual-effect-items.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(source).not.toMatch(/metadata\s*[.[]/);
    expect(source).not.toMatch(/\.content\b/);
    expect(source).not.toMatch(/JSON\.parse/);
    expect(source).not.toMatch(/eval|new Function|dangerouslySetInnerHTML/);
  });
});

describe('the registry stays inside its Phase-9 activation boundary', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  const importers = sourceFiles(join(ROOT, 'src'))
    .filter((file) =>
      /from\s+['"][^'"]*official-visual-effect-items['"]/.test(readFileSync(file, 'utf8')),
    )
    .map((f) => f.replace(`${ROOT}/`, ''))
    .sort();

  it('is imported only by the activation path, the trusted UI surfaces and the tests', () => {
    // Phase 8 asserted this registry was wired to NOTHING; Phase 9 activated
    // it; Phase 9.5 added two READ-ONLY display consumers (the preview-only
    // Prize Counter resolver) and the internal lab's item projection. The set
    // stays exact, and stays conspicuously free of: the renderer package,
    // presence/multiplayer, and any module that could activate an effect from
    // anything but the full official address. Growth here should be deliberate.
    expect(importers).toEqual([
      'src/components/blobbi/EffectsPanel.test.tsx',
      'src/components/blobbi/arcade/prizes/PrizeCounter.test.tsx',
      'src/components/blobbi/arcade/prizes/useOfficialArcadePrizes.ts',
      'src/components/tools/game-items/InventoryEquipmentLab.test.tsx',
      'src/effects/active-effects.test.ts',
      'src/effects/active-effects.ts',
      'src/effects/official-item-event-fixtures.test.ts',
      'src/effects/official-visual-effect-items.test.ts',
      'src/effects/useOwnedVisualEffects.ts',
      'src/pages/DevBlobbiEffects.tsx',
      'src/placement/apply-set-mutation.test.tsx',
      'src/placement/character-equipment-effects.test.tsx',
      'src/placement/effect-equipment-mutation.test.tsx',
      'src/tools/game-items/inventory-equipment-lab.ts',
    ]);
  });

  it('reaches no inventory-state, placement or publishing module', () => {
    const source = readFileSync(
      join(ROOT, 'src/effects/official-visual-effect-items.ts'),
      'utf8',
    );
    // Deduplicated: a module legitimately imports both types and values from
    // the same specifier, and this assertion is about WHICH modules it reaches.
    const imports = [
      ...new Set([...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])),
    ];
    expect(imports.sort()).toEqual([
      '@/inventory/constants',
      '@/protocol/event-registry',
      '@blobbi/react',
    ]);
    // Constants and a pure address builder — no hook, no query, no mutation.
    for (const banned of [/use[A-Z]/, /useNostrPublish/, /mutate/, /31633/, /31634/]) {
      expect(banned.test(source.replace(/\/\*[\s\S]*?\*\//g, '')), String(banned)).toBe(
        false,
      );
    }
  });
});
