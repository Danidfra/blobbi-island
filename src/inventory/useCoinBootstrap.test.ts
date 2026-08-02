/**
 * Legacy Coin bootstrap — exactly-once migration semantics.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  runCoinBootstrap,
  resetCoinBootstrapRuns,
  LEGACY_BOOTSTRAP_OP_ID,
} from './useCoinBootstrap';
import { createCoinWallet, type CoinWalletNostr } from './coin-wallet';
import { BLOBBI_COIN_ADDRESS, MAX_COIN_BALANCE } from './coin';
import { clearCoinOps, readCoinOp } from '@/lib/coin-op-ledger';

const PUBKEY = 'b'.repeat(64);

function profileEvent(coins: number | string | null, createdAt = 500): NostrEvent {
  const tags: string[][] = [
    ['d', 'blobbonaut-profile'],
    ['name', 'Filet'],
  ];
  if (coins !== null) tags.push(['coins', String(coins)]);
  return {
    id: `profile-${createdAt}`,
    pubkey: PUBKEY,
    created_at: createdAt,
    kind: 11125,
    tags,
    content: '',
    sig: 'sig',
  };
}

function inventoryEvent(coinQuantity: number, createdAt = 400): NostrEvent {
  const tags: string[][] = [['d', 'blobbi:island']];
  if (coinQuantity > 0) tags.push(['a', BLOBBI_COIN_ADDRESS, '', String(coinQuantity)]);
  return {
    id: `inventory-${createdAt}`,
    pubkey: PUBKEY,
    created_at: createdAt,
    kind: 31633,
    tags,
    content: '',
    sig: 'sig',
  };
}

/** Fake relay answering BOTH profile and inventory queries. */
function makeWorld(options: {
  profiles?: NostrEvent[];
  inventory?: NostrEvent | null;
  publish?: 'ok' | 'timeout';
}) {
  let inventory = options.inventory ?? null;
  const published: NostrEvent[] = [];
  const behavior = options.publish ?? 'ok';

  const nostr = {
    query: async (filters: { kinds: number[] }[]) => {
      if (filters[0]?.kinds?.includes(31633)) return inventory ? [inventory] : [];
      return options.profiles ?? [];
    },
    event: async (event: NostrEvent) => {
      if (behavior === 'timeout') {
        const error = new Error('timed out');
        error.name = 'TimeoutError';
        throw error;
      }
      published.push(event);
      inventory = event;
    },
  };

  const signer = {
    signEvent: async (template: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
      ...template,
      id: `signed-${template.created_at}`,
      pubkey: PUBKEY,
      sig: 'sig',
    }),
  };
  const wallet = createCoinWallet({
    nostr: nostr as CoinWalletNostr,
    user: { pubkey: PUBKEY, signer } as never,
  });

  const deps = { nostr: nostr as never, pubkey: PUBKEY, wallet };
  return {
    deps,
    published,
    setInventory: (event: NostrEvent | null) => {
      inventory = event;
    },
  };
}

beforeEach(() => {
  clearCoinOps();
  resetCoinBootstrapRuns();
});
afterEach(() => clearCoinOps());

describe('runCoinBootstrap', () => {
  it('migrates a legacy-only balance exactly once', async () => {
    const world = makeWorld({ profiles: [profileEvent(150)] });

    const first = await runCoinBootstrap(world.deps);
    expect(first).toMatchObject({ status: 'applied', migratedAmount: 150 });
    expect(world.published).toHaveLength(1);
    expect(readCoinOp(PUBKEY, LEGACY_BOOTSTRAP_OP_ID)?.status).toBe('applied');

    // A refresh runs it again: the durable ledger short-circuits.
    const second = await runCoinBootstrap(world.deps);
    expect(second).toMatchObject({ status: 'applied', migratedAmount: 150 });
    expect(world.published).toHaveLength(1);
  });

  it('never blindly adds the legacy amount when the inventory already holds Coins', async () => {
    const world = makeWorld({
      profiles: [profileEvent(150)],
      inventory: inventoryEvent(150),
    });

    const outcome = await runCoinBootstrap(world.deps);
    expect(outcome).toMatchObject({
      status: 'not-needed',
      migratedAmount: 0,
      note: 'inventory-already-populated',
    });
    expect(world.published).toHaveLength(0);
    // The decision is durable, so a refresh cannot re-open the question.
    expect(readCoinOp(PUBKEY, LEGACY_BOOTSTRAP_OP_ID)?.status).toBe('applied');
  });

  it('selects the NEWEST legacy profile, not whatever arrived first', async () => {
    const world = makeWorld({
      profiles: [profileEvent(40, 100), profileEvent(90, 900)],
    });
    const outcome = await runCoinBootstrap(world.deps);
    expect(outcome).toMatchObject({ status: 'applied', migratedAmount: 90 });
  });

  it('records a durable no-op for a zero legacy balance — no event published', async () => {
    const world = makeWorld({ profiles: [profileEvent(0)] });
    const outcome = await runCoinBootstrap(world.deps);
    expect(outcome).toMatchObject({ status: 'not-needed', migratedAmount: 0 });
    expect(world.published).toHaveLength(0);
    expect(readCoinOp(PUBKEY, LEGACY_BOOTSTRAP_OP_ID)?.status).toBe('applied');
  });

  it('treats a missing profile and a missing coins tag as nothing-to-migrate', async () => {
    expect(await runCoinBootstrap(makeWorld({}).deps)).toMatchObject({
      status: 'not-needed',
    });
    clearCoinOps();
    expect(
      await runCoinBootstrap(makeWorld({ profiles: [profileEvent(null)] }).deps),
    ).toMatchObject({ status: 'not-needed' });
  });

  it('refuses an invalid legacy value instead of migrating garbage', async () => {
    const world = makeWorld({ profiles: [profileEvent(MAX_COIN_BALANCE + 10)] });
    const outcome = await runCoinBootstrap(world.deps);
    expect(outcome.status).toBe('not-needed');
    expect(outcome.note).toContain('invalid-legacy-value');
    expect(world.published).toHaveLength(0);
  });

  it('an ambiguous migration surfaces, blocks re-publish, and reconciles read-only', async () => {
    const world = makeWorld({ profiles: [profileEvent(150)], publish: 'timeout' });

    const first = await runCoinBootstrap(world.deps);
    expect(first.status).toBe('ambiguous');
    expect(readCoinOp(PUBKEY, LEGACY_BOOTSTRAP_OP_ID)?.status).toBe('ambiguous');

    // Still ambiguous on a retry while the relay shows the old state…
    const second = await runCoinBootstrap(world.deps);
    expect(second.status).toBe('ambiguous');
    expect(world.published).toHaveLength(0);

    // …but when the timed-out publish turns out to have LANDED, reconciliation
    // confirms it without publishing anything.
    world.setInventory(inventoryEvent(150, 900));
    const third = await runCoinBootstrap(world.deps);
    expect(third).toMatchObject({ status: 'applied', migratedAmount: 150 });
    expect(world.published).toHaveLength(0);
  });
});
