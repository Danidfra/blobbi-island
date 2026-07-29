/**
 * Catalogue tests.
 *
 * The entries are TEMPORARY fixtures, but the invariants are not: whatever the
 * final prize list looks like, it must satisfy everything here, so these tests
 * are the checklist a replacement catalogue is written against.
 */
import { describe, it, expect } from 'vitest';

import {
  ARCADE_PRIZE_CATALOGUE,
  ARCADE_PRIZE_CATALOGUE_VERSION,
  ARCADE_PRIZE_CATEGORIES,
  ARCADE_PRIZE_CATEGORY_LABELS,
  getArcadePrize,
  orderedArcadePrizes,
  presentPrizeCategories,
} from './prize-catalogue';

describe('every entry is well-formed', () => {
  it('has a unique, non-empty id', () => {
    const ids = ARCADE_PRIZE_CATALOGUE.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.trim().length).toBeGreaterThan(0);
  });

  it('has a positive integer price', () => {
    for (const prize of ARCADE_PRIZE_CATALOGUE) {
      expect(Number.isInteger(prize.price), prize.id).toBe(true);
      expect(prize.price, prize.id).toBeGreaterThan(0);
    }
  });

  it('uses only supported categories, and every category has a label', () => {
    for (const prize of ARCADE_PRIZE_CATALOGUE) {
      expect(ARCADE_PRIZE_CATEGORIES, prize.id).toContain(prize.category);
    }
    for (const category of ARCADE_PRIZE_CATEGORIES) {
      expect(ARCADE_PRIZE_CATEGORY_LABELS[category].trim().length).toBeGreaterThan(0);
    }
  });

  it('has a non-empty title, description and emoji fallback', () => {
    for (const prize of ARCADE_PRIZE_CATALOGUE) {
      expect(prize.title.trim().length, prize.id).toBeGreaterThan(0);
      expect(prize.description.trim().length, prize.id).toBeGreaterThan(0);
      expect(prize.emojiFallback.trim().length, prize.id).toBeGreaterThan(0);
    }
  });

  it('carries valid delivery metadata', () => {
    for (const prize of ARCADE_PRIZE_CATALOGUE) {
      const d = prize.delivery;
      switch (d.type) {
        case 'mock-ownership':
          break;
        case 'inventory':
          expect(d.itemAddress.trim().length, prize.id).toBeGreaterThan(0);
          break;
        case 'badge':
          expect(d.badgeId.trim().length, prize.id).toBeGreaterThan(0);
          break;
        case 'blobbi-effect':
          expect(d.effectId.trim().length, prize.id).toBeGreaterThan(0);
          break;
        case 'home-furniture':
          expect(d.furnitureId.trim().length, prize.id).toBeGreaterThan(0);
          break;
        default:
          throw new Error(`unknown delivery type on ${prize.id}`);
      }
    }
  });

  it('versions the catalogue', () => {
    expect(ARCADE_PRIZE_CATALOGUE_VERSION.trim().length).toBeGreaterThan(0);
  });
});

describe('the flagship fixtures mean what the product says they mean', () => {
  it('makes the Mini Arcade Trophy a BADGE, not furniture', () => {
    const trophy = getArcadePrize('mini-arcade-trophy')!;
    expect(trophy.category).toBe('badge');
    expect(trophy.delivery).toEqual({ type: 'badge', badgeId: 'mini-arcade-trophy' });
  });

  it('makes the Mini Arcade Cabinet future Home FURNITURE with no-reward gameplay', () => {
    const cabinet = getArcadePrize('mini-arcade-cabinet')!;
    expect(cabinet.category).toBe('furniture');
    expect(cabinet.rarity).toBe('premium');
    expect(cabinet.delivery).toEqual({
      type: 'home-furniture',
      furnitureId: 'mini-arcade-cabinet',
      gameplayMode: 'no-rewards',
    });
    // The aspiration: clearly the most expensive thing on the shelf.
    for (const other of ARCADE_PRIZE_CATALOGUE) {
      if (other.id !== cabinet.id) expect(other.price).toBeLessThan(cabinet.price);
    }
    // The player-facing copy says what it will do, honestly.
    expect(cabinet.description.toLowerCase()).toContain('home');
    expect(cabinet.description.toLowerCase()).toMatch(/no arcade tickets/);
  });

  it('marks premium items consistently', () => {
    for (const prize of ARCADE_PRIZE_CATALOGUE.filter((p) => p.rarity === 'premium')) {
      // Premium is the long-term tier: nothing premium is cheaper than every
      // non-premium prize.
      const cheapestCommon = Math.min(
        ...ARCADE_PRIZE_CATALOGUE.filter((p) => p.rarity !== 'premium').map((p) => p.price),
      );
      expect(prize.price, prize.id).toBeGreaterThan(cheapestCommon);
    }
  });
});

describe('ordering and lookup', () => {
  it('orders deterministically: non-premium by price, premium last', () => {
    const a = orderedArcadePrizes();
    const b = orderedArcadePrizes();
    expect(a).toEqual(b);

    const firstPremium = a.findIndex((p) => p.rarity === 'premium');
    expect(firstPremium).toBeGreaterThan(-1);
    for (const later of a.slice(firstPremium)) expect(later.rarity).toBe('premium');

    const nonPremiumPrices = a.filter((p) => p.rarity !== 'premium').map((p) => p.price);
    expect(nonPremiumPrices).toEqual([...nonPremiumPrices].sort((x, y) => x - y));
  });

  it('does not mutate the catalogue when ordering', () => {
    const before = ARCADE_PRIZE_CATALOGUE.map((p) => p.id);
    orderedArcadePrizes();
    expect(ARCADE_PRIZE_CATALOGUE.map((p) => p.id)).toEqual(before);
  });

  it('resolves prizes by id, and null for unknown ids', () => {
    expect(getArcadePrize('arcade-snack')?.title).toBe('Arcade Snack');
    expect(getArcadePrize('not-a-prize')).toBeNull();
  });

  it('reports only the categories that have entries, in canonical order', () => {
    const present = presentPrizeCategories();
    expect(present.length).toBeGreaterThan(0);
    for (const category of present) {
      expect(ARCADE_PRIZE_CATALOGUE.some((p) => p.category === category)).toBe(true);
    }
    // Canonical order preserved.
    const indices = present.map((c) => ARCADE_PRIZE_CATEGORIES.indexOf(c));
    expect(indices).toEqual([...indices].sort((x, y) => x - y));
  });
});
