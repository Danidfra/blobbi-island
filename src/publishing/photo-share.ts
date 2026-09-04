/**
 * Publishing a polaroid publicly, the decision, and the event.
 *
 * ## What this governs, and what it deliberately does not
 *
 * Blobbi Island writes a lot of Nostr. Presence, chat, pet state, inventory,
 * equipment, themes, the owner profile: all of it is game protocol, all of it is
 * required for the island to work at all, and none of it is what
 * `publicNotePublishing` is about.
 *
 * That capability governs exactly one thing, the player taking something they
 * made and posting it, publicly and permanently, to the wider Nostr network
 * under their own key. Today that is one surface: the PhotoBooth's kind 1
 * polaroid share. Reading the capability as "no Nostr events" would have broken
 * the game while protecting nobody, so the gate lives here, on the social post,
 * rather than on `useNostrPublish`.
 *
 * ## Both capabilities, decided before anything leaves the device
 *
 * A photo share is an upload followed by a note. The upload is the irreversible
 * half: Blossom is content-addressed and public, so once the polaroid is up it
 * is up, whether or not the note that was going to reference it ever gets
 * published.
 *
 * So {@link permitPhotoShare} requires BOTH capabilities and is consulted once,
 * before the first byte moves. Checking them where they are used, upload gate at
 * the uploader, note gate at the publisher, would mean a profile that allows
 * uploads and forbids notes performs a permanent public upload and then discovers
 * it may not post. The two capabilities remain independent; it is this
 * *operation* that needs both.
 *
 * ## The event is unchanged
 *
 * This phase is about permission, not about redesigning social posting. The
 * builder below emits exactly the event the PhotoBooth emitted before: a kind 1
 * note (NIP-10) with `t` hashtags and a NIP-92 `imeta` tag carrying `url`, `m`,
 * `summary` and `alt`: all NIP-94 fields, so the attachment is standard. No new
 * kind, no custom tag, no Blobbi-specific publishing convention.
 */

import type { IslandSafetyPolicy } from '@/safety';

/** Which capability refused. Distinct values because they mean different things. */
export type PhotoShareDenial = 'media-uploads-not-permitted' | 'public-notes-not-permitted';

export type PhotoSharePermission =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: PhotoShareDenial };

const ALLOWED: PhotoSharePermission = Object.freeze({ allowed: true });

const DENIALS: Readonly<Record<PhotoShareDenial, PhotoSharePermission>> = Object.freeze({
  'media-uploads-not-permitted': Object.freeze({
    allowed: false,
    reason: 'media-uploads-not-permitted',
  }),
  'public-notes-not-permitted': Object.freeze({
    allowed: false,
    reason: 'public-notes-not-permitted',
  }),
});

/**
 * Whether this experience may publish a polaroid.
 *
 * Pure, and consulted BEFORE the upload. The upload is reported first when both
 * are missing, because it is the step that would have happened first and the one
 * whose consequences are irreversible.
 */
export function permitPhotoShare(policy: IslandSafetyPolicy): PhotoSharePermission {
  if (!policy.mediaUploads) return DENIALS['media-uploads-not-permitted'];
  if (!policy.publicNotePublishing) return DENIALS['public-notes-not-permitted'];
  return ALLOWED;
}

/** The hashtags every Blobbi polaroid carries. */
export const PHOTO_SHARE_HASHTAGS = Object.freeze(['Blobbi', 'BlobbiIsland']);

const MANDATORY_HASHTAG_TEXT = '#Blobbi #BlobbiIsland';

export interface PhotoShareInput {
  /** Whatever the player typed. Empty is fine. */
  readonly caption: string;
  /** The uploaded image's URL, from Blossom. */
  readonly imageUrl: string;
}

/**
 * The kind 1 note, byte-for-byte what the PhotoBooth published before.
 *
 * Pure and exported so a test can pin the shape without a signer, a relay or a
 * network: which is what makes "the publication shape is unchanged" a checkable
 * claim rather than a promise.
 */
export function buildPhotoShareEvent(input: PhotoShareInput): {
  kind: number;
  content: string;
  tags: string[][];
} {
  const caption = input.caption.trim();
  const content = caption
    ? `${caption}\n\n${MANDATORY_HASHTAG_TEXT}\n\n${input.imageUrl}`
    : `${MANDATORY_HASHTAG_TEXT}\n\n${input.imageUrl}`;

  return {
    kind: 1,
    content,
    tags: [
      ['t', 'Blobbi'],
      ['t', 'BlobbiIsland'],
      [
        // NIP-92: `url` plus at least one other field, drawn from NIP-94.
        'imeta',
        `url ${input.imageUrl}`,
        'm image/png',
        `summary blobbi_polaroid ${MANDATORY_HASHTAG_TEXT}`,
        'alt A polaroid photo taken at Blobbi Island with accessories, background, and frame',
      ],
    ],
  };
}
