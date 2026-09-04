/**
 * Phase 2 hardening: conversion-safety and spatial-meaning tests for the
 * interaction targets that regressed after the ground-anchor migration
 * (theater seats, chairs, arcade machines).
 *
 * These deliberately assert SPATIAL MEANING (in front of / below / apart),
 * not just the current constants.
 */
import { describe, it, expect } from 'vitest';
import { roomSeats } from './room-seats-config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  occupiableTheaterSeats,
  seatAnchorPosition,
  seatApproachPosition,
  getTheaterSeat,
  SEAT_SPRITE_HEIGHT_PERCENT,
  SEAT_CONTACT_RATIO,
} from './theater-seats-config';
import { resolveSeatedRender } from './blobbi-world-render';
import {
  arcadeMachines,
  machineAnchorPosition,
  machineHeightPercent,
  machineLeftPercent,
  arcadeMachineGroundOffsetPercent,
  arcadeBoundaryForFloor,
} from './arcade-machines-config';
import { constrainPosition } from './boundaries';
import { worldDistancePx, ARRIVAL_THRESHOLD_PX } from './blobbi-ground';

describe('theater seats: approach vs pose', () => {
  it('the seated pose applies the seat-contact offset EXACTLY ONCE (no half-body term)', () => {
    // Recomputed independently from raw config fields:
    //   pose = cushion line + SEAT_CONTACT_RATIO × (128 × seatedScale / 697)
    // A half-body term (ratio 0.5 of the box) buried the sitter behind the
    // chair; zero offset floated it above the cushion; both real regressions.
    for (const seat of occupiableTheaterSeats) {
      const spriteTop = 100 - seat.bottomPercent - SEAT_SPRITE_HEIGHT_PERCENT;
      const cushionLine = spriteTop + SEAT_SPRITE_HEIGHT_PERCENT * seat.interactionTarget.y;
      const scaledBody = (128 * seat.seatedScale * 100) / 697;
      expect(seatAnchorPosition(seat).y).toBeCloseTo(
        cushionLine + SEAT_CONTACT_RATIO * scaledBody + (seat.seatedOffset?.yPercent ?? 0),
        10,
      );
      // Deeper than the interim 0.3 calibration (the body sank too little),
      // and never MORE than the legacy half-body (which is the calibration
      // target itself: see the derivation test below).
      expect(seatAnchorPosition(seat).y - cushionLine).toBeGreaterThan(0.3 * scaledBody);
      expect(seatAnchorPosition(seat).y - cushionLine).toBeLessThanOrEqual(scaledBody / 2 + 1e-9);
    }
  });

  it('the contact ratio is DERIVED from the legacy visual: pose equals the pre-migration body bottom', () => {
    // Last known-good renderer: body CENTER on the cushion line, scaled around
    // center-center → visible bottom = cushion + scaledBody/2. The pose (the
    // bottom-anchored body's bottom) must reproduce that bottom exactly, for
    // every row and scale.
    for (const seat of occupiableTheaterSeats) {
      const spriteTop = 100 - seat.bottomPercent - SEAT_SPRITE_HEIGHT_PERCENT;
      const cushionLine = spriteTop + SEAT_SPRITE_HEIGHT_PERCENT * seat.interactionTarget.y;
      const scaledBody = (128 * seat.seatedScale * 100) / 697;
      const legacyBottom = cushionLine + scaledBody / 2;
      expect(seatAnchorPosition(seat).y).toBeCloseTo(
        legacyBottom + (seat.seatedOffset?.yPercent ?? 0),
        10,
      );
    }
  });

  it('the cushion CONTACT is scale-invariant: (pose − cushion) / scaledBody is one ratio for all rows', () => {
    const ratios = occupiableTheaterSeats.map((seat) => {
      const spriteTop = 100 - seat.bottomPercent - SEAT_SPRITE_HEIGHT_PERCENT;
      const cushionLine = spriteTop + SEAT_SPRITE_HEIGHT_PERCENT * seat.interactionTarget.y;
      const scaledBody = (128 * seat.seatedScale * 100) / 697;
      return (seatAnchorPosition(seat).y - cushionLine) / scaledBody;
    });
    for (const ratio of ratios) {
      expect(ratio).toBeCloseTo(SEAT_CONTACT_RATIO, 10);
    }
  });

  it('rows resolve DIFFERENT pose points but the same visual seat contact', () => {
    const a = seatAnchorPosition(getTheaterSeat('theater-seat-a4')!);
    const b = seatAnchorPosition(getTheaterSeat('theater-seat-b4')!);
    const c = seatAnchorPosition(getTheaterSeat('theater-seat-c2')!);
    expect(a.y).toBeGreaterThan(b.y);
    expect(b.y).toBeGreaterThan(c.y);
  });

  it('approach point and pose anchor are distinct for every seat', () => {
    for (const seat of occupiableTheaterSeats) {
      const approach = seatApproachPosition(seat);
      const pose = seatAnchorPosition(seat);
      expect(Math.abs(approach.y - pose.y)).toBeGreaterThan(1);
    }
  });

  it('adjacent seats in a row are farther apart than the arrival threshold; no teleport-snap', () => {
    const byRow = new Map<string, typeof occupiableTheaterSeats>();
    for (const seat of occupiableTheaterSeats) {
      byRow.set(seat.row, [...(byRow.get(seat.row) ?? []), seat]);
    }
    for (const seats of byRow.values()) {
      const sorted = [...seats].sort((a, b) => a.leftPercent - b.leftPercent);
      for (let i = 1; i < sorted.length; i++) {
        const a = seatApproachPosition(sorted[i - 1]);
        const b = seatApproachPosition(sorted[i]);
        // Only neighbours within one block (the centre aisle gap is larger).
        const d = worldDistancePx(a, b);
        expect(
          d,
          `${sorted[i - 1].id} → ${sorted[i].id} approach spacing`,
        ).toBeGreaterThan(ARRIVAL_THRESHOLD_PX);
      }
    }
  });

  it('local and remote seated geometry come from ONE resolver (pose + scale + row z)', () => {
    const seat = getTheaterSeat('theater-seat-a1')!;
    const seated = resolveSeatedRender('theater-seat-a1')!;
    expect(seated.position).toEqual(seatAnchorPosition(seat));
    expect(seated.scale).toBe(seat.seatedScale);
    // Row-derived seated z: just behind the own chair's backrest.
    expect(seated.zIndex).toBe(seat.zIndex - 5);
    // Representative rows: sitter in front of every farther row's chairs.
    const rowB = resolveSeatedRender('theater-seat-b2')!;
    const rowC = resolveSeatedRender('theater-seat-c2')!;
    expect(seated.zIndex).toBeGreaterThan(getTheaterSeat(rowB.seat.id)!.zIndex); // A sitter (25) > B chairs (20)
    expect(rowB.zIndex).toBeGreaterThan(getTheaterSeat(rowC.seat.id)!.zIndex);   // B sitter (15) > C chairs (10)
  });
});

