/**
 * Blobbi Island arcade, the shared, serialisable contracts every arcade game
 * speaks.
 *
 * This module is the boundary between "a game ran" and "something happened as a
 * result". It is deliberately tiny and deliberately dumb:
 *
 *  - **no React**: no components, no refs, no hooks;
 *  - **no Nostr**: no events, no addresses, no signers;
 *  - **no inventory**: no quantities, no item addresses, no ticket counts;
 *  - **no functions**: everything here is data that survives `JSON.stringify`.
 *
 * A run's outcome is a plain object that can be written to `localStorage`,
 * compared, replayed in a test, and (much later, if the product decides so)
 * published. Nothing downstream may recompute a score from it, and nothing
 * inside it may reference a live controller.
 *
 * ## What is NOT here
 *
 * A leaderboard shape. `ArcadeGameResult` is a *local* record; giving it a
 * publication shape now would invent protocol for a feature nobody has designed.
 * When a leaderboard exists it can be derived from this, additively.
 */

/**
 * Difficulty is part of the run REQUEST, echoed into the result, and an input to
 * the reward policy. It is a closed set on purpose: an open string would let a
 * future game invent `"impossible"` and quietly bypass the difficulty
 * multiplier table.
 */
export const ARCADE_DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type ArcadeDifficulty = (typeof ARCADE_DIFFICULTIES)[number];

export function isArcadeDifficulty(value: unknown): value is ArcadeDifficulty {
  return typeof value === 'string' && (ARCADE_DIFFICULTIES as readonly string[]).includes(value);
}

/**
 * Everything a finished run produced.
 *
 * ## Immutability
 *
 * A result is created ONCE, when the game ends, and never edited. The lifecycle
 * reducer refuses to replace an existing result (see
 * `arcade-machine-state.ts`), and the reward policy only reads it. `Readonly`
 * here is a compile-time reminder; the runtime guarantee is the reducer's.
 *
 * ## Per-game statistics
 *
 * `stats` is an open map of NUMBERS, `maxCombo`, `accuracy`, `perfects`,
 * `timeMs`, whatever a given game measures. It is open because forcing every
 * game into one stat shape is how you end up with a rhythm game reporting
 * `laps: 0`. It is numbers-only because the results UI renders it generically
 * and the reward policy may read from it; a nested object or a string here would
 * mean either could not.
 */
export interface ArcadeGameResult {
  /** Idempotency key, minted exactly once when the run begins. */
  readonly runId: string;
  /** Stable game identity (e.g. `blobbi-dance`): never an item id or address. */
  readonly gameId: string;
  /** Which physical machine the run happened on. */
  readonly machineId: string;
  readonly difficulty: ArcadeDifficulty;
  /** Did the player meet the game's own clear condition? */
  readonly cleared: boolean;
  /** Game-local score. Scales are NOT comparable between games, by design. */
  readonly score: number;
  /** Epoch ms when play started (after the countdown). */
  readonly startedAt: number;
  /** Epoch ms when the game ended. */
  readonly endedAt: number;
  /** Per-game numeric statistics. */
  readonly stats: Readonly<Record<string, number>>;
  /**
   * Optional deterministic seed for the run.
   *
   * Carried from day one although nothing generates one yet: "beat my score on
   * this seed" is the cheapest interesting Nostr feature the arcade could later
   * ship, and retrofitting a field into a persisted result shape is worse than
   * reserving it now. Absent means "not a seeded run", never "seed 0".
   */
  readonly seed?: string;
}

/** Why a result was rejected. One entry per problem, in field order. */
export interface ArcadeResultProblem {
  readonly field: string;
  readonly message: string;
}

export type ArcadeResultValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly problems: readonly ArcadeResultProblem[] };

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Reject impossible or malformed results **before** any reward is evaluated.
 *
 * This is not anti-cheat, a client-authored score cannot be verified client
 * side, and the docs say so plainly. It is a correctness gate: it stops `NaN`
 * scores, negative durations, `Infinity` stats and non-serialisable payloads
 * from reaching the reward policy, where they would produce a nonsense award or
 * a persisted claim that can never be replayed.
 */
