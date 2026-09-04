/**
 * `<BadgesStoreRoom>`: the room's contract with the movement system and the
 * shop.
 *
 * The claims under test:
 *
 *  1. both display units render from their canonical assets, exactly once;
 *  2. every object with a floor footprint reaches the SHARED movement blocker
 *     context, not a private list only this component can see;
 *  3. the three fixtures walk the Blobbi over and open the shop ON ARRIVAL,
 *     never on the click;
 *  4. four controls, one shop; no ordering of clicks and arrivals produces two.
 *
 * The modal is stubbed: this file is about the room, and the room importing
 * nothing from the badge domain is the point of the split.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import {
  BADGES_STORE_CHECKOUT,
  BADGES_STORE_CHECKOUT_BLOCKER,
  BADGES_STORE_SHOP_BUTTON,
  badgesStoreBlockers,
  badgesStoreObjects,
} from '@/lib/badges-store-config';
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
    currentLocation: 'badges-store-inside',
    previousLocation: 'shop',
    setCurrentLocation,
    setIsMapModalOpen: vi.fn(),
  }),
}));

const modalMounts: number[] = [];
vi.mock('./BadgesStoreModal', () => ({
  BadgesStoreModal: ({ onClose }: { onClose: () => void }) => {
    // Counts MOUNTS, so a second controller (rather than a second control)
    // shows up as a second instance rather than as a passing test.
    modalMounts.push(1);
    return (
      <div data-testid="badges-store-modal">
        <button type="button" onClick={onClose}>
          close badges
        </button>
      </div>
    );
  },
}));

import { BadgesStoreRoom } from './BadgesStoreRoom';

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
        <BadgesStoreRoom blobbiRef={blobbiRef} selectedBlobbiId="blobbi-1" />
        <BlockerProbe />
      </MovementBlockerProvider>
    </DebugOverlaysProvider>,
  );
}

const objectEl = (id: string) =>
  document.querySelector(`[data-badges-store-object="${id}"]`) as HTMLElement;

const shortcut = () =>
  screen.getByRole('button', { name: BADGES_STORE_SHOP_BUTTON.label });

/** Click a fixture and let the Blobbi ARRIVE, which is what fires it. */
function arriveAt(id: string) {
  fireEvent.click(objectEl(id));
  act(() => requests[requests.length - 1].action());
}

/** The three fixtures that walk you over before opening. */
const WALK_IN_OBJECTS = [
  BADGES_STORE_CHECKOUT.id,
  'badges-store-display-case',
  'badges-store-display-rack',
] as const;

beforeEach(() => {
  requests.length = 0;
  modalMounts.length = 0;
  setCurrentLocation.mockReset();
});

describe('the shop renders', () => {
  it('draws every configured object from its canonical asset', () => {
    renderRoom();
    for (const object of badgesStoreObjects) {
      const el = objectEl(object.id);
      expect(el, object.id).toBeTruthy();
      const img = el.tagName === 'IMG' ? el : el.querySelector('img')!;
      expect(img.getAttribute('src')).toBe(object.src);
    }
  });

  it('renders each object exactly once, plus the checkout hotspot', () => {
    renderRoom();
    expect(document.querySelectorAll('[data-badges-store-object]').length).toBe(
      badgesStoreObjects.length + 1,
    );
  });

  it('draws the case and the rack from two different assets', () => {
    renderRoom();
    const caseSrc = objectEl('badges-store-display-case')
      .querySelector('img')!
      .getAttribute('src');
    const rackSrc = objectEl('badges-store-display-rack')
      .querySelector('img')!
      .getAttribute('src');
    expect(caseSrc).toBe(
      '/assets/locations/badges-store-inside/badge-display-case.webp',
    );
    expect(rackSrc).toBe(
      '/assets/locations/badges-store-inside/badge-display-rack.webp',
    );
    expect(caseSrc).not.toBe(rackSrc);
  });
});

