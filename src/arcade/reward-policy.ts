/**
 * Arcade reward policy — pure, deterministic, and the only place a ticket count
 * is ever derived.
 *
 * **Nothing in this module grants anything.** It converts a finished result into
 * a NUMBER plus a breakdown. Writing that number to an inventory is
 * `arcade-reward-boundary.ts`'s contract and a later phase's implementation.
 *
 * ## The shape, and why it is this shape
 *
 * Each game owns a small policy that answers exactly one question: *how many
 * tickets is this run worth on its own terms?* Everything else — the
 * participation floor, the difficulty multiplier, the first-clear / daily /
 * personal-best bonuses, the daily anti-farming limit and the hard cap — is
 * applied by ONE shared function, {@link calculateTicketAward}.
 *
 * That split is the point. If each game applied its own bonuses, each game would
 * have its own economy, and the sixth one would quietly be ten times the first.
 * A game can only move `base`; it cannot reach the levers.
 *
 * ## Score scales never have to be comparable
 *
 * A rhythm game scoring in the hundreds of thousands and a puzzle scoring in
 * dozens both convert locally. The invariant the tests enforce is on the OUTPUT
 * band, not the input: a normal-difficulty clear must land inside
 * {@link ARCADE_REWARD_TUNING.targetBand} before bonuses, and no policy may
 * exceed its own `maxTicketsPerRun`, which itself may not exceed the hard cap.
 *
 * ## Honesty
 *
 * The award carries a line-by-line breakdown and explicit `capped` /
 * `dailyLimitReached` flags, so the results screen can say "capped at 25" or
 * "daily bonus used up" instead of silently paying less than the sum shown.
 */

import type { ArcadeDifficulty, ArcadeGameResult } from './types';
import { validateArcadeGameResult } from './types';

/**
 * Economy levers. Starting values from `docs/arcade-audit.md` §12.2; every one
 * of them is a product decision that will be tuned, so they live in one frozen
 * object rather than scattered through the arithmetic.
 */
export const ARCADE_REWARD_TUNING = {
  /**
   * Awarded for finishing a run without clearing it. Zero on a loss makes a
   * rhythm game feel punishing and pushes players to quit-and-retry, which costs
   * the economy more than the floor does.
   */
  participationFloor: 2,
  /** Applied to the base only; bonuses are flat by design. */
  difficultyMultipliers: { easy: 1, normal: 1.25, hard: 1.5 } as Record<ArcadeDifficulty, number>,
  bonuses: {
    /** Once ever, per game. */
    firstClear: 10,
    /** Once per UTC day, per game. */
    dailyFirstPlay: 5,
    /** Only when the run also cleared. */
    personalBest: 5,
  },
  /** Nothing may ever pay more than this in one run, whatever a policy says. */
  hardCapPerRun: 25,
  /** After this many rewarded runs of one game in a UTC day, participation only. */
  rewardedRunsPerGamePerDay: 6,
  /** The band a normal-difficulty clear must land in, before bonuses. */
  targetBand: { min: 3, max: 15 },
} as const;

/**
 * A single game's contribution to its own reward.
 *
 * `base` is the ONLY thing a game controls, and it must be pure: same result in,
 * same number out, no clock, no storage, no randomness.
 */
export interface ArcadeRewardPolicy {
  readonly gameId: string;
  /**
   * `draft` policies are placeholders: they exist so the framework has something
   * to exercise, and {@link getProductionRewardPolicy} refuses to return them.
   * Promoting one to `active` is a deliberate product decision, not a side
   * effect of shipping a game.
   */
  readonly status: 'draft' | 'active';
  /** Tickets for a CLEARED run, before floor, multiplier, bonuses and caps. */
  readonly base: (result: ArcadeGameResult) => number;
  /** This game's own ceiling. Must not exceed the shared hard cap. */
  readonly maxTicketsPerRun: number;
}

/** What the app knows about the player's history with this game. */
export interface ArcadeRewardContext {
  /** The player has never cleared this game before. */
  readonly firstClearEver: boolean;
  /** First run of this game this UTC day. */
  readonly firstPlayToday: boolean;
  /** This run beat the player's stored best for this game. */
  readonly newPersonalBest: boolean;
  /** How many runs of this game have already been rewarded today. */
  readonly rewardedRunsToday: number;
}

