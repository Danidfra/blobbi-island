/**
 * Stranger names, proven against the real world layer.
 *
 * A pure resolver test proves the rule; this proves the WIRING — that the
 * authored text does not survive anywhere on the way to a screen. The
 * assertions deliberately search the whole rendered subtree's markup rather
 * than one element, because the ways a name leaks are exactly the ones nobody
 * lists: `title`, `aria-label`, a tooltip, a hidden screen-reader span, a
 * `data-` attribute added next month.
 *
 * Harness follows `MultiplayerLayer.hiding.test.tsx`.
 *
 * These mount a POLICY rather than a profile. The shipped Family policy now
 * permits stranger-authored names — a deferred product decision, see
 * `docs/safe-user-authored-names.md` — so a test keyed on the profile name
 * would prove only what today's literals happen to say. The rule under test is
 * the capability, and a hand-built policy is how you state it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import {
  FAMILY_POLICY,
  IslandSafetyPolicyContext,
  STANDARD_POLICY,
  type IslandSafetyPolicy,
} from '@/safety';
import { safeBlobbiAlias } from '@/blobbi-names';
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

/** What a hostile player might put in a 32-character name field. */
const HOSTILE_NAME = 'add me on some-other-app';
const CLEAN_NAME = 'Rocket';

type Pusher = (event: NostrEvent) => void;
let subscriptions: Array<{ kinds: number[]; push: Pusher }> = [];
/** The kind 31124 the visual fetch will find. */
let blobbiName = CLEAN_NAME;

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
      ['name', blobbiName],
      ['stage', 'baby'],
      ['base_color', '#ff8800'],
      ['secondary_color', '#ffaa33'],
      ['eye_color', '#222222'],
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
    // The visual fetch queries kind 31124 for the remote Blobbi.
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

/** A curated experience that also withholds stranger names. */
const NO_AUTHORED_NAMES: IslandSafetyPolicy = Object.freeze({
  ...FAMILY_POLICY,
  strangerAuthoredNames: false,
});

function Harness({ policy }: { policy: IslandSafetyPolicy }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <IslandSafetyPolicyContext.Provider value={policy}>
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
  blobbiName = CLEAN_NAME;
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

async function setup(policy: IslandSafetyPolicy) {
  const { container } = render(<Harness policy={policy} />);
  await act(async () => {});
  await act(async () => {});

  const presenceSub = subscriptions.find((s) => s.kinds.includes(31950))!;
  expect(presenceSub).toBeTruthy();

  await act(async () => presenceSub.push(presenceEvent()));
  // The visual fetch is async; let it resolve and re-render.
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });

  return {
    container,
    actor: () => container.querySelector(`[data-player-key="${REMOTE_KEY}"]`),
    /** Everything rendered — text, attributes, hidden nodes alike. */
    markup: () => container.innerHTML,
  };
}

describe('an experience that permits authored names', () => {
  it('shows the name the stranger chose', async () => {
    const world = await setup(STANDARD_POLICY);
    expect(world.actor()).toBeTruthy();
    expect(world.markup()).toContain(CLEAN_NAME);
  });

  it('shows it in the label, its title and its aria-label', async () => {
    const world = await setup(STANDARD_POLICY);
    const label = world.container.querySelector(`[aria-label="${CLEAN_NAME}"]`);
    expect(label).toBeTruthy();
    expect(label?.getAttribute('title')).toBe(CLEAN_NAME);
  });

  it('is unchanged for a hostile name — this phase does not censor it', async () => {
    blobbiName = HOSTILE_NAME;
    const world = await setup(STANDARD_POLICY);
    expect(world.markup()).toContain('some-other-app');
  });

  it('includes the CURRENT Family policy, which permits them again', async () => {
    // The shipped answer today, asserted so that changing it back is a
    // deliberate act with a test to update rather than a quiet literal edit.
    // The mechanism below still works; this profile simply does not select it.
    expect(FAMILY_POLICY.strangerAuthoredNames).toBe(true);

    const world = await setup(FAMILY_POLICY);
    expect(world.markup()).toContain(CLEAN_NAME);
    expect(world.markup()).not.toContain(safeBlobbiAlias(REMOTE));
  });
});

describe('an experience that does not permit authored names', () => {
  // No shipped profile selects this today. The boundary is kept alive against a
  // policy that does, so the day one is wanted it is a literal change and not a
  // rebuild.
  it('never renders the authored name anywhere in the subtree', async () => {
    blobbiName = HOSTILE_NAME;
    const world = await setup(NO_AUTHORED_NAMES);

    // The whole markup: text nodes, title, aria-label, data attributes, hidden
    // spans. If it is anywhere, it can reach somebody.
    expect(world.markup()).not.toContain('some-other-app');
    expect(world.markup()).not.toContain(HOSTILE_NAME);
  });

  it('withholds even a perfectly clean authored name', async () => {
    // `strangerAuthoredNames: false` means never, not "unless it looks fine" —
    // a filter would have passed the hostile one above.
    const world = await setup(NO_AUTHORED_NAMES);
    expect(world.markup()).not.toContain(CLEAN_NAME);
  });

  it('renders the deterministic alias instead', async () => {
    const world = await setup(NO_AUTHORED_NAMES);
    expect(world.markup()).toContain(safeBlobbiAlias(REMOTE));
  });

  it('uses the alias for the accessible name and the tooltip too', async () => {
    blobbiName = HOSTILE_NAME;
    const world = await setup(NO_AUTHORED_NAMES);

    const alias = safeBlobbiAlias(REMOTE);
    const label = world.container.querySelector(`[aria-label="${alias}"]`);
    expect(label).toBeTruthy();
    expect(label?.getAttribute('title')).toBe(alias);
  });

  it('keeps the player visible — the name is substituted, not the person', async () => {
    const world = await setup(NO_AUTHORED_NAMES);
    expect(world.actor()).toBeTruthy();
  });

  it('gives the same stranger the same alias every time', async () => {
    const first = await setup(NO_AUTHORED_NAMES);
    const alias = safeBlobbiAlias(REMOTE);
    expect(first.markup()).toContain(alias);

    subscriptions = [];
    fakeNostr = makeFakeNostr();
    const second = await setup(NO_AUTHORED_NAMES);
    expect(second.markup()).toContain(alias);
  });

  it('substitutes a missing name rather than showing a placeholder', async () => {
    blobbiName = '';
    const world = await setup(NO_AUTHORED_NAMES);
    expect(world.markup()).toContain(safeBlobbiAlias(REMOTE));
    expect(world.markup()).not.toContain('Unnamed Blobbi');
  });
});
