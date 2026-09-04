/**
 * F-01: ambiguous Coin spends must reconcile before a retry can debit again.
 *
 * The defect: both spend surfaces minted a fresh random opId per attempt, so
 * after a publish timeout (recorded `ambiguous`: the event MAY have landed)
 * a retry was an INDEPENDENT operation: if the original landed, the retry
 * debited a second time. The fix is the spend-intent identity
 * (`src/lib/coin-spend-intent.ts`): retrying the same logical purchase reuses
 * the same wallet opId, and the wallet's in-lock ledger check + read-only
 * reconciliation turn the retry into `already-applied` or `blocked`: never a
 * second debit until the previous operation is resolved.
 *
 * These tests drive the same open-intent → spend → close-on-applied sequence
 * the purchase hooks run, against a fake relay that can accept a publish AND
 * still time out, the exact shape of the real defect. Assertions are about
 * balances and item quantities, not call counts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  createCoinWallet,
  mintCoinOpId,
  CoinWalletError,
  type CoinWalletNostr,
  type CoinMutationOutcome,
} from './coin-wallet';
import { BLOBBI_COIN_ADDRESS } from './coin';
import {
  clearCoinOps,
  persistCoinOp,
  readCoinOp,
  unresolvedCoinOps,
} from '@/lib/coin-op-ledger';
import {
  clearSpendIntents,
  closeSpendIntent,
  openSpendIntent,
  openSpendIntentsFor,
} from '@/lib/coin-spend-intent';

const PUBKEY = 'f'.repeat(64);
const APPLE = `31632:${'a'.repeat(64)}:blobbi:food:apple`;

function inventoryEvent(
  coinQuantity: number,
  createdAt: number,
  extraItems: readonly { address: string; quantity: number }[] = [],
): NostrEvent {
  const tags: string[][] = [['d', 'blobbi:island']];
  if (coinQuantity > 0) {
    tags.push(['a', BLOBBI_COIN_ADDRESS, '', String(coinQuantity)]);
  }
  for (const item of extraItems) {
    tags.push(['a', item.address, '', String(item.quantity)]);
  }
  return {
    id: `event-${createdAt}`,
    pubkey: PUBKEY,
    created_at: createdAt,
    kind: 31633,
    tags,
    content: '',
    sig: 'sig',
  };
}

type PublishBehavior = 'ok' | 'timeout' | 'timeout-landed' | 'error';

/**
 * A fake relay. `timeout-landed` is the F-01 shape: the relay ACCEPTS and
 * stores the event, but the acknowledgement never arrives in time.
 */
function makeRelay(initial: NostrEvent | null) {
  let stored = initial;
  const published: NostrEvent[] = [];
  let publishBehavior: PublishBehavior = 'ok';
  let queryBehavior: 'ok' | 'unreachable' = 'ok';

  const nostr: CoinWalletNostr = {
    query: async () => {
      if (queryBehavior === 'unreachable') throw new Error('relay unreachable');
      return stored ? [stored] : [];
    },
    event: async (event) => {
      if (publishBehavior === 'timeout') {
        const error = new Error('timed out');
        error.name = 'TimeoutError';
        throw error;
      }
      if (publishBehavior === 'timeout-landed') {
        stored = event;
        published.push(event);
        const error = new Error('timed out');
        error.name = 'TimeoutError';
        throw error;
      }
      if (publishBehavior === 'error') throw new Error('relay exploded');
      published.push(event);
      stored = event;
    },
  };
  return {
    nostr,
    published,
    setPublishBehavior: (behavior: PublishBehavior) => {
      publishBehavior = behavior;
    },
    setQueryBehavior: (behavior: 'ok' | 'unreachable') => {
      queryBehavior = behavior;
    },
    setStored: (event: NostrEvent | null) => {
      stored = event;
    },
    getStored: () => stored,
  };
}

function makeSigner() {
  let sequence = 0;
  return {
    signEvent: vi.fn(async (template: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
      ...template,
      id: `signed-${template.created_at}-${(sequence += 1)}`,
      pubkey: PUBKEY,
      sig: 'sig',
    })),
  };
}

/** A fresh wallet instance, creating a second one models a reload. */
function makeWallet(relay: ReturnType<typeof makeRelay>, nowMs = 1_700_000_000_000) {
  const signer = makeSigner();
  return createCoinWallet({
    nostr: relay.nostr,
    user: { pubkey: PUBKEY, signer } as never,
    now: () => nowMs,
  });
}

function quantityOf(event: NostrEvent | null, address: string): number {
  const tag = event?.tags.find(([name, addr]) => name === 'a' && addr === address);
  return tag ? Number(tag[3]) : 0;
}

