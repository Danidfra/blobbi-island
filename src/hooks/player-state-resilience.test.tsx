/**
 * Player state must survive an uncertain relay.
 *
 * The failure these tests pin, end to end:
 *
 * ```
 *   known player with 1 Blobbi
 *   → refetch hits an unreachable relay
 *   → NPool.query resolves []            (it never throws)
 *   → useBlobbis accepts [] as success
 *   → cache goes 1 pet → 0 pets
 *   → BlobbiIsland routes playing → selection
 *   → PlayingView / Mine unmounts, energy already spent, no reward
 *   → "Your nest is empty. You don't have a Blobbi yet."
 * ```
 *
 * Every step above is now blocked, and each step has a test here. The reads go
 * through `req`-shaped fakes because that is the API the resilient reader uses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, render, screen, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const OWNER = 'a'.repeat(64);

type ReqMessage =
  | ['EVENT', string, NostrEvent]
  | ['EOSE', string]
  | ['CLOSED', string, string];

/** What the fake relay should do for the NEXT read. */
let relayScript: () => ReqMessage[] = () => [['EOSE', 's']];

const nostrStub = {
  req: (_filters: unknown, _opts?: { signal?: AbortSignal }) => {
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
  useCurrentUser: () => ({ user: { pubkey: OWNER, signer: { signEvent: async () => ({}) } } }),
}));

const { useBlobbis } = await import('./useBlobbis');
const { useBlobbonautProfile } = await import('./useBlobbonautProfile');
const { nextGameState } = await import('@/pages/blobbi-island-state');

/** A valid, MODERN kind:31124 pet event. */
function petEvent(id: string): NostrEvent {
  return {
    id: `evt-${id}`,
    pubkey: OWNER,
    kind: 31124,
    created_at: 1_000,
    content: '',
    tags: [
      ['d', id],
      ['stage', 'adult'],
      ['breeding_ready', 'false'],
      ['generation', '1'],
      ['hunger', '80'],
      ['happiness', '80'],
      ['health', '80'],
      ['hygiene', '80'],
      ['energy', '70'],
      ['experience', '0'],
      ['care_streak', '0'],
      ['seed', 'abc'],
      ['adult_type', 'bloomi'],
      ['base_color', '#fff'],
    ],
    sig: 'sig',
  };
}

function profileEvent(companion: string): NostrEvent {
  return {
    id: 'evt-profile',
    pubkey: OWNER,
    kind: 11125,
    created_at: 1_000,
    content: '',
    tags: [
      ['d', 'profile'],
      ['name', 'Player'],
      ['current_companion', companion],
    ],
    sig: 'sig',
  };
}

/** Script helpers, named after what the relay is doing. */
const answersWith = (...events: NostrEvent[]): ReqMessage[] => [
  ...events.map((e) => ['EVENT', 's', e] as ReqMessage),
  ['EOSE', 's'],
];
const answersEmpty = (): ReqMessage[] => [['EOSE', 's']];
const isUnreachable = (): ReqMessage[] => [['CLOSED', 's', 'unavailable']];

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  relayScript = answersEmpty;
});

describe('useBlobbis keeps known Blobbis across an unusable read', () => {
  it('an UNKNOWN refetch does NOT erase the known list', async () => {
    const client = makeClient();
    relayScript = () => answersWith(petEvent('blobbi-a'));
    const { result } = renderHook(() => useBlobbis(), { wrapper: wrapperFor(client) });
    await waitFor(() =>
      expect((client.getQueryData(['blobbis', OWNER]) as unknown[])?.length).toBe(1),
    );

    relayScript = isUnreachable;
    let refetchIsError = false;
    await act(async () => {
      refetchIsError = (await result.current.refetch()).isError;
    });

    // The query FAILS (so React Query retains data) rather than succeeding empty.
    expect(refetchIsError).toBe(true);
    expect((client.getQueryData(['blobbis', OWNER]) as unknown[])?.length).toBe(1);
  });

  it('a timeout does NOT erase the known list', async () => {
    const client = makeClient();
    relayScript = () => answersWith(petEvent('blobbi-a'));
    const { result } = renderHook(() => useBlobbis(), { wrapper: wrapperFor(client) });
    await waitFor(() =>
      expect((client.getQueryData(['blobbis', OWNER]) as unknown[])?.length).toBe(1),
    );

    // A relay that accepts the REQ and never EOSEs.
    relayScript = () => {
      throw Object.assign(new DOMException('aborted', 'AbortError'));
    };
    await act(async () => {
      await result.current.refetch();
    });

    expect((client.getQueryData(['blobbis', OWNER]) as unknown[])?.length).toBe(1);
  });

  it('a CONFIRMED empty read still yields []: a new player can start', async () => {
    const client = makeClient();
    relayScript = answersEmpty; // both the read and its confirmation
    renderHook(() => useBlobbis(), { wrapper: wrapperFor(client) });
    await waitFor(() =>
      expect(client.getQueryData(['blobbis', OWNER])).toEqual([]),
    );
  });
});

