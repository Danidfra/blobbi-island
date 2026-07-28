/**
 * Blobbi Dance — the presentation constants the stage and the results share.
 *
 * Kept out of the components so the numbers that decide how the game LOOKS are
 * in one legible place, and so a test can assert against the same values the
 * renderer uses rather than a copy of them.
 *
 * It also keeps the LIVE renderer and the DEV gallery honest. The frame loop
 * paints a judgement by writing `className` straight onto a DOM node, which no
 * React tree can be inspected for; the harness renders the same states as plain
 * elements. Both call the helpers below, so what a reviewer looks at in
 * `/dev/arcade` is what a player sees mid-song.
 */

import type { DanceLane } from '@/arcade/dance/chart';
import type { DanceJudgment } from '@/arcade/dance/judgment';
import { cn } from '@/lib/utils';

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
  /**
   * The single letter shown under the arrow on the touch control and in the
   * start screen's control diagram.
   *
   * A SECOND non-colour cue, and the one that survives at 320 px where two
   * arrows a centimetre apart start to look alike. Colour is decoration in this
   * game; the arrow and this letter are the information.
   */
  readonly keyCap: string;
  /** The falling token's face. Decoration only — never the sole signal. */
  readonly token: string;
  /** The receptor's resting ring. */
  readonly receptor: string;
  /** The receptor's ring while its lane is held. */
  readonly receptorActive: string;
  /** The lane column's rail tint, behind the notes. */
  readonly rail: string;
  /** The lane's flash colour, as a raw CSS colour for the pulse keyframes. */
  readonly glow: string;
  /** The touch control's face. */
  readonly touch: string;
}

export const DANCE_LANE_VISUALS: readonly DanceLaneVisual[] = [
  {
    lane: 'left',
    glyph: '←',
    label: 'Left',
    keys: '← or A',
    keyCap: 'A',
    token:
      'border-rose-200/80 bg-gradient-to-b from-rose-400 to-rose-600 shadow-[0_3px_0_#9f1239,0_6px_14px_rgba(190,18,60,0.45)]',
    receptor: 'border-rose-300/60 text-rose-100/70',
    receptorActive: 'border-rose-200 bg-rose-500/35 text-white',
    rail: 'from-rose-400/10',
    glow: 'rgba(251,113,133,0.55)',
    touch:
      'border-rose-200/70 bg-gradient-to-b from-rose-400 to-rose-600 shadow-[0_4px_0_#9f1239]',
  },
  {
    lane: 'down',
    glyph: '↓',
    label: 'Down',
    keys: '↓ or S',
    keyCap: 'S',
    token:
      'border-sky-200/80 bg-gradient-to-b from-sky-400 to-sky-600 shadow-[0_3px_0_#075985,0_6px_14px_rgba(2,132,199,0.45)]',
    receptor: 'border-sky-300/60 text-sky-100/70',
    receptorActive: 'border-sky-200 bg-sky-500/35 text-white',
    rail: 'from-sky-400/10',
    glow: 'rgba(56,189,248,0.55)',
    touch: 'border-sky-200/70 bg-gradient-to-b from-sky-400 to-sky-600 shadow-[0_4px_0_#075985]',
  },
  {
    lane: 'up',
    glyph: '↑',
    label: 'Up',
    keys: '↑ or W',
    keyCap: 'W',
    token:
      'border-emerald-200/80 bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-[0_3px_0_#065f46,0_6px_14px_rgba(5,150,105,0.45)]',
    receptor: 'border-emerald-300/60 text-emerald-100/70',
    receptorActive: 'border-emerald-200 bg-emerald-500/35 text-white',
    rail: 'from-emerald-400/10',
    glow: 'rgba(52,211,153,0.55)',
    touch:
      'border-emerald-200/70 bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-[0_4px_0_#065f46]',
  },
  {
    lane: 'right',
    glyph: '→',
    label: 'Right',
    keys: '→ or D',
    keyCap: 'D',
    token:
      'border-amber-200/80 bg-gradient-to-b from-amber-400 to-amber-600 shadow-[0_3px_0_#92400e,0_6px_14px_rgba(217,119,6,0.45)]',
    receptor: 'border-amber-300/60 text-amber-100/70',
    receptorActive: 'border-amber-200 bg-amber-500/35 text-white',
    rail: 'from-amber-400/10',
    glow: 'rgba(251,191,36,0.55)',
    touch:
      'border-amber-200/70 bg-gradient-to-b from-amber-400 to-amber-600 shadow-[0_4px_0_#92400e]',
  },
];

/** Readout text and colour per judgement. The WORD is the information. */
export const JUDGMENT_VISUALS: Readonly<
  Record<DanceJudgment, { readonly label: string; readonly className: string }>
