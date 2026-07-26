/**
 * Geometry regression tests for the Town scene's movement blockers.
 *
 * Bug history: the streetlight artwork was repositioned (`left-[6%]` → `left-[15%]`,
 * `right-[12%]` → `right-[18%]`) but its MovementBlockers kept the OLD coordinates
 * (x 8 / x 82.5, y 86, 4.5×4). They ended up beside the bottom Town bushes and cut
 * the straight walk-in path to those bushes' hiding targets, so arriving there fell
 * back to the pending-interaction stall path — or failed outright.
 *
 * These tests use the REAL Town markup and the REAL MovementBlockerProvider, so
 * they cover registration as well as geometry:
 *   - both streetlight feet are blocked;
 *   - each blocker lies inside its own streetlight's artwork (it follows the
 *     streetlight, never the bushes);
 *   - no bush interaction target is blocked;
 *   - the straight path from every Town entry point to every bush target is clear,
 *     so arrival happens by proximity and not via the stall fallback;
 *   - ordinary Town walking bands stay open.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LocationContext } from '@/contexts/LocationContextValue';
import { MovementBlockerProvider, useMovementBlocker } from '@/contexts/MovementBlockerContext';
import { DebugOverlaysProvider } from '@/contexts/DebugOverlaysContext';
import { InteractiveElements } from './InteractiveElements';
import type { MovableBlobbiRef } from './MovableBlobbi';
import { townBushes, type TownBushConfig } from '@/lib/town-bushes-config';
import {
  townStreetlights,
  streetlightArtBox,
  streetlightBaseBlocker,
} from '@/lib/town-streetlights-config';
import { WORLD_WIDTH, WORLD_HEIGHT } from '@/components/shell/VirtualWorld';
import { getBlobbiInitialPosition } from '@/lib/location-initial-position';
import type { Position } from '@/lib/types';

/**
 * Intrinsic sprite sizes (px), which jsdom cannot measure. Combined with each
 * bush's `positionClass` below this reproduces the rendered box, and therefore the
 * same interaction target the component computes from the live rect at runtime.
 */
const BUSH_ART_SIZE: Record<string, { width: number; height: number }> = {
  '/assets/world/props/bush-1.png': { width: 328, height: 240 },
  '/assets/world/props/bush-2.png': { width: 284, height: 189 },
  '/assets/world/props/bush-3.png': { width: 239, height: 188 },
};

/** Read a Tailwind arbitrary percentage (`left-[15%]`, `-bottom-[2%]`, …). */
function edgePercent(positionClass: string, edge: string): number | null {
  const match = positionClass.match(new RegExp(`(^|\\s)(-?)${edge}-\\[(-?[\\d.]+)%\\]`));
  if (!match) return null;
  const value = parseFloat(match[3]);
  return match[2] === '-' ? -value : value;
}

/** The bush's rendered box in world percent. */
function bushBox(config: TownBushConfig) {
  const widthPercent = edgePercent(config.positionClass, 'w');
  if (widthPercent === null) throw new Error(`no width in "${config.positionClass}"`);

  const art = BUSH_ART_SIZE[config.src];
  if (!art) throw new Error(`unknown bush art ${config.src}`);

  const widthPx = (widthPercent / 100) * WORLD_WIDTH;
  const heightPercent = ((widthPx * (art.height / art.width)) / WORLD_HEIGHT) * 100;

  const left = edgePercent(config.positionClass, 'left');
  const right = edgePercent(config.positionClass, 'right');
  const top = edgePercent(config.positionClass, 'top');
  const bottom = edgePercent(config.positionClass, 'bottom');

  const x = left !== null ? left : 100 - (right ?? 0) - widthPercent;
  const y = top !== null ? top : 100 - (bottom ?? 0) - heightPercent;

  return { x, y, width: widthPercent, height: heightPercent };
}

