/**
 * Delivering a redeemed Arcade Pass.
 *
 * The Pass is the first prize with a real price, and the money question is
 * always the same one: a player whose Tickets are gone must end up either with
 * a pass or with a redemption the flow can still finish. Never neither.
 *
 * These tests drive the delivery ADAPTER directly, against the same four-method
 * contract the redemption hook calls. `arcade-pass-redemption.test.tsx` drives
 * the whole flow through the hook; this file pins the piece that is specific to
 * the Pass, including the two refusals that must present as recoverable rather
 * than as a loss.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  ARCADE_PASS_PRIZE,
  ARCADE_PASS_PRIZE_ID,
  createArcadePassOwnership,
} from './arcade-pass-prize';
import {
  ARCADE_PASS_DURATION_MS,
  ARCADE_PASS_FREE_PLAYS,
  clearArcadePasses,
  consumeArcadeFreePlay,
  readArcadePass,
} from '../pass/arcade-pass-entitlement';
import { ARCADE_PASS_TICKET_PRICE } from '../pass/arcade-pass-terms';
import { OFFICIAL_ARCADE_PRIZE_CATALOG } from './official-prize-catalog';

const ALICE = 'a'.repeat(64);
const T0 = 1_700_000_000_000;

let clock = T0;
const ownership = () => createArcadePassOwnership(() => clock);

beforeEach(() => {
  clock = T0;
  clearArcadePasses();
});
afterEach(() => {
  clearArcadePasses();
  vi.restoreAllMocks();
});

describe('the shelf entry', () => {
  it('is priced from the central terms, not a literal', () => {
    expect(ARCADE_PASS_PRIZE.price).toBe(ARCADE_PASS_TICKET_PRICE);
  });

  it('names BOTH limits, never "24 hours" alone', () => {
    // "24 hours" on its own reads as unlimited play for a day, precisely the
    // pass this one replaced.
    expect(ARCADE_PASS_PRIZE.description).toContain(String(ARCADE_PASS_FREE_PLAYS));
    expect(ARCADE_PASS_PRIZE.description).toMatch(/free play/i);
    expect(ARCADE_PASS_PRIZE.description).toMatch(/24 hours/i);
    expect(ARCADE_PASS_PRIZE.description).not.toMatch(/unlimited/i);
  });

  it('is redeemable, repeatable, and cheaper than every permanent prize', () => {
    expect(ARCADE_PASS_PRIZE.availability).toBe('available');
    // Repeatable so a confirmed redemption never blocks the next one; the
    // no-stacking rule lives in the entitlement, not in payment history.
    expect(ARCADE_PASS_PRIZE.repeatable).toBe(true);
    const cheapestPermanent = Math.min(
      ...OFFICIAL_ARCADE_PRIZE_CATALOG.map((p) => p.tickets),
    );
    expect(ARCADE_PASS_PRIZE.price).toBeLessThan(cheapestPermanent);
  });
});

describe('delivery', () => {
  it('grants the pass with both limits', async () => {
    await ownership().grantPrize(ALICE, ARCADE_PASS_PRIZE, 'red-1');

    const record = readArcadePass(ALICE)!;
    expect(record.remainingFreePlays).toBe(ARCADE_PASS_FREE_PLAYS);
    expect(record.expiresAt).toBe(T0 + ARCADE_PASS_DURATION_MS);
    expect(record.redemptionId).toBe('red-1');
  });

  it('verifies through the store, per redemption id', async () => {
    const store = ownership();
    expect(await store.hasDelivery(ALICE, ARCADE_PASS_PRIZE_ID, 'red-1')).toBe(false);

    await store.grantPrize(ALICE, ARCADE_PASS_PRIZE, 'red-1');

    expect(await store.hasDelivery(ALICE, ARCADE_PASS_PRIZE_ID, 'red-1')).toBe(true);
    expect(await store.hasDelivery(ALICE, ARCADE_PASS_PRIZE_ID, 'red-2')).toBe(false);
  });

  it('is idempotent, and a retry never resets a part-spent allowance', async () => {
    // The delivery retry the recovery path performs. It runs against a pass
    // the player may already have been using.
    const store = ownership();
    await store.grantPrize(ALICE, ARCADE_PASS_PRIZE, 'red-1');
    await consumeArcadeFreePlay(ALICE, clock);

    await store.grantPrize(ALICE, ARCADE_PASS_PRIZE, 'red-1');

    expect(readArcadePass(ALICE)!.remainingFreePlays).toBe(ARCADE_PASS_FREE_PLAYS - 1);
  });

  it('refuses a prize that is not the Pass', async () => {
    await expect(
      ownership().grantPrize(ALICE, { ...ARCADE_PASS_PRIZE, id: 'something-else' }, 'red-1'),
    ).rejects.toThrow(/not an arcade pass/i);
  });
});

describe('the two refusals are recoverable, not losses', () => {
  it('THROWS rather than overwriting a pass that is still usable', async () => {
    // Tickets are already spent when this runs. Overwriting would destroy
    // plays the player owns; throwing keeps the redemption in `delivering`,
    // which the flow can finish later without spending again.
    const store = ownership();
    await store.grantPrize(ALICE, ARCADE_PASS_PRIZE, 'red-1');

    await expect(store.grantPrize(ALICE, ARCADE_PASS_PRIZE, 'red-2')).rejects.toThrow(
      /already running/i,
    );

    const record = readArcadePass(ALICE)!;
    expect(record.redemptionId).toBe('red-1');
    expect(record.remainingFreePlays).toBe(ARCADE_PASS_FREE_PLAYS);
  });

  it('delivers the deferred pass once the previous one is spent', async () => {
    const store = ownership();
    await store.grantPrize(ALICE, ARCADE_PASS_PRIZE, 'red-1');
    for (let i = 0; i < ARCADE_PASS_FREE_PLAYS; i += 1) {
      await consumeArcadeFreePlay(ALICE, clock);
    }

    await store.grantPrize(ALICE, ARCADE_PASS_PRIZE, 'red-2');

    expect(readArcadePass(ALICE)!.redemptionId).toBe('red-2');
    expect(readArcadePass(ALICE)!.remainingFreePlays).toBe(ARCADE_PASS_FREE_PLAYS);
  });

  it('THROWS when storage will not keep the pass', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    await expect(
      ownership().grantPrize(ALICE, ARCADE_PASS_PRIZE, 'red-1'),
    ).rejects.toThrow(/storage/i);
  });

  it('never reports a delivery it did not make', async () => {
    const store = ownership();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    await expect(store.grantPrize(ALICE, ARCADE_PASS_PRIZE, 'red-1')).rejects.toThrow();
    vi.restoreAllMocks();

    // The verification the flow runs after every grant. A false `true` here is
    // what would turn a paid-but-undelivered pass into a silent loss.
    expect(await store.hasDelivery(ALICE, ARCADE_PASS_PRIZE_ID, 'red-1')).toBe(false);
  });
});

describe('holding is about the pass RUNNING, not about having bought one', () => {
  it('reports held only while usable', async () => {
    const store = ownership();
    await store.grantPrize(ALICE, ARCADE_PASS_PRIZE, 'red-1');
    expect(await store.hasPrize(ALICE, ARCADE_PASS_PRIZE_ID)).toBe(true);

    for (let i = 0; i < ARCADE_PASS_FREE_PLAYS; i += 1) {
      await consumeArcadeFreePlay(ALICE, clock);
    }
    // Spent. The counter must not look sold out to someone who can buy again.
    expect(await store.hasPrize(ALICE, ARCADE_PASS_PRIZE_ID)).toBe(false);
  });

  it('stops reporting held once the pass expires', async () => {
    const store = ownership();
    await store.grantPrize(ALICE, ARCADE_PASS_PRIZE, 'red-1');

    clock = T0 + ARCADE_PASS_DURATION_MS;
    expect(await store.hasPrize(ALICE, ARCADE_PASS_PRIZE_ID)).toBe(false);
  });
});

// ── Regression: the Pass is NOT a kind:31633 cosmetic ──────────────────────
//
// The cosmetics became real inventory ownership in the same phase this block
// was written. The Pass deliberately did not, and its terms did not move. The
// existing tests above express the terms through the constants, which is right
// for them and useless as a regression guard, a rebalance would change both
// sides at once. These pin the LITERALS.

describe('Arcade Pass regression', () => {
  it('still costs 180 Arcade Tickets', () => {
    expect(ARCADE_PASS_TICKET_PRICE).toBe(180);
    expect(ARCADE_PASS_PRIZE.price).toBe(180);
  });

  it('still grants 15 free plays within 24 hours', () => {
    expect(ARCADE_PASS_FREE_PLAYS).toBe(15);
    expect(ARCADE_PASS_DURATION_MS).toBe(24 * 60 * 60 * 1000);
    expect(ARCADE_PASS_PRIZE.description).toContain('15 free plays');
    expect(ARCADE_PASS_PRIZE.description).toContain('24 hours');
  });

  it('is a TEMPORARY entitlement, not inventory ownership', () => {
    // A `delivery.type` of `inventory` would route the Pass through the atomic
    // cosmetic redeemer and mint it as a permanent kind:31633 item, which is
    // exactly what an expiring allowance must never become.
    expect(ARCADE_PASS_PRIZE.delivery.type).toBe('mock-ownership');
    expect(ARCADE_PASS_PRIZE.delivery).not.toHaveProperty('itemAddress');
  });

  it('does not claim atomic delivery; its grant is a SECOND write', () => {
    // The entitlement store is local, not the ticket event, so the
    // paid-but-undelivered recovery path is load-bearing for the Pass and its
    // reconciliation must stay balance-based.
    const ownership = createArcadePassOwnership(() => 1_700_000_000_000);
    expect(ownership.atomicWithSpend).toBeUndefined();
  });

  it('keeps its own catalogue version, unchanged by the official catalog', () => {
    expect(ARCADE_PASS_PRIZE.catalogVersion).toBeUndefined();
  });
});
