import { useEffect, useRef } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useActiveThemeEvent, useSelectedNostrTheme } from '@/hooks/useNostrThemes';
import { useDittoThemeSettings } from '@/hooks/useDittoThemeSettings';
import { writeIslandThemeCache } from '@/lib/island-theme-cache';
import { paletteFromCoreColors } from '@/lib/island-theme-adapter';
import {
  DITTO_ACTIVE_THEME_ID,
  isBuiltinThemeId,
  isKnownIslandThemeId,
  type IslandTheme,
} from '@/lib/island-themes';
import { themeConfigFromDittoSettings } from '@/lib/ditto-settings';
import { addressFromNostrThemeId, nostrThemeId, type ThemeConfig } from '@/lib/nostr-theme';

/**
 * IslandThemeSync — reconciles the local theme selection with the account.
 *
 * Renders nothing. It lives BELOW the Nostr providers, which is the whole
 * reason it exists as a component rather than living in `AppProvider`: the
 * provider sits above them, has no relay, and must not wait for one before the
 * island paints. Everything here happens after first paint, and none of it is
 * allowed to change what the player is looking at unless it is strictly better
 * information.
 *
 * ## The two channels, and which one wins
 *
 * ```
 *   kind:30078   PRIVATE, `d = "ditto/metadata"`, NIP-44 to self.
 *                `theme` + `customTheme`. This is what Ditto RENDERS, so it is
 *                the authority. Carries `lastSync` in MILLISECONDS.
 *   kind:16767   PUBLIC. The palette the account is advertising. Ditto writes
 *                it ~2s after a selection when `autoShareTheme` (default true),
 *                and NOT AT ALL when the selection is a plain built-in mode.
 *                Second-resolution `created_at`.
 * ```
 *
 * 30078 is read first and preferred. 16767 is the fallback, and it is the one
 * that carries an `a` reference back to a named definition — so when both are
 * present, the settings blob decides WHAT and the active event decides WHICH
 * NAMED THEME, if any.
 *
 * ## Why the previous implementation adopted nothing
 *
 * It required a remote event to name a theme it could resolve: an `island-theme`
 * tag it wrote itself, or an `a` tag pointing at a kind:36767 definition. Ditto
 * publishes NEITHER for the common case — selecting a preset, or nudging a
 * colour, produces a self-contained 16767 with three `c` tags and no reference
 * at all. Island saw `remoteId === null` and returned early, every time. A
 * self-contained theme is now adopted on its own terms, under the reserved id
 * {@link DITTO_ACTIVE_THEME_ID}, exactly as Ditto's own `theme: 'custom'` has no
 * name either.
 *
 * ## What it will never do
 *
 * - Reset the selection because a read failed. Both reads throw on an unusable
 *   outcome rather than resolving to `null`, so "no remote theme" here is a
 *   CONFIRMED absence — and even that only means "do nothing".
 * - Adopt a named id it cannot resolve. That would trade a working island for
 *   the fallback one.
 * - Publish. Writing is `useThemePublish`'s job, and only when the player
 *   actually chooses something.
 */
