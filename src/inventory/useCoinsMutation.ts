/**
 * Blobbi Island — coins helper for the new inventory flows.
 *
 * Coins remain a kind:11125 (Blobbonaut profile) field — NOT inventory. This
 * hook publishes a coins change while preserving all other 11125 data, using a
 * freshly-fetched + validated profile as the base (never an empty/stale cache
 * snapshot, which would clobber the replaceable event — see audit §0.2).
 *
 * It intentionally does NOT touch inventory: the clean inventory lives in
 * kind:31633. It still routes through `mergeOwnerProfileTags` so unknown Ditto
 * tags, coins, pets, achievements, and current companion are preserved — as are
 * the legacy `storage` and `inv` tags, which are carried through opaquely by
 * that helper's unknown-tag passthrough and never read, written or rewritten.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import {
  parseOwnerProfile,
  validateOwnerProfileEvent,
  mergeOwnerProfileTags,
} from '@/lib/blobbi-parsers';
import {
  BLOBBONAUT_PROFILE_KINDS,
  KIND_BLOBBONAUT_PROFILE,
} from '@/lib/blobbi-kinds';

/** Result of a coins mutation. */
export interface CoinsMutationResult {
  previousCoins: number;
  newCoins: number;
}

/**
 * Publish a coins delta to the current user's 11125 profile.
 *
 * Reads the freshest profile from the relay to avoid clobbering. Rejects if the
 * resulting balance would be negative. Returns previous/new balances.
 */
export function useCoinsMutation() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: publish } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (delta: number): Promise<CoinsMutationResult> => {
      if (!user?.pubkey) throw new Error('User not logged in');

      const events = await nostr.query(
        [
          {
            kinds: [...BLOBBONAUT_PROFILE_KINDS],
            authors: [user.pubkey],
            limit: 1,
          },
        ],
        { signal: AbortSignal.timeout(3000) },
      );

      const latest = events
        .filter(validateOwnerProfileEvent)
        .sort((a, b) => b.created_at - a.created_at)[0];

      if (!latest) {
        throw new Error('Owner profile not found; cannot update coins');
      }

      const profile = parseOwnerProfile(latest);
      if (!profile) {
        throw new Error('Owner profile could not be parsed; cannot update coins');
      }
      const previousCoins = profile.coins;
      const newCoins = previousCoins + delta;
      if (newCoins < 0) {
        throw new Error('Insufficient coins');
      }

      // Preserve everything else; only coins changes. Inventory is NOT written
      // here — the clean consumable inventory lives in kind:31633.
      //
      // Legacy `inv` accessory tags need no special handling: `inv` is not a
      // managed owner-profile tag, so `mergeOwnerProfileTags` already carries it
      // through its unknown-tag passthrough verbatim, exactly like `storage` and
      // any unknown Ditto tag. Re-appending it here would publish a SECOND copy
      // of every `inv` tag on each coins write. We neither read nor migrate
      // `inv` quantities — the shared passthrough passes them through untouched.
      const finalTags = mergeOwnerProfileTags({ ...profile, coins: newCoins });
      await publish({
        kind: KIND_BLOBBONAUT_PROFILE,
        content: profile.rawContent,
        tags: finalTags,
      });

      return { previousCoins, newCoins };
    },
    onSuccess: () => {
      if (!user?.pubkey) return;
      queryClient.invalidateQueries({
        queryKey: ['blobbonaut-profile', user.pubkey],
      });
      queryClient.invalidateQueries({
        queryKey: ['owner-profile', user.pubkey],
      });
    },
  });
}
