/**
 * The Coin DELTA invariant, the regression suite for the Mine overwrite bug.
 *
 * ```
 *   grantCoins(+N)  ⇒  final = authoritativeCurrentBalance + N
 *   spendCoins(N)   ⇒  final = authoritativeCurrentBalance - N
 * ```
 *
 * The reported defect was a 20-Coin Mine reward REPLACING a 100-Coin balance
 * instead of adding to it. The arithmetic was never wrong: the BASE was. A
 * read that resolved empty (a relay that does not carry the inventory) was
 * used as a publish base, and because kind:31633 is replaceable, the resulting
 * event did not lose the delta; it replaced the player's entire inventory
 * with "20 Coins".
 *
 * Everything here therefore drives the REAL wallet against events built by the
 * REAL canonical builder. A test that hand-writes tags, or that asserts on a
 * fake arithmetic helper, would have passed throughout the bug.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { createCoinWallet, type CoinWalletNostr } from './coin-wallet';
import { BLOBBI_COIN_ADDRESS } from './coin';
import { ARCADE_TICKET_ADDRESS } from './arcade-reward-writer';
import { applyMutation, buildInventoryTemplate, getQuantity } from './useInventoryMutation';
import { buildEmptyInventory } from './useIslandInventory';
import { parseInventoryEvent } from './protocol-adapter';
import { ISLAND_ALLOCATION_MARKER } from './economy-entry';
import { clearCoinOps } from '@/lib/coin-op-ledger';

const PUBKEY = 'f'.repeat(64);
const APPLE = `31632:${'a'.repeat(64)}:blobbi:food:apple`;

/** A REAL canonical inventory event, exactly as production publishes one. */
function realInventoryEvent(
  entries: readonly { address: string; amount: number }[],
  createdAt: number,
): NostrEvent {
  let inventory = buildEmptyInventory(PUBKEY);
  for (const entry of entries) {
    inventory = applyMutation(inventory, {
      type: 'add',
      address: entry.address,
      amount: entry.amount,
    });
  }
  // The allocation marker rides on every post-economy-entry inventory.
  const template = buildInventoryTemplate(inventory, {
    extraTags: [ISLAND_ALLOCATION_MARKER],
  });
  return {
    ...template,
    content: template.content ?? '',
    id: `evt-${createdAt}`,
    pubkey: PUBKEY,
    created_at: createdAt,
    sig: 'sig',
  } as NostrEvent;
}

interface RelayOptions {
  /** Serve N resolved-EMPTY answers first, despite holding an event. */
  emptyAnswers?: number;
  failPublish?: boolean;
}

function makeRelay(initial: NostrEvent | null, options: RelayOptions = {}) {
  let stored = initial;
  let emptyAnswers = options.emptyAnswers ?? 0;
  const published: NostrEvent[] = [];
  const nostr: CoinWalletNostr = {
    query: async () => {
      if (emptyAnswers > 0) {
        emptyAnswers -= 1;
        return [];
      }
      return stored ? [stored] : [];
    },
    event: async (event) => {
      if (options.failPublish) throw new Error('relay refused');
      published.push(event);
      // Newest-wins, exactly like a relay holding a replaceable event.
      if (!stored || event.created_at >= stored.created_at) stored = event;
    },
  };
  return { nostr, published, getStored: () => stored };
}

function makeWallet(relay: ReturnType<typeof makeRelay>, nowMs = 1_700_000_000_000) {
  return createCoinWallet({
    nostr: relay.nostr,
    user: {
      pubkey: PUBKEY,
      signer: {
        signEvent: vi.fn(async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
          ...t,
          id: `signed-${t.created_at}`,
          pubkey: PUBKEY,
          sig: 'sig',
        })),
      },
    } as never,
    now: () => nowMs,
  });
}

function quantityIn(event: NostrEvent | null, address: string): number {
  if (!event) return -1;
  const parsed = parseInventoryEvent(event);
  return parsed ? getQuantity(parsed, address) : -1;
}

beforeEach(() => clearCoinOps());
afterEach(() => {
  clearCoinOps();
  vi.restoreAllMocks();
});

describe('grantCoins adds a delta to the authoritative balance', () => {
  it('0 + 20 = 20 (a genuinely empty inventory still bootstraps)', async () => {
    const relay = makeRelay(null);
    const wallet = makeWallet(relay);

    const outcome = await wallet.grantCoins({ opId: 'op', amount: 20, label: 'mine-reward' });

    expect(outcome).toEqual({ status: 'applied', balance: 20, verified: true });
    expect(quantityIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(20);
  });

  it('100 + 20 = 120, the reported Mine case', async () => {
    const relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 100 }], 1_000),
    );
    const wallet = makeWallet(relay);

    const outcome = await wallet.grantCoins({ opId: 'op', amount: 20, label: 'mine-reward' });

    expect(outcome).toEqual({ status: 'applied', balance: 120, verified: true });
    expect(quantityIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(120);
  });

  it('repeated independent rewards accumulate: 100 → +20 → +15 = 135', async () => {
    const relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 100 }], 1_000),
    );
    const wallet = makeWallet(relay);

    await wallet.grantCoins({ opId: 'mine-a', amount: 20, label: 'mine-reward' });
    await wallet.grantCoins({ opId: 'mine-b', amount: 15, label: 'mine-reward' });

    expect(quantityIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(135);
  });

  it('never writes the reward as an absolute replacement', async () => {
    const relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 100 }], 1_000),
    );
    const wallet = makeWallet(relay);

    await wallet.grantCoins({ opId: 'op', amount: 20, label: 'mine-reward' });

    // The published quantity is the SUM, never the operation's amount.
    expect(relay.published).toHaveLength(1);
    expect(quantityIn(relay.published[0], BLOBBI_COIN_ADDRESS)).toBe(120);
    expect(quantityIn(relay.published[0], BLOBBI_COIN_ADDRESS)).not.toBe(20);
  });

  it('preserves Arcade Tickets and unrelated entries', async () => {
    const relay = makeRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 100 },
          { address: ARCADE_TICKET_ADDRESS, amount: 40 },
          { address: APPLE, amount: 7 },
        ],
        1_000,
      ),
    );
    const wallet = makeWallet(relay);

    await wallet.grantCoins({ opId: 'op', amount: 20, label: 'mine-reward' });

    const stored = relay.getStored();
    expect(quantityIn(stored, BLOBBI_COIN_ADDRESS)).toBe(120);
    expect(quantityIn(stored, ARCADE_TICKET_ADDRESS)).toBe(40);
    expect(quantityIn(stored, APPLE)).toBe(7);
    // Unknown/forward-compatible tags ride through untouched.
    expect(stored?.tags).toContainEqual([...ISLAND_ALLOCATION_MARKER]);
  });
});

