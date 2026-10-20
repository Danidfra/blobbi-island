/**
 * World Travel on Nostr, end to end over an in-memory relay with real
 * signatures: the Island reads the Blobbi's World Location (kind 31126) and
 * shows it away in Blobbi Pixel, with no departure replayed and no room
 * presence published for it; a location this device merely kept never draws
 * the Blobbi before the relays answer; a Blobbi confirmed here arrives once
 * through the teleport; "Bring here" publishes exactly one World Location
 * naming the Island, and the Blobbi arrives; two meaningful interactions do
 * the same by themselves; once here, nothing more is written; a live move
 * elsewhere departs it; a refusal, a relay failure and a reload mid-arrival
 * end well; with no location at all it is at the default World (the Home),
 * away from here; the companion choice (11125) is never touched.
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
import { setCapturedHandoff } from './handoff-capture';
import { PRESENCE } from './useBlobbiPresence';
import { DEPARTURE } from './useWorldDeparture';
import { HANDOFF_PARAM, HANDOFF_SIGN_TIMEOUT_MS, decodeHandoff } from './world-travel-handoff';
import { worldById } from './worlds';
import { ISLAND_FOLLOW_AFTER } from './useIslandWorldTravel';
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
const otherSk = generateSecretKey();
const OTHER = getPublicKey(otherSk);
const NSEC = nip19.nsecEncode(sk);
const D = `blobbi-${PUBKEY.slice(0, 12)}-0123456789`;
const BLOBBI: Blobbi = { id: D, stage: 'baby', generation: 1, hunger: 80, happiness: 80, health: 100, hygiene: 80, energy: 80, experience: 0, careStreak: 0, baseColor: '#f7b267', secondaryColor: '#f4845f', eyeColor: '#2b2d42', name: 'Brook' };

/** A World Location signed by the owner, dated `nowMs` (the kit's template takes milliseconds). */
function locationIn(world: string, latest: NostrEvent | null = null, nowMs = Date.now() - 120_000, key = sk, o: { owner?: string; d?: string } = {}): NostrEvent {
  const template = buildWorldLocationTemplate({ owner: o.owner ?? PUBKEY, d: o.d ?? D, world, latest: latest ? { id: latest.id, createdAt: latest.created_at, world: latest.tags.find((t) => t[0] === 'world')![1] } as never : null, now: nowMs });
  return finalizeEvent({ kind: template.kind, content: template.content, tags: template.tags, created_at: template.created_at }, key) as NostrEvent;
}
/** As it comes out of a fragment: JSON only (no library's cached "verified" mark travels with it). */
const plain = <T,>(e: T): T => JSON.parse(JSON.stringify(e)) as T;

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
/** The gap after which the kit counts the next press as a new interaction. */
const GAP = 1_100;

const originalLocation = window.location;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  seen.length = 0;
  setCapturedHandoff(null);
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
  setCapturedHandoff(null);
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
  vi.useRealTimers();
  localStorage.clear();
  delete (window as { nostr?: unknown }).nostr;
});

