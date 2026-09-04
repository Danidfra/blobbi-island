/**
 * Blobbi Dance: judgement and scoring. Pure, deterministic, no clock.
 *
 * Every function here takes the song time as an ARGUMENT. Nothing reads
 * `Date.now()`, `performance.now()` or `AudioContext.currentTime`; the caller
 * owns the clock and this module owns the rules. That is what makes the whole
 * judgement surface testable by passing numbers, and it is why "was this note
 * hit?" has the same answer in a test as it does on a phone.
 *
 * ## The rules, in the order they matter
 *
 * 1. **One input resolves at most one note.** An input picks the single nearest
 *    eligible note in its own lane and consumes it.
 * 2. **One note is judged at most once.** A resolved note is never eligible
 *    again, so no amount of spamming can re-score it.
 * 3. **Eligibility is bounded by the widest window.** An input more than
 *    {@link DANCE_JUDGMENT_WINDOWS.okay} milliseconds from every unresolved note
 *    in its lane resolves nothing at all; it is not a miss, and it does not
 *    consume the next note. This is the rule that stops early spam from eating
 *    the chart: a player mashing left at 2 Hz destroys their combo through the
 *    notes they then fail to hit, not by pre-consuming notes they cannot see.
 * 4. **Overdue notes miss on their own.** A note whose time has passed by more
 *    than the widest window is marked missed by {@link advanceDanceRun}, without
 *    any input. A player who stops playing still gets a result.
 * 5. **Ties resolve to the earlier note.** Two eligible notes exactly equidistant
 *    can only happen when one is early and one is late; taking the earlier one
 *    keeps the chart moving forward and is deterministic.
 */

import type { DanceChart, DanceLane, DanceNote } from './chart';

// ── Windows ─────────────────────────────────────────────────────────────────

/**
 * Absolute timing windows in milliseconds.
 *
 * Starting values from the phase brief, kept unchanged: at 120 BPM an eighth
 * note is 250 ms, so the widest window (±180 ms) stays comfortably inside one
 * slot and a late hit can never drift into the next note's territory. Perfect at
 * ±60 ms is about four frames at 60 Hz, demanding but not frame-perfect.
 */
export const DANCE_JUDGMENT_WINDOWS = {
  perfect: 60,
  good: 120,
  okay: 180,
} as const;

/** Beyond this, an input is not talking about a note at all. */
export const DANCE_MAX_WINDOW_MS = DANCE_JUDGMENT_WINDOWS.okay;

export const DANCE_JUDGMENTS = ['perfect', 'good', 'okay', 'miss'] as const;
export type DanceJudgment = (typeof DANCE_JUDGMENTS)[number];

/** Classify a signed offset (input time − note time). Negative is early. */
export function judgeOffset(offsetMs: number): DanceJudgment {
  const magnitude = Math.abs(offsetMs);
  if (magnitude <= DANCE_JUDGMENT_WINDOWS.perfect) return 'perfect';
  if (magnitude <= DANCE_JUDGMENT_WINDOWS.good) return 'good';
  if (magnitude <= DANCE_JUDGMENT_WINDOWS.okay) return 'okay';
  return 'miss';
}

// ── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Points per judgement, before the combo bonus.
 *
 * These doubles as the ACCURACY weights: accuracy is `earned base ÷ maximum
 * base`, so one table defines both and they cannot drift apart.
 */
export const DANCE_JUDGMENT_POINTS: Readonly<Record<DanceJudgment, number>> = {
  perfect: 1000,
  good: 700,
  okay: 400,
  miss: 0,
};

/**
 * The combo bonus, kept deliberately dull.
 *
 * A hit at combo *n* earns `min(n, cap) × step` extra points on top of its base,
 * where *n* is the combo BEFORE this hit. So the bonus is bounded at 200 points
 * per note: a fifth of a Perfect, and a long streak is worth having without
 * letting one early run of luck decide the whole result. It is additive rather
 * than multiplicative for the same reason: a multiplier compounds, and a
 * compounding reward is one an early streak dominates.
 *
 * The bonus is deliberately EXCLUDED from accuracy (see
 * {@link summariseDanceRun}), so combo cannot inflate the number the reward
 * policy reads.
 */
