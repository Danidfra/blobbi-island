/**
 * Kind:11125 write-path tests for legacy `storage` opacity.
 *
 * Complements `src/lib/blobbi-profile-storage-opacity.test.ts` (which covers the
 * pure parse/merge functions) by driving the actual publishing hooks end to end:
 *
 *   - `useCreateOwnerProfile`: a brand-new profile must never invent `storage`;
 *   - `useUpdateOwnerProfile`: an update must carry pre-existing `storage`
 *     through untouched while still applying the intended field change.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const TEST_PUBKEY = 'c'.repeat(64);

const nostrEvent = vi.fn<(event: NostrEvent, opts?: unknown) => Promise<void>>();
const nostrQuery = vi.fn<() => Promise<NostrEvent[]>>();
const signEvent = vi.fn(
  async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> => ({
    ...t,
    tags: t.tags ?? [],
    content: t.content ?? '',
    created_at: t.created_at ?? 1_700_000_000,
    id: 'id-1',
    pubkey: TEST_PUBKEY,
    sig: 'sig',
  }),
);

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { event: nostrEvent, query: nostrQuery } }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { pubkey: TEST_PUBKEY, signer: { signEvent } },
  }),
}));

import { useCreateOwnerProfile, useUpdateOwnerProfile } from './useBlobbiEvents';
import { parseOwnerProfile } from '@/lib/blobbi-parsers';
import { KIND_BLOBBONAUT_PROFILE } from '@/lib/blobbi-kinds';

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function publishedTags(): string[][] {
  expect(nostrEvent).toHaveBeenCalled();
  return nostrEvent.mock.calls[0][0].tags;
}

function tagsNamed(tags: string[][], name: string): string[][] {
  return tags.filter(([n]) => n === name);
}

describe('kind:11125 write path: legacy storage opacity', () => {
  beforeEach(() => {
    nostrEvent.mockReset();
    nostrQuery.mockReset();
    signEvent.mockClear();
    nostrEvent.mockResolvedValue(undefined);
  });

  it('a freshly created profile never invents a storage tag', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCreateOwnerProfile(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        profileId: 'profile',
        name: 'Newcomer',
        pettingLevel: 0,
        lifetimeBlobbis: 1,
        ownedPets: ['blobbi-abc'],
        achievements: ['first-egg'],
      });
    });

    const tags = publishedTags();
    // The profile was really written...
    expect(tagsNamed(tags, 'has')).toEqual([['has', 'blobbi-abc']]);
    // ...and since the Coin cutover a fresh profile carries NO coins tag at
    // all: the initial balance is a wallet grant into kind:31633.
    expect(tags.find(([n]) => n === 'coins')).toBeUndefined();
    // ...with no consumable inventory anywhere on it.
    expect(tagsNamed(tags, 'storage')).toEqual([]);
  });

  it('updating a profile preserves a pre-existing storage tag verbatim', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // Seed the cache the way the app does: a parsed profile carrying legacy tags.
    const existing = parseOwnerProfile({
      id: 'p',
      pubkey: TEST_PUBKEY,
      created_at: 100,
      kind: KIND_BLOBBONAUT_PROFILE,
      tags: [
        ['d', 'profile'],
        ['name', 'Veteran'],
        ['coins', '200'],
        ['storage', 'food_apple:5', 'legacy-extra'],
        ['xp', '42'],
      ],
      content: '{"missions":1}',
      sig: 's',
    });
    client.setQueryData(['owner-profile', TEST_PUBKEY], existing);

    const { result } = renderHook(() => useUpdateOwnerProfile(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ name: 'Veteran Renamed' });
    });

    const tags = publishedTags();
    // The intended change landed.
    expect(tags.find(([n]) => n === 'name')?.[1]).toBe('Veteran Renamed');
    // The historic coins tag rides the passthrough VERBATIM, a profile
    // update can never change a balance since the Coin cutover.
    expect(tags.find(([n]) => n === 'coins')?.[1]).toBe('200');
    // Legacy storage survived with every element intact, exactly once.
    expect(tagsNamed(tags, 'storage')).toEqual([
      ['storage', 'food_apple:5', 'legacy-extra'],
    ]);
    // Unrelated host extension tags survived too.
    expect(tags.find(([n]) => n === 'xp')?.[1]).toBe('42');
  });
});
