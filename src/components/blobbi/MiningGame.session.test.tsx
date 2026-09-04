/**
 * A mining run, end to end, through the real component and the real durable
 * session lifecycle.
 *
 * What changed and is pinned here: gameplay publishes NOTHING. The energy cost
 * and the Coin reward are one settlement at the end, and an interrupted run
 * costs the player nothing at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { createMineSettlement } from '@/mine/mine-settlement';
import {
  clearMineSessions,
  readMineSession,
  readMineSessions,
} from '@/mine/mine-session-ledger';
import type { CoinWallet } from '@/inventory/coin-wallet';
import type { EnergySettler } from '@/mine/energy-settlement';

const PUBKEY = 'f'.repeat(64);
const PET_ID = 'blobbi-aa-bb';

/** Every publish the app could make during a run, counted. */
const coinGrants: { opId: string; amount: number }[] = [];
const energySettlements: { opId: string; amount: number }[] = [];
let coinBehaviour: 'applied' | 'ambiguous' = 'applied';

const wallet = {
  grantCoins: vi.fn(async (op: { opId: string; amount: number }) => {
    coinGrants.push({ opId: op.opId, amount: op.amount });
    if (coinBehaviour === 'ambiguous') {
      return { status: 'ambiguous', reason: 'publish-timeout' } as const;
    }
    return { status: 'applied', balance: 100, verified: true } as const;
  }),
  spendCoins: vi.fn(),
  readBalance: vi.fn(),
  reconcileOp: vi.fn(),
} as unknown as CoinWallet;

const settler: EnergySettler = {
  settleEnergyDelta: vi.fn(async (op) => {
    energySettlements.push({ opId: op.opId, amount: op.amount });
    return {
      status: 'applied' as const,
      energyAfter: 20,
      appliedDelta: op.amount,
      verified: true,
    };
  }),
  reconcileEnergyOp: vi.fn(async () => null),
};

vi.mock('@/hooks/useLocation', () => ({
  useLocation: () => ({ setCurrentLocation: () => {}, currentLocation: 'mine' }),
}));
vi.mock('@/hooks/useOptimizedStatus', () => ({
  useOptimizedStatus: () => ({
    status: { currentPet: { id: PET_ID, energy: 100, stage: 'adult' } },
    updatePetStats: () => {
      throw new Error('gameplay must not touch global pet status');
    },
    refreshFromRelay: () => {},
  }),
}));
vi.mock('@/hooks/useMineSettlement', () => ({
  useMineSettlement: () => {
    const settlement = createMineSettlement({
      pubkey: PUBKEY,
      wallet,
      settler,
      now: () => 1_700_000_000_000,
    });
    return {
      settlement,
      settle: (sessionId: string) => settlement.settleSession(sessionId),
    };
  },
}));

const { MiningGame } = await import('./MiningGame');

function renderMine() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MiningGame />
    </QueryClientProvider>,
  );
}

function wall(): HTMLElement {
  const element = document.querySelector('.hover\\:cursor-pickaxe');
  if (!element) throw new Error('mining surface not found');
  return element as HTMLElement;
}

/** Energy 100, 10 per click → the run ends on the 8th click (energy 20). */
async function playFullRun(clicks = 8) {
  await act(async () => {
    fireEvent.click(screen.getByText('Start'));
  });
  const surface = wall();
  for (let i = 0; i < clicks; i += 1) {
    await act(async () => {
      fireEvent.click(surface, { clientX: 10 + i, clientY: 10 + i });
    });
  }
}

beforeEach(() => {
  clearMineSessions();
  coinGrants.length = 0;
  energySettlements.length = 0;
  coinBehaviour = 'applied';
});
afterEach(() => {
  clearMineSessions();
  vi.clearAllMocks();
});

describe('gameplay is entirely local', () => {
  it('records ONE open durable session at Start, before any gameplay', async () => {
    renderMine();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    const sessions = readMineSessions(PUBKEY);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ status: 'open', petId: PET_ID, startEnergy: 100 });
  });
});

describe('finishing settles exactly once, in order', () => {
  it('one Coin operation and one energy operation, both from the session id', async () => {
    renderMine();
    await playFullRun();

    await waitFor(() => expect(coinGrants).toHaveLength(1));
    await waitFor(() => expect(energySettlements).toHaveLength(1));

    const sessionId = readMineSessions(PUBKEY)[0].sessionId;
    expect(coinGrants[0].opId).toBe(`mine:${sessionId}:coin`);
    expect(energySettlements[0].opId).toBe(`mine:${sessionId}:energy`);
    // 8 clicks × 10 energy = the whole run's cost, as ONE delta.
    expect(energySettlements[0].amount).toBe(80);
  });

  it('marks the session settled and tells the player', async () => {
    renderMine();
    await playFullRun();

    await waitFor(() =>
      expect(readMineSessions(PUBKEY)[0].status).toBe('settled'),
    );
    expect(
      document.querySelector('[data-mine-reward-status="settled"]'),
    ).not.toBeNull();
  });

  it('an unconfirmed reward does NOT charge energy, and says so plainly', async () => {
    coinBehaviour = 'ambiguous';
    renderMine();
    await playFullRun();

    await waitFor(() => expect(coinGrants).toHaveLength(1));
    expect(energySettlements).toHaveLength(0);
    await waitFor(() =>
      expect(readMineSessions(PUBKEY)[0].status).toBe('coin-pending'),
    );
    expect(screen.getByText(/still confirming your mining trip/i)).toBeInTheDocument();
  });
});

