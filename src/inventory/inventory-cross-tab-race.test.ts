/**
 * F-03 regression: the generic inventory mutation vs the value-bearing
 * writers, ACROSS tabs.
 *
 * Coins, Arcade Tickets and every consumable live in ONE replaceable
 * kind:31633 event. The per-tab write chain cannot serialize two different
 * tabs, so cross-tab exclusion is exactly what the shared queued Web Lock
 * exists for: and `useInventoryMutation` used to skip it, letting a free
 * grant or a consumption decrement in one tab silently roll back a Coin or
 * Ticket movement in another.
 *
 * A "tab" here is a fresh module registry (`vi.resetModules` + dynamic
 * import): each realm has its own per-tab promise chain, so the ONLY thing
 * serializing them is the shared lock, faked below as a queued exclusive
 * lock the way real Web Locks behave. Reads yield repeatedly so an unguarded
 * writer would deterministically interleave (both read the same base before
 * either publishes) rather than get lucky.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  runInventoryMutationTransaction,
  applyMutation,
  buildInventoryTemplate,
  getQuantity,
} from './useInventoryMutation';
import {
  InventoryTransactionError,
  isAmbiguousInventoryPublish,
  type InventoryTransactionNostr,
} from './inventory-transaction';
import { buildEmptyInventory } from './useIslandInventory';
import { parseInventoryEvent } from './protocol-adapter';
import { itemIdToAddress } from './registry';
import { BLOBBI_COIN_ADDRESS } from './coin';
import { ARCADE_TICKET_ADDRESS } from './arcade-reward-writer';
import { clearCoinOps } from '@/lib/coin-op-ledger';

const PUBKEY = 'e'.repeat(64);
const FROZEN_NOW = 1_700_000_000_000;
const READ_YIELDS = 16;
const APPLE = itemIdToAddress('food_apple')!;

// --- A queued exclusive Web Locks fake shared by every "tab" ---------------

function installFakeWebLocks() {
  const queues = new Map<string, Promise<unknown>>();
  let active = 0;
  let maxActive = 0;
  const locks = {
    request: (
      name: string,
      _options: { mode?: string },
      callback: (lock: unknown) => Promise<unknown>,
    ): Promise<unknown> => {
      const previous = queues.get(name) ?? Promise.resolve();
      const run = previous.then(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          return await callback({});
        } finally {
          active -= 1;
        }
      });
      queues.set(
        name,
        run.then(
          () => undefined,
          () => undefined,
        ),
      );
      return run;
    },
  };
  Object.defineProperty(globalThis.navigator, 'locks', {
    value: locks,
    configurable: true,
  });
  return {
    maxConcurrentHolders: () => maxActive,
    uninstall: () => {
      delete (globalThis.navigator as { locks?: unknown }).locks;
    },
  };
}

// --- Shared relay: slow reads, fast writes, newest-wins storage ------------

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
      if (event.created_at >= stored.created_at) stored = event;
    },
  };
  return { nostr, published, getStored: () => stored };
}

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

function signer(prefix: string) {
  return {
    signEvent: vi.fn(async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
      ...t,
      id: `${prefix}-${t.created_at}-${Math.random().toString(16).slice(2)}`,
      pubkey: PUBKEY,
      sig: 'sig',
    })),
  };
}

function quantityIn(event: NostrEvent, address: string): number {
  const parsed = parseInventoryEvent(event);
  return parsed ? getQuantity(parsed, address) : -1;
}

/** A second "tab": a fresh module registry with its own per-tab chain. */
async function loadOtherTab() {
  vi.resetModules();
  const mutation = await import('./useInventoryMutation');
  const wallet = await import('./coin-wallet');
  const arcade = await import('./arcade-reward-writer');
  return {
    runInventoryMutationTransaction: mutation.runInventoryMutationTransaction,
    createCoinWallet: wallet.createCoinWallet,
    createArcadeTicketWriter: arcade.createArcadeTicketWriter,
  };
}

let fakeLocks: ReturnType<typeof installFakeWebLocks>;

beforeEach(() => {
  clearCoinOps();
  fakeLocks = installFakeWebLocks();
});
afterEach(() => {
  clearCoinOps();
  fakeLocks.uninstall();
  vi.restoreAllMocks();
});

describe('a generic inventory mutation and a Coin wallet write racing across tabs', () => {
  it('cannot clobber each other: Coin +20 in tab A, apple +2 in tab B', async () => {
    const tabA = await loadOtherTab();
    const relay = makeYieldingRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 100 },
          { address: ARCADE_TICKET_ADDRESS, amount: 50 },
        ],
        1_000,
      ),
    );
    const wallet = tabA.createCoinWallet({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('coin') } as never,
      now: () => FROZEN_NOW,
    });

    // Started together, awaited together; only the shared lock orders them.
    await Promise.all([
      wallet.grantCoins({ opId: 'race-grant-1', amount: 20, label: 'mine-reward' }),
      runInventoryMutationTransaction(
        {
          nostr: relay.nostr,
          user: { pubkey: PUBKEY, signer: signer('mutation') } as never,
          now: () => FROZEN_NOW,
        },
        { type: 'add', address: APPLE, amount: 2 },
      ),
    ]);

    const stored = relay.getStored();
    expect(quantityIn(stored, BLOBBI_COIN_ADDRESS)).toBe(120);
    expect(quantityIn(stored, APPLE)).toBe(2);
    expect(quantityIn(stored, ARCADE_TICKET_ADDRESS)).toBe(50);
    // The mechanism, not luck: the lock never had two concurrent holders.
    expect(fakeLocks.maxConcurrentHolders()).toBe(1);
  });

  it('the reverse start order gives the same final state', async () => {
    const tabA = await loadOtherTab();
    const relay = makeYieldingRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 100 }], 1_000),
    );
    const wallet = tabA.createCoinWallet({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('coin') } as never,
      now: () => FROZEN_NOW,
    });

    await Promise.all([
      runInventoryMutationTransaction(
        {
          nostr: relay.nostr,
          user: { pubkey: PUBKEY, signer: signer('mutation') } as never,
          now: () => FROZEN_NOW,
        },
        { type: 'add', address: APPLE, amount: 2 },
      ),
      wallet.spendCoins({ opId: 'race-spend-1', amount: 30, label: 'arcade-pass' }),
    ]);

    const stored = relay.getStored();
    expect(quantityIn(stored, BLOBBI_COIN_ADDRESS)).toBe(70);
    expect(quantityIn(stored, APPLE)).toBe(2);
  });
});

