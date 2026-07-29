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
import { DANCE_REWARD_POLICY } from './dance/dance-reward';
import { HOCKEY_REWARD_POLICY } from './hockey/hockey-reward';
import { POOL_REWARD_POLICY } from './pool/pool-reward';

export { DANCE_REWARD_POLICY, HOCKEY_REWARD_POLICY, POOL_REWARD_POLICY };

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
/**
 * How much of the shared economy a policy opts into.
 *
 * - **`scaled`** — the full pipeline: participation floor, difficulty
 *   multiplier, first-clear / daily / personal-best bonuses, then the caps.
 * - **`flat`** — the policy's own `base` IS the award, subject only to the
 *   participation floor and the caps. The difficulty multiplier and the history
 *   bonuses are skipped.
 *
 * `flat` is not a loophole: a flat policy still cannot exceed the shared hard
 * cap, still cannot pay below the participation floor for a clear, and still
 * goes through this one function. It exists because a bonus the app cannot
 * SUBSTANTIATE must not be paid — the dance game ships with no first-clear
 * ledger, no personal-best store and no per-day rewarded-run counter, so a
 * `scaled` dance policy would have to be fed a context of permanent `false`s and
 * would advertise bonuses that can never fire.
 */
export type ArcadeRewardShape = 'scaled' | 'flat';

export interface ArcadeRewardPolicy {
  readonly gameId: string;
  /**
   * Stable identity of the POLICY, distinct from the game's id. A game may
   * eventually be re-tuned into a second policy while keeping its id; a claim
   * records which policy paid it.
   */
  readonly policyId: string;
  /**
   * Bumped whenever the numbers change. Recorded on the reward calculation so a
   * support question about "why did I get 4?" has a version to answer against.
   */
  readonly version: number;
  /**
   * `draft` policies are placeholders: they exist so the framework has something
   * to exercise, and {@link getProductionRewardPolicy} refuses to return them.
   * Promoting one to `active` is a deliberate product decision, not a side
   * effect of shipping a game.
   */
  readonly status: 'draft' | 'active';
  readonly shape: ArcadeRewardShape;
  /** Tickets for a CLEARED run, before floor, multiplier, bonuses and caps. */
  readonly base: (result: ArcadeGameResult) => number;
  /**
   * Optional player-facing decomposition of `base` for a cleared run.
   *
   * Purely presentational: the shared layer uses these lines in the breakdown
   * ONLY when every line has a non-empty label (after trimming) that is unique
   * within the breakdown and a non-negative integer ticket value, and the lines
   * sum to exactly what `base` returned. Anything else falls back to the single
   * `Clear` line — a policy cannot pay a different number, hide a deduction, or
   * double-render a line by describing itself creatively. Games with several
   * visible reasons (victory, difficulty, margin) use this so the results
   * screen can say why; a policy without one gets the single line, as the dance
   * policy always has.
   */
  readonly baseBreakdown?: (result: ArcadeGameResult) => readonly TicketAwardLine[];
  /** This game's own ceiling. Must not exceed the shared hard cap. */
  readonly maxTicketsPerRun: number;
  /**
   * Extra eligibility rule the game owns, evaluated BEFORE any arithmetic.
   *
   * Returns a reason string to refuse, or `null` to allow. The dance game uses
   * it to refuse a run that did not reach the end of the song, which is the one
   * thing the shared layer cannot know: `ArcadeGameResult` has no "was this run
   * interrupted?" field, and inventing one would put a game-specific concept in
   * the shared contract.
   */
  readonly ineligible?: (result: ArcadeGameResult) => string | null;
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
  // A game-owned refusal runs before any arithmetic, so an ineligible run has no
  // award to accidentally read a total off.
  const gameRefusal = policy.ineligible?.(result) ?? null;
  if (gameRefusal) {
    return emptyAward(policy.gameId, result.runId, gameRefusal);
  }

  const tuning = ARCADE_REWARD_TUNING;
  const isFlat = policy.shape === 'flat';
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

  // A policy may decompose its base into the lines a player is shown, but the
  // lines are presentation only and must not be able to MISREPRESENT the paid
  // reward. They are used exactly when every line carries a non-empty label
  // (after trimming) that is unique within the breakdown and a non-negative
  // integer ticket value, and the lines add up to the base actually paid; the
  // single `Clear` line remains the truth otherwise. Whatever the lines say,
  // `base` — and therefore the quantity granted — is computed above from
  // `policy.base` alone.
  const baseLines = participationFloorApplied ? undefined : policy.baseBreakdown?.(result);
  const seenLabels = new Set<string>();
  const baseLinesValid =
    baseLines !== undefined &&
    baseLines.length > 0 &&
    baseLines.every((line) => {
      const label = typeof line.label === 'string' ? line.label.trim() : '';
      if (
        label.length === 0 ||
        seenLabels.has(label) ||
        !Number.isInteger(line.tickets) ||
        line.tickets < 0
      ) {
        return false;
      }
      seenLabels.add(label);
      return true;
    }) &&
    baseLines.reduce((sum, line) => sum + line.tickets, 0) === base;
  if (baseLinesValid) breakdown.push(...baseLines);
  else breakdown.push({ label: 'Clear', tickets: base });