export const DANCE_COMBO_BONUS = { step: 4, cap: 50 } as const;

export function comboBonusFor(comboBeforeHit: number): number {
  return Math.min(Math.max(0, comboBeforeHit), DANCE_COMBO_BONUS.cap) * DANCE_COMBO_BONUS.step;
}

// ── Grades ──────────────────────────────────────────────────────────────────

export const DANCE_GRADES = ['S', 'A', 'B', 'C', 'D'] as const;
export type DanceGrade = (typeof DANCE_GRADES)[number];

/** Accuracy thresholds, in percent. Purely a presentation of accuracy. */
export const DANCE_GRADE_THRESHOLDS: readonly { grade: DanceGrade; minAccuracy: number }[] = [
  { grade: 'S', minAccuracy: 95 },
  { grade: 'A', minAccuracy: 88 },
  { grade: 'B', minAccuracy: 75 },
  { grade: 'C', minAccuracy: 60 },
  { grade: 'D', minAccuracy: 0 },
];

/**
 * Grade from accuracy alone.
 *
 * Nothing downstream may treat the grade as a reward input, the reward policy
 * reads the explicit validated metrics instead. A grade is a letter for a player
 * to read, and turning a letter into money is how a presentation change becomes
 * an economy change.
 */
export function gradeForAccuracy(accuracy: number): DanceGrade {
  const safe = Number.isFinite(accuracy) ? accuracy : 0;
  return DANCE_GRADE_THRESHOLDS.find((t) => safe >= t.minAccuracy)?.grade ?? 'D';
}

// ── Run state ───────────────────────────────────────────────────────────────

export type DanceNoteStatus = 'pending' | 'hit' | 'missed';

export interface DanceNoteState {
  readonly note: DanceNote;
  readonly status: DanceNoteStatus;
  /** Null until resolved. `'miss'` for a note that timed out. */
  readonly judgment: DanceJudgment | null;
  /** Signed offset in ms (input − note). Null for a timed-out note. */
  readonly offsetMs: number | null;
}

/** What one input did. Emitted so the UI can flash the right feedback. */
export interface DanceJudgmentEvent {
  readonly noteId: string;
  readonly lane: DanceLane;
  readonly judgment: DanceJudgment;
  readonly offsetMs: number | null;
  readonly combo: number;
  /** Points this event added, combo bonus included. */
  readonly points: number;
}

export interface DanceRunState {
  readonly chart: DanceChart;
  readonly notes: readonly DanceNoteState[];
  /** Index of the earliest still-pending note; everything before it is resolved. */
  readonly cursor: number;
  readonly score: number;
  readonly combo: number;
  readonly maxCombo: number;
  readonly counts: Readonly<Record<DanceJudgment, number>>;
  /** Sum of absolute offsets over hit notes, for the average-offset stat. */
  readonly absoluteOffsetSumMs: number;
  /** Inputs that matched no eligible note. Reported, never penalised. */
  readonly ghostInputs: number;
}

export function createDanceRun(chart: DanceChart): DanceRunState {
  return {
    chart,
    notes: chart.notes.map((note) => ({ note, status: 'pending', judgment: null, offsetMs: null })),
    cursor: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    counts: { perfect: 0, good: 0, okay: 0, miss: 0 },
    absoluteOffsetSumMs: 0,
    ghostInputs: 0,
  };
}

/** Move the cursor past any leading resolved notes. */
function advanceCursor(notes: readonly DanceNoteState[], from: number): number {
  let cursor = from;
  while (cursor < notes.length && notes[cursor].status !== 'pending') cursor += 1;
  return cursor;
}

