/**
 * The approved-media catalog — the single source of what a curated theater may
 * show.
 *
 * ## It is bundled, not fetched, and that is a safety decision
 *
 * A catalog that arrives over the network has a state nobody wants:
 * *unknown*. A relay times out, a query returns partial results, the app boots
 * offline — and a curated experience is left holding an empty list it cannot
 * distinguish from "nothing is approved". Fail-closed on that is correct but
 * makes the theater unusable on a bad connection; fail-open is unthinkable.
 *
 * A list compiled into the build has no unknown state. It is available at the
 * first frame, identical on every device, cannot be influenced by a relay, and
 * cannot be poisoned by a newer event from an unexpected author. For a set of
 * approved videos that changes on a release cadence rather than a live one, that
 * is strictly better than any protocol.
 *
 * `docs/theater-media-safety.md` §3 records the Nostr primitives that were
 * evaluated for a published catalog and why none of them is adopted yet.
 *
 * ## The production catalog is EMPTY, deliberately
 *
 * Deciding which videos are appropriate for children is editorial work with real
 * consequences, and it needs a person who can watch them and sign off. It is not
 * something to be invented alongside the code that will show them — an
 * engineering guess here would be a list of videos this project asserts are safe
 * for a nine-year-old on no evidence at all.
 *
 * So the array below ships empty and the enforcement around it is complete and
 * tested. Populating it is one edit to this file; until then a curated theater
 * honestly shows "nothing approved yet" rather than something nobody vetted.
 *
 * ## Trusted identity, trusted title
 *
 * An entry is `(provider, providerMediaId)` — the canonical identity of the
 * media — plus a `title` that belongs to THIS file. That second half matters:
 * the session protocol carries only a provider and an id, so a host cannot
 * supply words, and a curated client never renders a name anybody else chose.
 */

/** The one provider the theater can play today. */
export type ApprovedMediaProvider = 'youtube';

export interface ApprovedMedia {
  /**
   * Stable catalog identifier, independent of the provider.
   *
   * Separate from `providerMediaId` so an entry can survive a provider change
   * (a re-upload, a move to self-hosting) without becoming a different thing to
   * everything that references it.
   */
  readonly id: string;
  readonly provider: ApprovedMediaProvider;
  /** The provider's own identifier — an 11-character YouTube video id. */
  readonly providerMediaId: string;
  /**
   * What a curated client displays. **Trusted**, because it comes from here.
   *
   * Never taken from the session, never from the host, never from the provider.
   */
  readonly title: string;
  /** Optional grouping hint for the shelf. */
  readonly category?: string;
}

/**
 * The approved videos.
 *
 * **Intentionally empty.** See the module note: populating it is an editorial
 * decision requiring someone to watch the content and sign off, and inventing
 * entries here would be asserting a child-safety claim on no evidence.
 *
 * Adding one is a single object literal. Nothing else changes.
 */
export const APPROVED_THEATER_MEDIA: readonly ApprovedMedia[] = Object.freeze([]);

/** A YouTube video id is exactly 11 characters of URL-safe base64. */
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Structural validity of a catalog entry.
 *
 * Applied to the bundled list by its own test, so a typo in an id fails the
 * build rather than silently approving nothing — an entry that can never match
 * is indistinguishable from an entry that was never added.
 */
export function isWellFormedApprovedMedia(entry: ApprovedMedia): boolean {
  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    entry.provider === 'youtube' &&
    YOUTUBE_ID_PATTERN.test(entry.providerMediaId) &&
    typeof entry.title === 'string' &&
    entry.title.trim().length > 0
  );
}

/**
 * The approved entry for a piece of media, or `null`.
 *
 * Matching is on the canonical identity — provider AND provider id — never on
 * the title, and never on a URL. A caller holding a URL parses it first
 * (`youtube-url.ts`); this function only ever sees a resolved id.
 *
 * The catalog is a parameter so tests can supply fixtures without mocking a
 * module, and so a future catalog source is a change of argument rather than a
 * change of shape.
 */
export function approvedMediaFor(
  provider: string,
  providerMediaId: string,
  catalog: readonly ApprovedMedia[] = APPROVED_THEATER_MEDIA,
): ApprovedMedia | null {
  if (!provider || !providerMediaId) return null;
  return (
    catalog.find(
      (entry) =>
        isWellFormedApprovedMedia(entry) &&
        entry.provider === provider &&
        entry.providerMediaId === providerMediaId,
    ) ?? null
  );
}

/** Whether this exact media identity is approved. */
export function isApprovedMedia(
  provider: string,
  providerMediaId: string,
  catalog: readonly ApprovedMedia[] = APPROVED_THEATER_MEDIA,
): boolean {
  return approvedMediaFor(provider, providerMediaId, catalog) !== null;
}

/** Every well-formed entry, for the shelf. Malformed entries are not offered. */
export function approvedMediaShelf(
  catalog: readonly ApprovedMedia[] = APPROVED_THEATER_MEDIA,
): readonly ApprovedMedia[] {
  return Object.freeze(catalog.filter(isWellFormedApprovedMedia));
}