describe('World Travel on Nostr, from the Island', () => {
  it('away at load (in Blobbi Pixel): shown away at once with no departure, the away card up, no room presence for it', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_PIXEL));
    mount(pool);
    await tick(50);
    expect(status().dataset.travelSession).toBe('on');
    await settle();
    expect(status().dataset.travelPlace).toBe(WORLD_PIXEL);
    expect(status().dataset.travelHere).toBe('false');
    expect(status().dataset.travelResolution).toBe('confirmed');
    expect(status().dataset.travelChange).toMatch(/^historical:/);
    expect(world().dataset.presence).toBe('absent');
    expect(world().dataset.here).toBe('false');
    expect(screen.getByTestId('world-travel-away')).toHaveTextContent('Brook is in Blobbi Pixel');
    expect(screen.getByTestId('world-travel-call-here')).toHaveTextContent('Bring Brook here');
    // Never drawn here, not even for a frame; nothing written on load (opening the page is not an act)
    expect(seen.some((s) => s.startsWith('present') || s.startsWith('arriving') || s.endsWith('/true'))).toBe(false);
    expect(locations(pool)).toHaveLength(0);
  });

  it('a kept location that says "here" is stale after a trip: nothing is drawn before the relays answer, and they say Pixel', async () => {
    const pool = new FakePool();
    pool.readDelayMs = 1_000;
    const wasHere = locationIn(WORLD_ISLAND, null, Date.now() - 600_000);
    keep(wasHere);
    pool.seed(locationIn(WORLD_PIXEL, wasHere));
    mount(pool);
    await tick(50);
    // The kept place is known to the session, and is NOT shown
    expect(status().dataset.travelResolution).toBe('cached');
    expect(status().dataset.travelPlace).toBe(WORLD_ISLAND);
    expect(world().dataset.presence).toBe('absent');
    expect(world().dataset.here).toBe('false');
    expect(screen.queryByTestId('world-travel-notices')).toBeNull();
    await tick(ENTRY * 2);
    expect(world().dataset.presence).toBe('absent');
    await tick(1_000);
    expect(status().dataset.travelResolution).toBe('confirmed');
    expect(status().dataset.travelPlace).toBe(WORLD_PIXEL);
    await settle();
    expect(world().dataset.presence).toBe('absent');
    expect(screen.getByTestId('world-travel-away')).toHaveTextContent('Brook is in Blobbi Pixel');
    expect(seen.some((s) => s.startsWith('present') || s.startsWith('arriving') || s.endsWith('/true'))).toBe(false);
    expect(locations(pool)).toHaveLength(0);
  });

  it('confirmed here on the first look: the Blobbi arrives through the teleport exactly once, and the room speaks for it only once it has formed', async () => {
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
    // Re-renders, the minute's look and time replay nothing
    r.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <App pool={pool} signer="nsec" />
      </QueryClientProvider>,
    );
    await tick(61_000);
    expect(arrivals()).toBe(1);
    expect(world().dataset.presence).toBe('present');
    expect(locations(pool)).toHaveLength(0);
  });

  it('no relay answers: nothing kept means the default World (away, said honestly); a kept "here" stands and the Blobbi arrives', async () => {
    const down = new FakePool();
    down.failReads = true;
    const r = mount(down);
    await settle();
    expect(status().dataset.travelResolution).toBe('unreachable');
    expect(status().dataset.travelPlace).toBe(WORLD_HOME);
    expect(world().dataset.presence).toBe('absent');
    expect(screen.getByTestId('world-travel-away')).toHaveTextContent("Couldn't reach the Blobbi network");
    expect(locations(down)).toHaveLength(0);
    r.unmount();
    seen.length = 0;

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

  it('Bring here: exactly one World Location naming the Island, signed by the owner; the Blobbi arrives; then nothing more', async () => {
    const pool = new FakePool();
    const away = locationIn(WORLD_PIXEL);
    pool.seed(away);
    mount(pool);
    await settle();
    fireEvent.click(screen.getByTestId('world-travel-call-here'));
    await tick(100);
    const written = locations(pool);
    expect(written).toHaveLength(1);
    const loc = written[0];
    expect(loc.pubkey).toBe(PUBKEY);
    expect(loc.tags.find((t) => t[0] === 'world')?.[1]).toBe(WORLD_ISLAND);
    expect(loc.tags.find((t) => t[0] === 'from')?.[1]).toBe(WORLD_PIXEL);
    expect(loc.tags.find((t) => t[0] === 'd')?.[1]).toBe(D);
    expect(loc.tags.find((t) => t[0] === 'a')?.[1]).toBe(`31124:${PUBKEY}:${D}`);
    expect(loc.tags.find((t) => t[0] === 'prev')?.[1]).toBe(away.id);
    expect(loc.created_at).toBeGreaterThan(away.created_at);
    // Every travel relay got the same signed event
    for (const url of BLOBBI_WORLD_TRAVEL_RELAYS) expect(pool.relay(url).published.map((e) => e.id)).toEqual([loc.id]);
    // The arrival: on its way, then formed here
    expect(status().dataset.travelPlace).toBe(WORLD_ISLAND);
    expect(screen.getByTestId('world-travel-coming')).toHaveTextContent('Brook is on the way');
    await tick(PRESENCE.arriveLeadMs + 2_000);
    expect(world().dataset.presence === 'arriving' || world().dataset.presence === 'present').toBe(true);
    await tick(ARRIVAL);
    expect(world().dataset.presence).toBe('present');
    expect(status().dataset.travelHere).toBe('true');
    expect(world().dataset.here).toBe('true');
    expect(arrivals()).toBe(1);
    expect(screen.queryByTestId('world-travel-away')).toBeNull();
    // Here: a press is activity only; nothing more is written
    fireEvent.pointerDown(world());
    await tick(GAP);
    fireEvent.pointerDown(world());
    await tick(GAP);
    fireEvent.pointerDown(world());
    await tick(3_000);
    expect(locations(pool)).toHaveLength(1);
    // The companion choice was never touched
    expect(pool.relay(BLOBBI_WORLD_TRAVEL_RELAYS[0]).published.some((e) => e.kind === 11125)).toBe(false);
  });

  it('two taps asking for the same thing at once make one move: the second finds one under way', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_PIXEL));
    mount(pool);
    await settle();
    const button = screen.getByTestId('world-travel-call-here');
    fireEvent.click(button);
    fireEvent.click(button);
    await journey();
    expect(locations(pool)).toHaveLength(1);
    expect(world().dataset.presence).toBe('present');
  });

  it('playing here brings it over by itself: the second meaningful interaction publishes one move, the card counts the first', async () => {
    expect(ISLAND_FOLLOW_AFTER).toBe(2);
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_PIXEL));
    mount(pool);
    await settle();
    expect(screen.getByTestId('world-travel-noticed').dataset.needed).toBe('2');
    expect(screen.getByTestId('world-travel-detail')).toHaveTextContent('Keep playing and Brook comes over by itself');
    // One press: noticed, nothing written. A second within the same second is the same gesture
    fireEvent.pointerDown(world());
    fireEvent.pointerDown(world());
    await tick(50);
    expect(status().dataset.followCount).toBe('1');
    expect(screen.getByTestId('world-travel-detail')).toHaveTextContent('One more tap');
    expect(locations(pool)).toHaveLength(0);
    // A press on the card itself is not play in the world
    fireEvent.pointerDown(screen.getByTestId('world-travel-detail'));
    await tick(GAP);
    expect(status().dataset.followCount).toBe('1');
    expect(locations(pool)).toHaveLength(0);
    // The second counted press: one World Location, then the arrival
    fireEvent.pointerDown(world());
    await tick(100);
    expect(locations(pool)).toHaveLength(1);
    expect(locations(pool)[0].tags.find((t) => t[0] === 'world')?.[1]).toBe(WORLD_ISLAND);
    await journey();
    expect(world().dataset.presence).toBe('present');
    expect(status().dataset.travelHere).toBe('true');
    expect(arrivals()).toBe(1);
    // More play writes nothing more
    fireEvent.pointerDown(world());
    await tick(GAP);
    fireEvent.pointerDown(world());
    await tick(3_000);
    expect(locations(pool)).toHaveLength(1);
  });

  it('an extension that refuses: nothing is written, the card says so and offers to try again; play alone asks nothing more; Try again works', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_PIXEL));
    extension.signEvent.mockRejectedValueOnce(new Error('User rejected'));
    mount(pool, 'extension');
    await settle();
    expect(status().dataset.travelSession).toBe('on');
    fireEvent.click(screen.getByTestId('world-travel-call-here'));
    await tick(100);
    expect(extension.signEvent).toHaveBeenCalledTimes(1);
    expect(locations(pool)).toHaveLength(0);
    expect(status().dataset.travelPhase).toBe('failed');
    expect(status().dataset.travelReason).toBe('declined');
    expect(world().dataset.presence).toBe('absent');
    expect(screen.getByTestId('world-travel-detail')).toHaveTextContent("wasn't approved");
    const retry = screen.getByTestId('world-travel-retry');
    expect(retry).toHaveTextContent('Try again');
    // Following by play is suspended after a refusal: presses ask the extension nothing
    fireEvent.pointerDown(world());
    await tick(GAP);
    fireEvent.pointerDown(world());
    await tick(GAP);
    fireEvent.pointerDown(world());
    await tick(500);
    expect(extension.signEvent).toHaveBeenCalledTimes(1);
    expect(locations(pool)).toHaveLength(0);
    expect(status().dataset.followSuspended).toBe('true');
    // The player asks again, and approves this time
    fireEvent.click(retry);
    await tick(100);
    expect(extension.signEvent).toHaveBeenCalledTimes(2);
    expect(locations(pool)).toHaveLength(1);
    await journey();
    expect(world().dataset.presence).toBe('present');
  });

  it('every relay refuses the move: nothing arrives, the card says so; the same signed event is sent again once they are back, once', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_PIXEL));
    mount(pool);
    await settle();
    pool.failWrites = true;
    fireEvent.click(screen.getByTestId('world-travel-call-here'));
    await tick(100);
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
    fireEvent.click(screen.getByTestId('world-travel-call-here'));
    await tick(400);
    expect(locations(pool)).toHaveLength(1);
    expect(world().dataset.presence).toBe('absent');
    first.unmount();
    seen.length = 0;
    // The new page: this device kept the signed move, the relays hold it; nothing is signed again
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

  it('a live move elsewhere (another device, another world) departs the Blobbi here', async () => {
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
    expect(locations(pool)).toHaveLength(0);
  });

  it('with no World Location at all, the Blobbi is at the default World (its Home), away from here', async () => {
    const pool = new FakePool();
    mount(pool);
    await settle();
    expect(status().dataset.travelPlace).toBe(WORLD_HOME);
    expect(status().dataset.travelHere).toBe('false');
    expect(world().dataset.presence).toBe('absent');
    expect(screen.getByTestId('world-travel-away')).toHaveTextContent('Brook is in Blobbi Home');
  });
});

