/**
 * The cosmetic redemption, end to end through the real surface.
 *
 * The REAL Prize Counter, the REAL redeem control, the REAL redemption hook,
 * the REAL atomic redeemer and the REAL inventory cache sync — against a fake
 * relay. What is asserted is what a player would actually experience:
 *
 *   pick a prize → Redeem — 200 Tickets → one event → tickets down, prize owned
 *   → the shelf says Owned, with no reload and no second click possible.
 *
 * And the refusals: not enough tickets, already owned, and a preview that
 * looks at a prize without ever claiming to own or wear it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const OWNER = 'a'.repeat(64);

const published: NostrEvent[] = [];
const signEvent = vi.fn(async (template: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
  ...template,
  id: `signed-${signEvent.mock.calls.length}`,
  pubkey: OWNER,
  sig: 'sig',
}));
let relayEvents: NostrEvent[] = [];

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({
    nostr: {
      query: async () => relayEvents,
      event: async (event: NostrEvent) => {
        published.push(event);
      },
    },
  }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: OWNER, signer: { signEvent } } }),
}));
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: { relayUrl: 'wss://example.invalid' } }),
}));
vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => ({ data: [] }) }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({
  useBlobbonautProfile: () => ({ data: undefined }),
}));

import { buildGameInventoryEvent } from '@/inventory/package';
import { ISLAND_INVENTORY_D } from '@/inventory/constants';
import {
  parseInventoryEvent,
  parseOfficialItemDefinition,
  resolveFromDefinition,
} from '@/inventory/protocol-adapter';
import { inventoryQueryKey } from '@/inventory/useIslandInventory';
import { useInventoryCacheSync } from '@/inventory/useInventoryCacheSync';
import { clearConfirmedInventories } from '@/inventory/confirmed-inventory';
import {
  ITEM_CATALOG_QUERY_KEY,
  type ItemCatalog,
} from '@/inventory/useItemCatalog';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';
import { OFFICIAL_ARCADE_PRIZE_CATALOG } from '@/arcade/prizes/official-prize-catalog';
import { OFFICIAL_ITEM_EVENT_FIXTURES } from '@/effects/official-item-event-fixtures';
import {
  clearRedemptions,
  readRedemptions,
  resetRedemptionLocks,
} from '@/lib/arcade-redemption-ledger';
import {
  CharacterEquipmentContext,
  NO_CHARACTER_EQUIPMENT,
} from '@/contexts/CharacterEquipmentContext';

import { PrizeCounter } from './PrizeCounter';
import { ArcadeCosmeticRedeemAction } from './ArcadeCosmeticRedeemAction';

const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);
const CAP = OFFICIAL_ARCADE_PRIZE_CATALOG.find(
  (p) => p.d === 'blobbi:cosmetic:block-builder-cap',
)!;
const CAP_ADDRESS = CAP.itemAddress;

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

function itemsOf(event: NostrEvent): Record<string, number> {
  return Object.fromEntries(
    event.tags.filter(([name]) => name === 'a').map((tag) => [tag[1], Number(tag[3])]),
  );
}

function CacheSync() {
  // Exactly what the authenticated app root mounts: a confirmed write reaches
  // the shared inventory cache without any surface patching quantities.
  useInventoryCacheSync();
  return null;
}

beforeEach(() => {
  published.length = 0;
  signEvent.mockClear();
  relayEvents = [];
  localStorage.clear();
  clearRedemptions();
  resetRedemptionLocks();
  clearConfirmedInventories();
});

function renderCounter(
  options: {
    tickets?: number;
    owned?: { address: string; quantity: number }[];
    /** Render the counter WITHOUT a redeem slot — the preview-only shelf. */
    bare?: boolean;
  } = {},
) {
  const items = [
    ...(options.tickets !== undefined
      ? [{ address: TICKET_ADDRESS, quantity: options.tickets }]
      : []),
    ...(options.owned ?? []),
  ];
  const event = inventoryEvent(items);
  relayEvents = [event];

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(inventoryQueryKey(OWNER), parseInventoryEvent(event)!);
  const catalog = fixtureCatalog();
  client.setQueryData(ITEM_CATALOG_QUERY_KEY, catalog);

  const equipment = { ...NO_CHARACTER_EQUIPMENT, definitionsByAddress: catalog.byAddress };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <CharacterEquipmentContext.Provider value={equipment}>
        <CacheSync />
        {children}
      </CharacterEquipmentContext.Provider>
    </QueryClientProvider>
  );
  const view = render(
    options.bare ? (
      <PrizeCounter />
    ) : (
      <PrizeCounter
        redeemSlot={(resolved) => (
          <ArcadeCosmeticRedeemAction key={resolved.prize.d} resolved={resolved} />
        )}
      />
    ),
    { wrapper },
  );
  return { ...view, client };
}

