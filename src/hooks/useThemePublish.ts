/**
 * Publishing themes to Nostr.
 *
 * Two writes, for the two different questions the protocol separates:
 *
 *   `publishTheme`     kind:36767, "here is a theme, anyone may use it"
 *   `publishSelection` kind:16767, "this is the theme I am using"
 *
 * ## Editing is republishing
 *
 * kind:36767 is ADDRESSABLE, so its identity is `36767:<pubkey>:<d>` and a
 * second event with the same `d` REPLACES the first. There is therefore no
 * update path and no update endpoint: "edit my theme" is `publishTheme` with
 * the identifier it already has. The one thing that must not happen is
 * accidentally minting a NEW `d` while the player believes they are editing,
 * which is why `identifier` is an explicit parameter and only defaults to a
 * slug of the title when there is genuinely no existing theme.
 *
 * ## A selection is published TWICE, to two different channels
 *
 * This is the correction at the heart of this phase. Ditto keeps two separate
 * pieces of state and Island has to write both:
 *
 * ```
 *   kind:16767            PUBLIC. "here is my palette": what Ditto renders on
 *                         your profile page, and what it pulls into
 *                         `customTheme` on pageload.
 *   kind:30078 (NIP-78)   PRIVATE. `d = "ditto/metadata"`, NIP-44 to self.
 *                         Holds `theme` and `customTheme`: the ONLY state that
 *                         decides which theme Ditto actually renders.
 * ```
 *
 * Publishing only 16767 (what the previous phase did) leaves a Ditto account
 * on `theme: 'light'` looking exactly as it did: `NostrSync` imports the
 * palette into `customTheme` and then, in its own comment, does "NOT change the
 * `theme` value". The mode has to be set to `'custom'`, and the mode lives in
 * the encrypted blob.
 *
 * Both writes are debounced and best-effort: a player flipping through themes
 * must not publish twelve events, and a failed publish must not undo their
 * choice. The local selection is what they are looking at; these writes are how
 * it travels.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostr } from '@/hooks/useNostr';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { nextReplaceableCreatedAt, serializeByKey } from '@/lib/replaceable-write';
import {
  NIP78_KIND,
  dittoSettingsFilter,
  dittoSettingsTags,
  mergeDittoThemeSettings,
  newestSettingsEvent,
  parseDittoThemeSettings,
} from '@/lib/ditto-settings';
import type { IslandTheme } from '@/lib/island-themes';
import {
  ACTIVE_THEME_KIND,
  THEME_DEFINITION_KIND,
  buildActiveThemeTags,
  buildThemeDefinitionTags,
  nostrThemeId,
  titleToSlug,
  type ThemeConfig,
} from '@/lib/nostr-theme';

/** How long a rapid run of selections is collapsed into one publish. */
const SELECTION_PUBLISH_DEBOUNCE_MS = 2000;

