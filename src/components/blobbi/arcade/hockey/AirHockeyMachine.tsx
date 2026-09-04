import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useImmersive } from '@/hooks/useImmersive';
import { useArcadeRewardController } from '@/hooks/useArcadeRewardController';
import type { ArcadeRewardWriter } from '@/arcade/arcade-reward-boundary';
import type {
  ArcadeAbortReason,
  ArcadeEvent,
  ArcadeMachineState,
} from '@/arcade/arcade-machine-state';
import type { ArcadeGameResult } from '@/arcade/types';
import { isArcadeMuted, setArcadeMuted } from '@/arcade/audio/arcade-audio';
import {
  DEFAULT_HOCKEY_DIFFICULTY,
  HOCKEY_AI_PROFILES,
  type HockeyDifficulty,
} from '@/arcade/hockey/ai';
import type { HockeyMatchState } from '@/arcade/hockey/match';
import { MATCH_GOAL_TARGET } from '@/arcade/hockey/table';
import { summaryFromResult } from '@/arcade/hockey/hockey-result';
import type { HockeyAudioEngine, HockeyAudioFactory } from '@/arcade/hockey/hockey-audio';
import { createHockeyAudio } from '@/arcade/hockey/hockey-audio';

import { ArcadeGameShell } from '../ArcadeGameShell';
import type { HockeyOrientation } from './hockey-draw';
import { AirHockeyTable } from './AirHockeyTable';
import { AirHockeyPreview } from './AirHockeyPreview';
import { AirHockeyResults } from './AirHockeyResults';
import { arcadeEntryRefusalMessage } from '@/arcade/tokens/entry-copy';
import { ArcadeStartButton } from '../ArcadeStartButton';
import {
  FREE_ARCADE_GAME_ENTRY,
  type ArcadeGameEntry,
} from '@/arcade/tokens/game-entry';

/**
 * Air Hockey: the controller that joins the game to the shared arcade.
 *
 * The same shape as `DanceMachine`, deliberately: it is the pattern a dedicated
 * arcade machine follows, and Pool should be the third file that looks like
 * this. What a controller owns is the WIRING, and nothing the pieces around it
 * already own: the lifecycle lives in `ArcadeRoom`'s reducer, the rules live in
 * `src/arcade/hockey/`, and the frame is `ArcadeGameShell`.
 *
 * ## The rules the wiring enforces
 *
 *  - **A run id is minted exactly once, by the caller of `start`.** The reducer
 *    is pure and refuses to overwrite one; this is the only place one is made,
 *    and it is also the match's simulation SEED, so a run is reproducible.
 *  - **Difficulty is fixed when the run starts.** It is part of the request and
 *    is echoed into the result; letting it change mid-match would make the
 *    result describe a match that did not happen.
 *  - **The audio engine is built inside the Start click.** An `AudioContext`
 *    constructed outside a user gesture starts suspended and silently produces
 *    nothing. Unlike Blobbi Dance, a failure to build one does NOT refuse the
 *    run: this game keeps time from its own fixed-step loop, so silence costs
 *    feedback and nothing else.
 *  - **Replay is a new run.** New id, new seed, cleared result.
 *  - **The controller built the engine, so the controller disposes it.**
 *
 * ## Rewards
 *
 * `HOCKEY_REWARD_POLICY` is active and the catalogue says `grantsTickets:
 * true`, so this controller carries the same claim wiring as `DanceMachine`,
 * the shared `useArcadeRewardController`, which prices the finished
 * {@link ArcadeGameResult} and drives the exactly-once claim through
 * `useArcadeReward`. Nothing about the simulation or the result shape changed
 * to enable it; the result built in `hockey-result.ts` was the join point all
 * along.
 */

export interface AirHockeyMachineProps {
  /** The table this run happens on. Recorded in the result. */
  readonly machineId: string;
  /** Canonical game id, from the catalogue. Never derived from the machine. */
  readonly gameId: string;
  /** The game's name, from the catalogue. Titles the shell. */
  readonly title: string;
  readonly lifecycle: ArcadeMachineState;
  readonly dispatch: (event: ArcadeEvent) => void;
  /** Leave the game. Where that lands is the navigation model's decision. */
  readonly onExit: () => void;
  readonly exitLabel: string;
  readonly exitAriaLabel: string;
  /**
   * The turnstile that charges for a run. Injected, like the reward writer:
   * a machine rendered without one plays free, which is the safe default,
   * charging by omission would be taking money nobody wired up.
   */
  readonly entry?: ArcadeGameEntry;
  /** Overridable for the DEV harness and tests. */
  readonly audioFactory?: HockeyAudioFactory;
  /** Substitute reward writer. Production passes nothing. */
  readonly rewardWriter?: ArcadeRewardWriter;
  /** Goals needed to win. Injectable so a test need not play a whole match. */
  readonly targetGoals?: number;
  /** Build the match. Injectable for tests; production seeds it from the run id. */
  readonly createMatchState?: () => HockeyMatchState;
  readonly mintRunId?: () => string;
  /** Epoch clock, injectable so a test can assert exact result timestamps. */
  readonly now?: () => number;
  /** DEV harness only: show the raw arcade result on the results panel. */
  readonly showDebugDetails?: boolean;
  /**
   * Force the expanded (whole-screen) presentation on or off.
   *
   * Production leaves it undefined and the answer comes from `useImmersive`,
   * the app's existing feature-based test for a touch-first handheld, the same
   * one `BlobbiAppShell` uses to decide whether the world fills the screen.
   * Overridable only so a test can render either presentation deterministically.
   */
  readonly forceExpanded?: boolean;
}

