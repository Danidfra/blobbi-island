import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useArcadeRewardController } from '@/hooks/useArcadeRewardController';
import type { ArcadeRewardWriter } from '@/arcade/arcade-reward-boundary';
import type {
  ArcadeAbortReason,
  ArcadeEvent,
  ArcadeMachineState,
} from '@/arcade/arcade-machine-state';
import type { ArcadeGameResult } from '@/arcade/types';
import type { DanceChart } from '@/arcade/dance/chart';
import { DEFAULT_DANCE_CHART, validateDanceChart } from '@/arcade/dance/chart';
import type { DanceTrack } from '@/arcade/dance/track';
import { NEON_HOP_TRACK, getDanceTrack } from '@/arcade/dance/track';
import type { DanceAudioEngine, DanceAudioFactory } from '@/arcade/dance/dance-audio';
import { createDanceAudioEngine } from '@/arcade/dance/dance-audio';
import { isArcadeMuted, setArcadeMuted } from '@/arcade/audio/arcade-audio';

import { ArcadeGameShell } from '../ArcadeGameShell';
import { BlobbiDanceGame } from './BlobbiDanceGame';
import { DancePreview } from './DancePreview';
import { DanceResults } from './DanceResults';
import { arcadeEntryRefusalMessage } from '@/arcade/tokens/entry-copy';
import { ArcadeStartButton } from '../ArcadeStartButton';
import {
  FREE_ARCADE_GAME_ENTRY,
  type ArcadeGameEntry,
} from '@/arcade/tokens/game-entry';

/**
 * Blobbi Dance — the controller that joins the game to the shared arcade.
 *
 * It owns nothing that the pieces around it already own. The lifecycle lives in
 * `ArcadeRoom`'s reducer, the rules live in `src/arcade/dance/`, the claim
 * wiring lives in `useArcadeRewardController` (shared with Air Hockey and
 * Pool), and the frame is `ArcadeGameShell`. What is left here is the wiring —
 * and the wiring is where the interesting rules are:
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
 *
 * ## Identity is passed in, and it is always the dance machine's
 *
 * It used to take an `ArcadeMachineConfig` and read the game's id and name off
 * it. It now takes `machineId`, `gameId` and `title` as plain values: `gameId`
 * and `title` come from the game registry, `machineId` from the machine the
 * player walked to.
 *
 * In production that machine is ALWAYS `arcade-dance-machine`, and it is not
 * this component's job to make that true — `canLaunchArcadeGame` refuses a
 * Blobbi Dance launch from anywhere else, so no other machine can produce a run
 * to hand here. A brief corrective pass had the catalogue launching this game
 * from any of nine cabinets, which would have written a pool table's id into a
 * ticket claim; the fix is the launch rule, not a check inside the game.
 */

