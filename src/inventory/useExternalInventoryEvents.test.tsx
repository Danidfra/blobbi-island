/**
 * The live store hook: initial fetch + live tail, and the lifecycle around
 * it. Relays are fakes; everything else — the store, the merge, the
 * derivation, the query — is real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { clearEstablishedSpends } from './established-spends';
import type { LiveRelay } from './external-inventory-relays';
import { KIND_GAME_INVENTORY, KIND_GAME_INVENTORY_FOLD, KIND_GAME_INVENTORY_SPEND } from './package';

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const FARM_ISSUER = 'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';
const STRAWBERRY = `31632:${FARM_ISSUER}:farm:produce:strawberry`;
const FARM_MAIN = `31633:${OWNER}:farm:main`;
const RELAYS = ['wss://relay.primal.net', 'wss://relay.ditto.pub'];

let currentUser: { pubkey: string } | null = { pubkey: OWNER };
vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: currentUser }) }));
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: { relayUrl: 'wss://relay.ditto.pub' } }),
}));

/** What the "relays" hold for the authoritative fetch. */
const stored: { snapshots: NostrEvent[]; spends: NostrEvent[]; folds: NostrEvent[] } = {
  snapshots: [],
  spends: [],
  folds: [],
};

interface FakeRelay extends LiveRelay {
  url: string;
  filters: NostrFilter[][];
  closed: boolean;
  /** Push a live message into the open subscription. */
  emit(msg: ['EVENT', string, NostrEvent] | ['EOSE', string] | ['CLOSED', string, string]): void;
  /** End the current iterator as if the socket dropped. */
  drop(): void;
}

const openRelays: FakeRelay[] = [];
/** The relays currently subscribed (a re-scoped tail closes the previous ones). */
const live = () => openRelays.filter((r) => !r.closed);

function makeFakeRelay(url: string): FakeRelay {
  let resolveNext: ((msg: unknown) => void) | null = null;
  const queue: unknown[] = [];
  let ended = false;
  const relay: FakeRelay = {
    url,
    filters: [],
    closed: false,
    emit(msg) {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r(msg);
      } else queue.push(msg);
    },
    drop() {
      ended = true;
      relay.emit(['CLOSED', 's', 'dropped']);
    },
    async *req(filters, opts) {
      relay.filters.push(filters);
      ended = false;
      // Bootstrap replay, then EOSE, then live.
      for (const event of [...stored.snapshots, ...stored.spends, ...stored.folds]) {
        yield ['EVENT', 's', event] as ['EVENT', string, NostrEvent];
      }
      yield ['EOSE', 's'] as ['EOSE', string];
      while (!ended && !opts?.signal?.aborted) {
        const msg = (queue.length
          ? queue.shift()
          : await new Promise((resolve) => {
              resolveNext = resolve;
              opts?.signal?.addEventListener('abort', () => resolve(['CLOSED', 's', 'aborted']), { once: true });
            })) as ['EVENT', string, NostrEvent] | ['EOSE', string] | ['CLOSED', string, string];
        if (msg[0] === 'CLOSED') return;
        yield msg;
      }
    },
    async close() {
      relay.closed = true;
      ended = true;
      relay.emit(['CLOSED', 's', 'closed']);
    },
  };
  openRelays.push(relay);
  return relay;
}

vi.mock('./external-inventory-relays', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./external-inventory-relays')>();
  return {
    ...actual,
    openLiveRelay: (url: string) => makeFakeRelay(url),
    readFromExternalRelays: async (_relays: readonly string[], filters: NostrFilter[]) => {
      const kinds = new Set(filters.flatMap((f) => f.kinds ?? []));
      const ids = new Set(filters.flatMap((f) => f.ids ?? []));
      const all = [...stored.snapshots, ...stored.spends, ...stored.folds];
      const events = all.filter((e) => kinds.has(e.kind) && (ids.size === 0 || ids.has(e.id)));
      return { events, answered: true };
    },
  };
});

import { useExternalInventoryView, externalInventoryEventsQueryKey } from './useExternalInventoryEvents';

const hex = (seed: string) =>
  seed.split('').map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64);

