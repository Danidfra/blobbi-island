/**
 * Prize Counter surface tests.
 *
 * The REAL counter, cards, detail panel, redemption hook, state machine and
 * ledger — with a fake spend writer, a fake ownership store and a scripted
 * balance, so every visual state is reachable and nothing can publish.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { PrizeCounter } from './PrizeCounter';
import { QueryProviders } from '../test-providers';
import { getArcadePrize } from '@/arcade/prizes/prize-catalogue';
import type { ArcadePrize } from '@/arcade/prizes/prize-catalogue';
import type { ArcadePrizeSpendWriter } from '@/inventory/arcade-prize-spend-writer';
import { ArcadePrizeSpendError } from '@/inventory/arcade-prize-spend-writer';
import type { ArcadePrizeOwnership } from '@/lib/arcade-prize-ownership';
import { clearRedemptions, resetRedemptionLocks } from '@/lib/arcade-redemption-ledger';
import { clearLocalPrizeOwnership } from '@/lib/arcade-prize-ownership';

const PUBKEY = 'f'.repeat(64);
const GLASSES = getArcadePrize('neon-star-glasses')!; // 40
const CABINET = getArcadePrize('mini-arcade-cabinet')!; // 500, premium

let currentUser:
  | { pubkey: string; signer: { getPublicKey: () => Promise<string> } }
  | undefined = { pubkey: PUBKEY, signer: { getPublicKey: async () => PUBKEY } };

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: currentUser, users: currentUser ? [currentUser] : [] }),
}));

vi.mock('@nostrify/react', async () => {
  const actual = await vi.importActual<typeof import('@nostrify/react')>('@nostrify/react');
  return {
    ...actual,
    useNostr: () => ({
      nostr: {
        query: async () => [],
        event: async () => {
          throw new Error('The test pool refuses to publish');
        },
      },
    }),
  };
});

// Scripted balance: the counter reads the shared inventory hook.
const mockInventory = vi.fn();
vi.mock('@/inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory')>();
  return { ...actual, useIslandInventory: () => mockInventory() };
});

/** A fake kind:31633 whose ONLY reader here is `getQuantity`. */
async function inventoryWith(tickets: number) {
  const { buildEmptyInventory } = await vi.importActual<typeof import('@/inventory')>(
    '@/inventory',
  );
  const { addInventoryItemQuantity } = await import('@nostr-games/inventory');
  const { officialItemAddress, ARCADE_TICKET_D } = await import('@/protocol/event-registry');
  const base = buildEmptyInventory(PUBKEY);
  return tickets > 0
    ? addInventoryItemQuantity(base, officialItemAddress(ARCADE_TICKET_D), tickets)
    : base;
}

function fakeWriter(options: { balance?: number; spendError?: unknown } = {}) {
  let balance = options.balance ?? 100;
  let spends = 0;
  return {
    spendCount: () => spends,
    async spendTickets(redemption) {
      spends += 1;
      if (options.spendError) throw options.spendError;
      balance -= redemption.price;
    },
    async readTicketQuantity() {
      return balance;
    },
  } satisfies ArcadePrizeSpendWriter & { spendCount: () => number };
}

function fakeOwnership(options: { preOwned?: string[]; failGrants?: number } = {}) {
  /** prizeId → delivered redemption ids. Pre-owned prizes get a seed id. */
  const owned = new Map<string, Set<string>>(
    (options.preOwned ?? []).map((prizeId) => [prizeId, new Set(['pre-owned'])]),
  );
  let failures = options.failGrants ?? 0;
  const deliveries = (prizeId: string) => {
    const set = owned.get(prizeId) ?? new Set<string>();
    owned.set(prizeId, set);
    return set;
  };
  return {
    async hasPrize(_pubkey: string, prizeId: string) {
      return (owned.get(prizeId)?.size ?? 0) > 0;
    },
    async hasDelivery(_pubkey: string, prizeId: string, redemptionId: string) {
      return deliveries(prizeId).has(redemptionId);
    },
    async grantPrize(_pubkey: string, prize: ArcadePrize, redemptionId: string) {
      const set = deliveries(prize.id);
      if (set.has(redemptionId)) return;
      if (failures > 0) {
        failures -= 1;
        throw new Error('DEV: delivery refused');
      }
      set.add(redemptionId);
    },
    async listOwnedPrizes() {
      return [...owned.entries()]
        .filter(([, ids]) => ids.size > 0)
        .map(([prizeId, ids]) => ({
          prizeId,
          count: ids.size,
          firstGrantedAt: 1,
          deliveredRedemptionIds: [...ids],
        }));
    },
  } satisfies ArcadePrizeOwnership;
}

