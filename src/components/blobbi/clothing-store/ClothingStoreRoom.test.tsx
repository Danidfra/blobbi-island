/**
 * `<ClothingStoreRoom>` — the room's contract with the movement system and the
 * shop.
 *
 * The claims under test:
 *
 *  1. every configured object actually renders, from its canonical asset;
 *  2. the ones with a floor footprint reach the SHARED movement blocker context,
 *     not a private list only this component can see;
 *  3. the checkout walks the Blobbi over and opens the shop ON ARRIVAL, never on
 *     the click;
 *  4. the counter and the corner Shop button are two CONTROLS over ONE shop.
 *
 * The shop modal is stubbed: this file is about the room, and the room importing
 * nothing financial is the point of the split.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import {
  CLOTHING_STORE_SHOP_BUTTON,
  clothingStoreBlockers,
  clothingStoreInteraction,
  clothingStoreObjects,
} from '@/lib/clothing-store-config';
import {
  MovementBlockerProvider,
  useMovementBlocker,
} from '@/contexts/MovementBlockerContext';
import { DebugOverlaysProvider } from '@/contexts/DebugOverlaysContext';
import type { MovableBlobbiRef } from '../MovableBlobbi';

const requests: RequestInteractionOptions[] = [];
vi.mock('@/hooks/usePendingInteraction', () => ({
  usePendingInteraction: () => ({
    requestInteraction: (opts: RequestInteractionOptions) => requests.push(opts),
    cancel: () => {},
    hasPending: () => requests.length > 0,
  }),
}));

const modalMounts: number[] = [];
const setCurrentLocation = vi.fn();
vi.mock('@/hooks/useLocation', () => ({
  useLocation: () => ({
    currentLocation: 'clothing-store-inside',
    previousLocation: 'shop',
    setCurrentLocation,
    setIsMapModalOpen: vi.fn(),
  }),
}));

vi.mock('./ClothingStoreModal', () => ({
  ClothingStoreModal: ({ onClose }: { onClose: () => void }) => {
    // Counts MOUNTS, so a second controller (rather than a second control)
    // shows up as a second instance rather than as a passing test.
    modalMounts.push(1);
    return (
      <div data-testid="clothing-store-modal">
        <button type="button" onClick={onClose}>
          close shop
        </button>
      </div>
    );
  },
}));

const fittingMounts: number[] = [];
vi.mock('./FittingRoomModal', () => ({
  FittingRoomModal: ({ onClose }: { onClose: () => void }) => {
    fittingMounts.push(1);
    return (
      <div data-testid="fitting-room-modal">
        <button type="button" onClick={onClose}>
          close fitting room
        </button>
      </div>
    );
  },
}));

import { ClothingStoreRoom } from './ClothingStoreRoom';

/** Reports what the SHARED blocker context is actually holding. */
function BlockerProbe() {
  const { blockers } = useMovementBlocker();
  return <div data-testid="blockers">{blockers.map((b) => b.id).join(',')}</div>;
}

const blobbiRef = { current: null } as React.RefObject<MovableBlobbiRef>;

function renderRoom() {
  return render(
    <DebugOverlaysProvider>
      <MovementBlockerProvider>
        <ClothingStoreRoom blobbiRef={blobbiRef} selectedBlobbiId="blobbi-1" />
        <BlockerProbe />
      </MovementBlockerProvider>
    </DebugOverlaysProvider>,
  );
}

const objectEl = (id: string) =>
  document.querySelector(`[data-clothing-store-object="${id}"]`) as HTMLElement;

const shopButton = () =>
  screen.getByRole('button', { name: CLOTHING_STORE_SHOP_BUTTON.label });

/** Click an interactive object and let the Blobbi ARRIVE, which fires it. */
function arriveAt(id: string) {
  fireEvent.click(objectEl(id));
  act(() => requests[requests.length - 1].action());
}

/** Every object that opens the regular shop, plus the corner button. */
const SHOP_OBJECTS = [
  'clothing-store-checkout',
  'clothing-store-display-table',
  'clothing-store-display-table-2',
] as const;

beforeEach(() => {
  requests.length = 0;
  modalMounts.length = 0;
  fittingMounts.length = 0;
  setCurrentLocation.mockReset();
});

