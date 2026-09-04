/**
 * Digging: one use per valid attempt, at most one reveal, never twice.
 */

import { describe, it, expect } from 'vitest';

import { DEFAULT_TREASURE_HUNT_POLICY } from './policy';
import { resolveDig } from './digging';
import type { Point, TreasureTarget } from './types';

const POLICY = DEFAULT_TREASURE_HUNT_POLICY;

function target(overrides: Partial<TreasureTarget> & { id: string; position: Point }): TreasureTarget {
  return {
    category: 'litter',
    kind: 'bottle-cap',
    detectionRadius: 0.16,
    digRadius: 0.07,
    signalWeight: 0.85,
    rawValue: 1,
    found: false,
    ...overrides,
  };
}

describe('resolveDig', () => {
  it('reveals the target under the shovel and consumes one use', () => {
    const buried = target({ id: 'target-1', position: { x: 0.3, y: 0.3 } });
    const result = resolveDig({ x: 0.3, y: 0.3 }, [buried], 5, POLICY);
    expect(result).toEqual({ type: 'hit', targetId: 'target-1', shovelUsesConsumed: 1 });
  });

  it('hits within the dig radius and misses beyond it', () => {
    const buried = target({ id: 'target-1', position: { x: 0.3, y: 0.3 } });
    const inside = resolveDig({ x: 0.3 + 0.05, y: 0.3 }, [buried], 5, POLICY);
    expect(inside.type).toBe('hit');
    const outside = resolveDig({ x: 0.3 + 0.08, y: 0.3 }, [buried], 5, POLICY);
    expect(outside).toEqual({ type: 'miss', shovelUsesConsumed: 1 });
  });

  it('reveals only the closest eligible target when digs overlap', () => {
    const nearer = target({ id: 'target-1', position: { x: 0.32, y: 0.3 } });
    const farther = target({ id: 'target-2', position: { x: 0.26, y: 0.3 } });
    const result = resolveDig({ x: 0.3, y: 0.3 }, [farther, nearer], 5, POLICY);
    expect(result).toEqual({ type: 'hit', targetId: 'target-1', shovelUsesConsumed: 1 });
  });

  it('resolves an exact distance tie to the earlier target in array order', () => {
    const left = target({ id: 'target-1', position: { x: 0.25, y: 0.3 } });
    const right = target({ id: 'target-2', position: { x: 0.35, y: 0.3 } });
    const result = resolveDig({ x: 0.3, y: 0.3 }, [left, right], 5, POLICY);
    expect(result).toEqual({ type: 'hit', targetId: 'target-1', shovelUsesConsumed: 1 });
    // Same pair, swapped order: the other one wins, the rule is array order.
    const swapped = resolveDig({ x: 0.3, y: 0.3 }, [right, left], 5, POLICY);
    expect(swapped).toEqual({ type: 'hit', targetId: 'target-2', shovelUsesConsumed: 1 });
  });

  it('never reveals an already-found target', () => {
    const dugUp = target({ id: 'target-1', position: { x: 0.3, y: 0.3 }, found: true });
    const result = resolveDig({ x: 0.3, y: 0.3 }, [dugUp], 5, POLICY);
    expect(result).toEqual({ type: 'miss', shovelUsesConsumed: 1 });
  });

  it('digs the neighbor once the closest target has been found', () => {
    const found = target({ id: 'target-1', position: { x: 0.3, y: 0.3 }, found: true });
    const buried = target({ id: 'target-2', position: { x: 0.34, y: 0.3 } });
    const result = resolveDig({ x: 0.3, y: 0.3 }, [found, buried], 5, POLICY);
    expect(result).toEqual({ type: 'hit', targetId: 'target-2', shovelUsesConsumed: 1 });
  });

  it('rejects with no shovel uses remaining, consuming nothing', () => {
    const buried = target({ id: 'target-1', position: { x: 0.3, y: 0.3 } });
    const result = resolveDig({ x: 0.3, y: 0.3 }, [buried], 0, POLICY);
    expect(result).toEqual({
      type: 'rejected',
      reason: 'no-shovel-uses',
      shovelUsesConsumed: 0,
    });
  });

  it('rejects a non-finite point without consuming a use', () => {
    const result = resolveDig({ x: Number.NaN, y: 0.3 }, [], 5, POLICY);
    expect(result).toEqual({
      type: 'rejected',
      reason: 'invalid-position',
      shovelUsesConsumed: 0,
    });
  });

  it('rejects an out-of-field point without consuming a use; no silent clamping', () => {
    const result = resolveDig({ x: 1.2, y: 0.3 }, [], 5, POLICY);
    expect(result).toEqual({
      type: 'rejected',
      reason: 'out-of-field',
      shovelUsesConsumed: 0,
    });
  });

  it('reports invalid input ahead of the shovel budget', () => {
    const result = resolveDig({ x: Number.NaN, y: 0.3 }, [], 0, POLICY);
    expect(result.type).toBe('rejected');
    if (result.type === 'rejected') expect(result.reason).toBe('invalid-position');
  });

  it('is deterministic', () => {
    const buried = target({ id: 'target-1', position: { x: 0.31, y: 0.29 } });
    const first = resolveDig({ x: 0.3, y: 0.3 }, [buried], 3, POLICY);
    const second = resolveDig({ x: 0.3, y: 0.3 }, [buried], 3, POLICY);
    expect(second).toEqual(first);
  });
});
