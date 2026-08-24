import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useAppContext } from "@/hooks/useAppContext";
import {
  DEFAULT_ISLAND_THEME_ID,
  islandThemes,
  isBuiltinThemeId,
  resolveIslandTheme,
  type IslandTheme,
} from "@/lib/island-themes";
import {
  clearIslandThemeCache,
  islandThemeCacheVersion,
  readIslandThemeCache,
  subscribeToIslandThemeCache,
  writeIslandThemeCache,
} from "@/lib/island-theme-cache";

/**
 * The palette a stored theme id resolves to WITHOUT touching the network.
 *
 * The authority order the whole feature is built on:
 *
 * ```
 *   built-in registry   in the bundle, cannot fail
 *   palette cache       the last known look of a Nostr theme
 *   default             only when the id is unknown AND uncached
 * ```
 *
 * Note what is NOT here: a relay read. Nothing about first paint may wait on a
 * socket, and nothing about a relay being down may change what the player sees.
 * A selected Nostr theme is refreshed from its live definition afterwards, by
 * `IslandThemeSync`, which lives below the Nostr providers where a relay exists.
 */
export function resolveIslandThemeOffline(
  id: string | undefined,
  /**
   * The serialised cache entry, when the caller is tracking it.
   *
   * Only a cache-busting key: the value is re-read from storage either way, and
   * passing it makes the dependency visible to a memo instead of hidden behind
   * a side effect. Callers that do not track cache writes omit it.
   */
  _cacheVersion?: string,
): IslandTheme {
  if (isBuiltinThemeId(id)) return resolveIslandTheme(id);

  const cached = readIslandThemeCache();
  if (cached && cached.id === id) {
    return {
      id: cached.id,
      name: cached.name,
      description: cached.description,
      emoji: '✨',
      palette: cached.palette,
      source: 'nostr',
      // The interoperable source, so a re-selection republishes the theme's own
      // font and wallpaper instead of a colours-only reduction of it.
      ...(cached.config ? { config: cached.config } : {}),
    };
  }

  return resolveIslandTheme(DEFAULT_ISLAND_THEME_ID);
}

export interface UseThemeResult {
  /** The resolved active theme. Never undefined — an unresolvable id falls back. */
  theme: IslandTheme;
  /**
   * The id as STORED, which is not always `theme.id`: a config carrying an id
   * this build cannot resolve reports that id here while rendering the default
   * theme. The picker uses `theme.id` for what is selected; this exists for
   * diagnostics and for the "your theme is temporarily unavailable" state.
   */
  themeId: string;
  /** Every BUILT-IN theme, in picker order. */
  themes: readonly IslandTheme[];
  /**
   * True when the stored id names a Nostr theme this client cannot render from
   * its cache — the only state in which the island is showing something other
   * than what the player chose.
   */
  isUnresolved: boolean;
  /**
   * Switch themes. Applies immediately and caches the palette for the next boot.
   *
   * Publishing the choice to Nostr is deliberately NOT here — see
   * `useThemeSelection`. This hook is used by surfaces that only read the theme
   * (the account menu's Appearance row), and a read-only surface must not drag
   * a publish path, a signer and a relay into its dependency graph.
   */
  setTheme: (theme: IslandTheme) => void;
}

/**
 * Read and set the active Island theme.
 *
 * ## Where the choice lives
 *
 * The id goes in the `nostr:app-config` localStorage blob — the same one that
 * holds the relay preference — because that is what the pre-paint boot script
 * reads, and boot must never wait on anything. When the player is signed in the
 * choice is ALSO published as kind:16767 (`useThemeSelection`), which is what
 * makes it survive a new device and what lets Ditto show the same theme.
 * Neither is a fallback for the other: local is what this browser paints, 16767
 * is what the player last chose anywhere, and `IslandThemeSync` reconciles them
 * once on login.
 *
 * ## A relay outage is not a theme change
 *
 * If the selected theme is a Nostr theme and it cannot be read, the cached
 * palette keeps rendering and the stored id is left alone. The player is told
 * only when there is no cache either — the one case where what they see is
 * genuinely not what they chose.
 */
export function useTheme(): UseThemeResult {
  const { config, updateConfig } = useAppContext();
  const storedId = config.theme;

  /*
    The cache is part of the input, not just a boot optimisation.

    `ditto:active` names "whatever theme this account is using", so `IslandThemeSync`
    can replace its CONTENT without the id changing. Memoising on the id alone
    would leave the island painted with the previous theme until something else
    happened to re-render. Subscribing to the cache is what makes an adoption
    visible immediately.
  */
  const cacheVersion = useSyncExternalStore(
    subscribeToIslandThemeCache,
    islandThemeCacheVersion,
    () => '',
  );

  // `cacheVersion` is the serialised cache entry, so passing it THROUGH the
  // resolver rather than only as a dependency keeps the lint rule honest: it is
  // a real input, not a hidden one.
  const theme = useMemo(
    () => resolveIslandThemeOffline(storedId, cacheVersion),
    [storedId, cacheVersion],
  );

  const setTheme = useCallback(
    (next: IslandTheme) => {
      if (next.source === 'nostr') {
        // Cached BEFORE the config write, so the next boot has the palette even
        // if the tab is closed in the same instant.
        writeIslandThemeCache(next);
      } else {
        // A built-in needs no cache, and leaving a stale one behind would let a
        // later corrupt config resolve to a theme the player is not using.
        clearIslandThemeCache();
      }
      updateConfig((current) => ({ ...current, theme: next.id }));
    },
    [updateConfig],
  );

  return {
    theme,
    themeId: storedId,
    themes: islandThemes,
    isUnresolved: !isBuiltinThemeId(storedId) && theme.id !== storedId,
    setTheme,
  };
}
