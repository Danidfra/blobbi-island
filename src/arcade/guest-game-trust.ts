/**
 * Guest Games — the trust decision, recorded now and implemented later.
 *
 * A Guest Game is somebody else's little game, curated and shown in the arcade
 * "just for fun". None exists yet, **and nothing in this phase can run one**:
 * there is no runtime, no package format handling, no download, no iframe, no
 * WebXDC shim and no relay query. This module holds one decision and one flag,
 * so the decision has a home that is not a comment in a component.
 *
 * ## The decision
 *
 * When Guest Game discovery is built, Blobbi Island will initially accept
 * packages published by the OFFICIAL Blobbi issuer and nobody else. Not because
 * a wider set is undesirable — because a wider set needs a review process, a
 * revocation story and a runtime that has been attacked at least once, and none
 * of those exist. Starting with one publisher makes the trust surface a single
 * key that can be reasoned about.
 *
 * ## Why there is no key literal here
 *
 * That publisher is the SAME key the item catalog already trusts, and it is
 * already defined once, in `src/inventory/constants.ts`. Writing it out again
 * would create a second copy that a rotation would have to find — which is
 * exactly the failure the brief's "do not duplicate the public key across random
 * UI files" is about. This module re-exports it under the name that says what it
 * is trusted FOR, and adds nothing.
 *
 * Only the PUBLIC key is involved. No private material exists in this repository.
 *
 * ## Why this is inert
 *
 * {@link GUEST_GAME_RUNTIME_AVAILABLE} is `false` and nothing reads it to decide
 * whether to execute anything, because there is nothing to execute. The launch
 * resolver refuses every guest entry on CATEGORY, before launch mode is even
 * considered — see `isNativeLaunchable` in `catalogue.ts`. That refusal is the
 * real guarantee; this file is documentation with a type.
 *
 * `guest-game-trust.test.ts` asserts that the key is the item issuer's, that it
 * encodes to the npub the decision was taken against, and that **no other module
 * in `src/` references this constant** — so "recorded, not wired up" is checked
 * rather than promised.
 */

import { OFFICIAL_ISSUER_PUBKEY } from '@/protocol/event-registry';

/**
 * The only publisher Guest Game discovery will initially trust.
 *
 * Deliberately an alias of the official item issuer rather than a new constant:
 * one key, one definition, one place to change it.
 */
export const OFFICIAL_GUEST_GAME_PUBLISHER_PUBKEY: string = OFFICIAL_ISSUER_PUBKEY;

/**
 * Whether a Guest Game runtime exists in this build.
 *
 * `false`, and it is not a feature flag: flipping it would enable nothing,
 * because there is no runtime behind it. It is here so a future runtime has an
 * obvious switch to be gated on rather than being wired in silently.
 */
export const GUEST_GAME_RUNTIME_AVAILABLE = false;

/**
 * Why a Guest Game cannot start, in words a player can read.
 *
 * Deliberately says nothing about packages, trust, keys or protocol: the
 * audience is a child looking at a card, and "not ready yet" is the whole truth
 * they need.
 */
export const GUEST_GAME_UNAVAILABLE_MESSAGE =
  'Guest Games are not ready yet, so this one cannot be played.';
