/**
 * Accessory ↔ item-definition identity, and the trust boundary around it.
 *
 * The thing being protected: a kind:31632 definition is addressable, so anyone
 * can publish one with any `d` tag. If an accessory could be matched by `d`
 * alone, a stranger's event would decide what a player's hat looks like. Every
 * lookup here therefore ends at an address the official registry vouches for.
 */

import { describe, it, expect } from 'vitest';

import {
  ACCESSORY_CODE_TO_OFFICIAL_ITEM_D,
  HAS_ACCESSORY_ITEM_DEFINITIONS,
  accessoryDefinitionsByCode,
  accessoryItemAddress,
} from './accessory-item-identity';
import { bundledFallbackDefinition, type ResolvedBlobbiItemDefinition } from './catalog-fallback';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from './constants';
import { OFFICIAL_ITEM_D_TAGS, itemIdToAddress } from './registry';

describe('accessory → definition mapping', () => {
  it('is empty today, because no accessory definition has been published', () => {
    // Not an oversight: the official issuer has published 20 item definitions,
    // none of them an accessory. When that changes, this expectation and the
    // map change together.
    expect(ACCESSORY_CODE_TO_OFFICIAL_ITEM_D).toEqual({});
    expect(HAS_ACCESSORY_ITEM_DEFINITIONS).toBe(false);
  });

  it('only ever maps onto `d` tags the official registry knows', () => {
    for (const d of Object.values(ACCESSORY_CODE_TO_OFFICIAL_ITEM_D)) {
      expect(OFFICIAL_ITEM_D_TAGS).toContain(d);
    }
  });

  it('resolves nothing for an unmapped code', () => {
    expect(accessoryItemAddress('headwear-8')).toBeNull();
    expect(accessoryItemAddress('')).toBeNull();
  });

  it('builds addresses from the official issuer and never from a bare `d`', () => {
    // The registry — the only path to an address — always stamps the official
    // issuer, so a `d` tag alone can never produce one.
    const address = itemIdToAddress('food_apple')!;
    expect(address).toBe(`31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:blobbi:food:apple`);
  });
});

describe('projecting the catalog by accessory code', () => {
  it('returns an empty map when the catalog has not loaded', () => {
    expect(accessoryDefinitionsByCode(undefined).size).toBe(0);
  });

  it('returns an empty map while no accessory is mapped, whatever is loaded', () => {
    const catalog = new Map<string, ResolvedBlobbiItemDefinition>();
    const apple = itemIdToAddress('food_apple')!;
    catalog.set(apple, bundledFallbackDefinition(apple)!);
    expect(accessoryDefinitionsByCode(catalog).size).toBe(0);
  });

  it('walks the mapping, not the catalog, so an unmapped catalog costs nothing', () => {
    // A catalog full of items must not leak into the accessory map: only codes
    // named in the mapping can ever appear as keys.
    const catalog = new Map<string, ResolvedBlobbiItemDefinition>();
    for (const d of OFFICIAL_ITEM_D_TAGS) {
      const address = `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:${d}`;
      const definition = bundledFallbackDefinition(address);
      if (definition) catalog.set(address, definition);
    }
    const byCode = accessoryDefinitionsByCode(catalog);
    for (const code of byCode.keys()) {
      expect(Object.keys(ACCESSORY_CODE_TO_OFFICIAL_ITEM_D)).toContain(code);
    }
  });
});
