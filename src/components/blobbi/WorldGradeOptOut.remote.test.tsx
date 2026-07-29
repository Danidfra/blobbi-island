/**
 * The world-grade opt-out contract for REMOTE players, against real presence-driven
 * markup.
 *
 * Separate from `WorldGradeOptOut.test.tsx` because driving a real remote player
 * requires mocking `@nostrify/react`, and that mock is incompatible with `TestApp`
 * (which imports the real login provider from the same module). Mock shape copied
 * from `MultiplayerLayer.hiding.test.tsx`, the existing fixture for this component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef } from 'react';

import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { MultiplayerLayer } from './MultiplayerLayer';
import type { NostrEvent } from '@nostrify/nostrify';

const EXCLUDE_ON_WRAPPER = "[data-island-world-graded] [data-island-world-grade='exclude'] img";

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'localpk' } }),
}));
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: async () => {}, mutate: () => {} }),
}));
vi.mock('@/hooks/useLocation', () => ({
  useLocation: () => ({ currentLocation: 'town' }),
}));
vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => ({ data: [] }) }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({
  useBlobbonautProfile: () => ({ data: {} }),
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

const REMOTE_KEY = 'remotepk:abc';

function presenceEvent(ts: number): NostrEvent {
  return {
    id: `evt-${ts}`,
    kind: 31950,
    pubkey: 'remotepk',
    created_at: ts,
    sig: '',
    content: JSON.stringify({
      state: 'idle',
      location: 'town',
      anchor: { x: 40, y: 70, ts },
      blobbiD: 'remote-blobbi',
      seq: 1,
    }),
    tags: [
      ['d', 'session:abc'],
      ['a', '31124:remotepk:remote-blobbi'],
      ['t', 'blobbi:presence'],
      ['t', 'island:1'],
      ['t', 'loc:town'],
      ['expiration', String(ts + 35)],
    ],
  };
}

describe('remote players', () => {
  beforeEach(() => {
    subscriptions = [];
    fakeNostr = makeFakeNostr();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function Harness() {
    const containerRef = useRef<HTMLDivElement>(null);
    return (
      <PhotoBoothProvider>
        <MovementBlockerProvider>
          <div ref={containerRef} data-world-surface data-island-world-graded="">
            <MultiplayerLayer
              containerRef={containerRef}
              currentBlobbiD="local-blobbi"
              startPosition={{ x: 50, y: 66 }}
            />
          </div>
        </MovementBlockerProvider>
      </PhotoBoothProvider>
    );
  }

  async function setup() {
    const view = render(<Harness />);
    await act(async () => {
      await Promise.resolve();
    });
    const presence = subscriptions.find((s) => s.kinds.includes(31950));
    await act(async () => {
      presence?.push(presenceEvent(Math.floor(Date.now() / 1000)));
      await Promise.resolve();
    });
    return view;
  }

  it('marks a real presence-driven player wrapper as excluded', async () => {
    const { container } = await setup();
    const player = container.querySelector(`[data-player-key="${REMOTE_KEY}"]`);
    expect(player, 'no remote player rendered — fixture problem, not a contract one').not.toBeNull();
    expect(player).toHaveAttribute('data-island-world-grade', 'exclude');
  });

  it('excludes every image in the real player subtree, accessories included', async () => {
    const { container } = await setup();
    const player = container.querySelector(`[data-player-key="${REMOTE_KEY}"]`)!;
    for (const img of Array.from(player.querySelectorAll('img'))) {
      expect(img.matches(EXCLUDE_ON_WRAPPER), img.getAttribute('src') ?? '').toBe(true);
    }
    // …and the wrapper is what carries it, so any image added later is covered too.
    expect(player.matches("[data-island-world-grade='exclude']")).toBe(true);
  });

  it('does not disturb pointer behaviour or stacking on the player wrapper', async () => {
    // The exclusion is a data attribute and a `filter: none`: it must not have
    // changed hit-testing, hover or z-order.
    const { container } = await setup();
    const player = container.querySelector<HTMLElement>(`[data-player-key="${REMOTE_KEY}"]`)!;
    expect(player.className).toContain('group');
    expect(player.style.zIndex).not.toBe('');
    expect(player.style.transform).toContain('translate');
    // The sprite inside still re-enables pointer events for the click target.
    expect(player.querySelector('[data-block-move]')).not.toBeNull();
  });
});
