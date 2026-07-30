/**
 * Coverage for REMOTE players sitting in theater seats.
 *
 * Remote seating must come from explicit presence state — the optional `seatId`
 * field of the existing kind 31950 content — never from "is the player standing
 * roughly where a chair is". These tests push real presence events through the
 * subscription and assert what MultiplayerLayer paints:
 *   - seated  → snapped to the CANONICAL seat anchor, rear-facing, at the row's
 *               seated scale, with no ground shadow and no float
 *   - cleared → back to the normal floating renderer at the presence position
 *   - junk    → normal rendering, never a snap to an arbitrary chair
 *
 * They also pin the publish side: nothing is advertised until arrival, and the
 * seat is dropped the moment the player moves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { MultiplayerLayer } from './MultiplayerLayer';
import {
  decorativeTheaterSeats,
  getTheaterSeat,
  seatAnchorPosition,
} from '@/lib/theater-seats-config';
import { wireCenterToGround } from '@/lib/presence-ground';
import type { NostrEvent } from '@nostrify/nostrify';

// ---------------------------------------------------------------------------
// Mocks (same shape as MultiplayerLayer.hiding.test.tsx)
// ---------------------------------------------------------------------------
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'localpk' } }),
}));
/** Every event this client publishes, so we can inspect presence payloads. */
const published: Array<{ kind: number; content: string; tags: string[][] }> = [];
/**
 * Number of publish attempts to reject before letting them through, so a test
 * can simulate a relay that is briefly unavailable at exactly the moment the
 * player sits down.
 */
let publishFailuresRemaining = 0;
/**
 * How long a publish stays IN FLIGHT before settling.
 *
 * Zero (the default) resolves in the same microtask, which is what most tests
 * want. The flood regression suite sets it, because the bug it guards only
 * exists while a publish is outstanding: a real relay publish crosses a
 * WebSocket and takes milliseconds, during which this component re-renders many
 * times. With an instantly-resolving mock no render can interleave, so the
 * flood is invisible — which is exactly why it reached a browser.
 */
let publishDelayMs = 0;
const publishAttempts: Array<{ kind: number; content: string; tags: string[][] }> = [];
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({
    mutateAsync: async (event: { kind: number; content: string; tags: string[][] }) => {
      publishAttempts.push(event);
      if (publishDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, publishDelayMs));
      }
      if (publishFailuresRemaining > 0) {
        publishFailuresRemaining -= 1;
        throw new Error('relay unavailable');
      }
      published.push(event);
    },
    mutate: () => {},
  }),
}));
/** Mutable so a test can walk the local player out of the theater. */
let currentLocation = 'stage';
vi.mock('@/hooks/useLocation', () => ({
  useLocation: () => ({ currentLocation }),
}));
vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => ({ data: [] }) }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({
  useBlobbonautProfile: () => ({ data: {} }),
}));
vi.mock('./AccessoryOverlay', () => ({ AccessoryOverlay: () => null }));

/** Records the `facing` every remote sprite is rendered with. Remote players
 * render through the pure `BlobbiRendererView` (local goes through the
 * `CurrentBlobbiDisplay` wrapper); stub both with the same marker so the
 * assertions below see every rendered Blobbi. */
vi.mock('./CurrentBlobbiDisplay', () => ({
  CurrentBlobbiDisplay: ({ facing }: { facing?: string }) => (
    <div data-testid="blobbi-display" data-facing={facing ?? 'front'}>Blobbi</div>
  ),
}));
/* Only the COMPONENT is stubbed. The rest of `@blobbi/react` is pure data
 * (`DEFAULT_STAGE`, the size table, the accessory normalizer) that the layer
 * under test genuinely uses, so the real module is spread back in — mocking the
 * whole package would replace working code with `undefined`. */
vi.mock('@blobbi/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@blobbi/react')>()),
  BlobbiRendererView: ({ facing }: { facing?: string }) => (
    <div data-testid="blobbi-display" data-facing={facing ?? 'front'}>Blobbi</div>
  ),
}));

type Pusher = (event: NostrEvent) => void;
let subscriptions: Array<{ kinds: number[]; push: Pusher }> = [];

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
          while (queue.length > 0) {
            yield ['EVENT', 'sub', queue.shift()];
          }
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
const DECORATIVE = decorativeTheaterSeats[0].id;

/** A spot on the theater floor, deliberately NOT any seat's anchor. */
const FLOOR = { x: 50, y: 90 };