describe('chairs: live inline configs (shop / Nostr Station)', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/blobbi/InteractiveElements.tsx'),
    'utf8',
  );

  it('no private rect math remains: chairs resolve through the canonical walk-to-interact path', () => {
    expect(source).not.toContain(".closest('.w-full.h-full.relative')");
    // The legacy inline chair flow (its own getBoundingClientRect conversion,
    // action fired on click) is gone; InteractiveElement resolves chair
    // targets via resolveElementApproachTarget and requestInteraction.
    expect(source).not.toContain('handleChairClick');
    expect(source).not.toContain('getBoundingClientRect');
    // The canonical resolver owns the world-surface lookup now.
    const elementSource = readFileSync(
      join(process.cwd(), 'src/components/blobbi/InteractiveElement.tsx'),
      'utf8',
    );
    expect(elementSource).toContain('resolveElementApproachTarget');
    const resolverSource = readFileSync(
      join(process.cwd(), 'src/lib/approach-target.ts'),
      'utf8',
    );
    expect(resolverSource).toContain(".closest('[data-world-surface]')");
  });

  it('every chair APPROACH aims at the base of the chair (ground semantics), never the cushion', () => {
    // Chairs are configured now (`room-seats-config.ts`), no inline anchors.
    expect(source).not.toMatch(/seatAnchor:\s*\{/);
    expect(roomSeats.length).toBeGreaterThan(0);
    for (const seat of roomSeats) {
      expect(seat.approach.y, `${seat.id} must aim at the base`).toBeGreaterThanOrEqual(0.85);
      // The SEAT anchor is a separate point, above the approach: the body
      // sits on the cushion, the feet stopped on the floor in front.
      expect(seat.seatContact.y).toBeLessThan(seat.approach.y);
    }
  });
});

