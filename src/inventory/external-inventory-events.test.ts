/**
 * The external inventory event STORE: what enters it, what it derives, and,
 * the part that only matters once events arrive live; that the order of
 * arrival never changes the answer.
 *
 * Every balance rule is the package's; what is pinned here is the store's
 * discipline around it: canonical snapshot selection on merge, dedupe by id,
 * an orphan fold staying inert, a snapshot-before-fold staying unresolved
 * until the fold lands, and one REQ's worth of filters for any number of
 * inventories.
 */

import { describe, it, expect, vi } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  deriveExternalInventoryStates,
  emptyExternalInventoryEvents,
  externalInventoryLiveFilters,
  fetchExternalInventoryEvents,
  mergeExternalInventoryEvent,
  mergeExternalInventoryEvents,
  missingFoldReferencesOf,
  reconcileExternalInventoryStores,
  type ExternalInventoryFetchDeps,
} from './external-inventory-events';
import { effectiveQuantity } from './external-inventory-state';
import {
  ISLAND_INVENTORY_D,
  KIND_GAME_INVENTORY,
  KIND_GAME_INVENTORY_FOLD,
  KIND_GAME_INVENTORY_SPEND,
} from './package';

const OWNER = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);
const FARM_ISSUER = 'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';
const STRAWBERRY = `31632:${FARM_ISSUER}:farm:produce:strawberry`;
const FARM_MAIN = `31633:${OWNER}:farm:main`;
const CHEST = `31633:${OWNER}:guild:chest`;

/** A distinct, deterministic 64-hex id per label (two hex digits per character). */
const hex = (seed: string) =>
  seed
    .split('')
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(64, '0')
    .slice(0, 64);

function snapshot(
  id: string,
  items: [string, number][],
  options: { d?: string; fold?: string; createdAt?: number; owner?: string; malformed?: boolean } = {},
): NostrEvent {
  const tags: string[][] = options.malformed ? [] : [['d', options.d ?? 'farm:main']];
  for (const [address, quantity] of items) tags.push(['a', address, '', String(quantity)]);
  if (options.fold) tags.push(['e', options.fold, 'wss://relay.primal.net', 'fold']);
  return {
    id: hex(id),
    pubkey: options.owner ?? OWNER,
    created_at: options.createdAt ?? 1000,
    kind: KIND_GAME_INVENTORY,
    tags,
    content: '',
    sig: '',
  };
}

function spend(
  id: string,
  options: { qty?: number; createdAt?: number; author?: string; inventory?: string } = {},
): NostrEvent {
  return {
    id: hex(id),
    pubkey: options.author ?? OWNER,
    created_at: options.createdAt ?? 2000,
    kind: KIND_GAME_INVENTORY_SPEND,
    tags: [
      ['a', options.inventory ?? FARM_MAIN, '', 'inventory'],
      ['a', STRAWBERRY, '', 'item'],
      ['quantity', String(options.qty ?? 1)],
    ],
    content: '',
    sig: '',
  };
}

function fold(
  id: string,
  options: { spends?: string[]; voids?: string[]; previous?: string; author?: string; inventory?: string } = {},
): NostrEvent {
  const tags: string[][] = [['a', options.inventory ?? FARM_MAIN, '', 'inventory']];
  if (options.previous) tags.push(['e', options.previous, '', 'previous']);
  for (const s of options.spends ?? []) tags.push(['e', s, '', 'spend']);
  for (const v of options.voids ?? []) tags.push(['e', v, '', 'void']);
  return { id: hex(id), pubkey: options.author ?? OWNER, created_at: 3000, kind: KIND_GAME_INVENTORY_FOLD, tags, content: '', sig: '' };
}

const empty = () => emptyExternalInventoryEvents(OWNER);
const qty = (store: ReturnType<typeof empty>, address = FARM_MAIN) =>
  effectiveQuantity(deriveExternalInventoryStates(store).states.get(address)?.resolution, STRAWBERRY);
const status = (store: ReturnType<typeof empty>, address = FARM_MAIN) =>
  deriveExternalInventoryStates(store).states.get(address)?.status;

