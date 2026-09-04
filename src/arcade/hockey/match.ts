/**
 * Air Hockey: the match, as one pure fixed-step function.
 *
 * ```
 *   countdown ──3,2,1──► live ──goal──► goal ──┬── target reached ──► over
 *      ▲                  ▲                     │
 *      │                  └────── serve ◄───────┘
 *      └─ createMatch
 * ```
 *
 * `stepHockeyMatch(state, dt, input)` advances the world by exactly one fixed
 * step and returns the new state plus the events that happened during it. It is
 * the single source of truth for score, phase and puck, and it is pure: no
 * clock, no `Math.random`, no DOM, no React. Every random number comes from a
 * seeded generator carried IN the state, so a match is reproducible from
 * `(seed, inputs)`: which is what lets `match.test.ts` assert "a goal scores
 * exactly once" by stepping numbers rather than by watching a canvas.
 *
 * ## The invariants this file exists to enforce
 *
 * 1. **A goal is counted exactly once.** Detection can only happen in `live`,
 *    and scoring leaves `live` in the same step. There is no second path to a
 *    score and no flag to forget to clear.
 * 2. **The clock only advances in `live` and the two pauses.** `over` is
 *    terminal; stepping it returns the same object, so a loop that keeps
 *    running after the match ends changes nothing.
 * 3. **Nobody may leave their half.** Both mallets go through
 *    {@link clampToZone} and the same rate-limited move, every step, whatever
 *    the pointer or the AI asked for.
 * 4. **The puck cannot be lost.** {@link sanitisePuck} catches a non-finite or
 *    escaped puck and the match re-serves rather than freezing or exploding.
 * 5. **Serving is fair.** The side that CONCEDED gets the next serve, which is
 *    self-correcting: a player being beaten is handed the puck. Only the opening
 *    serve is random, and it is a seeded coin toss rather than a fixed side.
 */

import {
  createHockeyAiState,
  hockeyAiProfile,
  stepHockeyAi,

  DEFAULT_HOCKEY_DIFFICULTY,
  type HockeyAiState,
  type HockeyDifficulty,
} from './ai';
import {
  clampPuck,
  clampToZone,
  clampSpeed,
  detectGoal,
  integratePuck,
  moveMalletToward,
  movePlayerMallet,
  nudgeClearOfMallet,
  resolveMalletSwept,
  resolveWalls,
  sanitisePuck,
  speedOf,
  type HockeySide,
  type MalletState,
  type PuckState,
  type Vec2,
} from './physics';
import {
  COUNTDOWN_MS,
  GOAL_PAUSE_MS,
  MATCH_GOAL_TARGET,
  OPPONENT_HOME,
  OPPONENT_ZONE,
  PLAYER_HOME,
  PLAYER_MALLET_MAX_STRIKE_SPEED,
  PLAYER_ZONE,
  PUCK_MAX_SPEED,
  SERVE_DELAY_MS,
  SERVE_SPEED,
  SERVE_SPREAD_RADIANS,
  TABLE_CENTER_X,
  TABLE_CENTER_Y,
} from './table';

export type HockeyPhase = 'countdown' | 'serve' | 'live' | 'goal' | 'over';

/**
 * Something the presentation layer may want to react to.
 *
 * Returned from the step rather than stored on the state, because an event is a
 * thing that HAPPENED during one step, not a property of the world afterwards.
 * Keeping them out of the state also keeps the state comparable: two identical
 * worlds are `toEqual` even if one of them got there noisily.
 */
export type HockeyEvent =
  | { readonly type: 'wall'; readonly kind: 'side' | 'end'; readonly at: Vec2 }
  | {
      readonly type: 'mallet';
      readonly side: HockeySide;
      readonly at: Vec2;
      /** Closing speed, for scaling a sound or a spark. */
      readonly impact: number;
    }
  | { readonly type: 'goal'; readonly scorer: HockeySide; readonly at: Vec2 }
  | { readonly type: 'serve'; readonly to: HockeySide }
  /** The opening countdown ticked over to a new whole second (3, 2, 1, 0). */
  | { readonly type: 'countdown'; readonly secondsLeft: number }
  /** The countdown ended; the arcade lifecycle should leave `countdown`. */
  | { readonly type: 'countdown-complete' }
  | { readonly type: 'match-over'; readonly winner: HockeySide }
  /** An invalid physics state was caught and recovered from. */
  | { readonly type: 'recovered' };

