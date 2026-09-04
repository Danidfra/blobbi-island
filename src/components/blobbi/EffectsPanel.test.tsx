/**
 * EffectsPanel: behavioral tests for the player effect-management UI.
 *
 * What must hold:
 *
 *  - only OWNED official effects are actionable; unowned ones live in a locked
 *    list and never grow an equip button;
 *  - the card shows image/name/rarity/description and the equipped state;
 *  - same-slot replacement is announced by name before it happens, and the
 *    action reads Replace;
 *  - Preview hands the parent plain serializable data and calls NOTHING that
 *    publishes;
 *  - Remove targets the slot, not the inventory;
 *  - a pending publish disables every mutating button (no double-submit).
 *
 * Inventory and catalog are seeded straight into the query cache; the active
 * placement state arrives through the equipment context, as in production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

import { buildGameInventoryEvent } from '@/inventory/package';
import { ISLAND_INVENTORY_D } from '@/inventory/constants';
import { parseInventoryEvent, parseOfficialItemDefinition, resolveFromDefinition } from '@/inventory/protocol-adapter';
import { inventoryQueryKey } from '@/inventory/useIslandInventory';
import { ITEM_CATALOG_QUERY_KEY, type ItemCatalog } from '@/inventory/useItemCatalog';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';
import { visualEffectItemForEffect } from '@/effects/official-visual-effect-items';
import { fixtureByD } from '@/effects/official-item-event-fixtures';
import {
  CharacterEquipmentContext,
  NO_CHARACTER_EQUIPMENT,
} from '@/contexts/CharacterEquipmentContext';
import type { ActiveEffectPlacement } from '@/effects/active-effects';

import { EffectsPanel } from './EffectsPanel';

const AURA = visualEffectItemForEffect('celestial-aura')!;
const AURA_2 = visualEffectItemForEffect('solar-radiance')!;
const SPARKLES = visualEffectItemForEffect('golden-sparkles')!;

/** Resolve a fixture event into the catalog view model, via the real parser. */
function definitionOf(d: string): ResolvedBlobbiItemDefinition {
  const fixture = fixtureByD(d);
  if (!fixture) throw new Error(`no fixture for ${d}`);
  return resolveFromDefinition(parseOfficialItemDefinition(fixture.event)!);
}

