/**
 * Ditto's ENCRYPTED APP SETTINGS — where "the theme I am using" actually lives.
 *
 * ## The mistake this module exists to correct
 *
 * The first interop attempt assumed kind:16767 was Ditto's active-theme state.
 * It is not. In the current Ditto source, `useActiveProfileTheme` — the only
 * reader of 16767 — is consumed by exactly two files, `ProfilePage.tsx` and
 * `FollowPage.tsx`. Kind 16767 DECORATES A PROFILE: it is a public
 * advertisement of your palette so other people see your colours when they look
 * at you.
 *
 * Ditto's own app theme is two fields on its `AppConfig`:
 *
 * ```
 *   theme:       'light' | 'dark' | 'system' | 'custom'
 *   customTheme: ThemeConfig    // only rendered when theme === 'custom'
 * ```
 *
 * and those travel between devices as **NIP-78 kind:30078**, `d` =
 * `"ditto/metadata"`, with the whole settings object NIP-44 encrypted to the
 * author's own pubkey. That is the channel Island has to speak to be adopted by
 * Ditto, and to notice a theme chosen in Ditto.
 *
 * Ditto *does* also read 16767 on pageload (`NostrSync.tsx`, when
 * `autoShareTheme` — which defaults to `true`), but it writes the result into
 * `customTheme` and, in its own words, does "NOT change the `theme` value". So
 * a 16767 alone is invisible in Ditto unless that account's mode already
 * happens to be `'custom'`. Both channels are needed; only one of them decides.
 *
 * ## Writing another app's settings blob
 *
 * This module writes into `ditto/metadata`, which belongs to Ditto. That is a
 * deliberate and narrow decision, and the safety comes from the merge rule:
 *
 *   - the current blob is read FRESH and decrypted before every write;
 *   - if it cannot be decrypted, **nothing is written** — a failed read must
 *     never become "the user had no settings", which would publish a blob
 *     containing a theme and erase their feed settings, filters and relays;
 *   - only `theme`, `customTheme` and `lastSync` are touched. Every other key,
 *     known or not, is carried through verbatim.
 *
 * Ditto's own `EncryptedSettingsSchema` is a `z.looseObject`, so unknown keys
 * already survive its round trip; this module is held to the same standard from
 * the other side.
 */

import type { NostrEvent } from '@nostrify/nostrify';

import { parseHslTriplet, sanitizeThemeText, sanitizeThemeUrl, THEME_TITLE_MAX } from '@/lib/nostr-theme';
import type { ThemeBackground, ThemeConfig, ThemeFont } from '@/lib/nostr-theme';

/** NIP-78 application-specific data. */
export const NIP78_KIND = 30078;

/**
 * Ditto's settings `d` tag: `` `${config.appId}/metadata` `` with `appId:
 * "ditto"` (see `src/App.tsx` in the Ditto repo).
 *
 * Hardcoded rather than derived because Island is not Ditto and has no
 * `appId` of its own to substitute — this is the address of a specific other
 * application's settings, and pretending otherwise would invite writing to the
 * wrong one.
 */
export const DITTO_APP_ID = 'ditto';
export const DITTO_SETTINGS_D = `${DITTO_APP_ID}/metadata`;

/** The subset of Ditto's settings Island understands. Everything else passes through. */
export interface DittoThemeSettings {
  /** `'light' | 'dark' | 'system' | 'custom'` — Ditto's theme MODE. */
  theme?: string;
  /** Rendered by Ditto only when `theme === 'custom'`. */
  customTheme?: ThemeConfig;
  autoShareTheme?: boolean;
  /** Milliseconds. Ditto stamps this on every write; it is the ordering key. */
  lastSync?: number;
  /** The complete decoded blob, so a write can preserve what it does not know. */
  raw: Record<string, unknown>;
}

/** A settings blob shape Island will accept as a theme config. */
function readThemeConfig(value: unknown): ThemeConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;

  const colorsRaw = record.colors;
  if (!colorsRaw || typeof colorsRaw !== 'object') return undefined;
  const colors = colorsRaw as Record<string, unknown>;

  // Ditto stores HSL channel triplets here, not hex — the hex encoding is the
  // EVENT format. A blob that fails this is not defaulted; it is refused, so a
  // corrupt settings entry cannot paint an unreadable island.
  const background = colors.background;
  const text = colors.text ?? colors.foreground;
  const primary = colors.primary;
  if (![background, text, primary].every((c) => parseHslTriplet(c) !== null)) return undefined;

  const config: ThemeConfig = {
    colors: { background: background as string, text: text as string, primary: primary as string },
  };

  const title = sanitizeThemeText(record.title, THEME_TITLE_MAX);
  if (title) config.title = title;

  const font = readFont(record.font);
  if (font) config.font = font;
  const titleFont = readFont(record.titleFont);
  if (titleFont) config.titleFont = titleFont;

  const bg = readBackground(record.background);
  if (bg) config.background = bg;

  return config;
}