describe('merging kind:31633 (addressable: newest VALID per context)', () => {
  it('a newer valid snapshot replaces the current one for its context', () => {
    let store = mergeExternalInventoryEvent(empty(), snapshot('s1', [[STRAWBERRY, 4]], { createdAt: 10 }));
    expect(qty(store)).toBe(4);
    store = mergeExternalInventoryEvent(store, snapshot('s2', [[STRAWBERRY, 2]], { createdAt: 20 }));
    expect(store.snapshots.map((e) => e.id)).toEqual([hex('s2')]);
    expect(qty(store)).toBe(2);
  });

  it('a malformed newer event does NOT shadow the valid snapshot', () => {
    let store = mergeExternalInventoryEvent(empty(), snapshot('s1', [[STRAWBERRY, 4]], { createdAt: 10 }));
    const next = mergeExternalInventoryEvent(store, snapshot('bad', [[STRAWBERRY, 0]], { createdAt: 99, malformed: true }));
    expect(next).toBe(store);
    expect(qty(next)).toBe(4);
    store = next;
  });

  it('an older snapshot for the same context is dropped', () => {
    const store = mergeExternalInventoryEvent(empty(), snapshot('s2', [[STRAWBERRY, 2]], { createdAt: 20 }));
    expect(mergeExternalInventoryEvent(store, snapshot('s1', [[STRAWBERRY, 4]], { createdAt: 10 }))).toBe(store);
  });

  it('equal created_at breaks on the lower event id, deterministically', () => {
    const a = snapshot('aaaa', [[STRAWBERRY, 1]], { createdAt: 10 });
    const b = snapshot('bbbb', [[STRAWBERRY, 9]], { createdAt: 10 });
    const ab = mergeExternalInventoryEvents(empty(), [a, b]);
    const ba = mergeExternalInventoryEvents(empty(), [b, a]);
    expect(ab.snapshots.map((e) => e.id)).toEqual([hex('aaaa')]);
    expect(ba.snapshots.map((e) => e.id)).toEqual([hex('aaaa')]);
  });

  it('keeps one snapshot per context: another context is another row', () => {
    const store = mergeExternalInventoryEvents(empty(), [
      snapshot('s1', [[STRAWBERRY, 4]]),
      snapshot('c1', [[STRAWBERRY, 1]], { d: 'guild:chest' }),
    ]);
    expect(store.snapshots).toHaveLength(2);
    expect(qty(store)).toBe(4);
    expect(qty(store, CHEST)).toBe(1);
  });

  it("ignores another player's snapshot and Blobbi's own context", () => {
    const store = empty();
    expect(mergeExternalInventoryEvent(store, snapshot('x', [[STRAWBERRY, 4]], { owner: STRANGER }))).toBe(store);
    expect(mergeExternalInventoryEvent(store, snapshot('y', [[STRAWBERRY, 4]], { d: ISLAND_INVENTORY_D }))).toBe(store);
  });

  it('the same snapshot delivered twice is a no-op (same object back)', () => {
    const s1 = snapshot('s1', [[STRAWBERRY, 4]]);
    const store = mergeExternalInventoryEvent(empty(), s1);
    expect(mergeExternalInventoryEvent(store, { ...s1 })).toBe(store);
  });
});

describe('merging kind:1416 live', () => {
  const base = () => mergeExternalInventoryEvent(empty(), snapshot('s1', [[STRAWBERRY, 4]]));

  it('a new spend reduces the effective quantity, the raw snapshot is untouched', () => {
    const store = mergeExternalInventoryEvent(base(), spend('x1'));
    expect(qty(store)).toBe(3);
    expect(store.snapshots[0].tags).toContainEqual(['a', STRAWBERRY, '', '4']);
  });

  it('a spend of quantity 3 reduces by 3', () => {
    expect(qty(mergeExternalInventoryEvent(base(), spend('x1', { qty: 3 })))).toBe(1);
  });

  it('the same spend from two relays applies once', () => {
    const s = spend('x1');
    const store = mergeExternalInventoryEvents(base(), [s, { ...s }]);
    expect(store.spends).toHaveLength(1);
    expect(qty(store)).toBe(3);
  });

  it("a wrong-author spend never enters the store", () => {
    const store = base();
    expect(mergeExternalInventoryEvent(store, spend('x1', { author: STRANGER }))).toBe(store);
  });

  it('a spend for another inventory is stored (it may belong to a context discovered later) and cannot affect this one', () => {
    const store = mergeExternalInventoryEvent(base(), spend('x1', { inventory: CHEST }));
    expect(store.spends).toHaveLength(1);
    expect(qty(store)).toBe(4);
  });

  it('a late spend with an OLDER created_at than the snapshot still applies as pending', () => {
    const store = mergeExternalInventoryEvent(
      mergeExternalInventoryEvent(empty(), snapshot('s1', [[STRAWBERRY, 4]], { createdAt: 5000 })),
      spend('x1', { createdAt: 10 }),
    );
    expect(qty(store)).toBe(3);
  });
});

