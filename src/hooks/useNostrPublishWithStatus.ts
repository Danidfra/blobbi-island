import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { useNostr } from "@nostrify/react";
import type { NostrEvent } from "@nostrify/nostrify";

import { useCurrentUser } from "./useCurrentUser";

export interface RelayPublishStatus {
  url: string;
  status: 'pending' | 'success' | 'error';
  error?: string;
}

export interface PublishWithStatusResult {
  event: NostrEvent;
  relayStatuses: RelayPublishStatus[];
  successCount: number;
  failureCount: number;
}

export function useNostrPublishWithStatus(): UseMutationResult<
  PublishWithStatusResult,
  Error,
  { event: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>; relayUrls: string[] }
> {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async ({ event: eventData, relayUrls }) => {
      if (!user) {
        throw new Error("User is not logged in");
      }

      if (relayUrls.length === 0) {
        throw new Error("No relays specified");
      }

      // Prepare tags
      const tags = eventData.tags ?? [];
      if (!tags.some(([name]) => name === "client")) {
        tags.push(["client", "blobbi"]);
      }

      // Sign the event
      const event = await user.signer.signEvent({
        kind: eventData.kind,
        content: eventData.content ?? "",
        tags,
        created_at: eventData.created_at ?? Math.floor(Date.now() / 1000),
      });

      // Track status for each relay
      const relayStatuses: RelayPublishStatus[] = relayUrls.map(url => ({
        url,
        status: 'pending' as const,
      }));

      // Publish to each relay individually
      const publishPromises = relayUrls.map(async (relayUrl, index) => {
        try {
          // Use the main Nostr instance but filter to specific relay
          await nostr.event(event, {
            signal: AbortSignal.timeout(5000), // 5 second timeout per relay
            relays: [relayUrl],
          });

          relayStatuses[index] = {
            url: relayUrl,
            status: 'success',
          };
        } catch (error) {
          relayStatuses[index] = {
            url: relayUrl,
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      });

      // Wait for all publish attempts to complete
      await Promise.allSettled(publishPromises);

      const successCount = relayStatuses.filter(s => s.status === 'success').length;
      const failureCount = relayStatuses.filter(s => s.status === 'error').length;

      return {
        event,
        relayStatuses,
        successCount,
        failureCount,
      };
    },
  });
}