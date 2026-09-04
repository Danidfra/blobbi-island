/**
 * Hook-level tests for the kind:31634 equipment write path.
 *
 * The relay and publish primitives are mocked so success and failure are
 * deterministic. What is asserted here is the behavior that cannot be seen from
 * a pure function: what is actually published, what the cache does before and
 * after, and: importantly, what the inventory does NOT do.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const OWNER = 'a'.repeat(64);
const CHARACTER = 'blobbi-abc123';

const nostrEvent = vi.fn<(event: NostrEvent, opts?: unknown) => Promise<void>>();
const nostrQuery =
  vi.fn<(filters: { kinds?: number[] }[], opts?: unknown) => Promise<NostrEvent[]>>();
const signEvent = vi.fn(
  async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> => ({
    ...t,
    tags: t.tags ?? [],
    content: t.content ?? '',
    created_at: t.created_at ?? 1_700_000_000,
    id: 'id-' + Math.random().toString(16).slice(2),
    pubkey: OWNER,
    sig: 'sig',
  }),
);

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { event: nostrEvent, query: nostrQuery } }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: OWNER, signer: { signEvent } } }),
}));

import {
  KIND_GAME_INVENTORY,
  KIND_GAME_ITEM_PLACEMENT,
  buildGameInventoryEvent,
  buildGameItemPlacementEvent,
  compareGameItemPlacementRevisions,
  parseGameItemPlacementResult,
  type GameItemPlacement,
} from '@/inventory/package';
import { ADDRESSED_OFFICIAL_COSMETICS } from '@/protocol/event-registry';
import { ISLAND_INVENTORY_D } from '@/inventory/constants';

import { useEquipmentMutation, applyEquipmentMutation } from './useEquipmentMutation';
import { placementQueryKey, buildEmptyPlacement, type PlacementState } from './usePlacementState';
import {
  characterEquipmentPlacementD,
  placementTargetForCharacter,
  ISLAND_PLACEMENT_CONTEXT,
} from './identity';
import { buildEquipEntry, ISLAND_PLACEMENT_REFERENCE } from './render-model';

const CAP = ADDRESSED_OFFICIAL_COSMETICS[0]!.address;
const capEntry = buildEquipEntry({ itemAddress: CAP, slot: 'headwear' });

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** A published kind:31633 inventory holding `quantity` of the cap. */
function inventoryEvent(quantity: number): NostrEvent {
  const template = buildGameInventoryEvent({
    id: ISLAND_INVENTORY_D,
    items: quantity > 0 ? [{ address: CAP, quantity }] : [],
  });
  return {
    id: 'inv',
    pubkey: OWNER,
    created_at: 100,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
}

/** A published kind:31634 equipment document. */
function placementEvent(
  options: {
    revision?: number;
    entries?: Parameters<typeof buildGameItemPlacementEvent>[0]['placements'];
    contentExtra?: Record<string, unknown>;
    createdAt?: number;
    id?: string;
  } = {},
): NostrEvent {
  const template = buildGameItemPlacementEvent({
    id: characterEquipmentPlacementD(CHARACTER),
    target: placementTargetForCharacter(OWNER, CHARACTER),
    reference: ISLAND_PLACEMENT_REFERENCE,
    placements: options.entries ?? [],
    ...(options.revision === undefined ? {} : { revision: options.revision }),
    ...(options.contentExtra ? { contentExtra: options.contentExtra } : {}),
  });
  return {
    id: options.id ?? 'placement-evt',
    pubkey: OWNER,
    created_at: options.createdAt ?? 100,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
}

/** Route the mocked relay by filter kind. */
function relayReturns(options: {
  placement?: NostrEvent[];
  inventory?: NostrEvent[];
}) {
  nostrQuery.mockImplementation(async (filters) => {
    const kind = filters[0]?.kinds?.[0];
    if (kind === KIND_GAME_ITEM_PLACEMENT) return options.placement ?? [];
    if (kind === KIND_GAME_INVENTORY) return options.inventory ?? [];
    return [];
  });
}

/** The last event handed to the publisher, parsed back. */
function lastPublished(): NostrEvent {
  const call = signEvent.mock.calls.at(-1);
  if (!call) throw new Error('nothing was published');
  return {
    ...(call[0] as Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>),
    id: 'published',
    pubkey: OWNER,
    sig: 'sig',
  } as NostrEvent;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('applyEquipmentMutation', () => {
  const base = buildEmptyPlacement(OWNER, CHARACTER);

  it('equips into an empty document', () => {
    const next = applyEquipmentMutation(base, {
      type: 'equip',
      slot: 'headwear',
      entry: capEntry,
    });
    expect(next.placements).toHaveLength(1);
    expect(next.itemAddresses).toEqual([CAP]);
    // The input is untouched.
    expect(base.placements).toHaveLength(0);
  });

  it('replaces the item in an occupied slot rather than stacking', () => {
    const equipped = applyEquipmentMutation(base, {
      type: 'equip',
      slot: 'headwear',
      entry: capEntry,
    });
    const swapped = applyEquipmentMutation(equipped, {
      type: 'equip',
      slot: 'headwear',
      entry: buildEquipEntry({ itemAddress: CAP, slot: 'headwear', x: 60, y: 10 }),
    });
    expect(swapped.placements).toHaveLength(1);
    expect(swapped.placements[0]!.position).toEqual({ x: 60, y: 10 });
  });

  it('unequips a slot and leaves other slots alone', () => {
    const withTwo = applyEquipmentMutation(
      applyEquipmentMutation(base, {
        type: 'equip',
        slot: 'headwear',
        entry: capEntry,
      }),
      {
        type: 'equip',
        slot: 'neckwear',
        entry: buildEquipEntry({ itemAddress: CAP, slot: 'neckwear' }),
      },
    );
    const removed = applyEquipmentMutation(withTwo, {
      type: 'unequip',
      slot: 'headwear',
    });
    expect(removed.placements.map((e) => e.slot)).toEqual(['neckwear']);
  });

  it('refuses a slot the renderer does not know', () => {
    expect(() =>
      applyEquipmentMutation(base, {
        type: 'equip',
        slot: 'third-antenna',
        entry: capEntry,
      }),
    ).toThrow(/slot/i);
  });
});

describe('useEquipmentMutation', () => {
  beforeEach(() => {
    nostrEvent.mockReset();
    nostrQuery.mockReset();
    signEvent.mockClear();
    nostrEvent.mockResolvedValue(undefined);
    relayReturns({});
  });

  it('publishes a complete kind:31634 replacement state', async () => {
    relayReturns({ inventory: [inventoryEvent(1)] });
    const client = newClient();
    const { result } = renderHook(() => useEquipmentMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: { type: 'equip', slot: 'headwear', entry: capEntry },
      });
    });

    const published = lastPublished();
    expect(published.kind).toBe(KIND_GAME_ITEM_PLACEMENT);
    const parsed = parseGameItemPlacementResult(published);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.id).toBe(characterEquipmentPlacementD(CHARACTER));
    expect(parsed.value.placements).toHaveLength(1);
    expect(parsed.value.target).toEqual({
      type: 'address',
      address: `31124:${OWNER}:${CHARACTER}`,
    });
    expect(published.tags).toContainEqual(['a', CAP, '', 'item']);
    expect(published.tags).toContainEqual(['context', ISLAND_PLACEMENT_CONTEXT]);
  });

  it('starts at revision 1 when no document exists yet', async () => {
    relayReturns({ inventory: [inventoryEvent(1)] });
    const client = newClient();
    const { result } = renderHook(() => useEquipmentMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: { type: 'equip', slot: 'headwear', entry: capEntry },
      });
    });

    const parsed = parseGameItemPlacementResult(lastPublished());
    expect(parsed.ok && parsed.value.revision).toBe(1);
  });

  it('increments the revision from the state actually on the relay', async () => {
    relayReturns({
      placement: [placementEvent({ revision: 7 })],
      inventory: [inventoryEvent(1)],
    });
    const client = newClient();
    const { result } = renderHook(() => useEquipmentMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: { type: 'equip', slot: 'headwear', entry: capEntry },
      });
    });

    const parsed = parseGameItemPlacementResult(lastPublished());
    expect(parsed.ok && parsed.value.revision).toBe(8);
  });

  it('reads a FRESH relay state, not a stale cache, as the write base', async () => {
    // Cache says empty; the relay says revision 4 with a hat already on.
    relayReturns({
      placement: [placementEvent({ revision: 4, entries: [capEntry] })],
      inventory: [inventoryEvent(1)],
    });
    const client = newClient();
    client.setQueryData<PlacementState>(placementQueryKey(OWNER, CHARACTER), {
      placement: buildEmptyPlacement(OWNER, CHARACTER),
      warnings: [],
      isEmpty: true,
    });

    const { result } = renderHook(() => useEquipmentMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: {
          type: 'equip',
          slot: 'neckwear',
          entry: buildEquipEntry({ itemAddress: CAP, slot: 'neckwear' }),
        },
      });
    });

    const parsed = parseGameItemPlacementResult(lastPublished());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // The stale empty cache did not clobber the relay's hat.
    expect(parsed.value.placements.map((e) => e.slot).sort()).toEqual([
      'headwear',
      'neckwear',
    ]);
    expect(parsed.value.revision).toBe(5);
  });

  it('preserves unknown content fields written by a newer client', async () => {
    relayReturns({
      placement: [
        placementEvent({
          revision: 2,
          entries: [capEntry],
          contentExtra: { futureField: { keep: ['me'] } },
        }),
      ],
      inventory: [inventoryEvent(1)],
    });
    const client = newClient();
    const { result } = renderHook(() => useEquipmentMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: { type: 'unequip', slot: 'headwear' },
      });
    });

    const content = JSON.parse(lastPublished().content) as Record<string, unknown>;
    expect(content.futureField).toEqual({ keep: ['me'] });
    expect(content.placements).toEqual([]);
  });

  it('refuses to equip an item the player does not own', async () => {
    relayReturns({ inventory: [inventoryEvent(0)] });
    const client = newClient();
    const { result } = renderHook(() => useEquipmentMutation(), {
      wrapper: makeWrapper(client),
    });

    await expect(
      result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: { type: 'equip', slot: 'headwear', entry: capEntry },
      }),
    ).rejects.toThrow(/do not own/i);

    expect(signEvent).not.toHaveBeenCalled();
  });

  it('allows unequipping an item the player no longer owns', async () => {
    relayReturns({
      placement: [placementEvent({ revision: 1, entries: [capEntry] })],
      inventory: [inventoryEvent(0)],
    });
    const client = newClient();
    const { result } = renderHook(() => useEquipmentMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: { type: 'unequip', slot: 'headwear' },
      });
    });

    const parsed = parseGameItemPlacementResult(lastPublished());
    expect(parsed.ok && parsed.value.placements).toEqual([]);
  });

  it('never publishes a kind:31633 event when equipping or unequipping', async () => {
    relayReturns({ inventory: [inventoryEvent(1)] });
    const client = newClient();
    const { result } = renderHook(() => useEquipmentMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: { type: 'equip', slot: 'headwear', entry: capEntry },
      });
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: { type: 'unequip', slot: 'headwear' },
      });
    });

    const kinds = signEvent.mock.calls.map((c) => c[0].kind);
    expect(kinds).toEqual([
      KIND_GAME_ITEM_PLACEMENT,
      KIND_GAME_ITEM_PLACEMENT,
    ]);
    expect(kinds).not.toContain(KIND_GAME_INVENTORY);
  });

  it('updates the cache optimistically before the publish resolves', async () => {
    relayReturns({ inventory: [inventoryEvent(1)] });
    let releasePublish = (): void => {};
    nostrEvent.mockImplementation(
      () => new Promise<void>((resolve) => (releasePublish = resolve)),
    );

    const client = newClient();
    const { result } = renderHook(() => useEquipmentMutation(), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      result.current.mutate({
        characterId: CHARACTER,
        mutation: { type: 'equip', slot: 'headwear', entry: capEntry },
      });
    });

    await waitFor(() => {
      const cached = client.getQueryData<PlacementState>(
        placementQueryKey(OWNER, CHARACTER),
      );
      expect(cached?.placement.placements).toHaveLength(1);
    });

    releasePublish();
  });

  it('rolls the cache back when publishing fails', async () => {
    relayReturns({ inventory: [inventoryEvent(1)] });
    nostrEvent.mockRejectedValue(new Error('relay is on fire'));
    signEvent.mockRejectedValueOnce(new Error('user rejected signing'));

    const client = newClient();
    const seeded: PlacementState = {
      placement: buildEmptyPlacement(OWNER, CHARACTER),
      warnings: [],
      isEmpty: true,
    };
    client.setQueryData(placementQueryKey(OWNER, CHARACTER), seeded);

    const { result } = renderHook(() => useEquipmentMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current
        .mutateAsync({
          characterId: CHARACTER,
          mutation: { type: 'equip', slot: 'headwear', entry: capEntry },
        })
        .catch(() => undefined);
    });

    await waitFor(() => {
      const cached = client.getQueryData<PlacementState>(
        placementQueryKey(OWNER, CHARACTER),
      );
      expect(cached?.placement.placements).toHaveLength(0);
    });
  });

  it('serializes concurrent mutations for the same character', async () => {
    relayReturns({ inventory: [inventoryEvent(1)] });
    const client = newClient();
    const { result } = renderHook(() => useEquipmentMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await Promise.all([
        result.current.mutateAsync({
          characterId: CHARACTER,
          mutation: { type: 'equip', slot: 'headwear', entry: capEntry },
        }),
        result.current.mutateAsync({
          characterId: CHARACTER,
          mutation: {
            type: 'equip',
            slot: 'neckwear',
            entry: buildEquipEntry({ itemAddress: CAP, slot: 'neckwear' }),
          },
        }),
      ]);
    });

    // Both published, one after the other; never interleaved.
    expect(signEvent).toHaveBeenCalledTimes(2);
  });
});

