/**
 * The renderer's input-normalization contract (Phase 4).
 *
 * `normalizeBlobbiRenderModel` is the ONE place loose external visual data
 * becomes renderable state, so the rules it encodes — defaults, clamping, rear
 * facing, id sanitization — are asserted here rather than through the DOM.
 * Being pure, none of this needs React, a DOM, or a browser.
 *
 * Accessory numeric hardening lives alongside it: an equip tag is external data
 * that lands directly in CSS, and a non-finite value there does not throw — it
 * silently deletes the declaration, teleporting or erasing an accessory.
 */
import { describe, it, expect } from 'vitest';

import {
  normalizeBlobbiRenderModel,
  normalizeInstanceId,
  DEFAULT_ADULT_TYPE,
  FALLBACK_INSTANCE_ID,
} from './index';
import { normalizeAccessoryPlacements } from './index';
import type { AccessoryPlacementInput } from './index';

const model = (input: Partial<Parameters<typeof normalizeBlobbiRenderModel>[0]> = {}) =>
  normalizeBlobbiRenderModel({ visual: {}, instanceId: 'test', ...input });

function equip(code: string, overrides: Partial<AccessoryPlacementInput> = {}): AccessoryPlacementInput {
  return {
    code, x: 40, y: 30, scale: 1, rot: 0, flipX: false,
    url: `https://example.test/${code}.png`,
    slot: 'headwear', ...overrides,
  };
}

describe('stage and adult-type resolution', () => {
  it('defaults an absent or unrecognized stage to baby', () => {
    expect(model().stage).toBe('baby');
    expect(model({ visual: { stage: 'wormhole' as never } }).stage).toBe('baby');
  });

  it('keeps egg as its own stage (it draws the baby body, as it always has)', () => {
    expect(model({ visual: { stage: 'egg' } }).stage).toBe('egg');
  });

  it('carries adultType ONLY for the adult stage, with a default', () => {
    expect(model({ visual: { stage: 'adult' } }).adultType).toBe(DEFAULT_ADULT_TYPE);
    expect(model({ visual: { stage: 'adult', adultType: 'catti' } }).adultType).toBe('catti');
    // A baby carrying a stale adultType must not smuggle it into the drawing.
    expect(model({ visual: { stage: 'baby', adultType: 'catti' } }).adultType).toBeUndefined();
  });

  it('leaves absent colors undefined — meaning "the artwork\'s own colors"', () => {
    const resolved = model();
    expect(resolved.baseColor).toBeUndefined();
    expect(resolved.secondaryColor).toBeUndefined();
    expect(resolved.eyeColor).toBeUndefined();
  });
});

describe('facing, eyes and gaze', () => {
  it('maps facing onto the SVG variant to build', () => {
    expect(model().view).toBe('front');
    expect(model({ facing: 'back' }).view).toBe('rear');
  });

  it('collapses isSleeping and the legacy seated eyesClosed', () => {
    expect(model().eyesClosed).toBe(false);
    expect(model({ isSleeping: true }).eyesClosed).toBe(true);
    expect(model({ eyesClosed: true }).eyesClosed).toBe(true);
  });

  it('clamps each gaze axis to -1..1', () => {
    expect(model({ eyeOffset: { x: 5, y: -9 } }).gaze).toEqual({ x: 1, y: -1 });
    expect(model({ eyeOffset: { x: 0.25, y: -0.5 } }).gaze).toEqual({ x: 0.25, y: -0.5 });
  });

  it('turns a non-finite gaze axis into 0 rather than broken CSS', () => {
    expect(model({ eyeOffset: { x: NaN, y: Infinity } }).gaze).toEqual({ x: 0, y: 0 });
  });

  it('drops gaze entirely when rear-facing — that drawing has no pupils', () => {
    expect(model({ facing: 'back', eyeOffset: { x: 1, y: 1 } }).gaze).toBeNull();
  });

  it('distinguishes "no gaze" from "gaze of zero"', () => {
    // A static preview must leave the SVG untouched; a Blobbi looking straight
    // ahead must still get the gaze markup, so it can move next frame.
    expect(model().gaze).toBeNull();
    expect(model({ eyeOffset: { x: 0, y: 0 } }).gaze).toEqual({ x: 0, y: 0 });
  });
});

