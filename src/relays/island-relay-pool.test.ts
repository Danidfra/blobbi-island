/**
 * The Island on several relays, with the Blobbi relay as primary.
 *
 * Every relay here is a fake that behaves like a relay: it stores what it
 * accepts (one revision per replaceable address), answers a REQ with its
 * stored matches and EOSE, can be down (never answers), and can refuse writes
 * with a NIP-01 message. Events are synthetic. Nothing leaves the process.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NostrEvent, NostrFilter, NRelay } from '@nostrify/nostrify';

import { readRelay, readRelayConfirmed } from '@/lib/relay-read';
import { clearCoinOps } from '@/lib/coin-op-ledger';
import { createEconomyEntry, ISLAND_ALLOCATION_MARKER } from '@/inventory/economy-entry';
import { BLOBBI_COIN_ADDRESS } from '@/inventory/coin';
import { ISLAND_INVENTORY_D, KIND_GAME_INVENTORY } from '@/inventory/package';
import type { CoinWalletDeps } from '@/inventory/coin-wallet';

import { IslandRelayPool, type KeyValueStore } from './island-relay-pool';
import { DEFAULT_RELAY_CONFIG, migrateRelayConfig, relaySelection, withPrimary } from './relay-config';
import { BLOBBI_RELAY_URL, eventAddress, matchesFilter, replacesEvent } from './relay-routing';
import { RelayStatusStore, describeRelayStatus } from './relay-status';

const BLOBBI = BLOBBI_RELAY_URL;
const DITTO = 'wss://relay.ditto.pub';
const PRIMAL = 'wss://relay.primal.net';
const ME = 'f'.repeat(64);
const STRANGER = 'e'.repeat(64);
const PILOT_REFUSAL = 'blocked: this relay is in pilot mode; author is not on the write list';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeRelay implements NRelay {
  stored: NostrEvent[] = [];
  /** Every event offered, accepted or not. */
  offered: NostrEvent[] = [];
  reqs: NostrFilter[][] = [];
  /** `down`: no answer to anything. */
  down = false;
  /** Refuse every write with this message. */
  refuse: string | null = null;

  seed(...events: NostrEvent[]): this {
    for (const event of events) this.put(event);
    return this;
  }

  private put(event: NostrEvent): 'stored' | 'duplicate' | 'replaced' {
    if (this.stored.some((e) => e.id === event.id)) return 'duplicate';
    const address = eventAddress(event);
    if (address) {
      const held = this.stored.find((e) => eventAddress(e) === address);
      if (held && !replacesEvent(event, held)) return 'replaced';
      if (held) this.stored = this.stored.filter((e) => e !== held);
    }
    this.stored.push(event);
    return 'stored';
  }

  async *req(filters: NostrFilter[], opts?: { signal?: AbortSignal }) {
    this.reqs.push(filters);
    const signal = opts?.signal;
    const untilAbort = () =>
      new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    if (this.down) {
      await untilAbort();
      throw new DOMException('aborted', 'AbortError');
    }
    await wait(1);
    const sent = new Set<string>();
    for (const filter of filters) {
      const matches = this.stored
        .filter((e) => matchesFilter(e, filter))
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, filter.limit ?? 500);
      for (const event of matches) {
        if (sent.has(event.id)) continue;
        sent.add(event.id);
        yield ['EVENT', 'sub', event] as ['EVENT', string, NostrEvent];
      }
    }
    yield ['EOSE', 'sub'] as ['EOSE', string];
    await untilAbort();
  }

  async event(event: NostrEvent, opts?: { signal?: AbortSignal }): Promise<void> {
    this.offered.push(event);
    if (this.down) {
      await new Promise<void>((_, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')), { once: true });
      });
    }
    await wait(1);
    if (this.refuse) throw new Error(this.refuse);
    const outcome = this.put(event);
    if (outcome === 'replaced') throw new Error('replaced: have newer event');
  }

  async query(filters: NostrFilter[]): Promise<NostrEvent[]> {
    return this.stored.filter((e) => filters.some((f) => matchesFilter(e, f)));
  }

  async close(): Promise<void> {}
}