export interface PublishThemeInput {
  title: string;
  description?: string;
  /** The complete interoperable theme: colours, and any font or background. */
  config: ThemeConfig;
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
        throw new Error('That name cannot be used as an identifier, add a letter or number.');
      }

      await createEvent({
        kind: THEME_DEFINITION_KIND,
        // Empty, per the protocol: the colours are tags so relays can index and
        // clients can read them without parsing JSON.
        content: '',
        tags: buildThemeDefinitionTags({
          identifier,
          title,
          config: { ...input.config, title },
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
 * re-derivation of them, round-tripping sixteen derived colours back down to
 * three would drift the theme every time it was re-selected.
 */
export function usePublishThemeSelection() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent } = useNostrPublish();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The publish the debounce is holding, if any. */
  const pending = useRef<(() => void) | null>(null);

  /*
    FLUSHED on unmount, not dropped.

    The debounce exists so a player flipping through themes does not publish
    twelve events: but this hook lives in the picker, and closing the picker is
    the most ordinary thing a player does after choosing. Cancelling here meant
    a selection made in the last two seconds before the dialog closed never
    reached a relay at all: the choice applied locally, the account kept
    advertising the PREVIOUS theme, and the next reconciliation had every reason
    to believe the old one was current.

    The work is a module-level async job, no state, no render, so running it
    from a cleanup is safe.
  */
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const run = pending.current;
      pending.current = null;
      run?.();
    },
    [],
  );

  const signer = user?.signer;
  const pubkey = user?.pubkey;

  /**
   * Publish the PUBLIC half: kind:16767.
   *
   * `created_at` is monotonic against whatever is already on the relay
   * (`nextReplaceableCreatedAt`). A replaceable event with the same second as
   * its predecessor is resolved by NIP-01 on the LOWER id, which has nothing to
   * do with which one the player chose, so selecting A and then B inside one
   * second could leave A winning. Island already had this primitive for
   * inventory and pet state; the theme writer had been missing it.
   */
  const publishActiveTheme = useCallback(
    async (theme: IslandTheme, config: ThemeConfig) => {
      if (!pubkey) return;

      let previousCreatedAt = 0;
      try {
        const existing = await nostr.query(
          [{ kinds: [ACTIVE_THEME_KIND], authors: [pubkey], limit: 1 }],
          { signal: AbortSignal.timeout(3000) },
        );
        previousCreatedAt = Math.max(0, ...existing.map((e) => e.created_at));
      } catch {
        // An unreadable relay is not a reason to skip the write; it only means
        // the tie-break falls back to wall-clock, which is the old behaviour.
      }

      const [, sourceAuthor, ...rest] = (theme.address ?? '').split(':');
      const sourceIdentifier = rest.join(':');

      await createEvent({
        kind: ACTIVE_THEME_KIND,
        content: '',
        created_at: nextReplaceableCreatedAt(Date.now(), previousCreatedAt),
        tags: buildActiveThemeTags({
          config,
          ...(theme.address && sourceAuthor && sourceIdentifier
            ? { sourceAuthor, sourceIdentifier }
            : {}),
          islandThemeId: theme.id,
        }),
      });
    },
    [pubkey, nostr, createEvent],
  );

  /**
   * Publish the PRIVATE half: Ditto's encrypted settings.
   *
   * `theme: 'custom'` plus the config under `customTheme`, which is precisely
   * what Ditto's own `applyCustomTheme` writes. Everything else in the blob is
   * carried through untouched, and the write is ABANDONED; not attempted with
   * a fresh object, when the existing blob cannot be read, because publishing
   * a settings event containing only a theme would erase the user's feed
   * settings, filters and relay preferences.
   */
  const publishDittoSettings = useCallback(
    async (config: ThemeConfig) => {
      if (!pubkey || !signer?.nip44) return;

      const events = await nostr.query([dittoSettingsFilter(pubkey)], {
        signal: AbortSignal.timeout(4000),
      });
      const existingEvent = newestSettingsEvent(events);

      let existing: Record<string, unknown> = {};
      if (existingEvent) {
        let decrypted: string;
        try {
          decrypted = await signer.nip44.decrypt(pubkey, existingEvent.content);
        } catch {
          // Could not read it, so we do not know what is in it, so we must not
          // replace it. Silence here costs cross-app sync for this write; the
          // alternative costs the user their settings.
          return;
        }
        const parsed = parseDittoThemeSettings(decrypted);
        if (!parsed) return;
        existing = parsed.raw;
      }

      const merged = mergeDittoThemeSettings(existing, {
        theme: 'custom',
        customTheme: config,
        nowMs: Date.now(),
      });

      await createEvent({
        kind: NIP78_KIND,
        content: await signer.nip44.encrypt(pubkey, JSON.stringify(merged)),
        created_at: nextReplaceableCreatedAt(Date.now(), existingEvent?.created_at ?? 0),
        tags: dittoSettingsTags(),
      });
    },
    [pubkey, signer, nostr, createEvent],
  );

  return useCallback(
    (theme: IslandTheme, config: ThemeConfig) => {
      if (!pubkey) return;

      clearTimeout(timer.current);
      // Serialised per account so two rapid selections cannot interleave their
      // read-modify-write of the settings blob.
      const run = () => {
        void serializeByKey(`theme-selection:${pubkey}`, async () => {
          await publishActiveTheme(theme, config).catch(() => {});
          await publishDittoSettings(config).catch(() => {});
        });
      };
      // Replaces whatever the debounce was holding: only the newest selection
      // is worth publishing, and only once.
      pending.current = run;
      timer.current = setTimeout(() => {
        pending.current = null;
        run();
      }, SELECTION_PUBLISH_DEBOUNCE_MS);
    },
    [pubkey, publishActiveTheme, publishDittoSettings],
  );
}

/**
 * Retract a theme the player published (NIP-09).
 *
 * Both an `e` and an `a` tag: the `e` names the event a relay is holding, the
 * `a` names the address so a relay that has since seen a replacement deletes
 * that too. Neither guarantees anything, deletion on Nostr is a request, which
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
