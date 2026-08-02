/**
 * Economy entry — exactly-once initial allocation, proven against fake relays.
 *
 * The scenarios mirror the reset's product invariants: marker-as-proof
 * (never balance, never ledger, never legacy profile coins), atomic
 * marker+quantity publication, authoritative-read gating (no publish from an
 * unanswered read), safe same-op retries, cross-tab and modeled two-device
 * convergence, and account isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { clearCoinOps, readCoinOp } from '@/lib/coin-op-ledger';

import {
  createEconomyEntry,
  hasIslandAllocationMarker,
  isIslandAllocationMarker,
  INITIAL_ISLAND_COIN_ALLOCATION,
  ISLAND_ALLOCATION_MARKER,
  ISLAND_ALLOCATION_OP_ID,
  ISLAND_ECONOMY_ALLOCATION_ID,
} from './economy-entry';
import { BLOBBI_COIN_ADDRESS, MAX_COIN_BALANCE } from './coin';
import { parseInventoryEvent } from './protocol-adapter';
import { ISLAND_INVENTORY_D, KIND_GAME_INVENTORY } from './package';
import type { CoinWalletNostr } from './coin-wallet';

const PUBKEY = 'f'.repeat(64);
const OTHER_PUBKEY = 'e'.repeat(64);
const APPLE = `31632:${'a'.repeat(64)}:blobbi:food:apple`;

function inventoryEvent(opts: {
  pubkey?: string;
  coin?: number;
  marker?: boolean;
  extraTags?: string[][];
  items?: [string, number][];
  createdAt?: number;
}): NostrEvent {
  const tags: string[][] = [['d', ISLAND_INVENTORY_D]];
  for (const [address, quantity] of opts.items ?? []) {
    tags.push(['a', address, '', String(quantity)]);
  }
  if (opts.coin && opts.coin > 0) {
    tags.push(['a', BLOBBI_COIN_ADDRESS, '', String(opts.coin)]);
  }
  if (opts.marker) tags.push([...ISLAND_ALLOCATION_MARKER]);
  tags.push(...(opts.extraTags ?? []));
  return {
    id: `inv-${opts.createdAt ?? 1000}-${Math.random().toString(16).slice(2)}`,
    pubkey: opts.pubkey ?? PUBKEY,
    created_at: opts.createdAt ?? 1000,
    kind: KIND_GAME_INVENTORY,
    tags,
    content: '',
    sig: 'sig',
  };
}

/**
 * A fake relay with controllable read/publish behavior. Stores one inventory
 * event per pubkey; reads honor the query's `authors` filter and record every
 * filter for never-reads-11125 assertions.
 */
function makeRelay(initialByPubkey: Record<string, NostrEvent | null> = {}) {
  const stored = new Map<string, NostrEvent>(
    Object.entries(initialByPubkey).flatMap(([pk, ev]) => (ev ? [[pk, ev]] : [])),
  );
  const published: NostrEvent[] = [];
  const queries: { kinds: number[]; authors: string[]; '#d': string[] }[] = [];
  let readBehavior: 'ok' | 'reject' | 'stale' = 'ok';
  let publishBehavior: 'ok' | 'timeout' | 'timeout-but-landed' | 'error' = 'ok';
  /** Snapshot served while readBehavior === 'stale'. */
  const staleSnapshot = new Map<string, NostrEvent | null>();

  const nostr: CoinWalletNostr = {
    query: async (filters) => {
      for (const f of filters) queries.push(f);
      if (readBehavior === 'reject') {
        const error = new Error('read timed out');
        error.name = 'TimeoutError';
        throw error;
      }
      const author = filters[0]?.authors?.[0];
      if (!author) return [];
      if (readBehavior === 'stale') {
        const snap = staleSnapshot.get(author);
        return snap ? [snap] : [];
      }
      const event = stored.get(author);
      return event ? [event] : [];
    },
    event: async (event) => {
      if (publishBehavior === 'timeout' || publishBehavior === 'timeout-but-landed') {
        if (publishBehavior === 'timeout-but-landed') {
          published.push(event);
          stored.set(event.pubkey, event);
        }
        const error = new Error('publish timed out');
        error.name = 'TimeoutError';
        throw error;
      }
      if (publishBehavior === 'error') throw new Error('relay exploded');
      published.push(event);
      stored.set(event.pubkey, event);
    },
  };

  return {
    nostr,
    published,
    queries,
    setReadBehavior: (b: typeof readBehavior) => {
      readBehavior = b;
    },
    freezeStaleSnapshot: () => {
      staleSnapshot.clear();
      for (const [pk, ev] of stored) staleSnapshot.set(pk, ev);
    },
    setStaleSnapshotFor: (pk: string, ev: NostrEvent | null) => {
      staleSnapshot.set(pk, ev);
    },
    setPublishBehavior: (b: typeof publishBehavior) => {
      publishBehavior = b;
    },
    getStored: (pk: string) => stored.get(pk) ?? null,
  };
}

