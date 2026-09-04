/**
 * The hatch → Island handoff, against a relay that ACCEPTS events before it
 * SERVES them.
 *
 * This is the lifecycle race behind "my new Blobbi is an egg": the publish
 * resolves, the Island refetches, the relay answers empty, `relay-read.ts`
 * confirms that empty answer, and the caches settle on "no profile, no
 * Blobbis" with nothing scheduled to read again. The real hooks run here on a
 * real QueryClient; only the relay is a fixture, and it has a switch for
 * whether it has indexed what it accepted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { buildBlobbonautTags, updateBlobbonautTags } from '@blobbi-kit/core';

import { KIND_BLOBBI_STATE, KIND_BLOBBONAUT_PROFILE } from '@/lib/blobbi-kinds';
import { generateEggPreview, previewToBabyTags } from '@/lib/blobbi-egg-preview';

const PUBKEY = 'feb88e80a63d1111222233334444555566667777888899990000aaaabbbbcccc';

/** A relay with separate "accepted" and "served" sets. */
class LaggingRelay {
  accepted: NostrEvent[] = [];
  served: NostrEvent[] = [];
  publishCalls = 0;
  reads = 0;

  private matches(event: NostrEvent, filters: NostrFilter[]): boolean {
    return filters.some((filter) => {
      if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
      if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
      const d = filter['#d'];
      if (d && !d.includes(event.tags.find(([n]) => n === 'd')?.[1] ?? '')) return false;
      return true;
    });
  }

  /** Everything accepted becomes visible to reads. */
  index() {
    this.served = [...this.accepted];
  }

  event = vi.fn(async (event: NostrEvent) => {
    this.publishCalls += 1;
    this.accepted.push(event);
  });

  query = vi.fn(async (filters: NostrFilter[]) => {
    this.reads += 1;
    return this.served.filter((event) => this.matches(event, filters));
  });

  req = async function* (this: LaggingRelay, filters: NostrFilter[]) {
    this.reads += 1;
    for (const event of this.served) {
      if (this.matches(event, filters)) yield ['EVENT', 'sub', event];
    }
    yield ['EOSE', 'sub'];
  }.bind(this);
}

let relay = new LaggingRelay();

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: relay }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: PUBKEY } }),
}));

const { useBlobbis } = await import('@/hooks/useBlobbis');
const { useBlobbonautProfile } = await import('@/hooks/useBlobbonautProfile');
const { useOptimizedStatus } = await import('@/hooks/useOptimizedStatus');
const {
  applyAdoptionHandoff,
  confirmAdoptionOnRelay,
  reconcileAdoptionWithRelay,
} = await import('./adoption-handoff');

function signed(kind: number, tags: string[][], id: string): NostrEvent {
  return { id, kind, pubkey: PUBKEY, created_at: 1_800_000_000, content: '', tags, sig: 'sig' };
}

/** What `finalizeAdoption` hands back for a brand-new player. */
function hatch() {
  const preview = generateEggPreview(PUBKEY, 'Egg');
  const babyEvent = signed(KIND_BLOBBI_STATE, previewToBabyTags({ ...preview, name: 'Puck' }), 'baby-1');
  const profileTags = updateBlobbonautTags(
    [...buildBlobbonautTags(PUBKEY), ['name', 'Tester']],
    { has: [preview.d], current_companion: preview.d },
  );
  const profileEvent = signed(KIND_BLOBBONAUT_PROFILE, profileTags, 'profile-1');
  return { blobbiId: preview.d, babyEvent, profileEvent };
}

function useCompanionCaches() {
  return {
    list: useBlobbis(),
    profile: useBlobbonautProfile(),
    status: useOptimizedStatus().status,
  };
}

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(() => useCompanionCaches(), { wrapper });
  return { queryClient, ...rendered };
}

const noSleep = async () => {};

beforeEach(() => {
  relay = new LaggingRelay();
});

