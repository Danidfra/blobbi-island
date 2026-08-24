import { Flame, Sparkles, Star } from 'lucide-react';

import { cn } from '@/lib/utils';
import { BLOBBI_NEEDS, blobbiMood, needLevel, type BlobbiNeedKey } from '@/lib/blobbi-mood';
import type { CareNeed, CareUrgency, PetCondition, SleepState } from '@/lib/blobbi-types';

/**
 * The pet card — "how is my Blobbi", as a game says it.
 *
 * ## What this replaced
 *
 * A badge row, an alert, a five-row stat table under a heading, and a
 * two-column definition list of XP / streak / personality / trait / mood. Every
 * fact was there and correctly grouped, and it read like a profile analytics
 * panel: the same visual weight for "your pet is starving" and "generation 2".
 *
 * The reference study (Webkinz, Neopets, Tamagotchi-style pets) points at three
 * things those interfaces all do and this one did not:
 *
 *  1. **One headline.** A pet has a mood, and it is the first thing you read.
 *     Not five badges of equal weight.
 *  2. **Needs as meters beside the pet**, icon-led, numbers secondary. Webkinz
 *     puts them next to the avatar; the meaning is carried by how full the bar
 *     is, not by a printed percentage.
 *  3. **Progression as progression.** A bar, a streak, a badge — things that
 *     look like they are going somewhere.
 *
 * ## Compact, not tiny
 *
 * The blocks are spaced for a window that has to hold all of them at once
 * without scrolling. What was tightened is DEAD SPACE — a 60px-tall trophy for
 * three short strings, a 30px emoji in a padded box, `gap-y-2.5` between bars
 * that are 10px tall. Type sizes, bar heights and touch targets are untouched:
 * the fix for a tall panel is not a smaller font.
 *
 * ## What it deliberately does NOT do
 *
 * No new state, no invented thresholds, no level system. `blobbiMood` and
 * `needLevel` are pure re-readings of `analyzeCareStatus` output, and
 * `needLevel`'s boundaries are `getStatUrgency`'s own — so a meter that looks
 * low and a headline that says "Hungry" can never disagree. The game has raw XP
 * and no levels, so the card shows raw XP and no levels.
 */

export interface PetCardStats {
  hunger: number;
  energy: number;
  happiness: number;
  health: number;
  hygiene: number;
  experience: number;
  careStreak: number;
  generation: number;
  stage: string;
  personality?: string | string[];
  trait?: string | string[];
  mood?: string;
  isSleeping?: boolean;
}

export interface PetCardCareStatus {
  condition: PetCondition;
  urgency: CareUrgency;
  urgentNeed?: CareNeed;
  sleepState?: SleepState;
}

/** Tone → the two token pairs a tone owns. Nothing here is a raw colour. */
const TONE_STYLES = {
  calm: 'border-island-wood/20 bg-island-cream',
  notice: 'border-island-warn/40 bg-island-warn/10',
  alert: 'border-island-danger/35 bg-island-danger/10',
} as const;

/**
 * The mood hero.
 *
 * `role="status"` so a screen reader hears the headline change when the pet's
 * state does — the same information the emoji carries for everyone else. The
 * emoji is `aria-hidden`; the label is the accessible content.
 */
export function MoodHero({
  care,
  stats,
  className,
}: {
  care: PetCardCareStatus;
  stats: Pick<PetCardStats, 'isSleeping'>;
  className?: string;
}) {
  const mood = blobbiMood({
    condition: care.condition,
    urgency: care.urgency,
    urgentNeed: care.urgentNeed,
    sleepState: care.sleepState ?? (stats.isSleeping ? 'sleeping' : undefined),
  });

  return (
    <div
      role="status"
      data-testid="mood-hero"
      data-tone={mood.tone}
      className={cn(
        'flex items-center gap-2.5 rounded-panel border px-3 py-2 shadow-cozy-soft',
        TONE_STYLES[mood.tone],
        className,
      )}
    >
      <span aria-hidden className="text-2xl leading-none">
        {mood.emoji}
      </span>
      <div className="min-w-0">
        <p className="island-display text-base font-bold leading-tight text-island-ink">
          {mood.label}
        </p>
        {mood.hint && (
          <p className="mt-0.5 text-xs leading-snug text-island-ink-soft">{mood.hint}</p>
        )}
      </div>
    </div>
  );
}