describe('the things that do something look like it, and do not move', () => {
  it('each is a named button', () => {
    renderRoom();
    for (const id of WALK_IN_OBJECTS) {
      const el = objectEl(id);
      expect(el.tagName, id).toBe('BUTTON');
      expect(el.getAttribute('aria-label'), id).toBeTruthy();
    }
  });

  it('each highlights rather than moving', () => {
    renderRoom();
    for (const id of WALK_IN_OBJECTS) {
      const el = objectEl(id);
      expect(el.className, id).toContain('cursor-pointer');
      expect(el.className, id).toMatch(/hover:(brightness|drop-shadow)/);
      expect(el.className, id).toMatch(/focus-visible:(brightness|drop-shadow)/);
      // Furniture that jumps when you point at it reads as broken.
      expect(el.className, id).not.toMatch(
        /(^|[^\w-])(-?translate-|scale-|rotate-)/,
      );
    }
  });
});

describe('collision reaches the shared movement system', () => {
  it('registers a blocker for every object that stands on the floor', () => {
    renderRoom();
    const registered = screen.getByTestId('blockers').textContent!.split(',');
    expect(registered).toEqual([
      ...badgesStoreBlockers.map((b) => b.id),
      BADGES_STORE_CHECKOUT.id,
    ]);
  });

  it('registers the checkout counter at its measured footprint', () => {
    renderRoom();
    expect(BADGES_STORE_CHECKOUT_BLOCKER.width).toBeGreaterThan(0);
    expect(BADGES_STORE_CHECKOUT_BLOCKER.height).toBeGreaterThan(0);
    expect(screen.getByTestId('blockers').textContent).toContain(
      BADGES_STORE_CHECKOUT.id,
    );
  });
});

describe('walking to the badges', () => {
  it.each(WALK_IN_OBJECTS)('%s asks for a walk before it does anything', (id) => {
    renderRoom();
    fireEvent.click(objectEl(id));
    expect(requests).toHaveLength(1);
    expect(screen.queryByTestId('badges-store-modal')).toBeNull();
  });

  it.each(WALK_IN_OBJECTS)('%s walks to its own configured stand point', (id) => {
    renderRoom();
    fireEvent.click(objectEl(id));
    const expected =
      id === BADGES_STORE_CHECKOUT.id
        ? BADGES_STORE_CHECKOUT.standPoint
        : badgesStoreObjects.find((o) => o.id === id)!.interaction!.standPoint;
    expect(requests[0].target).toEqual(expected);
  });

  it.each(WALK_IN_OBJECTS)('%s opens the shop on ARRIVAL', (id) => {
    renderRoom();
    arriveAt(id);
    expect(screen.getByTestId('badges-store-modal')).toBeTruthy();
  });
});

describe('four controls, one shop', () => {
  it('the corner shortcut opens it with no walk at all', () => {
    renderRoom();
    fireEvent.click(shortcut());
    expect(requests).toHaveLength(0);
    expect(screen.getByTestId('badges-store-modal')).toBeTruthy();
  });

  it.each(WALK_IN_OBJECTS)(
    'the shortcut and %s open the same single instance',
    (id) => {
      renderRoom();
      fireEvent.click(shortcut());
      arriveAt(id);
      expect(screen.getAllByTestId('badges-store-modal')).toHaveLength(1);
      expect(modalMounts).toHaveLength(1);
    },
  );

  it('an arrival landing after the shop is already open changes nothing', () => {
    renderRoom();
    // Start a walk, open via the shortcut, and only then arrive.
    fireEvent.click(objectEl('badges-store-display-case'));
    fireEvent.click(shortcut());
    act(() => requests[0].action());
    expect(screen.getAllByTestId('badges-store-modal')).toHaveLength(1);
    expect(modalMounts).toHaveLength(1);
  });

  it('closing it unmounts it, and it can be opened again', () => {
    renderRoom();
    fireEvent.click(shortcut());
    fireEvent.click(screen.getByText('close badges'));
    expect(screen.queryByTestId('badges-store-modal')).toBeNull();

    arriveAt('badges-store-display-rack');
    expect(screen.getByTestId('badges-store-modal')).toBeTruthy();
    expect(modalMounts).toHaveLength(2);
  });
});

describe('leaving', () => {
  it('the back arrow returns to the mall', () => {
    const { container } = renderRoom();
    const back = container.querySelector('[class*="top-[5%]"]') as HTMLElement;
    fireEvent.click(back);
    expect(setCurrentLocation).toHaveBeenCalledWith('shop');
  });
});