function makeSigner(behavior: { fail?: boolean; pubkey?: string } = {}) {
  return {
    signEvent: vi.fn(async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => {
      if (behavior.fail) throw new Error('signer refused');
      return {
        ...t,
        id: `signed-${Math.random().toString(16).slice(2)}`,
        pubkey: behavior.pubkey ?? PUBKEY,
        sig: 'sig',
      };
    }),
  };
}

function makeEntry(
  relay: ReturnType<typeof makeRelay>,
  opts: { pubkey?: string; signer?: ReturnType<typeof makeSigner> } = {},
) {
  const pubkey = opts.pubkey ?? PUBKEY;
  const signer = opts.signer ?? makeSigner({ pubkey });
  return createEconomyEntry({
    nostr: relay.nostr,
    user: { pubkey, signer } as never,
    now: () => 1_700_000_000_000,
  });
}

function coinQuantityOf(event: NostrEvent | null): number {
  const tag = event?.tags.find(([n, a]) => n === 'a' && a === BLOBBI_COIN_ADDRESS);
  return tag ? Number(tag[3]) : 0;
}

function markerCount(event: NostrEvent | null): number {
  return (event?.tags ?? []).filter((t) => isIslandAllocationMarker(t)).length;
}

beforeEach(() => clearCoinOps());
afterEach(() => {
  clearCoinOps();
  vi.restoreAllMocks();
});

// ── Marker helpers ─────────────────────────────────────────────────────────

