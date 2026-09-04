/**
 * The reload/resume decision matrix, and the proof that it and remote-player
 * visibility run on ONE presence-lifetime rule.
 *
 * The boundary tests here are the load-bearing ones. `isPresenceAlive` is a
 * strict `>`, so a presence whose expiration equals `now` is spent. Relaxing it
 * to `>=` to make a resume test pass would silently widen how long every remote
 * Blobbi stays on screen, which is exactly the coupling these tests exist to
 * make visible.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  resolveInitialIslandLocation,
  isRenderableLocation,
  DEFAULT_ISLAND_LOCATION,
} from './location-resume';
import { EXP_SECONDS, explainPresenceEvent, isPresenceAlive } from './multiplayer';
import { groundToWireCenter } from './presence-ground';
import { locationBoundaries } from './location-boundaries';
import { getBackgroundForLocation } from './location-backgrounds';
import { constrainPosition } from './boundaries';
import { getBlobbiInitialPosition, resolveActorSpawn } from './location-initial-position';
import type { RelayReadOutcome } from './relay-read';

const PLAYER = 'a'.repeat(64);
const NOW = 1_800_000_000;
const ISLAND = '1';

interface PresenceOptions {
  location?: string;
  /** Overrides `location` in the `loc:` tag only, to model a disagreement. */
  tagLocation?: string;
  createdAt?: number;
  island?: string;
  session?: string;
  id?: string;
  /** Omit tags to model structurally unusable presence. */
  omit?: ReadonlyArray<'d' | 'presence' | 'island' | 'loc' | 'expiration'>;
  /** The stationary GROUND position the player published (converted to wire). */
  at?: { x: number; y: number };
  /** A walk in progress: GROUND destination, published as `goal.to`. */
  walkingTo?: { x: number; y: number };
  /** Raw content override, for malformed-payload cases. */
  rawContent?: unknown;
}

/**
 * A presence event shaped exactly like `buildPresence31950` writes them,
 * including `expiration = created_at + EXP_SECONDS`, which is the only reason
 * an age in seconds and a lifetime verdict are related at all.
 */
function presence(options: PresenceOptions = {}): NostrEvent {
  const {
    location = 'beach',
    tagLocation = location,
    createdAt = NOW,
    island = ISLAND,
    session = 'session-uuid',
    id = 'e'.repeat(64),
    omit = [],
    at = { x: 50, y: 80 },
    walkingTo,
    rawContent,
  } = options;

  // Positions go on the wire as legacy CENTER points, exactly as
  // `buildPresence31950` writes them. Building them any other way would test a
  // format the app does not publish.
  const wireAnchor = groundToWireCenter(at, location);
  const content =
    rawContent !== undefined
      ? rawContent
      : {
          state: walkingTo ? 'moving' : 'idle',
          location,
          anchor: { ...wireAnchor, ts: createdAt },
          ...(walkingTo
            ? {
                goal: {
                  from: wireAnchor,
                  to: groundToWireCenter(walkingTo, location),
                  v: 120,
                  ts: createdAt,
                },
              }
            : {}),
        };

  const tags: string[][] = [];
  if (!omit.includes('d')) tags.push(['d', `session:${session}`]);
  tags.push(['a', `31124:${PLAYER}:pet`]);
  if (!omit.includes('presence')) tags.push(['t', 'blobbi:presence']);
  if (!omit.includes('island')) tags.push(['t', `island:${island}`]);
  if (!omit.includes('loc')) tags.push(['t', `loc:${tagLocation}`]);
  if (!omit.includes('expiration')) {
    tags.push(['expiration', String(createdAt + EXP_SECONDS)]);
  }

  return {
    id,
    pubkey: PLAYER,
    kind: 31950,
    created_at: createdAt,
    sig: '0'.repeat(128),
    content: JSON.stringify(content),
    tags,
  };
}

// `explainPresenceEvent` reads the wall clock (that is the point; it is the
// live multiplayer gate). Pin the clock to NOW so both consumers are asked the
// same question in the shared-rule tests below.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

const answered = (events: NostrEvent[]): RelayReadOutcome => ({
  status: 'answered',
  events,
});

const resolve = (read: RelayReadOutcome, now = NOW) =>
  resolveInitialIslandLocation({ read, now, islandId: ISLAND });

