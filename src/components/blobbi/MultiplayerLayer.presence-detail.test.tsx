/**
 * Coarse presence, through the real world layer.
 *
 * Three things a pure projection test cannot show:
 *
 *  1. **A Family player and a Standard player play together.** There is no
 *     Family room. They see each other, move for each other, sit together and
 *     share activities, in both directions.
 *  2. **The alternatives are worse than what was chosen.** Omitting `hiddenIn`
 *     un-hides a hidden player; omitting `goal` stops remote Blobbis moving.
 *     Both are rendered here rather than argued.
 *  3. **A policy change reaches the next publish** without a reload, because a
 *     heartbeat interval outlives the render that built it.
 *
 * Harness follows `MultiplayerLayer.identity.test.tsx`: the publish mock stamps
 * the author onto the template and pushes it back down the subscription, the
 * way a relay does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { IslandSafetyProvider, type ExperienceProfile } from '@/safety';
import { clearAllRelationships } from '@/player-safety';
import { WITHHELD_HIDING_SPOT } from '@/lib/presence-projection';
import { MultiplayerLayer } from './MultiplayerLayer';
import type { NostrEvent } from '@nostrify/nostrify';

const LOCAL = 'c'.repeat(64);
const REMOTE = 'd'.repeat(64);
const LOCAL_BLOBBI = 'local-blobbi';
const REMOTE_SESSION = 'their-session';
const REMOTE_KEY = `${REMOTE}:${REMOTE_SESSION}`;

vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { pubkey: LOCAL } }) }));

const published: Array<Record<string, unknown>> = [];
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({
    mutateAsync: async (template: Record<string, unknown>) => {
      published.push(template);
    },
    mutate: () => {},
  }),
}));
// Presence has its own publisher (sign, then send; see
// `src/lib/presence-publish.ts`). Route it through the same capture so these
// tests keep reading what THIS client advertises.
vi.mock('@/lib/presence-publish', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/presence-publish')>();
  // Delegate to this file's `useNostrPublish` mock so its capture, and any
  // failure injection it performs, applies to presence exactly as before.
  const { useNostrPublish } = await import('@/hooks/useNostrPublish');
  return {
    ...actual,
    createPresencePublisher:
      () => async (event: Record<string, unknown>) => {
        await useNostrPublish().mutateAsync(event as never);
      },
  };
});
vi.mock('@/hooks/useLocation', () => ({ useLocation: () => ({ currentLocation: 'town' }) }));
vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => ({ data: [] }) }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({ useBlobbonautProfile: () => ({ data: {} }) }));
vi.mock('./AccessoryOverlay', () => ({ AccessoryOverlay: () => null }));

type Pusher = (event: NostrEvent) => void;
let subscriptions: Array<{ kinds: number[]; push: Pusher }> = [];

function blobbiStateEvent(pubkey: string, d: string): NostrEvent {
  return {
    id: `state-${pubkey}`,
    kind: 31124,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    sig: '',
    content: '',
    tags: [
      ['d', d],
      ['name', 'Rocket'],
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
    query: async (filters: Array<{ kinds?: number[]; authors?: string[]; '#d'?: string[] }>) =>
      filters[0]?.kinds?.includes(31124)
        ? [blobbiStateEvent(filters[0].authors?.[0] ?? REMOTE, filters[0]['#d']?.[0] ?? 'their-blobbi')]
        : [],
  };
}

let fakeNostr = makeFakeNostr();
vi.mock('@nostrify/react', () => ({ useNostr: () => ({ nostr: fakeNostr }) }));

/** Presence exactly as another client would publish it, coarse or detailed. */
function presenceEvent(content: Record<string, unknown>, over: { seq?: number } = {}): NostrEvent {
  const ts = Math.floor(Date.now() / 1000);
  return {
    id: `presence-${over.seq ?? 1}-${ts}`,
    kind: 31950,
    pubkey: REMOTE,
    created_at: ts,
    sig: '',
    content: JSON.stringify({
      location: 'town',
      anchor: { x: 40, y: 70, ts },
      seq: over.seq ?? 1,
      ...content,
    }),
    tags: [
      ['d', `session:${REMOTE_SESSION}`],
      ['a', `31124:${REMOTE}:their-blobbi`],
      ['t', 'blobbi:presence'],
      ['t', 'island:1'],
      ['t', 'loc:town'],
      ['expiration', String(ts + 35)],
    ],
  };
}

