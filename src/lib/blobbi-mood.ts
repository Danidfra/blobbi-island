/**
 * How a Blobbi's state READS to its owner.
 *
 * Pure presentation. Every value here is derived from `analyzeCareStatus`
 * output that already exists — `condition`, `urgentNeed`, `sleepState` — and
 * nothing new is computed, no threshold is invented and no state is added. What
 * this module owns is the difference between
 *
 *     condition: "fair" · urgency: "high" · urgentNeed: "cleaning"
 *
 * which is what the model says, and
 *
 *     🫧 Needs a wash
 *
 * which is what a person checking on their pet wants to read. The old panel
 * showed the former, twice, in two different cards.
 *
 * ## Precedence
 *
 * A pet has one headline, not five. The order is the order somebody would say
 * it out loud:
 *
 * ```
 *   asleep        →  nothing else matters while they are sleeping
 *   an urgent need→  the one thing to do something about
 *   condition     →  how they are generally
 * ```
 */

import type { CareNeed, CareUrgency, PetCondition, SleepState } from '@/lib/blobbi-types';

export interface BlobbiMood {
  /** The face. Decorative — `label` carries the meaning. */
  emoji: string;
  /** One short phrase, in the second person's voice. */
  label: string;
  /**
   * How loudly to say it.
   *
   * `alert` earns the danger treatment, `notice` a gentle one, `calm` none.
   * Three levels rather than five because a card with five visual weights has
   * no visual weight.
   */
  tone: 'calm' | 'notice' | 'alert';
  /** The action that would fix it, when there is one. Sentence fragment. */
  hint?: string;
}

/** What each unmet need reads as. */
const NEED_MOOD: Readonly<Record<CareNeed, { emoji: string; label: string; hint: string }>> = {
  food: { emoji: '🍎', label: 'Hungry', hint: 'Something from your bag would help.' },
  play: { emoji: '🎾', label: 'Wants to play', hint: 'A toy would cheer them up.' },
  medicine: { emoji: '🩹', label: 'Not feeling well', hint: 'Medicine would help.' },
  cleaning: { emoji: '🫧', label: 'Needs a wash', hint: 'Soap would sort that out.' },
  rest: { emoji: '💤', label: 'Worn out', hint: 'Some rest, or an energy item.' },
  // `attention` is in the vocabulary but is never produced by
  // `findUrgentCareNeed` today. Mapped anyway: an unmapped key would crash the
  // card the moment the model started emitting it.
  attention: { emoji: '🫶', label: 'Missing you', hint: 'Spend a little time together.' },
};

/** What the overall condition reads as, when nothing is urgent. */
const CONDITION_MOOD: Readonly<Record<PetCondition, { emoji: string; label: string }>> = {
  excellent: { emoji: '🤩', label: 'Feeling amazing' },
  good: { emoji: '😊', label: 'Feeling great' },
  fair: { emoji: '🙂', label: 'Doing okay' },
  poor: { emoji: '😕', label: 'Could use some care' },
  critical: { emoji: '😣', label: 'Really needs you' },
};

/** Which conditions are loud enough to colour the card. */
const CONDITION_TONE: Readonly<Record<PetCondition, BlobbiMood['tone']>> = {
  excellent: 'calm',
  good: 'calm',
  fair: 'calm',
  poor: 'notice',
  critical: 'alert',
};

/** How loudly an unmet need is announced. */
const URGENCY_TONE: Readonly<Record<CareUrgency, BlobbiMood['tone']>> = {
  none: 'calm',
  low: 'calm',
  medium: 'notice',
  high: 'alert',
  critical: 'alert',
};

export function blobbiMood(status: {
  condition: PetCondition;
  urgency: CareUrgency;
  urgentNeed?: CareNeed;
  sleepState?: SleepState;
}): BlobbiMood {
  // Asleep outranks everything: waking a Blobbi to tell it that it is tired
  // would be a strange thing for the game to do.
  if (status.sleepState === 'sleeping') {
    return { emoji: '😴', label: 'Fast asleep', tone: 'calm' };
  }

  if (status.urgentNeed && status.urgency !== 'none') {
    const mood = NEED_MOOD[status.urgentNeed];
    return {
      emoji: mood.emoji,
      label: mood.label,
      tone: URGENCY_TONE[status.urgency],
      hint: mood.hint,
    };
  }

  const mood = CONDITION_MOOD[status.condition];
  return { emoji: mood.emoji, label: mood.label, tone: CONDITION_TONE[status.condition] };
}

/**
 * The five needs, in the order the card shows them.
 *
 * A list rather than five hand-written rows: the meters are generated from it,
 * so a need cannot be shown with the wrong icon or silently dropped.
 */
export const BLOBBI_NEEDS = [
  { key: 'hunger', emoji: '🍎', label: 'Fed' },
  { key: 'energy', emoji: '⚡', label: 'Rested' },
  { key: 'happiness', emoji: '✨', label: 'Happy' },
  { key: 'health', emoji: '💚', label: 'Healthy' },
  { key: 'hygiene', emoji: '🫧', label: 'Clean' },
] as const satisfies readonly { key: string; emoji: string; label: string }[];

export type BlobbiNeedKey = (typeof BLOBBI_NEEDS)[number]['key'];

/**
 * How full a meter reads.
 *
 * The same `<= 25` / `<= 50` boundaries `getStatUrgency` already uses to decide
 * urgency, so a meter that looks low and a need that reports urgent can never
 * disagree. Presentation only — it computes no state.
 */
export function needLevel(value: number): 'good' | 'low' | 'critical' {
  if (value <= 25) return 'critical';
  if (value <= 50) return 'low';
  return 'good';
}
