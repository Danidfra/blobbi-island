/**
 * Validation of the CURRENTLY PUBLISHED official kind:31632 events (Phase 9).
 *
 * These tests treat the sixteen supplied signed events as authoritative input
 * and fail the build if the canonical registry, the trusted effect registry or
 * the renderer disagrees with what is actually published. They run entirely on
 * bundled fixtures — no production relay is queried.
 *
 * They also pin the identity rules: stable addresses (issuer + `d`) are what
 * the runtime keys on, and the event ids here are current-revision facts that
 * activation must not depend on.
 */
import { describe, it, expect } from 'vitest';
import { verifyEvent, getEventHash } from 'nostr-tools/pure';
import type { Event as NostrToolsEvent } from 'nostr-tools/pure';

import {
  OFFICIAL_ITEM_EVENT_FIXTURES,
  WEARABLE_EVENT_FIXTURES,
  EFFECT_EVENT_FIXTURES,
  fixtureByD,
} from './official-item-event-fixtures';
import {
  ADDRESSED_VISUAL_EFFECT_ITEMS,
  resolveOfficialVisualEffectItem,
  VISUAL_EFFECT_ITEM_ISSUER,
} from './official-visual-effect-items';
import { parseOfficialItemDefinition } from '@/inventory/protocol-adapter';
import { resolveFromDefinition } from '@/inventory/protocol-adapter';
import {
  selectPrimaryGameItemImage,
  buildGameItemAddress,
  KIND_GAME_ITEM_DEFINITION,
} from '@/inventory/package';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';
import {
  ADDRESSED_OFFICIAL_COSMETICS,
  ADDRESSED_OFFICIAL_EFFECT_ITEMS,
  officialItemAddress,
} from '@/protocol/event-registry';
import {
  BLOBBI_VISUAL_EFFECT_IDS,
  EFFECT_SLOTS,
  isBlobbiVisualEffectId,
} from '@blobbi/react';

const ARCADE_PRIZE_DS = [
  'blobbi:effect:golden-sparkles',
  'blobbi:effect:mystic-fog',
  'blobbi:effect:celestial-aura',
];