describe('marker helpers', () => {
  it('recognizes exactly ["allocation", "island-economy:v1"]', () => {
    expect(isIslandAllocationMarker(['allocation', 'island-economy:v1'])).toBe(true);
  });

  it.each([
    [['allocation', 'island-economy:v1', 'extra']],
    [['allocation', 'island-economy:v2']],
    [['Allocation', 'island-economy:v1']],
    [['allocation']],
    [['allocation', 'ISLAND-ECONOMY:V1']],
  ])('does not treat %j as proof', (tag) => {
    expect(isIslandAllocationMarker(tag as string[])).toBe(false);
  });

  it('a malformed allocation tag is not proof, so the grant still applies — and it is preserved', async () => {
    const relay = makeRelay({
      [PUBKEY]: inventoryEvent({ coin: 10, extraTags: [['allocation', 'island-economy:v1', 'oops']] }),
    });
    const result = await makeEntry(relay).checkAndApply();
    expect(result.status).toBe('applied');
    const final = relay.getStored(PUBKEY);
    expect(coinQuantityOf(final)).toBe(210);
    expect(markerCount(final)).toBe(1);
    expect(final?.tags).toContainEqual(['allocation', 'island-economy:v1', 'oops']);
  });

  it('an unrelated allocation marker (another version) is preserved and does not gate v1', async () => {
    const relay = makeRelay({
      [PUBKEY]: inventoryEvent({ extraTags: [['allocation', 'island-economy:v2']] }),
    });
    const result = await makeEntry(relay).checkAndApply();
    expect(result.status).toBe('applied');
    const final = relay.getStored(PUBKEY);
    expect(final?.tags).toContainEqual(['allocation', 'island-economy:v2']);
    expect(markerCount(final)).toBe(1);
  });

  it('duplicated canonical markers on a stored event are normalized to one by the next write', async () => {
    const event = inventoryEvent({ coin: 30, marker: true, extraTags: [[...ISLAND_ALLOCATION_MARKER]] });
    expect(event.tags.filter(isIslandAllocationMarker)).toHaveLength(2);
    const relay = makeRelay({ [PUBKEY]: event });
    // Marker present ⇒ no allocation. An ordinary wallet write normalizes.
    const entryResult = await makeEntry(relay).checkAndApply();
    expect(entryResult.status).toBe('applied');
    expect(relay.published).toHaveLength(0);
    const { createCoinWallet, mintCoinOpId } = await import('./coin-wallet');
    const wallet = createCoinWallet({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: makeSigner() } as never,
    });
    await wallet.grantCoins({ opId: mintCoinOpId('t'), amount: 1, label: 't' });
    expect(markerCount(relay.getStored(PUBKEY))).toBe(1);
  });

  it('the marker survives a zero Coin balance (spend-to-zero keeps proof)', async () => {
    const relay = makeRelay({ [PUBKEY]: inventoryEvent({ coin: 200, marker: true }) });
    const { createCoinWallet, mintCoinOpId } = await import('./coin-wallet');
    const wallet = createCoinWallet({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: makeSigner() } as never,
    });
    await wallet.spendCoins({ opId: mintCoinOpId('t'), amount: 200, label: 't' });
    const final = relay.getStored(PUBKEY);
    expect(coinQuantityOf(final)).toBe(0);
    expect(markerCount(final)).toBe(1);
    expect(hasIslandAllocationMarker(parseInventoryEvent(final!)!)).toBe(true);
  });
});

// ── Eligibility ────────────────────────────────────────────────────────────

