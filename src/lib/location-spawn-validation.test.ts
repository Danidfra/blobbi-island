/**
 * Table-driven validation of EVERY configured spawn and exit-return position
 * against the destination room's walk boundary, the generalization of
 * `arcade-spawn.test.ts` called for by the Phase 0 actor-safety baseline
 * (docs/blobbi-actor-ui-audit.md §16.4, §22.1).
 *
 * The positions validated here are ordinary walkable spawns: the Blobbi is
 * placed there by a room transition and is expected to stand and walk from
 * that point. They are asserted AS CONFIGURED (no pre-clamping): a point the
 * boundary would have to move is a bug, because `MovableBlobbi` takes
 * `initialPosition` into state raw and the Blobbi renders off-floor until the
 * first movement frame snaps it back.
 *
 * All coordinates are GROUND-ANCHOR semantics (Phase 2): the configured point
 * is where the Blobbi's FEET land, and the boundaries below constrain that
 * ground point: see docs/blobbi-actor-position-migration-notes.md.
 *
 * Deliberately NOT covered here (not ordinary walkable spawns):
 * - Theater seat cushion anchors (`seatAnchorPosition`): off-boundary by
 *   design; the Blobbi snaps there with `goTo(..., immediate)`, which bypasses
 *   boundary clamping. Pinned by `theater-seats-config.test.ts`.
 * - The bed sleeping position (`bedPosition.y - 5`): a walk destination that
 *   may sit above the walkable floor; covered by `bed-arrival.test.ts`.
 * - Arcade pass/no-pass spawn reachability (line-of-walk tests): covered in
 *   depth by `arcade-spawn.test.ts`; the raw points are still in the table
 *   below.
 */
import { describe, it, expect } from 'vitest';

import {
  ARCADE_DEFAULT_SPAWN,
  ARCADE_ELEVATOR_EXIT_SPAWN,
  EXIT_POSITIONS,
  LOCATION_INITIAL_POSITIONS,
  getBlobbiInitialPosition,
} from './location-initial-position';
import { LOCATION_BACKGROUNDS, getBackgroundForLocation } from './location-backgrounds';
import { locationBoundaries } from './location-boundaries';
import { constrainPosition, type Boundary } from './boundaries';
import type { LocationId } from './location-types';
import type { Position } from './types';

/**
 * PlayingView's fallback for rooms with no `locationBoundaries` entry
 * (PlayingView.tsx, `boundary = locationBoundaries[background] || {...}`).
 * Every current background has an entry, so this is defensive only, but
 * validating through the same resolution keeps the test honest if a room is
 * added without a boundary.
 */
const FALLBACK_BOUNDARY: Boundary = { shape: 'rectangle', x: [0, 100], y: [60, 100] };

function boundaryFor(background: string): Boundary {
  return locationBoundaries[background] || FALLBACK_BOUNDARY;
}

/**
 * A point is walkable when the walk boundary does not have to move it,
 * the same identity test `arcade-spawn.test.ts` established and the same
 * check the movement system itself performs each frame.
 */
function isWalkable(point: Position, boundary: Boundary): boolean {
  const constrained = constrainPosition(point, boundary);
  return (
    Math.abs(constrained.x - point.x) < 1e-6 && Math.abs(constrained.y - point.y) < 1e-6
  );
}

function describeFailure(
  label: string,
  destination: string,
  background: string,
  point: Position,
  boundary: Boundary,
): string {
  return [
    `${label}: configured position (${point.x}, ${point.y}) is OUTSIDE the walk boundary`,
    `destination location: ${destination}`,
    `background: ${background}`,
    `boundary: ${JSON.stringify(boundary)}`,
    `nearest walkable point: ${JSON.stringify(constrainPosition(point, boundary))}`,
  ].join('\n  ');
}