describe('revision conflict detection', () => {
  const base = (revision: number, id: string, entries: number): GameItemPlacement => {
    const event = placementEvent({
      revision,
      id,
      entries: entries === 0 ? [] : [capEntry],
    });
    const parsed = parseGameItemPlacementResult(event);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  };

  it('reports a lost update as a conflict, not a winner', () => {
    const mine = base(5, 'evt-a', 0);
    const theirs = base(5, 'evt-b', 1);
    expect(compareGameItemPlacementRevisions(mine, theirs)).toBe('conflict');
  });

  it('reports an older revision as stale and a newer one as ahead', () => {
    expect(compareGameItemPlacementRevisions(base(5, 'a', 0), base(4, 'b', 0))).toBe(
      'stale',
    );
    expect(compareGameItemPlacementRevisions(base(5, 'a', 0), base(6, 'b', 0))).toBe(
      'ahead',
    );
  });

  it('does not let a newer created_at decide an equal-revision tie', () => {
    const older = parseGameItemPlacementResult(
      placementEvent({ revision: 3, id: 'old', createdAt: 1 }),
    );
    const newer = parseGameItemPlacementResult(
      placementEvent({ revision: 3, id: 'new', createdAt: 999_999, entries: [capEntry] }),
    );
    expect(older.ok && newer.ok).toBe(true);
    if (!older.ok || !newer.ok) return;
    expect(compareGameItemPlacementRevisions(older.value, newer.value)).toBe(
      'conflict',
    );
  });
});
