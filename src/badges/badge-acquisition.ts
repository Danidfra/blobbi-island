/**
 * The acquisition adapter — the one place a badge could ever be acquired.
 *
 * ```
 *   BadgesStoreModal  →  BADGE_CATALOG (normalized)  →  acquireBadge()
 *                                                          ├─ purchase
 *                                                          ├─ achievement claim
 *                                                          └─ mission claim
 * ```
 *
 * The modal never publishes. It calls this, reads the result, and renders it.
 * That is the same split the Care and Clothing Stores use for Coins — the UI
 * describes intent, a domain module owns the write — and it is why adding a
 * real badge protocol later touches this file and not the store.
 *
 * ## Today every branch refuses, and the refusal is the correct behaviour
 *
 * There is no badge kind, no award event and no claim semantics in this
 * repository (`badge-catalog.ts` records the full audit). An adapter that
 * guessed one would publish fiction to a relay, so each branch returns an
 * explicit `unsupported` result naming what is missing. It never throws and
 * never partially writes: refusing is a normal outcome, not an error.
 *
 * The store cannot reach these branches anyway — {@link BADGE_CATALOG} is
 * empty, so there is no card to press — but the seam is exercised by its tests
 * rather than left to be discovered.
 */

import type { BadgeAcquisition } from './badge-catalog';

export interface BadgeAcquisitionRequest {
  readonly badgeId: string;
  readonly acquisition: BadgeAcquisition;
}

export type BadgeAcquisitionResult =
  | { readonly outcome: 'acquired'; readonly badgeId: string }
  | {
      readonly outcome: 'unsupported';
      readonly badgeId: string;
      /** What is missing, in words a developer can act on. */
      readonly reason: string;
    };

/**
 * What each branch is waiting for. Stated per acquisition type because they are
 * blocked on different things, and a single "not implemented" would hide that.
 */
const UNSUPPORTED_REASONS: Record<BadgeAcquisition, string> = {
  purchase:
    'Badges cannot be purchased: no badge item kind exists, so there is nothing for a Coin purchase to grant.',
  achievement:
    'Achievement badges cannot be claimed: this repository defines no award event and no issuer to verify one against.',
  mission:
    'Mission badges cannot be claimed: there is no mission system, so no requirement can be checked.',
};

/**
 * Acquire a badge — or say precisely why it cannot be acquired.
 *
 * Pure and write-free by construction: this module imports no publisher, no
 * signer, no wallet and no inventory mutation, so there is no code path from
 * here to a Nostr event. That is a stronger guarantee than "we do not call
 * them", and it is what lets the store be opened and browsed with confidence
 * that nothing is written.
 */
export function acquireBadge(
  request: BadgeAcquisitionRequest,
): BadgeAcquisitionResult {
  return {
    outcome: 'unsupported',
    badgeId: request.badgeId,
    reason: UNSUPPORTED_REASONS[request.acquisition],
  };
}

/**
 * Is any acquisition path implemented?
 *
 * The store asks this to choose its wording. It is a fact about the code, not
 * a feature flag: nothing toggles it, and it becomes true when a branch of
 * {@link acquireBadge} does something.
 */
export const BADGE_ACQUISITION_IMPLEMENTED = false;
