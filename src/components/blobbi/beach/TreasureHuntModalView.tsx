/**
 * Treasure Hunt — the contained-game controller (VIEW layer).
 *
 * Split from the production wrapper (`TreasureHuntModal.tsx`) so this module
 * imports NO wallet, ledger or relay code: the reward service arrives as a
 * prop (type-only import), which is what lets the dev harness and the tests
 * drive the full flow with an in-memory fake — and lets the harness's
 * no-write-path boundary test hold by import graph, not by promise.
 *
 * The Beach counterpart of `AirHockeyMachine`: it owns the screen flow
 * (intro → searching → results), the round state (the PURE reducer's state —
 * there is no second copy of the game anywhere), the drift-resistant clock,
 * the interruption policy, the audio engine's lifecycle, the
 * exit-confirmation rule — and, since the Coin cutover, the REWARD lifecycle
 * around a hunt:
 *
 * ```
 *   Start (slots left?) ──reserve slot+opId──► rewarded hunt
 *        │ no                                       │ finished legitimately
 *        ▼                                          ▼
 *   practice hunt                    authorize (provisional) ──► wallet grant
 *                                                   │
 *                       abandoned mid-round ──► slot consumed/released per policy
 * ```
 *
 * The reward machinery is consumed through {@link TreasureHuntRewardsService}
 * so the production wrapper injects the real hook while tests and the dev
 * harness inject a fully mocked service — the view never talks to a relay,
 * a ledger or a wallet directly.
 *
 * ## Trust model (repeated here on purpose)
 *
 * Rewards are PROVISIONAL and client-trusted: the official client authorizes
 * them locally and publishes the grant itself. Reservations, op ids and the
 * durable ledgers give exactly-once application and refresh-safety — not
 * cheat-proofing. See `docs/blobbi-coin-cutover.md`.
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
import type { TreasureHuntCoinReward } from '@/beach/rewards/coin-reward';
import type { TreasureHuntRewardsService } from '@/hooks/useTreasureHuntRewards';
import { cn } from '@/lib/utils';
import { TREASURE_HUNT_UI_POLICY } from './treasure-hunt-config';
import { createDetectorAudio, type DetectorAudioFactory } from './detector-audio';
import { TreasureHuntGame, type TreasureHuntDevOverlays, type TreasureTool } from './TreasureHuntGame';
import { TreasureHuntIntro, type TreasureHuntIntroMode } from './TreasureHuntIntro';
import { TreasureHuntResults } from './TreasureHuntResults';

type TreasureScreen = 'intro' | 'playing' | 'results';

/** What the results screen knows about this round's reward. */
export type TreasureHuntRewardView =
  | { phase: 'practice' }
  | { phase: 'authorizing' }
  | { phase: 'applied'; reward: TreasureHuntCoinReward; alreadyApplied: boolean }
  | { phase: 'ambiguous'; reward: TreasureHuntCoinReward }
  | { phase: 'failed'; reward: TreasureHuntCoinReward; message: string }
  | { phase: 'ineligible'; reason: string };

/** Dev-harness hooks. Production callers pass none of this. */
export interface TreasureHuntDevOptions {
  seed?: string;
  policy?: TreasureHuntPolicy;
  overlays?: TreasureHuntDevOverlays;
  audioFactory?: DetectorAudioFactory;
  forceReducedMotion?: boolean;
}

