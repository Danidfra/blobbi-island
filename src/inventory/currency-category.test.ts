/**
 * Currency-category integration.
 *
 * The audit identified the exact failure mode being guarded against here: a
 * category the adapter does not know about silently degrades a perfectly valid
 * fetched definition to `unknown`, and an `unknown` item is then dropped from
 * every UI that groups by category. These tests prove `currency` survives the
 * whole path — relay definition → adapter → resolved view model → fallback —
 * while genuinely unknown categories still degrade safely.
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { buildGameItemDefinitionEvent } from '@nostr-games/inventory';

import {
  OFFICIAL_ITEM_ISSUER_PUBKEY,
  bundledFallbackDefinition,
  dTagToAddress,
  isOfficialItemAddress,
  parseOfficialItemDefinition,
  priceForAddress,
  resolveFromDefinition,
  resolveItemDefinition,
  SHOP_ENTRIES,
} from '@/inventory';
import { ARCADE_TICKET_D } from '@/protocol/event-registry';

const TICKET_ADDRESS = dTagToAddress(ARCADE_TICKET_D)!;

/** Build an issuer-signed kind:31632 event, as the official issuer would. */
function officialDefinitionEvent(overrides: {
  d: string;
  name: string;
  type: string;
  category?: string;
  image?: string;
  content?: unknown;
}): NostrEvent {
  const template = buildGameItemDefinitionEvent({
    id: overrides.d,
    name: overrides.name,
    type: overrides.type,
    category: overrides.category,
    image: overrides.image,
    content: overrides.content ?? '',
  });
  return {
    id: 'evt',
    pubkey: OFFICIAL_ITEM_ISSUER_PUBKEY,
    created_at: 1000,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
}

describe('protocol adapter accepts the currency category', () => {
  it('keeps `currency` instead of degrading it to unknown', () => {
    const def = parseOfficialItemDefinition(
      officialDefinitionEvent({
        d: ARCADE_TICKET_D,
        name: 'Arcade Ticket',
        type: 'currency',
        category: 'currency',
      }),
    )!;
    const resolved = resolveFromDefinition(def);

    expect(resolved.category).toBe('currency');
    expect(resolved.source).toBe('definition');
  });

  it('still classifies a genuinely unrecognised category as unknown', () => {
    const def = parseOfficialItemDefinition(
      officialDefinitionEvent({
        d: ARCADE_TICKET_D,
        name: 'Arcade Ticket',
        type: 'currency',
        category: 'wildcard-category',
      }),
    )!;
    const resolved = resolveFromDefinition(def);

    // Falls back to the bundled category rather than trusting a category the
    // client does not understand.
    expect(resolved.category).toBe('currency');

    // For an address with NO bundled fallback there is nothing to fall back to,
    // so it degrades to `unknown` — which is the safe classification.
    const stranger = resolveItemDefinition(
      '31632:deadbeef:blobbi:mystery:thing',
      new Map(),
      'blobbi:mystery:thing',
    );
    expect(stranger.category).toBe('unknown');
    expect(stranger.action).toBeNull();
  });

  it('does not infer a gameplay action from the category name', () => {
    const def = parseOfficialItemDefinition(
      officialDefinitionEvent({
        d: ARCADE_TICKET_D,
        name: 'Arcade Ticket',
        type: 'currency',
        category: 'currency',
      }),
    )!;
    expect(resolveFromDefinition(def).action).toBeNull();
  });
});

describe('Arcade Ticket in the local catalog', () => {
  it('is registered under the canonical d and official address', () => {
    expect(ARCADE_TICKET_D).toBe('blobbi:currency:arcade-ticket');
    expect(TICKET_ADDRESS).toBe(
      `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:blobbi:currency:arcade-ticket`,
    );
    expect(isOfficialItemAddress(TICKET_ADDRESS)).toBe(true);
  });

  it('is present in the bundled fallback catalog', () => {
    const fallback = bundledFallbackDefinition(TICKET_ADDRESS);
    expect(fallback).not.toBeNull();
    expect(fallback!.source).toBe('fallback');
    expect(fallback!.name).toBe('Arcade Ticket');
    expect(fallback!.category).toBe('currency');
    expect(fallback!.emoji).toBe('🎟️');
  });

  it('has no action and no care effects in the fallback', () => {
    const fallback = bundledFallbackDefinition(TICKET_ADDRESS)!;
    expect(fallback.action).toBeNull();
    expect(fallback.effects).toEqual({});
  });

  it('carries the production artwork in the OFFLINE fallback', () => {
    // The artwork is live, so the bundled fallback renders the real image even
    // with every definition relay unreachable. The emoji stays as the last
    // resort if the image itself cannot load.
    const fallback = bundledFallbackDefinition(TICKET_ADDRESS)!;
    expect(fallback.image).toBe(
      'https://assets.blobbi.pet/items/arcade/arcade-ticket-v1.webp',
    );
    expect(fallback.emoji).toBe('🎟️');
  });

  it('resolves from a relay definition once one is published', () => {
    const def = parseOfficialItemDefinition(
      officialDefinitionEvent({
        d: ARCADE_TICKET_D,
        name: 'Arcade Ticket',
        type: 'currency',
        category: 'currency',
        image: 'https://cdn.example/arcade-ticket.png',
        content: {
          metadata: {
            itemId: 'cur_arcade_ticket',
            emoji: '🎟️',
            stackable: true,
          },
        },
      }),
    )!;
    const resolved = resolveItemDefinition(
      TICKET_ADDRESS,
      new Map([[TICKET_ADDRESS, def]]),
    );

    expect(resolved.source).toBe('definition');
    expect(resolved.name).toBe('Arcade Ticket');
    expect(resolved.category).toBe('currency');
    expect(resolved.action).toBeNull();
    expect(resolved.effects).toEqual({});
    // A published image takes precedence over the emoji fallback.
    expect(resolved.image).toBe('https://cdn.example/arcade-ticket.png');
  });
});

describe('currency is not purchasable', () => {
  it('is absent from the shop catalog', () => {
    expect(SHOP_ENTRIES.some((e) => e.address === TICKET_ADDRESS)).toBe(false);
    expect(SHOP_ENTRIES).toHaveLength(19);
  });

  it('has no price, so a purchase attempt is rejected as "not for sale"', () => {
    // `usePurchaseItem` throws when `priceForAddress` returns null. A price of
    // 0 would have meant "free", which is why the shop no longer defaults.
    expect(priceForAddress(TICKET_ADDRESS)).toBeNull();
  });

  it('never prices any item at zero', () => {
    for (const entry of SHOP_ENTRIES) {
      expect(entry.price, entry.itemId).toBeGreaterThan(0);
    }
  });
});
