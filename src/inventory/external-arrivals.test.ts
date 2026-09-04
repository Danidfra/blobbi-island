/**
 * The arrival detector, against REAL derived views: snapshots, spends and
 * folds go through the same store merge and derivation the bag uses, so what
 * is compared here is exactly what the player sees.
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  describeArrivals,
  formatArrival,
  observeExternalInventories,
  type ArrivalBaseline,
  type ResolvedArrival,
} from './external-arrivals';
import {
  deriveExternalInventoryStates,
  emptyExternalInventoryEvents,
  mergeExternalInventoryEvents,
  type ExternalInventoryView,
} from './external-inventory-events';
import { KIND_GAME_INVENTORY, KIND_GAME_INVENTORY_FOLD, KIND_GAME_INVENTORY_SPEND } from './package';

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const FARM_ISSUER = 'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';
const STRAWBERRY = `31632:${FARM_ISSUER}:farm:produce:strawberry`;
const CARROT = `31632:${FARM_ISSUER}:farm:produce:carrot`;
const FARM_MAIN = `31633:${OWNER}:farm:main`;

const hex = (seed: string) =>
  seed.split('').map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64);

function snapshot(
  id: string,
  items: [string, number][],
  options: { createdAt?: number; fold?: string; d?: string; owner?: string } = {},
): NostrEvent {
  const tags: string[][] = [['d', options.d ?? 'farm:main']];
  for (const [address, qty] of items) tags.push(['a', address, '', String(qty)]);
  if (options.fold) tags.push(['e', options.fold, 'wss://relay.primal.net', 'fold']);
  return { id: hex(id), pubkey: options.owner ?? OWNER, created_at: options.createdAt ?? 1000, kind: KIND_GAME_INVENTORY, tags, content: '', sig: '' };
}
function spend(id: string, qty = 1, address = STRAWBERRY): NostrEvent {
  return {
    id: hex(id),
    pubkey: OWNER,
    created_at: 2000,
    kind: KIND_GAME_INVENTORY_SPEND,
    tags: [['a', FARM_MAIN, '', 'inventory'], ['a', address, '', 'item'], ['quantity', String(qty)]],
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

/** A derived view over these events, exactly as the store would hold them. */
function viewOf(...events: NostrEvent[]): ExternalInventoryView {
  return deriveExternalInventoryStates(mergeExternalInventoryEvents(emptyExternalInventoryEvents(OWNER), events));
}

const qtyOf = (view: ExternalInventoryView, address = STRAWBERRY) => {
  const state = view.states.get(FARM_MAIN);
  return state?.status === 'ready' ? state.effective?.items.find((i) => i.address === address)?.quantity ?? 0 : null;
};

/** Observe a sequence of views from nothing; returns each step's arrivals. */
function run(views: ExternalInventoryView[], owner = OWNER) {
  let baseline: ArrivalBaseline | null = null;
  return views.map((view) => {
    const observed = observeExternalInventories(baseline, view, owner);
    baseline = observed.baseline;
    return observed.arrivals.map((a) => `${a.itemAddress.split(':').pop()}:${a.previous}->${a.current}`);
  });
}

describe('hydration', () => {
  it('the first observation records what is there and reports nothing', () => {
    expect(run([viewOf(snapshot('s1', [[STRAWBERRY, 4], [CARROT, 2]]))])).toEqual([[]]);
  });

  it('an empty first observation (no inventories at all) hydrates too: the first Farm snapshot afterwards is an arrival from 0', () => {
    expect(run([viewOf(), viewOf(snapshot('s1', [[STRAWBERRY, 1]]))])).toEqual([[], ['strawberry:0->1']]);
  });

  it('the same state observed again reports nothing: a remount, a duplicate event, a refetch', () => {
    const v = viewOf(snapshot('s1', [[STRAWBERRY, 4]]));
    expect(run([v, v, viewOf(snapshot('s1', [[STRAWBERRY, 4]]))])).toEqual([[], [], []]);
  });

  it('another owner is a fresh hydration, never a diff against the previous player', () => {
    const first = observeExternalInventories(null, viewOf(snapshot('s1', [[STRAWBERRY, 1]])), OWNER);
    const other = observeExternalInventories(first.baseline, viewOf(snapshot('o1', [[STRAWBERRY, 9]], { owner: OTHER })), OTHER);
    expect(other.arrivals).toEqual([]);
    expect(other.baseline.owner).toBe(OTHER);
  });
});

