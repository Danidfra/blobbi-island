import { cn } from '@/lib/utils';
import type { ArcadeGameResult } from '@/arcade/types';
import type { ArcadeRewardCalculation } from '@/arcade/reward-policy';
import type { ArcadeRewardState } from '@/hooks/useArcadeReward';
import { POOL_AI_PROFILES, type PoolDifficulty } from '@/arcade/pool/ai';
import {
  POOL_STAT_KEYS,
  formatPoolDuration,
  type PoolMatchResult,
} from '@/arcade/pool/pool-result';
import { groupLabel } from '@/arcade/pool/rules';

import { ArcadeRewardPanel } from '../ArcadeRewardPanel';

/**
 * The result of one frame.
 *
 * The frame half — who won and HOW, which is the part pool has more to say
 * about than air hockey does — is this component's own. "You win 7–3" and "you
 * win 7–3 by potting the 8-ball off a four-ball run" are different frames, and
 * the second one is worth telling somebody about.
 *
 * The ticket half is the shared {@link ArcadeRewardPanel}, exactly as on the
 * dance and hockey results screens: `POOL_REWARD_POLICY` is active, so a
 * finished frame shows its award, its breakdown, and the claim. The panel's
 * honesty rules (an unresolved claim is never retryable, a balance is never
 * invented) are documented on the panel itself.
 *
 * ## Non-colour signalling
 *
 * The outcome is stated as a WORD ("You win" / "Rival wins"), backed by the ball
 * counts, by an icon and by a sentence saying how it ended. The tint is the last
 * of four signals, not the only one, so the screen reads correctly in greyscale
 * and to a screen reader.
 */

interface PoolResultsProps {
  readonly summary: PoolMatchResult;
  /** The arcade-contract result. Rendered only for the DEV harness. */
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
  readonly showDebugDetails?: boolean;
}

/** One sentence about how the frame actually finished. */
function endingLine(summary: PoolMatchResult): string {
  if (summary.legalEightFinish) {
    return summary.playerScratches === 0
      ? 'You cleared your group and sank the 8-ball without a single scratch.'
      : 'You cleared your group and sank the 8-ball.';
  }
  if (summary.earlyEightLoss) {
    return 'The 8-ball went down before your group was clear. Clear all seven first, then take it on.';
  }
  return 'Your rival cleared up and took the 8-ball.';
}

export function PoolResults({
  summary,
  result,
  calculation,
  reward,
  claiming,
  canClaim,
  onClaim,
  onCheckStatus,
  isLoggedIn,
  showDebugDetails = false,
}: PoolResultsProps) {
  const won = summary.outcome === 'win';
  const profile = POOL_AI_PROFILES[summary.difficulty as PoolDifficulty];
  const accuracy =
    summary.playerShots > 0
      ? Math.round((summary.playerSuccessfulShots / summary.playerShots) * 100)
      : 0;

  return (
    <div data-pool-results className="mx-auto flex max-w-md flex-col gap-3 pb-2">
      <div
        data-pool-outcome={summary.outcome}
        className={cn(
          'overflow-hidden rounded-2xl border-2 px-4 py-4 text-center shadow-[0_4px_0_rgba(140,98,57,0.25)]',
          won
            ? 'border-island-purple/50 bg-gradient-to-b from-island-purple/15 to-island-cream-2'
            : 'border-island-wood/40 bg-gradient-to-b from-island-cream-2 to-island-sand',
        )}
      >
        <p aria-hidden className="text-4xl leading-none">
          {won ? '🎱' : '💪'}
        </p>
        <h3 className="mt-1 text-2xl font-black uppercase tracking-[0.14em] text-island-wood-dark">
          {won ? 'You win' : 'Rival wins'}
        </h3>

        {/* The ball count, labelled on both sides so it never depends on which
            number happens to be on the left. */}
        <p className="mt-2 flex items-end justify-center gap-3 font-mono">
          <span className="flex flex-col items-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-island-ink-soft">
              You
            </span>
            <span className="text-4xl font-black leading-none text-island-purple">
              {summary.playerBallsPocketed}
            </span>
          </span>
          <span className="pb-1 text-2xl font-black text-island-ink-soft">–</span>
          <span className="flex flex-col items-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-island-ink-soft">
              Rival
            </span>
            <span className="text-4xl font-black leading-none text-amber-600">
              {summary.opponentBallsPocketed}
            </span>
          </span>
        </p>

        <p className="mt-2 text-xs blobbi-text-muted">
          {summary.playerGroup === null ? 'Table stayed open' : `You were on ${groupLabel(summary.playerGroup).toLowerCase()}`}{' '}
          &middot; {profile?.label ?? summary.difficulty} rival &middot;{' '}
          {formatPoolDuration(summary.durationMs)}
        </p>
      </div>

      <dl
        data-pool-stats
        className="grid grid-cols-2 gap-2 rounded-2xl border-2 border-island-wood/25 bg-island-cream/60 p-3 sm:grid-cols-4"
      >
        <Stat label="Shots" value={String(summary.playerShots)} />
        <Stat label="Pot rate" value={`${accuracy}%`} />
        <Stat label="Best run" value={String(summary.longestPlayerRun)} />
        <Stat label="Scratches" value={String(summary.playerScratches)} />
      </dl>

      <ArcadeRewardPanel
        calculation={calculation}
        reward={reward}
        claiming={claiming}
        canClaim={canClaim}
        onClaim={onClaim}
        onCheckStatus={onCheckStatus}
        isLoggedIn={isLoggedIn}
        showDebugDetails={showDebugDetails}
        dataPrefix="pool"
        ineligibleHint="Play the frame through to the 8-ball and the tickets are yours — win or lose."
      />

      <p
        data-pool-ending
        className="rounded-2xl border-2 border-island-wood/25 p-3 text-xs blobbi-text-muted"
      >
        {endingLine(summary)}
      </p>

      {showDebugDetails && (
        <pre
          data-pool-debug
          className="overflow-x-auto rounded-xl bg-island-ink/90 p-3 text-left font-mono text-[10px] leading-relaxed text-island-cream"
        >
          {JSON.stringify(
            {
              runId: result.runId,
              gameId: result.gameId,
              machineId: result.machineId,
              cleared: result.cleared,
              score: result.score,
              won: result.stats[POOL_STAT_KEYS.won],
              difference: result.stats[POOL_STAT_KEYS.ballDifference],
              legalEight: result.stats[POOL_STAT_KEYS.legalEightFinish],
              earlyEight: result.stats[POOL_STAT_KEYS.earlyEightLoss],
            },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="text-center">
      <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-island-ink-soft">
        {label}
      </dt>
      <dd className="font-mono text-lg font-black leading-tight text-island-ink">{value}</dd>
    </div>
  );
}