describe('the hatch → Island handoff', () => {
  it('reproduces the race: a refetch straight after the publish confirms the stale relay', async () => {
    const { queryClient, result } = harness();
    await waitFor(() => expect(result.current.list.data).toEqual([]));
    await waitFor(() => expect(result.current.profile.data).toBeNull());

    // The publish is accepted; the relay has not indexed it yet.
    const handoff = hatch();
    await relay.event(handoff.babyEvent);
    await relay.event(handoff.profileEvent);

    // What the Island used to do next.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['blobbonaut-profile', PUBKEY] });
      await queryClient.refetchQueries({ queryKey: ['blobbis', PUBKEY] });
    });

    // Confirmed-empty, both of them: the in-world renderer draws an egg from
    // this, and nothing refetches the profile again.
    expect(result.current.list.data).toEqual([]);
    expect(result.current.profile.data).toBeNull();
  });

  it('writes every companion cache from the signed events before the relay serves them', async () => {
    const { queryClient, result } = harness();
    await waitFor(() => expect(result.current.list.data).toEqual([]));
    await waitFor(() => expect(result.current.status.isLoading).toBe(false));
    expect(result.current.status.currentPet).toBeNull();

    const handoff = hatch();
    await relay.event(handoff.babyEvent);
    await relay.event(handoff.profileEvent);

    let applied = false;
    act(() => {
      applied = applyAdoptionHandoff(queryClient, PUBKEY, handoff);
    });
    expect(applied).toBe(true);

    // The router's list, the world's profile, and the status layer's pair,
    // all without a single further relay read.
    const readsBefore = relay.reads;
    await waitFor(() => {
      expect(result.current.list.data?.map((b) => b.id)).toEqual([handoff.blobbiId]);
      expect(result.current.profile.data?.currentCompanion).toBe(handoff.blobbiId);
      expect(result.current.status.currentPet?.id).toBe(handoff.blobbiId);
      expect(result.current.status.owner?.currentCompanion).toBe(handoff.blobbiId);
    });
    expect(result.current.list.data?.[0].stage).toBe('baby');
    expect(relay.reads).toBe(readsBefore);

    // Applying the same handoff again (a retry, Strict Mode) keeps ONE Blobbi.
    act(() => {
      applyAdoptionHandoff(queryClient, PUBKEY, handoff);
    });
    await waitFor(() => expect(result.current.list.data).toHaveLength(1));

    // Nothing here publishes: the handoff is a cache write, never a second
    // Blobbi.
    expect(relay.publishCalls).toBe(2);
  });

  it('keeps the written caches while the relay lags, and refetches only once it confirms', async () => {
    const { queryClient, result } = harness();
    await waitFor(() => expect(result.current.list.data).toEqual([]));

    const handoff = hatch();
    await relay.event(handoff.babyEvent);
    await relay.event(handoff.profileEvent);
    act(() => {
      applyAdoptionHandoff(queryClient, PUBKEY, handoff);
    });

    // Never served within the window: the caches are left alone.
    const unconfirmed = await reconcileAdoptionWithRelay(queryClient, relay, PUBKEY, handoff.blobbiId, {
      attempts: 3,
      sleep: noSleep,
    });
    expect(unconfirmed).toBe(false);
    await waitFor(() => {
      expect(result.current.list.data?.map((b) => b.id)).toEqual([handoff.blobbiId]);
      expect(result.current.profile.data?.currentCompanion).toBe(handoff.blobbiId);
    });

    // The relay catches up: confirmation invalidates, and the authoritative
    // refetch agrees with what was written.
    relay.index();
    let confirmed = false;
    await act(async () => {
      confirmed = await reconcileAdoptionWithRelay(queryClient, relay, PUBKEY, handoff.blobbiId, {
        attempts: 3,
        sleep: noSleep,
      });
    });
    expect(confirmed).toBe(true);
    await waitFor(() => {
      expect(result.current.list.isFetching).toBe(false);
      expect(result.current.profile.isFetching).toBe(false);
    });
    expect(result.current.list.data?.map((b) => b.id)).toEqual([handoff.blobbiId]);
    expect(result.current.profile.data?.currentCompanion).toBe(handoff.blobbiId);
  });

  it('confirms only when BOTH the baby and the companion profile are served', async () => {
    const handoff = hatch();

    // Baby indexed, profile not yet.
    relay.accepted.push(handoff.babyEvent);
    relay.index();
    expect(await confirmAdoptionOnRelay(relay, PUBKEY, handoff.blobbiId, { attempts: 2, sleep: noSleep })).toBe(false);

    // Profile indexed too.
    relay.accepted.push(handoff.profileEvent);
    relay.index();
    expect(await confirmAdoptionOnRelay(relay, PUBKEY, handoff.blobbiId, { attempts: 1, sleep: noSleep })).toBe(true);
  });

  it('refuses to write from events it cannot parse', () => {
    const queryClient = new QueryClient();
    const handoff = hatch();
    const broken = { ...handoff, babyEvent: { ...handoff.babyEvent, tags: [['d', handoff.blobbiId]] } };
    expect(applyAdoptionHandoff(queryClient, PUBKEY, broken)).toBe(false);
    expect(queryClient.getQueryData(['blobbis', PUBKEY])).toBeUndefined();
    expect(queryClient.getQueryData(['blobbonaut-profile', PUBKEY])).toBeUndefined();
  });
});
