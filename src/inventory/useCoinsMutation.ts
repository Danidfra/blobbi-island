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
 * tags, coins, pets, achievements, and current companion are preserved.
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
      // Accessory boundary (Phase 10): `mergeOwnerProfileTags` intentionally
      // drops legacy `inv` accessory tags. To avoid this coins write REGRESSING
      // accessory ownership, we re-append the raw `inv` tags from the source
      // event verbatim. We neither read nor migrate `inv` quantities — we only
      // pass them through untouched.
      const ownerTags = mergeOwnerProfileTags({ ...profile, coins: newCoins });
      const invTags = latest.tags.filter((t) => t[0] === 'inv');
      const finalTags = [...ownerTags, ...invTags];
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
