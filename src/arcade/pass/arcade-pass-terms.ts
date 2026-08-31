/**
 * The three numbers that define an Arcade Pass, in one place.
 *
 * A dependency-free module on purpose. The entitlement needs the duration and
 * the allowance to grant a pass; the policy needs all three to prove the price
 * is defensible; the UI needs them to describe the offer. If they lived in the
 * entitlement the policy would import it, and if they lived in the policy the
 * entitlement would — so they live below both.
 *
 * ## The Pass, in one sentence
 *
 * 24 hours in which to use 15 free game starts, whichever runs out first.
 *
 * ## Why the allowance exists at all
 *
 * The Pass originally waived Token costs for the whole 24 hours, without limit.
 * That was unpriceable: the reward policy keeps paying a participation floor
 * after a game's daily scaled runs are gone, so Ticket income has no ceiling in
 * time — and a Pass that waives unlimited plays has no ceiling in value either.
 * Any price a determined player could reach by grinding was self-funding, and a
 * self-funding Pass permanently removes the Coin → Token sink.
 *
 * Bounding the PLAYS fixes both ends at once: the most a Pass can ever return
 * is `ARCADE_PASS_FREE_PLAYS × maxTicketsPerRun`, a finite number the price can
 * be set above. `arcade-pass-policy.ts` carries that arithmetic and the test
 * that keeps it true.
 */

/** How long a redeemed pass lasts before it expires, used or not. */
export const ARCADE_PASS_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Free game starts included with one Pass.
 *
 * Fifteen, and not more, because the reward policy grants full scaled rewards
 * for only `rewardedRunsPerGamePerDay` (6) runs of each of the three games —
 * 18 full-value runs in a UTC day. An allowance at or under 18 is worth the
 * same whenever it is redeemed. Push it past 18 and the offer starts depending
 * on how close midnight UTC is, which is a worse thing to explain than it is to
 * avoid.
 *
 * Fifteen is also enough to matter: at one Token per play it waives 75 Coins,
 * and it is comfortably usable inside a day (15 rounds of the shortest game is
 * about 17 minutes; of the longest, an hour).
 */
export const ARCADE_PASS_FREE_PLAYS = 15;

/**
 * What one Pass costs in Arcade Tickets.
 *
 * 180, chosen against the bound rather than a feeling:
 *
 * - The most a Pass can return is 15 plays × 8 Tickets (`maxTicketsPerRun`,
 *   equal for all three games) = **120**. Every play is a paid-for run, so a
 *   perfect player recovers at most two thirds of the price and still has to
 *   fund the rest from Token-charged play. The sink survives.
 * - It sits below the cheapest permanent prize (200 Tickets) — correct for a
 *   consumable that expires in a day, next to cosmetics you keep forever — and
 *   far below the 2500-Ticket headline.
 * - At a realistic ~6 Tickets per rewarded run it is a little under two days of
 *   ordinary play: premium, but not aspirational.
 *
 * `arcade-pass-policy.test.ts` re-derives the 120 from the live reward policies
 * and fails if this number ever stops clearing it.
 */
export const ARCADE_PASS_TICKET_PRICE = 180;
