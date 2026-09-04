/**
 * The live store hook: initial fetch + live tail, and the lifecycle around
 * it. Relays are fakes; everything else, the store, the merge, the
 * derivation, the query, is real.
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
      // A REQ takes a round trip: the relay replays what it holds when the
      // REQ ARRIVES, not when the client decided to subscribe.
      await new Promise((resolve) => setTimeout(resolve, 0));
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

/** Network behaviour knobs for the authoritative reads. */
const network = {
  /** How many discovery (kind:31633) reads happened, the count of authoritative fetches. */
  discoveryReads: 0,
  /** How many by-id fold reads happened. */
  byIdReads: 0,
  /** When set, by-id reads answer with this instead of the stored set. */
  byId: null as null | (() => { events: NostrEvent[]; answered: boolean }),
  /** When set, runs right after the FIRST discovery read answers (an event landing after the fetch). */
  afterFirstDiscovery: null as null | (() => void),
};

vi.mock('./external-inventory-relays', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./external-inventory-relays')>();
  return {
    ...actual,
    openLiveRelay: (url: string) => makeFakeRelay(url),
    readFromExternalRelays: async (_relays: readonly string[], filters: NostrFilter[]) => {
      const kinds = new Set(filters.flatMap((f) => f.kinds ?? []));
      const ids = new Set(filters.flatMap((f) => f.ids ?? []));
      if (kinds.has(KIND_GAME_INVENTORY)) network.discoveryReads += 1;
      if (ids.size > 0) {
        network.byIdReads += 1;
        if (network.byId) return network.byId();
      }
      const all = [...stored.snapshots, ...stored.spends, ...stored.folds];
      const events = all.filter((e) => kinds.has(e.kind) && (ids.size === 0 || ids.has(e.id)));
      if (kinds.has(KIND_GAME_INVENTORY) && network.discoveryReads === 1 && network.afterFirstDiscovery) {
        const land = network.afterFirstDiscovery;
        network.afterFirstDiscovery = null;
        land();
      }
      return { events, answered: true };
    },
  };
});

import {
  applyLiveEvent,
  useExternalInventoryView,
  externalInventoryEventsQueryKey,
  foldRetryPolicy,
} from './useExternalInventoryEvents';
import type { ExternalInventoryEvents } from './external-inventory-events';

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
  network.discoveryReads = 0;
  network.byIdReads = 0;
  network.byId = null;
  network.afterFirstDiscovery = null;
  clearEstablishedSpends();
});

