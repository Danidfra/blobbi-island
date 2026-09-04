/**
 * Building and ESTABLISHING a kind:1416 spend.
 *
 * The one property that matters more than any other: a retry after silence
 * offers the SAME signed bytes again. It never signs a second spend.
 */

import { describe, it, expect, vi } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import type { NUser } from '@nostrify/react/login';

import {
  buildSpendTemplate,
  establishSpend,
  signSpend,
  SPEND_CLIENT_NAME,
  SPEND_PURPOSE_FEED,
  type SpendPublishDeps,
} from './external-spend';
import { KIND_GAME_INVENTORY_SPEND, parseGameInventorySpend } from './package';

const OWNER = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);
const FARM_ISSUER = 'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';
const FARM_MAIN = `31633:${OWNER}:farm:main`;
const STRAWBERRY = `31632:${FARM_ISSUER}:farm:produce:strawberry`;

let signCount = 0;
function fakeSigner(pubkey: string) {
  return {
    pubkey,
    signer: {
      signEvent: vi.fn(async (t: { kind: number; content: string; tags: string[][]; created_at: number }): Promise<NostrEvent> => {
        signCount += 1;
        return { ...t, id: `signed-${signCount}`.padEnd(64, '0'), pubkey, sig: 'sig' };
      }),
    },
  } as unknown as Pick<NUser, 'pubkey' | 'signer'>;
}

const template = () =>
  buildSpendTemplate({
    inventoryAddress: FARM_MAIN,
    inventoryRelay: 'wss://relay.primal.net',
    itemAddress: STRAWBERRY,
    itemRelay: 'wss://relay.primal.net',
    quantity: 1,
    nonce: 'n1',
  });

describe('the spend event', () => {
  it('names the FULL inventory address, the FULL item address and quantity 1, through the canonical builder', () => {
    const t = template();
    expect(t.kind).toBe(KIND_GAME_INVENTORY_SPEND);
    expect(t.tags).toContainEqual(['a', FARM_MAIN, 'wss://relay.primal.net', 'inventory']);
    expect(t.tags).toContainEqual(['a', STRAWBERRY, 'wss://relay.primal.net', 'item']);
    expect(t.tags).toContainEqual(['quantity', '1']);
    expect(t.tags).toContainEqual(['purpose', SPEND_PURPOSE_FEED]);
    expect(t.tags.find((tag) => tag[0] === 'client')?.[1]).toBe(SPEND_CLIENT_NAME);
    expect(t.tags).toContainEqual(['nonce', 'n1']);
  });

  it('parses back as a valid spend when signed by the inventory owner', async () => {
    const signed = await signSpend(fakeSigner(OWNER), template(), 1700000000);
    const parsed = parseGameInventorySpend(signed);
    expect(parsed?.inventoryAddress).toBe(FARM_MAIN);
    expect(parsed?.itemAddress).toBe(STRAWBERRY);
    expect(parsed?.quantity).toBe(1);
    expect(parsed?.owner).toBe(OWNER);
  });

  it('refuses to sign a spend for an inventory the signer does not own', async () => {
    await expect(signSpend(fakeSigner(STRANGER), template(), 1700000000)).rejects.toThrow(/inventory owner/);
  });

  it('a wrong-author spend is not a spend to the package either', async () => {
    const signed = await signSpend(fakeSigner(OWNER), template(), 1700000000);
    expect(parseGameInventorySpend({ ...signed, pubkey: STRANGER })).toBeNull();
  });
});

describe('establishing a signed spend', () => {
  const signed: NostrEvent = {
    id: 'e'.repeat(64),
    pubkey: OWNER,
    created_at: 1,
    kind: 1416,
    tags: [],
    content: '',
    sig: '',
  };

  function deps(
    outcomes: { relay: string; ok: boolean; error?: string; indefinite?: boolean }[],
    found: NostrEvent[] = [],
  ): SpendPublishDeps & { publish: ReturnType<typeof vi.fn>; findById: ReturnType<typeof vi.fn> } {
    return {
      publish: vi.fn(async () => outcomes),
      findById: vi.fn(async () => ({ events: found, answered: true })),
    };
  }

  it('sends the SAME event object to the relays', async () => {
    const d = deps([{ relay: 'r1', ok: true }, { relay: 'r2', ok: true }]);
    await establishSpend(d, signed);
    expect(d.publish).toHaveBeenCalledWith(signed);
  });

  it('one accepting relay establishes it', async () => {
    const d = deps([{ relay: 'r1', ok: true }, { relay: 'r2', ok: false, error: 'blocked' }]);
    expect(await establishSpend(d, signed)).toEqual({ status: 'established', acceptedRelays: ['r1'], via: 'accepted' });
    expect(d.findById).not.toHaveBeenCalled();
  });

  it('silence searches for the exact id; found = established', async () => {
    const d = deps([{ relay: 'r1', ok: false, error: 'Timed out', indefinite: true }], [signed]);
    expect(await establishSpend(d, signed)).toMatchObject({ status: 'established', via: 'found' });
    expect(d.findById).toHaveBeenCalledWith(signed.id);
  });

  it('silence and not found = unconfirmed, never rejected', async () => {
    const d = deps([{ relay: 'r1', ok: false, error: 'Timed out', indefinite: true }]);
    expect(await establishSpend(d, signed)).toMatchObject({ status: 'unconfirmed' });
  });

  it('a definite refusal from every relay = rejected', async () => {
    const d = deps([{ relay: 'r1', ok: false, error: 'invalid' }, { relay: 'r2', ok: false, error: 'blocked' }]);
    expect(await establishSpend(d, signed)).toMatchObject({ status: 'rejected' });
    expect(d.findById).not.toHaveBeenCalled();
  });

  it('a found event with a different id does not count', async () => {
    const d = deps([{ relay: 'r1', ok: false, error: 'Timed out', indefinite: true }], [{ ...signed, id: 'f'.repeat(64) }]);
    expect(await establishSpend(d, signed)).toMatchObject({ status: 'unconfirmed' });
  });

  it('retrying republishes the identical event; no signer involved', async () => {
    const d = deps([{ relay: 'r1', ok: false, error: 'Timed out', indefinite: true }]);
    await establishSpend(d, signed);
    const again = deps([{ relay: 'r1', ok: true }]);
    await establishSpend(again, signed);
    expect(again.publish.mock.calls[0][0]).toBe(signed);
  });
});