export function validateArcadeGameResult(result: ArcadeGameResult): ArcadeResultValidation {
  const problems: ArcadeResultProblem[] = [];
  const fail = (field: string, message: string) => problems.push({ field, message });

  if (!isNonEmptyString(result.runId)) fail('runId', 'must be a non-empty string');
  if (!isNonEmptyString(result.gameId)) fail('gameId', 'must be a non-empty string');
  if (!isNonEmptyString(result.machineId)) fail('machineId', 'must be a non-empty string');
  if (!isArcadeDifficulty(result.difficulty)) {
    fail('difficulty', `must be one of ${ARCADE_DIFFICULTIES.join(', ')}`);
  }
  if (typeof result.cleared !== 'boolean') fail('cleared', 'must be a boolean');

  if (!isFiniteNumber(result.score)) fail('score', 'must be a finite number');
  else if (result.score < 0) fail('score', 'must not be negative');
  else if (!Number.isInteger(result.score)) fail('score', 'must be an integer');

  if (!isFiniteNumber(result.startedAt) || result.startedAt <= 0) {
    fail('startedAt', 'must be a positive epoch-ms timestamp');
  }
  if (!isFiniteNumber(result.endedAt) || result.endedAt <= 0) {
    fail('endedAt', 'must be a positive epoch-ms timestamp');
  }
  if (
    isFiniteNumber(result.startedAt) &&
    isFiniteNumber(result.endedAt) &&
    result.endedAt < result.startedAt
  ) {
    fail('endedAt', 'must not precede startedAt');
  }

  if (result.stats === null || typeof result.stats !== 'object' || Array.isArray(result.stats)) {
    fail('stats', 'must be a plain object of numbers');
  } else {
    for (const [key, value] of Object.entries(result.stats)) {
      if (!isFiniteNumber(value)) fail(`stats.${key}`, 'must be a finite number');
    }
  }

  if (result.seed !== undefined && !isNonEmptyString(result.seed)) {
    fail('seed', 'when present, must be a non-empty string');
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/**
 * Report every path inside `value` that JSON cannot represent.
 *
 * `JSON.stringify` is useless as a check on its own: it silently DROPS
 * functions, symbols and `undefined` properties and happily returns valid JSON,
 * so a result carrying a live controller reference would "serialise" while
 * losing exactly the thing that made it wrong. This walks the value instead and
 * names what it found.
 *
 * Used by tests and by the reward boundary before a pending claim is persisted:
 * a result that cannot be serialised cannot survive the refresh-mid-claim
 * recovery path, so it must never enter it.
 */
export function findNonSerialisable(value: unknown, path = ''): string[] {
  const here = path || '<root>';

  if (value === null) return [];
  const type = typeof value;

  if (type === 'string' || type === 'boolean') return [];
  if (type === 'number') return Number.isFinite(value as number) ? [] : [here];
  if (type === 'function' || type === 'symbol' || type === 'bigint' || type === 'undefined') {
    return [here];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, i) => findNonSerialisable(entry, `${path}[${i}]`));
  }

  // Only plain objects survive a round trip with their identity intact. A Map,
  // a Date or a class instance becomes something else on the way back.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return [here];

  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
    // An `undefined` PROPERTY is simply dropped by JSON and nothing is lost, so
    // an unset optional field (`seed`) is not a serialisation problem. An
    // `undefined` inside an ARRAY becomes `null` and IS one; hence the split.
    entry === undefined ? [] : findNonSerialisable(entry, path ? `${path}.${key}` : key),
  );
}

/** Convenience predicate over {@link findNonSerialisable}. */
export function isJsonSerialisable(value: unknown): boolean {
  return findNonSerialisable(value).length === 0;
}
