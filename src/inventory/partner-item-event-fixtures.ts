/**
 * Blobbi Island — published kind:31632 events from TRUSTED PARTNER issuers,
 * verbatim.
 *
 * FIXTURE / TEST DATA ONLY. Nothing in production imports this module, and a
 * source-level test asserts that.
 *
 * These exist to prove a specific claim without a network: that Island's
 * EXISTING generic normalization (`resolveFromDefinition`) already understands
 * a definition written by another game, with no Blobbi-specific metadata in it
 * and no Blobbi-specific code added to read it. A hand-written approximation
 * could not prove that — it would only prove that Island understands the shape
 * someone imagined the partner uses. So this is the signed event as fetched
 * from the wire, byte for byte, and the tests verify its id and signature
 * before asserting anything about how it resolves.
 *
 * NOTHING MAY KEY ON `id` OR `sig`. kind:31632 is addressable: the issuer
 * republishes a definition (new id, new signature, SAME address) whenever its
 * metadata changes. Stable identity is always `31632:<issuer>:<d>`.
 */

import type { NostrEvent } from '@nostrify/nostrify';

/** One published partner definition, as fetched from a relay. */
export interface PartnerItemEventFixture {
  /** The issuer's player-facing label, for readable test names. */
  issuerLabel: string;
  /** The stable `d` tag, duplicated out of the tags for convenient lookup. */
  d: string;
  /** The signed event, verbatim. */
  event: NostrEvent;
}

/**
 * The Farm's Strawberry — the first cross-game item Blobbi Island renders.
 *
 * Note what it does NOT contain: no `content.metadata`, no `content.effects`,
 * no Blobbi item id, no action, no stages, no slot. It is an ordinary Game Item
 * Definition that says what the item IS (`type`, `category`, `t` topics, art)
 * and says nothing about what any particular game should do with it. That is
 * the whole point — interoperability comes from the generic protocol, not from
 * a partner embedding Blobbi vocabulary in their events.
 *
 * Fetched from `wss://relay.primal.net` and `wss://relay.ditto.pub`, which both
 * serve it.
 */
export const FARM_STRAWBERRY_EVENT: NostrEvent = {
  id: '9d4d6f76877aac73850d4dfe271209071f6d009e3cb3d4a102b2356edde5589a',
  kind: 31632,
  pubkey: 'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4',
  tags: [
    ['d', 'farm:produce:strawberry'],
    ['name', 'Strawberry'],
    ['type', 'consumable'],
    ['category', 'food'],
    [
      'image',
      'https://blossom.primal.net/a8b3725f2d66a06c7f1b8d82b0f7ff52092a36347f5db5093dd4fc7f09b57f55.webp',
    ],
    [
      'image',
      'https://blossom.primal.net/a8b3725f2d66a06c7f1b8d82b0f7ff52092a36347f5db5093dd4fc7f09b57f55.webp',
      'front',
    ],
    [
      'image',
      'https://blossom.primal.net/a8b3725f2d66a06c7f1b8d82b0f7ff52092a36347f5db5093dd4fc7f09b57f55.webp',
      'side-right',
    ],
    [
      'image',
      'https://blossom.primal.net/a8b3725f2d66a06c7f1b8d82b0f7ff52092a36347f5db5093dd4fc7f09b57f55.webp',
      'side-left',
    ],
    [
      'image',
      'https://blossom.primal.net/a8b3725f2d66a06c7f1b8d82b0f7ff52092a36347f5db5093dd4fc7f09b57f55.webp',
      'back',
    ],
    ['rarity', 'common'],
    ['max_stack', '999'],
    ['version', '1'],
    ['context', 'game:farm'],
    ['context', 'cross-game'],
    ['t', 'edible'],
    ['t', 'fruit'],
    ['t', 'berry'],
    ['t', 'crop'],
    ['t', 'farm-produce'],
    ['t', 'organic'],
    ['alt', 'Game item definition: Strawberry'],
    ['client', 'nostr-worlds'],
  ],
  content: '{"description":"A fresh strawberry harvested on the farm."}',
  created_at: 1788395630,
  sig: '7203d1d648e39ecbe15a0e14934269d18e37d7043c3e6286a61c621da5ef66f7167fcaec21c7c8dab776a9a23b7bbff799b7de1f8e12b7fd962d4d6ddbbca5f2',
};

/** The primary (unmarked) artwork URL, duplicated for readable assertions. */
export const FARM_STRAWBERRY_PRIMARY_IMAGE =
  'https://blossom.primal.net/a8b3725f2d66a06c7f1b8d82b0f7ff52092a36347f5db5093dd4fc7f09b57f55.webp';

export const PARTNER_ITEM_EVENT_FIXTURES: readonly PartnerItemEventFixture[] = [
  {
    issuerLabel: 'Farm',
    d: 'farm:produce:strawberry',
    event: FARM_STRAWBERRY_EVENT,
  },
];