describe('location spawn validation (ground-anchor semantics)', () => {
  const initialEntries = Object.entries(LOCATION_INITIAL_POSITIONS) as Array<
    [LocationId, Position]
  >;

  it.each(initialEntries)(
    'initial position for "%s" lies inside its room boundary',
    (location, point) => {
      const background = getBackgroundForLocation(location);
      const boundary = boundaryFor(background);
      expect(
        isWalkable(point, boundary),
        describeFailure(`LOCATION_INITIAL_POSITIONS['${location}']`, location, background, point, boundary),
      ).toBe(true);
    },
  );

  it('covers every known location (table and background map stay in sync)', () => {
    // If a location gains a spawn entry without a background (or vice versa)
    // the per-entry assertions above would silently validate against the
    // fallback; surface the drift explicitly instead.
    const locations = Object.keys(LOCATION_BACKGROUNDS).sort();
    const spawns = Object.keys(LOCATION_INITIAL_POSITIONS).sort();
    expect(spawns).toEqual(locations);
  });

  const arcadeSpawns: Array<[string, Position]> = [
    ['ARCADE_DEFAULT_SPAWN', ARCADE_DEFAULT_SPAWN],
    ['ARCADE_ELEVATOR_EXIT_SPAWN', ARCADE_ELEVATOR_EXIT_SPAWN],
  ];

  it.each(arcadeSpawns)('%s lies inside the arcade ground-floor boundary', (label, point) => {
    const background = getBackgroundForLocation('arcade');
    const boundary = boundaryFor(background);
    expect(
      isWalkable(point, boundary),
      describeFailure(label, 'arcade', background, point, boundary),
    ).toBe(true);
  });

  it('the photo-booth special case spawns inside the booth floor', () => {
    // `getBlobbiInitialPosition` special-cases the literal background filename
    // 'photo-booth-inside.png' (not a LocationId) for the photo-booth modal,
    // which mounts its own MovableBlobbi against the modal container using the
    // same boundary table. Validate the special-cased point against that
    // boundary. (The key being a filename rather than a LocationId is a known
    // inconsistency: recorded in the migration notes, not changed here.)
    const background = 'photo-booth-inside.png';
    const point = getBlobbiInitialPosition(background);
    const boundary = boundaryFor(background);
    expect(
      isWalkable(point, boundary),
      describeFailure('photo-booth special case', background, background, point, boundary),
    ).toBe(true);
  });
});

describe('exit-return position validation (ground-anchor semantics)', () => {
  /**
   * Derived from the config itself (keys are
   * "<arrivingLocation>:<previousLocation>"), so a new EXIT_POSITIONS entry is
   * validated automatically: nothing to keep in sync by hand.
   */
  const exitTransitions: Array<[destination: LocationId, cameFrom: string]> = Object.keys(
    EXIT_POSITIONS,
  ).map((key) => {
    const [destination, cameFrom] = key.split(':');
    return [destination as LocationId, cameFrom];
  });

  it.each(exitTransitions)(
    'exiting to "%s" from "%s" lands inside the destination boundary',
    (destination, cameFrom) => {
      const point = getBlobbiInitialPosition(destination, cameFrom);
      const background = getBackgroundForLocation(destination);
      const boundary = boundaryFor(background);
      expect(
        isWalkable(point, boundary),
        describeFailure(
          `EXIT_POSITIONS['${destination}:${cameFrom}']`,
          destination,
          background,
          point,
          boundary,
        ),
      ).toBe(true);
    },
  );

  it.each(exitTransitions)(
    'exiting to "%s" from "%s" resolves the configured exit point',
    (destination, cameFrom) => {
      // `getBlobbiInitialPosition` must actually route these keys to the
      // config entry: otherwise the boundary assertion above would silently
      // validate the location default instead.
      const exitPoint = getBlobbiInitialPosition(destination, cameFrom);
      expect(exitPoint).toEqual(EXIT_POSITIONS[`${destination}:${cameFrom}`]);
    },
  );

  it('the corrected shop:clothing-store-inside spawn stands on the mall middle-level strip', () => {
    // Regression pin (Phase 0, values migrated in Phase 2): the pre-fix value
    // {55, 40} was outside every walkable area of shopping-mall-inside.png.
    // The corrected GROUND point stands on the middle-level walk strip
    // y ∈ [62.1, 63.1], in front of the clothing-store door (door x ≈ 51–64).
    const point = getBlobbiInitialPosition('shop', 'clothing-store-inside');
    expect(point.y).toBeGreaterThanOrEqual(62.1);
    expect(point.y).toBeLessThanOrEqual(63.1);
    expect(point.x).toBeGreaterThanOrEqual(51);
    expect(point.x).toBeLessThanOrEqual(64);
  });
});
