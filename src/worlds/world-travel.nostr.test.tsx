/**
 * World Travel on Nostr, end to end over an in-memory relay with real
 * signatures: the Island reads the Blobbi's World Location (kind 31126) and,
 * OPENING THE ISLAND BEING THE PLAYER'S INTENTION TO BRING IT HERE, moves an
 * away Blobbi (in Pixel, in Home, with no location at all) here with exactly
 * one World Location naming the Island once the first look has confirmed its
 * place, then plays the arrival once; a Blobbi already here is published
 * nothing for; re-renders, remounts, refreshes and visibility toggles never
 * publish a second event; a hidden tab acts on first show; a location this
 * device merely kept never draws the Blobbi before the relays answer; two
 * relays that disagree resolve to the newest; a refusal, a signer that never
 * answers (declined after the bounded wait, a late approval dropped),
 * unreachable relays and a reload mid-arrival end well, with "Bring here" as
 * the retry; an old page shown again moves nothing by itself; a live move
 * elsewhere departs it; LEAVING for Pixel signs and publishes nothing while
 * Stay is offered, then one World Location naming Pixel from the Island
 * before the page goes to the plain address; a trip published but not opened
 * is never undone; the companion choice (11125) is never touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NostrContext } from '@nostrify/react';
import { NLogin, NostrLoginProvider, useNostrLogin } from '@nostrify/react/login';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, type EventTemplate } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { AUTO_RESEND_MS, BLOBBI_WORLD_TRAVEL_RELAYS, KIND_WORLD_LOCATION, WORLD_HOME, WORLD_PIXEL, buildWorldLocationTemplate, parseWorldLocation, worldLocationStoreKey, type NostrEvent } from '@blobbi-kit/core';

import { ExternalEgressProvider } from '@/external-egress';
import type { Blobbi } from '@/hooks/useBlobbis';
import { IslandSafetyProvider } from '@/safety';
import { useEffect } from 'react';

import { DOCK_EVENTS } from '@/components/shell/dock-events';

import { ENTRY_BEAT_MS } from './entry-arrival';
import { PRESENCE } from './useBlobbiPresence';
import { DEPARTURE } from './useWorldDeparture';
import { ARRIVAL_INTENT_TTL_MS, DEPART_SIGN_TIMEOUT_MS, SIGN_PROMPT_TIMEOUT_MS } from './world-travel-departure';
import { worldById } from './worlds';
import { resetPageIntent } from './useIslandWorldTravel';
import { WorldTravelProvider } from './WorldTravelProvider';
import { setTravelMode, setTrustedInputCheck } from './travel-mode';
import { useWorldTravelView } from './world-travel-context';
import { WORLD_ISLAND } from './worlds';

// ─── An in-memory relay set the kit's adapter can use ───────────────────────

type Filter = { kinds?: number[]; authors?: string[]; '#d'?: string[]; '#a'?: string[]; limit?: number };
type Listener = (e: NostrEvent) => void;

class FakeRelay {
  events: NostrEvent[] = [];
  listeners = new Set<Listener>();
  published: NostrEvent[] = [];
  constructor(
    readonly url: string,
    readonly pool: FakePool,
  ) {}
  matches(e: NostrEvent, f: Filter): boolean {
    if (f.kinds && !f.kinds.includes(e.kind)) return false;
    if (f.authors && !f.authors.includes(e.pubkey)) return false;
    if (f['#d'] && !e.tags.some((t) => t[0] === 'd' && f['#d']!.includes(t[1]))) return false;
    if (f['#a'] && !e.tags.some((t) => t[0] === 'a' && f['#a']!.includes(t[1]))) return false;
    return true;
  }
  async query(filters: Filter[]): Promise<NostrEvent[]> {
    if (this.pool.failReads) throw new Error('relay down');
    if (this.pool.readDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.pool.readDelayMs));
    return this.events.filter((e) => filters.some((f) => this.matches(e, f)));
  }
  async event(e: NostrEvent): Promise<void> {
    if (this.pool.failWrites) throw new Error('relay down');
    this.published.push(e);
    this.store(e);
  }
  /** Store as a relay does: one event per address (the newest), and tell the stream. */
  store(e: NostrEvent): void {
    const d = e.tags.find((t) => t[0] === 'd')?.[1];
    this.events = this.events.filter((x) => !(x.kind === e.kind && x.pubkey === e.pubkey && x.tags.find((t) => t[0] === 'd')?.[1] === d));
    this.events.push(e);
    for (const l of this.listeners) l(e);
  }
  async *req(filters: Filter[], { signal }: { signal?: AbortSignal } = {}): AsyncGenerator<unknown[]> {
    if (this.pool.failReads) throw new Error('relay down');
    for (const e of await this.query(filters)) yield ['EVENT', 'sub', e];
    yield ['EOSE', 'sub'];
    const queue: NostrEvent[] = [];
    let wake: (() => void) | null = null;
    const listener: Listener = (e) => {
      if (filters.some((f) => this.matches(e, f))) {
        queue.push(e);
        wake?.();
      }
    };
    this.listeners.add(listener);
    try {
      while (!signal?.aborted) {
        if (queue.length) {
          yield ['EVENT', 'sub', queue.shift()!];
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        wake = null;
      }
    } finally {
      this.listeners.delete(listener);
    }
  }
}

