/**
 * The `segment` walkable area: a walk LINE, the floor a Blobbi rides when the
 * artwork hides the floor it is actually on (the Plaza's balcony corridor).
 */
import { describe, it, expect } from 'vitest';

import { areaContains, constrainPosition, constrainToArea, type Boundary, type WalkableArea } from './boundaries';
import { boundaryYRange } from './blobbi-world-render';
import { planRoute } from './blobbi-route';

const slope: WalkableArea = { type: 'segment', from: { x: 10, y: 40 }, to: { x: 30, y: 46 } };
const flat: WalkableArea = { type: 'segment', from: { x: 30, y: 46 }, to: { x: 50, y: 46 } };

describe('a segment area', () => {
  it('contains the points on it, its ends included, and nothing beside it', () => {
    expect(areaContains({ x: 10, y: 40 }, slope)).toBe(true);
    expect(areaContains({ x: 20, y: 43 }, slope)).toBe(true);
    expect(areaContains({ x: 30, y: 46 }, slope)).toBe(true);
    expect(areaContains({ x: 20, y: 44 }, slope)).toBe(false);
    // On the line's extension is NOT on the segment.
    expect(areaContains({ x: 40, y: 49 }, slope)).toBe(false);
  });

  it('clamps to the nearest point on it, perpendicular in the middle and to an end past its ends', () => {
    expect(constrainToArea({ x: 40, y: 40 }, flat)).toEqual({ x: 40, y: 40 + 6 });
    expect(constrainToArea({ x: 60, y: 30 }, flat)).toEqual({ x: 50, y: 46 });
    expect(constrainToArea({ x: 0, y: 30 }, slope)).toEqual({ x: 10, y: 40 });
    const mid = constrainToArea({ x: 20, y: 40 }, slope);
    expect(areaContains(mid, slope)).toBe(true);
    expect(mid.x).toBeLessThan(20);
  });

  it('is a floor the route planner walks joint to joint', () => {
    const boundary: Boundary = { shape: 'composite', areas: [slope, flat] };
    expect(boundaryYRange(boundary)).toEqual({ minY: 40, maxY: 46 });
    const route = planRoute({ x: 50, y: 46 }, { x: 10, y: 40 }, boundary, []);
    expect(route).toEqual([{ x: 30, y: 46 }, { x: 10, y: 40 }]);
    // A composite clamp lands a click anywhere onto the nearest segment.
    expect(constrainPosition({ x: 40, y: 20 }, boundary)).toEqual({ x: 40, y: 46 });
  });
});
