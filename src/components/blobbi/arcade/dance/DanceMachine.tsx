import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn, islandCtaButtonClass } from '@/lib/utils';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useArcadeReward, ARCADE_TICKET_ADDRESS } from '@/hooks/useArcadeReward';
import type { ArcadeRewardWriter } from '@/arcade/arcade-reward-boundary';
import type {
  ArcadeAbortReason,
  ArcadeEvent,
  ArcadeMachineState,
} from '@/arcade/arcade-machine-state';
import { canClaim as canClaimReward } from '@/arcade/arcade-machine-state';
import type { ArcadeGameResult } from '@/arcade/types';
import { calculateArcadeReward, getProductionRewardPolicy } from '@/arcade/reward-policy';
import type { DanceChart } from '@/arcade/dance/chart';
import { DEFAULT_DANCE_CHART, validateDanceChart } from '@/arcade/dance/chart';
import type { DanceTrack } from '@/arcade/dance/track';
import { NEON_HOP_TRACK, getDanceTrack } from '@/arcade/dance/track';
import type { DanceAudioEngine, DanceAudioFactory } from '@/arcade/dance/dance-audio';
import { createDanceAudioEngine } from '@/arcade/dance/dance-audio';
import { isArcadeMuted, setArcadeMuted } from '@/arcade/audio/arcade-audio';
import type { ArcadeMachineConfig } from '@/lib/arcade-machines-config';

import { ArcadeGameShell } from '../ArcadeGameShell';
import { BlobbiDanceGame } from './BlobbiDanceGame';
import { DancePreview } from './DancePreview';
import { DanceResults } from './DanceResults';

/**
 * Blobbi Dance — the controller that joins the game to the shared arcade.
 *
 * It owns nothing that the pieces around it already own. The lifecycle lives in
 * `ArcadeRoom`'s reducer, the rules live in `src/arcade/dance/`, the write lives
 * in `useArcadeReward`, and the frame is `ArcadeGameShell`. What is left here is
 * the wiring — and the wiring is where the interesting rules are:
 *
 *  - **A run id is minted exactly once, by the caller of `start`.** The reducer
 *    is pure and refuses to overwrite one; this is the only place one is made.
 *  - **A broken chart never starts a run.** Validation happens on mount, and
 *    Start does not exist when it fails.
 *  - **A claim goes through the reducer as well as the hook.** `claim` →
 *    `claim-succeeded` only on a CONFIRMED write, so a retry after an
 *    unconfirmed publish is still possible and a confirmed one can never repeat.
 *  - **Replay is a new run.** New id, cleared result, and the reward hook's state
 *    is reset so the previous run's message cannot linger over a fresh one.
 */

export interface DanceMachineProps {
  readonly machine: ArcadeMachineConfig;
  readonly lifecycle: ArcadeMachineState;
  readonly dispatch: (event: ArcadeEvent) => void;
  readonly onClose: () => void;
  /** Overridable for the DEV harness and tests. */
  readonly audioFactory?: DanceAudioFactory;
  /** Substitute reward writer. Production passes nothing. */
  readonly rewardWriter?: ArcadeRewardWriter;
  readonly chart?: DanceChart;
  readonly mintRunId?: () => string;
  /** DEV harness only: surface policy identity on the results panel. */
  readonly showDebugDetails?: boolean;
}

/** Unique per run. `crypto.randomUUID` where it exists; a counter where it does not. */
let runCounter = 0;
function defaultMintRunId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `dance-${uuid}`;
  runCounter += 1;
  return `dance-${Date.now()}-${runCounter}`;
}

const ABORT_COPY: Record<string, string> = {
  closed: 'That run ended when you left the machine, so it earned no tickets.',
  quit: 'That run ended early, so it earned no tickets.',
  interrupted:
    'That run ended because the tab was hidden — a rhythm game cannot keep time in a background tab. It earned no tickets.',
  error: 'That run could not continue, so it earned no tickets.',
};