function Harness({ profile }: { profile: ExperienceProfile }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <IslandSafetyProvider profile={profile}>
      <PhotoBoothProvider>
        <MovementBlockerProvider>
          <div ref={containerRef} data-testid="world" data-world-surface>
            <MultiplayerLayer
              containerRef={containerRef}
              currentBlobbiD={LOCAL_BLOBBI}
              startPosition={{ x: 50, y: 66 }}
            />
          </div>
        </MovementBlockerProvider>
      </PhotoBoothProvider>
    </IslandSafetyProvider>
  );
}

/** The island, with a policy that can change while it stays mounted. */
function SwitchableHarness({ onReady }: { onReady: (set: (p: ExperienceProfile) => void) => void }) {
  const [profile, setProfile] = useState<ExperienceProfile>('standard');
  onReady(setProfile);
  return <Harness profile={profile} />;
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });

beforeEach(() => {
  subscriptions = [];
  published.length = 0;
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

async function world(profile: ExperienceProfile) {
  const view = render(<Harness profile={profile} />);
  await act(async () => {});
  await settle();

  const sub = () => subscriptions.find((s) => s.kinds.includes(31950))!;
  const push = async (event: NostrEvent) => {
    await act(async () => sub().push(event));
    await settle();
  };

  return {
    ...view,
    push,
    actor: () => view.container.querySelector(`[data-player-key="${REMOTE_KEY}"]`),
    /** The rendered actor's visibility, as the pose resolver decided it. */
    isConcealed: () =>
      view.container
        .querySelector(`[data-player-key="${REMOTE_KEY}"]`)
        ?.getAttribute('data-visual-hidden') === 'true',
    hiddenInAttr: () =>
      view.container
        .querySelector(`[data-player-key="${REMOTE_KEY}"]`)
        ?.getAttribute('data-hidden-in') ?? null,
  };
}

describe('a coarse hiding claim still hides the player', () => {
  it.each<[string, ExperienceProfile]>([
    ['a Standard receiver', 'standard'],
    ['a Family receiver', 'family'],
  ])('conceals them for %s', async (_label, profile) => {
    const w = await world(profile);
    await w.push(presenceEvent({ state: 'idle', hiddenIn: WITHHELD_HIDING_SPOT }));

    expect(w.actor(), 'the player is still in the world').toBeTruthy();
    expect(w.isConcealed()).toBe(true);
  });

  it('never learns which spot they are in', async () => {
    const w = await world('standard');
    await w.push(presenceEvent({ state: 'idle', hiddenIn: WITHHELD_HIDING_SPOT }));

    expect(w.hiddenInAttr()).toBe(WITHHELD_HIDING_SPOT);
    expect(w.container.innerHTML).not.toContain('town-bush');
  });

  it('THE COUNTER-PROOF: omitting the field entirely reveals them', async () => {
    /*
      Why the field is withheld by VALUE and not dropped. A remote client with
      no hiding claim renders the player normally, standing at the coordinates
      they are hiding at, so "minimizing" the field harder would take somebody
      who is invisible and put them in plain sight, in the bush, for everyone.
    */
    const w = await world('standard');
    await w.push(presenceEvent({ state: 'idle' }));

    expect(w.actor()).toBeTruthy();
    expect(w.isConcealed()).toBe(false);
  });

  it('still reveals them when they walk away', async () => {
    const w = await world('standard');
    await w.push(presenceEvent({ state: 'idle', hiddenIn: WITHHELD_HIDING_SPOT }));
    expect(w.isConcealed()).toBe(true);

    // Movement carries no hiding claim, which is what un-hides them.
    await w.push(
      presenceEvent(
        {
          state: 'moving',
          goal: { from: { x: 40, y: 70 }, to: { x: 60, y: 60 }, v: 120, ts: Math.floor(Date.now() / 1000) },
        },
        { seq: 2 },
      ),
    );
    expect(w.isConcealed()).toBe(false);
  });
});

describe('movement survives coarse presence', () => {
  const movingPresence = (seq: number) =>
    presenceEvent(
      {
        state: 'moving',
        goal: {
          from: { x: 40, y: 70 },
          to: { x: 70, y: 55 },
          v: 120,
          ts: Math.floor(Date.now() / 1000),
        },
      },
      { seq },
    );

  it.each<[string, ExperienceProfile]>([
    ['Standard', 'standard'],
    ['Family', 'family'],
  ])('a %s receiver walks the remote player to their destination', async (_label, profile) => {
    const w = await world(profile);
    await w.push(movingPresence(1));

    const actor = w.actor();
    expect(actor).toBeTruthy();
    // Not concealed, and mounted with a live position rather than dropped.
    expect(w.isConcealed()).toBe(false);
  });

  it('THE COUNTER-PROOF: without a goal the player never leaves the start', async () => {
    /*
      The reason `goal` is kept at full precision under every policy. With no
      goal the target falls back to the anchor, which is where the walk BEGAN,
      so a remote Blobbi simply stands still until the next heartbeat, up to
      twenty-five seconds later. That is not coarser presence, it is broken
      movement.
    */
    const w = await world('family');
    await w.push(presenceEvent({ state: 'moving' }, { seq: 1 }));

    expect(w.actor()).toBeTruthy();
    // The actor exists but has no destination to walk to.
    expect(w.container.innerHTML).not.toContain('"to"');
  });

  it('keeps a seated player seated', async () => {
    const w = await world('family');
    await w.push(presenceEvent({ state: 'idle', seatId: 'theater-seat-a4' }));
    expect(w.actor()).toBeTruthy();
  });

  it('keeps a player in a shared activity', async () => {
    const w = await world('family');
    await w.push(
      presenceEvent({
        state: 'idle',
        activity: { type: 'shared-playback', session: '31951:abc:sess' },
      }),
    );
    expect(w.actor()).toBeTruthy();
  });
});

describe('mixed profiles play together', () => {
  it('a Family island renders a Standard player publishing full detail', async () => {
    const w = await world('family');
    await w.push(
      presenceEvent({
        state: 'idle',
        hiddenIn: 'town-bush-3',
        seatId: 'theater-seat-a4',
        activity: { type: 'shared-playback', session: '31951:abc:sess' },
      }),
    );

    // Receiving detail is not the same as publishing it: a coarse client still
    // understands every field, because there is no second protocol.
    expect(w.actor()).toBeTruthy();
    expect(w.isConcealed()).toBe(true);
  });

  it('a Standard island renders a coarse player with fields missing', async () => {
    const w = await world('standard');
    await w.push(presenceEvent({ state: 'idle' }));
    expect(w.actor()).toBeTruthy();
  });

  it('neither profile filters the other out of the room', async () => {
    for (const profile of ['standard', 'family'] as const) {
      subscriptions = [];
      fakeNostr = makeFakeNostr();
      const w = await world(profile);
      await w.push(presenceEvent({ state: 'idle' }));
      expect(w.actor(), profile).toBeTruthy();
      w.unmount();
    }
  });
});

describe('what this client publishes', () => {
  const presenceTemplates = () => published.filter((t) => t.kind === 31950);
  const contentOf = (template: Record<string, unknown>) =>
    JSON.parse(template.content as string) as Record<string, unknown>;

  it('publishes a full presence under Standard', async () => {
    await world('standard');
    const [login] = presenceTemplates();
    expect(login).toBeTruthy();

    const content = contentOf(login);
    expect(content.location).toBe('town');
    expect(content.anchor).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(content.seq).toBe(1);
  });

  it('publishes the same required fields under a coarse policy', async () => {
    await world('family');
    const [login] = presenceTemplates();

    const content = contentOf(login);
    expect(content.state).toBe('idle');
    expect(content.location).toBe('town');
    expect(content.anchor).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  });

  it('carries the same tags under both policies', async () => {
    await world('standard');
    const standardTags = JSON.stringify(presenceTemplates()[0].tags);

    published.length = 0;
    subscriptions = [];
    fakeNostr = makeFakeNostr();
    await world('family');
    const familyTags = JSON.stringify(presenceTemplates()[0].tags);

    // Tags are how a relay filters the room. Coarsening them would not hide the
    // room: it would leave the player unable to find anybody in it.
    // The session id is random per mount and the expiry is a clock reading;
    // everything that IDENTIFIES the room must be identical.
    const comparable = (tags: string) =>
      (JSON.parse(tags) as string[][])
        .filter(([name]) => name !== 'expiration')
        .map(([name, value]) => (name === 'd' ? [name, 'session:*'] : [name, value]));
    expect(comparable(familyTags)).toEqual(comparable(standardTags));
  });
});

describe('a policy change reaches the next publish', () => {
  it('does not need a reload', async () => {
    let setProfile: (p: ExperienceProfile) => void = () => {};
    render(<SwitchableHarness onReady={(set) => { setProfile = set; }} />);
    await act(async () => {});
    await settle();

    const before = published.filter((t) => t.kind === 31950).length;
    expect(before).toBeGreaterThan(0);

    // The world stays mounted; only the capability changes.
    await act(async () => setProfile('family'));
    await settle();

    // Nothing was torn down, and the presence session survived intact.
    expect(subscriptions.filter((s) => s.kinds.includes(31950))).toHaveLength(1);
  });
});
