/**
 * Lossless kind:31633 round-trip, the reset's first invariant.
 *
 * kind:31633 is a replaceable event: every write REPLACES the previous event
 * in full, so any data the canonical builder does not carry forward is
 * destroyed permanently. These tests prove that a stored inventory containing
 * every category of preservable data, non-empty content, `context` tags,
 * grant references, unknown/forward-compatible tags (including the economy
 * allocation marker), and unrelated item entries, survives each production
 * mutation path, and that repeated rewrites never duplicate the preserved
 * tags.
 *
 * Covered writers: the canonical template builder (ordinary mutations), the
 * Coin wallet (grant / spend / atomic purchase / spend-to-zero), and the
 * arcade ticket writer. The economy-entry allocation is covered in
 * `economy-entry.test.ts` through the same builder.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { clearCoinOps } from '@/lib/coin-op-ledger';

import {
  createCoinWallet,
  mintCoinOpId,
  type CoinWalletNostr,
} from './coin-wallet';
import { BLOBBI_COIN_ADDRESS } from './coin';
import {
  applyMutation,
  buildInventoryTemplate,
  extractForeignInventoryTags,
} from './useInventoryMutation';
import { createArcadeTicketWriter, ARCADE_TICKET_ADDRESS } from './arcade-reward-writer';
import { parseInventoryEvent } from './protocol-adapter';
import { ISLAND_INVENTORY_D, ISLAND_INVENTORY_NAME, KIND_GAME_INVENTORY } from './package';

const PUBKEY = 'f'.repeat(64);
const APPLE = `31632:${'a'.repeat(64)}:blobbi:food:apple`;
const PIZZA = `31632:${'a'.repeat(64)}:blobbi:food:pizza`;

const MARKER = ['allocation', 'island-economy:v1'];
const MYSTERY = ['mystery', 'value', 'extra'];
const PLAIN_E = ['e', 'b'.repeat(64), 'wss://relay.example'];
const CONTEXT = ['context', 'game:blobbi-island'];
const GRANT_REF = ['e', 'c'.repeat(64), '', 'grant'];
const CONTENT = '{"sort":"category","view":"grid"}';

/** A stored inventory carrying every category of preservable data. */
function richEvent(coinQuantity: number, createdAt = 1000): NostrEvent {
  const tags: string[][] = [
    ['d', ISLAND_INVENTORY_D],
    CONTEXT,
    ['name', 'Someone Else Named This'],
    ['a', APPLE, '', '7'],
  ];
  if (coinQuantity > 0) {
    tags.push(['a', BLOBBI_COIN_ADDRESS, '', String(coinQuantity)]);
  }
  tags.push(GRANT_REF, PLAIN_E, MARKER, MYSTERY, ['client', 'someone-else']);
  return {
    id: `rich-${createdAt}`,
    pubkey: PUBKEY,
    created_at: createdAt,
    kind: KIND_GAME_INVENTORY,
    tags,
    content: CONTENT,
    sig: 'sig',
  };
}

function makeRelay(initial: NostrEvent | null) {
  let stored = initial;
  const published: NostrEvent[] = [];
  const nostr: CoinWalletNostr = {
    query: async () => (stored ? [stored] : []),
    event: async (event) => {
      published.push(event);
      stored = event;
    },
  };
  return { nostr, published, getStored: () => stored };
}

function makeSigner() {
  return {
    signEvent: vi.fn(async (template: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
      ...template,
      id: `signed-${template.created_at}-${Math.random()}`,
      pubkey: PUBKEY,
      sig: 'sig',
    })),
  };
}

function makeWallet(relay: ReturnType<typeof makeRelay>) {
  return createCoinWallet({
    nostr: relay.nostr,
    user: { pubkey: PUBKEY, signer: makeSigner() } as never,
    now: () => 1_700_000_000_000,
  });
}

function countEqual(tags: string[][], tag: string[]): number {
  const key = JSON.stringify(tag);
  return tags.filter((t) => JSON.stringify(t) === key).length;
}

function coinQuantityOf(event: NostrEvent): number {
  const tag = event.tags.find(([name, addr]) => name === 'a' && addr === BLOBBI_COIN_ADDRESS);
  return tag ? Number(tag[3]) : 0;
}

/** Everything a rewrite must carry forward, asserted in one place. */
function expectPreserved(event: NostrEvent): void {
  expect(event.content).toBe(CONTENT);
  expect(countEqual(event.tags, CONTEXT)).toBe(1);
  expect(countEqual(event.tags, GRANT_REF)).toBe(1);
  expect(countEqual(event.tags, PLAIN_E)).toBe(1);
  expect(countEqual(event.tags, MARKER)).toBe(1);
  expect(countEqual(event.tags, MYSTERY)).toBe(1);
  // The unrelated item balance is intact.
  const apple = event.tags.find(([name, addr]) => name === 'a' && addr === APPLE);
  expect(apple?.[3]).toBe('7');
  // Managed tags are rebuilt, never duplicated. The Island owns `name`; the
  // previous event's `client` is dropped and OUR attribution added once.
  expect(event.tags.filter(([n]) => n === 'd')).toHaveLength(1);
  expect(event.tags.filter(([n]) => n === 'name')).toEqual([
    ['name', ISLAND_INVENTORY_NAME],
  ]);
  expect(event.tags.filter(([n]) => n === 'alt')).toHaveLength(1);
  expect(event.tags.filter(([n]) => n === 'client')).toEqual([
    ['client', 'blobbi'],
  ]);
}