function snapshot(id: string, qty: number, options: { createdAt?: number; fold?: string; d?: string; owner?: string } = {}): NostrEvent {
  const tags: string[][] = [['d', options.d ?? 'farm:main'], ['a', STRAWBERRY, '', String(qty)]];
  if (options.fold) tags.push(['e', options.fold, 'wss://relay.primal.net', 'fold']);
  return { id: hex(id), pubkey: options.owner ?? OWNER, created_at: options.createdAt ?? 1000, kind: KIND_GAME_INVENTORY, tags, content: '', sig: '' };
}
function spend(id: string, qty = 1, options: { author?: string; createdAt?: number } = {}): NostrEvent {
  return {
    id: hex(id),
    pubkey: options.author ?? OWNER,
    created_at: options.createdAt ?? 2000,
    kind: KIND_GAME_INVENTORY_SPEND,
    tags: [['a', FARM_MAIN, '', 'inventory'], ['a', STRAWBERRY, '', 'item'], ['quantity', String(qty)]],
    content: '',
    sig: '',
  };
}
function fold(id: string, spends: string[]): NostrEvent {
  return {
    id: hex(id),
    pubkey: OWNER,
    created_at: 3000,
    kind: KIND_GAME_INVENTORY_FOLD,
    tags: [['a', FARM_MAIN, '', 'inventory'], ...spends.map((s) => ['e', s, '', 'spend'])],
    content: '',
    sig: '',
  };
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const renderView = () => renderHook(() => useExternalInventoryView(), { wrapper });
const strawberryQty = (result: { current: ReturnType<typeof useExternalInventoryView> }) => {
  const state = result.current.states.get(FARM_MAIN);
  if (!state || state.status !== 'ready' || !state.effective) return null;
  return state.effective.items.find((i) => i.address === STRAWBERRY)?.quantity ?? 0;
};

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  currentUser = { pubkey: OWNER };
  stored.snapshots = [snapshot('s1', 4)];
  stored.spends = [];
  stored.folds = [];
  openRelays.length = 0;
  clearEstablishedSpends();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('initial state', () => {
  it('derives the effective quantity from the authoritative fetch: snapshot, pending spends, fold chain', async () => {
    stored.spends = [spend('x1'), spend('x2')];
    stored.folds = [fold('m1', [hex('x1')])];
    stored.snapshots = [snapshot('s2', 3, { fold: hex('m1') })];
    const { result } = renderView();
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.inventories.map((i) => i.id)).toEqual(['farm:main']);
    // 3 raw, x1 folded (not subtracted), x2 pending → 2.
    expect(strawberryQty(result)).toBe(2);
  });
});

describe('the live tail', () => {
  it('opens ONE subscription per relay with the batched filters — never per inventory or item', async () => {
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    await waitFor(() => expect(live().map((r) => r.filters.length)).toEqual([1, 1]));
    expect(openRelays).toHaveLength(2); // opened ONCE, with the full scope
    expect(live().map((r) => r.url).sort()).toEqual([...RELAYS].sort());
    const filters = live()[0].filters[0];
    expect(filters).toHaveLength(3);
    expect(filters[0]).toEqual({ kinds: [KIND_GAME_INVENTORY], authors: [OWNER] });
    expect(filters[1]).toEqual({ kinds: [KIND_GAME_INVENTORY_SPEND], authors: [OWNER], '#a': [FARM_MAIN] });
    expect(filters[2]).toEqual({ kinds: [KIND_GAME_INVENTORY_FOLD], authors: [OWNER], '#a': [FARM_MAIN] });
  });

  it('a live kind:1416 reduces the quantity WITHOUT a refetch', async () => {
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    act(() => live()[0].emit(['EVENT', 's', spend('live1')]));
    await waitFor(() => expect(strawberryQty(result)).toBe(3));
    // The raw snapshot in the store is untouched.
    const store = client.getQueryData<{ snapshots: NostrEvent[] }>(externalInventoryEventsQueryKey(OWNER))!;
    expect(store.snapshots[0].tags).toContainEqual(['a', STRAWBERRY, '', '4']);
  });

  it('the same live spend from both relays applies once', async () => {
    const { result } = renderView();
    await waitFor(() => expect(live().length).toBe(2));
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    const s = spend('dup');
    act(() => {
      live()[0].emit(['EVENT', 's', s]);
      live()[1].emit(['EVENT', 's', { ...s }]);
    });
    await waitFor(() => expect(strawberryQty(result)).toBe(3));
    await new Promise((r) => setTimeout(r, 10));
    expect(strawberryQty(result)).toBe(3);
  });

  it("a wrong-author live spend, and one for another player's snapshot, change nothing", async () => {
    const { result } = renderView();
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    act(() => {
      live()[0].emit(['EVENT', 's', spend('bad', 1, { author: OTHER })]);
      live()[0].emit(['EVENT', 's', snapshot('theirs', 0, { owner: OTHER, createdAt: 9999 })]);
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(strawberryQty(result)).toBe(4);
  });

  it('a newer valid live kind:31633 replaces the snapshot; a malformed newer one does not', async () => {
    const { result } = renderView();
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    act(() => live()[0].emit(['EVENT', 's', { ...snapshot('bad', 0, { createdAt: 9000 }), tags: [] }]));
    await new Promise((r) => setTimeout(r, 10));
    expect(strawberryQty(result)).toBe(4);
    act(() => live()[0].emit(['EVENT', 's', snapshot('s2', 7, { createdAt: 2000 })]));
    await waitFor(() => expect(strawberryQty(result)).toBe(7));
  });

  it('fold first (inert), then the snapshot referencing it: settles live', async () => {
    stored.spends = [spend('x1')];
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(3));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    act(() => live()[0].emit(['EVENT', 's', fold('m1', [hex('x1')])]));
    await new Promise((r) => setTimeout(r, 10));
    expect(strawberryQty(result)).toBe(3); // orphan: inert
    act(() => live()[0].emit(['EVENT', 's', snapshot('s2', 3, { createdAt: 2000, fold: hex('m1') })]));
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('ready'));
    expect(strawberryQty(result)).toBe(3); // folded: not subtracted again
  });

  it('snapshot first, referencing an unseen fold: unresolved (no raw number), then resolves when the fold lands live', async () => {
    stored.spends = [spend('x1')];
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(3));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    act(() => live()[0].emit(['EVENT', 's', snapshot('s2', 3, { createdAt: 2000, fold: hex('m1') })]));
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('unresolved'));
    expect(strawberryQty(result)).toBeNull();
    act(() => live()[1].emit(['EVENT', 's', fold('m1', [hex('x1')])]));
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('ready'));
    expect(strawberryQty(result)).toBe(3);
  });

  it('snapshot first, fold NOT on the tail: fetched by id (bounded), then resolves', async () => {
    stored.spends = [spend('x1')];
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(3));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    // The fold exists on the relays' stored set but was never streamed.
    stored.folds = [fold('m1', [hex('x1')])];
    act(() => live()[0].emit(['EVENT', 's', snapshot('s2', 3, { createdAt: 2000, fold: hex('m1') })]));
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('ready'));
    expect(strawberryQty(result)).toBe(3);
  });

  it('a live snapshot for a NEW context triggers an authoritative refetch so its ledger loads', async () => {
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    const chest = snapshot('c1', 2, { d: 'guild:chest', createdAt: 2000 });
    stored.snapshots = [snapshot('s1', 4), chest];
    stored.spends = [{ ...spend('cx'), tags: [['a', `31633:${OWNER}:guild:chest`, '', 'inventory'], ['a', STRAWBERRY, '', 'item'], ['quantity', '1']] }];
    act(() => live()[0].emit(['EVENT', 's', chest]));
    await waitFor(() => expect(result.current.inventories.map((i) => i.id).sort()).toEqual(['farm:main', 'guild:chest']));
    // The refetch pulled the chest's spend: 2 − 1.
    await waitFor(() => {
      const state = result.current.states.get(`31633:${OWNER}:guild:chest`);
      expect(state?.status === 'ready' && state.effective?.items.find((i) => i.address === STRAWBERRY)?.quantity).toBe(1);
    });
    // And the tail was re-scoped to both addresses.
    await waitFor(() => {
      const latest = openRelays[openRelays.length - 1].filters.at(-1)!;
      expect(latest[1]['#a']).toEqual([FARM_MAIN, `31633:${OWNER}:guild:chest`]);
    });
  });
});

