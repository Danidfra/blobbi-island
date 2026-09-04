/**
 * Redeeming the Arcade Pass, end to end through the real redemption flow.
 *
 * The Pass is the first thing on the Prize Counter that actually costs
 * something, so what matters here is what happens when the spend goes wrong.
 * The flow itself (`useArcadePrizeRedemption`) is hardened and tested; these
 * tests drive it with a substituted writer to prove the PASS wiring inherits
 * every guarantee: one debit per redemption, no re-spend when the outcome is
 * unknown, and a paid-but-undelivered pass that can still be delivered.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const PUBKEY = 'f'.repeat(64);
const spendTickets = vi.fn();
const readTicketQuantity = vi.fn();

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: PUBKEY, signer: {} } }),
}));

let inventoryData: { data: unknown; isLoading: boolean; isError: boolean };
vi.mock('@/inventory/useIslandInventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory/useIslandInventory')>();
  return { ...actual, useIslandInventory: () => inventoryData };
});

vi.mock('@nostrify/react', () => ({ useNostr: () => ({ nostr: {} }) }));

import type { NostrEvent } from '@nostrify/nostrify';
import { parseInventoryEvent } from '@/inventory/protocol-adapter';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';
import { ArcadePassOffer } from './ArcadePassOffer';
import {
  ARCADE_PASS_FREE_PLAYS,
  clearArcadePasses,
  consumeArcadeFreePlay,
  grantArcadePass,
  readArcadePass,
} from '@/arcade/pass/arcade-pass-entitlement';
import { ARCADE_PASS_TICKET_PRICE } from '@/arcade/pass/arcade-pass-terms';
import { clearRedemptions, resetRedemptionLocks } from '@/lib/arcade-redemption-ledger';
import { ArcadePrizeSpendError } from '@/inventory/arcade-prize-spend-writer';

const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

function inventoryWith(tickets: number) {
  const event: NostrEvent = {
    id: 'inv-1',
    pubkey: PUBKEY,
    created_at: 1_000,
    kind: 31633,
    tags: [
      ['d', 'blobbi:island'],
      ...(tickets > 0 ? [['a', TICKET_ADDRESS, '', String(tickets)]] : []),
    ],
    content: '',
    sig: 'sig',
  };
  return parseInventoryEvent(event)!;
}

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

/** The offer, driven by a substituted spend writer. */
function renderOffer() {
  return render(<ArcadePassOffer />, { wrapper });
}

vi.mock('@/inventory/arcade-prize-spend-writer', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/inventory/arcade-prize-spend-writer')>();
  return {
    ...actual,
    createArcadePrizeSpendWriter: () => ({ spendTickets, readTicketQuantity }),
  };
});

const redeemButton = () =>
  document.querySelector('[data-pass-redeem]') as HTMLButtonElement | null;
const byAttr = (attr: string) =>
  document.querySelector(`[${attr}]`) as HTMLElement | null;

beforeEach(() => {
  clearArcadePasses();
  clearRedemptions();
  resetRedemptionLocks();
  spendTickets.mockReset().mockResolvedValue(undefined);
  /*
    The flow reads the balance twice: a BASELINE before publishing, and again
    after, confirming the spend only on exactly −price. A constant mock would
    make every spend look like it never happened.
  */
  readTicketQuantity.mockReset();
  let ticketReads = 0;
  readTicketQuantity.mockImplementation(async () => {
    ticketReads += 1;
    return ticketReads === 1 ? 500 : 500 - ARCADE_PASS_TICKET_PRICE;
  });
  inventoryData = { data: inventoryWith(500), isLoading: false, isError: false };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  clearArcadePasses();
  clearRedemptions();
  resetRedemptionLocks();
});

describe('the offer states both limits', () => {
  it('advertises the play count and the window, never unlimited play', () => {
    renderOffer();
    const offer = byAttr('data-arcade-pass-offer')!;

    expect(offer.textContent).toContain(`${ARCADE_PASS_FREE_PLAYS} free plays`);
    expect(offer.textContent).toMatch(/24 hours/i);
    expect(offer.textContent).not.toMatch(/unlimited/i);
    expect(offer.textContent).toContain(String(ARCADE_PASS_TICKET_PRICE));
  });

  it('shows the remaining plays once a pass is running', () => {
    grantArcadePass(PUBKEY, { redemptionId: 'r1', nowMs: Date.now() });
    renderOffer();

    expect(byAttr('data-pass-status')!.textContent).toContain(
      `${ARCADE_PASS_FREE_PLAYS} free plays`,
    );
  });

  it('says the plays are used, not that the pass is gone', async () => {
    grantArcadePass(PUBKEY, { redemptionId: 'r1', nowMs: Date.now() });
    for (let i = 0; i < ARCADE_PASS_FREE_PLAYS; i += 1) {
      await consumeArcadeFreePlay(PUBKEY, Date.now());
    }
    renderOffer();

    expect(byAttr('data-pass-status')!.textContent).toMatch(/free plays used/i);
  });
});