/**
 * Which pending note an input in `lane` at `atMs` would resolve, if any.
 *
 * Exported because "did the engine pick the right note?" is the single most
 * important question in a rhythm game and it deserves its own tests, separate
 * from what happens to the score afterwards.
 */
export function selectNoteForInput(
  state: DanceRunState,
  lane: DanceLane,
  atMs: number,
): DanceNoteState | null {
  let best: DanceNoteState | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = state.cursor; i < state.notes.length; i += 1) {
    const candidate = state.notes[i];
    const distance = atMs - candidate.note.timeMs;
    // Notes are sorted, so once a note is further in the FUTURE than the widest
    // window, so is everything after it.
    if (distance < -DANCE_MAX_WINDOW_MS) break;
    if (candidate.status !== 'pending') continue;
    if (candidate.note.lane !== lane) continue;
    const magnitude = Math.abs(distance);
    if (magnitude > DANCE_MAX_WINDOW_MS) continue;
    // Strictly less-than keeps the EARLIER note on an exact tie, because the
    // loop walks forward in time.
    if (magnitude < bestDistance) {
      best = candidate;
      bestDistance = magnitude;
    }
  }

  return best;
}

export interface DanceInputOutcome {
  readonly state: DanceRunState;
  /** Null when the input matched nothing, a ghost input. */
  readonly event: DanceJudgmentEvent | null;
}

/**
 * Apply one lane press at song time `atMs`.
 *
 * Returns the SAME state object when nothing changed except the ghost counter…
 * no: a ghost input does change the counter, so the object is new. What does not
 * change is any note, any score, and the combo, a ghost input is free.
 */
export function applyDanceInput(
  state: DanceRunState,
  lane: DanceLane,
  atMs: number,
): DanceInputOutcome {
  const target = selectNoteForInput(state, lane, atMs);
  if (!target) {
    return { state: { ...state, ghostInputs: state.ghostInputs + 1 }, event: null };
  }

  const offsetMs = atMs - target.note.timeMs;
  const judgment = judgeOffset(offsetMs);
  // `selectNoteForInput` already bounded the offset by the widest window, so a
  // selected note can never be judged a miss. Kept as a type-level truth rather
  // than an assumption: if the windows ever diverge, this stays correct.
  const isHit = judgment !== 'miss';

  const points = isHit ? DANCE_JUDGMENT_POINTS[judgment] + comboBonusFor(state.combo) : 0;
  const combo = isHit ? state.combo + 1 : 0;

  const notes = state.notes.map((entry) =>
    entry.note.id === target.note.id
      ? { ...entry, status: (isHit ? 'hit' : 'missed') as DanceNoteStatus, judgment, offsetMs }
      : entry,
  );

  const next: DanceRunState = {
    ...state,
    notes,
    cursor: advanceCursor(notes, state.cursor),
    score: state.score + points,
    combo,
    maxCombo: Math.max(state.maxCombo, combo),
    counts: { ...state.counts, [judgment]: state.counts[judgment] + 1 },
    absoluteOffsetSumMs: state.absoluteOffsetSumMs + (isHit ? Math.abs(offsetMs) : 0),
  };

  return {
    state: next,
    event: { noteId: target.note.id, lane, judgment, offsetMs, combo, points },
  };
}

export interface DanceTimeOutcome {
  readonly state: DanceRunState;
  /** Notes that just timed out, in chart order. Empty most frames. */
  readonly missed: readonly DanceJudgmentEvent[];
}

/**
 * Advance the run to song time `atMs`, marking overdue notes as missed.
 *
 * Called once per animation frame. It returns the same state object when nothing
 * expired, which is the common case, so a frame in which nothing happens costs
 * one comparison and produces no re-render.
 */