/** Open the detail panel for one prize. */
function select(container: HTMLElement, d: string) {
  fireEvent.click(container.querySelector(`[data-prize-card="${d}"]`)!);
}

const redeemButton = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>('[data-prize-redeem-action="redeem"]');

describe('the shelf stops saying redemption is being prepared', () => {
  it('drops the standing preview notice once prizes can be bought', () => {
    const { container } = renderCounter({ tickets: 1000 });
    expect(container.querySelector('[data-prize-counter-preview-notice]')).toBeNull();
    select(container, CAP.d);
    expect(container.querySelector('[data-prize-redemption-disabled]')).toBeNull();
    expect(redeemButton(container)).not.toBeNull();
  });

  it('keeps the honest notice when no redeem slot is supplied', () => {
    // Without a slot the counter is exactly what it was — preview-only, and
    // saying so. The two states must not drift apart.
    const { container } = renderCounter({ tickets: 1000, bare: true });
    expect(container.querySelector('[data-prize-counter-preview-notice]')).not.toBeNull();
    select(container, CAP.d);
    expect(container.querySelector('[data-prize-redemption-disabled]')).not.toBeNull();
    expect(redeemButton(container)).toBeNull();
  });

  it('offers every one of the six prizes for its catalog price', () => {
    const { container } = renderCounter({ tickets: 10_000 });
    for (const prize of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      select(container, prize.d);
      const button = redeemButton(container)!;
      expect(button, prize.d).not.toBeNull();
      expect(button.textContent).toBe(`Redeem — ${prize.tickets} Tickets`);
      expect(button.disabled, prize.d).toBe(false);
    }
  });
});

describe('redeeming', () => {
  it('spends the tickets and grants the prize in ONE event', async () => {
    const { container } = renderCounter({ tickets: 500 });
    select(container, CAP.d);
    fireEvent.click(redeemButton(container)!);

    await waitFor(() => expect(published).toHaveLength(1));
    expect(itemsOf(published[0])).toEqual({
      [TICKET_ADDRESS]: 300,
      [CAP_ADDRESS]: 1,
    });
    expect(signEvent).toHaveBeenCalledTimes(1);
  });

  it('preserves unrelated inventory entries', async () => {
    const apple = officialItemAddress('blobbi:food:apple');
    const { container } = renderCounter({
      tickets: 500,
      owned: [{ address: apple, quantity: 4 }],
    });
    select(container, CAP.d);
    fireEvent.click(redeemButton(container)!);

    await waitFor(() => expect(published).toHaveLength(1));
    expect(itemsOf(published[0])[apple]).toBe(4);
  });

  it('updates the ticket balance and the Owned chip immediately — no reload', async () => {
    const { container } = renderCounter({ tickets: 500 });
    const balance = () =>
      container.querySelector('[data-prize-counter-balance]')!.textContent;
    expect(balance()).toContain('500');

    select(container, CAP.d);
    fireEvent.click(redeemButton(container)!);

    // The confirmed write reaches the shared cache; nothing here patches a
    // quantity by hand and nothing waits for a relay round trip.
    await waitFor(() => expect(balance()).toContain('300'));
    await waitFor(() => {
      const card = container.querySelector(`[data-prize-card="${CAP.d}"]`)!;
      expect(card.getAttribute('data-prize-state')).toBe('owned');
      expect(within(card as HTMLElement).getByText(/Owned/)).toBeInTheDocument();
    });
  });

  it('confirms in the panel and offers no second purchase', async () => {
    const { container } = renderCounter({ tickets: 500 });
    select(container, CAP.d);
    fireEvent.click(redeemButton(container)!);

    await waitFor(() =>
      expect(container.querySelector('[data-prize-redeem-state]')).not.toBeNull(),
    );
    expect(redeemButton(container)).toBeNull();
    expect(published).toHaveLength(1);
  });

  it('records the redemption as confirmed in the durable ledger', async () => {
    const { container } = renderCounter({ tickets: 500 });
    select(container, CAP.d);
    fireEvent.click(redeemButton(container)!);

    await waitFor(() => {
      const records = Object.values(readRedemptions(OWNER));
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        prizeId: CAP.d,
        price: CAP.tickets,
        status: 'confirmed',
        catalogueVersion: 'official-v2-inventory',
        attempts: 1,
      });
    });
  });

  it('cannot be double-charged by two clicks in one tick', async () => {
    const { container } = renderCounter({ tickets: 500 });
    select(container, CAP.d);
    const button = redeemButton(container)!;
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(published).toHaveLength(1));
    // Settle everything, then confirm it is still one.
    await waitFor(() =>
      expect(container.querySelector('[data-prize-redeem-state]')).not.toBeNull(),
    );
    expect(published).toHaveLength(1);
    expect(signEvent).toHaveBeenCalledTimes(1);
  });

  it('does not auto-equip what it grants', async () => {
    const { container } = renderCounter({ tickets: 500 });
    select(container, CAP.d);
    fireEvent.click(redeemButton(container)!);

    await waitFor(() => expect(published).toHaveLength(1));
    // Owning (kind:31633) and wearing (kind:31634) are different facts. Only
    // the inventory event was ever signed.
    for (const event of published) expect(event.kind).toBe(31633);
    expect(signEvent).toHaveBeenCalledTimes(1);
    const card = container.querySelector(`[data-prize-card="${CAP.d}"]`)!;
    expect(within(card as HTMLElement).queryByText('Equipped')).toBeNull();
  });
});

