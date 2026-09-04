/**
 * The particle randomness must not be random.
 *
 * Everything downstream, "re-rendering does not teleport a particle", "a
 * server render matches its hydration", "the same Blobbi always looks the
 * same": reduces to properties of these four functions, so they are tested
 * directly rather than only through the markup they end up in.
 */
import { describe, it, expect } from 'vitest';
import {
  hashString,
  unitFor,
  lerp,
  rangeFor,
  roundedRangeFor,
  pickFor,
} from './deterministic';

describe('hashString', () => {
  it('is stable, and stays a 32-bit unsigned integer', () => {
    for (const input of ['', 'a', 'blobbi', 'x'.repeat(500), '🙂 mixed ünïcode']) {
      const first = hashString(input);
      expect(hashString(input)).toBe(first);
      expect(Number.isInteger(first)).toBe(true);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('separates inputs that differ only in one character', () => {
    expect(hashString('golden-sparkles|1|x')).not.toBe(hashString('golden-sparkles|2|x'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});

describe('unitFor', () => {
  it('is pure: the same triple always yields the same number', () => {
    expect(unitFor('seed', 3, 'x')).toBe(unitFor('seed', 3, 'x'));
    // 200 repeats, because a hidden `Math.random()` would pass a single one.
    const value = unitFor('bb1:mystic-fog', 7, 'dy');
    for (let i = 0; i < 200; i++) {
      expect(unitFor('bb1:mystic-fog', 7, 'dy')).toBe(value);
    }
  });

  it('always lands in [0, 1)', () => {
    for (let i = 0; i < 3000; i++) {
      const value = unitFor('seed', i, 'field');
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('decorrelates the fields, so position and timing do not line up', () => {
    // If `x` and `delay` came from the same stream, every particle placed to
    // the right would also start late, and the scatter would read as a ramp.
    const xs: number[] = [];
    const delays: number[] = [];
    for (let i = 0; i < 60; i++) {
      xs.push(unitFor('seed', i, 'x'));
      delays.push(unitFor('seed', i, 'delay'));
    }
    expect(xs).not.toEqual(delays);
    const matches = xs.filter((x, i) => Math.abs(x - delays[i]) < 0.02).length;
    expect(matches).toBeLessThan(8);
  });

  it('spreads successive indices across the range instead of walking it', () => {
    // Twelve consecutive indices should not come out sorted, and should not
    // cluster in one third of the range; either would be visible as a line of
    // particles marching across the box.
    const values = Array.from({ length: 12 }, (_, i) => unitFor('spread', i, 'x'));
    const sorted = [...values].sort((a, b) => a - b);
    expect(values).not.toEqual(sorted);

    const buckets = [0, 0, 0];
    for (const value of values) buckets[Math.min(2, Math.floor(value * 3))]++;
    expect(Math.max(...buckets)).toBeLessThan(9);
  });

  it('gives different seeds different layouts', () => {
    // This is what makes two Blobbis side by side look independent.
    const a = Array.from({ length: 10 }, (_, i) => unitFor('bbA:golden-sparkles', i, 'x'));
    const b = Array.from({ length: 10 }, (_, i) => unitFor('bbB:golden-sparkles', i, 'x'));
    expect(a).not.toEqual(b);
  });

  it('does not collide when index and field could be ambiguously concatenated', () => {
    // ('s', 12, 'x') and ('s', 1, '2x') would share a key without a separator.
    expect(unitFor('s', 12, 'x')).not.toBe(unitFor('s', 1, '2x'));
  });
});

describe('range helpers', () => {
  it('lerp is the plain linear interpolation', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(-4, 4, 0.5)).toBe(0);
  });

  it('rangeFor never leaves the declared range, including negative ones', () => {
    for (let i = 0; i < 1500; i++) {
      const rising = rangeFor('seed', i, 'dy', -52, -34);
      expect(rising).toBeGreaterThanOrEqual(-52);
      expect(rising).toBeLessThan(-34);

      const size = rangeFor('seed', i, 'sz', 2.4, 5.4);
      expect(size).toBeGreaterThanOrEqual(2.4);
      expect(size).toBeLessThan(5.4);
    }
  });

  it('roundedRangeFor produces short, comparable numbers', () => {
    for (let i = 0; i < 100; i++) {
      const value = roundedRangeFor('seed', i, 'x', 0, 100, 2);
      expect(String(value).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
    }
    expect(roundedRangeFor('seed', 1, 'x', 5, 5)).toBe(5);
  });
});

describe('pickFor', () => {
  it('always returns a member of the list, deterministically', () => {
    const colors = ['#a', '#b', '#c', '#d'];
    for (let i = 0; i < 500; i++) {
      const picked = pickFor('seed', i, 'c', colors);
      expect(colors).toContain(picked);
      expect(pickFor('seed', i, 'c', colors)).toBe(picked);
    }
  });

  it('uses the whole list rather than favouring one entry', () => {
    const colors = ['#a', '#b', '#c', '#d'];
    const used = new Set(
      Array.from({ length: 40 }, (_, i) => pickFor('seed', i, 'c', colors)),
    );
    expect(used.size).toBe(colors.length);
  });

  it('refuses an empty list instead of returning undefined', () => {
    // Returning `undefined` would land the string "undefined" inside a CSS
    // gradient, where it fails silently and looks like a colour bug.
    expect(() => pickFor('seed', 0, 'c', [])).toThrow(/empty list/);
  });
});
