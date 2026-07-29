import { describe, it, expect } from 'vitest';

import {
  ISLAND_DAY_MINUTES,
  ISLAND_DAY_MS,
  ISLAND_EPOCH_MS,
  ISLAND_TICK_MS,
  clamp01,
  islandDayNumberAt,
  islandDayProgressAt,
  islandMinuteAt,
  msUntilNextIslandTick,
} from './island-clock';

describe('island clock constants', () => {
  it('runs one island day per two real hours', () => {
    expect(ISLAND_DAY_MS).toBe(7_200_000);
    expect(ISLAND_DAY_MINUTES).toBe(120);
  });

  it('anchors the epoch to UTC, not the host timezone', () => {
    // The whole point of the design: the same instant must yield the same island
    // time everywhere. Date.UTC ignores the host zone, so this is a fixed number
    // regardless of where the test runs.
    expect(ISLAND_EPOCH_MS).toBe(Date.UTC(2026, 0, 1));
    expect(new Date(ISLAND_EPOCH_MS).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('islandDayProgressAt', () => {
  it('starts the cycle at the epoch', () => {
    expect(islandDayProgressAt(ISLAND_EPOCH_MS)).toBe(0);
  });

  it('is linear through the first day', () => {
    expect(islandDayProgressAt(ISLAND_EPOCH_MS + ISLAND_DAY_MS / 4)).toBeCloseTo(0.25, 12);
    expect(islandDayProgressAt(ISLAND_EPOCH_MS + ISLAND_DAY_MS / 2)).toBeCloseTo(0.5, 12);
    expect(islandDayProgressAt(ISLAND_EPOCH_MS + (ISLAND_DAY_MS * 3) / 4)).toBeCloseTo(0.75, 12);
  });

  it('wraps at the end of a day rather than exceeding 1', () => {
    expect(islandDayProgressAt(ISLAND_EPOCH_MS + ISLAND_DAY_MS)).toBe(0);
    expect(islandDayProgressAt(ISLAND_EPOCH_MS + ISLAND_DAY_MS + 60_000)).toBeCloseTo(
      60_000 / ISLAND_DAY_MS,
      12,
    );
  });

  it('gives the same phase to instants exactly one island day apart', () => {
    const base = ISLAND_EPOCH_MS + 1_234_567;
    for (const days of [1, 7, 365, 5_000]) {
      expect(islandDayProgressAt(base + days * ISLAND_DAY_MS)).toBeCloseTo(
        islandDayProgressAt(base),
        12,
      );
    }
  });

  it('is refresh-safe: repeated reads of the same instant agree', () => {
    // There is no state to restart, which is the property that makes a page
    // reload a no-op. Asserting purity is asserting refresh-safety.
    const instant = ISLAND_EPOCH_MS + 4_321_098;
    const reads = Array.from({ length: 5 }, () => islandDayProgressAt(instant));
    expect(new Set(reads).size).toBe(1);
  });

  it('returns a real phase for timestamps BEFORE the epoch', () => {
    // JavaScript's % keeps the dividend's sign, so a naive implementation returns
    // a negative progress here and every downstream lookup collapses to zero.
    for (const msBefore of [1, 60_000, ISLAND_DAY_MS / 3, ISLAND_DAY_MS, ISLAND_DAY_MS * 10 + 5]) {
      const progress = islandDayProgressAt(ISLAND_EPOCH_MS - msBefore);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThan(1);
    }
  });

  it('mirrors pre-epoch instants onto the correct point of the cycle', () => {
    // One minute before the epoch is one minute before the end of the previous day.
    expect(islandDayProgressAt(ISLAND_EPOCH_MS - 60_000)).toBeCloseTo(
      (ISLAND_DAY_MS - 60_000) / ISLAND_DAY_MS,
      12,
    );
    expect(islandDayProgressAt(ISLAND_EPOCH_MS - ISLAND_DAY_MS)).toBe(0);
  });

  it('stays in range across a wide sweep of real timestamps', () => {
    for (let i = -500; i < 500; i += 1) {
      const progress = islandDayProgressAt(ISLAND_EPOCH_MS + i * 977_777);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThan(1);
    }
  });

  it('degrades to 0 rather than NaN for a nonsense clock', () => {
    expect(islandDayProgressAt(Number.NaN)).toBe(0);
    expect(islandDayProgressAt(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('islandDayNumberAt', () => {
  it('counts days forward from the epoch', () => {
    expect(islandDayNumberAt(ISLAND_EPOCH_MS)).toBe(0);
    expect(islandDayNumberAt(ISLAND_EPOCH_MS + ISLAND_DAY_MS - 1)).toBe(0);
    expect(islandDayNumberAt(ISLAND_EPOCH_MS + ISLAND_DAY_MS)).toBe(1);
    expect(islandDayNumberAt(ISLAND_EPOCH_MS + 12 * ISLAND_DAY_MS)).toBe(12);
  });

  it('floors rather than truncates, so it decreases before the epoch', () => {
    expect(islandDayNumberAt(ISLAND_EPOCH_MS - 1)).toBe(-1);
    expect(islandDayNumberAt(ISLAND_EPOCH_MS - ISLAND_DAY_MS)).toBe(-1);
    expect(islandDayNumberAt(ISLAND_EPOCH_MS - ISLAND_DAY_MS - 1)).toBe(-2);
  });

  it('changes exactly when the progress wraps', () => {
    const justBefore = ISLAND_EPOCH_MS + ISLAND_DAY_MS - 1;
    const justAfter = ISLAND_EPOCH_MS + ISLAND_DAY_MS;
    expect(islandDayProgressAt(justBefore)).toBeGreaterThan(0.999);
    expect(islandDayProgressAt(justAfter)).toBe(0);
    expect(islandDayNumberAt(justAfter) - islandDayNumberAt(justBefore)).toBe(1);
  });
});

describe('islandMinuteAt', () => {
  it('reports island minutes in [0, 120)', () => {
    expect(islandMinuteAt(ISLAND_EPOCH_MS)).toBe(0);
    expect(islandMinuteAt(ISLAND_EPOCH_MS + 30 * 60_000)).toBeCloseTo(30, 9);
    expect(islandMinuteAt(ISLAND_EPOCH_MS + 119 * 60_000)).toBeCloseTo(119, 9);
    expect(islandMinuteAt(ISLAND_EPOCH_MS + 120 * 60_000)).toBe(0);
  });
});

describe('msUntilNextIslandTick', () => {
  it('aligns ticks to absolute boundaries so clients step together', () => {
    // Two clients that mounted at different moments must land on the same
    // instants, or they drift up to a full tick apart from each other.
    expect(msUntilNextIslandTick(0)).toBe(ISLAND_TICK_MS);
    expect(msUntilNextIslandTick(ISLAND_TICK_MS)).toBe(ISLAND_TICK_MS);
    expect(msUntilNextIslandTick(ISLAND_TICK_MS + 1)).toBe(ISLAND_TICK_MS - 1);
    expect(msUntilNextIslandTick(ISLAND_TICK_MS * 3 - 250)).toBe(250);
  });

  it('never returns 0, so a scheduler cannot spin', () => {
    for (let offset = 0; offset < ISLAND_TICK_MS; offset += 137) {
      expect(msUntilNextIslandTick(offset)).toBeGreaterThan(0);
      expect(msUntilNextIslandTick(offset)).toBeLessThanOrEqual(ISLAND_TICK_MS);
    }
  });

  it('handles negative timestamps', () => {
    const delay = msUntilNextIslandTick(-ISLAND_TICK_MS - 1234);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(ISLAND_TICK_MS);
  });
});

describe('clamp01', () => {
  it('clamps and rejects non-finite input', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(7)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});
