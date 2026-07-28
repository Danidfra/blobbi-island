/**
 * Blobbi Dance — the note chart contract, and the one authored chart.
 *
 * ## Deterministic, committed, and validated before anything plays
 *
 * A chart is never generated at run time from a clock or a random source. This
 * one is *derived* from committed source data — sixteen bar patterns written as
 * plain strings — so the data a human edits is legible and the data the engine
 * judges against is exact. Same input, same notes, every run, on every device.
 *
 * `validateDanceChart` runs BEFORE the countdown, not during the run. A chart
 * that fails must surface as an honest error in the preview; a broken run that
 * starts and then misbehaves is strictly worse than one that never starts, and
 * this is the only place that distinction can be enforced.
 *
 * ## The pattern grammar
 *
 * One string per bar, one character per sixteenth… no: per EIGHTH note, so a
 * 4/4 bar is eight slots. Legible at a glance and dense enough for a first
 * chart:
 *
 * ```
 *   L  left      D  down      U  up      R  right      .  rest
 * ```
 *
 * Two lanes may share a slot (a "jump") by writing them as one bar in the
 * `simultaneous` table; the base grammar is one note per slot, because a
 * two-character-per-slot grammar makes every bar unreadable to buy a feature the
 * first chart does not need.
 *
 * ## Why `timeMs` and not "beat 3 of bar 4"
 *
 * Beats are how a chart is WRITTEN; milliseconds are how it is JUDGED. Keeping
 * the judged form in absolute milliseconds means the judgement code never has to
 * know the tempo, and a future variable-tempo track changes the generator rather
 * than the engine.
 */

import type { DanceTrack, DanceTrackId } from './track';
import { NEON_HOP_TRACK, msPerBeat } from './track';

/** The four lanes, in left-to-right screen order. */
export const DANCE_LANES = ['left', 'down', 'up', 'right'] as const;
export type DanceLane = (typeof DANCE_LANES)[number];

export function isDanceLane(value: unknown): value is DanceLane {
  return typeof value === 'string' && (DANCE_LANES as readonly string[]).includes(value);
}

/** The chart schema revision this build understands. */
export const DANCE_CHART_VERSION = 1;

/** Difficulty labels a chart may declare. One is authored today. */
export type DanceDifficulty = 'easy' | 'normal' | 'hard';

export interface DanceNote {
  /**
   * Stable identity, unique within the chart.
   *
   * Notes are identified rather than indexed because the judgement engine
   * resolves them out of order (an input judges the nearest eligible note, which
   * is not always the next one) and because a rendered note element is keyed by
   * it. An index would be neither stable across a chart edit nor unique across
   * lanes.
   */
  readonly id: string;
  readonly lane: DanceLane;
  /** Milliseconds from the track's zero — lead-in included. */
  readonly timeMs: number;
}

export interface DanceChart {
  readonly id: string;
  /** Chart schema revision. Refused if it is not {@link DANCE_CHART_VERSION}. */
  readonly version: number;
  /** The track this chart is written against, by id — never by filename. */
  readonly trackId: DanceTrackId;
  readonly difficulty: DanceDifficulty;
  /**
   * Chart-wide timing shift in milliseconds, applied when the chart is built.
   *
   * Distinct from the per-DEVICE latency offset in `arcade-audio.ts`: this one is
   * a property of the authored chart (the whole chart sits a hair early against
   * this track), the other is a property of the player's headphones. Conflating
   * them would mean a player's calibration silently re-authored the chart.
   */
  readonly offsetMs: number;
  /** Every note, sorted ascending by `timeMs`. */
  readonly notes: readonly DanceNote[];
}

// ── Authored source data ────────────────────────────────────────────────────

/**
 * Thirty-two bars, eight eighth-note slots each, at 120 BPM — 2 seconds per bar.
 *
 * Structured A / A′ / B / A″ so it reads as music rather than as a difficulty
 * ramp: eight bars introducing one lane per beat, eight adding offbeats, eight
 * of the busiest patterns in the chart, and eight that land it. Nothing is faster
 * than an eighth note, so the hardest moment asks for four inputs per second —
 * playable on a phone with two thumbs.
 *
 * 110 notes across 64 seconds of music.
 */
