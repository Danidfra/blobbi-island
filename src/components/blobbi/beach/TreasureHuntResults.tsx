/**
 * Treasure Hunt: the findings summary, with the reward outcome.
 *
 * Renders the pure `TreasureHuntResult` plus the reward view the controller
 * derived from the (provisional) authorization. Honest by construction:
 * "added" is said ONLY in the `applied` phase; `authorizing` and `ambiguous`
 * never claim Coins moved; a practice round says plainly that none were
 * awarded. No special-item reward exists and none is implied.
 */

import { Button } from '@/components/ui/button';
import type { TreasureHuntResult, TreasureFindResult } from '@/beach/treasure-hunt';
import { findPresentation } from './treasure-hunt-config';
import { CoinIcon } from '../CoinAmount';
import type { TreasureHuntRewardView } from './TreasureHuntModalView';

interface TreasureHuntResultsProps {
  result: TreasureHuntResult;
  rewardView: TreasureHuntRewardView;
  /** Retry after a provably-unsent failure only. */
  onRetryReward: () => void;
  onReturnToBeach: () => void;
  /** Fresh local simulation / new hunt. Absent while an outcome is unsettled. */
  onPlayAgain?: () => void;
  playAgainLabel: string;
}

function FindList({ finds, emptyLabel }: { finds: readonly TreasureFindResult[]; emptyLabel: string }) {
  if (finds.length === 0) {
    return <p className="text-sm blobbi-text-muted">{emptyLabel}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {finds.map((find) => {
        const presentation = findPresentation(find.kind);
        return (
          <li
            key={find.targetId}
            className="flex items-center gap-1.5 rounded-full border border-island-wood/30 bg-island-cream/80 px-3 py-1 text-sm text-island-ink"
          >
            <span aria-hidden>{presentation.icon}</span>
            <span>{presentation.name}</span>
          </li>
        );
      })}
    </ul>
  );
}

function RewardPanel({
  rewardView,
  onRetryReward,
}: {
  rewardView: TreasureHuntRewardView;
  onRetryReward: () => void;
}) {
  if (rewardView.phase === 'practice') {
    return (
      <p
        className="mx-auto max-w-md rounded-2xl bg-island-warn/20 px-4 py-1.5 text-center text-xs text-island-ink"
        data-treasure-practice-notice
      >
        Practice round: no Coins were awarded.
      </p>
    );
  }
  if (rewardView.phase === 'ineligible') {
    return (
      <p
        className="mx-auto max-w-md rounded-2xl bg-island-warn/20 px-4 py-1.5 text-center text-xs text-island-ink"
        data-treasure-reward-status="ineligible"
      >
        This hunt ended too quickly to earn a reward, dig at least once and
        keep hunting a little longer next time!
      </p>
    );
  }

  const reward = rewardView.phase === 'authorizing' ? null : rewardView.reward;

  return (
    <div
      className="mx-auto w-full max-w-md space-y-1 rounded-2xl border border-island-wood/20 bg-island-cream/70 p-3 text-sm"
      data-treasure-reward-status={rewardView.phase}
    >
      {reward && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          <dt className="blobbi-text-muted">Base reward</dt>
          <dd className="text-right font-semibold text-island-ink">{reward.baseCoins}</dd>
          <dt className="blobbi-text-muted">Cleanup reward</dt>
          <dd className="text-right font-semibold text-island-ink">{reward.cleanupCoins}</dd>
          <dt className="blobbi-text-muted">Treasure reward</dt>
          <dd className="text-right font-semibold text-island-ink">{reward.treasureCoins}</dd>
          <dt className="font-semibold text-island-ink">Total</dt>
          <dd className="text-right font-bold text-island-ink">
            <CoinIcon className="mr-1" />
            {reward.totalCoins} Blobbi Coins
          </dd>
        </dl>
      )}

      {rewardView.phase === 'authorizing' && (
        <p role="status" className="text-center text-xs blobbi-text-muted">
          Confirming your reward…
        </p>
      )}
      {rewardView.phase === 'applied' && (
        <p role="status" className="text-center text-xs font-semibold text-island-grass-dark">
          <CoinIcon className="mr-1" />
          {rewardView.reward.totalCoins} Blobbi Coins added
        </p>
      )}
      {rewardView.phase === 'ambiguous' && (
        <p role="status" className="text-center text-xs text-island-wood-dark">
          Your reward is being confirmed. It is safely recorded and will not be
          lost or doubled: check your balance in a moment.
        </p>
      )}
      {rewardView.phase === 'failed' && (
        <div className="space-y-1 text-center">
          <p role="alert" className="text-xs text-red-700">
            The reward could not be sent ({rewardView.message}). Nothing was
            published.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={onRetryReward}
            data-treasure-retry-reward
          >
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

export function TreasureHuntResults({
  result,
  rewardView,
  onRetryReward,
  onReturnToBeach,
  onPlayAgain,
  playAgainLabel,
}: TreasureHuntResultsProps) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-2 py-1" data-treasure-results>
      <h3 className="text-center text-lg font-bold text-island-ink">Findings Summary</h3>

      <RewardPanel rewardView={rewardView} onRetryReward={onRetryReward} />

      <section aria-labelledby="treasure-cleanup-heading" className="space-y-1.5">
        <h4 id="treasure-cleanup-heading" className="text-sm font-semibold text-island-ink">
          🧹 Beach cleaned
        </h4>
        <FindList finds={result.litterFinds} emptyLabel="No litter this time, the sand was already sparkling." />
      </section>

      <section aria-labelledby="treasure-found-heading" className="space-y-1.5">
        <h4 id="treasure-found-heading" className="text-sm font-semibold text-island-ink">
          💎 Treasures discovered
        </h4>
        <FindList finds={result.valuableFinds} emptyLabel="No treasures this time. The beach keeps its secrets!" />
      </section>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-2xl border border-island-wood/20 bg-island-cream/70 p-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="blobbi-text-muted">Digs used</dt>
          <dd className="font-semibold text-island-ink">{result.shovelUsesSpent}</dd>
        </div>
        <div>
          <dt className="blobbi-text-muted">Missed digs</dt>
          <dd className="font-semibold text-island-ink">{result.missedDigs}</dd>
        </div>
        <div>
          <dt className="blobbi-text-muted">Hunt time</dt>
          <dd className="font-semibold text-island-ink">{Math.round(result.durationSeconds)}s</dd>
        </div>
      </dl>

      <div className="mt-auto flex flex-wrap items-center justify-center gap-2 pb-1">
        <Button
          type="button"
          onClick={onReturnToBeach}
          className="rounded-full min-h-[44px] px-6"
          data-treasure-return
        >
          Return to Beach
        </Button>
        {onPlayAgain && (
          <Button
            type="button"
            variant="outline"
            className="rounded-full min-h-[44px]"
            onClick={onPlayAgain}
          >
            {playAgainLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
