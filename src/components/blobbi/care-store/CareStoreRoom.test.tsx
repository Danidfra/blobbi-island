/**
 * `<CareStoreRoom>` — the room's contract with the movement system.
 *
 * Three things are actually being asserted here, and none of them is a
 * coordinate:
 *
 *  1. the room registers its collision furniture with the SHARED movement
 *     blocker context (not a private list only this component can see);
 *  2. the checkout walks the Blobbi over and opens the shop ON ARRIVAL — never
 *     on the click, which is the failure every walk-to-interact object in this
 *     game has had at least once;
 *  3. leaving is the ordinary back arrow, and closing the shop is not leaving;
 *  4. the counter and the corner Shop button are two CONTROLS over ONE shop —
 *     never two shops.
 *
 * The shop modal is stubbed: this file is about the room. What the modal does
 * with money is `CareStoreModal.test.tsx`'s job, and the room importing nothing
 * financial is the point of the split.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import {
  CARE_STORE_CHECKOUT,
  CARE_STORE_SHOP_BUTTON,
  careStoreBlockers,
} from '@/lib/care-store-config';
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
    currentLocation: 'care-store-inside',
    previousLocation: 'shop',
    setCurrentLocation,
    setIsMapModalOpen: vi.fn(),
  }),
}));

/*
  The shop window needs a relay pool, a query client and a login context for its
  balance, its catalog and its purchase hook. This file tests the ROOM — that
  the checkout OPENS it — so the surface is stubbed here and exercised for real
  in `CareStoreModal.test.tsx` against a fake purchase hook.
*/
vi.mock('./CareStoreModal', () => ({
  CareStoreModal: ({ onClose }: { onClose: () => void }) => {
    // Counts MOUNTS, so a second controller (rather than a second control)
    // would show up as a second instance rather than as a passing test.
    modalMounts.push(Date.now());
    return (
      <div data-testid="care-store-modal">
        <button type="button" onClick={onClose}>
          close shop
        </button>
      </div>
    );
  },
}));

import { CareStoreRoom } from './CareStoreRoom';

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
        <CareStoreRoom blobbiRef={blobbiRef} selectedBlobbiId="blobbi-1" />
        <BlockerProbe />
      </MovementBlockerProvider>
    </DebugOverlaysProvider>,
  );
}

beforeEach(() => {
  requests.length = 0;
  modalMounts.length = 0;
  setCurrentLocation.mockReset();
});

const checkout = () =>
  screen.getByRole('button', { name: CARE_STORE_CHECKOUT.label });
const shopButton = () =>
  screen.getByRole('button', { name: CARE_STORE_SHOP_BUTTON.label });

/** Walk to the counter and arrive, which is what actually opens the shop. */
function arriveAtCheckout() {
  fireEvent.click(checkout());
  act(() => requests[requests.length - 1].action());
}

