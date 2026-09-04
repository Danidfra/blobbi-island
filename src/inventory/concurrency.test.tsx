/**
 * Concurrency tests for the inventory mutation layer (Q9 of the audit).
 *
 * These verify the SINGLE-INSTANCE guarantees:
 *  - mutations are serialized per-user;
 *  - each mutation performs a fresh read immediately before building the event;
 *  - a second queued mutation observes the result of the first, so two rapid
 *    consumptions of the FINAL unit cannot both succeed locally.
 *
 * Cross-device / cross-tab conflicts are NOT covered by in-memory serialization
 * (documented limitation): two independent app instances can still both read
 * the same remote snapshot before either publishes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const TEST_PUBKEY = '1'.repeat(64);

// A stateful in-memory "relay" that reflects published inventory immediately,
// modeling a single fast relay (best case for read-your-write).
let storedEvent: NostrEvent | null = null;

const nostrEvent = vi.fn(async (event: NostrEvent) => {
  storedEvent = event;
});
const nostrQuery = vi.fn(async () => (storedEvent ? [storedEvent] : []));
const signEvent = vi.fn(
  async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> => ({
    ...t,
    tags: t.tags ?? [],
    content: t.content ?? '',
    created_at: Math.floor(Date.now() / 1000),
    id: 'id-' + Math.random().toString(16).slice(2),
    pubkey: TEST_PUBKEY,
    sig: 'sig',
  }),
);

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { event: nostrEvent, query: nostrQuery } }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: TEST_PUBKEY, signer: { signEvent } } }),
}));

import { useInventoryMutation } from './useInventoryMutation';
import {
  buildEmptyInventory,
  buildInventoryTemplate,
  applyMutation,
  itemIdToAddress,
} from './index';

const APPLE = itemIdToAddress('food_apple')!;

function seed(qty: number) {
  const inv = applyMutation(buildEmptyInventory(TEST_PUBKEY), {
    type: 'add',
    address: APPLE,
    amount: qty,
  });
  const template = buildInventoryTemplate(inv);
  storedEvent = {
    id: 'seed',
    pubkey: TEST_PUBKEY,
    created_at: 1,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('inventory concurrency (single instance)', () => {
  beforeEach(() => {
    storedEvent = null;
    nostrEvent.mockClear();
    nostrQuery.mockClear();
    signEvent.mockClear();
  });

  it('serializes two concurrent consumes so the FINAL unit is spent once', async () => {
    seed(1); // exactly one apple
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useInventoryMutation(), {
      wrapper: makeWrapper(client),
    });

    const outcomes: Array<'ok' | 'fail'> = [];
    await act(async () => {
      const a = result.current
        .mutateAsync({ type: 'consume', address: APPLE })
        .then(() => outcomes.push('ok'))
        .catch(() => outcomes.push('fail'));
      const b = result.current
        .mutateAsync({ type: 'consume', address: APPLE })
        .then(() => outcomes.push('ok'))
        .catch(() => outcomes.push('fail'));
      await Promise.all([a, b]);
    });

    // Exactly one consume succeeds; the other fails (fresh read sees 0).
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'fail')).toHaveLength(1);
    // Only one inventory event was published.
    expect(nostrEvent).toHaveBeenCalledTimes(1);
  });

  it('a queued mutation observes the result of the previous one', async () => {
    seed(2);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useInventoryMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      const a = result.current.mutateAsync({ type: 'consume', address: APPLE });
      const b = result.current.mutateAsync({ type: 'consume', address: APPLE });
      await Promise.all([a, b]);
    });

    // Two published writes; final stored inventory is 0 apples (removed).
    expect(nostrEvent).toHaveBeenCalledTimes(2);
    const finalTags = storedEvent!.tags.filter((t) => t[0] === 'a' && t[1] === APPLE);
    expect(finalTags).toHaveLength(0);
  });
});
