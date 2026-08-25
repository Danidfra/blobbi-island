import { useCallback } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTheme } from '@/hooks/useTheme';
import { useSelectedNostrTheme } from '@/hooks/useNostrThemes';
import { usePublishThemeSelection } from '@/hooks/useThemePublish';
import { themeConfigFromIslandTheme } from '@/lib/island-theme-adapter';
import type { IslandTheme } from '@/lib/island-themes';

/**
 * `useTheme` plus everything that needs a relay.
 *
 * The split is deliberate. `useTheme` is a small hook over `AppConfig` that any
 * surface may read — the account menu shows the current theme's name in a row,
 * and that row should not pull a signer, a mutation and a subscription into its
 * dependency graph. THIS hook is for the one surface that actually chooses a
 * theme: it adds the live definition read (so a community theme's edits show
 * up), the loading/unavailable states that read implies, and the two publishes
 * that carry the choice to the player's other devices and to Ditto.
 */
export interface UseThemeSelectionResult extends ReturnType<typeof useTheme> {
  /** True while the selected Nostr theme's definition is being fetched. */
  isResolving: boolean;
  /**
   * True when the selected theme is a Nostr theme that this client can render
   * from neither a live read nor its cache.
   */
  isUnavailable: boolean;
  /**
   * Choose a theme. Applies and stores it, then publishes the selection to both
   * channels (kind:16767 and Ditto's encrypted settings).
   *
   * The INTEROPERABLE config travels rather than the derived palette: for a
   * theme that came from Nostr that is the author's own colours, font and
   * background, so a hop through the island costs nothing. For a built-in it is
   * the three colours plus the name — a complete, valid Ditto theme.
   */
  selectTheme: (theme: IslandTheme) => void;
}

export function useThemeSelection(): UseThemeSelectionResult {
  const base = useTheme();
  const { user } = useCurrentUser();
  const publishSelection = usePublishThemeSelection();
  const selected = useSelectedNostrTheme(base.themeId);

  // A freshly-read definition outranks the cache; the cache outranks nothing
  // being available at all. Both are the same theme id, so this only ever
  // swaps colours, never identity.
  const theme = selected.data && selected.data.id === base.themeId ? selected.data : base.theme;

  const selectTheme = useCallback(
    (next: IslandTheme) => {
      // THE chooser. Every surface that lets a player pick a theme comes
      // through here, which is why the account is attached here: it is the one
      // place that both knows who is signed in and is a deliberate choice
      // rather than a reconciliation. `IslandThemeSync` compares it against the
      // signed-in account to decide whether a remote selection outranks this
      // one — see `remoteWins`.
      base.setTheme(next, user?.pubkey ?? null);
      publishSelection(next, themeConfigFromIslandTheme(next));
    },
    [base, publishSelection, user?.pubkey],
  );

  return {
    ...base,
    theme,
    isResolving: selected.isLoading,
    isUnavailable: base.isUnresolved && !selected.isLoading && !selected.data,
    selectTheme,
  };
}