function presenceEvent(opts: {
  ts: number;
  state: 'idle' | 'moving';
  at: { x: number; y: number };
  seatId?: unknown;
  seq?: number;
  pubkey?: string;
  session?: string;
}): NostrEvent {
  const { ts, state, at, seatId, seq, pubkey = 'remotepk', session = 'abc' } = opts;
  return {
    id: `evt-${pubkey}-${ts}-${seq ?? 'legacy'}-${state}-${String(seatId ?? 'none')}`,
    kind: 31950,
    pubkey,
    created_at: ts,
    sig: '',
    content: JSON.stringify({
      state,
      location: 'stage',
      anchor: { x: at.x, y: at.y, ts },
      ...(state === 'moving'
        ? { goal: { from: at, to: FLOOR, v: 120, ts } }
        : {}),
      blobbiD: 'remote-blobbi',
      ...(seatId !== undefined ? { seatId } : {}),
      ...(seq !== undefined ? { seq } : {}),
    }),
    tags: [
      ['d', `session:${session}`],
      ['a', `31124:${pubkey}:remote-blobbi`],
      ['t', 'blobbi:presence'],
      ['t', 'island:1'],
      ['t', 'loc:stage'],
      ['expiration', String(ts + 35)],
    ],
  };
}

/** Every occupancy set the layer has reported upward, newest last. */
const occupancyReports: Array<Set<string>> = [];
const recordOccupancy = (seatIds: Set<string>) => {
  occupancyReports.push(new Set(seatIds));
};

function Harness({
  sittingIn = null,
  blobbiD = 'local-blobbi',
}: { sittingIn?: string | null; blobbiD?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <PhotoBoothProvider>
      <MovementBlockerProvider>
        <div ref={containerRef} data-testid="world" data-world-surface>
          <MultiplayerLayer
            containerRef={containerRef}
            currentBlobbiD={blobbiD}
            startPosition={FLOOR}
            sittingIn={sittingIn}
            onOccupiedSeatsChange={recordOccupancy}
          />
        </div>
      </MovementBlockerProvider>
    </PhotoBoothProvider>
  );
}

/** The most recently reported occupancy set. */
const occupancy = () => occupancyReports[occupancyReports.length - 1] ?? new Set<string>();

/** Presence events this client published that advertise a seat. */
const sitPublishes = () =>
  published.filter(
    (e) => e.kind === 31950 && typeof JSON.parse(e.content).seatId === 'string',
  );

