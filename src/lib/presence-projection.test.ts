/**
 * What a coarse presence may say, and what it must still say.
 *
 * The subtraction is small on purpose, one field, and only its value, so the
 * tests that matter most are the ones proving the alternatives are WORSE:
 * omitting the field entirely un-hides a hidden player, and dropping the
 * movement goal stops remote Blobbis moving at all. Both are checked here at
 * the projection level and again through the real world layer.
 */
import { describe, expect, it } from 'vitest';

import { FAMILY_POLICY, STANDARD_POLICY, type IslandSafetyPolicy } from '@/safety';
import { townBushes } from '@/lib/town-bushes-config';
import { occupiableTheaterSeats } from '@/lib/theater-seats-config';

import type { PresenceContent } from './multiplayer';
import { WITHHELD_HIDING_SPOT, projectPresenceForPolicy } from './presence-projection';

const coarse: IslandSafetyPolicy = FAMILY_POLICY;
const detailed: IslandSafetyPolicy = STANDARD_POLICY;

/** Everything presence can carry at once, so nothing is dropped by accident. */
function fullPresence(over: Partial<PresenceContent> = {}): PresenceContent {
  return {
    state: 'idle',
    location: 'town',
    anchor: { x: 41.376, y: 72.518, ts: 1_800_000_000 },
    goal: {
      from: { x: 41.376, y: 72.518 },
      to: { x: 63.902, y: 55.117 },
      v: 120,
      ts: 1_800_000_000,
    },
    hiddenIn: 'town-bush-3',
    seatId: 'theater-seat-a4',
    activity: { type: 'shared-playback', session: '31951:abc:sess' },
    seq: 7,
    ...over,
  };
}

describe('detailed presence', () => {
  it('is a pass-through: the wire shape does not change', () => {
    const content = fullPresence();
    expect(projectPresenceForPolicy(detailed, content)).toEqual(content);
  });

  it('returns the very same object, so no publish path can drift', () => {
    const content = fullPresence();
    expect(projectPresenceForPolicy(detailed, content)).toBe(content);
  });
});

describe('coarse presence keeps everything the world needs', () => {
  const projected = projectPresenceForPolicy(coarse, fullPresence());

  it('keeps the fields a remote client renders from', () => {
    // Each of these has a proven consumer; see the audit table in
    // docs/presence-data-minimization.md.
    expect(projected.state).toBe('idle');
    expect(projected.location).toBe('town');
    expect(projected.anchor).toEqual({ x: 41.376, y: 72.518, ts: 1_800_000_000 });
    expect(projected.seq).toBe(7);
  });

  it('keeps the movement goal, at full precision', () => {
    // Without it a remote Blobbi does not move: the target falls back to the
    // anchor, which is where the walk STARTED.
    expect(projected.goal).toEqual({
      from: { x: 41.376, y: 72.518 },
      to: { x: 63.902, y: 55.117 },
      v: 120,
      ts: 1_800_000_000,
    });
  });

  it('does not quantize coordinates', () => {
    // Island percentages, not geolocation. Rounding buys no privacy property
    // and costs smooth motion, so it is deliberately not done.
    expect(projected.anchor.x).toBe(41.376);
    expect(projected.goal?.to.y).toBe(55.117);
  });

  it('keeps the seat, because two players would otherwise share a chair', () => {
    expect(projected.seatId).toBe('theater-seat-a4');
  });

  it('keeps the shared activity, because co-play is built on it', () => {
    expect(projected.activity).toEqual({ type: 'shared-playback', session: '31951:abc:sess' });
  });
});

describe('coarse presence withholds the hiding spot', () => {
  it('replaces the id with a non-identifying marker', () => {
    const projected = projectPresenceForPolicy(coarse, fullPresence());
    expect(projected.hiddenIn).toBe(WITHHELD_HIDING_SPOT);
    expect(projected.hiddenIn).not.toBe('town-bush-3');
  });

  it('still SAYS the player is hidden', () => {
    // The fact is load-bearing and the identifier is not: every client decides
    // by truthiness, so the Blobbi stays concealed.
    const projected = projectPresenceForPolicy(coarse, fullPresence());
    expect(projected.hiddenIn).toBeTruthy();
  });

  it('says nothing when the player is not hiding', () => {
    for (const value of [undefined, '', '   ']) {
      const projected = projectPresenceForPolicy(
        coarse,
        fullPresence({ hiddenIn: value as string | undefined }),
      );
      // A whitespace id is not a spot, and must not become a claim of hiding.
      expect(projected.hiddenIn ?? '').toBe(value ?? '');
    }
  });

  it('uses a marker no real hiding spot could collide with', () => {
    const realSpots = townBushes.map((bush) => bush.id);
    expect(realSpots).not.toContain(WITHHELD_HIDING_SPOT);
    expect(realSpots.length).toBeGreaterThan(0);
  });

  it('uses a marker no seat could collide with either', () => {
    expect(occupiableTheaterSeats.map((seat) => seat.id)).not.toContain(WITHHELD_HIDING_SPOT);
  });
});

describe('the projection is a function, not a side effect', () => {
  it('never mutates its input, local state keeps the real spot', () => {
    const content = fullPresence();
    const before = structuredClone(content);
    projectPresenceForPolicy(coarse, content);
    expect(content).toEqual(before);
    expect(content.hiddenIn).toBe('town-bush-3');
  });

  it('is deterministic', () => {
    const content = fullPresence();
    expect(projectPresenceForPolicy(coarse, content)).toEqual(
      projectPresenceForPolicy(coarse, content),
    );
  });

  it('follows the capability, never a profile name', () => {
    const detailedFamily = { ...FAMILY_POLICY, detailedPresence: true } as IslandSafetyPolicy;
    expect(projectPresenceForPolicy(detailedFamily, fullPresence()).hiddenIn).toBe('town-bush-3');

    const coarseStandard = { ...STANDARD_POLICY, detailedPresence: false } as IslandSafetyPolicy;
    expect(projectPresenceForPolicy(coarseStandard, fullPresence()).hiddenIn).toBe(
      WITHHELD_HIDING_SPOT,
    );
  });

  it('handles a minimal presence without inventing fields', () => {
    const minimal: PresenceContent = {
      state: 'idle',
      location: 'town',
      anchor: { x: 1, y: 2, ts: 3 },
    };
    const projected = projectPresenceForPolicy(coarse, minimal);
    expect(projected).toEqual(minimal);
    expect('hiddenIn' in projected).toBe(false);
    expect('goal' in projected).toBe(false);
  });
});
