/**
 * The Block Builder Cap, end to end: published event → catalog → the URLs the
 * renderer paints.
 *
 * Built on the REAL published tags (fetched from wss://relay.ditto.pub, see
 * `docs/accessory-definition-migration.md`) rather than a convenient fixture.
 * Every layer in between runs for real: the issuer check, the package parser,
 * the Island resolver and the pose policy. A fixture would prove the plumbing
 * works on invented data; this proves it works on the event that exists.
 *
 * Since the kind:31634 migration the identity is the ADDRESS. There is no
 * accessory code and no filename fallback left, so the cases that used to
 * assert a legacy chain now assert its absence: an item with no published
 * definition resolves to no artwork at all.
 *
 * Nothing here signs, publishes or reaches a relay.
 */

import { describe, it, expect } from 'vitest';

import { OFFICIAL_ITEM_ISSUER_PUBKEY } from './constants';
import { KIND_GAME_ITEM_DEFINITION } from './package';
import {
  parseOfficialItemDefinition,
  resolveFromDefinition,
} from './protocol-adapter';
import { primaryItemImageUrl, itemImagesByMarker } from './item-image-resolution';
import type { ResolvedBlobbiItemDefinition } from './catalog-fallback';
import { createPlacementAccessorySourceResolver } from '@/placement/accessory-sources';
import { officialItemAddress } from '@/protocol/event-registry';
import type { NostrEvent } from '@nostrify/nostrify';

const D = 'blobbi:cosmetic:block-builder-cap';
const ADDRESS = officialItemAddress(D);

/** The four artwork URLs of the published definition. */
const IMG = {
  primary:
    'https://blossom.primal.net/11ed179592981472e25b9a327d8c6bfd55b7a3bae0a8d805e071b8ba4e47d1dc.webp',
  sideRight:
    'https://blossom.primal.net/3e590f6e43040a399e196d32ea636da31ac23520854e1971988237e8a18d9825.webp',
  sideLeft:
    'https://blossom.primal.net/5175d1b0ff2b5f698b62c10fb21bb07d78507a556f39ec33b75e50d6b70d8f9c.webp',
  back: 'https://blossom.primal.net/10f1f328c6c77c6cb9ed10c16cb66c185dafcba005c7f5640d678a416bdda3bc.webp',
} as const;

/**
 * The published event, tag for tag.
 *
 * NOTE the `front` view carries the SAME url as the unmarked primary; that is
 * what the issuer published, and several assertions below depend on the tests
 * not quietly "fixing" it.
 */
function capEvent(pubkey: string = OFFICIAL_ITEM_ISSUER_PUBKEY): NostrEvent {
  return {
    id: '8552d790b7cd6ab1585329ea1e21d3386d1bba70d5b511e6446681c43af672ed',
    pubkey,
    created_at: 1785438784,
    kind: KIND_GAME_ITEM_DEFINITION,
    content: JSON.stringify({
      description:
        'A playful cap for Blobbis who love stacking blocks, building strange little worlds, and turning every idea into an adventure.',
      metadata: { itemId: 'block-builder-cap', stackable: false },
      visual: { slot: 'headwear', forms: ['baby', 'adult'] },
    }),
    tags: [
      ['d', D],
      ['name', 'Block Builder Cap'],
      ['type', 'cosmetic'],
      ['category', 'headwear'],
      ['image', IMG.primary],
      ['image', IMG.primary, 'front'],
      ['image', IMG.sideRight, 'side-right'],
      ['image', IMG.sideLeft, 'side-left'],
      ['image', IMG.back, 'back'],
      ['symbol', '🧢'],
      ['rarity', 'uncommon'],
      ['max_stack', '1'],
      ['version', '1'],
      ['context', 'game:blobbi'],
      ['context', 'game:blobbi-island'],
      ['t', 'equipable'],
      ['t', 'wearable'],
      ['t', 'cosmetic'],
      ['t', 'headwear'],
      ['alt', 'Game item definition: Block Builder Cap'],
      ['client', 'blobbi'],
    ],
    sig: '0'.repeat(128),
  };
}

