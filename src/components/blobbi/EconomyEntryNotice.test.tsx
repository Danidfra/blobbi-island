/**
 * Pre-world economy-entry notice — copy and visibility contract.
 *
 * Speaks only when there is something to say (applying / ambiguous /
 * retryable failure), stays silent for checking/applied/idle, offers retry
 * only for safe states, and never leaks Nostr or migration terminology.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { EconomyEntrySnapshot } from '@/inventory/useEconomyEntry';

const mockStatus = vi.fn<() => EconomyEntrySnapshot & { retry: () => void }>();

vi.mock('@/inventory/useEconomyEntry', () => ({
  useEconomyEntryStatus: () => mockStatus(),
}));

import { EconomyEntryNotice } from './EconomyEntryNotice';

function statusOf(partial: Partial<EconomyEntrySnapshot>, retry = vi.fn()) {
  return {
    phase: 'idle' as const,
    canRetry: false,
    ...partial,
    retry,
  };
}

afterEach(() => vi.clearAllMocks());

describe('EconomyEntryNotice', () => {
  it.each([['idle'], ['checking'], ['applied']])('renders nothing for %s', (phase) => {
    mockStatus.mockReturnValue(statusOf({ phase: phase as EconomyEntrySnapshot['phase'] }));
    const { container } = render(<EconomyEntryNotice />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the applying copy', () => {
    mockStatus.mockReturnValue(statusOf({ phase: 'applying' }));
    render(<EconomyEntryNotice />);
    expect(screen.getByRole('status')).toHaveTextContent('Preparing your Island Coins…');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the ambiguous/confirming copy', () => {
    mockStatus.mockReturnValue(statusOf({ phase: 'ambiguous', canRetry: true }));
    render(<EconomyEntryNotice />);
    expect(screen.getByRole('status')).toHaveTextContent('Confirming your Island Coins…');
  });

  it('shows the retryable failure copy with a working retry button', () => {
    const retry = vi.fn();
    mockStatus.mockReturnValue(statusOf({ phase: 'failed', canRetry: true }, retry));
    render(<EconomyEntryNotice />);
    expect(screen.getByRole('status')).toHaveTextContent(
      "We couldn't prepare your Island Coins yet.",
    );
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for a NON-retryable failure (no unsafe retry offered)', () => {
    mockStatus.mockReturnValue(statusOf({ phase: 'failed', canRetry: false }));
    const { container } = render(<EconomyEntryNotice />);
    expect(container.firstChild).toBeNull();
  });

  it('never leaks protocol or migration language', () => {
    for (const phase of ['applying', 'ambiguous'] as const) {
      mockStatus.mockReturnValue(statusOf({ phase, canRetry: true }));
      const { container, unmount } = render(<EconomyEntryNotice />);
      const text = container.textContent ?? '';
      for (const forbidden of ['nostr', 'relay', 'event', 'kind', '31633', 'migrat', 'op id', 'legacy']) {
        expect(text.toLowerCase()).not.toContain(forbidden);
      }
      unmount();
    }
  });
});