/** A relay set that has NOT caught up: it answers the refetch with `events`. */
const relaysServe = (snapshots: NostrEvent[], spends: NostrEvent[] = [], folds: NostrEvent[] = []) => {
  stored.snapshots = snapshots;
  stored.spends = spends;
  stored.folds = folds;
};
const refetch = () => act(async () => { await client.invalidateQueries({ queryKey: externalInventoryEventsQueryKey(OWNER) }); });
const settle = () => new Promise((r) => setTimeout(r, 20));
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
  it('opens ONE subscription per relay with the batched filters; never per inventory or item', async () => {
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

describe('a refetch reconciles: it never makes the client forget', () => {
  it('a live spend survives a stale refetch that does not return it: effective stays 3', async () => {
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    act(() => live()[0].emit(['EVENT', 's', spend('live1')]));
    await waitFor(() => expect(strawberryQty(result)).toBe(3));

    relaysServe([snapshot('s1', 4)]); // the relays never got live1
    await refetch();
    await waitFor(() => expect(network.discoveryReads).toBe(2));
    await settle();
    expect(strawberryQty(result)).toBe(3);
    const store = client.getQueryData<{ spends: NostrEvent[] }>(externalInventoryEventsQueryKey(OWNER))!;
    expect(store.spends.map((e) => e.id)).toEqual([hex('live1')]);
  });

  it('a live newer snapshot (rev18) survives a stale refetch that only knows rev17', async () => {
    stored.snapshots = [snapshot('r17', 4, { createdAt: 17 })];
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    act(() => live()[0].emit(['EVENT', 's', snapshot('r18', 2, { createdAt: 18 })]));
    await waitFor(() => expect(strawberryQty(result)).toBe(2));

    await refetch(); // relays still serve r17
    await waitFor(() => expect(network.discoveryReads).toBe(2));
    await settle();
    expect(strawberryQty(result)).toBe(2);
  });

  it('a fetched newer VALID snapshot (rev19) still advances the winner', async () => {
    stored.snapshots = [snapshot('r18', 2, { createdAt: 18 })];
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(2));
    relaysServe([snapshot('r19', 6, { createdAt: 19 })]);
    await refetch();
    await waitFor(() => expect(strawberryQty(result)).toBe(6));
  });

  it('a known fold survives a stale refetch', async () => {
    stored.spends = [spend('x1')];
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(3));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    act(() => {
      live()[0].emit(['EVENT', 's', fold('m1', [hex('x1')])]);
      live()[0].emit(['EVENT', 's', snapshot('s2', 3, { createdAt: 2000, fold: hex('m1') })]);
    });
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('ready'));
    expect(strawberryQty(result)).toBe(3);

    // A relay that has the new snapshot but not the fold, and not the spend.
    relaysServe([snapshot('s2', 3, { createdAt: 2000, fold: hex('m1') })]);
    await refetch();
    await waitFor(() => expect(network.discoveryReads).toBe(2));
    await settle();
    expect(result.current.states.get(FARM_MAIN)?.status).toBe('ready');
    expect(strawberryQty(result)).toBe(3);
  });

  it('pending → folded with quantity 3, then a stale refetch: still 2', async () => {
    stored.snapshots = [snapshot('s1', 5, { createdAt: 10 })];
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(5));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    act(() => live()[0].emit(['EVENT', 's', spend('x1', 3)]));
    await waitFor(() => expect(strawberryQty(result)).toBe(2));
    act(() => {
      live()[1].emit(['EVENT', 's', fold('m1', [hex('x1')])]);
      live()[1].emit(['EVENT', 's', snapshot('s2', 2, { createdAt: 20, fold: hex('m1') })]);
    });
    await settle();
    expect(strawberryQty(result)).toBe(2);

    // The stale relay still serves the pre-fold world.
    relaysServe([snapshot('s1', 5, { createdAt: 10 })], [spend('x1', 3)]);
    await refetch();
    await waitFor(() => expect(network.discoveryReads).toBe(2));
    await settle();
    expect(strawberryQty(result)).toBe(2);
  });

  it('there is no missed-event window between the fetch and the tail: the tail replays', async () => {
    // Lands on the relay right after the fetch's discovery read answered,
    // before the ledger read, before the tail attached.
    network.afterFirstDiscovery = () => {
      stored.spends = [spend('between')];
    };
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(3));
    expect(network.discoveryReads).toBe(1); // no refetch was needed: the tail's replay carried it
  });
});

