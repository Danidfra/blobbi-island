/**
 * Treasure Hunt — the intro screen.
 *
 * Three modes, decided by the reward window:
 * - `rewarded`       — slots remain today: "Start Hunt" earns Blobbi Coins;
 * - `practice-limit` — today's rewarded hunts are done: unlimited practice;
 * - `practice-only`  — rewards unavailable (no session): plain practice.
 *
 * Unresolved reward operations from earlier sessions surface here as a
 * recovery banner — the app never silently grants again and never hides an
 * uncertain payout.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { BeachRewardOp } from '@/lib/beach-reward-ledger';
import { CoinIcon } from '../CoinAmount';

export type TreasureHuntIntroMode = 'rewarded' | 'practice-limit' | 'practice-only';

interface TreasureHuntIntroProps {
  mode: TreasureHuntIntroMode;
  /** Rewarded hunts remaining today (meaningful in `rewarded` mode). */
  remaining: number;
  onStart: () => void;
  /** Round creation failed (a seed that cannot place targets). Rare; visible. */
  startError: string | null;
  /** Unresolved reward operations needing reconciliation. */
  pendingOps?: readonly BeachRewardOp[];
  onRecoverPending?: (opId: string) => void;
}

export function TreasureHuntIntro({
  mode,
  remaining,
  onStart,
  startError,
  pendingOps = [],
  onRecoverPending,
}: TreasureHuntIntroProps) {
  const [showHowTo, setShowHowTo] = useState(false);

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 text-center px-4"
      data-treasure-intro
      data-treasure-intro-mode={mode}
    >
      <div className="text-5xl" aria-hidden>
        🏖️
      </div>
      <p className="max-w-md text-base text-island-ink">
        Somewhere under this sand there are lost treasures — and some litter that
        would love a cleanup. Grab the metal detector and see what you can find!
      </p>

      {mode === 'rewarded' && (
        <div
          className="max-w-md space-y-1 rounded-2xl bg-amber-100/80 px-4 py-2 text-sm text-island-ink"
          data-treasure-reward-notice
        >
          <p className="font-semibold">
            <CoinIcon className="mr-1" />
            Rewarded Hunt
          </p>
          <p>Complete the hunt to earn Blobbi Coins.</p>
          <p data-treasure-remaining>
            Rewarded hunts remaining today: <span className="font-bold">{remaining}</span>
          </p>
        </div>
      )}

      {mode === 'practice-limit' && (
        <div
          className="max-w-md space-y-1 rounded-2xl bg-amber-100/80 px-4 py-2 text-sm text-island-ink"
          data-treasure-practice-notice
        >
          <p className="font-semibold">Practice Hunt</p>
          <p>You have completed today’s rewarded hunts.</p>
          <p>You can keep playing for practice.</p>
        </div>
      )}

      {mode === 'practice-only' && (
        <p
          className="max-w-md rounded-2xl bg-amber-100/80 px-4 py-2 text-sm text-island-ink"
          data-treasure-practice-notice
        >
          <span className="font-semibold">Practice Hunt</span> — explore the
          detector and learn how to find objects.
        </p>
      )}

      {pendingOps.length > 0 && (
        <div
          className="max-w-md space-y-2 rounded-2xl border border-island-wood/30 bg-white/70 px-4 py-2 text-sm text-island-ink"
          data-treasure-pending-recovery
          role="status"
        >
          <p className="font-semibold">A previous reward is still being confirmed.</p>
          {pendingOps.map((op) => (
            <div key={op.opId} className="flex items-center justify-center gap-2">
              <span>
                {op.status === 'finalized'
                  ? `${op.amount ?? '?'} Coins ready to finish`
                  : 'Waiting for confirmation'}
              </span>
              {onRecoverPending && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => onRecoverPending(op.opId)}
                >
                  {op.status === 'finalized' ? 'Finish reward' : 'Check again'}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {showHowTo && (
        <div
          className="max-w-md rounded-2xl border border-island-wood/30 bg-white/60 p-4 text-sm text-island-ink"
          data-treasure-howto
        >
          <p>Move the detector across the sand and watch the signal.</p>
          <p>When the signal is strong, switch to the shovel and choose where to dig.</p>
          <p>You only have a few digs, so choose carefully.</p>
        </div>
      )}

      {startError && (
        <p role="alert" className="max-w-md text-sm text-destructive">
          {startError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          onClick={onStart}
          className="rounded-full min-h-[44px] px-6"
          data-treasure-start
        >
          {mode === 'rewarded' ? 'Start Hunt' : 'Start Practice Hunt'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="rounded-full min-h-[44px]"
          onClick={() => setShowHowTo((v) => !v)}
          aria-expanded={showHowTo}
        >
          How to Play
        </Button>
      </div>
    </div>
  );
}
