/**
 * Theater media admission, the one answer to "may this play here?".
 *
 * ## Why this is not a check in the input component
 *
 * Media enters the theater from four directions, and only one of them is a
 * person typing:
 *
 * ```
 *   the local input                → a URL the viewer pasted
 *   a session `set-media` command  → the HOST changed the video
 *   joining a session              → whatever is already playing
 *   re-seating after a remount     → the session's current media, restored
 * ```
 *
 * A check on the input covers the first and none of the rest. The one that
 * matters most is the second: a guest can join while an approved video is
 * playing and the host can swap it a second later. So the question is asked here,
 * a pure function, and every one of those four paths asks it before anything
 * is handed to a player.
 *
 * ## Capabilities, never a profile
 *
 * `openMediaEntry` is the capability. An experience that has it may name any
 * media the client supports; an experience without it may play only what the
 * catalog approves. Nothing here compares a profile name, which is the rule the
 * whole safety layer rests on (`docs/family-safety-policy.md`).
 */

import type { IslandSafetyPolicy } from '@/safety';

import {
  APPROVED_THEATER_MEDIA,
  approvedMediaFor,
  type ApprovedMedia,
} from './catalog';

/** The identity of a piece of media, as the session protocol carries it. */
export interface TheaterMediaRef {
  readonly provider: string;
  readonly id: string;
}

export type TheaterMediaDenial =
  /** Not something this client can play at all, wrong provider, malformed id. */
  | 'unsupported-media'
  /** Playable, but this experience only shows approved media and this is not. */
  | 'not-approved';

export type TheaterMediaAdmission =
  | {
      readonly admitted: true;
      /**
       * The catalog entry, when there is one.
       *
       * `null` under an open policy for media that simply is not in the
       * catalog: which is normal and not a problem. When it is present the
       * caller should prefer its title (see {@link theaterMediaTitle}).
       */
      readonly approved: ApprovedMedia | null;
    }
  | { readonly admitted: false; readonly reason: TheaterMediaDenial };

/** A YouTube video id is exactly 11 characters of URL-safe base64. */
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Structural support, before any policy question.
 *
 * Deliberately the same shape `lib/shared-playback/parse.ts` enforces on the
 * wire and `lib/youtube-url.ts` produces from a URL; this is the third place
 * that agrees rather than a fourth opinion, and its own test pins them together.
 */
function isSupportedRef(media: TheaterMediaRef | null | undefined): boolean {
  return (
    !!media &&
    media.provider === 'youtube' &&
    typeof media.id === 'string' &&
    YOUTUBE_ID_PATTERN.test(media.id)
  );
}

const ADMITTED_UNAPPROVED: TheaterMediaAdmission = Object.freeze({
  admitted: true,
  approved: null,
});

const DENIALS: Readonly<Record<TheaterMediaDenial, TheaterMediaAdmission>> = Object.freeze({
  'unsupported-media': Object.freeze({ admitted: false, reason: 'unsupported-media' }),
  'not-approved': Object.freeze({ admitted: false, reason: 'not-approved' }),
});

/**
 * Whether this experience may name arbitrary media.
 *
 * The positive reading of the capability, kept as its own function so the input
 * surface and the admission rule below cannot drift apart.
 */
export function allowsOpenMediaEntry(policy: IslandSafetyPolicy): boolean {
  return policy.openMediaEntry;
}

/**
 * Whether the theater screen may go fullscreen.
 *
 * ## Derived, not a new capability, and why
 *
 * `IslandSafetyPolicy` has no `theaterFullscreen` field and this phase did not
 * add one. The policy's own guidance is not to grow the matrix for a single
 * call site, and this has exactly one: the iframe's permissions.
 *
 * It is derived from `openMediaEntry` because the two express the same stance
 * rather than two independent preferences. An experience that curates what plays
 * is one where the theater is a room in the game, the screen is part of the
 * island, with the world visible around it. Fullscreen removes the island and
 * leaves a child alone with a video player, which is precisely the shape the
 * curation was there to avoid.
 *
 * If fullscreen ever needs to vary independently of curation, that is the moment
 * it becomes a capability, with a second call site to justify it. Deriving it
 * here, once and named, is what keeps that decision reversible instead of
 * scattered.
 */
export function allowsTheaterFullscreen(policy: IslandSafetyPolicy): boolean {
  return policy.openMediaEntry;
}

/**
 * May this media play in this experience?
 *
 * @param policy - the resolved capability set
 * @param media - the identity, from the input, the session, or a join
 * @param catalog - the approved list; a parameter so tests inject fixtures
 */
export function admitTheaterMedia(
  policy: IslandSafetyPolicy,
  media: TheaterMediaRef | null | undefined,
  catalog: readonly ApprovedMedia[] = APPROVED_THEATER_MEDIA,
): TheaterMediaAdmission {
  // Structure first: an experience that permits open entry still cannot play a
  // malformed id, and a curated one should say "unsupported" rather than "not
  // approved" when the thing is not media at all.
  if (!isSupportedRef(media)) return DENIALS['unsupported-media'];

  const approved = approvedMediaFor(media!.provider, media!.id, catalog);

  if (allowsOpenMediaEntry(policy)) {
    // Open entry still reports the catalog entry when there is one, so a curated
    // title is used wherever one exists.
    return approved ? Object.freeze({ admitted: true, approved }) : ADMITTED_UNAPPROVED;
  }

  if (!approved) return DENIALS['not-approved'];
  return Object.freeze({ admitted: true, approved });
}

/**
 * The title to display for a piece of media.
 *
 * Under a curated policy this is always the catalog's title, and `null` when
 * there is no entry, a curated client has no other trustworthy source, and a
 * host-supplied name would be an unvalidated string on a child's screen.
 *
 * Note what makes that easy here: the session protocol carries `{provider, id}`
 * and no words at all, so there is no host-supplied title to be tempted by. The
 * function exists so the rule survives a protocol that one day carries more.
 */
export function theaterMediaTitle(
  policy: IslandSafetyPolicy,
  media: TheaterMediaRef | null | undefined,
  catalog: readonly ApprovedMedia[] = APPROVED_THEATER_MEDIA,
): string | null {
  const admission = admitTheaterMedia(policy, media, catalog);
  if (!admission.admitted) return null;
  return admission.approved?.title ?? null;
}
