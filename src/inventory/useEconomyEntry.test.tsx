/**
 * React binding — one root controller drives the allocation; status readers
 * observe without triggering; accounts stay isolated across switches.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { clearCoinOps } from '@/lib/coin-op-ledger';

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

    // Switching back re-uses A's settled state — no third publish.
    currentPubkey = PUBKEY_A;
    rerender(makeApp(<Controller />));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(published).toHaveLength(2);
  });
});
