/**
 * Resume as the app actually runs it: a real EOSE-aware read, a real
 * `LocationProvider`, and the guarantees that keep this a BOOTSTRAP feature.
 *
 * The two that matter most are negative:
 *
 *  - a presence event arriving after boot must not move the player;
 *  - a navigation must beat an in-flight resume, permanently.
 *
 * Both are properties of the wiring, not of the pure policy, so they are tested
 * here against the real provider rather than reasoned about.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, screen, act, waitFor } from '@testing-library/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { EXP_SECONDS, publishPresenceLogin } from '@/lib/multiplayer';
import type { LocationId } from '@/lib/location-types';
import type { Position } from '@/lib/types';
import { grantArcadePass, clearArcadePass, resetArcadePassSubscribers } from '@/lib/arcade-pass';
import { STANDARD_POLICY } from '@/safety';

const PLAYER = 'a'.repeat(64);
const NOW = 1_800_000_000;
const ISLAND = '1';

type ReqMessage =
  | ['EVENT', string, NostrEvent]
  | ['EOSE', string]
  | ['CLOSED', string, string];

/** What the fake relay does for the next read. */
let relayScript: () => ReqMessage[] = () => [['EOSE', 's']];
let reqCount = 0;
let lastFilters: unknown;

const nostrStub = {
  req: (filters: unknown) => {
    reqCount += 1;
    lastFilters = filters;
    const messages = relayScript();
    return (async function* () {
      for (const msg of messages) yield msg;
    })();
  },
  query: async () => {
    throw new Error('query must not be used when req is available');
  },
  event: async () => {},
};

vi.mock('@nostrify/react', () => ({ useNostr: () => ({ nostr: nostrStub }) }));
vi.mock('@/hooks/useNostr', () => ({ useNostr: () => ({ nostr: nostrStub }) }));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: PLAYER, signer: { signEvent: async () => ({}) } } }),
}));

const { useIslandLocationResume } = await import('./useIslandLocationResume');
const { LocationProvider } = await import('@/contexts/LocationContext');
const { useLocation } = await import('./useLocation');

