/**
 * Treasure Hunt — the contained-game controller.
 *
 * The Beach counterpart of `AirHockeyMachine`: it owns the screen flow
 * (intro → searching → results), the round state (the PURE reducer's state —
 * there is no second copy of the game anywhere), the drift-resistant clock,
 * the interruption policy, the audio engine's lifecycle and the
 * exit-confirmation rule. It reuses `ArcadeGameShell` for containment —
 * portal into the stage overlay host, movement suppression, Escape, focus
 * restore, mount-only-while-open — behind Beach-specific props rather than a
 * copied shell. The game is deliberately NOT an arcade machine: it launches
 * from the Beach shack and never touches the arcade registry.
 *
 * ## Clock
 *
 * `useFixedStepLoop` at 10 steps/s feeding `advance-time` deltas into the
 * reducer. No `setInterval` (drifts; cheats in background tabs) and no
 * physics — the fixed step is used purely as a pause-safe, catch-up-capped
 * tick source. The loop's `active` flag is the single gate: paused, exit
 * dialog, finished round, closed shell — each stops ticking by construction.
 *
 * ## Interruption
 *
 * Air Hockey's policy: PAUSE on both `hidden` and `blur` (there is no
 * external audio clock to desync, so Dance's abort-on-hidden is unnecessary),
 * and never auto-resume.
 *
 * ## Exit rule
 *
 * Before the round starts: close immediately. Mid-round: first close request
 * pauses and asks ("the current hunt will be abandoned"); confirming leaves
 * and discards the local round. After results: close immediately. Escape
 * follows the same path — the shell's onClose is this component's
 * `requestClose`, so the first Escape raises the confirmation and a second
 * one confirms it.
 *
 * ## What this file never does
 *
 * No Coins, no inventory, no Nostr, no signer. The round ends in a pure
 * `TreasureHuntResult` rendered by the results screen, and closing throws it
 * away — rewards are Beach 2, behind a boundary that does not exist yet.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArcadeGameShell } from '../arcade/ArcadeGameShell';
import { useFixedStepLoop } from '@/arcade/useFixedStepLoop';
import { useArcadeInterruption } from '@/arcade/useArcadeInterruption';
import { useImmersive } from '@/hooks/useImmersive';
import { isArcadeMuted, setArcadeMuted } from '@/arcade/audio/arcade-audio';
import type { ArcadeStatus } from '@/arcade/arcade-machine-state';
import {
  buildTreasureHuntResult,
  createTreasureHuntRound,
  evaluateDetectorSignal,
  treasureHuntReducer,
  type Point,
  type TreasureHuntPolicy,
  type TreasureHuntRound,
} from '@/beach/treasure-hunt';
import { cn } from '@/lib/utils';
import { TREASURE_HUNT_UI_POLICY } from './treasure-hunt-config';
import { createDetectorAudio, type DetectorAudioFactory } from './detector-audio';
import { TreasureHuntGame, type TreasureHuntDevOverlays, type TreasureTool } from './TreasureHuntGame';
import { TreasureHuntIntro } from './TreasureHuntIntro';
import { TreasureHuntResults } from './TreasureHuntResults';

type TreasureScreen = 'intro' | 'playing' | 'results';

/** Dev-harness hooks. Production callers pass none of this. */
export interface TreasureHuntDevOptions {
  seed?: string;
  policy?: TreasureHuntPolicy;
  overlays?: TreasureHuntDevOverlays;
  audioFactory?: DetectorAudioFactory;
  forceReducedMotion?: boolean;
}

interface TreasureHuntModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * LOCAL-ONLY actor suppression while a hunt is actually running (searching
   * or results — not the intro, where the Island is still the scene). This is
   * a presentation callback and must never be wired to the published hidden
   * pose; see the presence note in `PlayingView`.
   */
  onActorSuppressionChange?: (suppressed: boolean) => void;
  dev?: TreasureHuntDevOptions;
}

const SHELL_STATUS: Record<TreasureScreen, ArcadeStatus> = {
  intro: 'preview',
  playing: 'playing',
  results: 'results',
};

