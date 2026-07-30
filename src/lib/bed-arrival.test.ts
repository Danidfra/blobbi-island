/**
 * Bed system under GROUND-ANCHOR semantics (Phase 2).
 *
 * The bed flow is: walk to a GROUND target (the sleep pose clamped into the
 * room's walk boundary) → on arrival, snap to the bed's SLEEP POSE anchor
 * (an explicit boundary-bypassing pose). The room gate from Phase 0 stays:
 * bed arrival exists only where the bed exists.
 */
import { describe, it, expect } from 'vitest';

import {
  BED_ROOM_BACKGROUND,
  BED_SLEEP_POSE_Y_OFFSET,
  getBedSleepPose,
  getBedWalkTarget,
  isBedArrival,
} from './bed-arrival';
import { LOCATION_BACKGROUNDS } from './location-backgrounds';
import { locationBoundaries } from './location-boundaries';
import { constrainPosition } from './boundaries';
import { worldDistancePx, ARRIVAL_THRESHOLD_PX } from './blobbi-ground';

const DEFAULT_BED_POSITION = { x: 75, y: 70 }; // PlayingView's useState default
const HOME_BOUNDARY = locationBoundaries[BED_ROOM_BACKGROUND];

describe('bed pose and walk target', () => {
  it('the sleep pose is an explicit pose anchor slightly below the bed sprite center', () => {
    const pose = getBedSleepPose(DEFAULT_BED_POSITION);
    expect(pose).toEqual({ x: 75, y: 70 + BED_SLEEP_POSE_Y_OFFSET });
  });

  it('the walk target is the pose clamped into the walkable floor (a reachable ground point)', () => {
    const walk = getBedWalkTarget(DEFAULT_BED_POSITION, HOME_BOUNDARY);
    // Must be walkable: constraining it again changes nothing.
    expect(constrainPosition(walk, HOME_BOUNDARY)).toEqual(walk);
  });

  it('the pose itself may sit OFF the walkable floor — reaching it requires the documented snap', () => {
    const pose = getBedSleepPose(DEFAULT_BED_POSITION);
    const clamped = constrainPosition(pose, HOME_BOUNDARY);
    // With the default bed position the pose lies above the arch floor line;
    // the walk stops at the clamped point and goTo(pose, immediate) bridges
    // the rest. (If a future bed drag puts the pose on the floor, both points
    // coincide and the snap is a no-op — also fine.)
    expect(worldDistancePx(pose, clamped)).toBeGreaterThan(0);
  });
});

describe('isBedArrival (ground semantics)', () => {
  const WALK = getBedWalkTarget(DEFAULT_BED_POSITION, HOME_BOUNDARY);

  it('the bed room is the Home interior background', () => {
    expect(BED_ROOM_BACKGROUND).toBe('home-inside.png');
    expect(LOCATION_BACKGROUNDS['home']).toBe(BED_ROOM_BACKGROUND);
  });

  it('triggers at (and near) the walk target inside the Home, using world-px distance', () => {
    expect(isBedArrival(WALK, WALK, BED_ROOM_BACKGROUND)).toBe(true);
    // Just inside the shared threshold along x (world px are isotropic).
    const nearX = { x: WALK.x + ((ARRIVAL_THRESHOLD_PX - 1) / 1046) * 100, y: WALK.y };
    expect(isBedArrival(nearX, WALK, BED_ROOM_BACKGROUND)).toBe(true);
    // Just outside.
    const farX = { x: WALK.x + ((ARRIVAL_THRESHOLD_PX + 5) / 1046) * 100, y: WALK.y };
    expect(isBedArrival(farX, WALK, BED_ROOM_BACKGROUND)).toBe(false);
  });

  it('never triggers outside the Home, even exactly on the walk target', () => {
    const everyOtherBackground = Object.values(LOCATION_BACKGROUNDS).filter(
      (background) => background !== BED_ROOM_BACKGROUND,
    );
    expect(everyOtherBackground.length).toBeGreaterThan(0);
    for (const background of everyOtherBackground) {
      expect(
        isBedArrival(WALK, WALK, background),
        `bed arrival must not trigger on background "${background}"`,
      ).toBe(false);
    }
  });

  it('the threshold is isotropic: the same world-px offset on x and y behaves identically', () => {
    const d = ARRIVAL_THRESHOLD_PX - 1;
    const alongX = { x: WALK.x + (d / 1046) * 100, y: WALK.y };
    const alongY = { x: WALK.x, y: WALK.y - (d / 697) * 100 };
    expect(isBedArrival(alongX, WALK, BED_ROOM_BACKGROUND)).toBe(true);
    expect(isBedArrival(alongY, WALK, BED_ROOM_BACKGROUND)).toBe(true);
  });
});
