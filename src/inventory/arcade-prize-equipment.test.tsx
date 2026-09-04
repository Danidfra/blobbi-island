/**
 * A redeemed prize is immediately equippable through the NORMAL paths.
 *
 * Nothing about the Arcade appears in these tests, and that is the point. The
 * wardrobe (`useEquippableCosmetics`) and the effects panel
 * (`useOwnedVisualEffects`) ask one question, "does kind:31633 hold this
 * official item?": and an atomic redemption answers it by putting the item
 * there. No arcade-specific unlock, no second registry, no special case.
 *
 * The other half of the claim is the separation: owning is kind:31633,
 * wearing is kind:31634, and a grant writes only the first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const OWNER = 'a'.repeat(64);

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { query: async () => [], event: async () => {} } }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: OWNER, signer: {} } }),
}));
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: { relayUrl: 'wss://example.invalid' } }),
}));

import { buildGameInventoryEvent } from './package';
import { ISLAND_INVENTORY_D } from './constants';
import {
  parseInventoryEvent,
  parseOfficialItemDefinition,
  resolveFromDefinition,
} from './protocol-adapter';
import { inventoryQueryKey } from './useIslandInventory';
import { ITEM_CATALOG_QUERY_KEY, type ItemCatalog } from './useItemCatalog';
import { clearConfirmedInventories, recordConfirmedInventory } from './confirmed-inventory';
import type { ResolvedBlobbiItemDefinition } from './catalog-fallback';
import { createArcadeCosmeticRedeemer } from './arcade-cosmetic-redeemer';
import {
  OFFICIAL_ARCADE_PRIZE_CATALOG,
  officialArcadePrizeAsRedeemable,
} from '@/arcade/prizes/official-prize-catalog';
import { OFFICIAL_ITEM_EVENT_FIXTURES } from '@/effects/official-item-event-fixtures';
import { useEquippableCosmetics } from '@/placement/useEquippableCosmetics';
import { useOwnedVisualEffects } from '@/effects/useOwnedVisualEffects';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';

const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);
const ACCESSORY_PRIZES = OFFICIAL_ARCADE_PRIZE_CATALOG.filter((p) => p.kind === 'accessory');
const EFFECT_PRIZES = OFFICIAL_ARCADE_PRIZE_CATALOG.filter((p) => p.kind === 'effect');

/** The slot each wearable prize declares in its published definition. */
const EXPECTED_SLOTS: Record<string, string> = {
  'blobbi:cosmetic:block-builder-cap': 'headwear',
  'blobbi:cosmetic:stargazer-glasses': 'eyewear',
  'blobbi:cosmetic:starlight-bow-tie': 'neckwear',
};

function fixtureCatalog(): ItemCatalog {
  const byAddress = new Map<string, ResolvedBlobbiItemDefinition>();
  for (const { event } of OFFICIAL_ITEM_EVENT_FIXTURES) {
    const parsed = parseOfficialItemDefinition(event);
    if (parsed) byAddress.set(parsed.address, resolveFromDefinition(parsed));
  }
  return {
    byAddress,
    fetchedCount: 16,
    totalCount: 16,
    cosmeticsFetched: 4,
    cosmeticsTotal: 4,
    effectItemsFetched: 12,
    effectItemsTotal: 12,
  };
}