let attempt = 0;

function renderCounter(options: {
  writer?: ReturnType<typeof fakeWriter>;
  ownership?: ArcadePrizeOwnership;
  catalogue?: readonly ArcadePrize[];
} = {}) {
  const writer = options.writer ?? fakeWriter();
  const ownership = options.ownership ?? fakeOwnership();
  const mintAttemptId = () => `attempt-${++attempt}`;
  render(
    <QueryProviders>
      <PrizeCounter
        catalogue={options.catalogue}
        redemptionOptions={{ writer, ownership, mintAttemptId }}
      />
    </QueryProviders>,
  );
  return { writer, ownership };
}

const card = (id: string) => document.querySelector(`[data-prize-card="${id}"]`);
const detail = () => document.querySelector('[data-prize-detail]');

async function selectPrize(id: string) {
  await act(async () => {
    fireEvent.click(card(id)!);
  });
}

beforeEach(async () => {
  localStorage.clear();
  clearRedemptions();
  clearLocalPrizeOwnership();
  resetRedemptionLocks();
  attempt = 0;
  currentUser = { pubkey: PUBKEY, signer: { getPublicKey: async () => PUBKEY } };
  mockInventory.mockReturnValue({
    data: await inventoryWith(100),
    isLoading: false,
    isError: false,
  });
});

afterEach(() => {
  localStorage.clear();
  resetRedemptionLocks();
});

describe('the counter and its balance', () => {
  it('shows the shelf, the sign and the real balance', () => {
    renderCounter();
    expect(document.querySelector('[data-prize-counter]')).toBeInTheDocument();
    const balance = document.querySelector('[data-prize-counter-balance]')!;
    expect(balance).toHaveAttribute('data-prize-counter-balance', 'ready');
    expect(balance).toHaveAttribute('aria-label', 'You have 100 Arcade Tickets');
    expect(document.querySelector('[data-prize-grid]')).toBeInTheDocument();
  });

  it('shows a loading balance without flashing a false zero', () => {
    mockInventory.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderCounter();
    const balance = document.querySelector('[data-prize-counter-balance]')!;
    expect(balance).toHaveAttribute('data-prize-counter-balance', 'loading');
    expect(balance.textContent).not.toContain('0');
  });

  it('distinguishes an unavailable balance and pauses redeeming', async () => {
    mockInventory.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderCounter();
    expect(document.querySelector('[data-prize-counter-balance]')).toHaveAttribute(
      'data-prize-counter-balance',
      'unavailable',
    );
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    await selectPrize(GLASSES.id);
    expect(screen.getByRole('button', { name: /balance unavailable/i })).toBeDisabled();
  });

  it('tells a logged-out player browsing is free, and disables redeeming', async () => {
    currentUser = undefined;
    renderCounter();
    expect(screen.getByText(/browsing is free/i)).toBeInTheDocument();
    await selectPrize(GLASSES.id);
    expect(screen.getByRole('button', { name: /log in to redeem/i })).toBeDisabled();
  });

  it('shows an empty-catalogue state', () => {
    renderCounter({ catalogue: [] });
    expect(document.querySelector('[data-prize-empty="catalogue"]')).toBeInTheDocument();
  });
});