let counter = 0;
function ev(kind: number, o: { at?: number; tags?: string[][]; pubkey?: string } = {}): NostrEvent {
  counter += 1;
  return {
    id: counter.toString(16).padStart(64, '0'),
    pubkey: o.pubkey ?? ME,
    created_at: o.at ?? 1000,
    kind,
    tags: o.tags ?? [],
    content: '',
    sig: `sig-${counter}`,
  };
}
const pet = (d: string, at: number, pubkey = ME) => ev(31124, { at, pubkey, tags: [['d', d], ['b', 'blobbi:ecosystem:v1']] });
const care = (at: number) => ev(1124, { at, tags: [['a', `31124:${ME}:blobbi-x`], ['p', ME], ['action', 'feed'], ['source', 'blobbi-island']] });
function inventory(o: { at: number; coin?: number; marker?: boolean }): NostrEvent {
  const tags: string[][] = [['d', ISLAND_INVENTORY_D]];
  if (o.coin) tags.push(['a', BLOBBI_COIN_ADDRESS, '', String(o.coin)]);
  if (o.marker) tags.push([...ISLAND_ALLOCATION_MARKER]);
  return ev(KIND_GAME_INVENTORY, { at: o.at, tags });
}

const PETS: NostrFilter[] = [{ kinds: [31124], authors: [ME], limit: 25 }];
const INVENTORY: NostrFilter[] = [{ kinds: [KIND_GAME_INVENTORY], authors: [ME], '#d': [ISLAND_INVENTORY_D], limit: 1 }];

