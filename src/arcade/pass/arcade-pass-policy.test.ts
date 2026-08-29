/**
 * Why the Arcade Pass has no Ticket price, kept honest by arithmetic.
 *
 * This file is the evidence behind `arcade-pass-policy.ts`'s header. It does
 * two jobs:
 *
 *  1. It computes the actual numbers from the LIVE reward tuning and catalogue,
 *     so the finding cannot quietly stop being true after a rebalance.
 *  2. It stops a price from being set on its own. Setting
 *     `ARCADE_PASS_TICKET_PRICE` without also bounding one side of the trade
 *     fails here, with the reason attached.
 */
import { describe, it, expect } from 'vitest';

import {
  ARCADE_PASS_DURATION_HOURS,
  ARCADE_PASS_TICKET_PRICE,
  arcadePassAvailability,
  isSelfFundingPassPrice,
  passCoinValueForPlays,
  selfFundingThresholdTickets,
  shortestGameDurationMs,
  sustainedTicketFloorPerHour,
} from './arcade-pass-policy';
import { ARCADE_REWARD_TUNING } from '@/arcade/reward-policy';
import { OFFICIAL_ARCADE_PRIZE_CATALOG } from '@/arcade/prizes/official-prize-catalog';

describe('the supply side has no ceiling', () => {
  it('keeps paying the participation floor after the daily rewarded runs are gone', () => {
    // `rewardedRunsPerGamePerDay` caps the SCALED reward, not play. This is the
    // fact the whole finding rests on, so it is asserted rather than assumed.
    expect(ARCADE_REWARD_TUNING.rewardedRunsPerGamePerDay).toBeGreaterThan(0);
    expect(ARCADE_REWARD_TUNING.participationFloor).toBeGreaterThan(0);
    expect(ARCADE_REWARD_TUNING).not.toHaveProperty('ticketsPerDayCap');
    expect(ARCADE_REWARD_TUNING).not.toHaveProperty('runsPerDayCap');
  });

  it('sustains a real Ticket rate indefinitely, set by the shortest game', () => {
    const shortest = shortestGameDurationMs();
    expect(shortest).not.toBeNull();

    const rate = sustainedTicketFloorPerHour();
    expect(rate).not.toBeNull();
    // ~106 Tickets/hour today: 2 Tickets per ~68-second Dance run. Loose bounds
    // so a tuning change moves the number without failing the point.
    expect(rate!).toBeGreaterThan(50);
  });

  it('reaches the headline prize inside a day of floor grinding', () => {
    // The PRIZE shelf has the same exposure as the Pass; the Pass just makes it
    // impossible to ignore. 2500 Tickets is the most expensive prize there is.
    const headline = Math.max(...OFFICIAL_ARCADE_PRIZE_CATALOG.map((p) => p.tickets));
    const rate = sustainedTicketFloorPerHour()!;

    expect(headline / rate).toBeLessThan(24);
  });
});

describe('the value side has no ceiling either', () => {
  it('is worth more the more you play, without limit', () => {
    // The Pass waives the Token cost of every play for 24 hours, so its Coin
    // value is however many games the player chooses to start.
    expect(passCoinValueForPlays(20)).toBeLessThan(passCoinValueForPlays(200));
    expect(passCoinValueForPlays(0)).toBe(0);
  });

  it('runs for a full day, which is what makes that unbounded in practice', () => {
    expect(ARCADE_PASS_DURATION_HOURS).toBe(24);
  });
});