/** The catalog the app would hold once the definition is fetched. */
function loadedCatalog(
  event: NostrEvent = capEvent(),
): ReadonlyMap<string, ResolvedBlobbiItemDefinition> {
  const parsed = parseOfficialItemDefinition(event);
  if (!parsed) return new Map();
  return new Map([[parsed.address, resolveFromDefinition(parsed)]]);
}

function capDefinition(): ResolvedBlobbiItemDefinition {
  return loadedCatalog().get(ADDRESS)!;
}

/** The renderer's candidate list for the cap, for a given pose. */
function capSources(
  facing: 'front' | 'back',
  definitions = loadedCatalog(),
): readonly string[] {
  return createPlacementAccessorySourceResolver({
    definitionsByAddress: definitions,
    facing,
  })({ code: ADDRESS, slot: 'headwear' });
}

describe('address and issuer', () => {
  it('builds the full official address from issuer + d', () => {
    expect(ADDRESS).toBe(`31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:${D}`);
  });

  it('parses the published event as an official definition', () => {
    const parsed = parseOfficialItemDefinition(capEvent());
    expect(parsed?.address).toBe(ADDRESS);
  });

  it('rejects the same d published by a third party', () => {
    const stranger = 'd'.repeat(64);
    expect(parseOfficialItemDefinition(capEvent(stranger))).toBeNull();
    // …and therefore never reaches the catalog.
    expect(loadedCatalog(capEvent(stranger)).size).toBe(0);
  });
});

describe('metadata comes from the definition', () => {
  it('reads name, type and topics off the published event', () => {
    const definition = capDefinition();
    expect(definition.name).toBe('Block Builder Cap');
    expect(definition.type).toBe('cosmetic');
    expect(definition.topics).toContain('wearable');
  });

  it('is not usable on a Blobbi: a cosmetic has no care action', () => {
    expect(capDefinition().action).toBeNull();
  });
});

describe('image views', () => {
  it('uses the primary image in compact UI', () => {
    expect(primaryItemImageUrl(capDefinition())).toBe(IMG.primary);
  });

  it('preserves the side views without ever posing them', () => {
    const definition = capDefinition();
    // Parsed and reachable…
    expect(itemImagesByMarker(definition, 'side-right')[0]?.url).toBe(IMG.sideRight);
    expect(itemImagesByMarker(definition, 'side-left')[0]?.url).toBe(IMG.sideLeft);

    // …but never chosen for a front or back pose, because they are different
    // camera angles rather than better versions of the same one.
    expect(capSources('front')[0]).not.toBe(IMG.sideRight);
    expect(capSources('back')[0]).not.toBe(IMG.sideLeft);
  });

  it('paints the front image first for a front-facing Blobbi', () => {
    // The `front` view happens to carry the same URL as the primary.
    expect(capSources('front')[0]).toBe(IMG.primary);
  });

  it('paints the back image first for a back-facing Blobbi', () => {
    const sources = capSources('back');
    expect(sources[0]).toBe(IMG.back);
    // The front/primary stays behind it as an onError fallback, so a dead
    // Blossom link degrades to a drawable hat rather than a hole.
    expect(sources).toContain(IMG.primary);
  });

  it('offers only published artwork; no inferred local path', () => {
    // The legacy chain appended `/assets/.../headwear/<code>.{webp,png}` here.
    // Nothing does any more: an address is not a filename.
    const sources = capSources('front');
    expect(sources.every((url) => url.startsWith('https://blossom.primal.net/'))).toBe(
      true,
    );
    expect(sources.some((url) => url.includes('/assets/'))).toBe(false);
  });
});

describe('when the definition is unavailable', () => {
  it('resolves to no artwork rather than guessing a path', () => {
    // Relay outage / cold cache / never published: all the same answer. The
    // item is not drawn, which is the honest outcome once identity is an
    // address and there is no filename convention to fall back on.
    expect(capSources('front', new Map())).toEqual([]);
  });

  it('resolves nothing for an address that is not in the catalog', () => {
    const sources = createPlacementAccessorySourceResolver({
      definitionsByAddress: loadedCatalog(),
      facing: 'front',
    })({ code: '31632:stranger:blobbi:cosmetic:other', slot: 'headwear' });
    expect(sources).toEqual([]);
  });
});
