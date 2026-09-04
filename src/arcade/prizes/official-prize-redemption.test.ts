/**
 * The six prizes, proven redeemable, identity first.
 *
 * Before anything may be sold for Arcade Tickets it has to be provable that
 * what the player receives is the OFFICIAL item and not a lookalike. These
 * tests pin that end of the chain: the catalog entry, the canonical
 * `31632:<issuer>:<d>` address, the item policy that makes the prize unique,
 * and the redemption record derived from all three.
 *
 * Ownership identity on Nostr is the address, never an event id: kind:31632 is
 * addressable and the issuer republishes a definition (new id, same address)
 * whenever its metadata changes. A single event id anywhere in this chain
 * would break every prize the first time its artwork was updated.
 */
import { describe, it, expect } from 'vitest';

import {
  OFFICIAL_ARCADE_PRIZE_CATALOG,
  OFFICIAL_ARCADE_PRIZE_CATALOG_VERSION,
  officialArcadePrize,
  officialArcadePrizeAsRedeemable,
  officialArcadePrizeById,
  officialArcadePrizeByAddress,
} from './official-prize-catalog';
import { evaluatePrizeEligibility } from './prize-redemption';
import {
  ARCADE_TICKET_D,
  ARCADE_TOKEN_D,
  BLOBBI_COIN_D,
  OFFICIAL_ISSUER_PUBKEY,
  officialCosmeticByD,
  officialEffectItemByD,
  officialItemAddress,
} from '@/protocol/event-registry';

/** The six, in the order the shelf shows them, with their intended prices. */
const EXPECTED = [
  { d: 'blobbi:cosmetic:block-builder-cap', kind: 'accessory', tickets: 200 },
  { d: 'blobbi:effect:golden-sparkles', kind: 'effect', tickets: 400 },
  { d: 'blobbi:cosmetic:stargazer-glasses', kind: 'accessory', tickets: 500 },
  { d: 'blobbi:cosmetic:starlight-bow-tie', kind: 'accessory', tickets: 900 },
  { d: 'blobbi:effect:mystic-fog', kind: 'effect', tickets: 1100 },
  { d: 'blobbi:effect:celestial-aura', kind: 'effect', tickets: 2500 },
] as const;

describe('every prize resolves to a canonical official definition', () => {
  it('is exactly the six intended items, at the intended prices', () => {
    expect(
      OFFICIAL_ARCADE_PRIZE_CATALOG.map((p) => ({
        d: p.d,
        kind: p.kind,
        tickets: p.tickets,
      })),
    ).toEqual(EXPECTED.map((e) => ({ d: e.d, kind: e.kind, tickets: e.tickets })));
  });

  it('names a real, ACTIVE official definition for each one', () => {
    for (const prize of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      const definition =
        prize.kind === 'accessory'
          ? officialCosmeticByD(prize.d)
          : officialEffectItemByD(prize.d);
      expect(definition, `${prize.d} has no official definition`).not.toBeNull();
      expect(definition!.status).toBe('active');
      expect(prize.fallbackName).toBe(definition!.name);
      expect(prize.fallbackSymbol).toBe(definition!.symbol);
    }
  });

  it('addresses the ISSUER’s item, derived; never a hand-typed string', () => {
    for (const prize of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      expect(prize.itemAddress).toBe(officialItemAddress(prize.d));
      expect(prize.itemAddress).toBe(`31632:${OFFICIAL_ISSUER_PUBKEY}:${prize.d}`);
    }
  });

  it('uses no event id as identity, anywhere in the chain', () => {
    // A 64-hex token that is not the issuer key would be an event id, the one
    // thing an addressable definition guarantees will change.
    for (const prize of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      const redeemable = officialArcadePrizeAsRedeemable(prize);
      const identity = [
        prize.d,
        prize.itemAddress,
        redeemable.id,
        redeemable.delivery.type === 'inventory' ? redeemable.delivery.itemAddress : '',
      ].join(' ');
      for (const [hex] of identity.matchAll(/\b[0-9a-f]{64}\b/g)) {
        expect(hex, `${prize.d} carries a non-issuer 64-hex token`).toBe(
          OFFICIAL_ISSUER_PUBKEY,
        );
      }
    }
  });

  it('is unique: every definition caps at one, so the prize cannot be stacked', () => {
    for (const prize of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      expect(prize.maxOwned).toBe(1);
      const definition =
        prize.kind === 'accessory'
          ? officialCosmeticByD(prize.d)
          : officialEffectItemByD(prize.d);
      expect(definition!.maxStack).toBe(1);
    }
  });

  it('classifies all six as REDEEMABLE; none is blocked', () => {
    // The scope claim, stated as a test: no prize on this shelf is a preview
    // pretending to be for sale, and none is for sale without a definition.
    for (const prize of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      expect(prize.availability).toBe('available');
    }
    expect(OFFICIAL_ARCADE_PRIZE_CATALOG).toHaveLength(6);
  });

  it('looks up by id and by address, and answers null for a stranger', () => {
    for (const prize of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      expect(officialArcadePrizeById(prize.d)).toBe(prize);
      expect(officialArcadePrizeByAddress(prize.itemAddress)).toBe(prize);
    }
    expect(officialArcadePrizeById('blobbi:cosmetic:not-a-prize')).toBeNull();
    // Same `d`, different issuer, a different item by a different author.
    expect(
      officialArcadePrizeByAddress(
        `31632:${'b'.repeat(64)}:blobbi:effect:celestial-aura`,
      ),
    ).toBeNull();
  });
});

