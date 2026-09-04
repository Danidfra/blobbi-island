/**
 * The compatibility policy: what an external item DOES to a Blobbi.
 *
 * The definition is the issuer's; the interpretation is Island's; and the
 * two-part opt-in (trusted issuer granted the profile + generic semantics on
 * the item) has to hold on BOTH sides for anything to become usable.
 */

import { describe, it, expect } from 'vitest';

import {
  FOOD_SEGMENT_HUNGER,
  applyExternalCompatibility,
  externalCompatibilityEffects,
  hasRawProduceSemantics,
  resolveExternalItemCompatibility,
} from './external-item-compatibility';
import { parseTrustedItemDefinition, resolveFromDefinition } from './protocol-adapter';
import { FARM_STRAWBERRY_EVENT } from './partner-item-event-fixtures';
import { bundledFallbackDefinition } from './catalog-fallback';
import { itemIdToAddress } from './registry';
import type { ResolvedBlobbiItemDefinition } from './catalog-fallback';

const FARM_ISSUER = 'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';
const STRANGER = 'd'.repeat(64);

const strawberry = resolveFromDefinition(parseTrustedItemDefinition(FARM_STRAWBERRY_EVENT)!);

function withAddress(def: ResolvedBlobbiItemDefinition, address: string): ResolvedBlobbiItemDefinition {
  return { ...def, address };
}

describe('raw produce', () => {
  it('the real Farm Strawberry resolves to raw-produce, one segment, feed', () => {
    expect(resolveExternalItemCompatibility({ definition: strawberry, sourceInventoryId: 'farm:main' })).toEqual({
      action: 'feed',
      profile: 'raw-produce',
      hungerSegments: 1,
    });
  });

  it('raw-produce maps to exactly ONE food segment of hunger and nothing else', () => {
    const compat = resolveExternalItemCompatibility({ definition: strawberry })!;
    expect(externalCompatibilityEffects(compat)).toEqual({ hunger: FOOD_SEGMENT_HUNGER });
    expect(FOOD_SEGMENT_HUNGER).toBe(25);
  });

  it('lays Island\'s interpretation over the issuer\'s definition without touching its identity', () => {
    const compat = resolveExternalItemCompatibility({ definition: strawberry })!;
    const applied = applyExternalCompatibility(strawberry, compat);
    expect(applied.action).toBe('feed');
    expect(applied.effects).toEqual({ hunger: 25 });
    expect(applied.stages).toEqual(['baby', 'adult']);
    // Identity untouched: full address, name, art, category, topics, rarity.
    expect(applied.address).toBe(strawberry.address);
    expect(applied.name).toBe('Strawberry');
    expect(applied.image).toBe(strawberry.image);
    expect(applied.category).toBe('food');
    expect(applied.topics).toEqual(strawberry.topics);
    // The source definition is not mutated.
    expect(strawberry.action).toBeNull();
    expect(strawberry.effects).toEqual({});
  });
});

describe('what does NOT become usable', () => {
  it('a trusted issuer\'s item without edible-food semantics, category alone is not enough', () => {
    const material = { ...strawberry, type: 'material', topics: ['crop'] };
    expect(hasRawProduceSemantics(material)).toBe(false);
    expect(resolveExternalItemCompatibility({ definition: material })).toBeNull();

    const notEdible = { ...strawberry, topics: ['fruit'] };
    expect(resolveExternalItemCompatibility({ definition: notEdible })).toBeNull();

    const notFood = { ...strawberry, category: 'toy' as const };
    expect(resolveExternalItemCompatibility({ definition: notFood })).toBeNull();
  });

  it('the same semantics under an UNTRUSTED issuer', () => {
    const impostor = withAddress(strawberry, `31632:${STRANGER}:farm:produce:strawberry`);
    expect(hasRawProduceSemantics(impostor)).toBe(true);
    expect(resolveExternalItemCompatibility({ definition: impostor })).toBeNull();
  });

  it('identity is the FULL address: the same `d` under another key is another item', () => {
    const ok = withAddress(strawberry, `31632:${FARM_ISSUER}:farm:produce:strawberry`);
    const other = withAddress(strawberry, `31632:${STRANGER}:farm:produce:strawberry`);
    expect(resolveExternalItemCompatibility({ definition: ok })).not.toBeNull();
    expect(resolveExternalItemCompatibility({ definition: other })).toBeNull();
  });

  it('Blobbi\'s own official food never passes through the cross-game policy', () => {
    const apple = bundledFallbackDefinition(itemIdToAddress('food_apple')!)!;
    expect(resolveExternalItemCompatibility({ definition: apple })).toBeNull();
  });

  it('a malformed address is nothing', () => {
    expect(resolveExternalItemCompatibility({ definition: withAddress(strawberry, 'farm:produce:strawberry') })).toBeNull();
  });
});