describe('redeeming spends Arcade Tickets', () => {
  it('spends once and delivers the pass', async () => {
    renderOffer();
    await act(async () => {
      redeemButton()!.click();
    });

    await waitFor(() => expect(spendTickets).toHaveBeenCalledTimes(1));
    // The debit is the TICKET writer's, never a coin path.
    expect(spendTickets.mock.calls[0][0]).toMatchObject({
      price: ARCADE_PASS_TICKET_PRICE,
    });
    await waitFor(() =>
      expect(readArcadePass(PUBKEY)?.remainingFreePlays).toBe(ARCADE_PASS_FREE_PLAYS),
    );
  });

  it('does nothing at all without enough Tickets', async () => {
    inventoryData = {
      data: inventoryWith(ARCADE_PASS_TICKET_PRICE - 1),
      isLoading: false,
      isError: false,
    };
    renderOffer();

    expect(redeemButton()!.disabled).toBe(true);
    expect(spendTickets).not.toHaveBeenCalled();
    expect(readArcadePass(PUBKEY)).toBeNull();
  });

  it('refuses to stack while a usable pass is running', async () => {
    grantArcadePass(PUBKEY, { redemptionId: 'existing', nowMs: Date.now() });
    renderOffer();

    expect(redeemButton()!.disabled).toBe(true);
    expect(spendTickets).not.toHaveBeenCalled();
    // Untouched.
    expect(readArcadePass(PUBKEY)!.redemptionId).toBe('existing');
  });

  it('lets an EXHAUSTED pass be replaced immediately', async () => {
    grantArcadePass(PUBKEY, { redemptionId: 'spent', nowMs: Date.now() });
    for (let i = 0; i < ARCADE_PASS_FREE_PLAYS; i += 1) {
      await consumeArcadeFreePlay(PUBKEY, Date.now());
    }
    renderOffer();

    expect(redeemButton()!.disabled).toBe(false);
    await act(async () => {
      redeemButton()!.click();
    });

    await waitFor(() =>
      expect(readArcadePass(PUBKEY)!.remainingFreePlays).toBe(ARCADE_PASS_FREE_PLAYS),
    );
    expect(readArcadePass(PUBKEY)!.redemptionId).not.toBe('spent');
  });
});

describe('an unresolved spend is never respent', () => {
  it('offers a read-only status check, not a retry', async () => {
    // A timeout means the spend may have landed. Publishing again would be a
    // second debit for one pass.
    spendTickets.mockRejectedValue(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    );
    renderOffer();

    await act(async () => {
      redeemButton()!.click();
    });

    await waitFor(() => expect(byAttr('data-pass-check-status')).not.toBeNull());
    expect(redeemButton()).toBeNull();

    const callsBefore = spendTickets.mock.calls.length;
    await act(async () => {
      byAttr('data-pass-check-status')!.click();
    });
    // The check READS. It must never publish.
    expect(spendTickets.mock.calls.length).toBe(callsBefore);
  });
});

describe('paid but not delivered is recoverable without a second debit', () => {
  it('finishes the delivery, spending nothing more', async () => {
    // The spend lands; storage then refuses the pass. The tickets are gone and
    // the player has nothing, the exact case the ledger exists for.
    // ONLY the pass write fails. The ledger's own writes must keep working,
    // it is the record that makes the recovery possible.
    const realSetItem = Storage.prototype.setItem.bind(localStorage);
    const failPassWrite = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation((key: string, value: string) => {
        if (key === 'blobbi:arcade:pass') throw new Error('quota');
        realSetItem(key, value);
      });

    renderOffer();
    await act(async () => {
      redeemButton()!.click();
    });

    await waitFor(() => expect(spendTickets).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(byAttr('data-pass-finish-delivery')).not.toBeNull());
    expect(readArcadePass(PUBKEY)).toBeNull();

    // Storage recovers; the player finishes what they already paid for.
    // Scoped to the storage spy, restoring everything would also wipe the
    // spend counter this test exists to check.
    failPassWrite.mockRestore();
    await act(async () => {
      byAttr('data-pass-finish-delivery')!.click();
    });

    await waitFor(() =>
      expect(readArcadePass(PUBKEY)?.remainingFreePlays).toBe(ARCADE_PASS_FREE_PLAYS),
    );
    // One debit, total.
    expect(spendTickets).toHaveBeenCalledTimes(1);
  });
});

describe('a provable pre-publish failure spends nothing', () => {
  it('leaves the player with their tickets and no pass', async () => {
    spendTickets.mockRejectedValue(
      new ArcadePrizeSpendError('not enough Arcade Tickets', 'insufficient-tickets'),
    );
    renderOffer();

    await act(async () => {
      redeemButton()!.click();
    });

    await waitFor(() => expect(byAttr('data-pass-message')).not.toBeNull());
    expect(readArcadePass(PUBKEY)).toBeNull();
  });
});