export function TreasureHuntModal({ open, onClose, onActorSuppressionChange, dev }: TreasureHuntModalProps) {
  const [screen, setScreen] = useState<TreasureScreen>('intro');
  const [round, setRound] = useState<TreasureHuntRound | null>(null);
  const [paused, setPaused] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [tool, setToolState] = useState<TreasureTool>('detector');
  const [muted, setMuted] = useState(() => isArcadeMuted());
  const [startError, setStartError] = useState<string | null>(null);

  const engineRef = useRef<ReturnType<DetectorAudioFactory> | null>(null);
  const roundRef = useRef<TreasureHuntRound | null>(null);
  roundRef.current = round;
  const toolRef = useRef<TreasureTool>('detector');
  const immersive = useImmersive();

  const setTool = useCallback((next: TreasureTool) => {
    toolRef.current = next;
    setToolState(next);
  }, []);

  const disposeAudio = useCallback(() => {
    engineRef.current?.dispose();
    engineRef.current = null;
  }, []);

  const resetLocalState = useCallback(() => {
    disposeAudio();
    setScreen('intro');
    setRound(null);
    setPaused(false);
    setConfirmExit(false);
    setTool('detector');
    setStartError(null);
  }, [disposeAudio, setTool]);

  // Closing the shell (or unmounting mid-run) must silence and forget
  // everything: no beep may outlive a closed shell.
  useEffect(() => {
    if (!open) resetLocalState();
  }, [open, resetLocalState]);
  useEffect(() => () => engineRef.current?.dispose(), []);

  // The actor stays visible while approaching and through the intro; it is
  // suppressed only while a hunt is actually on screen (playing/results) and
  // restored on close, abort, results exit and unmount — all of which either
  // flip `open`/`screen` or unmount this component.
  const suppressActor = open && screen !== 'intro';
  const onSuppressRef = useRef(onActorSuppressionChange);
  onSuppressRef.current = onActorSuppressionChange;
  useEffect(() => {
    onSuppressRef.current?.(suppressActor);
  }, [suppressActor]);
  useEffect(() => () => onSuppressRef.current?.(false), []);

  const handleStart = useCallback(() => {
    const seed =
      dev?.seed ??
      `beach-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    const created = createTreasureHuntRound({
      seed,
      policy: dev?.policy ?? TREASURE_HUNT_UI_POLICY,
    });
    if (!created.ok) {
      setStartError('The tide scrambled this hunt — please try starting again.');
      return;
    }
    // The audio engine is built INSIDE this click so the AudioContext unlocks.
    disposeAudio();
    const factory = dev?.audioFactory ?? createDetectorAudio;
    engineRef.current = factory();
    engineRef.current.setMuted(muted);

    setStartError(null);
    setRound(treasureHuntReducer(created.round, { type: 'start' }));
    setTool('detector');
    setPaused(false);
    setConfirmExit(false);
    setScreen('playing');
  }, [dev, disposeAudio, muted, setTool]);

  const searching = open && screen === 'playing' && round?.status === 'searching';
  const ticking = Boolean(searching && !paused && !confirmExit);

  useFixedStepLoop({
    active: ticking,
    stepMs: 100,
    onStep: (dt) => {
      setRound((current) =>
        current ? treasureHuntReducer(current, { type: 'advance-time', seconds: dt }) : current
      );
    },
    onRender: () => {
      const current = roundRef.current;
      if (!current || current.status !== 'searching') return;
      // The detector only speaks while it is the ACTIVE tool: selecting the
      // shovel silences current and future beeps immediately (beeps are
      // one-shot nodes, so gating the feed is a full silence — no timers to
      // cancel), and re-selecting the detector resumes from the live signal
      // without any new engine or timer being created.
      if (toolRef.current !== 'detector') return;
      const signal = evaluateDetectorSignal(
        current.coilPosition,
        current.targets,
        current.policy
      );
      engineRef.current?.update(signal.intensity);
    },
  });

  useArcadeInterruption({
    active: ticking,
    onInterrupt: () => setPaused(true),
  });

  // A finished round moves to results exactly once, whatever ended it.
  useEffect(() => {
    if (screen === 'playing' && round?.status === 'finished') {
      engineRef.current?.finish(round.foundTargetIds.length);
      setScreen('results');
      setPaused(false);
      setConfirmExit(false);
    }
  }, [round, screen]);

  const handleMoveDetector = useCallback((position: Point) => {
    setRound((current) =>
      current ? treasureHuntReducer(current, { type: 'move-detector', position }) : current
    );
  }, []);

  const handleDig = useCallback((position: Point) => {
    setRound((current) => {
      if (!current) return current;
      const next = treasureHuntReducer(current, { type: 'dig', position });
      if (next !== current) {
        const record = next.digHistory[next.digHistory.length - 1];
        engineRef.current?.dig(record.outcome === 'hit');
      }
      return next;
    });
  }, []);

  const handleToggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      setArcadeMuted(next);
      engineRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const reallyClose = useCallback(() => {
    resetLocalState();
    onClose();
  }, [onClose, resetLocalState]);

  const requestClose = useCallback(() => {
    if (searching && !confirmExit) {
      setPaused(true);
      setConfirmExit(true);
      return;
    }
    reallyClose();
  }, [searching, confirmExit, reallyClose]);

  const result =
    screen === 'results' && round?.status === 'finished'
      ? buildTreasureHuntResult(round)
      : null;

  const expanded = immersive && screen === 'playing';

  return (
    <ArcadeGameShell
      open={open}
      onClose={requestClose}
      title="Beach Treasure Hunt"
      description={screen === 'intro' ? 'A metal-detector hunt on the sand' : undefined}
      machineId="beach-treasure-hunt"
      gameId="treasure-hunt"
      surface="game"
      status={paused && screen === 'playing' ? 'paused' : SHELL_STATUS[screen]}
      closeLabel={
        screen === 'playing' ? 'Leave' : screen === 'results' ? 'Return to Beach' : 'Close'
      }
      onPause={screen === 'playing' && !paused ? () => setPaused(true) : undefined}
      onResume={
        screen === 'playing' && paused && !confirmExit ? () => setPaused(false) : undefined
      }
      className={cn(expanded && 'sm:inset-0 sm:rounded-none')}
      contentClassName={
        screen === 'playing'
          ? 'overflow-hidden p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]'
          : undefined
      }
    >
      {screen === 'intro' && (
        <TreasureHuntIntro onStart={handleStart} startError={startError} />
      )}

      {screen === 'playing' && round && (
        <div className="relative h-full min-h-0">
          <TreasureHuntGame
            round={round}
            paused={paused}
            tool={tool}
            onToolChange={setTool}
            onMoveDetector={handleMoveDetector}
            onDig={handleDig}
            muted={muted}
            onToggleMuted={handleToggleMuted}
            reducedMotionOverride={dev?.forceReducedMotion}
            devOverlays={dev?.overlays}
          />

          {confirmExit && (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 p-4"
              role="alertdialog"
              aria-labelledby="treasure-exit-heading"
              data-treasure-confirm-exit
            >
              <div className="max-w-sm space-y-3 rounded-2xl bg-white p-5 text-center shadow-xl">
                <h3 id="treasure-exit-heading" className="text-lg font-bold text-island-ink">
                  Leave the hunt?
                </h3>
                <p className="text-sm text-island-ink">
                  The current hunt will be abandoned.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full min-h-[44px]"
                    onClick={() => {
                      setConfirmExit(false);
                      setPaused(false);
                    }}
                    data-treasure-keep-digging
                  >
                    Keep Digging
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="rounded-full min-h-[44px]"
                    onClick={reallyClose}
                    data-treasure-leave
                  >
                    Leave Hunt
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {screen === 'results' && result && (
        <TreasureHuntResults
          result={result}
          onReturnToBeach={reallyClose}
          onPlayAgain={handleStart}
        />
      )}
    </ArcadeGameShell>
  );
}
