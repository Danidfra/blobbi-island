/**
 * Coin wallet — the currency-grade guarantees, proven against a fake relay.
 *
 * The scenarios mirror the defects the Coin audit catalogued: stale-base
 * clobbering, timeout-as-success, additive retries after ambiguity, same-tab
 * double spends, tied created_at, and publishes without a durable record.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  createCoinWallet,
  mintCoinOpId,
  CoinWalletError,
  type CoinWalletNostr,
} from './coin-wallet';
import { BLOBBI_COIN_ADDRESS, MAX_COIN_BALANCE } from './coin';
import { clearCoinOps, readCoinOp } from '@/lib/coin-op-ledger';

const PUBKEY = 'f'.repeat(64);
const OTHER_ADDRESS = `31632:${'a'.repeat(64)}:blobbi:food:apple`;

function inventoryEvent(coinQuantity: number, createdAt: number): NostrEvent {
  const tags: string[][] = [
    ['d', 'blobbi:island'],
    ['a', OTHER_ADDRESS, '', '7'],
  ];
  if (coinQuantity > 0) {
    tags.push(['a', BLOBBI_COIN_ADDRESS, '', String(coinQuantity)]);
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

/** A fake relay: serves the latest stored event, records publishes. */
function makeRelay(initial: NostrEvent | null) {
  let stored = initial;
  const published: NostrEvent[] = [];
  let publishBehavior: 'ok' | 'timeout' | 'error' | 'ok-stale-readback' = 'ok';

  const nostr: CoinWalletNostr = {
    query: async () => (stored ? [stored] : []),
    event: async (event) => {
      if (publishBehavior === 'timeout') {
        const error = new Error('timed out');
        error.name = 'TimeoutError';
        throw error;
      }
      if (publishBehavior === 'error') {
        throw new Error('relay exploded');
      }
      published.push(event);
      if (publishBehavior === 'ok') {
        stored = event; // the relay reflects the write on the next read
      }
      // 'ok-stale-readback': accepted, but reads keep returning the old event.
    },
  };
  return {
    nostr,
    published,
    setPublishBehavior: (behavior: typeof publishBehavior) => {
      publishBehavior = behavior;
    },
    setStored: (event: NostrEvent | null) => {
      stored = event;
    },
    getStored: () => stored,
  };
}

function makeSigner() {
  return {
    signEvent: vi.fn(async (template: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
      ...template,
      id: `signed-${template.created_at}`,
      pubkey: PUBKEY,
      sig: 'sig',
    })),
  };
}

function makeWallet(relay: ReturnType<typeof makeRelay>, nowMs = 1_700_000_000_000) {
  const signer = makeSigner();
  const wallet = createCoinWallet({
    nostr: relay.nostr,
    user: { pubkey: PUBKEY, signer } as never,
    now: () => nowMs,
  });
  return { wallet, signer };
}

function coinQuantityOf(event: NostrEvent): number {
  const tag = event.tags.find(([name, addr]) => name === 'a' && addr === BLOBBI_COIN_ADDRESS);
  return tag ? Number(tag[3]) : 0;
}

beforeEach(() => clearCoinOps());
afterEach(() => {
  clearCoinOps();
  vi.restoreAllMocks();
});

describe('grants', () => {
  it('publishes exactly one replacement event, preserves unrelated entries, verifies', async () => {
    const relay = makeRelay(inventoryEvent(10, 1_000));
    const { wallet } = makeWallet(relay);

    const outcome = await wallet.grantCoins({ opId: 'op-1', amount: 4, label: 'test' });

    expect(outcome).toEqual({ status: 'applied', balance: 14, verified: true });
    expect(relay.published).toHaveLength(1);
    expect(coinQuantityOf(relay.published[0])).toBe(14);
    // Unrelated entry rides through untouched.
    const other = relay.published[0].tags.find(
      ([name, addr]) => name === 'a' && addr === OTHER_ADDRESS,
    );
    expect(other?.[3]).toBe('7');
    expect(readCoinOp(PUBKEY, 'op-1')?.status).toBe('applied');
  });

  it('stamps a created_at strictly above the previous event (monotonic)', async () => {
    // Previous event is "in the future" relative to the injected clock.
    const previousCreatedAt = 2_000_000_000;
    const relay = makeRelay(inventoryEvent(1, previousCreatedAt));
    const { wallet, signer } = makeWallet(relay, 1_700_000_000_000);

    await wallet.grantCoins({ opId: 'op-mono', amount: 1, label: 'test' });

    const signedWith = signer.signEvent.mock.calls[0][0] as { created_at: number };
    expect(signedWith.created_at).toBe(previousCreatedAt + 1);
  });

  it('is exactly-once per opId: a repeat is an idempotent no-publish success', async () => {
    const relay = makeRelay(inventoryEvent(0, 1_000));
    const { wallet } = makeWallet(relay);

    await wallet.grantCoins({ opId: 'op-once', amount: 5, label: 'test' });
    const second = await wallet.grantCoins({ opId: 'op-once', amount: 5, label: 'test' });

    expect(second).toEqual({ status: 'already-applied' });
    expect(relay.published).toHaveLength(1);
  });

  it('rejects a grant that would exceed the application balance ceiling', async () => {
    const relay = makeRelay(inventoryEvent(MAX_COIN_BALANCE - 1, 1_000));
    const { wallet } = makeWallet(relay);
    await expect(
      wallet.grantCoins({ opId: 'op-cap', amount: 2, label: 'test' }),
    ).rejects.toMatchObject({ reason: 'balance-cap' });
    expect(relay.published).toHaveLength(0);
  });
});