describe('useBlobbonautProfile keeps the companion across an unusable read', () => {
  it('an UNKNOWN refetch does not drop current_companion', async () => {
    const client = makeClient();
    relayScript = () => answersWith(profileEvent('blobbi-a'));
    const { result } = renderHook(() => useBlobbonautProfile(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() =>
      expect(
        (client.getQueryData(['blobbonaut-profile', OWNER]) as { currentCompanion?: string })
          ?.currentCompanion,
      ).toBe('blobbi-a'),
    );

    relayScript = isUnreachable;
    await act(async () => {
      await result.current.refetch();
    });

    expect(
      (client.getQueryData(['blobbonaut-profile', OWNER]) as { currentCompanion?: string })
        ?.currentCompanion,
    ).toBe('blobbi-a');
  });

  it('a CONFIRMED absent profile still yields null', async () => {
    const client = makeClient();
    relayScript = answersEmpty;
    renderHook(() => useBlobbonautProfile(), { wrapper: wrapperFor(client) });
    await waitFor(() =>
      expect(client.getQueryData(['blobbonaut-profile', OWNER])).toBeNull(),
    );
  });
});

describe('BlobbiIsland routing never ejects a playing player on doubt', () => {
  const playing = {
    isLoading: false,
    hasReadError: false,
    blobbis: [{ id: 'a' } as never],
    hasSelectedBlobbi: true,
  };

  it('stays playing through an unusable read', () => {
    expect(nextGameState('playing', { ...playing, hasReadError: true })).toBe('playing');
  });

  it('stays playing through a background load', () => {
    expect(nextGameState('playing', { ...playing, isLoading: true })).toBe('playing');
  });

  it('stays playing when nothing has been read yet', () => {
    expect(nextGameState('playing', { ...playing, blobbis: undefined })).toBe('playing');
  });

  it('leaves only for a CONFIRMED empty nest', () => {
    expect(nextGameState('playing', { ...playing, blobbis: [] })).toBe('selection');
  });

  it('leaves when a known list holds no selectable companion', () => {
    expect(nextGameState('playing', { ...playing, hasSelectedBlobbi: false })).toBe('selection');
  });

  it('never interrupts the hatching ceremony', () => {
    expect(nextGameState('hatching', { ...playing, hasReadError: true })).toBe('hatching');
    expect(nextGameState('hatching', { ...playing, blobbis: [] })).toBe('hatching');
  });

  it('still routes normally before the world is entered', () => {
    expect(nextGameState('loading', playing)).toBe('playing');
    expect(nextGameState('loading', { ...playing, isLoading: true })).toBe('loading');
    expect(nextGameState('loading', { ...playing, blobbis: [] })).toBe('selection');
    expect(nextGameState('loading', { ...playing, hasReadError: true })).toBe('selection');
  });
});

describe('BlobbiSelectionScreen distinguishes unknown from confirmed empty', () => {
  const EMPTY_COPY = "You don't have a Blobbi yet.";

  async function renderScreen(blobbisState: {
    data: unknown;
    isLoading: boolean;
    error: unknown;
  }) {
    vi.resetModules();
    vi.doMock('./useBlobbis', () => ({ useBlobbis: () => blobbisState }));
    vi.doMock('./useBlobbonautProfile', () => ({
      useBlobbonautProfile: () => ({ data: { currentCompanion: 'blobbi-a' }, isLoading: false }),
      useSetCurrentCompanion: () => ({ mutate: () => {}, isPending: false }),
    }));
    const { BlobbiSelectionScreen } = await import(
      '@/components/blobbi/BlobbiSelectionScreen'
    );
    render(
      <QueryClientProvider client={makeClient()}>
        <BlobbiSelectionScreen onBlobbiSelected={() => {}} onHatchFirstEgg={() => {}} />
      </QueryClientProvider>,
    );
  }

  it('NEVER shows the empty-nest copy for an unusable read with nothing cached', async () => {
    await renderScreen({ data: undefined, isLoading: false, error: new Error('relay-read-timeout') });
    expect(screen.queryByText(EMPTY_COPY)).not.toBeInTheDocument();
    expect(screen.getByText('The nest is hiding')).toBeInTheDocument();
  });

  it('does not leak the transport reason into the UI', async () => {
    await renderScreen({ data: undefined, isLoading: false, error: new Error('relay-read-timeout') });
    expect(screen.queryByText(/relay-read-timeout/)).not.toBeInTheDocument();
  });

  it('keeps the pet cards when a refetch fails, instead of an error screen', async () => {
    const blobbi = {
      id: 'blobbi-aa-bb',
      stage: 'adult',
      generation: 1,
      hunger: 80,
      happiness: 80,
      health: 80,
      hygiene: 80,
      energy: 70,
      experience: 0,
      careStreak: 0,
      adultType: 'bloomi',
      rawTags: [['d', 'blobbi-aa-bb'], ['seed', 'abc']],
    };
    await renderScreen({ data: [blobbi], isLoading: false, error: new Error('relay-read-timeout') });
    expect(screen.queryByText(EMPTY_COPY)).not.toBeInTheDocument();
    expect(screen.queryByText('The nest is hiding')).not.toBeInTheDocument();
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    // The collection grid is still rendered (the pinned footer only exists
    // when there are cards to act on).
    expect(document.querySelector('.grid')).not.toBeNull();
    expect(screen.queryByText('Your nest is empty')).not.toBeInTheDocument();
  });

  it('SHOWS the empty nest for a confirmed empty read, new players can hatch', async () => {
    await renderScreen({ data: [], isLoading: false, error: null });
    expect(screen.getByText('Your nest is empty')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    expect(screen.getByText('Hatch your first Blobbi')).toBeInTheDocument();
  });
});
