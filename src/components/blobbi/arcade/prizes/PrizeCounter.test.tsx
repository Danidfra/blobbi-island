/**
 * The Prize Counter WITHOUT a redeem slot, against seeded real state.
 *
 * This is the counter's own surface — selection, resolution and preview — and
 * it must stay write-free even now that the arcade composes it with a live
 * redemption. Rendering `<PrizeCounter />` bare is what proves the component
 * itself sells nothing; the redeeming composition is covered by
 * `ArcadeCosmeticRedeemAction.test.tsx`.
 *
 * What must hold:
 *
 *  - the shelf shows exactly the SIX official prizes, resolved from the real
 *    kind:31632 catalog (real primary images, real names, real rarities);
 *  - Accessory/Effect distinction, ownership, equipped and affordability all
 *    display from the real inventory/equipment state;
 *  - the preview renders through the real renderer path and publishes nothing;
 *  - with no redeem slot there is no redeem control at all, and the honest
 *    "being prepared" message shows instead;
 *  - nothing in the flow signs, spends or mutates anything.
 *
 * Inventory and catalog are seeded straight into the query cache; the signer
 * mock records every signing attempt so "publishes nothing" is an assertion,
 * not an assumption.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const OWNER = 'a'.repeat(64);

const signEvent = vi.fn();
const nostrEvent = vi.fn();

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { query: async () => [], event: nostrEvent } }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: OWNER, signer: { signEvent } } }),
}));
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: { relayUrl: 'wss://example.invalid' } }),
}));
// The preview stage falls back to its sample Blobbi when no companion exists.
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
import {
  ITEM_CATALOG_QUERY_KEY,
  type ItemCatalog,
} from '@/inventory/useItemCatalog';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';
import {
  ARCADE_TICKET_D,
  officialItemAddress,
} from '@/protocol/event-registry';
import { OFFICIAL_ARCADE_PRIZE_CATALOG } from '@/arcade/prizes/official-prize-catalog';
import { OFFICIAL_ITEM_EVENT_FIXTURES } from '@/effects/official-item-event-fixtures';
import { visualEffectItemForEffect } from '@/effects/official-visual-effect-items';
import {
  CharacterEquipmentContext,
  NO_CHARACTER_EQUIPMENT,
} from '@/contexts/CharacterEquipmentContext';
import type { CharacterEquipment } from '@/placement/useCharacterEquipment';

import { PrizeCounter } from './PrizeCounter';

const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);
const CAP_ADDRESS = officialItemAddress('blobbi:cosmetic:block-builder-cap');
const AURA = visualEffectItemForEffect('celestial-aura')!;

/** The full published catalog, resolved from the sixteen signed fixtures. */
function fixtureCatalog(): ItemCatalog {
  const byAddress = new Map<string, ResolvedBlobbiItemDefinition>();
  for (const { event } of OFFICIAL_ITEM_EVENT_FIXTURES) {
    const parsed = parseOfficialItemDefinition(event);
    if (parsed) byAddress.set(parsed.address, resolveFromDefinition(parsed));
  }
  return {
    byAddress,
    fetchedCount: 0,
    totalCount: 0,
    cosmeticsFetched: 4,
    cosmeticsTotal: 4,
    effectItemsFetched: 12,
    effectItemsTotal: 12,
  };
}

