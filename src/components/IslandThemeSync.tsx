import { useEffect, useRef } from 'react';

import type { AppConfig } from '@/contexts/AppContext';
import type { DittoThemeSettingsResult } from '@/hooks/useDittoThemeSettings';
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
 * ## Which selection is newer — and why that question has to be asked
 *
 * The two sides are not symmetric. `AppConfig.theme` changes the instant the
 * player clicks; the account's copy is published after a two-second debounce,
 * and a reload, a closed picker or a dead relay can mean it never lands at all.
 * So the relay's answer is stale by construction for a window after every
 * selection, and "the account says X, I say Y" is NOT evidence that X is what
 * the player wants.
 *
 * Reconciliation therefore adopts only when the remote is genuinely the newer
 * word:
 *
 * ```
 *   themeChosenBy !== pubkey    the local choice is not this account's → adopt
 *   themeChosenAt undefined     no recorded choice here at all      → adopt
 *   remoteMs > themeChosenAt    the account chose later, elsewhere  → adopt
 *   otherwise                   the local choice is newer → leave it alone
 * ```
 *
 * The provenance lives on the CHOICE, in the config, rather than in a ref —
 * because a ref is gone after a reload, and a reload was the moment the bug
 * showed itself.
 *
 * ## What it will never do
 *
 * - Reset the selection because a read failed. Both reads throw on an unusable
 *   outcome rather than resolving to `null`, so "no remote theme" here is a
 *   CONFIRMED absence — and even that only means "do nothing".
 * - Overwrite a newer local choice with an older remote one. See above.
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
    const pubkey = user?.pubkey;
    if (adopted.current || !pubkey) return;

    const remote = resolveRemoteSelection({
      settingsConfig: themeConfigFromDittoSettings(dittoSettings.data?.settings),
      activeConfig: active.data?.config ?? null,
      activeSourceAddress: active.data?.sourceAddress ?? null,
      activeIslandThemeId: active.data?.islandThemeId ?? null,
      settingsUpdatedAtMs: settingsUpdatedAtMs(dittoSettings.data),
      activeUpdatedAtMs: secondsToMs(active.data?.createdAt),
    });

    /*
      UNKNOWN, not absent.

      Both reads throw on an unusable outcome rather than resolving empty, so
      arriving here with nothing means either "still loading" or "this account
      genuinely has no theme". Neither is a reason to touch the selection — and
      neither answers the question, so the guard below stays unarmed and the
      effect asks again when the reads land.
    */
    if (!remote) return;

    /*
      ARMED HERE, on every path that ANSWERS the question — not only on the
      paths that write.

      This is the regression. The effect re-runs on `selectedId`, so when the
      account already agreed at boot the old code returned early WITHOUT arming
      the guard; the player's very next theme change re-entered reconciliation,
      found the relay still holding the previous selection, and overwrote the
      choice they had just made. Reconciliation is a question about this
      session, and it has now been asked.
    */
    adopted.current = true;

    /*
      The provenance an ADOPTED selection carries.

      Its age is the ACCOUNT's, not this moment's: stamping `now` would make a
      theme chosen on another device last week outrank one chosen there
      yesterday, and the next boot would then refuse the newer of the two.
    */
    const adoptedProvenance = { themeChosenAt: remote.updatedAtMs, themeChosenBy: pubkey };

    // Already showing it — but the CONTENT of a self-contained theme can change
    // while its id does not, so the cache is refreshed even when the id matches.
    if (remote.id === selectedId && remote.id !== DITTO_ACTIVE_THEME_ID) return;

    // The local choice is the newer word, or it is this account's and the relay
    // simply has not caught up yet. Leaving it alone is the whole point.
    if (!remoteWins({ remote, config, pubkey })) return;

    if (remote.id === DITTO_ACTIVE_THEME_ID) {
      const cachedConfig = JSON.stringify(remote.theme.config ?? null);
      const currentConfig = JSON.stringify(readCurrentConfig(selectedId));
      if (remote.id === selectedId && cachedConfig === currentConfig) return;
      writeIslandThemeCache(remote.theme);
      updateConfig((current) => ({
        ...current,
        theme: DITTO_ACTIVE_THEME_ID,
        ...adoptedProvenance,
      }));
      return;
    }

    updateConfig((current) => ({ ...current, theme: remote.id, ...adoptedProvenance }));
  }, [
    dittoSettings.data,
    active.data,
    user?.pubkey,
    selectedId,
    config,
    updateConfig,
  ]);

  return null;
}

/** Seconds (Nostr `created_at`) as epoch milliseconds, or 0 when absent. */
function secondsToMs(seconds: number | null | undefined): number {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : 0;
}

/**
 * When the settings blob last said something about the theme.
 *
 * `lastSync` is Ditto's own millisecond stamp and is preferred, because it is
 * written by whichever client made the change. The event's `created_at` is the
 * fallback: it is only second-resolution and it moves when anything else in the
 * blob is rewritten, but it is never absent.
 */
function settingsUpdatedAtMs(result: DittoThemeSettingsResult | undefined): number {
  const lastSync = result?.settings?.lastSync;
  if (typeof lastSync === 'number' && Number.isFinite(lastSync)) return lastSync;
  return secondsToMs(result?.createdAt);
}

/**
 * Does the account's selection outrank this browser's?
 *
 * Three ways it can, and the order matters:
 *
 *  1. **The local choice is not this account's.** `AppConfig.theme` is
 *     per-browser; 16767 and 30078 are per-account. Signing in as somebody else
 *     adopts THEIR theme even though it is older than what is on screen — that
 *     is the intended scope, not an accident, and it is why provenance is
 *     checked before recency.
 *  2. **No local choice on record.** A config written before these fields
 *     existed, or a player who has never changed theme. Unknown yields to the
 *     account, which is exactly what shipped before.
 *  3. **Genuinely newer.** Strictly greater, so a tie keeps what the player is
 *     looking at. The remote side is second-resolution and the local side is
 *     milliseconds, so ties are common inside the second a selection is made —
 *     and in that second the local value is the one that was chosen last.
 */
function remoteWins(input: {
  remote: RemoteSelection;
  config: AppConfig;
  pubkey: string;
}): boolean {
  const { remote, config, pubkey } = input;
  if (config.themeChosenBy !== pubkey) return true;
  if (typeof config.themeChosenAt !== 'number') return true;
  return remote.updatedAtMs > config.themeChosenAt;
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
  /**
   * When the account last said this, in epoch milliseconds.
   *
   * The NEWEST of whichever channels contributed: the two are written by
   * different clients at different times, and the question being answered is
   * "when did this account last express a theme", not "when was this particular
   * event stored".
   */
  updatedAtMs: number;
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
  /** When the settings blob last changed, in ms. Omitted by callers that cannot say. */
  settingsUpdatedAtMs?: number;
  /** When the active-theme event was published, in ms. */
  activeUpdatedAtMs?: number;
}): RemoteSelection | null {
  const updatedAtMs = Math.max(input.settingsUpdatedAtMs ?? 0, input.activeUpdatedAtMs ?? 0);

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
        updatedAtMs,
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
    updatedAtMs,
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
