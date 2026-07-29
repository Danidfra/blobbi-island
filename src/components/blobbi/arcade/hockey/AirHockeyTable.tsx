import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { cn } from '@/lib/utils';
import { useArcadeInterruption } from '@/arcade/useArcadeInterruption';
import { useFixedStepLoop } from '@/arcade/useFixedStepLoop';
import type { ArcadeAbortReason, ArcadeStatus } from '@/arcade/arcade-machine-state';
import type { ArcadeGameResult } from '@/arcade/types';
import type { HockeyDifficulty } from '@/arcade/hockey/ai';
import { hockeyAiProfile } from '@/arcade/hockey/ai';
import type { HockeyEvent, HockeyMatchState } from '@/arcade/hockey/match';
import { createHockeyMatch, hockeySeedFrom, stepHockeyMatch } from '@/arcade/hockey/match';
import type { Vec2 } from '@/arcade/hockey/physics';
import { clampToZone } from '@/arcade/hockey/physics';
import {
  FIXED_STEP_MS,
  PLAYER_HOME,
  PLAYER_ZONE,
  PUCK_MAX_SPEED,
} from '@/arcade/hockey/table';
import {
  buildAirHockeyResult,
  summariseHockeyMatch,
} from '@/arcade/hockey/hockey-result';
import type { HockeyAudioEngine } from '@/arcade/hockey/hockey-audio';

import {
  HOCKEY_PALETTE,
  RIPPLE_LIFE_S,
  TRAIL_LENGTH,
  autoOrientation,
  drawHockeyFrame,
  fitTable,
  tableAspectRatio,
  tableDisplaySize,
  toTableUnits,
  type HockeyOrientation,
  type HockeyRipple,
  type TableTransform,
} from './hockey-draw';
import { HockeyOrientationToggle } from './HockeyOrientationToggle';
import { HockeySoundToggle } from './HockeySoundToggle';

/**
 * Air Hockey — the playable surface.
 *
 * ## Render strategy: the simulation is not React's business
 *
 * The match advances 120 times a second. Nothing that changes at that rate
 * lives in React state:
 *
 * | what | where it lives | how often it changes |
 * | --- | --- | --- |
 * | the whole match state | a ref, advanced by pure `stepHockeyMatch` | 120 Hz |
 * | puck, mallets, trail, ripples | pixels on a canvas | ~60 Hz |
 * | both scores, the phase, the countdown | React state | ~30 times a MATCH |
 * | lifecycle status | React state, owned by the caller's reducer | a few times a run |
 *
 * The simulation is therefore completely decoupled from render frequency:
 * `useFixedStepLoop` takes real elapsed time, hands the match fixed 1/120 s
 * steps, and throws away anything beyond a quarter of a second — so a stutter,
 * a resize or a backgrounded tab can never produce one enormous physics step.
 *
 * ## Coordinates
 *
 * The simulation lives in a 100 × 160 table-unit box and knows nothing about
 * pixels — or about which way up it is drawn. `fitTable` maps that box onto the
 * canvas with a UNIFORM scale and a QUARTER TURN (the game window is landscape
 * at every viewport; see `hockey-draw.ts`), and `toTableUnits` is its exact
 * inverse for pointer input. Because both directions read the same transform,
 * a resize, an orientation change or a fullscreen toggle cannot desynchronise
 * where the player points from where the mallet goes.
 *
 * ## Interruption: pause, never abort
 *
 * The opposite of Blobbi Dance, and for a stated reason. A rhythm game left in a
 * hidden tab silently accumulates misses against an audio clock that keeps
 * running, so it must abort. Air Hockey's clock IS the loop: stop the loop and
 * the match stops with it, exactly where it was. Hiding the tab or losing focus
 * therefore pauses, and the player picks the match back up — losing a
 * three-minute match to an OS dialog would be hostile, and nothing is gained by
 * it.
 */

