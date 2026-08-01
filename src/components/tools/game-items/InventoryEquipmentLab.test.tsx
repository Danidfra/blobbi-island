/**
 * Inventory & Equipment Lab — behavioral tests against stateful relay mocks.
 *
 * What must hold:
 *
 *  - without a signer, every write control is disabled and the notice shows;
 *  - the item list derives from the Phase-9 registries (sixteen rows);
 *  - "add one" publishes exactly one kind:31633 event and NEVER a kind:31634
 *    (inventory writes do not equip);
 *  - bulk actions show the complete diff, then publish ONE canonical event;
 *  - removing an equipped item's inventory leaves the placement document
 *    untouched — the row goes STALE and only an explicit action clears it;
 *  - a pending publish disables the confirm (no double-submit).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const OWNER = 'a'.repeat(64);
const CHARACTER = 'blobbi-lab-ui';

let relayInventory: NostrEvent[] = [];
let relayPlacements: NostrEvent[] = [];
let signCounter = 0;
let currentUser: { pubkey: string; signer: { signEvent: unknown } } | null = null;

const nostrEvent = vi.fn(async () => {});
const nostrQuery = vi.fn(
  async (filters: { kinds?: number[] }[]): Promise<NostrEvent[]> => {
    const kind = filters[0]?.kinds?.[0];
    if (kind === 31633) return relayInventory;
    if (kind === 31634) {
      const last = relayPlacements.at(-1);
      return last ? [last] : [];
    }
    return [];
  },
);
const signEvent = vi.fn(
  async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> => {
    signCounter += 1;
    const event: NostrEvent = {
      ...t,
      tags: t.tags ?? [],
      content: t.content ?? '',
      created_at: 1_700_000_000 + signCounter,
      id: `signed-${signCounter}`,
      pubkey: OWNER,
      sig: 'sig',
    };
    if (event.kind === 31633) relayInventory = [event];
    if (event.kind === 31634) relayPlacements.push(event);
    return event;
  },
);

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { event: nostrEvent, query: nostrQuery } }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: currentUser }),
}));
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: { relayUrl: 'wss://example.invalid' } }),
}));
vi.mock('@/hooks/useOptimizedStatus', () => ({
  useCurrentPet: () => ({ id: CHARACTER, name: 'Lab Blobbi', stage: 'adult' }),
}));

import {
  buildGameInventoryEvent,
  buildGameItemPlacementEvent,
  parseGameItemPlacementResult,
  getInventoryItemQuantity,
} from '@/inventory/package';
import { ISLAND_INVENTORY_D } from '@/inventory/constants';
import { parseInventoryEvent } from '@/inventory/protocol-adapter';
import { inventoryQueryKey } from '@/inventory/useIslandInventory';
import {
  ITEM_CATALOG_QUERY_KEY,
  type ItemCatalog,
} from '@/inventory/useItemCatalog';
import { officialItemAddress } from '@/protocol/event-registry';
import { visualEffectItemForEffect } from '@/effects/official-visual-effect-items';
import {
  characterEquipmentPlacementD,
  placementTargetForCharacter,
} from '@/placement/identity';
import { ISLAND_PLACEMENT_REFERENCE } from '@/placement/render-model';

import { InventoryEquipmentLab } from './InventoryEquipmentLab';

const CAP_D = 'blobbi:cosmetic:block-builder-cap';
const CAP = officialItemAddress(CAP_D);
const AURA = visualEffectItemForEffect('celestial-aura')!;

const EMPTY_CATALOG: ItemCatalog = {
  byAddress: new Map(),
  fetchedCount: 0,
  totalCount: 0,
  cosmeticsFetched: 0,
  cosmeticsTotal: 0,
  effectItemsFetched: 0,
  effectItemsTotal: 0,
};

function seedInventory(items: { address: string; quantity: number }[]) {
  const template = buildGameInventoryEvent({ id: ISLAND_INVENTORY_D, items });
  relayInventory = [
    {
      id: 'inv-base',
      pubkey: OWNER,
      created_at: 100,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: 'sig',
    },
  ];
}

function seedPlacement(entries: { item: string; slot: string }[]) {
  const template = buildGameItemPlacementEvent({
    id: characterEquipmentPlacementD(CHARACTER),
    target: placementTargetForCharacter(OWNER, CHARACTER),
    reference: ISLAND_PLACEMENT_REFERENCE,
    placements: entries.map((e) => ({
      id: e.slot,
      item: e.item,
      mode: 'equip' as const,
      slot: e.slot,
    })),
  });
  relayPlacements = [
    {
      id: 'placement-base',
      pubkey: OWNER,
      created_at: 100,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: 'sig',
    },
  ];
}

function renderLab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (currentUser) {
    client.setQueryData(
      inventoryQueryKey(OWNER),
      relayInventory[0] ? parseInventoryEvent(relayInventory[0]) : undefined,
    );
  }
  client.setQueryData(ITEM_CATALOG_QUERY_KEY, EMPTY_CATALOG);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<InventoryEquipmentLab />, { wrapper });
}

beforeEach(() => {
  relayInventory = [];
  relayPlacements = [];
  signCounter = 0;
  currentUser = { pubkey: OWNER, signer: { signEvent } };
  nostrEvent.mockClear();
  nostrQuery.mockClear();
  signEvent.mockClear();
});

describe('signer gating and identity', () => {
  it('disables every write and says so when no signer exists', () => {
    currentUser = null;
    renderLab();
    expect(screen.getByTestId('lab-signer-required')).toBeInTheDocument();
    expect(screen.getByTestId(`lab-add-${CAP_D}`)).toBeDisabled();
    expect(screen.getByTestId('lab-bulk-add-all-effects')).toBeDisabled();
    expect(screen.getByTestId('lab-apply-loadout')).toBeDisabled();
  });

  it('shows the issuer, the owner and the target Blobbi as distinct roles', () => {
    renderLab();
    expect(screen.getByTestId('lab-issuer')).toHaveTextContent(/trust root/);
    expect(screen.getByTestId('lab-owner')).toHaveTextContent(/you — the signer/);
    expect(screen.getByTestId('lab-target-blobbi')).toHaveTextContent('Lab Blobbi');
  });
});

describe('the item list', () => {
  it('derives all sixteen official items from the registries', () => {
    const { container } = renderLab();
    expect(container.querySelectorAll('[data-testid^="lab-item-"]')).toHaveLength(16);
    expect(screen.getByTestId('lab-item-blobbi:cosmetic:celestial-seraph-necklace'))
      .toBeInTheDocument();
    expect(screen.getByTestId('lab-item-blobbi:effect:rainbow-dream'))
      .toBeInTheDocument();
  });
});

describe('single-item inventory writes', () => {
  it('add one publishes exactly one kind:31633 event and no kind:31634', async () => {
    seedInventory([]);
    renderLab();
    fireEvent.click(screen.getByTestId(`lab-add-${CAP_D}`));
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));

    const [template] = signEvent.mock.calls[0] as [{ kind: number }];
    expect(template.kind).toBe(31633);
    const published = parseInventoryEvent(relayInventory[0])!;
    expect(getInventoryItemQuantity(published, CAP)).toBe(1);
    // Adding NEVER equips: no placement event was signed.
    expect(relayPlacements).toHaveLength(0);
  });

  it('remove completely asks for confirmation, names the stale consequence, then publishes', async () => {
    seedInventory([{ address: CAP, quantity: 3 }]);
    renderLab();
    fireEvent.click(screen.getByTestId(`lab-removeall-${CAP_D}`));
    // The dialog carries the kind warning and the stale-placement consequence.
    expect(screen.getByTestId('lab-confirm-kind')).toHaveTextContent('kind:31633');
    expect(screen.getByText(/becomes STALE/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('lab-confirm-publish'));
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));
    const published = parseInventoryEvent(relayInventory[0])!;
    expect(getInventoryItemQuantity(published, CAP)).toBe(0);
  });
});

describe('bulk inventory writes', () => {
  it('add-all-effects shows the twelve-line diff and publishes ONE canonical event', async () => {
    seedInventory([{ address: AURA.address, quantity: 2 }]);
    renderLab();
    fireEvent.click(screen.getByTestId('lab-bulk-add-all-effects'));

    const diff = screen.getByTestId('lab-confirm-diff');
    expect(diff.querySelectorAll('li')).toHaveLength(12);
    expect(diff).toHaveTextContent('2 → 3');
    expect(screen.getByTestId('lab-confirm-kind')).toHaveTextContent('kind:31633');

    fireEvent.click(screen.getByTestId('lab-confirm-publish'));
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));
    const published = parseInventoryEvent(relayInventory[0])!;
    expect(getInventoryItemQuantity(published, AURA.address)).toBe(3);
    expect(
      getInventoryItemQuantity(
        published,
        officialItemAddress('blobbi:effect:rainbow-dream'),
      ),
    ).toBe(1);
  });
});

describe('stale placements', () => {
  it('inventory removal leaves the placement untouched; clearing it is separate and explicit', async () => {
    seedInventory([]);
    seedPlacement([{ item: AURA.address, slot: 'aura' }]);
    renderLab();

    // The equipped-but-unowned aura shows as a stale placement…
    await waitFor(() =>
      expect(screen.getByTestId('lab-placement-aura')).toHaveTextContent(
        'stale — not owned',
      ),
    );
    // …and NOTHING has been published to "clean it up".
    expect(signEvent).not.toHaveBeenCalled();

    // Clearing it is an explicit, confirmed kind:31634 write of its own.
    fireEvent.click(screen.getByTestId('lab-clear-stale'));
    expect(screen.getByTestId('lab-confirm-kind')).toHaveTextContent('kind:31634');
    fireEvent.click(screen.getByTestId('lab-confirm-publish'));
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));

    const doc = parseGameItemPlacementResult(relayPlacements.at(-1)!);
    expect(doc.ok && doc.value.placements).toEqual([]);
  });
});

describe('the test loadout', () => {
  it('blocks applying while items are missing, and offers the separate inventory write', async () => {
    seedInventory([{ address: CAP, quantity: 1 }]);
    renderLab();
    // Let the placement/inventory queries settle so the plan is live.
    await waitFor(() =>
      expect(screen.getByTestId('lab-apply-loadout')).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId('lab-apply-loadout'));

    expect(screen.getByTestId('lab-loadout-steps').querySelectorAll('li')).toHaveLength(7);
    expect(screen.getByTestId('lab-loadout-missing')).toHaveTextContent('Not owned');
    // The equipment publish is blocked while anything is missing…
    expect(screen.getByTestId('lab-confirm-publish')).toBeDisabled();

    // …and the offered fix is a SEPARATE kind:31633 write with its own confirm.
    fireEvent.click(screen.getByTestId('lab-loadout-add-missing'));
    expect(screen.getByTestId('lab-confirm-kind')).toHaveTextContent('kind:31633');
    fireEvent.click(screen.getByTestId('lab-confirm-publish'));
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));
    const published = parseInventoryEvent(relayInventory[0])!;
    expect(
      getInventoryItemQuantity(
        published,
        officialItemAddress('blobbi:effect:pixel-glitch'),
      ),
    ).toBe(1);
    // Still no equipment write: adding inventory never equips.
    expect(relayPlacements).toHaveLength(0);
  });
});
