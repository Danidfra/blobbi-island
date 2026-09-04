import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { useArcadeInput } from '@/arcade/useArcadeInput';
import { useArcadeInterruption } from '@/arcade/useArcadeInterruption';
import type { ArcadeLane } from '@/arcade/arcade-input-map';
import type { ArcadeAbortReason, ArcadeStatus } from '@/arcade/arcade-machine-state';
import type { ArcadeGameResult } from '@/arcade/types';
import type { DanceChart, DanceNote } from '@/arcade/dance/chart';
import type { DanceTrack } from '@/arcade/dance/track';
import type { DanceAudioEngine } from '@/arcade/dance/dance-audio';
import type { DanceJudgment, DanceRunState } from '@/arcade/dance/judgment';
import {
  advanceDanceRun,
  applyDanceInput,
  createDanceRun,
  summariseDanceRun,
} from '@/arcade/dance/judgment';
import { buildDanceResult } from '@/arcade/dance/dance-result';
import { msPerBeat } from '@/arcade/dance/track';
import {
  COMBO_SCALE_CLASS,
  DANCE_LANE_VISUALS,
  JUDGMENT_FLASH_MS,
  JUDGMENT_READOUT_CLASS,
  RECEPTOR_SPARK_COUNT,
  comboTier,
  isNoteVisible,
  judgmentReadoutClass,
  noteProgress,
} from './dance-visuals';
import { DanceCabinet } from './DanceCabinet';
import { DanceMascot, type DanceMascotMood } from './DanceMascot';
import { DanceSoundToggle } from './DanceSoundToggle';

/**
 * Blobbi Dance: the playable surface.
 *
 * ## Render strategy
 *
 * A rhythm game updates sixty times a second. React state updated sixty times a
 * second re-renders a tree sixty times a second, and the input handler then
 * competes with reconciliation for the main thread, which shows up as exactly
 * the thing a rhythm game may not have: input lag.
 *
 * So this component splits its state by frequency:
 *
 * | what | where it lives | how often it changes |
 * | --- | --- | --- |
 * | song time | `AudioContext.currentTime`, read per frame | 60 Hz |
 * | note positions | `element.style.transform`, written per frame | 60 Hz |
 * | score, combo, progress, judgement | `textContent` / `style`, per frame | 60 Hz |
 * | which notes are ON SCREEN | React state | ~2 Hz, only when the set changes |
 * | lifecycle status | React state, owned by the caller's reducer | a few times a run |
 *
 * The run state itself lives in a ref and is advanced through the PURE reducer
 * functions in `judgment.ts`: so the rules stay pure and stay tested by passing
 * numbers, while the storage is a ref that no re-render depends on. Canvas was
 * considered and rejected: 110 notes with at most a dozen on screen is nowhere
 * near a DOM bottleneck, and a canvas would cost the focus outlines, the text
 * scaling and the screen-reader story that come free with elements.
 *
 * **Every decoration added in the polish pass obeys the same split.** A hit
 * pulses a receptor, flashes a lane, bumps a combo tier and changes the mascot's
 * mood by toggling ONE class or ONE attribute; CSS owns the tween from there. No
 * effect in this file spawns a DOM node, starts a second animation loop, or
 * queues a React render for something the compositor can do on its own.
 *
 * ## Timing
 *
 * Every judgement is made against `engine.songTimeMs()` sampled AT THE MOMENT
 * the input arrives; not against the last animation frame, which may be 16 ms
 * stale (a quarter of the Perfect window), and not against a frame counter.
 * `requestAnimationFrame` only decides when to draw; a dropped frame costs a
 * frame of animation and nothing else, because the next frame reads the true
 * song time.
 *
 * Nothing added for presentation touches any of that. Judgement windows, note
 * times, the audio origin and the run's result are exactly what they were.
 */

/** Where the run is, derived from the shared lifecycle status. */
type DancePhase = 'idle' | 'countdown' | 'playing' | 'paused' | 'ended';

