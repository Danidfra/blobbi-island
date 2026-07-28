/**
 * Chart contract tests.
 *
 * Two jobs: prove the shipped chart is what it claims to be, and prove the
 * validator refuses every shape of broken chart. The second matters more — the
 * shipped chart is generated from committed data and is unlikely to rot, but the
 * validator is the only thing standing between a bad chart and a run that
 * starts, misbehaves, and produces a result anyway.
 */
import { describe, it, expect } from 'vitest';

import {
  DANCE_CHART_VERSION,
  DANCE_LANES,
  MIN_SAME_LANE_GAP_MS,
  NEON_HOP_CHART,
  buildChartFromBars,
  describeChartProblems,
  isDanceLane,
  validateDanceChart,
  type DanceChart,
} from './chart';
import { NEON_HOP_BARS, NEON_HOP_TRACK, getDanceTrack, msPerBeat } from './track';

const track = NEON_HOP_TRACK;

const codes = (chart: DanceChart) => {
  const validation = validateDanceChart(chart, getDanceTrack(chart.trackId));
  return validation.ok ? [] : validation.problems.map((p) => p.code);
};

describe('the shipped chart', () => {
  it('passes validation', () => {
    expect(validateDanceChart(NEON_HOP_CHART, track)).toEqual({ ok: true });
  });

  it('is built deterministically — same source, same notes, every time', () => {
    const a = buildChartFromBars({
      id: NEON_HOP_CHART.id,
      track,
      difficulty: 'normal',
      bars: ['L...D...', 'U...R...'],
    });
    const b = buildChartFromBars({
      id: NEON_HOP_CHART.id,
      track,
      difficulty: 'normal',
      bars: ['L...D...', 'U...R...'],
    });
    expect(a).toEqual(b);
    expect(a.notes.map((n) => n.timeMs)).toEqual([2000, 3000, 4000, 5000]);
    expect(a.notes.map((n) => n.lane)).toEqual(['left', 'down', 'up', 'right']);
  });

  it('names its track by id, never by a filename', () => {
    expect(NEON_HOP_CHART.trackId).toBe(track.id);
    expect(NEON_HOP_CHART.trackId).not.toMatch(/\.(mp3|wav|ogg|webm|m4a)$/);
  });

  it('declares the version this build understands', () => {
    expect(NEON_HOP_CHART.version).toBe(DANCE_CHART_VERSION);
  });

  it('has unique note ids', () => {
    const ids = NEON_HOP_CHART.notes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is sorted, in bounds, and uses only real lanes', () => {
    const lastPlayable = track.durationMs - track.tailMs;
    let previous = -1;
    for (const note of NEON_HOP_CHART.notes) {
      expect(isDanceLane(note.lane)).toBe(true);
      expect(note.timeMs).toBeGreaterThanOrEqual(track.leadInMs);
      expect(note.timeMs).toBeLessThanOrEqual(lastPlayable);
      expect(note.timeMs).toBeGreaterThanOrEqual(previous);
      previous = note.timeMs;
    }
  });

  it('never asks for two notes in one lane closer than a hand can move', () => {
    const lastByLane = new Map<string, number>();
    for (const note of NEON_HOP_CHART.notes) {
      const previous = lastByLane.get(note.lane);
      if (previous !== undefined) {
        expect(note.timeMs - previous).toBeGreaterThanOrEqual(MIN_SAME_LANE_GAP_MS);
      }
      lastByLane.set(note.lane, note.timeMs);
    }
  });

  it('is a short session, not an endurance test', () => {
    const seconds = track.durationMs / 1000;
    expect(seconds).toBeGreaterThanOrEqual(45);
    expect(seconds).toBeLessThanOrEqual(90);
  });

  it('uses every lane, so no control is decorative', () => {
    for (const lane of DANCE_LANES) {
      expect(NEON_HOP_CHART.notes.some((n) => n.lane === lane)).toBe(true);
    }
  });

  it('stays under four inputs a second at its densest', () => {
    // A gap smaller than an eighth note at this tempo would mean the chart is
    // asking for something the touch controls cannot deliver on a phone.
    const eighth = (msPerBeat(track.bpm) * track.beatsPerBar) / 8;
    for (let i = 1; i < NEON_HOP_CHART.notes.length; i += 1) {
      const gap = NEON_HOP_CHART.notes[i].timeMs - NEON_HOP_CHART.notes[i - 1].timeMs;
      expect(gap).toBeGreaterThanOrEqual(eighth - 1);
    }
  });

  it('covers all 32 authored bars', () => {
    const bodyMs = track.durationMs - track.leadInMs - track.tailMs;
    expect(bodyMs).toBe(NEON_HOP_BARS * track.beatsPerBar * msPerBeat(track.bpm));
    expect(NEON_HOP_CHART.notes.length).toBeGreaterThan(80);
  });
});

