/**
 * The Mine must not storm the relay.
 *
 * `MiningGame` refreshes the authoritative pet state once when the cave opens:
 *
 * ```js
 * useEffect(() => { refreshFromRelay(); }, [refreshFromRelay]);
 * ```
 *
 * That is correct ONLY if `refreshFromRelay` is referentially stable. It was
 * not: `useOptimizedStatus` declared it with `[clearPendingUpdates, ownerQuery,
 * petsQuery]`, and the `useQuery` RESULT OBJECTS get a new identity on every
 * render — so the callback did too, and the effect re-fired on every render.
 * One measured session issued 11 refreshes = 22 relay reads, each of which
 * could resolve empty and wipe the player's state.
 *
 * Two levels of coverage, because the bug lived in the seam between them:
 * the hook's callback identity, and the component's effect firing.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, render, screen, fireEvent, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const OWNER = 'a'.repeat(64);

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { req: () => (async function* () {})(), query: async () => [] } }),
}));
vi.mock('@/hooks/useNostr', () => ({
  useNostr: () => ({ nostr: { req: () => (async function* () {})(), query: async () => [] } }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: OWNER, signer: { signEvent: async () => ({}) } } }),
}));

const { useOptimizedStatus } = await import('@/hooks/useOptimizedStatus');

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useOptimizedStatus().refreshFromRelay is referentially stable', () => {
  it('keeps the same identity across re-renders', () => {
    const { result, rerender } = renderHook(() => useOptimizedStatus(), {
      wrapper: wrapper(),
    });
    const first = result.current.refreshFromRelay;
    rerender();
    rerender();
    rerender();
    // An unstable identity here is what made the Mine's effect re-fire.
    expect(result.current.refreshFromRelay).toBe(first);
  });
});

describe('MiningGame refreshes once per mount, not once per render', () => {
  it('does not re-fire the refresh effect while the player mines', async () => {
    vi.resetModules();

    let refreshCount = 0;
    const petStateWrites: unknown[] = [];

    vi.doMock('@/hooks/useLocation', () => ({
      useLocation: () => ({ setCurrentLocation: () => {}, currentLocation: 'mine' }),
    }));
    // Mirrors the REAL hook's contract: a stable callback identity.
    vi.doMock('@/hooks/useOptimizedStatus', async () => {
      const { useCallback } = await import('react');
      return {
        useOptimizedStatus: () => {
          const refreshFromRelay = useCallback(() => {
            refreshCount += 1;
          }, []);
          return {
            status: { currentPet: { id: 'blobbi-a', energy: 100, stage: 'adult' } },
            updatePetStats: () => {},
            refreshFromRelay,
          };
        },
      };
    });
    vi.doMock('@/hooks/useBlobbiEvents', () => ({
      useUpdatePetState: () => ({ mutate: (args: unknown) => petStateWrites.push(args) }),
    }));
    vi.doMock('@/inventory/useCoinWallet', () => ({
      useCoinWallet: () => ({
        grantCoins: async () => ({ status: 'applied', balance: 1, verified: true }),
      }),
    }));

    const { MiningGame } = await import('./MiningGame');
    render(<MiningGame />);

    expect(refreshCount).toBe(1);

    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });

    const wall = document.querySelector('.hover\\:cursor-pickaxe') as HTMLElement;
    expect(wall).toBeTruthy();
    for (let i = 0; i < 12; i += 1) {
      fireEvent.click(wall, { clientX: 10 + i, clientY: 10 + i });
    }

    // A whole session's worth of state updates and re-renders…
    expect(petStateWrites.length).toBeGreaterThan(0);
    // …and still exactly ONE refresh. This was 11 before the fix.
    expect(refreshCount).toBe(1);
  });
});
