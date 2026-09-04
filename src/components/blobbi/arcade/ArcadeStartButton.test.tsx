import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FREE_ARCADE_GAME_ENTRY, type ArcadeGameEntry } from '@/arcade/tokens/game-entry';
import { arcadeEntryLooksShort, arcadeStartLabel } from '@/arcade/tokens/start-label';
import { ArcadeStartButton } from './ArcadeStartButton';

function paid(cost: number, balance: number | null, hasPass = false): ArcadeGameEntry {
  return {
    tokenBalance: balance,
    hasPass,
    costFor: () => cost,
    admitFree: () => (hasPass ? { ok: true, charged: 0, waivedByPass: true } : null),
    admit: async () => ({ ok: true, charged: cost, waivedByPass: false }),
  };
}

describe('the start label says the price first', () => {
  it('names the cost of a paid run before it is pressed', () => {
    expect(arcadeStartLabel({ entry: paid(1, 5), gameId: 'g' })).toBe('Play · 1 Token');
    expect(arcadeStartLabel({ entry: paid(2, 5), gameId: 'g' })).toBe('Play · 2 Tokens');
    expect(arcadeStartLabel({ entry: paid(1, 5), gameId: 'g', replay: true })).toBe('Play again · 1 Token');
  });

  it('drops the price when the run is free or a Pass waives it', () => {
    expect(arcadeStartLabel({ entry: FREE_ARCADE_GAME_ENTRY, gameId: 'g' })).toBe('Start');
    expect(arcadeStartLabel({ entry: paid(1, 0, true), gameId: 'g' })).toBe('Start');
    expect(arcadeStartLabel({ entry: paid(1, 0, true), gameId: 'g', replay: true })).toBe('Play again');
  });

  it('knows when the balance is short, and only then', () => {
    expect(arcadeEntryLooksShort({ entry: paid(1, 0), gameId: 'g' })).toBe(true);
    expect(arcadeEntryLooksShort({ entry: paid(1, 1), gameId: 'g' })).toBe(false);
    expect(arcadeEntryLooksShort({ entry: paid(1, null), gameId: 'g' })).toBe(false); // unknown is not short
    expect(arcadeEntryLooksShort({ entry: paid(1, 0, true), gameId: 'g' })).toBe(false); // a Pass covers it
    expect(arcadeEntryLooksShort({ entry: FREE_ARCADE_GAME_ENTRY, gameId: 'g' })).toBe(false);
  });
});

describe('the start button', () => {
  it('shows the cost and stays live, leaving refusal to the entry model', () => {
    const onClick = vi.fn();
    render(<ArcadeStartButton entry={paid(1, 0)} gameId="g" onClick={onClick} dataAttribute="data-test-start" dataValue="first" />);
    const button = screen.getByRole('button', { name: 'Play · 1 Token' });
    expect(button).toHaveAttribute('data-test-start', 'first');
    expect(button).toHaveAttribute('data-arcade-start-cost', '1');
    expect(button).not.toBeDisabled();
    expect(screen.getByText(/Not enough Tokens yet; you have 0/)).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('says nothing about a shortfall when the player can afford it', () => {
    render(<ArcadeStartButton entry={paid(1, 3)} gameId="g" onClick={() => {}} />);
    expect(document.querySelector('[data-arcade-start-short]')).toBeNull();
  });
});
