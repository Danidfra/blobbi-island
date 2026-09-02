/**
 * The Furniture Store's geometry, against the artwork that is the room.
 *
 * Three kinds of claim, and none of them is a coordinate snapshot:
 *
 *  1. the store POINTS AT its new assets, and the two-sprite storefront it
 *     replaced — facade plus a door overlay that never had a click handler —
 *     is gone from the repository and from every config;
 *  2. the walkable floor matches the picture: the aisle is a funnel between two
 *     raised display platforms, the platforms are not floor, and the room is
 *     still one connected space with the checkout reachable from the spawn;
 *  3. the checkout hotspot sits OVER the painted desk and stands the player on
 *     the customer's side of it.
 *
 * Floor claims run through the REAL clamp (`constrainPosition`) and the REAL
 * blocker rule against the REAL config. All coordinates are GROUND-ANCHOR
 * (feet), like every boundary in the game.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { constrainPosition, type Boundary } from './boundaries';
import { locationBoundaries } from './location-boundaries';
import { locationScalingConfig } from './location-scaling-config';
import { getBackgroundForLocation } from './location-backgrounds';
import { getBlobbiSizeForLocation } from './location-blobbi-sizes';
import { calculateBlobbiZIndex } from './interactive-elements-config';
import { LOCATION_INITIAL_POSITIONS, EXIT_POSITIONS } from './location-initial-position';
import {
  FURNITURE_STORE_CHECKOUT,
  FURNITURE_STORE_FACADE,
  FURNITURE_STORE_SHOP_BUTTON,
  furnitureStoreBlockers,
} from './furniture-store-config';
import { CARE_STORE_FACADE } from './care-store-config';
import { WORLD_ASPECT } from './world-coordinates';
import type { Position } from './types';

const LOCATION = 'furniture-store-inside';
const BACKGROUND = 'furniture-store-inside.webp';

/** The two-sprite storefront the new facade replaced. */
const OLD_FACADE = 'public/assets/locations/shop/furniture-store.png';
const OLD_FACADE_DOOR = 'public/assets/locations/shop/doors/furniture-store-door.png';

const boundary = locationBoundaries[BACKGROUND];
const mallBoundary = locationBoundaries['shopping-mall-inside.png'];

/** The exact rule `MovementBlockerContext.isPositionBlocked` applies. */
function isBlocked(point: Position): boolean {
  return furnitureStoreBlockers.some(
    (b) =>
      point.x >= b.x &&
      point.x <= b.x + b.width &&
      point.y >= b.y &&
      point.y <= b.y + b.height,
  );
}

/** A point the walk boundary does not have to move — i.e. real floor. */
function onFloor(point: Position, b: Boundary = boundary): boolean {
  const clamped = constrainPosition(point, b);
  return Math.abs(clamped.x - point.x) < 1e-6 && Math.abs(clamped.y - point.y) < 1e-6;
}

function standable(point: Position): boolean {
  return onFloor(point) && !isBlocked(point);
}

/**
 * Can the Blobbi walk from `from` to `to` without being stopped?
 *
 * Mirrors the movement loop: no pathfinding, one straight line, each step
 * clamped into the boundary and halted the moment it lands in a blocker.
 * `room-routing.test.ts` asks the harder question — whether the shared planner
 * finds a way round when this fails.
 */
function walkable(from: Position, to: Position, steps = 400): boolean {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const stepped = constrainPosition(
      { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
      boundary,
    );
    if (isBlocked(stepped)) return false;
  }
  return true;
}

const SPAWN = LOCATION_INITIAL_POSITIONS[LOCATION];

/** A placement, read back out of its Tailwind class string. */
function placement(className: string) {
  const pct = (prop: string) => {
    const found = className.match(new RegExp(`${prop}-\\[([\\d.]+)%\\]`));
    if (!found) throw new Error(`no ${prop} in "${className}"`);
    return Number(found[1]);
  };
  const left = pct('left'), top = pct('top'), width = pct('w'), height = pct('h');
  return { left, top, width, height, right: left + width, bottom: top + height };
}

