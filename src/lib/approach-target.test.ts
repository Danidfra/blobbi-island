/**
 * Canonical approach-target resolution (Phase 3).
 *
 * The DOM-based runtime path (`resolveElementApproachTarget`, fed live rects)
 * and the DOM-free config helpers (`seatApproachPosition`,
 * `machineAnchorPosition`) must compute the SAME points — the config helpers
 * are what tests and dev diagnostics trust, the live rects are what players
 * click. These tests build the element rects straight from the configs and
 * prove the two paths agree.
 */
import { describe, it, expect } from 'vitest';
import {
  ELEMENT_BASE_FRACTION,
  resolveElementApproachTarget,
  type ResolveElementApproachTargetOptions,
} from './approach-target';
import { WORLD_WIDTH, WORLD_HEIGHT } from './world-coordinates';
import { locationBoundaries } from './location-boundaries';
import {
  occupiableTheaterSeats,
  seatApproachPosition,
  SEAT_APPROACH_TARGET,
  SEAT_SPRITE_HEIGHT_PERCENT,
  THEATER_BACKGROUND_FILE,
} from './theater-seats-config';
import {
  arcadeMachines,
  machineAnchorPosition,
  machineHeightPercent,
  machineLeftPercent,
  arcadeMachineGroundOffsetPercent,
  ARCADE_FLOORS,
} from './arcade-machines-config';
import { constrainPosition } from './boundaries';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A stand-in Element whose rect and world surface are fully controlled. */
function fakeElement(elementRect: Rect, surfaceRect: Rect = SURFACE_RECT) {
  const toDomRect = (r: Rect) =>
    ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top }) as DOMRect;
  const surface = {
    getBoundingClientRect: () => toDomRect(surfaceRect),
  } as unknown as HTMLElement;
  const element = {
    getBoundingClientRect: () => toDomRect(elementRect),
    closest: (selector: string) => (selector === '[data-world-surface]' ? surface : null),
  } as unknown as Element;
  return { element, surface };
}

/** The world surface rendered 1:1 at the origin (rects in world-design px). */
const SURFACE_RECT: Rect = { left: 0, top: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT };

/** Percent-of-world placement → world-design-px rect. */
function rectFromPercent(p: { left: number; top: number; width: number; height: number }): Rect {
  return {
    left: (p.left / 100) * WORLD_WIDTH,
    top: (p.top / 100) * WORLD_HEIGHT,
    width: (p.width / 100) * WORLD_WIDTH,
    height: (p.height / 100) * WORLD_HEIGHT,
  };
}

function resolve(opts: Omit<ResolveElementApproachTargetOptions, 'element'> & { rect: Rect; surfaceRect?: Rect }) {
  const { rect, surfaceRect, ...rest } = opts;
  const { element } = fakeElement(rect, surfaceRect ?? SURFACE_RECT);
  return resolveElementApproachTarget({ element, ...rest });
}

