/**
 * What an Arcade Token costs, in Blobbi Coins, the ONE place that decides.
 *
 * A Coin price is Island economic policy, not a protocol fact, so it lives
 * here and never in the kind:31632 definition. Same reasoning as the shop's
 * `COIN_PRICES`: the definition is published once and shared, the price moves
 * on a balancing clock.
 *
 * ## Why 5 Coins
 *
 * Derived from what a play is worth, not picked round. A game pays out Arcade
 * Tickets, and the arcade's own reward policy bounds that at 8 per run with a
 * typical clear around 6. Against the island's other faucets, the Beach caps
 * near 140 Coins a day, a full Mine run is ~50, a 5-Coin entry means a
 * committed arcade session costs on the order of one Beach day, which is
 * meaningful without being prohibitive. It is also small enough that the
 * initial 200-Coin allocation buys 40 plays, so a new player is not gated out
 * of the arcade on day one.
 *
 * ## No bundles yet, deliberately
 *
 * Discounted bundles were considered and are NOT shipped. A bundle only makes
 * sense once the Ticket-per-Coin rate it implies can be checked against
 * something, and the Pass price, the one sink big enough to make that rate
 * matter: is still an open product decision (see `arcade-pass-policy.ts`).
 * Shipping a discount now would set that rate by accident. One canonical
 * single-unit price first; bundles when there is something to balance them
 * against.
 */

/** Blobbi Coins per Arcade Token. The single source for every surface. */
export const ARCADE_TOKEN_COIN_PRICE = 5;

/** Total Coin cost of `quantity` Tokens. Throws on a nonsensical quantity. */
export function arcadeTokenCoinCost(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(`Token quantity must be a positive integer (got ${quantity})`);
  }
  return quantity * ARCADE_TOKEN_COIN_PRICE;
}

/**
 * The quantities the store offers.
 *
 * Plain multiples of the single-unit price; no discount tiers, see above. The
 * list exists so the UI has one ordered source rather than three literals.
 */
export const ARCADE_TOKEN_PURCHASE_OPTIONS: readonly number[] = Object.freeze([1, 5, 10]);
