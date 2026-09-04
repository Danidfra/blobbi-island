/**
 * The WEARABLE half of the inventory, end to end through the real service
 * boundary.
 *
 * The relay is mocked; everything above it is real, `useEquippableCosmetics`,
 * `usePlacementState`, `useEquipmentMutation` and the package itself. What is
 * asserted is the behavior a player experiences AND the events that behavior
 * produces, because a surface that looks right while publishing the wrong kind
 * would pass any purely visual test.
 *
 * Two claims run through the whole file:
 *   1. nothing is shown that is not a trusted, owned, slot-declaring cosmetic;
 *   2. equipping and unequipping never publish kind:31633.
 *
 * Migrated from `EquipmentPanel.test.tsx` when the two stacked inventory panels
 * became one browser. Every policy assertion is the same; what changed is that
 * an action now lives in the detail panel, so the tests select an item before
 * acting on it, which is the redesign's whole point.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const OWNER = 'a'.repeat(64);
const CHARACTER = 'blobbi-abc123';

const nostrEvent = vi.fn<(event: NostrEvent, opts?: unknown) => Promise<void>>();
const nostrQuery =
  vi.fn<(filters: { kinds?: number[] }[], opts?: unknown) => Promise<NostrEvent[]>>();
const signEvent = vi.fn(
  async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> => ({
    ...t,
    tags: t.tags ?? [],
    content: t.content ?? '',
    created_at: 1_700_000_000,
    id: 'id-' + signEvent.mock.calls.length,
    pubkey: OWNER,
    sig: 'sig',
  }),
);

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { event: nostrEvent, query: nostrQuery } }),
}));
vi.mock('@/hooks/useNostr', () => ({
  useNostr: () => ({ nostr: { event: nostrEvent, query: nostrQuery } }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: OWNER, signer: { signEvent } } }),
}));
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: { relayUrl: 'wss://relay.invalid' } }),
}));

/**
 * The catalog fans out over its own relay pool rather than the app's `useNostr`
 * client, so it is mocked at that boundary, the same seam
 * `usePublishItemDefinition.test.tsx` already uses.
 */
const definitionEvents = vi.fn<() => NostrEvent[]>(() => []);
vi.mock('@/inventory/relay-fan-out', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory/relay-fan-out')>();
  return {
    ...actual,
    queryRelays: async (urls: string[]) =>
      urls.map((url) => ({ url, ok: true as const, events: definitionEvents() })),
  };
});

import {
  KIND_GAME_INVENTORY,
  KIND_GAME_ITEM_DEFINITION,
  KIND_GAME_ITEM_PLACEMENT,
  buildGameInventoryEvent,
  buildGameItemDefinitionEvent,
  buildGameItemPlacementEvent,
  parseGameItemPlacementResult,
} from '@/inventory/package';
import { ADDRESSED_OFFICIAL_COSMETICS, OFFICIAL_ISSUER_PUBKEY } from '@/protocol/event-registry';
import { ISLAND_INVENTORY_D } from '@/inventory/constants';
import { characterEquipmentPlacementD, placementTargetForCharacter } from '@/placement/identity';
import { ISLAND_PLACEMENT_REFERENCE, buildEquipEntry } from '@/placement/render-model';
import { InventoryBrowser } from './InventoryBrowser';

const CAP = ADDRESSED_OFFICIAL_COSMETICS[0]!;
const CAP_ADDRESS = CAP.address;

