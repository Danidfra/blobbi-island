/**
 * The kinds of leaving, and the one table that says which capability governs
 * each.
 *
 * ## Why classes rather than one `openExternal(url)`
 *
 * A bare URL loses the only thing worth knowing. "Open https://t.me/share/…" and
 * "open https://github.com/…" are the same call and completely different
 * decisions: one is handing a player to a social platform, the other is a
 * documentation link. A policy that can only see a string cannot tell them
 * apart, and neither can the confirmation the player reads.
 *
 * So the request carries INTENT. The class decides which capability applies,
 * what the player is shown, and whether they are asked first, and it does so in
 * exactly one place, which is the point of the phase. Before this, six components
 * each built their own URL and called `window.open` themselves.
 *
 * ## Two shapes of egress, one capability table
 *
 * Three classes end in a browser API (a new tab, the OS share sheet). Two are
 * *surfaces* rather than destinations, changing the relay, reaching the
 * authoring tools: which do not open anything but are the same kind of
 * decision: "may this experience reach outside its own boundaries". They share
 * this table so the mapping is stated once; only the first three ever touch
 * `performEgress`.
 */

import type { IslandSafetyPolicy } from '@/safety';

/**
 * Every way out of Blobbi Island.
 *
 * Deliberately does NOT include the theater's media embed. A YouTube iframe has
 * its own concerns, an open catalog, host-controlled media replacement, embed
 * privacy, fullscreen, session consent, and calling it an `external-link` to
 * make this phase look complete would bury all of them under a confirmation
 * dialog that does not address any of them. That is its own phase.
 */
export type EgressClass =
  /** A named destination in a new tab: docs, an image host, an attribution link. */
  | 'external-link'
  /** A share intent handed to a named social platform. */
  | 'social-share'
  /**
   * Travelling to another Blobbi world (Blobbi Home, Blobbi Pixel, Nostr
   * Farm): THIS tab goes there, after the Blobbi's departure has played. The
   * only class that navigates the current page rather than opening a new
   * one: a world is where the player takes their Blobbi next, not a link to
   * read beside the Island. Destinations come from the world registry
   * (`src/worlds/worlds.ts`), checked addresses only.
   */
  | 'world-travel'
  /** The operating system's share sheet, whose destination set is unknowable. */
  | 'native-share'
  /** Pointing the client at a different relay. */
  | 'relay-management'
  /** Reaching the internal authoring tools. */
  | 'authoring-tool';

/**
 * Which capability governs each class.
 *
 * The single source of this mapping. A feature asks for a CLASS; it never names
 * a capability, and it certainly never names a profile; that is the rule the
 * whole safety layer is built on (`docs/family-safety-policy.md`).
 */
export const EGRESS_CAPABILITY = Object.freeze({
  'external-link': 'externalLinks',
  'social-share': 'socialPlatformSharing',
  // Leaving the Island for another Blobbi world IS leaving the Island: the
  // same capability as any other way out, so a profile that keeps players
  // inside keeps them inside.
  'world-travel': 'externalLinks',
  'native-share': 'nativeShareSheet',
  'relay-management': 'relaySelection',
  'authoring-tool': 'authoringTools',
} as const satisfies Record<EgressClass, keyof IslandSafetyPolicy>);

/**
 * Whether this experience permits this kind of leaving.
 *
 * The predicate the non-browser classes use directly: the relay gate and the
 * authoring-route gate both call this rather than reading a capability by name,
 * so all five classes go through the same table.
 */
export function isEgressAllowed(policy: IslandSafetyPolicy, egressClass: EgressClass): boolean {
  return policy[EGRESS_CAPABILITY[egressClass]] === true;
}

/**
 * Which classes ask before acting.
 *
 * Confirmation is for crossing a boundary the player might not realise they are
 * crossing. It is deliberately NOT universal, because a dialog in front of every
 * action is a dialog nobody reads:
 *
 *  - **`external-link`** and **`social-share`** confirm. Both hand the player to
 *    somewhere that is not Blobbi Island, and the audit's finding was precisely
 *    that they did so with no warning at all.
 *  - **`world-travel`** does not. The player chose the world by name on its
 *    card, and the Blobbi's goodbye (with Stay) is the moment to change their
 *    mind; the page goes only once that has played.
 *  - **`native-share`** does not. The OS share sheet IS a confirmation, and a
 *    dialog in front of a dialog teaches players to dismiss both.
 *  - **`relay-management`** and **`authoring-tool`** do not, because they are not
 *    destinations: nothing opens, and the player stays where they are. They are
 *    gated, not announced.
 */
export const EGRESS_REQUIRES_CONFIRMATION: Readonly<Record<EgressClass, boolean>> = Object.freeze({
  'external-link': true,
  'social-share': true,
  // The Worlds sheet names the destination on its card, and the departure
  // itself offers Stay until the page goes: a second dialog in front of that
  // would be a dialog in front of a dialog.
  'world-travel': false,
  'native-share': false,
  'relay-management': false,
  'authoring-tool': false,
});
