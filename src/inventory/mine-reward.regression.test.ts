/**
 * Mine reward — the end-to-end regression for the reported overwrite bug.
 *
 * > existing balance = 100, Mine reward = 20, observed result = 20.
 *
 * Two halves, because the bug could have lived in either:
 *
 * 1. **Behavioural** — the Mine's exact reward call, against a REAL canonical
 *    inventory event, asserting the whole resulting kind:31633 (Coins,
 *    Arcade Tickets and an unrelated consumable), plus the Mine's real
 *    exactly-once mechanism: ONE operation id minted at Start and reused by
 *    both finish paths.
 * 2. **Structural** — that `MiningGame.tsx` still calls the canonical wallet
 *    with a DELTA under a per-session operation id, so a future edit cannot
 *    reintroduce an absolute write or a per-finish id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NostrEvent } from '@nostrify/nostrify';

import { createCoinWallet, mintCoinOpId, type CoinWalletNostr } from './coin-wallet';
import { BLOBBI_COIN_ADDRESS } from './coin';
import { ARCADE_TICKET_ADDRESS } from './arcade-reward-writer';
import { applyMutation, buildInventoryTemplate, getQuantity } from './useInventoryMutation';
import { buildEmptyInventory } from './useIslandInventory';
import { parseInventoryEvent } from './protocol-adapter';
import { clearCoinOps } from '@/lib/coin-op-ledger';

const PUBKEY = 'f'.repeat(64);
const APPLE = `31632:${'a'.repeat(64)}:blobbi:food:apple`;

/** The gem drop table MiningGame pays out from. Values unchanged. */
const GEM_VALUES = { 'stone.png': 1, 'gem-1.png': 10, 'gem-2.png': 25, 'gem-3.png': 50 };

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

function makeRelay(initial: NostrEvent) {
  let stored: NostrEvent = initial;
  const published: NostrEvent[] = [];
  const nostr: CoinWalletNostr = {
    query: async () => [stored],
    event: async (event) => {
      published.push(event);
      if (event.created_at >= stored.created_at) stored = event;
    },
  };
  return { nostr, published, getStored: () => stored };
}

function makeWallet(relay: ReturnType<typeof makeRelay>) {
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
    now: () => 1_700_000_000_000,
  });
}

function quantityIn(event: NostrEvent, address: string): number {
  const parsed = parseInventoryEvent(event);
  return parsed ? getQuantity(parsed, address) : -1;
}

/** The player state from the bug report, plus neighbours that must survive. */
function startingInventory() {
  return realInventoryEvent(
    [
      { address: BLOBBI_COIN_ADDRESS, amount: 100 },
      { address: ARCADE_TICKET_ADDRESS, amount: 40 },
      { address: APPLE, amount: 7 },
    ],
    1_000,
  );
}

beforeEach(() => clearCoinOps());
afterEach(() => {
  clearCoinOps();
  vi.restoreAllMocks();
});