function tagValue(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

function topics(tags: string[][]): string[] {
  return tags.filter(([n]) => n === 't').map(([, v]) => v as string);
}

describe('published official item events (fixtures)', () => {
  it('contains exactly sixteen events: four wearables, twelve effects', () => {
    expect(OFFICIAL_ITEM_EVENT_FIXTURES).toHaveLength(16);
    expect(WEARABLE_EVENT_FIXTURES).toHaveLength(4);
    expect(EFFECT_EVENT_FIXTURES).toHaveLength(12);
  });

  it('every event has a valid id hash and a valid signature from the official issuer', () => {
    for (const { d, event } of OFFICIAL_ITEM_EVENT_FIXTURES) {
      const e = event as unknown as NostrToolsEvent;
      expect(getEventHash(e), `${d}: id`).toBe(event.id);
      expect(verifyEvent(e), `${d}: sig`).toBe(true);
      expect(event.pubkey, `${d}: issuer`).toBe(OFFICIAL_ITEM_ISSUER_PUBKEY);
    }
  });

  it('every event is kind 31632 with required d, name and type', () => {
    for (const { d, event } of OFFICIAL_ITEM_EVENT_FIXTURES) {
      expect(event.kind).toBe(KIND_GAME_ITEM_DEFINITION);
      expect(tagValue(event.tags, 'd')).toBe(d);
      expect(tagValue(event.tags, 'name')).toBeTruthy();
      expect(tagValue(event.tags, 'type')).toBe('cosmetic');
    }
  });

  it('every event parses through the package parser with the issuer enforced', () => {
    for (const { d, event } of OFFICIAL_ITEM_EVENT_FIXTURES) {
      const parsed = parseOfficialItemDefinition(event);
      expect(parsed, d).not.toBeNull();
      expect(parsed!.issuer).toBe(OFFICIAL_ITEM_ISSUER_PUBKEY);
      expect(parsed!.address).toBe(
        buildGameItemAddress(OFFICIAL_ITEM_ISSUER_PUBKEY, d),
      );
    }
  });

  it('stable addresses are unique across all sixteen events', () => {
    const addresses = OFFICIAL_ITEM_EVENT_FIXTURES.map((f) =>
      buildGameItemAddress(OFFICIAL_ITEM_ISSUER_PUBKEY, f.d),
    );
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it('every event carries a resolvable primary image', () => {
    for (const { d, event } of OFFICIAL_ITEM_EVENT_FIXTURES) {
      const parsed = parseOfficialItemDefinition(event)!;
      const primary = selectPrimaryGameItemImage(parsed.images);
      expect(primary?.url, d).toMatch(/^https:\/\//);
    }
  });

  it('registry maxStack mirrors the published max_stack tag for all sixteen items', () => {
    for (const { d, kind, event } of OFFICIAL_ITEM_EVENT_FIXTURES) {
      const published = Number(tagValue(event.tags, 'max_stack'));
      const registered =
        kind === 'wearable'
          ? ADDRESSED_OFFICIAL_COSMETICS.find((c) => c.d === d)?.maxStack
          : ADDRESSED_OFFICIAL_EFFECT_ITEMS.find((e) => e.d === d)?.maxStack;
      expect(registered, d).toBe(published);
      expect(registered, d).toBe(1);
    }
  });

  it('event ids are all distinct from each other and never used as registry keys', () => {
    const ids = OFFICIAL_ITEM_EVENT_FIXTURES.map((f) => f.event.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The trusted registry resolves by ADDRESS. Feeding it an event id must
    // resolve nothing — ids are current-revision facts, not identity.
    for (const id of ids) {
      expect(resolveOfficialVisualEffectItem(id)).toBeNull();
    }
  });
});

describe('published wearable cosmetics agree with the canonical registry', () => {
  it('all four wearables are registered official cosmetics with matching fallbacks', () => {
    for (const { d, event } of WEARABLE_EVENT_FIXTURES) {
      const registered = ADDRESSED_OFFICIAL_COSMETICS.find((c) => c.d === d);
      expect(registered, d).toBeDefined();
      expect(registered!.address).toBe(officialItemAddress(d));
      expect(registered!.name).toBe(tagValue(event.tags, 'name'));
      expect(registered!.symbol).toBe(tagValue(event.tags, 'symbol'));
      expect(registered!.primaryImage).toBe(tagValue(event.tags, 'image'));
      expect(registered!.status).toBe('active');
    }
  });

  it('each wearable declares the expected visual slot in its signed content', () => {
    const expected: Record<string, string> = {
      'blobbi:cosmetic:celestial-seraph-necklace': 'neckwear',
      'blobbi:cosmetic:starlight-bow-tie': 'neckwear',
      'blobbi:cosmetic:block-builder-cap': 'headwear',
      'blobbi:cosmetic:stargazer-glasses': 'eyewear',
    };
    for (const { d, event } of WEARABLE_EVENT_FIXTURES) {
      const resolved = resolveFromDefinition(
        parseOfficialItemDefinition(event)!,
      );
      expect(resolved.slot, d).toBe(expected[d]);
      expect(resolved.forms, d).toEqual(['baby', 'adult']);
    }
  });
});

describe('published effect items agree with the trusted registry and the renderer', () => {
  it('all twelve effect definitions are cosmetic/effect with visual.kind blobbi-effect', () => {
    for (const { d, event } of EFFECT_EVENT_FIXTURES) {
      expect(tagValue(event.tags, 'type'), d).toBe('cosmetic');
      expect(tagValue(event.tags, 'category'), d).toBe('effect');
      expect(tagValue(event.tags, 'max_stack'), d).toBe('1');

      const resolved = resolveFromDefinition(
        parseOfficialItemDefinition(event)!,
      );
      expect(resolved.effectVisual?.kind, d).toBe('blobbi-effect');
    }
  });

  it('every published visual.effect matches the registered local effect id, which the renderer implements', () => {
    for (const { d, event } of EFFECT_EVENT_FIXTURES) {
      const address = officialItemAddress(d);
      const registration = resolveOfficialVisualEffectItem(address);
      expect(registration, d).not.toBeNull();

      const resolved = resolveFromDefinition(
        parseOfficialItemDefinition(event)!,
      );
      expect(resolved.effectVisual?.effect, d).toBe(registration!.effectId);
      expect(isBlobbiVisualEffectId(resolved.effectVisual?.effect), d).toBe(
        true,
      );
    }
  });

  it('every published visual.effectSlot matches the registered slot and the renderer slot', () => {
    for (const { d, event } of EFFECT_EVENT_FIXTURES) {
      const registration = resolveOfficialVisualEffectItem(
        officialItemAddress(d),
      )!;
      const resolved = resolveFromDefinition(
        parseOfficialItemDefinition(event)!,
      );
      expect(resolved.effectVisual?.effectSlot, d).toBe(
        registration.effectSlot,
      );
      expect(EFFECT_SLOTS[registration.effectId], d).toBe(
        registration.effectSlot,
      );
    }
  });

  it('every effect supports exactly baby and adult, as registered', () => {
    for (const { d, event } of EFFECT_EVENT_FIXTURES) {
      const resolved = resolveFromDefinition(
        parseOfficialItemDefinition(event)!,
      );
      expect(resolved.forms, d).toEqual(['baby', 'adult']);
      const registration = resolveOfficialVisualEffectItem(
        officialItemAddress(d),
      )!;
      expect([...registration.forms], d).toEqual(['baby', 'adult']);
    }
  });

  it('exactly Golden Sparkles, Mystic Fog and Celestial Aura carry arcade-prize — and the registry agrees', () => {
    const withTopic = EFFECT_EVENT_FIXTURES.filter((f) =>
      topics(f.event.tags).includes('arcade-prize'),
    ).map((f) => f.d);
    expect(withTopic.sort()).toEqual([...ARCADE_PRIZE_DS].sort());

    for (const entry of ADDRESSED_OFFICIAL_EFFECT_ITEMS) {
      expect(entry.arcadePrize, entry.d).toBe(
        ARCADE_PRIZE_DS.includes(entry.d),
      );
    }
  });

  it('registered names, symbols, images and rarities mirror the published events', () => {
    for (const { d, event } of EFFECT_EVENT_FIXTURES) {
      const entry = ADDRESSED_OFFICIAL_EFFECT_ITEMS.find((e) => e.d === d);
      expect(entry, d).toBeDefined();
      expect(entry!.name).toBe(tagValue(event.tags, 'name'));
      expect(entry!.symbol).toBe(tagValue(event.tags, 'symbol'));
      expect(entry!.primaryImage).toBe(tagValue(event.tags, 'image'));
      expect(entry!.rarity).toBe(tagValue(event.tags, 'rarity'));
      expect(entry!.status).toBe('active');
    }
  });

  it('Rainbow Dream follows the signed content, not the hand-off heading typo ("Rainbow Cream")', () => {
    const fixture = fixtureByD('blobbi:effect:rainbow-dream');
    expect(fixture).not.toBeNull();
    expect(tagValue(fixture!.event.tags, 'name')).toBe('Rainbow Dream');
    const registration = resolveOfficialVisualEffectItem(
      officialItemAddress('blobbi:effect:rainbow-dream'),
    );
    expect(registration?.name).toBe('Rainbow Dream');
    expect(registration?.effectId).toBe('rainbow-dream');
  });

  it('registry ↔ fixtures coverage is complete in both directions', () => {
    // Every published effect item is registered…
    for (const { d } of EFFECT_EVENT_FIXTURES) {
      expect(resolveOfficialVisualEffectItem(officialItemAddress(d)), d)
        .not.toBeNull();
    }
    // …every registered effect has a published fixture…
    for (const item of ADDRESSED_VISUAL_EFFECT_ITEMS) {
      expect(fixtureByD(item.d), item.d).not.toBeNull();
    }
    // …and together they cover every effect the renderer implements.
    const covered = new Set(
      ADDRESSED_VISUAL_EFFECT_ITEMS.map((i) => i.effectId),
    );
    expect([...covered].sort()).toEqual([...BLOBBI_VISUAL_EFFECT_IDS].sort());
  });

  it('a copied d under a different issuer forms a different address that resolves nothing', () => {
    const stranger =
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    for (const { d } of EFFECT_EVENT_FIXTURES) {
      const copied = buildGameItemAddress(stranger, d);
      expect(copied).not.toBe(officialItemAddress(d));
      expect(resolveOfficialVisualEffectItem(copied)).toBeNull();
    }
    expect(VISUAL_EFFECT_ITEM_ISSUER).toBe(OFFICIAL_ITEM_ISSUER_PUBKEY);
  });
});