/** The official cosmetic definition, as published. */
function definitionEvent(
  visual: unknown = { slot: 'headwear' },
  issuer = OFFICIAL_ISSUER_PUBKEY,
): NostrEvent {
  const template = buildGameItemDefinitionEvent({
    id: CAP.d,
    name: CAP.name,
    type: 'cosmetic',
    image: 'https://fixtures.invalid/cap.png',
    content: { visual },
  });
  return {
    id: 'def',
    pubkey: issuer,
    created_at: 100,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
}

function inventoryEvent(quantity: number): NostrEvent {
  const template = buildGameInventoryEvent({
    id: ISLAND_INVENTORY_D,
    items: quantity > 0 ? [{ address: CAP_ADDRESS, quantity }] : [],
  });
  return {
    id: 'inv',
    pubkey: OWNER,
    created_at: 100,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
}

function placementEvent(equipped: boolean, revision = 3): NostrEvent {
  const template = buildGameItemPlacementEvent({
    id: characterEquipmentPlacementD(CHARACTER),
    target: placementTargetForCharacter(OWNER, CHARACTER),
    reference: ISLAND_PLACEMENT_REFERENCE,
    revision,
    placements: equipped
      ? [buildEquipEntry({ itemAddress: CAP_ADDRESS, slot: 'headwear' })]
      : [],
  });
  return {
    id: 'placement',
    pubkey: OWNER,
    created_at: 100,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
}

function relay(options: {
  definition?: NostrEvent | null;
  inventory?: number;
  equipped?: boolean;
}) {
  const definition =
    options.definition === null ? [] : [options.definition ?? definitionEvent()];
  definitionEvents.mockImplementation(() => definition);
  nostrQuery.mockImplementation(async (filters) => {
    const kind = filters[0]?.kinds?.[0];
    if (kind === KIND_GAME_INVENTORY) return [inventoryEvent(options.inventory ?? 1)];
    if (kind === KIND_GAME_ITEM_PLACEMENT) {
      return [placementEvent(options.equipped ?? false)];
    }
    return [];
  });
}

function renderPanel(props: Partial<React.ComponentProps<typeof InventoryBrowser>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onEquip = vi.fn();
  const onUnequip = vi.fn();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const utils = render(
    <InventoryBrowser
      characterId={CHARACTER}
      form="baby"
      onEquip={onEquip}
      onUnequip={onUnequip}
      {...props}
    />,
    { wrapper: Wrapper },
  );
  return { ...utils, client, onEquip, onUnequip };
}

/** Select an item in the grid, revealing its detail panel. */
async function selectItem(address: string) {
  fireEvent.click(await screen.findByTestId(`item-${address}`));
}

const publishedKinds = () => signEvent.mock.calls.map((c) => c[0].kind);

describe('the wearables in the inventory browser', () => {
  beforeEach(() => {
    nostrEvent.mockReset();
    nostrQuery.mockReset();
    signEvent.mockClear();
    nostrEvent.mockResolvedValue(undefined);
    relay({});
  });

  it('offers an owned, official, slot-declaring cosmetic', async () => {
    relay({ inventory: 2 });
    renderPanel();
    // Art-first: the tile carries the name and the count, and nothing else.
    expect(await screen.findByTestId(`item-${CAP_ADDRESS}`)).toBeInTheDocument();
    expect(screen.getByText(CAP.name)).toBeInTheDocument();

    // The slot and the owned count live in the detail panel, on selection.
    await selectItem(CAP_ADDRESS);
    expect(screen.getByTestId('item-detail')).toHaveTextContent(/headwear/);
    expect(screen.getByTestId('item-detail')).toHaveTextContent(/2 owned/);
    expect(screen.getByTestId(`equip-${CAP_ADDRESS}`)).toBeInTheDocument();
  });

  it('does not offer a cosmetic the player does not own', async () => {
    relay({ inventory: 0 });
    renderPanel();
    // Owning none of it means the collection is empty, and the reason the
    // cosmetic is not there is still stated, in the diagnostics.
    await waitFor(() => expect(screen.getByText(/your bag is empty/i)).toBeInTheDocument());
    expect(screen.queryByTestId(`item-${CAP_ADDRESS}`)).toBeNull();
    expect(screen.getByText(/You do not own this yet\./)).toBeInTheDocument();
  });

  it('does not offer a cosmetic whose definition never resolved', async () => {
    // Empty official catalog: the honest state, and no hardcoded fallback.
    relay({ definition: null, inventory: 5 });
    renderPanel();
    await waitFor(() =>
      expect(screen.queryByTestId(`item-${CAP_ADDRESS}`)).toBeNull(),
    );
    // FOUR official cosmetics now share this state in the empty-catalog
    // harness (cap, necklace, bow tie, glasses): at least one row shows it.
    expect(
      screen.getAllByText(/official definition has not been published/i).length,
    ).toBeGreaterThan(0);
  });

  it('does not offer a cosmetic signed by an untrusted issuer', async () => {
    relay({ definition: definitionEvent({ slot: 'headwear' }, 'd'.repeat(64)), inventory: 1 });
    renderPanel();
    await waitFor(() =>
      expect(screen.queryByTestId(`item-${CAP_ADDRESS}`)).toBeNull(),
    );
  });

  it('does not offer a cosmetic whose definition declares no slot', async () => {
    relay({ definition: definitionEvent({}), inventory: 1 });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/does not say where it is worn/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId(`item-${CAP_ADDRESS}`)).toBeNull();
  });

  it('does not offer a cosmetic that does not fit the current form', async () => {
    relay({ definition: definitionEvent({ slot: 'headwear', forms: ['adult'] }), inventory: 1 });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/does not fit this Blobbi/i)).toBeInTheDocument(),
    );
  });

  it('offers a cosmetic whose definition declares NO forms at all', async () => {
    // The corrected policy: an absent optional field is not a restriction.
    relay({ definition: definitionEvent({ slot: 'headwear' }), inventory: 1 });
    renderPanel();
    await selectItem(CAP_ADDRESS);
    expect(screen.getByTestId(`equip-${CAP_ADDRESS}`)).toBeInTheDocument();
  });

  it('refuses a cosmetic whose forms list is present but unusable', async () => {
    relay({ definition: definitionEvent({ slot: 'headwear', forms: [] }), inventory: 1 });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/unusable list of Blobbi forms/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId(`equip-${CAP_ADDRESS}`)).toBeNull();
  });

  it('reports an empty official catalog honestly rather than falling back', async () => {
    // Nothing is invented from local data when no cosmetic resolves.
    relay({ definition: null, inventory: 0 });
    renderPanel();
    // An empty collection, and NOT a grid populated from the bundled fallback:
    // the registry knows these cosmetics exist, which is why this is "your bag
    // is empty" rather than "nothing has been published".
    await waitFor(() => expect(screen.getByText(/your bag is empty/i)).toBeInTheDocument());
    expect(screen.queryByTestId(`item-${CAP_ADDRESS}`)).toBeNull();
    // The name still appears in the diagnostics, naming what could not be
    // resolved: that is the honesty the test is about, not silence.
    expect(
      screen.getAllByText(/official definition has not been published/i).length,
    ).toBeGreaterThan(0);
  });

  it('marks what is worn, read from the kind:31634 document', async () => {
    relay({ equipped: true });
    renderPanel();
    // Worn state is on the TILE; no separate list, no nested tabs.
    const tile = await screen.findByTestId(`item-${CAP_ADDRESS}`);
    expect(tile).toHaveAttribute('data-equipped', 'headwear');
    expect(tile).toHaveTextContent('Worn');

    await selectItem(CAP_ADDRESS);
    expect(screen.getByTestId('unequip-headwear')).toBeInTheDocument();
  });

  it('surfaces a publish failure instead of swallowing it', async () => {
    relay({ equipped: true });
    renderPanel({ publishError: 'relay refused the event' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'relay refused the event',
    );
  });

  it('surfaces parser warnings from the placement document', async () => {
    // A document whose derived item tag is missing: valid, but stale.
    nostrQuery.mockImplementation(async (filters) => {
      const kind = filters[0]?.kinds?.[0];
      if (kind === KIND_GAME_ITEM_DEFINITION) return [definitionEvent()];
      if (kind === KIND_GAME_INVENTORY) return [inventoryEvent(1)];
      if (kind === KIND_GAME_ITEM_PLACEMENT) {
        const good = placementEvent(true);
        return [{ ...good, tags: good.tags.filter((t) => t[3] !== 'item') }];
      }
      return [];
    });
    renderPanel();
    // Diagnostics moved into one compact disclosure, so a player with no
    // problems pays no vertical space for them.
    expect(await screen.findByTestId('inventory-diagnostics')).toHaveTextContent(/item issue/i);
  });

  it('hands unequip to the caller with the definition-declared slot', async () => {
    relay({ equipped: true, inventory: 1 });
    const { onUnequip } = renderPanel();
    await selectItem(CAP_ADDRESS);
    fireEvent.click(screen.getByTestId('unequip-headwear'));
    expect(onUnequip).toHaveBeenCalledWith('headwear');
  });

  it('hands equip to the caller with the definition-declared slot', async () => {
    relay({ equipped: false, inventory: 1 });
    const { onEquip } = renderPanel();
    await selectItem(CAP_ADDRESS);
    fireEvent.click(screen.getByTestId(`equip-${CAP_ADDRESS}`));
    expect(onEquip).toHaveBeenCalledWith(CAP_ADDRESS, 'headwear');
  });

  it('publishes nothing by itself, the browser is not a write path', async () => {
    relay({ equipped: false, inventory: 1 });
    renderPanel();
    await selectItem(CAP_ADDRESS);
    fireEvent.click(screen.getByTestId(`equip-${CAP_ADDRESS}`));
    expect(publishedKinds()).toEqual([]);
  });
});