// ─── The hand-off: an explicit trip arrives by itself ───────────────────────

describe('the World Travel hand-off, arriving at the Island', () => {
  const handoffStatus = () => status().dataset.handoff;

  it('from Blobbi Home with a signed move: nothing is signed here, the move is published once, and the Blobbi arrives once', async () => {
    const pool = new FakePool();
    const home = locationIn(WORLD_HOME);
    pool.seed(home);
    const signedAtHome = plain(locationIn(WORLD_ISLAND, home, Date.now()));
    setCapturedHandoff(signedAtHome);
    mount(pool, 'extension');
    await settle();
    expect(handoffStatus()).toBe('done');
    expect(status().dataset.travelPlace).toBe(WORLD_ISLAND);
    expect(status().dataset.travelChange).toMatch(/^live:/);
    expect(locations(pool).map((e) => e.id)).toEqual([signedAtHome.id]);
    for (const url of BLOBBI_WORLD_TRAVEL_RELAYS) expect(pool.relay(url).published.map((e) => e.id)).toEqual([signedAtHome.id]);
    // The destination signed nothing: the move is the one the origin signed
    expect(extension.signEvent).not.toHaveBeenCalled();
    // On its way, then the teleport's arrival, once
    await tick(50);
    expect(world().dataset.presence === 'arriving' || world().dataset.presence === 'present').toBe(true);
    await tick(ARRIVAL);
    expect(world().dataset.presence).toBe('present');
    expect(world().dataset.here).toBe('true');
    expect(arrivals()).toBe(1);
    expect(screen.queryByTestId('world-travel-away')).toBeNull();
    // Play afterwards writes nothing more
    fireEvent.pointerDown(world());
    await tick(GAP);
    fireEvent.pointerDown(world());
    await tick(3_000);
    expect(locations(pool)).toHaveLength(1);
  });

  it('the same hand-off again (a reload mid-arrival, a second tab): already the place, nothing more is published', async () => {
    const pool = new FakePool();
    const home = locationIn(WORLD_HOME);
    pool.seed(home);
    const signedAtHome = plain(locationIn(WORLD_ISLAND, home, Date.now()));
    setCapturedHandoff(signedAtHome);
    const first = mount(pool);
    await settle();
    expect(handoffStatus()).toBe('done');
    expect(locations(pool)).toHaveLength(1);
    // The page reloads before the arrival has played; the address carried the hand-off again
    first.unmount();
    seen.length = 0;
    setCapturedHandoff(signedAtHome);
    mount(pool);
    await settle();
    expect(handoffStatus()).toBe('done');
    expect(status().dataset.travelPlace).toBe(WORLD_ISLAND);
    await tick(ARRIVAL);
    expect(world().dataset.presence).toBe('present');
    expect(arrivals()).toBe(1);
    await tick(5_000);
    expect(locations(pool)).toHaveLength(1);
  });

  it('opened directly, with nothing in the address: nothing is published, the ordinary rule stands', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_HOME));
    mount(pool);
    await settle();
    expect(handoffStatus()).toBeUndefined();
    expect(locations(pool)).toHaveLength(0);
    expect(screen.getByTestId('world-travel-away')).toHaveTextContent('Brook is in Blobbi Home');
  });

  it.each([
    ['another World', (home: NostrEvent) => plain(locationIn(WORLD_PIXEL, home, Date.now())), 'wrong-world'],
    ['another account', (home: NostrEvent) => plain(locationIn(WORLD_ISLAND, home, Date.now(), otherSk, { owner: OTHER, d: `blobbi-${OTHER.slice(0, 12)}-0123456789` })), 'wrong-account'],
    ['another Blobbi', (home: NostrEvent) => plain(locationIn(WORLD_ISLAND, home, Date.now(), sk, { d: `blobbi-${PUBKEY.slice(0, 12)}-9999999999` })), 'wrong-blobbi'],
    ['a tampered event', (home: NostrEvent) => ({ ...plain(locationIn(WORLD_ISLAND, home, Date.now())), content: 'x' }), 'invalid'],
    ['an expired one', (home: NostrEvent) => plain(locationIn(WORLD_ISLAND, home, Date.now() - 200_000)), 'expired'],
  ])('a hand-off for %s is dropped: nothing published, the Blobbi away with Bring here', async (_what, make, reason) => {
    const pool = new FakePool();
    const home = locationIn(WORLD_HOME, null, Date.now() - 400_000);
    pool.seed(home);
    setCapturedHandoff(make(home));
    mount(pool);
    await settle();
    expect(handoffStatus()).toBe('dropped');
    expect(status().dataset.handoffReason).toBe(reason);
    expect(locations(pool)).toHaveLength(0);
    expect(world().dataset.presence).toBe('absent');
    expect(screen.getByTestId('world-travel-away')).toHaveTextContent('Brook is in Blobbi Home');
    expect(screen.getByTestId('world-travel-call-here')).toBeInTheDocument();
  });

  it('a stale hand-off (the Blobbi moved again meanwhile) is dropped, and the newer place shown', async () => {
    const pool = new FakePool();
    const home = locationIn(WORLD_HOME, null, Date.now() - 400_000);
    const signedAtHome = plain(locationIn(WORLD_ISLAND, home, Date.now() - 30_000));
    // Another device took it to Pixel after the trip began
    pool.seed(locationIn(WORLD_PIXEL, home, Date.now() - 10_000));
    setCapturedHandoff(signedAtHome);
    mount(pool);
    await settle();
    expect(handoffStatus()).toBe('dropped');
    expect(status().dataset.handoffReason).toBe('stale');
    expect(locations(pool)).toHaveLength(0);
    expect(screen.getByTestId('world-travel-away')).toHaveTextContent('Brook is in Blobbi Pixel');
  });

  it('no relay accepting the hand-off: not here, said so with Try again; Try again sends the same event, once accepted it arrives', async () => {
    const pool = new FakePool();
    const home = locationIn(WORLD_HOME);
    pool.seed(home);
    const signedAtHome = plain(locationIn(WORLD_ISLAND, home, Date.now()));
    setCapturedHandoff(signedAtHome);
    pool.failWrites = true;
    mount(pool, 'extension');
    await settle();
    expect(handoffStatus()).toBe('failed');
    expect(locations(pool)).toHaveLength(0);
    expect(world().dataset.presence).toBe('absent');
    expect(status().dataset.travelHere).toBe('false');
    const card = screen.getByTestId('world-travel-away');
    expect(card).toHaveTextContent("Couldn't reach the Blobbi network");
    pool.failWrites = false;
    fireEvent.click(screen.getByTestId('world-travel-retry'));
    await tick(100);
    expect(handoffStatus()).toBe('done');
    expect(locations(pool).map((e) => e.id)).toEqual([signedAtHome.id]);
    expect(extension.signEvent).not.toHaveBeenCalled();
    await tick(50);
    await tick(ARRIVAL);
    expect(world().dataset.presence).toBe('present');
    expect(arrivals()).toBe(1);
  });
});

