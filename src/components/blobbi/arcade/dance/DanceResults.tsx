import { cn } from '@/lib/utils';
import type { ArcadeGameResult } from '@/arcade/types';
import type { ArcadeRewardCalculation } from '@/arcade/reward-policy';
import type { ArcadeRewardState } from '@/hooks/useArcadeReward';
import { DANCE_STAT_KEYS, resultAccuracy } from '@/arcade/dance/dance-result';
import { gradeForAccuracy } from '@/arcade/dance/judgment';

import { ArcadeRewardPanel } from '../ArcadeRewardPanel';
import { gradeVisual } from './dance-visuals';
import { DanceMascot } from './DanceMascot';

/**
 * The results screen for one dance run.
 *
 * The *score* half, the grade, the celebration, the metric tiles and the
 * judgement counts: is this component's own. The *ticket* half is the shared
 * {@link ArcadeRewardPanel}: the claim phases, the honesty rules and the
 * unresolved-claim protections are documented there and are identical across
 * all three dedicated games. This screen keeps its established
 * `data-dance-*` selectors through the panel's `dataPrefix`.
 */

interface DanceResultsProps {
  readonly result: ArcadeGameResult;
  /** Null when no production policy could be resolved at all. */
  readonly calculation: ArcadeRewardCalculation | null;
  readonly reward: ArcadeRewardState;
  /** True while the shared lifecycle is in `claiming`. */
  readonly claiming: boolean;
  readonly canClaim: boolean;
  readonly onClaim: () => void;
  /** Read-only status check for an unresolved claim. Never publishes. */
  readonly onCheckStatus: () => void;
  readonly isLoggedIn: boolean;
  /** DEV harness only: show the policy identity. Hidden from players. */
  readonly showDebugDetails?: boolean;
}

const stat = (result: ArcadeGameResult, key: string): number => result.stats[key] ?? 0;

export function DanceResults({
  result,
  calculation,
  reward,
  claiming,
  canClaim,
  onClaim,
  onCheckStatus,
  isLoggedIn,
  showDebugDetails = false,
}: DanceResultsProps) {
  const accuracy = resultAccuracy(result) ?? 0;
  const grade = gradeForAccuracy(accuracy);
  const fullCombo = stat(result, DANCE_STAT_KEYS.fullCombo) === 1;
  const visual = gradeVisual(grade);

  /** The four judgement counts, in the order they matter to a player. */
  const counts: { label: string; value: number; className: string }[] = [
    {
      label: 'Perfect',
      value: stat(result, DANCE_STAT_KEYS.perfect),
      className: 'bg-emerald-500/15 text-emerald-800',
    },
    {
      label: 'Good',
      value: stat(result, DANCE_STAT_KEYS.good),
      className: 'bg-sky-500/15 text-sky-800',
    },
    {
      label: 'Okay',
      value: stat(result, DANCE_STAT_KEYS.okay),
      className: 'bg-amber-500/15 text-amber-800',
    },
    {
      label: 'Missed',
      value: stat(result, DANCE_STAT_KEYS.miss),
      className: 'bg-rose-500/15 text-rose-800',
    },
  ];

  return (
    <div data-dance-results className="mx-auto max-w-md space-y-3 pb-2">
      {/*
        The whole summary in one sentence, for a screen reader, before the panels
        it duplicates. A results screen that can only be read by chasing a
        transient animation is not a results screen.
      */}
      <p className="sr-only" role="status">
        {`Grade ${grade}. ${accuracy}% accuracy. Score ${result.score.toLocaleString()}. ` +
          `${stat(result, DANCE_STAT_KEYS.perfect)} perfect, ` +
          `${stat(result, DANCE_STAT_KEYS.good)} good, ` +
          `${stat(result, DANCE_STAT_KEYS.okay)} okay, ` +
          `${stat(result, DANCE_STAT_KEYS.miss)} missed. ` +
          `Longest combo ${stat(result, DANCE_STAT_KEYS.maxCombo)}.` +
          (fullCombo ? ' Full combo.' : '')}
      </p>

      {/* The outcome, celebrated. The letter is the rank; the sentence beside it
          is what makes the rank mean something on a first play. */}
      <div
        className="flex items-center gap-3 rounded-2xl border-2 border-island-wood/30 bg-gradient-to-b from-island-cream-2 to-island-sand p-3 shadow-[0_4px_0_rgba(140,98,57,0.28)]"
        aria-hidden
      >
        <p
          data-dance-grade={grade}
          className={cn(
            'flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-[3px] text-4xl font-black',
            visual.ring,
            visual.text,
          )}
        >
          {grade}
        </p>
        <div className="min-w-0 flex-1">
          <p className="text-base font-black text-island-ink sm:text-lg">{visual.praise}</p>
          <p className="font-mono text-2xl font-black leading-tight text-island-purple">
            {result.score.toLocaleString()}
          </p>
          {fullCombo && (
            <p className="text-xs font-bold uppercase tracking-widest text-amber-600">
              <span aria-hidden>★ </span>Full combo
            </p>
          )}
        </div>
        <DanceMascot
          beatMs={500}
          dancing={false}
          reducedMotion
          className="hidden h-14 w-14 shrink-0 sm:block"
        />
      </div>

      {/* The two numbers a player compares between runs, then the breakdown. */}
      <dl className="grid grid-cols-2 gap-2" aria-hidden>
        <div className="rounded-xl border border-island-wood/25 bg-island-cream/60 p-2 text-center">
          <dt className="text-[11px] font-bold uppercase tracking-widest blobbi-text-muted">
            Accuracy
          </dt>
          <dd className="font-mono text-xl font-black text-island-ink">{accuracy}%</dd>
        </div>
        <div className="rounded-xl border border-island-wood/25 bg-island-cream/60 p-2 text-center">
          <dt className="text-[11px] font-bold uppercase tracking-widest blobbi-text-muted">
            Best combo
          </dt>
          <dd className="font-mono text-xl font-black text-island-ink">
            {stat(result, DANCE_STAT_KEYS.maxCombo)}
          </dd>
        </div>
      </dl>

      <dl className="grid grid-cols-4 gap-1.5" aria-hidden>
        {counts.map((row) => (
          <div key={row.label} className={cn('rounded-xl p-2 text-center', row.className)}>
            <dt className="text-[10px] font-bold uppercase tracking-wide">{row.label}</dt>
            <dd className="font-mono text-lg font-black">{row.value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-center text-[11px] blobbi-text-muted" aria-hidden>
        {stat(result, DANCE_STAT_KEYS.totalNotes)} notes in this song
      </p>

      <ArcadeRewardPanel
        calculation={calculation}
        reward={reward}
        claiming={claiming}
        canClaim={canClaim}
        onClaim={onClaim}
        onCheckStatus={onCheckStatus}
        isLoggedIn={isLoggedIn}
        showDebugDetails={showDebugDetails}
        dataPrefix="dance"
        ineligibleHint="Dance the whole song through and the tickets are yours, your score still counts either way."
      />
    </div>
  );
}
