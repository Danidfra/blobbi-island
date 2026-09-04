import { createContext } from "react";

/**
 * The id of the active Island theme.
 *
 * Deliberately `string` and not a union of the ids that exist in this build.
 * A stored preference outlives the build that wrote it, a removed seasonal
 * theme, or a player on a cached bundle, and the recovery for an id this
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
   * Active Island theme id; see `src/lib/island-themes.ts`.
   *
   * This field previously held `"light" | "dark" | "system"`. Blobbi Island has
   * no generic light/dark mode (an evening island is a THEME, authored with the
   * game's own colours), so those values are no longer meaningful. They are not
   * migrated: a config still carrying one resolves to the default theme through
   * the same unknown-id fallback every other stale id takes.
   */
  theme: Theme;
  /**
   * When the player last CHOSE a theme in this browser, in epoch milliseconds.
   *
   * Not decoration: it is the only thing that lets `IslandThemeSync` tell "the
   * account chose something newer on another device" from "the relay is still
   * holding the selection I replaced a moment ago". Without it, reconciliation
   * cannot order the two and adopts the remote unconditionally, which silently
   * reverts the choice the player just made.
   *
   * Absent means UNKNOWN, a config written before this field existed, or a
   * player who has never changed theme. Unknown yields to the account, which is
   * the behaviour that shipped before it.
   */
  themeChosenAt?: number;
  /**
   * The account that was signed in when that choice was made.
   *
   * `AppConfig.theme` is per-BROWSER while kind:16767 / kind:30078 are
   * per-ACCOUNT, so signing in as somebody else must adopt THEIR theme even
   * though it is older than what this browser is showing. Recording the author
   * of the choice is what makes that fall out of one comparison instead of
   * needing a second rule: a choice that is not this account's does not
   * outrank this account's.
   *
   * Absent when the choice was made signed out, or by a caller that did not say,
   * both of which yield to the account, the safe direction.
   */
  themeChosenBy?: string;
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
