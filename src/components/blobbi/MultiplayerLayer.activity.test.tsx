/**
 * Regression coverage for the SHARED-ACTIVITY reference in presence.
 *
 * Two rules, and they reinforce each other:
 *
 *  • **A watch session belongs to the ROOM, not to a chair.** Standing up,
 *    walking across the theater and changing seats all keep it. Only an explicit
 *    leave, or leaving the location, clears it.
 *  • **No cleanup event may outrank the movement it follows.** Presence is
 *    ordered by `seq`, so an `idle` clear published a tick after a walk — no
 *    `goal`, higher `seq` — is taken by every remote client as the newest word,
 *    and the Blobbi freezes mid-aisle instead of walking. Because movement no
 *    longer clears anything but the seat, there is no such event to publish.
 *
 * `seatId` is still cleared by movement: that one IS a claim about sitting
 * still.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { MultiplayerLayer } from './MultiplayerLayer';
import type { NostrEvent } from '@nostrify/nostrify';
import type { PresenceContent } from '@/lib/multiplayer';

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'localpk' } }),
}));

const published: Array<{ kind: number; content: string; tags: string[][] }> = [];
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({
    mutateAsync: async (event: { kind: number; content: string; tags: string[][] }) => {
      published.push(event);
    },
    mutate: () => {},
  }),
}));
// Presence has its own publisher (sign, then send — see
// `src/lib/presence-publish.ts`). Route it through the same capture so these
// tests keep reading what THIS client advertises.
vi.mock('@/lib/presence-publish', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/presence-publish')>();
  // Delegate to this file's `useNostrPublish` mock so its capture — and any
  // failure injection it performs — applies to presence exactly as before.
  const { useNostrPublish } = await import('@/hooks/useNostrPublish');
  return {
    ...actual,
    createPresencePublisher:
      () => async (event: Record<string, unknown>) => {
        await useNostrPublish().mutateAsync(event as never);
      },
  };
});

let currentLocation = 'stage';
vi.mock('@/hooks/useLocation', () => ({
  useLocation: () => ({ currentLocation }),
}));
vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => ({ data: [] }) }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({
  useBlobbonautProfile: () => ({ data: {} }),
}));
vi.mock('./AccessoryOverlay', () => ({ AccessoryOverlay: () => null }));
vi.mock('./CurrentBlobbiDisplay', () => ({
  CurrentBlobbiDisplay: () => <div data-testid="blobbi-display">Blobbi</div>,
}));

let subscriptions: Array<{ kinds: number[]; push: (event: NostrEvent) => void }> = [];

function makeFakeNostr() {
  return {
    req: (filters: Array<{ kinds?: number[] }>) => {
      const queue: NostrEvent[] = [];
      let notify: (() => void) | null = null;
      subscriptions.push({
        kinds: filters[0]?.kinds ?? [],
        push: (event: NostrEvent) => {
          queue.push(event);
          notify?.();
        },
      });
      return (async function* () {
        while (true) {
          while (queue.length > 0) yield ['EVENT', 'sub', queue.shift()];
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
          notify = null;
        }
      })();
    },
    query: async () => [],
  };
}

let fakeNostr = makeFakeNostr();
vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: fakeNostr }),
}));

const SEAT = 'theater-seat-a4';
const OTHER_SEAT = 'theater-seat-c2';
const FLOOR = { x: 50, y: 90 };
const SESSION = `31951:${'a'.repeat(64)}:3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34`;

function Harness({
  sittingIn = null,
  activitySession = null,
}: {
  sittingIn?: string | null;
  activitySession?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <PhotoBoothProvider>
      <MovementBlockerProvider>
        <div ref={containerRef} data-testid="world" data-world-surface>
          <MultiplayerLayer
            containerRef={containerRef}
            currentBlobbiD="local-blobbi"
            startPosition={FLOOR}
            sittingIn={sittingIn}
            activitySession={activitySession}
          />
        </div>
      </MovementBlockerProvider>
    </PhotoBoothProvider>
  );
}

const presence = () =>
  published
    .filter((e) => e.kind === 31950)
    .map((e) => JSON.parse(e.content) as PresenceContent);

const withActivity = () => presence().filter((c) => c.activity !== undefined);
const moving = () => presence().filter((c) => c.state === 'moving');

beforeEach(() => {
  subscriptions = [];
  published.length = 0;
  currentLocation = 'stage';
  fakeNostr = makeFakeNostr();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup(props: { sittingIn?: string | null; activitySession?: string | null } = {}) {
  const { container, rerender } = render(<Harness {...props} />);
  await act(async () => {});
  await act(async () => {});

  const state = { sittingIn: props.sittingIn ?? null, activitySession: props.activitySession ?? null };

  const update = async (next: Partial<typeof state>) => {
    Object.assign(state, next);
    await act(async () => {
      rerender(<Harness sittingIn={state.sittingIn} activitySession={state.activitySession} />);
    });
    await act(async () => {});
  };

  /** A real world click — the same path a player takes to walk somewhere. */
  const walk = async () => {
    const world = container.querySelector('[data-testid="world"]') as HTMLElement;
    vi.spyOn(world, 'getBoundingClientRect').mockReturnValue({
      width: 1000, height: 1000, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 1000,
      toJSON: () => ({}),
    } as DOMRect);
    await act(async () => {
      world.dispatchEvent(
        new MouseEvent('pointerdown', { clientX: 200, clientY: 900, bubbles: true, button: 0 }),
      );
      await vi.advanceTimersByTimeAsync(500); // past the click debounce
    });
  };

  /** Leaving the room: PlayingView clears both props as it changes location. */
  const goToLocation = async (location: string) => {
    currentLocation = location;
    await update({ sittingIn: null, activitySession: null });
  };

  return { container, update, walk, goToLocation };
}

