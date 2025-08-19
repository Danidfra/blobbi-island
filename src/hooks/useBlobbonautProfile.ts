/**
 * Hook to fetch and manage the user's Blobbonaut Profile (kind 31125)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from './useNostr';
import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';

import { parseOwnerProfile, validateOwnerProfileEvent } from '@/lib/blobbi-parsers';

export function useBlobbonautProfile() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['blobbonaut-profile', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) return null;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);

      const events = await nostr.query([{
        kinds: [31125],
        authors: [user.pubkey],
        limit: 1
      }], { signal });

      const validEvents = events.filter(validateOwnerProfileEvent);
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
  const { mutate: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (blobbiId: string) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      // 1. Fetch the latest kind 31125 event
      const events = await nostr.query([{
        kinds: [31125],
        authors: [user.pubkey],
        limit: 1
      }]);

      let existingTags: string[][] = [];
      if (events.length > 0 && validateOwnerProfileEvent(events[0])) {
        existingTags = events[0].tags;
      }

      // 2. Filter out the old 'current_companion' tag, if it exists
      const newTags = existingTags.filter(([tagName]) => tagName !== 'current_companion');

      // 3. Add the new 'current_companion' tag
      newTags.push(['current_companion', blobbiId]);

      // Ensure required tags for kind 31125 exist
      if (!newTags.some(([tagName]) => tagName === 'd')) {
        newTags.push(['d', 'profile']);
      }
      if (!newTags.some(([tagName]) => tagName === 'name')) {
        newTags.push(['name', '']); // Empty name is allowed
      }

      // 4. Create the new event with the updated tags
      createEvent({
        kind: 31125,
        content: `Selected ${blobbiId} as current companion`,
        tags: newTags,
      });

      return blobbiId;
    },
    onSuccess: () => {
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({
        queryKey: ['blobbonaut-profile', user?.pubkey]
      });
    },
  });
}