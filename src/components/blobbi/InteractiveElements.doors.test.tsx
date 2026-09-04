/**
 * Every visible walk-to door resolves to a point the Blobbi can actually reach,
 * and reaching it fires the door's location change.
 *
 * jsdom has no layout, so each door's rendered box is reproduced from its
 * Tailwind classes and the intrinsic size of its artwork, exactly the numbers
 * the runtime rect would carry. The Town Stage, the Plaza building and the
 * Nostr Station exterior all shipped with a door base ABOVE the room's walk
 * floor (the buildings stand in the upper half of their scenes), which the
 * route planner rightly refuses; the fix projects every element's approach
 * point into the walkable floor, and this table pins that it holds for the
 * doors that were dead AND for the ones that already worked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LocationContext } from '@/contexts/LocationContextValue';
import { MovementBlockerProvider, useMovementBlocker } from '@/contexts/MovementBlockerContext';
import { DebugOverlaysProvider } from '@/contexts/DebugOverlaysContext';
import { TestApp } from '@/test/TestApp';
import { InteractiveElements } from './InteractiveElements';
import type { MovableBlobbiRef } from './MovableBlobbi';
import type { LocationId } from '@/lib/location-types';
import type { Position } from '@/lib/types';
import { locationBoundaries } from '@/lib/location-boundaries';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';
import { getBlobbiInitialPosition } from '@/lib/location-initial-position';
import { isOnFloor, planRoute, type RouteBlocker } from '@/lib/blobbi-route';
import { WORLD_HEIGHT, WORLD_WIDTH } from '@/lib/world-coordinates';

/** Intrinsic artwork sizes (px), which jsdom cannot measure. */
const ART: Record<string, { width: number; height: number }> = {
  stage: { width: 396, height: 381 },
  'stage-door': { width: 188, height: 143 },
  'nostr-station': { width: 425, height: 383 },
  'nostr-station-door': { width: 132, height: 135 },
  plaza: { width: 2175, height: 1613 },
  'plaza-door': { width: 329, height: 311 },
  arcade: { width: 324, height: 419 },
  'arcade-door': { width: 129, height: 183 },
  shop: { width: 298, height: 400 },
  'shop-door': { width: 176, height: 186 },
  'plaza-inside-door-open': { width: 432, height: 351 },
};

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A building container box in world percent, from its Tailwind placement. */
function building(art: string, placement: { widthPercent: number; top: number; left?: number; right?: number; centerX?: number }): Box {
  const { width: aw, height: ah } = ART[art];
  const width = placement.widthPercent;
  const widthPx = (width / 100) * WORLD_WIDTH;
  const height = ((widthPx * (ah / aw)) / WORLD_HEIGHT) * 100;
  const x =
    placement.left !== undefined
      ? placement.left
      : placement.right !== undefined
        ? 100 - placement.right - width
        : (placement.centerX ?? 50) - width / 2;
  return { x, y: placement.top, width, height };
}

/** A door box: `bottom-0` inside its building, a fraction of the building's width. */
function doorIn(container: Box, art: string, fraction: number, edge: { left?: number; right?: number; centerX?: boolean }): Box {
  const { width: aw, height: ah } = ART[art];
  const width = container.width * fraction;
  const widthPx = (width / 100) * WORLD_WIDTH;
  const height = ((widthPx * (ah / aw)) / WORLD_HEIGHT) * 100;
  const x =
    edge.centerX
      ? container.x + container.width / 2 - width / 2
      : edge.left !== undefined
        ? container.x + container.width * edge.left
        : container.x + container.width - width - container.width * (edge.right ?? 0);
  return { x, y: container.y + container.height - height, width, height };
}

interface DoorCase {
  name: string;
  location: LocationId;
  alt: string;
  leadsTo: LocationId;
  box: Box;
  /** Whether the door's OWN base lies off the floor (the regression this fixes). */
  baseOffFloor: boolean;
}

const town = (art: 'arcade' | 'shop' | 'stage', p: Parameters<typeof building>[1]) => building(art, p);