// ---------------------------------------------------------------------------
// 1. The store points at its new assets, and only at them
// ---------------------------------------------------------------------------

describe('the storefront in the mall', () => {
  it('uses the new artwork and names the action, not the picture', () => {
    expect(FURNITURE_STORE_FACADE.src).toBe('/assets/locations/shop/furniture-store.webp');
    expect(FURNITURE_STORE_FACADE.alt).toMatch(/go inside/i);
    expect(existsSync(join('public', FURNITURE_STORE_FACADE.src))).toBe(true);
  });

  it('the old two-sprite storefront is deleted, dead door included', () => {
    expect(existsSync(OLD_FACADE)).toBe(false);
    expect(existsSync(OLD_FACADE_DOOR)).toBe(false);
  });

  it('nothing renders the old facade or its door any more', () => {
    const source = readFileSync('src/components/blobbi/InteractiveElements.tsx', 'utf8');
    // The comment explaining the deletion names the file; a rendered `src=`
    // would not be inside a comment, so assert on the JSX attribute form.
    expect(source).not.toContain('src="/assets/locations/shop/furniture-store.png"');
    expect(source).not.toContain('src="/assets/locations/shop/doors/furniture-store-door.png"');
  });

  it('stands its PAINTED base on the top level’s floor line', () => {
    const cls = FURNITURE_STORE_FACADE.containerClassName;
    const width = Number(cls.match(/w-\[([\d.]+)%\]/)![1]);
    const left = Number(cls.match(/left-\[([\d.]+)%\]/)![1]);
    const boxBottomY = 100 - Number(cls.match(/bottom-\[([\d.]+)%\]/)![1]);

    // 1536×1024 with ink margins l/r 1.89 %, b 1.76 %.
    const heightPct = width * (1024 / 1536) * WORLD_ASPECT;
    const paintedLeft = left + width * 0.0189;
    const paintedRight = left + width * (1 - 0.0189);
    const paintedTop = boxBottomY - heightPct * (1 - 0.0176);
    const paintedBase = boxBottomY - heightPct * 0.0176;

    // The line the old `.png` storefront stood on, measured the same way.
    expect(paintedBase).toBeCloseTo(33.02, 1);
    // Centred on the level, and inside it rather than through its ceiling trim.
    expect((paintedLeft + paintedRight) / 2).toBeCloseTo(50, 1);
    expect(paintedTop).toBeGreaterThan(5);
  });

  it('puts the walk target on the TOP walkway, not on the sprite base', () => {
    const clamped = constrainPosition(FURNITURE_STORE_FACADE.walkTarget, mallBoundary);
    expect(clamped).toEqual(FURNITURE_STORE_FACADE.walkTarget);
    // The top level's strip of `shopping-mall-inside.png`.
    expect(FURNITURE_STORE_FACADE.walkTarget.y).toBeGreaterThanOrEqual(32.5);
    expect(FURNITURE_STORE_FACADE.walkTarget.y).toBeLessThanOrEqual(33.5);
  });

  it('stands under its own storefront, not beside it', () => {
    expect(FURNITURE_STORE_FACADE.walkTarget.x).toBeGreaterThan(37);
    expect(FURNITURE_STORE_FACADE.walkTarget.x).toBeLessThan(63);
  });

  it('comes back out where it went in', () => {
    expect(EXIT_POSITIONS[`shop:${LOCATION}`]).toEqual(FURNITURE_STORE_FACADE.walkTarget);
  });
});

