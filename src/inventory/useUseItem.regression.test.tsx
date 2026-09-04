/**
 * Regression tests for the item-consumption Blobbi state update.
 *
 * Root cause of the original bug (manual validation):
 *   - `mergePetStateTags` derived `last_interaction` from the STALE raw tag of
 *     the source event before the live `pet.lastInteraction`, so action
 *     timestamps never advanced even though `care_streak` (read from the live
 *     `pet` field) did, an inconsistent state.
 *   - `useUseItem` reimplemented a naive `>20h` care-streak rule and only wrote
 *     `care_streak`, leaving `care_streak_last_at` / `care_streak_last_day`
 *     stale (preserved passthrough) while `care_streak` advanced.
 *
 * These tests prove the corrected behavior using DETERMINISTIC mocked
 * timestamps. They assert on the published kind:31124 tags, the publish
 * ordering (1124 -> 31124 -> 31633), accessory/unrelated-field preservation,
 * and that no legacy kind:11125 `storage` write is introduced.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { getLocalDayString } from '@blobbi-kit/core/blobbi';

const TEST_PUBKEY = 'e'.repeat(64);

const publish = vi.fn();
const inventoryMutate = vi.fn();
const nostrQuery = vi.fn<() => Promise<NostrEvent[]>>();
const applyOptimisticUpdate = vi.fn();

let currentPet: Record<string, unknown> | null;

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { query: nostrQuery, event: vi.fn() } }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: TEST_PUBKEY } }),
}));

vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: publish }),
}));

vi.mock('@/hooks/useOptimizedStatus', () => ({
  useOptimizedStatus: () => ({
    status: { allPets: currentPet ? [currentPet] : [] },
    applyOptimisticUpdate,
  }),
}));

vi.mock('./useInventoryMutation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useInventoryMutation')>();
  return {
    ...actual,
    useInventoryMutation: () => ({ mutateAsync: inventoryMutate }),
  };
});

import { useUseItem } from './useUseItem';
import {
  buildEmptyInventory,
  buildInventoryTemplate,
  applyMutation,
} from './index';
import { bundledFallbackDefinition } from './catalog-fallback';
import { itemIdToAddress } from './registry';

const APPLE = itemIdToAddress('food_apple')!;
const SOAP = itemIdToAddress('hyg_soap')!;
const VITAMINS = itemIdToAddress('med_vitamins')!;
const BALL = itemIdToAddress('toy_ball')!;

const appleDef = bundledFallbackDefinition(APPLE)!;
const soapDef = bundledFallbackDefinition(SOAP)!;
const vitaminsDef = bundledFallbackDefinition(VITAMINS)!;
const ballDef = bundledFallbackDefinition(BALL)!;

// Deterministic "now" for all tests.
const NOW = new Date('2026-07-24T12:00:00.000Z');
const NOW_UNIX = Math.floor(NOW.getTime() / 1000);
// A stale timestamp far in the past (matches the shape of the reported bug).
const STALE_UNIX = 1783104978; // ~2026-07-03
const STALE_STREAK_AT = 1776875929; // ~2026-04-22
const STALE_STREAK_DAY = '2026-04-22';

function inventoryEvent(address: string, qty: number): NostrEvent {
  const inv = applyMutation(buildEmptyInventory(TEST_PUBKEY), {
    type: 'add',
    address,
    amount: qty,
  });
  const template = buildInventoryTemplate(inv);
  return {
    id: 'inv',
    pubkey: TEST_PUBKEY,
    created_at: 10,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderUse() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useUseItem(), { wrapper: makeWrapper(client) });
}

/** Extract the single kind:31124 event from the publish mock calls. */
function stateEvent(): { kind: number; tags: string[][]; content: string } {
  const call = publish.mock.calls.find((c) => c[0]?.kind === 31124);
  if (!call) throw new Error('no kind:31124 publish found');
  return call[0];
}