export const EMPTY_REWARD_CONTEXT: ArcadeRewardContext = {
  firstClearEver: false,
  firstPlayToday: false,
  newPersonalBest: false,
  rewardedRunsToday: 0,
};

/** One line of the breakdown the results screen renders verbatim. */
export interface TicketAwardLine {
  readonly label: string;
  /** Signed contribution in tickets. A multiplier line carries its delta. */
  readonly tickets: number;
  /** Extra context for the UI (e.g. `×1.25 hard`). */
  readonly detail?: string;
}

export interface TicketAward {
  readonly gameId: string;
  readonly runId: string;
  /** Tickets from the game's own policy, before anything shared is applied. */
  readonly base: number;
  /** True when the participation floor replaced a lower base. */
  readonly participationFloorApplied: boolean;
  readonly multiplier: number;
  readonly bonuses: {
    readonly firstClear: number;
    readonly dailyFirstPlay: number;
    readonly personalBest: number;
  };
  /** Sum before caps. */
  readonly subtotal: number;
  /** What the player actually gets. Always an integer ≥ 0. */
  readonly total: number;
  /** A cap reduced the total — say so in the UI. */
  readonly capped: boolean;
  /** The daily anti-farming limit reduced this run to participation only. */
  readonly dailyLimitReached: boolean;
  /** Non-null when the result was rejected outright; `total` is then 0. */
  readonly rejected: string | null;
  readonly breakdown: readonly TicketAwardLine[];
}

function emptyAward(gameId: string, runId: string, rejected: string): TicketAward {
  return {
    gameId,
    runId,
    base: 0,
    participationFloorApplied: false,
    multiplier: 1,
    bonuses: { firstClear: 0, dailyFirstPlay: 0, personalBest: 0 },
    subtotal: 0,
    total: 0,
    capped: false,
    dailyLimitReached: false,
    rejected,
    breakdown: [],
  };
}

/**
 * Convert a finished result into a ticket award.
 *
 * Deterministic: the same `(policy, result, context)` always produces the same
 * award, with no clock and no I/O. The caller supplies the context precisely so
 * that "is this the first play today?" stays a question about data the caller
 * already has, rather than a hidden `Date.now()` inside the economy.
 *
 * Order of operations (documented because it is a product-visible choice):
 * `base → participation floor → × difficulty (rounded) → + flat bonuses → cap`.
 * The multiplier applies to the base only; bonuses are flat so a hard-difficulty
 * first clear cannot compound into an outlier.
 */
