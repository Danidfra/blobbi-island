/**
 * Connected Experiences: the registry of Nostr-powered apps and games the
 * Nostr Station points players at.
 *
 * ## What this is, and is not
 *
 * A connected experience is an INDEPENDENT application that happens to share
 * the player's Nostr identity and inventory with Blobbi Island. Island does
 * not import its code, embed it, share a signer, share storage or talk to it
 * over `postMessage`; everything the two apps have in common travels as Nostr
 * events, read back through the existing external-inventory pipeline. This
 * module therefore records only what the STATION needs to present an
 * experience and hand the player over: a name, a description, a destination
 * and how that destination is reached. It knows nothing about the
 * experience's protocol, issuer keys or item schema; those live where the
 * inventory reads them (`src/inventory/trusted-issuers.ts`), and a change to
 * either side never requires a change to the other.
 *
 * ## Launch modes
 *
 * `external` is the only mode today: the destination opens in a new browser
 * tab through the external-egress boundary (`src/external-egress`), so the
 * Island tab, its session and its live inventory subscription stay exactly
 * where they are while the player plays elsewhere. The union is deliberately
 * a type so a future `embedded` or `auto` value can be added in one place and
 * exhaustively switched on; nothing implements them, and nothing should until
 * the signer, storage-partitioning and session-ownership questions an embed
 * raises have answers.
 */

/** How the Station hands the player to an experience. */
export type ConnectedExperienceLaunchMode = 'external';

export interface ConnectedExperience {
  /** Stable identity; storage keys and tests hang off it, never the name. */
  readonly id: string;
  /** Player-facing name. */
  readonly name: string;
  /** One line: what the player does there. */
  readonly tagline: string;
  /** A short paragraph, player language only, no protocol vocabulary. */
  readonly description: string;
  /** Why it belongs in Blobbi Island: what comes back. */
  readonly interoperability: string;
  /** The destination, absolute `https:` URL. Egress validates it again. */
  readonly url: string;
  readonly launchMode: ConnectedExperienceLaunchMode;
  /**
   * The source label the inventory already prints on items from this
   * experience (`TrustedItemIssuer.label`), so the Station and the inventory
   * call the same thing by the same name. Optional: an experience need not
   * feed the inventory.
   */
  readonly sourceLabel?: string;
  /** Artwork for the card, when a suitable asset exists. */
  readonly image?: string;
}

/**
 * The official Nostr Farm web app.
 *
 * The one place this URL is written. The domain may not be live yet; when it
 * moves, this line moves with it, and nothing else in the source has to know.
 */
export const NOSTR_FARM_URL = 'https://farm.blobbi.pet';

export const NOSTR_FARM_EXPERIENCE: ConnectedExperience = {
  id: 'nostr-farm',
  name: 'Nostr Farm',
  tagline: 'Grow food and bring it back to feed your Blobbi.',
  description:
    'Grow crops in an independent Nostr game and bring your harvest back to Blobbi Island.',
  interoperability:
    'Food you harvest in Farm appears in your shared inventory here, ready to feed your Blobbi.',
  url: NOSTR_FARM_URL,
  launchMode: 'external',
  // Matches the inventory tile's pill for Farm produce (trusted-issuers.ts).
  sourceLabel: 'Farm',
};

/** Every experience the Station presents, in display order. */
export const CONNECTED_EXPERIENCES: readonly ConnectedExperience[] = [NOSTR_FARM_EXPERIENCE];

const BY_ID = new Map(CONNECTED_EXPERIENCES.map((experience) => [experience.id, experience]));

export function getConnectedExperience(id: string): ConnectedExperience | undefined {
  return BY_ID.get(id);
}

/**
 * Per-experience destination overrides, for pointing a build at a local or
 * staging deployment without touching the registry. Read from the build
 * environment by {@link connectedExperienceUrlOverrides}; tests pass their own.
 */
export type ConnectedExperienceUrlOverrides = Readonly<Partial<Record<string, string>>>;

/** `VITE_CONNECTED_EXPERIENCE_URL_NOSTR_FARM=https://…` overrides the Farm URL. */
export function connectedExperienceUrlOverrides(
  env: Readonly<Record<string, string | undefined>> = import.meta.env as Readonly<
    Record<string, string | undefined>
  >,
): ConnectedExperienceUrlOverrides {
  const overrides: Partial<Record<string, string>> = {};
  for (const experience of CONNECTED_EXPERIENCES) {
    const value = env[overrideEnvName(experience.id)]?.trim();
    if (value) overrides[experience.id] = value;
  }
  return overrides;
}

/** `nostr-farm` becomes `VITE_CONNECTED_EXPERIENCE_URL_NOSTR_FARM`. */
export function overrideEnvName(experienceId: string): string {
  return `VITE_CONNECTED_EXPERIENCE_URL_${experienceId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/**
 * The URL the Station will ask egress to open for `experience`: the override
 * for its id when one is set, its registry URL otherwise. No validation here;
 * the egress boundary refuses anything that is not an external `https:`
 * destination, and refusing there is what makes the refusal real.
 */
export function resolveConnectedExperienceUrl(
  experience: ConnectedExperience,
  overrides: ConnectedExperienceUrlOverrides = connectedExperienceUrlOverrides(),
): string {
  return overrides[experience.id] ?? experience.url;
}
