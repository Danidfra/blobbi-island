/**
 * The arcade turnstile.
 *
 * A Token is meaningful money, so the questions worth pinning are: is exactly
 * one charged per admitted run, is nothing charged when a run does not start,
 * and does an active Pass make a play provably free rather than refunded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const PUBKEY = 'f'.repeat(64);

const mutateInventory = vi.fn();

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: PUBKEY } }),
}));
vi.mock('@/inventory/useInventoryMutation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory/useInventoryMutation')>();
  return { ...actual, useInventoryMutation: () => ({ mutateAsync: mutateInventory }) };
});

let inventoryData: { data: unknown; isLoading: boolean; isError: boolean };
vi.mock('@/inventory/useIslandInventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory/useIslandInventory')>();
  return { ...actual, useIslandInventory: () => inventoryData };
});

import { BLOBBI_DANCE_GAME_ID } from '@/arcade/catalogue';
import { InventoryTransactionError } from '@/inventory/inventory-transaction';
import { parseInventoryEvent } from '@/inventory/protocol-adapter';
import { clearArcadePasses, grantArcadePass } from '@/arcade/pass/arcade-pass-entitlement';
import { ARCADE_TOKEN_ADDRESS } from '@/arcade/tokens/arcade-token';
import { useArcadeGameEntry } from './useArcadeGameEntry';

const NOW = Date.UTC(2026, 7, 29, 12);

/** An inventory holding `tokens` Arcade Tokens. */
function inventoryWith(tokens: number) {
  const event: NostrEvent = {
    id: 'inv-1',
    pubkey: PUBKEY,
    created_at: 1_000,
    kind: 31633,
    tags: [
      ['d', 'blobbi:island'],
      ...(tokens > 0 ? [['a', ARCADE_TOKEN_ADDRESS, '', String(tokens)]] : []),
    ],
    content: '',
    sig: 'sig',
  };
  return parseInventoryEvent(event)!;
}

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

function renderEntry() {
  return renderHook(() => useArcadeGameEntry(() => NOW), { wrapper });
}