describe('merging kind:1417 live: arrival order never changes the answer', () => {
  it('an orphan fold is stored and INERT', () => {
    const store = mergeExternalInventoryEvents(empty(), [
      snapshot('s1', [[STRAWBERRY, 4]]),
      spend('x1'),
      fold('m1', { spends: [hex('x1')] }),
    ]);
    expect(store.folds).toHaveLength(1);
    // Nothing references m1: x1 is still pending, effective still 3.
    expect(status(store)).toBe('ready');
    expect(qty(store)).toBe(3);
  });

  it('fold first, then the snapshot referencing it: derives using the fold', () => {
    let store = mergeExternalInventoryEvents(empty(), [
      snapshot('s1', [[STRAWBERRY, 4]], { createdAt: 10 }),
      spend('x1'),
      fold('m1', { spends: [hex('x1')] }),
    ]);
    expect(qty(store)).toBe(3);
    store = mergeExternalInventoryEvent(store, snapshot('s2', [[STRAWBERRY, 3]], { createdAt: 20, fold: hex('m1') }));
    expect(status(store)).toBe('ready');
    expect(qty(store)).toBe(3); // folded: not subtracted again
  });

  it('snapshot first, referencing a fold not yet seen: UNRESOLVED (never the raw number), then resolves when the fold lands', () => {
    let store = mergeExternalInventoryEvents(empty(), [
      spend('x1'),
      snapshot('s2', [[STRAWBERRY, 3]], { createdAt: 20, fold: hex('m1') }),
    ]);
    expect(status(store)).toBe('unresolved');
    expect(qty(store)).toBe(0);
    expect(missingFoldReferencesOf(deriveExternalInventoryStates(store))).toEqual([
      { eventId: hex('m1'), relay: 'wss://relay.primal.net' },
    ]);

    store = mergeExternalInventoryEvent(store, fold('m1', { spends: [hex('x1')] }));
    expect(status(store)).toBe('ready');
    expect(qty(store)).toBe(3);
  });

  it('the previous chain resolves through several manifests, whatever order they arrived in', () => {
    const events = [
      fold('m2', { previous: hex('m1'), spends: [hex('x2')] }),
      spend('x2', { createdAt: 2500 }),
      snapshot('s3', [[STRAWBERRY, 2]], { createdAt: 30, fold: hex('m2') }),
      spend('x1'),
      fold('m1', { spends: [hex('x1')] }),
    ];
    const forward = mergeExternalInventoryEvents(empty(), events);
    const backward = mergeExternalInventoryEvents(empty(), [...events].reverse());
    for (const store of [forward, backward]) {
      expect(status(store)).toBe('ready');
      expect(qty(store)).toBe(2);
    }
  });

  it('a duplicate manifest is harmless', () => {
    const m1 = fold('m1', { spends: [hex('x1')] });
    const store = mergeExternalInventoryEvents(empty(), [
      snapshot('s2', [[STRAWBERRY, 3]], { fold: hex('m1') }),
      spend('x1'),
      m1,
      { ...m1 },
    ]);
    expect(store.folds).toHaveLength(1);
    expect(qty(store)).toBe(3);
  });

  it("a fold by another author never enters", () => {
    const store = mergeExternalInventoryEvent(empty(), snapshot('s2', [[STRAWBERRY, 3]], { fold: hex('m1') }));
    expect(mergeExternalInventoryEvent(store, fold('m1', { spends: [hex('x1')], author: STRANGER }))).toBe(store);
    expect(status(store)).toBe('unresolved');
  });
});