describe('the facade sits behind the mall glass', () => {
  /**
   * Read off `InteractiveElements`' own mall branch rather than hard-coded, so
   * this fails if the glass ever moves rather than quietly agreeing with a
   * stale copy of its depth.
   */
  const mallSource = readFileSync(
    'src/components/blobbi/InteractiveElements.tsx',
    'utf8',
  );
  const zOf = (marker: string) => {
    const at = mallSource.indexOf(marker);
    expect(at, `"${marker}" not found in the mall branch`).toBeGreaterThan(-1);
    const after = mallSource.slice(at, at + 400);
    const found = after.match(/z-\[(\d+)\]/);
    if (!found) throw new Error(`no z-index near "${marker}"`);
    return Number(found[1]);
  };

  const facadeZ = Number(
    FURNITURE_STORE_FACADE.containerClassName.match(/z-\[(\d+)\]/)![1],
  );
  const topGlassZ = zOf('glass-barrier-top.png');
  const bottomGlassZ = zOf('glass-barrier-bottom.png');

  it('the mall really does have two glass layers at different depths', () => {
    // If this ever stops being true the rest of this block is meaningless.
    expect(topGlassZ).toBeLessThan(bottomGlassZ);
  });

  it('renders BEHIND the top level’s glass, where the store actually is', () => {
    expect(facadeZ).toBeLessThan(topGlassZ);
  });

  it('renders behind a Blobbi standing at its own door', () => {
    // The mall's own band gives an actor on the top walkway its z-index; the
    // storefront must be under it, or the shop covers the player.
    const onTopWalkway = calculateBlobbiZIndex(
      FURNITURE_STORE_FACADE.walkTarget.y,
      'shopping-mall-inside.png',
    );
    expect(facadeZ).toBeLessThan(onTopWalkway);
    // ...and the glass stays in front of the Blobbi too, as it does downstairs.
    expect(onTopWalkway).toBeLessThan(topGlassZ);
  });

  it('uses the SAME relationship the middle-level storefronts use', () => {
    // facade < Blobbi < glass, on both levels. The numbers differ because the
    // two balconies are at different depths; the ordering does not.
    const middleFacadeZ = Number(
      CARE_STORE_FACADE.containerClassName.match(/z-\[(\d+)\]/)![1],
    );
    const onMiddleWalkway = calculateBlobbiZIndex(
      CARE_STORE_FACADE.walkTarget.y,
      'shopping-mall-inside.png',
    );
    expect(middleFacadeZ).toBeLessThan(onMiddleWalkway);
    expect(onMiddleWalkway).toBeLessThan(bottomGlassZ);
  });

  it('is still above the mall background, not lost behind it', () => {
    expect(facadeZ).toBeGreaterThan(1);
  });

  it('stays clickable despite sitting low in the stack', () => {
    // The artwork is behind the glass, but the glass layer takes no pointer
    // events at all, so the storefront is still the thing under the cursor.
    const glassWrapper = mallSource.slice(
      mallSource.indexOf("if (backgroundFile === 'shopping-mall-inside.png')"),
      mallSource.indexOf('glass-barrier-bottom.png'),
    );
    expect(glassWrapper).toContain('pointer-events-none');
  });
});

describe('the room is a first-class location', () => {
  it('renders the new interior artwork', () => {
    expect(getBackgroundForLocation(LOCATION)).toBe(BACKGROUND);
    expect(existsSync(join('public/assets/world/backgrounds', BACKGROUND))).toBe(true);
  });

  it('has an entry in every table a room needs', () => {
    expect(boundary).toBeDefined();
    expect(locationScalingConfig[BACKGROUND]).toBeDefined();
    expect(getBlobbiSizeForLocation(LOCATION)).toBe('xl');
    expect(LOCATION_INITIAL_POSITIONS[LOCATION]).toBeDefined();
  });

  it('scales the Blobbi with the aisle’s depth', () => {
    const { initialScale, finalScale } = locationScalingConfig[BACKGROUND];
    // Front of the room is nearer the camera than the back of the aisle.
    expect(initialScale).toBeGreaterThan(finalScale);
    // The deepest interior in the game, so the widest ramp of the shop rooms.
    expect(initialScale / finalScale).toBeGreaterThan(1.4);
  });
});

// ---------------------------------------------------------------------------
// 2. The floor is the floor in the picture
// ---------------------------------------------------------------------------

describe('spawn and exit', () => {
  it('spawns on open floor, clear of every blocker', () => {
    expect(standable(SPAWN)).toBe(true);
  });

  it('spawns at the mouth of the aisle, in front of the checkout', () => {
    expect(SPAWN.y).toBeGreaterThan(FURNITURE_STORE_CHECKOUT.standPoint.y);
  });

  it('returns to the mall on walkable floor', () => {
    expect(onFloor(EXIT_POSITIONS[`shop:${LOCATION}`], mallBoundary)).toBe(true);
  });
});

