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

  return {
    id: record.id,
    name: sanitizeThemeText(record.name, THEME_TITLE_MAX) || 'Theme',
    description: sanitizeThemeText(record.description, 200),
    palette,
  };
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

/** Write the cached theme. Silent on failure — a full quota is not an error here. */
export function writeIslandThemeCache(theme: IslandTheme): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const entry: CachedIslandTheme = {
      id: theme.id,
      name: theme.name,
      description: theme.description,
      palette: theme.palette,
    };
    localStorage.setItem(ISLAND_THEME_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Ignored. The cache is an optimisation; the selection is elsewhere.
  }
}

/** Drop the cache. Used when the player selects a built-in theme. */
export function clearIslandThemeCache(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(ISLAND_THEME_CACHE_KEY);
  } catch {
    // Ignored, as above.
  }
}