export function advanceDanceRun(state: DanceRunState, atMs: number): DanceTimeOutcome {
  const deadline = atMs - DANCE_MAX_WINDOW_MS;

  let expired: number[] | null = null;
  for (let i = state.cursor; i < state.notes.length; i += 1) {
    const entry = state.notes[i];
    // Strictly PAST the window. A note exactly `okay` milliseconds old is still
    // hittable, `judgeOffset` would call it Okay, so expiring it here would
    // steal a note the player could legitimately still answer.
    if (entry.note.timeMs >= deadline) break;
    if (entry.status !== 'pending') continue;
    (expired ??= []).push(i);
  }

  if (!expired) return { state, missed: [] };

  const expiredSet = new Set(expired);
  const notes = state.notes.map((entry, i) =>
    expiredSet.has(i)
      ? { ...entry, status: 'missed' as DanceNoteStatus, judgment: 'miss' as DanceJudgment, offsetMs: null }
      : entry,
  );

  const next: DanceRunState = {
    ...state,
    notes,
    cursor: advanceCursor(notes, state.cursor),
    combo: 0,
    counts: { ...state.counts, miss: state.counts.miss + expired.length },
  };

  return {
    state: next,
    missed: expired.map((i) => ({
      noteId: state.notes[i].note.id,
      lane: state.notes[i].note.lane,
      judgment: 'miss' as const,
      offsetMs: null,
      combo: 0,
      points: 0,
    })),
  };
}

// ── Summary ─────────────────────────────────────────────────────────────────

export interface DanceRunSummary {
  readonly score: number;
  /** Every note Perfect, combo bonus EXCLUDED. The accuracy denominator. */
  readonly maxBaseScore: number;
  /** Base points earned, combo bonus excluded. */
  readonly baseScore: number;
  /** 0–100, one decimal place. */
  readonly accuracy: number;
  readonly grade: DanceGrade;
  readonly perfect: number;
  readonly good: number;
  readonly okay: number;
  readonly miss: number;
  readonly maxCombo: number;
  readonly totalNotes: number;
  readonly resolvedNotes: number;
  /** True when every note was hit and none was missed. */
  readonly fullCombo: boolean;
  /** Mean absolute timing error over hit notes, in ms. 0 when nothing was hit. */
  readonly averageAbsoluteOffsetMs: number;
  readonly ghostInputs: number;
}

/**
 * Reduce a run to the numbers a result, and therefore the reward policy, is
 * built from.
 *
 * Accuracy uses BASE points only. Including the combo bonus would mean a player
 * who hit the same notes with the same timing scored a different accuracy
 * depending on the ORDER of their misses, which is indefensible when accuracy is
 * what the reward tiers read.
 */
export function summariseDanceRun(state: DanceRunState): DanceRunSummary {
  const totalNotes = state.notes.length;
  const maxBaseScore = totalNotes * DANCE_JUDGMENT_POINTS.perfect;
  const baseScore =
    state.counts.perfect * DANCE_JUDGMENT_POINTS.perfect +
    state.counts.good * DANCE_JUDGMENT_POINTS.good +
    state.counts.okay * DANCE_JUDGMENT_POINTS.okay;

  const accuracy = maxBaseScore === 0 ? 0 : Math.round((baseScore / maxBaseScore) * 1000) / 10;
  const hits = state.counts.perfect + state.counts.good + state.counts.okay;
  const resolvedNotes = hits + state.counts.miss;

  return {
    score: state.score,
    maxBaseScore,
    baseScore,
    accuracy,
    grade: gradeForAccuracy(accuracy),
    perfect: state.counts.perfect,
    good: state.counts.good,
    okay: state.counts.okay,
    miss: state.counts.miss,
    maxCombo: state.maxCombo,
    totalNotes,
    resolvedNotes,
    fullCombo: totalNotes > 0 && state.counts.miss === 0 && hits === totalNotes,
    averageAbsoluteOffsetMs: hits === 0 ? 0 : Math.round((state.absoluteOffsetSumMs / hits) * 10) / 10,
    ghostInputs: state.ghostInputs,
  };
}
