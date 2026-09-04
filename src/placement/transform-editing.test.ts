/**
 * Editing an equipped accessory's 2D transform.
 *
 * The editor collects drag/scale/rotate patches per slot and saves them as ONE
 * complete kind:31634 replacement. These assert the batching, the default-
 * omission rule, and, most importantly, that an older client dragging a hat
 * does not delete fields a newer client wrote.
 */
import { describe, it, expect } from 'vitest';

import { ADDRESSED_OFFICIAL_COSMETICS } from '@/protocol/event-registry';
import type { GameItemPlacementEntry } from '@/inventory/package';

import { applyEquipmentMutation } from './useEquipmentMutation';
import { buildEmptyPlacement } from './usePlacementState';
import { buildEquipEntry, PLACEMENT_RENDER_DEFAULTS } from './render-model';

const OWNER = 'a'.repeat(64);
const CHARACTER = 'blobbi-abc123';
const CAP = ADDRESSED_OFFICIAL_COSMETICS[0]!.address;

function equipped(...entries: GameItemPlacementEntry[]) {
  return entries.reduce(
    (placement, entry) =>
      applyEquipmentMutation(placement, {
        type: 'equip',
        slot: entry.slot as string,
        entry,
      }),
    buildEmptyPlacement(OWNER, CHARACTER),
  );
}

const hat = buildEquipEntry({ itemAddress: CAP, slot: 'headwear' });
const scarf = buildEquipEntry({ itemAddress: CAP, slot: 'neckwear' });

describe('set-transforms', () => {
  it('applies a patch to the equipped entry in a slot', () => {
    const next = applyEquipmentMutation(equipped(hat), {
      type: 'set-transforms',
      transforms: { headwear: { x: 60, y: 12, scale: 1.3, rot: -8, flipX: true } },
    });
    const entry = next.placements[0]!;
    expect(entry.position).toEqual({ x: 60, y: 12 });
    expect(entry.scale).toEqual({ x: 1.3, y: 1.3 });
    expect(entry.rotation).toEqual({ type: 'euler', unit: 'degrees', z: -8 });
    expect(entry.flip).toEqual({ x: true, y: false });
  });

  it('edits several slots in one document, not one document per slot', () => {
    const next = applyEquipmentMutation(equipped(hat, scarf), {
      type: 'set-transforms',
      transforms: { headwear: { x: 60 }, neckwear: { y: 70 } },
    });
    expect(next.placements).toHaveLength(2);
    expect(next.placements.find((e) => e.slot === 'headwear')?.position?.x).toBe(60);
    expect(next.placements.find((e) => e.slot === 'neckwear')?.position?.y).toBe(70);
  });

  it('keeps the values it was not given', () => {
    const start = equipped(
      buildEquipEntry({ itemAddress: CAP, slot: 'headwear', x: 20, y: 30, scale: 1.5 }),
    );
    const next = applyEquipmentMutation(start, {
      type: 'set-transforms',
      transforms: { headwear: { rot: 10 } },
    });
    const entry = next.placements[0]!;
    expect(entry.position).toEqual({ x: 20, y: 30 });
    expect(entry.scale).toEqual({ x: 1.5, y: 1.5 });
    expect(entry.rotation?.['z']).toBe(10);
  });

  it('drops a field that returns to the Island default rather than freezing it', () => {
    const start = equipped(
      buildEquipEntry({ itemAddress: CAP, slot: 'headwear', scale: 1.5, rot: 12 }),
    );
    const next = applyEquipmentMutation(start, {
      type: 'set-transforms',
      transforms: {
        headwear: {
          scale: PLACEMENT_RENDER_DEFAULTS.scale,
          rot: PLACEMENT_RENDER_DEFAULTS.rot,
        },
      },
    });
    const entry = next.placements[0]!;
    expect(entry.scale).toBeUndefined();
    expect(entry.rotation).toBeUndefined();
  });

  it('preserves unknown entry fields written by a newer client', () => {
    const start = equipped({
      ...hat,
      futureField: { keep: true },
      layer: 4,
      form: 'baby',
      view: 'front',
    } as GameItemPlacementEntry);

    const next = applyEquipmentMutation(start, {
      type: 'set-transforms',
      transforms: { headwear: { x: 55 } },
    });
    const entry = next.placements[0]!;
    expect(entry['futureField']).toEqual({ keep: true });
    expect(entry.layer).toBe(4);
    expect(entry.form).toBe('baby');
    expect(entry.view).toBe('front');
  });

  it('ignores a slot that is not wearing anything', () => {
    // A transform is an edit to something worn; it must never conjure an entry.
    const next = applyEquipmentMutation(equipped(hat), {
      type: 'set-transforms',
      transforms: { neckwear: { x: 10 } },
    });
    expect(next.placements.map((e) => e.slot)).toEqual(['headwear']);
  });

  it('refuses a slot the renderer does not know', () => {
    expect(() =>
      applyEquipmentMutation(equipped(hat), {
        type: 'set-transforms',
        transforms: { 'third-antenna': { x: 10 } },
      }),
    ).toThrow(/slot/i);
  });

  it('never mutates the document it was given', () => {
    const start = equipped(hat);
    const snapshot = JSON.stringify(start.placements);
    applyEquipmentMutation(start, {
      type: 'set-transforms',
      transforms: { headwear: { x: 99 } },
    });
    expect(JSON.stringify(start.placements)).toBe(snapshot);
  });
});