const NEON_HOP_BARS_SOURCE: readonly string[] = [
  // ── A (1–8): one note per beat, then the first offbeats ──
  'L...D...',
  'U...R...',
  'R...U...',
  'D...L...',
  'L.D.U.R.',
  'R.U.D.L.',
  'L.LD..U.',
  'R.RU..D.',
  // ── A′ (9–16): alternating hands, with a downbeat breather at each end ──
  'D...U...',
  'L.R.L.R.',
  'U.D.U.D.',
  'R...L...',
  'L.D.U.R.',
  'D.U.R.L.',
  'U.R.D.L.',
  'R...R...',
  // ── B (17–24): the busiest section ──
  'LDUR....',
  'RULD....',
  'LDUR.RUL',
  'RULD.DUR',
  'U...D...',
  'L.R.U.D.',
  'R.L.D.U.',
  'U...U...',
  // ── A″ (25–32): the landing ──
  'L.D.U.R.',
  'R.U.D.L.',
  'L...R...',
  'D...U...',
  'L.D.U.R.',
  'R.U.D.L.',
  'D.U.R.L.',
  'R...L...',
];

/** How many slots one bar of the source grammar carries. */
const SLOTS_PER_BAR = 8;

const LANE_BY_SYMBOL: Readonly<Record<string, DanceLane>> = {
  L: 'left',
  D: 'down',
  U: 'up',
  R: 'right',
};

/**
 * Build a chart from bar patterns, deterministically.
 *
 * Exported so a test can build a deliberately broken chart from deliberately
 * broken source, rather than hand-writing a note array that no longer resembles
 * how real charts are produced.
 */
export function buildChartFromBars(options: {
  id: string;
  track: DanceTrack;
  difficulty: DanceDifficulty;
  bars: readonly string[];
  offsetMs?: number;
}): DanceChart {
  const { id, track, difficulty, bars, offsetMs = 0 } = options;
  const slotMs = (msPerBeat(track.bpm) * track.beatsPerBar) / SLOTS_PER_BAR;

  const notes: DanceNote[] = [];
  bars.forEach((bar, barIndex) => {
    [...bar].forEach((symbol, slotIndex) => {
      const lane = LANE_BY_SYMBOL[symbol];
      if (!lane) return; // '.' and anything unrecognised is a rest.
      notes.push({
        // Bar and slot make the id readable in a failing test's output, which is
        // worth more than a shorter string.
        id: `${id}:${barIndex + 1}:${slotIndex}:${lane}`,
        lane,
        timeMs: Math.round(track.leadInMs + (barIndex * SLOTS_PER_BAR + slotIndex) * slotMs),
      });
    });
  });

  notes.sort((a, b) => a.timeMs - b.timeMs || a.lane.localeCompare(b.lane));

  return { id, version: DANCE_CHART_VERSION, trackId: track.id, difficulty, offsetMs, notes };
}

/** The one shipped chart. */
export const NEON_HOP_CHART: DanceChart = buildChartFromBars({
  id: 'blobbi-dance-neon-hop-v1:normal',
  track: NEON_HOP_TRACK,
  difficulty: 'normal',
  bars: NEON_HOP_BARS_SOURCE,
  offsetMs: 0,
});

/** The chart a run uses when nothing else is specified. */
export const DEFAULT_DANCE_CHART = NEON_HOP_CHART;

// ── Validation ──────────────────────────────────────────────────────────────

export interface DanceChartProblem {
  readonly code:
    | 'unsupported-version'
    | 'track-missing'
    | 'no-notes'
    | 'duplicate-id'
    | 'invalid-lane'
    | 'invalid-time'
    | 'unsorted'
    | 'duplicate-note'
    | 'out-of-bounds';
  readonly message: string;
  /** Which note the problem is about, when it is about one. */
  readonly noteId?: string;
}

