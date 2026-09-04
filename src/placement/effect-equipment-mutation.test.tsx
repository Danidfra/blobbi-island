/**
 * kind:31634 writes for VISUAL-EFFECT slots (Phase 9).
 *
 * The wearable write path's own tests prove serialization, rollback and
 * lost-update handling in general; these prove the effect-specific facts:
 *
 *  - effect slots are accepted by the same single write path (no second one);
 *  - equipping an effect never touches kind:31633 in either direction;
 *  - the equip-A-then-immediately-equip-B race on one slot lands
 *    deterministically on B, with serialized publishes and no resurrected A;
 *  - removing an effect slot preserves unrelated wearable placements.
 *
 * The relay mock is STATEFUL here: each placement query returns the last
 * placement event actually signed, so the second write of a race reads the
 * first write's document exactly as it would from a real relay.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const OWNER = 'a'.repeat(64);
const CHARACTER = 'blobbi-race-1';

let publishedPlacements: NostrEvent[] = [];
let inventoryEvents: NostrEvent[] = [];
let signCounter = 0;

const nostrEvent = vi.fn(async () => {});
const nostrQuery = vi.fn(
  async (filters: { kinds?: number[] }[]): Promise<NostrEvent[]> => {
    const kind = filters[0]?.kinds?.[0];
    if (kind === 31634) {
      const last = publishedPlacements.at(-1);
      return last ? [last] : [];
    }
    if (kind === 31633) return inventoryEvents;
    return [];
  },
);
const signEvent = vi.fn(
  async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> => {
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
    if (event.kind === 31634) publishedPlacements.push(event);
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
  parseGameItemPlacementResult,
  getLastEquippedPlacementBySlot,
} from '@/inventory/package';
import { ISLAND_INVENTORY_D } from '@/inventory/constants';
import { visualEffectItemForEffect } from '@/effects/official-visual-effect-items';
import { officialItemAddress } from '@/protocol/event-registry';

import { useEquipmentMutation } from './useEquipmentMutation';
import { buildEquipEntry } from './render-model';

const AURA = visualEffectItemForEffect('celestial-aura')!;
const AURA_2 = visualEffectItemForEffect('solar-radiance')!;
const SPARKLES = visualEffectItemForEffect('golden-sparkles')!;
const CAP = officialItemAddress('blobbi:cosmetic:block-builder-cap');

function seedInventory(items: { address: string; quantity: number }[]) {
  const template = buildGameInventoryEvent({ id: ISLAND_INVENTORY_D, items });
  inventoryEvents = [
    {
      id: 'inv',
      pubkey: OWNER,
      created_at: 100,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: 'sig',
    },
  ];
}

function lastPlacementDoc() {
  const event = publishedPlacements.at(-1);
  if (!event) throw new Error('nothing published');
  const parsed = parseGameItemPlacementResult(event);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function makeHook() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useEquipmentMutation(), { wrapper });
}

beforeEach(() => {
  publishedPlacements = [];
  inventoryEvents = [];
  signCounter = 0;
  nostrEvent.mockClear();
  nostrQuery.mockClear();
  signEvent.mockClear();
});

describe('equipping an effect item', () => {
  it('writes the effect slot through the one existing path and never touches kind:31633', async () => {
    seedInventory([{ address: AURA.address, quantity: 1 }]);
    const { result } = makeHook();

    await act(async () => {
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: {
          type: 'equip',
          slot: 'aura',
          entry: buildEquipEntry({ itemAddress: AURA.address, slot: 'aura' }),
        },
      });
    });

    const doc = lastPlacementDoc();
    const equipped = getLastEquippedPlacementBySlot(doc, 'aura');
    expect(equipped?.item).toBe(AURA.address);
    expect(equipped?.mode).toBe('equip');
    // EVERY signed event is a placement; no inventory event was written.
    expect(
      signEvent.mock.calls.every(([t]) => (t as { kind: number }).kind === 31634),
    ).toBe(true);
  });

  it('refuses to equip an effect item the player does not own', async () => {
    seedInventory([]);
    const { result } = makeHook();

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          characterId: CHARACTER,
          mutation: {
            type: 'equip',
            slot: 'aura',
            entry: buildEquipEntry({ itemAddress: AURA.address, slot: 'aura' }),
          },
        });
      }),
    ).rejects.toThrow(/do not own/);
    expect(publishedPlacements).toHaveLength(0);
  });

  it('still refuses a slot outside the combined vocabulary', async () => {
    seedInventory([{ address: AURA.address, quantity: 1 }]);
    const { result } = makeHook();
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          characterId: CHARACTER,
          mutation: {
            type: 'equip',
            slot: 'mystery-slot',
            entry: {
              id: 'mystery-slot',
              item: AURA.address,
              mode: 'equip',
              slot: 'mystery-slot',
            },
          },
        });
      }),
    ).rejects.toThrow(/Unknown equipment slot/);
  });
});

describe('the same-slot race: equip Celestial Aura, then immediately Solar Radiance', () => {
  it('serializes both publishes and lands on Solar Radiance without resurrecting the first aura', async () => {
    seedInventory([
      { address: AURA.address, quantity: 1 },
      { address: AURA_2.address, quantity: 1 },
    ]);
    const { result } = makeHook();

    await act(async () => {
      const first = result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: {
          type: 'equip',
          slot: 'aura',
          entry: buildEquipEntry({ itemAddress: AURA.address, slot: 'aura' }),
        },
      });
      // Fired before the first settles, the per-document serializer must
      // queue it, not interleave it.
      const second = result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: {
          type: 'equip',
          slot: 'aura',
          entry: buildEquipEntry({ itemAddress: AURA_2.address, slot: 'aura' }),
        },
      });
      await Promise.all([first, second]);
    });

    expect(publishedPlacements).toHaveLength(2);

    // The second write read the first write's document (stateful relay mock),
    // so its revision advances past it.
    const [firstDoc, finalDoc] = publishedPlacements.map((e) => {
      const parsed = parseGameItemPlacementResult(e);
      if (!parsed.ok) throw new Error(parsed.error);
      return parsed.value;
    });
    expect(firstDoc.revision).toBe(1);
    expect(finalDoc.revision).toBe(2);

    // Exactly one aura in the final document: Solar Radiance, and Celestial
    // Aura is gone rather than lingering as a duplicate entry.
    const auraEntries = finalDoc.placements.filter((p) => p.slot === 'aura');
    expect(auraEntries).toHaveLength(1);
    expect(auraEntries[0]!.item).toBe(AURA_2.address);
    expect(finalDoc.itemAddresses).not.toContain(AURA.address);
  });
});

describe('removing an effect', () => {
  it('removes only the effect slot and preserves unrelated wearable and effect placements', async () => {
    seedInventory([
      { address: AURA.address, quantity: 1 },
      { address: SPARKLES.address, quantity: 1 },
      { address: CAP, quantity: 1 },
    ]);
    const { result } = makeHook();

    await act(async () => {
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: {
          type: 'equip',
          slot: 'headwear',
          entry: buildEquipEntry({ itemAddress: CAP, slot: 'headwear' }),
        },
      });
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: {
          type: 'equip',
          slot: 'aura',
          entry: buildEquipEntry({ itemAddress: AURA.address, slot: 'aura' }),
        },
      });
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: {
          type: 'equip',
          slot: 'ambient-particles',
          entry: buildEquipEntry({
            itemAddress: SPARKLES.address,
            slot: 'ambient-particles',
          }),
        },
      });
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: { type: 'unequip', slot: 'aura' },
      });
    });

    const doc = lastPlacementDoc();
    expect(doc.placements.map((p) => p.slot).sort()).toEqual([
      'ambient-particles',
      'headwear',
    ]);
    // Unequip wrote no inventory event either: quantities are placement-proof.
    expect(
      signEvent.mock.calls.every(([t]) => (t as { kind: number }).kind === 31634),
    ).toBe(true);
  });
});
