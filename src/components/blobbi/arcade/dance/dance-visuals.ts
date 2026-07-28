/**
 * Blobbi Dance — the presentation constants the stage and the results share.
 *
 * Kept out of the components so the numbers that decide how the game LOOKS are
 * in one legible place, and so a test can assert against the same values the
 * renderer uses rather than a copy of them.
 */

import type { DanceLane } from '@/arcade/dance/chart';
import type { DanceJudgment } from '@/arcade/dance/judgment';

/**
 * How long a note is visible before it reaches the receptors, in milliseconds.
 *
 * This is a READABILITY setting, not a timing one: it changes how far ahead the
 * player can see and nothing about when a note is due. 1.6 s at 120 BPM is a
 * little over three beats — long enough to read a pattern, short enough that the
 * field is not a wall of arrows on a phone.
 */
export const NOTE_APPROACH_MS = 1600;

/**
 * How long a resolved note stays on screen after its moment, in milliseconds.
 *
 * Zero would make notes vanish exactly at the judgement line, which reads as the
 * game eating inputs. A short overshoot makes a late hit visibly late.
 */
export const NOTE_LINGER_MS = 220;

/** How long a judgement readout stays up, in milliseconds. */
export const JUDGMENT_FLASH_MS = 420;

export interface DanceLaneVisual {
  readonly lane: DanceLane;
  /** The arrow itself. Carries the lane's meaning WITHOUT relying on colour. */
  readonly glyph: string;
  /** Spoken name for the touch control. */
  readonly label: string;
  /** Keyboard bindings, for the on-screen hint. */
  readonly keys: string;
  /** Tailwind colour classes. Decoration only — never the sole signal. */
  readonly accent: string;
  readonly receptor: string;
}

export const DANCE_LANE_VISUALS: readonly DanceLaneVisual[] = [
  {
    lane: 'left',
    glyph: '←',
    label: 'Left',
    keys: '← or A',
    accent: 'bg-rose-500/85 border-rose-700',
    receptor: 'border-rose-400',
  },
  {
    lane: 'down',
    glyph: '↓',
    label: 'Down',
    keys: '↓ or S',
    accent: 'bg-sky-500/85 border-sky-700',
    receptor: 'border-sky-400',
  },
  {
    lane: 'up',
    glyph: '↑',
    label: 'Up',
    keys: '↑ or W',
    accent: 'bg-emerald-500/85 border-emerald-700',
    receptor: 'border-emerald-400',
  },
  {
    lane: 'right',
    glyph: '→',
    label: 'Right',
    keys: '→ or D',
    accent: 'bg-amber-500/85 border-amber-700',
    receptor: 'border-amber-400',
  },
];

/** Readout text and colour per judgement. The WORD is the information. */
export const JUDGMENT_VISUALS: Readonly<
  Record<DanceJudgment, { readonly label: string; readonly className: string }>
> = {
  perfect: { label: 'Perfect!', className: 'text-emerald-600' },
  good: { label: 'Good', className: 'text-sky-600' },
  okay: { label: 'Okay', className: 'text-amber-600' },
  miss: { label: 'Miss', className: 'text-rose-600' },
};

/**
 * Where a note should be drawn, as a 0–1 fraction of the field height.
 *
 * `0` is the top of the field, `1` is the judgement line. Values outside 0–1 are
 * returned rather than clamped so the caller can decide whether a note is
 * off-screen; clamping here would hide the one case that matters.
 */
export function noteProgress(noteTimeMs: number, songTimeMs: number): number {
  return 1 - (noteTimeMs - songTimeMs) / NOTE_APPROACH_MS;
}

/** Is this note inside the drawn window at this song time? */
export function isNoteVisible(noteTimeMs: number, songTimeMs: number): boolean {
  const remaining = noteTimeMs - songTimeMs;
  return remaining <= NOTE_APPROACH_MS && remaining >= -NOTE_LINGER_MS;
}
