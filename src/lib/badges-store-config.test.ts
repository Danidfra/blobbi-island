/**
 * The Badges Store's geometry — the claims a player would notice being wrong.
 *
 * Everything here is computed in PAINTED coordinates, from each sprite's
 * measured alpha box, because a box is not a picture: two boxes can sit flush
 * while the artwork inside them shows a gap. The margins below were measured off
 * the assets and are restated here so a resize cannot silently invalidate the
 * placement.
 *
 * The room's own numbers come from `badges-store-inside.webp` AFTER the
 * `object-cover` crop — the image is 1.4506 wide-to-tall against the world's
 * 1.5007, so image percent is not world percent and the raw file would give
 * answers that are wrong by 1.7 % at every edge.
 */

import { describe, it, expect } from 'vitest';

import {
  BADGES_STORE_CHECKOUT,
  BADGES_STORE_CHECKOUT_BLOCKER,
  BADGES_STORE_FACADE,
  BADGES_STORE_SHOP_BUTTON,
  badgesStoreBlockers,
  badgesStoreInteraction,
  badgesStoreInteractiveObjects,
  badgesStoreObjects,
} from './badges-store-config';
import { locationBoundaries } from './location-boundaries';
import { constrainPosition } from './boundaries';
import {
  LOCATION_INITIAL_POSITIONS,
  EXIT_POSITIONS,
} from './location-initial-position';
import { planRoute, isBlocked, type RouteBlocker } from './blobbi-route';
import { WORLD_ASPECT } from './world-coordinates';

const boundary = locationBoundaries['badges-store-inside.webp'];

/** Every rectangle the room registers with the movement system. */
const ALL_BLOCKERS: RouteBlocker[] = [
  ...badgesStoreBlockers,
  BADGES_STORE_CHECKOUT_BLOCKER,
];

/** Measured alpha padding, as a fraction of each sprite's own box. */
const ART = {
  'badges-store-display-case': {
    w: 320,
    h: 333,
    left: 0.025,
    right: 0.0156,
    top: 0.048,
    bottom: 0.045,
  },
  'badges-store-display-rack': {
    w: 320,
    h: 360,
    left: 0,
    right: 0.0594,
    top: 0,
    bottom: 0,
  },
} as const;

function pct(className: string, prefix: string): number {
  const match = className.match(new RegExp(`(?:^| )(-?)${prefix}-\\[([\\d.]+)%\\]`));
  if (!match) throw new Error(`no ${prefix}-[…%] in "${className}"`);
  return Number(match[2]) * (match[1] === '-' ? -1 : 1);
}

/** Where an object's ink actually lands, in world percent. */
function painted(id: keyof typeof ART) {
  const object = badgesStoreObjects.find((o) => o.id === id)!;
  const art = ART[id];
  const width = pct(object.className, 'w');
  const boxLeft = pct(object.className, 'left');
  const boxBottomY = 100 - pct(object.className, 'bottom');
  const heightPct = width * (art.h / art.w) * WORLD_ASPECT;
  return {
    left: boxLeft + width * art.left,
    right: boxLeft + width * (1 - art.right),
    /** World y of the lowest ink — the line the object stands on. */
    base: boxBottomY - heightPct * art.bottom,
    top: boxBottomY - heightPct * (1 - art.top),
  };
}

/** Does the boundary leave this point exactly where it is? */
function onFloor(point: { x: number; y: number }): boolean {
  const clamped = constrainPosition(point, boundary);
  return (
    Math.abs(clamped.x - point.x) < 1e-6 && Math.abs(clamped.y - point.y) < 1e-6
  );
}

/** Is there a walkable route from the spawn point to here? */
function reachableFromSpawn(target: { x: number; y: number }) {
  return planRoute(
    LOCATION_INITIAL_POSITIONS['badges-store-inside'],
    target,
    boundary,
    ALL_BLOCKERS,
  );
}

