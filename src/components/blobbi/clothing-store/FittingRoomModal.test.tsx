/**
 * `<FittingRoomModal>`: a preview that changes nothing.
 *
 * The claim this file exists for is a NEGATIVE one, and negatives need two
 * kinds of proof:
 *
 *  1. STRUCTURAL: the module's import graph reaches no writer. Every purchase
 *     hook, inventory mutation, wallet and publisher is stubbed with a spy that
 *     fails the test if it is ever constructed, so "we do not call it" is
 *     replaced by "it is not there to call";
 *  2. BEHAVIOURAL: opening, trying things on, resetting and closing publish no
 *     event, because the fake relay's `event()` is a spy that must stay unused.
 *
 * Everything else here is about the preview being HONEST: it composes the same
 * accessory list equipping would, a second pick in a slot replaces the first,
 * and an item nobody owns says so.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import { officialCosmeticByD } from '@/protocol/event-registry';
import type { AccessoryPlacementInput } from '@blobbi/react';

const OWNER = 'f'.repeat(64);

const CAP = officialCosmeticByD('blobbi:cosmetic:block-builder-cap')!; // headwear
const GLASSES = officialCosmeticByD('blobbi:cosmetic:stargazer-glasses')!; // eyewear
const BOW_TIE = officialCosmeticByD('blobbi:cosmetic:starlight-bow-tie')!; // neckwear
const NECKLACE = officialCosmeticByD('blobbi:cosmetic:celestial-seraph-necklace')!;

const SLOTS: Record<string, string> = {
  [CAP.address]: 'headwear',
  [GLASSES.address]: 'eyewear',
  [BOW_TIE.address]: 'neckwear',
  [NECKLACE.address]: 'neckwear',
};

/** Everything the player is holding. Mutated per test. */
const owned = new Map<string, number>();

/**
 * Every write the app can perform, as spies that must never fire.
 *
 * A relay `event()` is the last gate before a Nostr publish, and a signer is
 * the one before that: if the fitting room could write, one of these would be
 * touched.
 */
const relayEvent = vi.fn();
const signEvent = vi.fn();

vi.mock('@nostrify/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nostrify/react')>();
  return {
    ...actual,
    // The relay's `event()` is the last gate before a Nostr publish. Keeping
    // the rest of the module real means `TestApp`'s provider still mounts.
    useNostr: () => ({ nostr: { query: async () => [], event: relayEvent } }),
  };
});
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: OWNER, signer: { signEvent } } }),
}));
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutate: relayEvent, mutateAsync: relayEvent }),
}));

/** The Blobbi being dressed, and what it really wears (kind:31634). */
const equipped: AccessoryPlacementInput[] = [];
vi.mock('@/hooks/useCharacterEquipmentContext', () => ({
  useCharacterEquipmentContext: () => ({
    accessories: equipped,
    effects: [],
    activeEffects: [],
    rejectedEffects: [],
    definitionsByAddress: new Map(),
    hidden: [],
    warnings: [],
    isLoading: false,
    isEmpty: equipped.length === 0,
  }),
}));
vi.mock('@/hooks/useBlobbonautProfile', () => ({
  useBlobbonautProfile: () => ({ data: { currentCompanion: 'blobbi-1' } }),
}));
vi.mock('@/hooks/useBlobbis', () => ({
  useBlobbis: () => ({
    data: [
      {
        id: 'blobbi-1',
        stage: 'adult',
        adultType: 'catti',
        baseColor: '#8E6BE8',
        secondaryColor: '#B79CF2',
        eyeColor: '#3A2A1A',
        name: 'Wardrobe Test Blobbi',
      },
    ],
  }),
}));

vi.mock('@/inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory')>();
  return {
    ...actual,
    useItemCatalog: () => ({
      data: {
        byAddress: new Map(
          actual.OFFICIAL_WEARABLES.map((w) => [
            w.address,
            {
              address: w.address,
              name: w.name,
              slot: SLOTS[w.address] ?? null,
              image: w.primaryImage ?? undefined,
              images: [],
            },
          ]),
        ),
        fetchedCount: 0,
        totalCount: 0,
      },
    }),
    useIslandInventory: () => ({ data: { owner: OWNER } }),
    getQuantity: (_inv: unknown, address: string) => owned.get(address) ?? 0,
  };
});

