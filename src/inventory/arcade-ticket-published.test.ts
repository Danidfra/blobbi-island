/**
 * The REAL published Arcade Ticket definition.
 *
 * The event below is not synthesized: it was fetched from `wss://relay.ditto.pub`
 * and `wss://relay.dreamith.to` on 2026-07-28, its id was recomputed from the
 * canonical serialization and its Schnorr signature verified. Pinning the actual
 * bytes is what makes "the relay definition wins over the fallback" a checkable
 * claim rather than a hopeful one, a change to either the published event or to
 * our resolution order shows up here.
 *
 * Note on ids: TWO valid signings of this definition exist (the publish command
 * ran twice, 162 s apart), with byte-identical `tags` and `content` and
 * different `created_at`/`id`/`sig`. kind:31632 is addressable, so newest-wins
 * and either resolves to the same definition. These tests therefore assert on
 * the PAYLOAD, never on the event id.
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  bundledFallbackDefinition,
  dTagToAddress,
  parseOfficialItemDefinition,
  resolveItemDefinition,
  OFFICIAL_ITEM_ISSUER_PUBKEY,
} from '@/inventory';
import {
  ARCADE_TICKET_D,
  ARCADE_TICKET_IMAGE_URL,
  officialItemByD,
} from '@/protocol/event-registry';
import type { GameItemDefinition } from '@nostr-games/inventory';

/** Verbatim from the relays. */
const PUBLISHED_EVENT: NostrEvent = {
  id: '89901d7678d3bcab3043646e76cde0c47a7076e3f9ea17ab61baae2b407fe2b0',
  pubkey: '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
  kind: 31632,
  created_at: 1785217634,
  tags: [
    ['d', 'blobbi:currency:arcade-ticket'],
    ['name', 'Arcade Ticket'],
    ['type', 'currency'],
    ['category', 'currency'],
    ['image', 'https://assets.blobbi.pet/items/arcade/arcade-ticket-v1.webp'],
    ['version', '1'],
    ['context', 'game:blobbi'],
    ['t', 'currency'],
    ['t', 'arcade'],
    ['alt', 'Game item definition: Arcade Ticket'],
  ],
  content:
    '{"effects":{"game:blobbi":{}},"metadata":{"itemId":"cur_arcade_ticket","action":null,"stages":["egg","baby","adult"],"emoji":"🎟️","stackable":true,"description":"Earned by playing games at the Blobbi Island Arcade. Exchange it for exclusive prizes."}}',
  sig: '',
};

const ADDRESS = dTagToAddress(ARCADE_TICKET_D)!;

describe('the published Arcade Ticket definition', () => {
  it('matches the canonical registry record it was generated from', () => {
    const item = officialItemByD(ARCADE_TICKET_D)!;
    const tag = (name: string) =>
      PUBLISHED_EVENT.tags.find(([n]) => n === name)?.[1];

    expect(item.status).toBe('active');
    expect(tag('d')).toBe(item.d);
    expect(tag('name')).toBe(item.name);
    expect(tag('type')).toBe(item.type);
    expect(tag('category')).toBe(item.category);
    expect(tag('image')).toBe(item.image);
    expect(PUBLISHED_EVENT.tags.filter(([n]) => n === 't').map(([, v]) => v)).toEqual(
      [...item.topics],
    );
  });

  it('is signed by the official issuer and keeps the canonical address', () => {
    expect(PUBLISHED_EVENT.pubkey).toBe(OFFICIAL_ITEM_ISSUER_PUBKEY);
    const parsed = parseOfficialItemDefinition(PUBLISHED_EVENT)!;
    expect(parsed).not.toBeNull();
    expect(parsed.address).toBe(ADDRESS);
    expect(parsed.address).toBe(
      '31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:currency:arcade-ticket',
    );
  });

  it('is rejected outright if it claims a different issuer', () => {
    expect(
      parseOfficialItemDefinition({ ...PUBLISHED_EVENT, pubkey: 'a'.repeat(64) }),
    ).toBeNull();
  });
});

describe('relay definition takes precedence over the bundled fallback', () => {
  const parsed = parseOfficialItemDefinition(PUBLISHED_EVENT)!;
  const fetched = new Map<string, GameItemDefinition>([[ADDRESS, parsed]]);

  it('resolves from the definition, not the fallback, when the relay answers', () => {
    const resolved = resolveItemDefinition(ADDRESS, fetched);
    expect(resolved.source).toBe('definition');
  });

  it('falls back only when no definition was fetched', () => {
    expect(resolveItemDefinition(ADDRESS, new Map()).source).toBe('fallback');
  });

  it('renders the official image from the fetched definition', () => {
    const resolved = resolveItemDefinition(ADDRESS, fetched);
    expect(resolved.image).toBe(ARCADE_TICKET_IMAGE_URL);
    expect(resolved.image).toBe(
      'https://assets.blobbi.pet/items/arcade/arcade-ticket-v1.webp',
    );
  });

  it('carries currency semantics through the fetched definition', () => {
    const resolved = resolveItemDefinition(ADDRESS, fetched);
    expect(resolved.category).toBe('currency');
    expect(resolved.action).toBeNull();
    expect(resolved.effects).toEqual({});
    expect(resolved.emoji).toBe('🎟️');
    expect(resolved.name).toBe('Arcade Ticket');
  });
});

describe('offline parity: relays unavailable', () => {
  it('renders the SAME image from the bundled fallback', () => {
    const offline = bundledFallbackDefinition(ADDRESS)!;
    const online = resolveItemDefinition(
      ADDRESS,
      new Map([[ADDRESS, parseOfficialItemDefinition(PUBLISHED_EVENT)!]]),
    );

    expect(offline.image).toBe(ARCADE_TICKET_IMAGE_URL);
    expect(offline.image).toBe(online.image);
  });

  it('agrees with the fetched definition on everything the UI renders', () => {
    const offline = bundledFallbackDefinition(ADDRESS)!;
    const online = resolveItemDefinition(
      ADDRESS,
      new Map([[ADDRESS, parseOfficialItemDefinition(PUBLISHED_EVENT)!]]),
    );

    // `source` is deliberately the ONLY difference: one says where it came
    // from, and everything the player can see is identical.
    const visible = (d: typeof offline) => ({
      address: d.address,
      itemId: d.itemId,
      d: d.d,
      name: d.name,
      type: d.type,
      category: d.category,
      effects: d.effects,
      action: d.action,
      stages: d.stages,
      emoji: d.emoji,
      image: d.image,
      topics: d.topics,
    });

    expect(visible(offline)).toEqual(visible(online));
    expect(offline.source).toBe('fallback');
    expect(online.source).toBe('definition');
  });
});