/** Counters the result carries. Only numbers, so they map straight into `stats`. */
export interface HockeyMatchStats {
  readonly playerHits: number;
  readonly opponentHits: number;
  readonly wallBounces: number;
  /** Fastest the puck ever went this match, in table units per second. */
  readonly topPuckSpeed: number;
}

export interface HockeyMatchState {
  readonly phase: HockeyPhase;
  /** Milliseconds left in `countdown`, `goal` or `serve`. Unused in `live`. */
  readonly timerMs: number;
  readonly puck: PuckState;
  readonly playerMallet: MalletState;
  readonly opponentMallet: MalletState;
  readonly playerScore: number;
  readonly opponentScore: number;
  readonly targetGoals: number;
  readonly difficulty: HockeyDifficulty;
  /** Who scored last. `null` before the first goal. Drives the goal banner. */
  readonly lastScorer: HockeySide | null;
  /** Who the next serve goes to. The side that conceded. */
  readonly serveTo: HockeySide;
  /** Total match time in ms, including the countdown and the pauses. */
  readonly elapsedMs: number;
  readonly ai: HockeyAiState;
  readonly stats: HockeyMatchStats;
  /** Seeded generator state. A plain uint32, so the whole match stays JSON. */
  readonly rngState: number;
}

/** Everything the player can do in one step. */
export interface HockeyInput {
  /**
   * Where the player wants their mallet, in table units.
   *
   * A WANT, not a position: the mallet is clamped into the player's half and
   * rate-limited toward it, so an out-of-bounds or wildly distant target is
   * simply a direction to move in. That is what makes dragging the pointer off
   * the canvas, or a resize landing the pointer somewhere unexpected, harmless
   * rather than exploitable.
   */
  readonly playerTarget: Vec2;
}

export interface HockeyStepResult {
  readonly state: HockeyMatchState;
  readonly events: readonly HockeyEvent[];
}

// ── Seeded randomness ───────────────────────────────────────────────────────

/**
 * mulberry32: a small, well-distributed 32-bit PRNG.
 *
 * Written out rather than pulled in as a dependency: it is nine lines, it needs
 * no cryptographic strength (it picks serve angles), and a match's determinism
 * should not depend on a package version.
 */