interface TreasureHuntModalBaseProps {
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

interface TreasureHuntModalViewProps extends TreasureHuntModalBaseProps {
  rewards: TreasureHuntRewardsService;
}

const SHELL_STATUS: Record<TreasureScreen, ArcadeStatus> = {
  intro: 'preview',
  playing: 'playing',
  results: 'results',
};

/** View layer, service-injected. Tests and the dev harness use this export. */
export function TreasureHuntModalView({
  open,
  onClose,
  onActorSuppressionChange,
  rewards,
  dev,
}: TreasureHuntModalViewProps) {
  const [screen, setScreen] = useState<TreasureScreen>('intro');
  const [round, setRound] = useState<TreasureHuntRound | null>(null);
  const [paused, setPaused] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [tool, setToolState] = useState<TreasureTool>('detector');
  const [muted, setMuted] = useState(() => isArcadeMuted());
  const [startError, setStartError] = useState<string | null>(null);
  const [rewardView, setRewardView] = useState<TreasureHuntRewardView>({ phase: 'practice' });

  const engineRef = useRef<ReturnType<DetectorAudioFactory> | null>(null);
  const roundRef = useRef<TreasureHuntRound | null>(null);
  roundRef.current = round;
  const toolRef = useRef<TreasureTool>('detector');
  const rewardOpIdRef = useRef<string | null>(null);
  const rewardsRef = useRef(rewards);
  rewardsRef.current = rewards;
  const immersive = useImmersive();

  const setTool = useCallback((next: TreasureTool) => {
    toolRef.current = next;
    setToolState(next);
  }, []);

  const disposeAudio = useCallback(() => {
    engineRef.current?.dispose();
    engineRef.current = null;
  }, []);

  /**
   * Abandon a still-searching rewarded hunt: the slot is consumed or
   * released per the documented participation rule (the service decides).
   * Finished rounds are never abandoned — their reward intent must survive.
   */
  const abandonIfSearching = useCallback(() => {
    const current = roundRef.current;
    const opId = rewardOpIdRef.current;
    if (opId && current && current.status === 'searching') {
      rewardsRef.current.abandonHunt(opId, {
        digs: current.digHistory.length,
        activeSeconds: current.elapsedSeconds,
      });
    }
    rewardOpIdRef.current = null;
  }, []);

  const resetLocalState = useCallback(() => {
    abandonIfSearching();
    disposeAudio();
    setScreen('intro');
    setRound(null);
    setPaused(false);
    setConfirmExit(false);
    setTool('detector');
    setStartError(null);
    setRewardView({ phase: 'practice' });
  }, [abandonIfSearching, disposeAudio, setTool]);

  // Closing the shell (or unmounting mid-run) must silence and forget
  // everything: no beep — and no dangling reservation — may outlive it.
  useEffect(() => {
    if (!open) resetLocalState();
  }, [open, resetLocalState]);
  const abandonRef = useRef(abandonIfSearching);
  abandonRef.current = abandonIfSearching;
  useEffect(
    () => () => {
      abandonRef.current();
      engineRef.current?.dispose();
    },
    [],
  );

  // The actor stays visible while approaching and through the intro; it is
  // suppressed only while a hunt is actually on screen (playing/results) and
  // restored on close, abort, results exit and unmount.
  const suppressActor = open && screen !== 'intro';
  const onSuppressRef = useRef(onActorSuppressionChange);
  onSuppressRef.current = onActorSuppressionChange;
  useEffect(() => {
    onSuppressRef.current?.(suppressActor);
  }, [suppressActor]);
  useEffect(() => () => onSuppressRef.current?.(false), []);

  const rewardedAvailable =
    rewards.windowStatus !== null && rewards.windowStatus.remaining > 0;

  const handleStart = useCallback(async () => {
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
    // The audio engine is built INSIDE the click, BEFORE any await, so the
    // AudioContext unlock keeps its user-gesture context.
    disposeAudio();
    const factory = dev?.audioFactory ?? createDetectorAudio;
    engineRef.current = factory();
    engineRef.current.setMuted(muted);

    // Rewarded start: reserve one of the window's slots NOW (multi-tab safe),
    // so ten simultaneous tabs cannot all begin rewarded hunts. A refusal
    // demotes this hunt to practice, honestly.
    rewardOpIdRef.current = null;
    let nextRewardView: TreasureHuntRewardView = { phase: 'practice' };
    if (rewardedAvailable) {
      const reserved = await rewards.reserveRewardedHunt(created.round.roundId);
      if (reserved.ok) {
        rewardOpIdRef.current = reserved.opId;
        nextRewardView = { phase: 'authorizing' }; // pending until finalized
      }
    }

    setStartError(null);
    setRewardView(nextRewardView);
    setRound(treasureHuntReducer(created.round, { type: 'start' }));
    setTool('detector');
    setPaused(false);
    setConfirmExit(false);
    setScreen('playing');
  }, [dev, disposeAudio, muted, setTool, rewards, rewardedAvailable]);

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
      // shovel silences current and future beeps immediately.
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

  // Refresh-safe participation tracking: the ledger learns about digs and
  // active time as they happen, so a mid-round refresh can apply the
  // documented consumed-vs-released abandonment rule.
  const digCount = round?.digHistory.length ?? 0;
  const elapsedBucket = Math.floor((round?.elapsedSeconds ?? 0) / 5);
  useEffect(() => {
    const opId = rewardOpIdRef.current;
    const current = roundRef.current;
    if (!opId || !current || current.status !== 'searching') return;
    rewardsRef.current.reportParticipation(opId, {
      digs: current.digHistory.length,
      activeSeconds: current.elapsedSeconds,
    });
  }, [digCount, elapsedBucket]);

  // A finished round moves to results exactly once, whatever ended it — and
  // a rewarded round hands its finalized result to the (provisional)
  // authorization exactly once.
  useEffect(() => {
    if (screen === 'playing' && round?.status === 'finished') {
      engineRef.current?.finish(round.foundTargetIds.length);
      setScreen('results');
      setPaused(false);
      setConfirmExit(false);

      const opId = rewardOpIdRef.current;
      if (opId) {
        const result = buildTreasureHuntResult(round);
        setRewardView({ phase: 'authorizing' });
        rewardsRef.current.authorizeReward(result, opId).then((outcome) => {
          switch (outcome.status) {
            case 'applied':
              setRewardView({
                phase: 'applied',
                reward: outcome.reward,
                alreadyApplied: outcome.alreadyApplied,
              });
              break;
            case 'ambiguous':
              setRewardView({ phase: 'ambiguous', reward: outcome.reward });
              break;
            case 'failed':
              setRewardView({
                phase: 'failed',
                reward: outcome.reward,
                message: outcome.message,
              });
              break;
            case 'ineligible':
              setRewardView({ phase: 'ineligible', reason: outcome.reason });
              break;
            case 'no-reservation':
              setRewardView({ phase: 'practice' });
              break;
          }
        });
      } else {
        setRewardView({ phase: 'practice' });
      }
    }
  }, [round, screen]);

  const handleRetryReward = useCallback(() => {
    const opId = rewardOpIdRef.current;
    const current = roundRef.current;
    if (!opId || !current || current.status !== 'finished') return;
    const result = buildTreasureHuntResult(current);
    setRewardView({ phase: 'authorizing' });
    rewardsRef.current.authorizeReward(result, opId).then((outcome) => {
      if (outcome.status === 'applied') {
        setRewardView({
          phase: 'applied',
          reward: outcome.reward,
          alreadyApplied: outcome.alreadyApplied,
        });
      } else if (outcome.status === 'ambiguous') {
        setRewardView({ phase: 'ambiguous', reward: outcome.reward });
      } else if (outcome.status === 'failed') {
        setRewardView({ phase: 'failed', reward: outcome.reward, message: outcome.message });
      }
    });
  }, []);

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

  // Replay while a grant is unresolved for THIS round would race the
  // operation; a fresh hunt is a fresh op, but we still wait for a settled
  // outcome before offering it.
  const canReplay =
    rewardView.phase !== 'authorizing' && rewardView.phase !== 'ambiguous';

  const introMode: TreasureHuntIntroMode =
    rewards.windowStatus === null
      ? 'practice-only'
      : rewardedAvailable
        ? 'rewarded'
        : 'practice-limit';

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
        <TreasureHuntIntro
          mode={introMode}
          remaining={rewards.windowStatus?.remaining ?? 0}
          onStart={() => void handleStart()}
          startError={startError}
          pendingOps={rewards.pendingOps}
          onRecoverPending={(opId) => void rewards.recoverPendingReward(opId)}
        />
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
            rewarded={rewardOpIdRef.current !== null}
            reducedMotionOverride={dev?.forceReducedMotion}
            devOverlays={dev?.overlays}
          />

          {confirmExit && (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center bg-island-ink/50 p-4 backdrop-blur-[2px]"
              role="alertdialog"
              aria-labelledby="treasure-exit-heading"
              data-treasure-confirm-exit
            >
              {/* Deliberately NOT a BlobbiModal: this is an `alertdialog`
                  layered over a live minigame that is only paused, and routing
                  it through a portal would take it out of the treasure field's
                  own stacking context. The surface language is shared; the
                  mechanism stays local. */}
              <div className="max-w-sm space-y-3 rounded-frame border-2 border-island-wood/35 bg-island-cream p-5 text-center shadow-cozy-frame">
                <h3 id="treasure-exit-heading" className="text-lg font-bold text-island-ink">
                  Leave the hunt?
                </h3>
                <p className="text-sm text-island-ink-soft">
                  The current hunt will be abandoned
                  {rewardOpIdRef.current ? ' and no Coins will be earned for it' : ''}.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    type="button"
                    variant="soft"
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
          rewardView={rewardView}
          onRetryReward={handleRetryReward}
          onReturnToBeach={reallyClose}
          onPlayAgain={canReplay ? () => void handleStart() : undefined}
          playAgainLabel={introMode === 'rewarded' ? 'Hunt Again' : 'Practice Again'}
        />
      )}
    </ArcadeGameShell>
  );
}