describe('refusals', () => {
  it('will not sell a prize the player cannot afford, and says the numbers', () => {
    const { container } = renderCounter({ tickets: 199 });
    select(container, CAP.d);

    const button = redeemButton(container)!;
    expect(button.disabled).toBe(true);
    expect(
      container.querySelector('[data-prize-redeem-reason="insufficient-tickets"]')!
        .textContent,
    ).toBe('You have 199 of 200 Arcade Tickets.');
    fireEvent.click(button);
    expect(published).toEqual([]);
    expect(signEvent).not.toHaveBeenCalled();
    // No reservation is recorded either — an insufficient balance must not
    // leave a ledger record that later looks like a pending redemption.
    expect(Object.values(readRedemptions(OWNER))).toEqual([]);
  });

  it('shows Owned instead of a price for a prize already held', () => {
    const { container } = renderCounter({
      tickets: 5000,
      owned: [{ address: CAP_ADDRESS, quantity: 1 }],
    });
    select(container, CAP.d);

    expect(redeemButton(container)).toBeNull();
    expect(
      container.querySelector('[data-prize-redeem-state="owned"]')!.textContent,
    ).toContain('Owned');
    expect(published).toEqual([]);
  });

  it('spends nothing for a prize already held, even with tickets to burn', () => {
    const { container } = renderCounter({
      tickets: 5000,
      owned: [{ address: CAP_ADDRESS, quantity: 1 }],
    });
    select(container, CAP.d);
    expect(signEvent).not.toHaveBeenCalled();
    expect(Object.values(readRedemptions(OWNER))).toEqual([]);
  });
});

describe('previewing is not owning', () => {
  it('renders the preview without writing inventory or equipment', () => {
    const { container } = renderCounter({ tickets: 0 });
    for (const prize of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      select(container, prize.d);
      // The panel is open and the prize is modelled…
      expect(container.querySelector(`[data-prize-detail="${prize.d}"]`)).not.toBeNull();
      // …and it says "Not yet", because previewing grants nothing.
      expect(
        container.querySelector('[data-prize-detail-owned]')!.textContent,
      ).toContain('Not yet');
    }
    expect(signEvent).not.toHaveBeenCalled();
    expect(published).toEqual([]);
    expect(Object.values(readRedemptions(OWNER))).toEqual([]);
  });
});
