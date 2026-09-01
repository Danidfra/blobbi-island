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
  CLOTHING_STORE_CHECKOUT,
  CLOTHING_STORE_SHOP_BUTTON,
  clothingStoreBlockers,
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

const checkout = () =>
  screen.getByRole('button', { name: CLOTHING_STORE_CHECKOUT.label });
const shopButton = () =>
  screen.getByRole('button', { name: CLOTHING_STORE_SHOP_BUTTON.label });

/** Walk to the counter and arrive, which is what actually opens the shop. */
function arriveAtCheckout() {
  fireEvent.click(checkout());
  act(() => requests[requests.length - 1].action());
}

const objectEl = (id: string) =>
  document.querySelector(`[data-clothing-store-object="${id}"]`) as HTMLImageElement;

beforeEach(() => {
  requests.length = 0;
  modalMounts.length = 0;
  setCurrentLocation.mockReset();
});

describe('the boutique renders', () => {
  it('draws every configured object from its canonical asset', () => {
    renderRoom();
    for (const object of clothingStoreObjects) {
      const el = objectEl(object.id);
      expect(el, object.id).toBeTruthy();
      expect(el.getAttribute('src')).toBe(object.src);
    }
  });

  it('renders the second display table from its own new asset', () => {
    renderRoom();
    const two = objectEl('clothing-store-display-table-2');
    expect(two).toBeTruthy();
    expect(two.getAttribute('src')).toBe(
      '/assets/locations/clothing-store-inside/display-table-2.png',
    );
    // Its own object, not a re-render of the first.
    expect(two.getAttribute('src')).not.toBe(
      objectEl('clothing-store-display-table').getAttribute('src'),
    );
  });

  it('registers a footprint for each table independently', () => {
    renderRoom();
    const registered = screen.getByTestId('blockers').textContent!.split(',');
    expect(registered).toContain('clothing-store-display-table');
    expect(registered).toContain('clothing-store-display-table-2');
  });

  it('renders each object exactly once', () => {
    renderRoom();
    expect(
      document.querySelectorAll('[data-clothing-store-object]').length,
    ).toBe(clothingStoreObjects.length);
  });

  it('keeps scenery out of the accessibility tree and out of the way of clicks', () => {
    renderRoom();
    for (const object of clothingStoreObjects) {
      const el = objectEl(object.id);
      expect(el.getAttribute('alt')).toBe('');
      expect(el.getAttribute('aria-hidden')).toBe('true');
      // No dead affordances: a decorative object must not look clickable.
      expect(el.className).toContain('pointer-events-none');
      expect(el.className).not.toContain('cursor-pointer');
    }
  });

  it('offers exactly two interactive controls plus the way out', () => {
    renderRoom();
    const named = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(named).toContain(CLOTHING_STORE_CHECKOUT.label);
    expect(named).toContain(CLOTHING_STORE_SHOP_BUTTON.label);
    expect(named).toHaveLength(2);
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

describe('the checkout', () => {
  it('is a named, keyboard-reachable control', () => {
    renderRoom();
    expect(checkout().tagName).toBe('BUTTON');
  });

  it('walks the Blobbi to the counter instead of acting where it stands', () => {
    renderRoom();
    fireEvent.click(checkout());

    expect(requests).toHaveLength(1);
    expect(requests[0].target).toEqual(CLOTHING_STORE_CHECKOUT.standPoint);
    expect(screen.queryByTestId('clothing-store-modal')).toBeNull();
  });

  it('opens the shop only once the Blobbi has ARRIVED', () => {
    renderRoom();
    arriveAtCheckout();
    expect(screen.getByTestId('clothing-store-modal')).toBeInTheDocument();
  });

  it('opening the shop does not change location', () => {
    renderRoom();
    arriveAtCheckout();
    expect(setCurrentLocation).not.toHaveBeenCalled();
  });

  it('never moves the counter under the pointer', () => {
    renderRoom();
    expect(checkout().className).not.toMatch(/translate|scale-|rotate-/);
  });
});

describe('the persistent Shop shortcut', () => {
  it('is there before you interact with anything', () => {
    renderRoom();
    expect(shopButton().tagName).toBe('BUTTON');
    expect(shopButton().textContent).toContain(CLOTHING_STORE_SHOP_BUTTON.text);
  });

  it('opens the shop immediately — no walk, that is the point of it', () => {
    renderRoom();
    fireEvent.click(shopButton());

    expect(requests).toHaveLength(0);
    expect(screen.getByTestId('clothing-store-modal')).toBeInTheDocument();
  });

  it('opens the shop without changing location', () => {
    renderRoom();
    fireEvent.click(shopButton());
    expect(setCurrentLocation).not.toHaveBeenCalled();
  });
});

describe('two controls, one shop', () => {
  it('never renders more than one shop at a time', () => {
    renderRoom();
    fireEvent.click(shopButton());
    arriveAtCheckout();
    expect(screen.getAllByTestId('clothing-store-modal')).toHaveLength(1);
  });

  it('the counter re-uses the shop the shortcut already opened', () => {
    renderRoom();
    fireEvent.click(shopButton());
    expect(modalMounts).toHaveLength(1);

    arriveAtCheckout();
    // One mount, not two. A duplicated controller would mount its own instance.
    expect(modalMounts).toHaveLength(1);
  });

  it('closing keeps the player in the Clothing Store, with the room intact', () => {
    renderRoom();
    arriveAtCheckout();
    fireEvent.click(screen.getByRole('button', { name: 'close shop' }));

    expect(screen.queryByTestId('clothing-store-modal')).toBeNull();
    expect(setCurrentLocation).not.toHaveBeenCalled();
    expect(screen.getByTestId('blockers').textContent).not.toBe('');
    expect(
      document.querySelectorAll('[data-clothing-store-object]').length,
    ).toBe(clothingStoreObjects.length);
  });

  it('closing from either entry point reopens the same one', () => {
    renderRoom();
    arriveAtCheckout();
    fireEvent.click(screen.getByRole('button', { name: 'close shop' }));
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
