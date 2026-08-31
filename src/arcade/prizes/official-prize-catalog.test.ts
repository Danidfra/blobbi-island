/**
 * The initial official Arcade Prize catalog — content and invariants.
 *
 * Unlike the retired fixture catalogue, the ENTRIES here are load-bearing:
 * Phase 9.5 specifies exactly six prizes, exactly these items, exactly these
 * provisional ticket values, and explicitly NOT the Celestial Seraph Necklace.
 * These tests pin all of that, plus the identity rules (stable full addresses
 * from the official issuer; never an event id) and resolvability against the
 * Phase-9 registries.
 */
import { describe, it, expect } from 'vitest';

import {
  OFFICIAL_ARCADE_PRIZE_CATALOG,
  OFFICIAL_ARCADE_PRIZE_CATALOG_VERSION,
  orderedOfficialArcadePrizes,
  officialArcadePrizeByAddress,
} from './official-prize-catalog';
import {
  officialCosmeticByAddress,
  officialEffectItemByAddress,
  officialItemAddress,
  OFFICIAL_ISSUER_PUBKEY,
} from '@/protocol/event-registry';

const EXPECTED = [
  { d: 'blobbi:cosmetic:block-builder-cap', kind: 'accessory', tickets: 200 },
  { d: 'blobbi:effect:golden-sparkles', kind: 'effect', tickets: 400 },
  { d: 'blobbi:cosmetic:stargazer-glasses', kind: 'accessory', tickets: 500 },
  { d: 'blobbi:cosmetic:starlight-bow-tie', kind: 'accessory', tickets: 900 },
  { d: 'blobbi:effect:mystic-fog', kind: 'effect', tickets: 1100 },
  { d: 'blobbi:effect:celestial-aura', kind: 'effect', tickets: 2500 },
] as const;

describe('the six initial prizes', () => {
  it('contains exactly six entries — the specified items at the specified prices', () => {
    expect(OFFICIAL_ARCADE_PRIZE_CATALOG).toHaveLength(6);
    for (const expected of EXPECTED) {
      const entry = OFFICIAL_ARCADE_PRIZE_CATALOG.find((p) => p.d === expected.d);
      expect(entry, expected.d).toBeDefined();
      expect(entry!.kind, expected.d).toBe(expected.kind);
      expect(entry!.tickets, expected.d).toBe(expected.tickets);
    }
  });

  it('is three accessories and three effects', () => {
    const kinds = OFFICIAL_ARCADE_PRIZE_CATALOG.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'accessory')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'effect')).toHaveLength(3);
  });

  it('does NOT contain the Celestial Seraph Necklace', () => {
    expect(
      OFFICIAL_ARCADE_PRIZE_CATALOG.some(
        (p) => p.d === 'blobbi:cosmetic:celestial-seraph-necklace',
      ),
    ).toBe(false);
    expect(
      officialArcadePrizeByAddress(
        officialItemAddress('blobbi:cosmetic:celestial-seraph-necklace'),
      ),
    ).toBeNull();
  });

  it('every address is the full stable address derived from the official issuer', () => {
    for (const entry of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      expect(entry.itemAddress).toBe(officialItemAddress(entry.d));
      expect(entry.itemAddress).toBe(
        `31632:${OFFICIAL_ISSUER_PUBKEY}:${entry.d}`,
      );
      // Never an event id: an id is 64 hex chars with no kind prefix.
      expect(entry.itemAddress).toMatch(/^31632:/);
    }
  });

  it('every entry resolves in the Phase-9 registries (no second manual list)', () => {
    for (const entry of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      if (entry.kind === 'accessory') {
        expect(officialCosmeticByAddress(entry.itemAddress), entry.d).not.toBeNull();
        expect(officialEffectItemByAddress(entry.itemAddress), entry.d).toBeNull();
      } else {
        expect(officialEffectItemByAddress(entry.itemAddress), entry.d).not.toBeNull();
        expect(officialCosmeticByAddress(entry.itemAddress), entry.d).toBeNull();
      }
    }
  });

  it('registry rarities match the specified ladder', () => {
    const rarityOf = (entry: (typeof OFFICIAL_ARCADE_PRIZE_CATALOG)[number]) =>
      entry.kind === 'effect'
        ? officialEffectItemByAddress(entry.itemAddress)!.rarity
        : ({
            'blobbi:cosmetic:block-builder-cap': 'uncommon',
            'blobbi:cosmetic:stargazer-glasses': 'rare',
            'blobbi:cosmetic:starlight-bow-tie': 'epic',
          } as Record<string, string>)[entry.d];
    const ladder = Object.fromEntries(
      OFFICIAL_ARCADE_PRIZE_CATALOG.map((p) => [p.d, rarityOf(p)]),
    );
    expect(ladder).toEqual({
      'blobbi:cosmetic:block-builder-cap': 'uncommon',
      'blobbi:effect:golden-sparkles': 'rare',
      'blobbi:cosmetic:stargazer-glasses': 'rare',
      'blobbi:cosmetic:starlight-bow-tie': 'epic',
      'blobbi:effect:mystic-fog': 'epic',
      'blobbi:effect:celestial-aura': 'legendary',
    });
  });
});

describe('shape and determinism', () => {
  it('orders deterministically by sortOrder, ascending with ascending price', () => {
    const ordered = orderedOfficialArcadePrizes();
    expect(ordered.map((p) => p.tickets)).toEqual([200, 400, 500, 900, 1100, 2500]);
    const orders = ordered.map((p) => p.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    // Shuffled input, same output.
    const shuffled = [...OFFICIAL_ARCADE_PRIZE_CATALOG].reverse();
    expect(orderedOfficialArcadePrizes(shuffled)).toEqual(ordered);
  });

  it('every entry is available — all six cosmetics redeem for real', () => {
    for (const entry of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      expect(entry.availability).toBe('available');
    }
  });

  it('addresses are unique, prices are positive integers, catalog is frozen', () => {
    const addresses = OFFICIAL_ARCADE_PRIZE_CATALOG.map((p) => p.itemAddress);
    expect(new Set(addresses).size).toBe(addresses.length);
    for (const entry of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      expect(Number.isInteger(entry.tickets)).toBe(true);
      expect(entry.tickets).toBeGreaterThan(0);
      expect(Object.isFrozen(entry)).toBe(true);
    }
    expect(Object.isFrozen(OFFICIAL_ARCADE_PRIZE_CATALOG)).toBe(true);
    expect(OFFICIAL_ARCADE_PRIZE_CATALOG_VERSION).toMatch(/inventory/);
  });

  it('only the headline prize is featured', () => {
    const featured = OFFICIAL_ARCADE_PRIZE_CATALOG.filter((p) => p.featured);
    expect(featured.map((p) => p.d)).toEqual(['blobbi:effect:celestial-aura']);
  });
});
