/**
 * React binding: one root controller drives the allocation; status readers
 * observe without triggering; accounts stay isolated across switches.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { clearCoinOps } from '@/lib/coin-op-ledger';
import { BLOBBI_COIN_ADDRESS } from './coin';
import { ISLAND_ALLOCATION_MARKER } from './economy-entry';
import { ISLAND_INVENTORY_D, KIND_GAME_INVENTORY } from './package';

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);

// One fake relay for the module-mocked useNostr.
const stored = new Map<string, NostrEvent>();
const published: NostrEvent[] = [];
const nostrFake = {
  query: vi.fn(async (filters: { authors?: string[] }[]) => {
    const author = filters[0]?.authors?.[0];
    const event = author ? stored.get(author) : undefined;
    return event ? [event] : [];
  }),
  event: vi.fn(async (event: NostrEvent) => {
    published.push(event);
    stored.set(event.pubkey, event);
  }),
};

let currentPubkey: string | null = PUBKEY_A;

vi.mock('@/hooks/useNostr', () => ({
  useNostr: () => ({ nostr: nostrFake }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: currentPubkey
      ? {
          pubkey: currentPubkey,
          signer: {
            signEvent: async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
              ...t,
              id: `signed-${Math.random().toString(16).slice(2)}`,
              pubkey: currentPubkey as string,
              sig: 'sig',
            }),
          },
        }
      : undefined,
  }),
}));

import {
  useEconomyEntryController,
  useEconomyEntryStatus,
  resetEconomyEntryRuns,
} from './useEconomyEntry';

function Controller() {
  useEconomyEntryController();
  return null;
}

function StatusProbe({ onPhase }: { onPhase: (phase: string) => void }) {
  const status = useEconomyEntryStatus();
  onPhase(status.phase);
  return <span data-testid="phase">{status.phase}</span>;
}

/** A status reader that can also drive the shared retry, as a surface does. */
function RetryProbe() {
  const status = useEconomyEntryStatus();
  return (
    <button type="button" data-testid="retry" onClick={() => status.retry()}>
      {status.phase}
    </button>
  );
}

/** A read that cannot be completed, the relay hiccup that stranded players. */
function failReads() {
  nostrFake.query.mockImplementation(async () => {
    const error = new Error('read timed out');
    error.name = 'TimeoutError';
    throw error;
  });
}

/** Restore the default store-backed read. */
function healReads() {
  nostrFake.query.mockImplementation(async (filters: { authors?: string[] }[]) => {
    const author = filters[0]?.authors?.[0];
    const event = author ? stored.get(author) : undefined;
    return event ? [event] : [];
  });
}

/** A kind:31633 event already carrying the v1 marker and the given balance. */
function markedInventory(pubkey: string, coins: number): NostrEvent {
  const tags: string[][] = [['d', ISLAND_INVENTORY_D], [...ISLAND_ALLOCATION_MARKER]];
  if (coins > 0) tags.push(['a', BLOBBI_COIN_ADDRESS, '', String(coins)]);
  return {
    id: `seeded-${pubkey.slice(0, 4)}`,
    pubkey,
    created_at: 1000,
    kind: KIND_GAME_INVENTORY,
    tags,
    content: '',
    sig: 'sig',
  };
}

function makeApp(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  clearCoinOps();
  resetEconomyEntryRuns();
  stored.clear();
  published.length = 0;
  nostrFake.query.mockClear();
  nostrFake.event.mockClear();
  healReads();
  currentPubkey = PUBKEY_A;
});
afterEach(() => {
  clearCoinOps();
  vi.restoreAllMocks();
});

describe('useEconomyEntry binding', () => {
  it('the root controller applies the allocation once; status observers never trigger runs', async () => {
    const phases: string[] = [];
    const { rerender } = render(
      makeApp(
        <>
          <Controller />
          <StatusProbe onPhase={(p) => phases.push(p)} />
        </>,
      ),
    );

    await waitFor(() => expect(published).toHaveLength(1));
    await waitFor(() => expect(phases.at(-1)).toBe('applied'));

    // Re-mounting more status readers (modal open/close) publishes nothing new.
    rerender(
      makeApp(
        <>
          <Controller />
          <StatusProbe onPhase={(p) => phases.push(p)} />
          <StatusProbe onPhase={() => {}} />
          <StatusProbe onPhase={() => {}} />
        </>,
      ),
    );
    await waitFor(() => expect(phases.at(-1)).toBe('applied'));
    expect(published).toHaveLength(1);
  });

  it('a status reader WITHOUT a controller never publishes', async () => {
    render(makeApp(<StatusProbe onPhase={() => {}} />));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(published).toHaveLength(0);
    expect(nostrFake.event).not.toHaveBeenCalled();
  });

  it('account switching isolates state and grants each account exactly once', async () => {
    const { rerender } = render(makeApp(<Controller />));
    await waitFor(() => expect(published).toHaveLength(1));
    expect(published[0].pubkey).toBe(PUBKEY_A);

    currentPubkey = PUBKEY_B;
    rerender(makeApp(<Controller />));
    await waitFor(() => expect(published).toHaveLength(2));
    expect(published[1].pubkey).toBe(PUBKEY_B);

    // Switching back re-uses A's settled state; no third publish.
    currentPubkey = PUBKEY_A;
    rerender(makeApp(<Controller />));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(published).toHaveLength(2);
  });
});

