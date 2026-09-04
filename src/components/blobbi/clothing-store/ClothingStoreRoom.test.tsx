/**
 * `<ClothingStoreRoom>`: the room's contract with the movement system, the
 * shop and the fitting room.
 *
 * The claims under test:
 *
 *  1. the room renders CONTROLS and COLLISION and nothing else, the furniture
 *     is painted into `clothing-store.webp`, so a sprite appearing here would be
 *     the old composition coming back;
 *  2. every floor footprint reaches the SHARED movement blocker context, not a
 *     private list only this component can see;
 *  3. every hotspot walks the Blobbi over and opens its surface ON ARRIVAL,
 *     never on the click;
 *  4. two controls open ONE shop, two booths open ONE fitting room, and the two
 *     surfaces can never stack.
 *
 * Both modals are stubbed and COUNT THEIR MOUNTS, so "one modal" is checked as
 * one instance rather than as one visible dialog: a second controller would show
 * up here as a second mount, which is the failure the counting is for.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import {
  CLOTHING_STORE_CHECKOUT,
  CLOTHING_STORE_FITTING_ROOM_LEFT,
  CLOTHING_STORE_FITTING_ROOM_RIGHT,
  CLOTHING_STORE_SHOP_BUTTON,
  clothingStoreBlockers,
  clothingStoreFittingRooms,
  clothingStoreHotspots,
} from '@/lib/clothing-store-config';
import {
  MovementBlockerProvider,
  useMovementBlocker,
} from '@/contexts/MovementBlockerContext';
import { DebugOverlaysProvider } from '@/contexts/DebugOverlaysContext';
import { BLOCK_UI_SELECTOR } from '@/lib/world-input';
import type { MovableBlobbiRef } from '../MovableBlobbi';

const requests: RequestInteractionOptions[] = [];
const cancel = vi.fn();
vi.mock('@/hooks/usePendingInteraction', () => ({
  usePendingInteraction: () => ({
    requestInteraction: (opts: RequestInteractionOptions) => requests.push(opts),
    cancel,
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

const hotspotEl = (id: string) =>
  document.querySelector(`[data-clothing-store-hotspot="${id}"]`) as HTMLElement;

const shopButton = () =>
  screen.getByRole('button', { name: CLOTHING_STORE_SHOP_BUTTON.label });

/** Click a hotspot and let the Blobbi ARRIVE, which fires it. */
function arriveAt(id: string) {
  fireEvent.click(hotspotEl(id));
  act(() => requests[requests.length - 1].action());
}

beforeEach(() => {
  requests.length = 0;
  modalMounts.length = 0;
  fittingMounts.length = 0;
  cancel.mockClear();
  setCurrentLocation.mockClear();
});

// ---------------------------------------------------------------------------
// The room is the artwork
// ---------------------------------------------------------------------------