describe('positive deltas on the EFFECTIVE quantity', () => {
  it('0 → 1, 2 → 3, 1 → 4', () => {
    expect(run([
      viewOf(snapshot('s1', [[STRAWBERRY, 0]])),
      viewOf(snapshot('s2', [[STRAWBERRY, 1]], { createdAt: 1001 })),
    ])).toEqual([[], ['strawberry:0->1']]);
    expect(run([
      viewOf(snapshot('s1', [[STRAWBERRY, 2]])),
      viewOf(snapshot('s2', [[STRAWBERRY, 3]], { createdAt: 1001 })),
    ])).toEqual([[], ['strawberry:2->3']]);
    const [, big] = run([
      viewOf(snapshot('s1', [[STRAWBERRY, 1]])),
      viewOf(snapshot('s2', [[STRAWBERRY, 4]], { createdAt: 1001 })),
    ]);
    expect(big).toEqual(['strawberry:1->4']);
  });

  it('carries the item, the inventory and the delta', () => {
    let baseline: ArrivalBaseline | null = null;
    ({ baseline } = observeExternalInventories(baseline, viewOf(snapshot('s1', [[STRAWBERRY, 1]])), OWNER));
    const { arrivals } = observeExternalInventories(baseline, viewOf(snapshot('s2', [[STRAWBERRY, 4]], { createdAt: 1001 })), OWNER);
    expect(arrivals).toEqual([
      { inventoryAddress: FARM_MAIN, inventoryId: 'farm:main', itemAddress: STRAWBERRY, itemRelay: '', previous: 1, current: 4, delta: 3 },
    ]);
  });

  it('a new item in a known inventory arrives from 0; an item that went to 0 and comes back is +1, not a first sighting', () => {
    expect(run([
      viewOf(snapshot('s1', [[STRAWBERRY, 3]])),
      viewOf(snapshot('s2', [[STRAWBERRY, 3], [CARROT, 2]], { createdAt: 1001 })),
      viewOf(snapshot('s3', [[CARROT, 2]], { createdAt: 1002 })),
      viewOf(snapshot('s4', [[STRAWBERRY, 1], [CARROT, 2]], { createdAt: 1003 })),
    ])).toEqual([[], ['carrot:0->2'], [], ['strawberry:0->1']]);
  });

  it('an inventory discovered AFTER hydration has no history: everything in it arrives', () => {
    expect(run([
      viewOf(snapshot('g1', [[STRAWBERRY, 1]], { d: 'guild:chest' })),
      viewOf(snapshot('g1', [[STRAWBERRY, 1]], { d: 'guild:chest' }), snapshot('s1', [[STRAWBERRY, 2]])),
    ])).toEqual([[], ['strawberry:0->2']]);
  });
});

