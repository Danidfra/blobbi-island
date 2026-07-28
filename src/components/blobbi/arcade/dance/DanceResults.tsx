import { cn } from '@/lib/utils';
import type { ArcadeGameResult } from '@/arcade/types';
import type { ArcadeRewardCalculation } from '@/arcade/reward-policy';
import type { ArcadeRewardState } from '@/hooks/useArcadeReward';
import { DANCE_STAT_KEYS, resultAccuracy } from '@/arcade/dance/dance-result';
import { gradeForAccuracy } from '@/arcade/dance/judgment';

import { gradeVisual } from './dance-visuals';
import { DanceMascot } from './DanceMascot';

/**
 * The results screen, and the only place a ticket number is shown to a player.
 *
 * ## Honesty rules this component exists to enforce
 *
 * A claim has more than two outcomes, and collapsing them into "worked / failed"
 * is how a player ends up being told something untrue — and, in the defect this
 * screen was rebuilt around, how a 3-ticket reward got granted twice.
 *
 * | phase | what the copy may say | what the button does |
 * | --- | --- | --- |
 * | `idle` + eligible | "claim these tickets" — never "you have them" | claim |
 * | `idle` + ineligible | why, in words, not a silent zero | nothing |
 * | `claiming` | "saving" — the button is out of action | nothing |
 * | `confirmed` | the tickets are in the inventory; the balance moved and was read back | nothing |
 * | `failed` | nothing was written; retry | claim again |
 * | `unresolved` | it MAY have been written; we will NOT send another grant | **check status, read-only** |
 * | `checking` | a read-only status check is running | nothing |
 * | `already-claimed` | this run was paid, on this browser | nothing |
 *
 * Two things must never appear: a confirmed balance increase the application
 * cannot substantiate, and a **"Try again" button on an unresolved claim**. The
 * second one is not a wording problem — an additive `+N` retried after a publish
 * that actually landed is `+2N`, and re-reading the balance first does not help,
 * because the balance already includes the first grant.
 *
 * ## What the polish pass changed, and what it could not
 *
 * The layout, the celebration and the wording of the *score* half are new: a
 * grade with a sentence beside it, four metric tiles, and the judgement counts
 * as a readable row rather than a two-column table of labels.
 *
 * The *ticket* half is presentation-only. Every phase above still renders its
 * own distinct state, an unresolved claim still gets exactly one read-only
 * action, and the status chip added at the top of the panel derives from the
 * same phase — it never says "saved" for a claim that is merely unresolved,
 * because that sentence is the defect this file was written to prevent.
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

/**
 * A short, non-committal label for each claim phase.
 *
 * These are STATUS words, not outcomes. `unresolved` reads "Not confirmed"
 * rather than anything that could be mistaken for "saved", because the whole
 * point of that phase is that the application does not know.
 */
const PHASE_CHIP: Readonly<
  Record<ArcadeRewardState['phase'], { label: string; className: string }>
> = {
  idle: { label: 'Ready to collect', className: 'bg-island-purple/15 text-island-purple' },
  claiming: { label: 'Saving…', className: 'bg-island-wood/15 text-island-wood-dark' },
  confirmed: { label: 'In your inventory', className: 'bg-emerald-500/15 text-emerald-800' },
  failed: { label: 'Not saved', className: 'bg-rose-500/15 text-rose-800' },
  unresolved: { label: 'Not confirmed', className: 'bg-amber-500/15 text-amber-800' },
  checking: { label: 'Checking…', className: 'bg-island-wood/15 text-island-wood-dark' },
  'already-claimed': { label: 'Already collected', className: 'bg-island-wood/15 text-island-wood-dark' },
};

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

      <RewardPanel
        calculation={calculation}
        reward={reward}
        claiming={claiming}
        canClaim={canClaim}
        onClaim={onClaim}
        onCheckStatus={onCheckStatus}
        isLoggedIn={isLoggedIn}
        showDebugDetails={showDebugDetails}
      />
    </div>
  );
}

