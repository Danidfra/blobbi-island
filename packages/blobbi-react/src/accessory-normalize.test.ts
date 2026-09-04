/**
 * Phase 1 coverage: deterministic accessory layer ordering
 * (docs/blobbi-renderer-contract.md §layer ordering).
 */
import { describe, it, expect } from 'vitest';

import {
  normalizeAccessoryPlacements,
  ACCESSORY_SLOT_RANK,
} from './index';
import type { AccessoryPlacementInput } from './index';

function equip(code: string, overrides: Partial<AccessoryPlacementInput> = {}): AccessoryPlacementInput {
  const slot = (code.split('-').slice(0, -1).join('-') || 'unknown') as AccessoryPlacementInput['slot'];
  return {
    code,
    x: 50,
    y: 50,
    scale: 1,
    rot: 0,
    flipX: false,
    url: `https://example.com/${code}.png`,
    slot,
    ...overrides,
  };
}

describe('normalizeAccessoryPlacements: deterministic layering', () => {
  it('assigns behind-body layers to back and aura, front to face slots', () => {
    const placements = normalizeAccessoryPlacements([
      equip('headwear-1'),
      equip('back-1'),
      equip('aura-1'),
      equip('eyewear-1'),
    ]);

    const byCode = Object.fromEntries(placements.map((p) => [p.code, p.layer]));
    expect(byCode['aura-1']).toBe('behind');
    expect(byCode['back-1']).toBe('behind');
    expect(byCode['eyewear-1']).toBe('front');
    expect(byCode['headwear-1']).toBe('front');
  });

  it('paint order never depends on input (relay tag) order', () => {
    const items = [
      equip('handheld-1'),
      equip('aura-1'),
      equip('headwear-1'),
      equip('back-1'),
      equip('neckwear-1'),
      equip('eyewear-1'),
    ];
    const forward = normalizeAccessoryPlacements(items).map((p) => p.code);
    const reversed = normalizeAccessoryPlacements([...items].reverse()).map((p) => p.code);
    const shuffled = normalizeAccessoryPlacements(
      [items[3], items[0], items[5], items[1], items[4], items[2]],
    ).map((p) => p.code);

    expect(reversed).toEqual(forward);
    expect(shuffled).toEqual(forward);
    expect(forward).toEqual([
      'aura-1',      // furthest back
      'back-1',      // behind body
      'neckwear-1',  // front group, bottom-up
      'eyewear-1',
      'headwear-1',
      'handheld-1',
    ]);
  });

  it('same-slot accessories order deterministically by code', () => {
    const forward = normalizeAccessoryPlacements([
      equip('headwear-9'),
      equip('headwear-1'),
    ]).map((p) => p.code);
    const reversed = normalizeAccessoryPlacements([
      equip('headwear-1'),
      equip('headwear-9'),
    ]).map((p) => p.code);
    expect(forward).toEqual(['headwear-1', 'headwear-9']);
    expect(reversed).toEqual(forward);
  });

  it('unknown/legacy slots use the documented fallback: in FRONT, never hidden', () => {
    const placements = normalizeAccessoryPlacements([
      equip('mystery-item', { slot: 'unknown' }),
      equip('headwear-1'),
    ]);
    const unknown = placements.find((p) => p.code === 'mystery-item')!;
    expect(unknown.layer).toBe('front');
    expect(unknown.layerRank).toBe(ACCESSORY_SLOT_RANK.unknown);
    // Above known front slots (so it is never buried), below color-overlay.
    expect(unknown.layerRank).toBeGreaterThan(ACCESSORY_SLOT_RANK.headwear);
    expect(unknown.layerRank).toBeLessThan(ACCESSORY_SLOT_RANK['color-overlay']);
  });

  it('rear view drops exactly the face-only slots', () => {
    const items = [
      equip('eyewear-1'),
      equip('face-mark-1', { slot: 'face-mark' }),
      equip('handheld-1'),
      equip('headwear-1'),
      equip('back-1'),
      equip('neckwear-1'),
      equip('aura-1'),
    ];
    const rear = normalizeAccessoryPlacements(items, { facing: 'back' }).map((p) => p.code);
    expect(rear).toEqual(['aura-1', 'back-1', 'neckwear-1', 'headwear-1']);

    const front = normalizeAccessoryPlacements(items, { facing: 'front' });
    expect(front).toHaveLength(items.length);
  });

  it('preserves position/scale/rotation/flip and resolves an image URL', () => {
    const [p] = normalizeAccessoryPlacements([
      equip('headwear-1', { x: 47.25, y: 12.6, scale: 1.15, rot: -7.5, flipX: true }),
    ]);
    expect(p).toMatchObject({
      xPercent: 47.25,
      yPercent: 12.6,
      scale: 1.15,
      rotationDeg: -7.5,
      flipX: true,
      imageUrl: 'https://example.com/headwear-1.png',
    });
  });

  it('the body sits at rank 0: behind ranks are negative, front ranks positive', () => {
    for (const [slot, rank] of Object.entries(ACCESSORY_SLOT_RANK)) {
      expect(rank, `slot ${slot} must not collide with the body's rank 0`).not.toBe(0);
    }
  });
});