/** Read a single tag value from a published event's tags. */
function tag(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

/** Count occurrences of a tag name (to catch duplicates). */
function tagCount(tags: string[][], name: string): number {
  return tags.filter(([n]) => n === name).length;
}

// A canonical adult pet with rich raw tags, STALE timestamps, and an unrelated
// field + equipped accessory that must be preserved through the republish.
function makeAdultPet(overrides: Record<string, unknown> = {}) {
  const rawTags: string[][] = [
    ['d', 'blobbi-1'],
    ['stage', 'adult'],
    ['breeding_ready', 'false'],
    ['generation', '1'],
    ['hunger', '40'],
    ['happiness', '40'],
    ['health', '40'],
    ['hygiene', '40'],
    ['energy', '40'],
    ['experience', '100'],
    ['care_streak', '1'],
    ['last_interaction', String(STALE_UNIX)],
    ['last_meal', String(STALE_UNIX)],
    ['care_streak_last_at', String(STALE_STREAK_AT)],
    ['care_streak_last_day', STALE_STREAK_DAY],
    // Unrelated tag set by Ditto that must survive republish.
    ['progression_state', 'growing'],
    // Equipped accessory tag that must survive republish.
    ['equip', 'hat:wizard'],
  ];
  return {
    id: 'blobbi-1',
    stage: 'adult',
    generation: 1,
    breedingReady: false,
    careStreak: 1,
    hunger: 40,
    happiness: 40,
    health: 40,
    hygiene: 40,
    energy: 40,
    experience: 100,
    isSleeping: false,
    isDirty: false,
    hasBuff: false,
    hasDebuff: false,
    inParty: false,
    visibleToOthers: true,
    lastInteraction: new Date(STALE_UNIX * 1000),
    lastMeal: new Date(STALE_UNIX * 1000),
    rawTags,
    rawContent: '',
    ...overrides,
  };
}

describe('useUseItem: Blobbi state timestamp & care-streak regression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    publish.mockReset();
    inventoryMutate.mockReset();
    nostrQuery.mockReset();
    applyOptimisticUpdate.mockReset();
    currentPet = makeAdultPet();
    publish.mockResolvedValue(undefined);
    inventoryMutate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('feed updates both last_meal and last_interaction (not stale)', async () => {
    nostrQuery.mockResolvedValue([inventoryEvent(APPLE, 2)]);
    const { result } = renderUse();
    await act(async () => {
      await result.current.mutateAsync({ address: APPLE, definition: appleDef, petId: 'blobbi-1', quantity: 1 });
    });
    const { tags } = stateEvent();
    expect(tag(tags, 'last_meal')).toBe(String(NOW_UNIX));
    expect(tag(tags, 'last_interaction')).toBe(String(NOW_UNIX));
    expect(tag(tags, 'last_interaction')).not.toBe(String(STALE_UNIX));
    expect(tagCount(tags, 'last_interaction')).toBe(1);
  });

  it('medicine updates last_medicine and last_interaction', async () => {
    nostrQuery.mockResolvedValue([inventoryEvent(VITAMINS, 2)]);
    const { result } = renderUse();
    await act(async () => {
      await result.current.mutateAsync({ address: VITAMINS, definition: vitaminsDef, petId: 'blobbi-1', quantity: 1 });
    });
    const { tags } = stateEvent();
    expect(tag(tags, 'last_medicine')).toBe(String(NOW_UNIX));
    expect(tag(tags, 'last_interaction')).toBe(String(NOW_UNIX));
  });

  it('clean updates last_clean and last_interaction', async () => {
    nostrQuery.mockResolvedValue([inventoryEvent(SOAP, 2)]);
    const { result } = renderUse();
    await act(async () => {
      await result.current.mutateAsync({ address: SOAP, definition: soapDef, petId: 'blobbi-1', quantity: 1 });
    });
    const { tags } = stateEvent();
    expect(tag(tags, 'last_clean')).toBe(String(NOW_UNIX));
    expect(tag(tags, 'last_interaction')).toBe(String(NOW_UNIX));
  });

  it('care-streak increment also updates care_streak_last_at and care_streak_last_day', async () => {
    // last activity was long ago (2+ days) -> shared helper resets to 1 with
    // fresh metadata. Either way the metadata must advance in lockstep.
    nostrQuery.mockResolvedValue([inventoryEvent(APPLE, 2)]);
    const { result } = renderUse();
    await act(async () => {
      await result.current.mutateAsync({ address: APPLE, definition: appleDef, petId: 'blobbi-1', quantity: 1 });
    });
    const { tags } = stateEvent();
    const todayStr = getLocalDayString(NOW);
    // Metadata advanced (not the stale April values) and is internally consistent.
    expect(tag(tags, 'care_streak_last_day')).toBe(todayStr);
    expect(tag(tags, 'care_streak_last_day')).not.toBe(STALE_STREAK_DAY);
    expect(tag(tags, 'care_streak_last_at')).toBe(String(NOW_UNIX));
    expect(tag(tags, 'care_streak_last_at')).not.toBe(String(STALE_STREAK_AT));
    // care_streak itself changed and its metadata changed with it.
    expect(tag(tags, 'care_streak')).toBeDefined();
    expect(tagCount(tags, 'care_streak')).toBe(1);
    expect(tagCount(tags, 'care_streak_last_at')).toBe(1);
    expect(tagCount(tags, 'care_streak_last_day')).toBe(1);
  });

  it('same-day action follows the streak rule without corrupting metadata', async () => {
    // Set the streak metadata to TODAY so the shared helper reports same_day.
    const todayStr = getLocalDayString(NOW);
    currentPet = makeAdultPet();
    (currentPet.rawTags as string[][]) = (currentPet.rawTags as string[][]).map((t) =>
      t[0] === 'care_streak_last_day'
        ? ['care_streak_last_day', todayStr]
        : t[0] === 'care_streak_last_at'
        ? ['care_streak_last_at', String(NOW_UNIX - 3600)]
        : t[0] === 'care_streak'
        ? ['care_streak', '5']
        : t,
    );
    currentPet.careStreak = 5;

    nostrQuery.mockResolvedValue([inventoryEvent(APPLE, 2)]);
    const { result } = renderUse();
    await act(async () => {
      await result.current.mutateAsync({ address: APPLE, definition: appleDef, petId: 'blobbi-1', quantity: 1 });
    });
    const { tags } = stateEvent();
    // Streak unchanged on same day; metadata preserved (day unchanged, at
    // preserved at its previous value; not corrupted or wiped).
    expect(tag(tags, 'care_streak')).toBe('5');
    expect(tag(tags, 'care_streak_last_day')).toBe(todayStr);
    expect(tag(tags, 'care_streak_last_at')).toBe(String(NOW_UNIX - 3600));
    // But the interaction timestamp DOES advance even on a same-day action.
    expect(tag(tags, 'last_interaction')).toBe(String(NOW_UNIX));
    expect(tag(tags, 'last_meal')).toBe(String(NOW_UNIX));
  });

  it('a later valid day follows the increment rule', async () => {
    // Set last day to yesterday (local) so the shared helper increments.
    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStr = getLocalDayString(yesterday);
    const todayStr = getLocalDayString(NOW);
    currentPet = makeAdultPet();
    (currentPet.rawTags as string[][]) = (currentPet.rawTags as string[][]).map((t) =>
      t[0] === 'care_streak_last_day'
        ? ['care_streak_last_day', yesterdayStr]
        : t[0] === 'care_streak'
        ? ['care_streak', '3']
        : t,
    );
    currentPet.careStreak = 3;

    nostrQuery.mockResolvedValue([inventoryEvent(APPLE, 2)]);
    const { result } = renderUse();
    await act(async () => {
      await result.current.mutateAsync({ address: APPLE, definition: appleDef, petId: 'blobbi-1', quantity: 1 });
    });
    const { tags } = stateEvent();
    expect(tag(tags, 'care_streak')).toBe('4'); // incremented 3 -> 4
    expect(tag(tags, 'care_streak_last_day')).toBe(todayStr);
    expect(tag(tags, 'care_streak_last_at')).toBe(String(NOW_UNIX));
  });

  it('preserves unrelated Blobbi state and never authors an equipment tag', async () => {
    // Equipment moved to kind:31634. Feeding a Blobbi republishes its kind:31124
    // state and must not AUTHOR equipment: it neither reads the old vocabulary
    // nor writes a fresh copy of it. A legacy `equip` tag already on the event
    // rides along verbatim through the unknown-tag passthrough; this client
    // has stopped understanding that tag, which is not a licence to delete a
    // player's record.
    nostrQuery.mockResolvedValue([inventoryEvent(APPLE, 2)]);
    const { result } = renderUse();
    await act(async () => {
      await result.current.mutateAsync({ address: APPLE, definition: appleDef, petId: 'blobbi-1', quantity: 1 });
    });
    const { tags } = stateEvent();
    // Unrelated Ditto tag survives.
    expect(tag(tags, 'progression_state')).toBe('growing');
    // Carried through byte-for-byte, and neither duplicated nor rewritten.
    const equipTags = tags.filter(([n]) => n === 'equip');
    expect(equipTags).toEqual([['equip', 'hat:wizard']]);
  });

  it('inventory still decrements AFTER the Blobbi state event (ordering 1124 -> 31124 -> 31633)', async () => {
    nostrQuery.mockResolvedValue([inventoryEvent(APPLE, 2)]);

    // Record the order of side effects across publish + inventory.
    const order: string[] = [];
    publish.mockImplementation(async (e: { kind: number }) => {
      order.push(`publish:${e.kind}`);
    });
    inventoryMutate.mockImplementation(async () => {
      order.push('inventory:remove');
    });

    const { result } = renderUse();
    await act(async () => {
      await result.current.mutateAsync({ address: APPLE, definition: appleDef, petId: 'blobbi-1', quantity: 1 });
    });

    expect(order).toEqual(['publish:1124', 'publish:31124', 'inventory:remove']);
  });

  it('does NOT introduce any legacy kind:11125 storage write', async () => {
    nostrQuery.mockResolvedValue([inventoryEvent(BALL, 2)]);
    const { result } = renderUse();
    await act(async () => {
      await result.current.mutateAsync({ address: BALL, definition: ballDef, petId: 'blobbi-1', quantity: 1 });
    });
    // No published event is kind 11125, and no `storage` tag is emitted anywhere.
    for (const call of publish.mock.calls) {
      const e = call[0];
      expect(e.kind).not.toBe(11125);
      if (Array.isArray(e.tags)) {
        expect((e.tags as string[][]).some(([n]) => n === 'storage')).toBe(false);
      }
    }
  });
});
