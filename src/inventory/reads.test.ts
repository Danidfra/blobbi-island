/**
 * Addressable-event read selection tests (Q4 of the audit).
 *
 * Exercises the pure selection logic in `fetchInventory` with a fake `nostr`
 * whose `query` returns crafted events in arbitrary order, including a NEWER
 * malformed event alongside an OLDER valid one.
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  fetchInventory,
  buildInventoryTemplate,
  applyMutation,
  buildEmptyInventory,
  itemIdToAddress,
  ISLAND_INVENTORY_D,
  KIND_GAME_INVENTORY,
} from '@/inventory';
import { getInventoryItemQuantity } from '@nostr-games/inventory';

const OWNER = 'c'.repeat(64);
const APPLE = itemIdToAddress('food_apple')!;

/** A fake nostr whose query returns a fixed set of events. */
function fakeNostr(events: NostrEvent[]) {
  return {
    query: async () => events,
  } as unknown as Parameters<typeof fetchInventory>[0];
}

function validInventoryEvent(quantity: number, created_at: number): NostrEvent {
  const inv = applyMutation(buildEmptyInventory(OWNER), {
    type: 'add',
    address: APPLE,
    amount: quantity,
  });
  const template = buildInventoryTemplate(inv);
  return {
    id: `valid-${created_at}`,
    pubkey: OWNER,
    created_at,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
}

/** A malformed 31633 event: missing `d` tag (MUST-reject by the package). */
function malformedInventoryEvent(created_at: number): NostrEvent {
  return {
    id: `malformed-${created_at}`,
    pubkey: OWNER,
    created_at,
    kind: KIND_GAME_INVENTORY,
    tags: [['a', APPLE, '', '999']], // no `d` tag -> rejected
    content: '',
    sig: 'sig',
  };
}

describe('fetchInventory selection', () => {
  it('returns an empty inventory when no event exists', async () => {
    const inv = await fetchInventory(fakeNostr([]), OWNER, AbortSignal.timeout(1000));
    expect(inv.items).toEqual([]);
    expect(inv.id).toBe(ISLAND_INVENTORY_D);
  });

  it('selects the newest VALID event', async () => {
    const older = validInventoryEvent(2, 100);
    const newer = validInventoryEvent(9, 200);
    const inv = await fetchInventory(
      fakeNostr([older, newer]),
      OWNER,
      AbortSignal.timeout(1000),
    );
    expect(getInventoryItemQuantity(inv, APPLE)).toBe(9);
  });

  it('a NEWER malformed event does not hide an OLDER valid event', async () => {
    const olderValid = validInventoryEvent(4, 100);
    const newerMalformed = malformedInventoryEvent(500);
    const inv = await fetchInventory(
      // deliberately out of order
      fakeNostr([newerMalformed, olderValid]),
      OWNER,
      AbortSignal.timeout(1000),
    );
    // The older valid event's quantity survives.
    expect(getInventoryItemQuantity(inv, APPLE)).toBe(4);
  });

  it('returns empty when the only event is malformed', async () => {
    const inv = await fetchInventory(
      fakeNostr([malformedInventoryEvent(500)]),
      OWNER,
      AbortSignal.timeout(1000),
    );
    expect(inv.items).toEqual([]);
  });
});
