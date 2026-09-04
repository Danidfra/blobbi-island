/**
 * The `apply-set` equipment mutation: ONE canonical kind:31634 publish for a
 * bulk slot change (Phase 9.5, the Inventory & Equipment Lab's writer).
 *
 * What must hold: one publish however many slots move, one revision increment,
 * unrelated placements and unknown content preserved, ownership required for
 * EVERY equipped entry, the equip/unequip-same-slot ambiguity refused, and no
 * inventory event ever written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const OWNER = 'a'.repeat(64);
const CHARACTER = 'blobbi-lab-1';

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
  buildGameItemPlacementEvent,
  parseGameItemPlacementResult,
  getLastEquippedPlacementBySlot,
} from '@/inventory/package';
import { ISLAND_INVENTORY_D } from '@/inventory/constants';
import { officialItemAddress } from '@/protocol/event-registry';
import { visualEffectItemForEffect } from '@/effects/official-visual-effect-items';

import { useEquipmentMutation, applyEquipmentMutation } from './useEquipmentMutation';
import { buildEmptyPlacement } from './usePlacementState';
import {
  characterEquipmentPlacementD,
  placementTargetForCharacter,
} from './identity';
import { ISLAND_PLACEMENT_REFERENCE } from './render-model';

const CAP = officialItemAddress('blobbi:cosmetic:block-builder-cap');
const GLASSES = officialItemAddress('blobbi:cosmetic:stargazer-glasses');
const AURA = visualEffectItemForEffect('celestial-aura')!;
const FOG = visualEffectItemForEffect('mystic-fog')!;

const entry = (item: string, slot: string) => ({
  id: slot,
  item,
  mode: 'equip' as const,
  slot,
});

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

function seedPlacement(
  entries: ReturnType<typeof entry>[],
  contentExtra?: Record<string, unknown>,
) {
  const template = buildGameItemPlacementEvent({
    id: characterEquipmentPlacementD(CHARACTER),
    target: placementTargetForCharacter(OWNER, CHARACTER),
    reference: ISLAND_PLACEMENT_REFERENCE,
    placements: entries,
    revision: 4,
    ...(contentExtra ? { contentExtra } : {}),
  });
  publishedPlacements = [
    {
      id: 'placement-base',
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

describe('applyEquipmentMutation apply-set (pure)', () => {
  const base = buildEmptyPlacement(OWNER, CHARACTER);

  it('applies every equip and unequip to one snapshot', () => {
    const withTwo = applyEquipmentMutation(base, {
      type: 'apply-set',
      equips: [
        { slot: 'headwear', entry: entry(CAP, 'headwear') },
        { slot: 'aura', entry: entry(AURA.address, 'aura') },
      ],
      unequips: [],
    });
    expect(withTwo.placements.map((p) => p.slot).sort()).toEqual(['aura', 'headwear']);

    const cleared = applyEquipmentMutation(withTwo, {
      type: 'apply-set',
      equips: [{ slot: 'ground-local', entry: entry(FOG.address, 'ground-local') }],
      unequips: ['aura'],
    });
    expect(cleared.placements.map((p) => p.slot).sort()).toEqual([
      'ground-local',
      'headwear',
    ]);
  });

  it('refuses an ambiguous set and an empty one', () => {
    expect(() =>
      applyEquipmentMutation(base, {
        type: 'apply-set',
        equips: [{ slot: 'aura', entry: entry(AURA.address, 'aura') }],
        unequips: ['aura'],
      }),
    ).toThrow(/both equips and unequips/);
    expect(() =>
      applyEquipmentMutation(base, { type: 'apply-set', equips: [], unequips: [] }),
    ).toThrow(/at least one change/);
    expect(() =>
      applyEquipmentMutation(base, {
        type: 'apply-set',
        equips: [{ slot: 'mystery', entry: entry(CAP, 'mystery') }],
        unequips: [],
      }),
    ).toThrow(/Unknown equipment slot/);
  });
});

describe('the hook publishes ONE canonical document per bulk action', () => {
  it('the seven-slot test loadout is one publish with one revision increment', async () => {
    seedInventory(
      [CAP, GLASSES, AURA.address, FOG.address].map((address) => ({
        address,
        quantity: 1,
      })),
    );
    seedPlacement([entry(GLASSES, 'eyewear')], { note: 'from-another-client' });
    const { result } = makeHook();

    await act(async () => {
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: {
          type: 'apply-set',
          equips: [
            { slot: 'headwear', entry: entry(CAP, 'headwear') },
            { slot: 'aura', entry: entry(AURA.address, 'aura') },
            { slot: 'ground-local', entry: entry(FOG.address, 'ground-local') },
          ],
          unequips: [],
        },
      });
    });

    // The base was seeded, so exactly one NEW event was signed.
    expect(signEvent).toHaveBeenCalledTimes(1);
    const doc = lastPlacementDoc();
    expect(doc.revision).toBe(5);
    expect(doc.placements.map((p) => p.slot).sort()).toEqual([
      'aura',
      'eyewear',
      'ground-local',
      'headwear',
    ]);
    // The pre-existing eyewear placement and the unknown content field rode
    // through untouched.
    expect(getLastEquippedPlacementBySlot(doc, 'eyewear')?.item).toBe(GLASSES);
    expect(doc.contentJson.note).toBe('from-another-client');
  });

  it('refuses the whole set when ANY equipped entry is unowned; nothing partial publishes', async () => {
    seedInventory([{ address: CAP, quantity: 1 }]); // aura NOT owned
    const { result } = makeHook();

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          characterId: CHARACTER,
          mutation: {
            type: 'apply-set',
            equips: [
              { slot: 'headwear', entry: entry(CAP, 'headwear') },
              { slot: 'aura', entry: entry(AURA.address, 'aura') },
            ],
            unequips: [],
          },
        }),
      ).rejects.toThrow(/do not own/);
    });
    expect(publishedPlacements).toHaveLength(0);
  });

  it('bulk unequips need no ownership and never write kind:31633', async () => {
    seedPlacement([
      entry(AURA.address, 'aura'),
      entry(FOG.address, 'ground-local'),
      entry(CAP, 'headwear'),
    ]);
    const { result } = makeHook();

    await act(async () => {
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation: {
          type: 'apply-set',
          equips: [],
          unequips: ['aura', 'ground-local'],
        },
      });
    });

    const doc = lastPlacementDoc();
    expect(doc.placements.map((p) => p.slot)).toEqual(['headwear']);
    expect(
      signEvent.mock.calls.every(([t]) => (t as { kind: number }).kind === 31634),
    ).toBe(true);
  });
});