/** Unique per run. `crypto.randomUUID` where it exists; a counter where it does not. */
let runCounter = 0;
function defaultMintRunId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `hockey-${uuid}`;
  runCounter += 1;
  return `hockey-${Date.now()}-${runCounter}`;
}

const ABORT_COPY: Record<string, string> = {
  closed: 'That match ended when you left the table.',
  quit: 'That match ended early.',
  interrupted: 'That match could not continue.',
  error: 'That match could not continue.',
};

export function AirHockeyMachine({
  machineId,
  gameId,
  title,
  lifecycle,
  dispatch,
  onExit,
  exitLabel,
  exitAriaLabel,
  audioFactory = createHockeyAudio,
  rewardWriter,
  targetGoals = MATCH_GOAL_TARGET,
  createMatchState,
  mintRunId = defaultMintRunId,
  entry = FREE_ARCADE_GAME_ENTRY,
  now = Date.now,
  showDebugDetails = false,
  forceExpanded,
}: AirHockeyMachineProps) {
  const reducedMotion = useReducedMotion();
  const immersive = useImmersive();
  const reward = useArcadeRewardController({ lifecycle, dispatch, writer: rewardWriter });

  const [difficulty, setDifficulty] = useState<HockeyDifficulty>(DEFAULT_HOCKEY_DIFFICULTY);
  const [abortNotice, setAbortNotice] = useState<string | null>(null);
  /**
   * The table layout the player explicitly asked for, or `null` to follow the
   * shape of the box.
   *
   * It lives HERE rather than in the table so that it survives a replay, the
   * table unmounts between runs, and it starts as `null` so a device that is
   * rotated re-answers the question instead of being stuck with an answer given
   * in the other orientation.
   */
  const [manualOrientation, setManualOrientation] = useState<HockeyOrientation | null>(null);

  /**
   * The engine for the current run.
   *
   * Held in a ref as well as in state: the ref is what the cleanup and the mute
   * toggle read (they must see the latest engine without waiting for a render),
   * and the state is what the table renders with.
   */
  const engineRef = useRef<HockeyAudioEngine | null>(null);
  const [engine, setEngine] = useState<HockeyAudioEngine | null>(null);

  /** The persisted arcade mute setting, mirrored into React so a control can render it. */
  const [muted, setMuted] = useState<boolean>(() => isArcadeMuted());
  /**
   * The authoritative value, so a second click in the same tick cannot read a
   * stale `muted` out of a closure. A state updater must be pure; a ref is the
   * honest place for the value the side effects need.
   */
  const mutedRef = useRef(muted);

  const handleToggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    setArcadeMuted(next);
    engineRef.current?.setMuted(next);
  }, []);

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
   * Never refuses the run. Air Hockey's clock is its own loop, so a browser with
   * no Web Audio gets a silent match rather than no match, which is the
   * opposite of Blobbi Dance, and correct for the opposite reason.
   */
  const prepareEngine = useCallback((): HockeyAudioEngine => {
    engineRef.current?.dispose();
    const created = audioFactory();
    created.setMuted(mutedRef.current);
    engineRef.current = created;
    setEngine(created);
    return created;
  }, [audioFactory]);

  /**
   * The commitment boundary: a Token is charged here and nowhere earlier.
   * Opening the table, picking a difficulty and backing out are all free.
   */
  const beginRun = useCallback(
    (kind: 'start' | 'replay') => {
      setAbortNotice(null);
      prepareEngine();

      // A free run, or one a Pass waives, starts on this tick, with no
      // write and no await.
      if (entry.admitFree(gameId)) {
        dispatch({ type: kind, runId: mintRunId(), difficulty });
        return;
      }

      void (async () => {
        const admitted = await entry.admit(gameId);
        if (!admitted.ok) {
          setAbortNotice(arcadeEntryRefusalMessage(admitted));
          return;
        }
        dispatch({ type: kind, runId: mintRunId(), difficulty });
      })();
    },
    [dispatch, difficulty, prepareEngine, entry, gameId, mintRunId],
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

  /**
   * The results panel reads the LIFECYCLE's result, not a copy kept here.
   *
   * There is exactly one result per run and the reducer owns it; deriving the
   * display from it means the panel cannot drift out of step with the run it
   * claims to describe.
   */
  const summary = useMemo(() => (result ? summaryFromResult(result) : null), [result]);

  const playing = status === 'countdown' || status === 'playing' || status === 'paused';
  const showResults = status === 'results' || status === 'claiming' || status === 'rewarded';

  /**
   * The expanded presentation: the whole screen, and only what a match needs.
   *
   * Deliberately scoped to a LIVE run. The start panel, the difficulty picker
   * and the results all want to be readable panels; only gameplay wants every
   * pixel. And it is deliberately not a second modal, a second route or a
   * second lifecycle: the same shell, told to stop insetting itself, and the
   * same table, told to drop its chrome. `BlobbiFrame` already makes the stage
   * fill the screen on a handheld, so filling the stage is filling the screen.
   */
  const expanded = (forceExpanded ?? immersive) && playing;

  let content: ReactNode;
  if (playing && engine) {
    content = (
      <AirHockeyTable
        machineId={machineId}
        gameId={gameId}
        difficulty={difficulty}
        status={status}
        runId={lifecycle.runId}
        targetGoals={targetGoals}
        reducedMotion={reducedMotion}
        onCountdownComplete={() => dispatch({ type: 'countdown-complete' })}
        onFinish={handleFinish}
        onAbort={handleAbort}
        onPause={() => dispatch({ type: 'pause' })}
        audio={engine}
        muted={muted}
        onToggleMute={handleToggleMute}
        now={now}
        createMatchState={createMatchState}
        manualOrientation={manualOrientation}
        onChooseOrientation={setManualOrientation}
        expanded={expanded}
      />
    );
  } else if (showResults && result && summary) {
    content = (
      <AirHockeyResults
        summary={summary}
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
      <AirHockeyPreview
        difficulty={difficulty}
        onSelectDifficulty={setDifficulty}
        abortNotice={status === 'aborted' ? abortNotice : null}
        muted={muted}
        onToggleMute={handleToggleMute}
      />
    );
  }

  /**
   * The footer holds exactly ONE action: the thing the player came for.
   *
   * The header's dismiss control already says where leaving goes, so a second
   * quiet "Close" down here would be two differently-worded buttons with one
   * destination: the mistake Blobbi Dance's footer was corrected for.
   */
  const footer = playing ? null : (
    <ArcadeStartButton
      entry={entry}
      gameId={gameId}
      replay={status !== 'preview'}
      dataAttribute="data-hockey-start"
      dataValue={status === 'preview' ? 'first' : 'again'}
      onClick={status === 'preview' ? handleStart : handleReplay}
    />
  );

  return (
    <ArcadeGameShell
      open={status !== 'closed'}
      onClose={onExit}
      title={title}
      // The description is a line of prose under the title. In expanded play it
      // is a line of prose taking a strip of table, and the same two facts are
      // already on the scoreboard.
      description={
        expanded
          ? undefined
          : `First to ${targetGoals} · ${HOCKEY_AI_PROFILES[difficulty].label} opponent`
      }
      machineId={machineId}
      gameId={gameId}
      status={status}
      surface="game"
      closeLabel={playing ? 'Leave' : exitLabel}
      closeAriaLabel={playing ? `Leave ${title} and end this match` : exitAriaLabel}
      onPause={playing ? () => dispatch({ type: 'pause' }) : undefined}
      onResume={status === 'paused' ? () => dispatch({ type: 'resume' }) : undefined}
      footer={footer}
      /*
        Expanded play gives the shell the whole stage: no inset, no rounding, no
        border. `sm:` is where the shell adds them, so `sm:` is where they are
        taken back: one override, not a second layout.
      */
      className={expanded ? 'sm:inset-0 sm:rounded-none border-0' : undefined}
      /*
        A live match must not be able to scroll: a stray drag on a phone would
        take the table off screen mid-rally. Every other state keeps the shell's
        normal scrolling, because the start panel at 320 × 568 genuinely needs
        it.
      */
      contentClassName={
        expanded
          ? // Safe-area insets on all three free edges: a notched phone in
            // landscape puts a cutout down one side and a home indicator along
            // the bottom, and a table drawn under either is a table the player
            // cannot reach. The top edge is the shell's header, which is
            // already inside the safe area.
            'overflow-hidden pt-1.5 pl-[max(0.375rem,env(safe-area-inset-left))] ' +
            'pr-[max(0.375rem,env(safe-area-inset-right))] ' +
            'pb-[max(0.375rem,env(safe-area-inset-bottom))]'
          : playing
            ? 'overflow-hidden px-2 py-2 sm:px-4 sm:py-3'
            : undefined
      }
    >
      {content}
    </ArcadeGameShell>
  );
}