beforeEach(() => {
  mutateInventory.mockReset();
  mutateInventory.mockResolvedValue(undefined);
  clearArcadePasses();
  inventoryData = { data: inventoryWith(3), isLoading: false, isError: false };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('starting a run costs one Token', () => {
  it('charges exactly the policy cost, once', async () => {
    const { result } = renderEntry();
    let outcome;
    await act(async () => {
      outcome = await result.current.admit(BLOBBI_DANCE_GAME_ID);
    });

    expect(outcome).toMatchObject({ ok: true, charged: 1, waivedByPass: false });
    expect(mutateInventory).toHaveBeenCalledTimes(1);
    expect(mutateInventory.mock.calls[0][0]).toEqual({
      type: 'remove',
      address: ARCADE_TOKEN_ADDRESS,
      amount: 1,
    });
  });

  it('charges again for a second run', async () => {
    const { result } = renderEntry();
    await act(async () => {
      await result.current.admit(BLOBBI_DANCE_GAME_ID);
    });
    await act(async () => {
      await result.current.admit(BLOBBI_DANCE_GAME_ID);
    });
    // Two runs are two Tokens — a replay is a play like any other.
    expect(mutateInventory).toHaveBeenCalledTimes(2);
  });

  it('every supported game reads its cost from the shared policy', () => {
    const { result } = renderEntry();
    for (const gameId of ['blobbi-dance', 'blobbi-air-hockey', 'blobbi-pool']) {
      expect(result.current.costFor(gameId)).toBe(1);
    }
    // Something the policy has never heard of is not charged a guessed price.
    expect(result.current.costFor('not-a-game')).toBe(0);
  });
});

describe('nothing is charged when a run does not start', () => {
  it('refuses without enough Tokens, writing nothing', async () => {
    inventoryData = { data: inventoryWith(0), isLoading: false, isError: false };
    const { result } = renderEntry();
    let outcome;
    await act(async () => {
      outcome = await result.current.admit(BLOBBI_DANCE_GAME_ID);
    });

    expect(outcome).toEqual({ ok: false, reason: 'insufficient-tokens', needed: 1 });
    expect(mutateInventory).not.toHaveBeenCalled();
  });

  it('two starts in one tick admit ONE run and charge once', async () => {
    const { result } = renderEntry();
    let first, second;
    await act(async () => {
      const a = result.current.admit(BLOBBI_DANCE_GAME_ID);
      const b = result.current.admit(BLOBBI_DANCE_GAME_ID);
      [first, second] = await Promise.all([a, b]);
    });

    const admitted = [first, second].filter((o) => (o as { ok: boolean }).ok);
    expect(admitted).toHaveLength(1);
    expect(second).toEqual({ ok: false, reason: 'busy' });
    expect(mutateInventory).toHaveBeenCalledTimes(1);
  });

  it('an unconfirmed spend does NOT start the run', async () => {
    mutateInventory.mockRejectedValue(
      new InventoryTransactionError('timed out', 'publish-timeout'),
    );
    const { result } = renderEntry();
    let outcome;
    await act(async () => {
      outcome = await result.current.admit(BLOBBI_DANCE_GAME_ID);
    });

    // The spend may have landed; admitting anyway would be a free play.
    expect(outcome).toEqual({ ok: false, reason: 'unconfirmed' });
  });

  it('an unknown balance is neither a zero balance nor a licence to charge', async () => {
    inventoryData = { data: undefined, isLoading: true, isError: false };
    const { result } = renderEntry();
    let outcome;
    await act(async () => {
      outcome = await result.current.admit(BLOBBI_DANCE_GAME_ID);
    });

    expect(outcome).toEqual({ ok: false, reason: 'unavailable' });
    expect(mutateInventory).not.toHaveBeenCalled();
  });
});

describe('an active Pass makes a play free', () => {
  it('starts the run and writes nothing at all', async () => {
    grantArcadePass(PUBKEY, { redemptionId: 'r1', nowMs: NOW });
    const { result } = renderEntry();
    let outcome;
    await act(async () => {
      outcome = await result.current.admit(BLOBBI_DANCE_GAME_ID);
    });

    expect(outcome).toMatchObject({ ok: true, charged: 0, waivedByPass: true });
    // Provably unchanged, not refunded.
    expect(mutateInventory).not.toHaveBeenCalled();
  });

  it('lets a player with zero Tokens keep playing', async () => {
    inventoryData = { data: inventoryWith(0), isLoading: false, isError: false };
    grantArcadePass(PUBKEY, { redemptionId: 'r1', nowMs: NOW });
    const { result } = renderEntry();
    let outcome;
    await act(async () => {
      outcome = await result.current.admit(BLOBBI_DANCE_GAME_ID);
    });
    expect(outcome).toMatchObject({ ok: true, charged: 0 });
  });

  it('an EXPIRED pass waives nothing', async () => {
    grantArcadePass(PUBKEY, { redemptionId: 'r1', nowMs: NOW - 25 * 60 * 60 * 1000 });
    const { result } = renderEntry();
    let outcome;
    await act(async () => {
      outcome = await result.current.admit(BLOBBI_DANCE_GAME_ID);
    });

    expect(outcome).toMatchObject({ ok: true, charged: 1, waivedByPass: false });
    expect(mutateInventory).toHaveBeenCalledTimes(1);
  });

  it('a pass belonging to another account waives nothing here', async () => {
    grantArcadePass('a'.repeat(64), { redemptionId: 'r1', nowMs: NOW });
    const { result } = renderEntry();
    let outcome;
    await act(async () => {
      outcome = await result.current.admit(BLOBBI_DANCE_GAME_ID);
    });
    expect(outcome).toMatchObject({ ok: true, charged: 1 });
  });
});