describe('the storefront in the mall', () => {
  it('uses the new artwork and names the action, not the picture', () => {
    expect(BADGES_STORE_FACADE.src).toBe('/assets/locations/shop/badges-store.webp');
    expect(BADGES_STORE_FACADE.alt).toMatch(/go inside/i);
  });

  it("stands its PAINTED base on the mall's middle-level floor line", () => {
    const width = pct(BADGES_STORE_FACADE.containerClassName, 'w');
    const boxBottomY = 100 - pct(BADGES_STORE_FACADE.containerClassName, 'bottom');
    // 1510×1041 with a 2.79 % bottom margin.
    const heightPct = width * (1041 / 1510) * WORLD_ASPECT;
    const base = boxBottomY - heightPct * 0.0279;
    // The line the Care Store facade stands on, measured the same way.
    expect(base).toBeCloseTo(61.5, 1);
  });

  it('puts the walk target on the walkway, not on the sprite base', () => {
    const mall = locationBoundaries['shopping-mall-inside.png'];
    const clamped = constrainPosition(BADGES_STORE_FACADE.walkTarget, mall);
    expect(clamped).toEqual(BADGES_STORE_FACADE.walkTarget);
    // The middle level's strip, the same one its neighbours are entered from.
    expect(BADGES_STORE_FACADE.walkTarget.y).toBeGreaterThanOrEqual(62.1);
    expect(BADGES_STORE_FACADE.walkTarget.y).toBeLessThanOrEqual(63.1);
  });

  it('comes back out where it went in', () => {
    expect(EXIT_POSITIONS['shop:badges-store-inside']).toEqual(
      BADGES_STORE_FACADE.walkTarget,
    );
  });
});

/**
 * What the two units painted when the store opened.
 *
 * Kept as literals rather than recomputed, because the claim under test is a
 * comparison against a PAST state: they were props, and they are furniture now.
 * Deriving these from the current config would make the assertions tautological.
 */
const OPENING_SIZE = {
  'badges-store-display-case': { width: 11.51, height: 17.0 },
  'badges-store-display-rack': { width: 10.35, height: 18.56 },
} as const;

/** How much bigger each unit is than it opened at, linearly. */
const TARGET_SCALE = 2;