export type DanceChartValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly problems: readonly DanceChartProblem[] };

/**
 * The smallest gap at which two notes in the SAME lane are distinguishable.
 *
 * Two notes in one lane closer together than the Perfect window cannot both be
 * hit — one input would be inside both windows and the engine resolves exactly
 * one note per input, so the second is an unavoidable miss. That is not a
 * difficulty spike, it is an unwinnable chart, so it is a validation error.
 */
export const MIN_SAME_LANE_GAP_MS = 60;

/**
 * Check a chart before it is ever played.
 *
 * Returns every problem rather than the first, because a chart author fixing one
 * error at a time is a bad use of anyone's afternoon.
 */
export function validateDanceChart(chart: DanceChart, track: DanceTrack | undefined): DanceChartValidation {
  const problems: DanceChartProblem[] = [];
  const fail = (code: DanceChartProblem['code'], message: string, noteId?: string) =>
    problems.push({ code, message, noteId });

  if (chart.version !== DANCE_CHART_VERSION) {
    fail(
      'unsupported-version',
      `chart version ${chart.version} is not supported (this build reads version ${DANCE_CHART_VERSION})`,
    );
    // Every check below assumes the current schema, so stop here rather than
    // reporting a cascade of problems that are really one problem.
    return { ok: false, problems };
  }

  if (!track || track.id !== chart.trackId) {
    fail('track-missing', `no track is registered for id "${chart.trackId}"`);
    return { ok: false, problems };
  }

  if (chart.notes.length === 0) {
    fail('no-notes', 'a chart with no notes is not a game');
    return { ok: false, problems };
  }

  const seenIds = new Set<string>();
  const lastInLane = new Map<DanceLane, DanceNote>();
  let previousTime = Number.NEGATIVE_INFINITY;

  for (const note of chart.notes) {
    if (seenIds.has(note.id)) fail('duplicate-id', `note id "${note.id}" appears more than once`, note.id);
    seenIds.add(note.id);

    if (!isDanceLane(note.lane)) {
      fail('invalid-lane', `note "${note.id}" has lane "${String(note.lane)}"`, note.id);
    }

    if (!Number.isFinite(note.timeMs) || note.timeMs < 0) {
      fail('invalid-time', `note "${note.id}" has a non-finite or negative time`, note.id);
    } else {
      if (note.timeMs < previousTime) {
        fail('unsorted', `note "${note.id}" is out of chronological order`, note.id);
      }
      previousTime = note.timeMs;

      // The tail exists so the song does not stop on the last note; a note
      // scheduled inside it (or before the lead-in) is outside the music.
      const lastPlayableMs = track.durationMs - track.tailMs;
      if (note.timeMs < track.leadInMs || note.timeMs > lastPlayableMs) {
        fail(
          'out-of-bounds',
          `note "${note.id}" at ${note.timeMs}ms is outside the track's playable range ` +
            `(${track.leadInMs}–${lastPlayableMs}ms)`,
          note.id,
        );
      }
    }

    if (isDanceLane(note.lane)) {
      const previous = lastInLane.get(note.lane);
      if (previous && Math.abs(note.timeMs - previous.timeMs) < MIN_SAME_LANE_GAP_MS) {
        fail(
          'duplicate-note',
          `notes "${previous.id}" and "${note.id}" are ${Math.abs(note.timeMs - previous.timeMs)}ms ` +
            `apart in the same lane; anything under ${MIN_SAME_LANE_GAP_MS}ms cannot both be hit`,
          note.id,
        );
      }
      lastInLane.set(note.lane, note);
    }
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/** Human-readable one-liner for the error UI. */
export function describeChartProblems(problems: readonly DanceChartProblem[]): string {
  const first = problems[0];
  const rest = problems.length - 1;
  return rest > 0 ? `${first.message} (and ${rest} more)` : first.message;
}
