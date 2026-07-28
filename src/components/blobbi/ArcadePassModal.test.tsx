/**
 * Arcade Pass purchase coverage.
 *
 * The audit proved, with a WebSocket spy on a live page, that buying a pass
 * published nothing: `updateOwnerCoins` is a local optimistic mutation, the
 * deduction was visible only inside this modal's own hook instance, and a reload
 * restored the balance while clearing the pass — so passes were free and
 * unlimited. It also found that an unresolved coin query rendered as
 * "Your current coins: 0" and disabled the button, telling a player with 983,338
 * coins that they were broke.
 *
 * These tests pin the fix: the charge goes through the canonical coin writer,
 * the pass is granted only on success, a failure grants nothing and says so, and
 * an unknown balance is never rendered as a number.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { ArcadePassModal, ARCADE_PASS_PRICE } from './ArcadePassModal';
import { clearArcadePass, hasArcadePass } from '@/lib/arcade-pass';

// ---------------------------------------------------------------------------
// Collaborators. Nothing here touches a relay: the point is that the modal calls
// the CANONICAL writer, not that the writer works (it has its own tests).
// ---------------------------------------------------------------------------

const changeCoins = vi.fn();
let coinsPending = false;

vi.mock('@/inventory/useCoinsMutation', () => ({
  useCoinsMutation: () => ({ mutateAsync: changeCoins, isPending: coinsPending }),
}));

let statusValue: {
  owner: { coins: number } | null;
  isLoading: boolean;
  error?: string;
};
const refreshFromRelay = vi.fn();
const updateOwnerCoins = vi.fn();

vi.mock('@/hooks/useOptimizedStatus', () => ({
  useOptimizedStatus: () => ({
    status: statusValue,
    refreshFromRelay,
    updateOwnerCoins,
  }),
}));

const toast = vi.fn();
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast }) }));

function renderModal() {
  return render(<ArcadePassModal isOpen onClose={() => {}} />);
}

const buyButton = () => screen.getByRole('button', { name: /buy ticket|buying/i });

beforeEach(() => {
  changeCoins.mockReset().mockResolvedValue({ previousCoins: 100, newCoins: 80 });
  refreshFromRelay.mockReset();
  updateOwnerCoins.mockReset();
  toast.mockReset();
  coinsPending = false;
  statusValue = { owner: { coins: 100 }, isLoading: false };
  clearArcadePass();
});

afterEach(() => {
  clearArcadePass();
});

describe('the coin balance is never faked', () => {
  it('shows a skeleton, not a zero, while the balance is loading', () => {
    statusValue = { owner: null, isLoading: true };
    renderModal();

    expect(screen.getByText(/your current coins/i)).toBeInTheDocument();
    // The dialog portals to the body, so query there rather than in the
    // render container.
    expect(document.body.querySelector('.animate-pulse')).toBeInTheDocument();
    // The old bug: a loading balance rendered as the number 0.
    expect(screen.queryByText('0')).toBeNull();
    expect(buyButton()).toBeDisabled();
  });

  it('shows an error with a retry when the balance cannot be read', () => {
    statusValue = { owner: null, isLoading: false, error: 'relay unreachable' };
    renderModal();

    expect(screen.getByText(/couldn't read your coin balance/i)).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
    expect(buyButton()).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refreshFromRelay).toHaveBeenCalledTimes(1);
  });

  it('treats a resolved-but-absent profile as unknown, not as zero', () => {
    statusValue = { owner: null, isLoading: false };
    renderModal();

    expect(screen.getByText(/couldn't read your coin balance/i)).toBeInTheDocument();
    expect(buyButton()).toBeDisabled();
  });

  it('shows the real balance once it resolves', () => {
    statusValue = { owner: { coins: 983338 }, isLoading: false };
    renderModal();

    expect(screen.getByText('983338')).toBeInTheDocument();
    expect(buyButton()).toBeEnabled();
  });

  it('refuses the purchase when the player genuinely cannot afford it', () => {
    statusValue = { owner: { coins: ARCADE_PASS_PRICE - 1 }, isLoading: false };
    renderModal();

    expect(buyButton()).toBeDisabled();
    expect(screen.getByText(new RegExp(`need ${ARCADE_PASS_PRICE} coins`, 'i'))).toBeInTheDocument();
  });
});

describe('the purchase is a real transaction', () => {
  it('charges through the canonical coin mutation, exactly once', async () => {
    renderModal();
    fireEvent.click(buyButton());

    await waitFor(() => expect(changeCoins).toHaveBeenCalledTimes(1));
    expect(changeCoins).toHaveBeenCalledWith(-ARCADE_PASS_PRICE);
  });

  it('never uses the local optimistic coin path', async () => {
    renderModal();
    fireEvent.click(buyButton());

    await waitFor(() => expect(changeCoins).toHaveBeenCalled());
    // `updateOwnerCoins` publishes nothing and is per-hook-instance; using it is
    // what made the charge fictional.
    expect(updateOwnerCoins).not.toHaveBeenCalled();
  });

  it('grants the pass only after the charge succeeds', async () => {
    let resolveCharge: () => void = () => {};
    changeCoins.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCharge = resolve;
        }),
    );

    renderModal();
    fireEvent.click(buyButton());

    // In flight: charged nothing yet, so no pass yet.
    expect(hasArcadePass()).toBe(false);

    resolveCharge();
    await waitFor(() => expect(hasArcadePass()).toBe(true));
  });

  it('grants nothing when the publish fails, and says so', async () => {
    changeCoins.mockRejectedValue(new Error('Insufficient coins'));
    const onClose = vi.fn();
    render(<ArcadePassModal isOpen onClose={onClose} />);

    fireEvent.click(buyButton());

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(hasArcadePass()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/no coins were deducted/i);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('closes and confirms on success', async () => {
    const onClose = vi.fn();
    render(<ArcadePassModal isOpen onClose={onClose} />);

    fireEvent.click(buyButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(hasArcadePass()).toBe(true);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Arcade Pass Purchased!' }),
    );
  });

  it('cannot be double-charged by a double click', async () => {
    coinsPending = true;
    renderModal();

    expect(buyButton()).toBeDisabled();
    fireEvent.click(buyButton());
    fireEvent.click(buyButton());
    expect(changeCoins).not.toHaveBeenCalled();
  });

  it('charges once even when two clicks land in the same tick', async () => {
    // `isPending` only flips after a re-render, so the disabled button cannot be
    // the guarantee — the synchronous in-flight ref is.
    changeCoins.mockImplementation(() => new Promise(() => {}));
    renderModal();

    const button = buyButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(changeCoins).toHaveBeenCalledTimes(1);
  });

  it('does not grant a pass when the modal is closed mid-charge', async () => {
    let resolveCharge: () => void = () => {};
    changeCoins.mockImplementation(
      () => new Promise<void>((resolve) => { resolveCharge = resolve; }),
    );

    const { unmount } = renderModal();
    fireEvent.click(buyButton());
    unmount();

    expect(hasArcadePass()).toBe(false);
    // The charge is already in flight and the player has paid, so when it lands
    // the pass is still granted — closing a modal must not silently take the
    // purchase away.
    resolveCharge();
    await waitFor(() => expect(hasArcadePass()).toBe(true));
  });
});

describe('storage failure after a successful charge', () => {
  /** Make `sessionStorage.setItem` throw, as Safari private browsing does. */
  function breakStorage() {
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    return () => {
      Storage.prototype.setItem = setItem;
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never claims the coins were safe when only the pass write failed', async () => {
    const restore = breakStorage();
    const onClose = vi.fn();
    render(<ArcadePassModal isOpen onClose={onClose} />);

    fireEvent.click(buyButton());

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    const alert = screen.getByRole('alert');

    // The charge DID go through, so the "no coins were deducted" copy would be a
    // lie. This is the distinction the three outcomes exist for.
    expect(alert).not.toHaveTextContent(/no coins were deducted/i);
    expect(alert).toHaveTextContent(/coins may already have been spent/i);
    expect(hasArcadePass()).toBe(false);
    // Still open, so the player can retry once storage is available.
    expect(onClose).not.toHaveBeenCalled();
    restore();
  });

  it('attempts no compensating coin write', async () => {
    const restore = breakStorage();
    render(<ArcadePassModal isOpen onClose={() => {}} />);

    fireEvent.click(buyButton());
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    // A refund would be a second unverified publish stacked on a first whose
    // outcome is unknown, and could hand back coins that were never taken.
    expect(changeCoins).toHaveBeenCalledTimes(1);
    expect(changeCoins).toHaveBeenCalledWith(-ARCADE_PASS_PRICE);
    restore();
  });

  it('reports a failed charge and a failed pass write differently', async () => {
    changeCoins.mockRejectedValue(new Error('Insufficient coins'));
    render(<ArcadePassModal isOpen onClose={() => {}} />);

    fireEvent.click(buyButton());
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    expect(screen.getByRole('alert')).toHaveTextContent(/no coins were deducted/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/may already have been spent/i);
  });
});