describe('a generic inventory mutation and an Arcade Ticket writer racing across tabs', () => {
  it('cannot clobber each other: Ticket +10 in tab A, apple -1 in tab B', async () => {
    const tabA = await loadOtherTab();
    const relay = makeYieldingRelay(
      realInventoryEvent(
        [
          { address: ARCADE_TICKET_ADDRESS, amount: 50 },
          { address: APPLE, amount: 3 },
        ],
        1_000,
      ),
    );
    const ticketWriter = tabA.createArcadeTicketWriter({
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('ticket') } as never,
      now: () => FROZEN_NOW,
    });

    await Promise.all([
      ticketWriter.publishTicketGrant({ tickets: 10 } as never),
      runInventoryMutationTransaction(
        {
          nostr: relay.nostr,
          user: { pubkey: PUBKEY, signer: signer('mutation') } as never,
          now: () => FROZEN_NOW,
        },
        { type: 'remove', address: APPLE, amount: 1 },
      ),
    ]);

    const stored = relay.getStored();
    expect(quantityIn(stored, ARCADE_TICKET_ADDRESS)).toBe(60);
    expect(quantityIn(stored, APPLE)).toBe(2);
    expect(fakeLocks.maxConcurrentHolders()).toBe(1);
  });
});

describe('replaceable-event ordering on the generic mutation path', () => {
  it('two mutations inside ONE wall-clock second produce strictly increasing created_at', async () => {
    const relay = makeYieldingRelay(
      realInventoryEvent([{ address: APPLE, amount: 1 }], 1_000),
    );
    const deps = {
      nostr: relay.nostr,
      user: { pubkey: PUBKEY, signer: signer('mono') } as never,
      now: () => FROZEN_NOW, // frozen: both writes happen in the same second
    };

    await runInventoryMutationTransaction(deps, {
      type: 'add',
      address: APPLE,
      amount: 1,
    });
    await runInventoryMutationTransaction(deps, {
      type: 'add',
      address: APPLE,
      amount: 1,
    });

    const stamps = relay.published.map((e) => e.created_at);
    expect(stamps).toHaveLength(2);
    expect(stamps[1]).toBeGreaterThan(stamps[0]);
    expect(quantityIn(relay.getStored(), APPLE)).toBe(3);
  });
});

describe('losslessness of the generic mutation path', () => {
  it('unknown tags, the allocation marker, other balances and content all survive', async () => {
    const base = realInventoryEvent(
      [
        { address: BLOBBI_COIN_ADDRESS, amount: 100 },
        { address: ARCADE_TICKET_ADDRESS, amount: 50 },
      ],
      1_000,
    );
    base.tags = [
      ...base.tags,
      ['allocation', 'island-economy:v1'],
      ['x-future', 'keep-me', 'extra'],
    ];
    base.content = 'foreign-content';
    const relay = makeYieldingRelay(base);

    await runInventoryMutationTransaction(
      {
        nostr: relay.nostr,
        user: { pubkey: PUBKEY, signer: signer('lossless') } as never,
        now: () => FROZEN_NOW,
      },
      { type: 'add', address: APPLE, amount: 2 },
    );

    const stored = relay.getStored();
    expect(quantityIn(stored, APPLE)).toBe(2);
    expect(quantityIn(stored, BLOBBI_COIN_ADDRESS)).toBe(100);
    expect(quantityIn(stored, ARCADE_TICKET_ADDRESS)).toBe(50);
    expect(stored.tags).toContainEqual(['allocation', 'island-economy:v1']);
    expect(stored.tags).toContainEqual(['x-future', 'keep-me', 'extra']);
    expect(stored.content).toBe('foreign-content');
  });
});

describe('strict publish semantics on the generic mutation path', () => {
  it('a publish timeout throws AMBIGUOUS, never resolves as success', async () => {
    const base = realInventoryEvent([{ address: APPLE, amount: 3 }], 1_000);
    const timeout = new Error('publish timed out');
    timeout.name = 'TimeoutError';
    const nostr: InventoryTransactionNostr = {
      query: async () => [base],
      event: async () => {
        throw timeout;
      },
    };

    let caught: unknown;
    await runInventoryMutationTransaction(
      {
        nostr,
        user: { pubkey: PUBKEY, signer: signer('strict') } as never,
        now: () => FROZEN_NOW,
      },
      { type: 'remove', address: APPLE, amount: 1 },
    ).catch((err: unknown) => {
      caught = err;
    });

    expect(caught).toBeInstanceOf(InventoryTransactionError);
    expect((caught as InventoryTransactionError).reason).toBe('publish-timeout');
    expect(isAmbiguousInventoryPublish(caught)).toBe(true);
  });
});