describe('the two display units are full-size shop furniture', () => {
  it.each(['badges-store-display-case', 'badges-store-display-rack'] as const)(
    '%s is about %s× its opening size, without distortion',
    (id) => {
      const ink = painted(id);
      const was = OPENING_SIZE[id];
      const widthScale = (ink.right - ink.left) / was.width;
      const heightScale = (ink.base - ink.top) / was.height;

      expect(widthScale).toBeGreaterThan(TARGET_SCALE * 0.9);
      expect(widthScale).toBeLessThan(TARGET_SCALE * 1.1);
      // Same multiplier on both axes, or the artwork is stretched.
      expect(heightScale).toBeCloseTo(widthScale, 1);
    },
  );

  it.each(['badges-store-display-case', 'badges-store-display-rack'] as const)(
    '%s keeps its own aspect ratio',
    (id) => {
      const ink = painted(id);
      const art = ART[id];
      // The sprite's ink aspect, converted from image pixels into world percent.
      const inkAspect =
        ((art.w * (1 - art.left - art.right)) / (art.h * (1 - art.top - art.bottom))) *
        (1 / WORLD_ASPECT);
      const placed = (ink.right - ink.left) / (ink.base - ink.top);
      expect(placed).toBeCloseTo(inkAspect, 1);
    },
  );

  it('puts the case on the LEFT and the rack on the RIGHT, near the front', () => {
    const caseInk = painted('badges-store-display-case');
    const rackInk = painted('badges-store-display-rack');

    expect(caseInk.right).toBeLessThan(50);
    expect(rackInk.left).toBeGreaterThan(50);
    // Both well forward of the counter (base y ≈ 58.7) and clear of the frame.
    expect(caseInk.base).toBeGreaterThan(80);
    expect(rackInk.base).toBeGreaterThan(80);
    expect(caseInk.base).toBeLessThan(99);
    expect(rackInk.base).toBeLessThan(99);
  });

  it('anchors the case to the LEFT wall and the rack to the RIGHT wall', () => {
    const caseInk = painted('badges-store-display-case');
    const rackInk = painted('badges-store-display-rack');
    // Flush, not floating in the middle of its half of the room.
    expect(caseInk.left).toBeLessThan(1);
    expect(rackInk.right).toBeGreaterThan(99);
    // And nothing clipped off the frame.
    expect(caseInk.left).toBeGreaterThanOrEqual(0);
    expect(rackInk.right).toBeLessThanOrEqual(100);
  });

  it('balances the room without being one object twice', () => {
    const caseInk = painted('badges-store-display-case');
    const rackInk = painted('badges-store-display-rack');
    const caseWidth = caseInk.right - caseInk.left;
    const rackWidth = rackInk.right - rackInk.left;

    // Comparable visual weight...
    expect(Math.abs(caseWidth - rackWidth)).toBeLessThan(4);
    // ...but different furniture. Both are now anchored to their own wall, so
    // their POSITIONS are near-symmetric by design; what must stay distinct is
    // the furniture — the rack is narrower and taller than the case.
    expect(rackWidth).toBeLessThan(caseWidth);
    expect(rackInk.base - rackInk.top).toBeGreaterThan(caseInk.base - caseInk.top);
  });

  it('never overlap each other', () => {
    const caseInk = painted('badges-store-display-case');
    const rackInk = painted('badges-store-display-rack');
    expect(caseInk.right).toBeLessThan(rackInk.left);
  });

  it('leaves a wide central corridor, front to back', () => {
    const caseInk = painted('badges-store-display-case');
    const rackInk = painted('badges-store-display-rack');
    const corridor = rackInk.left - caseInk.right;
    // Comfortably more than a passage: about half the room's width.
    expect(corridor).toBeGreaterThan(30);

    // And it is genuinely walkable from the front of the room to the checkout.
    const centre = (caseInk.right + rackInk.left) / 2;
    for (const y of [96, 92, 88, 84, 80, 74, 68, 62]) {
      expect(onFloor({ x: centre, y }), `corridor at y=${y}`).toBe(true);
      expect(isBlocked({ x: centre, y }, ALL_BLOCKERS), `corridor at y=${y}`).toBe(
        false,
      );
    }
  });

  it('keeps space in front of, behind, and beside each of them', () => {
    for (const id of ['badges-store-display-case', 'badges-store-display-rack'] as const) {
      const object = badgesStoreObjects.find((o) => o.id === id)!;
      const ink = painted(id);
      const centre = (ink.left + ink.right) / 2;
      const behind = { x: centre, y: object.blocker!.y - 2 };

      // In front — between the unit's base and the bottom of the frame.
      expect(onFloor({ x: centre, y: ink.base + 4 }), id).toBe(true);
      expect(isBlocked({ x: centre, y: ink.base + 4 }, ALL_BLOCKERS), id).toBe(false);

      // Behind — open floor past the footprint's back edge.
      expect(onFloor(behind), id).toBe(true);
      expect(isBlocked(behind, ALL_BLOCKERS), id).toBe(false);

      // Beside, on the corridor side. Each unit is flush against its own wall,
      // so only the inward side can be walkable — "where visually possible".
      const inward =
        id === 'badges-store-display-case'
          ? { x: ink.right + 3, y: ink.base }
          : { x: ink.left - 3, y: ink.base };
      expect(onFloor(inward), id).toBe(true);
      expect(isBlocked(inward, ALL_BLOCKERS), id).toBe(false);
    }
  });

  it('blocks only the FEET, so the Blobbi can walk behind them', () => {
    for (const id of ['badges-store-display-case', 'badges-store-display-rack'] as const) {
      const object = badgesStoreObjects.find((o) => o.id === id)!;
      const ink = painted(id);
      const blocker = object.blocker!;
      const paintedHeight = ink.base - ink.top;

      // A shallow band, not the painted silhouette — even at twice the size.
      expect(blocker.height).toBeLessThan(paintedHeight / 4);
      // And no wider than the artwork that stands on it.
      expect(blocker.width).toBeLessThanOrEqual(ink.right - ink.left + 0.01);
      // Sitting at the object's base rather than floating.
      expect(blocker.y + blocker.height).toBeCloseTo(ink.base, 0);
      // ...and the floor directly behind it is open.
      expect(isBlocked({ x: (ink.left + ink.right) / 2, y: blocker.y - 2 }, ALL_BLOCKERS)).toBe(
        false,
      );
    }
  });

  it('is walkable BEHIND both units, from the spawn point', () => {
    for (const id of ['badges-store-display-case', 'badges-store-display-rack'] as const) {
      const object = badgesStoreObjects.find((o) => o.id === id)!;
      const ink = painted(id);
      // Directly behind the footprint — the click that used to walk the Blobbi
      // into the furniture and leave it there.
      const behind = {
        x: (ink.left + ink.right) / 2,
        y: object.blocker!.y - 3,
      };
      const route = reachableFromSpawn(behind);
      expect(route, `behind ${id}`).not.toBeNull();
      expect(route![route!.length - 1]).toEqual(behind);
    }
  });

  it('cannot be walked THROUGH', () => {
    for (const object of badgesStoreObjects) {
      const blocker = object.blocker!;
      const middle = {
        x: blocker.x + blocker.width / 2,
        y: blocker.y + blocker.height / 2,
      };
      expect(isBlocked(middle, ALL_BLOCKERS)).toBe(true);
      // The planner refuses a destination inside furniture outright.
      expect(reachableFromSpawn(middle)).toBeNull();
    }
  });
});

