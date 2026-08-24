import { createContext } from "react";

/**
 * The id of the active Island theme.
 *
 * Deliberately `string` and not a union of the ids that exist in this build.
 * A stored preference outlives the build that wrote it — a removed seasonal
 * theme, or a player on a cached bundle — and the recovery for an id this
 * build does not know is to fall back to the default, which
 * `resolveIslandTheme` does at the point of use. Widening the type here is what
 * keeps that fallback the ONLY place the question is asked; a union would push
 * a cast or a `catch` into every consumer instead.
 *
 * Use `islandThemeIds` / `isKnownIslandThemeId` from `@/lib/island-themes` when
 * you need to know whether a specific id is real.
 */
export type Theme = string;

export interface AppConfig {
  /**
   * Active Island theme id — see `src/lib/island-themes.ts`.
   *
   * This field previously held `"light" | "dark" | "system"`. Blobbi Island has
   * no generic light/dark mode (an evening island is a THEME, authored with the
   * game's own colours), so those values are no longer meaningful. They are not
   * migrated: a config still carrying one resolves to the default theme through
   * the same unknown-id fallback every other stale id takes.
   */
  theme: Theme;
  /** Selected relay URL */
  relayUrl: string;
}

export interface AppContextType {
  /** Current application configuration */
  config: AppConfig;
  /** Update configuration using a callback that receives current config and returns new config */
  updateConfig: (updater: (currentConfig: AppConfig) => AppConfig) => void;
  /** Optional list of preset relays to display in the RelaySelector */
  presetRelays?: { name: string; url: string }[];
}

export const AppContext = createContext<AppContextType | undefined>(undefined);