describe('an interrupted run costs nothing', () => {
  it('unmounting mid-game publishes nothing and abandons the session', async () => {
    const { unmount } = renderMine();

    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    const surface = wall();
    // Half a run: local energy 100 → 50, nothing durable.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        fireEvent.click(surface, { clientX: 10 + i, clientY: 10 + i });
      });
    }

    unmount();

    expect(coinGrants).toHaveLength(0);
    expect(energySettlements).toHaveLength(0);
    expect(readMineSessions(PUBKEY)[0].status).toBe('abandoned');
  });

  it('recovery of that abandoned session grants nothing', async () => {
    const { unmount } = renderMine();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    unmount();

    const settlement = createMineSettlement({
      pubkey: PUBKEY,
      wallet,
      settler,
      now: () => 1_700_000_000_000,
    });
    await settlement.recoverSessions();

    expect(coinGrants).toHaveLength(0);
    expect(energySettlements).toHaveLength(0);
  });
});

/**
 * The cave refuses a second concurrent trip.
 *
 * The point is that the refusal happens at START: a run whose reward another
 * live run may already have claimed must not cost the Blobbi its energy.
 */
describe('one mining trip at a time', () => {
  it('refuses to start while another tab is mid-run, charging no energy', async () => {
    // Another tab's live session, written through the same durable ledger.
    const otherTab = createMineSettlement({
      pubkey: PUBKEY,
      wallet,
      settler,
      now: () => 1_700_000_000_000,
      ownerId: 'another-tab',
    });
    const live = await otherTab.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!live.ok) throw new Error('start failed');

    renderMine();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });

    expect(document.querySelector('[data-mine-session-in-progress]')).not.toBeNull();
    expect(screen.getByText(/already have a mining trip in progress/i)).toBeInTheDocument();
    // No second session, and the other tab's run is untouched.
    expect(readMineSessions(PUBKEY).filter((r) => r.status === 'open')).toHaveLength(1);
    expect(energySettlements).toHaveLength(0);
    expect(coinGrants).toHaveLength(0);
  });

  it('opening the cave does not void a run in progress elsewhere', async () => {
    const otherTab = createMineSettlement({
      pubkey: PUBKEY,
      wallet,
      settler,
      now: () => 1_700_000_000_000,
      ownerId: 'another-tab',
    });
    const live = await otherTab.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!live.ok) throw new Error('start failed');

    // Mounting runs startup recovery, which used to abandon every open run.
    renderMine();
    await act(async () => {});

    expect(readMineSession(PUBKEY, live.sessionId)?.status).toBe('open');
  });

  it('a reload mid-run frees the Mine for the same tab at once', async () => {
    // This tab's own run, started before the reload. The unmount cleanup never
    // ran (a reload does not run it), so the record is still open and fresh.
    const beforeReload = createMineSettlement({
      pubkey: PUBKEY,
      wallet,
      settler,
      now: () => 1_700_000_000_000,
    });
    const orphan = await beforeReload.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!orphan.ok) throw new Error('start failed');

    // The reloaded tab: same sessionStorage identity, a fresh component.
    renderMine();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });

    expect(document.querySelector('[data-mine-session-in-progress]')).toBeNull();
    expect(readMineSession(PUBKEY, orphan.sessionId)).toMatchObject({
      status: 'abandoned',
      note: 'orphaned-by-reload',
    });
    expect(readMineSessions(PUBKEY).filter((r) => r.status === 'open')).toHaveLength(1);
  });

  it('leaving the page mid-run abandons the session before the tab goes', async () => {
    renderMine();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    const open = readMineSessions(PUBKEY).filter((r) => r.status === 'open');
    expect(open).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(readMineSession(PUBKEY, open[0].sessionId)?.status).toBe('abandoned');
    expect(energySettlements).toHaveLength(0);
    expect(coinGrants).toHaveLength(0);
  });

  it('a normal solo run is unaffected', async () => {
    renderMine();
    await playFullRun();

    await waitFor(() => {
      expect(document.querySelector('[data-mine-reward-status]')).not.toBeNull();
    });
    expect(document.querySelector('[data-mine-session-in-progress]')).toBeNull();
    expect(coinGrants).toHaveLength(1);
  });
});
