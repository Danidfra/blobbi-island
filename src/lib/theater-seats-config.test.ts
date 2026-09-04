/**
 * Invariants for the theater seat table.
 *
 * The seat layout used to be six flex containers of anonymous clones; it is now
 * 28 absolutely-placed entries computed from the original containers' offsets.
 * These tests pin the conversion against the ORIGINAL measured geometry, so a
 * refactor that quietly moves a row by a percent fails here instead of in a
 * screenshot nobody takes.
 */
import { describe, it, expect } from 'vitest';
import {
  SEAT_SPRITE_HEIGHT_PERCENT,
  getTheaterSeat,
  THEATER_DECORATIVE_CHAIR_COUNT,
  THEATER_OCCUPIABLE_SEAT_COUNT,
  decorativeTheaterSeats,
  isOccupiableSeat,
  occupiableTheaterSeats,
  seatAnchorPosition,
  seatApproachPosition,
  SEAT_CONTACT_RATIO,
  theaterSeats,
} from './theater-seats-config';
import { locationBoundaries } from './location-boundaries';
import { constrainPosition } from './boundaries';

/** Sprite centres measured from the original flex markup (audit §1.8). */
const MEASURED_CENTERS: Record<string, number[]> = {
  a: [5.4, 14.5, 23.7, 32.9, 67.1, 76.3, 85.5, 94.6],
  b: [-0.7, 8.5, 17.7, 26.9, 36.1, 63.9, 73.1, 82.3, 91.5, 100.6],
  c: [3.4, 12.5, 21.7, 30.9, 40.1, 59.9, 69.1, 78.3, 87.5, 96.6],
};

const center = (seat: (typeof theaterSeats)[number]) => seat.leftPercent + seat.widthPercent / 2;

