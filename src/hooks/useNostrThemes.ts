/**
 * Discovery of Nostr themes (kind:36767).
 *
 * ## The filters, and why they are Ditto's
 *
 * ```
 *   community  [{ kinds: [36767], limit: 60 }]
 *   mine       [{ kinds: [36767], authors: [pubkey], limit: 50 }]
 *   one theme  [{ kinds: [36767], authors: [pubkey], '#d': [d], limit: 1 }]
 * ```
 *
 * Ditto's own theme feed queries by KIND with a limit and pages backwards on
 * `until`; it does not filter on `#t: ['theme']` even though it writes that
 * tag. Island reuses the kind filter — an unfiltered kind query bounded by a
 * limit is not "querying the whole Nostr universe", it is asking one relay for
 * its most recent N events of one narrow, low-volume kind — because filtering
 * on `#t` here would silently hide every theme published by a client that does
 * not write the tag, which is the opposite of interoperating.
 *
 * The single-theme read is by ADDRESS (`authors` + `#d`) rather than by event
 * id, because kind:36767 is addressable: the author republishes on every edit,
 * so an id-keyed read would pin the theme to a version and break the moment
 * they changed a colour.
 *
 * ## Why these reads are completion-aware
 *
 * `NPool.query()` cannot fail — a timeout, a dead socket and a genuinely empty
 * relay all return `[]` (see `src/lib/relay-read.ts`). For a browse list that
 * is survivable, but for the read that resolves the theme the player is
 * CURRENTLY USING it is not: a false empty would say "your theme no longer
 * exists" during a blip. So the selected-theme read throws on an unusable
 * outcome, React Query keeps the last good value, and the palette cache carries
 * the island through regardless.
 */

import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useNostr } from '@/hooks/useNostr';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { readRelayEventsOrThrow } from '@/lib/relay-read';
import { paletteFromCoreColors } from '@/lib/island-theme-adapter';
import { islandThemeFromNostr, type IslandTheme } from '@/lib/island-themes';
import {
  ACTIVE_THEME_KIND,
  THEME_DEFINITION_KIND,
  addressFromNostrThemeId,
  parseActiveTheme,
  resolveThemeDefinitions,
  type ActiveThemeSelection,
  type NostrThemeDefinition,
} from '@/lib/nostr-theme';

/** How many community themes one browse asks for. */
const COMMUNITY_LIMIT = 60;

const READ_TIMEOUT_MS = 4000;

/** Turn a parsed definition into the shape the picker and applier consume. */
export function themeFromDefinition(definition: NostrThemeDefinition): IslandTheme {
  return islandThemeFromNostr({
    address: definition.address,
    pubkey: definition.pubkey,
    title: definition.title,
    description: definition.description,
    palette: paletteFromCoreColors(definition.config.colors),
    // The interoperable source travels WITH the theme, so re-publishing it
    // carries the author's font and wallpaper rather than only its colours.
    config: definition.config,
  });
}

export interface DiscoveredThemes {
  themes: IslandTheme[];
  /** Parsed definitions, keyed by address — the picker needs the core colours. */
  definitions: Map<string, NostrThemeDefinition>;
}

function toDiscovered(events: NostrEvent[]): DiscoveredThemes {
  const definitions = resolveThemeDefinitions(events);
  return {
    themes: definitions.map(themeFromDefinition),
    definitions: new Map(definitions.map((d) => [d.address, d])),
  };
}

/**
 * Themes other people have published.
 *
 * A browse list, so an unusable read resolves to an empty list rather than
 * throwing: "we could not reach a relay" and "nobody has published a theme"
 * look the same to a browser, and the picker renders its own empty state with a
 * relay switcher either way. The distinction matters for the SELECTED theme,
 * and that read is separate and does throw.
 */
export function useCommunityThemes() {
  const { nostr } = useNostr();

  return useQuery<DiscoveredThemes>({
    queryKey: ['nostr-themes', 'community'],
    queryFn: async (c) => {
      const events = await nostr.query(
        [{ kinds: [THEME_DEFINITION_KIND], limit: COMMUNITY_LIMIT }],
        { signal: AbortSignal.any([c.signal, AbortSignal.timeout(READ_TIMEOUT_MS)]) },
      );
      return toDiscovered(events);
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/** Themes the signed-in player has published. */
export function useMyThemes() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery<DiscoveredThemes>({
    queryKey: ['nostr-themes', 'mine', user?.pubkey ?? ''],
    queryFn: async (c) => {
      if (!user?.pubkey) return { themes: [], definitions: new Map() };
      const events = await nostr.query(
        [{ kinds: [THEME_DEFINITION_KIND], authors: [user.pubkey], limit: 50 }],
        { signal: AbortSignal.any([c.signal, AbortSignal.timeout(READ_TIMEOUT_MS)]) },
      );
      return toDiscovered(events);
    },
    enabled: !!user?.pubkey,
    // Short, so a publish or a delete shows up promptly.
    staleTime: 30 * 1000,
  });
}

/**
 * The one theme the player has selected, when that selection is a Nostr theme.
 *
 * This is the read that keeps a chosen community theme alive across reloads,
 * and the one that must not lie. It throws on an unusable outcome so React
 * Query retains the previous value — and the palette cache means the island is
 * already painted correctly before this resolves at all.
 */
export function useSelectedNostrTheme(themeId: string | undefined) {
  const { nostr } = useNostr();
  const address = addressFromNostrThemeId(themeId);

  return useQuery<IslandTheme | null>({
    queryKey: ['nostr-themes', 'selected', address ?? ''],
    queryFn: async (c) => {
      if (!address) return null;
      const [, pubkey, ...rest] = address.split(':');
      const identifier = rest.join(':');

      const events = await readRelayEventsOrThrow(
        nostr,
        [{ kinds: [THEME_DEFINITION_KIND], authors: [pubkey], '#d': [identifier], limit: 1 }],
        { signal: c.signal, timeoutMs: READ_TIMEOUT_MS },
      );

      const [definition] = resolveThemeDefinitions(events);
      // A CONFIRMED empty read means the author deleted or replaced the theme
      // out from under the player. `null` is the honest answer; what happens
      // next is `useTheme`'s decision, and it is to keep the cached palette.
      return definition ? themeFromDefinition(definition) : null;
    },
    enabled: !!address,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });
}

/**
 * The player's own kind:16767 active-theme event.
 *
 * This is the cross-device half of the selection: `AppConfig.theme` is what
 * this browser is showing, and 16767 is what the player last chose ANYWHERE.
 * Reconciliation happens in `IslandThemeSync`, and it is one-directional on
 * boot — a newer remote selection adopts, an unreachable relay changes nothing.
 */
export function useActiveThemeEvent() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery<ActiveThemeSelection | null>({
    queryKey: ['nostr-themes', 'active', user?.pubkey ?? ''],
    queryFn: async (c) => {
      if (!user?.pubkey) return null;
      const events = await readRelayEventsOrThrow(
        nostr,
        [{ kinds: [ACTIVE_THEME_KIND], authors: [user.pubkey], limit: 1 }],
        { signal: c.signal, timeoutMs: READ_TIMEOUT_MS },
      );
      // Replaceable: newest wins, and relays do not promise ordering.
      const newest = [...events].sort((a, b) => b.created_at - a.created_at)[0];
      return newest ? parseActiveTheme(newest) : null;
    },
    enabled: !!user?.pubkey,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
