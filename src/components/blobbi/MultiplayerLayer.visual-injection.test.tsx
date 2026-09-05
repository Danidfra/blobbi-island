/**
 * Stranger-authored colours, proven against the real world layer.
 *
 * A remote player's kind 31124 is the one piece of relay data that reaches a
 * `dangerouslySetInnerHTML` sink: its `base_color` / `secondary_color` /
 * `eye_color` tags are spliced into the V1 SVG artwork as attribute values by
 * `@blobbi-kit/renderer`, which does not escape them. Anything that is not a
 * hex colour must therefore be dropped at the parse boundary, or a stranger
 * can put arbitrary markup into every player's page just by walking in.
 *
 * Harness follows `MultiplayerLayer.names.test.tsx`. The payload is inert on
 * purpose: it only carries a recognisable marker, never a real script.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { IslandSafetyPolicyContext, STANDARD_POLICY } from '@/safety';
import { clearAllRelationships } from '@/player-safety';
import { MultiplayerLayer } from './MultiplayerLayer';
import type { NostrEvent } from '@nostrify/nostrify';

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'localpk' } }),
}));
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: async () => {}, mutate: () => {} }),
}));
vi.mock('@/hooks/useLocation', () => ({ useLocation: () => ({ currentLocation: 'town' }) }));
vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => ({ data: [] }) }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({ useBlobbonautProfile: () => ({ data: {} }) }));
vi.mock('./AccessoryOverlay', () => ({ AccessoryOverlay: () => null }));

const REMOTE = 'a'.repeat(64);
const REMOTE_KEY = `${REMOTE}:abc`;
const BLOBBI_D = 'blobbi-remote';

/** Breaks out of the `style="stop-color:…"` attribute the colour lands in. */
const MARKER = 'blobbi-injection-probe';
const HOSTILE_COLOR = `"><b data-probe="${MARKER}"><!--`;
const CLEAN_COLOR = '#ff8800';

type Pusher = (event: NostrEvent) => void;
let subscriptions: Array<{ kinds: number[]; push: Pusher }> = [];
let colors = { base: CLEAN_COLOR, secondary: '#ffaa33', eye: '#222222' };

function blobbiStateEvent(): NostrEvent {
  return {
    id: 'b'.repeat(64),
    kind: 31124,
    pubkey: REMOTE,
    created_at: Math.floor(Date.now() / 1000),
    sig: '',
    content: '',
    tags: [
      ['d', BLOBBI_D],
      ['name', 'Rocket'],
      ['stage', 'baby'],
      ['base_color', colors.base],
      ['secondary_color', colors.secondary],
      ['eye_color', colors.eye],
    ],
  };
}

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
    query: async (filters: Array<{ kinds?: number[] }>) =>
      filters[0]?.kinds?.includes(31124) ? [blobbiStateEvent()] : [],
  };
}

let fakeNostr = makeFakeNostr();
vi.mock('@nostrify/react', () => ({ useNostr: () => ({ nostr: fakeNostr }) }));

function presenceEvent(): NostrEvent {
  const ts = Math.floor(Date.now() / 1000);
  return {
    id: `presence-${ts}`,
    kind: 31950,
    pubkey: REMOTE,
    created_at: ts,
    sig: '',
    content: JSON.stringify({
      state: 'idle',
      location: 'town',
      anchor: { x: 40, y: 70, ts },
      blobbiD: BLOBBI_D,
      seq: 1,
    }),
    tags: [
      ['d', 'session:abc'],
      ['a', `31124:${REMOTE}:${BLOBBI_D}`],
      ['t', 'blobbi:presence'],
      ['t', 'island:1'],
      ['t', 'loc:town'],
      ['expiration', String(ts + 35)],
    ],
  };
}

function Harness() {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <IslandSafetyPolicyContext.Provider value={STANDARD_POLICY}>
      <PhotoBoothProvider>
        <MovementBlockerProvider>
          <div ref={containerRef} data-testid="world" data-world-surface>
            <MultiplayerLayer
              containerRef={containerRef}
              currentBlobbiD="local-blobbi"
              startPosition={{ x: 50, y: 66 }}
            />
          </div>
        </MovementBlockerProvider>
      </PhotoBoothProvider>
    </IslandSafetyPolicyContext.Provider>
  );
}

beforeEach(() => {
  subscriptions = [];
  colors = { base: CLEAN_COLOR, secondary: '#ffaa33', eye: '#222222' };
  fakeNostr = makeFakeNostr();
  localStorage.clear();
  clearAllRelationships();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

async function setup() {
  const { container } = render(<Harness />);
  await act(async () => {});
  await act(async () => {});

  const presenceSub = subscriptions.find((s) => s.kinds.includes(31950))!;
  expect(presenceSub).toBeTruthy();

  await act(async () => presenceSub.push(presenceEvent()));
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });

  return {
    container,
    actor: () => container.querySelector(`[data-player-key="${REMOTE_KEY}"]`),
    markup: () => container.innerHTML,
  };
}

describe('a stranger whose 31124 carries hostile colour tags', () => {
  it('never gets markup of their own into the page', async () => {
    colors = { base: HOSTILE_COLOR, secondary: HOSTILE_COLOR, eye: HOSTILE_COLOR };
    const world = await setup();

    // The element the payload tries to create must not exist, and the marker
    // must not survive anywhere in the subtree, text or attribute.
    expect(world.container.querySelector(`[data-probe="${MARKER}"]`)).toBeNull();
    expect(world.markup()).not.toContain(MARKER);
  });

  it('still draws the stranger, from the artwork defaults', async () => {
    colors = { base: HOSTILE_COLOR, secondary: '#ffaa33', eye: '#222222' };
    const world = await setup();
    expect(world.actor()).toBeTruthy();
    expect(world.container.querySelector(`[data-player-key="${REMOTE_KEY}"] svg`)).toBeTruthy();
  });
});

describe('a stranger with ordinary hex colours', () => {
  it('is drawn with them', async () => {
    const world = await setup();
    expect(world.actor()).toBeTruthy();
    expect(world.markup().toLowerCase()).toContain(CLEAN_COLOR);
  });
});
