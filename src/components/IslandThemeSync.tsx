import { useEffect, useRef } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useActiveThemeEvent, useSelectedNostrTheme } from '@/hooks/useNostrThemes';
import { writeIslandThemeCache } from '@/lib/island-theme-cache';
import { isBuiltinThemeId, isKnownIslandThemeId } from '@/lib/island-themes';
import { addressFromNostrThemeId, nostrThemeId } from '@/lib/nostr-theme';

/**
 * IslandThemeSync — reconciles the local theme selection with Nostr.
 *
 * Renders nothing. It lives BELOW the Nostr providers, which is the whole
 * reason it exists as a component rather than living in `AppProvider`: the
 * provider sits above them, has no relay, and must not wait for one before the
 * island paints. Everything here happens after first paint, and none of it is
 * allowed to change what the player is looking at unless it is strictly better
 * information.
 *
 * ## Two jobs
 *
 * **1. Keep the palette cache fresh.** When the selected theme is a kind:36767
 * definition and a newer version of it resolves, the cached palette is
 * rewritten so the next boot paints the author's current colours rather than
 * last week's.
 *
 * **2. Adopt a selection made elsewhere, ONCE.** On login, the player's
 * kind:16767 active-theme event says what they last chose on any device. If it
 * names a theme this browser is not showing, this adopts it — once per session,
 * guarded by a ref, because a repeating adopt would fight the player every time
 * they picked something on this device.
 *
 * ## What it will never do
 *
 * - Reset the selection because a read failed. `useActiveThemeEvent` throws on
 *   an unusable read rather than resolving to `null`, so "no active theme" here
 *   is a CONFIRMED absence and even that only means "do nothing".
 * - Adopt a remote selection it cannot resolve. An id naming a theme this build
 *   does not know and cannot fetch is not adopted, because adopting it would
 *   trade a working island for a fallback one.
 * - Write anything. Publishing is `useThemePublish`'s job, and it only happens
 *   when the player actually chooses something.
 */
export function IslandThemeSync() {
  const { config, updateConfig } = useAppContext();
  const { user } = useCurrentUser();
  const selectedId = config.theme;

  const selected = useSelectedNostrTheme(selectedId);
  const active = useActiveThemeEvent();

  // ── 1. Refresh the cache from the live definition ──────────────────────────
  useEffect(() => {
    const theme = selected.data;
    if (!theme || theme.id !== selectedId) return;
    writeIslandThemeCache(theme);
  }, [selected.data, selectedId]);

  // ── 2. Adopt a selection made on another device, once ──────────────────────
  const adopted = useRef(false);
  useEffect(() => {
    // A new account is a new question; let it adopt again.
    adopted.current = false;
  }, [user?.pubkey]);

  useEffect(() => {
    if (adopted.current || !user?.pubkey) return;
    const remote = active.data;
    if (!remote) return;

    const remoteId =
      remote.islandThemeId ??
      (remote.sourceAddress ? nostrThemeId(remote.sourceAddress) : null);
    if (!remoteId || remoteId === selectedId) return;

    // Only adopt an id this client can actually resolve: a built-in it ships,
    // or a well-formed Nostr address it can fetch. Anything else — a theme id
    // from a future build, a malformed tag — is left alone, and the player
    // keeps the island they have.
    const resolvable =
      (isBuiltinThemeId(remoteId) && isKnownIslandThemeId(remoteId)) ||
      addressFromNostrThemeId(remoteId) !== null;
    if (!resolvable) return;

    adopted.current = true;
    updateConfig((current) => ({ ...current, theme: remoteId }));
  }, [active.data, user?.pubkey, selectedId, updateConfig]);

  return null;
}
