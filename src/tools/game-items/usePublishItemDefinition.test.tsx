/**
 * The publish flow, against a MOCKED signer and a MOCKED relay writer.
 *
 * No test in this file, or anywhere in this feature, is capable of reaching a
 * real relay: `publishToRelays` is replaced wholesale, so a regression that
 * made publishing fire unexpectedly would fail loudly here rather than emit an
 * event onto the network.
 *
 * The cases are chosen around the states a real publication actually reaches:
 * all relays accepted, some accepted, none accepted, the signer refused, and
 * there is no signer at all. Only the last two produce a rejected mutation,
 * because only they mean no event exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { KIND_GAME_ITEM_DEFINITION } from '@/inventory/package';

const TEST_PUBKEY = 'b'.repeat(64);
const RELAYS = ['wss://relay.one', 'wss://relay.two'];

const signEvent = vi.fn();
const publishToRelays = vi.fn();

let currentUser: { pubkey: string; signer: { signEvent: typeof signEvent } } | undefined;

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: currentUser }),
}));

vi.mock('@/inventory/relay-fan-out', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory/relay-fan-out')>();
  return { ...actual, publishToRelays: (...args: unknown[]) => publishToRelays(...args) };
});

vi.mock('./useItemDefinitions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useItemDefinitions')>();
  return { ...actual, useToolRelayUrls: () => RELAYS };
});

import { usePublishItemDefinition } from './usePublishItemDefinition';
import {
  definitionsByAuthorQueryKey,
  type PublishedDefinitionRecord,
} from './useItemDefinitions';

const TEMPLATE = {
  kind: KIND_GAME_ITEM_DEFINITION as typeof KIND_GAME_ITEM_DEFINITION,
  content: '',
  tags: [
    ['d', 'blobbi:accessory:hat'],
    ['name', 'Hat'],
    ['type', 'cosmetic'],
  ],
};

function signedFrom(template: {
  kind: number;
  content: string;
  tags: string[][];
}): NostrEvent {
  return {
    id: 'e'.repeat(64),
    pubkey: TEST_PUBKEY,
    created_at: 1_700_000_000,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'f'.repeat(128),
  };
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderPublish(client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })) {
  const rendered = renderHook(() => usePublishItemDefinition(), {
    wrapper: wrapper(client),
  });
  return { ...rendered, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { pubkey: TEST_PUBKEY, signer: { signEvent } };
  signEvent.mockImplementation(async (template) => signedFrom(template));
  publishToRelays.mockResolvedValue(RELAYS.map((relay) => ({ relay, ok: true })));
});

describe('access', () => {
  it('rejects when there is no signer, and signs nothing', async () => {
    currentUser = undefined;
    const { result } = renderPublish();

    await expect(
      result.current.mutateAsync({ template: TEMPLATE }),
    ).rejects.toThrow(/No signer/i);
    expect(signEvent).not.toHaveBeenCalled();
    expect(publishToRelays).not.toHaveBeenCalled();
  });

  it('surfaces a signer rejection and publishes nothing', async () => {
    signEvent.mockRejectedValue(new Error('user declined'));
    const { result } = renderPublish();

    await expect(
      result.current.mutateAsync({ template: TEMPLATE }),
    ).rejects.toThrow(/Signing was rejected/i);
    expect(publishToRelays).not.toHaveBeenCalled();
  });
});

describe('signing', () => {
  it('signs exactly once, with the template it was given', async () => {
    const { result } = renderPublish();
    await result.current.mutateAsync({ template: TEMPLATE });

    expect(signEvent).toHaveBeenCalledTimes(1);
    const signed = signEvent.mock.calls[0][0];
    expect(signed.kind).toBe(KIND_GAME_ITEM_DEFINITION);
    expect(signed.tags).toContainEqual(['d', 'blobbi:accessory:hat']);
    expect(typeof signed.created_at).toBe('number');
  });

  it('adds the client tag once', async () => {
    const { result } = renderPublish();
    await result.current.mutateAsync({ template: TEMPLATE });
    const signed = signEvent.mock.calls[0][0];
    expect(signed.tags.filter((t: string[]) => t[0] === 'client')).toEqual([
      ['client', 'blobbi'],
    ]);
  });

  it('does not add a second client tag when the template already has one', async () => {
    const { result } = renderPublish();
    await result.current.mutateAsync({
      template: { ...TEMPLATE, tags: [...TEMPLATE.tags, ['client', 'other']] },
    });
    const signed = signEvent.mock.calls[0][0];
    expect(signed.tags.filter((t: string[]) => t[0] === 'client')).toHaveLength(1);
  });

  it('does not mutate the caller’s template tags', async () => {
    const tags = TEMPLATE.tags.map((tag) => [...tag]);
    const template = { ...TEMPLATE, tags };
    const { result } = renderPublish();
    await result.current.mutateAsync({ template });
    expect(template.tags).toEqual(TEMPLATE.tags);
  });
});

describe('relay outcomes', () => {
  it('reports full success', async () => {
    const { result } = renderPublish();
    const outcome = await result.current.mutateAsync({ template: TEMPLATE });

    expect(outcome.reachedAnyRelay).toBe(true);
    expect(outcome.acceptedRelays).toEqual(RELAYS);
    expect(outcome.rejectedRelays).toEqual([]);
    expect(outcome.event.id).toBe('e'.repeat(64));
    expect(outcome.record?.address).toBe(`31632:${TEST_PUBKEY}:blobbi:accessory:hat`);
  });

  it('reports PARTIAL success without throwing', async () => {
    publishToRelays.mockResolvedValue([
      { relay: RELAYS[0], ok: true },
      { relay: RELAYS[1], ok: false, error: 'rate-limited' },
    ]);
    const { result } = renderPublish();
    const outcome = await result.current.mutateAsync({ template: TEMPLATE });

    expect(outcome.reachedAnyRelay).toBe(true);
    expect(outcome.acceptedRelays).toEqual([RELAYS[0]]);
    expect(outcome.rejectedRelays).toEqual([
      { relay: RELAYS[1], ok: false, error: 'rate-limited' },
    ]);
  });

  it('reports total failure as a resolved result, not a thrown error', async () => {
    publishToRelays.mockResolvedValue(
      RELAYS.map((relay) => ({ relay, ok: false, error: 'Timed out' })),
    );
    const { result } = renderPublish();
    const outcome = await result.current.mutateAsync({ template: TEMPLATE });

    expect(outcome.reachedAnyRelay).toBe(false);
    expect(outcome.acceptedRelays).toEqual([]);
    expect(outcome.event.id).toBe('e'.repeat(64));
  });

  it('offers the event to every tool relay', async () => {
    const { result } = renderPublish();
    await result.current.mutateAsync({ template: TEMPLATE });
    expect(publishToRelays).toHaveBeenCalledTimes(1);
    expect(publishToRelays.mock.calls[0][0]).toEqual(RELAYS);
  });
});

describe('cache updates without a refetch', () => {
  it('inserts the published record into an existing by-author list', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const key = definitionsByAuthorQueryKey([TEST_PUBKEY]);
    client.setQueryData<PublishedDefinitionRecord[]>(key, []);

    const { result } = renderPublish(client);
    await result.current.mutateAsync({ template: TEMPLATE });

    await waitFor(() => {
      const cached = client.getQueryData<PublishedDefinitionRecord[]>(key);
      expect(cached).toHaveLength(1);
      expect(cached?.[0].address).toBe(`31632:${TEST_PUBKEY}:blobbi:accessory:hat`);
    });
  });

  it('REPLACES the row for an address rather than adding a duplicate', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const key = definitionsByAuthorQueryKey([TEST_PUBKEY]);
    client.setQueryData<PublishedDefinitionRecord[]>(key, []);

    const { result } = renderPublish(client);
    await result.current.mutateAsync({ template: TEMPLATE });

    // A second publication at the SAME address with a newer timestamp.
    signEvent.mockImplementation(async (template) => ({
      ...signedFrom(template),
      id: 'a'.repeat(64),
      created_at: 1_700_000_500,
    }));
    await result.current.mutateAsync({
      template: { ...TEMPLATE, tags: [...TEMPLATE.tags, ['category', 'headwear']] },
    });

    await waitFor(() => {
      const cached = client.getQueryData<PublishedDefinitionRecord[]>(key);
      expect(cached).toHaveLength(1);
      expect(cached?.[0].event.id).toBe('a'.repeat(64));
    });
  });

  it('does not touch the cache when no relay accepted the event', async () => {
    publishToRelays.mockResolvedValue(
      RELAYS.map((relay) => ({ relay, ok: false, error: 'Timed out' })),
    );
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const key = definitionsByAuthorQueryKey([TEST_PUBKEY]);
    client.setQueryData<PublishedDefinitionRecord[]>(key, []);

    const { result } = renderPublish(client);
    await result.current.mutateAsync({ template: TEMPLATE });

    expect(client.getQueryData<PublishedDefinitionRecord[]>(key)).toEqual([]);
  });
});