describe('the room renders controls, not furniture', () => {
  it('renders no scene sprites at all', () => {
    renderRoom();
    // Every piece of furniture is painted into `clothing-store.webp`. Any
    // <img> here would be the deleted composition returning.
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  it('renders one button per hotspot, plus the shortcut and the back arrow', () => {
    renderRoom();
    for (const hotspot of clothingStoreHotspots) {
      expect(hotspotEl(hotspot.id), hotspot.id).toBeTruthy();
    }
    expect(document.querySelectorAll('[data-clothing-store-hotspot]')).toHaveLength(
      clothingStoreHotspots.length,
    );
    expect(shopButton()).toBeInTheDocument();
  });

  it('leaves the room for the mall', () => {
    renderRoom();
    // `<BackArrow>` is a `data-block-move` div, not a button, the shared
    // component, unchanged.
    fireEvent.click(document.querySelector('[data-block-move]')!);
    expect(setCurrentLocation).toHaveBeenCalledWith('shop');
  });

  it('every control is move-blocking, so a click never also walks the world', () => {
    renderRoom();
    const selector = BLOCK_UI_SELECTOR;
    for (const hotspot of clothingStoreHotspots) {
      expect(hotspotEl(hotspot.id).closest(selector), hotspot.id).not.toBeNull();
    }
    expect(shopButton().closest(selector)).not.toBeNull();
  });
});

describe('collision reaches the SHARED movement context', () => {
  it('registers every configured footprint, by id', () => {
    renderRoom();
    const registered = screen.getByTestId('blockers').textContent!.split(',');
    expect(registered.sort()).toEqual(
      clothingStoreBlockers.map((b) => b.id).sort(),
    );
  });

  it('registers nothing for the fixtures painted against the walls', () => {
    renderRoom();
    const registered = screen.getByTestId('blockers').textContent!;
    for (const absent of ['rug', 'hat-shelf', 'display-table', 'poster', 'sign']) {
      expect(registered).not.toContain(absent);
    }
  });
});

// ---------------------------------------------------------------------------
// The checkout
// ---------------------------------------------------------------------------

describe('the checkout', () => {
  it('is a real, named, keyboard-reachable button', () => {
    renderRoom();
    const el = screen.getByRole('button', { name: CLOTHING_STORE_CHECKOUT.label });
    expect(el.tagName).toBe('BUTTON');
    expect(el).toBe(hotspotEl(CLOTHING_STORE_CHECKOUT.id));
  });

  it('highlights on hover and on focus, and never moves', () => {
    renderRoom();
    const el = hotspotEl(CLOTHING_STORE_CHECKOUT.id);
    expect(el.className).toContain('hover:bg-island-cream/15');
    expect(el.className).toContain('focus-visible:bg-island-cream/15');
    expect(el.className).toContain('hover:ring-island-cream/60');
    // No transform of any kind: the background is a picture, and a picture that
    // jumps when you point at it reads as broken.
    expect(el.className).not.toMatch(/hover:(scale|translate|-translate)/);
    expect(el.className).not.toMatch(/focus-visible:(scale|translate|-translate)/);
    expect(el.className).not.toMatch(/\btransform\b/);
  });

  it('starts a walk to its stand point rather than opening', () => {
    renderRoom();
    fireEvent.click(hotspotEl(CLOTHING_STORE_CHECKOUT.id));
    expect(requests).toHaveLength(1);
    expect(requests[0].target).toEqual(CLOTHING_STORE_CHECKOUT.standPoint);
    expect(screen.queryByTestId('clothing-store-modal')).toBeNull();
  });

  it('opens the shop once the Blobbi arrives', () => {
    renderRoom();
    arriveAt(CLOTHING_STORE_CHECKOUT.id);
    expect(screen.getByTestId('clothing-store-modal')).toBeInTheDocument();
    expect(modalMounts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The two fitting rooms
// ---------------------------------------------------------------------------

describe('the two fitting rooms', () => {
  it('there are exactly two, and each is its own named button', () => {
    renderRoom();
    const booths = clothingStoreHotspots.filter((h) => h.opens === 'fitting-room');
    expect(booths).toHaveLength(2);
    for (const booth of booths) {
      const el = screen.getByRole('button', { name: booth.label });
      expect(el).toBe(hotspotEl(booth.id));
    }
    expect(
      screen.getByRole('button', { name: CLOTHING_STORE_FITTING_ROOM_LEFT.label }),
    ).not.toBe(
      screen.getByRole('button', { name: CLOTHING_STORE_FITTING_ROOM_RIGHT.label }),
    );
  });

  it.each(clothingStoreFittingRooms.map((b) => [b.id, b] as const))(
    '%s highlights on hover and focus, and never moves',
    (_id, booth) => {
      renderRoom();
      const el = hotspotEl(booth.id);
      expect(el.className).toContain('hover:bg-island-cream/15');
      expect(el.className).toContain('focus-visible:bg-island-cream/15');
      expect(el.className).not.toMatch(/hover:(scale|translate|-translate)/);
      expect(el.className).not.toMatch(/focus-visible:(scale|translate|-translate)/);
      expect(el.className).not.toMatch(/\btransform\b/);
    },
  );

  it.each(clothingStoreFittingRooms.map((b) => [b.id, b] as const))(
    '%s walks to its OWN stand point',
    (_id, booth) => {
      renderRoom();
      fireEvent.click(hotspotEl(booth.id));
      expect(requests).toHaveLength(1);
      expect(requests[0].target).toEqual(booth.standPoint);
      expect(screen.queryByTestId('fitting-room-modal')).toBeNull();
    },
  );

  it.each(clothingStoreFittingRooms.map((b) => [b.id, b] as const))(
    '%s opens the fitting room only on arrival',
    (id) => {
      renderRoom();
      arriveAt(id);
      expect(screen.getByTestId('fitting-room-modal')).toBeInTheDocument();
      expect(fittingMounts).toHaveLength(1);
    },
  );

  it('both open the SAME modal, never a second one', () => {
    renderRoom();
    arriveAt(CLOTHING_STORE_FITTING_ROOM_LEFT.id);
    fireEvent.click(screen.getByText('close fitting room'));

    arriveAt(CLOTHING_STORE_FITTING_ROOM_RIGHT.id);
    expect(screen.getAllByTestId('fitting-room-modal')).toHaveLength(1);
    // Two mounts across two separate openings; never two at once.
    expect(fittingMounts).toHaveLength(2);
    expect(screen.queryByTestId('clothing-store-modal')).toBeNull();
  });

  it('never opens the shop', () => {
    renderRoom();
    for (const booth of clothingStoreFittingRooms) {
      arriveAt(booth.id);
      expect(screen.queryByTestId('clothing-store-modal')).toBeNull();
      fireEvent.click(screen.getByText('close fitting room'));
    }
    expect(modalMounts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The shortcut
// ---------------------------------------------------------------------------

describe('the lower-right Shop button', () => {
  it('opens the shop immediately, with no walk', () => {
    renderRoom();
    fireEvent.click(shopButton());
    expect(requests).toHaveLength(0);
    expect(screen.getByTestId('clothing-store-modal')).toBeInTheDocument();
  });

  it('is the SAME shop the checkout opens, not a second one', () => {
    renderRoom();
    fireEvent.click(shopButton());
    fireEvent.click(screen.getByText('close shop'));

    arriveAt(CLOTHING_STORE_CHECKOUT.id);
    expect(screen.getAllByTestId('clothing-store-modal')).toHaveLength(1);
    expect(modalMounts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// One surface at a time
// ---------------------------------------------------------------------------

describe('the shop and the fitting room cannot stack', () => {
  it('a fitting-room arrival landing after the shop opened is ignored', () => {
    renderRoom();
    // Walk to a booth, then open the shop from the corner button before the
    // Blobbi gets there, the arrival is now stale.
    fireEvent.click(hotspotEl(CLOTHING_STORE_FITTING_ROOM_LEFT.id));
    fireEvent.click(shopButton());
    act(() => requests[requests.length - 1].action());

    expect(screen.getByTestId('clothing-store-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('fitting-room-modal')).toBeNull();
    expect(fittingMounts).toHaveLength(0);
  });

  it('a checkout arrival landing after the fitting room opened is ignored', () => {
    renderRoom();
    arriveAt(CLOTHING_STORE_FITTING_ROOM_RIGHT.id);
    fireEvent.click(hotspotEl(CLOTHING_STORE_CHECKOUT.id));
    act(() => requests[requests.length - 1].action());

    expect(screen.getByTestId('fitting-room-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('clothing-store-modal')).toBeNull();
    expect(modalMounts).toHaveLength(0);
  });

  it('a new click replaces the pending interaction rather than queueing it', () => {
    renderRoom();
    fireEvent.click(hotspotEl(CLOTHING_STORE_FITTING_ROOM_LEFT.id));
    fireEvent.click(hotspotEl(CLOTHING_STORE_CHECKOUT.id));

    // `requestInteraction` replaces: the last request is the live one, and
    // firing it opens what the player asked for LAST.
    expect(requests[requests.length - 1].target).toEqual(
      CLOTHING_STORE_CHECKOUT.standPoint,
    );
    act(() => requests[requests.length - 1].action());
    expect(screen.getByTestId('clothing-store-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('fitting-room-modal')).toBeNull();
  });

  it('closing one surface leaves the room able to open the other', () => {
    renderRoom();
    arriveAt(CLOTHING_STORE_CHECKOUT.id);
    fireEvent.click(screen.getByText('close shop'));
    expect(screen.queryByTestId('clothing-store-modal')).toBeNull();

    arriveAt(CLOTHING_STORE_FITTING_ROOM_LEFT.id);
    expect(screen.getByTestId('fitting-room-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('clothing-store-modal')).toBeNull();
  });
});