> = {
  perfect: { label: 'Perfect!', className: 'text-emerald-200 [text-shadow:0_2px_10px_rgba(16,185,129,0.75)]' },
  good: { label: 'Good', className: 'text-sky-200 [text-shadow:0_2px_10px_rgba(14,165,233,0.7)]' },
  okay: { label: 'Okay', className: 'text-amber-200 [text-shadow:0_2px_10px_rgba(245,158,11,0.7)]' },
  miss: { label: 'Miss', className: 'text-rose-200 [text-shadow:0_2px_10px_rgba(244,63,94,0.7)]' },
};

/**
 * The judgement readout's fixed half.
 *
 * Position and centring live here rather than in the animation, so a reduced-
 * motion player — who gets no animation at all — still sees the word in the
 * right place. The animation only ever adds scale and opacity on top.
 */
export const JUDGMENT_READOUT_CLASS =
  'block text-center text-2xl font-black uppercase tracking-wide sm:text-3xl';

/**
 * The full class list for one judgement readout.
 *
 * Shared by the frame loop (which assigns it to `element.className`) and by the
 * DEV gallery (which renders it as JSX), so the two cannot drift.
 */
export function judgmentReadoutClass(
  judgment: DanceJudgment,
  reducedMotion: boolean,
): string {
  return cn(
    JUDGMENT_READOUT_CLASS,
    JUDGMENT_VISUALS[judgment].className,
    !reducedMotion && 'dance-judgment-pop',
  );
}

/**
 * How the combo readout grows.
 *
 * Prominence is the reward for a long combo, and it is deliberately expressed as
 * SCALE AND COLOUR on a fixed-size box rather than as a bigger element: a combo
 * counter that reflows the HUD would move the playfield under the player's
 * hands at exactly the moment they are doing well.
 *
 * Tiers are listed high-to-low and the first match wins.
 */
export interface DanceComboTier {
  readonly id: 'none' | 'start' | 'hot' | 'blazing' | 'unreal';
  readonly min: number;
  /** Applied to the combo number. Scale only — the box never changes size. */
  readonly className: string;
  /** A field-wide emphasis for the top tiers. Restrained on purpose. */
  readonly fieldClassName: string;
}

export const DANCE_COMBO_TIERS: readonly DanceComboTier[] = [
  {
    id: 'unreal',
    min: 40,
    className: 'scale-[1.35] text-amber-300 [text-shadow:0_2px_14px_rgba(251,191,36,0.9)]',
    fieldClassName: 'ring-2 ring-amber-300/50',
  },
  {
    id: 'blazing',
    min: 20,
    className: 'scale-125 text-fuchsia-300 [text-shadow:0_2px_12px_rgba(232,121,249,0.8)]',
    fieldClassName: 'ring-2 ring-fuchsia-300/35',
  },
  {
    id: 'hot',
    min: 10,
    className: 'scale-110 text-sky-200 [text-shadow:0_2px_10px_rgba(56,189,248,0.7)]',
    fieldClassName: '',
  },
  { id: 'start', min: 2, className: 'scale-100 text-white/90', fieldClassName: '' },
  { id: 'none', min: 0, className: 'scale-90 text-transparent', fieldClassName: '' },
];

export function comboTier(combo: number): DanceComboTier {
  return (
    DANCE_COMBO_TIERS.find((tier) => combo >= tier.min) ??
    DANCE_COMBO_TIERS[DANCE_COMBO_TIERS.length - 1]
  );
}

/** The combo box's fixed half. A tier only ever adds a scale and a colour. */
export const COMBO_SCALE_CLASS =
  'flex origin-center flex-col items-center leading-none transition-transform duration-150';

/**
 * Grade presentation. The LETTER is the outcome; the sentence beside it is what
 * makes the outcome mean something to a child reading it for the first time.
 */
export const DANCE_GRADE_VISUALS: Readonly<
  Record<string, { readonly praise: string; readonly ring: string; readonly text: string }>
> = {
  S: { praise: 'Flawless dancing!', ring: 'border-amber-400 bg-amber-400/15', text: 'text-amber-600' },
  A: { praise: 'Brilliant rhythm!', ring: 'border-emerald-500 bg-emerald-500/15', text: 'text-emerald-700' },
  B: { praise: 'Nice moves!', ring: 'border-sky-500 bg-sky-500/15', text: 'text-sky-700' },
  C: { praise: 'Good going — keep dancing!', ring: 'border-island-purple bg-island-purple/15', text: 'text-island-purple' },
  D: { praise: 'Warming up! Try that one again.', ring: 'border-island-wood bg-island-wood/15', text: 'text-island-wood-dark' },
};

export function gradeVisual(grade: string) {
  return DANCE_GRADE_VISUALS[grade] ?? DANCE_GRADE_VISUALS.D;
}

/**
 * How many sparks a receptor throws on a hit.
 *
 * A fixed, tiny number rendered ONCE as static markup and replayed by a CSS
 * class toggle — never spawned per hit. An unbounded particle system is the one
 * decoration that can genuinely cost a rhythm game its frame budget.
 */
export const RECEPTOR_SPARK_COUNT = 5;

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
