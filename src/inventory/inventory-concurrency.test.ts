/**
 * Concurrent kind:31633 writers, the lost-update regression.
 *
 * Coins and Arcade Tickets are two quantities in ONE replaceable event. Before
 * the shared transaction primitive the Coin wallet held a cross-tab lock and
 * the per-tab write chain while the two Arcade Ticket writers held neither, so
 * their read-modify-write windows could overlap and whichever event landed
 * last silently resurrected the other currency's old value.
 *
 * These tests overlap the writers on purpose; every call is started before
 * the previous one is awaited, and the fake relay yields on every read so the
 * interleaving is real rather than notional.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { createCoinWallet } from './coin-wallet';
import { BLOBBI_COIN_ADDRESS } from './coin';
import { ARCADE_TICKET_ADDRESS, createArcadeTicketWriter } from './arcade-reward-writer';
import { createArcadePrizeSpendWriter } from './arcade-prize-spend-writer';
import {
  inventoryWriteLockName,
  nextInventoryCreatedAt,
  type InventoryTransactionNostr,
} from './inventory-transaction';
import { applyMutation, buildInventoryTemplate, getQuantity } from './useInventoryMutation';
import { buildEmptyInventory } from './useIslandInventory';
import { parseInventoryEvent } from './protocol-adapter';
import { clearCoinOps } from '@/lib/coin-op-ledger';

const PUBKEY = 'f'.repeat(64);
const FROZEN_NOW = 1_700_000_000_000;

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
  const template = buildInventoryTemplate(inventory);
  return {
    ...template,
    content: template.content ?? '',
    id: `evt-${createdAt}`,
    pubkey: PUBKEY,
    created_at: createdAt,
    sig: 'sig',
  } as NostrEvent;
}

/**
 * A relay whose READS are deliberately much slower than its WRITES.
 *
 * That asymmetry is what makes the lost update deterministic rather than
 * lucky: without serialization both writers finish their reads before either
 * one publishes, so they both build from the same base and the second publish
 * resurrects the first's old value. With the shared transaction the second
 * writer cannot even start reading until the first has published, so the same
 * timing produces the correct result.
 */
const READ_YIELDS = 16;

function makeYieldingRelay(initial: NostrEvent) {
  let stored: NostrEvent = initial;
  const published: NostrEvent[] = [];
  const nostr: InventoryTransactionNostr = {
    query: async () => {
      for (let i = 0; i < READ_YIELDS; i += 1) await Promise.resolve();
      return [stored];
    },
    event: async (event) => {
      published.push(event);
      // Newest-wins, exactly like a relay holding a replaceable event.
      if (event.created_at >= stored.created_at) stored = event;
    },
  };
  return { nostr, published, getStored: () => stored };
}

function signer(prefix: string) {
  return {
    signEvent: vi.fn(async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
      ...t,
      id: `${prefix}-${t.created_at}`,
      pubkey: PUBKEY,
      sig: 'sig',
    })),
  };
}

function quantityIn(event: NostrEvent, address: string): number {
  const parsed = parseInventoryEvent(event);
  return parsed ? getQuantity(parsed, address) : -1;
}

beforeEach(() => clearCoinOps());
afterEach(() => {
  clearCoinOps();
  vi.restoreAllMocks();
});

