/**
 * Regression tests for local-watching-remote gaze tracking:
 * MovableBlobbi + MultiplayerLayer (computeNearbyGaze + useIslandPresence)
 * composed exactly like PlayingView, with a scripted remote movement and a
 * manually-driven rAF clock.
 *
 * Bug history (the "start → frozen → jump to final" gaze bug): the attention
 * range threshold gated not just acquisition but also FOLLOWING, so a watched
 * remote walking beyond the radius was dropped mid-movement; the release
 * transition was also never re-rendered. These tests pin the fixed behavior:
 *  1. localAttentionRef.current.targetKey stays set during remote movement
 *  2. livePositionsRef entry for the remote changes every frame
 *  3. the local Blobbi's CSS gaze vars (--blobbi-eye-x/y) track continuously,
 *     including when the target walks beyond the acquisition radius
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { MovableBlobbi } from './MovableBlobbi';
import { MultiplayerLayer } from './MultiplayerLayer';
import { emptyAttention, type AttentionState, type LocalActiveState } from '@/lib/gaze';
import type { Position } from '@/lib/types';
import type { NostrEvent } from '@nostrify/nostrify';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'localpk' } }),
}));

vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: async () => {}, mutate: () => {} }),
}));

vi.mock('@/hooks/useLocation', () => ({
  useLocation: () => ({ currentLocation: 'home' }),
}));

// Stable local-Blobbi data for the real CurrentBlobbiDisplay.
const STABLE_BLOBBIS = [
  {
    id: 'blobbi-1',
    stage: 'baby',
    baseColor: '#ff0000',
    secondaryColor: '#00ff00',
    eyeColor: '#0000ff',
  },
];
const STABLE_BLOBBIS_RESULT = { data: STABLE_BLOBBIS };
const STABLE_PROFILE_RESULT = { data: { currentCompanion: 'blobbi-1' } };
vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => STABLE_BLOBBIS_RESULT }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({
  useBlobbonautProfile: () => STABLE_PROFILE_RESULT,
}));
// The local-player wrapper fetches equipment; give it a stable empty result so
// the real renderer runs without a QueryClient (accessories are not under test).
const STABLE_ACCESSORIES_RESULT = { equipment: [] };
vi.mock('./hooks/useAccessoryManagement', () => ({
  useAccessoryManagement: () => STABLE_ACCESSORIES_RESULT,
}));

// Fake Nostr: capture subscriptions, let the test push events.
type Pusher = (event: NostrEvent) => void;
const subscriptions: Array<{ kinds: number[]; push: Pusher }> = [];

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

// ---------------------------------------------------------------------------
// Manual rAF + performance.now + interval control
// ---------------------------------------------------------------------------
let rafCallbacks: Map<number, FrameRequestCallback>;
let rafId: number;
let now: number;
let intervals: Array<{ fn: () => void; ms: number; last: number }>;

function flushFrame(dt = 16) {
  now += dt;
  // Fire due intervals first (like the event loop would).
  for (const iv of intervals) {
    if (now - iv.last >= iv.ms) {
      iv.last = now;
      iv.fn();
    }
  }
  const cbs = Array.from(rafCallbacks.values());
  rafCallbacks.clear();
  for (const cb of cbs) cb(now);
}

beforeEach(() => {
  rafCallbacks = new Map();
  rafId = 0;
  now = 100000;
  intervals = [];
  subscriptions.length = 0;
  fakeNostr = makeFakeNostr();

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallbacks.set(++rafId, cb);
    return rafId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafCallbacks.delete(id);
  });
  vi.stubGlobal('setInterval', ((fn: () => void, ms: number) => {
    intervals.push({ fn, ms, last: now });
    return intervals.length;
  }) as unknown as typeof setInterval);
  vi.stubGlobal('clearInterval', ((id: number) => {
    if (typeof id === 'number' && intervals[id - 1]) {
      intervals[id - 1] = { fn: () => {}, ms: Infinity, last: now };
    }
  }) as unknown as typeof clearInterval);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function Harness({
  localAttentionRef,
  livePositionsRef,
  localActiveRef,
}: {
  localAttentionRef: React.MutableRefObject<AttentionState>;
  livePositionsRef: React.MutableRefObject<Map<string, Position>>;
  localActiveRef: React.MutableRefObject<LocalActiveState | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <PhotoBoothProvider>
      <MovementBlockerProvider>
        <div ref={containerRef} data-testid="world">
          <MovableBlobbi
            containerRef={containerRef}
            initialPosition={{ x: 50, y: 90 }}
            boundary={{ shape: 'rectangle', x: [0, 100], y: [60, 100] }}
            backgroundFile="home-inside.png"
            localAttentionRef={localAttentionRef}
            livePositionsRef={livePositionsRef}
            localActiveRef={localActiveRef}
          />
          <MultiplayerLayer
            containerRef={containerRef}
            currentBlobbiD="local-blobbi"
            startPosition={{ x: 50, y: 90 }}
            localAttentionRef={localAttentionRef}
            livePositionsRef={livePositionsRef}
            localActiveRef={localActiveRef}
          />
        </div>
      </MovementBlockerProvider>
    </PhotoBoothProvider>
  );
}

function presenceMoveEvent(opts: {
  from: Position;
  to: Position;
  ts: number;
}): NostrEvent {
  const { from, to, ts } = opts;
  return {
    id: `evt-${ts}-${Math.random()}`,
    kind: 31950,
    pubkey: 'remotepk',
    created_at: ts,
    sig: '',
    content: JSON.stringify({
      state: 'moving',
      location: 'home',
      anchor: { x: from.x, y: from.y, ts },
      goal: { from, to, v: 120, ts },
      blobbiD: 'remote-blobbi',
    }),
    tags: [
      ['d', 'session:abc'],
      ['a', '31124:remotepk:remote-blobbi'],
      ['t', 'blobbi:presence'],
      ['t', 'island:1'],
      ['t', 'loc:home'],
      ['expiration', String(ts + 35)],
    ],
  };
}

describe('local-watching-remote gaze tracking', () => {
  it('tracks a moving remote continuously (targetKey, live pos, CSS vars)', async () => {
    const localAttentionRef = { current: emptyAttention() };
    const livePositionsRef = { current: new Map<string, Position>() };
    const localActiveRef = { current: null as LocalActiveState | null };

    const { container } = render(
      <Harness
        localAttentionRef={localAttentionRef}
        livePositionsRef={livePositionsRef}
        localActiveRef={localActiveRef}
      />
    );

    // Give the world container a real size for percent<->pixel math.
    const world = container.querySelector('[data-testid="world"]') as HTMLElement;
    vi.spyOn(world, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 1000,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 1000,
      toJSON: () => ({}),
    } as DOMRect);

    // Let async init settle (presence login -> subscription).
    await act(async () => {});
    await act(async () => {});

    const presenceSub = subscriptions.find((s) => s.kinds.includes(31950));
    expect(presenceSub, 'presence subscription should exist').toBeTruthy();

    // Remote spawns at the location spawn point (50,75) and walks to (58,82).
    // Local sits at (50,90): the direction from local to remote changes from
    // (0,-1) toward (0.71,-0.71) over the move, and stays within the 18-unit
    // attention range the whole time.
    const ts = Math.floor(Date.now() / 1000);
    await act(async () => {
      presenceSub!.push(presenceMoveEvent({ from: { x: 50, y: 75 }, to: { x: 58, y: 82 }, ts }));
    });
    // Allow the async event processing (visual fetch await) to finish.
    await act(async () => {});

    const KEY = 'remotepk:abc';

    const findGazeWrapper = (): HTMLElement | null => {
      const els = container.querySelectorAll<HTMLElement>('div');
      for (const el of Array.from(els)) {
        // Pick the LOCAL blobbi's wrapper: it sits inside .blobbi-character.
        if (
          el.style.getPropertyValue('--blobbi-eye-x') !== '' &&
          el.closest('.blobbi-character')
        ) {
          return el;
        }
      }
      return null;
    };

    const samples: Array<{
      frame: number;
      targetKey: string | null;
      livePos: string;
      cssVars: string;
    }> = [];

    // ~2.4s of animation = 150 frames; remote needs ~1.5s to cover ~178px.
    for (let f = 0; f < 150; f++) {
      await act(async () => {
        flushFrame();
      });
      if (f % 10 === 0) {
        const live = livePositionsRef.current.get(KEY);
        const wrapper = findGazeWrapper();
        samples.push({
          frame: f,
          targetKey: localAttentionRef.current.targetKey,
          livePos: live ? `${live.x.toFixed(2)},${live.y.toFixed(2)}` : 'MISSING',
          cssVars: wrapper
            ? `${Number(wrapper.style.getPropertyValue('--blobbi-eye-x')).toFixed(3)},${Number(
                wrapper.style.getPropertyValue('--blobbi-eye-y')
              ).toFixed(3)}`
            : 'NO-WRAPPER',
        });
      }
    }

    // 1. targetKey must be continuously set during the movement window.
    const during = samples.filter((s) => s.frame >= 30 && s.frame <= 80);
    expect(during.every((s) => s.targetKey === KEY), 'targetKey should stay set').toBe(true);

    // 2. live position must change between samples while moving.
    const livePositions = new Set(during.map((s) => s.livePos));
    expect(livePositions.size, 'live position should change').toBeGreaterThan(3);

    // 3. CSS vars must change between samples while moving.
    const cssVars = new Set(during.map((s) => s.cssVars));
    expect(cssVars.size, 'CSS gaze vars should change').toBeGreaterThan(3);
  });

  it('keeps following a watched remote beyond the acquisition radius, then releases after it stops', async () => {
    const localAttentionRef = { current: emptyAttention() };
    const livePositionsRef = { current: new Map<string, Position>() };
    const localActiveRef = { current: null as LocalActiveState | null };

    const { container } = render(
      <Harness
        localAttentionRef={localAttentionRef}
        livePositionsRef={livePositionsRef}
        localActiveRef={localActiveRef}
      />
    );

    const world = container.querySelector('[data-testid="world"]') as HTMLElement;
    vi.spyOn(world, 'getBoundingClientRect').mockReturnValue({
      width: 1000, height: 1000, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 1000,
      toJSON: () => ({}),
    } as DOMRect);

    await act(async () => {});
    await act(async () => {});
    const presenceSub = subscriptions.find((s) => s.kinds.includes(31950));
    expect(presenceSub, 'presence subscription should exist').toBeTruthy();

    // Local at (50,90). Remote spawns at (50,75) (dist 15, IN acquisition
    // range) and walks along the room to (90,74): a ~3.3s walk that crosses
    // the 18-unit radius at x≈58 (~0.75s in) and continues OUT of range for
    // far longer than the 1.5s ATTENTION_HOLD. Pre-fix, attention released
    // mid-walk (hold expired while the target was still moving) and the eyes
    // froze; post-fix the gaze follows the whole movement.
    const ts = Math.floor(Date.now() / 1000);
    await act(async () => {
      presenceSub!.push(presenceMoveEvent({ from: { x: 50, y: 75 }, to: { x: 90, y: 74 }, ts }));
    });
    await act(async () => {});

    const KEY = 'remotepk:abc';
    const findGazeWrapper = (): HTMLElement | null => {
      const els = container.querySelectorAll<HTMLElement>('div');
      for (const el of Array.from(els)) {
        if (
          el.style.getPropertyValue('--blobbi-eye-x') !== '' &&
          el.closest('.blobbi-character')
        ) {
          return el;
        }
      }
      return null;
    };

    const samples: Array<{ frame: number; targetKey: string | null; cssVars: string; live: string }> = [];
    // ~8s: the walk takes ~3.3s, hold is 1.5s, then release + idle aftermath.
    for (let f = 0; f < 480; f++) {
      await act(async () => {
        flushFrame();
      });
      if (f % 10 === 0) {
        const wrapper = findGazeWrapper();
        const live = livePositionsRef.current.get(KEY);
        samples.push({
          frame: f,
          targetKey: localAttentionRef.current.targetKey,
          live: live ? `${live.x.toFixed(2)},${live.y.toFixed(2)}` : 'MISSING',
          cssVars: wrapper
            ? `${Number(wrapper.style.getPropertyValue('--blobbi-eye-x')).toFixed(3)},${Number(
                wrapper.style.getPropertyValue('--blobbi-eye-y')
              ).toFixed(3)}`
            : 'NO-WRAPPER',
        });
      }
    }

    // While the remote walks BEYOND the acquisition radius, and beyond the
    // point where the pre-fix hold would have expired (~frame 135): the gaze
    // must keep following: targetKey stays set and the eyes keep changing.
    // (Pre-fix, attention released mid-walk and the eyes froze here.)
    const beyond = samples.filter((s) => s.frame >= 150 && s.frame <= 190);
    expect(beyond.every((s) => s.targetKey === KEY), 'should follow beyond radius').toBe(true);
    const beyondLive = new Set(beyond.map((s) => s.live));
    expect(beyondLive.size, 'remote should still be walking in this window').toBeGreaterThan(2);
    const beyondVars = new Set(beyond.map((s) => s.cssVars));
    expect(beyondVars.size, 'eyes should keep tracking beyond radius').toBeGreaterThan(2);

    // After the remote stops (~frame 200) + 1.5s hold, attention must release...
    const tail = samples[samples.length - 1];
    expect(tail.targetKey, 'attention should release after the stop+hold').toBe(null);

    // ...and the release must actually be RENDERED: the eyes return to idle
    // instead of staying frozen on the attention direction toward the stop
    // point. That direction has y ≈ -0.4 with x ≈ +0.9; idle gaze x stays in
    // [-0.85, 0.85] and mostly near neutral, so requiring the eyes to have
    // left the attention direction is robust.
    const [tailX, tailY] = tail.cssVars.split(',').map(Number);
    const stop = livePositionsRef.current.get(KEY);
    if (stop) {
      const dx = stop.x - 50;
      const dy = stop.y - 90;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const frozen =
        Math.abs(tailX - dx / len) < 0.02 && Math.abs(tailY - dy / len) < 0.02;
      expect(frozen, 'eyes should leave the stale attention direction').toBe(false);
    }
  });
});
