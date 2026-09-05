/**
 * Movement heading → body facing, and which bodies are allowed to turn.
 */
import { describe, it, expect } from 'vitest';
import type { BlobbiVisual } from '@blobbi/renderer';
import { facingFromHeading, resolveBodyFacing } from './blobbi-facing';

describe('facingFromHeading', () => {
  it.each([
    [{ x: 0, y: 1 }, 'front'],
    [{ x: 0, y: -1 }, 'back'],
    [{ x: 1, y: 0 }, 'right'],
    [{ x: -1, y: 0 }, 'left'],
    // Diagonals: the dominant axis.
    [{ x: 0.9, y: 0.4 }, 'right'],
    [{ x: -0.9, y: -0.4 }, 'left'],
    [{ x: 0.3, y: 0.95 }, 'front'],
    [{ x: 0.3, y: -0.95 }, 'back'],
    // Exact ties are vertical, deterministically.
    [{ x: 0.7071, y: 0.7071 }, 'front'],
    [{ x: -0.7071, y: -0.7071 }, 'back'],
  ] as const)('%j → %s', (heading, facing) => {
    expect(facingFromHeading(heading)).toBe(facing);
  });

  it('no heading yields the fallback (front unless told otherwise)', () => {
    expect(facingFromHeading({ x: 0, y: 0 })).toBe('front');
    expect(facingFromHeading({ x: 0.0001, y: -0.0001 })).toBe('front');
    expect(facingFromHeading({ x: 0, y: 0 }, 'left')).toBe('left');
  });

  it('is pure: repeated calls agree', () => {
    for (const h of [{ x: 0.6, y: -0.8 }, { x: -0.2, y: 0.1 }]) {
      expect(facingFromHeading(h)).toBe(facingFromHeading(h));
    }
  });
});

describe('resolveBodyFacing', () => {
  const v1: BlobbiVisual = { stage: 'adult', adultType: 'catti', baseColor: '#F2A0C0' };
  const v2: BlobbiVisual = { ...v1, visualGeneration: 'v2' };

  it('V1 ignores the movement facing entirely: a walking V1 body never turns', () => {
    for (const movementFacing of ['left', 'right', 'back', 'front'] as const) {
      expect(resolveBodyFacing({ visual: v1, poseFacing: 'front', movementFacing })).toBe('front');
    }
    expect(resolveBodyFacing({ visual: { ...v1, visualGeneration: 'v1' }, poseFacing: 'front', movementFacing: 'left' })).toBe('front');
  });

  it('V2 follows the movement facing while standing', () => {
    for (const movementFacing of ['left', 'right', 'back', 'front'] as const) {
      expect(resolveBodyFacing({ visual: v2, poseFacing: 'front', movementFacing })).toBe(movementFacing);
    }
  });

  it('without a movement facing (seated, sleeping, no controller) V2 keeps the pose facing', () => {
    expect(resolveBodyFacing({ visual: v2, poseFacing: 'front' })).toBe('front');
  });

  it('a rear-facing seat wins for every generation', () => {
    expect(resolveBodyFacing({ visual: v2, poseFacing: 'back', movementFacing: 'left' })).toBe('back');
    expect(resolveBodyFacing({ visual: v1, poseFacing: 'back', movementFacing: 'left' })).toBe('back');
  });
});
