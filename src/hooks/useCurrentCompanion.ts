import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
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
  const { mutate: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (blobbiId: string) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      // Create kind 31125 event with current_companion tag
      createEvent({
        kind: 31125,
        content: `Selected ${blobbiId} as current companion`,
        tags: [
          ['d', 'current_companion'], // Addressable event identifier
          ['current_companion', blobbiId],
        ],
      });

      return blobbiId;
    },
    onSuccess: () => {
      // Invalidate and refetch current companion query
      queryClient.invalidateQueries({
        queryKey: ['current-companion', user?.pubkey]
      });
    },
  });
}