describe('resolveElementApproachTarget — mechanics', () => {
  it('resolves ELEMENT_BASE_FRACTION to the floor at the element base', () => {
    // A 10%×10% door whose top-left is at (45%, 60%).
    const result = resolve({
      rect: rectFromPercent({ left: 45, top: 60, width: 10, height: 10 }),
      fraction: ELEMENT_BASE_FRACTION,
    });
    expect(result?.target.x).toBeCloseTo(50);
    expect(result?.target.y).toBeCloseTo(69); // 60 + 10 × 0.9
    expect(result?.meta.clamped).toBe(false);
  });

  it('clamps into the boundary EXPLICITLY and reports it in metadata', () => {
    const boundary = { shape: 'rectangle' as const, x: [0, 100] as [number, number], y: [80, 100] as [number, number] };
    const result = resolve({
      rect: rectFromPercent({ left: 45, top: 10, width: 10, height: 10 }),
      fraction: ELEMENT_BASE_FRACTION,
      boundary,
    });
    expect(result?.target.y).toBe(80);
    expect(result?.meta.clamped).toBe(true);
    expect(result?.meta.raw.y).toBeCloseTo(19);
  });

  it('applies a functional y-offset to the RAW converted y, exactly once', () => {
    const seen: number[] = [];
    const result = resolve({
      rect: rectFromPercent({ left: 45, top: 60, width: 10, height: 10 }),
      fraction: { x: 0.5, y: 0.5 },
      yOffsetPercent: (rawY) => {
        seen.push(rawY);
        return 3;
      },
    });
    expect(seen).toEqual([65]);
    expect(result?.target.y).toBeCloseTo(68);
  });

  it('returns null without a world surface or with a zero-size surface', () => {
    const { element } = fakeElement(rectFromPercent({ left: 0, top: 0, width: 10, height: 10 }));
    expect(
      resolveElementApproachTarget({ element, worldSurface: null, fraction: ELEMENT_BASE_FRACTION }),
    ).toBeNull();
    expect(
      resolve({
        rect: rectFromPercent({ left: 0, top: 0, width: 10, height: 10 }),
        surfaceRect: { left: 0, top: 0, width: 0, height: 0 },
        fraction: ELEMENT_BASE_FRACTION,
      }),
    ).toBeNull();
  });

  it('is invariant under the uniform world scale (letterboxed surface)', () => {
    const s = 0.5;
    const off = { x: 137, y: 42 };
    const base = rectFromPercent({ left: 45, top: 60, width: 10, height: 10 });
    const scaled = resolve({
      rect: {
        left: off.x + base.left * s,
        top: off.y + base.top * s,
        width: base.width * s,
        height: base.height * s,
      },
      surfaceRect: {
        left: off.x,
        top: off.y,
        width: SURFACE_RECT.width * s,
        height: SURFACE_RECT.height * s,
      },
      fraction: ELEMENT_BASE_FRACTION,
    });
    expect(scaled?.target.x).toBeCloseTo(50);
    expect(scaled?.target.y).toBeCloseTo(69);
  });
});

describe('DOM/runtime ↔ config-helper parity', () => {
  it('theater seats: live-rect resolution equals seatApproachPosition for every seat', () => {
    const boundary = locationBoundaries[THEATER_BACKGROUND_FILE];
    for (const seat of occupiableTheaterSeats) {
      const rect = rectFromPercent({
        left: seat.leftPercent,
        top: 100 - seat.bottomPercent - SEAT_SPRITE_HEIGHT_PERCENT,
        width: seat.widthPercent,
        height: SEAT_SPRITE_HEIGHT_PERCENT,
      });
      const runtime = resolve({ rect, fraction: SEAT_APPROACH_TARGET, boundary });
      const config = seatApproachPosition(seat);
      expect(runtime?.target.x, seat.id).toBeCloseTo(config.x, 6);
      expect(runtime?.target.y, seat.id).toBeCloseTo(config.y, 6);
    }
  });

  it('arcade machines: live-rect resolution equals machineAnchorPosition for every machine', () => {
    for (const machine of arcadeMachines) {
      const heightPercent = machineHeightPercent(machine);
      const rect = rectFromPercent({
        left: machineLeftPercent(machine),
        top: 100 - machine.bottomPercent - heightPercent,
        width: machine.widthPercent,
        height: heightPercent,
      });
      const runtime = resolve({
        rect,
        fraction: machine.interactionAnchor,
        yOffsetPercent: (y) => arcadeMachineGroundOffsetPercent(machine.floor, y),
        // machineAnchorPosition is unclamped; the config test proves it is
        // already walkable, so parity is checked pre-clamp…
      });
      const config = machineAnchorPosition(machine);
      expect(runtime?.target.x, machine.id).toBeCloseTo(config.x, 6);
      expect(runtime?.target.y, machine.id).toBeCloseTo(config.y, 6);
      // …and the runtime clamp is a no-op for a walkable anchor.
      const boundary = locationBoundaries[ARCADE_FLOORS[machine.floor]];
      const clamped = constrainPosition(config, boundary);
      expect(clamped.x, machine.id).toBeCloseTo(config.x, 6);
      expect(clamped.y, machine.id).toBeCloseTo(config.y, 6);
    }
  });
});
