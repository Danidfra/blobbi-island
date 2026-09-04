/**
 * The capability model, what a player may do, stated once.
 *
 * ## The rule this type exists to enforce
 *
 * Feature code asks **"is this capability allowed?"**, never **"who is this
 * player?"**:
 *
 * ```ts
 * if (!policy.freeTextChat) return;      // ✅
 * if (profile === 'family') return;      // ❌
 * ```
 *
 * The difference is not style. A capability check states the reason the code
 * behaves as it does, survives the arrival of a third profile untouched, and can
 * be exercised by a test that never mentions a profile at all. A profile check
 * states a fact about a person, spreads a policy decision across the tree, and
 * has to be revisited at every call site the day the matrix changes.
 * `docs/family-safety-audit.md` §18.5 records this as the failure mode most
 * likely to happen by accident here.
 *
 * ## Capability names are SEMANTIC, never presentational
 *
 * A capability describes a product boundary, not the widget that happens to
 * implement it today. `freeTextChat` survives a chat rewrite; `hideChatTextarea`
 * does not, and worse, it invites an implementation that hides a textarea while
 * the subscription underneath keeps delivering the very content the name claims
 * to have removed.
 *
 * ## Where a capability must be enforced
 *
 * **At the data boundary, not the render boundary.** For anything a stranger can
 * author, the check belongs where the content is admitted, before it is queued,
 * cached or handed to a component, because a component only controls what
 * *this* build draws, while a policy at the boundary also governs content that
 * arrives from a Standard client, a third-party client, or a future screen
 * nobody has written yet. See `chat-admission.ts` for the worked example and
 * `docs/family-safety-policy.md` for the general rule.
 *
 * ## The three invariants
 *
 * Three fields are typed as the literal `false` rather than `boolean`. They are
 * not restrictions that Family adds; they are properties the island has today in
 * every profile, and turning any of them on would be a new product decision
 * rather than a configuration change. Typing them this way means a future
 * profile literal that tries to relax one does not type-check, the compiler
 * asks the question instead of a reviewer having to notice.
 */

import type { ExperienceProfile } from './experience-profile';

/**
 * The complete capability set of one experience.
 *
 * Every field is `readonly`, and the two shipped policies are frozen
 * (`policies.ts`), so a policy cannot be edited in place by a consumer that
 * happens to hold a reference to it.
 */
export interface IslandSafetyPolicy {
  /**
   * Which profile produced this policy.
   *
   * Present for diagnostics, logging and the resolver's own tests, **not** as
   * something feature code should branch on. If you find yourself reading this
   * field outside `src/safety/`, the capability you actually needed is missing
   * and should be added instead.
   */
  readonly profile: ExperienceProfile;

  // ── Communication ────────────────────────────────────────────────────────

  /**
   * Compose and display arbitrary player-authored text in the world.
   *
   * **Both directions, one flag, deliberately.** Send and render can never
   * diverge, because a build that disabled composing while still rendering
   * inbound text would remove the player's voice and keep every stranger's,
   * the exact half-measure `docs/family-safety-audit.md` §18.2 names as the most
   * likely way to get this wrong. Enforced in `chat-admission.ts`.
   */
  readonly freeTextChat: boolean;

  /**
   * Communicate by choosing from a curated, app-authored phrase catalog.
   *
   * The catalog does not exist yet (Phase D). The capability is defined now
   * because it is what makes `freeTextChat: false` a substitution rather than a
   * silencing, and because {@link assertPolicyInvariants} refuses a profile that
   * has no communication channel at all.
   */
  readonly predefinedPhrases: boolean;

  /**
   * Express reactions through the Blobbi itself rather than through words.
   *
   * Reserved in the protocol and unbuilt: kind 31950 already defines
   * `state: 'emote'` and `NIP.md` marks it "reserved for a future emote/reaction
   * feature". It is a capability rather than a mere to-do because Family's whole
   * communication story rests on it.
   */
  readonly emotes: boolean;

  /**
   * Private one-to-one messaging. **Invariant: absent in every profile.**
   *
   * Blobbi Island has never had a private channel; no kind 4, no NIP-17/59, no
   * `nip44` usage anywhere in `src/`. Recording it as a policy invariant turns
   * "we happen not to have built DMs" into "shipping DMs is a decision that has
   * to change this type", which is the difference the audit's §1 finding rests
   * on.
   */
  readonly directMessages: false;

  // ── Social identity ──────────────────────────────────────────────────────

  /**
   * Display a name another player chose, such as their Blobbi's `name` tag.
   *
   * Free text authored by a stranger, attached to a body that moves around the
   * child's screen and persists in kind 31124. When this is `false` the renderer
   * must substitute a neutral generated name, `genUserName` already derives a
   * stable, collision-resistant one from a pubkey.
   */
  readonly strangerAuthoredNames: boolean;

  /**
   * Render another player's kind:0 profile metadata, picture, display name,
   * about, website. **Invariant: never, in any profile.**
   *
   * Today no code path does this, which is the single most valuable safety
   * property the product has and, as the audit puts it, an accident. This field
   * is how it stops being an accident: a signature authenticates an author and
   * says nothing whatever about whether the picture behind that URL is suitable
   * for a nine-year-old.
   */
  readonly strangerProfileMetadata: false;

  /**
   * Name your own Blobbi with free text.
   *
   * Two risks in one field, and the second is the larger: a stranger reading it
   * (see {@link strangerAuthoredNames}), and a child typing their real name,
   * school or age into a box the game invited them to fill in.
   */
  readonly ownFreeTextNaming: boolean;

  // ── Leaving the island ───────────────────────────────────────────────────