describe('amount validation', () => {
  const relay = () => makeRelay(inventoryEvent(10, 1_000));

  it.each([
    [0, 'zero'],
    [-3, 'negative'],
    [1.5, 'fraction'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'infinity'],
    [MAX_COIN_BALANCE + 1, 'over-max'],
    [Number.MAX_SAFE_INTEGER + 2, 'unsafe'],
  ])('rejects %s (%s) without publishing', async (amount) => {
    const r = relay();
    const { wallet } = makeWallet(r);
    await expect(
      wallet.grantCoins({ opId: mintCoinOpId('bad'), amount, label: 'test' }),
    ).rejects.toMatchObject({ reason: 'invalid-amount' });
    expect(r.published).toHaveLength(0);
  });
});

describe('spends', () => {
  it('spends against a FRESH balance and preserves unrelated entries', async () => {
    const relay = makeRelay(inventoryEvent(20, 1_000));
    const { wallet } = makeWallet(relay);

    const outcome = await wallet.spendCoins({ opId: 'spend-1', amount: 6, label: 'shop' });

    expect(outcome).toEqual({ status: 'applied', balance: 14, verified: true });
    expect(coinQuantityOf(relay.published[0])).toBe(14);
  });

  it('rejects insufficient funds before any record or publish', async () => {
    const relay = makeRelay(inventoryEvent(3, 1_000));
    const { wallet } = makeWallet(relay);
    await expect(
      wallet.spendCoins({ opId: 'spend-poor', amount: 4, label: 'shop' }),
    ).rejects.toMatchObject({ reason: 'insufficient-funds' });
    expect(relay.published).toHaveLength(0);
    expect(readCoinOp(PUBKEY, 'spend-poor')).toBeNull();
  });

  it('two same-tab concurrent spends cannot both succeed on one stale base', async () => {
    const relay = makeRelay(inventoryEvent(5, 1_000));
    const { wallet } = makeWallet(relay);

    const [first, second] = await Promise.allSettled([
      wallet.spendCoins({ opId: 'race-a', amount: 3, label: 'shop' }),
      wallet.spendCoins({ opId: 'race-b', amount: 3, label: 'shop' }),
    ]);

    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    expect((second as PromiseRejectedResult).reason).toMatchObject({
      reason: 'insufficient-funds',
    });
    expect(relay.published).toHaveLength(1);
  });

  it('spending exactly to zero removes the coin entry but keeps the others', async () => {
    const relay = makeRelay(inventoryEvent(4, 1_000));
    const { wallet } = makeWallet(relay);
    await wallet.spendCoins({ opId: 'spend-all', amount: 4, label: 'shop' });
    const published = relay.published[0];
    expect(coinQuantityOf(published)).toBe(0);
    expect(
      published.tags.some(([name, addr]) => name === 'a' && addr === OTHER_ADDRESS),
    ).toBe(true);
  });
});

