/**
 * DEV/TEST-ONLY kind:31632 fixtures covering every shape of the repeatable
 * `image` tag.
 *
 * These are RAW EVENTS rather than hand-built `GameItemDefinition` objects on
 * purpose: the whole point of this phase is that Island consumes the library's
 * parse of an issuer's tags, so a fixture that skipped the parser would prove
 * nothing about the integration and would happily encode a shape the parser
 * rejects. Every test below runs real tags through
 * `parseGameItemDefinitionResult`.
 *
 * They are:
 *  - never published to Nostr;
 *  - never inserted into anyone's inventory;
 *  - never equipped;
 *  - never added to `OFFICIAL_ITEM_DEFINITIONS`, the shop, or the catalog;
 *  - authored by a FIXTURE pubkey, not the official issuer, so a stray import
 *    into production code cannot make one resolve as an official item
 *    (`parseOfficialItemDefinition` rejects it on the issuer check alone).
 *
 * URLs point at `fixtures.invalid` — a reserved TLD that can never resolve — so
 * nothing here can accidentally hit the network.
 */

import type { NostrEvent } from '@nostrify/nostrify';

/**
 * A deliberately non-official issuer. 64 lowercase hex chars so it is a valid
 * pubkey everywhere, and visibly a fixture when it shows up in a failure.
 */
export const FIXTURE_ISSUER_PUBKEY = 'f1'.repeat(32);

/** Fixture artwork URLs, one per view, plus the unmarked defaults. */
export const FIXTURE_IMAGE_URLS = {
  primary: 'https://fixtures.invalid/hat-primary.png',
  primaryAlt: 'https://fixtures.invalid/hat-primary-alt.png',
  front: 'https://fixtures.invalid/hat-front.png',
  frontAlt: 'https://fixtures.invalid/hat-front-alt.png',
  back: 'https://fixtures.invalid/hat-back.png',
  sideRight: 'https://fixtures.invalid/hat-side-right.png',
  sideLeft: 'https://fixtures.invalid/hat-side-left.png',
  diagonalFrontRight: 'https://fixtures.invalid/hat-diagonal-front-right.png',
  diagonalFrontLeft: 'https://fixtures.invalid/hat-diagonal-front-left.png',
  future: 'https://fixtures.invalid/hat-top-down.png',
} as const;

/**
 * Build a kind:31632 event carrying the given `image` tags.
 *
 * `id`/`sig` are fixture-stable placeholders: the item parser reads tags and
 * content, and signature verification is a relay/pool concern that happens long
 * before a definition reaches it.
 */
export function itemDefinitionEventFixture(
  d: string,
  imageTags: readonly string[][],
  overrides: Partial<NostrEvent> = {},
): NostrEvent {
  return {
    id: `fixture-${d}`,
    pubkey: FIXTURE_ISSUER_PUBKEY,
    created_at: 1_700_000_000,
    kind: 31632,
    tags: [
      ['d', d],
      ['name', 'Fixture Hat'],
      ['type', 'accessory'],
      ...imageTags,
    ],
    content: '',
    sig: '0'.repeat(128),
    ...overrides,
  } as NostrEvent;
}

const U = FIXTURE_IMAGE_URLS;

/** One unmarked image: the ordinary case, and what every published item has. */
export const FIXTURE_PRIMARY_ONLY = itemDefinitionEventFixture(
  'fixture:accessory:primary-only',
  [['image', U.primary]],
);

/** The intended accessory shape: a default plus the two poses Island renders. */
export const FIXTURE_PRIMARY_FRONT_BACK = itemDefinitionEventFixture(
  'fixture:accessory:primary-front-back',
  [
    ['image', U.primary],
    ['image', U.front, 'front'],
    ['image', U.back, 'back'],
  ],
);

/** A full turnaround: every marker this spec version defines, plus a primary. */
export const FIXTURE_FULL_TURNAROUND = itemDefinitionEventFixture(
  'fixture:accessory:full-turnaround',
  [
    ['image', U.primary],
    ['image', U.front, 'front'],
    ['image', U.back, 'back'],
    ['image', U.sideRight, 'side-right'],
    ['image', U.sideLeft, 'side-left'],
    ['image', U.diagonalFrontRight, 'diagonal-front-right'],
    ['image', U.diagonalFrontLeft, 'diagonal-front-left'],
  ],
);

/**
 * No unmarked image at all — legal, and the reason the library's primary
 * selection falls back to the first entry instead of returning nothing.
 * Ordered side-first so "first valid image" is provably NOT the front view.
 */
export const FIXTURE_ONLY_MARKED = itemDefinitionEventFixture(
  'fixture:accessory:only-marked',
  [
    ['image', U.sideRight, 'side-right'],
    ['image', U.front, 'front'],
    ['image', U.back, 'back'],
  ],
);

/** Two `front` views. The first wins; the second must not be lost. */
export const FIXTURE_DUPLICATE_FRONT = itemDefinitionEventFixture(
  'fixture:accessory:duplicate-front',
  [
    ['image', U.primary],
    ['image', U.front, 'front'],
    ['image', U.frontAlt, 'front'],
  ],
);

/** Two unmarked images — a `multiple-primary-images` warning, not a rejection. */
export const FIXTURE_MULTIPLE_PRIMARIES = itemDefinitionEventFixture(
  'fixture:accessory:multiple-primaries',
  [
    ['image', U.primary],
    ['image', U.primaryAlt],
    ['image', U.back, 'back'],
  ],
);

/** A marker this spec version does not define. Preserved verbatim. */
export const FIXTURE_UNKNOWN_MARKER = itemDefinitionEventFixture(
  'fixture:accessory:unknown-marker',
  [
    ['image', U.primary],
    ['image', U.future, 'top-down'],
  ],
);

/** Blank and value-less `image` tags, which the parser drops with a warning. */
export const FIXTURE_INVALID_IMAGE_TAGS = itemDefinitionEventFixture(
  'fixture:accessory:invalid-image-tags',
  [
    ['image', ''],
    ['image'],
    ['image', '   ', 'front'],
    ['image', U.primary],
  ],
);

/** No `image` tag whatsoever — the item renders its emoji/placeholder. */
export const FIXTURE_NO_IMAGES = itemDefinitionEventFixture(
  'fixture:accessory:no-images',
  [],
);

/** Only a `back` view, so a front-facing request has to fall back. */
export const FIXTURE_BACK_ONLY = itemDefinitionEventFixture(
  'fixture:accessory:back-only',
  [['image', U.back, 'back']],
);

/** Only a `front` view, so a back-facing request has to fall back to it. */
export const FIXTURE_FRONT_ONLY = itemDefinitionEventFixture(
  'fixture:accessory:front-only',
  [['image', U.front, 'front']],
);

/** Every fixture, for sweeps that assert a property across all of them. */
export const ALL_ITEM_IMAGE_FIXTURES: readonly NostrEvent[] = [
  FIXTURE_PRIMARY_ONLY,
  FIXTURE_PRIMARY_FRONT_BACK,
  FIXTURE_FULL_TURNAROUND,
  FIXTURE_ONLY_MARKED,
  FIXTURE_DUPLICATE_FRONT,
  FIXTURE_MULTIPLE_PRIMARIES,
  FIXTURE_UNKNOWN_MARKER,
  FIXTURE_INVALID_IMAGE_TAGS,
  FIXTURE_NO_IMAGES,
  FIXTURE_BACK_ONLY,
  FIXTURE_FRONT_ONLY,
];