describe('a Coin write and a Ticket write never lose each other', () => {
  it('Coin +20 overlapping Ticket +10: 100/50 → 120/60', async () => {
    const relay = makeYieldingRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 100 },
          { address: ARCADE_TICKET_ADDRESS, amount: 50 },
        ],
        1_000,
      ),
    );
    const wallet = createCoinWallet({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('coin') } as never,
      now: () => FROZEN_NOW,
    });
    const ticketWriter = createArcadeTicketWriter({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('ticket') } as never,
      now: () => FROZEN_NOW,
    });

    // Started together, awaited together, the queue decides the order.
    await Promise.all([
      wallet.grantCoins({ opId: 'mine-1', amount: 20, label: 'mine-reward' }),
      ticketWriter.publishTicketGrant({ tickets: 10 } as never),
    ]);

    const stored = relay.getStored();
    expect(quantityIn(stored, BLOBBI_COIN_ADDRESS)).toBe(120);
    expect(quantityIn(stored, ARCADE_TICKET_ADDRESS)).toBe(60);
  });

  it('the reverse start order gives the same final state', async () => {
    const relay = makeYieldingRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 100 },
          { address: ARCADE_TICKET_ADDRESS, amount: 50 },
        ],
        1_000,
      ),
    );
    const wallet = createCoinWallet({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('coin') } as never,
      now: () => FROZEN_NOW,
    });
    const ticketWriter = createArcadeTicketWriter({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('ticket') } as never,
      now: () => FROZEN_NOW,
    });

    await Promise.all([
      ticketWriter.publishTicketGrant({ tickets: 10 } as never),
      wallet.grantCoins({ opId: 'mine-1', amount: 20, label: 'mine-reward' }),
    ]);

    const stored = relay.getStored();
    expect(quantityIn(stored, BLOBBI_COIN_ADDRESS)).toBe(120);
    expect(quantityIn(stored, ARCADE_TICKET_ADDRESS)).toBe(60);
  });

  it('Coin +20 overlapping Ticket -15: 100/50 → 120/35', async () => {
    const relay = makeYieldingRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 100 },
          { address: ARCADE_TICKET_ADDRESS, amount: 50 },
        ],
        1_000,
      ),
    );
    const wallet = createCoinWallet({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('coin') } as never,
      now: () => FROZEN_NOW,
    });
    const spendWriter = createArcadePrizeSpendWriter({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('spend') } as never,
      now: () => FROZEN_NOW,
    });

    await Promise.all([
      wallet.grantCoins({ opId: 'mine-1', amount: 20, label: 'mine-reward' }),
      spendWriter.spendTickets({ price: 15 } as never),
    ]);

    const stored = relay.getStored();
    expect(quantityIn(stored, BLOBBI_COIN_ADDRESS)).toBe(120);
    expect(quantityIn(stored, ARCADE_TICKET_ADDRESS)).toBe(35);
  });

  it('a Coin spend overlapping a Ticket grant keeps both movements', async () => {
    const relay = makeYieldingRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 100 },
          { address: ARCADE_TICKET_ADDRESS, amount: 50 },
        ],
        1_000,
      ),
    );
    const wallet = createCoinWallet({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('coin') } as never,
      now: () => FROZEN_NOW,
    });
    const ticketWriter = createArcadeTicketWriter({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('ticket') } as never,
      now: () => FROZEN_NOW,
    });

    await Promise.all([
      wallet.spendCoins({ opId: 'pass-1', amount: 20, label: 'arcade-pass' }),
      ticketWriter.publishTicketGrant({ tickets: 10 } as never),
    ]);

    const stored = relay.getStored();
    expect(quantityIn(stored, BLOBBI_COIN_ADDRESS)).toBe(80);
    expect(quantityIn(stored, ARCADE_TICKET_ADDRESS)).toBe(60);
  });

  it('three overlapping writers all land', async () => {
    const relay = makeYieldingRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 100 },
          { address: ARCADE_TICKET_ADDRESS, amount: 50 },
        ],
        1_000,
      ),
    );
    const wallet = createCoinWallet({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('coin') } as never,
      now: () => FROZEN_NOW,
    });
    const ticketWriter = createArcadeTicketWriter({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('ticket') } as never,
      now: () => FROZEN_NOW,
    });

    await Promise.all([
      wallet.grantCoins({ opId: 'mine-1', amount: 20, label: 'mine-reward' }),
      ticketWriter.publishTicketGrant({ tickets: 10 } as never),
      wallet.grantCoins({ opId: 'beach-1', amount: 5, label: 'beach-reward' }),
    ]);

    const stored = relay.getStored();
    expect(quantityIn(stored, BLOBBI_COIN_ADDRESS)).toBe(125);
    expect(quantityIn(stored, ARCADE_TICKET_ADDRESS)).toBe(60);
  });
});

