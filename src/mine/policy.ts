/**
 * The Mine's economy policy — pure data and pure functions, in one place.
 *
 * Everything that decides what a mining run is WORTH lives here: the gem
 * table, the drop distribution, what a dig costs, when a run ends, and the
 * daily ceiling on rewarded output. The React component draws the cave; it
 * does not own a single balance number. Nothing here touches Nostr, the
 * wallet, storage or React — settlement remains `mine-settlement.ts`'s job
 * and the durable record remains `mine-session-ledger.ts`'s.
 *
 * ## The Mine's economic role in V1
 *
 * ```
 *   initial allocation  one-time 200 Coins
 *   Beach               repeatable, capped: 10 rewarded hunts per UTC day
 *   Mine                ENERGY CONVERSION, capped per UTC day   ← this module
 *   shop / arcade pass  sinks
 * ```
 *
 * The Mine converts a Blobbi's energy into Coins. That is deliberately not
 * the same shape as the Beach: the Beach is free and paced by a slot count,
 * the Mine is unpaced but consumes a resource the player has to replace.
 *
 * ## Why energy alone is not the boundary
 *
 * Nothing in this client regenerates energy passively — there is no decay or
 * recovery loop, `useWakePet`'s full-energy reset is an optimistic update in
 * an unreferenced example component, and every consumable that restores
 * energy is bought with Coins at a loss (see {@link MINE_COIN_PER_ENERGY}).
 * So one Blobbi's energy really is a hard bound on one player's mining.
 *
 * What energy does NOT bound is the number of Blobbis. Pet state is public
 * Nostr data: a player can arrive holding several Blobbis created elsewhere,
 * switch companion freely, and mine a fresh energy bar with each one. Energy
 * bounds a *Blobbi*; nothing bounded the *account*. And the whole argument
 * above rests on "no regeneration exists", which is a fact about today's code
 * rather than a rule anyone wrote down.
 *
 * {@link MINE_DAILY_COIN_CAP} is that rule, written down. It is a structural
 * backstop, not a throttle on normal play: a single-Blobbi player never
 * reaches it, because they run out of energy first.
 */

/** Every gem the wall can yield. `asset` is the artwork the UI draws. */
export interface MineGemSpec {
  readonly kind: MineGemKind;
  /** Coins this gem contributes to a run's raw reward. */
  readonly value: number;
  /**
   * Exclusive upper bound on the roll that selects this gem — the ORIGINAL
   * cascading threshold, kept as a literal. See the note on the table below.
   */
  readonly threshold: number;
  /** Probability of this gem on one dig, DERIVED from the thresholds. */
  readonly weight: number;
  /** Sprite filename under the mining asset directory. */
  readonly asset: string;
  /** Player-facing name for the results list. */
  readonly label: string;
}

export type MineGemKind = 'stone' | 'gem-1' | 'gem-2' | 'gem-3';

/**
 * The drop table, richest first, keyed by the original THRESHOLDS.
 *
 * ```
 *   roll < 0.05 → gem-3
 *   roll < 0.15 → gem-2
 *   roll < 0.30 → gem-1
 *   otherwise   → stone
 * ```
 *
 * The thresholds are the source of truth and the weights are derived from
 * them, not the other way around. That ordering is not stylistic: summing
 * `0.05 + 0.1` in binary floating point gives `0.15000000000000002`, so a
 * roll of exactly `0.15` — which the original gave to gem-1 — would land on
 * gem-2 instead. Tiny, but it is a real change to the drop odds, and this
 * phase extracts the policy without altering it. The parity sweep in
 * `policy.test.ts` catches exactly this.
 *
 * Values and odds are unchanged from the pre-policy implementation.
 */
const GEM_ROWS = [
  { kind: 'gem-3', value: 50, threshold: 0.05, asset: 'gem-3.png', label: 'Gem 3' },
  { kind: 'gem-2', value: 25, threshold: 0.15, asset: 'gem-2.png', label: 'Gem 2' },
  { kind: 'gem-1', value: 10, threshold: 0.3, asset: 'gem-1.png', label: 'Gem 1' },
  { kind: 'stone', value: 1, threshold: 1, asset: 'stone.png', label: 'Stone' },
] as const satisfies readonly (Omit<MineGemSpec, 'weight'> & { kind: MineGemKind })[];

export const MINE_GEM_TABLE: readonly MineGemSpec[] = Object.freeze(
  GEM_ROWS.map((row, index) =>
    Object.freeze({
      ...row,
      weight: row.threshold - (index === 0 ? 0 : GEM_ROWS[index - 1].threshold),
    }),
  ),
);

const GEM_BY_KIND = new Map(MINE_GEM_TABLE.map((gem) => [gem.kind, gem]));

/** Look up a gem's spec. Throws on an unknown kind rather than paying 0. */
export function mineGem(kind: MineGemKind): MineGemSpec {
  const gem = GEM_BY_KIND.get(kind);
  if (!gem) throw new Error(`Unknown mine gem kind: ${kind}`);
  return gem;
}

/** Energy a single dig costs. */
export const MINE_ENERGY_PER_DIG = 10;

/**
 * The run ends once energy is at or below this. A dig that brings energy to
 * this level is the last one and yields NO gem — the original stop condition,
 * preserved exactly.
 */
export const MINE_MIN_ENERGY = 20;