function memoryStorage(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

interface World {
  pool: IslandRelayPool;
  relays: Record<string, FakeRelay>;
  blobbi: FakeRelay;
  ditto: FakeRelay;
  primal: FakeRelay;
  status: RelayStatusStore;
  storage: ReturnType<typeof memoryStorage>;
}

let worlds: World[] = [];

/** A fresh installation: the default selection, nothing chosen by hand. Carrying existing events is off unless `carry`. */
function world(o: { storage?: ReturnType<typeof memoryStorage>; pubkey?: string | null; carry?: boolean } = {}): World {
  const relays: Record<string, FakeRelay> = { [BLOBBI]: new FakeRelay(), [DITTO]: new FakeRelay(), [PRIMAL]: new FakeRelay() };
  const status = new RelayStatusStore();
  const storage = o.storage ?? memoryStorage();
  const pool = new IslandRelayPool({
    getConfig: () => relaySelection(DEFAULT_RELAY_CONFIG),
    getPubkey: () => (o.pubkey === undefined ? ME : o.pubkey),
    open: (url) => (relays[url] ??= new FakeRelay()),
    status,
    storage,
    settleMs: 40,
    relayTimeoutMs: 120,
    liveGraceMs: 20,
    lingerMs: 60,
    deliveryTimeoutMs: 80,
    retryBackoffMs: [50],
  });
  // `carry`: the account has made the choice the Network panel offers, for the default relays.
  if (o.carry) pool.consent.enable(ME, [BLOBBI, DITTO, PRIMAL]);
  const w = { pool, relays, blobbi: relays[BLOBBI], ditto: relays[DITTO], primal: relays[PRIMAL], status, storage };
  worlds.push(w);
  return w;
}

beforeEach(() => {
  localStorage.clear();
  clearCoinOps(ME);
});

afterEach(async () => {
  for (const w of worlds) await w.pool.close();
  worlds = [];
});

const ids = (events: readonly NostrEvent[]) => events.map((e) => e.id);

describe('a new installation', () => {
  it('uses the Blobbi relay as primary with no setup, and keeps the earlier relays as secondaries', () => {
    expect(DEFAULT_RELAY_CONFIG.relayUrl).toBe('wss://relay.blobbi.pet');
    expect(relaySelection(DEFAULT_RELAY_CONFIG)).toEqual({ primary: BLOBBI, secondaries: [DITTO, PRIMAL] });
  });

  it('asks every relay of the selection for the player state', async () => {
    const w = world();
    await w.pool.query(PETS);
    expect(w.blobbi.reqs).toHaveLength(1);
    expect(w.ditto.reqs).toHaveLength(1);
    expect(w.primal.reqs).toHaveLength(1);
  });
});

describe('an installation that already had a relay', () => {
  it('moves to the Blobbi relay as primary and keeps the old relay, first among the secondaries', () => {
    const old = { theme: 'x', relayUrl: 'wss://relay.example.com' };
    const migrated = migrateRelayConfig(old);
    expect(relaySelection(migrated)).toEqual({ primary: BLOBBI, secondaries: ['wss://relay.example.com', DITTO, PRIMAL] });
    expect(migrated.theme).toBe('x');
    // The old default is not listed twice.
    expect(relaySelection(migrateRelayConfig({ relayUrl: DITTO })).secondaries).toEqual([DITTO, PRIMAL]);
  });

  it('is migrated once: a later choice of primary is the player\'s and stands', () => {
    const chosen = withPrimary(migrateRelayConfig({ relayUrl: DITTO }), PRIMAL);
    expect(relaySelection(migrateRelayConfig(chosen))).toEqual({ primary: PRIMAL, secondaries: [BLOBBI, DITTO] });
  });
});

describe('reading, once the account chose to have its existing saves copied', () => {
  it('an event only a secondary has is returned, and the original is carried to the primary and the other secondary', async () => {
    const w = world({ carry: true });
    const mine = pet('blobbi-x', 1000);
    w.ditto.seed(mine);

    expect(ids(await w.pool.query(PETS))).toEqual([mine.id]);
    await wait(30);

    // Same id, same signature: the very event, not a re-signed copy.
    expect(w.blobbi.stored).toEqual([mine]);
    expect(w.primal.stored).toEqual([mine]);
    expect(w.ditto.offered).toEqual([]);
    expect(w.status.get(BLOBBI)?.synced).toBe(1);
  });

  it('an event only the Blobbi relay has is returned, and carried to the secondaries', async () => {
    const w = world({ carry: true });
    const mine = pet('blobbi-x', 1000);
    w.blobbi.seed(mine);

    expect(ids(await w.pool.query(PETS))).toEqual([mine.id]);
    await wait(30);

    expect(w.ditto.stored).toEqual([mine]);
    expect(w.primal.stored).toEqual([mine]);
    expect(w.blobbi.offered).toEqual([]);
  });

  it('different revisions on different relays: the newest wins (also from a secondary), and only it is carried', async () => {
    const w = world({ carry: true });
    const old = pet('blobbi-x', 1000);
    const fresh = pet('blobbi-x', 2000);
    w.blobbi.seed(old);
    w.ditto.seed(fresh);
    w.primal.seed(old);

    expect(ids(await w.pool.query(PETS))).toEqual([fresh.id]);
    await wait(30);

    expect(w.blobbi.stored).toEqual([fresh]);
    expect(w.primal.stored).toEqual([fresh]);
    expect(ids([...w.blobbi.offered, ...w.primal.offered, ...w.ditto.offered])).toEqual([fresh.id, fresh.id]);
  });

  it('the same event from three relays is one event; distinct history is all kept', async () => {
    const w = world({ carry: true });
    const state = pet('blobbi-x', 1000);
    const [a, b, c] = [care(1001), care(1002), care(1003)];
    w.blobbi.seed(state, a, b);
    w.ditto.seed(state, b, c);
    w.primal.seed(state, a, c);

    const got = await w.pool.query([{ kinds: [31124, 1124], authors: [ME] }]);
    expect(ids(got).sort()).toEqual(ids([state, a, b, c]).sort());
    expect(new Set(ids(got)).size).toBe(4);
  });

  it('carries each missing event once: reading again does not offer it again', async () => {
    const w = world({ carry: true });
    w.ditto.seed(pet('blobbi-x', 1000));
    await w.pool.query(PETS);
    await wait(30);
    const offeredOnce = w.blobbi.offered.length;
    await w.pool.query(PETS);
    await w.pool.query(PETS);
    await wait(30);
    expect(offeredOnce).toBe(1);
    expect(w.blobbi.offered).toHaveLength(1);
  });

  it('does not carry another player\'s events, expiring presence, or anything when signed out', async () => {
    const w = world({ carry: true });
    const theirs = pet('blobbi-y', 1000, STRANGER);
    const presence = ev(31950, { tags: [['d', 'session:abcdefgh'], ['expiration', '9999999999'], ['t', 'blobbi:presence']] });
    w.ditto.seed(theirs, presence);
    await w.pool.query([{ kinds: [31124], authors: [STRANGER] }]);
    await w.pool.query([{ kinds: [31950], authors: [ME] }]);
    await wait(30);
    expect(w.blobbi.offered).toEqual([]);
    expect(w.primal.offered).toEqual([]);

    const signedOut = world({ pubkey: null, carry: true });
    signedOut.ditto.seed(pet('blobbi-x', 1000));
    await signedOut.pool.query(PETS);
    await wait(30);
    expect(signedOut.blobbi.offered).toEqual([]);
  });

  it('a filled limit leaves presence undetermined: nothing is carried', async () => {
    const w = world({ carry: true });
    w.blobbi.seed(care(2001), care(2002));
    w.ditto.seed(care(1001), care(1002));
    w.primal.seed(care(1001));
    await w.pool.query([{ kinds: [1124], authors: [ME], limit: 2 }]);
    await wait(30);
    // Blobbi and Ditto each filled the limit: either may hold what the other returned.
    expect(w.blobbi.offered).toEqual([]);
    expect(w.ditto.offered).toEqual([]);
    // Primal returned one of two allowed: it certainly lacks the rest.
    expect(w.primal.offered.length).toBeGreaterThan(0);
  });
});

describe('a restored session only reads', () => {
  /** An account with history, spread unevenly over the relays, as a real one is. */
  function restored(o: { carry?: boolean; storage?: ReturnType<typeof memoryStorage> } = {}) {
    const w = world(o);
    const state = pet('blobbi-x', 2000);
    const stale = pet('blobbi-x', 1000);
    const profile = ev(11125, { at: 1500, tags: [['d', `blobbonaut-${ME.slice(0, 12)}`], ['b', 'blobbi:ecosystem:v1']] });
    const stock = inventory({ at: 1800, coin: 735, marker: true });
    const history = [care(1900), care(1950)];
    w.ditto.seed(state, profile, stock, ...history);
    w.primal.seed(stale);
    return { w, state, profile, stock, history };
  }
  const offers = (w: World) => [...w.blobbi.offered, ...w.ditto.offered, ...w.primal.offered];
  /** What the app reads when a saved login comes back: Blobbis, profile, inventory, care history. */
  async function load(w: World) {
    const pets = await readRelayConfirmed(w.pool, PETS, { timeoutMs: 1000 });
    const profile = await readRelayConfirmed(w.pool, [{ kinds: [11125, 31125], authors: [ME], limit: 1 }], { timeoutMs: 1000 });
    const stock = await readRelayConfirmed(w.pool, INVENTORY, { timeoutMs: 1000 });
    const history = await w.pool.query([{ kinds: [1124], authors: [ME], limit: 500 }]);
    await wait(120);
    return { pets, profile, stock, history };
  }

  it('recovers and merges the state from every relay and sends no EVENT to any of them', async () => {
    const { w, state, profile, stock, history } = restored();

    const got = await load(w);
    // Loading twice, as a refetch would, changes nothing.
    await load(w);

    expect(got.pets.status === 'answered' && ids(got.pets.events)).toEqual([state.id]);
    expect(got.profile.status === 'answered' && ids(got.profile.events)).toEqual([profile.id]);
    expect(got.stock.status === 'answered' && ids(got.stock.events)).toEqual([stock.id]);
    expect(ids(got.history).sort()).toEqual(ids(history).sort());

    expect(offers(w)).toEqual([]);
    expect(w.blobbi.stored).toEqual([]);
    // The relay holding the older revision is not corrected behind the player's back either.
    expect(w.primal.stored.map((e) => e.created_at)).toEqual([1000]);
    expect(w.status.getSnapshot()).toEqual({});
  });

  it('nothing owed from an earlier session is sent on load either', async () => {
    const storage = memoryStorage();
    const first = world({ storage });
    first.blobbi.down = true;
    const mine = pet('blobbi-x', 1000);
    await first.pool.event(mine);
    await first.pool.close();

    // The page is opened again: the primary is back and lacks the event, and the ledger remembers a retry.
    const next = world({ storage });
    next.ditto.seed(mine);
    next.primal.seed(mine);
    await load(next);
    expect(offers(next)).toEqual([]);
  });

  it('an economy check on a restored account with an inventory signs and sends nothing', async () => {
    const { w } = restored();
    const signed: NostrEvent[] = [];
    const entry = createEconomyEntry({
      nostr: w.pool,
      user: { pubkey: ME, signer: { signEvent: async (t: unknown) => (signed.push(t as NostrEvent), t) } },
    } as unknown as CoinWalletDeps);
    expect(await entry.checkAndApply()).toMatchObject({ status: 'applied', alreadyApplied: true });
    await wait(60);
    expect(signed).toEqual([]);
    expect(offers(w)).toEqual([]);
  });

  it('once the account turns copying on, only its eligible saves go out, only to the chosen relays that lack them', async () => {
    const { w, state, profile, stock, history } = restored();
    const strangers = pet('blobbi-y', 3000, STRANGER);
    const presence = ev(31950, { at: 2000, tags: [['d', 'session:abcdefgh'], ['expiration', '9999999999'], ['t', 'blobbi:presence']] });
    const legacy = ev(31125, { at: 900, tags: [['d', 'old'], ['b', 'blobbi:ecosystem:v1']] });
    w.ditto.seed(strangers, presence, legacy);
    await load(w);
    expect(offers(w)).toEqual([]);

    // The choice, as the Network panel records it: this account, these two relays.
    w.pool.consent.enable(ME, [BLOBBI, PRIMAL]);
    await load(w);
    await w.pool.query([{ kinds: [31124], authors: [STRANGER] }]);
    await w.pool.query([{ kinds: [31950], authors: [ME] }]);
    await wait(200);

    const eligible = ids([state, profile, stock, ...history]).sort();
    // The primary lacked everything; Primal held an old revision of the Blobbi and nothing else.
    expect(ids(w.blobbi.offered).sort()).toEqual(eligible);
    expect(ids(w.primal.offered).sort()).toEqual(eligible);
    // Ditto already had them all: nothing is sent where nothing is missing.
    expect(w.ditto.offered).toEqual([]);
    // Same events, same signatures; the stale revision was replaced by the winner, never re-sent.
    expect(w.blobbi.stored.map((e) => e.sig).sort()).toEqual([state, profile, stock, ...history].map((e) => e.sig).sort());
    expect(w.primal.stored.find((e) => e.kind === 31124)).toEqual(state);
    // Each pair once.
    await load(w);
    expect(w.blobbi.offered).toHaveLength(eligible.length);
  });

  it('the choice covers the relays that were shown: a relay left out receives nothing', async () => {
    const { w } = restored();
    w.pool.consent.enable(ME, [BLOBBI]);
    await load(w);
    expect(w.blobbi.offered.length).toBeGreaterThan(0);
    expect(w.primal.offered).toEqual([]);
    expect(w.ditto.offered).toEqual([]);
  });

  it('the choice is the account\'s: another login in the same browser stays read-only, and turning it off stops it', async () => {
    const { w } = restored();
    w.pool.consent.enable(STRANGER, [BLOBBI, DITTO, PRIMAL]);
    await load(w);
    expect(offers(w)).toEqual([]);

    w.pool.consent.enable(ME, [BLOBBI, DITTO, PRIMAL]);
    w.pool.consent.disable(ME);
    await load(w);
    expect(offers(w)).toEqual([]);
  });

  it('with copying off, what the player does is still published to the primary and the secondaries', async () => {
    const { w } = restored();
    await load(w);
    const adopted = pet('blobbi-new', 5000);
    const cared = care(5001);
    await w.pool.event(adopted);
    await w.pool.event(cared);
    await wait(30);
    for (const relay of [w.blobbi, w.ditto, w.primal]) expect(ids(relay.offered)).toEqual([adopted.id, cared.id]);
  });
});

describe('the primary relay is temporarily down', () => {
  it('a read still answers from the secondaries', async () => {
    const w = world();
    const mine = pet('blobbi-x', 1000);
    w.blobbi.down = true;
    w.ditto.seed(mine);
    w.primal.seed(mine);

    const outcome = await readRelay(w.pool, PETS, { timeoutMs: 1000 });
    expect(outcome).toMatchObject({ status: 'answered' });
    expect(outcome.status === 'answered' && ids(outcome.events)).toEqual([mine.id]);
    // Nothing is offered to a relay that did not answer.
    await wait(30);
    expect(w.blobbi.offered).toEqual([]);
  });

  it('an EMPTY answer from the secondaries is unknown, not "this account has nothing"', async () => {
    const w = world();
    w.blobbi.down = true;
    const outcome = await readRelayConfirmed(w.pool, PETS, { timeoutMs: 400 });
    expect(outcome.status).toBe('unknown');
  });

  it('a publish is accepted by the secondaries, the primary is marked pending, and it catches up when it is back', async () => {
    const w = world();
    w.blobbi.down = true;
    const mine = pet('blobbi-x', 1000);

    // Resolves on the first relay that accepts; it does not wait out the dead primary.
    await w.pool.event(mine, { signal: AbortSignal.timeout(2000) });

    await wait(120);
    expect(w.ditto.stored).toEqual([mine]);
    expect(w.primal.stored).toEqual([mine]);
    expect(w.status.get(BLOBBI)?.pending).toBe(1);
    expect(describeRelayStatus(w.status.get(BLOBBI))?.text).toMatch(/will sync later/);

    w.blobbi.down = false;
    await wait(220);
    expect(w.blobbi.stored).toEqual([mine]);
    expect(w.status.get(BLOBBI)?.pending).toBe(0);
    expect(describeRelayStatus(w.status.get(BLOBBI))?.tone).toBe('ok');
  });

  it('gives up on a relay that stays silent instead of sending for ever', async () => {
    const w = world();
    w.blobbi.down = true;
    await w.pool.event(pet('blobbi-x', 1000));
    await wait(900);
    // One attempt with the publish, then the ledger's limit of three in all.
    expect(w.blobbi.offered).toHaveLength(3);
  });

  it('a newer revision this device saw accepted is not replaced by an older one from the relay that is still up', async () => {
    const storage = memoryStorage();
    const first = world({ storage });
    const old = pet('blobbi-x', 1000);
    const fresh = pet('blobbi-x', 2000);
    first.ditto.seed(old);
    first.primal.seed(old);
    first.ditto.refuse = 'error: database is busy';
    first.primal.refuse = 'error: database is busy';
    // Only the primary takes the new revision.
    await first.pool.event(fresh);
    expect(first.blobbi.stored).toEqual([fresh]);

    // Next session: the primary is down; the secondaries still hold the old revision.
    const next = world({ storage });
    next.ditto.seed(old);
    next.primal.seed(old);
    next.blobbi.down = true;
    const outcome = await readRelay(next.pool, [{ kinds: [31124], authors: [ME], '#d': ['blobbi-x'] }], { timeoutMs: 400 });
    expect(outcome.status).toBe('unknown');
  });
});

describe('the primary relay refuses the account (write list)', () => {
  it('the publish succeeds on the secondaries, the refusal is recorded, and it is not retried', async () => {
    const w = world();
    w.blobbi.refuse = PILOT_REFUSAL;
    const mine = pet('blobbi-x', 1000);

    await expect(w.pool.event(mine)).resolves.toBeUndefined();
    await wait(200);

    expect(w.ditto.stored).toEqual([mine]);
    expect(w.blobbi.offered).toHaveLength(1);
    const status = w.status.get(BLOBBI);
    expect(status?.lastFailure).toMatchObject({ verdict: 'rejected', message: PILOT_REFUSAL });
    expect(status?.pending).toBe(0);
    expect(describeRelayStatus(status)?.text).toMatch(/Not accepting saves from this account yet/);
  });

  it('reads that find the event missing there do not keep offering it', async () => {
    const w = world({ carry: true });
    w.blobbi.refuse = PILOT_REFUSAL;
    w.ditto.seed(pet('blobbi-x', 1000));
    for (let i = 0; i < 4; i += 1) await w.pool.query(PETS);
    await wait(60);
    expect(w.blobbi.offered).toHaveLength(1);

    // And the refusal survives a reload.
    const reloaded = world({ storage: w.storage, carry: true });
    reloaded.blobbi.refuse = PILOT_REFUSAL;
    reloaded.ditto.seed(...w.ditto.stored);
    reloaded.primal.seed(...w.ditto.stored);
    await reloaded.pool.query(PETS);
    await wait(60);
    expect(reloaded.blobbi.offered).toEqual([]);
  });

  it('fails only when every relay refused, with the primary\'s reason', async () => {
    const w = world();
    w.blobbi.refuse = PILOT_REFUSAL;
    w.ditto.refuse = 'blocked: no';
    w.primal.refuse = 'blocked: no';
    await expect(w.pool.event(pet('blobbi-x', 1000))).rejects.toThrow(PILOT_REFUSAL);
    await wait(150);
    // An event the caller was told had failed is never sent again behind its back.
    expect(w.blobbi.offered).toHaveLength(1);
    expect(w.ditto.offered).toHaveLength(1);
  });
});

describe('an existing account meets an empty primary', () => {
  const deps = (w: World, signed: NostrEvent[]): CoinWalletDeps =>
    ({
      nostr: w.pool,
      user: {
        pubkey: ME,
        signer: {
          signEvent: async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => {
            const event = { ...t, id: `signed-${signed.length}`.padEnd(64, '0'), pubkey: ME, sig: 'sig' } as NostrEvent;
            signed.push(event);
            return event;
          },
        },
      },
    }) as unknown as CoinWalletDeps;

  it('the inventory on a secondary is the inventory: no new 200-Coin inventory is signed', async () => {
    const w = world();
    const existing = inventory({ at: 1000, coin: 735, marker: true });
    w.ditto.seed(existing);
    const signed: NostrEvent[] = [];

    const result = await createEconomyEntry(deps(w, signed)).checkAndApply();

    expect(result).toMatchObject({ status: 'applied', alreadyApplied: true });
    expect(signed).toEqual([]);
    await wait(30);
    // Read, not copied: the account has not asked for its saves to be carried.
    expect(w.blobbi.stored).toEqual([]);
    expect(w.ditto.stored).toEqual([existing]);
  });

  it('secondaries that do not answer leave the state unknown: nothing is signed or published', async () => {
    const w = world();
    w.ditto.down = true;
    w.primal.down = true;
    const signed: NostrEvent[] = [];

    const result = await createEconomyEntry(deps(w, signed)).checkAndApply();

    expect(result).toEqual({ status: 'check-failed' });
    expect(signed).toEqual([]);
    expect([...w.blobbi.offered, ...w.ditto.offered, ...w.primal.offered]).toEqual([]);
  }, 20_000);

  it('the Blobbi list is not "empty" while the relay that holds the Blobbis is silent', async () => {
    const w = world();
    w.ditto.down = true;
    const outcome = await readRelayConfirmed(w.pool, PETS, { timeoutMs: 400 });
    expect(outcome.status).toBe('unknown');

    w.ditto.down = false;
    w.ditto.seed(pet('blobbi-x', 1000));
    const again = await readRelayConfirmed(w.pool, PETS, { timeoutMs: 1000 });
    expect(again.status === 'answered' && again.events).toHaveLength(1);
  });

  it('a genuinely new account is a confirmed empty once every relay has said so', async () => {
    const w = world();
    expect(await readRelayConfirmed(w.pool, INVENTORY, { timeoutMs: 1000 })).toEqual({ status: 'answered', events: [] });
  });
});

describe('flows with their own routing', () => {
  it('realtime (presence, chat, theater) goes to the primary and one rendezvous relay, and is never carried', async () => {
    const w = world();
    const presence = ev(31950, { tags: [['d', 'session:abcdefgh'], ['expiration', '9999999999']] });
    await w.pool.event(presence);
    await wait(30);
    expect(w.blobbi.offered).toEqual([presence]);
    expect(w.ditto.offered).toEqual([presence]);
    expect(w.primal.offered).toEqual([]);

    await w.pool.query([{ kinds: [21201], '#l': ['plaza'] }]);
    expect(w.primal.reqs).toEqual([]);
  });

  it('realtime does not wait for a dead primary', async () => {
    const w = world();
    w.blobbi.down = true;
    const presence = ev(31950, { tags: [['d', 'session:abcdefgh'], ['expiration', '9999999999']] });
    w.ditto.seed(presence);
    const outcome = await readRelay(w.pool, [{ kinds: [31950], authors: [ME] }], { timeoutMs: 1000 });
    expect(outcome.status === 'answered' && ids(outcome.events)).toEqual([presence.id]);
  });

  it('a kind the Blobbi relay refuses by policy (a shared photo, a theme) goes to the public relays only', async () => {
    const w = world();
    const note = ev(1);
    const theme = ev(16767);
    await w.pool.event(note);
    await w.pool.event(theme);
    await wait(30);
    expect(w.blobbi.offered).toEqual([]);
    expect(ids(w.ditto.offered)).toEqual([note.id, theme.id]);

    await w.pool.query([{ kinds: [36767], limit: 60 }]);
    expect(w.blobbi.reqs).toEqual([]);
  });

  it('an explicit relay list (remote signing, the travel session) is left exactly as the caller asked', async () => {
    const w = world();
    const other = 'wss://bunker.example.com';
    await w.pool.event(ev(24133), { relays: [other] });
    expect(w.relays[other].offered).toHaveLength(1);
    expect([...w.blobbi.offered, ...w.ditto.offered, ...w.primal.offered]).toEqual([]);
  });
});
