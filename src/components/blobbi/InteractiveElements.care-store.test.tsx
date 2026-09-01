/**
 * The Care Store storefront in the shopping mall — and the Photo Booth it
 * traded places with.
 *
 * The facade is the door — there is no separate door overlay asset — so what
 * has to hold is: it is drawn from the real artwork, it stands on the middle
 * level between the plant and the Clothing Store rather than on top of either,
 * and clicking it walks the player onto the mall's walkway before changing
 * location.
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
 *
 * ## And why the facade must not MOVE
 *
 * A storefront that lifts off its own floor when you point at it reads as
 * broken, not as interactive. The affordance is a filter; the tests below assert
 * the absence of any transform rather than the presence of a particular glow,
 * because "does not move" is the property that matters.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import { LocationContext } from '@/contexts/LocationContextValue';
import { InteractiveElements } from './InteractiveElements';
import type { MovableBlobbiRef } from './MovableBlobbi';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import { CARE_STORE_FACADE } from '@/lib/care-store-config';
import { MALL_PHOTO_BOOTH } from '@/lib/photo-booth-config';
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
  /** The ground-floor potted plant beside the Coffee Shop. */
  plant: { w: 136, h: 252, left: 0.0147, right: 0.0809, bottom: 0.0119 },
  /** The middle-level potted plant to the Care Store's left. */
  plant1: { w: 91, h: 215, left: 0.044, right: 0.0549, bottom: 0.014 },
  clothing: { w: 567, h: 391, left: 0, right: 0, bottom: 0 },
  booth: { w: 223, h: 309, left: 0, right: 0.0045, bottom: 0 },
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

const clothingEl = () =>
  screen.getByAltText('Shopping clothing store').parentElement!;

const boothEl = () => screen.getByAltText('Photo booth').parentElement!;

/** A ground-floor or middle-level potted plant, by its placement class. */
function plantEl(container: HTMLElement, src: string, edgeClass: string): HTMLElement {
  const plant = [...container.querySelectorAll('img')].find(
    (img) =>
      img.getAttribute('src') === src && img.className.includes(edgeClass),
  );
  if (!plant) throw new Error(`plant ${src} ${edgeClass} not found`);
  return plant as HTMLElement;
}

const groundPlant = (c: HTMLElement) =>
  plantEl(c, '/assets/locations/shop/plant-2.png', 'right-[20.4%]');
const middlePlant = (c: HTMLElement) =>
  plantEl(c, '/assets/locations/shop/plant-1.png', 'left-[26%]');

beforeEach(() => {
  requests.length = 0;
  setCurrentLocation.mockReset();
});

describe('the Care Store and the Photo Booth swapped places', () => {
  it('the Care Store now stands on the MIDDLE level, where the booth was', async () => {
    await renderMall();
    const care = boxOf(facade().parentElement!, 'left');
    const clothing = boxOf(clothingEl(), 'right');

    // Same level as the Clothing Store and the Badges Store, not the ground
    // floor: the middle level's storefronts are the ones it now sits between.
    expect(care.bottom).toBeGreaterThan(30);
    expect(care.bottom).toBeLessThan(45);
    expect(Math.abs(care.bottom - clothing.bottom)).toBeLessThan(2);
  });

  it('the Photo Booth now stands on the GROUND floor, where the Care Store was', async () => {
    await renderMall();
    const booth = boxOf(boothEl(), 'left');
    const coffee = boxOf(coffeeEl(), 'left');

    expect(booth.bottom).toBe(coffee.bottom);
    // In the bay to the Coffee Shop's right.
    expect(booth.left).toBeGreaterThan(coffee.left + coffee.width);
  });

  it('neither object was duplicated', async () => {
    await renderMall();
    expect(screen.getAllByAltText(CARE_STORE_FACADE.alt)).toHaveLength(1);
    expect(screen.getAllByAltText('Photo booth')).toHaveLength(1);
    // One door overlay for the booth, and none for the Care Store (the facade
    // IS its door).
    expect(screen.getAllByAltText(MALL_PHOTO_BOOTH.doorAlt)).toHaveLength(1);
  });

  it('neither destination changed', async () => {
    await renderMall();
    fireEvent.click(facade());
    act(() => requests[0].action());
    expect(setCurrentLocation).toHaveBeenCalledWith('care-store-inside');

    // The booth still opens its own modal rather than navigating anywhere.
    setCurrentLocation.mockReset();
    requests.length = 0;
    fireEvent.click(screen.getByAltText(MALL_PHOTO_BOOTH.doorAlt).parentElement!);
    expect(requests).toHaveLength(1);
    act(() => requests[0].action());
    expect(setCurrentLocation).not.toHaveBeenCalled();
  });
});

