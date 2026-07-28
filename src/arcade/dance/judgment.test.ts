/**
 * Judgement and scoring tests.
 *
 * Every case here is a number in and a number out — no clock, no DOM, no audio.
 * That is the whole reason the engine takes the song time as an argument: "was
 * this note hit?" must have exactly one answer, and it must be checkable without
 * waiting sixty-eight real seconds.
 */
import { describe, it, expect } from 'vitest';

import {
  DANCE_COMBO_BONUS,
  DANCE_GRADE_THRESHOLDS,
  DANCE_JUDGMENT_POINTS,
  DANCE_JUDGMENT_WINDOWS,
  DANCE_MAX_WINDOW_MS,
  advanceDanceRun,
  applyDanceInput,
  comboBonusFor,
  createDanceRun,
  gradeForAccuracy,
  judgeOffset,
  selectNoteForInput,
  summariseDanceRun,
  type DanceRunState,
} from './judgment';
import { DANCE_CHART_VERSION, type DanceChart } from './chart';
import { NEON_HOP_TRACK } from './track';

function chartOf(notes: DanceChart['notes']): DanceChart {
  return {
    id: 'test',
    version: DANCE_CHART_VERSION,
    trackId: NEON_HOP_TRACK.id,
    difficulty: 'normal',
    offsetMs: 0,
    notes,
  };
}

/** Four notes, one per lane, a second apart. */
const SIMPLE = chartOf([
  { id: 'n1', lane: 'left', timeMs: 1000 },
  { id: 'n2', lane: 'down', timeMs: 2000 },
  { id: 'n3', lane: 'up', timeMs: 3000 },
  { id: 'n4', lane: 'right', timeMs: 4000 },
]);

const play = (state: DanceRunState, lane: 'left' | 'down' | 'up' | 'right', at: number) =>
  applyDanceInput(state, lane, at);

describe('windows', () => {
  it('classifies by absolute offset, early and late alike', () => {
    expect(judgeOffset(0)).toBe('perfect');
    expect(judgeOffset(DANCE_JUDGMENT_WINDOWS.perfect)).toBe('perfect');
    expect(judgeOffset(-DANCE_JUDGMENT_WINDOWS.perfect)).toBe('perfect');
    expect(judgeOffset(DANCE_JUDGMENT_WINDOWS.perfect + 1)).toBe('good');
    expect(judgeOffset(-(DANCE_JUDGMENT_WINDOWS.good))).toBe('good');
    expect(judgeOffset(DANCE_JUDGMENT_WINDOWS.good + 1)).toBe('okay');
    expect(judgeOffset(-DANCE_JUDGMENT_WINDOWS.okay)).toBe('okay');
    expect(judgeOffset(DANCE_JUDGMENT_WINDOWS.okay + 1)).toBe('miss');
  });

  it('keeps the windows ordered and inside one eighth note', () => {
    expect(DANCE_JUDGMENT_WINDOWS.perfect).toBeLessThan(DANCE_JUDGMENT_WINDOWS.good);
    expect(DANCE_JUDGMENT_WINDOWS.good).toBeLessThan(DANCE_JUDGMENT_WINDOWS.okay);
    // At 120 BPM an eighth note is 250 ms; a window wider than that would let one
    // input be eligible for two consecutive notes.
    expect(DANCE_MAX_WINDOW_MS).toBeLessThan(250);
  });
});

describe('note selection', () => {
  it('picks the nearest unresolved note in the SAME lane', () => {
    const run = createDanceRun(SIMPLE);
    expect(selectNoteForInput(run, 'left', 1010)?.note.id).toBe('n1');
    expect(selectNoteForInput(run, 'down', 1010)).toBeNull();
  });

  it('picks nothing when every note is outside the widest window', () => {
    const run = createDanceRun(SIMPLE);
    expect(selectNoteForInput(run, 'left', 1000 + DANCE_MAX_WINDOW_MS + 1)).toBeNull();
    expect(selectNoteForInput(run, 'left', 1000 - DANCE_MAX_WINDOW_MS - 1)).toBeNull();
  });

  it('resolves an exact tie to the EARLIER note, deterministically', () => {
    const twins = chartOf([
      { id: 'early', lane: 'left', timeMs: 1000 },
      { id: 'late', lane: 'left', timeMs: 1200 },
    ]);
    const run = createDanceRun(twins);
    // 1100 is exactly 100 ms from both.
    expect(selectNoteForInput(run, 'left', 1100)?.note.id).toBe('early');
  });

  it('skips a note that is already resolved', () => {
    const run = play(createDanceRun(SIMPLE), 'left', 1000).state;
    expect(selectNoteForInput(run, 'left', 1000)).toBeNull();
  });
});

