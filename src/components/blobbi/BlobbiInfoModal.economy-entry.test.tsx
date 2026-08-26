/**
 * The in-world Coins surface and a failed initial allocation.
 *
 * F-04: a relay hiccup during the initial 200-Coin allocation used to render
 * as a plain `0` here — indistinguishable from an honest empty purse, and with
 * no way back short of reloading the page. The row must now say the Coins did
 * not arrive, offer the SAME retry the pre-world notice drives, and return to
 * an ordinary balance once the retry lands.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import type { EconomyEntrySnapshot } from '@/inventory/useEconomyEntry';
import type { CoinBalanceView } from '@/inventory/useCoinWallet';

const mockEntry = vi.fn<() => EconomyEntrySnapshot & { retry: () => void }>();
const mockBalance = vi.fn<() => CoinBalanceView>();

vi.mock('@/inventory/useEconomyEntry', () => ({
  useEconomyEntryStatus: () => mockEntry(),
}));
vi.mock('@/inventory/useCoinWallet', () => ({
  useCoinBalance: () => mockBalance(),
}));
vi.mock('@/hooks/useOptimizedStatus', () => ({
  useCurrentPet: () => ({
    id: 'pet-1',
    name: 'Luna',
    stage: 'adult' as const,
    hunger: 70,
    energy: 60,
    happiness: 80,
    health: 90,
    hygiene: 75,
    experience: 900,
    careStreak: 2,
    generation: 1,
    personality: 'Curious',
  }),
  useOptimizedStatus: () => ({ status: {}, refreshFromRelay: () => {} }),
}));

import { BlobbiInfoModal } from './BlobbiInfoModal';

function entryOf(
  partial: Partial<EconomyEntrySnapshot>,
  retry = vi.fn(),
): EconomyEntrySnapshot & { retry: () => void } {
  return { phase: 'idle', canRetry: false, ...partial, retry };
}

function balanceOf(partial: Partial<CoinBalanceView> = {}): CoinBalanceView {
  return { balance: 0, isLoading: false, isError: false, refetch: () => {}, ...partial };
}

function renderModal() {
  return render(
    <TestApp>
      <div className="relative h-screen w-full">
        <BlobbiInfoModal isOpen onClose={() => {}} />
      </div>
    </TestApp>,
  );
}

/** The Coins row, whatever it currently contains. */
async function coinHud(): Promise<HTMLElement> {
  const node = await screen.findByText('Coins');
  const row = node.parentElement?.querySelector('[data-coin-hud]');
  if (!(row instanceof HTMLElement)) throw new Error('no coin HUD found');
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBalance.mockReturnValue(balanceOf());
});

describe('the in-world Coins surface', () => {
  it('tells a failed allocation apart from an honest zero balance', async () => {
    mockEntry.mockReturnValue(entryOf({ phase: 'failed', canRetry: true }));
    renderModal();

    const row = await coinHud();
    expect(row).toHaveTextContent('Coins not ready yet');
    // The alarming, wrong reading is the one that must not appear.
    expect(row.textContent).not.toMatch(/\b0\b/);
  });

  it('exposes a retry that drives the shared economy-entry action', async () => {
    const retry = vi.fn();
    mockEntry.mockReturnValue(entryOf({ phase: 'failed', canRetry: true }, retry));
    renderModal();

    const row = await coinHud();
    const button = row.querySelector('[data-economy-entry-retry]');
    expect(button).toBeInstanceOf(HTMLButtonElement);
    (button as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows the retry running, then the real balance once it lands', async () => {
    mockEntry.mockReturnValue(entryOf({ phase: 'checking' }));
    const { rerender } = renderModal();

    let row = await coinHud();
    expect(row.querySelector('[data-economy-entry-retry]')).toBeNull();
    expect(row.querySelector('[data-coin-amount]')).not.toBeNull();

    mockEntry.mockReturnValue(entryOf({ phase: 'applied', alreadyApplied: false }));
    mockBalance.mockReturnValue(balanceOf({ balance: 200 }));
    rerender(
      <TestApp>
        <div className="relative h-screen w-full">
          <BlobbiInfoModal isOpen onClose={() => {}} />
        </div>
      </TestApp>,
    );

    row = await coinHud();
    expect(row).toHaveTextContent('200');
    expect(row).not.toHaveTextContent('Coins not ready yet');
  });

  it('never presents an ambiguous allocation as a failure', async () => {
    mockEntry.mockReturnValue(entryOf({ phase: 'ambiguous', canRetry: true }));
    renderModal();

    const row = await coinHud();
    expect(row).toHaveTextContent('Confirming your Coin balance…');
    expect(row.querySelector('[data-economy-entry-retry]')).toBeNull();
  });

  it('offers no retry for a failure a retry could not recover', async () => {
    // `balance-cap`: +200 would exceed the ceiling. The balance is real and
    // shown; pressing a button changes nothing.
    mockEntry.mockReturnValue(
      entryOf({ phase: 'failed', failureReason: 'balance-cap', canRetry: false }),
    );
    mockBalance.mockReturnValue(balanceOf({ balance: 12 }));
    renderModal();

    const row = await coinHud();
    expect(row.querySelector('[data-economy-entry-retry]')).toBeNull();
    expect(row).toHaveTextContent('12');
  });
});