describe('eligibility', () => {
  it('a brand-new account (no profile, no Blobbi, no inventory) receives exactly 200', async () => {
    const relay = makeRelay();
    const result = await makeEntry(relay).checkAndApply();
    expect(result).toMatchObject({ status: 'applied', alreadyApplied: false, verified: true });
    expect(relay.published).toHaveLength(1);
    const final = relay.getStored(PUBKEY);
    expect(coinQuantityOf(final)).toBe(INITIAL_ISLAND_COIN_ALLOCATION);
    expect(markerCount(final)).toBe(1);
    // Marker and quantity are in the SAME event.
    expect(final).toBe(relay.published[0]);
    // No profile / adoption / any non-31633 event is ever written.
    expect(relay.published.every((e) => e.kind === KIND_GAME_INVENTORY)).toBe(true);
  });

  it('never queries kind:11125 — the legacy coins value cannot influence anything', async () => {
    const relay = makeRelay();
    await makeEntry(relay).checkAndApply();
    expect(relay.queries.length).toBeGreaterThan(0);
    for (const filter of relay.queries) {
      expect(filter.kinds).toEqual([KIND_GAME_INVENTORY]);
      expect(filter['#d']).toEqual([ISLAND_INVENTORY_D]);
    }
  });

  it('unrelated inventory items are preserved and do not gate the grant', async () => {
    const relay = makeRelay({ [PUBKEY]: inventoryEvent({ items: [[APPLE, 7]] }) });
    const result = await makeEntry(relay).checkAndApply();
    expect(result.status).toBe('applied');
    const final = relay.getStored(PUBKEY);
    expect(coinQuantityOf(final)).toBe(200);
    expect(final?.tags).toContainEqual(['a', APPLE, '', '7']);
  });

  it('Coins already present WITHOUT the marker still receive +200', async () => {
    const relay = makeRelay({ [PUBKEY]: inventoryEvent({ coin: 40 }) });
    const result = await makeEntry(relay).checkAndApply();
    expect(result.status).toBe('applied');
    expect(coinQuantityOf(relay.getStored(PUBKEY))).toBe(240);
    expect(markerCount(relay.getStored(PUBKEY))).toBe(1);
  });

  it('marker present with a positive balance receives nothing (and publishes nothing)', async () => {
    const relay = makeRelay({ [PUBKEY]: inventoryEvent({ coin: 150, marker: true }) });
    const result = await makeEntry(relay).checkAndApply();
    expect(result).toMatchObject({ status: 'applied', alreadyApplied: true });
    expect(relay.published).toHaveLength(0);
  });

  it('marker present with a ZERO balance receives nothing — balance is never proof', async () => {
    const relay = makeRelay({ [PUBKEY]: inventoryEvent({ coin: 0, marker: true }) });
    const result = await makeEntry(relay).checkAndApply();
    expect(result).toMatchObject({ status: 'applied', alreadyApplied: true });
    expect(relay.published).toHaveLength(0);
  });

  it('marker absent with a zero balance receives 200', async () => {
    const relay = makeRelay({ [PUBKEY]: inventoryEvent({ coin: 0, items: [[APPLE, 1]] }) });
    const result = await makeEntry(relay).checkAndApply();
    expect(result.status).toBe('applied');
    expect(coinQuantityOf(relay.getStored(PUBKEY))).toBe(200);
  });

  it('the allocation write is lossless: content, contexts, grant refs and unknown tags survive', async () => {
    const rich: NostrEvent = {
      id: 'rich',
      pubkey: PUBKEY,
      created_at: 1000,
      kind: KIND_GAME_INVENTORY,
      tags: [
        ['d', ISLAND_INVENTORY_D],
        ['context', 'game:blobbi-island'],
        ['a', APPLE, '', '7'],
        ['e', 'c'.repeat(64), '', 'grant'],
        ['mystery', 'value'],
      ],
      content: '{"sort":"category"}',
      sig: 'sig',
    };
    const relay = makeRelay({ [PUBKEY]: rich });
    const result = await makeEntry(relay).checkAndApply();
    expect(result.status).toBe('applied');
    const final = relay.getStored(PUBKEY);
    expect(final?.content).toBe('{"sort":"category"}');
    expect(final?.tags).toContainEqual(['context', 'game:blobbi-island']);
    expect(final?.tags).toContainEqual(['e', 'c'.repeat(64), '', 'grant']);
    expect(final?.tags).toContainEqual(['mystery', 'value']);
    expect(final?.tags).toContainEqual(['a', APPLE, '', '7']);
    expect(coinQuantityOf(final)).toBe(200);
    expect(markerCount(final)).toBe(1);
  });

  it('the local ledger never determines eligibility: applied record + authoritative marker absence re-grants', async () => {
    const relay = makeRelay();
    await makeEntry(relay).checkAndApply();
    expect(readCoinOp(PUBKEY, ISLAND_ALLOCATION_OP_ID)?.status).toBe('applied');
    // The relay loses the event entirely: every read now authoritatively
    // (EOSE) answers "no event" while publishes still land.
    expect(relay.getStored(PUBKEY)).not.toBeNull();
    relay.setStaleSnapshotFor(PUBKEY, null);
    relay.setReadBehavior('stale');
    const second = await makeEntry(relay).checkAndApply();
    expect(second.status).toBe('applied');
    // The marker superseded the local `applied` record and the allocation was
    // re-established as the relay's current state.
    expect(relay.published).toHaveLength(2);
  });
});

// ── Failure, ambiguity and recovery ────────────────────────────────────────

