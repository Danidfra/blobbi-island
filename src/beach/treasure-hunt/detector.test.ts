/**
 * Detector: the signal is honest, bounded and lossy.
 *
 * Hand-placed targets, exact distances: the curve, the saturation plateau,
 * the strongest-wins overlap rule and, most importantly, the promise that
 * a signal never leaks a target's coordinates.
 */

import { describe, it, expect } from 'vitest';

import { DEFAULT_TREASURE_HUNT_POLICY, type TreasureHuntPolicy } from './policy';
import { evaluateDetectorSignal, signalStrengthForDistance } from './detector';
import type { Point, TreasureTarget } from './types';

const POLICY: TreasureHuntPolicy = DEFAULT_TREASURE_HUNT_POLICY;

function target(overrides: Partial<TreasureTarget> & { id: string; position: Point }): TreasureTarget {
  return {
    category: 'valuable',
    kind: 'decorative-coin',
    detectionRadius: 0.2,
    digRadius: 0.07,
    signalWeight: 1,
    rawValue: 4,
    found: false,
    ...overrides,
  };
}

describe('signalStrengthForDistance', () => {
  it('is zero at and beyond the detection radius', () => {
    expect(signalStrengthForDistance(0.2, 0.2, 1, POLICY)).toBe(0);
    expect(signalStrengthForDistance(0.3, 0.2, 1, POLICY)).toBe(0);
  });

  it('saturates to the weight at and inside the saturation distance', () => {
    expect(signalStrengthForDistance(POLICY.signalSaturationDistance, 0.2, 1, POLICY)).toBe(1);
    expect(signalStrengthForDistance(0, 0.2, 0.85, POLICY)).toBe(0.85);
  });

  it('increases strictly as distance decreases', () => {
    const distances = [0.18, 0.15, 0.12, 0.09, 0.06, 0.03];
    const strengths = distances.map((d) => signalStrengthForDistance(d, 0.2, 1, POLICY));
    for (let i = 1; i < strengths.length; i += 1) {
      expect(strengths[i]).toBeGreaterThan(strengths[i - 1]);
    }
  });

  it('stays within 0..weight', () => {
    for (let d = 0; d <= 0.25; d += 0.005) {
      const s = signalStrengthForDistance(d, 0.2, 0.85, POLICY);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0.85);
    }
  });
});

