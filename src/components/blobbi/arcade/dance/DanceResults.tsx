import { cn } from '@/lib/utils';
import type { ArcadeGameResult } from '@/arcade/types';
import type { ArcadeRewardCalculation } from '@/arcade/reward-policy';
import type { ArcadeRewardState } from '@/hooks/useArcadeReward';
import { DANCE_STAT_KEYS, resultAccuracy } from '@/arcade/dance/dance-result';
import { gradeForAccuracy } from '@/arcade/dance/judgment';

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

  const rows: { label: string; value: string }[] = [
    { label: 'Perfect', value: String(stat(result, DANCE_STAT_KEYS.perfect)) },
    { label: 'Good', value: String(stat(result, DANCE_STAT_KEYS.good)) },
    { label: 'Okay', value: String(stat(result, DANCE_STAT_KEYS.okay)) },
    { label: 'Missed', value: String(stat(result, DANCE_STAT_KEYS.miss)) },
    { label: 'Longest combo', value: String(stat(result, DANCE_STAT_KEYS.maxCombo)) },
    {
      label: 'Notes',
      value: String(stat(result, DANCE_STAT_KEYS.totalNotes)),
    },
  ];

  return (
    <div data-dance-results className="mx-auto max-w-md space-y-4 py-2">
      {/*
        The whole summary in one sentence, for a screen reader, before the table
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

      <div className="flex items-center justify-center gap-4" aria-hidden>
        <p
          data-dance-grade={grade}
          className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-island-purple text-4xl font-black text-island-purple"
        >
          {grade}
        </p>
        <div>
          <p className="text-2xl font-bold text-island-ink">{accuracy}%</p>
          <p className="blobbi-text-muted text-sm">
            {result.score.toLocaleString()} points{fullCombo ? ' · full combo' : ''}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-island-wood/25 p-3 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-2">
            <dt className="blobbi-text-muted">{row.label}</dt>
            <dd className="font-mono font-bold text-island-ink">{row.value}</dd>
          </div>
        ))}
      </dl>

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
        className="rounded-xl border border-island-wood/25 p-3 text-sm blobbi-text-muted"
      >
        Arcade Tickets could not be worked out for this run, so none are being offered. Your score
        still stands.
      </p>
    );
  }

  if (!calculation.eligible) {
    return (
      <p
        data-dance-reward="ineligible"
        role="status"
        className="rounded-xl border border-island-wood/25 p-3 text-sm blobbi-text-muted"
      >
        No Arcade Tickets for this run — {calculation.ineligibleReason}.
      </p>
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

  return (
    <div
      data-dance-reward={reward.phase}
      className="space-y-2 rounded-xl border border-island-wood/25 p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold text-island-ink">Arcade Tickets</h4>
        <p className="font-mono text-lg font-bold text-island-purple">
          <span aria-hidden>🎟️ </span>
          {calculation.quantity}
        </p>
      </div>

      <ul className="space-y-0.5 text-xs blobbi-text-muted">
        {calculation.components.map((line) => (
          <li key={line.label} className="flex justify-between gap-3">
            <span>
              {line.label}
              {line.detail ? ` (${line.detail})` : ''}
            </span>
            <span className="font-mono">
              {line.tickets > 0 ? `+${line.tickets}` : line.tickets}
            </span>
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
            'w-full rounded-full border-2 border-island-wood/40 px-4 py-2 text-sm font-bold',
            'bg-transparent text-island-ink disabled:opacity-50',
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
              'w-full rounded-full border-2 border-island-purple px-4 py-2 text-sm font-bold',
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
