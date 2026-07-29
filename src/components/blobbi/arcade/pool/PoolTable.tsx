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
import { poolAiProfile, type PoolDifficulty } from '@/arcade/pool/ai';
import {
  applyPlayerShot,
  createPoolMatch,
  dragPlayerCueBall,
  placePlayerCueBall,
  stepPoolMatch,
  type PoolEvent,
  type PoolMatchState,
} from '@/arcade/pool/match';
import { poolSeedFrom } from '@/arcade/pool/rack';
import {
  createPoolPhysicsWorld,
  type PoolPhysicsWorld,
} from '@/arcade/pool/pool-physics-world';
import {
  CUE_BALL,
  clamp,
  findBall,
  isLegalBallPosition,
  normalise,
  type PoolBall,
  type Vec2,
} from '@/arcade/pool/physics';
import { groupLabel, groupOf, remainingInGroup, type PoolGroup } from '@/arcade/pool/rules';
import {
  BALL_BOUNDS,
  FIXED_STEP_MS,
  MAX_BALL_SPEED,
  MIN_SHOT_POWER,
  powerFromPull,
} from '@/arcade/pool/table';
import { buildPoolResult, summarisePoolMatch } from '@/arcade/pool/pool-result';
import type { PoolAudioEngine } from '@/arcade/pool/pool-audio';

import {
  BALL_COLOURS,
  POOL_PALETTE,
  RIPPLE_LIFE_S,
  autoOrientation,
  RAIL_WIDTH,
  drawPoolFrame,
  fitTable,
  tableOuterSize,
  toTableUnits,
  type AimState,
  type PoolOrientation,
  type PoolRipple,
  type PoolTransform,
} from './pool-draw';
import { PoolSoundToggle } from './PoolSoundToggle';

/**
 * Pool — the playable surface.
 *
 * ## Render strategy: the simulation is not React's business
 *
 * The match advances 120 times a second. Nothing that changes at that rate lives
 * in React state:
 *
 * | what | where it lives | how often it changes |
 * | --- | --- | --- |
 * | the whole match state | a ref, advanced by pure `stepPoolMatch` | 120 Hz |
 * | the aim angle and cue pull | a ref, written by pointer events | pointer rate |
 * | balls, cue, guides, ripples | pixels on a canvas | ~60 Hz |
 * | turn, groups, balls left, banner | React state | a few times a SHOT |
 * | lifecycle status | React state, owned by the caller's reducer | a few times a run |
 *
 * The simulation is therefore completely decoupled from render frequency:
 * `useFixedStepLoop` takes real elapsed time, hands the match fixed 1/120 s
 * steps, and throws away anything beyond a quarter of a second — so a stutter, a
 * resize or a backgrounded tab can never produce one enormous physics step.
 *
 * ## The control: pull the cue back and let go
 *
 * One gesture, one rule, and it is the same rule for a mouse and a finger:
 *
 * > **Press anywhere and drag. The cue aims AWAY from your finger, and how far
 * > you pull is how hard you hit. Let go to shoot.**
 *
 * Everything useful falls out of that single rule rather than being bolted on:
 *
 *  - **Aiming and power are one gesture**, so there is no mode to be in and no
 *    second control to find. Pulling a stick back and releasing it is a thing
 *    hands already know how to do.
 *  - **A tap is a re-aim, not a shot.** A drag shorter than
 *    {@link MIN_SHOT_POWER} does not fire, so tapping behind the ball simply
 *    points the cue — which is the discoverable way in for a player who has not
 *    worked out the pull yet, and is also the guard against an accidental shot
 *    while the dialog is opening or the phone is being turned.
 *  - **Your finger is behind the ball, not on the target.** On a phone that is
 *    the difference between seeing the shot and covering it.
 *
 * ## Interruption: pause, never abort
 *
 * The opposite of Blobbi Dance, and the same choice Air Hockey made. A rhythm
 * game left in a hidden tab silently accumulates misses against an audio clock
 * that keeps running, so it must abort. Pool's clock IS the loop: stop the loop
 * and the table stops with it, exactly where it was, with the balls where they
 * were and the same player still to shoot. Losing a four-minute frame to an OS
 * notification would be hostile, and nothing is gained by it.
 */

export interface PoolTableProps {
  readonly machineId: string;
  readonly gameId: string;
  readonly difficulty: PoolDifficulty;
  /** The shared lifecycle status. This component never changes it directly. */
  readonly status: ArcadeStatus;
  readonly runId: string | null;
  readonly reducedMotion: boolean;
  /** The break-setup beat ended and play began. */
  readonly onCountdownComplete: () => void;
  /** The match was decided. Exactly one result per run. */
  readonly onFinish: (result: ArcadeGameResult) => void;
  /** The run cannot continue. Never called with a result. */
  readonly onAbort: (reason: ArcadeAbortReason) => void;
  /** Freeze — the tab was hidden or the window lost focus. Recoverable. */
  readonly onPause: () => void;
  readonly audio: PoolAudioEngine;
  readonly muted: boolean;
  readonly onToggleMute: () => void;
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
   * reproducible and two runs are never identical — and so nothing in the render
   * path ever calls `Math.random()`.
   */
  readonly createMatchState?: () => PoolMatchState;
}