function presenceEvent(location: string, createdAt: number, session = 'sess-1'): NostrEvent {
  return {
    id: `${location}-${createdAt}`.padEnd(64, '0').slice(0, 64),
    pubkey: PLAYER,
    kind: 31950,
    created_at: createdAt,
    sig: '0'.repeat(128),
    content: JSON.stringify({
      state: 'idle',
      location,
      anchor: { x: 50, y: 80, ts: createdAt },
    }),
    tags: [
      ['d', `session:${session}`],
      ['a', `31124:${PLAYER}:pet`],
      ['t', 'blobbi:presence'],
      ['t', `island:${ISLAND}`],
      ['t', `loc:${location}`],
      ['expiration', String(createdAt + EXP_SECONDS)],
    ],
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW * 1000);
  relayScript = () => [['EOSE', 's']];
  reqCount = 0;
  lastFilters = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useIslandLocationResume', () => {
  it('reads the signed-in player’s own kind:31950 presence', async () => {
    relayScript = () => [['EOSE', 's']];

    const { result } = renderHook(() => useIslandLocationResume(ISLAND), { wrapper });
    await waitFor(() => expect(result.current.isSettled).toBe(true));

    expect(lastFilters).toEqual([
      {
        kinds: [31950],
        authors: [PLAYER],
        '#t': ['blobbi:presence'],
        limit: 20,
      },
    ]);
  });

  it('restores a fresh presence location', async () => {
    relayScript = () => [
      ['EVENT', 's', presenceEvent('beach', NOW - 5)],
      ['EOSE', 's'],
    ];

    const { result } = renderHook(() => useIslandLocationResume(ISLAND), { wrapper });
    await waitFor(() => expect(result.current.isSettled).toBe(true));

    expect(result.current.location).toBe('beach');
    expect(result.current.outcome.kind).toBe('fresh-presence');
  });

  it('classifies a refused REQ as unknown, never as confirmed empty', async () => {
    relayScript = () => [['CLOSED', 's', 'rate-limited']];

    const { result } = renderHook(() => useIslandLocationResume(ISLAND), { wrapper });
    await waitFor(() => expect(result.current.isSettled).toBe(true));

    expect(result.current.outcome).toEqual({ kind: 'unknown-read', reason: 'closed' });
    expect(result.current.location).toBe('town');
  });

  it('settles even when the relay never completes the read', async () => {
    // Events, then the iterator ends without EOSE: partial, so unknown.
    relayScript = () => [['EVENT', 's', presenceEvent('mine', NOW - 5)]];

    const { result } = renderHook(() => useIslandLocationResume(ISLAND), { wrapper });
    await waitFor(() => expect(result.current.isSettled).toBe(true));

    expect(result.current.outcome).toEqual({ kind: 'unknown-read', reason: 'unreachable' });
    // The partial event is diagnostics only — it did not become a restore.
    expect(result.current.location).toBe('town');
  });

  describe('arcade floors', () => {
    afterEach(() => {
      clearArcadePass();
      resetArcadePassSubscribers();
    });

    it('restores the exact floor for a player who still holds their pass', async () => {
      grantArcadePass();
      relayScript = () => [
        ['EVENT', 's', presenceEvent('arcade-1', NOW - 5)],
        ['EOSE', 's'],
      ];

      const { result } = renderHook(() => useIslandLocationResume(ISLAND), { wrapper });
      await waitFor(() => expect(result.current.isSettled).toBe(true));

      // Bought the pass, rode up, refreshed. No second purchase.
      expect(result.current.location).toBe('arcade-1');
      expect(result.current.outcome.kind).toBe('fresh-presence');
    });

    it('falls back to the entrance for a player without a pass', async () => {
      clearArcadePass();
      relayScript = () => [
        ['EVENT', 's', presenceEvent('arcade-minus1', NOW - 5)],
        ['EOSE', 's'],
      ];

      const { result } = renderHook(() => useIslandLocationResume(ISLAND), { wrapper });
      await waitFor(() => expect(result.current.isSettled).toBe(true));

      expect(result.current.location).toBe('arcade');
      expect(result.current.outcome.kind).toBe('gated-presence');
    });

    it('restores the arcade entrance at the same position', async () => {
      relayScript = () => [
        ['EVENT', 's', presenceEvent('arcade', NOW - 5)],
        ['EOSE', 's'],
      ];

      const { result } = renderHook(() => useIslandLocationResume(ISLAND), { wrapper });
      await waitFor(() => expect(result.current.isSettled).toBe(true));

      expect(result.current.location).toBe('arcade');
      expect(result.current.position).not.toBeNull();
    });
  });

  it('reads once and never re-asks', async () => {
    relayScript = () => [
      ['EVENT', 's', presenceEvent('beach', NOW - 5)],
      ['EOSE', 's'],
    ];

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const sharedWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const first = renderHook(() => useIslandLocationResume(ISLAND), { wrapper: sharedWrapper });
    await waitFor(() => expect(first.result.current.isSettled).toBe(true));
    expect(reqCount).toBe(1);

    first.rerender();
    const second = renderHook(() => useIslandLocationResume(ISLAND), { wrapper: sharedWrapper });
    await waitFor(() => expect(second.result.current.isSettled).toBe(true));

    expect(reqCount).toBe(1);
    expect(second.result.current.location).toBe('beach');
  });
});

/** Reports and drives the live location, so the provider can be observed. */
function LocationProbe({ onNavigate }: { onNavigate?: LocationId }) {
  const { currentLocation, setCurrentLocation, bootstrapPosition } = useLocation();
  return (
    <div>
      <span data-testid="loc">{currentLocation}</span>
      <span data-testid="pos">
        {bootstrapPosition ? `${bootstrapPosition.x},${bootstrapPosition.y}` : 'spawn'}
      </span>
      <button onClick={() => onNavigate && setCurrentLocation(onNavigate)}>go</button>
    </div>
  );
}