export function calculateTicketAward(
  policy: ArcadeRewardPolicy,
  result: ArcadeGameResult,
  context: ArcadeRewardContext = EMPTY_REWARD_CONTEXT,
): TicketAward {
  const validation = validateArcadeGameResult(result);
  if (!validation.ok) {
    return emptyAward(
      policy.gameId,
      result.runId ?? '',
      `invalid result: ${validation.problems.map((p) => `${p.field} ${p.message}`).join('; ')}`,
    );
  }
  if (result.gameId !== policy.gameId) {
    return emptyAward(policy.gameId, result.runId, `result belongs to game ${result.gameId}`);
  }
  if (policy.maxTicketsPerRun > ARCADE_REWARD_TUNING.hardCapPerRun) {
    return emptyAward(policy.gameId, result.runId, 'policy cap exceeds the shared hard cap');
  }

  const tuning = ARCADE_REWARD_TUNING;
  const dailyLimitReached = context.rewardedRunsToday >= tuning.rewardedRunsPerGamePerDay;

  const breakdown: TicketAwardLine[] = [];

  // A run that did not clear, or that lands past the daily limit, pays the
  // participation floor and nothing else. The floor is deliberately visible in
  // the breakdown so "why only 2?" always has an on-screen answer.
  if (!result.cleared || dailyLimitReached) {
    const total = Math.min(tuning.participationFloor, policy.maxTicketsPerRun);
    breakdown.push({
      label: dailyLimitReached ? 'Daily bonus used up' : 'Participation',
      tickets: total,
      detail: dailyLimitReached ? 'come back tomorrow' : undefined,
    });
    return {
      gameId: policy.gameId,
      runId: result.runId,
      base: 0,
      participationFloorApplied: true,
      multiplier: 1,
      bonuses: { firstClear: 0, dailyFirstPlay: 0, personalBest: 0 },
      subtotal: total,
      total,
      capped: total < tuning.participationFloor,
      dailyLimitReached,
      rejected: null,
      breakdown,
    };
  }

  const rawBase = policy.base(result);
  const safeBase = Number.isFinite(rawBase) ? Math.max(0, Math.floor(rawBase)) : 0;
  const participationFloorApplied = safeBase < tuning.participationFloor;
  const base = participationFloorApplied ? tuning.participationFloor : safeBase;
  breakdown.push({ label: 'Clear', tickets: base });

  const multiplier = tuning.difficultyMultipliers[result.difficulty] ?? 1;
  const multiplied = Math.round(base * multiplier);
  if (multiplied !== base) {
    breakdown.push({
      label: 'Difficulty',
      tickets: multiplied - base,
      detail: `×${multiplier} ${result.difficulty}`,
    });
  }

  const bonuses = {
    firstClear: context.firstClearEver ? tuning.bonuses.firstClear : 0,
    dailyFirstPlay: context.firstPlayToday ? tuning.bonuses.dailyFirstPlay : 0,
    personalBest: context.newPersonalBest ? tuning.bonuses.personalBest : 0,
  };
  if (bonuses.firstClear) breakdown.push({ label: 'First clear', tickets: bonuses.firstClear });
  if (bonuses.dailyFirstPlay) {
    breakdown.push({ label: 'First play today', tickets: bonuses.dailyFirstPlay });
  }
  if (bonuses.personalBest) {
    breakdown.push({ label: 'New personal best', tickets: bonuses.personalBest });
  }

  const subtotal =
    multiplied + bonuses.firstClear + bonuses.dailyFirstPlay + bonuses.personalBest;
  const cap = Math.min(policy.maxTicketsPerRun, tuning.hardCapPerRun);
  const total = Math.min(subtotal, cap);
  const capped = total < subtotal;
  if (capped) breakdown.push({ label: 'Capped', tickets: total - subtotal, detail: `max ${cap}` });

  return {
    gameId: policy.gameId,
    runId: result.runId,
    base,
    participationFloorApplied,
    multiplier,
    bonuses,
    subtotal,
    total,
    capped,
    dailyLimitReached: false,
    rejected: null,
    breakdown,
  };
}

// ── Policy registry ────────────────────────────────────────────────────────

/**
 * The dance game's placeholder policy.
 *
 * **`draft`, and it must stay draft until the real rhythm game exists.** Its
 * `base` is a plausible curve over a 0–100 accuracy stat, chosen only so the
 * shared machinery has something non-trivial to exercise and so the band test
 * has a real policy to check. It is not a balancing decision, no beat map has
 * been authored to produce those scores, and nothing consumes it: this phase
 * grants no tickets at all.
 */
export const DANCE_REWARD_POLICY: ArcadeRewardPolicy = {
  gameId: 'blobbi-dance',
  status: 'draft',
  base: (result) => {
    // `accuracy` is a 0..100 percentage the future game will report. A missing
    // stat degrades to the bottom of the band rather than to zero, so a policy
    // bug can never silently pay nothing for a genuine clear.
    const accuracy = result.stats.accuracy;
    if (!Number.isFinite(accuracy)) return ARCADE_REWARD_TUNING.targetBand.min;
    const { min, max } = ARCADE_REWARD_TUNING.targetBand;
    const t = Math.min(1, Math.max(0, accuracy / 100));
    return Math.round(min + t * (max - min));
  },
  maxTicketsPerRun: ARCADE_REWARD_TUNING.hardCapPerRun,
};

const POLICIES: readonly ArcadeRewardPolicy[] = [DANCE_REWARD_POLICY];

/** Every registered policy, draft ones included. Tests iterate this. */
export const arcadeRewardPolicies = POLICIES;

/** Look up a policy by game id, regardless of status. */
export function getRewardPolicy(gameId: string): ArcadeRewardPolicy | undefined {
  return POLICIES.find((p) => p.gameId === gameId);
}

/**
 * Look up a policy that is cleared for production.
 *
 * Returns `undefined` for a draft policy, which is what keeps this phase honest:
 * there is currently NO production policy, so a caller that reaches for one and
 * gets nothing back cannot accidentally pay out.
 */
export function getProductionRewardPolicy(gameId: string): ArcadeRewardPolicy | undefined {
  const policy = getRewardPolicy(gameId);
  return policy?.status === 'active' ? policy : undefined;
}
