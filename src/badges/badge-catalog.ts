/**
 * The badge domain — normalized, and deliberately empty.
 *
 * ## What the audit found
 *
 * Nothing. There is no badge protocol in this repository, and this file exists
 * to say so in code rather than to paper over it:
 *
 * | Question                              | Answer in this repository                       |
 * | ------------------------------------- | ----------------------------------------------- |
 * | Badge definition kind?                | None. `src/protocol/event-registry.ts` enumerates every kind Island reads or writes — 1124, 11125, 31125, 31124, 21201, 31950, 31951, 21951, 31632, 31633, 31634 — and none of them is a badge. NIP-58 (kinds 8 / 30008 / 30009) is neither imported nor queried. |
 * | Badge inside kind:31632?              | No. `ITEM_CATEGORIES` is `food, toy, medicine, hygiene, energy, currency`. A Game Item Definition has no badge category and no badge-shaped fields. |
 * | Ownership / award representation?     | None. kind:31633 holds item quantities, not awards; there is no accepted-award event and no issuer convention. |
 * | Award or claim logic?                 | None. No code grants, claims or revokes a badge. |
 * | Criteria / mission requirements?      | None. No mission system, no achievement store, no progress model. |
 * | Purchasing path?                      | Coins buy kind:31632 items through `useBatchPurchase`. There is nothing badge-shaped for it to buy. |
 * | Anything that already awards badges?  | One artefact only: the Arcade prize catalogue declares a `badge` delivery type (`{ type: 'badge', badgeId }`, used by Mini Arcade Trophy) and states in its own documentation that it "is not implemented, and nothing here pretends otherwise". It is a placeholder, not a protocol. |
 *
 * ## So the shelf is empty, and that is the honest result
 *
 * The store is built, walkable and wired end to end. What it cannot do is
 * invent the merchandise. Publishing fabricated badges, minting a kind number,
 * or writing mission requirements nobody has specified would put fiction into
 * production data — and unlike a layout mistake, fiction that reaches a relay
 * cannot be edited back out.
 *
 * The Clothing Store hit the same wall from the other side (real wearables, no
 * Coin prices) and answered it the same way: show what the store is FOR, say
 * plainly why nothing is on the shelf, and leave the seam ready. When a badge
 * kind exists, {@link BADGE_CATALOG} is where its resolved records arrive and
 * `badge-acquisition.ts` is where acquiring one is implemented. Nothing else in
 * the store has to change.
 */

/** How a badge is come by. The three the store is designed to serve. */
export type BadgeAcquisition = 'purchase' | 'achievement' | 'mission';

export const BADGE_ACQUISITIONS: readonly BadgeAcquisition[] = [
  'purchase',
  'achievement',
  'mission',
];

/** Tab labels, in the store's own words. */
export const BADGE_ACQUISITION_LABELS: Record<BadgeAcquisition, string> = {
  purchase: 'Purchasable',
  achievement: 'Achievements',
  mission: 'Missions',
};

/**
 * One badge, as the store needs it — whatever it turns out to be made of.
 *
 * This is the NORMALIZED shape: the modal renders this and nothing else, so a
 * future protocol adapter has one target to map onto and the UI never learns
 * what a badge event looks like.
 *
 * Optional fields are optional because they are genuinely unknown for some
 * acquisition types, not to leave room for guesses. A `purchase` badge without
 * a `price` is not for sale; an `achievement` without a `requirement` does not
 * tell the player how to earn it, and the modal says so rather than inventing
 * one.
 */
export interface BadgeRecord {
  /** Canonical identity, stable across sessions. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Artwork URL, or `null` when the definition carries none. */
  readonly image: string | null;
  /** Emoji fallback, drawn when there is no artwork. */
  readonly symbol: string;
  readonly acquisition: BadgeAcquisition;
  /** Does the viewer hold it? `null` means unknown, never "no". */
  readonly owned: boolean | null;
  /** Coin price, for `purchase` badges that have one. */
  readonly price?: number;
  /** What earns it, for `achievement` / `mission` badges that state it. */
  readonly requirement?: string;
  /** Progress toward `requirement`, 0–1, when the source reports it. */
  readonly progress?: number;
}

/**
 * Every badge the store knows about.
 *
 * Empty, and not as a stub: see the table above. This array is the single
 * place a real catalog arrives, whether it is resolved from a future badge
 * kind, from kind:31632 definitions once they carry badges, or from a
 * canonical bundled list. Everything downstream — the tabs, the counts, the
 * empty state — is derived from it.
 */
export const BADGE_CATALOG: readonly BadgeRecord[] = [];

/** The badges of one acquisition type, in catalog order. */
export function badgesByAcquisition(
  badges: readonly BadgeRecord[],
  acquisition: BadgeAcquisition,
): readonly BadgeRecord[] {
  return badges.filter((badge) => badge.acquisition === acquisition);
}

/**
 * Which acquisition tabs are worth showing, given what is actually stocked.
 *
 * Only types with at least one badge: a "Missions" tab over an empty list
 * implies a mission system exists, which is exactly the impression this
 * workstream must not create.
 */
export function stockedAcquisitions(
  badges: readonly BadgeRecord[],
): readonly BadgeAcquisition[] {
  return BADGE_ACQUISITIONS.filter(
    (acquisition) => badgesByAcquisition(badges, acquisition).length > 0,
  );
}