describe('currencies are never prizes', () => {
  it('holds no Ticket, Token or Coin address', () => {
    const currencies = [ARCADE_TICKET_D, ARCADE_TOKEN_D, BLOBBI_COIN_D].map(
      officialItemAddress,
    );
    for (const prize of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      expect(currencies).not.toContain(prize.itemAddress);
    }
  });

  it('refuses to build a prize from a currency `d`', () => {
    // A currency is neither an official cosmetic nor an effect item, so the
    // registry lookup fails and the entry cannot exist.
    expect(() => officialArcadePrize(ARCADE_TICKET_D, 'accessory', 100, 99)).toThrow(
      /not an official accessory definition/,
    );
    expect(() => officialArcadePrize(ARCADE_TOKEN_D, 'effect', 100, 99)).toThrow(
      /not an official effect definition/,
    );
  });
});

describe('a catalog entry cannot lie about what it sells', () => {
  it('refuses an unknown `d`', () => {
    expect(() =>
      officialArcadePrize('blobbi:cosmetic:invented-hat', 'accessory', 100, 99),
    ).toThrow(/not an official accessory definition/);
  });

  it('refuses a cosmetic declared as an effect, and vice versa', () => {
    expect(() =>
      officialArcadePrize('blobbi:cosmetic:block-builder-cap', 'effect', 100, 99),
    ).toThrow(/not an official effect definition/);
    expect(() =>
      officialArcadePrize('blobbi:effect:celestial-aura', 'accessory', 100, 99),
    ).toThrow(/not an official accessory definition/);
  });

  it('refuses a price that is not a positive integer', () => {
    for (const bad of [0, -100, 1.5, Number.NaN]) {
      expect(() =>
        officialArcadePrize('blobbi:effect:mystic-fog', 'effect', bad, 99),
      ).toThrow(/invalid ticket price/);
    }
  });
});

describe('the redemption record derived from a prize', () => {
  it('carries the stable id, the frozen price and the canonical address', () => {
    for (const prize of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      const redeemable = officialArcadePrizeAsRedeemable(prize);
      expect(redeemable.id).toBe(prize.d);
      expect(redeemable.price).toBe(prize.tickets);
      expect(redeemable.availability).toBe('available');
      expect(redeemable.delivery).toEqual({
        type: 'inventory',
        itemAddress: prize.itemAddress,
      });
      expect(redeemable.catalogVersion).toBe(OFFICIAL_ARCADE_PRIZE_CATALOG_VERSION);
    }
  });

  it('is never repeatable: one confirmed purchase is the last one', () => {
    for (const prize of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      const redeemable = officialArcadePrizeAsRedeemable(prize);
      expect(redeemable.repeatable).toBeUndefined();
      expect(
        evaluatePrizeEligibility({
          prize: redeemable,
          balance: 999_999,
          owned: true,
          loggedIn: true,
        }),
      ).toEqual({ eligible: false, reason: 'owned' });
    }
  });

  it('refuses on an insufficient balance, and distinguishes an unreadable one', () => {
    const redeemable = officialArcadePrizeAsRedeemable(OFFICIAL_ARCADE_PRIZE_CATALOG[0]);
    expect(
      evaluatePrizeEligibility({
        prize: redeemable,
        balance: redeemable.price - 1,
        owned: false,
        loggedIn: true,
      }),
    ).toEqual({ eligible: false, reason: 'insufficient-tickets' });
    // "We could not check" is never presented as "you cannot afford it".
    expect(
      evaluatePrizeEligibility({
        prize: redeemable,
        balance: null,
        owned: false,
        loggedIn: true,
      }),
    ).toEqual({ eligible: false, reason: 'balance-unavailable' });
    expect(
      evaluatePrizeEligibility({
        prize: redeemable,
        balance: redeemable.price,
        owned: false,
        loggedIn: true,
      }),
    ).toEqual({ eligible: true });
  });

  it('prefers the fetched definition name but never ends up nameless', () => {
    const prize = OFFICIAL_ARCADE_PRIZE_CATALOG[0];
    expect(officialArcadePrizeAsRedeemable(prize, 'Fetched Name').title).toBe(
      'Fetched Name',
    );
    expect(officialArcadePrizeAsRedeemable(prize, '   ').title).toBe(prize.fallbackName);
    expect(officialArcadePrizeAsRedeemable(prize).title).toBe(prize.fallbackName);
  });
});

describe('the price ladder', () => {
  it('rises strictly with shelf order, and the headline is the dearest', () => {
    const prices = OFFICIAL_ARCADE_PRIZE_CATALOG.map((p) => p.tickets);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(new Set(prices).size).toBe(prices.length);
    const featured = OFFICIAL_ARCADE_PRIZE_CATALOG.filter((p) => p.featured);
    expect(featured).toHaveLength(1);
    expect(featured[0].tickets).toBe(Math.max(...prices));
  });
});