describe('the Blobbi walks on visible floor', () => {
  /**
   * Points measured off `furniture-store-inside.webp`: for each, the boards run
   * unbroken from there to the bottom of the frame.
   */
  const openFloor: [string, Position][] = [
    ['spawn', SPAWN],
    ['front-left corner', { x: 3, y: 96 }],
    ['front-centre', { x: 50, y: 96 }],
    ['front-right corner', { x: 97, y: 96 }],
    ['the aisle mouth', { x: 50, y: 86 }],
    ['mid-aisle', { x: 50, y: 75 }],
    ['up the aisle', { x: 50, y: 63 }],
    ['at the desk', FURNITURE_STORE_CHECKOUT.standPoint],
  ];

  it.each(openFloor)('%s is standable', (_label, point) => {
    expect(standable(point)).toBe(true);
  });

  /** Points that are display PLATFORM, wall or off-frame in the artwork. */
  const notFloor: [string, Position][] = [
    ['the left platform, on the sofa', { x: 12, y: 70 }],
    ['the left platform, at its front edge', { x: 12, y: 86 }],
    ['the right platform, on the bed', { x: 88, y: 70 }],
    ['the right platform, at its front edge', { x: 88, y: 86 }],
    ['the back wall above the desk', { x: 50, y: 40 }],
    ['the ceiling', { x: 50, y: 10 }],
    ['off the left frame edge', { x: -10, y: 95 }],
    ['off the right frame edge', { x: 115, y: 95 }],
  ];

  it.each(notFloor)('%s is not floor', (_label, point) => {
    expect(onFloor(point)).toBe(false);
  });

  it('the clamp always lands inside the room', () => {
    for (const point of [
      { x: 50, y: 130 },
      { x: -20, y: 90 },
      { x: 140, y: 90 },
      { x: 50, y: 5 },
      { x: 5, y: 60 },
      { x: 95, y: 60 },
    ]) {
      const clamped = constrainPosition(point, boundary);
      expect(onFloor(clamped), `${point.x},${point.y}`).toBe(true);
      expect(clamped.x).toBeGreaterThanOrEqual(0);
      expect(clamped.x).toBeLessThanOrEqual(100);
      // The aisle's back edge is the checkout desk's own base.
      expect(clamped.y).toBeGreaterThanOrEqual(56);
      expect(clamped.y).toBeLessThanOrEqual(99);
    }
  });
});

describe('the display platforms are not walkable, and need no blockers to say so', () => {
  it('the aisle narrows as it goes back, exactly as the platforms do', () => {
    // Sampled along the funnel: at each depth, the widest x still on floor.
    const widthAt = (y: number) => {
      let count = 0;
      for (let x = 0; x <= 100; x += 0.5) if (onFloor({ x, y })) count += 0.5;
      return count;
    };
    const front = widthAt(95);
    const mid = widthAt(80);
    const back = widthAt(62);
    expect(front).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(back);
    // Front is effectively wall to wall; the service aisle is a fifth of it.
    expect(front).toBeGreaterThan(95);
    expect(back).toBeLessThan(30);
  });

  it('registers exactly one blocker, and it is the desk', () => {
    expect(furnitureStoreBlockers.map((b) => b.id)).toEqual([
      'furniture-store-checkout',
    ]);
  });

  it('has no invisible walls standing on open floor', () => {
    // Every blocker must be something the artwork paints, which here means it
    // sits at the aisle's back edge rather than out in the room.
    for (const b of furnitureStoreBlockers) {
      expect(b.y + b.height, b.id).toBeLessThanOrEqual(56);
      expect(b.width, b.id).toBeGreaterThan(0);
      expect(b.height, b.id).toBeGreaterThan(0);
      expect(b.x, b.id).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, b.id).toBeLessThanOrEqual(100);
    }
  });
});