describe('created_at ordering for a replaceable event', () => {
  it('is strictly increasing across writers inside ONE wall-clock second', async () => {
    const relay = makeYieldingRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 100 },
          { address: ARCADE_TICKET_ADDRESS, amount: 50 },
        ],
        1_000,
      ),
    );
    // A FROZEN clock: every write happens in the same second. Without the
    // monotonic rule they would tie, and NIP-01's lowest-id tie-break would
    // let a relay keep the stale snapshot.
    const wallet = createCoinWallet({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('coin') } as never,
      now: () => FROZEN_NOW,
    });
    const ticketWriter = createArcadeTicketWriter({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('ticket') } as never,
      now: () => FROZEN_NOW,
    });

    await wallet.grantCoins({ opId: 'a', amount: 1, label: 'mine-reward' });
    await ticketWriter.publishTicketGrant({ tickets: 1 } as never);
    await wallet.grantCoins({ opId: 'b', amount: 1, label: 'mine-reward' });

    const stamps = relay.published.map((e) => e.created_at);
    expect(stamps).toHaveLength(3);
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
    }
    // And the final state carries every movement.
    expect(quantityIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(102);
    expect(quantityIn(relay.getStored(), ARCADE_TICKET_ADDRESS)).toBe(51);
  });

  it('nextInventoryCreatedAt never ties with, or precedes, the base', () => {
    // Wall clock ahead of the base: use the clock.
    expect(nextInventoryCreatedAt(1_700_000_000_000, 1_000)).toBe(1_700_000_000);
    // Base at/ahead of the clock (a future-dated predecessor): step past it.
    expect(nextInventoryCreatedAt(1_000_000, 1_700_000_000)).toBe(1_700_000_001);
    expect(nextInventoryCreatedAt(1_700_000_000_000, 1_700_000_000)).toBe(1_700_000_001);
  });
});

describe('writers are mutually excluded, not merely usually lucky', () => {
  /**
   * The value assertions above prove the OUTCOME; this proves the MECHANISM.
   *
   * Each writer gets its own labelled view of one shared store, so the exact
   * interleaving is recorded. A writer that does not join the shared queue
   * starts reading while another writer's transaction is still open, and the
   * log shows it, deterministically, with no reliance on which promise
   * happens to settle first.
   */
  it('no writer opens a read while another writer holds the queue', async () => {
    let stored: NostrEvent = realInventoryEvent(
      [
        { address: BLOBBI_COIN_ADDRESS, amount: 100 },
        { address: ARCADE_TICKET_ADDRESS, amount: 50 },
      ],
      1_000,
    );
    const log: string[] = [];

    const viewFor = (label: string): InventoryTransactionNostr => ({
      query: async () => {
        log.push(`${label}:read-start`);
        for (let i = 0; i < READ_YIELDS; i += 1) await Promise.resolve();
        log.push(`${label}:read-end`);
        return [stored];
      },
      event: async (event) => {
        log.push(`${label}:publish`);
        if (event.created_at >= stored.created_at) stored = event;
      },
    });

    const wallet = createCoinWallet({
      nostr: viewFor('coin'),
      user: { pubkey: PUBKEY, signer: signer('coin') } as never,
      now: () => FROZEN_NOW,
    });
    const ticketWriter = createArcadeTicketWriter({
      nostr: viewFor('ticket'),
      user: { pubkey: PUBKEY, signer: signer('ticket') } as never,
      now: () => FROZEN_NOW,
    });

    await Promise.all([
      wallet.grantCoins({ opId: 'mine-1', amount: 20, label: 'mine-reward' }),
      ticketWriter.publishTicketGrant({ tickets: 10 } as never),
    ]);

    // Walk the log: between any writer's first read and its publish, no OTHER
    // writer may appear. That is exactly what the shared queue guarantees.
    const firstTicketRead = log.indexOf('ticket:read-start');
    const coinPublish = log.indexOf('coin:publish');
    expect(firstTicketRead).toBeGreaterThan(-1);
    expect(coinPublish).toBeGreaterThan(-1);
    expect(
      firstTicketRead,
      `ticket writer read while the coin transaction was open: ${log.join(' → ')}`,
    ).toBeGreaterThan(coinPublish);

    expect(quantityIn(stored, BLOBBI_COIN_ADDRESS)).toBe(120);
    expect(quantityIn(stored, ARCADE_TICKET_ADDRESS)).toBe(60);
  });
});

describe('all kind:31633 writers contend for ONE lock name', () => {
  it('the lock name is derived, per-user, and not writer-specific', () => {
    expect(inventoryWriteLockName(PUBKEY)).toBe(`blobbi-inventory:${PUBKEY}`);
    expect(inventoryWriteLockName('other')).not.toBe(inventoryWriteLockName(PUBKEY));
  });
});