export interface BlobbiDanceGameProps {
  readonly machineId: string;
  readonly gameId: string;
  readonly chart: DanceChart;
  readonly track: DanceTrack;
  /** The shared lifecycle status. This component never changes it directly. */
  readonly status: ArcadeStatus;
  readonly runId: string | null;
  readonly reducedMotion: boolean;
  /** The countdown reached the first beat. */
  readonly onCountdownComplete: () => void;
  /** The song ended. Exactly one result per run. */
  readonly onFinish: (result: ArcadeGameResult) => void;
  /** The run cannot continue. Never called with a result. */
  readonly onAbort: (reason: ArcadeAbortReason) => void;
  /** The run should freeze, the window lost focus. Recoverable. */
  readonly onPause: () => void;
  /**
   * The audio engine for THIS run, already built.
   *
   * Built by the controller inside the Start click rather than here in an
   * effect, because an `AudioContext` constructed outside a user gesture starts
   * suspended and silently produces nothing. Ownership follows: the controller
   * created it, so the controller disposes it.
   */
  readonly engine: DanceAudioEngine;
  /** The persisted arcade mute setting, owned by the controller. */
  readonly muted: boolean;
  readonly onToggleMute: () => void;
  /** Epoch clock, injectable so a test can assert exact result timestamps. */
  readonly now?: () => number;
}

/** Where each spark flies. Fixed offsets, so nothing is computed per hit. */
const SPARK_VECTORS = [
  { dx: '-16px', dy: '-18px' },
  { dx: '-7px', dy: '-24px' },
  { dx: '0px', dy: '-26px' },
  { dx: '7px', dy: '-24px' },
  { dx: '16px', dy: '-18px' },
].slice(0, RECEPTOR_SPARK_COUNT);

/** Judgement → how the Blobbi takes it. `okay` is still a hit, so still a nod. */
const MOOD_FOR_JUDGMENT: Readonly<Record<DanceJudgment, DanceMascotMood>> = {
  perfect: 'perfect',
  good: 'good',
  okay: 'good',
  miss: 'miss',
};