describe('the boutique renders', () => {
  it('draws every configured object from its canonical asset', () => {
    renderRoom();
    for (const object of clothingStoreObjects) {
      const el = objectEl(object.id);
      expect(el, object.id).toBeTruthy();
      const img = el.tagName === 'IMG' ? el : el.querySelector('img')!;
      expect(img.getAttribute('src')).toBe(object.src);
    }
  });

  it('renders each object exactly once', () => {
    renderRoom();
    expect(document.querySelectorAll('[data-clothing-store-object]').length).toBe(
      clothingStoreObjects.length,
    );
  });

  it('draws the second display table from its own new asset', () => {
    renderRoom();
    const two = objectEl('clothing-store-display-table-2').querySelector('img')!;
    expect(two.getAttribute('src')).toBe(
      '/assets/locations/clothing-store-inside/display-table-2.png',
    );
    expect(two.getAttribute('src')).not.toBe(
      objectEl('clothing-store-display-table').querySelector('img')!.getAttribute('src'),
    );
  });

  it('keeps scenery out of the accessibility tree and out of the way of clicks', () => {
    renderRoom();
    for (const object of clothingStoreObjects) {
      if (object.interaction) continue;
      const el = objectEl(object.id);
      expect(el.tagName, object.id).toBe('IMG');
      expect(el.getAttribute('alt')).toBe('');
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.className).toContain('pointer-events-none');
      expect(el.className).not.toContain('cursor-pointer');
    }
  });

  it('the hat shelf is still scenery', () => {
    renderRoom();
    expect(objectEl('clothing-store-hat-shelf').tagName).toBe('IMG');
  });
});

describe('the objects that do something look like it — and do not move', () => {
  it('each is a named button carrying its own artwork', () => {
    renderRoom();
    for (const object of clothingStoreObjects) {
      if (!object.interaction) continue;
      const el = objectEl(object.id);
      expect(el.tagName, object.id).toBe('BUTTON');
      expect(el.getAttribute('aria-label')).toBe(object.alt);
      expect(el.querySelector('img')).toBeTruthy();
    }
  });

  it('each highlights rather than moving', () => {
    renderRoom();
    for (const object of clothingStoreObjects) {
      if (!object.interaction) continue;
      const el = objectEl(object.id);
      expect(el.className, object.id).toContain('cursor-pointer');
      expect(el.className, object.id).toMatch(/hover:(brightness|drop-shadow)/);
      expect(el.className, object.id).toMatch(/focus-visible:(brightness|drop-shadow)/);
      // Furniture that jumps when you point at it reads as broken.
      expect(el.className, object.id).not.toMatch(
        /(^|[^\w-])(-?translate-|scale-|rotate-)/,
      );
    }
  });
});

describe('collision furniture reaches the shared movement system', () => {
  it('registers a blocker for every object that stands on the floor', () => {
    renderRoom();
    const registered = screen.getByTestId('blockers').textContent!.split(',');
    expect(registered).toEqual(clothingStoreBlockers.map((b) => b.id));
  });

  it('registers nothing for the rug or the wall art', () => {
    renderRoom();
    const registered = screen.getByTestId('blockers').textContent!;
    expect(registered).not.toContain('clothing-store-rug');
    expect(registered).not.toContain('clothing-store-sign');
    expect(registered).not.toContain('poster');
  });

  it('deregisters them when the player leaves the room', () => {
    const { unmount } = renderRoom();
    unmount();
    renderRoom();
    expect(screen.getByTestId('blockers').textContent!.split(',')).toEqual(
      clothingStoreBlockers.map((b) => b.id),
    );
  });
});