class FakePool {
  relays = new Map<string, FakeRelay>();
  /** Every read fails at once (the relays cannot be reached). */
  failReads = false;
  /** Every write fails at once. */
  failWrites = false;
  /** Reads answer this much later (a slow relay). */
  readDelayMs = 0;
  relay(url: string): FakeRelay {
    let r = this.relays.get(url);
    if (!r) {
      r = new FakeRelay(url, this);
      this.relays.set(url, r);
    }
    return r;
  }
  async query(): Promise<NostrEvent[]> {
    return [];
  }
  async event(): Promise<void> {}
  async *req(): AsyncGenerator<unknown[]> {
    yield ['EOSE', 'sub'];
  }
  /** Every travel relay holds `event`. */
  seed(event: NostrEvent): void {
    for (const url of BLOBBI_WORLD_TRAVEL_RELAYS) this.relay(url).store(event);
  }
}

// ─── The account and its Blobbi ─────────────────────────────────────────────

const sk = generateSecretKey();
const PUBKEY = getPublicKey(sk);
const NSEC = nip19.nsecEncode(sk);
const D = `blobbi-${PUBKEY.slice(0, 12)}-0123456789`;
const BLOBBI: Blobbi = { id: D, stage: 'baby', generation: 1, hunger: 80, happiness: 80, health: 100, hygiene: 80, energy: 80, experience: 0, careStreak: 0, baseColor: '#f7b267', secondaryColor: '#f4845f', eyeColor: '#2b2d42', name: 'Brook' };

/** A World Location signed by the owner, dated `nowMs` (the kit's template takes milliseconds). */
function locationIn(world: string, latest: NostrEvent | null = null, nowMs = Date.now() - 120_000, key = sk, o: { owner?: string; d?: string } = {}): NostrEvent {
  const template = buildWorldLocationTemplate({ owner: o.owner ?? PUBKEY, d: o.d ?? D, world, latest: latest ? { id: latest.id, createdAt: latest.created_at, world: latest.tags.find((t) => t[0] === 'world')![1] } as never : null, now: nowMs });
  return finalizeEvent({ kind: template.kind, content: template.content, tags: template.tags, created_at: template.created_at }, key) as NostrEvent;
}
/** What this device kept from an earlier session (the kit's own cache of the relays' last answer). */
function keep(event: NostrEvent): void {
  localStorage.setItem(worldLocationStoreKey(PUBKEY, D), JSON.stringify(event));
}

/** An nsec login (signs silently), or a NIP-07 extension login (`window.nostr`, which may refuse). */
type Signer = 'nsec' | 'extension';
const extension = { signEvent: vi.fn<(t: EventTemplate) => Promise<NostrEvent>>() };

function SignIn({ signer }: { signer: Signer }) {
  const { logins, addLogin } = useNostrLogin();
  useEffect(() => {
    if (logins.length > 0) return;
    if (signer === 'nsec') addLogin(NLogin.fromNsec(NSEC));
    else void NLogin.fromExtension().then(addLogin);
  }, [logins.length, addLogin, signer]);
  return null;
}

/** Every change of how the world draws its Blobbi, in order, as `presence/here` (the arrival counted from it). */
const seen: string[] = [];
const arrivals = () => seen.filter((s) => s.startsWith('arriving/')).length;

function World() {
  const view = useWorldTravelView();
  useEffect(() => {
    seen.push(`${view.presence}/${view.blobbiHere}`);
  }, [view.presence, view.blobbiHere]);
  return <div data-testid="world" data-presence={view.presence} data-here={String(view.blobbiHere)} />;
}

function App({ pool, signer }: { pool: FakePool; signer: Signer }) {
  return (
    <NostrLoginProvider storageKey="wt-login">
      <NostrContext.Provider value={{ nostr: pool as never }}>
        <IslandSafetyProvider profile="standard">
          <ExternalEgressProvider>
            <SignIn signer={signer} />
            <Signed />
          </ExternalEgressProvider>
        </IslandSafetyProvider>
      </NostrContext.Provider>
    </NostrLoginProvider>
  );
}

function mount(pool: FakePool, signer: Signer = 'nsec') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App pool={pool} signer={signer} />
    </QueryClientProvider>,
  );
}

/** The provider mounts only once the account is signed in (as the page does: the world needs a user). */
function Signed() {
  const { logins } = useNostrLogin();
  if (logins.length === 0) return null;
  return (
    <WorldTravelProvider blobbi={BLOBBI} pubkey={PUBKEY}>
      <World />
    </WorldTravelProvider>
  );
}

const status = () => screen.getByTestId('world-travel-status');
const world = () => screen.getByTestId('world');
const tick = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const locations = (pool: FakePool) => pool.relays.get(BLOBBI_WORLD_TRAVEL_RELAYS[0])!.published.filter((e) => e.kind === KIND_WORLD_LOCATION);
/** The entry gate has decided and, if the Blobbi is here, its arrival has played. */
const ENTRY = ENTRY_BEAT_MS + 50;
/** React flushes the session's first answer at the end of one act: the gate's beat is then scheduled, and played in the next. */
const settle = async () => {
  await tick(50);
  await tick(ENTRY);
};
const ARRIVAL = PRESENCE.arriveMs + 50;
/** From a move's publication to the Blobbi standing here (the kit's shortest journey, then the arrival). */
/** From a move's publication to the Blobbi standing here: the kit's shortest journey, then the arrival (two acts, so the arriving frame is committed). */
const journey = async () => {
  await tick(PRESENCE.arriveLeadMs + 2_000);
  await tick(ARRIVAL);
};
/** A tag's value on an event. */
const tag = (e: NostrEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1];
/** The page is seen, or not (jsdom's document is always visible otherwise); `visibilitychange` follows. */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
}
const restoreVisibility = () => void delete (document as { visibilityState?: unknown }).visibilityState;