export interface DanceMachineProps {
  /** The cabinet this run happens on. Recorded in the result and the claim. */
  readonly machineId: string;
  /** Canonical game id, from the catalogue. Never derived from the machine. */
  readonly gameId: string;
  /** The game's name, from the catalogue. Titles the shell. */
  readonly title: string;
  readonly lifecycle: ArcadeMachineState;
  readonly dispatch: (event: ArcadeEvent) => void;
  /** Leave the game. Where that lands is the navigation model's decision. */
  readonly onExit: () => void;
  /**
   * Text for the single dismiss control while NOT mid-run.
   *
   * Supplied by the caller because only the caller knows the destination: a
   * dedicated machine returns to the arcade room, a catalogue-launched game
   * returns to the catalogue, and a control that says the wrong one is worse
   * than one that says nothing.
   */
  readonly exitLabel: string;
  readonly exitAriaLabel: string;
  /**
   * The turnstile that charges for a run. Injected, like the reward writer:
   * a machine rendered without one plays free, which is the safe default —
   * charging by omission would be taking money nobody wired up.
   */
  readonly entry?: ArcadeGameEntry;
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
  machineId,
  gameId,
  title,
  lifecycle,
  dispatch,
  onExit,
  exitLabel,
  exitAriaLabel,
  audioFactory = createDanceAudioEngine,
  rewardWriter,
  chart = DEFAULT_DANCE_CHART,
  mintRunId = defaultMintRunId,
  entry = FREE_ARCADE_GAME_ENTRY,
  showDebugDetails = false,
}: DanceMachineProps) {
  const reducedMotion = useReducedMotion();
  const reward = useArcadeRewardController({ lifecycle, dispatch, writer: rewardWriter });
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

  useEffect(() => {
    if (status === 'aborted' && lifecycle.abortReason) {
      setAbortNotice(ABORT_COPY[lifecycle.abortReason] ?? ABORT_COPY.quit);
    }
  }, [status, lifecycle.abortReason]);

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

  /**
   * The commitment boundary: a Token is charged here and nowhere earlier.
   * A broken chart and a failed audio engine both refuse BEFORE the charge —
   * the player must never pay for a run that cannot start.
   */
  const beginRun = useCallback(
    (kind: 'start' | 'replay') => {
      if (chartProblems.length > 0) return;
      setAbortNotice(null);
      // Everything that can refuse for FREE happens first: a broken chart or a
      // dead audio engine must never cost the player a Token.
      if (!prepareEngine()) return;

      // A free run — or one a Pass waives — starts on this tick, with no
      // write and no await.
      if (entry.admitFree(gameId)) {
        dispatch({ type: kind, runId: mintRunId(), difficulty: chart.difficulty });
        return;
      }

      void (async () => {
        const admitted = await entry.admit(gameId);
        if (!admitted.ok) {
          setAbortNotice(arcadeEntryRefusalMessage(admitted));
          return;
        }
        dispatch({ type: kind, runId: mintRunId(), difficulty: chart.difficulty });
      })();
    },
    [chartProblems.length, dispatch, chart.difficulty, prepareEngine, entry, gameId, mintRunId],
  );

  const handleStart = useCallback(() => beginRun('start'), [beginRun]);
  const handleReplay = useCallback(() => beginRun('replay'), [beginRun]);

  const handleFinish = useCallback(
    (finished: ArcadeGameResult) => dispatch({ type: 'finish', result: finished }),
    [dispatch],
  );

  const handleAbort = useCallback(
    (reason: ArcadeAbortReason) => dispatch({ type: 'abort', reason }),
    [dispatch],
  );

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
        machineId={machineId}
        gameId={gameId}
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
        calculation={reward.calculation}
        reward={reward.rewardState}
        claiming={status === 'claiming'}
        canClaim={reward.canClaim}
        onClaim={reward.handleClaim}
        onCheckStatus={reward.handleCheckStatus}
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
   * The footer holds exactly ONE action: the thing the player came for.
   *
   * Before this pass Close and Start were the same size and nearly the same
   * weight, so the screen offered a child two equally-loud choices and let them
   * work out which one plays the game. `islandCtaButtonClass` is the island's
   * existing primary CTA — the same pill used to enter the island — so the
   * loudest thing on the screen is the thing the player came for.
   *
   * Phase 4 removed the footer's quiet "Close" as well. It did the same thing as
   * the header's dismiss control while wearing a different word, and once that
   * control started saying where it goes ("Back to games"), two differently
   * labelled buttons with one destination was worse than one.
   */
  const footer = playing ? null : (
    <>
      {chartProblems.length === 0 &&
        !audioError &&
        (status === 'preview' ? (
          <ArcadeStartButton entry={entry} gameId={gameId} dataAttribute="data-dance-start" onClick={handleStart} />
        ) : (
          <ArcadeStartButton entry={entry} gameId={gameId} replay dataAttribute="data-dance-replay" onClick={handleReplay} />
        ))}
    </>
  );

  return (
    <ArcadeGameShell
      open={status !== 'closed'}
      onClose={onExit}
      title={title}
      description={`${track.title} · ${Math.round(track.durationMs / 1000)} seconds`}
      machineId={machineId}
      gameId={gameId}
      status={status}
      surface="game"
      /*
        One dismiss control, labelled for where it actually goes. Mid-run it
        abandons the run, so it says so; everywhere else it says where the
        player lands, which only the caller knows.
      */
      closeLabel={playing ? 'Leave' : exitLabel}
      closeAriaLabel={playing ? `Leave ${title} and end this run` : exitAriaLabel}
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