/**
 * One need meter.
 *
 * A real `progressbar` with the full ARIA quartet, because the bar IS the
 * information — a div that merely looks like a meter tells a screen-reader user
 * nothing. The value is also printed, small, so the number is available to
 * everyone without dominating.
 *
 * `level` drives the fill colour AND the printed value's weight, so the state
 * is never carried by colour alone.
 */
function NeedMeter({
  emoji,
  label,
  value,
}: {
  emoji: string;
  label: string;
  value: number;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const level = needLevel(pct);

  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline gap-1.5">
        <span aria-hidden className="text-sm leading-none">
          {emoji}
        </span>
        <span className="text-xs font-semibold text-island-ink">{label}</span>
        <span
          className={cn(
            'ml-auto text-[0.6875rem] tabular-nums',
            level === 'good' ? 'text-island-ink-soft' : 'font-bold text-island-danger',
          )}
        >
          {Math.round(pct)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full border border-island-wood/20 bg-island-cream-2"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-300 ease-cozy motion-reduce:transition-none',
            level === 'good' && 'bg-island-grass',
            level === 'low' && 'bg-island-warn',
            level === 'critical' && 'bg-island-danger',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** The five needs, generated from one list so none can be dropped or mislabelled. */
export function NeedMeters({ stats, className }: { stats: PetCardStats; className?: string }) {
  return (
    <div
      data-testid="need-meters"
      className={cn('grid grid-cols-2 gap-x-3 gap-y-2', className)}
    >
      {BLOBBI_NEEDS.map((need) => (
        <NeedMeter
          key={need.key}
          emoji={need.emoji}
          label={need.label}
          value={stats[need.key as BlobbiNeedKey]}
        />
      ))}
    </div>
  );
}

/**
 * Progression.
 *
 * XP, care streak and generation as three small trophies rather than a
 * definition list. There is deliberately **no level and no XP bar**: the game
 * has raw experience and no thresholds, and drawing a bar would require
 * inventing a ceiling — a fake progress bar is worse than an honest number.
 */
export function ProgressionStrip({ stats, className }: { stats: PetCardStats; className?: string }) {
  return (
    <div data-testid="progression" className={cn('grid grid-cols-3 gap-1.5', className)}>
      <Trophy icon={Sparkles} value={stats.experience.toLocaleString()} label="XP earned" />
      <Trophy
        icon={Flame}
        value={String(stats.careStreak)}
        label={stats.careStreak === 1 ? 'day streak' : 'days streak'}
      />
      <Trophy icon={Star} value={`Gen ${stats.generation}`} label={stats.stage} />
    </div>
  );
}

function Trophy({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ElementType;
  value: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-panel border border-island-wood/20 bg-island-cream px-1.5 py-1.5 text-center shadow-cozy-soft">
      <Icon aria-hidden className="size-3.5 text-island-purple" />
      <span className="island-display text-sm font-bold leading-none text-island-ink">{value}</span>
      <span className="text-[0.625rem] capitalize leading-tight text-island-ink-soft">{label}</span>
    </div>
  );
}

/** A single character descriptor. */
function TraitChip({ emoji, value }: { emoji: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-island-purple/30 bg-island-purple/10 px-2 py-0.5 text-xs font-semibold capitalize text-island-ink">
      <span aria-hidden>{emoji}</span>
      {value}
    </span>
  );
}

/** Normalise the model's `string | string[]` into chips. */
function toValues(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map((v) => v.trim()).filter(Boolean);
}

/**
 * Personality, traits and mood as collectible-style chips.
 *
 * The model stores these as `string | string[]`, and the old card rendered the
 * array by joining it with commas — a database field printed verbatim. One chip
 * per value reads as character flavour instead, and costs less horizontal room
 * than the label-plus-value rows it replaces.
 */
export function TraitChips({ stats, className }: { stats: PetCardStats; className?: string }) {
  const chips = [
    ...toValues(stats.personality).map((v) => ({ emoji: '🎭', value: v })),
    ...toValues(stats.trait).map((v) => ({ emoji: '✨', value: v })),
    ...toValues(stats.mood).map((v) => ({ emoji: '💭', value: v })),
  ];

  if (chips.length === 0) return null;

  return (
    <div data-testid="trait-chips" className={cn('flex flex-wrap gap-1.5', className)}>
      {chips.map((chip, i) => (
        <TraitChip key={`${chip.value}-${i}`} emoji={chip.emoji} value={chip.value} />
      ))}
    </div>
  );
}
