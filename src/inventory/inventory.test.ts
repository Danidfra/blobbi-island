import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  buildEmptyInventory,
  itemIdToAddress,
  applyMutation,
  buildInventoryTemplate,
  getQuantity,
  hasQuantity,
  ISLAND_INVENTORY_D,
  KIND_GAME_INVENTORY,
} from '@/inventory';
import { parseGameInventory, getInventoryItemQuantity } from '@nostr-games/inventory';

const OWNER = 'a'.repeat(64);
const APPLE = itemIdToAddress('food_apple')!;
const PIZZA = itemIdToAddress('food_pizza')!;

describe('buildEmptyInventory', () => {
  it('produces a valid empty inventory with the Island d', () => {
    const inv = buildEmptyInventory(OWNER);
    expect(inv.id).toBe(ISLAND_INVENTORY_D);
    expect(inv.items).toEqual([]);
    expect(inv.kind).toBe(KIND_GAME_INVENTORY);
  });
});

describe('applyMutation', () => {
  it('adds quantity', () => {
    const inv = applyMutation(buildEmptyInventory(OWNER), {
      type: 'add',
      address: APPLE,
      amount: 3,
    });
    expect(getQuantity(inv, APPLE)).toBe(3);
  });

  it('purchase adds N units', () => {
    const inv = applyMutation(buildEmptyInventory(OWNER), {
      type: 'purchase',
      address: APPLE,
      units: 5,
    });
    expect(getQuantity(inv, APPLE)).toBe(5);
  });

  it('removes quantity and removes zero entries', () => {
    let inv = applyMutation(buildEmptyInventory(OWNER), {
      type: 'add',
      address: APPLE,
      amount: 2,
    });
    inv = applyMutation(inv, { type: 'remove', address: APPLE, amount: 2 });
    expect(getQuantity(inv, APPLE)).toBe(0);
    expect(inv.items.find((i) => i.address === APPLE)).toBeUndefined();
  });

  it('sets an exact quantity; setting 0 removes it', () => {
    let inv = applyMutation(buildEmptyInventory(OWNER), {
      type: 'set',
      address: APPLE,
      quantity: 10,
    });
    expect(getQuantity(inv, APPLE)).toBe(10);
    inv = applyMutation(inv, { type: 'set', address: APPLE, quantity: 0 });
    expect(getQuantity(inv, APPLE)).toBe(0);
  });

  it('consumes exactly one item', () => {
    let inv = applyMutation(buildEmptyInventory(OWNER), {
      type: 'add',
      address: APPLE,
      amount: 2,
    });
    inv = applyMutation(inv, { type: 'consume', address: APPLE });
    expect(getQuantity(inv, APPLE)).toBe(1);
  });

  it('throws when consuming with zero quantity', () => {
    expect(() =>
      applyMutation(buildEmptyInventory(OWNER), {
        type: 'consume',
        address: APPLE,
      }),
    ).toThrow(/quantity is zero/);
  });

  it('rejects negative amount', () => {
    expect(() =>
      applyMutation(buildEmptyInventory(OWNER), {
        type: 'add',
        address: APPLE,
        amount: -1,
      }),
    ).toThrow(/negative/);
  });

  it('rejects non-integer amount', () => {
    expect(() =>
      applyMutation(buildEmptyInventory(OWNER), {
        type: 'add',
        address: APPLE,
        amount: 1.5,
      }),
    ).toThrow(/integer/);
  });

  it('rejects invalid item address', () => {
    expect(() =>
      applyMutation(buildEmptyInventory(OWNER), {
        type: 'add',
        address: 'not-an-address',
        amount: 1,
      }),
    ).toThrow(/Invalid kind:31632/);
  });

  it('preserves unrelated items', () => {
    let inv = applyMutation(buildEmptyInventory(OWNER), {
      type: 'add',
      address: APPLE,
      amount: 3,
    });
    inv = applyMutation(inv, { type: 'add', address: PIZZA, amount: 2 });
    inv = applyMutation(inv, { type: 'consume', address: APPLE });
    expect(getQuantity(inv, APPLE)).toBe(2);
    expect(getQuantity(inv, PIZZA)).toBe(2); // untouched
  });
});