describe('the last window: a live event between the query result and its commit', () => {
  /**
   * Hook the ONE place TanStack writes a completed fetch, `Query.setData`
   * without `manual`: and, right before it commits, deliver a live event
   * through the production path (`applyLiveEvent` → `setQueryData`, which is
   * a `manual` write through the same method). That is exactly "the query
   * function has already returned; the result has not been committed yet".
   * Against 3accc2b (reconcile inside the query function) this loses the
   * event; against `structuralSharing` reconciliation it cannot.
   */
  function injectAtCommit(event: NostrEvent) {
    const query = client.getQueryCache().find<ExternalInventoryEvents>({
      queryKey: externalInventoryEventsQueryKey(OWNER),
    })!;
    const original = query.setData.bind(query);
    const seen = { injected: false, committed: null as ExternalInventoryEvents | null };
    query.setData = (data, options) => {
      if (!options?.manual && !seen.injected) {
        seen.injected = true;
        applyLiveEvent(client, OWNER, event);
      }
      const committed = original(data, options);
      if (!options?.manual) seen.committed = committed;
      return committed;
    };
    return seen;
  }

  it('a live spend that lands after the refetch produced its result is NOT forgotten by the commit', async () => {
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    const seen = injectAtCommit(spend('s4'));

    relaysServe([snapshot('s1', 4)]); // the relays never got s4
    await refetch();
    await waitFor(() => expect(seen.committed).not.toBeNull());
    expect(seen.injected).toBe(true);
    // The COMMITTED value itself carries s4; not a later re-merge.
    expect(seen.committed!.spends.map((e) => e.id)).toEqual([hex('s4')]);
    await settle();
    expect(strawberryQty(result)).toBe(3);
  });

  it('a live newer snapshot that lands after the refetch produced its result is NOT regressed by the commit', async () => {
    stored.snapshots = [snapshot('r17', 4, { createdAt: 17 })];
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    const seen = injectAtCommit(snapshot('r18', 2, { createdAt: 18 }));

    await refetch(); // relays still serve r17
    await waitFor(() => expect(seen.committed).not.toBeNull());
    expect(seen.committed!.snapshots.map((e) => e.id)).toEqual([hex('r18')]);
    await settle();
    expect(strawberryQty(result)).toBe(2);
  });

  it('the same commit still advances to a fetched newer VALID snapshot', async () => {
    stored.snapshots = [snapshot('r17', 4, { createdAt: 17 })];
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    const seen = injectAtCommit(spend('s4'));
    relaysServe([snapshot('r19', 6, { createdAt: 19 })]);
    await refetch();
    await waitFor(() => expect(seen.committed).not.toBeNull());
    expect(seen.committed!.snapshots.map((e) => e.id)).toEqual([hex('r19')]);
    expect(seen.committed!.spends.map((e) => e.id)).toEqual([hex('s4')]);
    await waitFor(() => expect(strawberryQty(result)).toBe(5));
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

  it('the first (bootstrap) EOSE does not invalidate, and a reconnect EOSE invalidates exactly once; no loop', async () => {
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    await waitFor(() => expect(live().every((r) => r.filters.length === 1)).toBe(true));
    await settle();
    expect(network.discoveryReads).toBe(1);
    const before = openRelays.length;

    act(() => live()[0].emit(['EOSE', 's']));
    await waitFor(() => expect(network.discoveryReads).toBe(2));
    await settle();
    expect(network.discoveryReads).toBe(2); // the refetch did not re-trigger anything
    expect(openRelays.length).toBe(before); // no resubscription: the scope did not change
    expect(live().every((r) => r.filters.length === 1)).toBe(true);
  });

  it('the tab becoming visible again reconciles once from the authoritative fetch; hidden does nothing', async () => {
    // The Connected Experiences return path: the player harvested in another
    // tab and came back. A silenced socket must not leave stale produce.
    const { result } = renderView();
    await waitFor(() => expect(strawberryQty(result)).toBe(4));
    await waitFor(() => expect(live().every((r) => r.filters.length === 1)).toBe(true));
    await settle();
    expect(network.discoveryReads).toBe(1);
    const before = openRelays.length;

    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await settle();
    expect(network.discoveryReads).toBe(1);

    stored.spends = [spend('while-away')];
    visibility.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(strawberryQty(result)).toBe(3));
    await settle();
    expect(network.discoveryReads).toBe(2);
    expect(openRelays.length).toBe(before);
    visibility.mockRestore();
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

describe('missing folds', () => {
  it('a transient (unanswered) by-id read is retried on the next recovery trigger and then resolves', async () => {
    stored.spends = [spend('x1')];
    stored.snapshots = [snapshot('s2', 3, { createdAt: 2000, fold: hex('m1') })];
    network.byId = () => ({ events: [], answered: false }); // by-id relays down
    const { result } = renderView();
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('unresolved'));
    await waitFor(() => expect(network.byIdReads).toBeGreaterThan(0));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    await settle();
    const attemptsSoFar = network.byIdReads;
    const fetchesSoFar = network.discoveryReads;
    expect(strawberryQty(result)).toBeNull(); // never the raw number

    // The by-id relays come back, holding the manifest (it is ONLY reachable
    // by id here, the ledger read still does not have it). After the
    // unanswered wait, a recovery trigger; here the view changing because a
    // live spend arrived, makes the manifest eligible again.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    network.byId = () => ({ events: [fold('m1', [hex('x1')])], answered: true });
    act(() => live()[0].emit(['EVENT', 's', spend('x2', 1, { createdAt: 2500 })]));
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('ready'));
    expect(network.byIdReads).toBeGreaterThan(attemptsSoFar);
    expect(network.discoveryReads).toBe(fetchesSoFar); // no refetch was needed
    expect(strawberryQty(result)).toBe(2); // raw 3 − x2 (pending); x1 folded, not subtracted
  });

  it('a by-id read cancelled mid-flight by a view change does not strand the manifest: it is asked for again', async () => {
    stored.spends = [spend('x1')];
    stored.snapshots = [snapshot('s2', 3, { createdAt: 2000, fold: hex('m1') })];
    let calls = 0;
    network.byId = () => {
      calls += 1;
      // 1: the authoritative fetch's own by-id round, answered, absent.
      if (calls === 1) return { events: [], answered: true };
      // 2: the view's read, a read that never comes back (the relay hangs).
      if (calls === 2) return new Promise(() => {}) as unknown as { events: NostrEvent[]; answered: boolean };
      // 3+: the retry finds it.
      return { events: [fold('m1', [hex('x1')])], answered: true };
    };
    const { result } = renderView();
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('unresolved'));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    await waitFor(() => expect(network.byIdReads).toBe(2));
    const reads = network.byIdReads;
    // The view changes while the read hangs: the effect re-runs, cancels the
    // hung read, and the manifest is eligible again at once.
    act(() => live()[0].emit(['EVENT', 's', spend('x2', 1, { createdAt: 2500 })]));
    await waitFor(() => expect(network.byIdReads).toBeGreaterThan(reads));
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('ready'));
    expect(strawberryQty(result)).toBe(2);
  });

  it('an answered-but-absent by-id read is not hammered: the same trigger does not retry before its wait', async () => {
    stored.spends = [spend('x1')];
    stored.snapshots = [snapshot('s2', 3, { createdAt: 2000, fold: hex('m1') })];
    const { result } = renderView();
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('unresolved'));
    await waitFor(() => expect(network.byIdReads).toBeGreaterThan(0));
    const reads = network.byIdReads;
    act(() => live()[0]?.emit(['EVENT', 's', spend('x2')])); // view changes → trigger
    await settle();
    expect(network.byIdReads).toBe(reads); // still within the absent-wait
    expect(strawberryQty(result)).toBeNull();
  });

  it('a live kind:1417 resolves an unresolved inventory without any refetch', async () => {
    stored.spends = [spend('x1')];
    stored.snapshots = [snapshot('s2', 3, { createdAt: 2000, fold: hex('m1') })];
    const { result } = renderView();
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('unresolved'));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    const reads = network.discoveryReads;
    act(() => live()[0].emit(['EVENT', 's', fold('m1', [hex('x1')])]));
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('ready'));
    expect(strawberryQty(result)).toBe(3);
    expect(network.discoveryReads).toBe(reads);
  });
});