export function DanceMachine({
  machine,
  lifecycle,
  dispatch,
  onClose,
  audioFactory = createDanceAudioEngine,
  rewardWriter,
  chart = DEFAULT_DANCE_CHART,
  mintRunId = defaultMintRunId,
  showDebugDetails = false,
}: DanceMachineProps) {
  const reducedMotion = useReducedMotion();
  const reward = useArcadeReward({ writer: rewardWriter });
  const [abortNotice, setAbortNotice] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  /**
   * The engine for the current run.
   *
   * It lives here, not in the game component, for one reason: an `AudioContext`
   * built outside a user gesture starts suspended and silently produces nothing.
   * Building it inside the Start handler — the click itself — is the only way to
   * be sure, and it means an unavailable audio system is reported BEFORE a run
   * exists rather than aborting one that had already started.
   */
  const engineRef = useRef<DanceAudioEngine | null>(null);
  const [engine, setEngine] = useState<DanceAudioEngine | null>(null);

  /**
   * The persisted arcade mute setting, mirrored into React so a control can
   * render it.
   *
   * The storage and the engine hook already existed — `isArcadeMuted`,
   * `setArcadeMuted` and `DanceAudioEngine.setMuted` all shipped in earlier
   * phases — and nothing in the product had ever offered a way to reach them.
   * This adds the control, not the capability, and it changes no timing: muting
   * takes the master gain to zero while the `AudioContext` (and therefore the
   * clock every judgement is made against) keeps running exactly as before.
   */
  const [muted, setMuted] = useState<boolean>(() => isArcadeMuted());
  /**
   * The authoritative value, so the toggle never has to read `muted` from a
   * closure that a second click in the same tick would have made stale.
   *
   * The alternative — deriving `next` inside `setMuted`'s updater — would put
   * the storage write and the engine call inside a function React is entitled to
   * invoke twice (and does, under StrictMode) and to discard the result of. A
   * state updater must be pure; a ref is the honest place for the value the side
   * effects need.
   */
  const mutedRef = useRef(muted);

  const handleToggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    setArcadeMuted(next);
    engineRef.current?.setMuted(next);
  }, []);

  const track: DanceTrack = useMemo(
    () => getDanceTrack(chart.trackId) ?? NEON_HOP_TRACK,
    [chart.trackId],
  );

  /**
   * Validated once per chart, before anything can start.
   *
   * The one shipped chart is generated deterministically from committed data, so
   * in practice this always passes — which is exactly why it must be checked
   * rather than assumed: the check is what makes a future hand-edited or
   * fetched chart fail honestly instead of producing an unplayable run.
   */
  const chartProblems = useMemo(() => {
    const validation = validateDanceChart(chart, getDanceTrack(chart.trackId));
    return validation.ok ? [] : validation.problems;
  }, [chart]);

  const status = lifecycle.status;
  const result = lifecycle.result;

  /**
   * Adopt whatever durable claim state exists for this run.
   *
   * Not a reset: a reset is what let an unresolved claim come back as a fresh
   * "Claim" button after the shell was closed and reopened. `hydrate` reads the
   * ledger, so a claim that may already have been published stays represented as
   * unresolved, and a confirmed one stays confirmed across a refresh. A run with
   * no record hydrates to idle, which is the reset behaviour where it is correct.
   */
  const hydrateReward = reward.hydrate;
  useEffect(() => {
    hydrateReward(lifecycle.runId);
  }, [lifecycle.runId, hydrateReward]);

  useEffect(() => {
    if (status === 'aborted' && lifecycle.abortReason) {
      setAbortNotice(ABORT_COPY[lifecycle.abortReason] ?? ABORT_COPY.quit);
    }
  }, [status, lifecycle.abortReason]);

  const calculation = useMemo(() => {
    if (!result) return null;
    const policy = getProductionRewardPolicy(result.gameId);
    if (!policy) return null;
    return calculateArcadeReward({
      policy,
      result,
      itemAddress: ARCADE_TICKET_ADDRESS,
    });
  }, [result]);

  /** The controller built the engine, so the controller releases it. */
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  /**
   * Build a fresh engine for a new run, from inside the click that asked for it.
   *
   * Returns `false` when audio is unavailable, in which case no run is started
   * at all — a rhythm game whose clock comes from the audio cannot be played
   * without it, and starting one anyway would produce a result nobody earned.
   */
  const prepareEngine = useCallback((): boolean => {
    engineRef.current?.dispose();
    engineRef.current = null;
    setEngine(null);

    const created = audioFactory(track);
    if (!created.ok) {
      setAudioError(
        created.failure === 'no-web-audio'
          ? 'This browser has no Web Audio support, and Blobbi Dance keeps time from the audio clock, so it cannot be played here.'
          : 'The audio system could not start, so the music cannot play. Blobbi Dance keeps time from the audio clock, so the run cannot begin.',
      );
      return false;
    }

    setAudioError(null);
    // The engine reads the persisted flag itself, but say it explicitly: in a
    // private-mode browser the write may not have persisted, and the control the
    // player just used must still be obeyed for this run. Read from the ref, not
    // from the rendered `muted`, so a toggle that has not yet re-rendered still
    // reaches the engine this call is building.
    created.engine.setMuted(mutedRef.current);
    engineRef.current = created.engine;
    setEngine(created.engine);
    return true;
  }, [audioFactory, track]);

  const handleStart = useCallback(() => {
    if (chartProblems.length > 0) return;
    setAbortNotice(null);
    if (!prepareEngine()) return;
    dispatch({ type: 'start', runId: mintRunId(), difficulty: chart.difficulty });
  }, [chartProblems.length, dispatch, mintRunId, chart.difficulty, prepareEngine]);

  const handleReplay = useCallback(() => {
    if (chartProblems.length > 0) return;
    setAbortNotice(null);
    if (!prepareEngine()) return;
    dispatch({ type: 'replay', runId: mintRunId(), difficulty: chart.difficulty });
  }, [chartProblems.length, dispatch, mintRunId, chart.difficulty, prepareEngine]);

  const handleFinish = useCallback(
    (finished: ArcadeGameResult) => dispatch({ type: 'finish', result: finished }),
    [dispatch],
  );

  const handleAbort = useCallback(
    (reason: ArcadeAbortReason) => dispatch({ type: 'abort', reason }),
    [dispatch],
  );

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
   * It can only move the claim to `confirmed` (when the balance proves the grant
   * landed) or leave it unresolved. The lifecycle follows: a confirmation here is
   * a real reward, so the reducer records it exactly as a successful claim does.
   */
  const handleCheckStatus = useCallback(async () => {
    if (!result || !calculation) return;
    const phase = await reconcileClaim(result.runId, calculation.itemAddress);
    if (phase === 'confirmed' && lifecycle.status === 'results') {
      dispatch({ type: 'claim' });
      dispatch({ type: 'claim-succeeded' });
    }
  }, [result, calculation, reconcileClaim, dispatch, lifecycle.status]);

  const playing = status === 'countdown' || status === 'playing' || status === 'paused';
  const showResults = status === 'results' || status === 'claiming' || status === 'rewarded';

  let content: ReactNode;
  if (audioError) {
    content = (
      <div
        role="alert"
        data-dance-error="audio"
        className="mx-auto max-w-md space-y-3 py-8 text-center"
      >
        <h3 className="text-lg font-bold text-island-ink">Blobbi Dance cannot start</h3>
        <p className="blobbi-text-muted text-sm">{audioError}</p>
      </div>
    );
  } else if (playing && engine) {
    content = (
      <BlobbiDanceGame
        machineId={machine.id}
        gameId={machine.gameId ?? ''}
        chart={chart}
        track={track}
        status={status}
        runId={lifecycle.runId}
        reducedMotion={reducedMotion}
        onCountdownComplete={() => dispatch({ type: 'countdown-complete' })}
        onFinish={handleFinish}
        onAbort={handleAbort}
        onPause={() => dispatch({ type: 'pause' })}
        engine={engine}
        muted={muted}
        onToggleMute={handleToggleMute}
      />
    );
  } else if (showResults && result) {
    content = (
      <DanceResults
        result={result}
        calculation={calculation}
        reward={reward.state}
        claiming={status === 'claiming'}
        canClaim={canClaimReward(lifecycle)}
        onClaim={handleClaim}
        onCheckStatus={handleCheckStatus}
        isLoggedIn={reward.isLoggedIn}
        showDebugDetails={showDebugDetails}
      />
    );
  } else {
    content = (
      <DancePreview
        track={track}
        chart={chart}
        chartProblems={chartProblems}
        abortNotice={status === 'aborted' ? abortNotice : null}
        muted={muted}
        onToggleMute={handleToggleMute}
      />
    );
  }

  /**
   * The footer, with a deliberate hierarchy: ONE bright primary action and one
   * quiet way out.
   *
   * Before this pass Close and Start were the same size and nearly the same
   * weight, so the screen offered a child two equally-loud choices and let them
   * work out which one plays the game. `islandCtaButtonClass` is the island's
   * existing primary CTA — the same pill used to enter the island — so the
   * loudest thing on the screen is the thing the player came for.
   */
  const footer = playing ? null : (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={onClose}
        className="rounded-full text-island-ink-soft"
      >
        Close
      </Button>
      {chartProblems.length === 0 &&
        !audioError &&
        (status === 'preview' ? (
          <button
            type="button"
            data-dance-start
            onClick={handleStart}
            className={cn(islandCtaButtonClass, 'w-auto min-w-[10rem] px-8 py-2.5')}
          >
            Start
          </button>
        ) : (
          <button
            type="button"
            data-dance-replay
            onClick={handleReplay}
            className={cn(islandCtaButtonClass, 'w-auto min-w-[10rem] px-8 py-2.5')}
          >
            Play again
          </button>
        ))}
    </>
  );

  return (
    <ArcadeGameShell
      open={status !== 'closed'}
      onClose={onClose}
      title={machine.displayName}
      description={`${track.title} · ${Math.round(track.durationMs / 1000)} seconds`}
      machineId={machine.id}
      gameId={machine.gameId}
      status={status}
      onPause={playing ? () => dispatch({ type: 'pause' }) : undefined}
      onResume={status === 'paused' ? () => dispatch({ type: 'resume' }) : undefined}
      footer={footer}
      /*
        A live run must not be able to scroll: a stray drag on a phone would take
        the lanes off screen mid-song. Every other state keeps the shell's normal
        scrolling, because a results panel at 320 × 568 genuinely needs it.
      */
      contentClassName={playing ? 'overflow-hidden px-2 py-2 sm:px-4 sm:py-3' : undefined}
    >
      {content}
    </ArcadeGameShell>
  );
}
