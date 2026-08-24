import { ReactNode, useLayoutEffect } from 'react';
import { z } from 'zod';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { AppContext, type AppConfig, type AppContextType } from '@/contexts/AppContext';
import { DEFAULT_ISLAND_THEME_ID, applyIslandTheme } from '@/lib/island-themes';
import { resolveIslandThemeOffline } from '@/hooks/useTheme';

interface AppProviderProps {
  children: ReactNode;
  /** Application storage key */
  storageKey: string;
  /** Default app configuration */
  defaultConfig: AppConfig;
  /** Optional list of preset relays to display in the RelaySelector */
  presetRelays?: { name: string; url: string }[];
}

/**
 * Zod schema for AppConfig validation.
 *
 * Both fields are `.catch()`-guarded, so a malformed or outdated entry degrades
 * to the default for that field rather than throwing. That matters more than it
 * looks: `useLocalStorage` catches a throwing deserializer by discarding the
 * WHOLE blob, so without the per-field catch a stale theme id would also cost
 * the player their chosen relay.
 *
 * The theme is not validated against the known ids on purpose — see the note on
 * `Theme` in `src/contexts/AppContext.ts`. An unknown id is resolved (to the
 * default) at the point it is applied, not rejected here, so a theme removed
 * from a later build and then restored still comes back.
 */
const AppConfigSchema: z.ZodType<AppConfig> = z.object({
  theme: z.string().catch(DEFAULT_ISLAND_THEME_ID),
  relayUrl: z.string().url().catch('wss://relay.ditto.pub'),
});

export function AppProvider(props: AppProviderProps) {
  const {
    children,
    storageKey,
    defaultConfig,
    presetRelays,
  } = props;

  // App configuration state with localStorage persistence
  const [config, setConfig] = useLocalStorage<AppConfig>(
    storageKey,
    defaultConfig,
    {
      serialize: JSON.stringify,
      deserialize: (value: string) => {
        const parsed = JSON.parse(value);
        return AppConfigSchema.parse(parsed);
      }
    }
  );

  // Generic config updater with callback pattern
  const updateConfig = (updater: (currentConfig: AppConfig) => AppConfig) => {
    setConfig(updater);
  };

  const appContextValue: AppContextType = {
    config,
    updateConfig,
    presetRelays,
  };

  useApplyIslandTheme(config.theme);

  return (
    <AppContext.Provider value={appContextValue}>
      {children}
    </AppContext.Provider>
  );
}

/**
 * Publish the active theme's palette onto <html>.
 *
 * `useLayoutEffect` rather than `useEffect` so the custom properties land in
 * the same frame the app first paints. In the browser the pre-paint boot script
 * (`public/island-theme.js`) has usually already written the same values, and
 * this is the reconciliation — but the script is best-effort (it can be blocked,
 * or the config can change), so this is the authoritative write.
 *
 * Resolution is deliberately OFFLINE (`resolveIslandThemeOffline`): built-in
 * registry, then the palette cache, then the default. This provider sits above
 * every Nostr provider — it has no relay to ask and must not acquire one, since
 * first paint cannot wait on a socket. A selected Nostr theme is refreshed from
 * its definition afterwards by `IslandThemeSync`, which lives below the
 * providers where a relay exists.
 *
 * Switching a theme is only a custom-property change on the root element. No
 * component unmounts, no context above the router changes identity, and no
 * query is invalidated — which is the reason a player can change theme mid-game
 * without disturbing a mining session, a rhythm track or their position in the
 * world. `island-theme.test.tsx` holds that line.
 */
function useApplyIslandTheme(themeId: string) {
  useLayoutEffect(() => {
    applyIslandTheme(resolveIslandThemeOffline(themeId), document.documentElement);
  }, [themeId]);
}
