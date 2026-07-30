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
import {
  bundledCosmeticFallbackDefinition,
  bundledFallbackDefinition,
  type ResolvedBlobbiItemDefinition,
} from './catalog-fallback';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from './constants';
import {
  OFFICIAL_COSMETIC_D_TAGS,
  OFFICIAL_ITEM_D_TAGS,
  itemIdToAddress,
} from './registry';
import {
  ACCESSORY_CODE_PATTERN,
} from '@/components/blobbi/lib/accessory-types';
import { inferSlotFromCode } from '@/components/blobbi/lib/accessory-utils';

describe('accessory → definition mapping', () => {
  it('maps the Block Builder Cap, and nothing that is not published', () => {
    expect(ACCESSORY_CODE_TO_OFFICIAL_ITEM_D).toEqual({
      'headwear-block-builder-cap': 'blobbi:cosmetic:block-builder-cap',
    });
    expect(HAS_ACCESSORY_ITEM_DEFINITIONS).toBe(true);
  });

  it('only ever maps onto `d` tags the official COSMETIC registry knows', () => {
    // Cosmetics are a separate identity list from consumables — a hat is not a
    // care item — so the mapping is checked against the cosmetic `d` tags. What
    // is unchanged is that the `d` must be declared in this repository.
    for (const d of Object.values(ACCESSORY_CODE_TO_OFFICIAL_ITEM_D)) {
      expect(OFFICIAL_COSMETIC_D_TAGS).toContain(d);
      expect(OFFICIAL_ITEM_D_TAGS).not.toContain(d);
    }
  });

  it('resolves nothing for an unmapped code', () => {
    expect(accessoryItemAddress('headwear-8')).toBeNull();
    expect(accessoryItemAddress('')).toBeNull();
  });

  it('builds the Block Builder Cap address from the official issuer', () => {
    expect(accessoryItemAddress('headwear-block-builder-cap')).toBe(
      `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:blobbi:cosmetic:block-builder-cap`,
    );
  });

  it('wears a code whose prefix infers the slot the definition declares', () => {
    // The mapping stores no slot of its own; the code's prefix is the slot. The
    // published definition says `visual.slot: headwear`, and the transitional
    // code must agree with it or the accessory would be drawn in the wrong place.
    expect(inferSlotFromCode('headwear-block-builder-cap')).toBe('headwear');
    expect(ACCESSORY_CODE_PATTERN.test('headwear-block-builder-cap')).toBe(true);
  });

  it('does not collide with the numeric local-artwork series', () => {
    // `headwear-1` … `headwear-21` are backed by files in public/assets. The
    // transitional code is a slug precisely so it can never be mistaken for the
    // next one of those, or be shadowed when that file eventually ships.
    expect('headwear-block-builder-cap').not.toMatch(/^headwear-\d+$/);
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

  it('returns an empty map when the loaded catalog holds no cosmetic', () => {
    const catalog = new Map<string, ResolvedBlobbiItemDefinition>();
    const apple = itemIdToAddress('food_apple')!;
    catalog.set(apple, bundledFallbackDefinition(apple)!);
    expect(accessoryDefinitionsByCode(catalog).size).toBe(0);
  });

  it('projects a loaded cosmetic under its legacy code', () => {
    const address = accessoryItemAddress('headwear-block-builder-cap')!;
    const catalog = new Map<string, ResolvedBlobbiItemDefinition>([
      [address, bundledCosmeticFallbackDefinition(address)!],
    ]);

    const byCode = accessoryDefinitionsByCode(catalog);
    expect(byCode.get('headwear-block-builder-cap')?.name).toBe(
      'Block Builder Cap',
    );
  });

  it('ignores a same-`d` definition published by a different issuer', () => {
    // THE TRUST TEST. A stranger publishes `blobbi:cosmetic:block-builder-cap`
    // — a legal, addressable event that relays will serve. It lands in a catalog
    // keyed by ITS OWN address, which is not the address the mapping resolves,
    // so it can never describe the player's hat.
    const stranger = 'd'.repeat(64);
    const strangerAddress = `31632:${stranger}:blobbi:cosmetic:block-builder-cap`;
    expect(strangerAddress).not.toBe(
      accessoryItemAddress('headwear-block-builder-cap'),
    );

    const catalog = new Map<string, ResolvedBlobbiItemDefinition>([
      [
        strangerAddress,
        {
          ...bundledCosmeticFallbackDefinition(
            accessoryItemAddress('headwear-block-builder-cap')!,
          )!,
          address: strangerAddress,
          name: 'Totally Legit Cap',
          image: 'https://attacker.invalid/not-a-cap.png',
          images: [{ url: 'https://attacker.invalid/not-a-cap.png' }],
        },
      ],
    ]);

    expect(accessoryDefinitionsByCode(catalog).size).toBe(0);
  });

  it('does not imply ownership: a mapping is metadata, not inventory', () => {
    // Nothing in this module reads or writes `inv`/`equip` state. A resolvable
    // definition means "this is what that hat looks like", never "the player
    // has one" or "the player is wearing it".
    const address = accessoryItemAddress('headwear-block-builder-cap')!;
    const catalog = new Map<string, ResolvedBlobbiItemDefinition>([
      [address, bundledCosmeticFallbackDefinition(address)!],
    ]);
    const definition = accessoryDefinitionsByCode(catalog).get(
      'headwear-block-builder-cap',
    )!;

    expect(definition).not.toHaveProperty('quantity');
    expect(definition).not.toHaveProperty('owned');
    expect(definition).not.toHaveProperty('equipped');
    // And it cannot enter a care flow: `useUseItem` rejects a null action.
    expect(definition.action).toBeNull();
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