describe('instance id safety', () => {
  it('reduces an id to characters that are legal in an SVG id', () => {
    expect(normalizeInstanceId('preview:abc/1')).toBe('preview_abc_1');
    expect(normalizeInstanceId('blobbi-npub1x-pet7')).toBe('blobbi-npub1x-pet7');
  });

  it('is idempotent, so a normalized id survives a second pass unchanged', () => {
    const once = normalizeInstanceId('a b:c/d');
    expect(normalizeInstanceId(once)).toBe(once);
  });

  it('falls back when the caller supplies nothing usable', () => {
    // These would otherwise all collapse to the SAME id prefix, silently
    // sharing gradients between unrelated Blobbis.
    for (const empty of ['', '   ', ':::', undefined]) {
      expect(normalizeInstanceId(empty)).toBe(FALLBACK_INSTANCE_ID);
    }
  });

  it('keeps distinct caller ids distinct', () => {
    expect(normalizeInstanceId('pub-a:sess-1')).not.toBe(normalizeInstanceId('pub-a:sess-2'));
  });
});

describe('accessory normalization is deterministic and CSS-safe', () => {
  it('orders by (layerRank, code) regardless of input order', () => {
    const forward = normalizeAccessoryPlacements([
      equip('headwear-2'), equip('aura-1', { slot: 'aura' }), equip('headwear-1'),
    ]);
    const reversed = normalizeAccessoryPlacements([
      equip('headwear-1'), equip('aura-1', { slot: 'aura' }), equip('headwear-2'),
    ]);
    expect(forward.map((p) => p.code)).toEqual(reversed.map((p) => p.code));
    expect(forward.map((p) => p.code)).toEqual(['aura-1', 'headwear-1', 'headwear-2']);
    expect(forward[0].layer).toBe('behind');
  });

  it('hides face-only slots when rear-facing, and keeps the rest', () => {
    const rear = normalizeAccessoryPlacements(
      [
        equip('eyewear-1', { slot: 'eyewear' }),
        equip('handheld-1', { slot: 'handheld' }),
        equip('face-mark-1', { slot: 'face-mark' }),
        equip('headwear-1'),
        equip('back-1', { slot: 'back' }),
      ],
      { facing: 'back' },
    );
    expect(rear.map((p) => p.code)).toEqual(['back-1', 'headwear-1']);
  });

  it('replaces every non-finite numeric field with a renderable default', () => {
    const [placement] = normalizeAccessoryPlacements([
      equip('headwear-1', {
        x: NaN, y: Infinity, scale: NaN, rot: -Infinity,
        flipX: undefined as unknown as boolean,
      }),
    ]);

    expect(placement.xPercent).toBe(50);
    expect(placement.yPercent).toBe(50);
    expect(placement.scale).toBe(1);
    expect(placement.rotationDeg).toBe(0);
    expect(placement.flipX).toBe(false);

    for (const value of [placement.xPercent, placement.yPercent, placement.scale, placement.rotationDeg]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('rejects a zero or negative scale, which would erase the accessory', () => {
    expect(normalizeAccessoryPlacements([equip('h', { scale: 0 })])[0].scale).toBe(1);
    expect(normalizeAccessoryPlacements([equip('h', { scale: -2 })])[0].scale).toBe(1);
    // A legitimately small scale is left alone.
    expect(normalizeAccessoryPlacements([equip('h', { scale: 0.25 })])[0].scale).toBe(0.25);
  });

  it('preserves decimal precision authored by drag editing', () => {
    const [placement] = normalizeAccessoryPlacements([equip('h', { x: 41.375, y: 29.5 })]);
    expect(placement.xPercent).toBe(41.375);
    expect(placement.yPercent).toBe(29.5);
  });

  it('resolves a non-empty, de-duplicated source list for every placement', () => {
    const [placement] = normalizeAccessoryPlacements([equip('headwear-1')]);
    expect(placement.sources.length).toBeGreaterThan(0);
    expect(new Set(placement.sources).size).toBe(placement.sources.length);
    expect(placement.sources.every((s) => s.length > 0)).toBe(true);
    expect(placement.imageUrl).toBe(placement.sources[0]);
  });

  it('treats undefined equipment as no accessories', () => {
    expect(normalizeAccessoryPlacements(undefined)).toEqual([]);
    expect(normalizeAccessoryPlacements([])).toEqual([]);
  });
});