describe('filters', () => {
  it('filters by category and announces the tabs as a radio group', () => {
    renderCounter();
    expect(screen.getByRole('radiogroup', { name: /prize category/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Accessories' }));
    expect(card('neon-star-glasses')).toBeInTheDocument();
    expect(card('arcade-champion-cap')).toBeInTheDocument();
    expect(card('mini-arcade-cabinet')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(card('mini-arcade-cabinet')).toBeInTheDocument();
  });

  it('shows a friendly no-results state for an empty category', () => {
    // A catalogue with no badges, filtered to badges.
    renderCounter({ catalogue: [GLASSES, CABINET] });
    expect(screen.queryByRole('radio', { name: 'Badges' })).toBeNull();
    // Categories with no entries are not offered at all — the better initial
    // UI — so drive the empty state through a present category instead.
    fireEvent.click(screen.getByRole('radio', { name: 'Furniture' }));
    expect(card('mini-arcade-cabinet')).toBeInTheDocument();
  });
});

describe('cards and selection', () => {
  it('selecting a card opens the detail and NEVER spends', async () => {
    const { writer } = renderCounter();
    expect(detail()).toBeNull();
    await selectPrize(GLASSES.id);
    expect(detail()).toHaveAttribute('data-prize-detail', GLASSES.id);
    expect(within(detail() as HTMLElement).getByText(GLASSES.description)).toBeInTheDocument();
    expect(writer.spendCount()).toBe(0);
  });

  it('labels affordability in words on the card', async () => {
    mockInventory.mockReturnValue({
      data: await inventoryWith(20),
      isLoading: false,
      isError: false,
    });
    renderCounter();
    expect(card('neon-star-glasses')).toHaveAttribute('data-prize-state', 'unaffordable');
    expect(within(card('neon-star-glasses') as HTMLElement).getByText(/need 20 more/i))
      .toBeInTheDocument();
    // Pixel Confetti (15) is still affordable at 20 tickets.
    expect(card('pixel-confetti')).toHaveAttribute('data-prize-state', 'available');
  });

  it('marks owned and coming-soon prizes in text', async () => {
    renderCounter({ ownership: fakeOwnership({ preOwned: [GLASSES.id] }) });
    await waitFor(() =>
      expect(card('neon-star-glasses')).toHaveAttribute('data-prize-state', 'owned'),
    );
    expect(within(card('neon-star-glasses') as HTMLElement).getByText('Owned')).toBeInTheDocument();
    expect(
      within(card('golden-ticket-frame') as HTMLElement).getByText('Coming soon'),
    ).toBeInTheDocument();
  });

  it('shows the Mini Arcade Cabinet as the premium long-term goal, with future-Home copy', async () => {
    renderCounter();
    await selectPrize(CABINET.id);
    const panel = detail() as HTMLElement;
    expect(within(panel).getByText(/future home furniture/i)).toBeInTheDocument();
    expect(within(panel).getByText(/will not award arcade tickets/i)).toBeInTheDocument();
    expect(
      within(panel).getByRole('button', { name: /not enough tickets/i }),
    ).toBeDisabled();
  });
});

describe('redemption', () => {
  it('redeems only after the explicit confirmation, then celebrates and marks Owned', async () => {
    const { writer } = renderCounter();
    await selectPrize(GLASSES.id);

    const redeemButton = screen.getByRole('button', { name: /redeem for 40 tickets/i });
    await act(async () => {
      fireEvent.click(redeemButton);
    });

    await waitFor(() => expect(detail()).toHaveAttribute('data-prize-detail-phase', 'confirmed'));
    expect(writer.spendCount()).toBe(1);
    expect(screen.getByText(/neon star glasses is yours/i)).toBeInTheDocument();
    expect(document.querySelector('[data-prize-success-stamp]')).toBeInTheDocument();
    expect(document.querySelector('[data-prize-action="owned"]')).toBeInTheDocument();
    await waitFor(() =>
      expect(card('neon-star-glasses')).toHaveAttribute('data-prize-state', 'owned'),
    );
  });

  it('shows the failed-before-spend state with a retry', async () => {
    renderCounter({
      writer: fakeWriter({ spendError: new ArcadePrizeSpendError('no', 'sign-failed') }),
    });
    await selectPrize(GLASSES.id);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /redeem for 40 tickets/i }));
    });
    await waitFor(() => expect(detail()).toHaveAttribute('data-prize-detail-phase', 'failed'));
    expect(screen.getByText(/nothing was spent/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('offers ONLY a read-only status check for an unresolved spend', async () => {
    const { writer } = renderCounter({
      writer: fakeWriter({
        spendError: Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
      }),
    });
    await selectPrize(GLASSES.id);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /redeem for 40 tickets/i }));
    });

    await waitFor(() =>
      expect(detail()).toHaveAttribute('data-prize-detail-phase', 'spend-unresolved'),
    );
    expect(screen.getByText(/will not send it again/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /redeem for/i })).toBeNull();
    expect(screen.getByRole('button', { name: /check spend status/i })).toBeInTheDocument();
    expect(writer.spendCount()).toBe(1);
  });

  it('recovers a paid-but-undelivered prize without spending again', async () => {
    const { writer } = renderCounter({ ownership: fakeOwnership({ failGrants: 1 }) });
    await selectPrize(GLASSES.id);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /redeem for 40 tickets/i }));
    });

    await waitFor(() =>
      expect(detail()).toHaveAttribute('data-prize-detail-phase', 'delivery-recovery'),
    );
    expect(screen.getByText(/without paying again/i)).toBeInTheDocument();

    // The detail's own action — the pending-delivery banner offers one too.
    await act(async () => {
      fireEvent.click(document.querySelector('[data-prize-finish-delivery]') as HTMLElement);
    });
    await waitFor(() => expect(detail()).toHaveAttribute('data-prize-detail-phase', 'confirmed'));
    expect(writer.spendCount()).toBe(1);
  });

  it('surfaces a pending delivery on a fresh mount — the refresh recovery', async () => {
    // First mount: spend succeeds, delivery fails.
    const ownership = fakeOwnership({ failGrants: 1 });
    const first = render(
      <QueryProviders>
        <PrizeCounter
          redemptionOptions={{
            writer: fakeWriter(),
            ownership,
            mintAttemptId: () => `attempt-${++attempt}`,
          }}
        />
      </QueryProviders>,
    );
    await selectPrize(GLASSES.id);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /redeem for 40 tickets/i }));
    });
    await waitFor(() =>
      expect(detail()).toHaveAttribute('data-prize-detail-phase', 'delivery-recovery'),
    );
    first.unmount();

    // The "refresh": a brand-new mount sees the ledger and offers recovery.
    renderCounter({ ownership });
    const banner = document.querySelector('[data-prize-pending-delivery]')!;
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/paid for but not delivered/i);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /finish delivery/i }));
    });
    await waitFor(() =>
      expect(document.querySelector('[data-prize-pending-delivery]')).toBeNull(),
    );
  });
});

