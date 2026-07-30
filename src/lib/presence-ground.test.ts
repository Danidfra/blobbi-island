/**
 * Presence wire-compatibility boundary (Phase 2).
 *
 * Internal Island semantics are GROUND points; the kind 31950 wire keeps
 * legacy CENTER points. These tests pin the conversion pair and the full
 * publish→ingest round-trip through the real event builder.
 */
import { describe, it, expect } from 'vitest';

import { groundToWireCenter, wireCenterToGround } from './presence-ground';
import { buildPresence31950, type PresenceContent } from './multiplayer';
import { blobbiHalfHeightPercent } from './blobbi-ground';
import { getBlobbiSizeForLocation } from './location-blobbi-sizes';
import type { LocationId } from './location-types';

const LOCATIONS: LocationId[] = ['home', 'town', 'stage', 'nostr-station', 'mine'];

describe('ground ↔ wire-center conversion', () => {
  it('wire centers sit half a scaled body ABOVE the internal ground point', () => {
    for (const location of LOCATIONS) {
      const ground = { x: 50, y: 85 };
      const wire = groundToWireCenter(ground, location);
      expect(wire.x).toBe(ground.x);
      expect(wire.y).toBeLessThan(ground.y);
      const size = getBlobbiSizeForLocation(location);
      // The offset magnitude is bounded by the room's scale range around the
      // canonical half body height.
      const atScale1 = blobbiHalfHeightPercent(size, 1);
      expect(ground.y - wire.y).toBeGreaterThan(atScale1 * 0.5);
      expect(ground.y - wire.y).toBeLessThan(atScale1 * 1.7);
    }
  });

  it('round-trips ground → wire → ground within a fraction of a world pixel', () => {
    for (const location of LOCATIONS) {
      for (const y of [70, 80, 90, 96]) {
        const ground = { x: 42.5, y };
        const back = wireCenterToGround(groundToWireCenter(ground, location), location);
        expect(back.x).toBeCloseTo(ground.x, 10);
        // The inverse pair samples the depth ramp at slightly different points;
        // the residual is bounded far below one world pixel (1px ≈ 0.14%).
        expect(Math.abs(back.y - ground.y)).toBeLessThan(0.1);
      }
    }
  });
});

describe('buildPresence31950 — the single ground→wire boundary', () => {
  it('serializes anchor and goal as legacy CENTER points on the wire', () => {
    const ground = { x: 50, y: 90 };
    const goalTo = { x: 60, y: 85 };
    const content: PresenceContent = {
      state: 'moving',
      location: 'stage' as LocationId,
      anchor: { ...ground, ts: 123 },
      goal: { from: ground, to: goalTo, v: 120, ts: 123 },
    };
    const event = buildPresence31950({
      sessionId: 's1',
      islandId: '1',
      location: 'stage' as LocationId,
      blobbiAddr: '31124:pk:d',
      content,
    });
    const wire = JSON.parse(event.content);
    expect(wire.anchor.y).toBeCloseTo(groundToWireCenter(ground, 'stage').y, 10);
    expect(wire.goal.from.y).toBeCloseTo(groundToWireCenter(ground, 'stage').y, 10);
    expect(wire.goal.to.y).toBeCloseTo(groundToWireCenter(goalTo, 'stage').y, 10);
    // Non-positional fields pass through untouched.
    expect(wire.goal.v).toBe(120);
    expect(wire.anchor.ts).toBe(123);
    expect(wire.state).toBe('moving');
    // No new protocol fields are introduced.
    expect(Object.keys(wire).sort()).toEqual(['anchor', 'goal', 'location', 'state']);
    expect(event.kind).toBe(31950);
  });

  it('publish-then-ingest restores the internal ground point (full round-trip)', () => {
    const ground = { x: 30, y: 95 };
    const content: PresenceContent = {
      state: 'idle',
      location: 'town' as LocationId,
      anchor: { ...ground, ts: 5 },
    };
    const event = buildPresence31950({
      sessionId: 's1',
      islandId: '1',
      location: 'town' as LocationId,
      blobbiAddr: '31124:pk:d',
      content,
    });
    const wire = JSON.parse(event.content);
    const restored = wireCenterToGround(wire.anchor, 'town');
    expect(restored.x).toBeCloseTo(ground.x, 10);
    expect(Math.abs(restored.y - ground.y)).toBeLessThan(0.1);
  });
});