describe('theater seat configuration', () => {
  it('has 28 seats: 8 + 10 + 10', () => {
    expect(theaterSeats).toHaveLength(28);
    expect(theaterSeats.filter((s) => s.row === 'a')).toHaveLength(8);
    expect(theaterSeats.filter((s) => s.row === 'b')).toHaveLength(10);
    expect(theaterSeats.filter((s) => s.row === 'c')).toHaveLength(10);
  });

  it('gives every seat a unique, well-formed id', () => {
    const ids = theaterSeats.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const seat of theaterSeats) {
      expect(seat.id).toMatch(/^theater-seat-[abc]\d{1,2}$/);
      expect(seat.id).toContain(`-${seat.row}`);
    }
  });

  it('reproduces the original layout to within a rounding error', () => {
    for (const row of ['a', 'b', 'c'] as const) {
      const centers = theaterSeats.filter((s) => s.row === row).map(center);
      expect(centers).toHaveLength(MEASURED_CENTERS[row].length);
      centers.forEach((value, i) => {
        // The audit's table is rounded to one decimal; allow that rounding.
        expect(Math.abs(value - MEASURED_CENTERS[row][i])).toBeLessThan(0.1);
      });
    }
  });

  it('draws 28 chairs but offers exactly 26 occupiable seats', () => {
    expect(theaterSeats).toHaveLength(28);
    expect(occupiableTheaterSeats).toHaveLength(THEATER_OCCUPIABLE_SEAT_COUNT);
    expect(THEATER_OCCUPIABLE_SEAT_COUNT).toBe(26);
    expect(decorativeTheaterSeats).toHaveLength(THEATER_DECORATIVE_CHAIR_COUNT);
    expect(THEATER_DECORATIVE_CHAIR_COUNT).toBe(2);
    expect(occupiableTheaterSeats.length + decorativeTheaterSeats.length).toBe(theaterSeats.length);
  });

  it('marks exactly the two off-world row-B chairs as decorative', () => {
    expect(decorativeTheaterSeats.map((s) => s.id)).toEqual(['theater-seat-b1', 'theater-seat-b10']);
    // ...and they really are off-world, which is WHY they are decorative.
    for (const chair of decorativeTheaterSeats) {
      const c = center(chair);
      expect(c < 2 || c > 98).toBe(true);
    }
  });

  it('keeps every occupiable seat centre inside the world', () => {
    for (const seat of occupiableTheaterSeats) {
      expect(center(seat)).toBeGreaterThanOrEqual(2);
      expect(center(seat)).toBeLessThanOrEqual(98);
    }
  });

  it('uses the mirrored sprite on the left and the plain one on the right', () => {
    for (const seat of theaterSeats) {
      expect(seat.src).toContain(seat.side === 'left' ? 'chair-left.png' : 'chair.png');
    }
  });

  it('keeps chair z-indices at the row bands the Blobbi z-bands interleave with', () => {
    const zByRow = { a: 30, b: 20, c: 10 };
    for (const seat of theaterSeats) {
      expect(seat.zIndex).toBe(zByRow[seat.row]);
    }
  });

  it('shrinks the seated scale row by row, front to back', () => {
    const scaleByRow = { a: 0.85, b: 0.78, c: 0.72 };
    for (const seat of theaterSeats) {
      expect(seat.seatedScale).toBe(scaleByRow[seat.row]);
    }
    expect(scaleByRow.a).toBeGreaterThan(scaleByRow.b);
    expect(scaleByRow.b).toBeGreaterThan(scaleByRow.c);
  });

  it('turns every seated Blobbi toward the screen', () => {
    expect(theaterSeats.every((s) => s.facing === 'back')).toBe(true);
  });

  describe('seat anchors', () => {
    it('rest the seated body ON the cushion: pose = cushion line + contact ratio × scaled body', () => {
      // Explicit VISUAL POSE ANCHOR, calibrated to the cushion (measured lines
      // 87.6 / 82.7 / 77.6) plus SEAT_CONTACT_RATIO of the row-scaled body.
      // The ratio (0.5) is derived from the legacy center-anchor renderer's
      // visible body bottom; see ground-target-hardening.test.ts.
      const cushionByRow = { a: 87.6, b: 82.7, c: 77.6 };
      for (const seat of theaterSeats) {
        const scaledBody = (128 * seat.seatedScale * 100) / 697;
        const expected = cushionByRow[seat.row] + SEAT_CONTACT_RATIO * scaledBody;
        expect(Math.abs(seatAnchorPosition(seat).y - expected)).toBeLessThan(0.1);
      }
    });

    it('every APPROACH point lies inside the theater walk boundary, so arrival can fire', () => {
      // Arrival is measured against the walk APPROACH (floor at the seat's
      // front base), not the pose: the pose is a boundary-bypassing snap and
      // may legitimately sit off the walkable floor (rows B/C cushions do).
      const boundary = locationBoundaries['stage-inside.png'];
      expect(boundary).toBeDefined();
      for (const seat of occupiableTheaterSeats) {
        const approach = seatApproachPosition(seat);
        const clamped = constrainPosition(approach, boundary);
        expect(clamped.x).toBeCloseTo(approach.x, 6);
        expect(clamped.y).toBeCloseTo(approach.y, 6);
      }
    });

    it('separates the approach (floor) from the pose (cushion) for every row', () => {
      for (const seat of occupiableTheaterSeats) {
        const approach = seatApproachPosition(seat);
        const pose = seatAnchorPosition(seat);
        // Feet stop BELOW the cushion line, on the floor in front of the seat.
        expect(approach.y).toBeGreaterThan(pose.y);
      }
    });

    it('are horizontally centred on the chair', () => {
      for (const seat of theaterSeats) {
        expect(seatAnchorPosition(seat).x).toBeCloseTo(center(seat), 6);
      }
    });
  });

  it('renders the chair sprite at the measured 15.44 % of world height', () => {
    expect(SEAT_SPRITE_HEIGHT_PERCENT).toBeCloseTo(15.44, 2);
  });

  describe('lookup helpers', () => {
    it('resolves known ids and rejects unknown ones', () => {
      expect(getTheaterSeat('theater-seat-a1')?.row).toBe('a');
      expect(getTheaterSeat('theater-seat-zz9')).toBeUndefined();
      expect(getTheaterSeat(null)).toBeUndefined();
      expect(getTheaterSeat(undefined)).toBeUndefined();
    });

    it('refuses to treat a decorative chair as an occupiable seat', () => {
      expect(isOccupiableSeat('theater-seat-a1')).toBe(true);
      expect(isOccupiableSeat('theater-seat-b1')).toBe(false);
      expect(isOccupiableSeat('theater-seat-b10')).toBe(false);
      expect(isOccupiableSeat('nonsense')).toBe(false);
    });
  });
});