export interface AirHockeyTableProps {
  readonly machineId: string;
  readonly gameId: string;
  readonly difficulty: HockeyDifficulty;
  /** The shared lifecycle status. This component never changes it directly. */
  readonly status: ArcadeStatus;
  readonly runId: string | null;
  readonly targetGoals: number;
  readonly reducedMotion: boolean;
  /** The opening countdown reached zero. */
  readonly onCountdownComplete: () => void;
  /** The match was decided. Exactly one result per run. */
  readonly onFinish: (result: ArcadeGameResult) => void;
  /** The run cannot continue. Never called with a result. */
  readonly onAbort: (reason: ArcadeAbortReason) => void;
  /** Freeze — the tab was hidden or the window lost focus. Recoverable. */
  readonly onPause: () => void;
  readonly audio: HockeyAudioEngine;
  readonly muted: boolean;
  readonly onToggleMute: () => void;
  /**
   * The layout the player explicitly chose, or `null` to follow the box.
   *
   * Owned by the controller so it survives a replay, and `null` by default so a
   * phone that is rotated re-answers the question rather than being stuck with
   * an answer given in the other orientation.
   */
  readonly manualOrientation: HockeyOrientation | null;
  readonly onChooseOrientation: (orientation: HockeyOrientation) => void;
  /**
   * True when the game owns the whole screen (a phone, a tablet) rather than
   * sitting inside the arcade's framed window. Drops every non-essential piece
   * of interface so the table gets the space.
   */
  readonly expanded: boolean;
  /** Epoch clock, injectable so a test can assert exact result timestamps. */
  readonly now?: () => number;
  /**
   * Build the match to play. Overridable for tests and the DEV harness.
   *
   * The production default seeds the match from the run id, so a run is
   * reproducible and two runs are never identical — and so nothing in the
   * render path ever calls `Math.random()`.
   */
  readonly createMatchState?: () => HockeyMatchState;
}

/** How fast the keyboard drives the aim point, in table units per second. */
const KEYBOARD_SPEED = 230;
/** Steps between trail samples. 4 at 120 Hz ≈ one sample every 33 ms. */
const TRAIL_SAMPLE_EVERY = 4;
/** Live ripples kept at once. A hard cap, so a long rally cannot grow the array. */
const MAX_RIPPLES = 10;

const MOVEMENT_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'w',
  'a',
  's',
  'd',
  'W',
  'A',
  'S',
  'D',
]);

interface HockeyHud {
  readonly playerScore: number;
  readonly opponentScore: number;
  readonly phase: HockeyMatchState['phase'];
  readonly countdown: number | null;
  readonly lastScorer: HockeyMatchState['lastScorer'];
}

function hudOf(state: HockeyMatchState): HockeyHud {
  return {
    playerScore: state.playerScore,
    opponentScore: state.opponentScore,
    phase: state.phase,
    countdown: state.phase === 'countdown' ? Math.max(0, Math.ceil(state.timerMs / 1000)) : null,
    lastScorer: state.lastScorer,
  };
}

function sameHud(a: HockeyHud, b: HockeyHud): boolean {
  return (
    a.playerScore === b.playerScore &&
    a.opponentScore === b.opponentScore &&
    a.phase === b.phase &&
    a.countdown === b.countdown &&
    a.lastScorer === b.lastScorer
  );
}