describe('missing folds: the one-shot wake-up', () => {
  /** by-id answers scripted per call; the fetch's own round is call 1. */
  function scriptById(script: ((call: number) => { events: NostrEvent[]; answered: boolean })) {
    let calls = 0;
    network.byId = () => script((calls += 1));
  }
  const unresolvedFarm = () => {
    stored.spends = [spend('x1')];
    stored.snapshots = [snapshot('s2', 3, { createdAt: 2000, fold: hex('m1') })];
  };
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it('unanswered: with NO event, refetch or reconnect, the second by-id happens by itself after ~5 s and resolves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    unresolvedFarm();
    scriptById((call) => (call <= 2 ? { events: [], answered: false } : { events: [fold('m1', [hex('x1')])], answered: true }));
    const { result } = renderView();
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('unresolved'));
    await waitFor(() => expect(network.byIdReads).toBe(2));
    await advance(4_500);
    expect(network.byIdReads).toBe(2);
    const fetches = network.discoveryReads;
    await advance(1_000);
    await waitFor(() => expect(network.byIdReads).toBe(3));
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('ready'));
    expect(strawberryQty(result)).toBe(3);
    expect(network.discoveryReads).toBe(fetches); // no refetch, no reconnect
  });

  it('answered-but-absent: no retry before 30 s, exactly one at the deadline', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    unresolvedFarm();
    scriptById((call) => (call <= 2 ? { events: [], answered: true } : { events: [fold('m1', [hex('x1')])], answered: true }));
    const { result } = renderView();
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('unresolved'));
    await waitFor(() => expect(network.byIdReads).toBe(2));
    await advance(29_000);
    expect(network.byIdReads).toBe(2);
    await advance(1_500);
    await waitFor(() => expect(network.byIdReads).toBe(3));
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('ready'));
    await advance(60_000);
    expect(network.byIdReads).toBe(3); // resolved: no further reads, no timer
  });

  it('repeated failures back off exponentially: 5 s, 10 s, 20 s, and never hammer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    unresolvedFarm();
    scriptById(() => ({ events: [], answered: false }));
    const { result } = renderView();
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('unresolved'));
    await waitFor(() => expect(network.byIdReads).toBe(2)); // t≈0: fetch round + view read
    await advance(5_200);
    await waitFor(() => expect(network.byIdReads).toBe(3)); // +5 s
    await advance(9_000);
    expect(network.byIdReads).toBe(3);
    await advance(1_500);
    await waitFor(() => expect(network.byIdReads).toBe(4)); // +10 s
    await advance(19_000);
    expect(network.byIdReads).toBe(4);
    await advance(1_500);
    await waitFor(() => expect(network.byIdReads).toBe(5)); // +20 s
    expect(result.current.states.get(FARM_MAIN)?.status).toBe('unresolved');
    expect(strawberryQty(result)).toBeNull();
  });

  it('a live fold arriving before the deadline resolves, and the pending wake-up performs no read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    unresolvedFarm();
    scriptById(() => ({ events: [], answered: false }));
    const { result } = renderView();
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('unresolved'));
    await waitFor(() => expect(network.byIdReads).toBe(2));
    await waitFor(() => expect(live()[0]?.filters.length).toBe(1));
    act(() => live()[0].emit(['EVENT', 's', fold('m1', [hex('x1')])]));
    await waitFor(() => expect(result.current.states.get(FARM_MAIN)?.status).toBe('ready'));
    await advance(30_000);
    expect(network.byIdReads).toBe(2);
  });

  it('unmount cancels the pending wake-up; a user change never retries the old user\'s manifest', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    unresolvedFarm();
    scriptById(() => ({ events: [], answered: false }));
    const first = renderView();
    await waitFor(() => expect(first.result.current.states.get(FARM_MAIN)?.status).toBe('unresolved'));
    await waitFor(() => expect(network.byIdReads).toBe(2));
    first.unmount();
    await advance(30_000);
    expect(network.byIdReads).toBe(2);

    // Same scenario, then the player changes before the deadline.
    const second = renderView();
    await waitFor(() => expect(second.result.current.states.get(FARM_MAIN)?.status).toBe('unresolved'));
    await waitFor(() => expect(network.byIdReads).toBe(4));
    currentUser = { pubkey: OTHER };
    stored.snapshots = [snapshot('o1', 9, { owner: OTHER })];
    stored.spends = [];
    second.rerender();
    await waitFor(() => expect(second.result.current.inventories.map((i) => i.owner)).toEqual([OTHER]));
    await advance(60_000);
    expect(network.byIdReads).toBe(4);
  });
});