describe('the room is one connected space', () => {
  it('the front of the showroom is one continuous walk, wall to wall', () => {
    expect(walkable({ x: 3, y: 96 }, { x: 97, y: 96 })).toBe(true);
  });

  it('the spawn reaches the checkout in a straight line up the aisle', () => {
    expect(walkable(SPAWN, FURNITURE_STORE_CHECKOUT.standPoint)).toBe(true);
  });

  it('the checkout can be left again for either front corner', () => {
    expect(walkable(FURNITURE_STORE_CHECKOUT.standPoint, { x: 5, y: 96 })).toBe(true);
    expect(walkable(FURNITURE_STORE_CHECKOUT.standPoint, { x: 95, y: 96 })).toBe(true);
  });

  it('a walk aimed at a display platform lands back on open floor', () => {
    // The composite clamps to its NEAREST band, so a step aimed at the sofa
    // never lands on the platform: it comes back out in front of it, or into
    // the aisle beside it, depending on which is closer.
    for (const aim of [
      { x: 10, y: 70 },  // deep in the living-room set
      { x: 90, y: 70 },  // deep in the bedroom set
      { x: 25, y: 82 },  // just over the left platform's edge
      { x: 75, y: 82 },  // just over the right platform's edge
    ]) {
      const clamped = constrainPosition(aim, boundary);
      expect(onFloor(clamped), `${aim.x},${aim.y}`).toBe(true);
      expect(isBlocked(clamped), `${aim.x},${aim.y}`).toBe(false);
      // It was moved: the platform is not somewhere the Blobbi may stand.
      expect(clamped, `${aim.x},${aim.y}`).not.toEqual(aim);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The checkout sits over what it names
// ---------------------------------------------------------------------------

describe('the checkout', () => {
  const box = placement(FURNITURE_STORE_CHECKOUT.className);
  const desk = furnitureStoreBlockers.find((b) => b.id === 'furniture-store-checkout')!;

  it('covers the desk painted in the artwork', () => {
    // Measured: wooden top x 42.3–60.1 from y ≈ 43.6, plinth base at y ≈ 55.3.
    expect(box.left).toBeCloseTo(42.3, 1);
    expect(box.right).toBeCloseTo(60.1, 1);
    expect(box.top).toBeCloseTo(43.6, 1);
    expect(box.bottom).toBeCloseTo(55.3, 1);
  });

  it('sits over its own floor footprint, horizontally', () => {
    expect(box.left).toBeCloseTo(desk.x, 1);
    expect(box.right).toBeCloseTo(desk.x + desk.width, 1);
  });

  it('stands the player on the CUSTOMER side of the desk', () => {
    const { standPoint } = FURNITURE_STORE_CHECKOUT;
    expect(standPoint.y).toBeGreaterThan(desk.y + desk.height);
    expect(standPoint.x).toBeGreaterThan(desk.x);
    expect(standPoint.x).toBeLessThan(desk.x + desk.width);
    expect(standable(standPoint)).toBe(true);
  });

  it('is close enough to the desk to read as being served', () => {
    const gap = FURNITURE_STORE_CHECKOUT.standPoint.y - (desk.y + desk.height);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(3);
  });

  it('is placed in world percent, never raw pixels', () => {
    expect(FURNITURE_STORE_CHECKOUT.className).not.toMatch(/\[\d+px\]/);
    expect(FURNITURE_STORE_SHOP_BUTTON.className).toMatch(/bottom-\[[\d.]+%\]/);
    expect(FURNITURE_STORE_SHOP_BUTTON.className).toMatch(/right-\[[\d.]+%\]/);
  });

  it('is named for what it opens, as is the shortcut', () => {
    expect(FURNITURE_STORE_CHECKOUT.label).toMatch(/furniture/i);
    expect(FURNITURE_STORE_SHOP_BUTTON.label).toMatch(/furniture store/i);
  });

  it('sits below the Blobbi at every depth in the room', () => {
    const hotspotZ = Number(
      FURNITURE_STORE_CHECKOUT.className.match(/z-\[(\d+)\]/)![1],
    );
    for (const y of [58, 65, 75, 85, 95, 99]) {
      expect(calculateBlobbiZIndex(y, BACKGROUND), `y=${y}`).toBeGreaterThan(hotspotZ);
    }
  });
});