export function AirHockeyTable({
  machineId,
  gameId,
  difficulty,
  status,
  runId,
  targetGoals,
  reducedMotion,
  onCountdownComplete,
  onFinish,
  onAbort,
  onPause,
  audio,
  muted,
  onToggleMute,
  now = Date.now,
  createMatchState,
  manualOrientation,
  onChooseOrientation,
  expanded,
}: AirHockeyTableProps) {
  // ── High-frequency state, deliberately outside React ─────────────────────
  const buildMatch = useCallback(
    () =>
      createMatchState
        ? createMatchState()
        : createHockeyMatch({
            difficulty,
            targetGoals,
            seed: hockeySeedFrom(runId ?? 'air-hockey'),
          }),
    [createMatchState, difficulty, targetGoals, runId],
  );

  const matchRef = useRef<HockeyMatchState | null>(null);
  if (matchRef.current === null) matchRef.current = buildMatch();

  /** Which run the match was built for, so a replay builds a new one. */
  const builtRunIdRef = useRef<string | null>(null);
  const finishedRef = useRef(false);
  const startedAtRef = useRef(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** The box the table is fitted INTO. Its shape decides the default layout. */
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const transformRef = useRef<TableTransform>({
    scale: 0,
    offsetX: 0,
    offsetY: 0,
    orientation: 'landscape',
  });
  const pixelSizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  /** Cached at measure time and on pointer-down, so a drag reads no layout. */
  const rectRef = useRef<DOMRect | null>(null);

  const targetRef = useRef<Vec2>({ x: PLAYER_HOME.x, y: PLAYER_HOME.y });
  const pointerIdRef = useRef<number | null>(null);
  const keysRef = useRef(new Set<string>());

  const trailRef = useRef<Vec2[]>([]);
  const trailTickRef = useRef(0);
  const ripplesRef = useRef<HockeyRipple[]>([]);
  const goalWashRef = useRef(0);

  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  // ── Low-frequency state, in React ────────────────────────────────────────
  const [hud, setHud] = useState<HockeyHud>(() => hudOf(matchRef.current!));
  const [liveMessage, setLiveMessage] = useState('');
  /**
   * The layout the CONTAINER asks for, measured. Changes when the window is
   * resized, when the phone is rotated, or when the shell's footer comes and
   * goes — never from a user-agent string.
   */
  const [fittedOrientation, setFittedOrientation] = useState<HockeyOrientation>('landscape');
  /**
   * Whether the scoreboard goes BESIDE the table instead of above it.
   *
   * This is where most of the desktop's wasted space was going. The arcade's
   * game window is short and very wide — 956 x 382 of usable stage on a normal
   * laptop — and a table locked to 8:5 in a box that wide is bound by HEIGHT.
   * Stacking a 65 px scoreboard and a line of instructions on top of it
   * therefore did not cost a strip of table; it cost a fifth of the table's
   * every dimension, and left 500 px of width empty beside it. Measured, the
   * table used 48% of the width it was given.
   *
   * Putting the HUD in the empty column instead spends the width that had no
   * use on the thing that had nowhere to go, and the table grows from
   * 456 x 285 to 611 x 382 — about 1.8x the playfield, with nothing overlapping
   * the puck.
   */
  const [hudBeside, setHudBeside] = useState(false);

  const orientation = manualOrientation ?? fittedOrientation;
  /** Read by `measure`, which must stay a stable callback. */
  const orientationRef = useRef(orientation);
  orientationRef.current = orientation;

  const callbacksRef = useRef({ onCountdownComplete, onFinish, onAbort, onPause });
  callbacksRef.current = { onCountdownComplete, onFinish, onAbort, onPause };

  const audioRef = useRef(audio);
  audioRef.current = audio;

  const profile = hockeyAiProfile(difficulty);

  // ── Measurement ──────────────────────────────────────────────────────────

  /**
   * Size the backing store and recompute the table transform.
   *
   * Never called from inside the frame loop. Reading layout 60 times a second is
   * the classic way to make a smooth game stutter; reading it when the box
   * actually changes costs nothing.
   */
  const measure = useCallback(() => {
    // The CONTAINER decides the layout; the canvas decides the scale. Measuring
    // the canvas for both would be circular — its own shape is a consequence of
    // the layout we are trying to choose.
    const container = containerRef.current;
    if (container) {
      const box = container.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        const fitted = autoOrientation(box.width, box.height);
        setFittedOrientation((current) => (current === fitted ? current : fitted));

        // Measured against the WHOLE stage, not the table's own container: the
        // stage's shape does not change when the HUD moves, so the decision
        // cannot oscillate between the two layouts it is choosing from.
        const size = tableDisplaySize(orientationRef.current);
        const beside = box.width / box.height > (size.width / size.height) * 1.3;
        setHudBeside((current) => (current === beside ? current : beside));
      }
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    rectRef.current = rect;
    if (rect.width <= 0 || rect.height <= 0) return;

    // Capped at 2: beyond that the pixel cost is real and the difference is not
    // visible on a table made of flat colours.
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    pixelSizeRef.current = { width, height, dpr };
    transformRef.current = fitTable(rect.width, rect.height, orientationRef.current);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && !ctxRef.current) {
      try {
        ctxRef.current = canvas.getContext('2d');
      } catch {
        // jsdom, and any browser that refuses a 2D context. The simulation runs
        // regardless; only the picture is missing, and the HUD still works.
        ctxRef.current = null;
      }
    }
    measure();
    if (typeof window === 'undefined') return;

    // Three signals, because each catches something the others do not:
    //   • `resize`            — the window changed, on every platform;
    //   • `orientationchange` — older mobile browsers fire it BEFORE a resize,
    //                           or instead of one;
    //   • `ResizeObserver`    — the container changed without the window doing
    //                           so, which is what happens when the shell's
    //                           footer appears or the app enters expanded mode.
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver === 'function' && containerRef.current) {
      observer = new ResizeObserver(() => measure());
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      observer?.disconnect();
    };
  }, [measure]);

  /**
   * Re-measure whenever the box could have changed shape without a resize
   * event: a phase change (the shell's footer comes and goes), a layout switch
   * (the table's own aspect ratio just changed), or entering expanded mode.
   */
  useEffect(() => {
    measure();
  }, [status, orientation, expanded, hudBeside, measure]);

  // ── Run lifetime ─────────────────────────────────────────────────────────

  /** Build a fresh match when a run enters its countdown. Once per run. */
  useEffect(() => {
    if (status !== 'countdown' || !runId) return;
    if (builtRunIdRef.current === runId) return;

    builtRunIdRef.current = runId;
    matchRef.current = buildMatch();
    finishedRef.current = false;
    startedAtRef.current = 0;
    trailRef.current = [];
    ripplesRef.current = [];
    goalWashRef.current = 0;
    targetRef.current = { x: PLAYER_HOME.x, y: PLAYER_HOME.y };
    setHud(hudOf(matchRef.current));
    setLiveMessage('Get ready.');
    // The player pressed Start, so the playfield is where they want to be: give
    // it focus, which is also what makes the keyboard controls reachable
    // without hunting for them.
    boxRef.current?.focus({ preventScroll: true });
  }, [status, runId, buildMatch]);

  const finishMatch = useCallback(
    (state: HockeyMatchState) => {
      if (finishedRef.current || !runId) return;
      finishedRef.current = true;
      const summary = summariseHockeyMatch(state);
      setLiveMessage(
        summary.outcome === 'win'
          ? `You won ${summary.playerScore} to ${summary.opponentScore}.`
          : `You lost ${summary.playerScore} to ${summary.opponentScore}.`,
      );
      const endedAt = now();
      callbacksRef.current.onFinish(
        buildAirHockeyResult({
          runId,
          machineId,
          gameId,
          match: summary,
          startedAt: startedAtRef.current || endedAt,
          endedAt,
        }),
      );
    },
    [runId, machineId, gameId, now],
  );

  // ── Events → sound and sparks ────────────────────────────────────────────

  const addRipple = useCallback((at: Vec2, strength: number, tint: string) => {
    if (reducedMotionRef.current) return;
    const ripples = ripplesRef.current;
    ripples.push({ x: at.x, y: at.y, strength, age: 0, tint });
    if (ripples.length > MAX_RIPPLES) ripples.splice(0, ripples.length - MAX_RIPPLES);
  }, []);

  const applyEvents = useCallback(
    (events: readonly HockeyEvent[]) => {
      for (const event of events) {
        switch (event.type) {
          case 'wall': {
            const strength = event.kind === 'end' ? 0.5 : 0.35;
            audioRef.current.wall(strength);
            addRipple(event.at, strength * 0.4, HOCKEY_PALETTE.lineSoft);
            break;
          }
          case 'mallet': {
            const strength = Math.min(1, event.impact / PUCK_MAX_SPEED);
            audioRef.current.hit(strength);
            addRipple(
              event.at,
              strength,
              event.side === 'player' ? HOCKEY_PALETTE.player : HOCKEY_PALETTE.opponent,
            );
            break;
          }
          case 'goal': {
            audioRef.current.goal(event.scorer === 'player');
            goalWashRef.current = 1;
            setLiveMessage(
              event.scorer === 'player' ? 'You scored.' : 'Your rival scored.',
            );
            break;
          }
          case 'countdown-complete': {
            startedAtRef.current = now();
            setLiveMessage('Go.');
            callbacksRef.current.onCountdownComplete();
            break;
          }
          case 'match-over': {
            audioRef.current.fanfare(event.winner === 'player');
            finishMatch(matchRef.current!);
            break;
          }
          case 'serve':
          case 'countdown':
          case 'recovered':
          default:
            break;
        }
      }
    },
    [addRipple, finishMatch, now],
  );

  // ── The loop ─────────────────────────────────────────────────────────────

  const running = status === 'countdown' || status === 'playing';

  const step = useCallback(
    (dt: number) => {
      const current = matchRef.current;
      if (!current) return;

      // Keyboard moves the AIM POINT, which the mallet then chases under the
      // same rate limit the pointer is subject to. One target, two ways to move
      // it — so neither input path can produce a mallet speed the other cannot.
      const keys = keysRef.current;
      if (keys.size > 0) {
        const dx =
          (keys.has('ArrowRight') || keys.has('d') || keys.has('D') ? 1 : 0) -
          (keys.has('ArrowLeft') || keys.has('a') || keys.has('A') ? 1 : 0);
        const dy =
          (keys.has('ArrowDown') || keys.has('s') || keys.has('S') ? 1 : 0) -
          (keys.has('ArrowUp') || keys.has('w') || keys.has('W') ? 1 : 0);
        if (dx !== 0 || dy !== 0) {
          const length = Math.hypot(dx, dy);
          targetRef.current = clampToZone(
            {
              x: targetRef.current.x + (dx / length) * KEYBOARD_SPEED * dt,
              y: targetRef.current.y + (dy / length) * KEYBOARD_SPEED * dt,
            },
            PLAYER_ZONE,
          );
        }
      }

      const outcome = stepHockeyMatch(current, dt, { playerTarget: targetRef.current });
      matchRef.current = outcome.state;
      if (outcome.events.length > 0) applyEvents(outcome.events);

      // Decorations age on the SIMULATION clock, not on the frame clock, so a
      // dropped frame does not make a ripple linger.
      const ripples = ripplesRef.current;
      for (let i = ripples.length - 1; i >= 0; i -= 1) {
        ripples[i].age += dt;
        if (ripples[i].age >= RIPPLE_LIFE_S) ripples.splice(i, 1);
      }
      if (goalWashRef.current > 0) {
        goalWashRef.current = Math.max(0, goalWashRef.current - dt * 1.6);
      }

      if (!reducedMotionRef.current) {
        trailTickRef.current += 1;
        if (trailTickRef.current >= TRAIL_SAMPLE_EVERY) {
          trailTickRef.current = 0;
          const trail = trailRef.current;
          trail.push({ x: outcome.state.puck.x, y: outcome.state.puck.y });
          if (trail.length > TRAIL_LENGTH) trail.shift();
        }
      }
    },
    [applyEvents],
  );

  const render = useCallback(() => {
    const state = matchRef.current;
    if (!state) return;

    const ctx = ctxRef.current;
    const { width, height, dpr } = pixelSizeRef.current;
    if (ctx && width > 0 && height > 0) {
      drawHockeyFrame(ctx, state, {
        transform: transformRef.current,
        devicePixelRatio: dpr,
        pixelWidth: width,
        pixelHeight: height,
        // Only the puck's own trail is drawn while it is actually moving; a
        // frozen puck with a comet tail behind it reads as a bug.
        trail: state.phase === 'live' ? trailRef.current : [],
        ripples: ripplesRef.current,
        goalWash: reducedMotionRef.current ? Math.min(0.35, goalWashRef.current) : goalWashRef.current,
      });
    }

    const next = hudOf(state);
    setHud((current) => (sameHud(current, next) ? current : next));
  }, []);

  useFixedStepLoop({ active: running, stepMs: FIXED_STEP_MS, onStep: step, onRender: render });

  /**
   * Both interruptions pause. See the module note: this game's clock is its own
   * loop, so stopping the loop stops the match with nothing left running and
   * nothing to reconcile on the way back.
   */
  useArcadeInterruption({
    active: running,
    onInterrupt: (reason) => {
      setLiveMessage(
        reason === 'hidden'
          ? 'Paused because the game was hidden.'
          : 'Paused because the window lost focus.',
      );
      callbacksRef.current.onPause();
    },
  });

  // ── Input ────────────────────────────────────────────────────────────────

  const aimAt = useCallback((clientX: number, clientY: number) => {
    const rect = rectRef.current ?? canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    rectRef.current = rect;
    targetRef.current = clampToZone(
      toTableUnits({ x: clientX - rect.left, y: clientY - rect.top }, transformRef.current),
      PLAYER_ZONE,
    );
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // The shell is a modal dialog, so the world's click-to-move listener is
      // already out of reach. This stops the OTHER thing a drag does on a phone:
      // a scroll, a pull-to-refresh, or a long-press selection.
      event.preventDefault();
      rectRef.current = canvasRef.current?.getBoundingClientRect() ?? null;
      pointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      aimAt(event.clientX, event.clientY);
    },
    [aimAt],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // A mouse steers on hover, which is what a desktop player expects and what
      // makes the mallet feel weightless. Touch and pen require a held contact,
      // because there is no hover to steer with and a stray tap should not fling
      // the mallet across the table.
      if (event.pointerType !== 'mouse' && pointerIdRef.current !== event.pointerId) return;
      aimAt(event.clientX, event.clientY);
    },
    [aimAt],
  );

  const endPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!MOVEMENT_KEYS.has(event.key)) return;
    // Arrow keys scroll a dialog by default, which would take the table off
    // screen mid-rally.
    event.preventDefault();
    keysRef.current.add(event.key);
  }, []);

  const handleKeyUp = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!MOVEMENT_KEYS.has(event.key)) return;
    keysRef.current.delete(event.key);
  }, []);

  /** Leaving the playfield must not leave a key stuck down. */
  const handleBlur = useCallback(() => {
    keysRef.current.clear();
    pointerIdRef.current = null;
  }, []);

  useEffect(() => {
    const keys = keysRef.current;
    return () => {
      keys.clear();
      pointerIdRef.current = null;
    };
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  const goalBanner = hud.phase === 'goal' && hud.lastScorer !== null;
  const paused = status === 'paused';

  return (
    <div
      data-hockey-stage
      data-hockey-phase={hud.phase}
      data-hockey-orientation={orientation}
      data-hockey-presentation={expanded ? 'expanded' : 'contained'}
      data-hockey-hud={hudBeside ? 'beside' : 'above'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      ref={containerRef}
      className={cn(
        'flex h-full min-h-0',
        hudBeside ? 'flex-row items-stretch' : 'flex-col',
        expanded ? 'gap-1' : 'gap-2',
      )}
    >
      {/* One restrained live region. Goals and the final score, nothing else. */}
      <p aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      {/*
        The scoreboard. Both scores are always on screen, each with a visible
        text label, so who is winning is never communicated by colour or by
        position alone.
      */}
      <div
        data-hockey-scoreboard
        className={cn(
          'grid shrink-0 items-center gap-2 border-island-wood/30 bg-island-cream-2/80',
          hudBeside
            ? 'w-[7.5rem] grid-cols-1 content-center justify-items-center py-2 text-center'
            : 'grid-cols-3',
          // Expanded play keeps the scoreboard — a score you cannot read is not
          // a score — but strips it to one thin line so every remaining pixel
          // belongs to the table.
          expanded
            ? 'rounded-lg border px-2 py-0.5'
            : 'rounded-xl border-2 px-3 py-1.5',
        )}
      >
        <p className={cn('leading-tight', hudBeside ? 'text-center' : 'text-left')}>
          <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-island-ink-soft">
            You
          </span>
          <span
            data-hockey-player-score
            className={cn(
              'font-mono font-black text-island-purple',
              expanded ? 'text-xl' : 'text-2xl sm:text-3xl',
            )}
          >
            {hud.playerScore}
          </span>
        </p>

        <p className="text-center text-[10px] font-bold uppercase tracking-[0.18em] text-island-ink-soft">
          <span data-hockey-status className="block text-xs tracking-normal text-island-ink">
            {hud.phase === 'countdown'
              ? 'Get ready'
              : hud.phase === 'goal'
                ? 'Goal!'
                : hud.phase === 'serve'
                  ? 'Next serve'
                  : hud.phase === 'over'
                    ? 'Match over'
                    : paused
                      ? 'Paused'
                      : 'First to ' + targetGoals}
          </span>
          {!expanded && <span className="mt-0.5 block">{profile.label}</span>}
          {/*
            The instructions live INSIDE the HUD column when the HUD is beside
            the table. As a sibling of the table they were a `shrink-0`
            paragraph 300 px wide, quietly taking a third of the playfield's
            width in row layout — the table measured 418 px instead of 579.
          */}
          {hudBeside && !expanded && (
            <span className="mt-2 block text-[10px] font-normal normal-case leading-snug tracking-normal blobbi-text-muted">
              Drag to move your mallet. Arrow keys work too.
            </span>
          )}
        </p>

        <p className={cn('leading-tight', hudBeside ? 'text-center' : 'text-right')}>
          <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-island-ink-soft">
            Rival
          </span>
          <span
            data-hockey-opponent-score
            className={cn(
              'font-mono font-black text-amber-600',
              expanded ? 'text-xl' : 'text-2xl sm:text-3xl',
            )}
          >
            {hud.opponentScore}
          </span>
        </p>
      </div>

      {/*
        The table. Centred, aspect-locked, and never wider or taller than its
        box — and it is THIS box, measured, that decides which way round the
        table is laid out.
      */}
      <div
        data-hockey-field
        className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center"
      >
        <div
          ref={boxRef}
          data-hockey-table
          tabIndex={0}
          role="application"
          aria-label="Air hockey table. Drag to move your mallet, or use the arrow keys."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onLostPointerCapture={endPointer}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onBlur={handleBlur}
          className={cn(
            // The aspect ratio is an inline style rather than a class because it
            // is chosen at runtime, and Tailwind can only emit classes it can
            // see in the source.
            'relative h-full max-h-full w-auto max-w-full',
            'overflow-hidden border-island-wood-dark/60',
            expanded ? 'rounded-xl border' : 'rounded-2xl border-2',
            'shadow-[inset_0_2px_10px_rgba(0,0,0,0.55)]',
            // `touch-none` is the load-bearing one: without it a drag on a phone
            // scrolls the dialog instead of moving the mallet.
            'touch-none select-none',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-island-purple',
          )}
          style={{
            backgroundColor: HOCKEY_PALETTE.rail,
            aspectRatio: tableAspectRatio(orientation),
          }}
        >
          <canvas ref={canvasRef} aria-hidden className="block h-full w-full" />

          <div className="absolute right-1.5 top-1.5 flex items-center gap-1.5">
            {/*
              The layout switch is a DESKTOP control and is not rendered in
              expanded play. On a phone the answer is not a preference — it is
              which way the player is holding the device — and offering a button
              that fights the next rotation would be worse than offering none.
            */}
            {!expanded && (
              <HockeyOrientationToggle
                orientation={orientation}
                onChoose={onChooseOrientation}
              />
            )}
            <HockeySoundToggle muted={muted} onToggle={onToggleMute} className="h-9 w-9" />
          </div>

          {hud.countdown !== null && (
            <div
              data-hockey-countdown={hud.countdown}
              role="status"
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[#15102a]/60"
            >
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/70">
                Get ready
              </span>
              <span
                key={hud.countdown}
                className={cn(
                  'text-6xl font-black text-white [text-shadow:0_3px_16px_rgba(142,107,232,0.9)]',
                  !reducedMotion && 'arcade-pop-in',
                )}
              >
                {hud.countdown > 0 ? hud.countdown : 'Go!'}
              </span>
            </div>
          )}

          {goalBanner && (
            <div
              data-hockey-goal={hud.lastScorer ?? undefined}
              role="status"
              className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center"
            >
              {/* The WORD is the signal; the tint only reinforces it. */}
              <p
                className={cn(
                  'text-4xl font-black uppercase tracking-[0.2em] text-white sm:text-5xl',
                  '[text-shadow:0_3px_18px_rgba(0,0,0,0.85)]',
                  !reducedMotion && 'arcade-pop-in',
                )}
              >
                Goal
              </p>
              <p className="mt-1 text-sm font-bold text-white/90 [text-shadow:0_2px_8px_rgba(0,0,0,0.9)]">
                {hud.lastScorer === 'player' ? 'You scored' : 'Your rival scored'}
              </p>
            </div>
          )}

          {paused && (
            <div
              data-hockey-paused
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[#15102a]/75 text-center"
            >
              <p className="text-2xl font-black uppercase tracking-[0.2em] text-white">Paused</p>
              <p className="max-w-[16rem] px-4 text-xs text-white/80">
                The match is frozen exactly where it was. Press Resume to carry on.
              </p>
            </div>
          )}
        </div>
      </div>

      {/*
        One short line of instructions, kept on screen rather than only on the
        start panel — a player who came back after a pause should not have to
        remember. Dropped in expanded play: on a phone the gesture is obvious,
        and the line costs a strip of table to say so.
      */}
      {!expanded && !hudBeside && (
        <p className="shrink-0 text-center text-[11px] blobbi-text-muted">
          Drag inside the table to move your mallet. Arrow keys work too.
        </p>
      )}
    </div>
  );
}