function inventoryEvent(
  items: { address: string; quantity: number }[],
  createdAt = 100,
): NostrEvent {
  const template = buildGameInventoryEvent({ id: ISLAND_INVENTORY_D, items });
  return {
    id: `inv-${createdAt}`,
    pubkey: OWNER,
    created_at: createdAt,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
}

function harness(items: { address: string; quantity: number }[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(
    inventoryQueryKey(OWNER),
    parseInventoryEvent(inventoryEvent(items))!,
  );
  client.setQueryData(ITEM_CATALOG_QUERY_KEY, fixtureCatalog());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

beforeEach(() => {
  clearConfirmedInventories();
});

describe('a redeemed wearable is recognised by the normal wardrobe', () => {
  it('is not offered while it is only a prize on the shelf', () => {
    const { wrapper } = harness([{ address: TICKET_ADDRESS, quantity: 5000 }]);
    const { result } = renderHook(() => useEquippableCosmetics('adult'), { wrapper });
    for (const prize of ACCESSORY_PRIZES) {
      expect(result.current.available.map((c) => c.address)).not.toContain(
        prize.itemAddress,
      );
      expect(
        result.current.unavailable.find((c) => c.address === prize.itemAddress)?.reason,
        prize.d,
      ).toBe('not-owned');
    }
  });

  it('becomes equippable, in its published slot, the moment it is owned', () => {
    const { wrapper } = harness(
      ACCESSORY_PRIZES.map((p) => ({ address: p.itemAddress, quantity: 1 })),
    );
    const { result } = renderHook(() => useEquippableCosmetics('adult'), { wrapper });

    for (const prize of ACCESSORY_PRIZES) {
      const entry = result.current.available.find((c) => c.address === prize.itemAddress);
      expect(entry, prize.d).toBeDefined();
      expect(entry!.slot).toBe(EXPECTED_SLOTS[prize.d]);
      expect(entry!.quantity).toBe(1);
    }
  });

  it('is owned but NOT worn, a grant never equips', () => {
    const { wrapper } = harness(
      ACCESSORY_PRIZES.map((p) => ({ address: p.itemAddress, quantity: 1 })),
    );
    const { result } = renderHook(() => useEquippableCosmetics('adult'), { wrapper });
    // `useEquippableCosmetics` answers ownership only. What is WORN comes from
    // kind:31634, which this path never writes, the placement is `undefined`
    // for every freshly-owned prize.
    for (const entry of result.current.available) {
      expect(entry).not.toHaveProperty('placement');
    }
  });
});

describe('a redeemed effect is recognised by the normal effects panel', () => {
  it('is locked until owned, then available for its slot and form', () => {
    const { wrapper: empty } = harness([{ address: TICKET_ADDRESS, quantity: 5000 }]);
    const locked = renderHook(() => useOwnedVisualEffects('adult'), { wrapper: empty });
    for (const prize of EFFECT_PRIZES) {
      expect(
        locked.result.current.unavailable.find((e) => e.address === prize.itemAddress)
          ?.reason,
        prize.d,
      ).toBe('not-owned');
    }

    const { wrapper: owned } = harness(
      EFFECT_PRIZES.map((p) => ({ address: p.itemAddress, quantity: 1 })),
    );
    const unlocked = renderHook(() => useOwnedVisualEffects('adult'), { wrapper: owned });
    for (const prize of EFFECT_PRIZES) {
      const entry = unlocked.result.current.available.find(
        (e) => e.address === prize.itemAddress,
      );
      expect(entry, prize.d).toBeDefined();
      expect(entry!.quantity).toBe(1);
      expect(entry!.registration.effectSlot).toBeTruthy();
    }
  });
});

describe('the handover from redemption to equipment', () => {
  it('the event the redeemer publishes is exactly what the wardrobe reads', async () => {
    // End to end across the seam, with no hand-built inventory in between: the
    // redeemer's own replacement event is parsed back and fed to the wardrobe.
    const prize = officialArcadePrizeAsRedeemable(ACCESSORY_PRIZES[0]);
    const published: NostrEvent[] = [];
    const base = inventoryEvent([{ address: TICKET_ADDRESS, quantity: 5000 }]);

    const { writer } = createArcadeCosmeticRedeemer({
      nostr: {
        query: async () => [base],
        event: async (event) => {
          published.push(event);
        },
      },
      user: {
        pubkey: OWNER,
        signer: {
          getPublicKey: async () => OWNER,
          signEvent: async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) =>
            ({ ...t, id: 'signed', pubkey: OWNER, sig: 'sig' }) as NostrEvent,
        },
      } as never,
      prize,
    });

    await writer.spendTickets({
      redemptionId: `${prize.id}:a-1`,
      prizeId: prize.id,
      attemptId: 'a-1',
      price: prize.price,
      catalogueVersion: 'official-v2-inventory',
      status: 'spending',
      createdAt: 1,
      updatedAt: 1,
      attempts: 1,
      failure: null,
      quantityBefore: 5000,
      reconcileAttempts: 0,
    });
    expect(published).toHaveLength(1);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(inventoryQueryKey(OWNER), parseInventoryEvent(published[0])!);
    client.setQueryData(ITEM_CATALOG_QUERY_KEY, fixtureCatalog());
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useEquippableCosmetics('adult'), { wrapper });
    const entry = result.current.available.find(
      (c) => c.address === ACCESSORY_PRIZES[0].itemAddress,
    );
    expect(entry).toBeDefined();
    expect(entry!.slot).toBe(EXPECTED_SLOTS[ACCESSORY_PRIZES[0].d]);
    // …and the tickets really did leave, in that same event.
    expect(
      parseInventoryEvent(published[0])!.items.find((i) => i.address === TICKET_ADDRESS)
        ?.quantity,
    ).toBe(5000 - prize.price);
  });

  it('a stale relay answer cannot roll a confirmed redemption backwards', () => {
    // The reader folds this tab's confirmed event over a lagging relay answer,
    // which is what stops a just-redeemed prize from flickering away.
    const address = ACCESSORY_PRIZES[0].itemAddress;
    const confirmed = inventoryEvent(
      [{ address: TICKET_ADDRESS, quantity: 4800 }, { address, quantity: 1 }],
      200,
    );
    recordConfirmedInventory(OWNER, confirmed);

    // The cache holds the OLD state (the relay has not caught up)…
    const { wrapper } = harness([{ address: TICKET_ADDRESS, quantity: 5000 }]);
    const stale = renderHook(() => useEquippableCosmetics('adult'), { wrapper });
    expect(stale.result.current.available.map((c) => c.address)).not.toContain(address);

    // …and the confirmed newer event is the one that wins on the next read.
    const { wrapper: fresh } = harness([
      { address: TICKET_ADDRESS, quantity: 4800 },
      { address, quantity: 1 },
    ]);
    const after = renderHook(() => useEquippableCosmetics('adult'), { wrapper: fresh });
    expect(after.result.current.available.map((c) => c.address)).toContain(address);
  });
});