function nextRandom(state: number): { value: number; state: number } {
  let a = (state + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  a = a | 0;
  return { value, state: a };
}

/** Turn any string into a seed. Same string, same match. */
export function hockeySeedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ── Construction ────────────────────────────────────────────────────────────

const CENTRE_PUCK: PuckState = Object.freeze({
  x: TABLE_CENTER_X,
  y: TABLE_CENTER_Y,
  vx: 0,
  vy: 0,
});

function restMallet(home: Vec2): MalletState {
  return { x: home.x, y: home.y, vx: 0, vy: 0 };
}

export interface CreateHockeyMatchOptions {
  readonly difficulty?: HockeyDifficulty;
  /** Goals to win. Injectable so a test does not have to play seven points. */
  readonly targetGoals?: number;
  /** Any 32-bit number. Derive one from the run id with {@link hockeySeedFrom}. */
  readonly seed?: number;
}

export function createHockeyMatch({
  difficulty = DEFAULT_HOCKEY_DIFFICULTY,
  targetGoals = MATCH_GOAL_TARGET,
  seed = 1,
}: CreateHockeyMatchOptions = {}): HockeyMatchState {
  // The opening serve is a seeded coin toss, drawn here so it is fixed for the
  // life of the match rather than at the moment of the serve, which means the
  // opening cannot be re-rolled by pausing.
  const toss = nextRandom(seed >>> 0);
  return {
    phase: 'countdown',
    timerMs: COUNTDOWN_MS,
    puck: CENTRE_PUCK,
    playerMallet: restMallet(PLAYER_HOME),
    opponentMallet: restMallet(OPPONENT_HOME),
    playerScore: 0,
    opponentScore: 0,
    targetGoals: Math.max(1, Math.floor(targetGoals)),
    difficulty,
    lastScorer: null,
    serveTo: toss.value < 0.5 ? 'player' : 'opponent',
    elapsedMs: 0,
    ai: createHockeyAiState(CENTRE_PUCK),
    stats: { playerHits: 0, opponentHits: 0, wallBounces: 0, topPuckSpeed: 0 },
    rngState: toss.state,
  };
}

/**
 * Send the puck out of the centre spot toward `side`'s half.
 *
 * The angle is drawn from the seeded generator inside a cone, so serves are
 * varied without ever being a straight gift down the middle, and, because
 * `serveTo` is always the side that conceded, an opponent on a run keeps handing
 * the puck back to the player it is beating.
 */
function serve(
  state: HockeyMatchState,
  playerMallet: MalletState,
  opponentMallet: MalletState,
): { puck: PuckState; rngState: number } {
  const draw = nextRandom(state.rngState);
  const angle = (draw.value * 2 - 1) * SERVE_SPREAD_RADIANS;
  const towardPlayer = state.serveTo === 'player' ? 1 : -1;
  const velocity = clampSpeed(
    Math.sin(angle) * SERVE_SPEED,
    Math.cos(angle) * SERVE_SPEED * towardPlayer,
    PUCK_MAX_SPEED,
  );

  // The centre spot is a legal place for either mallet's CENTRE to stand, the
  // two zones meet on the line, so a player camped there would be handed the
  // puck inside their own mallet, and the next step would read that as a
  // full-strength free hit. Push it clear first, without touching its velocity.
  let puck: PuckState = {
    x: TABLE_CENTER_X,
    y: TABLE_CENTER_Y,
    vx: velocity.vx,
    vy: velocity.vy,
  };
  puck = nudgeClearOfMallet(puck, playerMallet);
  puck = nudgeClearOfMallet(puck, opponentMallet);

  return { puck, rngState: draw.state };
}

// ── The step ────────────────────────────────────────────────────────────────

/**
 * Advance one fixed step.
 *
 * `dt` is in SECONDS and is expected to be the fixed step the loop is driven
 * at. It is an argument rather than a constant so a test can step a whole point
 * in a handful of calls, but nothing in here adapts to it: the tuning assumes a
 * small, regular step, and the loop hook is what guarantees one.
 */
export function stepHockeyMatch(
  state: HockeyMatchState,
  dt: number,
  input: HockeyInput,
): HockeyStepResult {
  if (state.phase === 'over' || dt <= 0) return { state, events: [] };

  const events: HockeyEvent[] = [];
  const elapsedMs = state.elapsedMs + dt * 1000;

  // ── Mallets move in every phase except `over` ────────────────────────────
  //
  // Deliberately: being able to reposition during the countdown and between
  // points is what makes a serve feel like the start of a rally rather than an
  // ambush, and it costs nothing because the puck is frozen.
  //
  // The player's mallet goes exactly where the pointer is, immediately; the
  // opponent's is steered under a speed limit. That asymmetry is the point,
  // see `movePlayerMallet`. Tunnelling is handled below, by sweeping the path
  // both mallets travelled rather than by refusing to let them travel.
  const playerMallet = movePlayerMallet(
    state.playerMallet,
    input.playerTarget,
    dt,
    PLAYER_ZONE,
    PLAYER_MALLET_MAX_STRIKE_SPEED,
  );

  const profile = hockeyAiProfile(state.difficulty);
  let rngState = state.rngState;
  const aiStep = stepHockeyAi({
    state: state.ai,
    puck: state.puck,
    mallet: state.opponentMallet,
    profile,
    dt,
    random: () => {
      const draw = nextRandom(rngState);
      rngState = draw.state;
      return draw.value;
    },
  });
  const opponentMallet = moveMalletToward(
    state.opponentMallet,
    clampToZone(aiStep.target, OPPONENT_ZONE),
    dt,
    { maxSpeed: profile.maxSpeed, arriveRadius: aiStep.arriveRadius },
  );

  const moved: HockeyMatchState = {
    ...state,
    elapsedMs,
    playerMallet,
    opponentMallet,
    ai: aiStep.state,
    rngState,
  };

  // ── Frozen phases: run their timer and nothing else ──────────────────────

  if (moved.phase === 'countdown') {
    const before = Math.ceil(moved.timerMs / 1000);
    const timerMs = moved.timerMs - dt * 1000;
    const after = Math.ceil(timerMs / 1000);
    if (after !== before && after >= 0) events.push({ type: 'countdown', secondsLeft: after });
    if (timerMs > 0) return { state: { ...moved, timerMs }, events };

    events.push({ type: 'countdown-complete' });
    events.push({ type: 'serve', to: moved.serveTo });
    const served = serve(moved, playerMallet, opponentMallet);
    return {
      state: {
        ...moved,
        phase: 'live',
        timerMs: 0,
        puck: served.puck,
        rngState: served.rngState,
        ai: createHockeyAiState(served.puck),
      },
      events,
    };
  }

  if (moved.phase === 'goal') {
    const timerMs = moved.timerMs - dt * 1000;
    if (timerMs > 0) return { state: { ...moved, timerMs }, events };

    const decided =
      moved.playerScore >= moved.targetGoals || moved.opponentScore >= moved.targetGoals;
    if (decided) {
      const winner: HockeySide =
        moved.playerScore > moved.opponentScore ? 'player' : 'opponent';
      events.push({ type: 'match-over', winner });
      return { state: { ...moved, phase: 'over', timerMs: 0 }, events };
    }
    // Back to the centre spot, and both mallets released to reposition.
    return {
      state: { ...moved, phase: 'serve', timerMs: SERVE_DELAY_MS, puck: CENTRE_PUCK },
      events,
    };
  }

  if (moved.phase === 'serve') {
    const timerMs = moved.timerMs - dt * 1000;
    if (timerMs > 0) return { state: { ...moved, timerMs }, events };

    events.push({ type: 'serve', to: moved.serveTo });
    const served = serve(moved, playerMallet, opponentMallet);
    return {
      state: {
        ...moved,
        phase: 'live',
        timerMs: 0,
        puck: served.puck,
        rngState: served.rngState,
        ai: createHockeyAiState(served.puck),
      },
      events,
    };
  }

  // ── `live`: the actual simulation ────────────────────────────────────────

  const checked = sanitisePuck(moved.puck);
  if (checked === null) {
    // Invariant 4. Something produced an impossible puck; take the point back to
    // the centre spot rather than continuing with a broken world.
    events.push({ type: 'recovered' });
    return {
      state: { ...moved, phase: 'serve', timerMs: SERVE_DELAY_MS, puck: CENTRE_PUCK },
      events,
    };
  }

  let puck = integratePuck(checked, dt);

  const walls = resolveWalls(puck);
  puck = walls.puck;
  let wallBounces = moved.stats.wallBounces;
  if (walls.hit) {
    wallBounces += 1;
    events.push({ type: 'wall', kind: walls.hit, at: { x: puck.x, y: puck.y } });
  }

  let playerHits = moved.stats.playerHits;
  let opponentHits = moved.stats.opponentHits;

  const playerContact = resolveMalletSwept(puck, state.playerMallet, playerMallet);
  puck = playerContact.puck;
  if (playerContact.hit) {
    playerHits += 1;
    events.push({
      type: 'mallet',
      side: 'player',
      at: { x: puck.x, y: puck.y },
      impact: playerContact.impactSpeed,
    });
  }

  const opponentContact = resolveMalletSwept(puck, state.opponentMallet, opponentMallet);
  puck = opponentContact.puck;
  if (opponentContact.hit) {
    opponentHits += 1;
    events.push({
      type: 'mallet',
      side: 'opponent',
      at: { x: puck.x, y: puck.y },
      impact: opponentContact.impactSpeed,
    });
  }

  puck = clampPuck(puck, true);

  const topPuckSpeed = Math.max(moved.stats.topPuckSpeed, speedOf(puck));
  const stats: HockeyMatchStats = { playerHits, opponentHits, wallBounces, topPuckSpeed };

  // ── Goals ────────────────────────────────────────────────────────────────
  //
  // Invariant 1: the only place a score changes, and it leaves `live` in the
  // same breath, so the next step cannot see the same puck in the same goal.
  const scorer = detectGoal(puck);
  if (scorer) {
    const playerScore = moved.playerScore + (scorer === 'player' ? 1 : 0);
    const opponentScore = moved.opponentScore + (scorer === 'opponent' ? 1 : 0);
    events.push({ type: 'goal', scorer, at: { x: puck.x, y: puck.y } });
    return {
      state: {
        ...moved,
        phase: 'goal',
        timerMs: GOAL_PAUSE_MS,
        puck: { ...puck, vx: 0, vy: 0 },
        playerScore,
        opponentScore,
        lastScorer: scorer,
        // Invariant 5: the conceding side serves next.
        serveTo: scorer === 'player' ? 'opponent' : 'player',
        stats,
      },
      events,
    };
  }

  return { state: { ...moved, puck, stats }, events };
}

// ── Derived questions the UI asks ───────────────────────────────────────────

export function isMatchOver(state: HockeyMatchState): boolean {
  return state.phase === 'over';
}

/** Who won. `null` until the match is actually over. */
export function matchWinner(state: HockeyMatchState): HockeySide | null {
  if (state.phase !== 'over') return null;
  return state.playerScore > state.opponentScore ? 'player' : 'opponent';
}

/** Whole seconds left on the opening countdown, or `null` outside it. */
export function countdownSeconds(state: HockeyMatchState): number | null {
  if (state.phase !== 'countdown') return null;
  return Math.max(0, Math.ceil(state.timerMs / 1000));
}