describe('failure and recovery', () => {
  it('a failed authoritative read publishes nothing and is retryable', async () => {
    const relay = makeRelay();
    relay.setReadBehavior('reject');
    const result = await makeEntry(relay).checkAndApply();
    expect(result.status).toBe('check-failed');
    expect(relay.published).toHaveLength(0);
    expect(readCoinOp(PUBKEY, ISLAND_ALLOCATION_OP_ID)).toBeNull();
  });

  it('the balance ceiling rejects explicitly — no clamp, no partial marker-only event', async () => {
    const relay = makeRelay({ [PUBKEY]: inventoryEvent({ coin: MAX_COIN_BALANCE - 100 }) });
    const result = await makeEntry(relay).checkAndApply();
    expect(result).toMatchObject({ status: 'failed', reason: 'balance-cap', terminal: true });
    expect(relay.published).toHaveLength(0);
    expect(markerCount(relay.getStored(PUBKEY))).toBe(0);
  });

  it('a pre-publish sign failure is provably unsent and the SAME operation retries safely', async () => {
    const relay = makeRelay();
    const failing = makeSigner({ fail: true });
    const first = await makeEntry(relay, { signer: failing }).checkAndApply();
    expect(first).toMatchObject({ status: 'failed', reason: 'sign-failed' });
    expect(relay.published).toHaveLength(0);
    expect(readCoinOp(PUBKEY, ISLAND_ALLOCATION_OP_ID)?.status).toBe('failed');

    const second = await makeEntry(relay).checkAndApply();
    expect(second).toMatchObject({ status: 'applied', alreadyApplied: false });
    expect(readCoinOp(PUBKEY, ISLAND_ALLOCATION_OP_ID)?.status).toBe('applied');
    expect(coinQuantityOf(relay.getStored(PUBKEY))).toBe(200);
  });

  it('a publish timeout becomes ambiguous — recorded, surfaced, never auto-retried in the same run', async () => {
    const relay = makeRelay();
    relay.setPublishBehavior('timeout');
    const result = await makeEntry(relay).checkAndApply();
    expect(result.status).toBe('ambiguous');
    expect(readCoinOp(PUBKEY, ISLAND_ALLOCATION_OP_ID)?.status).toBe('ambiguous');
  });

  it('ambiguous, then the marker turns out PRESENT: reconciled to applied without republishing', async () => {
    const relay = makeRelay();
    relay.setPublishBehavior('timeout-but-landed'); // it actually landed
    const first = await makeEntry(relay).checkAndApply();
    expect(first.status).toBe('ambiguous');

    relay.setPublishBehavior('ok');
    const second = await makeEntry(relay).checkAndApply();
    expect(second).toMatchObject({ status: 'applied', alreadyApplied: true });
    // No second grant: exactly one publish ever, balance stays 200.
    expect(relay.published).toHaveLength(1);
    expect(coinQuantityOf(relay.getStored(PUBKEY))).toBe(200);
    expect(readCoinOp(PUBKEY, ISLAND_ALLOCATION_OP_ID)?.status).toBe('applied');
    expect(readCoinOp(PUBKEY, ISLAND_ALLOCATION_OP_ID)?.note).toBe('reconciled-by-marker');
  });

  it('ambiguous, then the marker is authoritatively ABSENT: the same operation retries and lands once', async () => {
    const relay = makeRelay();
    relay.setPublishBehavior('timeout'); // provably did NOT land (test-side knowledge)
    const first = await makeEntry(relay).checkAndApply();
    expect(first.status).toBe('ambiguous');

    relay.setPublishBehavior('ok');
    const second = await makeEntry(relay).checkAndApply();
    expect(second).toMatchObject({ status: 'applied', alreadyApplied: false });
    expect(relay.published).toHaveLength(1);
    expect(coinQuantityOf(relay.getStored(PUBKEY))).toBe(200);
  });

  it('while the marker cannot be re-read, an ambiguous operation STAYS ambiguous (no blind publish)', async () => {
    const relay = makeRelay();
    relay.setPublishBehavior('timeout');
    await makeEntry(relay).checkAndApply();

    // First read succeeds (marker absent), the confirming read fails.
    let call = 0;
    const flaky: CoinWalletNostr = {
      query: async (filters) => {
        call += 1;
        if (call > 1) {
          const error = new Error('read timed out');
          error.name = 'TimeoutError';
          throw error;
        }
        return relay.nostr.query(filters, { signal: AbortSignal.timeout(1000) });
      },
      event: relay.nostr.event,
    };
    const entry = createEconomyEntry({
      nostr: flaky,
      user: { pubkey: PUBKEY, signer: makeSigner() } as never,
    });
    const result = await entry.checkAndApply();
    expect(result.status).toBe('ambiguous');
    expect(relay.published).toHaveLength(0);
  });
});