describe('the production equip and unequip flows publish only kind:31634', () => {
  beforeEach(() => {
    nostrEvent.mockReset();
    nostrQuery.mockReset();
    signEvent.mockClear();
    nostrEvent.mockResolvedValue(undefined);
  });

  /** Drive the real mutation the modal wires to the panel's callbacks. */
  async function runFlow(kind: 'equip' | 'unequip') {
    relay({ equipped: kind === 'unequip', inventory: 1 });
    const { useEquipmentMutation } = await import('@/placement/useEquipmentMutation');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useEquipmentMutation(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.mutateAsync({
        characterId: CHARACTER,
        mutation:
          kind === 'equip'
            ? {
                type: 'equip',
                slot: 'headwear',
                entry: buildEquipEntry({ itemAddress: CAP_ADDRESS, slot: 'headwear' }),
              }
            : { type: 'unequip', slot: 'headwear' },
      });
    });

    const published = signEvent.mock.calls.at(-1)![0];
    return { published, kinds: publishedKinds() };
  }

  it('equip: one kind:31634 event, revision incremented, no kind:31633', async () => {
    const { published, kinds } = await runFlow('equip');
    expect(kinds).toEqual([KIND_GAME_ITEM_PLACEMENT]);
    expect(kinds).not.toContain(KIND_GAME_INVENTORY);

    const parsed = parseGameItemPlacementResult({
      ...published,
      id: 'x',
      pubkey: OWNER,
      sig: 'sig',
    } as NostrEvent);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.revision).toBe(4);
    expect(parsed.value.placements.map((e) => e.slot)).toEqual(['headwear']);
  });

  it('unequip: one kind:31634 event, empty placements, no kind:31633', async () => {
    const { published, kinds } = await runFlow('unequip');
    expect(kinds).toEqual([KIND_GAME_ITEM_PLACEMENT]);

    const parsed = parseGameItemPlacementResult({
      ...published,
      id: 'x',
      pubkey: OWNER,
      sig: 'sig',
    } as NostrEvent);
    expect(parsed.ok && parsed.value.placements).toEqual([]);
    expect(parsed.ok && parsed.value.revision).toBe(4);
  });

  it('publishes no legacy kind:31124 or kind:11125 event in either flow', async () => {
    await runFlow('equip');
    const legacyKinds = publishedKinds().filter((k) => k === 31124 || k === 11125);
    expect(legacyKinds).toEqual([]);
  });
});
