import { useCallback, useMemo } from "react";

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
  readIslandThemeCache,
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
export function resolveIslandThemeOffline(id: string | undefined): IslandTheme {
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

  const theme = useMemo(() => resolveIslandThemeOffline(storedId), [storedId]);

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
