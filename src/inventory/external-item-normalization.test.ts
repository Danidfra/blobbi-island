/**
 * The interoperability claim, proved against a real signed event.
 *
 * Two things are asserted here, and they are the load-bearing ones for the
 * whole cross-game feature:
 *
 * 1. **Island already understands a partner's item generically.** The Farm's
 *    Strawberry definition contains no Blobbi vocabulary at all — no item id,
 *    no action, no stages, no effects, no slot — and the EXISTING
 *    `resolveFromDefinition` still produces a correct, renderable item from it.
 *    No Farm-specific parsing was added to make this true.
 *
 * 2. **Trust did not widen.** `parseOfficialItemDefinition` means exactly what
 *    it meant before: official BLOBBI items only. The partner path is a
 *    separate, narrower-purpose parser, and the trust decision it makes is
 *    about the ISSUER's whole pubkey — never about a `d`.
 *
 * The fixture's id and signature are verified first, so an assertion about how
 * Strawberry resolves is an assertion about a real published event and not
 * about a plausible-looking object.
 */

import { describe, it, expect } from 'vitest';
import { verifyEvent, getEventHash } from 'nostr-tools/pure';
import type { Event as NostrToolsEvent } from 'nostr-tools/pure';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  FARM_STRAWBERRY_EVENT,
  FARM_STRAWBERRY_PRIMARY_IMAGE,
} from './partner-item-event-fixtures';
import {
  parseOfficialItemDefinition,
  parseTrustedItemDefinition,
  resolveFromDefinition,
} from './protocol-adapter';
import { primaryItemImageUrl } from './item-image-resolution';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from './constants';
import { OFFICIAL_ITEM_REGISTRY } from './registry';
import { buildGameItemAddress } from './package';

const FARM_ISSUER =
  'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';
const STRANGER = 'a'.repeat(64);

/** Re-sign-free clone with a different author. Parsers do not check sigs. */
function reissuedBy(event: NostrEvent, pubkey: string): NostrEvent {
  return { ...event, pubkey, id: `reissued-${pubkey}`, sig: '' };
}

describe('the Strawberry fixture is the real published event', () => {
  it('has a matching id and a valid signature', () => {
    const e = FARM_STRAWBERRY_EVENT as unknown as NostrToolsEvent;
    expect(getEventHash(e)).toBe(FARM_STRAWBERRY_EVENT.id);
    expect(verifyEvent(e)).toBe(true);
  });
});

describe('generic normalization of a partner definition', () => {
  it('resolves name, type, category, topics, rarity and art with no Blobbi metadata', () => {
    const parsed = parseTrustedItemDefinition(FARM_STRAWBERRY_EVENT);
    expect(parsed).not.toBeNull();

    const resolved = resolveFromDefinition(parsed!);

    // Identity is the FULL address, always.
    expect(resolved.address).toBe(
      buildGameItemAddress(FARM_ISSUER, 'farm:produce:strawberry'),
    );
    expect(resolved.d).toBe('farm:produce:strawberry');

    // The generic facts a client needs to render an item it has never seen.
    expect(resolved.name).toBe('Strawberry');
    expect(resolved.type).toBe('consumable');
    expect(resolved.category).toBe('food');
    expect(resolved.rarity).toBe('common');
    expect(resolved.topics).toContain('edible');
    expect(resolved.description).toBe(
      'A fresh strawberry harvested on the farm.',
    );

    // The PRIMARY image is the unmarked `image` tag, chosen by the package —
    // an inventory cell must never show a pose-specific view.
    expect(primaryItemImageUrl(resolved)).toBe(FARM_STRAWBERRY_PRIMARY_IMAGE);
    expect(resolved.images[0].marker).toBeUndefined();

    // The definition came from a real fetched event, not a bundled guess.
    expect(resolved.source).toBe('definition');
  });

  it('invents no Blobbi gameplay semantics for it', () => {
    const resolved = resolveFromDefinition(
      parseTrustedItemDefinition(FARM_STRAWBERRY_EVENT)!,
    );

    // No legacy Blobbi id: this is not one of Island's items, and `itemId` is a
    // compatibility identifier for Island's own registry only.
    expect(resolved.itemId).toBeNull();
    // No action and no stat effects. Island has not been told what a partner's
    // strawberry does to a Blobbi, and must not decide on the issuer's behalf.
    expect(resolved.action).toBeNull();
    expect(resolved.effects).toEqual({});
    // Not equippable: the issuer declared no slot.
    expect(resolved.slot).toBeNull();
    expect(resolved.visualDiagnostics.slot).toBe('missing');
  });
});

describe('the official parser did not widen', () => {
  it('still accepts an official Blobbi definition', () => {
    const official = OFFICIAL_ITEM_REGISTRY[0];
    const event: NostrEvent = {
      id: 'official',
      pubkey: OFFICIAL_ITEM_ISSUER_PUBKEY,
      created_at: 1,
      kind: 31632,
      tags: [
        ['d', official.d],
        ['name', 'Apple'],
        ['type', 'consumable'],
        ['category', 'food'],
      ],
      content: '',
      sig: '',
    };
    expect(parseOfficialItemDefinition(event)?.address).toBe(official.address);
  });

  it('REJECTS the Farm definition', () => {
    expect(parseOfficialItemDefinition(FARM_STRAWBERRY_EVENT)).toBeNull();
  });
});

describe('the trusted parser trusts issuers, never `d` values', () => {
  it('accepts the Farm issuer', () => {
    const parsed = parseTrustedItemDefinition(FARM_STRAWBERRY_EVENT);
    expect(parsed?.issuer).toBe(FARM_ISSUER);
  });

  it('accepts the official Blobbi issuer too', () => {
    const event: NostrEvent = {
      id: 'official',
      pubkey: OFFICIAL_ITEM_ISSUER_PUBKEY,
      created_at: 1,
      kind: 31632,
      tags: [
        ['d', 'blobbi:food:apple'],
        ['name', 'Apple'],
        ['type', 'consumable'],
      ],
      content: '',
      sig: '',
    };
    expect(parseTrustedItemDefinition(event)?.issuer).toBe(
      OFFICIAL_ITEM_ISSUER_PUBKEY,
    );
  });

  it('rejects an arbitrary issuer', () => {
    const event: NostrEvent = {
      id: 'stranger',
      pubkey: STRANGER,
      created_at: 1,
      kind: 31632,
      tags: [
        ['d', 'anything'],
        ['name', 'Anything'],
        ['type', 'consumable'],
      ],
      content: '',
      sig: '',
    };
    expect(parseTrustedItemDefinition(event)).toBeNull();
  });

  it('rejects the SAME `d` published under a different key', () => {
    // The impersonation this design exists to refuse: kind:31632 is
    // addressable, so anyone may publish `farm:produce:strawberry`. Only the
    // issuer half of the address decides.
    const impostor = reissuedBy(FARM_STRAWBERRY_EVENT, STRANGER);
    expect(impostor.tags).toContainEqual(['d', 'farm:produce:strawberry']);
    expect(parseTrustedItemDefinition(impostor)).toBeNull();
    expect(parseOfficialItemDefinition(impostor)).toBeNull();
  });
});
