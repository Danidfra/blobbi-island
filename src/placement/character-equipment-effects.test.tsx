/**
 * useCharacterEquipment × visual effects, the join, hook-level.
 *
 * The pure resolver's own tests prove the gates; these prove the PARTITION and
 * the PLUMBING: that one kind:31634 document feeds both vocabularies, that an
 * official effect item never leaks onto the wearable path (and vice versa),
 * that the author gate silences effects for documents the owner did not sign,
 * and that the empty case stays the shared frozen array.
 *
 * All three queries are seeded straight into the cache; no relay, no signer.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const OWNER = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);
const CHARACTER = 'blobbi-fx-7';

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { query: async () => [], event: async () => {} } }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: OWNER, signer: {} } }),
}));
// `useItemCatalog` reads the configured relay from the app context; the
// catalog itself is seeded straight into the cache, so a fixed config is all
// that is needed.
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: { relayUrl: 'wss://example.invalid' } }),
}));

import {
  buildGameInventoryEvent,
  buildGameItemPlacementEvent,
  buildGameItemAddress,
  parseGameItemPlacementResult,
  type GameItemPlacementEntry,
} from '@/inventory/package';
import { ISLAND_INVENTORY_D } from '@/inventory/constants';
import { parseInventoryEvent } from '@/inventory/protocol-adapter';
import { inventoryQueryKey } from '@/inventory/useIslandInventory';
import { ITEM_CATALOG_QUERY_KEY, type ItemCatalog } from '@/inventory/useItemCatalog';
import { officialItemAddress } from '@/protocol/event-registry';
import { visualEffectItemForEffect } from '@/effects/official-visual-effect-items';

import { useCharacterEquipment } from './useCharacterEquipment';
import { placementQueryKey, type PlacementState } from './usePlacementState';
import {
  characterEquipmentPlacementD,
  placementTargetForCharacter,
} from './identity';
import { ISLAND_PLACEMENT_REFERENCE } from './render-model';

const AURA = visualEffectItemForEffect('celestial-aura')!;
const AURA_2 = visualEffectItemForEffect('solar-radiance')!;
const CAP = officialItemAddress('blobbi:cosmetic:block-builder-cap');

function placementState(
  entries: GameItemPlacementEntry[],
  author = OWNER,
): PlacementState {
  const template = buildGameItemPlacementEvent({
    id: characterEquipmentPlacementD(CHARACTER),
    target: placementTargetForCharacter(author, CHARACTER),
    reference: ISLAND_PLACEMENT_REFERENCE,
    placements: entries,
  });
  const event: NostrEvent = {
    id: 'placement',
    pubkey: author,
    created_at: 100,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
  const parsed = parseGameItemPlacementResult(event);
  if (!parsed.ok) throw new Error(parsed.error);
  return { placement: parsed.value, warnings: parsed.warnings, isEmpty: false };
}

function inventoryOf(items: { address: string; quantity: number }[]) {
  const template = buildGameInventoryEvent({
    id: ISLAND_INVENTORY_D,
    items,
  });
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

const EMPTY_CATALOG: ItemCatalog = {
  byAddress: new Map(),
  fetchedCount: 0,
  totalCount: 0,
  cosmeticsFetched: 0,
  cosmeticsTotal: 0,
  effectItemsFetched: 0,
  effectItemsTotal: 0,
};

function setup(options: {
  entries: GameItemPlacementEntry[];
  owned?: { address: string; quantity: number }[];
  form?: string;
  author?: string;
  ownerPubkey?: string;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(
    placementQueryKey(options.ownerPubkey ?? OWNER, CHARACTER),
    placementState(options.entries, options.author ?? OWNER),
  );
  client.setQueryData(inventoryQueryKey(OWNER), inventoryOf(options.owned ?? []));
  client.setQueryData(ITEM_CATALOG_QUERY_KEY, EMPTY_CATALOG);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useCharacterEquipment(CHARACTER, {
        ...(options.form === undefined ? {} : { form: options.form }),
        ...(options.ownerPubkey === undefined
          ? {}
          : { ownerPubkey: options.ownerPubkey }),
      }),
    { wrapper },
  );
}

const equipAura: GameItemPlacementEntry = {
  id: 'aura',
  item: AURA.address,
  mode: 'equip',
  slot: 'aura',
};

describe('activation through the join', () => {
  it('an owned, equipped, form-compatible effect becomes renderer input', () => {
    const { result } = setup({
      entries: [equipAura],
      owned: [{ address: AURA.address, quantity: 1 }],
      form: 'adult',
    });
    expect(result.current.effects).toEqual([{ id: 'celestial-aura' }]);
    expect(result.current.activeEffects[0]?.registration.d).toBe(AURA.d);
    expect(result.current.hidden).toEqual([]);
  });

  it('a stale placement (quantity now 0) does not render, is diagnosed, and stays in the document', () => {
    const { result } = setup({
      entries: [equipAura],
      owned: [],
      form: 'adult',
    });
    expect(result.current.effects).toEqual([]);
    expect(result.current.rejectedEffects[0]?.reason).toBe('not-owned');
  });

  it('an egg activates nothing', () => {
    const { result } = setup({
      entries: [equipAura],
      owned: [{ address: AURA.address, quantity: 1 }],
      form: 'egg',
    });
    expect(result.current.effects).toEqual([]);
    expect(result.current.rejectedEffects[0]?.reason).toBe('incompatible-form');
  });

  it('a document signed by someone other than the owner activates nothing', () => {
    const { result } = setup({
      entries: [equipAura],
      owned: [{ address: AURA.address, quantity: 1 }],
      form: 'adult',
      author: STRANGER,
      ownerPubkey: OWNER,
    });
    expect(result.current.effects).toEqual([]);
  });

  it('same-slot duplicates resolve deterministically: last equipped wins', () => {
    const { result } = setup({
      entries: [
        equipAura,
        { id: 'aura', item: AURA_2.address, mode: 'equip', slot: 'aura' },
      ],
      owned: [
        { address: AURA.address, quantity: 1 },
        { address: AURA_2.address, quantity: 1 },
      ],
      form: 'adult',
    });
    expect(result.current.effects).toEqual([{ id: 'solar-radiance' }]);
  });
});

describe('the partition between wearables and effects', () => {
  it('an official effect item never appears among hidden wearables, and vice versa', () => {
    const { result } = setup({
      entries: [
        equipAura,
        { id: 'headwear', item: CAP, mode: 'equip', slot: 'headwear' },
      ],
      owned: [{ address: AURA.address, quantity: 1 }],
      form: 'adult',
    });
    // The cap is refused by the wearable policy (no fetched definition in this
    // harness) but stays a WEARABLE diagnosis; the aura activates as an effect.
    expect(result.current.effects).toEqual([{ id: 'celestial-aura' }]);
    const hiddenItems = result.current.hidden.map((h) => h.entry.item);
    expect(hiddenItems).toContain(CAP);
    expect(hiddenItems).not.toContain(AURA.address);
  });

  it("a third-party copy of an official effect d stays on the wearable path as untrusted", () => {
    const copied = buildGameItemAddress(STRANGER, AURA.d);
    const { result } = setup({
      entries: [{ id: 'aura', item: copied, mode: 'equip', slot: 'aura' }],
      owned: [{ address: copied, quantity: 1 }],
      form: 'adult',
    });
    expect(result.current.effects).toEqual([]);
    expect(result.current.rejectedEffects).toEqual([]);
    expect(result.current.hidden[0]).toMatchObject({
      reason: 'untrusted-issuer',
    });
  });
});

describe('the empty case', () => {
  it('no effect placements yields the shared frozen empty array', () => {
    const { result } = setup({
      entries: [],
      owned: [{ address: AURA.address, quantity: 1 }],
      form: 'adult',
    });
    expect(result.current.effects).toHaveLength(0);
    expect(Object.isFrozen(result.current.effects)).toBe(true);
  });
});
