/**
 * The arrivals hook: when the player is told, and when they are not.
 *
 * Views are built with the real derivation and handed in directly; the two
 * catalogs are stood in for so a definition can be present, pending, or
 * never coming.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  deriveExternalInventoryStates,
  emptyExternalInventoryEvents,
  mergeExternalInventoryEvents,
} from './external-inventory-events';
import { KIND_GAME_INVENTORY } from './package';
import { FARM_STRAWBERRY_EVENT, FARM_STRAWBERRY_PRIMARY_IMAGE } from './partner-item-event-fixtures';
import { parseTrustedItemDefinition, resolveFromDefinition } from './protocol-adapter';
import type { ExternalInventoryViewResult } from './useExternalInventoryEvents';

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const FARM_ISSUER = 'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';
const STRAWBERRY = `31632:${FARM_ISSUER}:farm:produce:strawberry`;
const STRANGER = `31632:${'c'.repeat(64)}:farm:produce:strawberry`;

let currentUser: { pubkey: string } | null = { pubkey: OWNER };
vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: currentUser }) }));

const externalCatalog = vi.fn();
const officialCatalog = vi.fn();
vi.mock('./useExternalItemCatalog', () => ({ useExternalItemCatalog: () => externalCatalog() }));
vi.mock('./useItemCatalog', () => ({ useItemCatalog: () => officialCatalog() }));

import { useExternalInventoryArrivals } from './useExternalInventoryArrivals';

const STRAWBERRY_DEFINITION = resolveFromDefinition(parseTrustedItemDefinition(FARM_STRAWBERRY_EVENT)!);
const resolvedCatalog = { data: { byAddress: new Map([[STRAWBERRY, STRAWBERRY_DEFINITION]]), resolvedCount: 1, requestedCount: 1 }, isError: false, isFetching: false };
const loadingCatalog = { data: undefined, isError: false, isFetching: true };
const emptyCatalog = { data: { byAddress: new Map(), resolvedCount: 0, requestedCount: 1 }, isError: false, isFetching: false };

const hex = (seed: string) =>
  seed.split('').map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64);
function snapshot(id: string, items: [string, number][], createdAt = 1000, owner = OWNER): NostrEvent {
  return {
    id: hex(id),
    pubkey: owner,
    created_at: createdAt,
    kind: KIND_GAME_INVENTORY,
    tags: [['d', 'farm:main'], ...items.map(([a, q]) => ['a', a, '', String(q)])],
    content: '',
    sig: '',
  };
}
function view(events: NostrEvent[], extra: Partial<ExternalInventoryViewResult> = {}, owner = OWNER): ExternalInventoryViewResult {
  const derived = deriveExternalInventoryStates(mergeExternalInventoryEvents(emptyExternalInventoryEvents(owner), events));
  return { ...derived, isLoading: false, isError: false, error: null, dataUpdatedAt: 1, ...extra };
}

let onArrivals: ReturnType<typeof vi.fn>;
function renderArrivals(initial: ExternalInventoryViewResult) {
  return renderHook((props: { view: ExternalInventoryViewResult }) => useExternalInventoryArrivals(props.view, { onArrivals }), {
    initialProps: { view: initial },
  });
}

beforeEach(() => {
  currentUser = { pubkey: OWNER };
  onArrivals = vi.fn();
  externalCatalog.mockReturnValue(resolvedCatalog);
  officialCatalog.mockReturnValue({ data: undefined });
});

describe('baseline', () => {
  it('hydration from a store with items tells the player nothing', () => {
    renderArrivals(view([snapshot('s1', [[STRAWBERRY, 3]])]));
    expect(onArrivals).not.toHaveBeenCalled();
  });

  it('a loading view, and a store that was never written, are not a baseline', () => {
    const { rerender } = renderArrivals(view([], { isLoading: true, dataUpdatedAt: 0 }));
    rerender({ view: view([snapshot('s1', [[STRAWBERRY, 3]])], { isLoading: true, dataUpdatedAt: 0 }) });
    // Still loading: no baseline yet, so when the store lands with 3 it hydrates silently.
    rerender({ view: view([snapshot('s1', [[STRAWBERRY, 3]])]) });
    expect(onArrivals).not.toHaveBeenCalled();
  });

  it('a remount with the same store re-hydrates silently', () => {
    const stored = view([snapshot('s1', [[STRAWBERRY, 3]])]);
    const first = renderArrivals(stored);
    first.unmount();
    renderArrivals(view([snapshot('s1', [[STRAWBERRY, 3]])]));
    expect(onArrivals).not.toHaveBeenCalled();
  });

  it('the same view re-reported (a refetch that changed nothing, a re-render) tells nothing', () => {
    const { rerender } = renderArrivals(view([snapshot('s1', [[STRAWBERRY, 3]])]));
    rerender({ view: view([snapshot('s1', [[STRAWBERRY, 3]])], { dataUpdatedAt: 2 }) });
    rerender({ view: view([snapshot('s1', [[STRAWBERRY, 3]])], { dataUpdatedAt: 3 }) });
    expect(onArrivals).not.toHaveBeenCalled();
  });
});

describe('an arrival', () => {
  it('0 → 1 Strawberry: once, named, pictured, and sourced to Nostr Farm', () => {
    const { rerender } = renderArrivals(view([snapshot('s1', [[STRAWBERRY, 0]])]));
    rerender({ view: view([snapshot('s2', [[STRAWBERRY, 1]], 1001)]) });
    expect(onArrivals).toHaveBeenCalledTimes(1);
    expect(onArrivals.mock.calls[0][0]).toEqual([
      { itemAddress: STRAWBERRY, name: 'Strawberry', imageUrl: FARM_STRAWBERRY_PRIMARY_IMAGE, emoji: STRAWBERRY_DEFINITION.emoji, sourceName: 'Nostr Farm', delta: 1 },
    ]);
    // The same state again: nothing more.
    rerender({ view: view([snapshot('s2', [[STRAWBERRY, 1]], 1001)], { dataUpdatedAt: 2 }) });
    expect(onArrivals).toHaveBeenCalledTimes(1);
  });

  it('2 → 3 is +1; 1 → 4 is +3', () => {
    const { rerender } = renderArrivals(view([snapshot('s1', [[STRAWBERRY, 2]])]));
    rerender({ view: view([snapshot('s2', [[STRAWBERRY, 3]], 1001)]) });
    rerender({ view: view([snapshot('s3', [[STRAWBERRY, 1]], 1002)]) });
    rerender({ view: view([snapshot('s4', [[STRAWBERRY, 4]], 1003)]) });
    expect(onArrivals.mock.calls.map(([a]) => a[0].delta)).toEqual([1, 3]);
  });

  it('waits for the definition, then tells once; never names an address', () => {
    externalCatalog.mockReturnValue(loadingCatalog);
    const { rerender } = renderArrivals(view([]));
    rerender({ view: view([snapshot('s1', [[STRAWBERRY, 1]])]) });
    expect(onArrivals).not.toHaveBeenCalled();
    externalCatalog.mockReturnValue(resolvedCatalog);
    rerender({ view: view([snapshot('s1', [[STRAWBERRY, 1]])]) });
    expect(onArrivals).toHaveBeenCalledTimes(1);
    expect(onArrivals.mock.calls[0][0][0].name).toBe('Strawberry');
    rerender({ view: view([snapshot('s1', [[STRAWBERRY, 1]])], { dataUpdatedAt: 2 }) });
    expect(onArrivals).toHaveBeenCalledTimes(1);
  });

  it('an item from an untrusted issuer, or one the catalog settled without, is dropped: no misleading source', () => {
    externalCatalog.mockReturnValue(emptyCatalog);
    const { rerender } = renderArrivals(view([]));
    rerender({ view: view([snapshot('s1', [[STRANGER, 1], [STRAWBERRY, 1]])]) });
    expect(onArrivals).not.toHaveBeenCalled();
    // Now the catalog resolves the Strawberry: the dropped stranger never comes back,
    // and the Strawberry, whose arrival was dropped with it when the catalog settled, is not replayed either.
    externalCatalog.mockReturnValue(resolvedCatalog);
    rerender({ view: view([snapshot('s1', [[STRANGER, 1], [STRAWBERRY, 1]])], { dataUpdatedAt: 2 }) });
    expect(onArrivals).not.toHaveBeenCalled();
    // A LATER rise is reported as usual.
    rerender({ view: view([snapshot('s2', [[STRANGER, 1], [STRAWBERRY, 2]], 1001)]) });
    expect(onArrivals).toHaveBeenCalledTimes(1);
    expect(onArrivals.mock.calls[0][0]).toHaveLength(1);
    expect(onArrivals.mock.calls[0][0][0].itemAddress).toBe(STRAWBERRY);
  });
});

describe('players', () => {
  it('another player signing in hydrates afresh; logging out forgets', () => {
    const { rerender } = renderArrivals(view([snapshot('s1', [[STRAWBERRY, 1]])]));
    currentUser = { pubkey: OTHER };
    rerender({ view: view([snapshot('o1', [[STRAWBERRY, 5]], 1000, OTHER)], {}, OTHER) });
    expect(onArrivals).not.toHaveBeenCalled();
    rerender({ view: view([snapshot('o2', [[STRAWBERRY, 6]], 1001, OTHER)], {}, OTHER) });
    expect(onArrivals).toHaveBeenCalledTimes(1);
    currentUser = null;
    rerender({ view: view([], { isLoading: false, dataUpdatedAt: 0 }, '') });
    currentUser = { pubkey: OWNER };
    rerender({ view: view([snapshot('s9', [[STRAWBERRY, 9]], 1009)]) });
    expect(onArrivals).toHaveBeenCalledTimes(1);
  });
});
