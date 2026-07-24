/**
 * Regression tests: coins writes (used by purchases) must preserve non-inventory
 * kind:11125 profile fields (coins/pets/achievements/companion/Ditto tags) AND
 * must not delete legacy `inv` accessory tags.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const TEST_PUBKEY = 'b'.repeat(64);

const nostrEvent = vi.fn<(event: NostrEvent, opts?: unknown) => Promise<void>>();
const nostrQuery = vi.fn<() => Promise<NostrEvent[]>>();
const signEvent = vi.fn(
  async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> => ({
    ...t,
    tags: t.tags ?? [],
    content: t.content ?? '',
    created_at: t.created_at ?? Math.floor(Date.now() / 1000),
    id: 'id-' + Math.random().toString(16).slice(2),
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

import { useCoinsMutation } from './useCoinsMutation';

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

/** A realistic 11125 profile with pets, achievements, companion, Ditto + inv. */
function profileEvent(coins: number): NostrEvent {
  return {
    id: 'profile',
    pubkey: TEST_PUBKEY,
    created_at: 100,
    kind: 11125,
    tags: [
      ['d', 'profile'],
      ['b', 'blobbi:ecosystem:v1'],
      ['name', 'Tester'],
      ['coins', String(coins)],
      ['current_companion', 'blobbi-abc'],
      ['has', 'blobbi-abc'],
      ['has', 'blobbi-def'],
      ['achievements', 'first-egg'],
      ['inv', 'headwear-1', 'qty', '2', 'url', 'x', 'ver', '1'],
      ['storage', 'food_apple:5'], // legacy consumable inventory (must be dropped)
      ['xp', '42'], // Ditto unknown tag
    ],
    content: '{"custom":true}',
    sig: 'sig',
  };
}

function tagValue(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}
function tagValues(tags: string[][], name: string): string[] {
  return tags.filter(([n]) => n === name).map(([, v]) => v);
}

describe('useCoinsMutation regression', () => {
  beforeEach(() => {
    nostrEvent.mockReset();
    nostrQuery.mockReset();
    signEvent.mockClear();
    nostrEvent.mockResolvedValue(undefined);
  });

  it('deducts coins while preserving pets, companion, achievements, Ditto and inv tags', async () => {
    nostrQuery.mockResolvedValue([profileEvent(200)]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useCoinsMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync(-35);
    });

    expect(nostrEvent).toHaveBeenCalledTimes(1);
    const published = nostrEvent.mock.calls[0][0];
    expect(published.kind).toBe(11125);

    // Coins updated.
    expect(tagValue(published.tags, 'coins')).toBe('165');
    // Non-inventory fields preserved.
    expect(tagValues(published.tags, 'has')).toEqual(['blobbi-abc', 'blobbi-def']);
    expect(tagValue(published.tags, 'current_companion')).toBe('blobbi-abc');
    expect(tagValues(published.tags, 'achievements')).toEqual(['first-egg']);
    // Ditto unknown tag preserved.
    expect(tagValue(published.tags, 'xp')).toBe('42');
    // Content preserved.
    expect(published.content).toBe('{"custom":true}');
    // Accessory inv tag NOT deleted (Phase 10 boundary).
    expect(published.tags.some((t) => t[0] === 'inv' && t[1] === 'headwear-1')).toBe(true);
    // Legacy consumable `storage` inventory is NOT re-emitted (dropped).
    expect(published.tags.some((t) => t[0] === 'storage')).toBe(false);
  });

  it('rejects a purchase that would make coins negative', async () => {
    nostrQuery.mockResolvedValue([profileEvent(10)]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useCoinsMutation(), {
      wrapper: makeWrapper(client),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync(-50);
      }),
    ).rejects.toThrow(/Insufficient coins/);
    expect(nostrEvent).not.toHaveBeenCalled();
  });
});