const originalLocation = window.location;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  seen.length = 0;
  // Every test is a new page: the Island's one decision per Blobbi is not made yet
  resetPageIntent();
  assign = vi.fn();
  Object.defineProperty(window, 'location', { value: { ...originalLocation, assign }, writable: true, configurable: true });
  setTravelMode('nostr');
  // jsdom's events are never trusted: in this suite every press is the player's
  setTrustedInputCheck(() => true);
  extension.signEvent.mockReset();
  extension.signEvent.mockImplementation(async (t) => finalizeEvent(t, sk) as NostrEvent);
  Object.defineProperty(window, 'nostr', { value: { getPublicKey: async () => PUBKEY, signEvent: (t: EventTemplate) => extension.signEvent(t) }, configurable: true, writable: true });
});
afterEach(() => {
  setTravelMode(null);
  setTrustedInputCheck(null);
  restoreVisibility();
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
  vi.useRealTimers();
  localStorage.clear();
  delete (window as { nostr?: unknown }).nostr;
});

describe('World Travel on Nostr, from the Island: opening it brings the Blobbi here', () => {
  it('away at load (in Blobbi Pixel): shown away at once with no departure and no room presence; once confirmed, one World Location naming the Island, the arrival once, then nothing more', async () => {
    const pool = new FakePool();
    const away = locationIn(WORLD_PIXEL);
    pool.seed(away);
    const r = mount(pool);
    await tick(50);
    expect(status().dataset.travelSession).toBe('on');
    expect(status().dataset.travelResolution).toBe('confirmed');
    // The opening's one move: signed by the owner, from Pixel, over the canonical location, to every travel relay
    const written = locations(pool);
    expect(written).toHaveLength(1);
    const loc = written[0];
    expect(loc.pubkey).toBe(PUBKEY);
    expect(tag(loc, 'world')).toBe(WORLD_ISLAND);
    expect(tag(loc, 'from')).toBe(WORLD_PIXEL);
    expect(tag(loc, 'd')).toBe(D);
    expect(tag(loc, 'a')).toBe(`31124:${PUBKEY}:${D}`);
    expect(tag(loc, 'prev')).toBe(away.id);
    expect(loc.created_at).toBeGreaterThan(away.created_at);
    for (const url of BLOBBI_WORLD_TRAVEL_RELAYS) expect(pool.relay(url).published.map((e) => e.id)).toEqual([loc.id]);
    // Never drawn here before the move; on its way, then formed here through the teleport, once
    expect(seen.some((s) => s.startsWith('present') || s.startsWith('arriving') || s.endsWith('/true'))).toBe(false);
    await settle();
    expect(status().dataset.travelPlace).toBe(WORLD_ISLAND);
    expect(world().dataset.presence).toBe('absent');
    expect(screen.getByTestId('world-travel-coming')).toHaveTextContent('Brook is on the way');
    await journey();
    expect(world().dataset.presence).toBe('present');
    expect(status().dataset.travelHere).toBe('true');
    expect(world().dataset.here).toBe('true');
    expect(arrivals()).toBe(1);
    expect(screen.queryByTestId('world-travel-away')).toBeNull();
    // Re-renders, the minute's look, the page hidden and shown again, and play: nothing more is written
    r.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <App pool={pool} signer="nsec" />
      </QueryClientProvider>,
    );
    await tick(61_000);
    setVisibility('hidden');
    setVisibility('visible');
    fireEvent.pointerDown(world());
    await tick(1_100);
    fireEvent.pointerDown(world());
    await tick(3_000);
    expect(locations(pool)).toHaveLength(1);
    expect(arrivals()).toBe(1);
    // The companion choice was never touched
    expect(pool.relay(BLOBBI_WORLD_TRAVEL_RELAYS[0]).published.some((e) => e.kind === 11125)).toBe(false);
  });

  it('in Blobbi Home, or with no World Location at all (the default World): the same one move, from Home', async () => {
    const pool = new FakePool();
    const home = locationIn(WORLD_HOME);
    pool.seed(home);
    const first = mount(pool);
    await settle();
    expect(locations(pool)).toHaveLength(1);
    expect(tag(locations(pool)[0], 'from')).toBe(WORLD_HOME);
    expect(tag(locations(pool)[0], 'prev')).toBe(home.id);
    await journey();
    expect(world().dataset.presence).toBe('present');
    first.unmount();
    seen.length = 0;
    localStorage.clear();
    resetPageIntent();

    const empty = new FakePool();
    mount(empty);
    await tick(50);
    expect(locations(empty)).toHaveLength(1);
    expect(tag(locations(empty)[0], 'world')).toBe(WORLD_ISLAND);
    expect(tag(locations(empty)[0], 'from')).toBe(WORLD_HOME);
    expect(tag(locations(empty)[0], 'prev')).toBeUndefined();
    await settle();
    await journey();
    expect(world().dataset.presence).toBe('present');
    expect(arrivals()).toBe(1);
  });

  it('a kept location that says "here" is stale after a trip: nothing is drawn before the relays answer; they say Pixel, and the Island then brings it over', async () => {
    const pool = new FakePool();
    pool.readDelayMs = 1_000;
    const wasHere = locationIn(WORLD_ISLAND, null, Date.now() - 600_000);
    keep(wasHere);
    const inPixel = locationIn(WORLD_PIXEL, wasHere);
    pool.seed(inPixel);
    mount(pool);
    await tick(50);
    // The kept place is known to the session, and is NOT shown; nothing is signed over it either
    expect(status().dataset.travelResolution).toBe('cached');
    expect(status().dataset.travelPlace).toBe(WORLD_ISLAND);
    expect(world().dataset.presence).toBe('absent');
    expect(world().dataset.here).toBe('false');
    expect(screen.queryByTestId('world-travel-notices')).toBeNull();
    expect(locations(pool)).toHaveLength(0);
    await tick(ENTRY * 2);
    expect(world().dataset.presence).toBe('absent');
    expect(locations(pool)).toHaveLength(0);
    // The relays answer: Pixel, confirmed; the opening's move follows at once (its own fresh read first, as slow as
    // the relays are), over Pixel's location
    await tick(1_000);
    expect(status().dataset.travelResolution).toBe('confirmed');
    expect(seen.some((s) => s.startsWith('present') || s.startsWith('arriving') || s.endsWith('/true'))).toBe(false);
    await tick(1_100);
    expect(locations(pool)).toHaveLength(1);
    expect(tag(locations(pool)[0], 'from')).toBe(WORLD_PIXEL);
    expect(tag(locations(pool)[0], 'prev')).toBe(inPixel.id);
    await settle();
    await journey();
    expect(world().dataset.presence).toBe('present');
    expect(arrivals()).toBe(1);
  });

  it('confirmed here on the first look: nothing is published, the Blobbi arrives through the teleport exactly once, and the room speaks for it only once it has formed', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_ISLAND));
    const r = mount(pool);
    await tick(50);
    expect(status().dataset.travelResolution).toBe('confirmed');
    expect(status().dataset.travelHere).toBe('true');
    // Known to be here, and still not standing there: it arrives
    expect(world().dataset.presence).toBe('absent');
    expect(world().dataset.here).toBe('false');
    await settle();
    expect(world().dataset.presence).toBe('arriving');
    expect(world().dataset.here).toBe('false');
    await tick(ARRIVAL);
    expect(world().dataset.presence).toBe('present');
    expect(world().dataset.here).toBe('true');
    expect(arrivals()).toBe(1);
    // Re-renders, the minute's look, time and visibility replay nothing and write nothing
    r.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <App pool={pool} signer="nsec" />
      </QueryClientProvider>,
    );
    await tick(61_000);
    setVisibility('hidden');
    setVisibility('visible');
    await tick(100);
    expect(arrivals()).toBe(1);
    expect(world().dataset.presence).toBe('present');
    expect(locations(pool)).toHaveLength(0);
  });

  it('two relays that disagree: the newest location wins, and the move names it as `prev`', async () => {
    const pool = new FakePool();
    const older = locationIn(WORLD_PIXEL, null, Date.now() - 300_000);
    const newer = locationIn(WORLD_HOME, older, Date.now() - 100_000);
    pool.relay(BLOBBI_WORLD_TRAVEL_RELAYS[0]).store(older);
    pool.relay(BLOBBI_WORLD_TRAVEL_RELAYS[1]).store(newer);
    mount(pool);
    await settle();
    // What this page signed (the kit also heals the lagging relay with the newest event it read: not a move)
    const known = new Set([older.id, newer.id]);
    const written = [...new Set([...pool.relays.values()].flatMap((r) => r.published.filter((e) => e.kind === KIND_WORLD_LOCATION && !known.has(e.id)).map((e) => e.id)))];
    expect(written).toHaveLength(1);
    const loc = pool.relay(BLOBBI_WORLD_TRAVEL_RELAYS[1]).published.find((e) => e.id === written[0])!;
    expect(tag(loc, 'world')).toBe(WORLD_ISLAND);
    expect(tag(loc, 'from')).toBe(WORLD_HOME);
    expect(tag(loc, 'prev')).toBe(newer.id);
    await journey();
    expect(world().dataset.presence).toBe('present');
  });

  it('a tab opened hidden decides nothing until it is seen: then the one move; shown and hidden again, nothing more', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_PIXEL));
    setVisibility('hidden');
    mount(pool);
    await settle();
    expect(status().dataset.travelResolution).toBe('confirmed');
    expect(status().dataset.travelPlace).toBe(WORLD_PIXEL);
    await tick(5_000);
    expect(locations(pool)).toHaveLength(0);
    expect(screen.getByTestId('world-travel-away')).toHaveTextContent('Brook is in Blobbi Pixel');
    // Seen for the first time
    setVisibility('visible');
    await tick(100);
    expect(locations(pool)).toHaveLength(1);
    expect(tag(locations(pool)[0], 'world')).toBe(WORLD_ISLAND);
    await journey();
    expect(world().dataset.presence).toBe('present');
    setVisibility('hidden');
    setVisibility('visible');
    await tick(3_000);
    expect(locations(pool)).toHaveLength(1);
    expect(arrivals()).toBe(1);
  });

  it('no relay answers: nothing is published (nothing kept: the default World, said honestly; kept "here": it stands and the Blobbi arrives); once they answer, Bring here moves it', async () => {
    const down = new FakePool();
    down.failReads = true;
    const r = mount(down);
    await settle();
    expect(status().dataset.travelResolution).toBe('unreachable');
    expect(status().dataset.travelPlace).toBe(WORLD_HOME);
    expect(world().dataset.presence).toBe('absent');
    expect(screen.getByTestId('world-travel-away')).toHaveTextContent("Couldn't reach the Blobbi network");
    expect(locations(down)).toHaveLength(0);
    // The relays come back: this page decided already (nothing by itself, however long it stays open)...
    down.failReads = false;
    await tick(61_000);
    setVisibility('hidden');
    setVisibility('visible');
    await tick(100);
    expect(status().dataset.travelResolution).toBe('confirmed');
    expect(locations(down)).toHaveLength(0);
    // ...and the player's button is the retry
    fireEvent.click(screen.getByTestId('world-travel-call-here'));
    await tick(100);
    expect(locations(down)).toHaveLength(1);
    expect(tag(locations(down)[0], 'world')).toBe(WORLD_ISLAND);
    await journey();
    expect(world().dataset.presence).toBe('present');
    r.unmount();
    seen.length = 0;
    localStorage.clear();
    resetPageIntent();

    const kept = new FakePool();
    kept.failReads = true;
    keep(locationIn(WORLD_ISLAND));
    mount(kept);
    await settle();
    expect(status().dataset.travelResolution).toBe('unreachable');
    expect(world().dataset.presence).toBe('arriving');
    await tick(ARRIVAL);
    expect(world().dataset.presence).toBe('present');
    expect(arrivals()).toBe(1);
    expect(screen.getByTestId('world-travel-unreachable')).toHaveTextContent('shown here');
    expect(locations(kept)).toHaveLength(0);
  });

  it('an extension that refuses: nothing is written, the card says so; play, re-renders, visibility and a remount ask nothing more; Bring here asks once more, and two taps make one move', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_PIXEL));
    extension.signEvent.mockRejectedValueOnce(new Error('User rejected'));
    const first = mount(pool, 'extension');
    await settle();
    expect(status().dataset.travelSession).toBe('on');
    // The opening asked once, and was refused
    expect(extension.signEvent).toHaveBeenCalledTimes(1);
    expect(extension.signEvent.mock.calls[0][0].kind).toBe(KIND_WORLD_LOCATION);
    expect(locations(pool)).toHaveLength(0);
    expect(status().dataset.travelPhase).toBe('failed');
    expect(status().dataset.travelReason).toBe('declined');
    expect(world().dataset.presence).toBe('absent');
    expect(screen.getByTestId('world-travel-detail')).toHaveTextContent("wasn't approved");
    expect(screen.getByTestId('world-travel-retry')).toHaveTextContent('Try again');
    // Play asks the extension nothing; nor do re-renders, a refresh or the page hidden and shown
    fireEvent.pointerDown(world());
    await tick(1_100);
    fireEvent.pointerDown(world());
    await tick(1_100);
    fireEvent.pointerDown(world());
    await tick(500);
    first.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <App pool={pool} signer="extension" />
      </QueryClientProvider>,
    );
    await tick(61_000);
    setVisibility('hidden');
    setVisibility('visible');
    await tick(100);
    expect(extension.signEvent).toHaveBeenCalledTimes(1);
    expect(locations(pool)).toHaveLength(0);
    // The provider mounted again in the same page (another route, a re-created tree): the page's decision stands
    first.unmount();
    seen.length = 0;
    mount(pool, 'extension');
    await settle();
    expect(status().dataset.travelPlace).toBe(WORLD_PIXEL);
    expect(extension.signEvent).toHaveBeenCalledTimes(1);
    expect(locations(pool)).toHaveLength(0);
    // The player asks, twice at once, and approves: one signature, one move, the arrival
    const button = screen.getByTestId('world-travel-call-here');
    fireEvent.click(button);
    fireEvent.click(button);
    await tick(100);
    expect(extension.signEvent).toHaveBeenCalledTimes(2);
    expect(locations(pool)).toHaveLength(1);
    await journey();
    expect(world().dataset.presence).toBe('present');
    expect(arrivals()).toBe(1);
  });

  it('a signer that never answers: the card says what it waits for; after the bounded wait the move is declined with nothing published; a late approval is dropped; Bring here moves it once', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_PIXEL));
    let answer: ((event: NostrEvent) => void) | null = null;
    extension.signEvent.mockImplementationOnce(() => new Promise((yes) => (answer = yes)));
    mount(pool, 'extension');
    await settle();
    expect(extension.signEvent).toHaveBeenCalledTimes(1);
    expect(status().dataset.travelPhase).toBe('signing');
    expect(screen.getByTestId('world-travel-coming')).toHaveTextContent('Approve the request');
    await tick(SIGN_PROMPT_TIMEOUT_MS - 1_000);
    expect(status().dataset.travelPhase).toBe('signing');
    expect(locations(pool)).toHaveLength(0);
    // The limit (`boundedSigner`, 60 s): the kit's move ends as declined, its lock with it; the card offers its retry
    await tick(1_100);
    expect(status().dataset.travelPhase).toBe('failed');
    expect(status().dataset.travelReason).toBe('declined');
    expect(locations(pool)).toHaveLength(0);
    expect(world().dataset.presence).toBe('absent');
    expect(screen.getByTestId('world-travel-retry')).toHaveTextContent('Try again');
    expect(extension.signEvent).toHaveBeenCalledTimes(1);
    // The stale prompt is approved at last: the late signature is dropped by the wrapper, never published
    const stale = extension.signEvent.mock.calls[0][0];
    act(() => answer!(finalizeEvent(stale, sk) as NostrEvent));
    await tick(1_000);
    expect(locations(pool)).toHaveLength(0);
    expect(status().dataset.travelPhase).toBe('failed');
    expect(world().dataset.presence).toBe('absent');
    // The player asks again: a new signature of its own, one event, one arrival
    fireEvent.click(screen.getByTestId('world-travel-retry'));
    await tick(100);
    expect(extension.signEvent).toHaveBeenCalledTimes(2);
    expect(locations(pool)).toHaveLength(1);
    expect(locations(pool)[0].id).not.toBe(finalizeEvent(stale, sk).id);
    expect(tag(locations(pool)[0], 'world')).toBe(WORLD_ISLAND);
    await journey();
    expect(world().dataset.presence).toBe('present');
    expect(arrivals()).toBe(1);
    await tick(60_000);
    expect(locations(pool)).toHaveLength(1);
  });

  it('an old page looked at again (a background tab shown later than ARRIVAL_INTENT_TTL_MS): nothing is signed or published, when the place confirms or on visibility changes; Bring here still moves it once', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_PIXEL));
    // The page's navigation started longer ago than the intent lives (`performance.now` counts from it)
    const t0 = Date.now();
    const now = vi.spyOn(performance, 'now').mockImplementation(() => ARRIVAL_INTENT_TTL_MS + 1 + (Date.now() - t0));
    try {
      setVisibility('hidden');
      mount(pool, 'extension');
      await settle();
      expect(status().dataset.travelResolution).toBe('confirmed');
      expect(status().dataset.travelPlace).toBe(WORLD_PIXEL);
      expect(extension.signEvent).not.toHaveBeenCalled();
      expect(locations(pool)).toHaveLength(0);
      // Shown now, hidden and shown again, left open: still nothing by itself
      setVisibility('visible');
      await tick(100);
      setVisibility('hidden');
      setVisibility('visible');
      await tick(61_000);
      expect(extension.signEvent).not.toHaveBeenCalled();
      expect(locations(pool)).toHaveLength(0);
      expect(world().dataset.presence).toBe('absent');
      expect(screen.getByTestId('world-travel-away')).toHaveTextContent('Brook is in Blobbi Pixel');
      // The player's button is the way: one signature, one event, the arrival
      fireEvent.click(screen.getByTestId('world-travel-call-here'));
      await tick(100);
      expect(extension.signEvent).toHaveBeenCalledTimes(1);
      expect(locations(pool)).toHaveLength(1);
      expect(tag(locations(pool)[0], 'world')).toBe(WORLD_ISLAND);
      await journey();
      expect(world().dataset.presence).toBe('present');
      expect(arrivals()).toBe(1);
    } finally {
      now.mockRestore();
    }
  });

  it('every relay refuses the move: nothing arrives, the card says so; the same signed event is sent again once they are back, once', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_PIXEL));
    pool.failWrites = true;
    mount(pool);
    await settle();
    expect(status().dataset.travelPhase).toBe('failed');
    expect(status().dataset.travelReason).toBe('unreachable');
    expect(status().dataset.travelPlace).toBe(WORLD_PIXEL);
    expect(world().dataset.presence).toBe('absent');
    expect(screen.getByTestId('world-travel-detail')).toHaveTextContent("Couldn't reach the Blobbi network");
    expect(screen.getByTestId('world-travel-retry')).toBeInTheDocument();
    expect(locations(pool)).toHaveLength(0);
    // The relays come back: the kit resends the very event it signed (no second signature), and the Blobbi arrives
    pool.failWrites = false;
    await tick(AUTO_RESEND_MS + 100);
    expect(locations(pool)).toHaveLength(1);
    await journey();
    expect(world().dataset.presence).toBe('present');
    expect(arrivals()).toBe(1);
  });

  it('a reload in the middle of the arrival: the move stands (one event), and the Blobbi arrives once in the new page', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_PIXEL));
    const first = mount(pool);
    await settle();
    await tick(400);
    expect(locations(pool)).toHaveLength(1);
    expect(world().dataset.presence).toBe('absent');
    first.unmount();
    seen.length = 0;
    // The new page: this device kept the signed move, the relays hold it; nothing is signed again
    resetPageIntent();
    mount(pool);
    await tick(50);
    expect(status().dataset.travelPlace).toBe(WORLD_ISLAND);
    expect(world().dataset.presence).toBe('absent');
    await settle();
    expect(world().dataset.presence).toBe('arriving');
    await tick(ARRIVAL);
    expect(world().dataset.presence).toBe('present');
    expect(arrivals()).toBe(1);
    await tick(5_000);
    expect(locations(pool)).toHaveLength(1);
  });

  it('a live move elsewhere (another device, another world) departs the Blobbi here, and this page never reclaims it by itself', async () => {
    const pool = new FakePool();
    const here = locationIn(WORLD_ISLAND);
    pool.seed(here);
    mount(pool);
    await settle();
    await tick(ARRIVAL);
    expect(status().dataset.travelHere).toBe('true');
    expect(world().dataset.presence).toBe('present');
    // The page has been visible long enough for a departure to play
    await tick(2_000);
    const moved = locationIn(WORLD_PIXEL, here, Date.now());
    act(() => pool.relay(BLOBBI_WORLD_TRAVEL_RELAYS[0]).store(moved));
    await tick(100);
    expect(status().dataset.travelPlace).toBe(WORLD_PIXEL);
    expect(status().dataset.travelChange).toMatch(/^live:/);
    expect(world().dataset.presence).toBe('departing');
    expect(world().dataset.here).toBe('false');
    await tick(PRESENCE.departMs + 100);
    expect(world().dataset.presence).toBe('absent');
    expect(screen.getByTestId('world-travel-away')).toHaveTextContent('Blobbi Pixel');
    // Focused again, refreshed, left open: it stays where the player took it (two open tabs never ping-pong)
    setVisibility('hidden');
    setVisibility('visible');
    await tick(61_000);
    expect(locations(pool)).toHaveLength(0);
    expect(screen.getByTestId('world-travel-call-here')).toBeInTheDocument();
  });
});

