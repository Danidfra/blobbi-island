/**
 * What the 24-hour Arcade Pass costs in Arcade Tickets.
 *
 * ## The price is deliberately UNSET
 *
 * {@link ARCADE_PASS_TICKET_PRICE} is `null`, and that is a finding rather than
 * an omission: with the economy as it stands, **the defensible price band is
 * empty**. Two bounds close from opposite sides and cross.
 *
 * ### The floor: ~2540 Tickets, below which the Pass funds itself
 *
 * `rewardedRunsPerGamePerDay` (6) caps the SCALED reward, not play. After the
 * sixth run of a game, every further run still pays the `participationFloor`
 * (2 Tickets), with no daily ceiling and no cooldown. At the shortest game's own
 * estimated length that is a sustained ~106 Tickets/hour
 * ({@link sustainedTicketFloorPerHour}) for as long as the player keeps going.
 *
 * A Pass costs nothing to use, so every hour under one is pure Ticket income.
 * The loop — play → earn → redeem a Pass → play free → earn more — therefore
 * closes at {@link selfFundingThresholdTickets}: the rate times the Pass's own
 * 24-hour life, about **2540 Tickets**. Price it below that and a grinder never
 * spends another Coin on Tokens, which permanently disables the Coin → Token
 * sink the Pass sits in front of — the only Coin sink the arcade has.
 *
 * ### The ceiling: 2500 Tickets, the most expensive permanent prize
 *
 * The Pass shares a shelf and a currency with the prize catalog, whose headline
 * item (`celestial-aura`) is a PERMANENT cosmetic at 2500 Tickets. A consumable
 * that expires in a day cannot cost more than the permanent headline without
 * making the shelf incoherent, and in a sane ladder it would sit well below it.
 *
 * ### Floor > ceiling
 *
 * 2540 > 2500, and that is before allowing the Pass any discount for being
 * temporary. There is no number in between, so there is no number to pick.
 *
 * ## What has to change first
 *
 * The band opens as soon as one bound moves. In rough order of how much they
 * disturb the rest of the economy:
 *
 * - **Bound the Pass.** Make it N free plays within 24 hours rather than
 *   unlimited ones. Income under the Pass stops being uncapped, the floor drops
 *   away from 2540, and a price can be set against a real number. Smallest
 *   change; keeps the Pass a Ticket prize.
 * - **Bound the supply.** Add a real per-day Ticket ceiling that the
 *   participation floor also counts against. This lowers the floor directly,
 *   and fixes the same exposure on the PRIZE shelf — the 2500-Ticket headline
 *   prize is itself about a day of floor grinding today.
 * - **Move the Pass out of Tickets.** Price it in Coins, so it stays inside the
 *   sink instead of bypassing it. Cheapest to ship, but it abandons the
 *   three-layer design the Pass was introduced for.
 *
 * Until one of those lands, {@link arcadePassAvailability} reports `unpriced`
 * and no production surface offers the Pass for sale. The entitlement itself is
 * complete and correct — it is only unobtainable.
 */

import { ARCADE_REWARD_TUNING } from '@/arcade/reward-policy';
import { ARCADE_CATALOGUE } from '@/arcade/catalogue';
import { ARCADE_PASS_DURATION_MS } from './arcade-pass-entitlement';
import { ARCADE_TOKEN_COIN_PRICE } from '@/arcade/tokens/token-store';

/**
 * The Pass price in Arcade Tickets, or `null` while it is undecided.
 *
 * A number here is a product decision that must be made together with one of
 * the changes in this module's header. Setting it alone ships a Pass that is
 * either self-funding or more expensive than the permanent headline prize;
 * `arcade-pass-policy.test.ts` fails loudly with the offending number either
 * way.
 */
export const ARCADE_PASS_TICKET_PRICE: number | null = null;

/** Pass length in hours, for reasoning about the numbers above. */
export const ARCADE_PASS_DURATION_HOURS = ARCADE_PASS_DURATION_MS / (60 * 60 * 1000);

/** Whether the Pass can currently be obtained, and why not when it cannot. */
export type ArcadePassAvailability =
  | { readonly kind: 'purchasable'; readonly ticketPrice: number }
  | { readonly kind: 'unpriced'; readonly reason: string };

export function arcadePassAvailability(
  ticketPrice: number | null = ARCADE_PASS_TICKET_PRICE,
): ArcadePassAvailability {
  if (ticketPrice === null) {
    return {
      kind: 'unpriced',
      reason:
        'The Arcade Pass has no Ticket price yet: Ticket supply has no daily ceiling and the Pass waives unlimited plays, so every price is self-funding.',
    };
  }
  return { kind: 'purchasable', ticketPrice };
}

