/**
 * The Mine's economy policy — pure data and pure functions, in one place.
 *
 * Everything that decides what a mining run is WORTH lives here: the gem
 * table, the drop distribution, what a dig costs and when a run ends. The
 * React component draws the cave; it does not own a single balance number.
 * Nothing here touches Nostr, the wallet, storage or React — settlement
 * remains `mine-settlement.ts`'s job and the durable record remains
 * `mine-session-ledger.ts`'s.
 *
 * ## The Mine's economic role in V1
 *
 * ```
 *   initial allocation  one-time 200 Coins
 *   Beach               repeatable and FREE, so it is capped: 10 rewarded
 *                       hunts per UTC day
 *   Mine                ENERGY → COIN CONVERSION, bounded by energy   ← here
 *   shop / arcade pass  sinks
 * ```
 *
 * The Mine has **no daily Coin cap, no cooldown and no run quota**. It does
 * not need one, because unlike the Beach it is not free: every dig spends a
 * Blobbi's energy, and energy is the limiting resource.
 *
 * ## Why energy is a real boundary
 *
 * Nothing in this client regenerates energy passively — there is no decay or
 * recovery loop, and `useWakePet`'s full-energy reset is an optimistic update
 * in an unreferenced example component that publishes nothing. The only real
 * source of energy is a consumable bought with Coins, and every one of them
 * loses when converted back through mining:
 *
 * ```
 *   a dig pays        MINE_EXPECTED_COINS_PER_DIG (7.2) for 10 energy
 *   so energy is      0.72 Coins each
 *   break-even needs  1.39 energy per Coin
 *   best on offer     the Energy Drink, 35 energy for 30 Coins = 1.17
 * ```
 *
 * So `buy energy → mine → buy more energy` shrinks a balance rather than
 * growing it, and it shrinks faster than that ratio suggests because energy
 * below {@link MINE_MIN_ENERGY} cannot be dug at all — a drink bought at the
 * floor yields three rewarded digs (~21.6 Coins) for 30. `policy.test.ts`
 * asserts this for every purchasable item, so a price cut or an effect buff
 * fails the build rather than quietly opening a faucet.
 *
 * ## Multiple Blobbis are multiple energy bars, on purpose
 *
 * Pet state is public Nostr data, so a player may hold several Blobbis and
 * mine each one's energy. That is accepted as legitimate play: it is bounded
 * by the same non-renewable resource, just more of it, and suppressing it
 * would mean an account-wide limit that punishes ordinary collectors to deter
 * a case that costs nothing.
 *
 * ## When this must be re-audited
 *
 * The model rests on energy being scarce and expensive. Re-audit the Mine
 * economy if ANY of these change:
 *
 * - passive, free or repeatable energy regeneration is introduced (sleep,
 *   time-based recovery, daily refills, quest rewards, anything that returns
 *   energy without spending Coins);
 * - an energy-restoring item's price falls or its `energy` effect rises far
 *   enough that energy costs less than {@link MINE_COIN_PER_ENERGY} per
 *   point — i.e. more than ~1.39 energy per Coin;
 * - the gem table, {@link MINE_ENERGY_PER_DIG} or {@link MINE_MIN_ENERGY}
 *   move, since all three feed that ratio;
 * - Blobbis become cheaply or freely mintable in-app, which would turn "more
 *   Blobbis, more energy" from collecting into farming.
 *
 * No speculative cap is encoded for those futures. The test suite is the
 * tripwire; a limit should be a deliberate decision made when one is needed.
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

/** Average Coins a run starting at `startEnergy` yields. */
export function expectedCoinsForEnergy(startEnergy: number): number {
  return rewardedDigsForEnergy(startEnergy) * MINE_EXPECTED_COINS_PER_DIG;
}
