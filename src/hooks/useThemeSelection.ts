import { useCallback } from 'react';

import { useTheme } from '@/hooks/useTheme';
import { useSelectedNostrTheme } from '@/hooks/useNostrThemes';
import { usePublishThemeSelection } from '@/hooks/useThemePublish';
import type { IslandTheme } from '@/lib/island-themes';
import type { CoreThemeColors } from '@/lib/nostr-theme';

/**
 * `useTheme` plus everything that needs a relay.
 *
 * The split is deliberate. `useTheme` is a small hook over `AppConfig` that any
 * surface may read — the account menu shows the current theme's name in a row,
 * and that row should not pull a signer, a mutation and a subscription into its
 * dependency graph. THIS hook is for the one surface that actually chooses a
 * theme: it adds the live definition read (so a community theme's edits show
 * up), the loading/unavailable states that read implies, and the kind:16767
 * publish that carries the choice to the player's other devices.
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
   * Choose a theme. Applies and stores it, then publishes the selection.
   *
   * `sourceColors` is the theme's ORIGINAL three colours when it came from a
   * kind:36767 definition, so the published selection carries the author's
   * values rather than a re-derivation of Island's derivation of them — a round
   * trip through sixteen and back to three would drift the theme a little every
   * time it was chosen.
   */
  selectTheme: (theme: IslandTheme, sourceColors?: CoreThemeColors) => void;
}

export function useThemeSelection(): UseThemeSelectionResult {
  const base = useTheme();
  const publishSelection = usePublishThemeSelection();
  const selected = useSelectedNostrTheme(base.themeId);

  // A freshly-read definition outranks the cache; the cache outranks nothing
  // being available at all. Both are the same theme id, so this only ever
  // swaps colours, never identity.
  const theme = selected.data && selected.data.id === base.themeId ? selected.data : base.theme;

  const selectTheme = useCallback(
    (next: IslandTheme, sourceColors?: CoreThemeColors) => {
      base.setTheme(next);
      publishSelection(next, sourceColors);
    },
    [base, publishSelection],
  );

  return {
    ...base,
    theme,
    isResolving: selected.isLoading,
    isUnavailable: base.isUnresolved && !selected.isLoading && !selected.data,
    selectTheme,
  };
}
