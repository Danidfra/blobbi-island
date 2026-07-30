/**
 * The Block Builder Cap, end to end: published event → catalog → accessory code
 * → the URLs the renderer paints.
 *
 * This is the first accessory to be activated through the item protocol, so the
 * test is deliberately built on the REAL published tags (fetched from
 * wss://relay.ditto.pub, see `docs/accessory-definition-migration.md`) rather
 * than a convenient fixture. Every layer in between runs for real: the issuer
 * check, the package parser, the Island resolver and the pose policy. A fixture
 * would prove the plumbing works on invented data; this proves it works on the
 * event that actually exists.
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
import {
  accessoryDefinitionsByCode,
  accessoryItemAddress,
} from './accessory-item-identity';
import { primaryItemImageUrl, itemImagesByMarker } from './item-image-resolution';
import type { ResolvedBlobbiItemDefinition } from './catalog-fallback';
import { createIslandAccessorySourceResolver } from '@/components/blobbi/lib/island-accessory-sources';
import { accessoryImagePath } from '@/lib/asset-paths';
import type { NostrEvent } from '@nostrify/nostrify';

const CODE = 'headwear-block-builder-cap';
const D = 'blobbi:cosmetic:block-builder-cap';

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
 * NOTE the `front` view carries the SAME url as the unmarked primary — that is
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
  return accessoryDefinitionsByCode(loadedCatalog()).get(CODE)!;
}

describe('address and issuer', () => {
  it('builds the full official address from issuer + d', () => {
    expect(accessoryItemAddress(CODE)).toBe(
      `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:${D}`,
    );
  });

  it('parses the published event as an official definition', () => {
    const parsed = parseOfficialItemDefinition(capEvent());
    expect(parsed?.address).toBe(accessoryItemAddress(CODE));
  });

  it('rejects the same d published by a third party', () => {
    const stranger = 'd'.repeat(64);
    expect(parseOfficialItemDefinition(capEvent(stranger))).toBeNull();
    // …and therefore never reaches the accessory map.
    expect(accessoryDefinitionsByCode(loadedCatalog(capEvent(stranger))).size).toBe(0);
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
    const resolve = (facing: 'front' | 'back') =>
      createIslandAccessorySourceResolver({
        definitionsByCode: accessoryDefinitionsByCode(loadedCatalog()),
        facing,
      })({ code: CODE, slot: 'headwear', url: '' });

    expect(resolve('front')[0]).not.toBe(IMG.sideRight);
    expect(resolve('back')[0]).not.toBe(IMG.sideLeft);
  });

  it('paints the front image first for a front-facing Blobbi', () => {
    const sources = createIslandAccessorySourceResolver({
      definitionsByCode: accessoryDefinitionsByCode(loadedCatalog()),
      facing: 'front',
    })({ code: CODE, slot: 'headwear', url: '' });

    expect(sources[0]).toBe(IMG.primary); // the `front` view, same URL as primary
  });

  it('paints the back image first for a back-facing Blobbi', () => {
    const sources = createIslandAccessorySourceResolver({
      definitionsByCode: accessoryDefinitionsByCode(loadedCatalog()),
      facing: 'back',
    })({ code: CODE, slot: 'headwear', url: '' });

    expect(sources[0]).toBe(IMG.back);
    // The front/primary stays behind it as an onError fallback, so a dead
    // Blossom link degrades to a drawable hat rather than a hole.
    expect(sources).toContain(IMG.primary);
  });

  it('outranks the inferred local path, but keeps it as a last resort', () => {
    const sources = createIslandAccessorySourceResolver({
      definitionsByCode: accessoryDefinitionsByCode(loadedCatalog()),
      facing: 'front',
    })({ code: CODE, slot: 'headwear', url: '' });

    const png = accessoryImagePath('headwear', CODE, 'png');
    expect(sources.indexOf(IMG.primary)).toBeLessThan(sources.indexOf(png));
    expect(sources).toContain(png);
  });
});

describe('when the definition is temporarily unavailable', () => {
  it('still renders through the legacy chain', () => {
    // Relay outage / cold cache: no definitions at all. The accessory must not
    // vanish — the stored equip URL and the local paths still answer.
    const stored = 'https://stored.invalid/cap.png';
    const sources = createIslandAccessorySourceResolver({
      definitionsByCode: new Map(),
      facing: 'front',
    })({ code: CODE, slot: 'headwear', url: stored });

    expect(sources[0]).toBe(stored);
    expect(sources.length).toBeGreaterThan(1);
  });
});

describe('unmapped accessories are untouched', () => {
  it('resolves headwear-8 exactly as before, definition or not', () => {
    const withCatalog = createIslandAccessorySourceResolver({
      definitionsByCode: accessoryDefinitionsByCode(loadedCatalog()),
      facing: 'front',
    })({ code: 'headwear-8', slot: 'headwear', url: '' });

    const withoutCatalog = createIslandAccessorySourceResolver({
      definitionsByCode: new Map(),
      facing: 'front',
    })({ code: 'headwear-8', slot: 'headwear', url: '' });

    expect(withCatalog).toEqual(withoutCatalog);
    expect(withCatalog).not.toContain(IMG.primary);
  });
});