function catalogWith(ds: string[]): ItemCatalog {
  const byAddress = new Map<string, ResolvedBlobbiItemDefinition>();
  for (const d of ds) {
    const def = definitionOf(d);
    byAddress.set(def.address, def);
  }
  return {
    byAddress,
    fetchedCount: 0,
    totalCount: 0,
    cosmeticsFetched: 0,
    cosmeticsTotal: 0,
    effectItemsFetched: ds.length,
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

function activePlacement(item: typeof AURA): ActiveEffectPlacement {
  return {
    entry: {
      id: item.effectSlot,
      item: item.address,
      mode: 'equip',
      slot: item.effectSlot,
    },
    registration: item,
  };
}

const handlers = {
  onEquip: vi.fn(),
  onRemove: vi.fn(),
  onPreview: vi.fn(),
};

beforeEach(() => {
  handlers.onEquip.mockClear();
  handlers.onRemove.mockClear();
  handlers.onPreview.mockClear();
});

/**
 * Select an effect's tile, revealing its detail panel.
 *
 * The panel became a paged tile grid with a detail area, so the verbs moved out
 * of every card and into the one selected item, the same selection→detail
 * pattern the rest of the wardrobe uses. Every assertion below is the same;
 * they just have to pick something up before acting on it.
 */
function selectEffect(effectId: string) {
  fireEvent.click(screen.getByTestId(`effect-card-${effectId}`));
}

function renderPanel(options: {
  owned: { address: string; quantity: number }[];
  active?: ActiveEffectPlacement[];
  stage?: string;
  isPublishing?: boolean;
  previewingEffectId?: string | null;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(inventoryQueryKey(OWNER), inventoryOf(options.owned));
  client.setQueryData(
    ITEM_CATALOG_QUERY_KEY,
    catalogWith([AURA.d, AURA_2.d, SPARKLES.d]),
  );

  const active = options.active ?? [];
  const equipment = {
    ...NO_CHARACTER_EQUIPMENT,
    activeEffects: active,
    effects: active.map((a) => ({ id: a.registration.effectId })),
  };

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <CharacterEquipmentContext.Provider value={equipment}>
        {children}
      </CharacterEquipmentContext.Provider>
    </QueryClientProvider>
  );

  return render(
    <EffectsPanel
      stage={options.stage ?? 'adult'}
      onEquip={handlers.onEquip}
      onRemove={handlers.onRemove}
      onPreview={handlers.onPreview}
      previewingEffectId={options.previewingEffectId ?? null}
      isPublishing={options.isPublishing ?? false}
    />,
    { wrapper },
  );
}

describe('what is actionable', () => {
  it('shows owned effects with image, name, rarity and description; unowned ones are locked', () => {
    renderPanel({ owned: [{ address: AURA.address, quantity: 1 }] });

    // Owned: an art-first tile carrying the artwork and the name…
    const card = screen.getByTestId('effect-card-celestial-aura');
    expect(card).toHaveTextContent('Celestial Aura');
    expect(card.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('blossom.primal.net'),
    );

    // …and the rest on selection, in the detail panel.
    selectEffect('celestial-aura');
    const detail = screen.getByTestId('effect-detail');
    expect(detail).toHaveTextContent('Celestial Aura');
    expect(detail).toHaveTextContent('legendary');
    expect(detail).toHaveTextContent(/celestial halo/);
    expect(screen.getByTestId('equip-celestial-aura')).toBeInTheDocument();

    // Unowned: no card, no equip control; only the locked list names it.
    expect(screen.queryByTestId('effect-card-solar-radiance')).toBeNull();
    expect(screen.queryByTestId('equip-solar-radiance')).toBeNull();
    expect(screen.getByText(/Solar Radiance/)).toBeInTheDocument();
    // Eleven unowned effects share the reason; at least one instance shows.
    expect(
      screen.getAllByText(/You do not own this yet/).length,
    ).toBeGreaterThan(0);
  });

  it('an egg makes owned effects unavailable with the form reason', () => {
    renderPanel({
      owned: [{ address: AURA.address, quantity: 1 }],
      stage: 'egg',
    });
    expect(screen.queryByTestId('equip-celestial-aura')).toBeNull();
    expect(
      screen.getByText(/does not support this Blobbi’s current form/),
    ).toBeInTheDocument();
  });
});

describe('equip, replace, remove', () => {
  it('equips an owned effect into its registered slot', () => {
    renderPanel({ owned: [{ address: AURA.address, quantity: 1 }] });
    selectEffect('celestial-aura');
    fireEvent.click(screen.getByTestId('equip-celestial-aura'));
    expect(handlers.onEquip).toHaveBeenCalledWith(AURA.address, 'aura');
  });

  it('announces exactly what a same-slot equip will replace, and labels it Replace', () => {
    renderPanel({
      owned: [
        { address: AURA.address, quantity: 1 },
        { address: AURA_2.address, quantity: 1 },
      ],
      active: [activePlacement(AURA)],
    });
    selectEffect('solar-radiance');
    expect(
      screen.getByTestId('replace-warning-solar-radiance'),
    ).toHaveTextContent(
      // "Activating", since the tile grid replaced the card list, the verb on
      // the button is Replace either way.
      'Activating Solar Radiance will replace Celestial Aura in the Aura slot.',
    );
    const button = screen.getByTestId('equip-solar-radiance');
    expect(button).toHaveTextContent('Replace');
    fireEvent.click(button);
    expect(handlers.onEquip).toHaveBeenCalledWith(AURA_2.address, 'aura');
  });

  it('a different-slot effect shows no replace warning', () => {
    renderPanel({
      owned: [
        { address: AURA.address, quantity: 1 },
        { address: SPARKLES.address, quantity: 1 },
      ],
      active: [activePlacement(AURA)],
    });
    expect(screen.queryByTestId('replace-warning-golden-sparkles')).toBeNull();
    selectEffect('golden-sparkles');
    expect(screen.getByTestId('equip-golden-sparkles')).toHaveTextContent('Activate');
  });

  it('shows the equipped state and removes by slot only', () => {
    renderPanel({
      owned: [{ address: AURA.address, quantity: 1 }],
      active: [activePlacement(AURA)],
    });
    expect(
      (selectEffect('celestial-aura'), screen.getByTestId('effect-detail')),
    // The badge reads "Active" since the polish pass, "equipped" is what a
    // developer calls it, "Active" is what the effect IS to a player.
    ).toHaveTextContent('Active');
    fireEvent.click(screen.getByTestId('remove-celestial-aura'));
    expect(handlers.onRemove).toHaveBeenCalledWith('aura');
    expect(handlers.onEquip).not.toHaveBeenCalled();
  });
});

describe('preview', () => {
  it('starts a preview with plain serializable data and publishes nothing', () => {
    renderPanel({ owned: [{ address: AURA.address, quantity: 1 }] });
    selectEffect('celestial-aura');
    fireEvent.click(screen.getByTestId('preview-celestial-aura'));
    expect(handlers.onPreview).toHaveBeenCalledWith([{ id: 'celestial-aura' }]);
    const payload = handlers.onPreview.mock.calls[0]![0];
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
    expect(handlers.onEquip).not.toHaveBeenCalled();
    expect(handlers.onRemove).not.toHaveBeenCalled();
  });

  it('ends the preview with null, restoring the persisted view', () => {
    renderPanel({
      owned: [{ address: AURA.address, quantity: 1 }],
      previewingEffectId: 'celestial-aura',
    });
    selectEffect('celestial-aura');
    expect(screen.getByTestId('effect-detail')).toHaveTextContent(
      'Previewing',
    );
    fireEvent.click(screen.getByTestId('preview-celestial-aura'));
    expect(handlers.onPreview).toHaveBeenCalledWith(null);
  });
});

describe('pending publish', () => {
  it('disables every mutating action while a publish is in flight', () => {
    renderPanel({
      owned: [
        { address: AURA.address, quantity: 1 },
        { address: SPARKLES.address, quantity: 1 },
      ],
      active: [activePlacement(AURA)],
      isPublishing: true,
    });
    selectEffect('celestial-aura');
    expect(screen.getByTestId('remove-celestial-aura')).toBeDisabled();
    selectEffect('golden-sparkles');
    expect(screen.getByTestId('equip-golden-sparkles')).toBeDisabled();
    fireEvent.click(screen.getByTestId('equip-golden-sparkles'));
    expect(handlers.onEquip).not.toHaveBeenCalled();
  });
});

describe('stale placements', () => {
  it('lists a stale equipped effect with a remove action', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(inventoryQueryKey(OWNER), inventoryOf([]));
    client.setQueryData(ITEM_CATALOG_QUERY_KEY, catalogWith([AURA.d]));
    const equipment = {
      ...NO_CHARACTER_EQUIPMENT,
      rejectedEffects: [
        {
          entry: {
            id: 'aura',
            item: AURA.address,
            mode: 'equip' as const,
            slot: 'aura',
          },
          registration: AURA,
          reason: 'not-owned' as const,
        },
      ],
    };
    render(
      <QueryClientProvider client={client}>
        <CharacterEquipmentContext.Provider value={equipment}>
          <EffectsPanel
            stage="adult"
            onEquip={handlers.onEquip}
            onRemove={handlers.onRemove}
            onPreview={handlers.onPreview}
            previewingEffectId={null}
          />
        </CharacterEquipmentContext.Provider>
      </QueryClientProvider>,
    );
    // Stale placements moved into the compact disclosure, so a player with no
    // problems pays no vertical space for them. The remove action is still
    // there, inside it.
    expect(screen.getByTestId('effect-diagnostics')).toHaveTextContent(
      /effects? you no longer own/i,
    );
    fireEvent.click(screen.getByTestId('remove-stale-aura'));
    expect(handlers.onRemove).toHaveBeenCalledWith('aura');
  });
});