const DOORS: DoorCase[] = [
  {
    name: 'Town Stage (was dead: base above the Town floor)',
    location: 'town',
    alt: 'Stage Door',
    leadsTo: 'stage',
    box: doorIn(town('stage', { widthPercent: 27.6, top: 22, centerX: 50 }), 'stage-door', 0.47, { right: -0.01 }),
    baseOffFloor: true,
  },
  {
    name: 'Plaza building (was dead: base above the Plaza floor)',
    location: 'plaza',
    alt: 'Plaza Door',
    leadsTo: 'plaza-inside',
    box: doorIn(building('plaza', { widthPercent: 50, top: 0, centerX: 50 }), 'plaza-door', 0.076, { centerX: true }),
    baseOffFloor: true,
  },
  {
    name: 'Nostr Station exterior (was dead: base far above the floor)',
    location: 'nostr-station',
    alt: 'Nostr Station Door',
    leadsTo: 'nostr-station-inside',
    box: doorIn(building('nostr-station', { widthPercent: 20, top: 6, right: 5 }), 'nostr-station-door', 0.31, { left: 0.1 }),
    baseOffFloor: true,
  },
  {
    name: 'Town Arcade (already worked)',
    location: 'town',
    alt: 'Arcade Door',
    leadsTo: 'arcade',
    box: doorIn(town('arcade', { widthPercent: 21.1, top: 25, left: 18 }), 'arcade-door', 0.4, { right: 0 }),
    baseOffFloor: false,
  },
  {
    name: 'Town Shop (already worked)',
    location: 'town',
    alt: 'Shop Door',
    leadsTo: 'shop',
    box: doorIn(town('shop', { widthPercent: 20.5, top: 25, right: 18 }), 'shop-door', 0.6, { left: 0 }),
    baseOffFloor: false,
  },
];

const SURFACE = { left: 0, top: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT };

function rectOf(box: Box): DOMRect {
  const left = (box.x / 100) * WORLD_WIDTH;
  const top = (box.y / 100) * WORLD_HEIGHT;
  const width = (box.width / 100) * WORLD_WIDTH;
  const height = (box.height / 100) * WORLD_HEIGHT;
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

const ZERO = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

/** Give jsdom the layout: the world surface, and the door under test. */
function stubLayout(alt: string, box: Box) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-world-surface')) {
      return { ...SURFACE, right: SURFACE.width, bottom: SURFACE.height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    const isDoor = this.matches(`img[alt="${alt}"]`) || this.querySelector(`img[alt="${alt}"]`) !== null;
    // The surface itself also "contains" the door; it was handled above.
    return isDoor ? rectOf(box) : ZERO;
  });
}

type BlockerRects = () => RouteBlocker[];
function Probe({ onReady }: { onReady: (blockers: BlockerRects) => void }) {
  const { blockers } = useMovementBlocker();
  onReady(() => blockers.map((b) => b.rect));
  return null;
}

async function renderRoom(location: LocationId) {
  const walks: Position[] = [];
  const blobbiRef: React.RefObject<MovableBlobbiRef> = {
    current: {
      // A "teleporting" walker: the walk is not the subject here, arrival is.
      goTo: (target) => {
        walks.push(target);
      },
      snapTo: vi.fn(),
      stop: vi.fn(),
      getCurrentPosition: () => walks[walks.length - 1] ?? getBlobbiInitialPosition(location),
    },
  };
  const setCurrentLocation = vi.fn();
  let blockers: BlockerRects = () => [];
  render(
    <TestApp>
      <LocationContext.Provider
        value={{
          currentLocation: location,
          setCurrentLocation,
          previousLocation: null,
          isMapModalOpen: false,
          setIsMapModalOpen: vi.fn(),
          isTransitioning: false,
        }}
      >
        <DebugOverlaysProvider>
          <MovementBlockerProvider>
            <div data-world-surface>
              <InteractiveElements blobbiRef={blobbiRef} selectedBlobbi={null} />
              <Probe onReady={(fn) => { blockers = fn; }} />
            </div>
          </MovementBlockerProvider>
        </DebugOverlaysProvider>
      </LocationContext.Provider>
    </TestApp>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return { walks, setCurrentLocation, blockers: () => blockers() };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('walk-to doors resolve reachable approach points and fire their transition', () => {
  it.each(DOORS)('$name', async ({ location, alt, leadsTo, box, baseOffFloor }) => {
    const boundary = locationBoundaries[getBackgroundForLocation(location)];
    expect(boundary).toBeDefined();

    // The premise: the door's own base is (or is not) on the floor.
    const base = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.9 };
    expect(isOnFloor(base, boundary)).toBe(!baseOffFloor);

    stubLayout(alt, box);
    const { walks, setCurrentLocation, blockers } = await renderRoom(location);

    fireEvent.click(screen.getByAltText(alt));

    // The Blobbi was asked to walk somewhere it can stand…
    expect(walks).toHaveLength(1);
    const target = walks[0];
    expect(isOnFloor(target, boundary)).toBe(true);
    // …that the room's planner accepts from the spawn point, around its blockers…
    expect(planRoute(getBlobbiInitialPosition(location), target, boundary, blockers())).not.toBeNull();
    // …near the door, not somewhere else on the floor.
    expect(Math.abs(target.x - base.x)).toBeLessThan(6);

    // …and arriving there fires the door.
    expect(setCurrentLocation).toHaveBeenCalledWith(leadsTo);
  });
});