/** Same rule as TownBush: the configured fractional aim point inside the box. */
function bushTarget(config: TownBushConfig): Position {
  const box = bushBox(config);
  return {
    x: box.x + box.width * config.interactionTarget.x,
    y: box.y + box.height * config.interactionTarget.y,
  };
}

/** Every way a player can enter Town (map spawn + the three door exits). */
const TOWN_ENTRY_POINTS: Array<{ name: string; at: Position }> = [
  { name: 'map spawn', at: getBlobbiInitialPosition('town') },
  { name: 'arcade exit', at: getBlobbiInitialPosition('town', 'arcade') },
  { name: 'stage exit', at: getBlobbiInitialPosition('town', 'stage') },
  { name: 'shop exit', at: getBlobbiInitialPosition('town', 'shop') },
];

type BlockedFn = (x: number, y: number) => boolean;

function Probe({ onReady }: { onReady: (isBlocked: BlockedFn) => void }) {
  const { isPositionBlocked } = useMovementBlocker();
  onReady(isPositionBlocked);
  return null;
}

/** Render the real Town scene and hand back its live blocker predicate. */
function renderTown(): { isBlocked: BlockedFn; container: HTMLElement } {
  const blobbiRef: React.RefObject<MovableBlobbiRef> = {
    current: { goTo: vi.fn(), getCurrentPosition: () => ({ x: 50, y: 75 }) },
  };

  let isBlocked: BlockedFn = () => false;

  const { container } = render(
    <LocationContext.Provider
      value={{
        currentLocation: 'town',
        setCurrentLocation: vi.fn(),
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
            <Probe onReady={(fn) => { isBlocked = fn; }} />
          </div>
        </MovementBlockerProvider>
      </DebugOverlaysProvider>
    </LocationContext.Provider>,
  );

  return { isBlocked: (x, y) => isBlocked(x, y), container };
}

/** Walk a straight line and report the first blocked sample, if any. */
function firstBlockedPoint(
  isBlocked: BlockedFn,
  from: Position,
  to: Position,
  steps = 2000,
): Position | null {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    if (isBlocked(x, y)) return { x, y };
  }
  return null;
}

describe('Town movement blockers', () => {
  it('blocks the base of both streetlights', () => {
    const { isBlocked } = renderTown();

    for (const streetlight of townStreetlights) {
      const base = streetlightBaseBlocker(streetlight);
      const centre = { x: base.x + base.width / 2, y: base.y + base.height / 2 };
      expect(
        isBlocked(centre.x, centre.y),
        `${streetlight.id} base at ${centre.x.toFixed(1)},${centre.y.toFixed(1)}`,
      ).toBe(true);

      // The whole plate blocks, corner to corner.
      expect(isBlocked(base.x + 0.05, base.y + 0.05)).toBe(true);
      expect(isBlocked(base.x + base.width - 0.05, base.y + base.height - 0.05)).toBe(true);
    }
  });

  it('keeps each blocker inside its own streetlight artwork', () => {
    for (const streetlight of townStreetlights) {
      const art = streetlightArtBox(streetlight);
      const base = streetlightBaseBlocker(streetlight);

      // Horizontally within the sprite, and resting on its bottom edge — i.e.
      // derived from the streetlight, never from a bush position.
      expect(base.x).toBeGreaterThanOrEqual(art.x);
      expect(base.x + base.width).toBeLessThanOrEqual(art.x + art.width);
      expect(base.y + base.height).toBeLessThanOrEqual(art.y + art.height);
      // The sprite's last opaque row is 3px above its bottom edge (~0.4%).
      expect(art.y + art.height - (base.y + base.height)).toBeLessThan(0.5);

      // Small: only the foot, not the pole or the lamp.
      expect(base.height).toBeLessThan(2);
      expect(base.width).toBeLessThan(art.width);
    }
  });

  it('leaves the streetlight blockers clear of the old, stale coordinates', () => {
    const { isBlocked } = renderTown();

    // The previous (misplaced) rects were x 8–12.5 and x 82.5–87 at y 86–90.
    // Nothing may block there any more; that band is the approach to the bottom
    // bushes.
    expect(isBlocked(10, 88)).toBe(false);
    expect(isBlocked(84.5, 88)).toBe(false);
  });

  it('does not block any bush interaction target', () => {
    const { isBlocked } = renderTown();

    for (const bush of townBushes) {
      const target = bushTarget(bush);
      expect(
        isBlocked(target.x, target.y),
        `${bush.id} target ${target.x.toFixed(1)},${target.y.toFixed(1)}`,
      ).toBe(false);
    }
  });

  it('keeps every bush reachable in a straight line from every Town entry point', () => {
    const { isBlocked } = renderTown();

    for (const entry of TOWN_ENTRY_POINTS) {
      for (const bush of townBushes) {
        const target = bushTarget(bush);
        const hit = firstBlockedPoint(isBlocked, entry.at, target);
        expect(
          hit,
          `${entry.name} → ${bush.id} blocked at ${hit ? `${hit.x.toFixed(2)},${hit.y.toFixed(2)}` : ''}`,
        ).toBeNull();
      }
    }
  });

  it('reaches the two bottom bushes without the stall fallback', () => {
    const { isBlocked } = renderTown();

    // A blocked path stops the Blobbi short, and the walk-to-interact model then
    // relies on stall detection (and gives up beyond 1.6× the 5% threshold). With
    // the corrected blockers the walk reaches the target itself, so arrival is by
    // proximity — assert the final approach is clear right up to the target.
    for (const id of ['town-bush-3', 'town-bush-4']) {
      const bush = townBushes.find((b) => b.id === id)!;
      const target = bushTarget(bush);
      for (const entry of TOWN_ENTRY_POINTS) {
        expect(firstBlockedPoint(isBlocked, entry.at, target), `${entry.name} → ${id}`).toBeNull();
      }
      // The last stretch of the approach (within the proximity threshold) is free.
      expect(isBlocked(target.x, target.y - 5)).toBe(false);
      expect(isBlocked(target.x, target.y)).toBe(false);
    }
  });

  it('renders both streetlights from the same config that positions their blockers', () => {
    const { container } = renderTown();

    const images = Array.from(
      container.querySelectorAll<HTMLImageElement>('[data-streetlight-id]'),
    );
    expect(images).toHaveLength(townStreetlights.length);

    for (const streetlight of townStreetlights) {
      const img = images.find(
        (el) => el.dataset.streetlightId === streetlight.id,
      );
      expect(img, streetlight.id).toBeTruthy();

      // The artwork is placed from the SAME numbers the blocker is derived from,
      // in percentages of the fixed virtual world — so a single set of
      // coordinates stays aligned at every viewport size (VirtualWorld scales the
      // whole world layer uniformly; the sprite has no breakpoint variants).
      expect(img!.style.height).toBe(`${streetlight.heightPercent}%`);
      expect(img!.style.bottom).toBe(`${streetlight.bottomPercent}%`);
      expect(img!.style[streetlight.anchor.edge]).toBe(`${streetlight.anchor.percent}%`);
    }
  });

  it('does not obstruct ordinary Town walking', () => {
    const { isBlocked } = renderTown();

    // The main walking band and the very bottom strip stay completely open.
    for (const y of [62, 66, 70, 75, 80, 85, 92, 96]) {
      for (let x = 0; x <= 100; x += 0.5) {
        expect(isBlocked(x, y), `walkable at ${x},${y}`).toBe(false);
      }
    }

    // Walking left-to-right along the streetlight foot line is stopped only by
    // the two feet, nowhere else.
    const blockedSpans: number[] = [];
    for (let x = 0; x <= 100; x += 0.1) {
      if (isBlocked(x, 88.9)) blockedSpans.push(x);
    }
    expect(blockedSpans.length).toBeGreaterThan(0);
    const [min, max] = [Math.min(...blockedSpans), Math.max(...blockedSpans)];
    expect(min).toBeGreaterThan(17);
    expect(max).toBeLessThan(81);
  });
});
