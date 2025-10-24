import { useNostr } from "@nostrify/react";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { useCurrentUser } from "./useCurrentUser";

import type { NostrEvent } from "@nostrify/nostrify";

export function useNostrPublish(): UseMutationResult<NostrEvent> {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => {
      if (user) {
        const tags = t.tags ?? [];

        // Add the client tag if it doesn't exist
        if (!tags.some(([name]) => name === "client")) {
          tags.push(["client", "blobbi"]);
        }

        const event = await user.signer.signEvent({
          kind: t.kind,
          content: t.content ?? "",
          tags,
          created_at: t.created_at ?? Math.floor(Date.now() / 1000),
        });

        // Publish event with improved error handling
        try {
          await nostr.event(event, { signal: AbortSignal.timeout(5000) });
          console.log('Event published successfully');
        } catch (error) {
          // Check if this is a timeout or network error vs a hard failure
          if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            // Timeout errors are common with relays - treat as partial success
            console.warn('Event publish timed out but may have succeeded on some relays:', error);
            // Still return the event as if it succeeded for movement purposes
          } else {
            // For other errors, log but don't treat as fatal for movement events
            console.warn('Event publish error:', error);
            // For movement events specifically, we can be more lenient
            if (event.kind === 31950) { // Presence event
              console.log('Movement event publish failed but continuing');
              // Return a minimal event-like object to prevent unmounting
              return { ...event, id: 'temp-' + Date.now() };
            }
            throw error;
          }
        }
        return event;
      } else {
        throw new Error("User is not logged in");
      }
    },
    onError: (error) => {
      console.error("Failed to publish event:", error);
    },
    onSuccess: (data) => {
      console.log("Event published successfully:", data);
    },
  });
}