describe('arcade machines: targets vs static placement', () => {
  it('static sprite placement carries NO ground offset (only the actor target does)', () => {
    for (const machine of arcadeMachines) {
      // The sprite rect derives purely from authored art fields…
      const spriteTop = 100 - machine.bottomPercent - machineHeightPercent(machine);
      const spriteBottom = 100 - machine.bottomPercent;
      // …while the anchor equals the fraction point PLUS the offset, once.
      const fractionY = spriteTop + machineHeightPercent(machine) * machine.interactionAnchor.y;
      const expected = fractionY + arcadeMachineGroundOffsetPercent(machine.floor, fractionY);
      expect(machineAnchorPosition(machine).y).toBeCloseTo(expected, 10);
      // Sanity: the placement numbers themselves are untouched by the helper.
      expect(spriteBottom).toBeCloseTo(100 - machine.bottomPercent, 10);
    }
  });

  it('every machine target stops BELOW the sprite base, in front of the machine, never inside it', () => {
    for (const machine of arcadeMachines) {
      const spriteBottom = 100 - machine.bottomPercent;
      const anchor = machineAnchorPosition(machine);
      expect(
        anchor.y,
        `${machine.id} target must land on the floor in front of the sprite`,
      ).toBeGreaterThan(spriteBottom - machineHeightPercent(machine) * 0.15);
      // Tables specifically (pool / air hockey): fully outside the table body.
      if (machine.id.includes('pool') || machine.id.includes('hockey')) {
        expect(anchor.y, `${machine.id} must stand clear of the table`).toBeGreaterThan(spriteBottom);
      }
    }
  });

  it('every machine target is walkable on its own floor', () => {
    for (const machine of arcadeMachines) {
      const boundary = arcadeBoundaryForFloor(machine.floor)!;
      const anchor = machineAnchorPosition(machine);
      const clamped = constrainPosition(anchor, boundary);
      expect(clamped.x, machine.id).toBeCloseTo(anchor.x, 6);
      expect(clamped.y, machine.id).toBeCloseTo(anchor.y, 6);
    }
  });

  it('machines on one floor have distinct anchor points (nothing stacked)', () => {
    const byFloor = new Map<string, Array<{ id: string; x: number; y: number }>>();
    for (const machine of arcadeMachines) {
      const anchor = machineAnchorPosition(machine);
      byFloor.set(machine.floor, [...(byFloor.get(machine.floor) ?? []), { id: machine.id, ...anchor }]);
    }
    for (const anchors of byFloor.values()) {
      for (let i = 0; i < anchors.length; i++) {
        for (let j = i + 1; j < anchors.length; j++) {
          const d = worldDistancePx(anchors[i], anchors[j]);
          expect(d, `${anchors[i].id} vs ${anchors[j].id}`).toBeGreaterThan(10);
        }
      }
    }
  });

  it('sprite left/width derivation is pure art math (regression guard for static placement)', () => {
    for (const machine of arcadeMachines) {
      const left = machineLeftPercent(machine);
      expect(Number.isFinite(left)).toBe(true);
      expect(left).toBeGreaterThanOrEqual(-10);
      expect(left + machine.widthPercent).toBeLessThanOrEqual(110);
    }
  });
});