describe('every interactive object walks the Blobbi over first', () => {
  it.each([...SHOP_OBJECTS, 'clothing-store-fitting-room'])(
    '%s requests its own stand point and opens nothing yet',
    (id) => {
      renderRoom();
      fireEvent.click(objectEl(id));

      expect(requests).toHaveLength(1);
      expect(requests[0].target).toEqual(clothingStoreInteraction(id).standPoint);
      expect(screen.queryByTestId('clothing-store-modal')).toBeNull();
      expect(screen.queryByTestId('fitting-room-modal')).toBeNull();
    },
  );

  it.each(SHOP_OBJECTS)('%s opens the regular shop on ARRIVAL', (id) => {
    renderRoom();
    arriveAt(id);
    expect(screen.getByTestId('clothing-store-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('fitting-room-modal')).toBeNull();
  });

  it('the fitting room opens the fitting room, never the shop', () => {
    renderRoom();
    arriveAt('clothing-store-fitting-room');
    expect(screen.getByTestId('fitting-room-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('clothing-store-modal')).toBeNull();
  });

  it('none of them changes location', () => {
    renderRoom();
    for (const id of [...SHOP_OBJECTS, 'clothing-store-fitting-room']) {
      arriveAt(id);
      fireEvent.click(
        screen.getByRole('button', { name: /^close (shop|fitting room)$/ }),
      );
    }
    expect(setCurrentLocation).not.toHaveBeenCalled();
  });
});

describe('four controls, one shop', () => {
  it('the corner button opens it immediately — no walk, that is the point', () => {
    renderRoom();
    fireEvent.click(shopButton());
    expect(requests).toHaveLength(0);
    expect(screen.getByTestId('clothing-store-modal')).toBeInTheDocument();
  });

  it('all four reach the same one modal', () => {
    for (const openIt of [
      () => fireEvent.click(shopButton()),
      () => arriveAt('clothing-store-checkout'),
      () => arriveAt('clothing-store-display-table'),
      () => arriveAt('clothing-store-display-table-2'),
    ]) {
      const view = renderRoom();
      openIt();
      expect(screen.getAllByTestId('clothing-store-modal')).toHaveLength(1);
      view.unmount();
      requests.length = 0;
    }
  });

  it('a second control re-uses the shop the first already opened', () => {
    renderRoom();
    fireEvent.click(shopButton());
    expect(modalMounts).toHaveLength(1);

    arriveAt('clothing-store-display-table');
    arriveAt('clothing-store-display-table-2');
    // One mount, not three: four controls, one controller.
    expect(modalMounts).toHaveLength(1);
    expect(screen.getAllByTestId('clothing-store-modal')).toHaveLength(1);
  });

  it('closing keeps the player in the Clothing Store, with the room intact', () => {
    renderRoom();
    arriveAt('clothing-store-checkout');
    fireEvent.click(screen.getByRole('button', { name: 'close shop' }));

    expect(screen.queryByTestId('clothing-store-modal')).toBeNull();
    expect(setCurrentLocation).not.toHaveBeenCalled();
    expect(screen.getByTestId('blockers').textContent).not.toBe('');
    expect(document.querySelectorAll('[data-clothing-store-object]').length).toBe(
      clothingStoreObjects.length,
    );
  });
});

describe('the two surfaces never stack', () => {
  it('the fitting room cannot open underneath the shop', () => {
    renderRoom();
    fireEvent.click(shopButton());
    arriveAt('clothing-store-fitting-room');

    expect(screen.getAllByTestId('clothing-store-modal')).toHaveLength(1);
    expect(screen.queryByTestId('fitting-room-modal')).toBeNull();
    expect(fittingMounts).toHaveLength(0);
  });

  it('the shop cannot open underneath the fitting room', () => {
    renderRoom();
    arriveAt('clothing-store-fitting-room');
    fireEvent.click(shopButton());
    arriveAt('clothing-store-checkout');

    expect(screen.getAllByTestId('fitting-room-modal')).toHaveLength(1);
    expect(screen.queryByTestId('clothing-store-modal')).toBeNull();
    expect(modalMounts).toHaveLength(0);
  });

  it('an arrival that lands after the player opened something else is ignored', () => {
    // A walk outlives the click that started it. This is the ordering that used
    // to produce a dialog behind a dialog.
    renderRoom();
    fireEvent.click(objectEl('clothing-store-fitting-room'));
    fireEvent.click(shopButton());
    act(() => requests[requests.length - 1].action());

    expect(screen.getAllByTestId('clothing-store-modal')).toHaveLength(1);
    expect(screen.queryByTestId('fitting-room-modal')).toBeNull();
  });

  it('closing one frees the room for the other', () => {
    renderRoom();
    arriveAt('clothing-store-fitting-room');
    fireEvent.click(screen.getByRole('button', { name: 'close fitting room' }));

    fireEvent.click(shopButton());
    expect(screen.getAllByTestId('clothing-store-modal')).toHaveLength(1);
  });
});

describe('leaving the Clothing Store', () => {
  it('uses the same back arrow every other interior uses, and returns to the mall', () => {
    const { container } = renderRoom();
    const back = container
      .querySelector('svg path[d^="M19 12H5"]')
      ?.closest('[data-block-move]') as HTMLElement;
    expect(back).toBeTruthy();
    fireEvent.click(back);

    expect(setCurrentLocation).toHaveBeenCalledWith('shop');
  });
});