/**
 * F-04: one relay hiccup at sign-in used to strand a player at 0 Coins for the
 * whole page, because the run map could not tell "running" from "finished
 * badly". These assert the recovery a player can actually reach.
 */
describe('failure recovery', () => {
  it('a settled failure can be retried in the same session; no page reload', async () => {
    failReads();
    render(makeApp(<><Controller /><RetryProbe /></>));

    await waitFor(() => expect(screen.getByTestId('retry')).toHaveTextContent('failed'));
    expect(published).toHaveLength(0);

    healReads();
    act(() => screen.getByTestId('retry').click());

    await waitFor(() => expect(screen.getByTestId('retry')).toHaveTextContent('applied'));
    expect(published).toHaveLength(1);
    expect(published[0].pubkey).toBe(PUBKEY_A);
  });

  it('a completed allocation is never re-granted by a retry', async () => {
    render(makeApp(<><Controller /><RetryProbe /></>));
    await waitFor(() => expect(screen.getByTestId('retry')).toHaveTextContent('applied'));
    expect(published).toHaveLength(1);

    act(() => screen.getByTestId('retry').click());
    act(() => screen.getByTestId('retry').click());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(published).toHaveLength(1);
    expect(screen.getByTestId('retry')).toHaveTextContent('applied');
  });

  it('a failed run is re-attempted after signing out and back in', async () => {
    failReads();
    const { rerender } = render(makeApp(<><Controller /><RetryProbe /></>));
    await waitFor(() => expect(screen.getByTestId('retry')).toHaveTextContent('failed'));

    // Sign out, then back in as the same account, without a page reload.
    healReads();
    currentPubkey = null;
    rerender(makeApp(<><Controller /><RetryProbe /></>));
    currentPubkey = PUBKEY_A;
    rerender(makeApp(<><Controller /><RetryProbe /></>));

    await waitFor(() => expect(published).toHaveLength(1));
    expect(published[0].pubkey).toBe(PUBKEY_A);
  });

  it('two retry clicks in one tick start ONE attempt', async () => {
    failReads();
    render(makeApp(<><Controller /><RetryProbe /></>));
    await waitFor(() => expect(screen.getByTestId('retry')).toHaveTextContent('failed'));

    // Hold every read open so the first attempt is still in flight when the
    // second click lands.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    nostrFake.query.mockImplementation(async (filters: { authors?: string[] }[]) => {
      await held;
      const author = filters[0]?.authors?.[0];
      const event = author ? stored.get(author) : undefined;
      return event ? [event] : [];
    });
    nostrFake.query.mockClear();

    const button = screen.getByTestId('retry');
    act(() => {
      button.click();
      button.click();
    });

    // The second click issued no second read: it found an attempt in flight.
    expect(nostrFake.query).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
      await held;
    });
    await waitFor(() => expect(screen.getByTestId('retry')).toHaveTextContent('applied'));
    expect(published).toHaveLength(1);
  });

  it('a retry after a publish that actually LANDED grants nothing more', async () => {
    // The classic ambiguity: the relay stored the event, then the response
    // timed out. The marker is now the authoritative proof.
    nostrFake.event.mockImplementationOnce(async (event: NostrEvent) => {
      published.push(event);
      stored.set(event.pubkey, event);
      const error = new Error('publish timed out');
      error.name = 'TimeoutError';
      throw error;
    });

    render(makeApp(<><Controller /><RetryProbe /></>));
    await waitFor(() => expect(screen.getByTestId('retry')).toHaveTextContent('ambiguous'));
    expect(published).toHaveLength(1);

    act(() => screen.getByTestId('retry').click());

    await waitFor(() => expect(screen.getByTestId('retry')).toHaveTextContent('applied'));
    expect(published).toHaveLength(1);
  });

  it('a marker-present account at ZERO Coins stays at zero, a retry adds nothing', async () => {
    // Spent down to nothing: the balance is not proof, the marker is.
    stored.set(PUBKEY_A, markedInventory(PUBKEY_A, 0));

    render(makeApp(<><Controller /><RetryProbe /></>));
    await waitFor(() => expect(screen.getByTestId('retry')).toHaveTextContent('applied'));
    expect(published).toHaveLength(0);

    act(() => screen.getByTestId('retry').click());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(published).toHaveLength(0);
  });
});