describe('the defensible band is empty', () => {
  const rate = sustainedTicketFloorPerHour()!;
  const floor = selfFundingThresholdTickets()!;
  const headline = Math.max(...OFFICIAL_ARCADE_PRIZE_CATALOG.map((p) => p.tickets));

  it('puts the self-funding floor just above the headline prize', () => {
    // THE finding. Anything under `floor` funds its own replacement; anything
    // over `headline` costs more than a permanent cosmetic while lasting a day.
    // The two cross, so no number sits in between.
    expect(floor).toBeGreaterThan(headline);
  });

  it('leaves no candidate price that is neither self-funding nor absurd', () => {
    const candidates = [50, 100, 200, 500, 1000, 1500, 2000, 2500, 3000, 5000];
    const defensible = candidates.filter((ticketPrice) => {
      const selfFunding = isSelfFundingPassPrice({
        ticketPrice,
        hoursPlayedPerPass: ARCADE_PASS_DURATION_HOURS,
      }).selfFunding;
      return !selfFunding && ticketPrice <= headline;
    });

    expect(defensible).toEqual([]);
  });

  it.each([50, 100, 200, 500, 1000, 2500])(
    '%i Tickets is self-funding within one Pass',
    (ticketPrice) => {
      const verdict = isSelfFundingPassPrice({
        ticketPrice,
        hoursPlayedPerPass: ARCADE_PASS_DURATION_HOURS,
      });
      expect(verdict.selfFunding).toBe(true);
      expect(verdict.hoursToBreakEven!).toBeLessThan(ARCADE_PASS_DURATION_HOURS);
    },
  );

  it('stops being self-funding only above the headline prize', () => {
    // Not "no price is safe" — a high enough one is. It is just a price nobody
    // could put on a shelf next to a permanent 2500-Ticket cosmetic.
    const verdict = isSelfFundingPassPrice({
      ticketPrice: Math.ceil(floor) + 1,
      hoursPlayedPerPass: ARCADE_PASS_DURATION_HOURS,
    });
    expect(verdict.selfFunding).toBe(false);
    expect(Math.ceil(floor) + 1).toBeGreaterThan(headline);
  });

  it.each([1, 2, 4, 8])('a %i-hour-a-day player funds any Pass priced at their own daily income', (hours) => {
    const earned = rate * hours;
    expect(isSelfFundingPassPrice({ ticketPrice: earned, hoursPlayedPerPass: hours }).selfFunding).toBe(true);
  });

  it('reports break-even hours rather than only a boolean', () => {
    // The eventual decision needs the number, not a verdict.
    const result = isSelfFundingPassPrice({ ticketPrice: 2 * rate, hoursPlayedPerPass: 1 });
    expect(result.selfFunding).toBe(false);
    expect(result.hoursToBreakEven).toBeCloseTo(2, 5);
  });
});

describe('the Pass is therefore unobtainable, on purpose', () => {
  it('has no price', () => {
    expect(ARCADE_PASS_TICKET_PRICE).toBeNull();
  });

  it('reports itself unpriced, with the reason', () => {
    const availability = arcadePassAvailability();
    expect(availability.kind).toBe('unpriced');
    expect(availability).toHaveProperty('reason');
  });

  it('REFUSES a price that is either self-funding or absurd', () => {
    /*
     * The guard. Whoever sets `ARCADE_PASS_TICKET_PRICE` will land here.
     *
     * A price is defensible only once the band opens — see the three options in
     * `arcade-pass-policy.ts`'s header. Until then it must clear the
     * self-funding floor AND stay at or below the permanent headline prize, and
     * today those two demands contradict each other.
     *
     * Do NOT fix this by editing the expectation. Fix it by making the change
     * that opens the band, and this test will pass on its own.
     */
    if (ARCADE_PASS_TICKET_PRICE === null) {
      expect(arcadePassAvailability().kind).toBe('unpriced');
      return;
    }

    const headline = Math.max(...OFFICIAL_ARCADE_PRIZE_CATALOG.map((p) => p.tickets));
    const verdict = isSelfFundingPassPrice({
      ticketPrice: ARCADE_PASS_TICKET_PRICE,
      hoursPlayedPerPass: ARCADE_PASS_DURATION_HOURS,
    });

    expect(
      verdict.selfFunding,
      `A Pass at ${ARCADE_PASS_TICKET_PRICE} Tickets pays for its own replacement in ` +
        `${verdict.hoursToBreakEven?.toFixed(1)}h of play, inside its own ${ARCADE_PASS_DURATION_HOURS}h life. ` +
        'Bound the Ticket supply or bound the Pass before pricing it.',
    ).toBe(false);

    expect(
      ARCADE_PASS_TICKET_PRICE,
      `A Pass at ${ARCADE_PASS_TICKET_PRICE} Tickets costs more than the permanent ` +
        `${headline}-Ticket headline prize, while lasting one day.`,
    ).toBeLessThanOrEqual(headline);
  });
});