function readFont(value: unknown): ThemeFont | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const family = sanitizeThemeText(record.family, 64);
  if (!family) return undefined;
  const font: ThemeFont = { family };
  const url = sanitizeThemeUrl(record.url);
  if (url) font.url = url;
  return font;
}

function readBackground(value: unknown): ThemeBackground | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const url = sanitizeThemeUrl(record.url);
  if (!url) return undefined;
  const background: ThemeBackground = { url };
  if (record.mode === 'cover' || record.mode === 'tile') background.mode = record.mode;
  const mimeType = sanitizeThemeText(record.mimeType, 64);
  if (mimeType) background.mimeType = mimeType;
  const dimensions = sanitizeThemeText(record.dimensions, 32);
  if (dimensions) background.dimensions = dimensions;
  const blurhash = sanitizeThemeText(record.blurhash, 128);
  if (blurhash) background.blurhash = blurhash;
  return background;
}

/**
 * Parse a DECRYPTED settings blob.
 *
 * Returns `null` for anything that is not a JSON object — and that `null` is
 * load-bearing: it is the difference between "this user has no settings" and
 * "we could not read this user's settings", and only the first may ever lead to
 * a write.
 */
export function parseDittoThemeSettings(decrypted: string): DittoThemeSettings | null {
  if (!decrypted) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;

  return {
    theme: typeof raw.theme === 'string' ? raw.theme : undefined,
    customTheme: readThemeConfig(raw.customTheme),
    autoShareTheme: typeof raw.autoShareTheme === 'boolean' ? raw.autoShareTheme : undefined,
    lastSync: typeof raw.lastSync === 'number' && Number.isFinite(raw.lastSync)
      ? raw.lastSync
      : undefined,
    raw,
  };
}

/** The theme Ditto is currently rendering, or `null` if it is on a built-in mode. */
export function themeConfigFromDittoSettings(
  settings: DittoThemeSettings | null | undefined,
): ThemeConfig | null {
  if (!settings) return null;
  // Ditto renders `customTheme` ONLY when the mode is `custom`
  // (`resolveTheme` → `'custom'` → `config.customTheme`). A `customTheme` left
  // behind under a `light`/`dark`/`system` mode is a stale draft, not what the
  // user is looking at.
  if (settings.theme !== 'custom') return null;
  return settings.customTheme ?? null;
}

/**
 * Build the next settings object: the existing blob with the theme replaced.
 *
 * Everything not named here is spread through untouched, including keys added
 * to Ditto after this was written. `lastSync` is milliseconds, and it is what
 * orders this write against a selection made on another device — it is also the
 * mechanism that survives two selections inside one wall-clock second, which
 * a second-resolution `created_at` cannot.
 */
export function mergeDittoThemeSettings(
  existing: Record<string, unknown>,
  patch: { theme: string; customTheme: ThemeConfig; nowMs: number },
): Record<string, unknown> {
  return {
    ...existing,
    theme: patch.theme,
    customTheme: patch.customTheme,
    lastSync: patch.nowMs,
  };
}

/** The filter that addresses a user's Ditto settings event. */
export function dittoSettingsFilter(pubkey: string) {
  return { kinds: [NIP78_KIND], authors: [pubkey], '#d': [DITTO_SETTINGS_D], limit: 1 };
}

/**
 * Tags for a kind:30078 settings event, matching Ditto's writer.
 *
 * Ditto emits `d`, `title` and `client`. Island emits `d` and `title` with the
 * same values, and its own `client` — a settings blob written from the island
 * should say so, and Ditto never reads the tag.
 */
export function dittoSettingsTags(): string[][] {
  return [
    ['d', DITTO_SETTINGS_D],
    ['title', 'Ditto Metadata'],
    ['client', 'blobbi'],
  ];
}

/** Pick the newest of several settings events. Replaceable: highest `created_at` wins. */
export function newestSettingsEvent(events: readonly NostrEvent[]): NostrEvent | undefined {
  return [...events]
    .filter((e) => e.kind === NIP78_KIND)
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))[0];
}
