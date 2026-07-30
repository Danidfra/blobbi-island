/**
 * Bed geometry under GROUND-ANCHOR semantics.
 *
 * The bed flow (Phase 3) is: request the bed interaction → walk to a GROUND
 * target (the sleep pose clamped into the room's walk boundary) via the
 * canonical pending-interaction system → on confirmed arrival, snap to the
 * bed's SLEEP POSE anchor (an explicit boundary-bypassing pose). This file
 * pins the geometry; the flow itself is covered by
 * `src/components/blobbi/BedArrival.test.tsx`.
 */
import { describe, it, expect } from 'vitest';

import {
  BED_SLEEP_POSE_Y_OFFSET,
  getBedSleepPose,
  getBedWalkTarget,
} from './bed-arrival';
import { LOCATION_BACKGROUNDS } from './location-backgrounds';
import { locationBoundaries } from './location-boundaries';
import { constrainPosition } from './boundaries';
import { worldDistancePx } from './blobbi-ground';

const DEFAULT_BED_POSITION = { x: 75, y: 70 }; // useBlobbiPoseController's default
const HOME_BOUNDARY = locationBoundaries[LOCATION_BACKGROUNDS['home']];

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
    // the walk stops at the clamped point and `snapTo(pose)` bridges the rest.
    // (If a future bed drag puts the pose on the floor, both points coincide
    // and the snap is a no-op — also fine.)
    expect(worldDistancePx(pose, clamped)).toBeGreaterThan(0);
  });

  it('the home mapping the structural gate relies on is stable', () => {
    // The bed exists only in the Home interior; the pose controller's bed flow
    // can only be requested from that room's furniture.
    expect(LOCATION_BACKGROUNDS['home']).toBe('home-inside.png');
  });
});