describe('a completed Mine run adds its reward to the existing balance', () => {
  it('Coin 100 + 20 = 120, Tickets 40 and the apple untouched', async () => {
    const relay = makeRelay(startingInventory());
    const wallet = makeWallet(relay);

    // The Mine's own payout: gem values summed into ONE delta.
    const mined = ['gem-2.png', 'stone.png', 'stone.png', 'gem-1.png'] as const;
    const totalCoins = mined.reduce((sum, gem) => sum + GEM_VALUES[gem], 0);
    expect(totalCoins).toBe(37);

    const opId = mintCoinOpId('mine-reward'); // minted at Start, as the Mine does
    const outcome = await wallet.grantCoins({
      opId,
      amount: totalCoins,
      label: 'mine-reward',
    });

    expect(outcome).toEqual({ status: 'applied', balance: 137, verified: true });

    const stored = relay.getStored();
    expect(quantityIn(stored, BLOBBI_COIN_ADDRESS)).toBe(137);
    expect(quantityIn(stored, ARCADE_TICKET_ADDRESS)).toBe(40);
    expect(quantityIn(stored, APPLE)).toBe(7);
  });

  it('the exact reported case: 100 + 20 = 120, never 20', async () => {
    const relay = makeRelay(startingInventory());
    const wallet = makeWallet(relay);

    await wallet.grantCoins({
      opId: mintCoinOpId('mine-reward'),
      amount: 20,
      label: 'mine-reward',
    });

    expect(quantityIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(120);
    expect(quantityIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).not.toBe(20);
    expect(quantityIn(relay.getStored(), ARCADE_TICKET_ADDRESS)).toBe(40);
  });

  it('two Mine runs accumulate: 100 → +20 → +15 = 135', async () => {
    const relay = makeRelay(startingInventory());
    const wallet = makeWallet(relay);

    await wallet.grantCoins({ opId: mintCoinOpId('mine-reward'), amount: 20, label: 'mine-reward' });
    await wallet.grantCoins({ opId: mintCoinOpId('mine-reward'), amount: 15, label: 'mine-reward' });

    expect(quantityIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(135);
    expect(quantityIn(relay.getStored(), ARCADE_TICKET_ADDRESS)).toBe(40);
  });
});

describe('the SAME completed run cannot pay twice', () => {
  it('both finish paths share the session operation id and grant once', async () => {
    const relay = makeRelay(startingInventory());
    const wallet = makeWallet(relay);

    // MiningGame mints ONE id at Start and keeps it in a ref; the auto-finish
    // (energy exhausted) and the results button both reuse it.
    const sessionOpId = mintCoinOpId('mine-reward');

    const auto = await wallet.grantCoins({ opId: sessionOpId, amount: 20, label: 'mine-reward' });
    const button = await wallet.grantCoins({ opId: sessionOpId, amount: 20, label: 'mine-reward' });

    expect(auto).toMatchObject({ status: 'applied' });
    expect(button).toEqual({ status: 'already-applied' });
    expect(relay.published).toHaveLength(1);
    expect(quantityIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(120);
  });

  it('a NEW session mints a new id and pays again', async () => {
    const relay = makeRelay(startingInventory());
    const wallet = makeWallet(relay);

    await wallet.grantCoins({ opId: mintCoinOpId('mine-reward'), amount: 20, label: 'mine-reward' });
    await wallet.grantCoins({ opId: mintCoinOpId('mine-reward'), amount: 20, label: 'mine-reward' });

    expect(relay.published).toHaveLength(2);
    expect(quantityIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(140);
  });
});

describe('MiningGame stays wired to the canonical delta path', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/blobbi/MiningGame.tsx'),
    'utf8',
  );
  const settlement = readFileSync(
    join(process.cwd(), 'src/mine/mine-settlement.ts'),
    'utf8',
  );

  it('pays through the canonical wallet, via the durable session settlement', () => {
    // The Mine no longer calls the wallet directly; it hands a frozen reward to
    // the settlement service, which grants through the ONE canonical wallet.
    expect(source).toMatch(/useMineSettlement/);
    expect(settlement).toMatch(/wallet\.grantCoins\(/);
    expect(settlement).toMatch(/label: 'mine-reward'/);
    // Still no bespoke inventory write anywhere on the Mine path.
    expect(source).not.toMatch(/applyMutation|buildInventoryTemplate/);
    expect(settlement).not.toMatch(/applyMutation|buildInventoryTemplate/);
  });

  it('passes the summed reward as an amount (a delta), never a balance', () => {
    // The run's own gem total is what is handed to finalization; the daily
    // ceiling may trim it there, but nothing reads a balance to build it.
    expect(source).toMatch(/const totalCoins = mineRunReward\(/);
    expect(source).toMatch(/coinReward: rawCoins/);
    expect(settlement).toMatch(/amount: coinReward/);
    // A balance read feeding the grant would be the absolute-write shape.
    expect(source).not.toMatch(/useCoinBalance/);
  });

  it('derives ONE stable session id per run, at Start', () => {
    expect(source).toMatch(/sessionIdRef/);
    expect(source).toMatch(/const startGame[\s\S]{0,400}startSession\(/);
    // Exactly one place the session is created: a second would pay twice.
    expect(source.match(/startSession\(/g) ?? []).toHaveLength(1);
    // Operation ids are DERIVED from the session, never minted per attempt.
    expect(settlement).toMatch(/mineCoinOpId\(current\.sessionId\)/);
    expect(settlement).toMatch(/mineEnergyOpId\(current\.sessionId\)/);
    expect(settlement).not.toMatch(/mintCoinOpId/);
  });

  it('publishes NO pet state during gameplay', () => {
    // The per-click kind:31124 write is gone: the whole run's energy cost is
    // one delta settled at the end.
    expect(source).not.toMatch(/useUpdatePetState/);
    expect(source).not.toMatch(/updatePetStats\(/);
  });
});
