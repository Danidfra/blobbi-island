/**
 * The social platforms a share can be handed to, and the only place their URLs
 * are built.
 *
 * ## Why this file exists
 *
 * `ShareModal` and `SocialShareModal` each carried the same seven-case `switch`
 * building the same seven URLs and calling `window.open` themselves. Two copies
 * of a share URL is two places to get the encoding wrong, two places to add a
 * platform, and two places a `noopener` fix has to land. The audit recorded it
 * as finding H-6; this is the fix.
 *
 * A feature now says *share with Telegram* and passes what it wants shared. It
 * does not know the host, the query parameters, or that a browser is involved.
 *
 * ## Labels come from here, destinations come from the URL
 *
 * `label` is what the confirmation calls the platform. It is trusted because it
 * is written here — but it is never the authority on where the player is going.
 * That comes from parsing the built URL (`url.ts`), so a wrong label can mislabel
 * a button and can never mis-state a destination.
 */

/** The platforms that take a web share intent. */
export type SocialPlatformId =
  | 'twitter'
  | 'facebook'
  | 'linkedin'
  | 'reddit'
  | 'whatsapp'
  | 'telegram';

/** What is being shared. Encoding is this module's problem, not the caller's. */
export interface SharePayload {
  /** The page being shared. */
  readonly url: string;
  /** The caption or title. */
  readonly text: string;
  /** Hashtags without the `#`, for the platforms that take them separately. */
  readonly hashtags?: readonly string[];
}

export interface SocialShareTarget {
  readonly id: SocialPlatformId;
  /** What the player reads. */
  readonly label: string;
  /** Built here so every share URL has one author. */
  readonly buildUrl: (payload: SharePayload) => string;
}

const encode = encodeURIComponent;

/**
 * The catalog. Every entry produces an `https:` URL, which
 * `classifyDestination` then validates like any other — a catalog entry gets no
 * special trust just because it is local.
 */
export const SOCIAL_SHARE_TARGETS: readonly SocialShareTarget[] = Object.freeze([
  {
    id: 'twitter',
    label: 'X (Twitter)',
    buildUrl: ({ url, text, hashtags }) =>
      `https://twitter.com/intent/tweet?text=${encode(text)}&url=${encode(url)}` +
      (hashtags?.length ? `&hashtags=${encode(hashtags.join(','))}` : ''),
  },
  {
    id: 'facebook',
    label: 'Facebook',
    buildUrl: ({ url }) => `https://www.facebook.com/sharer/sharer.php?u=${encode(url)}`,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    buildUrl: ({ url }) => `https://www.linkedin.com/sharing/share-offsite/?url=${encode(url)}`,
  },
  {
    id: 'reddit',
    label: 'Reddit',
    buildUrl: ({ url, text }) =>
      `https://www.reddit.com/submit?url=${encode(url)}&title=${encode(text)}`,
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    // One `text` parameter carrying both, so the caption and the link arrive
    // together in the message box.
    buildUrl: ({ url, text }) => `https://wa.me/?text=${encode(`${text} ${url}`)}`,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    buildUrl: ({ url, text }) =>
      `https://t.me/share/url?url=${encode(url)}&text=${encode(text)}`,
  },
]);

const BY_ID: ReadonlyMap<string, SocialShareTarget> = new Map(
  SOCIAL_SHARE_TARGETS.map((target) => [target.id, target]),
);

export function socialShareTarget(id: string): SocialShareTarget | null {
  return BY_ID.get(id) ?? null;
}

export function isSocialPlatformId(id: string): id is SocialPlatformId {
  return BY_ID.has(id);
}