// ── Durability across storage loss and devices ─────────────────────────────

describe('cross-storage durability', () => {
  it('a refresh with an EMPTY local ledger relies on the marker: no duplicate grant', async () => {
    const relay = makeRelay();
    await makeEntry(relay).checkAndApply();
    clearCoinOps(); // refresh / cleared storage / second browser profile
    const second = await makeEntry(relay).checkAndApply();
    expect(second).toMatchObject({ status: 'applied', alreadyApplied: true });
    expect(relay.published).toHaveLength(1);
    expect(coinQuantityOf(relay.getStored(PUBKEY))).toBe(200);
  });

  it('two tabs converge to one grant (serialized; the loser skips on the in-lock marker check)', async () => {
    const relay = makeRelay();
    const [a, b] = await Promise.all([
      makeEntry(relay).checkAndApply(),
      makeEntry(relay).checkAndApply(),
    ]);
    const statuses = [a.status, b.status];
    expect(statuses.every((s) => s === 'applied')).toBe(true);
    expect(relay.published).toHaveLength(1);
    expect(coinQuantityOf(relay.getStored(PUBKEY))).toBe(200);
    expect(markerCount(relay.getStored(PUBKEY))).toBe(1);
  });

  it('the modeled two-device race converges to 200, never a stable 400', async () => {
    const relay = makeRelay();

    // Device A: grants normally. (Reads/writes fresh.)
    await makeEntry(relay).checkAndApply();
    expect(coinQuantityOf(relay.getStored(PUBKEY))).toBe(200);

    // Device B: separate localStorage (empty ledger) and a STALE view — it
    // raced device A, so its reads still show the pre-grant state.
    clearCoinOps();
    relay.freezeStaleSnapshot();
    relay.setStaleSnapshotFor(PUBKEY, null); // B never saw A's event
    relay.setReadBehavior('stale');
    const b = await makeEntry(relay).checkAndApply();
    expect(b.status).toBe('applied');
    relay.setReadBehavior('ok');

    // Convergence: the newest replacement event carries ONE marker and ONE
    // +200 — B built `empty base + 200 + marker`, not `A's 200 + 200`.
    const final = relay.getStored(PUBKEY);
    expect(coinQuantityOf(final)).toBe(200);
    expect(markerCount(final)).toBe(1);
    // Both devices published, but the outcome is one allocation, not two.
    expect(relay.published).toHaveLength(2);
  });

  it('account switching isolates state: each pubkey gets its own single allocation', async () => {
    const relay = makeRelay();
    await makeEntry(relay, { pubkey: PUBKEY }).checkAndApply();
    await makeEntry(relay, { pubkey: OTHER_PUBKEY }).checkAndApply();

    expect(coinQuantityOf(relay.getStored(PUBKEY))).toBe(200);
    expect(coinQuantityOf(relay.getStored(OTHER_PUBKEY))).toBe(200);
    expect(readCoinOp(PUBKEY, ISLAND_ALLOCATION_OP_ID)?.status).toBe('applied');
    expect(readCoinOp(OTHER_PUBKEY, ISLAND_ALLOCATION_OP_ID)?.status).toBe('applied');

    // Re-running either is a no-op.
    const again = await makeEntry(relay, { pubkey: PUBKEY }).checkAndApply();
    expect(again).toMatchObject({ status: 'applied', alreadyApplied: true });
    expect(relay.published).toHaveLength(2);
  });
});

// ── Operation identity ─────────────────────────────────────────────────────

describe('operation identity', () => {
  it('uses ONE stable op id embedding the economy version — never random', async () => {
    expect(ISLAND_ALLOCATION_OP_ID).toBe(`initial-allocation:${ISLAND_ECONOMY_ALLOCATION_ID}`);
    const relay = makeRelay();
    await makeEntry(relay).checkAndApply();
    expect(readCoinOp(PUBKEY, ISLAND_ALLOCATION_OP_ID)).not.toBeNull();
  });
});
