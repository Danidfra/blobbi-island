/**
 * Reloading inside the Mine restores the ROOM and nothing else.
 *
 * The distinction this pins is the whole reason location resume is safe to
 * ship. `cave-open` is a location like any other, so presence restores it, but
 * a mining run is not a location. It is a durable session with energy and Coins
 * attached, and the existing lifecycle deliberately ABANDONS an unfinished run
 * on unmount: no energy charged, no Coins granted (`docs/mine-session-settlement.md`).
 *
 * Restoring the room must not quietly undo that. A resumed Mine has to look
 * exactly like walking into the cave: the instructions screen, no session, no
 * settlement. These tests fail if resume ever grows the ability to rehydrate a
 * run: which is the tempting next feature and the wrong one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const startSession = vi.fn(() => true);
const finalizeSession = vi.fn(() => true);
const abandonSession = vi.fn();
const settle = vi.fn(async () => ({ phase: 'settled', coinReward: 0, coinApplied: true }));
const setCurrentLocation = vi.fn();
const refreshFromRelay = vi.fn();

vi.mock('@/hooks/useLocation', () => ({
  useLocation: () => ({ currentLocation: 'cave-open', setCurrentLocation }),
}));

vi.mock('@/hooks/useOptimizedStatus', () => ({
  useOptimizedStatus: () => ({
    status: { currentPet: { id: 'pet-1', name: 'Blob', energy: 90 } },
    refreshFromRelay,
  }),
}));

vi.mock('@/hooks/useMineSettlement', () => ({
  useMineSettlement: () => ({
    settlement: { startSession, finalizeSession, abandonSession },
    settle,
  }),
}));

const { MiningGame } = await import('./MiningGame');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Mine after a location resume', () => {
  it('mounts at the instructions screen, not into a run', () => {
    render(<MiningGame />);

    expect(screen.getByText(/Energy: Each click consumes 10 energy/i)).toBeInTheDocument();
  });

  it('does not fabricate a mining session', () => {
    render(<MiningGame />);

    // A resumed ROOM must mint no session. The run starts when the player
    // starts it, exactly as it does when they walk in through the cave mouth.
    expect(startSession).not.toHaveBeenCalled();
  });

  it('has no energy or reward side effect', () => {
    const { unmount } = render(<MiningGame />);
    unmount();

    expect(finalizeSession).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    // Nothing was started, so there is nothing to abandon either.
    expect(abandonSession).not.toHaveBeenCalled();
  });

  it('resumes no progress across a reload-shaped remount', () => {
    // Two mounts in a row is what a reload looks like to this component. The
    // second must be as empty as the first; no clicks, no loot, no session.
    const first = render(<MiningGame />);
    first.unmount();
    render(<MiningGame />);

    expect(screen.getByText(/Energy: Each click consumes 10 energy/i)).toBeInTheDocument();
    expect(startSession).not.toHaveBeenCalled();
    expect(finalizeSession).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });
});