describe('resolveInitialIslandLocation', () => {
  it('restores a fresh presence location', () => {
    // One second inside the lifetime.
    const decision = resolve(answered([presence({ location: 'beach', createdAt: NOW - EXP_SECONDS + 1 })]));

    expect(decision.location).toBe('beach');
    expect(decision.outcome).toEqual({ kind: 'fresh-presence', location: 'beach' });
  });

  it.each(['beach', 'mine', 'cave-open', 'plaza', 'stage', 'home', 'shop'] as const)(
    'restores %s',
    (location) => {
      const decision = resolve(answered([presence({ location, createdAt: NOW - 5 })]));
      expect(decision.location).toBe(location);
      expect(decision.outcome.kind).toBe('fresh-presence');
    },
  );

  describe('the lifetime boundary', () => {
    // expiration = created_at + EXP_SECONDS, and alive means expiration > now.
    // So age EXP_SECONDS - 1 is the last living second, and age EXP_SECONDS is
    // already spent.
    it(`age ${EXP_SECONDS - 1}s is still alive`, () => {
      const decision = resolve(answered([presence({ createdAt: NOW - (EXP_SECONDS - 1) })]));
      expect(decision.outcome.kind).toBe('fresh-presence');
      expect(decision.location).toBe('beach');
    });

    it(`age ${EXP_SECONDS}s: expiration exactly equals now, is stale`, () => {
      const decision = resolve(answered([presence({ createdAt: NOW - EXP_SECONDS })]));
      expect(decision.outcome.kind).toBe('stale-presence');
      expect(decision.location).toBe(DEFAULT_ISLAND_LOCATION);
    });

    it(`age ${EXP_SECONDS + 1}s is stale`, () => {
      const decision = resolve(answered([presence({ createdAt: NOW - (EXP_SECONDS + 1) })]));
      expect(decision.outcome.kind).toBe('stale-presence');
      expect(decision.location).toBe(DEFAULT_ISLAND_LOCATION);
    });
  });

  it('sends a long-stale presence to Town rather than resurrecting it', () => {
    const daysAgo = NOW - 3 * 24 * 60 * 60;
    const decision = resolve(answered([presence({ location: 'mine', createdAt: daysAgo })]));

    expect(decision.location).toBe('town');
    expect(decision.outcome).toMatchObject({
      kind: 'stale-presence',
      presenceLocation: 'mine',
    });
  });

  it('sends a confirmed-empty read to Town', () => {
    const decision = resolve(answered([]));
    expect(decision.location).toBe('town');
    expect(decision.outcome).toEqual({ kind: 'no-presence' });
  });

  it('sends an unrecognised historical location to Town without trusting it', () => {
    const decision = resolve(
      answered([presence({ location: 'volcano-lair-removed-in-2024', createdAt: NOW - 5 })]),
    );

    expect(decision.location).toBe('town');
    expect(decision.outcome).toEqual({
      kind: 'invalid-location',
      value: 'volcano-lair-removed-in-2024',
    });
    expect(isRenderableLocation('volcano-lair-removed-in-2024')).toBe(false);
  });

  it('rejects presence whose loc tag and content disagree', () => {
    const decision = resolve(
      answered([presence({ location: 'beach', tagLocation: 'mine', createdAt: NOW - 5 })]),
    );
    expect(decision.location).toBe('town');
    expect(decision.outcome.kind).toBe('invalid-location');
  });

  it('ignores presence from another island', () => {
    const decision = resolve(
      answered([presence({ location: 'beach', island: '2', createdAt: NOW - 5 })]),
    );
    expect(decision.outcome).toEqual({ kind: 'no-presence' });
    expect(decision.location).toBe('town');
  });

  it.each(['d', 'presence', 'island', 'expiration'] as const)(
    'treats presence missing its %s tag as no presence at all',
    (tag) => {
      const decision = resolve(answered([presence({ createdAt: NOW - 5, omit: [tag] })]));
      expect(decision.outcome.kind).toBe('no-presence');
      expect(decision.location).toBe('town');
    },
  );

  it('reports live presence with no loc tag as unlocatable, not as absent', () => {
    // A distinction worth keeping: the player HAS live presence, we just cannot
    // tell where from it. Collapsing this into `no-presence` would claim we
    // confirmed they had never been anywhere.
    const decision = resolve(answered([presence({ createdAt: NOW - 5, omit: ['loc'] })]));

    expect(decision.outcome).toEqual({ kind: 'invalid-location', value: null });
    expect(decision.location).toBe('town');
  });

  describe('unknown reads', () => {
    it('does not become a confirmed empty', () => {
      const decision = resolve({ status: 'unknown', reason: 'timeout', partialCount: 0 });

      expect(decision.outcome).toEqual({ kind: 'unknown-read', reason: 'timeout' });
      expect(decision.outcome.kind).not.toBe('no-presence');
    });

    it.each(['timeout', 'aborted', 'closed', 'unreachable'] as const)(
      'reaches the bounded Town fallback for reason %s',
      (reason) => {
        const decision = resolve({ status: 'unknown', reason, partialCount: 0 });
        expect(decision.location).toBe('town');
        expect(decision.outcome).toEqual({ kind: 'unknown-read', reason });
      },
    );

    it('never treats partial results as an answer', () => {
      const decision = resolve({ status: 'unknown', reason: 'timeout', partialCount: 3 });
      expect(decision.outcome.kind).toBe('unknown-read');
    });
  });

  describe('newest-event semantics across tabs', () => {
    it('uses the newest presence, not the first', () => {
      const decision = resolve(
        answered([
          presence({ location: 'beach', createdAt: NOW - 20, id: 'a'.repeat(64) }),
          presence({ location: 'plaza', createdAt: NOW - 2, session: 'other-tab', id: 'b'.repeat(64) }),
        ]),
      );

      expect(decision.location).toBe('plaza');
    });

    it('is deterministic when two tabs publish in the same second', () => {
      const events = [
        presence({ location: 'beach', createdAt: NOW - 2, id: 'a'.repeat(64) }),
        presence({ location: 'plaza', createdAt: NOW - 2, session: 'other-tab', id: 'b'.repeat(64) }),
      ];

      expect(resolve(answered(events)).location).toBe('plaza');
      expect(resolve(answered([...events].reverse())).location).toBe('plaza');
    });

    it('judges the newest presence rather than searching back for a usable one', () => {
      const decision = resolve(
        answered([
          presence({ location: 'beach', createdAt: NOW - 20, id: 'a'.repeat(64) }),
          presence({ location: 'gone', createdAt: NOW - 2, session: 'other', id: 'b'.repeat(64) }),
        ]),
      );

      expect(decision.outcome.kind).toBe('invalid-location');
      expect(decision.location).toBe('town');
    });
  });

  describe('arcade floors are resumed like any other location', () => {
    /*
     * These floors used to be gated: the elevator demanded an Arcade Pass on
     * every floor, so resuming a player upstairs without one stranded them, and
     * this policy had to send them to the entrance instead.
     *
     * The arcade charges for PLAYS now, not for presence; one Arcade Token per
     * game, bought at the counter on the ground floor, and the elevator is open
     * to everyone. With no entitlement to check, an arcade floor resumes exactly
     * like Town does.
     */
    it.each(['arcade-1', 'arcade-minus1', 'arcade'] as const)(
      'resumes %s from presence',
      (location) => {
        const decision = resolve(answered([presence({ location, createdAt: NOW - 5 })]));
        expect(decision.location).toBe(location);
        expect(decision.outcome.kind).toBe('fresh-presence');
      },
    );

    it('takes no entitlement input, so it cannot redirect on one', () => {
      // The signature is the guarantee: there is no pass argument left to pass
      // in, and no branch that could consult one.
      const decision = resolve(answered([presence({ location: 'arcade-1', createdAt: NOW - 5 })]));
      expect(Object.keys(decision).sort()).toEqual(['location', 'outcome', 'position']);
      expect(decision.outcome).toEqual({ kind: 'fresh-presence', location: 'arcade-1' });
    });
  });

  describe('position', () => {
    /** The ground position is recovered through the wire round-trip. */
    const expectAt = (actual: { x: number; y: number } | null, expected: { x: number; y: number }) => {
      expect(actual).not.toBeNull();
      expect(actual!.x).toBeCloseTo(expected.x, 1);
      expect(actual!.y).toBeCloseTo(expected.y, 1);
    };

    it('opens Town at the position the player was standing in', () => {
      const spot = { x: 38.5, y: 72.4 };
      const decision = resolve(
        answered([presence({ location: 'town', at: spot, createdAt: NOW - 5 })]),
      );

      expect(decision.location).toBe('town');
      expectAt(decision.position, spot);
    });

    it('opens the Mine at the previous safe position', () => {
      const spot = { x: 61.2, y: 88.1 };
      const decision = resolve(
        answered([presence({ location: 'mine', at: spot, createdAt: NOW - 5 })]),
      );

      expect(decision.location).toBe('mine');
      expectAt(decision.position, spot);
    });

    it('restores where a walk was HEADED, and does not resume the walk', () => {
      // Mid-walk presence: `anchor` is where the walk began and is already
      // behind the player; `goal.to` is where it ends. Every remote client
      // renders that player arriving at `goal.to`, so that is the settled spot.
      const from = { x: 20, y: 70 };
      const to = { x: 70, y: 76 };
      const decision = resolve(
        answered([presence({ location: 'town', at: from, walkingTo: to, createdAt: NOW - 2 })]),
      );

      expectAt(decision.position, to);
      // Nothing that could restart a walk survives: there is no goal, no
      // velocity and no movement state anywhere on the decision.
      expect(Object.keys(decision).sort()).toEqual(['location', 'outcome', 'position']);
      expect(JSON.stringify(decision)).not.toContain('goal');
      expect(JSON.stringify(decision)).not.toContain('"v"');
    });

    it.each([
      ['non-finite', { x: Number.NaN, y: 80 }],
      ['infinite', { x: 50, y: Number.POSITIVE_INFINITY }],
      ['non-numeric', { x: '50', y: '80' }],
      ['missing y', { x: 50 }],
    ])('falls back to the canonical spawn for %s coordinates', (_label, anchor) => {
      const decision = resolve(
        answered([
          presence({
            location: 'town',
            createdAt: NOW - 5,
            rawContent: { state: 'idle', location: 'town', anchor },
          }),
        ]),
      );

      expect(decision.location).toBe('town');
      // `null` is how the decision says "use the scene's own spawn".
      expect(decision.position).toBeNull();
    });

    it('falls back to the canonical spawn for coordinates outside world-percent space', () => {
      // Clamping `x: -9999` onto an edge would invent a spot the player never
      // occupied; it is malformed, not merely out of bounds.
      const decision = resolve(
        answered([
          presence({
            location: 'town',
            createdAt: NOW - 5,
            rawContent: {
              state: 'idle',
              location: 'town',
              anchor: { x: -9999, y: 4321, ts: NOW - 5 },
            },
          }),
        ]),
      );

      expect(decision.position).toBeNull();
    });

    it('clamps an in-range but off-floor position onto the scene’s walkable area', () => {
      // Inside world-percent space on the wire, but well above Town's walkable
      // floor band (an arch spanning y ≈ 63.5–78.3): the shape a room whose
      // floor moved between builds would produce.
      const offFloor = { x: 50, y: 40 };
      const decision = resolve(
        answered([presence({ location: 'town', at: offFloor, createdAt: NOW - 5 })]),
      );

      expect(decision.position).not.toBeNull();

      const boundary = locationBoundaries[getBackgroundForLocation('town')];
      const clamped = constrainPosition(decision.position!, boundary);
      // Already on the floor: constraining again is a no-op.
      expect(clamped.x).toBeCloseTo(decision.position!.x, 5);
      expect(clamped.y).toBeCloseTo(decision.position!.y, 5);
      expect(decision.position!.y).toBeGreaterThan(offFloor.y);
    });

    it('gives no position when the location itself is not restored', () => {
      const stale = resolve(answered([presence({ location: 'beach', at: { x: 30, y: 80 }, createdAt: NOW - 100 })]));
      expect(stale.position).toBeNull();

      const unknown = resolve({ status: 'unknown', reason: 'timeout', partialCount: 0 });
      expect(unknown.position).toBeNull();

      const none = resolve(answered([]));
      expect(none.position).toBeNull();
    });

    it('stays clear of the canonical spawn, so the test above is meaningful', () => {
      // Guards against a false pass: if the restored position happened to equal
      // the spawn, "restored" and "not restored" would be indistinguishable.
      const spot = { x: 38.5, y: 72.4 };
      const decision = resolve(
        answered([presence({ location: 'town', at: spot, createdAt: NOW - 5 })]),
      );
      const spawn = getBlobbiInitialPosition('town', null);

      expect(decision.position!.x).not.toBeCloseTo(spawn.x, 1);
    });
  });

  it('restores only the coarse location and a standing position; no seat, hiding spot or activity', () => {
    const seated = presence({ location: 'stage', createdAt: NOW - 5 });
    const event: NostrEvent = {
      ...seated,
      content: JSON.stringify({
        state: 'moving',
        location: 'stage',
        anchor: { x: 12.5, y: 31.75, ts: NOW - 5 },
        goal: { from: { x: 12, y: 31 }, to: { x: 90, y: 70 }, v: 120, ts: NOW - 5 },
        seatId: 'theater-seat-a4',
        hiddenIn: 'town-bush-1',
        activity: { type: 'shared-playback', session: '31951:abc:watch' },
      }),
    };

    const decision = resolve(answered([event]));

    expect(decision.outcome).toEqual({ kind: 'fresh-presence', location: 'stage' });
    // The decision is a location and a standing position. Whatever the presence
    // also claimed about seats, hiding or sessions is not carried out of this
    // module: there is nowhere in the result to put it.
    expect(Object.keys(decision).sort()).toEqual(['location', 'outcome', 'position']);
    const serialized = JSON.stringify(decision);
    expect(serialized).not.toContain('seatId');
    expect(serialized).not.toContain('hiddenIn');
    expect(serialized).not.toContain('activity');
    expect(serialized).not.toContain('shared-playback');
  });
});

