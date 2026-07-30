/**
 * Phase 1 coverage: accessory tag parsing/serialization precision and the
 * consolidated defaults (docs/blobbi-renderer-contract.md).
 */
import { describe, it, expect } from 'vitest';

import {
  createEquipTag,
  parseEquipTag,
  parseEquipTags,
  parseFiniteNumber,
  EQUIP_TAG_DEFAULTS,
} from './accessory-utils';
import type { EquipmentConfig } from './accessory-types';

const BASE_CONFIG: EquipmentConfig = {
  code: 'headwear-8',
  x: 47.25,
  y: 12.6,
  scale: 1.15,
  rot: -7.5,
  flipX: true,
  refw: 100,
  refh: 100,
  form: 'default',
  url: 'https://example.com/headwear-8.png',
  slot: 'headwear',
};

describe('parseFiniteNumber', () => {
  it('preserves decimals', () => {
    expect(parseFiniteNumber('47.25', 0)).toBe(47.25);
    expect(parseFiniteNumber('-7.5', 0)).toBe(-7.5);
  });

  it('keeps integers as integers', () => {
    expect(parseFiniteNumber('55', 0)).toBe(55);
  });

  it('falls back for absent, empty, or non-finite input — never NaN/Infinity', () => {
    expect(parseFiniteNumber(undefined, 50)).toBe(50);
    expect(parseFiniteNumber('', 50)).toBe(50);
    expect(parseFiniteNumber('  ', 50)).toBe(50);
    expect(parseFiniteNumber('NaN', 50)).toBe(50);
    expect(parseFiniteNumber('Infinity', 50)).toBe(50);
    expect(parseFiniteNumber('not-a-number', 50)).toBe(50);
  });
});

describe('equip tag round-trip precision', () => {
  it('decimal x/y/scale/rot survive serialize → parse → serialize unchanged', () => {
    const tag = createEquipTag(BASE_CONFIG);
    const parsed = parseEquipTags([tag])[0];

    expect(parsed.x).toBe(47.25);
    expect(parsed.y).toBe(12.6);
    expect(parsed.scale).toBe(1.15);
    expect(parsed.rot).toBe(-7.5);
    expect(parsed.flipX).toBe(true);
    expect(parsed.refw).toBe(100);
    expect(parsed.refh).toBe(100);

    // Second round-trip is byte-stable (no cumulative drift).
    expect(createEquipTag(parsed)).toEqual(tag);
  });

  it('serialization limits float noise to 2 decimals without integer truncation', () => {
    const noisy = { ...BASE_CONFIG, x: 55.000000000001, y: 12.34567 };
    const tag = createEquipTag(noisy);
    const x = tag[tag.indexOf('x') + 1];
    const y = tag[tag.indexOf('y') + 1];
    expect(x).toBe('55');
    expect(y).toBe('12.35');
  });

  it('legacy integer positions remain valid and unchanged', () => {
    const legacyTag = [
      'equip', 'eyewear-2',
      'x', '50', 'y', '50', 'scale', '1', 'rot', '0',
      'flipX', '0', 'refw', '100', 'refh', '100',
      'form', 'default', 'url', 'https://example.com/e.png', 'ver', '1',
    ];
    const parsed = parseEquipTags([legacyTag])[0];
    expect(parsed).toMatchObject({ x: 50, y: 50, scale: 1, rot: 0, flipX: false });
  });

  it('no parseInt truncation remains: a drag-produced decimal parses intact', () => {
    const dragTag = [
      'equip', 'headwear-8',
      'x', '63.7', 'y', '21.9', 'scale', '0.85', 'rot', '4.5',
      'flipX', '1', 'refw', '100', 'refh', '100',
      'form', 'default', 'url', 'u', 'ver', '1',
    ];
    const parsed = parseEquipTags([dragTag])[0];
    expect(parsed.x).toBe(63.7);
    expect(parsed.y).toBe(21.9);
    expect(parsed.rot).toBe(4.5);
  });

  it('invalid numeric fields fall back to the shared defaults (never NaN)', () => {
    const badTag = [
      'equip', 'headwear-8',
      'x', 'garbage', 'y', '', 'scale', 'NaN', 'rot', 'Infinity',
      'form', 'default', 'url', 'u', 'ver', '1',
    ];
    const parsed = parseEquipTags([badTag])[0];
    expect(parsed.x).toBe(EQUIP_TAG_DEFAULTS.x);
    expect(parsed.y).toBe(EQUIP_TAG_DEFAULTS.y);
    expect(parsed.scale).toBe(EQUIP_TAG_DEFAULTS.scale);
    expect(parsed.rot).toBe(EQUIP_TAG_DEFAULTS.rot);
    expect(parsed.refw).toBe(EQUIP_TAG_DEFAULTS.refw);
    expect(parsed.refh).toBe(EQUIP_TAG_DEFAULTS.refh);
    for (const value of [parsed.x, parsed.y, parsed.scale, parsed.rot]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('both parsers agree on the same tag (the legacy x:50 vs x:5 default split is gone)', () => {
    const sparseTag = ['equip', 'headwear-8', 'form', 'default', 'url', 'u', 'ver', '1'];
    const viaAll = parseEquipTags([sparseTag])[0];
    const viaOne = parseEquipTag([sparseTag], 'headwear-8');
    expect(viaOne).toEqual(viaAll);
    expect(viaAll.x).toBe(EQUIP_TAG_DEFAULTS.x);
    expect(viaAll.y).toBe(EQUIP_TAG_DEFAULTS.y);
  });

  it('refw/refh are preserved through the round-trip (compatibility, no conversion)', () => {
    const custom = { ...BASE_CONFIG, refw: 128, refh: 128 };
    const parsed = parseEquipTags([createEquipTag(custom)])[0];
    expect(parsed.refw).toBe(128);
    expect(parsed.refh).toBe(128);
    // The x/y they accompany are untouched: coordinates are normalized
    // percentages and get NO ref-dimension conversion (contract §refw/refh).
    expect(parsed.x).toBe(custom.x);
    expect(parsed.y).toBe(custom.y);
  });
});