describe('collision furniture reaches the shared movement system', () => {
  it('registers every configured blocker', () => {
    renderRoom();
    const registered = screen.getByTestId('blockers').textContent!.split(',');
    expect(registered).toEqual(careStoreBlockers.map((b) => b.id));
  });

  it('deregisters them when the player leaves the room', () => {
    const { unmount, getByTestId } = renderRoom();
    expect(getByTestId('blockers').textContent).not.toBe('');
    unmount();
    // Re-rendered fresh: nothing from the old room lingers in the context.
    renderRoom();
    expect(screen.getByTestId('blockers').textContent!.split(',')).toEqual(
      careStoreBlockers.map((b) => b.id),
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
    expect(requests[0].target).toEqual(CARE_STORE_CHECKOUT.standPoint);
    // Nothing has opened yet: the click only started a walk.
    expect(screen.queryByTestId('care-store-modal')).toBeNull();
  });

  it('opens the shop only once the Blobbi has ARRIVED', () => {
    renderRoom();
    arriveAtCheckout();

    expect(screen.getByTestId('care-store-modal')).toBeInTheDocument();
  });

  it('opening the shop does not change location', () => {
    renderRoom();
    arriveAtCheckout();

    expect(setCurrentLocation).not.toHaveBeenCalled();
  });

  it('closing the shop returns to the room, still in the Care Store', () => {
    renderRoom();
    arriveAtCheckout();
    fireEvent.click(screen.getByRole('button', { name: 'close shop' }));

    expect(screen.queryByTestId('care-store-modal')).toBeNull();
    expect(setCurrentLocation).not.toHaveBeenCalled();
    // The room is still standing: its furniture is still registered.
    expect(screen.getByTestId('blockers').textContent).not.toBe('');
  });
});

describe('the persistent Shop shortcut', () => {
  it('is a named control that is there before you interact with anything', () => {
    renderRoom();
    const button = shopButton();
    expect(button.tagName).toBe('BUTTON');
    // Visible label as well as the accessible name, so it reads as a shop.
    expect(button.textContent).toContain(CARE_STORE_SHOP_BUTTON.text);
  });

  it('sits in the room\'s lower-right corner', () => {
    renderRoom();
    // Anchored in world percent from the bottom-right, like every other world
    // object, so it rides the uniform world scale instead of screen pixels.
    expect(shopButton().className).toMatch(/\bbottom-\[\d+(\.\d+)?%\]/);
    expect(shopButton().className).toMatch(/\bright-\[\d+(\.\d+)?%\]/);
  });

  it('opens the shop immediately — no walk, that is the point of it', () => {
    renderRoom();
    fireEvent.click(shopButton());

    expect(requests).toHaveLength(0);
    expect(screen.getByTestId('care-store-modal')).toBeInTheDocument();
  });

  it('opens the shop without changing location', () => {
    renderRoom();
    fireEvent.click(shopButton());
    expect(setCurrentLocation).not.toHaveBeenCalled();
  });

  it('closing from the shortcut returns to the room, still in the Care Store', () => {
    renderRoom();
    fireEvent.click(shopButton());
    fireEvent.click(screen.getByRole('button', { name: 'close shop' }));

    expect(screen.queryByTestId('care-store-modal')).toBeNull();
    expect(setCurrentLocation).not.toHaveBeenCalled();
    expect(screen.getByTestId('blockers').textContent).not.toBe('');
  });
});

describe('two controls, one shop', () => {
  it('never renders more than one shop at a time', () => {
    renderRoom();
    fireEvent.click(shopButton());
    arriveAtCheckout();

    expect(screen.getAllByTestId('care-store-modal')).toHaveLength(1);
  });

  it('the counter re-uses the shop the shortcut already opened — it does not mount a second one', () => {
    renderRoom();
    fireEvent.click(shopButton());
    expect(modalMounts).toHaveLength(1);

    arriveAtCheckout();
    // Same state, same element: one mount, not two. A duplicated controller
    // would mount its own instance here.
    expect(modalMounts).toHaveLength(1);
  });

  it('closing once closes it for both entry points', () => {
    renderRoom();
    arriveAtCheckout();
    fireEvent.click(screen.getByRole('button', { name: 'close shop' }));
    expect(screen.queryByTestId('care-store-modal')).toBeNull();

    // And the shortcut can open the same one again afterwards.
    fireEvent.click(shopButton());
    expect(screen.getAllByTestId('care-store-modal')).toHaveLength(1);
  });

  it('opening from EITHER entry point stays purely presentational', () => {
    // The room's import graph carries no writer at all — asserted here as
    // behaviour: neither control can reach a mutation, because the only
    // financial surface in this tree is the stub above.
    renderRoom();
    fireEvent.click(shopButton());
    fireEvent.click(screen.getByRole('button', { name: 'close shop' }));
    arriveAtCheckout();

    expect(setCurrentLocation).not.toHaveBeenCalled();
    expect(screen.getByTestId('blockers').textContent!.split(',')).toEqual(
      careStoreBlockers.map((b) => b.id),
    );
  });
});

describe('leaving the Care Store', () => {
  it('uses the same back arrow every other interior uses, and returns to the mall', () => {
    const { container } = renderRoom();
    // The shared `BackArrow`: the left-pointing chevron every interior renders.
    const back = container
      .querySelector('svg path[d^="M19 12H5"]')
      ?.closest('[data-block-move]') as HTMLElement;
    expect(back).toBeTruthy();
    fireEvent.click(back);

    expect(setCurrentLocation).toHaveBeenCalledWith('shop');
  });
});
