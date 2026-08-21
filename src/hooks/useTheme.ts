import { useAppContext } from "@/hooks/useAppContext";
import {
  islandThemes,
  resolveIslandTheme,
  type IslandTheme,
} from "@/lib/island-themes";

export interface UseThemeResult {
  /** The resolved active theme. Never undefined — an unknown stored id resolves to the default. */
  theme: IslandTheme;
  /**
   * The id as STORED, which is not always `theme.id`: a config carrying an id
   * this build does not know reports that id here while rendering the default
   * theme. The picker uses `theme.id` for what is selected; this exists for
   * diagnostics.
   */
  themeId: string;
  /** Every theme available in this build, in picker order. */
  themes: readonly IslandTheme[];
  /** Switch themes. Persists immediately and applies without a reload. */
  setTheme: (id: string) => void;
}

/**
 * Read and set the active Island theme.
 *
 * The write goes to the same `nostr:app-config` localStorage blob that holds
 * the relay preference, and publishes nothing — theme is a local display
 * choice, not protocol state.
 */
export function useTheme(): UseThemeResult {
  const { config, updateConfig } = useAppContext();

  return {
    theme: resolveIslandTheme(config.theme),
    themeId: config.theme,
    themes: islandThemes,
    setTheme: (id: string) => {
      updateConfig((currentConfig) => ({
        ...currentConfig,
        theme: id,
      }));
    },
  };
}