describe('admission: the package parsers decide what is worth keeping', () => {
  const base = () => mergeExternalInventoryEvent(empty(), snapshot('s1', [[STRAWBERRY, 4]]));

  it('a same-author kind:1416 that does not parse is NOT stored', () => {
    const store = base();
    const noQuantity: NostrEvent = { ...spend('bad1'), tags: [['a', FARM_MAIN, '', 'inventory'], ['a', STRAWBERRY, '', 'item']] };
    const dOnly: NostrEvent = { ...spend('bad2'), tags: [['a', 'farm:main', '', 'inventory'], ['a', STRAWBERRY, '', 'item'], ['quantity', '1']] };
    const zero: NostrEvent = { ...spend('bad3'), tags: [['a', FARM_MAIN, '', 'inventory'], ['a', STRAWBERRY, '', 'item'], ['quantity', '0']] };
    for (const bad of [noQuantity, dOnly, zero]) expect(mergeExternalInventoryEvent(store, bad)).toBe(store);
  });

  it('a same-author kind:1417 that does not parse is NOT stored', () => {
    const store = base();
    const empty1417: NostrEvent = { ...fold('bad1', { spends: [hex('x1')] }), tags: [['a', FARM_MAIN, '', 'inventory']] };
    const twice: NostrEvent = fold('bad2', { spends: [hex('x1')], voids: [hex('x1')] });
    for (const bad of [empty1417, twice]) expect(mergeExternalInventoryEvent(store, bad)).toBe(store);
  });

  it("an event whose inventory address names another owner never enters, whoever signed it", () => {
    const store = base();
    const otherInventory = `31633:${STRANGER}:farm:main`;
    const signedByOwner: NostrEvent = { ...spend('s'), tags: [['a', otherInventory, '', 'inventory'], ['a', STRAWBERRY, '', 'item'], ['quantity', '1']] };
    expect(mergeExternalInventoryEvent(store, signedByOwner)).toBe(store);
    expect(mergeExternalInventoryEvent(store, fold('f', { spends: [hex('x1')], author: STRANGER }))).toBe(store);
  });

  it('a valid spend or fold for a context not yet discovered IS kept', () => {
    const store = mergeExternalInventoryEvents(base(), [spend('x', { inventory: CHEST }), fold('m', { spends: [hex('x')], inventory: CHEST })]);
    expect(store.spends).toHaveLength(1);
    expect(store.folds).toHaveLength(1);
    expect(qty(store)).toBe(4);
  });
});

