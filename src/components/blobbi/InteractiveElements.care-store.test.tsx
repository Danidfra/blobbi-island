/**
 * The Care Store storefront in the shopping mall.
 *
 * The facade is the door — there is no separate door overlay asset — so what
 * has to hold is: it is drawn from the real artwork, it stands beside the Coffee
 * Shop on the mall's ground floor rather than on top of it, and clicking it
 * walks the player to a point on the mall FLOOR before changing location.
 *
 * That last part is the one worth guarding. The facade's own base sits above
 * the mall's walkable band, so a derived "floor at this sprite's base" target
 * would be unreachable and the storefront would look dead — the arcade counters'
 * historical failure, recorded in `arcade-room-config.ts`.
 *
 * ## Why the placement assertions are about INK, not boxes
 *
 * A storefront box is not a storefront. Each sprite carries its own transparent
 * padding, so two boxes can sit flush while the pictures inside them show a gap,
 * and two boxes can be clear of each other while the ink overlaps. Comparing raw
 * `bottom-[…]` / `left-[…]` values would therefore pass while the scene looks
 * wrong — which is exactly the trap the facade's own anchor had to dodge. So
 * everything below is computed in PAINTED geometry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import { LocationContext } from '@/contexts/LocationContextValue';
import { InteractiveElements } from './InteractiveElements';
import type { MovableBlobbiRef } from './MovableBlobbi';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import { CARE_STORE_FACADE } from '@/lib/care-store-config';
import { constrainPosition } from '@/lib/boundaries';
import { locationBoundaries } from '@/lib/location-boundaries';
import { WORLD_ASPECT } from '@/lib/world-coordinates';

const requests: RequestInteractionOptions[] = [];
vi.mock('@/hooks/usePendingInteraction', () => ({
  usePendingInteraction: () => ({
    requestInteraction: (opts: RequestInteractionOptions) => requests.push(opts),
    cancel: () => {},
    hasPending: () => requests.length > 0,
  }),
}));

const setCurrentLocation = vi.fn();

async function renderMall() {
  const blobbiRef: React.RefObject<MovableBlobbiRef> = {
    current: {
      goTo: vi.fn(),
      snapTo: vi.fn(),
      stop: vi.fn(),
      getCurrentPosition: () => ({ x: 50, y: 96.7 }),
    },
  };
  const result = render(
    <TestApp>
      <LocationContext.Provider
        value={{
          currentLocation: 'shop',
          setCurrentLocation,
          previousLocation: 'town',
          isMapModalOpen: false,
          setIsMapModalOpen: vi.fn(),
          isTransitioning: false,
        }}
      >
        <div data-world-surface>
          <InteractiveElements blobbiRef={blobbiRef} selectedBlobbi={null} />
        </div>
      </LocationContext.Provider>
    </TestApp>,
  );
  // `TestApp`'s login provider hydrates asynchronously, so the mall subtree is
  // not yet in the DOM on the synchronous return from `render`.
  await screen.findByAltText(CARE_STORE_FACADE.alt);
  return result;
}

/** The clickable wrapper `InteractiveElement` puts around the facade sprite. */
const facade = () => screen.getByAltText(CARE_STORE_FACADE.alt).parentElement!;

/** Parse a Tailwind percentage utility like `left-[50%]`. */
function pct(className: string, prefix: string): number {
  const match = className.match(new RegExp(`(?:^| )${prefix}-\\[([\\d.]+)%\\]`));
  if (!match) throw new Error(`no ${prefix}-[…%] in "${className}"`);
  return Number(match[1]);
}

/**
 * Each sprite's transparent padding, as a fraction of the sprite — measured from
 * its own alpha channel, so these survive any resize — plus its real pixel size.
 */
const ART = {
  care: { w: 567, h: 391, left: 0.0159, right: 0.0159, bottom: 0.0537 },
  coffee: { w: 579, h: 385, left: 0, right: 0.0052, bottom: 0.0026 },
  /** The right potted plant the facade must not grow into. */
  plant: { w: 136, h: 252, left: 0.0147, right: 0.0809, bottom: 0.0119 },
} as const;

interface Box {
  left: number;
  width: number;
  bottom: number;
}

/** Where a sprite's ink lands, in world percent. */
function painted(box: Box, art: (typeof ART)[keyof typeof ART]) {
  // A width-percent box is this many height-percent tall, once the sprite's own
  // aspect and the world's 1046×697 are applied.
  const heightPct = box.width * (art.h / art.w) * WORLD_ASPECT;
  return {
    left: box.left + box.width * art.left,
    right: box.left + box.width * (1 - art.right),
    width: box.width * (1 - art.left - art.right),
    /** Distance from the world's bottom edge up to the artwork's lowest ink. */
    baseline: box.bottom + heightPct * art.bottom,
  };
}

function boxOf(el: HTMLElement, edge: 'left' | 'right'): Box {
  const width = pct(el.className, 'w');
  return {
    left:
      edge === 'left' ? pct(el.className, 'left') : 100 - pct(el.className, 'right') - width,
    width,
    bottom: pct(el.className, 'bottom'),
  };
}