export function IslandThemeSync() {
  const { config, updateConfig } = useAppContext();
  const { user } = useCurrentUser();
  const selectedId = config.theme;

  const selected = useSelectedNostrTheme(selectedId);
  const active = useActiveThemeEvent();
  const dittoSettings = useDittoThemeSettings();

  // ── 1. Refresh the cache from the live definition ──────────────────────────
  useEffect(() => {
    const theme = selected.data;
    if (!theme || theme.id !== selectedId) return;
    writeIslandThemeCache(theme);
  }, [selected.data, selectedId]);

  // ── 2. Adopt the account's selection, once per session ─────────────────────
  const adopted = useRef(false);
  useEffect(() => {
    // A new account is a new question; let it adopt again.
    adopted.current = false;
  }, [user?.pubkey]);

  useEffect(() => {
    if (adopted.current || !user?.pubkey) return;

    const remote = resolveRemoteSelection({
      settingsConfig: themeConfigFromDittoSettings(dittoSettings.data?.settings),
      activeConfig: active.data?.config ?? null,
      activeSourceAddress: active.data?.sourceAddress ?? null,
      activeIslandThemeId: active.data?.islandThemeId ?? null,
    });
    if (!remote) return;

    // Already showing it — but the CONTENT of a self-contained theme can change
    // while its id does not, so the cache is refreshed even when the id matches.
    if (remote.id === selectedId && remote.id !== DITTO_ACTIVE_THEME_ID) return;

    adopted.current = true;

    if (remote.id === DITTO_ACTIVE_THEME_ID) {
      const cachedConfig = JSON.stringify(remote.theme.config ?? null);
      const currentConfig = JSON.stringify(readCurrentConfig(selectedId));
      if (remote.id === selectedId && cachedConfig === currentConfig) return;
      writeIslandThemeCache(remote.theme);
      updateConfig((current) => ({ ...current, theme: DITTO_ACTIVE_THEME_ID }));
      return;
    }

    updateConfig((current) => ({ ...current, theme: remote.id }));
  }, [
    dittoSettings.data,
    active.data,
    user?.pubkey,
    selectedId,
    updateConfig,
  ]);

  return null;
}

/** The cached config for the currently selected id, for change detection. */
function readCurrentConfig(selectedId: string): ThemeConfig | null {
  if (selectedId !== DITTO_ACTIVE_THEME_ID) return null;
  try {
    const raw = localStorage.getItem('nostr:island-theme-cache');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string; config?: ThemeConfig };
    return parsed.id === selectedId ? (parsed.config ?? null) : null;
  } catch {
    return null;
  }
}

interface RemoteSelection {
  id: string;
  theme: IslandTheme;
}

/**
 * What the account says the active theme is, as an Island theme.
 *
 * Exported for tests: this is the decision the whole interop story turns on,
 * and it is pure — no relay, no React, no storage.
 */
export function resolveRemoteSelection(input: {
  settingsConfig: ThemeConfig | null;
  activeConfig: ThemeConfig | null;
  activeSourceAddress: string | null;
  activeIslandThemeId: string | null;
}): RemoteSelection | null {
  // A NAMED theme is preferred whenever the account points at one, because a
  // name survives the author editing it — the definition is re-fetched by
  // address and the island follows the edit. Both signals for a name are
  // considered: the id Island writes for itself, and the `a` reference Ditto
  // writes when a selection came from a definition.
  const named =
    input.activeIslandThemeId ??
    (input.activeSourceAddress ? nostrThemeId(input.activeSourceAddress) : null);

  if (named) {
    const resolvable =
      (isBuiltinThemeId(named) && isKnownIslandThemeId(named)) ||
      addressFromNostrThemeId(named) !== null;
    if (resolvable) {
      return {
        id: named,
        // A named theme's palette comes from its own definition read; this
        // placeholder is never cached, only the id is used.
        theme: {
          id: named,
          name: named,
          description: '',
          emoji: '✨',
          palette: paletteFromCoreColors(
            (input.settingsConfig ?? input.activeConfig)?.colors ?? {
              background: '38 100% 96%',
              text: '30 38% 16%',
              primary: '257 70% 56%',
            },
          ),
          source: isBuiltinThemeId(named) ? 'builtin' : 'nostr',
        },
      };
    }
    // A name this build cannot resolve is NOT a reason to give up: the event
    // also carries the colours, so fall through and adopt them self-contained.
  }

  // SELF-CONTAINED. The settings blob is the authority on what Ditto renders;
  // the active event is the fallback for an account whose settings could not be
  // read (no NIP-44 signer, or a relay that only carries public events).
  const config = input.settingsConfig ?? input.activeConfig;
  if (!config) return null;

  return {
    id: DITTO_ACTIVE_THEME_ID,
    theme: {
      id: DITTO_ACTIVE_THEME_ID,
      name: config.title || 'Your theme',
      description: 'The theme on your Nostr account.',
      emoji: '✨',
      palette: paletteFromCoreColors(config.colors),
      source: 'nostr',
      config,
    },
  };
}
