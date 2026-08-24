/**
 * Blobbi Island — the last-known palette of the selected theme.
 *
 * ## Why a cache exists at all
 *
 * A built-in theme is in the bundle: choosing it is instant and it can never be
 * unavailable. A theme discovered on a relay is neither. Without a cache, a
 * player who chose a community theme would get:
 *
 *   - the default island for the first few hundred milliseconds of every boot,
 *     while the relay is asked what their theme looks like; and
 *   - the default island *permanently* whenever the relay is unreachable.
 *
 * The second is the serious one. A relay outage must not repaint the player's
 * island, and it must ABSOLUTELY not be recorded as "they changed their mind" —
 * so this cache holds the derived palette, and the selection itself stays in
 * `AppConfig.theme` regardless. Losing the cache costs a flash of the default;
 * losing the selection would cost the choice.
 *
 * ## Why the DERIVED palette and not the three core colours
 *
 * Because the pre-paint boot script (`public/island-theme.js`) is what uses it,
 * and that script runs before the module graph loads — it cannot call the
 * adapter. Sixteen ready-to-apply triplets is the one form it can consume with
 * a `for` loop. The adapter is deterministic, so the cached palette and a fresh
 * derivation always agree.
 *
 * ## Authority order
 *
 * ```
 *   AppConfig.theme            the selection. Never overwritten by a read.
 *      +
 *   this cache                 what it looks like, applied before first paint
 *      ↓
 *   relay definition           refreshes the cache when it resolves
 *      ↓
 *   default theme              only when the id is unknown AND uncached
 * ```
 */

import {
  ISLAND_PALETTE_KEYS,
  type IslandPalette,
  type IslandTheme,
} from '@/lib/island-themes';
import { parseHslTriplet, sanitizeThemeText, THEME_TITLE_MAX } from '@/lib/nostr-theme';
import type { ThemeConfig } from '@/lib/nostr-theme';
import { parseDittoThemeSettings } from '@/lib/ditto-settings';

/**
 * localStorage key.
 *
 * Separate from `nostr:app-config` on purpose: the config is the player's
 * PREFERENCES and a corrupt entry there costs them their relay too (the whole
 * blob is discarded when deserialization throws). This is a disposable
 * derivative, so it gets its own key and its own failure mode — a bad value is
 * simply ignored.
 */
export const ISLAND_THEME_CACHE_KEY = 'nostr:island-theme-cache';

export interface CachedIslandTheme {
  /** The theme id this palette belongs to. A mismatch invalidates the cache. */
  id: string;
  name: string;
  description: string;
  palette: IslandPalette;
  /**
   * The interoperable source — Ditto's `ThemeConfig`.
   *
   * Cached alongside the derived palette because it is what gets REPUBLISHED.
   * Without it, an offline boot followed by a re-selection would publish a
   * re-derivation of a derivation and quietly drop the theme's font and
   * wallpaper. Optional so a cache written before this field still loads.
   */
  config?: ThemeConfig;
}

/**
 * Validate an unknown value as a cached theme.
 *
 * Exported because the boot script's test asserts the two agree about what a
 * valid entry is. Everything is checked — every palette key present, every
 * value a parseable HSL triplet — because this value is written straight into
 * custom properties by a script that has no error handling of its own.
 */
export function parseCachedIslandTheme(value: unknown): CachedIslandTheme | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id) return null;
  if (!record.palette || typeof record.palette !== 'object') return null;

  const rawPalette = record.palette as Record<string, unknown>;
  const palette = {} as IslandPalette;
  for (const key of ISLAND_PALETTE_KEYS) {
    const channel = rawPalette[key];
    if (typeof channel !== 'string' || parseHslTriplet(channel) === null) return null;
    palette[key] = channel;
  }

  const cached: CachedIslandTheme = {
    id: record.id,
    name: sanitizeThemeText(record.name, THEME_TITLE_MAX) || 'Theme',
    description: sanitizeThemeText(record.description, 200),
    palette,
  };

  // Re-validated through the same reader the settings blob uses, so a tampered
  // cache cannot smuggle a `javascript:` font URL past the media layer.
  const config = readCachedConfig(record.config);
  if (config) cached.config = config;
  return cached;
}

/**
 * Validate a cached `ThemeConfig`.
 *
 * Deliberately re-uses `themeConfigFromDittoSettings`' sibling reader rather
 * than trusting the value: localStorage is writable by anything running on the
 * origin, and this config feeds a `@font-face` src and a `url()`.
 */
function readCachedConfig(value: unknown): ThemeConfig | undefined {
  const settings = parseDittoThemeSettings(
    JSON.stringify({ theme: 'custom', customTheme: value ?? null }),
  );
  return settings?.customTheme;
}

/** Read the cached theme, or `null` if there is none or it is unusable. */
export function readIslandThemeCache(): CachedIslandTheme | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ISLAND_THEME_CACHE_KEY);
    if (!raw) return null;
    return parseCachedIslandTheme(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Fired after every cache write.
 *
 * The reserved id {@link DITTO_ACTIVE_THEME_ID} names "whatever theme this
 * account is currently using", so its CONTENT changes while its id does not —
 * which means a consumer memoising on the id alone would never repaint. This is
 * how they find out. A plain DOM event rather than a store because the cache is
 * a module-level side effect on `localStorage`, not React state.
 */
export const ISLAND_THEME_CACHE_EVENT = 'island:theme-cache';

/** Subscribe to cache writes. Returns an unsubscribe function. */
export function subscribeToIslandThemeCache(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(ISLAND_THEME_CACHE_EVENT, listener);
  return () => window.removeEventListener(ISLAND_THEME_CACHE_EVENT, listener);
}

/** A value that changes whenever the cache does — the snapshot for a store. */
export function islandThemeCacheVersion(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return localStorage.getItem(ISLAND_THEME_CACHE_KEY) ?? '';
  } catch {
    return '';
  }
}

function announce(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ISLAND_THEME_CACHE_EVENT));
}

/** Write the cached theme. Silent on failure — a full quota is not an error here. */
export function writeIslandThemeCache(theme: IslandTheme): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const entry: CachedIslandTheme = {
      id: theme.id,
      name: theme.name,
      description: theme.description,
      palette: theme.palette,
      ...(theme.config ? { config: theme.config } : {}),
    };
    localStorage.setItem(ISLAND_THEME_CACHE_KEY, JSON.stringify(entry));
    announce();
  } catch {
    // Ignored. The cache is an optimisation; the selection is elsewhere.
  }
}

/** Drop the cache. Used when the player selects a built-in theme. */
export function clearIslandThemeCache(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(ISLAND_THEME_CACHE_KEY);
    announce();
  } catch {
    // Ignored, as above.
  }
}
