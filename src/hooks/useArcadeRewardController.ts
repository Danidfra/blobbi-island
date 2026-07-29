/**
 * `useArcadeRewardController` — the ONE claim wiring every dedicated machine
 * shares.
 *
 * `DanceMachine` originally carried this wiring inline; when Air Hockey and
 * Pool earned reward policies of their own, copying those sixty lines twice
 * would have created three drifting implementations of the code most sensitive
 * to drift in the whole arcade. So the wiring lives here, once, and a machine
 * controller asks three questions: *what is this run worth*, *may it be
 * claimed*, and *what happened when the player tried*.
 *
 * What it owns, per machine instance:
 *
 *  - **hydration** — on every run-id change, adopt whatever durable claim state
 *    the ledger holds, so an unresolved or confirmed claim survives closing the
 *    shell, remounting, and a refresh;
 *  - **calculation** — resolve the game's PRODUCTION policy and price the
 *    finished result against the canonical Arcade Ticket address. A game with
 *    no active policy calculates to `null` and the results screen offers no
 *    claim — the shared panel renders its unavailable/no-claim state;
 *  - **claim** — the reducer's `claim` event is dispatched BEFORE the awaited
 *    publish so the lifecycle's own one-reward-per-run guard engages inside the
 *    same tick as the click, then `claim-succeeded`/`claim-failed` follows the
 *    verified outcome;
 *  - **status check** — read-only reconciliation for an unresolved claim; it
 *    can confirm the reward (and then advances the lifecycle exactly as a
 *    successful claim does) but can never publish.
 *
 * What it deliberately does NOT own: the run id (the machine mints it), the
 * result (the game builds it, the reducer keeps it), and the write itself
 * (`useArcadeReward` → `ArcadeRewardWriter`, unchanged). This hook is wiring,
 * not a second boundary — every exactly-once guarantee still lives in
 * `useArcadeReward` and the claim ledger beneath it.
 */

import { useCallback, useEffect, useMemo } from 'react';

import { useArcadeReward, ARCADE_TICKET_ADDRESS } from '@/hooks/useArcadeReward';
import type { ArcadeRewardWriter } from '@/arcade/arcade-reward-boundary';
import type { ArcadeEvent, ArcadeMachineState } from '@/arcade/arcade-machine-state';
import { canClaim as canClaimReward } from '@/arcade/arcade-machine-state';
import { calculateArcadeReward, getProductionRewardPolicy } from '@/arcade/reward-policy';
import type { ArcadeRewardCalculation } from '@/arcade/reward-policy';

export interface UseArcadeRewardControllerOptions {
  readonly lifecycle: ArcadeMachineState;
  readonly dispatch: (event: ArcadeEvent) => void;
  /** Substitute writer, for the DEV harness and tests. Production passes nothing. */
  readonly writer?: ArcadeRewardWriter;
}

export function useArcadeRewardController({
  lifecycle,
  dispatch,
  writer,
}: UseArcadeRewardControllerOptions) {
  const reward = useArcadeReward({ writer });
  const result = lifecycle.result;

  /**
   * Adopt whatever durable claim state exists for this run.
   *
   * Not a reset: a reset is what let an unresolved claim come back as a fresh
   * "Claim" button after the shell was closed and reopened. `hydrate` reads the
   * ledger, so a claim that may already have been published stays represented
   * as unresolved, and a confirmed one stays confirmed across a refresh. A run
   * with no record hydrates to idle, which is the reset behaviour where it is
   * correct.
   */
  const hydrateReward = reward.hydrate;
  useEffect(() => {
    hydrateReward(lifecycle.runId);
  }, [lifecycle.runId, hydrateReward]);

  const calculation = useMemo<ArcadeRewardCalculation | null>(() => {
    if (!result) return null;
    const policy = getProductionRewardPolicy(result.gameId);
    if (!policy) return null;
    return calculateArcadeReward({
      policy,
      result,
      itemAddress: ARCADE_TICKET_ADDRESS,
    });
  }, [result]);

  const { claimReward, reconcileClaim } = reward;
  const rewardPhase = reward.state.phase;

  const handleClaim = useCallback(async () => {
    if (!result || !calculation || !calculation.eligible) return;
    if (!canClaimReward(lifecycle)) return;
    // An unresolved claim must never reach `claimReward`, even if some future
    // control wires itself to this handler. The hook refuses it too — this is
    // the outer half of the same rule.
    if (rewardPhase === 'unresolved' || rewardPhase === 'checking') return;
    // Into `claiming` FIRST, so the reducer's own one-reward-per-run guard is
    // engaged before any await — the disabled button is a courtesy, this is the
    // guarantee (together with the hook's synchronous lock).
    dispatch({ type: 'claim' });
    const attempt = await claimReward(result, calculation);
    dispatch({ type: attempt.ok ? 'claim-succeeded' : 'claim-failed' });
  }, [result, calculation, lifecycle, dispatch, claimReward, rewardPhase]);

  /**
   * Read-only reconciliation. Publishes nothing, ever.
   *
   * It can only move the claim to `confirmed` (when the balance proves the
   * grant landed) or leave it unresolved. The lifecycle follows: a confirmation
   * here is a real reward, so the reducer records it exactly as a successful
   * claim does.
   */
  const handleCheckStatus = useCallback(async () => {
    if (!result || !calculation) return;
    const phase = await reconcileClaim(result.runId, calculation.itemAddress);
    if (phase === 'confirmed' && lifecycle.status === 'results') {
      dispatch({ type: 'claim' });
      dispatch({ type: 'claim-succeeded' });
    }
  }, [result, calculation, reconcileClaim, dispatch, lifecycle.status]);

  return {
    /** The reward hook's rendered state — phase, message, quantity. */
    rewardState: reward.state,
    /** Null when the game has no production policy or no result exists yet. */
    calculation,
    /** True when the shared lifecycle allows a claim for the current run. */
    canClaim: canClaimReward(lifecycle),
    isLoggedIn: reward.isLoggedIn,
    handleClaim,
    handleCheckStatus,
  };
}
