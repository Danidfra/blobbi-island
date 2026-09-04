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
  DEFAULT_POOL_DIFFICULTY,
  POOL_AI_PROFILES,
  type PoolDifficulty,
} from '@/arcade/pool/ai';
import type { PoolMatchState } from '@/arcade/pool/match';
import { poolSummaryFromResult } from '@/arcade/pool/pool-result';
import type { PoolAudioEngine, PoolAudioFactory } from '@/arcade/pool/pool-audio';
import { createPoolAudio } from '@/arcade/pool/pool-audio';

import { ArcadeGameShell } from '../ArcadeGameShell';
import { PoolTable } from './PoolTable';
import { PoolPreview } from './PoolPreview';
import { PoolResults } from './PoolResults';
import { arcadeEntryRefusalMessage } from '@/arcade/tokens/entry-copy';
import { ArcadeStartButton } from '../ArcadeStartButton';
import {
  FREE_ARCADE_GAME_ENTRY,
  type ArcadeGameEntry,
} from '@/arcade/tokens/game-entry';

/**
 * Pool — the controller that joins the game to the shared arcade.
 *
 * The **third** file with this shape, after `DanceMachine` and
 * `AirHockeyMachine`, and that is the point rather than an accident:
 * `docs/blobbi-air-hockey.md` §2 wrote the dedicated-machine pattern down and
 * said Pool should be the next thing that looks like it. What a controller owns
 * is the WIRING, and nothing the pieces around it already own — the lifecycle
 * lives in `ArcadeRoom`'s reducer, the rules live in `src/arcade/pool/`, and the
 * frame is `ArcadeGameShell`.
 *
 * ## The rules the wiring enforces
 *
 *  - **A run id is minted exactly once, by the caller of `start`.** The reducer
 *    is pure and refuses to overwrite one; this is the only place one is made,
 *    and it is also the match's SEED — the rack and the rival's decisions both
 *    come from it — so a run is reproducible.
 *  - **Difficulty is fixed when the run starts.** It is part of the request and
 *    is echoed into the result; letting it change mid-frame would make the
 *    result describe a match that did not happen.
 *  - **The audio engine is built inside the Start click.** An `AudioContext`
 *    constructed outside a user gesture starts suspended and silently produces
 *    nothing. As in Air Hockey, a failure to build one does NOT refuse the run:
 *    this game keeps time from its own fixed-step loop, so silence costs
 *    feedback and nothing else.
 *  - **Replay is a new run.** New id, new seed, new rack, cleared result.
 *  - **The controller built the engine, so the controller disposes it.**
 *
 * ## Rewards
 *
 * `POOL_REWARD_POLICY` is active and the catalogue says `grantsTickets: true`,
 * so this controller carries the same claim wiring as `DanceMachine` and
 * `AirHockeyMachine` — the shared `useArcadeRewardController`, which prices the
 * finished {@link ArcadeGameResult} and drives the exactly-once claim through
 * `useArcadeReward`. Nothing about the simulation or the result shape changed
 * to enable it; the result built in `pool-result.ts` was the join point all
 * along.
 */

export interface PoolMachineProps {
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
   * a machine rendered without one plays free, which is the safe default —
   * charging by omission would be taking money nobody wired up.
   */
  readonly entry?: ArcadeGameEntry;
  /** Overridable for the DEV harness and tests. */
  readonly audioFactory?: PoolAudioFactory;
  /** Substitute reward writer. Production passes nothing. */
  readonly rewardWriter?: ArcadeRewardWriter;
  /** Build the match. Injectable for tests; production seeds it from the run id. */
  readonly createMatchState?: () => PoolMatchState;
  readonly mintRunId?: () => string;
  /** Epoch clock, injectable so a test can assert exact result timestamps. */
  readonly now?: () => number;
  /** DEV harness only: show the raw arcade result on the results panel. */
  readonly showDebugDetails?: boolean;
  /**
   * Force the expanded (whole-screen) presentation on or off.
   *
   * Production leaves it undefined and the answer comes from `useImmersive`, the
   * app's existing feature-based test for a touch-first handheld — the same one
   * `BlobbiAppShell` uses to decide whether the world fills the screen.
   * Overridable only so a test can render either presentation deterministically.
   */
  readonly forceExpanded?: boolean;
}

