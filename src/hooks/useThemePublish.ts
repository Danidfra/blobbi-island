/**
 * Publishing themes to Nostr.
 *
 * Two writes, for the two different questions the protocol separates:
 *
 *   `publishTheme`     kind:36767 — "here is a theme, anyone may use it"
 *   `publishSelection` kind:16767 — "this is the theme I am using"
 *
 * ## Editing is republishing
 *
 * kind:36767 is ADDRESSABLE, so its identity is `36767:<pubkey>:<d>` and a
 * second event with the same `d` REPLACES the first. There is therefore no
 * update path and no update endpoint: "edit my theme" is `publishTheme` with
 * the identifier it already has. The one thing that must not happen is
 * accidentally minting a NEW `d` while the player believes they are editing —
 * which is why `identifier` is an explicit parameter and only defaults to a
 * slug of the title when there is genuinely no existing theme.
 *
 * ## Why the selection is published at all
 *
 * Because a theme that only lives in this browser's localStorage is not a
 * preference, it is a browser setting. kind:16767 is the same event Ditto uses
 * for "my active theme", so a selection made on the island survives a new
 * device — and shows up in Ditto, which is the point of using their protocol
 * instead of inventing one.
 *
 * It is a debounced, best-effort write: a player flipping through themes must
 * not publish six events, and a failed publish must not undo their choice. The
 * local selection is the source of truth for what they are looking at; this
 * write is how it travels.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { coreColorsFromPalette } from '@/lib/island-theme-adapter';
import type { IslandTheme } from '@/lib/island-themes';
import {
  ACTIVE_THEME_KIND,
  THEME_DEFINITION_KIND,
  buildActiveThemeTags,
  buildThemeDefinitionTags,
  nostrThemeId,
  titleToSlug,
  type CoreThemeColors,
} from '@/lib/nostr-theme';

/** How long a rapid run of selections is collapsed into one publish. */
const SELECTION_PUBLISH_DEBOUNCE_MS = 2000;

export interface PublishThemeInput {
  title: string;
  description?: string;
  colors: CoreThemeColors;
  /** Set when editing: the existing `d`. Omitted, a slug of the title is used. */
  identifier?: string;
}

export function usePublishTheme() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: PublishThemeInput) => {
      if (!user?.pubkey) throw new Error('Sign in to publish a theme.');

      const title = input.title.trim();
      if (!title) throw new Error('A theme needs a name.');

      const identifier = input.identifier || titleToSlug(title);
      if (!identifier) {
        // A title of nothing but punctuation slugs to the empty string, and an
        // empty `d` is a different addressable event, not this theme.
        throw new Error('That name cannot be used as an identifier — add a letter or number.');
      }

      await createEvent({
        kind: THEME_DEFINITION_KIND,
        // Empty, per the protocol: the colours are tags so relays can index and
        // clients can read them without parsing JSON.
        content: '',
        tags: buildThemeDefinitionTags({
          identifier,
          title,
          colors: input.colors,
          description: input.description,
        }),
      });

      const address = `${THEME_DEFINITION_KIND}:${user.pubkey}:${identifier}`;
      return { identifier, address, themeId: nostrThemeId(address) };
    },
    onSuccess: () => {
      // The author's own list must reflect the write immediately; the community
      // browse will pick it up on its own next fetch.
      queryClient.invalidateQueries({ queryKey: ['nostr-themes', 'mine', user?.pubkey ?? ''] });
      queryClient.invalidateQueries({ queryKey: ['nostr-themes', 'community'] });
    },
  });
}

/**
 * Publish "this is the theme I am using" (kind:16767), debounced.
 *
 * The palette is reduced to the three colours the protocol carries. For a
 * community theme those are the ORIGINAL three from its definition, not a
 * re-derivation of them — round-tripping sixteen derived colours back down to
 * three would drift the theme every time it was re-selected.
 */
export function usePublishThemeSelection() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return useCallback(
    (theme: IslandTheme, sourceColors?: CoreThemeColors) => {
      if (!user?.pubkey) return;

      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        createEvent({
          kind: ACTIVE_THEME_KIND,
          content: '',
          tags: buildActiveThemeTags({
            colors: sourceColors ?? coreColorsFromPalette(theme.palette),
            title: theme.name,
            sourceAddress: theme.address ?? null,
            islandThemeId: theme.id,
          }),
        }).catch(() => {
          // Best-effort by design. The player's selection is already applied
          // and already stored locally; a relay that would not take the event
          // must not undo it, and there is nothing for them to act on.
        });
      }, SELECTION_PUBLISH_DEBOUNCE_MS);
    },
    [user?.pubkey, createEvent],
  );
}

/**
 * Retract a theme the player published (NIP-09).
 *
 * Both an `e` and an `a` tag: the `e` names the event a relay is holding, the
 * `a` names the address so a relay that has since seen a replacement deletes
 * that too. Neither guarantees anything — deletion on Nostr is a request — which
 * is why the picker's copy says "asked to remove" rather than "deleted".
 */
export function useDeleteTheme() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { eventId: string; identifier: string }) => {
      if (!user?.pubkey) throw new Error('Sign in first.');
      await createEvent({
        kind: 5,
        content: '',
        tags: [
          ['e', input.eventId],
          ['a', `${THEME_DEFINITION_KIND}:${user.pubkey}:${input.identifier}`],
          ['k', String(THEME_DEFINITION_KIND)],
        ],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nostr-themes', 'mine', user?.pubkey ?? ''] });
      queryClient.invalidateQueries({ queryKey: ['nostr-themes', 'community'] });
    },
  });
}
