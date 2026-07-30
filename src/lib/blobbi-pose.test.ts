/**
 * Actor pose model (Phase 3).
 *
 * `resolveActorRender` is the ONE pure resolver both the local wrapper
 * (MovableBlobbi) and the remote layer (MultiplayerLayer) render through.
 * These tests pin what each pose means visually — and that the resolver is
 * caller-agnostic, which is the local/remote parity guarantee.
 */
import { describe, it, expect } from 'vitest';
import { resolveActorRender, STANDING_POSE, type ActorRenderContext } from './blobbi-pose';
import {
  resolveBlobbiScale,
  resolveBlobbiZIndex,
  resolveSeatedRender,
} from './blobbi-world-render';
import { locationBoundaries } from './location-boundaries';
import { getTheaterSeat, seatAnchorPosition } from './theater-seats-config';

const THEATER: Pick<ActorRenderContext, 'backgroundFile' | 'boundary' | 'scaleByYPosition'> = {
  backgroundFile: 'stage-inside.png',
  boundary: locationBoundaries['stage-inside.png'],
  scaleByYPosition: true,
};

const GROUND = { x: 40, y: 88 };

describe('standing', () => {
  it('renders at the ground position with depth scale, band z, shadow and float', () => {
    const render = resolveActorRender(STANDING_POSE, { groundPosition: GROUND, ...THEATER });
    expect(render.renderPosition).toEqual(GROUND);
    expect(render.scale).toBe(resolveBlobbiScale(GROUND, 'stage-inside.png', THEATER.boundary));
    expect(render.zIndex).toBe(resolveBlobbiZIndex(GROUND, 'stage-inside.png'));
    expect(render.facing).toBe('front');
    expect(render.hideShadow).toBe(false);
    expect(render.disableFloat).toBe(false);
    expect(render.visualHidden).toBe(false);
    expect(render.sleeping).toBe(false);
    expect(render.seatedIn).toBeNull();
    expect(render.hiddenIn).toBeNull();
  });

  it('skips the depth ramp when the room does not scale by y', () => {
    const render = resolveActorRender(STANDING_POSE, {
      groundPosition: GROUND,
      backgroundFile: 'stage-inside.png',
      boundary: THEATER.boundary,
      scaleByYPosition: false,
    });
    expect(render.scale).toBe(1);
  });

  it('caller-specific float suppression passes through (remote per-frame integration)', () => {
    const render = resolveActorRender(STANDING_POSE, {
      groundPosition: GROUND,
      ...THEATER,
      suppressFloat: true,
    });
    expect(render.disableFloat).toBe(true);
  });
});

describe('seated', () => {
  const SEAT_ID = 'theater-seat-a1';

  it('is drawn at the seat POSE ANCHOR — never the stored ground position', () => {
    const render = resolveActorRender(
      { kind: 'seated', seatId: SEAT_ID },
      { groundPosition: GROUND, ...THEATER },
    );
    const seat = getTheaterSeat(SEAT_ID)!;
    expect(render.renderPosition).toEqual(seatAnchorPosition(seat));
    expect(render.renderPosition).not.toEqual(GROUND);
  });

  it('derives scale, z, facing, shadow and float from the seat', () => {
    const render = resolveActorRender(
      { kind: 'seated', seatId: SEAT_ID },
      { groundPosition: GROUND, ...THEATER },
    );
    const seated = resolveSeatedRender(SEAT_ID)!;
    expect(render.scale).toBe(
      resolveBlobbiScale(seated.position, 'stage-inside.png', THEATER.boundary) * seated.scale,
    );
    expect(render.zIndex).toBe(seated.zIndex);
    expect(render.facing).toBe(seated.facing);
    expect(render.hideShadow).toBe(true);
    expect(render.disableFloat).toBe(true);
    expect(render.seatedIn).toBe(SEAT_ID);
  });

  it('an unknown, stale or decorative seat id renders as STANDING (hostile-claim guard)', () => {
    for (const seatId of ['theater-seat-nope', 'theater-seat-b1']) {
      const render = resolveActorRender(
        { kind: 'seated', seatId },
        { groundPosition: GROUND, ...THEATER },
      );
      expect(render.renderPosition, seatId).toEqual(GROUND);
      expect(render.seatedIn, seatId).toBeNull();
      expect(render.hideShadow, seatId).toBe(false);
    }
  });
});

describe('sleeping', () => {
  it('keeps the ground shadow (the bed sits on the floor), suppresses float, closes eyes', () => {
    const anchor = { x: 75, y: 74.2 };
    const render = resolveActorRender(
      { kind: 'sleeping', anchor },
      // The movement position has been snapped to the anchor by the flow.
      { groundPosition: anchor, backgroundFile: 'home-inside.png', boundary: locationBoundaries['home-inside.png'], scaleByYPosition: true },
    );
    expect(render.renderPosition).toEqual(anchor);
    expect(render.sleeping).toBe(true);
    expect(render.disableFloat).toBe(true);
    expect(render.hideShadow).toBe(false);
    expect(render.visualHidden).toBe(false);
  });
});

describe('hidden', () => {
  it('paints nothing while keeping standing geometry (anchor stays mounted)', () => {
    const render = resolveActorRender(
      { kind: 'hidden', spotId: 'town-bush-1' },
      { groundPosition: GROUND, backgroundFile: 'town-open.webp', boundary: locationBoundaries['town-open.webp'], scaleByYPosition: true },
    );
    expect(render.visualHidden).toBe(true);
    expect(render.hiddenIn).toBe('town-bush-1');
    expect(render.renderPosition).toEqual(GROUND);
    expect(render.zIndex).toBe(resolveBlobbiZIndex(GROUND, 'town-open.webp'));
  });
});

describe('local/remote parity', () => {
  it('the resolver is pure and caller-agnostic: identical inputs, identical presentation', () => {
    // The local wrapper and the remote layer build the same (pose, context)
    // for a player seated in a1 at the same room point — the resolver cannot
    // tell them apart, so their presentation cannot diverge.
    const localView = resolveActorRender(
      { kind: 'seated', seatId: 'theater-seat-a1' },
      { groundPosition: GROUND, ...THEATER, suppressFloat: false },
    );
    const remoteView = resolveActorRender(
      { kind: 'seated', seatId: 'theater-seat-a1' },
      { groundPosition: GROUND, ...THEATER, suppressFloat: false },
    );
    expect(remoteView).toEqual(localView);
  });

  it('remote float suppression while moving does not change any other field', () => {
    const still = resolveActorRender(STANDING_POSE, { groundPosition: GROUND, ...THEATER });
    const moving = resolveActorRender(STANDING_POSE, {
      groundPosition: GROUND,
      ...THEATER,
      suppressFloat: true,
    });
    expect({ ...moving, disableFloat: still.disableFloat }).toEqual(still);
  });
});