describe('spendCoins subtracts a delta from the authoritative balance', () => {
  it('100 - 20 = 80', async () => {
    const relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 100 }], 1_000),
    );
    const wallet = makeWallet(relay);

    const outcome = await wallet.spendCoins({ opId: 'op', amount: 20, label: 'shop' });

    expect(outcome).toEqual({ status: 'applied', balance: 80, verified: true });
    expect(quantityIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(80);
  });

  it('refuses to overspend against the authoritative balance', async () => {
    const relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 10 }], 1_000),
    );
    const wallet = makeWallet(relay);

    await expect(
      wallet.spendCoins({ opId: 'op', amount: 20, label: 'shop' }),
    ).rejects.toMatchObject({ reason: 'insufficient-funds' });
    expect(relay.published).toHaveLength(0);
  });
});

describe('a resolved-EMPTY read is never a publish base (the root cause)', () => {
  it('a stale empty answer cannot replace 100 Coins with the 20-Coin reward', async () => {
    const relay = makeRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 100 },
          { address: ARCADE_TICKET_ADDRESS, amount: 40 },
        ],
        1_000,
      ),
      { emptyAnswers: 1 },
    );
    const wallet = makeWallet(relay);

    const outcome = await wallet.grantCoins({ opId: 'op', amount: 20, label: 'mine-reward' });

    expect(outcome).toEqual({ status: 'applied', balance: 120, verified: true });
    expect(quantityIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(120);
    expect(quantityIn(relay.getStored(), ARCADE_TICKET_ADDRESS)).toBe(40);
  });

  it('two agreeing empty answers still allow a genuine first write', async () => {
    const relay = makeRelay(null, { emptyAnswers: 2 });
    const wallet = makeWallet(relay);

    const outcome = await wallet.grantCoins({ opId: 'op', amount: 200, label: 'allocation' });

    expect(outcome).toMatchObject({ status: 'applied', balance: 200 });
  });

  it('an unreadable confirming read publishes NOTHING', async () => {
    let calls = 0;
    const nostr: CoinWalletNostr = {
      query: async () => {
        calls += 1;
        if (calls === 1) return [];
        throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      },
      event: async () => {
        throw new Error('must not publish');
      },
    };
    const wallet = createCoinWallet({
      nostr,
      user: { pubkey: PUBKEY, signer: { signEvent: vi.fn() } } as never,
      now: () => 1_700_000_000_000,
    });

    await expect(
      wallet.grantCoins({ opId: 'op', amount: 20, label: 'mine-reward' }),
    ).rejects.toMatchObject({ reason: 'read-failed' });
  });
});

describe('exactly-once, preserved by the delta fix', () => {
  it('the SAME opId twice applies ONE delta', async () => {
    const relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 100 }], 1_000),
    );
    const wallet = makeWallet(relay);

    const first = await wallet.grantCoins({ opId: 'same', amount: 20, label: 'mine-reward' });
    const second = await wallet.grantCoins({ opId: 'same', amount: 20, label: 'mine-reward' });

    expect(first).toMatchObject({ status: 'applied' });
    expect(second).toEqual({ status: 'already-applied' });
    expect(relay.published).toHaveLength(1);
    expect(quantityIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(120);
  });

  it('DIFFERENT opIds both apply', async () => {
    const relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 100 }], 1_000),
    );
    const wallet = makeWallet(relay);

    await wallet.grantCoins({ opId: 'a', amount: 20, label: 'mine-reward' });
    await wallet.grantCoins({ opId: 'b', amount: 20, label: 'mine-reward' });

    expect(relay.published).toHaveLength(2);
    expect(quantityIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(140);
  });

  it('a failed publish leaves the authoritative balance untouched', async () => {
    const relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 100 }], 1_000),
      { failPublish: true },
    );
    const wallet = makeWallet(relay);

    const outcome = await wallet.grantCoins({ opId: 'op', amount: 20, label: 'mine-reward' });

    // Possibly-published is reported honestly, and nothing was stored.
    expect(outcome).toMatchObject({ status: 'ambiguous' });
    expect(quantityIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(100);
    // The optimistic reward is never truth: a re-read still shows 100.
    await expect(wallet.readBalance()).resolves.toBe(100);
  });
});