describe('strict publish and ambiguity', () => {
  it('a publish timeout is AMBIGUOUS, not success, and blocks blind retries', async () => {
    const relay = makeRelay(inventoryEvent(10, 1_000));
    relay.setPublishBehavior('timeout');
    const { wallet } = makeWallet(relay);

    const outcome = await wallet.grantCoins({ opId: 'op-tmo', amount: 4, label: 'test' });
    expect(outcome).toEqual({ status: 'ambiguous', reason: 'publish-timeout' });
    expect(readCoinOp(PUBKEY, 'op-tmo')?.status).toBe('ambiguous');

    // The relay did NOT land it; a retry reconciles, finds the old balance,
    // and stays blocked rather than publishing a second additive mutation.
    relay.setPublishBehavior('ok');
    const retry = await wallet.grantCoins({ opId: 'op-tmo', amount: 4, label: 'test' });
    expect(retry).toEqual({ status: 'blocked', blockedBy: 'ambiguous' });
    expect(relay.published).toHaveLength(0);
  });

  it('an ambiguous op whose publish actually LANDED reconciles to applied', async () => {
    const relay = makeRelay(inventoryEvent(10, 1_000));
    relay.setPublishBehavior('timeout');
    const { wallet } = makeWallet(relay);

    await wallet.grantCoins({ opId: 'op-landed', amount: 4, label: 'test' });
    // Simulate: the timed-out publish actually reached the relay.
    relay.setStored(inventoryEvent(14, 2_000));

    const retry = await wallet.grantCoins({ opId: 'op-landed', amount: 4, label: 'test' });
    expect(retry).toEqual({ status: 'already-applied' });
    expect(readCoinOp(PUBKEY, 'op-landed')?.status).toBe('applied');
    expect(relay.published).toHaveLength(0); // reconciliation is read-only
  });

  it('an unclassifiable publish error is ambiguous too — never provably unsent', async () => {
    const relay = makeRelay(inventoryEvent(10, 1_000));
    relay.setPublishBehavior('error');
    const { wallet } = makeWallet(relay);
    const outcome = await wallet.grantCoins({ opId: 'op-err', amount: 4, label: 'test' });
    expect(outcome).toEqual({ status: 'ambiguous', reason: 'publish-unknown' });
  });

  it('a read-back that cannot see the write stays applied but unverified', async () => {
    const relay = makeRelay(inventoryEvent(10, 1_000));
    relay.setPublishBehavior('ok-stale-readback');
    const { wallet } = makeWallet(relay);
    const outcome = await wallet.grantCoins({ opId: 'op-stale', amount: 4, label: 'test' });
    expect(outcome).toEqual({ status: 'applied', balance: 14, verified: false });
    expect(readCoinOp(PUBKEY, 'op-stale')?.note).toBe('read-back-unverified');
  });

  it('a signer refusal is provably-unsent: failed, and retryable', async () => {
    const relay = makeRelay(inventoryEvent(10, 1_000));
    const signer = {
      signEvent: vi.fn().mockRejectedValueOnce(new Error('nope')),
    };
    const wallet = createCoinWallet({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer } as never,
      now: () => 1_700_000_000_000,
    });

    await expect(
      wallet.grantCoins({ opId: 'op-sign', amount: 4, label: 'test' }),
    ).rejects.toMatchObject({ reason: 'sign-failed' });
    expect(readCoinOp(PUBKEY, 'op-sign')?.status).toBe('failed');

    // The same opId may retry after a provably-unsent failure.
    signer.signEvent.mockImplementation(async (template: never) => ({
      ...(template as object),
      id: 'signed',
      pubkey: PUBKEY,
      sig: 'sig',
    }));
    const retry = await wallet.grantCoins({ opId: 'op-sign', amount: 4, label: 'test' });
    expect(retry).toMatchObject({ status: 'applied' });
  });

  it('refuses to publish when the durable record cannot be written', async () => {
    const relay = makeRelay(inventoryEvent(10, 1_000));
    const { wallet } = makeWallet(relay);
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota');
      });

    await expect(
      wallet.grantCoins({ opId: 'op-noledger', amount: 4, label: 'test' }),
    ).rejects.toMatchObject({ reason: 'ledger-unavailable' });
    expect(relay.published).toHaveLength(0);
    setItem.mockRestore();
  });
});

describe('readBalance', () => {
  it('returns the fresh quantity and 0 for an empty inventory', async () => {
    const relay = makeRelay(inventoryEvent(42, 1_000));
    const { wallet } = makeWallet(relay);
    expect(await wallet.readBalance()).toBe(42);

    relay.setStored(null);
    expect(await wallet.readBalance()).toBe(0);
  });

  it('rejects a stored balance outside the valid range instead of clamping', async () => {
    const relay = makeRelay(inventoryEvent(MAX_COIN_BALANCE + 5, 1_000));
    const { wallet } = makeWallet(relay);
    await expect(wallet.readBalance()).rejects.toBeInstanceOf(CoinWalletError);
  });
});