  // A flat policy declines the multiplier and the history bonuses; it does NOT
  // decline the floor above or the caps below.
  const multiplier = isFlat ? 1 : (tuning.difficultyMultipliers[result.difficulty] ?? 1);
  const multiplied = Math.round(base * multiplier);
  if (multiplied !== base) {
    breakdown.push({
      label: 'Difficulty',
      tickets: multiplied - base,
      detail: `×${multiplier} ${result.difficulty}`,
    });
  }

  const bonuses = {
    firstClear: !isFlat && context.firstClearEver ? tuning.bonuses.firstClear : 0,
    dailyFirstPlay: !isFlat && context.firstPlayToday ? tuning.bonuses.dailyFirstPlay : 0,
    personalBest: !isFlat && context.newPersonalBest ? tuning.bonuses.personalBest : 0,
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

// ── Structured reward calculation ──────────────────────────────────────────

/**
 * The full, self-describing answer to "what is this run worth, and may it be
 * paid?" — the object the claim boundary and the results UI both read.
 *
 * It exists on top of {@link TicketAward} because an award answers only "how
 * many". A claim needs to know WHICH item, under WHICH policy version, and
 * whether it is allowed at all — and a UI that has to infer "not eligible" from
 * `total === 0` will eventually infer it wrongly.
 *
 * **Computing one performs no writes.** It touches no storage, no relay and no
 * clock; the caller supplies the item address, so this module still holds no
 * inventory identity of its own.
 */
export interface ArcadeRewardCalculation {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly gameId: string;
  readonly runId: string;
  /** Canonical kind:31632 address of the item to grant. Supplied by the caller. */
  readonly itemAddress: string;
  /** Units to grant. Always `0` when `eligible` is false. */
  readonly quantity: number;
  readonly eligible: boolean;
  /** Why not, when `eligible` is false. Null otherwise. */
  readonly ineligibleReason: string | null;
  /** Line-by-line reasons, rendered verbatim by the results screen. */
  readonly components: readonly TicketAwardLine[];
  readonly capApplied: boolean;
  /** The ceiling that was in force, whether or not it bit. */
  readonly cap: number;
  /** The underlying award, for callers that want the raw arithmetic. */
  readonly award: TicketAward;
}

export interface CalculateArcadeRewardInput {
  readonly policy: ArcadeRewardPolicy;
  readonly result: ArcadeGameResult;
  /** Canonical kind:31632 address of the reward item. */
  readonly itemAddress: string;
  readonly context?: ArcadeRewardContext;
  /**
   * Set to `false` to evaluate a DRAFT policy for inspection (the DEV harness
   * does this). Production callers must leave it `true`, which is what makes a
   * draft policy unable to pay.
   */
  readonly requireProductionPolicy?: boolean;
}

/**
 * Turn a finished result into a payable — or explicitly unpayable — grant.
 *
 * Eligibility is refused, in this order, for: a non-production policy, a missing
 * or malformed item address, a rejected award (invalid result, wrong game, the
 * game's own refusal), and a zero total. Each returns a reason a human can read,
 * because "not eligible" with no explanation is the copy that makes players
 * think the arcade is broken.
 */
export function calculateArcadeReward(input: CalculateArcadeRewardInput): ArcadeRewardCalculation {
  const { policy, result, itemAddress, context, requireProductionPolicy = true } = input;
  const award = calculateTicketAward(policy, result, context);
  const cap = Math.min(policy.maxTicketsPerRun, ARCADE_REWARD_TUNING.hardCapPerRun);

  const base = {
    policyId: policy.policyId,
    policyVersion: policy.version,
    gameId: policy.gameId,
    runId: award.runId,
    itemAddress,
    components: award.breakdown,
    capApplied: award.capped,
    cap,
    award,
  } as const;

  const refuse = (reason: string): ArcadeRewardCalculation => ({
    ...base,
    quantity: 0,
    eligible: false,
    ineligibleReason: reason,
  });

  if (requireProductionPolicy && policy.status !== 'active') {
    return refuse('this game has no production reward policy yet');
  }
  if (typeof itemAddress !== 'string' || itemAddress.trim().length === 0) {
    return refuse('no reward item address was supplied');
  }
  if (award.rejected !== null) return refuse(award.rejected);
  if (!Number.isInteger(award.total) || award.total <= 0) {
    return refuse('this run earned no tickets');
  }

  return { ...base, quantity: award.total, eligible: true, ineligibleReason: null };
}

// ── Policy registry ────────────────────────────────────────────────────────

const POLICIES: readonly ArcadeRewardPolicy[] = [
  DANCE_REWARD_POLICY,
  HOCKEY_REWARD_POLICY,
  POOL_REWARD_POLICY,
];

/** Every registered policy, draft ones included. Tests iterate this. */
export const arcadeRewardPolicies = POLICIES;

/** Look up a policy by game id, regardless of status. */
export function getRewardPolicy(gameId: string): ArcadeRewardPolicy | undefined {
  return POLICIES.find((p) => p.gameId === gameId);
}

/**
 * Look up a policy that is cleared for production.
 *
 * Returns `undefined` for a draft policy, so a game whose policy has not been
 * deliberately promoted cannot pay out. All three dedicated games — dance,
 * air hockey and pool — now carry an `active` policy; a fourth game starts as
 * `draft` and gets nothing back from here until promoted.
 */
export function getProductionRewardPolicy(gameId: string): ArcadeRewardPolicy | undefined {
  const policy = getRewardPolicy(gameId);
  return policy?.status === 'active' ? policy : undefined;
}
