/**
 * Spend-intent identity — the durable "same logical purchase" record.
 *
 * The contract under test: retrying an unresolved purchase reuses ONE
 * identity; a closed purchase never leaks its identity to a later identical
 * purchase; possibly-published intents are never garbage-collected; and the
 * two surfaces live in storages matching their delivery lifetime
 * (shop → localStorage, pass → sessionStorage).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  APPLIED_INTENT_RETENTION_MS,
  clearSpendIntents,
  closeSpendIntent,
  openSpendIntent,
  openSpendIntentsFor,
} from './coin-spend-intent';
import { clearCoinOps, persistCoinOp, type CoinOpRecord } from './coin-op-ledger';

const PUBKEY = 'a'.repeat(64);
const OTHER_PUBKEY = 'b'.repeat(64);
const APPLE = `31632:${'c'.repeat(64)}:blobbi:food:apple`;
const PIZZA = `31632:${'c'.repeat(64)}:blobbi:food:pizza`;

let minted = 0;
const mint = () => `shop-purchase:test-${(minted += 1)}`;

function opRecord(opId: string, status: CoinOpRecord['status']): CoinOpRecord {
  return {
    opId,
    kind: 'spend',
    amount: 10,
    status,
    label: 'shop-purchase',
    balanceBefore: 100,
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(() => {
  minted = 0;
  clearSpendIntents();
  clearCoinOps();
});
afterEach(() => {
  clearSpendIntents();
  clearCoinOps();
});

describe('one identity per logical purchase', () => {
  it('the same payload reuses the open intent; a different payload gets a fresh one', () => {
    const cart = { surface: 'shop-purchase' as const, amount: 20, lines: [{ address: APPLE, amount: 2 }] };
    const first = openSpendIntent(PUBKEY, cart, mint)!;
    expect(first.reused).toBe(false);

    const retry = openSpendIntent(PUBKEY, cart, mint)!;
    expect(retry.reused).toBe(true);
    expect(retry.intent.intentId).toBe(first.intent.intentId);

    const other = openSpendIntent(
      PUBKEY,
      { surface: 'shop-purchase', amount: 5, lines: [{ address: PIZZA, amount: 1 }] },
      mint,
    )!;
    expect(other.reused).toBe(false);
    expect(other.intent.intentId).not.toBe(first.intent.intentId);
  });

  it('line ORDER does not change the identity; line CONTENT does', () => {
    const twoLines = [
      { address: PIZZA, amount: 1 },
      { address: APPLE, amount: 2 },
    ];
    const first = openSpendIntent(
      PUBKEY,
      { surface: 'shop-purchase', amount: 25, lines: twoLines },
      mint,
    )!;
    const reordered = openSpendIntent(
      PUBKEY,
      { surface: 'shop-purchase', amount: 25, lines: [...twoLines].reverse() },
      mint,
    )!;
    expect(reordered.intent.intentId).toBe(first.intent.intentId);

    const differentQuantity = openSpendIntent(
      PUBKEY,
      { surface: 'shop-purchase', amount: 25, lines: [{ address: PIZZA, amount: 1 }, { address: APPLE, amount: 3 }] },
      mint,
    )!;
    expect(differentQuantity.intent.intentId).not.toBe(first.intent.intentId);
  });

  it('closing the intent gives the next identical purchase a fresh identity', () => {
    const cart = { surface: 'shop-purchase' as const, amount: 20, lines: [{ address: APPLE, amount: 2 }] };
    const first = openSpendIntent(PUBKEY, cart, mint)!;
    closeSpendIntent(PUBKEY, 'shop-purchase', first.intent.intentId);

    const second = openSpendIntent(PUBKEY, cart, mint)!;
    expect(second.reused).toBe(false);
    expect(second.intent.intentId).not.toBe(first.intent.intentId);
  });

  it('intents do not collide across pubkeys', () => {
    const cart = { surface: 'shop-purchase' as const, amount: 20, lines: [{ address: APPLE, amount: 2 }] };
    const mine = openSpendIntent(PUBKEY, cart, mint)!;
    const theirs = openSpendIntent(OTHER_PUBKEY, cart, mint)!;
    expect(theirs.intent.intentId).not.toBe(mine.intent.intentId);
    expect(openSpendIntentsFor(PUBKEY, 'shop-purchase')).toHaveLength(1);
    expect(openSpendIntentsFor(OTHER_PUBKEY, 'shop-purchase')).toHaveLength(1);
  });
});

describe('durability matches delivery lifetime', () => {
  it('an intent survives a reload simulation (fresh read from storage)', () => {
    const cart = { surface: 'shop-purchase' as const, amount: 20, lines: [{ address: APPLE, amount: 2 }] };
    const first = openSpendIntent(PUBKEY, cart, mint)!;
    // Nothing in memory carries over in this module — every call re-reads
    // storage, so this IS the reload behavior.
    const after = openSpendIntentsFor(PUBKEY, 'shop-purchase');
    expect(after.map((i) => i.intentId)).toEqual([first.intent.intentId]);
  });

  it('shop intents live in localStorage, pass intents in sessionStorage', () => {
    openSpendIntent(PUBKEY, { surface: 'shop-purchase', amount: 20, lines: [{ address: APPLE, amount: 2 }] }, mint);
    openSpendIntent(PUBKEY, { surface: 'arcade-pass', amount: 20 }, () => 'arcade-pass:test-1');

    expect(localStorage.getItem('blobbi:coin:spend-intents')).toContain('shop-purchase');
    expect(localStorage.getItem('blobbi:coin:spend-intents')).not.toContain('arcade-pass');
    expect(sessionStorage.getItem('blobbi:coin:spend-intents:session')).toContain('arcade-pass');
  });
});

describe('garbage collection is bounded and never drops a possibly-published intent', () => {
  it('provably-unsent stale intents are collected when a new purchase opens', () => {
    // No coin-op record at all: the attempt never reached the wallet.
    openSpendIntent(PUBKEY, { surface: 'shop-purchase', amount: 5, lines: [{ address: PIZZA, amount: 1 }] }, mint);
    // A different purchase triggers GC of the abandoned one.
    openSpendIntent(PUBKEY, { surface: 'shop-purchase', amount: 20, lines: [{ address: APPLE, amount: 2 }] }, mint);

    const open = openSpendIntentsFor(PUBKEY, 'shop-purchase');
    expect(open).toHaveLength(1);
    expect(open[0].lines[0].address).toBe(APPLE);
  });

  it('publishing/ambiguous intents survive GC — each is a real open question', () => {
    const first = openSpendIntent(PUBKEY, { surface: 'shop-purchase', amount: 5, lines: [{ address: PIZZA, amount: 1 }] }, mint)!;
    persistCoinOp(PUBKEY, opRecord(first.intent.intentId, 'ambiguous'));

    openSpendIntent(PUBKEY, { surface: 'shop-purchase', amount: 20, lines: [{ address: APPLE, amount: 2 }] }, mint);
    const open = openSpendIntentsFor(PUBKEY, 'shop-purchase');
    expect(open.map((i) => i.intentId)).toContain(first.intent.intentId);
    expect(open).toHaveLength(2);
  });

  it('an applied-but-never-closed intent is only pruned after the retention window', () => {
    let clock = 1_000_000;
    const now = () => clock;
    const cart = { surface: 'shop-purchase' as const, amount: 20, lines: [{ address: APPLE, amount: 2 }] };
    const first = openSpendIntent(PUBKEY, cart, mint, now)!;
    persistCoinOp(PUBKEY, opRecord(first.intent.intentId, 'applied'));

    // Inside the window: an identical purchase still resolves to the SAME
    // intent (the flow will see already-applied, not a second charge).
    clock += 1000;
    const retry = openSpendIntent(PUBKEY, cart, mint, now)!;
    expect(retry.reused).toBe(true);

    // After the window: the identical cart is a genuinely new purchase —
    // the aged applied intent is pruned rather than captured.
    clock += APPLIED_INTENT_RETENTION_MS + 1;
    const fresh = openSpendIntent(PUBKEY, cart, mint, now)!;
    expect(fresh.reused).toBe(false);
    expect(fresh.intent.intentId).not.toBe(first.intent.intentId);
  });
});