describe('resolveActorSpawn: what the scene actually mounts with', () => {
  it('uses the bootstrap position when a session was resumed', () => {
    const resumed = { x: 38.5, y: 72.4 };
    expect(resolveActorSpawn(resumed, 'town', null)).toEqual(resumed);
  });

  it('uses the canonical spawn once the bootstrap is spent', () => {
    // What `LocationContext` hands over after the first navigation.
    expect(resolveActorSpawn(null, 'town', 'beach')).toEqual(
      getBlobbiInitialPosition('town', 'beach'),
    );
  });

  it('uses the canonical spawn for an ordinary, unresumed entry', () => {
    expect(resolveActorSpawn(undefined, 'mine', null)).toEqual(
      getBlobbiInitialPosition('mine', null),
    );
  });

  it('still honours door-exit positions when there is no bootstrap', () => {
    // The pre-existing rule this must not shadow: leaving a room puts you at
    // its door on the parent map, not at the parent's center spawn.
    expect(resolveActorSpawn(null, 'town', 'arcade')).toEqual({ x: 32, y: 75.8 });
  });
});

describe('one presence lifetime rule, two consumers', () => {
  /**
   * Remote visibility and local resume must agree at every age, including both
   * sides of the boundary. `explainPresenceEvent` is what decides whether an
   * incoming presence may render a remote player at all; if these two ever
   * disagree, one of them grew its own timeout.
   */
  const ages = [0, 1, EXP_SECONDS - 2, EXP_SECONDS - 1, EXP_SECONDS, EXP_SECONDS + 1, 10_000];

  it.each(ages)('agrees at age %is', (age) => {
    const createdAt = NOW - age;
    const event = presence({ location: 'beach', createdAt });

    const remoteWouldRender = explainPresenceEvent(event).ok;
    const resumeVerdict = resolve(answered([event]), NOW).outcome.kind;

    expect(resumeVerdict === 'fresh-presence').toBe(remoteWouldRender);
    expect(resumeVerdict === 'stale-presence').toBe(!remoteWouldRender);
  });

  it('both consumers read the same predicate', () => {
    // The predicate itself, at the boundary the two tests above pin.
    expect(isPresenceAlive(NOW + 1, NOW)).toBe(true);
    expect(isPresenceAlive(NOW, NOW)).toBe(false);
    expect(isPresenceAlive(NOW - 1, NOW)).toBe(false);
  });

  it('does not restore what multiplayer would have already hidden', () => {
    const spent = presence({ location: 'mine', createdAt: NOW - EXP_SECONDS });

    expect(explainPresenceEvent(spent)).toEqual({ ok: false, reason: 'expired' });
    expect(resolve(answered([spent])).location).toBe('town');
  });
});
