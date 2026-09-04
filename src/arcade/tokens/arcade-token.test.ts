/**
 * Arcade Token identity and price.
 *
 * The Token and the Ticket are opposite halves of the arcade loop; one is
 * paid IN to play, the other is paid OUT as a reward, so the first thing that
 * has to be true is that they are two different items.
 */

import { describe, it, expect } from 'vitest';

import { ARCADE_TICKET_D, officialItemByD } from '@/protocol/event-registry';
import { itemIdToAddress, addressToItemId } from '@/inventory/registry';
import { BLOBBI_COIN_ADDRESS } from '@/inventory/coin';

import {
  ARCADE_TOKEN_ADDRESS,
  ARCADE_TOKEN_D,
  ARCADE_TOKEN_DEFINITION_EVENT_ID,
  ARCADE_TOKEN_ISSUER,
} from './arcade-token';
import {
  ARCADE_TOKEN_COIN_PRICE,
  ARCADE_TOKEN_PURCHASE_OPTIONS,
  arcadeTokenCoinCost,
} from './token-store';

describe('the Arcade Token is a registered official currency', () => {
  it('resolves to the canonical published address', () => {
    expect(ARCADE_TOKEN_ADDRESS).toBe(
      '31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:currency:arcade-token',
    );
    // Built from the registry's issuer + d, not hand-written.
    expect(ARCADE_TOKEN_ADDRESS).toBe(`31632:${ARCADE_TOKEN_ISSUER}:${ARCADE_TOKEN_D}`);
  });

  it('round-trips through the shared registry like every other item', () => {
    expect(itemIdToAddress('arcade-token')).toBe(ARCADE_TOKEN_ADDRESS);
    expect(addressToItemId(ARCADE_TOKEN_ADDRESS)).toBe('arcade-token');
  });

  it('carries the published currency metadata', () => {
    const item = officialItemByD(ARCADE_TOKEN_D);
    expect(item).toBeTruthy();
    expect(item).toMatchObject({
      name: 'Arcade Token',
      type: 'currency',
      category: 'currency',
      status: 'active',
      stackable: true,
      // Currency is never used on a Blobbi, a null action is what keeps it
      // out of every care flow.
      action: null,
    });
    expect(item?.effects).toEqual({});
  });

  it('records the published event id as provenance, never as identity', () => {
    expect(ARCADE_TOKEN_DEFINITION_EVENT_ID).toBe(
      '22f7e302f70b27e71722ae95b56561bd83a832c5bb9dde896310d9860d0b6b04',
    );
    // The address is the key; the event id must not appear inside it.
    expect(ARCADE_TOKEN_ADDRESS).not.toContain(ARCADE_TOKEN_DEFINITION_EVENT_ID);
  });
});

describe('Token, Ticket and Coin are three distinct currencies', () => {
  it('has its own address and item id', () => {
    const ticket = itemIdToAddress('cur_arcade_ticket');
    expect(ARCADE_TOKEN_ADDRESS).not.toBe(ticket);
    expect(ARCADE_TOKEN_ADDRESS).not.toBe(BLOBBI_COIN_ADDRESS);
    expect(ARCADE_TOKEN_D).not.toBe(ARCADE_TICKET_D);
  });

  it('is not purchasable through the food shop', async () => {
    // Currency is earned or bought at its own counter, never priced in the
    // consumable shop: the shop's validator rejects a currency price outright.
    const { priceForAddress } = await import('@/inventory/shop-catalog');
    expect(priceForAddress(ARCADE_TOKEN_ADDRESS)).toBeNull();
  });
});

describe('the Token price has one source', () => {
  it('is 5 Blobbi Coins', () => {
    expect(ARCADE_TOKEN_COIN_PRICE).toBe(5);
  });

  it('multiplies cleanly, with no discount tiers', () => {
    for (const quantity of ARCADE_TOKEN_PURCHASE_OPTIONS) {
      expect(arcadeTokenCoinCost(quantity)).toBe(quantity * ARCADE_TOKEN_COIN_PRICE);
    }
  });

  it('refuses a nonsensical quantity rather than charging something odd', () => {
    for (const bad of [0, -1, 2.5, Number.NaN]) {
      expect(() => arcadeTokenCoinCost(bad)).toThrow(/positive integer/i);
    }
  });

  it('leaves the initial 200-Coin allocation worth 40 plays', () => {
    // A new player is not gated out of the arcade on day one.
    expect(Math.floor(200 / ARCADE_TOKEN_COIN_PRICE)).toBe(40);
  });
});