describe('reconciling a refetch with what is already known (monotonic per owner)', () => {
  it('an incomplete refetch cannot delete a known spend: effective stays 3', () => {
    const held = mergeExternalInventoryEvents(empty(), [snapshot('s1', [[STRAWBERRY, 4]]), spend('x1')]);
    const fetched = mergeExternalInventoryEvents(empty(), [snapshot('s1', [[STRAWBERRY, 4]])]);
    const result = reconcileExternalInventoryStores(held, fetched);
    expect(result).toBe(held); // nothing new was learned
    expect(qty(result)).toBe(3);
  });

  it('an incomplete refetch cannot delete a known fold', () => {
    const held = mergeExternalInventoryEvents(empty(), [
      spend('x1'),
      fold('m1', { spends: [hex('x1')] }),
      snapshot('s2', [[STRAWBERRY, 3]], { fold: hex('m1') }),
    ]);
    const fetched = mergeExternalInventoryEvents(empty(), [snapshot('s2', [[STRAWBERRY, 3]], { fold: hex('m1') }), spend('x1')]);
    const result = reconcileExternalInventoryStores(held, fetched);
    expect(result.folds).toHaveLength(1);
    expect(status(result)).toBe('ready');
    expect(qty(result)).toBe(3);
  });

  it('a stale refetch cannot regress rev18 → rev17', () => {
    const held = mergeExternalInventoryEvent(empty(), snapshot('r18', [[STRAWBERRY, 2]], { createdAt: 18 }));
    const fetched = mergeExternalInventoryEvent(empty(), snapshot('r17', [[STRAWBERRY, 4]], { createdAt: 17 }));
    const result = reconcileExternalInventoryStores(held, fetched);
    expect(result.snapshots.map((e) => e.id)).toEqual([hex('r18')]);
    expect(qty(result)).toBe(2);
  });

  it('a fetched newer VALID snapshot still advances the winner', () => {
    const held = mergeExternalInventoryEvent(empty(), snapshot('r18', [[STRAWBERRY, 2]], { createdAt: 18 }));
    const fetched = mergeExternalInventoryEvent(empty(), snapshot('r19', [[STRAWBERRY, 6]], { createdAt: 19 }));
    const result = reconcileExternalInventoryStores(held, fetched);
    expect(result.snapshots.map((e) => e.id)).toEqual([hex('r19')]);
    expect(qty(result)).toBe(6);
  });

  it('a fetched malformed newer snapshot does not shadow the held valid one', () => {
    const held = mergeExternalInventoryEvent(empty(), snapshot('r18', [[STRAWBERRY, 2]], { createdAt: 18 }));
    const fetched = { ...empty(), snapshots: [snapshot('bad', [[STRAWBERRY, 9]], { createdAt: 99, malformed: true })] };
    expect(reconcileExternalInventoryStores(held, fetched)).toBe(held);
  });

  it('pending → folded with quantity 3, then a stale refetch: still 2, never resurrected, never double-subtracted', () => {
    let held = mergeExternalInventoryEvents(empty(), [snapshot('s1', [[STRAWBERRY, 5]], { createdAt: 10 }), spend('x1', { qty: 3 })]);
    expect(qty(held)).toBe(2);
    held = mergeExternalInventoryEvents(held, [fold('m1', { spends: [hex('x1')] }), snapshot('s2', [[STRAWBERRY, 2]], { createdAt: 20, fold: hex('m1') })]);
    expect(qty(held)).toBe(2);
    // A relay that still serves the OLD snapshot and not the fold.
    const stale = mergeExternalInventoryEvents(empty(), [snapshot('s1', [[STRAWBERRY, 5]], { createdAt: 10 }), spend('x1', { qty: 3 })]);
    const result = reconcileExternalInventoryStores(held, stale);
    expect(result).toBe(held);
    expect(qty(result)).toBe(2);
  });

  it('stores of different owners are never merged: the fetched one stands alone', () => {
    const held = mergeExternalInventoryEvents(empty(), [snapshot('s1', [[STRAWBERRY, 4]]), spend('x1')]);
    const theirs = mergeExternalInventoryEvent(emptyExternalInventoryEvents(STRANGER), snapshot('t1', [[STRAWBERRY, 9]], { owner: STRANGER }));
    const result = reconcileExternalInventoryStores(held, theirs);
    expect(result).toBe(theirs);
    expect(result.spends).toEqual([]);
    expect(reconcileExternalInventoryStores(undefined, theirs)).toBe(theirs);
  });
});

describe('the pending → folded transition, live', () => {
  it('quantity 3 spend: raw 5 → effective 2; owner folds: raw 2, chain ∋ spend → effective 2', () => {
    let store = mergeExternalInventoryEvents(empty(), [snapshot('s1', [[STRAWBERRY, 5]], { createdAt: 10 }), spend('x1', { qty: 3 })]);
    expect(qty(store)).toBe(2);
    store = mergeExternalInventoryEvents(store, [
      fold('m1', { spends: [hex('x1')] }),
      snapshot('s2', [[STRAWBERRY, 2]], { createdAt: 20, fold: hex('m1') }),
    ]);
    expect(qty(store)).toBe(2);
  });

  it("this tab's established spends are merged into the derivation, never into the store", () => {
    const store = mergeExternalInventoryEvent(empty(), snapshot('s1', [[STRAWBERRY, 4]]));
    const view = deriveExternalInventoryStates(store, [spend('x1')]);
    expect(effectiveQuantity(view.states.get(FARM_MAIN)?.resolution, STRAWBERRY)).toBe(3);
    expect(store.spends).toHaveLength(0);
  });
});