// ─── Leaving: the Island moves the Blobbi to the world it opens ──────────────

describe('leaving the Island for another world', () => {
  const GOODBYE = DEPARTURE.noticeMs + DEPARTURE.waveMs;
  const PIXEL_URL = worldById('pixel', {})!.url!;
  /** How many World Locations the first relay held when the page was asked to go. */
  let publishedAtGo = -1;
  async function arriveHere(pool: FakePool, signer: Signer = 'nsec') {
    mount(pool, signer);
    await settle();
    await tick(ARRIVAL);
    expect(world().dataset.presence).toBe('present');
    assign.mockImplementation(() => {
      publishedAtGo = locations(pool).length;
    });
  }
  async function leaveForPixel() {
    act(() => void document.dispatchEvent(new CustomEvent(DOCK_EVENTS.openWorlds)));
    fireEvent.click(screen.getByTestId('world-pixel'));
    await tick(GOODBYE);
    await tick(PRESENCE.departMs);
    await tick(50);
  }
  beforeEach(() => {
    publishedAtGo = -1;
  });

  it('Island → Pixel: nothing is signed or published while Stay is offered; once the Blobbi is gone, one World Location naming Pixel, from the Island, signed here (an extension asks) and published BEFORE the page goes to the plain address', async () => {
    const pool = new FakePool();
    const here = locationIn(WORLD_ISLAND);
    pool.seed(here);
    await arriveHere(pool, 'extension');
    act(() => void document.dispatchEvent(new CustomEvent(DOCK_EVENTS.openWorlds)));
    fireEvent.click(screen.getByTestId('world-pixel'));
    // The door press itself, the notice, the wave, the dissolving: the signer is not asked, the relays see nothing
    expect(extension.signEvent).not.toHaveBeenCalled();
    await tick(GOODBYE);
    await tick(PRESENCE.departMs - 20);
    expect(screen.getByTestId('departure-notice').dataset.phase).toBe('leaving');
    expect(screen.getByTestId('departure-stay')).toHaveTextContent('Stay');
    expect(extension.signEvent).not.toHaveBeenCalled();
    expect(locations(pool)).toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
    // Gone (Stay no longer offered): the move is signed and published now, then the page is asked to go
    await tick(20);
    await tick(50);
    expect(screen.getByTestId('departure-notice').dataset.phase).toBe('gone');
    expect(screen.queryByTestId('departure-stay')).toBeNull();
    expect(extension.signEvent).toHaveBeenCalledTimes(1);
    expect(extension.signEvent.mock.calls[0][0].kind).toBe(KIND_WORLD_LOCATION);
    const written = locations(pool);
    expect(written).toHaveLength(1);
    const loc = parseWorldLocation(written[0], { verify: (e) => verifyEvent(e as never) });
    expect(loc).toMatchObject({ owner: PUBKEY, d: D, world: WORLD_PIXEL, from: WORLD_ISLAND, prev: here.id });
    expect(loc!.createdAt).toBeGreaterThan(here.created_at);
    for (const url of BLOBBI_WORLD_TRAVEL_RELAYS) expect(pool.relay(url).published.map((e) => e.id)).toEqual([written[0].id]);
    // Published first, then the navigation: the plain address, nothing attached
    expect(assign).toHaveBeenCalledTimes(1);
    expect(publishedAtGo).toBe(1);
    expect(assign.mock.calls[0][0]).toBe(PIXEL_URL);
    const url = new URL(assign.mock.calls[0][0] as string);
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
  });

  it('Stay during the goodbye (before the Blobbi is gone): nothing was signed or published, the Blobbi is simply here again, and the page stays', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_ISLAND));
    await arriveHere(pool, 'extension');
    act(() => void document.dispatchEvent(new CustomEvent(DOCK_EVENTS.openWorlds)));
    fireEvent.click(screen.getByTestId('world-pixel'));
    await tick(GOODBYE + 300);
    expect(world().dataset.presence).toBe('departing');
    fireEvent.click(screen.getByTestId('departure-stay'));
    expect(screen.queryByTestId('departure-notice')).toBeNull();
    expect(world().dataset.presence).toBe('present');
    expect(world().dataset.here).toBe('true');
    await tick(10_000);
    expect(extension.signEvent).not.toHaveBeenCalled();
    expect(locations(pool)).toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
    expect(status().dataset.travelPlace).toBe(WORLD_ISLAND);
    expect(world().dataset.presence).toBe('present');
  });

  it('after the move was published, a navigation that does not happen is not undone: the card says Brook has left but Pixel did not open, Try again asks the page to go once more (no new move), Dismiss leaves it away', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_ISLAND));
    await arriveHere(pool);
    await leaveForPixel();
    expect(locations(pool)).toHaveLength(1);
    expect(assign).toHaveBeenCalledTimes(1);
    // Still here after the wait: the trip stands
    await tick(DEPARTURE.failMs + 100);
    const notice = screen.getByTestId('departure-notice');
    expect(notice.dataset.phase).toBe('failed');
    expect(notice.dataset.left).toBe('true');
    expect(notice).toHaveTextContent('Brook has left for Blobbi Pixel, but it did not open.');
    expect(notice).not.toHaveTextContent('is back');
    expect(screen.queryByTestId('departure-stay')).toBeNull();
    expect(screen.getByTestId('departure-dismiss')).toHaveTextContent('Dismiss');
    expect(screen.getByTestId('departure-retry')).toHaveTextContent('Try again');
    expect(world().dataset.presence).toBe('absent');
    expect(world().dataset.here).toBe('false');
    // Try again: the page is asked to go once more, with no goodbye and no second event
    fireEvent.click(screen.getByTestId('departure-retry'));
    await tick(50);
    expect(assign).toHaveBeenCalledTimes(2);
    expect(assign.mock.calls[1][0]).toBe(PIXEL_URL);
    expect(locations(pool)).toHaveLength(1);
    expect(world().dataset.presence).toBe('absent');
    await tick(DEPARTURE.failMs + 100);
    expect(screen.getByTestId('departure-notice').dataset.left).toBe('true');
    // Dismiss: the card goes, the Blobbi is not brought back; the session shows it away, as the relays say
    fireEvent.click(screen.getByTestId('departure-dismiss'));
    expect(screen.queryByTestId('departure-notice')).toBeNull();
    await tick(100);
    expect(world().dataset.presence).toBe('absent');
    expect(status().dataset.travelPlace).toBe(WORLD_PIXEL);
    expect(screen.getByTestId('world-travel-away')).toHaveTextContent('Brook is in Blobbi Pixel');
    await tick(10_000);
    expect(locations(pool)).toHaveLength(1);
    expect(assign).toHaveBeenCalledTimes(2);
    // The entry's arrival was the only one
    expect(arrivals()).toBe(1);
  });

  it('an nsec login signs silently: the move is published and the page goes at once', async () => {
    const pool = new FakePool();
    const here = locationIn(WORLD_ISLAND);
    pool.seed(here);
    await arriveHere(pool);
    await leaveForPixel();
    expect(locations(pool)).toHaveLength(1);
    expect(parseWorldLocation(locations(pool)[0], { verify: (e) => verifyEvent(e as never) })).toMatchObject({ world: WORLD_PIXEL, from: WORLD_ISLAND, prev: here.id });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(publishedAtGo).toBe(1);
    expect(assign.mock.calls[0][0]).toBe(PIXEL_URL);
  });

  it('refused at the door: the page still goes, to the plain address, and nothing is published', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_ISLAND));
    extension.signEvent.mockRejectedValueOnce(new Error('User rejected'));
    await arriveHere(pool, 'extension');
    await leaveForPixel();
    expect(extension.signEvent).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0][0]).toBe(PIXEL_URL);
    expect(locations(pool)).toHaveLength(0);
  });

  it('a signer that never answers: the card says what it waits for; after the bounded wait the page goes, and nothing is published, not even later', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_ISLAND));
    extension.signEvent.mockImplementationOnce(() => new Promise(() => {}));
    await arriveHere(pool, 'extension');
    await leaveForPixel();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByTestId('departure-notice')).toHaveTextContent('Approve the trip in your signer');
    await tick(DEPART_SIGN_TIMEOUT_MS + 100);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0][0]).toBe(PIXEL_URL);
    expect(locations(pool)).toHaveLength(0);
    // Still here afterwards (a navigation that never happened): the Blobbi comes back after the usual wait
    await tick(DEPARTURE.failMs + 100);
    expect(screen.getByTestId('departure-notice')).toHaveTextContent('did not open');
    await tick(60_000);
    expect(locations(pool)).toHaveLength(0);
  });

  it('no relay accepting the move: the page still goes, and nothing is published', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_ISLAND));
    await arriveHere(pool);
    pool.failWrites = true;
    await leaveForPixel();
    await tick(5_000);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0][0]).toBe(PIXEL_URL);
    expect(locations(pool)).toHaveLength(0);
  });
});
