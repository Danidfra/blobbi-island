/**
 * `<FurnitureStoreRoom>` — the showroom's contract with the movement system and
 * its shop.
 *
 * The claims under test:
 *
 *  1. the room renders COLLISION and CONTROLS and nothing else — every fixture
 *     is painted into `furniture-store-inside.webp`, so a sprite appearing here
 *     would be the showroom drawn twice;
 *  2. its floor footprint reaches the SHARED movement blocker context, not a
 *     private list only this component can see;
 *  3. the checkout walks the Blobbi up the aisle and opens the shop ON ARRIVAL,
 *     never on the click;
 *  4. the desk and the corner button are two CONTROLS over ONE shop.
 *
 * The modal is stubbed and COUNTS ITS MOUNTS, so "one shop" is checked as one
 * instance rather than as one visible dialog: a second controller would show up
 * here as a second mount, which is the failure the counting is for.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import {
  FURNITURE_STORE_CHECKOUT,
  FURNITURE_STORE_SHOP_BUTTON,
  furnitureStoreBlockers,
} from '@/lib/furniture-store-config';
import { BLOCK_UI_SELECTOR } from '@/lib/world-input';
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

const setCurrentLocation = vi.fn();
vi.mock('@/hooks/useLocation', () => ({
  useLocation: () => ({
    currentLocation: 'furniture-store-inside',
    previousLocation: 'shop',
    setCurrentLocation,
    setIsMapModalOpen: vi.fn(),
  }),
}));

const modalMounts: number[] = [];
vi.mock('./FurnitureStoreModal', () => ({
  FurnitureStoreModal: ({ onClose }: { onClose: () => void }) => {
    modalMounts.push(1);
    return (
      <div data-testid="furniture-store-modal">
        <button type="button" onClick={onClose}>
          close shop
        </button>
      </div>
    );
  },
}));

import { FurnitureStoreRoom } from './FurnitureStoreRoom';

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
        <FurnitureStoreRoom blobbiRef={blobbiRef} selectedBlobbiId="blobbi-1" />
        <BlockerProbe />
      </MovementBlockerProvider>
    </DebugOverlaysProvider>,
  );
}

const checkout = () =>
  document.querySelector('[data-furniture-store-checkout]') as HTMLElement;
const shopButton = () =>
  screen.getByRole('button', { name: FURNITURE_STORE_SHOP_BUTTON.label });

beforeEach(() => {
  requests.length = 0;
  modalMounts.length = 0;
  setCurrentLocation.mockClear();
});

describe('the room renders controls, not furniture', () => {
  it('renders no scene sprites at all', () => {
    renderRoom();
    // Every sofa, bed and lamp is painted into the background; the display
    // platforms are excluded by the walk boundary's shape. Any <img> here would
    // be the showroom drawn twice.
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  it('renders the checkout, the shortcut and the back arrow', () => {
    renderRoom();
    expect(checkout()).toBeTruthy();
    expect(shopButton()).toBeInTheDocument();
    expect(document.querySelector('[data-block-move]')).toBeTruthy();
  });

  it('leaves the room for the mall', () => {
    renderRoom();
    // `<BackArrow>` is a `data-block-move` div, not a button — the shared
    // component, unchanged.
    fireEvent.click(document.querySelector('[data-block-move]')!);
    expect(setCurrentLocation).toHaveBeenCalledWith('shop');
  });

  it('both controls are move-blocking, so a click never also walks the world', () => {
    renderRoom();
    expect(checkout().closest(BLOCK_UI_SELECTOR)).not.toBeNull();
    expect(shopButton().closest(BLOCK_UI_SELECTOR)).not.toBeNull();
  });
});

describe('collision reaches the SHARED movement context', () => {
  it('registers every configured footprint, by id', () => {
    renderRoom();
    const registered = screen.getByTestId('blockers').textContent!.split(',');
    expect(registered.sort()).toEqual(furnitureStoreBlockers.map((b) => b.id).sort());
  });

  it('registers nothing for the display platforms', () => {
    renderRoom();
    // They are raised and roped off, so the walk BOUNDARY excludes them; a
    // blocker here would restate that as an invisible wall.
    const registered = screen.getByTestId('blockers').textContent!;
    for (const absent of ['platform', 'sofa', 'bed', 'wardrobe', 'display']) {
      expect(registered).not.toContain(absent);
    }
  });
});

describe('the checkout', () => {
  it('is a real, named, keyboard-reachable button', () => {
    renderRoom();
    const el = screen.getByRole('button', { name: FURNITURE_STORE_CHECKOUT.label });
    expect(el.tagName).toBe('BUTTON');
    expect(el).toBe(checkout());
  });

  it('highlights on hover and on focus, and never moves', () => {
    renderRoom();
    const el = checkout();
    expect(el.className).toContain('hover:bg-island-cream/15');
    expect(el.className).toContain('focus-visible:bg-island-cream/15');
    expect(el.className).toContain('hover:ring-island-cream/60');
    // No transform of any kind: the desk is background pixels, and a background
    // that jumps when you point at it reads as broken.
    expect(el.className).not.toMatch(/hover:(scale|translate|-translate)/);
    expect(el.className).not.toMatch(/focus-visible:(scale|translate|-translate)/);
    expect(el.className).not.toMatch(/\btransform\b/);
  });

  it('starts a walk to its stand point rather than opening', () => {
    renderRoom();
    fireEvent.click(checkout());
    expect(requests).toHaveLength(1);
    expect(requests[0].target).toEqual(FURNITURE_STORE_CHECKOUT.standPoint);
    expect(screen.queryByTestId('furniture-store-modal')).toBeNull();
  });

  it('opens the shop once the Blobbi arrives', () => {
    renderRoom();
    fireEvent.click(checkout());
    act(() => requests[0].action());
    expect(screen.getByTestId('furniture-store-modal')).toBeInTheDocument();
    expect(modalMounts).toHaveLength(1);
  });
});

describe('the lower-right Shop button', () => {
  it('opens the shop immediately, with no walk', () => {
    renderRoom();
    fireEvent.click(shopButton());
    expect(requests).toHaveLength(0);
    expect(screen.getByTestId('furniture-store-modal')).toBeInTheDocument();
  });

  it('is the SAME shop the checkout opens, not a second one', () => {
    renderRoom();
    fireEvent.click(shopButton());
    fireEvent.click(screen.getByText('close shop'));

    fireEvent.click(checkout());
    act(() => requests[0].action());
    expect(screen.getAllByTestId('furniture-store-modal')).toHaveLength(1);
    // Two mounts across two separate openings — never two at once.
    expect(modalMounts).toHaveLength(2);
  });
});

describe('the shop cannot stack', () => {
  it('an arrival landing after the shortcut already opened it changes nothing', () => {
    renderRoom();
    fireEvent.click(checkout());
    fireEvent.click(shopButton());
    act(() => requests[0].action());

    expect(screen.getAllByTestId('furniture-store-modal')).toHaveLength(1);
    expect(modalMounts).toHaveLength(1);
  });

  it('two arrivals in a row still leave one dialog', () => {
    renderRoom();
    fireEvent.click(checkout());
    act(() => requests[0].action());
    act(() => requests[0].action());
    expect(screen.getAllByTestId('furniture-store-modal')).toHaveLength(1);
    expect(modalMounts).toHaveLength(1);
  });

  it('closing it lets it be opened again', () => {
    renderRoom();
    fireEvent.click(shopButton());
    fireEvent.click(screen.getByText('close shop'));
    expect(screen.queryByTestId('furniture-store-modal')).toBeNull();

    fireEvent.click(shopButton());
    expect(screen.getByTestId('furniture-store-modal')).toBeInTheDocument();
  });
});
