/**
 * The accessory EDITOR draws the same artwork the world draws.
 *
 * Phase 6 deliberately left `AccessoryOverlay` definition-blind: it built its own
 * chain (`config.url` → generated URL, then `onError` → local `.webp` → `.png`)
 * while the world went through `createIslandAccessorySourceResolver`. That was
 * harmless only for as long as NO accessory had a published definition. The
 * moment one did, the editor and the world disagreed about what a hat looks
 * like — and the editor is where a human decides that hat's position.
 *
 * These tests pin the two halves of the fix:
 *   ARTWORK is definition-aware, and follows `facing`.
 *   PLACEMENT is not, and nothing is published or mutated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { EquipmentConfig } from './lib/accessory-types';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';

const FRONT = 'https://blossom.invalid/cap-front.webp';
const BACK = 'https://blossom.invalid/cap-back.webp';
const STORED = 'https://stored.invalid/legacy-cap.png';

const MAPPED_CODE = 'headwear-block-builder-cap';
const UNMAPPED_CODE = 'headwear-8';

function equipmentConfig(code: string): EquipmentConfig {
  return {
    code,
    x: 50,
    y: 20,
    scale: 1.25,
    rot: 10,
    flipX: true,
    refw: 100,
    refh: 100,
    form: 'default',
    url: STORED,
    slot: 'headwear',
  };
}

let equipment: EquipmentConfig[] = [];
let definitions: ReadonlyMap<string, ResolvedBlobbiItemDefinition> = new Map();

vi.mock('./hooks/useAccessoryManagement', () => ({
  useAccessoryManagement: () => ({ equipment }),
}));

vi.mock('@/inventory/useAccessoryItemDefinitions', () => ({
  useAccessoryItemDefinitions: () => definitions,
}));

const { AccessoryOverlay } = await import('./AccessoryOverlay');

/** A definition carrying a distinct front and back view. */
function capDefinition(): ResolvedBlobbiItemDefinition {
  return {
    address: '31632:issuer:blobbi:cosmetic:block-builder-cap',
    itemId: MAPPED_CODE,
    d: 'blobbi:cosmetic:block-builder-cap',
    name: 'Block Builder Cap',
    type: 'cosmetic',
    category: 'unknown',
    effects: {},
    action: null,
    stages: [],
    emoji: '🧢',
    image: FRONT,
    images: [
      { url: FRONT },
      { url: FRONT, marker: 'front' },
      { url: BACK, marker: 'back' },
    ],
    topics: [],
    source: 'definition',
  };
}

beforeEach(() => {
  equipment = [];
  definitions = new Map();
});

describe('artwork is definition-aware', () => {
  it('uses the official front image for a mapped accessory', () => {
    equipment = [equipmentConfig(MAPPED_CODE)];
    definitions = new Map([[MAPPED_CODE, capDefinition()]]);

    render(<AccessoryOverlay facing="front" />);

    expect(screen.getByAltText(MAPPED_CODE)).toHaveAttribute('src', FRONT);
  });

  it('uses the official back image when the Blobbi is turned around', () => {
    equipment = [equipmentConfig(MAPPED_CODE)];
    definitions = new Map([[MAPPED_CODE, capDefinition()]]);

    render(<AccessoryOverlay facing="back" />);

    expect(screen.getByAltText(MAPPED_CODE)).toHaveAttribute('src', BACK);
  });

  it('outranks the URL stored on the equip tag', () => {
    // The equip tag still carries the legacy URL, and it is still the fallback —
    // but a published definition is a better authority than a stored guess.
    equipment = [equipmentConfig(MAPPED_CODE)];
    definitions = new Map([[MAPPED_CODE, capDefinition()]]);

    render(<AccessoryOverlay facing="front" />);

    expect(screen.getByAltText(MAPPED_CODE)).not.toHaveAttribute('src', STORED);
  });

  it('leaves an unmapped accessory on its legacy stored URL', () => {
    equipment = [equipmentConfig(UNMAPPED_CODE)];
    definitions = new Map([[MAPPED_CODE, capDefinition()]]);

    render(<AccessoryOverlay facing="front" />);

    expect(screen.getByAltText(UNMAPPED_CODE)).toHaveAttribute('src', STORED);
  });

  it('renders a mapped accessory even when no definition has loaded', () => {
    // Relay outage / cold cache. The hat must not vanish from the editor.
    equipment = [equipmentConfig(MAPPED_CODE)];
    definitions = new Map();

    render(<AccessoryOverlay facing="front" />);

    expect(screen.getByAltText(MAPPED_CODE)).toHaveAttribute('src', STORED);
  });
});

describe('placement stays the legacy equip representation', () => {
  it('applies the stored transform unchanged, mapped or not', () => {
    equipment = [equipmentConfig(MAPPED_CODE)];
    definitions = new Map([[MAPPED_CODE, capDefinition()]]);

    const { container } = render(<AccessoryOverlay facing="front" />);
    const box = container.querySelector<HTMLElement>('[title^="headwear-"]')!;

    // x/y are percentages of the renderer box; scale/rot/flipX ride the same
    // single transform for every view. A definition changes NONE of them.
    expect(box.style.left).toBe('50%');
    expect(box.style.top).toBe('20%');
    expect(box.style.transform).toContain('scale(1.25)');
    expect(box.style.transform).toContain('rotate(10deg)');
    expect(box.style.transform).toContain('scaleX(-1)');
  });

  it('uses one shared transform across facings — no per-view placement', () => {
    equipment = [equipmentConfig(MAPPED_CODE)];
    definitions = new Map([[MAPPED_CODE, capDefinition()]]);

    const front = render(<AccessoryOverlay facing="front" />);
    const frontBox = front.container.querySelector<HTMLElement>('[title^="headwear-"]')!;
    const frontTransform = frontBox.style.transform;
    front.unmount();

    const back = render(<AccessoryOverlay facing="back" />);
    const backBox = back.container.querySelector<HTMLElement>('[title^="headwear-"]')!;

    // Same numbers, different artwork. Per-view placement would need a Placement
    // design, which this phase deliberately does not introduce.
    expect(backBox.style.transform).toBe(frontTransform);
  });
});