describe('the fold retry policy', () => {
  it('first ask is eligible, in-flight is not, unanswered retries sooner than absent, backoff doubles and caps', () => {
    const t = 1_000_000;
    expect(foldRetryPolicy.eligible(undefined, t)).toBe(true);
    const started = foldRetryPolicy.started(undefined, t);
    expect(foldRetryPolicy.eligible(started, t + 999_999)).toBe(false);
    const unanswered = foldRetryPolicy.finished(started, false, t);
    expect(unanswered.outcome).toBe('unanswered');
    expect(foldRetryPolicy.eligible(unanswered, t + 4_999)).toBe(false);
    expect(foldRetryPolicy.eligible(unanswered, t + 5_000)).toBe(true);
    const absent = foldRetryPolicy.finished(started, true, t);
    expect(absent.outcome).toBe('absent');
    expect(foldRetryPolicy.eligible(absent, t + 29_999)).toBe(false);
    expect(foldRetryPolicy.eligible(absent, t + 30_000)).toBe(true);
    // A client-side cancellation is eligible again immediately and does not count as a try.
    const cancelled = foldRetryPolicy.aborted(foldRetryPolicy.started(undefined, t), t);
    expect(cancelled.inFlight).toBe(false);
    expect(cancelled.tries).toBe(0);
    expect(foldRetryPolicy.eligible(cancelled, t)).toBe(true);
    // Doubling per try, capped at five minutes.
    let attempt = unanswered;
    for (let i = 0; i < 12; i += 1) attempt = foldRetryPolicy.finished(foldRetryPolicy.started(attempt, t), false, t);
    expect(attempt.nextEligibleAt - t).toBe(5 * 60_000);
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