describe('what is NOT an arrival', () => {
  it('a decrease, and an unchanged number', () => {
    expect(run([
      viewOf(snapshot('s1', [[STRAWBERRY, 3]])),
      viewOf(snapshot('s2', [[STRAWBERRY, 2]], { createdAt: 1001 })),
      viewOf(snapshot('s3', [[STRAWBERRY, 2]], { createdAt: 1002 })),
    ])).toEqual([[], [], []]);
  });

  it('a kind:1416 spend lowers the effective number, and the kind:1417 fold that settles it changes nothing', () => {
    const s1 = snapshot('s1', [[STRAWBERRY, 3]]);
    const sp = spend('sp1');
    const f1 = fold('f1', [hex('sp1')]);
    const s2 = snapshot('s2', [[STRAWBERRY, 2]], { createdAt: 3001, fold: hex('f1') });
    const views = [viewOf(s1), viewOf(s1, sp), viewOf(s1, sp, f1), viewOf(s1, sp, f1, s2)];
    expect(views.map((v) => qtyOf(v))).toEqual([3, 2, 2, 2]);
    expect(run(views)).toEqual([[], [], [], []]);
  });

  it('the pending → folded transition observed in the other order (snapshot before its fold) still awards nothing', () => {
    const s1 = snapshot('s1', [[STRAWBERRY, 3]]);
    const sp = spend('sp1');
    const f1 = fold('f1', [hex('sp1')]);
    const s2 = snapshot('s2', [[STRAWBERRY, 2]], { createdAt: 3001, fold: hex('f1') });
    // The new snapshot references a fold not seen yet: unresolved, no number.
    const unresolved = viewOf(s1, sp, s2);
    expect(qtyOf(unresolved)).toBeNull();
    expect(run([viewOf(s1), viewOf(s1, sp), unresolved, viewOf(s1, sp, s2, f1)])).toEqual([[], [], [], []]);
  });

  it('an inventory that cannot be resolved at hydration is absorbed when it resolves; only a LATER rise counts', () => {
    const s2 = snapshot('s2', [[STRAWBERRY, 3]], { createdAt: 3001, fold: hex('f1') });
    const f1 = fold('f1', [hex('sp1')]);
    const s3 = snapshot('s3', [[STRAWBERRY, 4]], { createdAt: 3002, fold: hex('f1') });
    expect(run([viewOf(s2), viewOf(s2, f1), viewOf(s2, f1, s3)])).toEqual([[], [], ['strawberry:3->4']]);
  });

  it('an inventory that goes unresolved after hydration keeps its last numbers, and is compared again when it resolves', () => {
    const s1 = snapshot('s1', [[STRAWBERRY, 3]]);
    const s2 = snapshot('s2', [[STRAWBERRY, 4]], { createdAt: 3001, fold: hex('f1') });
    const f1 = fold('f1', [hex('sp0')]);
    const views = [viewOf(s1), viewOf(s1, s2), viewOf(s1, s2, f1)];
    expect(views.map((v) => qtyOf(v))).toEqual([3, null, 4]);
    expect(run(views)).toEqual([[], [], ['strawberry:3->4']]);
  });

  it('a raw snapshot that grows while pending spends debit it: only the effective rise counts', () => {
    // Raw 3 → 5, but a spend of 1 is pending: effective 3 → 4.
    const s1 = snapshot('s1', [[STRAWBERRY, 3]]);
    const sp = spend('sp1');
    const s2 = snapshot('s2', [[STRAWBERRY, 5]], { createdAt: 1001 });
    expect(run([viewOf(s1), viewOf(s1, sp), viewOf(s1, sp, s2)])).toEqual([[], [], ['strawberry:2->4']]);
  });
});

describe('the notice', () => {
  const strawberry: ResolvedArrival = { itemAddress: STRAWBERRY, name: 'Strawberry', imageUrl: 'https://img/s.webp', emoji: '🍓', sourceName: 'Nostr Farm', delta: 1 };
  const carrot: ResolvedArrival = { itemAddress: CARROT, name: 'Carrot', sourceName: 'Nostr Farm', delta: 2 };

  it('one item: the count, the name, the picture, and the source', () => {
    expect(describeArrivals([strawberry])).toEqual({
      title: '+1 Strawberry',
      description: 'Received from Nostr Farm',
      imageUrl: 'https://img/s.webp',
      emoji: '🍓',
    });
    expect(formatArrival({ name: 'Strawberry', delta: 3 })).toBe('+3 Strawberry');
  });

  it('a few items are named together; many are counted', () => {
    expect(describeArrivals([strawberry, carrot])).toEqual({ title: '+1 Strawberry, +2 Carrot', description: 'Received from Nostr Farm' });
    const four = [strawberry, carrot, { ...carrot, itemAddress: 'c', name: 'Corn' }, { ...carrot, itemAddress: 'd', name: 'Pea' }];
    expect(describeArrivals(four)).toEqual({ title: '4 items received', description: 'Received from Nostr Farm' });
  });

  it('several sources are named together; nothing to say for nothing', () => {
    expect(describeArrivals([strawberry, { ...carrot, sourceName: 'Guild Hall' }])?.description).toBe('Received from Nostr Farm and Guild Hall');
    expect(describeArrivals([])).toBeNull();
  });

  it('never contains protocol vocabulary', () => {
    const text = JSON.stringify(describeArrivals([strawberry, carrot]));
    expect(text).not.toMatch(/31632|31633|1416|1417|farm:main|wss:|f47aaf/);
  });
});