const CART = [{ address: APPLE, amount: 2 }] as const;
const CART_COST = 20;

/** The exact sequence the purchase hooks run, minus React. */
async function confirmShopPurchase(
  wallet: ReturnType<typeof createCoinWallet>,
): Promise<{ outcome: CoinMutationOutcome; opId: string }> {
  const opened = openSpendIntent(
    PUBKEY,
    { surface: 'shop-purchase', amount: CART_COST, lines: [...CART] },
    () => mintCoinOpId('shop-purchase'),
  );
  expect(opened).not.toBeNull();
  const opId = opened!.intent.intentId;
  const outcome = await wallet.spendCoins({
    opId,
    amount: CART_COST,
    label: 'shop-purchase',
    grantLines: [...CART],
  });
  if (outcome.status === 'applied' || outcome.status === 'already-applied') {
    closeSpendIntent(PUBKEY, 'shop-purchase', opId);
  }
  return { outcome, opId };
}

beforeEach(() => {
  clearCoinOps();
  clearSpendIntents();
});
afterEach(() => {
  clearCoinOps();
  clearSpendIntents();
  vi.restoreAllMocks();
});

describe('a spend that timed out but LANDED cannot debit twice', () => {
  it('retry without reload resolves as already-applied: one debit, one grant', async () => {
    const relay = makeRelay(inventoryEvent(100, 1_000));
    const wallet = makeWallet(relay);

    relay.setPublishBehavior('timeout-landed');
    const first = await confirmShopPurchase(wallet);
    expect(first.outcome.status).toBe('ambiguous');

    // The player retries the same basket. Same intent, same opId, and the
    // wallet reconciles in-lock instead of publishing a second debit.
    relay.setPublishBehavior('ok');
    const second = await confirmShopPurchase(wallet);
    expect(second.opId).toBe(first.opId);
    expect(second.outcome.status).toBe('already-applied');

    // Balance and items reflect exactly ONE purchase.
    expect(quantityOf(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(80);
    expect(quantityOf(relay.getStored(), APPLE)).toBe(2);
    expect(relay.published).toHaveLength(1);
  });

  it('retry after a RELOAD (fresh wallet, intents re-read from storage) is still one debit', async () => {
    const relay = makeRelay(inventoryEvent(100, 1_000));

    relay.setPublishBehavior('timeout-landed');
    const first = await confirmShopPurchase(makeWallet(relay));
    expect(first.outcome.status).toBe('ambiguous');

    // "Reload": everything in memory is gone; the intent and the ledger are
    // durable, and a brand-new wallet instance reads them back.
    relay.setPublishBehavior('ok');
    const second = await confirmShopPurchase(makeWallet(relay));
    expect(second.opId).toBe(first.opId);
    expect(second.outcome.status).toBe('already-applied');
    expect(quantityOf(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(80);
    expect(quantityOf(relay.getStored(), APPLE)).toBe(2);
  });

  it('the same basket bought again AFTER definitive completion is a genuinely new debit', async () => {
    const relay = makeRelay(inventoryEvent(100, 1_000));
    const wallet = makeWallet(relay);

    const first = await confirmShopPurchase(wallet);
    expect(first.outcome.status).toBe('applied');

    // Intentional second purchase of the identical basket: the intent was
    // closed, so this is a fresh operation and a real second charge.
    const second = await confirmShopPurchase(wallet);
    expect(second.opId).not.toBe(first.opId);
    expect(second.outcome.status).toBe('applied');
    expect(quantityOf(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(60);
    expect(quantityOf(relay.getStored(), APPLE)).toBe(4);
  });
});

describe('read-only recovery (reconcileOp) semantics', () => {
  it('proves a landed spend by EVENT ID, even when the balance alone is inconclusive', async () => {
    const relay = makeRelay(inventoryEvent(100, 1_000));
    const wallet = makeWallet(relay);

    relay.setPublishBehavior('timeout-landed');
    const { opId } = await confirmShopPurchase(wallet);

    // A foreign write (another device) lands ON TOP of the spend, moving the
    // balance so the balance-delta heuristic can no longer match…
    const landed = relay.getStored()!;
    relay.setStored({
      ...inventoryEvent(quantityOf(landed, BLOBBI_COIN_ADDRESS) + 7, landed.created_at + 10, [
        { address: APPLE, quantity: quantityOf(landed, APPLE) },
      ]),
    });
    const inconclusive = await wallet.reconcileOp(opId);
    expect(inconclusive?.status).toBe('ambiguous');

    // …but while the spend's own event IS the newest state, the recorded
    // signed-event id is definitive proof.
    relay.setStored(landed);
    const reconciled = await wallet.reconcileOp(opId);
    expect(reconciled?.status).toBe('applied');
    expect(reconciled?.note).toBe('reconciled-by-event-id');
  });

  it('never converts an unprovable spend into failure or success; it stays ambiguous and blocks', async () => {
    const relay = makeRelay(inventoryEvent(100, 1_000));
    const wallet = makeWallet(relay);

    // Timeout where the event did NOT land: the relay still shows the base.
    relay.setPublishBehavior('timeout');
    const first = await confirmShopPurchase(wallet);
    expect(first.outcome.status).toBe('ambiguous');

    // Even though the base event is still current, non-publication cannot be
    // proven (the event could still be in flight): no downgrade to `failed`.
    const record = await wallet.reconcileOp(first.opId);
    expect(record?.status).toBe('ambiguous');

    // A retry therefore publishes NOTHING new: it is blocked, not re-debited.
    relay.setPublishBehavior('ok');
    const second = await confirmShopPurchase(wallet);
    expect(second.opId).toBe(first.opId);
    expect(second.outcome.status).toBe('blocked');
    expect(quantityOf(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(100);
    expect(quantityOf(relay.getStored(), APPLE)).toBe(0);
  });

  it('an unreachable relay during recovery leaves the operation exactly as it was', async () => {
    const relay = makeRelay(inventoryEvent(100, 1_000));
    const wallet = makeWallet(relay);

    relay.setPublishBehavior('timeout-landed');
    const { opId } = await confirmShopPurchase(wallet);

    relay.setQueryBehavior('unreachable');
    await expect(wallet.reconcileOp(opId)).rejects.toThrow(CoinWalletError);
    expect(readCoinOp(PUBKEY, opId)?.status).toBe('ambiguous');
    expect(unresolvedCoinOps(PUBKEY).map((r) => r.opId)).toContain(opId);

    // Once the relay is back, the same recovery proves the spend landed.
    relay.setQueryBehavior('ok');
    const reconciled = await wallet.reconcileOp(opId);
    expect(reconciled?.status).toBe('applied');
  });

  it('records without event-id evidence still reconcile by the balance delta', async () => {
    const relay = makeRelay(inventoryEvent(100, 1_000));
    const wallet = makeWallet(relay);

    relay.setPublishBehavior('timeout-landed');
    const { opId } = await confirmShopPurchase(wallet);

    // Simulate a pre-upgrade record: strip the event-id evidence.
    const stored = readCoinOp(PUBKEY, opId)!;
    expect(stored.publishedEventId).toBeTruthy();
    clearCoinOps(PUBKEY);
    persistCoinOp(PUBKEY, { ...stored, publishedEventId: null });

    const reconciled = await wallet.reconcileOp(opId);
    expect(reconciled?.status).toBe('applied');
    expect(reconciled?.note).toBe('reconciled-by-read-back');
  });
});

describe('intent bookkeeping around the wallet', () => {
  it('an ambiguous purchase keeps its intent open; completion closes it', async () => {
    const relay = makeRelay(inventoryEvent(100, 1_000));
    const wallet = makeWallet(relay);

    relay.setPublishBehavior('timeout-landed');
    await confirmShopPurchase(wallet);
    expect(openSpendIntentsFor(PUBKEY, 'shop-purchase')).toHaveLength(1);

    relay.setPublishBehavior('ok');
    await confirmShopPurchase(wallet);
    expect(openSpendIntentsFor(PUBKEY, 'shop-purchase')).toHaveLength(0);
  });

  it('a DIFFERENT basket while one is unresolved is its own new operation', async () => {
    const relay = makeRelay(inventoryEvent(100, 1_000));
    const wallet = makeWallet(relay);

    relay.setPublishBehavior('timeout');
    const first = await confirmShopPurchase(wallet);
    expect(first.outcome.status).toBe('ambiguous');

    relay.setPublishBehavior('ok');
    const opened = openSpendIntent(
      PUBKEY,
      { surface: 'shop-purchase', amount: 5, lines: [{ address: APPLE, amount: 1 }] },
      () => mintCoinOpId('shop-purchase'),
    );
    expect(opened!.reused).toBe(false);
    expect(opened!.intent.intentId).not.toBe(first.opId);
    const outcome = await wallet.spendCoins({
      opId: opened!.intent.intentId,
      amount: 5,
      label: 'shop-purchase',
      grantLines: [{ address: APPLE, amount: 1 }],
    });
    expect(outcome.status).toBe('applied');
    // The unresolved first attempt is still tracked, untouched.
    expect(readCoinOp(PUBKEY, first.opId)?.status).toBe('ambiguous');
  });
});
