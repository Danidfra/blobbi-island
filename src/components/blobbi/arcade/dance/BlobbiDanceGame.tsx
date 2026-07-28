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
  DANCE_LANE_VISUALS,
  JUDGMENT_FLASH_MS,
  JUDGMENT_VISUALS,
  isNoteVisible,
  noteProgress,
} from './dance-visuals';

/**
 * Blobbi Dance — the playable surface.
 *
 * ## Render strategy
 *
 * A rhythm game updates sixty times a second. React state updated sixty times a
 * second re-renders a tree sixty times a second, and the input handler then
 * competes with reconciliation for the main thread — which shows up as exactly
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
 * functions in `judgment.ts` — so the rules stay pure and stay tested by passing
 * numbers, while the storage is a ref that no re-render depends on. Canvas was
 * considered and rejected: 110 notes with at most a dozen on screen is nowhere
 * near a DOM bottleneck, and a canvas would cost the focus outlines, the text
 * scaling and the screen-reader story that come free with elements.
 *
 * ## Timing
 *
 * Every judgement is made against `engine.songTimeMs()` sampled AT THE MOMENT
 * the input arrives — not against the last animation frame, which may be 16 ms
 * stale (a quarter of the Perfect window), and not against a frame counter.
 * `requestAnimationFrame` only decides when to draw; a dropped frame costs a
 * frame of animation and nothing else, because the next frame reads the true
 * song time.
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
  /** The run should freeze — the window lost focus. Recoverable. */
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
  /** Epoch clock, injectable so a test can assert exact result timestamps. */
  readonly now?: () => number;
}