describe('recovery', () => {
  it('a second EOSE (the relay re-sent the REQ after reconnecting) reconciles from the authoritative fetch', async () => {
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    // While "away", a spend landed that this tail never streamed.
    stored.spends = [spend('missed')];
    act(() => live()[0].emit(['EOSE', 's']));
    await waitFor(() => expect(strawberryQty(result)).toBe(3));
  });

  it('a dropped iterator resubscribes and reconciles', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    stored.spends = [spend('missed')];
    const dropped = live()[0];
    act(() => dropped.drop());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await waitFor(() => expect(dropped.filters.length).toBe(2));
    await waitFor(() => expect(strawberryQty(result)).toBe(3));
  });
});

describe('lifecycle', () => {
  it('unmount closes every relay', async () => {
    const { result, unmount } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    await waitFor(() => expect(live().length).toBe(2));
    unmount();
    expect(openRelays.every((r) => r.closed)).toBe(true);
  });

  it('logout closes the tail and derives nothing; a new player gets a fresh store and fresh subscriptions', async () => {
    const { result, rerender } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    await waitFor(() => expect(live().length).toBe(2));
    const first = [...live()];

    currentUser = null;
    rerender();
    await waitFor(() => expect(first.every((r) => r.closed)).toBe(true));
    expect(result.current.inventories).toEqual([]);

    // Another player signs in: their own store, their own tail; the old
    // player's events are filtered by author and can never enter.
    stored.snapshots = [snapshot('o1', 9, { owner: OTHER })];
    currentUser = { pubkey: OTHER };
    rerender();
    await waitFor(() => expect(result.current.inventories.map((i) => i.owner)).toEqual([OTHER]));
    const latest = openRelays.filter((r) => !r.closed);
    expect(latest.every((r) => r.filters[0][0].authors?.[0] === OTHER)).toBe(true);
    act(() => latest[0].emit(['EVENT', 's', spend('stale', 1, { author: OWNER })]));
    await new Promise((r) => setTimeout(r, 10));
    const store = client.getQueryData<{ spends: NostrEvent[] }>(externalInventoryEventsQueryKey(OTHER))!;
    expect(store.spends).toEqual([]);
  });
});