function inventoryOf(items: { address: string; quantity: number }[]) {
  const template = buildGameInventoryEvent({ id: ISLAND_INVENTORY_D, items });
  const event: NostrEvent = {
    id: 'inv',
    pubkey: OWNER,
    created_at: 100,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
  return parseInventoryEvent(event)!;
}

beforeEach(() => {
  signEvent.mockClear();
  nostrEvent.mockClear();
});

function renderCounter(options: {
  tickets?: number;
  owned?: { address: string; quantity: number }[];
  equipment?: Partial<CharacterEquipment>;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(
    inventoryQueryKey(OWNER),
    inventoryOf([
      ...(options.tickets !== undefined
        ? [{ address: TICKET_ADDRESS, quantity: options.tickets }]
        : []),
      ...(options.owned ?? []),
    ]),
  );
  const catalog = fixtureCatalog();
  client.setQueryData(ITEM_CATALOG_QUERY_KEY, catalog);

  // Accessory artwork resolves through the equipment context's definitions
  // map, exactly as in production (where the app-root provider carries the
  // full catalog).
  const equipment = {
    ...NO_CHARACTER_EQUIPMENT,
    definitionsByAddress: catalog.byAddress,
    ...options.equipment,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <CharacterEquipmentContext.Provider value={equipment}>
        {children}
      </CharacterEquipmentContext.Provider>
    </QueryClientProvider>
  );
  return render(<PrizeCounter />, { wrapper });
}

describe('the shelf', () => {
  it('shows exactly the six official prizes with real published artwork and names', () => {
    const { container } = renderCounter({ tickets: 0 });
    const cards = container.querySelectorAll('[data-prize-card]');
    expect(cards).toHaveLength(6);

    for (const prize of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      const card = container.querySelector(`[data-prize-card="${prize.d}"]`);
      expect(card, prize.d).not.toBeNull();
      const img = card!.querySelector('img');
      expect(img?.getAttribute('src'), prize.d).toMatch(/blossom\.primal\.net/);
    }
    expect(screen.getByText('Block Builder Cap')).toBeInTheDocument();
    expect(screen.getByText('Celestial Aura')).toBeInTheDocument();
    // The reserved mythic necklace is NOT on the shelf.
    expect(screen.queryByText('Celestial Seraph Necklace')).toBeNull();
  });

  it('distinguishes accessories from effects, on the cards and through the filters', () => {
    const { container } = renderCounter({ tickets: 0 });
    expect(container.querySelectorAll('[data-prize-kind="accessory"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-prize-kind="effect"]')).toHaveLength(3);

    fireEvent.click(screen.getByRole('radio', { name: 'Effects' }));
    expect(container.querySelectorAll('[data-prize-card]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-prize-kind="accessory"]')).toHaveLength(0);
  });

  it('shows ticket prices and the balance, and marks affordability honestly', () => {
    const { container } = renderCounter({ tickets: 450 });
    // 450 tickets: cap (200) and sparkles (400) affordable; glasses (500) not.
    expect(
      container.querySelector('[data-prize-card="blobbi:cosmetic:block-builder-cap"]'),
    ).toHaveAttribute('data-prize-state', 'preview');
    expect(
      container.querySelector('[data-prize-card="blobbi:cosmetic:stargazer-glasses"]'),
    ).toHaveAttribute('data-prize-state', 'unaffordable');
    expect(
      container.querySelector('[data-prize-counter-balance="ready"]'),
    ).toHaveTextContent('450');
  });

  it('marks owned and equipped items from the real inventory and equipment state', () => {
    const { container } = renderCounter({
      tickets: 0,
      owned: [{ address: AURA.address, quantity: 1 }],
      equipment: {
        activeEffects: [
          {
            entry: { id: 'aura', item: AURA.address, mode: 'equip', slot: 'aura' },
            registration: AURA,
          },
        ],
      },
    });
    const auraCard = container.querySelector(
      '[data-prize-card="blobbi:effect:celestial-aura"]',
    ) as HTMLElement;
    expect(auraCard).toHaveAttribute('data-prize-state', 'owned');
    expect(within(auraCard).getByText(/Owned/)).toBeInTheDocument();
    expect(within(auraCard).getByText('Equipped')).toBeInTheDocument();
  });
});

describe('the detail panel and the preview', () => {
  it('opens a detail with description, slot, rarity — and the honest disabled-redemption message', () => {
    const { container } = renderCounter({ tickets: 100 });
    fireEvent.click(
      container.querySelector('[data-prize-card="blobbi:effect:celestial-aura"]')!,
    );
    const detail = container.querySelector(
      '[data-prize-detail="blobbi:effect:celestial-aura"]',
    ) as HTMLElement;
    expect(detail).not.toBeNull();
    expect(within(detail).getByText(/celestial halo/)).toBeInTheDocument();
    expect(container.querySelector('[data-prize-detail-slot="aura"]')).not.toBeNull();
    expect(
      within(detail).getByText(
        'Prize redemption is being prepared. You can preview rewards now.',
      ),
    ).toBeInTheDocument();
    // No redeem control exists anywhere — not disabled: ABSENT.
    expect(screen.queryByRole('button', { name: /redeem/i })).toBeNull();
  });

  it('previews an effect through the real renderer without signing or publishing', () => {
    const { container } = renderCounter({ tickets: 0 });
    fireEvent.click(
      container.querySelector('[data-prize-card="blobbi:effect:mystic-fog"]')!,
    );
    expect(container.querySelector('[data-prize-preview-stage]')).not.toBeNull();
    // The effect renders through the real effect path.
    expect(container.querySelector('[data-blobbi-effect="mystic-fog"]')).not.toBeNull();
    expect(signEvent).not.toHaveBeenCalled();
    expect(nostrEvent).not.toHaveBeenCalled();
  });

  it('previews an accessory with its published artwork, front and back, on the sample Blobbi', () => {
    const { container } = renderCounter({ tickets: 0 });
    fireEvent.click(
      container.querySelector('[data-prize-card="blobbi:cosmetic:block-builder-cap"]')!,
    );
    const stage = container.querySelector('[data-prize-preview-stage]') as HTMLElement;
    expect(stage.querySelector('img[src*="blossom"]')).not.toBeNull();
    expect(screen.getByText('Shown on a sample Blobbi')).toBeInTheDocument();

    // Flip to the back view; the cap has a published back image and stays on.
    fireEvent.click(container.querySelector('[data-prize-preview-facing]')!);
    expect(stage.querySelector('img[src*="blossom"]')).not.toBeNull();
    expect(signEvent).not.toHaveBeenCalled();
  });
});

describe('what this counter cannot do', () => {
  it('never signs, publishes, or mutates anything during a full browse of all six prizes', () => {
    const { container } = renderCounter({
      tickets: 5000,
      owned: [{ address: CAP_ADDRESS, quantity: 1 }],
    });
    for (const prize of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      fireEvent.click(container.querySelector(`[data-prize-card="${prize.d}"]`)!);
    }
    expect(signEvent).not.toHaveBeenCalled();
    expect(nostrEvent).not.toHaveBeenCalled();
  });
});
