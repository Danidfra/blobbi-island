/**
 * The two shipped policies, the only two capability literals in the codebase.
 *
 * ## A capability answers "may this profile?", not "is it built?"
 *
 * `emotes: true` in both policies does not claim an emote system exists; it
 * records that neither profile forbids one. Reading it the other way would make
 * the matrix un-writable, because every future capability would have to start
 * `false` in Family, the exact profile it is being added for. Availability is a
 * question for the feature; permission is a question for this file. The fields
 * that are permitted-but-unbuilt today are called out individually below.
 *
 * ## `STANDARD_POLICY` is a description, not a wish
 *
 * It must state what Blobbi Island does **today**, capability for capability,
 * because it is what every existing player will resolve to. Tightening Standard
 * here would be shipping a silent product change disguised as a refactor, so
 * where the audit recommended a Standard-mode improvement (an interstitial
 * before external links, for instance) this file still says `externalLinks:
 * true`, matching the shipped behaviour. Those improvements belong to the phase
 * that implements them, where they are visible as changes.
 *
 * `policies.test.ts` pins every Standard field against the behaviour recorded in
 * `docs/family-safety-audit.md`, so a future Family restriction that leaks into
 * Standard fails a test rather than reaching a player.
 *
 * ## `FAMILY_POLICY` is defined and unreachable
 *
 * It exists, it is exhaustively tested, and **nothing can select it**. There is
 * no setting, no storage key, no URL parameter and no environment variable that
 * produces it: see `resolve.ts`, and `boundaries.test.ts` which proves no
 * module outside this directory even names it.
 */

import type { IslandSafetyPolicy } from './island-safety-policy';

/**
 * Blobbi Island exactly as it ships today.
 *
 * Every `true` below is a statement about current production behaviour with a
 * code path behind it. Every `false` is a capability the island does not have in
 * any profile (see the invariants in `island-safety-policy.ts`).
 */
export const STANDARD_POLICY: IslandSafetyPolicy = Object.freeze({
  profile: 'standard',

  // Communication. Free-text kind 21201 chat is live today (`chat-config.ts`,
  // `MultiplayerLayer.publishChatMessage`). Phrases and emotes are permitted and
  // unbuilt.
  freeTextChat: true,
  predefinedPhrases: true,
  emotes: true,
  directMessages: false,

  // Social identity. A remote player's chosen Blobbi name is rendered on hover
  // today; their kind:0 metadata never is, in any profile.
  strangerAuthoredNames: true,
  strangerProfileMetadata: false,
  ownFreeTextNaming: true,

  // Leaving the island. All three work today with no confirmation step. The
  // audit recommends adding one for Standard too, as a visible change, in the
  // phase that builds the egress helper, not here.
  externalLinks: true,
  socialPlatformSharing: true,
  nativeShareSheet: true,

  // Media. The theater takes any embeddable YouTube reference; nothing renders
  // an uncurated image in any profile.
  arbitraryRemoteMedia: false,
  openMediaEntry: true,

  // Publishing and configuration. The PhotoBooth uploads to Blossom and can
  // publish a kind 1; the relay is user-selectable from the account menu; the
  // authoring tools route ships in production builds.
  mediaUploads: true,
  publicNotePublishing: true,
  relaySelection: true,
  authoringTools: true,

  // Playing together, at full presence detail.
  multiplayerPresence: true,
  sharedActivities: true,
  detailedPresence: true,
} as const);

/**
 * The reduced-risk experience.
 *
 * Shaped by one principle from the audit: **the risk is concentrated in
 * arbitrary text, arbitrary video and the exits, remove those three and keep
 * the world.** Presence, co-play, the Arcade, the Beach, the Mine, the shop,
 * dressing up a Blobbi and sitting in the theater together are all untouched,
 * because none of them carries a channel a stranger can author into.
 *
 * ### Capabilities whose Family semantics are still open
 *
 * Recorded here rather than discovered later:
 *
 * - **`openMediaEntry: false` leaves the Family theater with nothing to play.**
 *   The intended replacement is an issuer-signed catalog of approved videos
 *   (audit Phase E), reusing the trust pattern `useItemCatalog.ts` already
 *   applies to items. Until that exists, Family may gather in the theater and
 *   not watch: a real gap, deliberately not papered over.
 * - **`strangerAuthoredNames` is deferred, not unbuilt.** Phase F built the
 *   substitution and its boundary; the shipped Family policy then set the
 *   capability back to `true` while the social identity model (friends, local
 *   nicknames, alias collisions) is decided. See the note on the field itself.
 * - **`detailedPresence` is enforced** (Phase G). The audit disagreed with the
 *   guess recorded here: dropping `hiddenIn` outright would UN-HIDE a hidden
 *   player, so its value is withheld and the fact kept; `goal` and full
 *   coordinate precision are load-bearing for smooth motion and are published
 *   under every policy. See `docs/presence-data-minimization.md`. Coarsening
 *   what this client publishes still does not change what a relay will serve to
 *   a modified one.
 * - **`authoringTools: false` is route-level.** It removes the surface from a
 *   Family build; it is not an authorization boundary, because publishing an
 *   event only ever required a signature the player already controls.
 */
export const FAMILY_POLICY: IslandSafetyPolicy = Object.freeze({
  profile: 'family',

  // Communication: substituted, not removed. Free text is refused in BOTH
  // directions at the data boundary (`chat-admission.ts`): including text sent
  // by Standard players and by third-party clients, which is the whole point.
  freeTextChat: false,
  predefinedPhrases: true,
  emotes: true,
  directMessages: false,

  // Social identity.
  //
  // `strangerAuthoredNames` is TEMPORARILY true, and deliberately so: it is the
  // one capability that currently distinguishes neither shipped profile. The
  // mechanism behind it works and is tested, a policy with it false resolves
  // every remote name to a deterministic alias (`resolveRemoteBlobbiDisplayName`),
  // but shipping it revealed a product question nobody has answered yet. An
  // island where every stranger is "Sunny Fox" and two of them share the alias
  // is not obviously better for a child than one where names are real; friends,
  // local nicknames and relationship-aware naming all change the answer.
  //
  // So the capability describes reality rather than an intention: a curated
  // player currently sees the names other players chose. The alternative,
  // leaving this false and rendering authored names anyway, would make the
  // matrix a lie, which is worse than an honest gap. Revisit when the social
  // identity model is decided; the boundary is already in place to switch back.
  strangerAuthoredNames: true,
  strangerProfileMetadata: false,
  ownFreeTextNaming: false,

  // Leaving the island: no exits. Restoring one is a guardian decision for a
  // later phase, not a default.
  externalLinks: false,
  socialPlatformSharing: false,
  nativeShareSheet: false,

  // Media: nothing arbitrary, from anyone, including the player themselves.
  arbitraryRemoteMedia: false,
  openMediaEntry: false,

  // Publishing and configuration: no permanent public artefacts, and the relay
  // stays where the experience was configured, a different relay is a
  // different population, which would undo every restriction above it.
  mediaUploads: false,
  publicNotePublishing: false,
  relaySelection: false,
  authoringTools: false,

  // Playing together: preserved in full, at reduced presence detail.
  multiplayerPresence: true,
  sharedActivities: true,
  detailedPresence: false,
} as const);