function RewardPanel({
  calculation,
  reward,
  claiming,
  canClaim,
  onClaim,
  isLoggedIn,
  onCheckStatus,
  showDebugDetails,
}: Pick<
  DanceResultsProps,
  | 'calculation'
  | 'reward'
  | 'claiming'
  | 'canClaim'
  | 'onClaim'
  | 'onCheckStatus'
  | 'isLoggedIn'
  | 'showDebugDetails'
>) {
  if (!calculation) {
    return (
      <p
        data-dance-reward="unavailable"
        role="status"
        className="rounded-2xl border-2 border-island-wood/25 p-3 text-sm blobbi-text-muted"
      >
        Arcade Tickets could not be worked out for this run, so none are being offered. Your score
        still stands.
      </p>
    );
  }

  /**
   * Zero tickets, said kindly and said once.
   *
   * A run can be ineligible for reasons that are nobody's fault — it was cut
   * short, or it never reached the end. The copy names the reason and then says
   * the useful thing: the way to get tickets is to play the song through, which
   * the Play again button is right there to do.
   */
  if (!calculation.eligible) {
    return (
      <div
        data-dance-reward="ineligible"
        role="status"
        className="rounded-2xl border-2 border-island-wood/25 bg-island-cream/60 p-3 text-center"
      >
        <p className="text-sm font-bold text-island-ink">
          <span aria-hidden>🎟️ </span>No Arcade Tickets this time
        </p>
        <p className="mt-1 text-xs blobbi-text-muted">
          {calculation.ineligibleReason}. Dance the whole song through and the tickets are yours —
          your score still counts either way.
        </p>
      </div>
    );
  }

  const busy = claiming || reward.phase === 'claiming';
  const checking = reward.phase === 'checking';
  const confirmed = reward.phase === 'confirmed';
  const already = reward.phase === 'already-claimed';
  /**
   * The claim MAY have been published. The only action offered is a read-only
   * status check — there is deliberately no path from here to another publish.
   */
  const unresolved = reward.phase === 'unresolved';
  const chip = PHASE_CHIP[reward.phase];

  return (
    <div
      data-dance-reward={reward.phase}
      className="space-y-2 rounded-2xl border-2 border-island-purple/30 bg-island-purple/[0.06] p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-island-ink">Arcade Tickets</h4>
        <span
          data-dance-reward-chip={reward.phase}
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
            chip.className,
          )}
        >
          {chip.label}
        </span>
      </div>

      {/* The earned quantity, large enough to be the point of the panel. */}
      <p className="text-center font-mono text-4xl font-black leading-none text-island-purple">
        <span aria-hidden className="mr-1 text-2xl">
          🎟️
        </span>
        {calculation.quantity}
      </p>

      <ul className="space-y-0.5 text-xs blobbi-text-muted">
        {calculation.components.map((line) => (
          <li key={line.label} className="flex justify-between gap-3">
            <span>
              {line.label}
              {line.detail ? ` (${line.detail})` : ''}
            </span>
            <span className="font-mono">{line.tickets > 0 ? `+${line.tickets}` : line.tickets}</span>
          </li>
        ))}
        {calculation.capApplied && (
          <li className="font-bold">Capped at {calculation.cap} per run.</li>
        )}
      </ul>

      {reward.message && (
        <p
          role="status"
          data-dance-reward-message
          className={cn(
            'rounded-lg px-2 py-1.5 text-xs',
            confirmed && 'bg-emerald-500/10 text-emerald-800',
            reward.phase === 'failed' && 'bg-rose-500/10 text-rose-800',
            unresolved && 'bg-amber-500/10 text-amber-800',
            already && 'bg-island-wood/10',
            (busy || checking) && 'bg-island-wood/10',
          )}
        >
          {reward.message}
        </p>
      )}

      {/*
        An unresolved claim gets ONE action, and it does not publish. Offering
        "Try again" here is what turned a 3-ticket reward into 6: the retry is an
        additive +N on a balance that may already include the first +N.
      */}
      {unresolved || checking ? (
        <button
          type="button"
          data-dance-check-status
          onClick={onCheckStatus}
          disabled={checking || !isLoggedIn}
          className={cn(
            'min-h-[44px] w-full rounded-full border-2 border-island-wood/40 px-4 py-2 text-sm font-bold',
            'bg-island-cream text-island-ink disabled:opacity-50',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          )}
        >
          {checking ? 'Checking…' : 'Check ticket status'}
        </button>
      ) : (
        !confirmed &&
        !already && (
          <button
            type="button"
            data-dance-claim
            onClick={onClaim}
            disabled={busy || !canClaim || !isLoggedIn}
            className={cn(
              'min-h-[44px] w-full rounded-full border-2 border-island-purple px-4 py-2 text-sm font-bold',
              'bg-island-purple text-white disabled:opacity-50',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
            )}
          >
            {busy
              ? 'Saving your tickets…'
              : !isLoggedIn
                ? 'Log in to keep these tickets'
                : reward.phase === 'failed'
                  ? 'Try again'
                  : `Claim ${calculation.quantity} tickets`}
          </button>
        )
      )}

      {/*
        Policy identity is protocol trivia, not player copy. It stays available
        for the DEV harness and for a support conversation, and out of the way
        otherwise.
      */}
      {showDebugDetails && (
        <p data-dance-reward-policy className="text-[11px] blobbi-text-muted">
          Policy {calculation.policyId} v{calculation.policyVersion}
        </p>
      )}
    </div>
  );
}
