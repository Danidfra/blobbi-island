/**
 * F-08 / F-09 — the Arcade Pass says what it is, and says its price once.
 *
 * Two findings, one surface family. The price was written into prose in the
 * "no pass" notice as well as being a constant in the modal, so the two could
 * drift; and the modal sold a PASS with a button that said "Buy Ticket", next
 * to an Arcade Ticket balance that is a genuinely different currency.
 *
 * These are behavioural, not snapshots: they assert what a player reads.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ARCADE_PASS_PRICE } from '@/lib/arcade-pass';
import type { CoinBalanceView } from '@/inventory/useCoinWallet';

/** Swapped per test; the modals portal their content, so queries use the document. */
let balance: CoinBalanceView;

vi.mock('@/inventory/useCoinWallet', () => ({
  useCoinBalance: () => balance,
  useCoinWallet: () => ({ spendCoins: vi.fn(), grantCoins: vi.fn(), wallet: null }),
}));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'a'.repeat(64) } }),
}));

import { ArcadePassModal } from './ArcadePassModal';
import { NoPassModal } from './NoPassModal';

const read = (relPath: string) => readFileSync(join(process.cwd(), relPath), 'utf8');

beforeEach(() => {
  vi.clearAllMocks();
  balance = { balance: 500, isLoading: false, isError: false, refetch: vi.fn() };
});
afterEach(() => vi.restoreAllMocks());

describe('the pass price has one source', () => {
  it('the purchase modal quotes the constant', () => {
    render(<ArcadePassModal isOpen onClose={() => {}} />);
    expect(
      screen.getByText(new RegExp(`Costs ${ARCADE_PASS_PRICE} Blobbi Coins`, 'i')),
    ).toBeInTheDocument();
  });

  it('the no-pass notice quotes the same constant, as a Coin price', () => {
    render(<NoPassModal isOpen onClose={() => {}} />);
    // Rendered through the shared PriceTag, so it carries the Coin mark too.
    expect(screen.getByText(String(ARCADE_PASS_PRICE))).toBeInTheDocument();
    expect(
      document.body.querySelector('[data-coin-icon], [data-coin-icon-fallback]'),
    ).not.toBeNull();
  });

  it('neither surface writes the price into prose', () => {
    for (const file of [
      'src/components/blobbi/NoPassModal.tsx',
      'src/components/blobbi/ArcadePassModal.tsx',
    ]) {
      const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(source, file).not.toMatch(/\b20 [Cc]oins\b/);
    }
  });

  it('the constant lives outside the component that sells the pass', () => {
    // A price two surfaces quote does not belong to either of them.
    expect(read('src/lib/arcade-pass.ts')).toMatch(/export const ARCADE_PASS_PRICE = \d+/);
    expect(read('src/components/blobbi/ArcadePassModal.tsx')).not.toMatch(
      /export const ARCADE_PASS_PRICE/,
    );
  });
});

describe('a Pass is never called a Ticket', () => {
  it('the call to action buys a Pass', () => {
    render(<ArcadePassModal isOpen onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /buy pass/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /buy ticket/i })).toBeNull();
  });

  it('says plainly that Tickets are a different thing', () => {
    render(<ArcadePassModal isOpen onClose={() => {}} />);
    expect(screen.getByText(/not an Arcade Ticket/i)).toBeInTheDocument();
  });

  it('the no-pass notice reassures the player about their Tickets', () => {
    render(<NoPassModal isOpen onClose={() => {}} />);
    expect(screen.getByText(/Arcade Tickets are not spent/i)).toBeInTheDocument();
  });

  it('the real Ticket surfaces keep their own name', () => {
    // The currency the arcade games pay out stays "Ticket" everywhere.
    expect(read('src/components/blobbi/ArcadeTicketBalance.tsx')).toMatch(/Arcade Ticket/);
    expect(read('src/components/blobbi/arcade/prizes/PrizeCounter.tsx')).toMatch(
      /Arcade Ticket/,
    );
  });
});

describe('Coin presentation is the shared one', () => {
  it('the pass modal renders the balance through CoinAmount', () => {
    render(<ArcadePassModal isOpen onClose={() => {}} />);
    const amount = document.body.querySelector('[data-coin-amount]');
    expect(amount).not.toBeNull();
    expect(amount).toHaveAttribute('data-coin-amount', '500');
  });

  it('an unknown balance still renders as unknown, never as zero', () => {
    balance = { balance: null, isLoading: false, isError: false, refetch: vi.fn() };
    render(<ArcadePassModal isOpen onClose={() => {}} />);

    // CoinAmount's own unavailable state, not a fabricated number.
    expect(document.body.querySelector('[data-coin-amount]')).toHaveAttribute(
      'data-coin-amount',
      'unknown',
    );
    expect(screen.getByText(/balance unavailable/i)).toBeInTheDocument();
  });
});