export function BlobbiDanceGame({
  machineId,
  gameId,
  chart,
  track,
  status,
  runId,
  reducedMotion,
  onCountdownComplete,
  onFinish,
  onAbort,
  onPause,
  engine,
  muted,
  onToggleMute,
  now = Date.now,
}: BlobbiDanceGameProps) {
  // ── High-frequency state, deliberately outside React ────────────────────
  const engineRef = useRef<DanceAudioEngine>(engine);
  engineRef.current = engine;
  /** Which run the engine has been started for, so a replay starts a new one. */
  const startedRunIdRef = useRef<string | null>(null);
  const runRef = useRef<DanceRunState>(createDanceRun(chart));
  const startedAtRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const flashAtRef = useRef<number | null>(null);

  const noteElementsRef = useRef(new Map<string, HTMLElement | null>());
  const receptorsRef = useRef(new Map<ArcadeLane, HTMLElement | null>());
  const laneFlashesRef = useRef(new Map<ArcadeLane, HTMLElement | null>());
  const scoreRef = useRef<HTMLSpanElement | null>(null);
  const comboScaleRef = useRef<HTMLDivElement | null>(null);
  const comboBumpRef = useRef<HTMLDivElement | null>(null);
  const comboValueRef = useRef<HTMLSpanElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const judgmentRef = useRef<HTMLParagraphElement | null>(null);
  const mascotRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const receptorRowRef = useRef<HTMLDivElement | null>(null);
  /**
   * How far a note travels from its spawn point to the judgement line, in
   * pixels.
   *
   * Measured to the receptors' CENTRE rather than to the field's bottom edge.
   * Using the field height, as this did before the polish pass, put a note's
   * top edge on the field's bottom edge at the moment it was due, which is a
   * receptor's height BELOW the receptor: notes were judged after they had
   * visually left the lane, and no note ever met the ring it was supposed to
   * land in. That is a drawing bug, not a timing one, and this is the whole fix:
   * `noteProgress` is untouched, every note is due at exactly the same
   * millisecond, and now the picture agrees with the clock.
   */
  const travelRef = useRef(0);
  /** The combo tier currently painted, so the class is not rewritten per frame. */
  const comboTierRef = useRef<string>('');
  /** Field emphasis classes currently applied, for the same reason. */
  const fieldEmphasisRef = useRef<string[]>([]);

  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  // ── Low-frequency state, in React ───────────────────────────────────────
  const [visibleIds, setVisibleIds] = useState<readonly string[]>([]);
  const [countdownBeat, setCountdownBeat] = useState<number | null>(null);
  /** Announced to assistive technology. Deliberately restrained. */
  const [liveMessage, setLiveMessage] = useState('');

  const notesById = useMemo(() => {
    const map = new Map<string, { note: DanceNote; index: number }>();
    chart.notes.forEach((note, index) => map.set(note.id, { note, index }));
    return map;
  }, [chart]);

  const beatMs = msPerBeat(track.bpm);

  // Callbacks are read through a ref so the animation loop never re-binds when a
  // parent re-renders with new inline functions.
  const callbacksRef = useRef({ onCountdownComplete, onFinish, onAbort, onPause });
  callbacksRef.current = { onCountdownComplete, onFinish, onAbort, onPause };

  /**
   * Measure the note travel distance.
   *
   * Runs on mount, on resize and when the phase changes; never inside the frame
   * loop. Reading layout sixty times a second is the classic way to make a
   * smooth game stutter; reading it when the box actually changes costs nothing.
   */
  const measureField = useCallback(() => {
    const field = fieldRef.current;
    if (!field) {
      travelRef.current = 0;
      return;
    }
    const fieldRect = field.getBoundingClientRect();
    const rowRect = receptorRowRef.current?.getBoundingClientRect();
    travelRef.current =
      rowRect && rowRect.height > 0
        ? rowRect.top + rowRect.height / 2 - fieldRect.top
        : fieldRect.height;
  }, []);

  useEffect(() => {
    measureField();
    if (typeof window === 'undefined') return;
    // `resize` covers what actually changes this box: a window resize, and a
    // mobile browser collapsing its URL bar (the shell is sized in `dvh`, so
    // that moves the field too). `orientationchange` is belt and braces for the
    // older mobile browsers that fire it before, or instead of, a resize.
    //
    // A `ResizeObserver` was considered and rejected: it would have to be
    // stubbed in every test environment, and the geometry here cannot change
    // without one of these two events. Nothing inside the game resizes the
    // field: the combo emphasis is a `ring` (a box-shadow, so no layout), the
    // countdown is absolutely positioned, and every row has an explicit
    // line-height, so even a late webfont swap leaves the box alone.
    window.addEventListener('resize', measureField);
    window.addEventListener('orientationchange', measureField);
    return () => {
      window.removeEventListener('resize', measureField);
      window.removeEventListener('orientationchange', measureField);
    };
  }, [measureField]);

  /** Replay a CSS animation that may already be on the element. */
  const restartAnimation = useCallback((element: HTMLElement | null, className: string) => {
    if (!element || reducedMotionRef.current) return;
    element.classList.remove(className);
    // One forced reflow per hit, a handful a second, never per frame, which is
    // the only way to restart a CSS animation that is already running.
    void element.offsetWidth;
    element.classList.add(className);
  }, []);

  /** Paint a judgement without touching React state. */
  const showJudgment = useCallback(
    (judgment: DanceJudgment, atSongTimeMs: number, lane?: ArcadeLane) => {
      flashAtRef.current = atSongTimeMs;

      const element = judgmentRef.current;
      if (element) {
        element.textContent = '';
        element.className = JUDGMENT_READOUT_CLASS;
        // Reset first, then reflow, so the pop replays even for two Perfects in
        // a row: otherwise an identical class list is a no-op to the browser.
        if (!reducedMotionRef.current) void element.offsetWidth;
        element.textContent =
          judgment === 'perfect'
            ? 'Perfect!'
            : judgment === 'good'
              ? 'Good'
              : judgment === 'okay'
                ? 'Okay'
                : 'Miss';
        element.className = judgmentReadoutClass(judgment, reducedMotionRef.current);
      }

      mascotRef.current?.setAttribute('data-mood', MOOD_FOR_JUDGMENT[judgment]);

      if (lane) {
        restartAnimation(laneFlashesRef.current.get(lane) ?? null, 'dance-lane-flash');
        // A missed note gets the lane flash but not the receptor pulse: the
        // pulse means "you hit this", and it must not appear for a note nobody
        // touched.
        if (judgment !== 'miss') {
          restartAnimation(receptorsRef.current.get(lane) ?? null, 'dance-receptor-pulse');
        }
      }
    },
    [restartAnimation],
  );

  // ── Engine lifetime ─────────────────────────────────────────────────────

  /**
   * Unmounting must leave nothing running.
   *
   * Stopping is this component's job because it knows the run is over; DISPOSING
   * is the controller's, because the controller built the engine. Both happen,
   * the frame loop is cancelled here, and the controller releases the context.
   */
  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      engineRef.current.stop();
    };
  }, []);

  /** Start the song when a run enters its countdown. Once per run. */
  useEffect(() => {
    if (status !== 'countdown' || !runId) return;
    if (startedRunIdRef.current === runId) return;

    startedRunIdRef.current = runId;
    runRef.current = createDanceRun(chart);
    finishedRef.current = false;
    flashAtRef.current = null;
    comboTierRef.current = '';
    setLiveMessage('Get ready.');
    startedAtRef.current = now();
    engine.start();
  }, [status, runId, chart, engine, now]);

  const phase: DancePhase =
    status === 'countdown'
      ? 'countdown'
      : status === 'playing'
        ? 'playing'
        : status === 'paused'
          ? 'paused'
          : status === 'preview' || status === 'closed'
            ? 'idle'
            : 'ended';

  /** The box can change shape between phases; re-measure rather than guess. */
  useEffect(() => {
    measureField();
  }, [phase, measureField]);

  /** Pause and resume follow the lifecycle, so the clock freezes with the game. */
  useEffect(() => {
    if (phase === 'paused') {
      void engine.pause();
      setLiveMessage('Paused.');
    } else if (phase === 'playing' && engine.state === 'paused') {
      void engine.resume();
      setLiveMessage('Playing.');
    }
  }, [phase, engine]);

  // ── The frame loop ──────────────────────────────────────────────────────

  const running = phase === 'countdown' || phase === 'playing';

  useEffect(() => {
    if (!running) return;

    let cancelled = false;

    const finish = () => {
      const summary = summariseDanceRun(runRef.current);
      engine.stop();
      if (!runId) return;
      setLiveMessage(
        `Song finished. ${summary.accuracy}% accuracy, grade ${summary.grade}, ` +
          `${summary.miss} missed out of ${summary.totalNotes}.`,
      );
      callbacksRef.current.onFinish(
        buildDanceResult({
          runId,
          machineId,
          gameId,
          chart,
          track,
          summary,
          startedAt: startedAtRef.current || now(),
          endedAt: now(),
          completedNaturally: true,
        }),
      );
    };

    const draw = () => {
      if (cancelled) return;
      frameRef.current = requestAnimationFrame(draw);

      const songTime = engine.songTimeMs();
      if (songTime === null) return;

      if (status === 'countdown') {
        const remaining = track.leadInMs - songTime;
        const beat = Math.max(0, Math.ceil(remaining / beatMs));
        setCountdownBeat((current) => (current === beat ? current : beat));
        if (remaining <= 0) {
          setCountdownBeat(null);
          callbacksRef.current.onCountdownComplete();
        }
      }

      if (status === 'playing') {
        const outcome = advanceDanceRun(runRef.current, songTime);
        if (outcome.state !== runRef.current) {
          runRef.current = outcome.state;
          if (outcome.missed.length > 0) {
            showJudgment('miss', songTime, outcome.missed[0].lane);
          }
        }
      }

      // Note positions, written straight to the DOM.
      const travel = travelRef.current;
      const notes = runRef.current.notes;
      for (const [id, element] of noteElementsRef.current) {
        if (!element) continue;
        const entry = notesById.get(id);
        if (!entry) continue;
        const progress = noteProgress(entry.note.timeMs, songTime);
        element.style.transform = `translate3d(0, ${(progress * travel).toFixed(1)}px, 0)`;
        element.style.opacity = notes[entry.index]?.status === 'pending' ? '1' : '0';
      }

      // Which notes belong on screen. The only React state this loop touches,
      // and only when the membership actually changes.
      const nextVisible: string[] = [];
      for (const note of chart.notes) {
        if (isNoteVisible(note.timeMs, songTime)) nextVisible.push(note.id);
      }
      setVisibleIds((current) =>
        current.length === nextVisible.length && current.every((id, i) => id === nextVisible[i])
          ? current
          : nextVisible,
      );

      const run = runRef.current;
      if (scoreRef.current) scoreRef.current.textContent = run.score.toLocaleString();

      if (comboValueRef.current) comboValueRef.current.textContent = String(run.combo);
      const tier = comboTier(run.combo);
      if (tier.id !== comboTierRef.current) {
        const previous = comboTierRef.current;
        comboTierRef.current = tier.id;
        if (comboScaleRef.current) {
          comboScaleRef.current.className = cn(COMBO_SCALE_CLASS, tier.className);
        }
        // Bump only when the tier changes, a bump on every hit would restart a
        // CSS animation eight times a second for no added meaning.
        if (previous && tier.min > 0) restartAnimation(comboBumpRef.current, 'dance-combo-bump');

        const next = tier.fieldClassName ? tier.fieldClassName.split(' ') : [];
        const field = fieldRef.current;
        if (field) {
          for (const token of fieldEmphasisRef.current) field.classList.remove(token);
          for (const token of next) field.classList.add(token);
        }
        fieldEmphasisRef.current = next;
      }

      if (progressRef.current) {
        const done = Math.min(100, Math.max(0, (songTime / track.durationMs) * 100));
        progressRef.current.style.width = `${done.toFixed(1)}%`;
      }

      if (flashAtRef.current !== null) {
        const age = songTime - flashAtRef.current;
        if (age > JUDGMENT_FLASH_MS || age < 0) {
          if (judgmentRef.current) {
            judgmentRef.current.textContent = '';
            judgmentRef.current.className = JUDGMENT_READOUT_CLASS;
          }
          mascotRef.current?.setAttribute('data-mood', 'idle');
          flashAtRef.current = null;
        }
      }

      if (status === 'playing' && !finishedRef.current && songTime >= track.durationMs) {
        finishedRef.current = true;
        finish();
      }
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      cancelled = true;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [
    running,
    status,
    track,
    chart,
    notesById,
    beatMs,
    runId,
    machineId,
    gameId,
    now,
    engine,
    showJudgment,
    restartAnimation,
  ]);

  // ── Input ───────────────────────────────────────────────────────────────

  const handleLane = useCallback(
    (lane: ArcadeLane) => {
      if (status !== 'playing') return;
      const songTime = engine.songTimeMs();
      if (songTime === null) return;

      const outcome = applyDanceInput(runRef.current, lane, songTime);
      runRef.current = outcome.state;
      if (!outcome.event) return; // A ghost input: no note, no penalty, no noise.

      showJudgment(outcome.event.judgment, songTime, outcome.event.lane);
      engine.playHitBlip(outcome.event.judgment === 'perfect');
    },
    [status, engine, showJudgment],
  );

  const { activeLanes, pressLane } = useArcadeInput({
    enabled: status === 'playing',
    onAction: (action) => {
      if (action.type === 'lane' && action.phase === 'press') handleLane(action.lane);
    },
  });

  /**
   * Backgrounding ABORTS. Merely losing focus PAUSES.
   *
   * A hidden tab is unrecoverable: `requestAnimationFrame` is throttled to a
   * stop while `AudioContext.currentTime` keeps advancing, so the run silently
   * accumulates misses the player never had a chance to answer. Aborting is the
   * safe outcome, and it has a decisive advantage, an aborted run has no
   * result, so it cannot be claimed, rewarded, or argued about.
   *
   * A blurred-but-visible tab is a different thing entirely: the notes are still
   * on screen and the music is still playing. Ending a sixty-eight second run
   * because someone clicked a devtools panel is hostile, and pausing costs
   * nothing: the engine re-anchors to the current audio time on resume rather
   * than trusting the clock to have frozen.
   */
  useArcadeInterruption({
    active: running,
    onInterrupt: (reason) => {
      if (reason === 'hidden') {
        setLiveMessage('The run ended because the game was hidden.');
        engine.stop();
        callbacksRef.current.onAbort('interrupted');
        return;
      }
      setLiveMessage('Paused because the window lost focus.');
      callbacksRef.current.onPause();
    },
  });

  // ── Render ──────────────────────────────────────────────────────────────

  const registerNote = useCallback((id: string, element: HTMLElement | null) => {
    if (element) noteElementsRef.current.set(id, element);
    else noteElementsRef.current.delete(id);
  }, []);

  const visibleNotes = visibleIds
    .map((id) => notesById.get(id))
    .filter((entry): entry is { note: DanceNote; index: number } => Boolean(entry))
    .map((entry) => entry.note);

  return (
    <div
      data-dance-stage
      data-dance-phase={phase}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      style={{ ['--dance-beat' as string]: `${Math.round(beatMs)}ms` }}
      className="flex h-full min-h-0 flex-col"
    >
      {/*
        One restrained live region for the whole game. Announcing notes would
        make it unusable; announcing "get ready", "paused", "the run ended" and
        the final summary is the information a screen-reader user needs.
      */}
      <p aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      <DanceCabinet
        title={track.title}
        subtitle={`${chart.difficulty} · ${Math.round(track.durationMs / 1000)}s`}
        reducedMotion={reducedMotion}
        beatMs={beatMs}
        mascot={
          <DanceMascot
            ref={mascotRef}
            beatMs={beatMs}
            dancing={phase === 'playing'}
            reducedMotion={reducedMotion}
            className="h-9 w-9 shrink-0 sm:h-12 sm:w-12"
          />
        }
        actions={
          <DanceSoundToggle
            muted={muted}
            onToggle={onToggleMute}
            className="h-9 w-9 sm:h-10 sm:w-10"
          />
        }
        meter={
          <div className="h-1.5 w-full overflow-hidden bg-island-wood/25">
            <div
              ref={progressRef}
              data-dance-progress
              className="h-full w-0 bg-gradient-to-r from-island-purple to-fuchsia-400"
            />
          </div>
        }
      >
        <div className="flex h-full min-h-0 flex-col gap-2">
          {/*
            The HUD, and only what a player uses mid-song: how well it is going
            (score), how well it is going RIGHT NOW (combo), and how much is left
            (the progress bar under the marquee). Accuracy, offsets, ghost inputs and
            note counts are all computed, and all deliberately kept off this screen
            until the results, where there is time to read them.
          */}
          {/*
            Three columns, so the combo stays optically centred over the lanes
            whatever the score's digit count. The difficulty is deliberately NOT
            repeated here: it is already on the marquee, and a HUD that restates
            what is two centimetres above it is clutter competing with the notes.
          */}
          <div className="grid shrink-0 grid-cols-3 items-center px-0.5">
            <p className="font-mono text-lg font-black leading-none text-white sm:text-xl">
              <span className="sr-only">Score </span>
              <span ref={scoreRef}>0</span>
            </p>

            {/*
              A FIXED box. The combo grows by scaling its contents, never by taking
              more room: a counter that reflows the HUD would move the playfield
              under the player's hands at the exact moment they are doing well.
            */}
            <div
              data-dance-combo
              aria-hidden
              className="mx-auto flex h-8 w-24 shrink-0 items-center justify-center overflow-visible"
            >
              <div ref={comboBumpRef}>
                <div ref={comboScaleRef} className={cn(COMBO_SCALE_CLASS, comboTier(0).className)}>
                  <span
                    ref={comboValueRef}
                    className="font-mono text-xl font-black leading-none sm:text-2xl"
                  >
                    0
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-[0.2em]">combo</span>
                </div>
              </div>
            </div>

            <span />
          </div>

          {/* The note highway. */}
          <div
            ref={fieldRef}
            data-dance-field
            className="relative min-h-[8rem] flex-1 overflow-hidden rounded-xl bg-gradient-to-b from-[#1b1230] via-[#241a3d] to-[#15102a]"
          >
            {/* Lane rails: four visibly separate columns, each with its own tint,
                its own divider and its own flash layer. */}
            <div className="absolute inset-0 grid grid-cols-4" aria-hidden>
              {DANCE_LANE_VISUALS.map((visual) => (
                <div
                  key={visual.lane}
                  data-dance-lane-rail={visual.lane}
                  className="relative border-r border-white/10 last:border-r-0"
                >
                  <div className={cn('absolute inset-0 bg-gradient-to-b to-transparent', visual.rail)} />
                  <div
                    ref={(el) => {
                      laneFlashesRef.current.set(visual.lane, el);
                    }}
                    data-dance-lane-flash={visual.lane}
                    className="absolute inset-0 bg-white opacity-0"
                  />
                </div>
              ))}
            </div>

            {/*
              Judgement readout. The WORD is the signal; colour only reinforces
              it, and the position is fixed so a reduced-motion player (who gets
              no animation) still reads it in the same place.

              It is drawn BEFORE the notes deliberately. Both live in the same
              stacking context, so DOM order decides who paints on top, and a
              420 ms word must not cover the thing the player is aiming at. The
              word is several times the size of a note and stays perfectly
              legible with one falling across it; a note hidden behind it is a
              note that gets missed.
            */}
            <div
              className="pointer-events-none absolute inset-x-0 top-[34%] flex justify-center"
              aria-hidden
            >
              <p ref={judgmentRef} data-dance-judgment className={JUDGMENT_READOUT_CLASS} />
            </div>

            {/* Notes. Positioned by the frame loop, never by React.

                The ref'd element is a zero-size POINT on the lane's centre line; the
                visible token is its child and centres itself on that point with a
                static transform. That is what lets the loop write one plain
                `translate3d(0, y, 0)` per note without having to re-derive the
                centring offset every frame. */}
            {visibleNotes.map((note) => {
              const laneIndex = DANCE_LANE_VISUALS.findIndex((v) => v.lane === note.lane);
              const visual = DANCE_LANE_VISUALS[laneIndex];
              return (
                <div
                  key={note.id}
                  ref={(el) => registerNote(note.id, el)}
                  data-dance-note={note.id}
                  data-dance-lane={note.lane}
                  aria-hidden
                  className="absolute top-0 h-0 w-0 will-change-transform"
                  style={{ left: `${(laneIndex + 0.5) * 25}%` }}
                >
                  <div
                    className={cn(
                      'flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center',
                      'rounded-xl border-2 text-lg font-black text-white sm:h-11 sm:w-11 sm:text-xl',
                      '[text-shadow:0_1px_2px_rgba(0,0,0,0.45)]',
                      visual.token,
                    )}
                  >
                    {visual.glyph}
                  </div>
                </div>
              );
            })}

            {/* Receptors: the judgement line's four targets. */}
            <div
              ref={receptorRowRef}
              className="absolute bottom-2 left-0 right-0 grid grid-cols-4 sm:bottom-3"
              aria-hidden
            >
              {/*
                The judgement line: one bright rule across all four lanes, so
                where a note is due is unambiguous at a glance.

                It lives INSIDE the receptor row and is centred on it, rather
                than being offset from the field's bottom edge. An offset has to
                be re-derived every time a receptor's size or the row's padding
                changes, and it was already wrong by half a receptor at the
                smallest size: drawing the line above the targets it is supposed
                to run through. Centring it on the row is correct at every size
                by construction, and it is the same line the notes are animated
                to (`travelRef` measures to this row's centre too).
              */}
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/40 shadow-[0_0_10px_rgba(255,255,255,0.45)]" />
              {DANCE_LANE_VISUALS.map((visual) => {
                const active = activeLanes.has(visual.lane);
                return (
                  <div key={visual.lane} className="flex justify-center">
                    <div
                      data-dance-receptor={visual.lane}
                      data-active={active ? 'true' : 'false'}
                      style={{ ['--dance-lane-glow' as string]: visual.glow }}
                      className={cn(
                        'relative flex h-9 w-9 items-center justify-center rounded-xl border-2',
                        'text-lg font-black sm:h-11 sm:w-11 sm:text-xl',
                        active ? visual.receptorActive : visual.receptor,
                        !active && 'bg-white/5',
                        !reducedMotion && 'transition-colors duration-75',
                      )}
                    >
                      {visual.glyph}
                      {/*
                        The pulse lives on a child whose `className` NEVER
                        changes, and that is not a stylistic choice.

                        Holding a lane changes `activeLanes`, which re-renders
                        the receptor above: and a React re-render rewrites
                        `className` from props, wiping any class the frame loop
                        had just added to it. React has no opinion about THIS
                        element, so the one class the loop toggles survives the
                        render that the very same key press caused.

                        The sparks are static markup inside it: a fixed handful,
                        replayed by the pulse rather than spawned per hit.
                      */}
                      <span
                        ref={(el) => {
                          receptorsRef.current.set(visual.lane, el);
                        }}
                        data-dance-pulse={visual.lane}
                        className="pointer-events-none absolute inset-0 rounded-xl"
                      >
                        {SPARK_VECTORS.map((spark, index) => (
                          <span
                            key={index}
                            style={{
                              ['--dance-spark-dx' as string]: spark.dx,
                              ['--dance-spark-dy' as string]: spark.dy,
                            }}
                            className="dance-spark absolute left-1/2 top-1/2 h-1 w-1 rounded-full bg-white opacity-0"
                          />
                        ))}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {countdownBeat !== null && (
              <div
                data-dance-countdown={countdownBeat}
                role="status"
                className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[#15102a]/70 backdrop-blur-[1px]"
              >
                <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/70">
                  Get ready
                </span>
                {/*
                  Keyed on the beat, so each tick mounts fresh and replays its pop.
                  Nothing here moves the chart: the countdown is drawn OVER a song
                  that is already running on the audio clock, and the first note is
                  due at the same millisecond whether this overlay renders or not.
                */}
                <span
                  key={countdownBeat}
                  className={cn(
                    'text-5xl font-black text-white [text-shadow:0_3px_16px_rgba(142,107,232,0.9)] sm:text-6xl',
                    !reducedMotion && 'dance-countdown-tick',
                  )}
                >
                  {countdownBeat > 3 ? '•' : countdownBeat > 0 ? countdownBeat : 'Go!'}
                </span>
              </div>
            )}
          </div>

          {/*
            Touch controls: always rendered, so a tablet with a keyboard has both.

            Each button sits directly under the lane it fires, which is what makes
            the lane-to-button relationship readable without a legend. The arrow is
            the primary cue and the key cap under it is the redundant one, so a
            player who cannot tell rose from amber still knows which control is
            which.
          */}
          <div
            className="grid shrink-0 grid-cols-4 gap-1.5 pb-[env(safe-area-inset-bottom)] sm:gap-2"
          >
            {DANCE_LANE_VISUALS.map((visual) => (
              <button
                key={visual.lane}
                type="button"
                data-dance-touch={visual.lane}
                aria-label={`${visual.label} lane (${visual.keys})`}
                disabled={status !== 'playing'}
                // Pointer events unify mouse and touch, so a tap fires exactly once.
                onPointerDown={(event) => {
                  event.preventDefault();
                  pressLane(visual.lane);
                }}
                // `detail === 0` means the click came from the keyboard rather than a
                // pointer, which is what keeps Enter and Space working on the button
                // without letting a tap fire twice (pointerdown AND the synthetic
                // click that follows it).
                onClick={(event) => {
                  if (event.detail === 0) pressLane(visual.lane);
                }}
                className={cn(
                  // 56 px tall, comfortably over the 44 px minimum touch target, and
                  // full-width in its column so the whole strip under a lane is live.
                  'dance-touch-lane flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border-2',
                  'text-2xl font-black leading-none text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]',
                  'touch-none select-none disabled:opacity-40 disabled:shadow-none',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                  visual.touch,
                  !reducedMotion && 'transition-transform duration-75 active:scale-95',
                )}
              >
                <span aria-hidden>{visual.glyph}</span>
                <span aria-hidden className="text-[10px] font-bold uppercase tracking-widest opacity-80">
                  {visual.keyCap}
                </span>
              </button>
            ))}
          </div>
        </div>
      </DanceCabinet>
    </div>
  );
}
