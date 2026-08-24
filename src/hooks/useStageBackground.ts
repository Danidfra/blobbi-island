/**
 * Read and set the Blobbi stage background.
 *
 * ## Where the selection lives
 *
 * In the `background` tag of the kind:11125 Blobbonaut profile — a MANAGED tag
 * `parseOwnerProfile` has read and `mergeOwnerProfileTags` has written since
 * long before this feature, and which nothing had ever set. No new kind, no new
 * tag, and no second answer to "what did this player choose".
 *
 * That also means the choice follows the player rather than the browser: it is
 * the same replaceable event that carries their current companion, so a new
 * device shows the same stage.
 *
 * ## Authority order
 *
 * ```
 *   optimistic cache  → the tap is reflected before the relay answers
 *   profile query     → the canonical value once it resolves
 *   default           → an unknown id, a missing profile, an unusable read
 * ```
 *
 * A relay outage is NOT destructive: `useBlobbonautProfile` throws rather than
 * resolving to `null` on an unusable read, so React Query keeps the last known
 * profile and the stage keeps the player's background. Only a genuinely empty
 * profile, or an id this build does not know, resolves to the default — and
 * neither erases what is stored.
 */

import { useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useNostr } from '@/hooks/useNostr';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useBlobbonautProfile } from '@/hooks/useBlobbonautProfile';
import { validateOwnerProfileEvent } from '@/lib/blobbi-parsers';
import { BLOBBONAUT_PROFILE_KINDS, KIND_BLOBBONAUT_PROFILE } from '@/lib/blobbi-kinds';
import { BLOBBI_ECOSYSTEM_NAMESPACE } from '@blobbi-kit/core/blobbi';
import { useIslandInventory } from '@/inventory';
import { getInventoryItems } from '@/inventory/package';
import {
  DEFAULT_STAGE_BACKGROUND_ID,
  isStageBackgroundOwned,
  resolveStageBackground,
  stageBackgrounds,
  type StageBackground,
} from '@/lib/blobbi-stage-backgrounds';

export interface StageBackgroundChoice {
  background: StageBackground;
  /** `true` when the player owns/has unlocked it. Locked entries are shown, not hidden. */
  owned: boolean;
}

export interface UseStageBackgroundResult {
  /** The resolved active background. Never undefined — an unknown id resolves to the default. */
  background: StageBackground;
  /** The id as STORED, which is not always `background.id`. Diagnostics. */
  storedId: string;
  /** Every background in this build, with its ownership state, in picker order. */
  choices: readonly StageBackgroundChoice[];
  /** Select a background. Optimistic, then published to kind:11125. */
  setBackground: (id: string) => void;
  isSaving: boolean;
  /** A publish that failed, surfaced rather than swallowed. */
  error: Error | null;
  /** Whether a selection can be published at all (needs a signed-in profile writer). */
  canSelect: boolean;
}

export function useStageBackground(): UseStageBackgroundResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { data: profile } = useBlobbonautProfile();
  const { data: inventory } = useIslandInventory();

  const storedId = profile?.background ?? DEFAULT_STAGE_BACKGROUND_ID;

  const choices = useMemo((): StageBackgroundChoice[] => {
    const quantityByAddress = new Map<string, number>(
      inventory ? getInventoryItems(inventory).map((i) => [i.address, i.quantity]) : [],
    );
    return stageBackgrounds.map((background) => ({
      background,
      owned: isStageBackgroundOwned(background, quantityByAddress),
    }));
  }, [inventory]);

  const mutation = useMutation({
    mutationFn: async (backgroundId: string) => {
      if (!user?.pubkey) throw new Error('User not logged in');

      // Latest replaceable profile, chosen DETERMINISTICALLY by created_at:
      // relays return replaceable events in arbitrary order, and republishing
      // whichever arrived first is how a stale profile gets resurrected. Same
      // rule as `useSetCurrentCompanion`.
      const events = await nostr.query([
        { kinds: [...BLOBBONAUT_PROFILE_KINDS], authors: [user.pubkey], limit: 1 },
      ]);
      const latest = events
        .filter(validateOwnerProfileEvent)
        .sort((a, b) => b.created_at - a.created_at)[0];

      const tags = (latest?.tags ?? []).filter(([name]) => name !== 'background');
      tags.push(['background', backgroundId]);

      // Required tags for kind:11125, added only when absent so an existing
      // value is never overwritten.
      if (!tags.some(([name]) => name === 'd')) tags.push(['d', 'profile']);
      if (!tags.some(([name]) => name === 'name')) tags.push(['name', '']);
      if (!tags.some(([name]) => name === 'b')) tags.push(['b', BLOBBI_ECOSYSTEM_NAMESPACE]);

      await createEvent({
        kind: KIND_BLOBBONAUT_PROFILE,
        // Content is preserved verbatim: it is the player's data and this
        // writer has no opinion about it.
        content: latest?.content ?? '',
        tags,
      });

      return backgroundId;
    },
    onMutate: async (backgroundId: string) => {
      const key = ['blobbonaut-profile', user?.pubkey];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (old: unknown) =>
        old && typeof old === 'object'
          ? { ...(old as Record<string, unknown>), background: backgroundId }
          : old,
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context) {
        queryClient.setQueryData(['blobbonaut-profile', user?.pubkey], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['blobbonaut-profile', user?.pubkey] });
    },
  });

  const { mutate } = mutation;
  const setBackground = useCallback((id: string) => mutate(id), [mutate]);

  return {
    background: resolveStageBackground(storedId),
    storedId,
    choices,
    setBackground,
    isSaving: mutation.isPending,
    error: mutation.error,
    canSelect: !!user?.pubkey,
  };
}