describe('evaluateDetectorSignal', () => {
  it('reports silence with no targets in range', () => {
    const far = target({ id: 'target-1', position: { x: 0.9, y: 0.9 } });
    const signal = evaluateDetectorSignal({ x: 0.1, y: 0.1 }, [far], POLICY);
    expect(signal).toEqual({
      intensity: 0,
      nearestTargetId: null,
      nearestDistance: null,
      activeTargetCount: 0,
    });
  });

  it('reports silence over an empty field', () => {
    const signal = evaluateDetectorSignal({ x: 0.5, y: 0.5 }, [], POLICY);
    expect(signal.intensity).toBe(0);
    expect(signal.activeTargetCount).toBe(0);
  });

  it('never exposes target coordinates; only intensity, id, distance, count', () => {
    const buried = target({ id: 'target-1', position: { x: 0.5, y: 0.5 } });
    const signal = evaluateDetectorSignal({ x: 0.45, y: 0.5 }, [buried], POLICY);
    expect(Object.keys(signal).sort()).toEqual([
      'activeTargetCount',
      'intensity',
      'nearestDistance',
      'nearestTargetId',
    ]);
  });

  it('normalizes intensity to 0..1 and saturates on top of a target', () => {
    const buried = target({ id: 'target-1', position: { x: 0.5, y: 0.5 } });
    const onTop = evaluateDetectorSignal({ x: 0.5, y: 0.5 }, [buried], POLICY);
    expect(onTop.intensity).toBe(1);
    for (const dx of [0.02, 0.05, 0.1, 0.15, 0.19]) {
      const s = evaluateDetectorSignal({ x: 0.5 + dx, y: 0.5 }, [buried], POLICY);
      expect(s.intensity).toBeGreaterThanOrEqual(0);
      expect(s.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('grows as the coil approaches the target', () => {
    const buried = target({ id: 'target-1', position: { x: 0.5, y: 0.5 } });
    const farther = evaluateDetectorSignal({ x: 0.65, y: 0.5 }, [buried], POLICY);
    const nearer = evaluateDetectorSignal({ x: 0.55, y: 0.5 }, [buried], POLICY);
    expect(nearer.intensity).toBeGreaterThan(farther.intensity);
  });

  it('ignores found targets entirely', () => {
    const dugUp = target({ id: 'target-1', position: { x: 0.5, y: 0.5 }, found: true });
    const signal = evaluateDetectorSignal({ x: 0.5, y: 0.5 }, [dugUp], POLICY);
    expect(signal.intensity).toBe(0);
    expect(signal.nearestTargetId).toBeNull();
    expect(signal.activeTargetCount).toBe(0);
  });

  it('selects the nearest unresolved in-range target', () => {
    const near = target({ id: 'target-1', position: { x: 0.55, y: 0.5 } });
    const far = target({ id: 'target-2', position: { x: 0.6, y: 0.5 } });
    const signal = evaluateDetectorSignal({ x: 0.5, y: 0.5 }, [far, near], POLICY);
    expect(signal.nearestTargetId).toBe('target-1');
    expect(signal.nearestDistance).toBeCloseTo(0.05, 10);
    expect(signal.activeTargetCount).toBe(2);
  });

  it('skips a found target when picking the nearest', () => {
    const near = target({ id: 'target-1', position: { x: 0.55, y: 0.5 }, found: true });
    const far = target({ id: 'target-2', position: { x: 0.6, y: 0.5 } });
    const signal = evaluateDetectorSignal({ x: 0.5, y: 0.5 }, [near, far], POLICY);
    expect(signal.nearestTargetId).toBe('target-2');
  });

  it('combines overlapping fields as the strongest signal, not the sum', () => {
    const left = target({ id: 'target-1', position: { x: 0.45, y: 0.5 } });
    const right = target({ id: 'target-2', position: { x: 0.55, y: 0.5 } });
    const coil: Point = { x: 0.5, y: 0.5 };
    const alone = evaluateDetectorSignal(coil, [left], POLICY).intensity;
    const together = evaluateDetectorSignal(coil, [left, right], POLICY).intensity;
    expect(together).toBe(alone); // symmetric pair: max === each individual
    expect(together).toBeLessThanOrEqual(1);
    expect(evaluateDetectorSignal(coil, [left, right], POLICY).activeTargetCount).toBe(2);
  });

  it('honors per-target signal weight in the maximum', () => {
    const weak = target({ id: 'target-1', position: { x: 0.5, y: 0.5 }, signalWeight: 0.5 });
    const strong = target({ id: 'target-2', position: { x: 0.52, y: 0.5 } });
    const signal = evaluateDetectorSignal({ x: 0.5, y: 0.5 }, [weak, strong], POLICY);
    // The weak target saturates at 0.5; the strong one nearby reads higher.
    expect(signal.intensity).toBeGreaterThan(0.5);
  });

  it('throws on a non-finite coil position', () => {
    expect(() =>
      evaluateDetectorSignal({ x: Number.NaN, y: 0.5 }, [], POLICY)
    ).toThrow(/finite/);
    expect(() =>
      evaluateDetectorSignal({ x: 0.5, y: Number.POSITIVE_INFINITY }, [], POLICY)
    ).toThrow(/finite/);
  });

  it('is deterministic', () => {
    const buried = target({ id: 'target-1', position: { x: 0.52, y: 0.48 } });
    const first = evaluateDetectorSignal({ x: 0.5, y: 0.5 }, [buried], POLICY);
    const second = evaluateDetectorSignal({ x: 0.5, y: 0.5 }, [buried], POLICY);
    expect(second).toEqual(first);
  });
});