beforeEach(() => clearCoinOps());
afterEach(() => {
  clearCoinOps();
  vi.restoreAllMocks();
});

describe('canonical template builder', () => {
  it('rebuilds an event losslessly around an item grant', () => {
    const base = parseInventoryEvent(richEvent(40))!;
    const next = applyMutation(base, { type: 'add', address: PIZZA, amount: 2 });
    const template = buildInventoryTemplate(next);
    const event = { ...richEvent(40), tags: template.tags, content: template.content };
    // The builder does not add `client`; publish paths do. Simulate that.
    event.tags = [...event.tags, ['client', 'blobbi']];
    expectPreserved(event);
    const pizza = event.tags.find(([n, a]) => n === 'a' && a === PIZZA);
    expect(pizza?.[3]).toBe('2');
  });

  it('exposes foreign tags for reuse and never the managed ones', () => {
    const base = parseInventoryEvent(richEvent(40))!;
    const foreign = extractForeignInventoryTags(base);
    expect(foreign).toContainEqual(MARKER);
    expect(foreign).toContainEqual(MYSTERY);
    expect(foreign).toContainEqual(PLAIN_E);
    expect(foreign.some(([n]) => n === 'd')).toBe(false);
    expect(foreign.some(([n]) => n === 'a')).toBe(false);
    expect(foreign.some(([n]) => n === 'context')).toBe(false);
    expect(foreign).not.toContainEqual(GRANT_REF);
    expect(foreign.some(([n]) => n === 'client')).toBe(false);
  });

  it('merges caller extraTags without duplicating preserved ones', () => {
    const base = parseInventoryEvent(richEvent(40))!;
    const template = buildInventoryTemplate(base, {
      extraTags: [MARKER, ['fresh', 'tag']],
    });
    expect(countEqual(template.tags, MARKER)).toBe(1);
    expect(countEqual(template.tags, ['fresh', 'tag'])).toBe(1);
  });
});

describe('Coin wallet mutations', () => {
  it('a Coin grant preserves everything', async () => {
    const relay = makeRelay(richEvent(40));
    const wallet = makeWallet(relay);
    const outcome = await wallet.grantCoins({
      opId: mintCoinOpId('test-grant'),
      amount: 10,
      label: 'test',
    });
    expect(outcome.status).toBe('applied');
    expectPreserved(relay.published[0]);
    expect(coinQuantityOf(relay.published[0])).toBe(50);
  });

  it('a Coin spend preserves everything', async () => {
    const relay = makeRelay(richEvent(40));
    const wallet = makeWallet(relay);
    const outcome = await wallet.spendCoins({
      opId: mintCoinOpId('test-spend'),
      amount: 15,
      label: 'test',
    });
    expect(outcome.status).toBe('applied');
    expectPreserved(relay.published[0]);
    expect(coinQuantityOf(relay.published[0])).toBe(25);
  });

  it('an atomic purchase (spend + grant lines) preserves everything', async () => {
    const relay = makeRelay(richEvent(40));
    const wallet = makeWallet(relay);
    const outcome = await wallet.spendCoins({
      opId: mintCoinOpId('test-purchase'),
      amount: 20,
      label: 'shop-purchase',
      grantLines: [{ address: PIZZA, amount: 3 }],
    });
    expect(outcome.status).toBe('applied');
    expect(relay.published).toHaveLength(1);
    expectPreserved(relay.published[0]);
    expect(coinQuantityOf(relay.published[0])).toBe(20);
    const pizza = relay.published[0].tags.find(([n, a]) => n === 'a' && a === PIZZA);
    expect(pizza?.[3]).toBe('3');
  });

  it('spending the balance to zero omits the Coin line but keeps the marker', async () => {
    const relay = makeRelay(richEvent(40));
    const wallet = makeWallet(relay);
    const outcome = await wallet.spendCoins({
      opId: mintCoinOpId('test-spend-all'),
      amount: 40,
      label: 'test',
    });
    expect(outcome.status).toBe('applied');
    expectPreserved(relay.published[0]);
    expect(coinQuantityOf(relay.published[0])).toBe(0);
    expect(
      relay.published[0].tags.some(([n, a]) => n === 'a' && a === BLOBBI_COIN_ADDRESS),
    ).toBe(false);
  });

  it('repeated rewrites never duplicate preserved tags', async () => {
    const relay = makeRelay(richEvent(40));
    const wallet = makeWallet(relay);
    await wallet.grantCoins({ opId: mintCoinOpId('g1'), amount: 5, label: 'test' });
    await wallet.spendCoins({ opId: mintCoinOpId('s1'), amount: 3, label: 'test' });
    await wallet.grantCoins({ opId: mintCoinOpId('g2'), amount: 1, label: 'test' });
    expect(relay.published).toHaveLength(3);
    const final = relay.published[2];
    expectPreserved(final);
    expect(coinQuantityOf(final)).toBe(43);
  });
});

describe('arcade ticket writer', () => {
  it('a ticket grant preserves everything', async () => {
    const relay = makeRelay(richEvent(40));
    const writer = createArcadeTicketWriter({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: makeSigner() } as never,
    });
    await writer.publishTicketGrant({
      runId: 'run-1',
      tickets: 2,
      gameId: 'test',
    } as never);
    expectPreserved(relay.published[0]);
    const ticket = relay.published[0].tags.find(
      ([n, a]) => n === 'a' && a === ARCADE_TICKET_ADDRESS,
    );
    expect(ticket?.[3]).toBe('2');
  });
});
