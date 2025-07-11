import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from './useNostr';
import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';

export function useCurrentCompanion() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['current-companion', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) {
        return null;
      }

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);

      // Query for kind 31125 events (Current Companion)
      const events = await nostr.query([{
        kinds: [31125],
        authors: [user.pubkey],
        limit: 1
      }], { signal });

      if (events.length === 0) {
        return null;
      }

      const event = events[0];
      const currentCompanion = event.tags.find(([name]) => name === 'current_companion')?.[1];

      return currentCompanion || null;
    },
    enabled: !!user?.pubkey,
    staleTime: 30000, // 30 seconds
  });
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
      if (events.length > 0) {
        existingTags = events[0].tags;
      }

      // 2. Filter out the old 'current_companion' tag, if it exists
      const newTags = existingTags.filter(([tagName]) => tagName !== 'current_companion');

      // 3. Add the new 'current_companion' tag
      newTags.push(['current_companion', blobbiId]);

      // Ensure 'd' tag for addressable event exists
      if (!newTags.some(([tagName]) => tagName === 'd')) {
        newTags.push(['d', 'current_companion']);
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
      // Invalidate and refetch current companion query
      queryClient.invalidateQueries({
        queryKey: ['current-companion', user?.pubkey]
      });
      queryClient.invalidateQueries({
        queryKey: ['companion-settings', user?.pubkey]
      });
    },
  });
}