const JUDGMENT_BASE_CLASS =
  'pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 text-2xl font-black drop-shadow';

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
  const scoreRef = useRef<HTMLSpanElement | null>(null);
  const comboRef = useRef<HTMLParagraphElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const judgmentRef = useRef<HTMLParagraphElement | null>(null);
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const fieldHeightRef = useRef(0);

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

  const measureField = useCallback(() => {
    fieldHeightRef.current = fieldRef.current?.getBoundingClientRect().height ?? 0;
  }, []);

  useEffect(() => {
    measureField();
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', measureField);
    return () => window.removeEventListener('resize', measureField);
  }, [measureField]);

  /** Paint a judgement without touching React state. */
  const showJudgment = useCallback((judgment: DanceJudgment, atSongTimeMs: number) => {
    flashAtRef.current = atSongTimeMs;
    const element = judgmentRef.current;
    if (!element) return;
    const visual = JUDGMENT_VISUALS[judgment];
    element.textContent = visual.label;
    element.className = cn(JUDGMENT_BASE_CLASS, visual.className);
  }, []);

  // ── Engine lifetime ─────────────────────────────────────────────────────

  /**
   * Unmounting must leave nothing running.
   *
   * Stopping is this component's job because it knows the run is over; DISPOSING
   * is the controller's, because the controller built the engine. Both happen —
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
    startedAtRef.current = now();
    setLiveMessage('Get ready.');
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
          if (outcome.missed.length > 0) showJudgment('miss', songTime);
        }
      }

      // Note positions, written straight to the DOM.
      const fieldHeight = fieldHeightRef.current;
      const notes = runRef.current.notes;
      for (const [id, element] of noteElementsRef.current) {
        if (!element) continue;
        const entry = notesById.get(id);
        if (!entry) continue;
        const progress = noteProgress(entry.note.timeMs, songTime);
        element.style.transform = `translate3d(-50%, ${(progress * fieldHeight).toFixed(1)}px, 0)`;
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
      if (comboRef.current) {
        comboRef.current.textContent = run.combo > 1 ? `${run.combo}× combo` : '';
      }
      if (progressRef.current) {
        const done = Math.min(100, Math.max(0, (songTime / track.durationMs) * 100));
        progressRef.current.style.width = `${done.toFixed(1)}%`;
      }
      if (judgmentRef.current && flashAtRef.current !== null) {
        const age = songTime - flashAtRef.current;
        if (age > JUDGMENT_FLASH_MS || age < 0) {
          judgmentRef.current.textContent = '';
          judgmentRef.current.className = JUDGMENT_BASE_CLASS;
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

      showJudgment(outcome.event.judgment, songTime);
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
   * safe outcome, and it has a decisive advantage — an aborted run has no
   * result, so it cannot be claimed, rewarded, or argued about.
   *
   * A blurred-but-visible tab is a different thing entirely: the notes are still
   * on screen and the music is still playing. Ending a sixty-eight second run
   * because someone clicked a devtools panel is hostile, and pausing costs
   * nothing — the engine re-anchors to the current audio time on resume rather
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
      className="flex h-full min-h-[22rem] flex-col gap-3"
    >
      {/*
        One restrained live region for the whole game. Announcing notes would
        make it unusable; announcing "get ready", "paused", "the run ended" and
        the final summary is the information a screen-reader user needs.
      */}
      <p aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      <div className="flex items-baseline justify-between gap-3 text-sm">
        <p className="font-mono text-base font-bold text-island-ink">
          <span className="sr-only">Score </span>
          <span ref={scoreRef}>0</span>
        </p>
        <p ref={comboRef} data-dance-combo aria-hidden className="font-bold text-island-purple" />
        <p className="blobbi-text-muted text-xs">
          {track.title} · {chart.difficulty}
        </p>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-island-wood/20">
        <div
          ref={progressRef}
          data-dance-progress
          className="h-full w-0 rounded-full bg-island-purple"
        />
      </div>

      <div
        ref={fieldRef}
        data-dance-field
        className="relative flex-1 overflow-hidden rounded-xl border border-island-wood/25 bg-island-ink/5"
      >
        {/* Lane guides. Decorative; the arrows carry the meaning. */}
        <div className="absolute inset-0 grid grid-cols-4" aria-hidden>
          {DANCE_LANE_VISUALS.map((visual) => (
            <div key={visual.lane} className="border-r border-island-wood/10 last:border-r-0" />
          ))}
        </div>

        {/* Notes. Positioned by the frame loop, never by React. */}
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
              className={cn(
                'absolute top-0 flex h-9 w-9 items-center justify-center rounded-lg border-2',
                'text-lg font-bold text-white will-change-transform',
                visual.accent,
              )}
              style={{ left: `${(laneIndex + 0.5) * 25}%` }}
            >
              {visual.glyph}
            </div>
          );
        })}

        {/* Receptors — the judgement line. */}
        <div
          className="absolute bottom-0 left-0 right-0 grid grid-cols-4 border-t-2 border-dashed border-island-wood/40"
          aria-hidden
        >
          {DANCE_LANE_VISUALS.map((visual) => (
            <div key={visual.lane} className="flex justify-center py-1">
              <div
                data-dance-receptor={visual.lane}
                data-active={activeLanes.has(visual.lane) ? 'true' : 'false'}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg border-2 text-lg font-bold',
                  visual.receptor,
                  activeLanes.has(visual.lane) ? 'bg-island-ink/20' : 'bg-transparent',
                  !reducedMotion && 'transition-colors duration-75',
                )}
              >
                {visual.glyph}
              </div>
            </div>
          ))}
        </div>

        {/* Judgement readout. The WORD is the signal; colour only reinforces it. */}
        <p ref={judgmentRef} data-dance-judgment aria-hidden className={JUDGMENT_BASE_CLASS} />

        {countdownBeat !== null && (
          <div
            data-dance-countdown={countdownBeat}
            role="status"
            className="absolute inset-0 flex items-center justify-center bg-island-ink/25 text-5xl font-black text-white"
          >
            {countdownBeat > 0 ? countdownBeat : 'Go!'}
          </div>
        )}
      </div>

      {/* Touch controls — always rendered, so a tablet with a keyboard has both. */}
      <div className="grid grid-cols-4 gap-2">
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
              'flex h-14 items-center justify-center rounded-xl border-2 text-2xl font-bold text-white',
              'touch-none select-none disabled:opacity-40',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
              visual.accent,
              !reducedMotion && 'transition-transform duration-75 active:scale-95',
            )}
          >
            <span aria-hidden>{visual.glyph}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
