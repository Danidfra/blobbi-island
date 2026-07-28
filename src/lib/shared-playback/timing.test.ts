import { describe, it, expect } from 'vitest';
import {
  compareRevisions,
  createEventDedupe,
  isNewerCanonical,
  isStaleRevision,
} from './ordering';
import {
  clampToDuration,
  driftAction,
  estimateClockOffset,
  expectedPosition,
  hasReachedEnd,
  pushClockSample,
} from './timing';
import type { PlaybackAnchor } from './timing';

const T = 1_785_175_200_000;

function anchor(overrides: Partial<PlaybackAnchor> = {}): PlaybackAnchor {
  return { state: 'playing', position: 100, updatedAt: T, rate: 1, ...overrides };
}

describe('expectedPosition', () => {
  it('holds still while paused, however long ago the anchor was taken', () => {
    const paused = anchor({ state: 'paused', position: 42.5 });
    expect(expectedPosition(paused, T)).toBe(42.5);
    expect(expectedPosition(paused, T + 60 * 60 * 1000)).toBe(42.5);
  });

  it('advances with wall-clock time while playing', () => {
    expect(expectedPosition(anchor(), T + 30_000)).toBe(130);
  });

  it('advances at the session rate', () => {
    expect(expectedPosition(anchor({ rate: 1.5 }), T + 30_000)).toBe(145);
    expect(expectedPosition(anchor({ rate: 0.5 }), T + 30_000)).toBe(115);
  });

  it('subtracts the estimated clock offset', () => {
    // This guest's clock runs 5 s fast; without the correction it would seek 5 s
    // ahead of everyone else, on every single check.
    expect(expectedPosition(anchor(), T + 35_000, 5_000)).toBe(130);
  });

  it('clamps to the duration once metadata knows one', () => {
    expect(expectedPosition(anchor(), T + 600_000, 0, 300)).toBe(300);
  });

  it('treats an unknown duration as unbounded rather than clamping to zero', () => {
    expect(expectedPosition(anchor(), T + 30_000, 0, 0)).toBe(130);
  });

  it('never runs backwards when the anchor is in the future', () => {
    // A host clock ahead of ours, or a badly ordered delivery: the answer is the
    // anchor position, never a negative seek target.
    expect(expectedPosition(anchor(), T - 60_000)).toBe(100);
  });

  it('refuses to extrapolate more than a day from a resurrected event', () => {
    const tenDays = T + 10 * 24 * 60 * 60 * 1000;
    expect(expectedPosition(anchor({ position: 0 }), tenDays)).toBe(86400);
  });

  it('recognizes a playing state that has run past the end', () => {
    expect(hasReachedEnd(299.9, 300)).toBe(true);
    expect(hasReachedEnd(120, 300)).toBe(false);
    expect(hasReachedEnd(120, 0)).toBe(false);
  });

  it('clamps positions into range', () => {
    expect(clampToDuration(-5, 300)).toBe(0);
    expect(clampToDuration(500, 300)).toBe(300);
    expect(clampToDuration(Number.NaN, 300)).toBe(0);
  });
});

describe('estimateClockOffset', () => {
  it('is zero until a sample exists', () => {
    expect(estimateClockOffset([])).toBe(0);
  });

  it('takes the median, so one bad relay hop cannot drag it', () => {
    expect(estimateClockOffset([100, 120, 110, 9_000, 105])).toBe(110);
  });

  it('keeps only the last eight samples', () => {
    let samples: number[] = [];
    for (let i = 0; i < 20; i += 1) samples = pushClockSample(samples, i);
    expect(samples).toHaveLength(8);
    expect(samples[0]).toBe(12);
    expect(samples[7]).toBe(19);
  });

  it('never trusts an offset beyond five minutes', () => {
    expect(estimateClockOffset([10 * 60 * 1000])).toBe(5 * 60 * 1000);
    expect(estimateClockOffset([-10 * 60 * 1000])).toBe(-5 * 60 * 1000);
  });
});

describe('driftAction', () => {
  it.each([
    [0, 'ignore'],
    [0.5, 'ignore'],
    [0.74, 'ignore'],
    [0.75, 'wait'],
    [1.0, 'wait'],
    [2.0, 'wait'],
    [2.01, 'seek'],
    [30, 'seek'],
  ])('drift %ss ⇒ %s', (drift, expected) => {
    expect(driftAction(drift)).toBe(expected);
  });

  it('treats being ahead and behind identically', () => {
    expect(driftAction(-3)).toBe('seek');
    expect(driftAction(-0.5)).toBe('ignore');
  });
});

describe('ordering', () => {
  const base = { rev: 5, createdAt: 1000, eventId: 'aaaa' };

  it('orders by revision first', () => {
    expect(compareRevisions(base, { ...base, rev: 6 })).toBe(-1);
    expect(compareRevisions({ ...base, rev: 6 }, base)).toBe(1);
  });

  it('falls back to created_at at equal revision', () => {
    expect(compareRevisions(base, { ...base, createdAt: 1001 })).toBe(-1);
  });

  it('falls back to the event id when even created_at ties', () => {
    expect(compareRevisions(base, { ...base, eventId: 'bbbb' })).toBe(-1);
    expect(compareRevisions(base, base)).toBe(0);
  });

  it('adopts a keepalive (same rev, later created_at) as the newer record', () => {
    expect(isNewerCanonical(base, { ...base, createdAt: 1020 })).toBe(true);
  });

  it('refuses an older canonical event', () => {
    expect(isNewerCanonical(base, { ...base, rev: 4, createdAt: 2000 })).toBe(false);
  });

  it('applies only strictly greater revisions to the player', () => {
    expect(isStaleRevision(5, 5)).toBe(true);
    expect(isStaleRevision(5, 4)).toBe(true);
    expect(isStaleRevision(5, 6)).toBe(false);
    // -1 is "nothing applied yet", so rev 0 is genuinely new.
    expect(isStaleRevision(-1, 0)).toBe(false);
  });

  it('remembers event ids it has already handled, within a bound', () => {
    const dedupe = createEventDedupe(3);
    expect(dedupe.check('a')).toBe(false);
    expect(dedupe.check('a')).toBe(true);
    dedupe.check('b');
    dedupe.check('c');
    dedupe.check('d'); // evicts 'a'
    expect(dedupe.size).toBe(3);
    expect(dedupe.check('a')).toBe(false);
    dedupe.reset();
    expect(dedupe.size).toBe(0);
  });
});