describe('validation refuses a chart that cannot be played fairly', () => {
  const base = (overrides: Partial<DanceChart> = {}): DanceChart => ({
    id: 'test-chart',
    version: DANCE_CHART_VERSION,
    trackId: track.id,
    difficulty: 'normal',
    offsetMs: 0,
    notes: [{ id: 'a', lane: 'left', timeMs: 3000 }],
    ...overrides,
  });

  it('refuses an unsupported version, and reports only that', () => {
    const problems = codes(base({ version: 99, notes: [] }));
    expect(problems).toEqual(['unsupported-version']);
  });

  it('refuses a chart whose track does not exist', () => {
    expect(codes(base({ trackId: 'no-such-track' }))).toEqual(['track-missing']);
  });

  it('refuses an empty chart', () => {
    expect(codes(base({ notes: [] }))).toEqual(['no-notes']);
  });

  it('refuses duplicate note ids', () => {
    expect(
      codes(
        base({
          notes: [
            { id: 'a', lane: 'left', timeMs: 3000 },
            { id: 'a', lane: 'up', timeMs: 4000 },
          ],
        }),
      ),
    ).toContain('duplicate-id');
  });

  it('refuses an unknown lane', () => {
    expect(
      codes(
        base({
          notes: [{ id: 'a', lane: 'diagonal' as never, timeMs: 3000 }],
        }),
      ),
    ).toContain('invalid-lane');
  });

  it('refuses a negative or non-finite time', () => {
    expect(codes(base({ notes: [{ id: 'a', lane: 'left', timeMs: -1 }] }))).toContain(
      'invalid-time',
    );
    expect(codes(base({ notes: [{ id: 'a', lane: 'left', timeMs: Number.NaN }] }))).toContain(
      'invalid-time',
    );
  });

  it('refuses notes out of chronological order', () => {
    expect(
      codes(
        base({
          notes: [
            { id: 'a', lane: 'left', timeMs: 5000 },
            { id: 'b', lane: 'up', timeMs: 4000 },
          ],
        }),
      ),
    ).toContain('unsorted');
  });

  it('refuses two notes in one lane at the same judgment instant', () => {
    expect(
      codes(
        base({
          notes: [
            { id: 'a', lane: 'left', timeMs: 4000 },
            { id: 'b', lane: 'left', timeMs: 4000 + MIN_SAME_LANE_GAP_MS - 1 },
          ],
        }),
      ),
    ).toContain('duplicate-note');
  });

  it('allows two DIFFERENT lanes at the same instant — that is a jump, not a bug', () => {
    expect(
      codes(
        base({
          notes: [
            { id: 'a', lane: 'left', timeMs: 4000 },
            { id: 'b', lane: 'right', timeMs: 4000 },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a note before the lead-in or inside the tail', () => {
    expect(codes(base({ notes: [{ id: 'a', lane: 'left', timeMs: 10 }] }))).toContain(
      'out-of-bounds',
    );
    expect(
      codes(base({ notes: [{ id: 'a', lane: 'left', timeMs: track.durationMs - 1 }] })),
    ).toContain('out-of-bounds');
  });

  it('reports every problem, not just the first', () => {
    const validation = validateDanceChart(
      base({
        notes: [
          { id: 'a', lane: 'left', timeMs: 5000 },
          { id: 'a', lane: 'nope' as never, timeMs: 4000 },
        ],
      }),
      track,
    );
    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    expect(validation.problems.length).toBeGreaterThan(1);
    expect(describeChartProblems(validation.problems)).toMatch(/and \d+ more/);
  });
});