describe('the World Travel hand-off, leaving the Island', () => {
  const GOODBYE = DEPARTURE.noticeMs + DEPARTURE.waveMs;
  const PIXEL_URL = worldById('pixel', {})!.url!;
  async function leaveForPixel() {
    act(() => void document.dispatchEvent(new CustomEvent(DOCK_EVENTS.openWorlds)));
    fireEvent.click(screen.getByTestId('world-pixel'));
    await tick(GOODBYE);
    await tick(PRESENCE.departMs);
    await tick(50);
  }

  it('the move to Pixel is signed here, once, on the choice (an extension asks); the page goes with it in the fragment; nothing is published', async () => {
    const pool = new FakePool();
    const here = locationIn(WORLD_ISLAND);
    pool.seed(here);
    mount(pool, 'extension');
    await settle();
    await tick(ARRIVAL);
    expect(world().dataset.presence).toBe('present');
    await leaveForPixel();
    expect(extension.signEvent).toHaveBeenCalledTimes(1);
    expect(extension.signEvent.mock.calls[0][0].kind).toBe(KIND_WORLD_LOCATION);
    expect(assign).toHaveBeenCalledTimes(1);
    const url = new URL(assign.mock.calls[0][0] as string);
    expect(`${url.origin}${url.pathname}`).toBe(PIXEL_URL);
    expect(url.search).toBe('');
    const carried = decodeHandoff(new URLSearchParams(url.hash.slice(1)).get(HANDOFF_PARAM));
    const loc = parseWorldLocation(carried!, { verify: (e) => verifyEvent(e as never) });
    expect(loc).toMatchObject({ owner: PUBKEY, d: D, world: WORLD_PIXEL, from: WORLD_ISLAND, prev: here.id });
    expect(loc!.createdAt).toBeGreaterThan(here.created_at);
    // Signed, not published: the destination publishes
    expect(locations(pool)).toHaveLength(0);
  });

  it('refused at the door: the page still goes, with nothing attached, and nothing is published', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_ISLAND));
    extension.signEvent.mockRejectedValueOnce(new Error('User rejected'));
    mount(pool, 'extension');
    await settle();
    await tick(ARRIVAL);
    await leaveForPixel();
    expect(extension.signEvent).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0][0]).toBe(PIXEL_URL);
    expect(locations(pool)).toHaveLength(0);
  });

  it('a signer that never answers: the card says what it waits for; after the wait the page goes with nothing attached', async () => {
    const pool = new FakePool();
    pool.seed(locationIn(WORLD_ISLAND));
    extension.signEvent.mockImplementationOnce(() => new Promise(() => {}));
    mount(pool, 'extension');
    await settle();
    await tick(ARRIVAL);
    await leaveForPixel();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByTestId('departure-notice')).toHaveTextContent('Approve the trip in your signer');
    await tick(HANDOFF_SIGN_TIMEOUT_MS + 100);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0][0]).toBe(PIXEL_URL);
    // Still here afterwards (a navigation that never happened): the Blobbi comes back after the usual wait
    await tick(DEPARTURE.failMs + 100);
    expect(screen.getByTestId('departure-notice')).toHaveTextContent('did not open');
  });

  it('an nsec login signs silently: the page goes at once with the move attached', async () => {
    const pool = new FakePool();
    const here = locationIn(WORLD_ISLAND);
    pool.seed(here);
    mount(pool);
    await settle();
    await tick(ARRIVAL);
    await leaveForPixel();
    expect(assign).toHaveBeenCalledTimes(1);
    const url = new URL(assign.mock.calls[0][0] as string);
    const carried = decodeHandoff(new URLSearchParams(url.hash.slice(1)).get(HANDOFF_PARAM));
    expect(parseWorldLocation(carried!, { verify: (e) => verifyEvent(e as never) })).toMatchObject({ world: WORLD_PIXEL, from: WORLD_ISLAND, prev: here.id });
    expect(locations(pool)).toHaveLength(0);
  });
});