describe('hasQuantity', () => {
  it('checks quantity thresholds', () => {
    const inv = applyMutation(buildEmptyInventory(OWNER), {
      type: 'add',
      address: APPLE,
      amount: 3,
    });
    expect(hasQuantity(inv, APPLE, 3)).toBe(true);
    expect(hasQuantity(inv, APPLE, 4)).toBe(false);
    expect(hasQuantity(inv, PIZZA, 1)).toBe(false);
  });
});

describe('buildInventoryTemplate (round-trip)', () => {
  it('builds a publishable kind:31633 template with correct d and a-refs', () => {
    let inv = applyMutation(buildEmptyInventory(OWNER), {
      type: 'add',
      address: APPLE,
      amount: 3,
    });
    inv = applyMutation(inv, { type: 'add', address: PIZZA, amount: 1 });

    const template = buildInventoryTemplate(inv);
    expect(template.kind).toBe(KIND_GAME_INVENTORY);
    expect(template.tags.find((t) => t[0] === 'd')).toEqual([
      'd',
      ISLAND_INVENTORY_D,
    ]);
    // `a` tags reference the item addresses with quantities.
    const aTags = template.tags.filter((t) => t[0] === 'a');
    expect(aTags).toHaveLength(2);

    // Round-trip parse.
    const event: NostrEvent = {
      id: '',
      pubkey: OWNER,
      created_at: 5,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: '',
    };
    const parsed = parseGameInventory(event)!;
    expect(getInventoryItemQuantity(parsed, APPLE)).toBe(3);
    expect(getInventoryItemQuantity(parsed, PIZZA)).toBe(1);
  });
});

describe('inventory reads (parsing)', () => {
  it('parses a valid stored inventory', () => {
    const template = buildInventoryTemplate(
      applyMutation(buildEmptyInventory(OWNER), {
        type: 'add',
        address: APPLE,
        amount: 4,
      }),
    );
    const event: NostrEvent = {
      id: '',
      pubkey: OWNER,
      created_at: 5,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: '',
    };
    const parsed = parseGameInventory(event)!;
    expect(getInventoryItemQuantity(parsed, APPLE)).toBe(4);
  });

  it('ignores malformed / zero-quantity item tags (package behavior)', () => {
    const event: NostrEvent = {
      id: '',
      pubkey: OWNER,
      created_at: 5,
      kind: KIND_GAME_INVENTORY,
      tags: [
        ['d', ISLAND_INVENTORY_D],
        ['a', APPLE, '', '0'], // zero quantity -> ignored
        ['a', PIZZA, '', '2'], // valid
        ['a', 'garbage'], // malformed -> ignored
      ],
      content: '',
      sig: '',
    };
    const parsed = parseGameInventory(event)!;
    expect(getInventoryItemQuantity(parsed, APPLE)).toBe(0);
    expect(getInventoryItemQuantity(parsed, PIZZA)).toBe(2);
  });
});

describe('duplicate strategy (package default: last)', () => {
  it('resolves duplicate item addresses using the recommended `last` strategy', () => {
    const event: NostrEvent = {
      id: '',
      pubkey: OWNER,
      created_at: 5,
      kind: KIND_GAME_INVENTORY,
      tags: [
        ['d', ISLAND_INVENTORY_D],
        ['a', APPLE, '', '3'],
        ['a', APPLE, '', '7'], // duplicate -> `last` keeps 7
      ],
      content: '',
      sig: '',
    };
    // Permissive parse (the mode the adapter uses) defaults to `last`.
    const parsed = parseGameInventory(event, { mode: 'permissive' })!;
    expect(getInventoryItemQuantity(parsed, APPLE)).toBe(7);
  });
});

describe('overflow protection (package behavior)', () => {
  it('throws when adding would exceed Number.MAX_SAFE_INTEGER', () => {
    const inv = applyMutation(buildEmptyInventory(OWNER), {
      type: 'set',
      address: APPLE,
      quantity: Number.MAX_SAFE_INTEGER,
    });
    expect(() =>
      applyMutation(inv, { type: 'add', address: APPLE, amount: 1 }),
    ).toThrow();
    // Sanity: no silent wrap occurred.
    expect(getQuantity(inv, APPLE)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects an unsafe-integer set quantity', () => {
    expect(() =>
      applyMutation(buildEmptyInventory(OWNER), {
        type: 'set',
        address: APPLE,
        quantity: Number.MAX_SAFE_INTEGER + 2,
      }),
    ).toThrow();
  });
});