beforeEach(() => {
  subscriptions = [];
  published.length = 0;
  occupancyReports.length = 0;
  publishAttempts.length = 0;
  publishFailuresRemaining = 0;
  publishDelayMs = 0;
  currentLocation = 'stage';
  fakeNostr = makeFakeNostr();
  // Freeze the presence animation loop: these tests assert rendering from
  // presence state, not interpolation.
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup(initialSittingIn: string | null = null) {
  const { container, rerender } = render(<Harness sittingIn={initialSittingIn} />);
  await act(async () => {});
  await act(async () => {});

  const presenceSub = subscriptions.find((s) => s.kinds.includes(31950));
  expect(presenceSub, 'presence subscription should exist').toBeTruthy();

  const push = async (event: NostrEvent) => {
    await act(async () => {
      presenceSub!.push(event);
    });
    await act(async () => {});
  };

  const player = (pubkey = 'remotepk', session = 'abc') =>
    container.querySelector(`[data-player-key="${pubkey}:${session}"]`) as HTMLElement | null;

  const setLocalSittingIn = async (sittingIn: string | null) => {
    await act(async () => {
      rerender(<Harness sittingIn={sittingIn} />);
    });
    await act(async () => {});
  };

  /** Walk the local player into another room, keeping the seat prop as-is. */
  const goToLocation = async (location: string, sittingIn: string | null) => {
    currentLocation = location;
    await act(async () => {
      rerender(<Harness sittingIn={sittingIn} />);
    });
    await act(async () => {});
  };

  /** Swap the local player's active Blobbi in place, without moving. */
  const switchBlobbi = async (blobbiD: string, sittingIn: string | null) => {
    await act(async () => {
      rerender(<Harness sittingIn={sittingIn} blobbiD={blobbiD} />);
    });
    await act(async () => {});
  };

  return { container, push, player, setLocalSittingIn, goToLocation, switchBlobbi };
}

/** Percent value of an inline `left`/`top`, for anchor comparisons. */
const pct = (value: string) => Number.parseFloat(value.replace('%', ''));

const facingOf = (el: HTMLElement) =>
  el.querySelector('[data-testid="blobbi-display"]')?.getAttribute('data-facing');
const shadowOf = (el: HTMLElement) => el.querySelector('div[style*="radial-gradient"]');
const floatOf = (el: HTMLElement) => el.querySelector('.animate-float');

const TS = 1_800_000_000;

describe('remote players seated in a theater seat', () => {
  it('renders a normal floating remote player when no seat is published', async () => {
    const h = await setup();

    // The FIRST presence for a location spawns the player at that location's
    // entry point (existing behaviour, unrelated to seating), so send a second
    // update to observe a player rendered at their own published anchor.
    await h.push(presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR }));
    await h.push(presenceEvent({ ts: TS + 1, seq: 2, state: 'idle', at: FLOOR }));

    const el = h.player()!;
    expect(el.hasAttribute('data-seated-in')).toBe(false);
    expect(facingOf(el)).toBe('front');
    expect(shadowOf(el)).not.toBeNull();
    // The WIRE carries legacy CENTER points; the renderer draws the ingested
    // GROUND point (Phase 2).
    const ground = wireCenterToGround(FLOOR, 'stage');
    expect(pct(el.style.left)).toBeCloseTo(ground.x, 5);
    expect(pct(el.style.top)).toBeCloseTo(ground.y, 5);
  });

  it('snaps a seated remote to the CANONICAL seat anchor, ignoring its coordinates', async () => {
    const h = await setup();

    // The published anchor is the walk-to cushion point and is deliberately
    // nowhere near the seat's render anchor here: if the renderer trusted
    // coordinates instead of the seat id, this test would place the Blobbi on
    // the floor.
    await h.push(
      presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT }),
    );

    const anchor = seatAnchorPosition(getTheaterSeat(SEAT)!);
    const el = h.player()!;
    expect(el.getAttribute('data-seated-in')).toBe(SEAT);
    expect(pct(el.style.left)).toBeCloseTo(anchor.x, 5);
    expect(pct(el.style.top)).toBeCloseTo(anchor.y, 5);
    // Same DOM-free resolver the LOCAL seated Blobbi uses, so both clients pin
    // the Blobbi to the identical point.
    expect(anchor).not.toEqual(FLOOR);
  });

  it('renders a seated remote with the rear-facing renderer', async () => {
    const h = await setup();
    await h.push(
      presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT }),
    );

    // Rear-facing markup has no face elements at all — CurrentBlobbiDisplay
    // drops the pupils for `facing="back"`, exactly as it does locally.
    expect(facingOf(h.player()!)).toBe('back');
  });

  it('applies the seat row\'s seated scale, no shadow and no float', async () => {
    const h = await setup();
    await h.push(
      presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT }),
    );

    const el = h.player()!;
    const seat = getTheaterSeat(SEAT)!;
    const sprite = el.querySelector('[data-blobbi-scale-rig]') as HTMLElement;
    expect(sprite.style.transform).toBe(`scale(${seat.seatedScale})`);
    // A Blobbi in a chair is not standing on the floor, and must not bob.
    expect(shadowOf(el)).toBeNull();
    expect(floatOf(el)).toBeNull();
  });

  it('never scales the positioned anchor — chat bubbles portal into it', async () => {
    const h = await setup();
    await h.push(
      presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT }),
    );
    expect(h.player()!.style.transform).toBe('translate(-50%, -100%)'); // ground anchor
  });

  it('renders exactly ONE Blobbi for a seated remote — no floating copy', async () => {
    const h = await setup();
    await h.push(
      presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT }),
    );

    // The seated pose replaces the normal renderer rather than being drawn on
    // top of it: one sprite, at one position, in one element.
    expect(h.container.querySelectorAll('[data-testid="blobbi-display"]')).toHaveLength(1);
    expect(h.container.querySelectorAll('[data-player-key]')).toHaveLength(1);
  });

  it('uses the row\'s seated scale per row, not one global value', async () => {
    const h = await setup();

    await h.push(presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT }));
    const rowA = (h.player()!.querySelector('[data-blobbi-scale-rig]') as HTMLElement).style.transform;

    await h.push(presenceEvent({ ts: TS + 1, seq: 2, state: 'idle', at: FLOOR, seatId: OTHER_SEAT }));
    const rowC = (h.player()!.querySelector('[data-blobbi-scale-rig]') as HTMLElement).style.transform;

    expect(rowA).toBe(`scale(${getTheaterSeat(SEAT)!.seatedScale})`);
    expect(rowC).toBe(`scale(${getTheaterSeat(OTHER_SEAT)!.seatedScale})`);
    expect(rowA).not.toBe(rowC);
  });

  it('stands the remote Blobbi up the moment it starts moving', async () => {
    const h = await setup();
    await h.push(
      presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT }),
    );
    expect(h.player()!.getAttribute('data-seated-in')).toBe(SEAT);

    // Walking away publishes a `moving` presence with no seatId — that IS the
    // stand-up, with no separate event to lose.
    await h.push(presenceEvent({ ts: TS + 2, seq: 2, state: 'moving', at: FLOOR }));

    const el = h.player()!;
    expect(el.hasAttribute('data-seated-in')).toBe(false);
    expect(facingOf(el)).toBe('front');
    expect(shadowOf(el)).not.toBeNull();
  });

  it('ignores a stale sit re-delivered after the player already walked away', async () => {
    const h = await setup();

    const sit = presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT });
    await h.push(sit);
    await h.push(presenceEvent({ ts: TS, seq: 2, state: 'moving', at: FLOOR }));
    expect(h.player()!.hasAttribute('data-seated-in')).toBe(false);

    // Same second, wrong delivery order: only the monotonic seq can order them.
    await h.push(sit);
    expect(h.player()!.hasAttribute('data-seated-in')).toBe(false);
  });

  describe('unusable seat claims fall back to normal rendering', () => {
    it('ignores a DECORATIVE chair id', async () => {
      const h = await setup();
      await h.push(
        presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: DECORATIVE }),
      );
      await h.push(
        presenceEvent({ ts: TS + 1, seq: 2, state: 'idle', at: FLOOR, seatId: DECORATIVE }),
      );

      // A decorative chair hangs off the edge of the world; snapping to it would
      // fling the Blobbi out of the room.
      const el = h.player()!;
      expect(el.hasAttribute('data-seated-in')).toBe(false);
      expect(facingOf(el)).toBe('front');
      const ground = wireCenterToGround(FLOOR, 'stage');
      expect(pct(el.style.left)).toBeCloseTo(ground.x, 5);
      expect(pct(el.style.top)).toBeCloseTo(ground.y, 5);
    });

    it('ignores an unknown seat id without crashing', async () => {
      const h = await setup();
      await h.push(
        presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: 'theater-seat-z99' }),
      );
      await h.push(
        presenceEvent({ ts: TS + 1, seq: 2, state: 'idle', at: FLOOR, seatId: 'theater-seat-z99' }),
      );

      const el = h.player()!;
      expect(el).toBeTruthy();
      expect(el.hasAttribute('data-seated-in')).toBe(false);
      const ground = wireCenterToGround(FLOOR, 'stage');
      expect(pct(el.style.left)).toBeCloseTo(ground.x, 5);
      expect(pct(el.style.top)).toBeCloseTo(ground.y, 5);
    });

    it('ignores non-string junk in the field', async () => {
      const h = await setup();

      for (const [i, junk] of [42, true, {}, [], null, ''].entries()) {
        await h.push(
          presenceEvent({ ts: TS + i, seq: i + 1, state: 'idle', at: FLOOR, seatId: junk }),
        );
        const el = h.player()!;
        expect(el, `junk ${JSON.stringify(junk)} should still render a player`).toBeTruthy();
        expect(el.hasAttribute('data-seated-in')).toBe(false);
      }
    });
  });

  describe('duplicate claims on one seat', () => {
    it('seats the lowest hex pubkey and stands the other one up', async () => {
      const h = await setup();

      await h.push(
        presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT, pubkey: 'ff11', session: 's1' }),
      );
      await h.push(
        presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT, pubkey: 'aa22', session: 's2' }),
      );

      // Exactly one seated Blobbi in the chair, chosen by a rule both clients
      // compute identically — never two sprites stacked on one anchor.
      expect(h.player('aa22', 's2')!.getAttribute('data-seated-in')).toBe(SEAT);
      const loser = h.player('ff11', 's1')!;
      expect(loser.hasAttribute('data-seated-in')).toBe(false);
      expect(facingOf(loser)).toBe('front');
      expect(pct(loser.style.left)).toBeCloseTo(FLOOR.x, 5);
    });

    it('gives the local player their own seat and stands the remote up', async () => {
      // Presence is advisory: a stranger cannot evict you from the chair you are
      // demonstrably sitting in.
      const h = await setup(SEAT);

      await h.push(
        presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT, pubkey: '0000' }),
      );

      const el = h.player('0000')!;
      expect(el.hasAttribute('data-seated-in')).toBe(false);
      expect(facingOf(el)).toBe('front');
    });

    it('seats the remote again once the local player leaves that seat', async () => {
      const h = await setup(SEAT);
      await h.push(
        presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT, pubkey: '0000' }),
      );
      expect(h.player('0000')!.hasAttribute('data-seated-in')).toBe(false);

      await h.setLocalSittingIn(null);

      expect(h.player('0000')!.getAttribute('data-seated-in')).toBe(SEAT);
    });
  });

  describe('publishing the local seat', () => {
    it('publishes nothing while the player is only walking toward a seat', async () => {
      // `sittingIn` stays null for the whole walk — TheaterSeat fires `onSit`
      // from the ARRIVAL callback, never from the click — so there is nothing
      // here to advertise yet.
      const h = await setup();
      await h.setLocalSittingIn(null);
      expect(sitPublishes()).toHaveLength(0);
    });

    it('publishes the canonical seat id once on arrival', async () => {
      const h = await setup();

      await h.setLocalSittingIn(SEAT);

      const sits = sitPublishes();
      expect(sits).toHaveLength(1);
      const content = JSON.parse(sits[0].content);
      expect(content.seatId).toBe(SEAT);
      expect(content.location).toBe('stage');
      expect(content.state).toBe('idle');
      // Reuses the presence kind and its tag shape — no new event kind.
      expect(sits[0].kind).toBe(31950);
      expect(sits[0].tags).toEqual(
        expect.arrayContaining([['t', 'blobbi:presence'], ['t', 'loc:stage']]),
      );
    });

    it('does not republish while the player stays in the same seat', async () => {
      const h = await setup();
      await h.setLocalSittingIn(SEAT);
      expect(sitPublishes()).toHaveLength(1);

      // Re-renders (own churn, other players moving) must not re-publish.
      await h.setLocalSittingIn(SEAT);
      await h.push(presenceEvent({ ts: TS, seq: 1, state: 'moving', at: FLOOR }));
      await h.setLocalSittingIn(SEAT);

      expect(sitPublishes()).toHaveLength(1);
    });

    it('stops advertising the seat once the player stands up', async () => {
      const h = await setup();
      await h.setLocalSittingIn(SEAT);
      await h.setLocalSittingIn(null);

      const before = sitPublishes().length;
      await h.setLocalSittingIn(null);
      expect(sitPublishes()).toHaveLength(before);
      expect(before).toBe(1);
    });

    it('publishes a second seat when the player moves to another chair', async () => {
      const h = await setup();
      await h.setLocalSittingIn(SEAT);
      // Seat-to-seat always passes through null: the walk stands you up first.
      await h.setLocalSittingIn(null);
      await h.setLocalSittingIn(OTHER_SEAT);

      const sits = sitPublishes();
      expect(sits.map((e) => JSON.parse(e.content).seatId)).toEqual([SEAT, OTHER_SEAT]);
    });

    it('drops the seat from presence the instant the player moves', async () => {
      // The clear is SYNCHRONOUS inside `moveTo`, before the move is published,
      // so observers never see the contradictory "seated in A4 while walking to
      // the other side of the room" state — and no heartbeat racing the walk can
      // put the player back in the chair afterwards.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();
        await h.setLocalSittingIn(SEAT);
        expect(sitPublishes()).toHaveLength(1);

        const world = h.container.querySelector('[data-testid="world"]') as HTMLElement;
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

        const moves = published.filter((e) => JSON.parse(e.content).state === 'moving');
        expect(moves.length).toBeGreaterThan(0);
        for (const move of moves) {
          expect('seatId' in JSON.parse(move.content)).toBe(false);
        }

        // Heartbeats after the walk must not re-advertise the seat either, even
        // though the `sittingIn` prop here deliberately still says SEAT.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });
        expect(sitPublishes()).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps advertising the seat on heartbeats AFTER arriving in the room', async () => {
      // Regression: entering the theater IS a location change, which rebuilds
      // the heartbeat interval. A rebuilt heartbeat that forgot to read the seat
      // ejected every player from their chair ~25 s after they sat down — and
      // only for players who had walked in, which is all of them. Found in a
      // real browser, not in jsdom, because it needs a location change followed
      // by a sit followed by a heartbeat.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();
        // A REAL location change (the harness starts in the theater, so walk out
        // and back in). This is what rebuilds the heartbeat interval — the whole
        // point of the test; re-rendering with the same location would leave the
        // original interval in place and prove nothing.
        await h.goToLocation('town', null);
        await h.goToLocation('stage', null);
        await h.setLocalSittingIn(SEAT);

        const beforeHeartbeat = published.length;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000); // past HEARTBEAT_INTERVAL_MS
        });

        const heartbeats = published
          .slice(beforeHeartbeat)
          .map((e) => JSON.parse(e.content))
          .filter((c) => c.state === 'idle');
        expect(heartbeats.length).toBeGreaterThan(0);
        for (const beat of heartbeats) {
          expect(beat.seatId).toBe(SEAT);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops advertising the seat after a location change, even if the prop lags', async () => {
      // Defence in depth. PlayingView already clears `sittingIn` when the
      // location changes, but presence clears its own copy independently — so a
      // player who walks out of the theater can never keep haunting a chair
      // there because one layer forgot.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();
        await h.setLocalSittingIn(SEAT);
        expect(sitPublishes()).toHaveLength(1);

        await h.goToLocation('town', SEAT);

        const beforeHeartbeat = published.length;
        await act(async () => {
          // Past HEARTBEAT_INTERVAL_MS (25 s).
          await vi.advanceTimersByTimeAsync(30_000);
        });

        const heartbeats = published.slice(beforeHeartbeat);
        expect(heartbeats.length).toBeGreaterThan(0);
        for (const beat of heartbeats) {
          expect('seatId' in JSON.parse(beat.content)).toBe(false);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('retries promptly when the arrival publish fails, instead of waiting for a heartbeat', async () => {
      // Without this, the sit was marked "synchronized" before the publish
      // resolved, so a single relay hiccup meant nobody saw you sit down until
      // the next heartbeat — up to 25 s of standing in front of your own chair.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();
        publishFailuresRemaining = 1; // the arrival publish fails once

        await h.setLocalSittingIn(SEAT);
        expect(sitPublishes()).toHaveLength(0); // nothing landed yet

        await act(async () => {
          await vi.advanceTimersByTimeAsync(2_000); // well under a heartbeat
        });

        const sits = sitPublishes();
        expect(sits).toHaveLength(1);
        expect(JSON.parse(sits[0].content).seatId).toBe(SEAT);
      } finally {
        vi.useRealTimers();
      }
    });

    it('gives up after a bounded number of attempts rather than looping', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();
        publishFailuresRemaining = Number.MAX_SAFE_INTEGER; // relay never recovers

        await h.setLocalSittingIn(SEAT);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20_000);
        });

        // Bounded: a permanently failing relay must not become a publish loop.
        // The heartbeat stays the backstop.
        const sitAttempts = publishAttempts.filter(
          (e) => typeof JSON.parse(e.content).seatId === 'string',
        );
        expect(sitAttempts.length).toBeGreaterThan(1);
        expect(sitAttempts.length).toBeLessThanOrEqual(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not retry — or publish at all — for a seat that is not occupiable', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();

        // A decorative chair can never be reached through the UI; this covers a
        // future caller invoking the hook incorrectly. It must be refused at the
        // outbound boundary, and refusal is PERMANENT — retrying it forever
        // would be a publish loop with no possible success.
        await h.setLocalSittingIn(DECORATIVE);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000);
        });

        expect(publishAttempts.filter((e) => e.content.includes('seatId'))).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('re-asserts the seat when the player swaps their Blobbi while seated', async () => {
      // Swapping your active Blobbi republishes presence as a "here I am" login,
      // which carries no seatId — on its own that stands a seated player up on
      // every remote screen until the next heartbeat.
      const h = await setup();
      await h.setLocalSittingIn(SEAT);
      const before = published.length;

      await h.switchBlobbi('other-blobbi', SEAT);

      const after = published.slice(before).map((e) => JSON.parse(e.content));
      const login = after.find((c) => c.seatId === undefined);
      const reassert = after.find((c) => c.seatId === SEAT);
      expect(login, 'the identity switch still republishes presence').toBeDefined();
      expect(reassert, 'the seat is re-asserted immediately').toBeDefined();
      // Higher seq, so it can never be reordered behind the login that dropped it.
      expect(reassert.seq).toBeGreaterThan(login.seq);
    });

    it('stamps a strictly increasing seq on every presence it publishes', async () => {
      const h = await setup();
      await h.setLocalSittingIn(SEAT);

      const seqs = published
        .filter((e) => e.kind === 31950)
        .map((e) => JSON.parse(e.content).seq as number);
      expect(seqs.every((n) => typeof n === 'number')).toBe(true);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      expect(new Set(seqs).size).toBe(seqs.length);
    });
  });

  /**
   * Regression suite for a real publish FLOOD observed in two-client testing:
   * a seated player emitted `idle` + `seatId` presence several times per second
   * (seq 197, 198, 199, …), which swamped both clients and left remote Blobbis
   * frozen.
   *
   * Cause: `sitAt` is a NEW function identity on every render of this component
   * (it closes over an inline `publish` arrow), and the component re-renders on
   * every remote position update. The effect therefore re-runs many times per
   * second. Recording "I have published this seat" asynchronously — after the
   * publish resolved — meant the effect's own guard never saw the claim before
   * the next re-run, so it published again, forever.
   *
   * Every test here re-renders and pushes remote presence between assertions,
   * because a flood only appears under exactly that churn.
   */
  describe('seat publication is bounded under render churn (flood regression)', () => {
    /** Presence publish ATTEMPTS carrying a seat (successful or not). */
    const seatAttempts = () =>
      publishAttempts.filter((e) => {
        try { return typeof JSON.parse(e.content).seatId === 'string'; } catch { return false; }
      });

    /** Re-render and deliver remote presence — the churn that drove the flood. */
    const churn = async (h: Awaited<ReturnType<typeof setup>>, seat: string | null, ts: number) => {
      await h.setLocalSittingIn(seat);
      await h.push(presenceEvent({ ts, seq: ts, state: 'moving', at: FLOOR, pubkey: 'cccc' }));
      await h.setLocalSittingIn(seat);
    };

    /**
     * The reproduction condition: sit down, then re-render and deliver remote
     * presence repeatedly WHILE the arrival publish is still outstanding. Each
     * re-render hands the effect a brand-new `sitAt` identity, so it re-runs —
     * and must be stopped by its own guard, not by the publish having finished.
     */
    const sitWithChurnWhileInFlight = async (
      h: Awaited<ReturnType<typeof setup>>, seat: string, rounds = 8,
    ) => {
      await h.setLocalSittingIn(seat);
      for (let i = 0; i < rounds; i++) await churn(h, seat, TS + i);
    };

    it('publishes the seat exactly ONCE on a successful arrival', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();
        publishDelayMs = 4_000; // in flight across every re-render below

        await sitWithChurnWhileInFlight(h, SEAT);
        // The flood happened HERE, before the publish ever resolved.
        expect(seatAttempts()).toHaveLength(1);

        await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
        expect(seatAttempts()).toHaveLength(1);
        expect(sitPublishes()).toHaveLength(1);

        // ...and still one after it has settled and churn continues.
        for (let i = 0; i < 8; i++) await churn(h, SEAT, TS + 50 + i);
        expect(seatAttempts()).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('schedules NO retry timer after a successful publish', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();
        publishDelayMs = 200;

        await h.setLocalSittingIn(SEAT);
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        expect(sitPublishes()).toHaveLength(1);

        // If a retry were pending it would fire within 1.2 s; 10 s is generous.
        await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
        expect(seatAttempts()).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops immediately after the first success: one failure then success = 2 attempts', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();
        // Delay 0 here on purpose: this test is about the RETRY LADDER, which is
        // driven by the 1.2 s timer. Keeping publishes instant makes the ladder
        // deterministic; in-flight churn is covered by the tests above.
        publishFailuresRemaining = 1;

        await h.setLocalSittingIn(SEAT);
        await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
        expect(seatAttempts()).toHaveLength(2);
        expect(sitPublishes()).toHaveLength(1);

        // And nothing further, under churn or over time.
        for (let i = 0; i < 5; i++) await churn(h, SEAT, TS + 100 + i);
        await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
        expect(seatAttempts()).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops at the configured bound when every attempt fails', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();
        // Delay 0: deterministic retry ladder, as above.
        publishFailuresRemaining = Number.MAX_SAFE_INTEGER;

        await h.setLocalSittingIn(SEAT);
        // Deliberately under HEARTBEAT_INTERVAL_MS: past it the heartbeat
        // legitimately re-advertises the seat (that is the backstop), and this
        // test is about the retry ladder alone.
        await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
        for (let i = 0; i < 5; i++) await churn(h, SEAT, TS + 200 + i);

        // Exactly the bound — not "a lot but finite".
        expect(seatAttempts()).toHaveLength(3);
        expect(sitPublishes()).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('lets movement win: no stale sit retry republishes a seat the player left', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();
        publishFailuresRemaining = 1; // arrival fails, a retry is pending

        await h.setLocalSittingIn(SEAT);
        expect(sitPublishes()).toHaveLength(0);

        // The player walks off before the retry fires.
        publishFailuresRemaining = 0;
        await h.setLocalSittingIn(null);
        const attemptsAtStandUp = seatAttempts().length;

        await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

        // The pending retry must not resurrect the seat behind the movement.
        expect(seatAttempts()).toHaveLength(attemptsAtStandUp);
        expect(sitPublishes()).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('publishes exactly once for the NEW seat when the player changes chairs', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();
        publishDelayMs = 200;
        await sitWithChurnWhileInFlight(h, SEAT, 4);
        // Seat-to-seat always passes through null: the walk stands you up first.
        await h.setLocalSittingIn(null);
        await sitWithChurnWhileInFlight(h, OTHER_SEAT, 4);
        await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

        const seats = sitPublishes().map((e) => JSON.parse(e.content).seatId);
        expect(seats).toEqual([SEAT, OTHER_SEAT]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('leaves the 25 s heartbeat as the ONLY periodic seated publication', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();
        publishDelayMs = 200;
        await sitWithChurnWhileInFlight(h, SEAT);
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        const afterArrival = seatAttempts().length;
        expect(afterArrival).toBe(1);

        // Just over two heartbeat intervals of sitting still, with churn
        // throughout. Anything beyond the heartbeats is a flood.
        for (let i = 0; i < 6; i++) {
          await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
          await churn(h, SEAT, TS + 400 + i);
        }

        const periodic = seatAttempts().length - afterArrival;
        expect(periodic).toBeGreaterThanOrEqual(1);
        expect(periodic).toBeLessThanOrEqual(3); // ~54 s / 25 s, plus slack
      } finally {
        vi.useRealTimers();
      }
    });

    it('still clears the seat on stand-up after a successful sit', async () => {
      // The flood also broke this: with the claim never recorded, the
      // `!sittingIn` branch short-circuited and `clearSit()` never ran, so
      // heartbeats kept advertising a seat the player had walked away from.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();
        publishDelayMs = 200;
        await sitWithChurnWhileInFlight(h, SEAT, 4);
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        await h.setLocalSittingIn(null);

        const before = published.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
        const heartbeats = published.slice(before).map((e) => JSON.parse(e.content));
        expect(heartbeats.length).toBeGreaterThan(0);
        for (const beat of heartbeats) {
          expect('seatId' in beat).toBe(false);
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('legacy publish assertions', () => {
    it('keeps stamping a strictly increasing seq', async () => {
      const h = await setup();
      await h.setLocalSittingIn(SEAT);

      const seqs = published
        .filter((e) => e.kind === 31950)
        .map((e) => JSON.parse(e.content).seq as number);
      expect(seqs.every((n) => typeof n === 'number')).toBe(true);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      expect(new Set(seqs).size).toBe(seqs.length);
    });
  });

  describe('visual occupancy reported to the seats', () => {
    it('reports a remotely occupied seat', async () => {
      const h = await setup();
      expect(occupancy().size).toBe(0);

      await h.push(
        presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT }),
      );

      expect(occupancy()).toEqual(new Set([SEAT]));
    });

    it('reports the local seat and a remote seat under the same canonical ids', async () => {
      const h = await setup(OTHER_SEAT);
      await h.push(
        presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT }),
      );

      expect(occupancy()).toEqual(new Set([SEAT, OTHER_SEAT]));
    });

    it('never reports a decorative chair as occupied', async () => {
      const h = await setup();
      await h.push(
        presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: DECORATIVE }),
      );
      expect(occupancy().size).toBe(0);
    });

    it('releases the seat when the sitter walks away', async () => {
      const h = await setup();
      await h.push(presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT }));
      expect(occupancy()).toEqual(new Set([SEAT]));

      await h.push(presenceEvent({ ts: TS + 1, seq: 2, state: 'moving', at: FLOOR }));
      expect(occupancy().size).toBe(0);
    });

    it('releases the seat when the sitter\'s presence goes STALE', async () => {
      // Nothing in the occupancy layer expires anything: the seat is released
      // purely because the presence GC (NIP-40 window + 5 s) drops the player,
      // which drops their claim. A user who closes their laptop mid-film cannot
      // hold a chair forever, and cannot hold it by any mechanism this module
      // would have to remember to clean up.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const h = await setup();
        await h.push(presenceEvent({ ts: TS, seq: 1, state: 'idle', at: FLOOR, seatId: SEAT }));
        expect(occupancy()).toEqual(new Set([SEAT]));

        // BEFORE the staleness threshold (EXP_SECONDS 35 + 5), the seat is still
        // held. Asserting this first is what makes the next assertion mean
        // "the GC released it" rather than "it was never really there".
        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });
        expect(h.player(), 'still within the presence window').not.toBeNull();
        expect(occupancy()).toEqual(new Set([SEAT]));

        // Past it, with no heartbeat from that player: the presence GC in
        // useIslandPresence drops them from `players`, which drops their claim.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(15_000);
        });
        await act(async () => {});

        expect(h.player()).toBeNull();
        expect(occupancy().size).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('keeps rendering players from clients that never send the field', async () => {
    const h = await setup();

    // Byte-for-byte an old-client payload: no seatId key anywhere.
    const legacy = presenceEvent({ ts: TS, state: 'idle', at: FLOOR });
    expect(legacy.content).not.toContain('seatId');
    await h.push(legacy);

    const el = h.player()!;
    expect(el.hasAttribute('data-seated-in')).toBe(false);
    expect(facingOf(el)).toBe('front');
  });
});
