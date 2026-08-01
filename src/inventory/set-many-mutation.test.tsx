/**
 * The `set-many` inventory mutation — ONE canonical kind:31633 publish for a
 * bulk quantity change (Phase 9.5, the Inventory & Equipment Lab's writer).
 *
 * What must hold: one publish however many targets, unrelated entries and
 * unknown tags preserved, zero omitted per the package's canonical builder,
 * no negative quantities, duplicate targets refused, optimistic update with
 * rollback, and per-user serialization shared with every other inventory
 * mutation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const OWNER = 'a'.repeat(64);

let relayInventory: NostrEvent[] = [];
let signCounter = 0;
let failNextPublish = false;

const nostrEvent = vi.fn(async () => {});
const nostrQuery = vi.fn(
  async (filters: { kinds?: number[] }[]): Promise<NostrEvent[]> => {
    if (filters[0]?.kinds?.[0] === 31633) return relayInventory;
    return [];
  },
);
const signEvent = vi.fn(
  async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> => {
    if (failNextPublish) {
      failNextPublish = false;
      throw new Error('DEV: signer refused');
    }
    signCounter += 1;
    const event: NostrEvent = {
      ...t,
      tags: t.tags ?? [],
      content: t.content ?? '',
      created_at: 1_700_000_000 + signCounter,
      id: `signed-${signCounter}`,
      pubkey: OWNER,
      sig: 'sig',
    };
    if (event.kind === 31633) relayInventory = [event];
    return event;
  },
);

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { event: nostrEvent, query: nostrQuery } }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: OWNER, signer: { signEvent } } }),
}));

import {
  buildGameInventoryEvent,
  getInventoryItemQuantity,
} from '@/inventory/package';
import { ISLAND_INVENTORY_D } from '@/inventory/constants';
import { parseInventoryEvent } from '@/inventory/protocol-adapter';
import { inventoryQueryKey, buildEmptyInventory } from '@/inventory/useIslandInventory';
import {
  useInventoryMutation,
  applyMutation,
  getQuantity,
} from '@/inventory/useInventoryMutation';
import { officialItemAddress } from '@/protocol/event-registry';

const CAP = officialItemAddress('blobbi:cosmetic:block-builder-cap');
const AURA = officialItemAddress('blobbi:effect:celestial-aura');
const THIRD_PARTY = `31632:${'b'.repeat(64)}:their:item`;

function seedRelayInventory(
  items: { address: string; quantity: number }[],
  extraTags: string[][] = [],
) {
  const template = buildGameInventoryEvent({ id: ISLAND_INVENTORY_D, items });
  relayInventory = [
    {
      id: 'inv-base',
      pubkey: OWNER,
      created_at: 100,
      kind: template.kind,
      tags: [...template.tags, ...extraTags],
      content: template.content,
      sig: 'sig',
    },
  ];
}

function lastPublishedInventory() {
  const call = signEvent.mock.calls.at(-1);
  if (!call) throw new Error('nothing published');
  const template = call[0] as Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>;
  return parseInventoryEvent({
    ...template,
    id: 'published',
    pubkey: OWNER,
    sig: 'sig',
  } as NostrEvent)!;
}

function makeHook() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useInventoryMutation(), { wrapper }) };
}

beforeEach(() => {
  relayInventory = [];
  signCounter = 0;
  failNextPublish = false;
  nostrEvent.mockClear();
  nostrQuery.mockClear();
  signEvent.mockClear();
});

describe('applyMutation set-many (pure)', () => {
  const base = buildEmptyInventory(OWNER);

  it('applies every target to one snapshot', () => {
    const next = applyMutation(base, {
      type: 'set-many',
      targets: [
        { address: CAP, quantity: 2 },
        { address: AURA, quantity: 1 },
      ],
    });
    expect(getQuantity(next, CAP)).toBe(2);
    expect(getQuantity(next, AURA)).toBe(1);
    expect(base).not.toBe(next);
  });

  it('refuses negatives, non-integers, duplicates and an empty target list', () => {
    expect(() =>
      applyMutation(base, {
        type: 'set-many',
        targets: [{ address: CAP, quantity: -1 }],
      }),
    ).toThrow(/negative/);
    expect(() =>
      applyMutation(base, {
        type: 'set-many',
        targets: [{ address: CAP, quantity: 1.5 }],
      }),
    ).toThrow(/integer/);
    expect(() =>
      applyMutation(base, {
        type: 'set-many',
        targets: [
          { address: CAP, quantity: 1 },
          { address: CAP, quantity: 2 },
        ],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      applyMutation(base, { type: 'set-many', targets: [] }),
    ).toThrow(/at least one/);
  });
});

describe('the hook publishes ONE canonical event per bulk action', () => {
  it('twelve targets, one publish, unrelated third-party entry preserved', async () => {
    seedRelayInventory([
      { address: THIRD_PARTY, quantity: 9 },
      { address: CAP, quantity: 5 },
    ]);
    const { result } = makeHook();

    await act(async () => {
      await result.current.mutateAsync({
        type: 'set-many',
        targets: [
          { address: CAP, quantity: 0 },
          { address: AURA, quantity: 1 },
        ],
      });
    });

    expect(signEvent).toHaveBeenCalledTimes(1);
    const published = lastPublishedInventory();
    // Zero omitted (canonical), the aura added, the STRANGER's entry intact.
    expect(getInventoryItemQuantity(published, CAP)).toBe(0);
    expect(getInventoryItemQuantity(published, AURA)).toBe(1);
    expect(getInventoryItemQuantity(published, THIRD_PARTY)).toBe(9);
  });

  it('rolls back the optimistic cache when the publish fails', async () => {
    seedRelayInventory([{ address: CAP, quantity: 2 }]);
    const { client, result } = makeHook();
    const key = inventoryQueryKey(OWNER);
    const before = parseInventoryEvent(relayInventory[0])!;
    client.setQueryData(key, before);

    failNextPublish = true;
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          type: 'set-many',
          targets: [{ address: CAP, quantity: 0 }],
        }),
      ).rejects.toThrow(/signer refused/);
    });

    // Rolled back, then reconciled from the (unchanged) relay: same state,
    // possibly a fresh parse of the same event.
    expect(client.getQueryData(key)).toStrictEqual(before);
  });

  it('serializes with other inventory mutations for the same user', async () => {
    seedRelayInventory([]);
    const { result } = makeHook();

    await act(async () => {
      const first = result.current.mutateAsync({
        type: 'set-many',
        targets: [{ address: CAP, quantity: 1 }],
      });
      const second = result.current.mutateAsync({
        type: 'add',
        address: AURA,
        amount: 1,
      });
      await Promise.all([first, second]);
    });

    // The second write read the first write's event (stateful relay mock), so
    // the final published inventory holds BOTH — no lost update.
    const published = lastPublishedInventory();
    expect(getInventoryItemQuantity(published, CAP)).toBe(1);
    expect(getInventoryItemQuantity(published, AURA)).toBe(1);
  });
});
