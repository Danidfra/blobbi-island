/**
 * The kind:31633 publish base, against the REAL relay-read semantics.
 *
 * `a1036e9` introduced `readAuthoritativeInventoryBase` on the belief that
 * `nostr.query` rejects on timeout. It does not — `NPool.query` swallows every
 * failure and resolves, usually with `[]` — so the "unknown never becomes a
 * publish base" guarantee was only as strong as "two consecutive timeouts are
 * unlikely". These tests drive the helper through `req`-shaped relays so the
 * guarantee is real:
 *
 * ```
 *   unknown read        → THROWS; nothing may be built from it
 *   confirmed empty     → an empty base, so a first-ever write still works
 *   answered non-empty  → that inventory, with its created_at
 * ```
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  fetchInventoryWithMeta,
  readAuthoritativeInventoryBase,
  buildEmptyInventory,
  type InventoryReadNostr,
} from './useIslandInventory';
import { applyMutation, buildInventoryTemplate, getQuantity } from './useInventoryMutation';
import { BLOBBI_COIN_ADDRESS } from './coin';
import { ARCADE_TICKET_ADDRESS } from './arcade-reward-writer';
import { createCoinWallet, type CoinWalletNostr } from './coin-wallet';
import { RelayReadUnknownError } from '@/lib/relay-read';
import { clearCoinOps } from '@/lib/coin-op-ledger';

const PUBKEY = 'f'.repeat(64);

type ReqMessage =
  | ['EVENT', string, NostrEvent]
  | ['EOSE', string]
  | ['CLOSED', string, string];

/** The player's real inventory: 100 Coins and 40 Arcade Tickets. */
function storedInventory(): NostrEvent {
  let inventory = buildEmptyInventory(PUBKEY);
  inventory = applyMutation(inventory, {
    type: 'add',
    address: BLOBBI_COIN_ADDRESS,
    amount: 100,
  });
  inventory = applyMutation(inventory, {
    type: 'add',
    address: ARCADE_TICKET_ADDRESS,
    amount: 40,
  });
  const template = buildInventoryTemplate(inventory);
  return {
    ...template,
    content: template.content ?? '',
    id: 'evt-1000',
    pubkey: PUBKEY,
    created_at: 1_000,
    sig: 'sig',
  } as NostrEvent;
}

/** A relay that replays one scripted message sequence per read. */
function scriptedRelay(scripts: ReqMessage[][]) {
  let call = 0;
  const published: NostrEvent[] = [];
  const nostr = {
    req: () => {
      const script = scripts[Math.min(call, scripts.length - 1)];
      call += 1;
      return (async function* () {
        for (const msg of script) yield msg;
      })();
    },
    query: async () => {
      throw new Error('query must not be used when req is available');
    },
    event: async (event: NostrEvent) => {
      published.push(event);
    },
  };
  return { nostr, published, reads: () => call };
}

const answers = (...events: NostrEvent[]): ReqMessage[] => [
  ...events.map((e) => ['EVENT', 's', e] as ReqMessage),
  ['EOSE', 's'],
];
const answersEmpty = (): ReqMessage[] => [['EOSE', 's']];
const unreachable = (): ReqMessage[] => [['CLOSED', 's', 'unavailable']];

beforeEach(() => clearCoinOps());
afterEach(() => {
  clearCoinOps();
  vi.restoreAllMocks();
});

describe('an unknown read is never a publish base', () => {
  it('readAuthoritativeInventoryBase THROWS instead of returning an empty base', async () => {
    const relay = scriptedRelay([unreachable()]);
    await expect(
      readAuthoritativeInventoryBase(relay.nostr as InventoryReadNostr, PUBKEY),
    ).rejects.toBeInstanceOf(RelayReadUnknownError);
  });

  it('an EMPTY answer followed by an UNKNOWN confirmation is unknown, not empty', async () => {
    const relay = scriptedRelay([answersEmpty(), unreachable()]);
    await expect(
      readAuthoritativeInventoryBase(relay.nostr as InventoryReadNostr, PUBKEY),
    ).rejects.toBeInstanceOf(RelayReadUnknownError);
  });

  it('the single read reports unknown too', async () => {
    const relay = scriptedRelay([unreachable()]);
    await expect(
      fetchInventoryWithMeta(relay.nostr as InventoryReadNostr, PUBKEY),
    ).rejects.toBeInstanceOf(RelayReadUnknownError);
  });

  it('a Coin grant against an UNKNOWN read publishes NOTHING', async () => {
    // The exact shape of the reported Mine bug: 100 Coins + 40 Tickets held,
    // the relay unusable. No event may be built, and nothing may be erased.
    const relay = scriptedRelay([unreachable()]);
    const wallet = createCoinWallet({
      nostr: relay.nostr as CoinWalletNostr,
      user: { pubkey: PUBKEY, signer: { signEvent: vi.fn() } } as never,
      now: () => 1_700_000_000_000,
    });

    await expect(
      wallet.grantCoins({ opId: 'mine-1', amount: 20, label: 'mine-reward' }),
    ).rejects.toMatchObject({ reason: 'read-failed' });
    expect(relay.published).toHaveLength(0);
  });

  it('a stale EMPTY answer cannot erase a real inventory', async () => {
    // First read answers empty (a lagging replica); the confirmation gets the
    // truth. The base must be the REAL inventory, not the empty one.
    const relay = scriptedRelay([answersEmpty(), answers(storedInventory())]);
    const base = await readAuthoritativeInventoryBase(
      relay.nostr as InventoryReadNostr,
      PUBKEY,
    );
    expect(getQuantity(base.inventory, BLOBBI_COIN_ADDRESS)).toBe(100);
    expect(getQuantity(base.inventory, ARCADE_TICKET_ADDRESS)).toBe(40);
    expect(base.createdAt).toBe(1_000);
  });
});

describe('a genuinely new account can still make its first write', () => {
  it('two completed EMPTY reads produce an empty base', async () => {
    const relay = scriptedRelay([answersEmpty(), answersEmpty()]);
    const base = await readAuthoritativeInventoryBase(
      relay.nostr as InventoryReadNostr,
      PUBKEY,
    );
    expect(base.createdAt).toBe(0);
    expect(getQuantity(base.inventory, BLOBBI_COIN_ADDRESS)).toBe(0);
    expect(relay.reads()).toBe(2);
  });

  it('the first Coin grant on a confirmed-empty account is published', async () => {
    const relay = scriptedRelay([answersEmpty()]);
    const wallet = createCoinWallet({
      nostr: relay.nostr as CoinWalletNostr,
      user: {
        pubkey: PUBKEY,
        signer: {
          signEvent: vi.fn(async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
            ...t,
            id: 'signed',
            pubkey: PUBKEY,
            sig: 'sig',
          })),
        },
      } as never,
      now: () => 1_700_000_000_000,
    });

    const outcome = await wallet.grantCoins({
      opId: 'allocation',
      amount: 200,
      label: 'island-allocation',
    });
    expect(outcome).toMatchObject({ status: 'applied', balance: 200 });
    expect(relay.published).toHaveLength(1);
  });

  it('an answered NON-empty base costs exactly one read', async () => {
    const relay = scriptedRelay([answers(storedInventory())]);
    const base = await readAuthoritativeInventoryBase(
      relay.nostr as InventoryReadNostr,
      PUBKEY,
    );
    expect(getQuantity(base.inventory, BLOBBI_COIN_ADDRESS)).toBe(100);
    expect(relay.reads()).toBe(1);
  });
});