  /**
   * Follow a link out of Blobbi Island to an arbitrary destination.
   *
   * The capability covers the act of leaving, whatever the mechanism, anchor,
   * `window.open`, a share intent. Phase B introduces the single egress helper
   * that will consult it; today the calls are scattered, which is itself the
   * finding (audit H-6).
   */
  readonly externalLinks: boolean;

  /** Hand the player to a named social platform's share page. */
  readonly socialPlatformSharing: boolean;

  /**
   * Open the operating system's share sheet.
   *
   * Separate from {@link socialPlatformSharing} because the destination set is
   * not knowable in advance: it is every share target installed on the device.
   */
  readonly nativeShareSheet: boolean;

  // ── Untrusted media ──────────────────────────────────────────────────────

  /**
   * Render media from a URL this application did not curate.
   * **Invariant: never, in any profile.**
   *
   * Item art is issuer-locked (`useItemCatalog.ts` accepts definitions only from
   * the official issuer), and nothing else fetches a picture chosen by another
   * player. Keeping this at `false` is what stops the generic image pipeline
   * from quietly becoming an arbitrary-image pipeline the first time somebody
   * adds a "custom avatar" feature.
   */
  readonly arbitraryRemoteMedia: false;

  /**
   * Put any video the player can name on the theater screen.
   *
   * Today that means pasting any embeddable YouTube URL or id
   * (`youtube-url.ts`: "the theater accepts an OPEN catalog"). When this is
   * `false` the theater needs an approved catalog to show instead, which does
   * not exist yet, so a Family theater currently has nothing to play. That is a
   * known, documented gap for Phase E, not an oversight.
   */
  readonly openMediaEntry: boolean;

  // ── Publishing and configuration ─────────────────────────────────────────

  /**
   * Upload a file to a public media host.
   *
   * Blossom is content-addressed and effectively permanent: an upload cannot be
   * meaningfully retracted, which is a different order of consequence from most
   * things a child can do by tapping a button.
   */
  readonly mediaUploads: boolean;

  /** Publish a public, permanent Nostr note (kind 1) from inside the game. */
  readonly publicNotePublishing: boolean;

  /**
   * Point the client at a different relay.
   *
   * The relay decides which strangers exist and which moderation regime, if any,
   * applies. Every other restriction in this policy is worth less if this one is
   * open, because a different relay is a different population.
   */
  readonly relaySelection: boolean;

  /**
   * Reach the internal authoring tools at `/tools/game-items`, which publish
   * events, upload files and link off-site.
   */
  readonly authoringTools: boolean;

  // ── Playing together, preserved in every profile ────────────────────────

  /**
   * See other players and be seen by them.
   *
   * `true` in **every** profile, and the tests assert it. Family mode is not a
   * single-player mode: the audit found co-presence to be low-risk because it
   * carries no content channel, and removing it would strip out the reason a
   * child wants to be on the island while mitigating almost nothing.
   */
  readonly multiplayerPresence: boolean;

  /**
   * Take part in shared activities: sitting together, synchronized watch
   * sessions, co-play. Also `true` in every profile, what a Family session may
   * *play* is governed by {@link openMediaEntry}, not by whether it may gather.
   */
  readonly sharedActivities: boolean;

  /**
   * Publish fine-grained presence: exact coordinates, movement destination, and
   * the id of the spot a hidden player is hiding in.
   *
   * When `false`, presence is coarsened. The hiding case is the clearest reason
   * it is a capability at all: today a player who hides is suppressed visually
   * on every stock client while their exact hiding spot is broadcast, so hiding
   * does not hide from anything but a stock client.
   */
  readonly detailedPresence: boolean;
}

/**
 * The structural rules every profile must satisfy, whoever writes it.
 *
 * These are not assertions about Standard or about Family; they are properties
 * of a *valid* policy, checked against each shipped literal by `policies.test.ts`
 * and available to any future profile. Throwing rather than returning is
 * deliberate: a policy that breaks one of these is a programming error at
 * authoring time, not a runtime condition to degrade around.
 */
export function assertPolicyInvariants(policy: IslandSafetyPolicy): void {
  const problems: string[] = [];

  // Invariants of the island itself, restated at runtime because the literal
  // `false` types only protect code that is compiled with them.
  if (policy.directMessages !== false) problems.push('directMessages must be false in every profile');
  if (policy.strangerProfileMetadata !== false) {
    problems.push('strangerProfileMetadata must be false in every profile');
  }
  if (policy.arbitraryRemoteMedia !== false) {
    problems.push('arbitraryRemoteMedia must be false in every profile');
  }

  // Playing together is the product. A profile that removes it is a different
  // product wearing this one's name.
  if (!policy.multiplayerPresence) problems.push('multiplayerPresence must be true in every profile');
  if (!policy.sharedActivities) problems.push('sharedActivities must be true in every profile');

  // Restricting speech is only legitimate as a SUBSTITUTION. A profile that
  // switches free text off and offers nothing in its place has silenced the
  // player rather than protected them.
  if (!policy.freeTextChat && !policy.predefinedPhrases && !policy.emotes) {
    problems.push(
      'a profile without freeTextChat must offer predefinedPhrases or emotes: ' +
        'restricting speech is a substitution, never a removal',
    );
  }

  // Uploading is how a note gets its picture; a profile that allowed the note
  // and refused the upload would fail halfway through an action it invited.
  if (policy.publicNotePublishing && !policy.mediaUploads) {
    problems.push('publicNotePublishing without mediaUploads cannot complete a photo share');
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid IslandSafetyPolicy for profile "${policy.profile}":\n- ${problems.join('\n- ')}`,
    );
  }
}