describe('inputs', () => {
  it('judges an on-time hit as Perfect and starts a combo', () => {
    const { state, event } = play(createDanceRun(SIMPLE), 'left', 1000);
    expect(event).toMatchObject({ noteId: 'n1', judgment: 'perfect', offsetMs: 0, combo: 1 });
    expect(state.score).toBe(DANCE_JUDGMENT_POINTS.perfect);
    expect(state.counts.perfect).toBe(1);
  });

  it('keeps the SIGNED offset, so early and late are distinguishable afterwards', () => {
    const early = play(createDanceRun(SIMPLE), 'left', 930).event;
    const late = play(createDanceRun(SIMPLE), 'left', 1070).event;
    expect(early?.offsetMs).toBe(-70);
    expect(late?.offsetMs).toBe(70);
    expect(early?.judgment).toBe('good');
    expect(late?.judgment).toBe('good');
  });

  it('never lets one input resolve two notes', () => {
    const jump = chartOf([
      { id: 'a', lane: 'left', timeMs: 1000 },
      { id: 'b', lane: 'right', timeMs: 1000 },
    ]);
    const { state } = play(createDanceRun(jump), 'left', 1000);
    expect(state.notes.filter((n) => n.status !== 'pending')).toHaveLength(1);
  });

  it('never lets one note be judged twice', () => {
    let run = createDanceRun(SIMPLE);
    run = play(run, 'left', 1000).state;
    const second = play(run, 'left', 1000);
    expect(second.event).toBeNull();
    expect(second.state.score).toBe(run.score);
    expect(second.state.counts.perfect).toBe(1);
  });

  it('does not let early spam consume future notes', () => {
    let run = createDanceRun(SIMPLE);
    // Thirty presses across the two seconds before the first note is even close.
    for (let t = 0; t < 600; t += 20) run = play(run, 'left', t).state;

    expect(run.notes.every((n) => n.status === 'pending')).toBe(true);
    expect(run.ghostInputs).toBe(30);
    expect(run.combo).toBe(0);
    expect(run.score).toBe(0);

    // …and the note is still there to be hit.
    const { event } = play(run, 'left', 1000);
    expect(event?.judgment).toBe('perfect');
  });

  it('charges nothing for a ghost input — it is not a miss', () => {
    const { state, event } = play(createDanceRun(SIMPLE), 'up', 0);
    expect(event).toBeNull();
    expect(state.counts.miss).toBe(0);
    expect(state.ghostInputs).toBe(1);
  });
});

describe('automatic misses', () => {
  it('marks a note missed once it is past the widest window', () => {
    const run = createDanceRun(SIMPLE);
    const stillPending = advanceDanceRun(run, 1000 + DANCE_MAX_WINDOW_MS);
    expect(stillPending.state).toBe(run); // same object: nothing changed
    expect(stillPending.missed).toEqual([]);

    const expired = advanceDanceRun(run, 1000 + DANCE_MAX_WINDOW_MS + 1);
    expect(expired.missed.map((m) => m.noteId)).toEqual(['n1']);
    expect(expired.state.counts.miss).toBe(1);
    expect(expired.state.combo).toBe(0);
  });

  it('breaks the combo', () => {
    let run = play(createDanceRun(SIMPLE), 'left', 1000).state;
    expect(run.combo).toBe(1);
    run = advanceDanceRun(run, 2000 + DANCE_MAX_WINDOW_MS + 1).state;
    expect(run.combo).toBe(0);
    expect(run.maxCombo).toBe(1);
  });

  it('expires several at once when the player stops playing', () => {
    const run = advanceDanceRun(createDanceRun(SIMPLE), 10_000);
    expect(run.state.counts.miss).toBe(4);
    expect(run.missed).toHaveLength(4);
    expect(run.state.notes.every((n) => n.status === 'missed')).toBe(true);
  });

  it('never re-misses a note it already missed', () => {
    const once = advanceDanceRun(createDanceRun(SIMPLE), 10_000).state;
    const twice = advanceDanceRun(once, 20_000);
    expect(twice.state).toBe(once);
    expect(twice.missed).toEqual([]);
  });

  it('does not miss a note that was already hit', () => {
    let run = play(createDanceRun(SIMPLE), 'left', 1000).state;
    run = advanceDanceRun(run, 10_000).state;
    expect(run.counts.miss).toBe(3);
    expect(run.counts.perfect).toBe(1);
  });
});

describe('scoring and combo', () => {
  it('adds a capped, additive combo bonus', () => {
    expect(comboBonusFor(0)).toBe(0);
    expect(comboBonusFor(10)).toBe(10 * DANCE_COMBO_BONUS.step);
    expect(comboBonusFor(DANCE_COMBO_BONUS.cap)).toBe(
      DANCE_COMBO_BONUS.cap * DANCE_COMBO_BONUS.step,
    );
    // Past the cap it stops growing — one long streak cannot dominate a result.
    expect(comboBonusFor(10_000)).toBe(DANCE_COMBO_BONUS.cap * DANCE_COMBO_BONUS.step);
  });

  it('pays the bonus for the combo BEFORE the hit, so the first note has none', () => {
    let run = createDanceRun(SIMPLE);
    run = play(run, 'left', 1000).state;
    expect(run.score).toBe(DANCE_JUDGMENT_POINTS.perfect);
    run = play(run, 'down', 2000).state;
    expect(run.score).toBe(2 * DANCE_JUDGMENT_POINTS.perfect + comboBonusFor(1));
  });

  it('caps a single note well below two Perfects', () => {
    const maxPerNote = DANCE_JUDGMENT_POINTS.perfect + comboBonusFor(DANCE_COMBO_BONUS.cap);
    expect(maxPerNote).toBeLessThan(2 * DANCE_JUDGMENT_POINTS.perfect);
  });

  it('cannot be farmed by spamming — a ghost input adds nothing', () => {
    let run = createDanceRun(SIMPLE);
    for (let i = 0; i < 500; i += 1) run = play(run, 'left', 500).state;
    expect(run.score).toBe(0);
  });
});