describe('the storefront is part of the mall scene', () => {
  it('renders the real Care Store artwork', async () => {
    await renderMall();
    expect(screen.getByAltText(CARE_STORE_FACADE.alt)).toHaveAttribute(
      'src',
      '/assets/locations/shop/care-store.webp',
    );
  });

  it('stands on the same floor line as its middle-level neighbours, with no ink overlapping', async () => {
    const { container } = await renderMall();
    const care = painted(boxOf(facade().parentElement!, 'left'), ART.care);
    const clothing = painted(boxOf(clothingEl(), 'right'), ART.clothing);
    const plant = painted(boxOf(middlePlant(container), 'left'), ART.plant1);

    // ONE floor line. Comparing the raw `bottom-[…]` values would get this
    // wrong: the sprites are padded differently below their artwork.
    expect(Math.abs(care.baseline - clothing.baseline)).toBeLessThan(0.3);

    // Between the plant and the Clothing Store, touching neither.
    expect(care.left).toBeGreaterThanOrEqual(plant.right);
    expect(care.right).toBeLessThanOrEqual(clothing.left);
  });

  it('has presence: it fills the bay it stands in, without exceeding it', async () => {
    const { container } = await renderMall();
    const care = painted(boxOf(facade().parentElement!, 'left'), ART.care);
    const clothing = painted(boxOf(clothingEl(), 'right'), ART.clothing);
    const plant = painted(boxOf(middlePlant(container), 'left'), ART.plant1);

    const bay = clothing.left - plant.right;
    // "Slightly larger, never oversized": it uses nearly all the clear wall
    // between its neighbours, and none of theirs.
    expect(care.width / bay).toBeGreaterThan(0.95);
    expect(care.width / bay).toBeLessThanOrEqual(1);
    // And it stays a sibling of the Clothing Store rather than dwarfing it.
    expect(Math.abs(care.width - clothing.width)).toBeLessThan(4);
  });

  it('the Photo Booth sits clear of both its new neighbours', async () => {
    const { container } = await renderMall();
    const booth = painted(boxOf(boothEl(), 'left'), ART.booth);
    const coffee = painted(boxOf(coffeeEl(), 'left'), ART.coffee);
    const plant = painted(boxOf(groundPlant(container), 'right'), ART.plant);

    expect(booth.left).toBeGreaterThanOrEqual(coffee.right);
    expect(booth.right).toBeLessThanOrEqual(plant.left);
    // Centred in the bay rather than stretched across it: a booth is a small
    // object and must not pretend to be a storefront.
    const bay = { left: coffee.right, right: plant.left };
    const bayCentre = (bay.left + bay.right) / 2;
    const boothCentre = (booth.left + booth.right) / 2;
    expect(Math.abs(boothCentre - bayCentre)).toBeLessThan(0.5);
    expect(booth.width / (bay.right - bay.left)).toBeLessThan(0.6);
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

describe('the facade never moves', () => {
  /** Every Tailwind utility that would shift or resize the storefront. */
  const MOVEMENT = /(^|[^\w-])(-?translate-|scale-|rotate-|skew-|animate-tap)/;

  it('carries no transform utility in any state', async () => {
    await renderMall();
    const wrapper = facade().parentElement!;
    for (const className of [wrapper.className, facade().className]) {
      expect(className).not.toMatch(MOVEMENT);
      // Nor a state-prefixed one, which is how the lift got in.
      expect(className).not.toMatch(/hover:-?translate/);
      expect(className).not.toMatch(/hover:scale/);
      expect(className).not.toMatch(/active:scale/);
    }
  });

  it('animates a FILTER instead, so the affordance costs no movement', async () => {
    await renderMall();
    const wrapper = facade().parentElement!;
    expect(wrapper.className).toContain('transition-[filter]');
    // Something visible must actually change on hover and on focus.
    expect(wrapper.className).toMatch(/hover:(brightness|drop-shadow)/);
    expect(wrapper.className).toMatch(/focus-within:(brightness|drop-shadow)/);
  });

  it('does not opt into `InteractiveElement`\'s own hover-scale or tap-pop', async () => {
    await renderMall();
    // `animated={false}` is what withholds both; the rendered class list is
    // where that decision becomes observable.
    expect(facade().className).not.toContain('hover:scale-110');
    expect(facade().className).not.toContain('animate-tap');
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