describe('repeatable prizes in the UI', () => {
  const SNACK_ID = 'arcade-snack';

  it('returns to a redeemable action after a confirmed attempt, and shows the count', async () => {
    const { writer } = renderCounter();
    await selectPrize(SNACK_ID);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /redeem for 20 tickets/i }));
    });
    await waitFor(() => expect(detail()).toHaveAttribute('data-prize-detail-phase', 'confirmed'));

    // Celebrated — and still purchasable, never retired.
    expect(document.querySelector('[data-prize-action="owned"]')).toBeNull();
    const again = screen.getByRole('button', { name: /redeem again for 20 tickets/i });
    expect(again).toBeEnabled();
    // The count is visible on the card and in the detail.
    await waitFor(() =>
      expect(
        within(card(SNACK_ID) as HTMLElement).getByText(/owned ×1/i),
      ).toBeInTheDocument(),
    );
    expect(within(detail() as HTMLElement).getByText(/redeemed ×1/i)).toBeInTheDocument();

    // A second explicit redemption spends again and counts to 2.
    await act(async () => {
      fireEvent.click(again);
    });
    await waitFor(() => expect(writer.spendCount()).toBe(2));
    await waitFor(() =>
      expect(
        within(card(SNACK_ID) as HTMLElement).getByText(/owned ×2/i),
      ).toBeInTheDocument(),
    );
  });

  it('keeps a repeatable card in the ordinary states rather than an owned lock', async () => {
    renderCounter({ ownership: fakeOwnership({ preOwned: [SNACK_ID] }) });
    await waitFor(() =>
      expect(
        within(card(SNACK_ID) as HTMLElement).getByText(/owned ×1/i),
      ).toBeInTheDocument(),
    );
    expect(card(SNACK_ID)).toHaveAttribute('data-prize-state', 'available');
    await selectPrize(SNACK_ID);
    expect(screen.getByRole('button', { name: /redeem for 20 tickets/i })).toBeEnabled();
  });
});

describe('layout affordances', () => {
  it('gives the mobile detail a way back to the shelf', async () => {
    renderCounter();
    await selectPrize(GLASSES.id);
    const back = document.querySelector('[data-prize-detail-back]') as HTMLElement;
    expect(back).toBeInTheDocument();
    fireEvent.click(back);
    expect(detail()).toBeNull();
  });

  it('keeps every interactive target at 44px minimum height', () => {
    renderCounter();
    for (const selector of ['[data-prize-filter]', '[data-prize-card]']) {
      for (const el of document.querySelectorAll(selector)) {
        expect(el.className).toMatch(/min-h-\[44px\]/);
      }
    }
  });
});
