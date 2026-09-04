/**
 * Parsing and validation of YouTube video references.
 *
 * The theater accepts an OPEN catalog: the host may load any embeddable YouTube
 * video by pasting a normal watch URL, a `youtu.be` short link, or the bare
 * 11-character video id. Everything else is rejected here, before a player is
 * ever constructed, so an unparseable input produces a friendly message instead
 * of a mysterious embed error.
 *
 * This module is pure: no DOM, no network, no YouTube API. Whether a video is
 * actually *playable* (private, deleted, embedding disabled, region blocked) can
 * only be discovered by trying to embed it; those cases surface as player
 * errors, see `youtube-player.ts`.
 */

/** A YouTube video id is exactly 11 characters of URL-safe base64. */
export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Hostnames whose URLs this parser understands. */
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'www.youtu.be',
]);

/** Path prefixes that carry the video id as the following path segment. */
const PATH_ID_PREFIXES = ['embed', 'shorts', 'v', 'live'];

export type YouTubeParseFailure =
  | 'empty'
  | 'not-a-youtube-link'
  | 'no-video-id'
  | 'invalid-video-id';

export type YouTubeParseResult =
  | { ok: true; videoId: string; startSeconds?: number }
  | { ok: false; reason: YouTubeParseFailure };

/** Human-readable copy for each rejection, kept next to the reasons it explains. */
export const YOUTUBE_PARSE_MESSAGES: Record<YouTubeParseFailure, string> = {
  'empty': 'Paste a YouTube link or video ID to get started.',
  'not-a-youtube-link': "That doesn't look like a YouTube link. Only YouTube videos work for now.",
  'no-video-id': "That YouTube link doesn't point at a single video.",
  'invalid-video-id': 'That video ID looks wrong: YouTube IDs are 11 characters long.',
};

/** `?t=90`, `?t=1m30s`, `#t=90` → seconds. Returns undefined when absent/odd. */
function parseStartSeconds(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match || (!match[1] && !match[2] && !match[3])) return undefined;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/**
 * Resolve any accepted reference to a video id.
 *
 * @param input - A watch URL, a `youtu.be` link, an embed/shorts URL, or a raw id.
 */
export function parseYouTubeInput(input: string): YouTubeParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  // A bare id: the shortest, and the only form with no structure to check.
  if (!/[/\s?#]/.test(trimmed) && !trimmed.includes('.')) {
    return YOUTUBE_ID_PATTERN.test(trimmed)
      ? { ok: true, videoId: trimmed }
      : { ok: false, reason: 'invalid-video-id' };
  }

  // Tolerate links pasted without a scheme ("youtu.be/xyz").
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: 'not-a-youtube-link' };
  }

  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, reason: 'not-a-youtube-link' };
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const isShortLink = url.hostname.toLowerCase().endsWith('youtu.be');

  let candidate: string | undefined;
  if (isShortLink) {
    candidate = segments[0];
  } else if (segments[0] && PATH_ID_PREFIXES.includes(segments[0].toLowerCase())) {
    candidate = segments[1];
  } else {
    candidate = url.searchParams.get('v') ?? undefined;
  }

  if (!candidate) return { ok: false, reason: 'no-video-id' };
  if (!YOUTUBE_ID_PATTERN.test(candidate)) return { ok: false, reason: 'invalid-video-id' };

  const startSeconds =
    parseStartSeconds(url.searchParams.get('t')) ??
    parseStartSeconds(url.searchParams.get('start')) ??
    parseStartSeconds(url.hash.startsWith('#t=') ? url.hash.slice(3) : null);

  return startSeconds === undefined
    ? { ok: true, videoId: candidate }
    : { ok: true, videoId: candidate, startSeconds };
}

/** Convenience guard for ids that arrive from somewhere other than user input. */
export function isValidYouTubeVideoId(value: unknown): value is string {
  return typeof value === 'string' && YOUTUBE_ID_PATTERN.test(value);
}