/** Unique per run. `crypto.randomUUID` where it exists; a counter where it does not. */
let runCounter = 0;
function defaultMintRunId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `pool-${uuid}`;
  runCounter += 1;
  return `pool-${Date.now()}-${runCounter}`;
}

const ABORT_COPY: Record<string, string> = {
  closed: 'That frame ended when you left the table.',
  quit: 'That frame ended early.',
  interrupted: 'That frame could not continue.',
  error: 'That frame could not continue.',
};

export function PoolMachine({
  machineId,
  gameId,
  title,
  lifecycle,
  dispatch,
  onExit,
  exitLabel,
  exitAriaLabel,
  audioFactory = createPoolAudio,
  rewardWriter,
  createMatchState,
  mintRunId = defaultMintRunId,
  entry = FREE_ARCADE_GAME_ENTRY,
  now = Date.now,
  showDebugDetails = false,
  forceExpanded,
}: PoolMachineProps) {
  const reducedMotion = useReducedMotion();
  const immersive = useImmersive();
  const reward = useArcadeRewardController({ lifecycle, dispatch, writer: rewardWriter });

  const [difficulty, setDifficulty] = useState<PoolDifficulty>(DEFAULT_POOL_DIFFICULTY);
  const [abortNotice, setAbortNotice] = useState<string | null>(null);

  /**
   * The engine for the current run.
   *
   * Held in a ref as well as in state: the ref is what the cleanup and the mute
   * toggle read (they must see the latest engine without waiting for a render),
   * and the state is what the table renders with.
   */
  const engineRef = useRef<PoolAudioEngine | null>(null);
  const [engine, setEngine] = useState<PoolAudioEngine | null>(null);

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
   * Never refuses the run. Pool's clock is its own loop, so a browser with no
   * Web Audio gets a silent frame rather than no frame.
   */
  const prepareEngine = useCallback((): PoolAudioEngine => {
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

      // A free run — or one a Pass waives — starts on this tick, with no
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
  const summary = useMemo(() => (result ? poolSummaryFromResult(result) : null), [result]);

  const playing = status === 'countdown' || status === 'playing' || status === 'paused';
  const showResults = status === 'results' || status === 'claiming' || status === 'rewarded';

  /**
   * The expanded presentation: the whole screen, and only what a frame needs.
   *
   * Deliberately scoped to a LIVE run. The start panel, the rival picker and the
   * results all want to be readable panels; only gameplay wants every pixel. And
   * it is deliberately not a second modal, a second route or a second lifecycle
   * — the same shell, told to stop insetting itself, and the same table, told to
   * drop its chrome. `BlobbiFrame` already makes the stage fill the screen on a
   * handheld, so filling the stage is filling the screen.
   */
  const expanded = (forceExpanded ?? immersive) && playing;

  let content: ReactNode;
  if (playing && engine) {
    content = (
      <PoolTable
        machineId={machineId}
        gameId={gameId}
        difficulty={difficulty}
        status={status}
        runId={lifecycle.runId}
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
        expanded={expanded}
      />
    );
  } else if (showResults && result && summary) {
    content = (
      <PoolResults
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
      <PoolPreview
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
   * destination.
   */
  const footer = playing ? null : (
    <ArcadeStartButton
      entry={entry}
      gameId={gameId}
      replay={status !== 'preview'}
      dataAttribute="data-pool-start"
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
      // is a line of prose taking a strip of table, and the same facts are
      // already on the scoreboard.
      description={
        expanded ? undefined : `8-ball · ${POOL_AI_PROFILES[difficulty].label} rival`
      }
      machineId={machineId}
      gameId={gameId}
      status={status}
      surface="game"
      closeLabel={playing ? 'Leave' : exitLabel}
      closeAriaLabel={playing ? `Leave ${title} and end this frame` : exitAriaLabel}
      onPause={playing ? () => dispatch({ type: 'pause' }) : undefined}
      onResume={status === 'paused' ? () => dispatch({ type: 'resume' }) : undefined}
      footer={footer}
      /*
        Expanded play gives the shell the whole stage: no inset, no rounding, no
        border. `sm:` is where the shell adds them, so `sm:` is where they are
        taken back — one override, not a second layout.
      */
      className={expanded ? 'sm:inset-0 sm:rounded-none border-0' : undefined}
      /*
        A live frame must not be able to scroll: a stray drag on a phone would
        take the table off screen mid-shot. Every other state keeps the shell's
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