/**
 * Pick a gem from a uniform `roll` in `[0, 1)`.
 *
 * Deterministic by construction: the caller supplies the randomness, so every
 * test can pin a payout without simulating a distribution.
 */
export function rollMineGem(roll: number): MineGemKind {
  for (const gem of MINE_GEM_TABLE) {
    if (roll < gem.threshold) return gem.kind;
  }
  // Unreachable for a well-formed roll; the last row is the floor.
  return MINE_GEM_TABLE[MINE_GEM_TABLE.length - 1].kind;
}

/** The raw (pre-cap) Coin value of a run's finds. Always a non-negative integer. */
export function mineRunReward(gems: readonly MineGemKind[]): number {
  return gems.reduce((total, kind) => total + mineGem(kind).value, 0);
}

/** Coins one rewarded dig is worth on average. */
export const MINE_EXPECTED_COINS_PER_DIG = MINE_GEM_TABLE.reduce(
  (total, gem) => total + gem.value * gem.weight,
  0,
);

/** Coins one point of Blobbi energy converts to, on average. */
export const MINE_COIN_PER_ENERGY = MINE_EXPECTED_COINS_PER_DIG / MINE_ENERGY_PER_DIG;

/**
 * How many REWARDED digs a run starting at `startEnergy` can make.
 *
 * A dig costs {@link MINE_ENERGY_PER_DIG}; the dig that lands at or below
 * {@link MINE_MIN_ENERGY} ends the run and pays nothing, so the count is one
 * fewer than the raw energy quotient suggests.
 */
export function rewardedDigsForEnergy(startEnergy: number): number {
  let energy = Math.max(0, Math.trunc(startEnergy));
  let digs = 0;
  while (energy > MINE_MIN_ENERGY) {
    energy -= MINE_ENERGY_PER_DIG;
    if (energy <= MINE_MIN_ENERGY) break;
    digs += 1;
  }
  return digs;
}

/** Average Coins a run starting at `startEnergy` yields, before the daily cap. */
export function expectedCoinsForEnergy(startEnergy: number): number {
  return rewardedDigsForEnergy(startEnergy) * MINE_EXPECTED_COINS_PER_DIG;
}

// ── The daily ceiling ──────────────────────────────────────────────────────

/**
 * Most Coins the Mine will pay one account per UTC day.
 *
 * Chosen from the numbers above, not from the Beach's:
 *
 * ```
 *   full 100-energy run   7 rewarded digs x 7.2 = ~50 Coins expected
 *   MINE_DAILY_COIN_CAP   200  =  ~4 such runs
 * ```
 *
 * - **A normal session is never clipped.** One Blobbi has one energy bar, so
 *   the ordinary player earns ~50 and stops for want of energy. (Seven gem-3
 *   rolls in a row would reach 350, but that is a 1-in-1.3-billion run; the
 *   number that matters is the expected ~50.)
 * - **Two, three, four Blobbis still play unclipped**, which matters because
 *   holding several is legitimate — the cap must not punish it.
 * - **Beyond that it binds.** Twenty Blobbis is 200, not ~1000. That is the
 *   scenario energy alone could never bound.
 * - **It coexists with the Beach rather than replacing it.** The Beach pays
 *   roughly 140/day realistically (10 hunts, cap 25 each) for free; the Mine
 *   can pay more in a burst but only by consuming energy that costs Coins to
 *   replace. Different shapes, neither redundant.
 * - **It is legible.** 200 is the initial allocation: at most, a day of
 *   mining hands you your starting purse again.
 *
 * This is a client-side policy over a client-trusted balance, like every
 * other limit in this phase. It bounds honest play and accidents, not a
 * modified client.
 */
export const MINE_DAILY_COIN_CAP = 200;

/** The UTC daily window key for a timestamp: `YYYY-MM-DD`. */
export function mineRewardWindowKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Epoch ms of the next window reset (next UTC midnight). */
export function mineRewardWindowResetAt(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

/** What the day's budget looks like right now. */
export interface MineRewardBudget {
  readonly windowKey: string;
  readonly cap: number;
  /** Coins already committed to runs in this window. */
  readonly awarded: number;
  /** `cap - awarded`, never negative. */
  readonly remaining: number;
  readonly resetsAt: number;
}

/** Build the budget view from an already-summed awarded total. */
export function mineRewardBudget(awarded: number, nowMs: number): MineRewardBudget {
  const safeAwarded = Math.max(0, Math.trunc(awarded));
  return {
    windowKey: mineRewardWindowKey(nowMs),
    cap: MINE_DAILY_COIN_CAP,
    awarded: safeAwarded,
    remaining: Math.max(0, MINE_DAILY_COIN_CAP - safeAwarded),
    resetsAt: mineRewardWindowResetAt(nowMs),
  };
}

export interface CappedMineReward {
  /** What the run actually pays. Integer, `0..remaining`. */
  readonly coinReward: number;
  /** True when the ceiling trimmed the payout — surfaced, never hidden. */
  readonly capped: boolean;
}

/**
 * Apply the day's ceiling to a run's raw reward.
 *
 * Trimming is honest: the results screen reports `capped` so a player is never
 * quietly paid less than the gems they are looking at.
 */
export function capMineReward(rawReward: number, remaining: number): CappedMineReward {
  const raw = Math.max(0, Math.trunc(rawReward));
  const budget = Math.max(0, Math.trunc(remaining));
  const coinReward = Math.min(raw, budget);
  return { coinReward, capped: coinReward < raw };
}