/**
 * The shortest game's estimated length, in ms.
 *
 * The floor rate is set by whatever a player can finish fastest, not by an
 * average across the three games — a farmer picks the quickest one.
 */
export function shortestGameDurationMs(
  catalogue: readonly { estimatedDurationMs?: number }[] = ARCADE_CATALOGUE,
): number | null {
  const durations = catalogue
    .map((entry) => entry.estimatedDurationMs)
    .filter((ms): ms is number => typeof ms === 'number' && Number.isFinite(ms) && ms > 0);
  return durations.length > 0 ? Math.min(...durations) : null;
}

/**
 * Tickets per hour a player can sustain INDEFINITELY, after every game's daily
 * scaled reward is exhausted.
 *
 * Uses the participation floor and the shortest game, because that is the
 * combination that has no cap on it. Deliberately optimistic about the player
 * (no break between runs) and therefore honest about the economy: this is the
 * rate the design has to survive, not the rate a typical player achieves.
 */
export function sustainedTicketFloorPerHour(
  tuning: { participationFloor: number } = ARCADE_REWARD_TUNING,
  shortestMs: number | null = shortestGameDurationMs(),
): number | null {
  if (shortestMs === null || shortestMs <= 0) return null;
  const runsPerHour = (60 * 60 * 1000) / shortestMs;
  return runsPerHour * tuning.participationFloor;
}

/**
 * The price below which a Pass pays for its own replacement.
 *
 * The sustained floor rate times the Pass's own life: a player grinding under a
 * Pass for its full 24 hours earns this many Tickets, all of it profit, because
 * the Pass waived every Token they would otherwise have bought.
 *
 * `null` when the floor rate cannot be derived (no game has an estimated
 * length), which is itself a reason not to price anything.
 */
export function selfFundingThresholdTickets(
  ticketsPerHour: number | null = sustainedTicketFloorPerHour(),
  passDurationHours: number = ARCADE_PASS_DURATION_HOURS,
): number | null {
  if (ticketsPerHour === null || ticketsPerHour <= 0) return null;
  return ticketsPerHour * passDurationHours;
}

/** The inputs a self-funding check needs, all injectable so tests can vary them. */
export interface PassSelfFundingInput {
  /** Candidate Ticket price for one 24-hour Pass. */
  readonly ticketPrice: number;
  /** Hours the player actually spends in the arcade during the Pass. */
  readonly hoursPlayedPerPass: number;
  /** Sustained Ticket floor rate; defaults to the live one. */
  readonly ticketsPerHour?: number | null;
}

export interface PassSelfFundingResult {
  /** True when a Pass pays for the next Pass, closing the loop. */
  readonly selfFunding: boolean;
  /** Tickets earned across `hoursPlayedPerPass`. */
  readonly ticketsEarned: number;
  /**
   * Hours of play needed to earn one Pass back, or `null` when the floor rate
   * is unknown.
   */
  readonly hoursToBreakEven: number | null;
}

/**
 * Does a Pass at this price pay for its own replacement?
 *
 * The Pass costs nothing to USE, so every hour under it is pure Ticket income.
 * If income over the hours actually played reaches the price, the player never
 * spends a Coin on Tokens again and the sink is gone.
 */
export function isSelfFundingPassPrice(input: PassSelfFundingInput): PassSelfFundingResult {
  const rate = input.ticketsPerHour ?? sustainedTicketFloorPerHour();
  if (rate === null || rate <= 0) {
    return { selfFunding: false, ticketsEarned: 0, hoursToBreakEven: null };
  }
  const ticketsEarned = rate * Math.max(0, input.hoursPlayedPerPass);
  return {
    selfFunding: ticketsEarned >= input.ticketPrice,
    ticketsEarned,
    hoursToBreakEven: input.ticketPrice / rate,
  };
}

/**
 * What a Pass is worth in Coins to a player who starts `plays` games under it.
 *
 * Unbounded by construction — which is half of why the price is unset. Exposed
 * so the eventual decision is made against a number rather than a feeling.
 */
export function passCoinValueForPlays(
  plays: number,
  tokenCoinPrice: number = ARCADE_TOKEN_COIN_PRICE,
): number {
  return Math.max(0, plays) * tokenCoinPrice;
}