describe('one REQ for any number of inventories', () => {
  it('with no inventories: discovery only (a `#a: []` filter would match nothing)', () => {
    const filters = externalInventoryLiveFilters(OWNER, []);
    expect(filters).toEqual([{ kinds: [KIND_GAME_INVENTORY], authors: [OWNER] }]);
  });

  it('with N inventories: still three filters, the addresses batched into `#a`', () => {
    const addresses = Array.from({ length: 50 }, (_, i) => `31633:${OWNER}:game${i}:main`);
    const filters = externalInventoryLiveFilters(OWNER, addresses);
    expect(filters).toHaveLength(3);
    expect(filters[0]).toEqual({ kinds: [KIND_GAME_INVENTORY], authors: [OWNER] });
    expect(filters[1]).toEqual({ kinds: [KIND_GAME_INVENTORY_SPEND], authors: [OWNER], '#a': addresses });
    expect(filters[2]).toEqual({ kinds: [KIND_GAME_INVENTORY_FOLD], authors: [OWNER], '#a': addresses });
    // No `since`, no item addresses, no per-inventory filter.
    for (const filter of filters) {
      expect(filter).not.toHaveProperty('since');
      expect(JSON.stringify(filter)).not.toContain('31632:');
    }
  });
});

describe('the authoritative fetch', () => {
  function deps(overrides: Partial<ExternalInventoryFetchDeps> & { calls?: string[] } = {}) {
    const calls: string[] = overrides.calls ?? [];
    const d: ExternalInventoryFetchDeps & { calls: string[] } = {
      calls,
      readSnapshots: async () => {
        calls.push('snapshots');
        return { events: [snapshot('s1', [[STRAWBERRY, 4]])], answered: true };
      },
      readLedger: async (addresses) => {
        calls.push(`ledger:${addresses.length}`);
        return { events: [spend('x1')], answered: true };
      },
      readFoldsById: async (refs) => {
        calls.push(`byId:${refs.length}`);
        return { events: [], answered: true };
      },
      ...overrides,
    };
    return d;
  }

  it('discovers, then reads spends AND folds for every discovered address in one round', async () => {
    const d = deps();
    const result = await fetchExternalInventoryEvents(d, OWNER);
    expect(result.status).toBe('ok');
    expect(d.calls).toEqual(['snapshots', 'ledger:1']);
    if (result.status !== 'ok') return;
    expect(qty(result.store)).toBe(3);
  });

  it('fetches a missing manifest by id and resolves', async () => {
    const d = deps({
      readSnapshots: async () => ({ events: [snapshot('s2', [[STRAWBERRY, 3]], { fold: hex('m1') })], answered: true }),
      readFoldsById: vi.fn(async () => ({ events: [fold('m1', { spends: [hex('x1')] })], answered: true })),
    });
    const result = await fetchExternalInventoryEvents(d, OWNER);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(status(result.store)).toBe('ready');
    expect(qty(result.store)).toBe(3);
    expect(d.readFoldsById).toHaveBeenCalledTimes(1);
  });

  it('stops after a round that finds nothing new and leaves the inventory unresolved', async () => {
    const d = deps({
      readSnapshots: async () => ({ events: [snapshot('s2', [[STRAWBERRY, 3]], { fold: hex('m1') })], answered: true }),
    });
    const result = await fetchExternalInventoryEvents(d, OWNER);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(d.calls.filter((c) => c.startsWith('byId'))).toHaveLength(1);
    expect(status(result.store)).toBe('unresolved');
  });

  it('an unanswered discovery or ledger read is an error, never an empty store', async () => {
    expect((await fetchExternalInventoryEvents(deps({ readSnapshots: async () => ({ events: [], answered: false }) }), OWNER)).status).toBe('error');
    expect((await fetchExternalInventoryEvents(deps({ readLedger: async () => ({ events: [], answered: false }) }), OWNER)).status).toBe('error');
  });

  it('a preflight refreshes ONE inventory against the snapshot the caller holds, without re-discovering', async () => {
    const d = deps();
    const result = await fetchExternalInventoryEvents(d, OWNER, {
      snapshots: [snapshot('s1', [[STRAWBERRY, 4]])],
      onlyAddresses: [FARM_MAIN],
    });
    expect(d.calls).toEqual(['ledger:1']);
    expect(result.status === 'ok' && qty(result.store)).toBe(3);
  });
});