describe('joining and leaving a shared activity', () => {
  it('publishes the session address once, on the transition', async () => {
    const h = await setup({ sittingIn: SEAT });
    published.length = 0;

    await h.update({ activitySession: SESSION });
    expect(withActivity()).toHaveLength(1);
    expect(withActivity()[0].activity).toEqual({ type: 'shared-playback', session: SESSION });
    // The seat is preserved: joining a session does not stand you up.
    expect(withActivity()[0].seatId).toBe(SEAT);

    // Re-rendering with the same session must not republish it.
    await h.update({});
    await h.update({});
    expect(withActivity()).toHaveLength(1);
  });

  it('publishes an idle clear when leaving while STAYING seated', async () => {
    // An explicit "Leave session" has no movement to preserve, so an idle event
    // is the right way to tell everyone at once.
    const h = await setup({ sittingIn: SEAT, activitySession: SESSION });
    published.length = 0;

    await h.update({ activitySession: null });

    const events = presence();
    expect(events).toHaveLength(1);
    expect(events[0].state).toBe('idle');
    expect(events[0].activity).toBeUndefined();
    expect(events[0].seatId).toBe(SEAT);
    expect(events[0].goal).toBeUndefined();
  });
});

describe('moving while in a shared activity', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes ONE moving presence: no seat, same activity', async () => {
    const h = await setup({ sittingIn: SEAT, activitySession: SESSION });
    published.length = 0;

    await h.walk();

    const moves = moving();
    expect(moves).toHaveLength(1);
    const move = moves[0];
    // Standing up is a seat claim ending…
    expect('seatId' in move).toBe(false);
    // …and NOT the session ending.
    expect(move.activity).toEqual({ type: 'shared-playback', session: SESSION });
    // The walk itself is intact — this is what remote clients animate.
    expect(move.goal).toBeDefined();
    expect(move.goal?.to).toBeDefined();
  });

  it('publishes NOTHING extra when the seat prop clears afterwards', async () => {
    // The regression that made this file: a cleanup event published a tick after
    // the walk carried no goal and a higher `seq`, so every remote client took it
    // as the newest word and froze the Blobbi mid-aisle. Standing up must remain
    // a ONE-event transition.
    const h = await setup({ sittingIn: SEAT, activitySession: SESSION });
    published.length = 0;

    await h.walk();
    const afterMove = published.length;

    await h.update({ sittingIn: null });

    expect(published).toHaveLength(afterMove);
    expect(presence().filter((c) => c.state === 'idle')).toHaveLength(0);
  });

  it('keeps the movement as the newest presence, by seq', async () => {
    const h = await setup({ sittingIn: SEAT, activitySession: SESSION });
    published.length = 0;

    await h.walk();
    await h.update({ sittingIn: null });

    const events = presence();
    const newest = events[events.length - 1];
    expect(newest.state).toBe('moving');
    expect(newest.goal).toBeDefined();
    const movingSeq = moving()[0].seq ?? 0;
    for (const event of events) expect(event.seq ?? 0).toBeLessThanOrEqual(movingSeq);
  });

  it('keeps advertising the session on heartbeats while standing in the room', async () => {
    const h = await setup({ sittingIn: SEAT, activitySession: SESSION });
    await h.walk();
    await h.update({ sittingIn: null });
    published.length = 0;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    const beats = presence();
    expect(beats.length).toBeGreaterThan(0);
    for (const beat of beats) {
      // Standing, but still watching together.
      expect('seatId' in beat).toBe(false);
      expect(beat.activity?.session).toBe(SESSION);
    }
  });

  it('carries the SAME session from one seat to the next', async () => {
    const h = await setup({ sittingIn: SEAT, activitySession: SESSION });
    published.length = 0;

    // Seat-to-seat: the walk stands you up, the arrival seats you again, and the
    // session is untouched throughout — no leave, no rejoin, no new code.
    await h.walk();
    await h.update({ sittingIn: null });
    await h.update({ sittingIn: OTHER_SEAT });

    expect(moving()).toHaveLength(1);
    expect(moving()[0].activity?.session).toBe(SESSION);

    const newest = presence()[presence().length - 1];
    expect(newest.state).toBe('idle');
    expect(newest.seatId).toBe(OTHER_SEAT);
    expect(newest.activity?.session).toBe(SESSION);

    // And no event of any kind dropped the session along the way.
    expect(presence().every((e) => e.activity?.session === SESSION)).toBe(true);
  });

  it('leaves ordinary movement alone outside the theater lifecycle', async () => {
    // No seat, no session: a plain walk, published exactly as it always was.
    const h = await setup();
    published.length = 0;

    await h.walk();

    const moves = moving();
    expect(moves).toHaveLength(1);
    expect(moves[0].goal).toBeDefined();
    expect('seatId' in moves[0]).toBe(false);
    expect('activity' in moves[0]).toBe(false);
  });

  it('preserves an activity across movement with no seat involved', async () => {
    const h = await setup({ activitySession: SESSION });
    published.length = 0;

    await h.walk();

    const moves = moving();
    expect(moves).toHaveLength(1);
    expect(moves[0].activity).toEqual({ type: 'shared-playback', session: SESSION });
    expect('seatId' in moves[0]).toBe(false);
  });
});

describe('leaving the theater', () => {
  it('clears the activity through navigation, with no extra idle event', async () => {
    const h = await setup({ sittingIn: SEAT, activitySession: SESSION });
    published.length = 0;

    await h.goToLocation('town');

    const events = presence();
    // The location change publishes its own arrival presence; nothing else may
    // follow it to clear the activity separately.
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect('activity' in event).toBe(false);
      expect('seatId' in event).toBe(false);
    }
    expect(events.filter((e) => e.location === 'town').length).toBeGreaterThan(0);
  });
});
