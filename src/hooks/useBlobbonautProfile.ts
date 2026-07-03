/**
 * Hook to fetch and manage the user's Blobbonaut Profile (kind 11125)
 *
 * Also queries legacy kind 31125 for backward compatibility.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from './useNostr';
import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';

import { parseOwnerProfile, validateOwnerProfileEvent } from '@/lib/blobbi-parsers';
import { BLOBBONAUT_PROFILE_KINDS, KIND_BLOBBONAUT_PROFILE } from '@/lib/blobbi-kinds';
import { BLOBBI_ECOSYSTEM_NAMESPACE } from '@blobbi-kit/core/blobbi';

export function useBlobbonautProfile() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['blobbonaut-profile', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) return null;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);

      const events = await nostr.query([{
        kinds: [...BLOBBONAUT_PROFILE_KINDS],
        authors: [user.pubkey],
        limit: 1
      }], { signal });

      // Always reconcile against the LATEST replaceable event. Relays / multiple
      // kinds can return events out of order, so pick the highest created_at
      // rather than trusting array position — otherwise an older profile could
      // win and revert a freshly-switched current_companion.
      const validEvents = events
        .filter(validateOwnerProfileEvent)
        .sort((a, b) => b.created_at - a.created_at);
      return validEvents.length > 0 ? parseOwnerProfile(validEvents[0]) : null;
    },
    enabled: !!user?.pubkey,
    staleTime: 30000, // 30 seconds
  });
}

export function useBlobbonautInventory() {
  const { data: profile, ...rest } = useBlobbonautProfile();

  return {
    data: profile?.inventory || [],
    profile,
    ...rest
  };
}

export function useSetCurrentCompanion() {
  const { nostr } = useNostr();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (blobbiId: string) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      // 1. Fetch the latest owner profile event (both new and legacy kinds)
      const events = await nostr.query([{
        kinds: [...BLOBBONAUT_PROFILE_KINDS],
        authors: [user.pubkey],
        limit: 1
      }]);

      let existingTags: string[][] = [];
      let existingContent = '';
      if (events.length > 0 && validateOwnerProfileEvent(events[0])) {
        existingTags = events[0].tags;
        existingContent = events[0].content;
      }

      // 2. Filter out the old 'current_companion' tag, if it exists
      const newTags = existingTags.filter(([tagName]) => tagName !== 'current_companion');

      // 3. Add the new 'current_companion' tag
      newTags.push(['current_companion', blobbiId]);

      // Ensure required tags for kind 11125 exist
      if (!newTags.some(([tagName]) => tagName === 'd')) {
        newTags.push(['d', 'profile']);
      }
      if (!newTags.some(([tagName]) => tagName === 'name')) {
        newTags.push(['name', '']); // Empty name is allowed
      }
      // Ensure canonical ecosystem marker required by @blobbi-kit/core validation.
      // Additive + idempotent: only added when absent (existing `b` preserved).
      if (!newTags.some(([tagName]) => tagName === 'b')) {
        newTags.push(['b', BLOBBI_ECOSYSTEM_NAMESPACE]);
      }

      // 4. Create the new event with the updated tags, preserving original
      //    content. Await the publish so the relay has the new replaceable event
      //    before we reconcile.
      await createEvent({
        kind: KIND_BLOBBONAUT_PROFILE,
        content: existingContent,
        tags: newTags,
      });

      return blobbiId;
    },
    onMutate: async (blobbiId: string) => {
      // Optimistically reflect the new companion immediately so the header /
      // HUD / selection / in-world Blobbi all update without waiting for the
      // relay round-trip. The blobbi art is keyed off this id and already
      // present in the ['blobbis'] cache, so the switch is instant.
      const keyA = ['blobbonaut-profile', user?.pubkey];
      const keyB = ['owner-profile', user?.pubkey];
      await queryClient.cancelQueries({ queryKey: keyA });
      await queryClient.cancelQueries({ queryKey: keyB });
      const previousA = queryClient.getQueryData(keyA);
      const previousB = queryClient.getQueryData(keyB);
      const setCompanion = (old: unknown) =>
        old && typeof old === 'object'
          ? { ...(old as Record<string, unknown>), currentCompanion: blobbiId }
          : old;
      // Update BOTH profile caches so neither layer reverts the selection.
      queryClient.setQueryData(keyA, setCompanion);
      queryClient.setQueryData(keyB, setCompanion);
      return { previousA, previousB };
    },
    onError: (_err, _blobbiId, context) => {
      // Roll back the optimistic update on failure.
      if (context) {
        if ('previousA' in context) {
          queryClient.setQueryData(['blobbonaut-profile', user?.pubkey], context.previousA);
        }
        if ('previousB' in context) {
          queryClient.setQueryData(['owner-profile', user?.pubkey], context.previousB);
        }
      }
    },
    onSuccess: async (blobbiId) => {
      // Reconcile with the relays — but the optimistic selection stays
      // AUTHORITATIVE until the relay confirms the same value. A naive
      // invalidate() would let a stale read (the relay hasn't surfaced the new
      // replaceable event yet) overwrite the user's choice and visibly revert
      // to the old Blobbi. So we poll a few times and only refetch once the
      // remote profile confirms the new current_companion; if it never confirms
      // in the window we simply keep the optimistic value (no reload needed).
      if (!user?.pubkey) return;

      const confirmed = await confirmCompanionOnRelay(nostr, user.pubkey, blobbiId);
      if (confirmed) {
        // Relay now serves the new event — safe to refetch authoritative data
        // for both profile caches without risking a revert.
        queryClient.invalidateQueries({ queryKey: ['blobbonaut-profile', user.pubkey] });
        queryClient.invalidateQueries({ queryKey: ['owner-profile', user.pubkey] });
      }
      // else: keep the optimistic caches as-is. They already hold the correct
      // selection; a later natural refetch will pick up the confirmed event.
    },
  });
}

/**
 * Poll the relay until it serves a profile whose current_companion matches the
 * just-published value (read-your-write reconciliation). Returns true once the
 * relay confirms, false if it doesn't within the short window. Used so a stale
 * relay read can't undo an explicit Blobbi switch.
 */
async function confirmCompanionOnRelay(
  nostr: ReturnType<typeof useNostr>['nostr'],
  pubkey: string,
  expectedBlobbiId: string,
): Promise<boolean> {
  const attempts = 4;
  const delayMs = 400;
  for (let i = 0; i < attempts; i++) {
    try {
      const events = await nostr.query(
        [{ kinds: [...BLOBBONAUT_PROFILE_KINDS], authors: [pubkey], limit: 1 }],
        { signal: AbortSignal.timeout(2000) },
      );
      const latest = events
        .filter(validateOwnerProfileEvent)
        .sort((a, b) => b.created_at - a.created_at)[0];
      const companion = latest
        ? parseOwnerProfile(latest)?.currentCompanion
        : undefined;
      if (companion === expectedBlobbiId) {
        return true;
      }
    } catch {
      // Ignore transient query errors and retry within the window.
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}