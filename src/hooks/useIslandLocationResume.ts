/**
 * One bounded presence read, once per authenticated island entry, to decide
 * where the session opens.
 *
 * ## Bootstrap only
 *
 * This hook resolves exactly once and then holds its answer forever. It is not
 * a subscription and it never follows presence: after boot, location is owned
 * entirely by `LocationContext` and the normal navigation path, so a heartbeat
 * arriving mid-session cannot move the player. The query is pinned with
 * `staleTime: Infinity` and every automatic refetch disabled, and
 * `LocationProvider` latches its bootstrap independently; either alone would
 * be sufficient; both together make "cannot teleport" structural rather than
 * incidental.
 *
 * ## Why this read is allowed to give up
 *
 * `readRelay` reports `unknown` for a timeout, a refused REQ or a dead socket,
 * and the rest of the app treats that as "do not overwrite what you know"
 * (`src/lib/relay-read.ts`). That rule is about *destroying player data*, and
 * it is not weakened here: this read owns no data. Its only product is a
 * navigation choice for a session that has not started yet, and there is
 * nothing to preserve or erase; no location is persisted, and nothing about
 * "you were in Town" is ever written.
 *
 * So `unknown` resolves to the default location and is *classified* as unknown
 * (`outcome.kind === 'unknown-read'`), never as a confirmed empty. The
 * distinction survives into the returned decision, which is what a future
 * "couldn't reach your last spot" affordance would need. What we refuse to do
 * is block the world on an unreachable relay: the read has one deadline, and
 * the player enters the island either way.
 *
 * Note the deliberate use of `readRelay` and not `readRelayConfirmed`: the
 * double-read confirmation exists for state whose false absence is destructive.
 * A missed resume costs the player one walk back, so the second round-trip
 * would buy latency on the boot path for nothing.
 */

import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { readRelay, type RelayReader } from '@/lib/relay-read';
import { nowSec } from '@/lib/multiplayer';
import {
  DEFAULT_ISLAND_LOCATION,
  resolveInitialIslandLocation,
  type LocationResumeDecision,
} from '@/lib/location-resume';

/**
 * How many of the player's own presence events to consider.
 *
 * Presence is addressable on `session:<uuid>`, so a player accumulates one
 * retained event per browsing session on any relay that does not honour NIP-40
 * deletion. Relays serve newest-first, and only the newest is ever used, so this
 * is a payload bound and not a policy.
 */
const PRESENCE_SCAN_LIMIT = 20;

/** Not-yet-decided is a distinct state: the world must not render on a guess. */
export interface IslandLocationResume extends LocationResumeDecision {
  /** `false` while the read is still in flight. */
  readonly isSettled: boolean;
}

const PENDING: IslandLocationResume = {
  isSettled: false,
  location: DEFAULT_ISLAND_LOCATION,
  position: null,
  outcome: { kind: 'unknown-read', reason: 'timeout' },
};

export function useIslandLocationResume(islandId: string): IslandLocationResume {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;

  const { data, status } = useQuery<LocationResumeDecision>({
    queryKey: ['island-location-resume', pubkey, islandId],
    enabled: Boolean(pubkey),
    queryFn: async (c) => {
      const read = await readRelay(
        nostr as RelayReader,
        [
          {
            kinds: [31950],
            authors: [pubkey!],
            '#t': ['blobbi:presence'],
            limit: PRESENCE_SCAN_LIMIT,
          },
        ],
        { signal: c.signal },
      );

      return resolveInitialIslandLocation({
        read,
        now: nowSec(),
        islandId,
        // Read at DECISION time, not render time. The pass is the entitlement's
        // own answer about itself; this policy only consults it.
      });
    },
    // Bootstrap, not state. Resolve once; never re-ask, never re-decide.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // No signed-in player means nothing to resume, and nothing to wait for.
  if (!pubkey) {
    return {
      isSettled: true,
      location: DEFAULT_ISLAND_LOCATION,
      position: null,
      outcome: { kind: 'no-presence' },
    };
  }

  if (data) return { ...data, isSettled: true };

  // `readRelay` returns its failures rather than throwing, so `error` here means
  // something structural (a missing pool, a bug): not a relay condition. Settle
  // anyway: an unreachable decision must never leave the world unmountable.
  if (status === 'error') {
    return {
      isSettled: true,
      location: DEFAULT_ISLAND_LOCATION,
      position: null,
      outcome: { kind: 'unknown-read', reason: 'unreachable' },
    };
  }

  return PENDING;
}