describe('LocationProvider bootstrap', () => {
  it('opens in Town when no resume decision is supplied', () => {
    render(
      <LocationProvider>
        <LocationProbe />
      </LocationProvider>,
    );
    expect(screen.getByTestId('loc')).toHaveTextContent('town');
  });

  it('opens directly in the resumed location, with no Town render in between', () => {
    render(
      <LocationProvider initialLocation="mine">
        <LocationProbe />
      </LocationProvider>,
    );

    // The FIRST committed render is already the restored location — the world
    // never sees Town, so there is nothing to flash away from.
    expect(screen.getByTestId('loc')).toHaveTextContent('mine');
  });

  it('adopts a decision that lands after mount, without a scene transition', async () => {
    function Host() {
      const [initial, setInitial] = useState<LocationId | undefined>(undefined);
      useEffect(() => {
        const id = setTimeout(() => setInitial('beach'), 10);
        return () => clearTimeout(id);
      }, []);
      return (
        <LocationProvider initialLocation={initial}>
          <LocationProbe />
        </LocationProvider>
      );
    }

    render(<Host />);
    expect(screen.getByTestId('loc')).toHaveTextContent('town');

    await act(async () => {
      vi.advanceTimersByTime(20);
    });

    // No 500ms fade wait: bootstrap is not travel.
    expect(screen.getByTestId('loc')).toHaveTextContent('beach');
  });

  it('cannot be teleported by a later presence update', async () => {
    function Host() {
      const [initial, setInitial] = useState<LocationId | undefined>('beach');
      useEffect(() => {
        // A refetch arriving mid-session with a different answer.
        const id = setTimeout(() => setInitial('mine'), 10);
        return () => clearTimeout(id);
      }, []);
      return (
        <LocationProvider initialLocation={initial}>
          <LocationProbe />
        </LocationProvider>
      );
    }

    render(<Host />);
    expect(screen.getByTestId('loc')).toHaveTextContent('beach');

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(screen.getByTestId('loc')).toHaveTextContent('beach');
  });

  it('lets a navigation beat an in-flight resume, permanently', async () => {
    function Host() {
      const [initial, setInitial] = useState<LocationId | undefined>(undefined);
      useEffect(() => {
        const id = setTimeout(() => setInitial('mine'), 50);
        return () => clearTimeout(id);
      }, []);
      return (
        <LocationProvider initialLocation={initial}>
          <LocationProbe onNavigate="plaza" />
        </LocationProvider>
      );
    }

    render(<Host />);

    // Player walks somewhere before the resume answer lands.
    act(() => {
      screen.getByText('go').click();
    });
    await act(async () => {
      vi.advanceTimersByTime(600); // the transition's fade-out
    });
    expect(screen.getByTestId('loc')).toHaveTextContent('plaza');

    // The late resume must not yank them back.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('loc')).toHaveTextContent('plaza');
  });

  it('opens at the restored position on the very first frame', () => {
    render(
      <LocationProvider initialLocation="mine" initialPosition={{ x: 61.5, y: 88 }}>
        <LocationProbe />
      </LocationProvider>,
    );

    // Both are already correct in the FIRST committed render — no spawn frame,
    // no follow-up effect that moves the actor afterwards.
    expect(screen.getByTestId('loc')).toHaveTextContent('mine');
    expect(screen.getByTestId('pos')).toHaveTextContent('61.5,88');
  });

  it('adopts location and position in the same commit', async () => {
    function Host() {
      const [resume, setResume] = useState<{ loc?: LocationId; pos: Position | null }>({
        loc: undefined,
        pos: null,
      });
      useEffect(() => {
        const id = setTimeout(() => setResume({ loc: 'beach', pos: { x: 33, y: 82 } }), 10);
        return () => clearTimeout(id);
      }, []);
      return (
        <LocationProvider initialLocation={resume.loc} initialPosition={resume.pos}>
          <LocationProbe />
        </LocationProvider>
      );
    }

    render(<Host />);
    expect(screen.getByTestId('pos')).toHaveTextContent('spawn');

    await act(async () => {
      vi.advanceTimersByTime(20);
    });

    expect(screen.getByTestId('loc')).toHaveTextContent('beach');
    expect(screen.getByTestId('pos')).toHaveTextContent('33,82');
  });

  it('drops the bootstrap position the moment the player navigates', async () => {
    render(
      <LocationProvider initialLocation="beach" initialPosition={{ x: 33, y: 82 }}>
        <LocationProbe onNavigate="plaza" />
      </LocationProvider>,
    );
    expect(screen.getByTestId('pos')).toHaveTextContent('33,82');

    act(() => {
      screen.getByText('go').click();
    });

    // Cleared immediately, not on the far side of the fade — the destination
    // scene's own spawn rules own it from here.
    expect(screen.getByTestId('pos')).toHaveTextContent('spawn');

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByTestId('loc')).toHaveTextContent('plaza');
    expect(screen.getByTestId('pos')).toHaveTextContent('spawn');
  });

  it('cannot be teleported by a late resume answer after the player has moved', async () => {
    function Host() {
      const [resume, setResume] = useState<{ loc?: LocationId; pos: Position | null }>({
        loc: undefined,
        pos: null,
      });
      useEffect(() => {
        const id = setTimeout(() => setResume({ loc: 'mine', pos: { x: 61, y: 88 } }), 50);
        return () => clearTimeout(id);
      }, []);
      return (
        <LocationProvider initialLocation={resume.loc} initialPosition={resume.pos}>
          <LocationProbe onNavigate="plaza" />
        </LocationProvider>
      );
    }

    render(<Host />);

    act(() => {
      screen.getByText('go').click();
    });
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    // Neither the location nor the position moved.
    expect(screen.getByTestId('loc')).toHaveTextContent('plaza');
    expect(screen.getByTestId('pos')).toHaveTextContent('spawn');
  });

  it('publishes the restored location through the existing presence publisher', async () => {
    const published: Record<string, unknown>[] = [];

    /**
     * Stands in for `MultiplayerLayer`'s wiring: it reads the live location and
     * hands it to the SAME `publishPresenceLogin` production uses. No second
     * publisher exists, and the restore reaches this one the ordinary way —
     * through `currentLocation`, not through a side channel.
     */
    function PresencePublisher() {
      const { currentLocation } = useLocation();
      // Read at publish time, so the effect can depend on the location without
      // republishing on every change — login presence goes out once per session,
      // like the real one.
      const locationRef = useRef(currentLocation);
      locationRef.current = currentLocation;
      const publishedOnce = useRef(false);

      useEffect(() => {
        if (publishedOnce.current) return;
        publishedOnce.current = true;
        void publishPresenceLogin(
          async (event) => {
            published.push(event);
          },
          {
            sessionId: 'sess-1',
            islandId: ISLAND,
            location: locationRef.current,
            blobbiAddr: `31124:${PLAYER}:pet`,
            policy: STANDARD_POLICY,
            startPos: { x: 50, y: 80 },
            seq: 1,
          },
        );
      }, []);
      return null;
    }

    render(
      <LocationProvider initialLocation="mine">
        <PresencePublisher />
      </LocationProvider>,
    );

    await waitFor(() => expect(published).toHaveLength(1));

    const event = published[0] as { kind: number; tags: string[][]; content: string };
    expect(event.kind).toBe(31950);
    expect(event.tags).toContainEqual(['t', 'loc:mine']);
    expect(JSON.parse(event.content).location).toBe('mine');
    // And it is ordinary presence: the expiration the whole freshness rule
    // rests on is present, so the restored session is itself resumable.
    expect(event.tags.find(([n]) => n === 'expiration')?.[1]).toBe(String(NOW + EXP_SECONDS));
  });

  it('still supports ordinary navigation after a bootstrap restore', async () => {
    render(
      <LocationProvider initialLocation="beach">
        <LocationProbe onNavigate="plaza" />
      </LocationProvider>,
    );
    expect(screen.getByTestId('loc')).toHaveTextContent('beach');

    act(() => {
      screen.getByText('go').click();
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(screen.getByTestId('loc')).toHaveTextContent('plaza');
  });
});
