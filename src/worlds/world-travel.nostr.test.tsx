/**
 * World Travel on Nostr, end to end over an in-memory relay with real
 * signatures: the Island reads the Blobbi's World Location (kind 31126) and
 * shows it away in Blobbi Pixel, with no departure replayed and no room
 * presence published for it; "Call here" publishes exactly one World
 * Location naming the Island, and the Blobbi arrives; once here, nothing
 * more is written; a live move elsewhere departs it; with no location at
 * all it is at the default World (the Home), away from here; the companion
 * choice (11125) is never touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NostrContext } from '@nostrify/react';
import { NLogin, NostrLoginProvider, useNostrLogin } from '@nostrify/react/login';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { BLOBBI_WORLD_TRAVEL_RELAYS, KIND_WORLD_LOCATION, WORLD_PIXEL, buildWorldLocationTemplate, type NostrEvent } from '@blobbi-kit/core';

import { ExternalEgressProvider } from '@/external-egress';
import type { Blobbi } from '@/hooks/useBlobbis';
import { IslandSafetyProvider } from '@/safety';
import { useEffect } from 'react';

import { PRESENCE } from './useBlobbiPresence';
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
  constructor(readonly url: string) {}
  matches(e: NostrEvent, f: Filter): boolean {
    if (f.kinds && !f.kinds.includes(e.kind)) return false;
    if (f.authors && !f.authors.includes(e.pubkey)) return false;
    if (f['#d'] && !e.tags.some((t) => t[0] === 'd' && f['#d']!.includes(t[1]))) return false;
    if (f['#a'] && !e.tags.some((t) => t[0] === 'a' && f['#a']!.includes(t[1]))) return false;
    return true;
  }
  async query(filters: Filter[]): Promise<NostrEvent[]> {
    return this.events.filter((e) => filters.some((f) => this.matches(e, f)));
  }
  async event(e: NostrEvent): Promise<void> {
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
  relay(url: string): FakeRelay {
    let r = this.relays.get(url);
    if (!r) {
      r = new FakeRelay(url);
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
}

// ─── The account and its Blobbi ─────────────────────────────────────────────

const sk = generateSecretKey();
const PUBKEY = getPublicKey(sk);
const NSEC = nip19.nsecEncode(sk);
const D = `blobbi-${PUBKEY.slice(0, 12)}-0123456789`;
const BLOBBI: Blobbi = { id: D, stage: 'baby', generation: 1, hunger: 80, happiness: 80, health: 100, hygiene: 80, energy: 80, experience: 0, careStreak: 0, baseColor: '#f7b267', secondaryColor: '#f4845f', eyeColor: '#2b2d42', name: 'Brook' };

/** A World Location signed by the owner, dated `nowMs` (the kit's template takes milliseconds). */
function locationIn(world: string, latest: NostrEvent | null = null, nowMs = Date.now() - 120_000): NostrEvent {
  const template = buildWorldLocationTemplate({ owner: PUBKEY, d: D, world, latest: latest ? { id: latest.id, createdAt: latest.created_at, world: latest.tags.find((t) => t[0] === 'world')![1] } as never : null, now: nowMs });
  return finalizeEvent({ kind: template.kind, content: template.content, tags: template.tags, created_at: template.created_at }, sk) as NostrEvent;
}

function SignIn() {
  const { logins, addLogin } = useNostrLogin();
  useEffect(() => {
    if (logins.length === 0) addLogin(NLogin.fromNsec(NSEC));
  }, [logins.length, addLogin]);
  return null;
}

function World() {
  const view = useWorldTravelView();
  return <div data-testid="world" data-presence={view.presence} data-here={String(view.blobbiHere)} />;
}

function mount(pool: FakePool) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NostrLoginProvider storageKey="wt-login">
        <NostrContext.Provider value={{ nostr: pool as never }}>
          <IslandSafetyProvider profile="standard">
            <ExternalEgressProvider>
              <SignIn />
              <Signed />
            </ExternalEgressProvider>
          </IslandSafetyProvider>
        </NostrContext.Provider>
      </NostrLoginProvider>
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

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  setTravelMode('nostr');
  // jsdom's events are never trusted: in this suite every press is the player's
  setTrustedInputCheck(() => true);
});
afterEach(() => {
  setTravelMode(null);
  setTrustedInputCheck(null);
  vi.useRealTimers();
  localStorage.clear();
});

describe('World Travel on Nostr, from the Island', () => {
  it('away at load (in Blobbi Pixel): shown away at once with no departure, the away card up, no room presence for it', async () => {
    const pool = new FakePool();
    const away = locationIn(WORLD_PIXEL);
    for (const url of BLOBBI_WORLD_TRAVEL_RELAYS) pool.relay(url).store(away);
    mount(pool);
    await tick(50);
    expect(status().dataset.travelSession).toBe('on');
    await tick(200);
    expect(status().dataset.travelPlace).toBe(WORLD_PIXEL);
    expect(status().dataset.travelHere).toBe('false');
    expect(status().dataset.travelResolution).toBe('confirmed');
    expect(status().dataset.travelChange).toMatch(/^historical:/);
    expect(world().dataset.presence).toBe('absent');
    expect(world().dataset.here).toBe('false');
    expect(screen.getByTestId('world-travel-away')).toHaveTextContent('Brook is in Blobbi Pixel');
    // Nothing written on load
    expect(locations(pool)).toHaveLength(0);
  });

  it('Call here: exactly one World Location naming the Island, signed by the owner; the Blobbi arrives; then nothing more', async () => {
    const pool = new FakePool();
    const away = locationIn(WORLD_PIXEL);
    for (const url of BLOBBI_WORLD_TRAVEL_RELAYS) pool.relay(url).store(away);
    mount(pool);
    await tick(250);
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
    await tick(PRESENCE.arriveLeadMs + 2_000);
    expect(world().dataset.presence === 'arriving' || world().dataset.presence === 'present').toBe(true);
    await tick(PRESENCE.arriveMs + 500);
    expect(world().dataset.presence).toBe('present');
    expect(status().dataset.travelHere).toBe('true');
    expect(world().dataset.here).toBe('true');
    expect(screen.queryByTestId('world-travel-away')).toBeNull();
    // Here: a press is activity only; nothing more is written
    fireEvent.pointerDown(world());
    fireEvent.pointerDown(world());
    fireEvent.pointerDown(world());
    await tick(3_000);
    expect(locations(pool)).toHaveLength(1);
    // The companion choice was never touched
    expect(pool.relay(BLOBBI_WORLD_TRAVEL_RELAYS[0]).published.some((e) => e.kind === 11125)).toBe(false);
  });

  it('a live move elsewhere (another device, another world) departs the Blobbi here', async () => {
    const pool = new FakePool();
    const here = locationIn(WORLD_ISLAND);
    for (const url of BLOBBI_WORLD_TRAVEL_RELAYS) pool.relay(url).store(here);
    mount(pool);
    await tick(250);
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
    await tick(250);
    expect(status().dataset.travelPlace).toBe('blobbi-home');
    expect(status().dataset.travelHere).toBe('false');
    expect(world().dataset.presence).toBe('absent');
    expect(screen.getByTestId('world-travel-away')).toHaveTextContent('Brook is in Blobbi Home');
  });
});