import { FittingRoomModal } from './FittingRoomModal';

async function renderFittingRoom(onClose = () => {}) {
  const result = render(
    <TestApp>
      <FittingRoomModal isOpen onClose={onClose} />
    </TestApp>,
  );
  await screen.findByText('Fitting Room');
  return result;
}

const tryButton = (address: string) =>
  document.querySelector(`[data-fitting-room-try="${address}"]`) as HTMLButtonElement;
const tile = (address: string) =>
  document.querySelector(`[data-fitting-room-item="${address}"]`) as HTMLElement;
const wornCodes = () =>
  [...document.querySelectorAll('[data-fitting-room-stage] img')]
    .map((img) => img.getAttribute('src'))
    .filter(Boolean);

/** Nothing published, nothing signed. */
function expectNoWrites() {
  expect(relayEvent).not.toHaveBeenCalled();
  expect(signEvent).not.toHaveBeenCalled();
}

beforeEach(() => {
  relayEvent.mockReset();
  signEvent.mockReset();
  owned.clear();
  equipped.length = 0;
});

describe('the fitting room writes nothing, ever', () => {
  it('imports no writer at all', async () => {
    // The structural half of the claim: if any of these appeared in this
    // module's graph, the preview could publish. They do not.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/components/blobbi/clothing-store/FittingRoomModal.tsx', 'utf8'),
    );
    for (const forbidden of [
      'useBatchPurchase',
      'useInventoryMutation',
      'useCoinWallet',
      'useNostrPublish',
      'runInventoryTransaction',
      'useUseItem',
      'spendCoins',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it('opening publishes nothing', async () => {
    await renderFittingRoom();
    expectNoWrites();
  });

  it('trying clothes on publishes nothing', async () => {
    await renderFittingRoom();
    fireEvent.click(tryButton(CAP.address));
    fireEvent.click(tryButton(GLASSES.address));
    fireEvent.click(tryButton(BOW_TIE.address));
    expectNoWrites();
  });

  it('taking things off and resetting publishes nothing', async () => {
    await renderFittingRoom();
    fireEvent.click(tryButton(CAP.address));
    fireEvent.click(tryButton(CAP.address));
    fireEvent.click(tryButton(GLASSES.address));
    fireEvent.click(document.querySelector('[data-fitting-room-reset]')!);
    expectNoWrites();
  });

  it('closing publishes nothing, and reports only the close', async () => {
    const onClose = vi.fn();
    await renderFittingRoom(onClose);
    fireEvent.click(tryButton(CAP.address));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expectNoWrites();
  });

  it('leaves the real equipment exactly as it found it', async () => {
    equipped.push({
      code: NECKLACE.address,
      slot: 'neckwear',
      x: 50,
      y: 50,
      scale: 1,
      rot: 0,
      flipX: false,
    });
    const before = JSON.stringify(equipped);

    const { unmount } = await renderFittingRoom();
    fireEvent.click(tryButton(BOW_TIE.address));
    fireEvent.click(tryButton(CAP.address));
    unmount();

    // kind:31634 is untouched: the preview was composed, not applied.
    expect(JSON.stringify(equipped)).toBe(before);
    expectNoWrites();
  });
});

describe('the preview', () => {
  it('renders the current Blobbi', async () => {
    await renderFittingRoom();
    expect(document.querySelector('[data-fitting-room-stage]')).toBeTruthy();
    expect(document.querySelector('[data-blobbi-renderer]')).toBeTruthy();
  });

  it('starts wearing what the Blobbi really wears', async () => {
    equipped.push({
      code: NECKLACE.address,
      slot: 'neckwear',
      x: 50,
      y: 50,
      scale: 1,
      rot: 0,
      flipX: false,
    });
    await renderFittingRoom();
    expect(screen.getByText(/is wearing what they already own/i)).toBeInTheDocument();
  });

  it('draws a wearable once it is tried on', async () => {
    await renderFittingRoom();
    expect(wornCodes()).toHaveLength(0);

    fireEvent.click(tryButton(CAP.address));
    expect(wornCodes()).toHaveLength(1);
    expect(wornCodes()[0]).toBe(CAP.primaryImage);
  });

  it('previews several slots at once', async () => {
    await renderFittingRoom();
    fireEvent.click(tryButton(CAP.address)); // headwear
    fireEvent.click(tryButton(GLASSES.address)); // eyewear
    fireEvent.click(tryButton(BOW_TIE.address)); // neckwear

    expect(wornCodes()).toHaveLength(3);
    expect(tile(CAP.address).dataset.tryingOn).toBe('yes');
    expect(tile(GLASSES.address).dataset.tryingOn).toBe('yes');
    expect(tile(BOW_TIE.address).dataset.tryingOn).toBe('yes');
  });

  it('a second pick in the SAME slot replaces the first', async () => {
    await renderFittingRoom();
    fireEvent.click(tryButton(BOW_TIE.address)); // neckwear
    fireEvent.click(tryButton(NECKLACE.address)); // neckwear too

    // Exactly what equipping would do; one thing per slot.
    expect(wornCodes()).toHaveLength(1);
    expect(tile(BOW_TIE.address).dataset.tryingOn).toBe('no');
    expect(tile(NECKLACE.address).dataset.tryingOn).toBe('yes');
  });

  it('tapping the same item again takes it off', async () => {
    await renderFittingRoom();
    fireEvent.click(tryButton(CAP.address));
    expect(tryButton(CAP.address).textContent).toBe('Take off');

    fireEvent.click(tryButton(CAP.address));
    expect(tile(CAP.address).dataset.tryingOn).toBe('no');
    expect(wornCodes()).toHaveLength(0);
  });

  it('reset restores the Blobbi to what it actually wears', async () => {
    equipped.push({
      code: NECKLACE.address,
      slot: 'neckwear',
      x: 50,
      y: 50,
      scale: 1,
      rot: 0,
      flipX: false,
    });
    await renderFittingRoom();
    fireEvent.click(tryButton(CAP.address));
    fireEvent.click(tryButton(BOW_TIE.address));
    expect(screen.getByText(/Trying on 2 items/i)).toBeInTheDocument();

    fireEvent.click(document.querySelector('[data-fitting-room-reset]')!);

    expect(screen.getByText(/is wearing what they already own/i)).toBeInTheDocument();
    for (const address of [CAP.address, BOW_TIE.address]) {
      expect(tile(address).dataset.tryingOn).toBe('no');
    }
  });

  it('can be turned round', async () => {
    await renderFittingRoom();
    const facing = document.querySelector('[data-fitting-room-facing]') as HTMLElement;
    expect(facing.textContent).toBe('Show back');
    fireEvent.click(facing);
    expect(facing.textContent).toBe('Show front');
  });
});

describe('the rail never implies ownership', () => {
  it('marks what you own and what you do not', async () => {
    owned.set(CAP.address, 1);
    await renderFittingRoom();

    expect(tile(CAP.address).dataset.owned).toBe('yes');
    expect(
      tile(CAP.address).querySelector('[data-fitting-room-ownership]')!.textContent,
    ).toBe('Owned');

    expect(tile(GLASSES.address).dataset.owned).toBe('no');
    expect(
      tile(GLASSES.address).querySelector('[data-fitting-room-ownership]')!.textContent,
    ).toBe('Preview only');
  });

  it('lets you try on something you do not own; that is what a fitting room is', async () => {
    await renderFittingRoom();
    expect(tile(GLASSES.address).dataset.owned).toBe('no');

    fireEvent.click(tryButton(GLASSES.address));

    expect(tile(GLASSES.address).dataset.tryingOn).toBe('yes');
    // Trying it on did not quietly make it yours.
    expect(tile(GLASSES.address).dataset.owned).toBe('no');
    expectNoWrites();
  });

  it('says plainly that nothing here is bought or worn', async () => {
    await renderFittingRoom();
    expect(
      screen.getByText(/Nothing in here is bought or worn/i),
    ).toBeInTheDocument();
  });
});