/** Radians per second the keyboard swings the cue. */
const KEY_AIM_SPEED = 0.85;
/** Power per second the keyboard adds or removes. */
const KEY_POWER_SPEED = 0.7;
/** Table units per second the keyboard slides the cue ball during placement. */
const KEY_PLACE_SPEED = 34;
/** Live ripples kept at once. A hard cap, so a break cannot grow the array. */
const MAX_RIPPLES = 12;

const AIM_KEYS = new Set([
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

/** The cue's aim and pull. Lives in a ref — it changes at pointer rate. */
interface AimRef {
  angle: number;
  power: number;
  dragging: boolean;
}

interface PoolHud {
  readonly phase: PoolMatchState['phase'];
  readonly turn: PoolMatchState['turn'];
  readonly banner: string | null;
  readonly playerGroup: PoolGroup | null;
  readonly opponentGroup: PoolGroup | null;
  readonly playerLeft: number | null;
  readonly opponentLeft: number | null;
  readonly pocketed: readonly number[];
  /** Power in twentieths, so a drag re-renders the meter twenty times and not two hundred. */
  readonly powerStep: number;
  readonly placementLegal: boolean;
}

function hudOf(state: PoolMatchState, powerStep: number): PoolHud {
  const cue = findBall(state.balls, CUE_BALL);
  return {
    phase: state.phase,
    turn: state.turn,
    banner: state.banner,
    playerGroup: state.assignment.player,
    opponentGroup: state.assignment.opponent,
    playerLeft:
      state.assignment.player === null
        ? null
        : remainingInGroup(state.balls, state.assignment.player).length,
    opponentLeft:
      state.assignment.opponent === null
        ? null
        : remainingInGroup(state.balls, state.assignment.opponent).length,
    pocketed: state.balls.filter((b) => b.pocketed && b.number !== CUE_BALL).map((b) => b.number),
    powerStep,
    placementLegal:
      state.phase !== 'ball-in-hand' || !cue || isLegalBallPosition(cue, state.balls, CUE_BALL),
  };
}

function sameHud(a: PoolHud, b: PoolHud): boolean {
  return (
    a.phase === b.phase &&
    a.turn === b.turn &&
    a.banner === b.banner &&
    a.playerGroup === b.playerGroup &&
    a.opponentGroup === b.opponentGroup &&
    a.playerLeft === b.playerLeft &&
    a.opponentLeft === b.opponentLeft &&
    a.powerStep === b.powerStep &&
    a.placementLegal === b.placementLegal &&
    a.pocketed.length === b.pocketed.length
  );
}

export function PoolTable({
  machineId,
  gameId,
  difficulty,
  status,
  runId,
  reducedMotion,
  onCountdownComplete,
  onFinish,
  onAbort,
  onPause,
  audio,
  muted,
  onToggleMute,
  expanded,
  now = Date.now,
  createMatchState,
}: PoolTableProps) {
  // ── High-frequency state, deliberately outside React ─────────────────────
  const buildMatch = useCallback(
    () =>
      createMatchState
        ? createMatchState()
        : createPoolMatch({ difficulty, seed: poolSeedFrom(runId ?? 'blobbi-pool') }),
    [createMatchState, difficulty, runId],
  );

  /**
   * The Planck world for the current run.
   *
   * One per run, built here and disposed on unmount. It is a ref rather than
   * state for the same reason the match is: it changes 120 times a second and
   * React must never re-render because of it.
   */
  const worldRef = useRef<PoolPhysicsWorld | null>(null);
  if (worldRef.current === null) worldRef.current = createPoolPhysicsWorld();

  const matchRef = useRef<PoolMatchState | null>(null);
  if (matchRef.current === null) {
    matchRef.current = buildMatch();
    worldRef.current.reset(matchRef.current.balls);
  }

  /** Whoever built the world releases it. */
  useEffect(() => {
    const world = worldRef.current;
    return () => {
      world?.dispose();
      worldRef.current = null;
    };
  }, []);

  /** Which run the match was built for, so a replay builds a new one. */
  const builtRunIdRef = useRef<string | null>(null);
  const finishedRef = useRef(false);
  const startedAtRef = useRef(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** The box the table is fitted INTO. Its shape decides the default layout. */
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const transformRef = useRef<PoolTransform>({
    scale: 0,
    offsetX: 0,
    offsetY: 0,
    orientation: 'landscape',
  });
  const pixelSizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  /** Cached at measure time and on pointer-down, so a drag reads no layout. */
  const rectRef = useRef<DOMRect | null>(null);

  const aimRef = useRef<AimRef>({ angle: 0, power: 0, dragging: false });
  const pointerIdRef = useRef<number | null>(null);
  /** What the current pointer gesture is doing. `null` when there is none. */
  const gestureRef = useRef<'aim' | 'place' | null>(null);
  const keysRef = useRef(new Set<string>());

  const ripplesRef = useRef<PoolRipple[]>([]);
  /** The hardest contact seen since the last frame. Flushed to audio once. See `pool-audio.ts`. */
  const loudestContactRef = useRef(0);
  const loudestCushionRef = useRef(0);

  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  // ── Low-frequency state, in React ────────────────────────────────────────
  const [hud, setHud] = useState<PoolHud>(() => hudOf(matchRef.current!, 0));
  const [liveMessage, setLiveMessage] = useState('');
  /**
   * The layout the CONTAINER asks for, measured. Changes when the window is
   * resized, when the phone is rotated, or when the shell's footer comes and
   * goes — never from a user-agent string.
   */
  const [orientation, setOrientation] = useState<PoolOrientation>('landscape');
  /**
   * Whether the HUD goes BESIDE the table instead of above it.
   *
   * The arcade's game window is short and very wide — about 956 × 382 of usable
   * stage on a laptop — and a 214:114 table in a box that wide is bound by
   * HEIGHT. A HUD stacked on top of it therefore does not cost a strip of table;
   * it costs a fifth of the table's every dimension while leaving 250 px of
   * width empty beside it. Putting the HUD in the empty column spends the width
   * that had no use on the thing that had nowhere to go.
   */
  const [hudBeside, setHudBeside] = useState(false);
  /**
   * Where the table is actually DRAWN inside its box, in CSS pixels.
   *
   * The box fills its container and the canvas letterboxes inside it, so the two
   * are not the same rectangle. Every overlay — the power meter, the sound
   * toggle, the banner, the placement button — belongs on the TABLE, and
   * anchoring them to the box leaves them floating in the letterbox margin.
   *
   * Published from `measure`, so it changes when the layout does and never
   * during a frame.
   */
  const [frame, setFrame] = useState({ left: 0, top: 0, width: 0, height: 0 });

  const orientationRef = useRef(orientation);
  orientationRef.current = orientation;

  const callbacksRef = useRef({ onCountdownComplete, onFinish, onAbort, onPause });
  callbacksRef.current = { onCountdownComplete, onFinish, onAbort, onPause };

  const audioRef = useRef(audio);
  audioRef.current = audio;

  const profile = poolAiProfile(difficulty);

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
        setOrientation((current) => (current === fitted ? current : fitted));

        // Measured against the WHOLE stage, not the table's own container: the
        // stage's shape does not change when the HUD moves, so the decision
        // cannot oscillate between the two layouts it is choosing from.
        const outer = tableOuterSize(fitted);
        const beside = box.width / box.height > (outer.width / outer.height) * 1.22;
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
    const transform = fitTable(rect.width, rect.height, orientationRef.current);
    transformRef.current = transform;

    const outer = tableOuterSize(orientationRef.current);
    const next = {
      left: transform.offsetX - RAIL_WIDTH * transform.scale,
      top: transform.offsetY - RAIL_WIDTH * transform.scale,
      width: outer.width * transform.scale,
      height: outer.height * transform.scale,
    };
    setFrame((current) =>
      current.left === next.left &&
      current.top === next.top &&
      current.width === next.width &&
      current.height === next.height
        ? current
        : next,
    );
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
   * A gesture in flight when the geometry changes is a gesture whose meaning has
   * changed underneath it.
   *
   * Cancelling it is the conservative answer and the one the brief asks for: the
   * alternative is a shot fired along an angle the player chose against a table
   * that has since been re-laid, which is worse than making them drag again. The
   * aim ANGLE survives, because it is in table units and a rotation does not
   * change it — only the half-finished pull is dropped.
   */
  useEffect(() => {
    measure();
    if (gestureRef.current !== null) {
      gestureRef.current = null;
      pointerIdRef.current = null;
      aimRef.current = { ...aimRef.current, power: 0, dragging: false };
    }
  }, [orientation, expanded, hudBeside, status, measure]);

  // ── Run lifetime ─────────────────────────────────────────────────────────

  /** Build a fresh match when a run enters its countdown. Once per run. */
  useEffect(() => {
    if (status !== 'countdown' || !runId) return;
    if (builtRunIdRef.current === runId) return;

    builtRunIdRef.current = runId;
    matchRef.current = buildMatch();
    // A replay is a brand-new table: the same world, emptied and re-racked, so a
    // body from the previous frame can never survive into this one.
    worldRef.current?.reset(matchRef.current.balls);
    finishedRef.current = false;
    startedAtRef.current = 0;
    ripplesRef.current = [];
    aimRef.current = { angle: 0, power: 0, dragging: false };
    gestureRef.current = null;
    pointerIdRef.current = null;
    setHud(hudOf(matchRef.current, 0));
    setLiveMessage('Rack them up. You break.');
    // The player pressed Start, so the table is where they want to be: give it
    // focus, which is also what makes the keyboard controls reachable without
    // hunting for them.
    boxRef.current?.focus({ preventScroll: true });
  }, [status, runId, buildMatch]);

  const finishMatch = useCallback(
    (state: PoolMatchState) => {
      if (finishedRef.current || !runId) return;
      finishedRef.current = true;
      const summary = summarisePoolMatch(state);
      setLiveMessage(
        summary.outcome === 'win'
          ? 'You potted the 8-ball. You win.'
          : 'Your rival took the frame.',
      );
      const endedAt = now();
      callbacksRef.current.onFinish(
        buildPoolResult({
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
    (events: readonly PoolEvent[]) => {
      for (const event of events) {
        switch (event.type) {
          case 'ready-complete': {
            startedAtRef.current = now();
            setLiveMessage('Your break. Drag back from the cue ball and let go.');
            callbacksRef.current.onCountdownComplete();
            break;
          }
          case 'strike': {
            audioRef.current.strike(event.power);
            break;
          }
          case 'collide': {
            // Aggregated, not played: a break is forty contacts in a fifth of a
            // second, and one click each is a burst of noise. The loudest of
            // each frame is played once, in `render`.
            const strength = Math.min(1, event.impact / MAX_BALL_SPEED);
            loudestContactRef.current = Math.max(loudestContactRef.current, strength);
            addRipple(event.at, strength * 0.6, 'rgba(255,255,255,0.8)');
            break;
          }
          case 'cushion': {
            const strength = Math.min(1, event.impact / MAX_BALL_SPEED);
            loudestCushionRef.current = Math.max(loudestCushionRef.current, strength);
            break;
          }
          case 'pocket': {
            audioRef.current.pocket();
            addRipple(
              event.at,
              1,
              event.ball === CUE_BALL
                ? POOL_PALETTE.danger
                : (BALL_COLOURS[event.ball] ?? POOL_PALETTE.ok),
            );
            break;
          }
          case 'scratch': {
            audioRef.current.scratch();
            break;
          }
          case 'shot-resolved': {
            setLiveMessage(event.outcome.message);
            break;
          }
          case 'turn': {
            audioRef.current.turn(event.to === 'player');
            break;
          }
          case 'match-over': {
            audioRef.current.fanfare(event.winner === 'player');
            finishMatch(matchRef.current!);
            break;
          }
          case 'ai-planned':
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

  const step = useCallback((dt: number) => {
    const current = matchRef.current;
    if (!current) return;

    // Keyboard first, so a held key moves the cue at the same rate whatever the
    // frame rate is doing. It writes the same aim ref the pointer does — one
    // target, two ways to move it, so neither path can produce something the
    // other cannot.
    const keys = keysRef.current;
    if (keys.size > 0 && current.turn === 'player') {
      const left = keys.has('ArrowLeft') || keys.has('a') || keys.has('A') ? 1 : 0;
      const right = keys.has('ArrowRight') || keys.has('d') || keys.has('D') ? 1 : 0;
      const up = keys.has('ArrowUp') || keys.has('w') || keys.has('W') ? 1 : 0;
      const down = keys.has('ArrowDown') || keys.has('s') || keys.has('S') ? 1 : 0;

      if (current.phase === 'aiming') {
        const swing = (right - left) * KEY_AIM_SPEED * dt;
        const push = (up - down) * KEY_POWER_SPEED * dt;
        if (swing !== 0 || push !== 0) {
          aimRef.current = {
            angle: aimRef.current.angle + swing,
            power: clamp(aimRef.current.power + push, 0, 1),
            dragging: aimRef.current.dragging,
          };
        }
      } else if (current.phase === 'ball-in-hand') {
        const dx = (right - left) * KEY_PLACE_SPEED * dt;
        const dy = (down - up) * KEY_PLACE_SPEED * dt;
        if (dx !== 0 || dy !== 0) {
          const cue = findBall(current.balls, CUE_BALL);
          if (cue && worldRef.current) {
            matchRef.current = dragPlayerCueBall(
              current,
              {
                x: clamp(cue.x + dx, BALL_BOUNDS.minX, BALL_BOUNDS.maxX),
                y: clamp(cue.y + dy, BALL_BOUNDS.minY, BALL_BOUNDS.maxY),
              },
              worldRef.current,
            );
          }
        }
      }
    }

    // Re-read the ref rather than reusing `current`: the keyboard branch above
    // may have replaced it, and stepping the stale copy would silently undo the
    // placement the player just nudged.
    const world = worldRef.current;
    if (!world) return;
    const outcome = stepPoolMatch(matchRef.current ?? current, dt, world);
    matchRef.current = outcome.state;
    if (outcome.events.length > 0) applyEvents(outcome.events);

    // Decorations age on the SIMULATION clock, not on the frame clock, so a
    // dropped frame does not make a ripple linger.
    const ripples = ripplesRef.current;
    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      ripples[i].age += dt;
      if (ripples[i].age >= RIPPLE_LIFE_S) ripples.splice(i, 1);
    }
  }, [applyEvents]);

  const render = useCallback(() => {
    const state = matchRef.current;
    if (!state) return;

    // One click for the frame's loudest contact, one for its loudest cushion.
    // See `pool-audio.ts` for why this aggregation is not optional.
    if (loudestContactRef.current > 0) {
      audioRef.current.collide(loudestContactRef.current);
      loudestContactRef.current = 0;
    }
    if (loudestCushionRef.current > 0) {
      audioRef.current.cushion(loudestCushionRef.current);
      loudestCushionRef.current = 0;
    }

    const aiming = state.turn === 'player' && state.phase === 'aiming';
    const placing = state.turn === 'player' && state.phase === 'ball-in-hand';

    const ctx = ctxRef.current;
    const { width, height, dpr } = pixelSizeRef.current;
    if (ctx && width > 0 && height > 0) {
      const aim: AimState | null = aiming
        ? {
            angle: aimRef.current.angle,
            power: aimRef.current.power,
            dragging: aimRef.current.dragging,
          }
        : null;

      drawPoolFrame(ctx, state, {
        transform: transformRef.current,
        devicePixelRatio: dpr,
        pixelWidth: width,
        pixelHeight: height,
        aim,
        ripples: ripplesRef.current,
        // Rings only while the player can act on them. Leaving them up during
        // the opponent's turn implies it is still your shot.
        showTargets: aiming || placing,
        placing,
      });
    }

    const powerStep = aiming ? Math.round(aimRef.current.power * 20) : 0;
    const next = hudOf(state, powerStep);
    setHud((current) => (sameHud(current, next) ? current : next));
  }, []);

  useFixedStepLoop({ active: running, stepMs: FIXED_STEP_MS, onStep: step, onRender: render });

  /**
   * Both interruptions pause. See the module note: this game's clock is its own
   * loop, so stopping the loop stops the table with nothing left running and
   * nothing to reconcile on the way back.
   */
  useArcadeInterruption({
    active: running,
    onInterrupt: (reason) => {
      // A half-finished pull must not survive a pause. Coming back to a cue
      // already drawn back, with no finger on it, is a shot waiting to go off.
      gestureRef.current = null;
      pointerIdRef.current = null;
      aimRef.current = { ...aimRef.current, power: 0, dragging: false };
      setLiveMessage(
        reason === 'hidden'
          ? 'Paused because the game was hidden.'
          : 'Paused because the window lost focus.',
      );
      callbacksRef.current.onPause();
    },
  });

  // ── Input ────────────────────────────────────────────────────────────────

  const pointToTable = useCallback((clientX: number, clientY: number): Vec2 | null => {
    const rect = rectRef.current ?? canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    rectRef.current = rect;
    return toTableUnits({ x: clientX - rect.left, y: clientY - rect.top }, transformRef.current);
  }, []);

  /** Recompute the aim from a pointer position. See the module note on the gesture. */
  const pullTo = useCallback(
    (point: Vec2, cue: PoolBall) => {
      const away = normalise(cue.x - point.x, cue.y - point.y);
      const pull = Math.hypot(point.x - cue.x, point.y - cue.y);
      aimRef.current = {
        // A pointer sitting exactly on the cue ball has no direction to give;
        // keeping the previous angle is better than snapping to an arbitrary one.
        angle: away ? Math.atan2(away.y, away.x) : aimRef.current.angle,
        power: powerFromPull(pull),
        dragging: true,
      };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = matchRef.current;
      if (!state || state.turn !== 'player') return;
      if (state.phase !== 'aiming' && state.phase !== 'ball-in-hand') return;

      // The shell is a modal dialog, so the world's click-to-move listener is
      // already out of reach. This stops the OTHER thing a drag does on a phone:
      // a scroll, a pull-to-refresh, or a long-press selection.
      event.preventDefault();
      rectRef.current = canvasRef.current?.getBoundingClientRect() ?? null;
      const point = pointToTable(event.clientX, event.clientY);
      if (!point) return;

      pointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture?.(event.pointerId);

      if (state.phase === 'ball-in-hand') {
        gestureRef.current = 'place';
        if (worldRef.current) matchRef.current = dragPlayerCueBall(state, point, worldRef.current);
        return;
      }

      const cue = findBall(state.balls, CUE_BALL);
      if (!cue) return;
      gestureRef.current = 'aim';
      pullTo(point, cue);
    },
    [pointToTable, pullTo],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (gestureRef.current === null) return;
      if (pointerIdRef.current !== event.pointerId) return;
      const state = matchRef.current;
      if (!state) return;

      const point = pointToTable(event.clientX, event.clientY);
      if (!point) return;

      if (gestureRef.current === 'place') {
        if (worldRef.current) matchRef.current = dragPlayerCueBall(state, point, worldRef.current);
        return;
      }

      const cue = findBall(state.balls, CUE_BALL);
      if (cue) pullTo(point, cue);
    },
    [pointToTable, pullTo],
  );

  const releasePointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerIdRef.current = null;
    gestureRef.current = null;
  }, []);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (gesture === null || pointerIdRef.current !== event.pointerId) return;
      releasePointer(event);

      const state = matchRef.current;
      if (!state) return;

      // Placement is confirmed by the button, not by letting go: the brief asks
      // for an explicit confirmation, and a drag that commits on release makes
      // the first accidental touch the final answer.
      if (gesture === 'place') return;

      const power = aimRef.current.power;
      aimRef.current = { ...aimRef.current, power: 0, dragging: false };

      if (power < MIN_SHOT_POWER) {
        // Under the threshold this was a re-aim, not a shot. Deliberately: it is
        // the guard against an accidental fire, and it is also how a player who
        // has not found the pull yet still gets to point the cue.
        return;
      }
      if (state.phase !== 'aiming' || state.turn !== 'player') return;
      if (!worldRef.current) return;

      const outcome = applyPlayerShot(state, aimRef.current.angle, power, worldRef.current);
      matchRef.current = outcome.state;
      if (outcome.events.length > 0) applyEvents(outcome.events);
    },
    [applyEvents, releasePointer],
  );

  /**
   * A cancelled or lost gesture drops the shot and keeps the aim.
   *
   * `pointercancel` fires when the browser takes the gesture over — a system
   * scroll, a palm rejection, the phone being rotated mid-drag. Firing the cue
   * on the strength of a pull the player did not finish is the worst possible
   * reading of that, so nothing is fired.
   */
  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (gestureRef.current === null) return;
      releasePointer(event);
      aimRef.current = { ...aimRef.current, power: 0, dragging: false };
    },
    [releasePointer],
  );

  const confirmPlacement = useCallback(() => {
    const state = matchRef.current;
    const world = worldRef.current;
    if (!state || !world) return;
    const cue = findBall(state.balls, CUE_BALL);
    matchRef.current = placePlayerCueBall(state, world, cue ? { x: cue.x, y: cue.y } : undefined);
    setLiveMessage('Cue ball placed. Take your shot.');
    setHud(hudOf(matchRef.current, 0));
    boxRef.current?.focus({ preventScroll: true });
  }, []);

  const shootNow = useCallback(() => {
    const state = matchRef.current;
    const world = worldRef.current;
    if (!state || !world) return;
    if (state.phase !== 'aiming' || state.turn !== 'player') return;
    const power = Math.max(MIN_SHOT_POWER, aimRef.current.power);
    aimRef.current = { ...aimRef.current, power: 0, dragging: false };
    const outcome = applyPlayerShot(state, aimRef.current.angle, power, world);
    matchRef.current = outcome.state;
    if (outcome.events.length > 0) applyEvents(outcome.events);
  }, [applyEvents]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const state = matchRef.current;
      if (!state || state.turn !== 'player') return;

      if (AIM_KEYS.has(event.key)) {
        // Arrow keys scroll a dialog by default, which would take the table off
        // screen mid-frame.
        event.preventDefault();
        keysRef.current.add(event.key);
        return;
      }

      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (state.phase === 'ball-in-hand') confirmPlacement();
        else if (state.phase === 'aiming') shootNow();
        return;
      }

      if (event.key === 'Escape' && state.phase === 'aiming') {
        // Not a close: the shell owns that. This puts the cue back down.
        aimRef.current = { ...aimRef.current, power: 0, dragging: false };
      }
    },
    [confirmPlacement, shootNow],
  );

  const handleKeyUp = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!AIM_KEYS.has(event.key)) return;
    keysRef.current.delete(event.key);
  }, []);

  /** Leaving the table must not leave a key stuck down or a cue drawn back. */
  const handleBlur = useCallback(() => {
    keysRef.current.clear();
    pointerIdRef.current = null;
    gestureRef.current = null;
    aimRef.current = { ...aimRef.current, power: 0, dragging: false };
  }, []);

  useEffect(() => {
    const keys = keysRef.current;
    return () => {
      keys.clear();
      pointerIdRef.current = null;
      gestureRef.current = null;
    };
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  const paused = status === 'paused';
  const placing = hud.turn === 'player' && hud.phase === 'ball-in-hand';
  const aiming = hud.turn === 'player' && hud.phase === 'aiming';
  /**
   * The rival is deciding — NOT "the rival's shot is on its way".
   *
   * Scoped to `thinking` alone on purpose. A first pass also covered the rival's
   * `rolling`, and the result read "Rival is lining up…" over a table full of
   * balls it had already hit, which is the badge contradicting the picture.
   */
  const thinking = hud.phase === 'thinking';

  const statusLine = paused
    ? 'Paused'
    : hud.phase === 'ready'
      ? 'Your break'
      : hud.phase === 'over'
        ? 'Frame over'
        : placing
          ? 'Place the cue ball'
          : aiming
            ? 'Your shot'
            : hud.phase === 'rolling'
              ? 'Balls rolling'
              : thinking
                ? 'Rival is thinking'
                : hud.turn === 'player'
                  ? 'Your shot'
                  : "Rival's shot";

  return (
    <div
      data-pool-stage
      data-pool-phase={hud.phase}
      data-pool-turn={hud.turn}
      data-pool-orientation={orientation}
      data-pool-presentation={expanded ? 'expanded' : 'contained'}
      data-pool-hud={hudBeside ? 'beside' : 'above'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      ref={containerRef}
      className={cn(
        'flex h-full min-h-0',
        hudBeside ? 'flex-row items-stretch' : 'flex-col',
        expanded ? 'gap-1' : 'gap-2',
      )}
    >
      {/* One restrained live region. Turn changes, fouls and the result. */}
      <p aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      {/*
        The scoreboard. Both sides are always on screen, each with a visible
        text label, so whose turn it is and which group is whose are never
        communicated by colour or by position alone.
      */}
      <div
        data-pool-scoreboard
        className={cn(
          'grid shrink-0 items-center gap-2 border-island-wood/30 bg-island-cream-2/80',
          hudBeside
            ? 'w-[8.5rem] grid-cols-1 content-start justify-items-stretch py-2'
            : 'grid-cols-3',
          expanded ? 'rounded-lg border px-2 py-1' : 'rounded-xl border-2 px-3 py-1.5',
        )}
      >
        <SidePanel
          label="You"
          active={hud.turn === 'player'}
          group={hud.playerGroup}
          left={hud.playerLeft}
          tone="player"
          compact={expanded}
        />

        <p
          className={cn(
            'text-center text-[10px] font-bold uppercase tracking-[0.16em] text-island-ink-soft',
            hudBeside && 'order-first',
          )}
        >
          <span data-pool-status className="block text-xs tracking-normal text-island-ink">
            {statusLine}
          </span>
          {!expanded && <span className="mt-0.5 block">{profile.label} rival</span>}
        </p>

        <SidePanel
          label="Rival"
          active={hud.turn === 'opponent'}
          group={hud.opponentGroup}
          left={hud.opponentLeft}
          tone="opponent"
          compact={expanded}
        />

        {/* The balls already down, so "how far through is this frame?" is
            answerable at a glance. Dropped in the narrow stacked layout, where
            it would cost a row of table to say what the counts above already
            say. */}
        {hudBeside && !expanded && hud.pocketed.length > 0 && (
          <PocketedTray numbers={hud.pocketed} />
        )}

        {hudBeside && !expanded && (
          <p className="mt-1 text-[10px] font-normal leading-snug tracking-normal blobbi-text-muted">
            Drag back from the cue ball and let go. Arrow keys and space work
            too.
          </p>
        )}
      </div>

      {/*
        The table. Centred, aspect-locked, and never wider or taller than its
        box — and it is THIS box, measured, that decides which way round the
        table is laid out.
      */}
      <div
        data-pool-field
        className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center"
      >
        <div
          ref={boxRef}
          data-pool-table
          tabIndex={0}
          role="application"
          aria-label="Pool table. Drag back from the cue ball and let go to shoot, or use the arrow keys and space."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handlePointerCancel}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onBlur={handleBlur}
          /*
            The box FILLS its container and the canvas letterboxes inside it.

            The obvious alternative — an aspect-locked element, which is what Air
            Hockey uses — has a failure mode this game can actually reach. With
            `height: 100%` definite and `width: auto` from `aspect-ratio`,
            `max-width: 100%` clamps the width WITHOUT reducing the height, so
            the element stretches. That needs the element's ratio to disagree
            with its box, which is exactly what happens for the frame or two
            between a device rotating and `measure` catching up — and a
            stretched table is not a cosmetic problem here, because a pointer
            position would no longer map back to a table unit the simulation
            agrees with. The shot would leave at a different angle from the one
            the guide drew.

            `fitTable` already computes a uniform scale and centres what is left
            over, so letting it own the fit makes distortion impossible rather
            than merely unlikely: a mismatched orientation costs a small table
            for one frame instead of a wrong one. The wooden frame is drawn INTO
            the canvas by `drawTable`, so the picture is unchanged.
          */
          className={cn(
            'relative h-full w-full',
            'overflow-hidden',
            // `touch-none` is the load-bearing one: without it a drag on a phone
            // scrolls the dialog instead of pulling the cue.
            'touch-none select-none',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-island-purple',
          )}
        >
          <canvas ref={canvasRef} aria-hidden className="block h-full w-full" />

          {/*
            Everything below sits ON the table rather than on the box. See
            `frame`: the canvas letterboxes, so the two rectangles differ, and an
            overlay pinned to the box ends up in the margin beside the felt.
          */}
          <div
            data-pool-frame
            className="pointer-events-none absolute"
            style={{
              left: frame.width > 0 ? frame.left : 0,
              top: frame.width > 0 ? frame.top : 0,
              width: frame.width > 0 ? frame.width : '100%',
              height: frame.width > 0 ? frame.height : '100%',
            }}
          >
          {/* The power meter. The cue's own pull-back says the same thing more
              vividly; this says it precisely, and it is the version that still
              works when a finger is over the cue ball. */}
          <div
            data-pool-power={hud.powerStep}
            aria-hidden
            className={cn(
              'pointer-events-none absolute bottom-3 left-2 top-3 w-2 overflow-hidden rounded-full',
              'border border-white/25 bg-black/45 transition-opacity',
              aiming ? 'opacity-100' : 'opacity-0',
            )}
          >
            <div
              className="absolute inset-x-0 bottom-0 rounded-full bg-gradient-to-t from-emerald-300 via-amber-300 to-rose-400"
              style={{ height: `${(hud.powerStep / 20) * 100}%` }}
            />
          </div>

          <div className="pointer-events-auto absolute right-1.5 top-1.5 flex items-center gap-1.5">
            <PoolSoundToggle muted={muted} onToggle={onToggleMute} className="h-9 w-9" />
          </div>

          {hud.phase === 'ready' && (
            <div
              data-pool-ready
              role="status"
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/45"
            >
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/70">
                Rack them up
              </span>
              <span
                className={cn(
                  'text-4xl font-black text-white [text-shadow:0_3px_16px_rgba(0,0,0,0.8)]',
                  !reducedMotion && 'arcade-pop-in',
                )}
              >
                Your break
              </span>
            </div>
          )}

          {/* The banner: the one sentence saying what just happened. Never the
              only channel — the same words go to the live region above. */}
          {hud.banner && hud.phase !== 'ready' && (
            <div
              data-pool-banner
              role="status"
              className="pointer-events-none absolute inset-x-0 top-2 flex justify-center px-2"
            >
              <p
                className={cn(
                  'max-w-[92%] truncate rounded-full bg-black/65 px-3 py-1 text-center text-xs font-bold text-white',
                  'sm:text-sm',
                  !reducedMotion && 'arcade-pop-in',
                )}
              >
                {hud.banner}
              </p>
            </div>
          )}

          {placing && (
            <div className="pointer-events-auto absolute inset-x-0 bottom-2 flex flex-col items-center gap-1 px-2">
              <p className="pointer-events-none rounded-full bg-black/60 px-3 py-0.5 text-[11px] font-semibold text-white">
                {hud.placementLegal
                  ? 'Drag the cue ball anywhere on the table.'
                  : 'That spot is taken — it will move to the nearest free one.'}
              </p>
              <button
                type="button"
                data-pool-place
                onPointerDown={(event) => event.stopPropagation()}
                onClick={confirmPlacement}
                className={cn(
                  'min-h-[44px] rounded-full border-2 border-white/30 bg-island-purple px-5 py-1.5',
                  'text-sm font-bold text-white shadow-lg active:scale-95',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                )}
              >
                Place cue ball
              </button>
            </div>
          )}

          {thinking && !paused && (
            <div
              data-pool-thinking
              role="status"
              className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/55 px-3 py-1 text-[11px] font-semibold text-white"
            >
              Rival is lining up…
            </div>
          )}

          {paused && (
            <div
              data-pool-paused
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/70 text-center"
            >
              <p className="text-2xl font-black uppercase tracking-[0.2em] text-white">Paused</p>
              <p className="max-w-[16rem] px-4 text-xs text-white/80">
                The table is frozen exactly where it was. Press Resume to carry on.
              </p>
            </div>
          )}
          </div>
        </div>
      </div>

      {/*
        One short line of instructions, kept on screen rather than only on the
        start panel — a player who came back after a pause should not have to
        remember. Dropped in expanded play: on a phone the gesture is obvious
        once, and the line costs a strip of table to say so.
      */}
      {!expanded && !hudBeside && (
        <p className="shrink-0 text-center text-[11px] blobbi-text-muted">
          Drag back from the cue ball and let go. Arrow keys aim, space shoots.
        </p>
      )}
    </div>
  );
}

/** One side of the scoreboard: who they are, what they are on, how many are left. */
function SidePanel({
  label,
  active,
  group,
  left,
  tone,
  compact,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly group: PoolGroup | null;
  readonly left: number | null;
  readonly tone: 'player' | 'opponent';
  readonly compact: boolean;
}) {
  return (
    <p
      data-pool-side={tone}
      data-pool-active={active ? 'true' : 'false'}
      className={cn(
        'rounded-lg px-1.5 py-0.5 leading-tight',
        // The ACTIVE side is marked by a tint AND by the word in the status
        // line above AND by `data-pool-active`, so the turn is never carried by
        // colour alone.
        active && (tone === 'player' ? 'bg-island-purple/15' : 'bg-amber-500/15'),
      )}
    >
      <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-island-ink-soft">
        {label}
        {active && <span className="ml-1 text-island-ink">•</span>}
      </span>
      <span
        className={cn(
          'block font-bold',
          compact ? 'text-xs' : 'text-sm',
          tone === 'player' ? 'text-island-purple' : 'text-amber-600',
        )}
      >
        {group === null ? 'Open' : groupLabel(group)}
      </span>
      {left !== null && (
        <span className="block text-[10px] blobbi-text-muted">
          {left === 0 ? 'On the 8' : `${left} left`}
        </span>
      )}
    </p>
  );
}

/** Small chips for the balls already off the table. */
function PocketedTray({ numbers }: { readonly numbers: readonly number[] }) {
  return (
    <span data-pool-pocketed className="mt-1 flex flex-wrap gap-1">
      {numbers.map((n) => (
        <span
          key={n}
          title={`Ball ${n}`}
          className="flex h-4 w-4 items-center justify-center rounded-full border border-black/25 text-[8px] font-bold text-white"
          style={{
            backgroundColor: BALL_COLOURS[n] ?? '#888',
            // A striped ball is a white ball with a band, here as a ring, so the
            // tray tells solids from stripes the same way the table does.
            boxShadow: groupOf(n) === 'stripes' ? 'inset 0 0 0 1.5px #F6F2E8' : undefined,
          }}
        >
          {n}
        </span>
      ))}
    </span>
  );
}