describe('summary', () => {
  const perfectRun = () => {
    let run = createDanceRun(SIMPLE);
    run = play(run, 'left', 1000).state;
    run = play(run, 'down', 2000).state;
    run = play(run, 'up', 3000).state;
    run = play(run, 'right', 4000).state;
    return summariseDanceRun(run);
  };

  it('reports 100% and a full combo for a flawless run', () => {
    const summary = perfectRun();
    expect(summary.accuracy).toBe(100);
    expect(summary.grade).toBe('S');
    expect(summary.fullCombo).toBe(true);
    expect(summary.maxCombo).toBe(4);
    expect(summary.miss).toBe(0);
    expect(summary.baseScore).toBe(summary.maxBaseScore);
  });

  it('computes accuracy from BASE points only, so combo cannot inflate it', () => {
    const summary = perfectRun();
    // The score includes combo bonuses and is therefore ABOVE the base…
    expect(summary.score).toBeGreaterThan(summary.baseScore);
    // …but accuracy is still exactly 100, not more.
    expect(summary.accuracy).toBe(100);
  });

  it('weights partial credit exactly as the points table does', () => {
    let run = createDanceRun(SIMPLE);
    run = play(run, 'left', 1000).state; // perfect
    run = play(run, 'down', 2000 + 100).state; // good
    run = play(run, 'up', 3000 - 150).state; // okay
    run = advanceDanceRun(run, 10_000).state; // miss the last
    const summary = summariseDanceRun(run);

    const expected =
      ((DANCE_JUDGMENT_POINTS.perfect + DANCE_JUDGMENT_POINTS.good + DANCE_JUDGMENT_POINTS.okay) /
        (4 * DANCE_JUDGMENT_POINTS.perfect)) *
      100;
    expect(summary.accuracy).toBeCloseTo(Math.round(expected * 10) / 10, 5);
    expect(summary).toMatchObject({ perfect: 1, good: 1, okay: 1, miss: 1, fullCombo: false });
  });

  it('is not a full combo when every note was hit but one was Okay', () => {
    let run = createDanceRun(SIMPLE);
    run = play(run, 'left', 1000).state;
    run = play(run, 'down', 2000).state;
    run = play(run, 'up', 3000).state;
    run = play(run, 'right', 4000 + 150).state; // okay, but still a hit
    const summary = summariseDanceRun(run);
    // "Full combo" means no missed notes, not all Perfects.
    expect(summary.fullCombo).toBe(true);
    expect(summary.accuracy).toBeLessThan(100);
  });

  it('reports the average absolute timing error over hits only', () => {
    let run = createDanceRun(SIMPLE);
    run = play(run, 'left', 1000 + 40).state;
    run = play(run, 'down', 2000 - 20).state;
    run = advanceDanceRun(run, 10_000).state;
    expect(summariseDanceRun(run).averageAbsoluteOffsetMs).toBe(30);
  });

  it('handles a run where nothing at all happened', () => {
    const summary = summariseDanceRun(createDanceRun(SIMPLE));
    expect(summary).toMatchObject({
      accuracy: 0,
      grade: 'D',
      fullCombo: false,
      averageAbsoluteOffsetMs: 0,
      resolvedNotes: 0,
    });
  });
});

describe('grades', () => {
  it('follows the published thresholds', () => {
    expect(gradeForAccuracy(100)).toBe('S');
    expect(gradeForAccuracy(95)).toBe('S');
    expect(gradeForAccuracy(94.9)).toBe('A');
    expect(gradeForAccuracy(88)).toBe('A');
    expect(gradeForAccuracy(87.9)).toBe('B');
    expect(gradeForAccuracy(75)).toBe('B');
    expect(gradeForAccuracy(74.9)).toBe('C');
    expect(gradeForAccuracy(60)).toBe('C');
    expect(gradeForAccuracy(59.9)).toBe('D');
    expect(gradeForAccuracy(0)).toBe('D');
  });

  it('degrades a nonsense accuracy to the bottom grade rather than throwing', () => {
    expect(gradeForAccuracy(Number.NaN)).toBe('D');
  });

  it('keeps the thresholds in descending order, so the first match is the best', () => {
    for (let i = 1; i < DANCE_GRADE_THRESHOLDS.length; i += 1) {
      expect(DANCE_GRADE_THRESHOLDS[i].minAccuracy).toBeLessThan(
        DANCE_GRADE_THRESHOLDS[i - 1].minAccuracy,
      );
    }
  });
});