const coffeeEl = () =>
  screen.getByAltText('Shopping coffe shop').parentElement!.parentElement!;

/** The right-hand potted plant on the mall's ground floor. */
function plantEl(container: HTMLElement): HTMLElement {
  const plant = [...container.querySelectorAll('img')].find(
    (img) =>
      img.getAttribute('src') === '/assets/locations/shop/plant-2.png' &&
      img.className.includes('right-[20.4%]'),
  );
  if (!plant) throw new Error('right ground-floor plant not found');
  return plant as HTMLElement;
}

beforeEach(() => {
  requests.length = 0;
  setCurrentLocation.mockReset();
});

describe('the storefront is part of the mall scene', () => {
  it('renders the real Care Store artwork', async () => {
    await renderMall();
    expect(screen.getByAltText(CARE_STORE_FACADE.alt)).toHaveAttribute(
      'src',
      '/assets/locations/shop/care-store.webp',
    );
  });

  it('stands on the same floor line as the Coffee Shop, with no ink overlapping', async () => {
    const { container } = await renderMall();
    const care = painted(boxOf(facade().parentElement!, 'left'), ART.care);
    const coffee = painted(boxOf(coffeeEl(), 'left'), ART.coffee);
    const plant = painted(boxOf(plantEl(container), 'right'), ART.plant);

    // ONE floor line. Comparing the raw `bottom-[…]` values would get this
    // wrong: the sprites are padded differently below their artwork.
    expect(Math.abs(care.baseline - coffee.baseline)).toBeLessThan(0.3);

    // Beside the Coffee Shop, not on top of it — and not into the plant either.
    expect(care.left).toBeGreaterThanOrEqual(coffee.right);
    expect(care.right).toBeLessThanOrEqual(plant.left);
  });

  it('has presence: it fills the bay it stands in, without exceeding it', async () => {
    const { container } = await renderMall();
    const care = painted(boxOf(facade().parentElement!, 'left'), ART.care);
    const coffee = painted(boxOf(coffeeEl(), 'left'), ART.coffee);
    const plant = painted(boxOf(plantEl(container), 'right'), ART.plant);

    const bay = plant.left - coffee.right;
    // "Slightly larger, never oversized": it uses nearly all the clear wall
    // between its neighbours, and none of theirs.
    expect(care.width / bay).toBeGreaterThan(0.95);
    expect(care.width / bay).toBeLessThanOrEqual(1);
    // And it stays a sibling of the Coffee Shop rather than dwarfing it.
    expect(Math.abs(care.width - coffee.width)).toBeLessThan(3);
  });

  it('keeps the facade inside the world', async () => {
    await renderMall();
    const box = boxOf(facade().parentElement!, 'left');
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.left + box.width).toBeLessThanOrEqual(100);
  });

  it('leaves the Coffee Shop exactly where it was', async () => {
    await renderMall();
    expect(coffeeEl().className).toContain('bottom-[12%]');
    expect(coffeeEl().className).toContain('left-[28%]');
    expect(coffeeEl().className).toContain('w-[22.5%]');
  });

  it('offers a click affordance and blocks a world walk-through', async () => {
    await renderMall();
    expect(facade().className).toContain('cursor-pointer');
    expect(facade()).toHaveAttribute('data-block-move');
  });

  it('keeps the click target on the facade itself, whatever size it is', async () => {
    await renderMall();
    // The clickable element IS the sprite's own box — `InteractiveElement` wraps
    // the image — so resizing the facade resizes the hit area with it. Nothing
    // here may hard-code a target that could drift from the picture.
    expect(facade().contains(screen.getByAltText(CARE_STORE_FACADE.alt))).toBe(true);
    expect(facade().parentElement!.className).toContain(
      CARE_STORE_FACADE.containerClassName,
    );
  });
});

describe('clicking the storefront goes inside', () => {
  it('walks to a named point on the mall floor first', async () => {
    await renderMall();
    fireEvent.click(facade());

    expect(requests).toHaveLength(1);
    expect(requests[0].target).toEqual(CARE_STORE_FACADE.walkTarget);

    // The named point is genuinely reachable: the mall boundary does not have
    // to move it. (A derived base point would land above the walkway.)
    const mall = locationBoundaries['shopping-mall-inside.png'];
    expect(constrainPosition(CARE_STORE_FACADE.walkTarget, mall)).toEqual(
      CARE_STORE_FACADE.walkTarget,
    );
  });

  it('does not change location on the click itself', async () => {
    await renderMall();
    fireEvent.click(facade());
    expect(setCurrentLocation).not.toHaveBeenCalled();
  });

  it('enters the Care Store on arrival', async () => {
    await renderMall();
    fireEvent.click(facade());
    act(() => requests[0].action());

    expect(setCurrentLocation).toHaveBeenCalledTimes(1);
    expect(setCurrentLocation).toHaveBeenCalledWith('care-store-inside');
  });
});
