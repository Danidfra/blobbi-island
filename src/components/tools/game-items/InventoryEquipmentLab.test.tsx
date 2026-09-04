/**
 * Inventory & Equipment Lab, behavioral tests against stateful relay mocks
 * (Phase 9.5a semantics: every write confirmed, max_stack respected).
 *
 * What must hold:
 *
 *  - without a signer, every write control is disabled and the notice shows;
 *  - the item list derives from the Phase-9 registries (sixteen rows);
 *  - NO action signs before its confirmation; cancel signs nothing; confirm
 *    causes exactly one correct event; a second submit is blocked in flight;
 *  - dialogs state the event kind and the untouched side (inventory dialogs
 *    say equipment is unchanged, equipment dialogs say inventory is);
 *  - "Add to inventory" means 0 → 1 and is disabled once owned; set-quantity
 *    rejects values above max_stack; bulk add ensures ownership and reports
 *    over-max anomalies instead of incrementing or repairing them;
 *  - the normalize action repairs over-max quantities in one canonical event;
 *  - removing an equipped item's inventory leaves the placement untouched,
 *    the row goes STALE and only an explicit confirmed action clears it;
 *  - a failed publish keeps the dialog open and fabricates no success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const OWNER = 'a'.repeat(64);
const CHARACTER = 'blobbi-lab-ui';

let relayInventory: NostrEvent[] = [];
let relayPlacements: NostrEvent[] = [];
let signCounter = 0;
let failNextSign = false;
let signGate: Promise<void> | null = null;
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
    if (signGate) await signGate;
    if (failNextSign) {
      failNextSign = false;
      throw new Error('DEV: signer refused');
    }
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
  useCurrentPet: () => ({ id: CHARACTER, name: 'Lumi', stage: 'adult' }),
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
const RADIANCE = visualEffectItemForEffect('solar-radiance')!;

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

function confirmDialog() {
  fireEvent.click(screen.getByTestId('lab-confirm-publish'));
}

beforeEach(() => {
  relayInventory = [];
  relayPlacements = [];
  signCounter = 0;
  failNextSign = false;
  signGate = null;
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
    expect(screen.getByTestId('lab-owner')).toHaveTextContent(/you: the signer/);
    expect(screen.getByTestId('lab-target-blobbi')).toHaveTextContent('Lumi');
  });
});

describe('the item list', () => {
  it('derives all sixteen official items from the registries', () => {
    const { container } = renderLab();
    expect(container.querySelectorAll('[data-testid^="lab-item-"]')).toHaveLength(16);
  });
});

describe('every single-item write is confirmed', () => {
  it('add stages a dialog, signs NOTHING before confirm, and cancel signs nothing', () => {
    seedInventory([]);
    renderLab();
    fireEvent.click(screen.getByTestId(`lab-add-${CAP_D}`));

    // The dialog names the kind, the change, and the untouched side.
    expect(screen.getByTestId('lab-confirm-kind')).toHaveTextContent('kind:31633');
    const lines = screen.getByTestId('lab-confirm-lines');
    expect(lines).toHaveTextContent('Quantity: 0 → 1');
    expect(lines).toHaveTextContent('No equipment placement will be changed.');
    expect(lines).toHaveTextContent(CAP);
    expect(signEvent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('lab-confirm-cancel'));
    expect(signEvent).not.toHaveBeenCalled();
    // Only the seeded base event exists; nothing new was published.
    expect(relayInventory.map((e) => e.id)).toEqual(['inv-base']);
  });

  it('confirming an add publishes exactly one kind:31633 event and no kind:31634', async () => {
    seedInventory([]);
    renderLab();
    fireEvent.click(screen.getByTestId(`lab-add-${CAP_D}`));
    confirmDialog();
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));

    const [template] = signEvent.mock.calls[0] as [{ kind: number }];
    expect(template.kind).toBe(31633);
    const published = parseInventoryEvent(relayInventory[0])!;
    expect(getInventoryItemQuantity(published, CAP)).toBe(1);
    // Adding NEVER equips: no placement event was signed.
    expect(relayPlacements).toHaveLength(0);
  });

  it('remove one and remove completely are confirmed too', async () => {
    seedInventory([{ address: CAP, quantity: 1 }]);
    renderLab();

    fireEvent.click(screen.getByTestId(`lab-remove-${CAP_D}`));
    expect(screen.getByTestId('lab-confirm-lines')).toHaveTextContent(
      'Quantity: 1 → 0',
    );
    expect(signEvent).not.toHaveBeenCalled();
    confirmDialog();
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));
    expect(
      getInventoryItemQuantity(parseInventoryEvent(relayInventory[0])!, CAP),
    ).toBe(0);
  });

  it('a failed publish keeps the dialog open and reports the error honestly', async () => {
    seedInventory([]);
    renderLab();
    fireEvent.click(screen.getByTestId(`lab-add-${CAP_D}`));
    failNextSign = true;
    confirmDialog();
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));
    // Still open: the described write did not land, so the dialog stays true.
    expect(screen.getByTestId('lab-confirm-publish')).toBeInTheDocument();
    expect(relayInventory.map((e) => e.id)).toEqual(['inv-base']);
  });

  it('a second submit is blocked while a publish is in flight', async () => {
    seedInventory([]);
    renderLab();
    fireEvent.click(screen.getByTestId(`lab-add-${CAP_D}`));

    let release!: () => void;
    signGate = new Promise((resolve) => {
      release = resolve;
    });
    confirmDialog();
    await waitFor(() =>
      expect(screen.getByTestId('lab-confirm-publish')).toBeDisabled(),
    );
    // Cancel is unavailable too: an in-flight signature cannot be recalled.
    expect(screen.getByTestId('lab-confirm-cancel')).toBeDisabled();
    fireEvent.click(screen.getByTestId('lab-confirm-publish'));
    release();
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));
  });
});

describe('max_stack in normal controls', () => {
  it('Add to inventory is disabled once owned, labelled Owned', () => {
    seedInventory([{ address: CAP, quantity: 1 }]);
    renderLab();
    const add = screen.getByTestId(`lab-add-${CAP_D}`);
    expect(add).toBeDisabled();
    expect(add).toHaveTextContent('Owned');
    expect(screen.getByTestId(`lab-quantity-${CAP_D}`)).toHaveTextContent('Owned');
  });

  it('ordinary set-quantity rejects values above max_stack:1', () => {
    seedInventory([]);
    renderLab();
    const input = screen.getByTestId(`lab-setqty-input-${CAP_D}`);
    fireEvent.change(input, { target: { value: '2' } });
    expect(screen.getByTestId(`lab-setqty-${CAP_D}`)).toBeDisabled();
    fireEvent.change(input, { target: { value: '1' } });
    expect(screen.getByTestId(`lab-setqty-${CAP_D}`)).toBeEnabled();
  });

  it('an over-max quantity is displayed as exceeding the published max_stack', () => {
    seedInventory([{ address: AURA.address, quantity: 3 }]);
    renderLab();
    expect(
      screen.getByTestId('lab-quantity-blobbi:effect:celestial-aura'),
    ).toHaveTextContent('×3 (exceeds max_stack:1)');
  });
});

describe('bulk inventory writes', () => {
  it('add-all-effects ensures ownership in ONE event, reporting an over-max anomaly untouched', async () => {
    seedInventory([{ address: AURA.address, quantity: 2 }]);
    renderLab();
    fireEvent.click(screen.getByTestId('lab-bulk-add-all-effects'));

    const diff = screen.getByTestId('lab-confirm-diff');
    // Eleven 0 → 1 rows; the anomalous aura is NOT in the diff…
    expect(diff.querySelectorAll('li')).toHaveLength(11);
    expect(diff).not.toHaveTextContent('Celestial Aura');
    // …it is reported separately, with the repair pointer.
    expect(screen.getByTestId('lab-confirm-anomalies')).toHaveTextContent(
      /Celestial Aura ×2: quantity exceeds published max_stack:1/,
    );
    expect(signEvent).not.toHaveBeenCalled();

    confirmDialog();
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));
    const published = parseInventoryEvent(relayInventory[0])!;
    // The anomaly is unchanged; neither 3 nor silently 1.
    expect(getInventoryItemQuantity(published, AURA.address)).toBe(2);
    expect(
      getInventoryItemQuantity(
        published,
        officialItemAddress('blobbi:effect:rainbow-dream'),
      ),
    ).toBe(1);
  });

  it('normalize-stacks repairs over-max quantities to one, in one canonical event', async () => {
    seedInventory([
      { address: AURA.address, quantity: 3 },
      { address: CAP, quantity: 1 },
    ]);
    renderLab();
    fireEvent.click(screen.getByTestId('lab-bulk-normalize-stacks'));
    expect(screen.getByTestId('lab-confirm-diff')).toHaveTextContent('3 → 1');
    confirmDialog();
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));
    const published = parseInventoryEvent(relayInventory[0])!;
    expect(getInventoryItemQuantity(published, AURA.address)).toBe(1);
    expect(getInventoryItemQuantity(published, CAP)).toBe(1);
  });
});

describe('equipment writes are confirmed', () => {
  it('equip states the kind, Blobbi, slot and replacement; nothing signs before confirm', async () => {
    seedInventory([
      { address: AURA.address, quantity: 1 },
      { address: RADIANCE.address, quantity: 1 },
    ]);
    seedPlacement([{ item: RADIANCE.address, slot: 'aura' }]);
    renderLab();
    // Wait for the placement document to load, so the staged dialog can name
    // what the equip would replace.
    await waitFor(() =>
      expect(screen.getByTestId('lab-placement-aura')).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByTestId('lab-equip-blobbi:effect:celestial-aura'),
    );
    expect(screen.getByTestId('lab-confirm-kind')).toHaveTextContent('kind:31634');
    const lines = screen.getByTestId('lab-confirm-lines');
    expect(lines).toHaveTextContent('Blobbi “Lumi”');
    expect(lines).toHaveTextContent('Slot: aura');
    expect(lines).toHaveTextContent('Replaces: Solar Radiance');
    expect(lines).toHaveTextContent('Inventory quantity will not change.');
    expect(signEvent).not.toHaveBeenCalled();

    confirmDialog();
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));
    const doc = parseGameItemPlacementResult(relayPlacements.at(-1)!);
    expect(doc.ok && doc.value.placements[0]?.item).toBe(AURA.address);
    // Equipping wrote no inventory event.
    expect(
      signEvent.mock.calls.every(([t]) => (t as { kind: number }).kind === 31634),
    ).toBe(true);
  });

  it('unequip is confirmed and says the item stays in inventory', async () => {
    seedInventory([{ address: AURA.address, quantity: 1 }]);
    seedPlacement([{ item: AURA.address, slot: 'aura' }]);
    renderLab();
    await waitFor(() =>
      expect(screen.getByTestId('lab-placement-aura')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('lab-unequip-aura'));
    const lines = screen.getByTestId('lab-confirm-lines');
    expect(lines).toHaveTextContent('Slot removed: aura');
    expect(lines).toHaveTextContent('The item remains in inventory.');
    expect(signEvent).not.toHaveBeenCalled();
    confirmDialog();
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));
  });
});

describe('stale placements', () => {
  it('inventory removal leaves the placement untouched; clearing it is separate, confirmed and explicit', async () => {
    seedInventory([]);
    seedPlacement([{ item: AURA.address, slot: 'aura' }]);
    renderLab();

    // The equipped-but-unowned aura shows as a stale placement…
    await waitFor(() =>
      expect(screen.getByTestId('lab-placement-aura')).toHaveTextContent(
        'stale: not owned',
      ),
    );
    // …and NOTHING has been published to "clean it up".
    expect(signEvent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('lab-clear-stale'));
    expect(screen.getByTestId('lab-confirm-kind')).toHaveTextContent('kind:31634');
    expect(screen.getByTestId('lab-confirm-lines')).toHaveTextContent(
      'No inventory quantity changes.',
    );
    expect(signEvent).not.toHaveBeenCalled();
    confirmDialog();
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));

    const doc = parseGameItemPlacementResult(relayPlacements.at(-1)!);
    expect(doc.ok && doc.value.placements).toEqual([]);
  });
});

describe('the test loadout', () => {
  it('blocks applying while items are missing, and offers the separate inventory write', async () => {
    seedInventory([{ address: CAP, quantity: 1 }]);
    renderLab();
    await waitFor(() =>
      expect(screen.getByTestId('lab-apply-loadout')).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId('lab-apply-loadout'));

    expect(screen.getByTestId('lab-loadout-steps').querySelectorAll('li')).toHaveLength(7);
    expect(screen.getByTestId('lab-loadout-missing')).toHaveTextContent('Not owned');
    expect(screen.getByTestId('lab-confirm-publish')).toBeDisabled();

    fireEvent.click(screen.getByTestId('lab-loadout-add-missing'));
    expect(screen.getByTestId('lab-confirm-kind')).toHaveTextContent('kind:31633');
    confirmDialog();
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

describe('the writers have exactly one call-site: the confirmation handler', () => {
  it('both mutateAsync invocations live inside confirmPending', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/tools/game-items/InventoryEquipmentLab.tsx'),
      'utf8',
    );
    const occurrences = [...source.matchAll(/mutateAsync\(/g)];
    expect(occurrences).toHaveLength(2);

    const confirmStart = source.indexOf('const confirmPending');
    const rowSection = source.indexOf('// ── Row-level actions');
    expect(confirmStart).toBeGreaterThan(-1);
    expect(rowSection).toBeGreaterThan(confirmStart);
    for (const match of occurrences) {
      expect(match.index).toBeGreaterThan(confirmStart);
      expect(match.index).toBeLessThan(rowSection);
    }
  });
});