describe('the checkout', () => {
  it('sits over the counter painted into the background', () => {
    const left = pct(BADGES_STORE_CHECKOUT.className, 'left');
    const width = pct(BADGES_STORE_CHECKOUT.className, 'w');
    // The counter's probed extent: x 39 → 58.5 %.
    expect(left).toBeCloseTo(39, 0);
    expect(left + width).toBeCloseTo(58.5, 0);
  });

  it('blocks the counter footprint', () => {
    const middle = {
      x: BADGES_STORE_CHECKOUT_BLOCKER.x + BADGES_STORE_CHECKOUT_BLOCKER.width / 2,
      y: BADGES_STORE_CHECKOUT_BLOCKER.y + BADGES_STORE_CHECKOUT_BLOCKER.height / 2,
    };
    expect(isBlocked(middle, ALL_BLOCKERS)).toBe(true);
    // The boundary agrees: the counter's floor is not floor you can stand on.
    expect(onFloor(middle)).toBe(false);
  });

  it('stands the player IN FRONT of the counter, never behind it', () => {
    const stand = BADGES_STORE_CHECKOUT.standPoint;
    // In front means further down the screen than the counter's base.
    expect(stand.y).toBeGreaterThan(
      BADGES_STORE_CHECKOUT_BLOCKER.y + BADGES_STORE_CHECKOUT_BLOCKER.height,
    );
    expect(isBlocked(stand, ALL_BLOCKERS)).toBe(false);
    expect(onFloor(stand)).toBe(true);
  });
});

describe('every stand point is somewhere the Blobbi can actually get to', () => {
  const standPoints = [
    ...badgesStoreInteractiveObjects.map((o) => ({
      id: o.id,
      point: o.interaction!.standPoint,
    })),
    { id: BADGES_STORE_CHECKOUT.id, point: BADGES_STORE_CHECKOUT.standPoint },
  ];

  it.each(standPoints)('$id', ({ point }) => {
    expect(onFloor(point)).toBe(true);
    expect(isBlocked(point, ALL_BLOCKERS)).toBe(false);
    const route = reachableFromSpawn(point);
    expect(route).not.toBeNull();
    expect(route![route!.length - 1]).toEqual(point);
  });

  it('spawns on open floor, clear of everything', () => {
    const spawn = LOCATION_INITIAL_POSITIONS['badges-store-inside'];
    expect(onFloor(spawn)).toBe(true);
    expect(isBlocked(spawn, ALL_BLOCKERS)).toBe(false);
  });
});

describe('the config is internally consistent', () => {
  it('gives every interactive object a real accessible name', () => {
    for (const object of badgesStoreInteractiveObjects) {
      expect(object.alt, object.id).toBeTruthy();
    }
    expect(BADGES_STORE_CHECKOUT.alt).toBeTruthy();
  });

  it('converges every interaction on ONE surface', () => {
    for (const object of badgesStoreInteractiveObjects) {
      expect(object.interaction!.opens).toBe('badges');
    }
  });

  it('uses stable ids that are not derived from filenames', () => {
    const ids = badgesStoreObjects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const object of badgesStoreObjects) {
      expect(object.src).not.toContain(object.id);
    }
  });

  it('throws rather than returning undefined for a non-interactive id', () => {
    expect(() => badgesStoreInteraction('badges-store-nonexistent')).toThrow();
  });

  it('names the shortcut for what it opens', () => {
    expect(BADGES_STORE_SHOP_BUTTON.label).toMatch(/badges/i);
    expect(BADGES_STORE_SHOP_BUTTON.text).toBe('Badges');
  });
});
