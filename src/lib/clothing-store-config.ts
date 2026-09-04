/**
 * The Clothing Store's interior: where its floor is, what stands on it, and
 * what the player can click.
 *
 * ## The artwork is the room
 *
 * `clothing-store.webp` is a FURNISHED boutique, two curtained fitting rooms
 * on the left, a leaning mirror, wall shelving, a purple checkout island, a
 * clothing rack and a tall bookcase on the right, all painted in. It replaced
 * `clothing-store-inside.png`, which was an empty shell that nine separate
 * sprites were composed onto (rug, two posters, a sign, a hat shelf, a checkout,
 * a fitting room and two display tables). Those sprites and their placement are
 * gone: the new picture already contains the furniture they drew, and layering
 * them back over it would have shown the room twice.
 *
 * So this file no longer describes a scene graph. There is nothing to render.
 * What is left is the part a picture cannot state: where the Blobbi's feet may
 * go, and which regions of the image are controls.
 *
 * ## Coordinates
 *
 * World percent of the fixed 1046×697 design box, like every other room.
 *
 * `clothing-store.webp` is 1600×1103, aspect 1.4506 against the world's
 * 1.5007: so `object-cover` matches its WIDTH and crops it top and bottom.
 * Image x percentages are world x percentages; image y percentages are not.
 * Every number below was measured on the surviving crop (image rows 18…1085,
 * `worldY% = (imageY − 18.42) / 1066.16 × 100`), which is what the player
 * actually sees. That is the same arrangement `badges-store-inside.webp` has,
 * and it is why the two files quote row ranges rather than raw image percents.
 *
 * ## Ground-anchor semantics
 *
 * Blockers are tested against the Blobbi's GROUND point (its feet), like every
 * boundary in the game. Each rectangle is an object's floor FOOTPRINT, the
 * band of floor it stands on; not its painted height. A Blobbi's body may
 * overlap a booth or a counter above the floor, which is what standing AT the
 * till looks like.
 *
 * ## Where the boundary ends and a blocker begins
 *
 * `location-boundaries.ts` holds the floor's outer PERIMETER; this file holds
 * the things standing inside it. The split is the Care Store's, for its reason:
 * a composite boundary clamps to its nearest area, so punching a hole makes the
 * Blobbi slide round the rim, while a blocker stops the walk and lets the route
 * planner go round.
 *
 * Which means most of this room's furniture needs no blocker at all. The wall
 * shelving, the clothing rack's bench and the right-hand bookcase are pressed
 * against walls with no floor behind them, so the boundary's own back edge IS
 * their footprint. Only four things stand out ON the floor: the two booths, the
 * leaning mirror, and the checkout island.
 */

import type { Position } from '@/lib/types';

/** A rectangle in world percent, matching `MovementBlocker`'s props. */
export interface ClothingStoreBlocker {
  /** Stable id; also the blocker id in `MovementBlockerContext`. */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Which of the room's two modal surfaces an interaction opens. */
export type ClothingStoreSurface = 'shop' | 'fitting-room';

/**
 * A clickable region of the painted background.
 *
 * A hotspot rather than a sprite, because there is no sprite: the checkout and
 * both booths are part of the artwork. The room renders each as a real labelled
 * `<button>` over the region, keyboard reachable, named for what it opens, and
 * already move-blocking via `BLOCK_UI_SELECTOR`, so a tap never also starts a
 * raw world walk. The Care Store's checkout established the shape.
 */
export interface ClothingStoreHotspot {
  /** Stable identity. Used as the React key and by the tests. Never a filename. */
  readonly id: string;
  /** Accessible name. Names the outcome, not the furniture. */
  readonly label: string;
  /** Placement over the artwork, in world percent. Never raw pixels. */
  readonly className: string;
  /** Which surface ARRIVAL opens. Never opened by the click itself. */
  readonly opens: ClothingStoreSurface;
  /** Where the Blobbi stands before the surface opens. */
  readonly standPoint: Position;
}

// ---------------------------------------------------------------------------
// The storefront, in the shopping mall
// ---------------------------------------------------------------------------

/**
 * The Clothing Store facade on the mall's middle level.
 *
 * ## The facade IS the entrance
 *
 * It used to be two sprites: `clothing-store.png` plus a
 * `doors/clothing-store-door.png` overlay that carried the click. The new
 * artwork is an OPEN-FRONT storefront, awning, sign, and the boutique visible
 * behind it: with no door painted anywhere, so a door overlay would have been
 * a door-shaped affordance floating over a shop that has none. Both old sprites
 * are deleted and the whole storefront is the click target, exactly as the Care
 * and Badges Stores next to it already work.
 *
 * ## Placement
 *
 * `clothing-store.webp` is 1536×1024 (a 1.5 box, the world's own ratio) with ink
 * margins l/r 3.19 %, t 1.07 %, b 2.93 %. The old `.png` had none, which is why
 * its box could sit flush on the floor line at `bottom-[38.5%]`; this one cannot.
 *
 * The numbers below reproduce the OLD PAINTED EXTENT exactly, so nothing else on
 * the level has to move:
 *
 *   box width  W = 24.5 / 0.9362 = 26.17 %  → paints 24.5 % wide, as before
 *   box left     = 50 − 0.0319 · W = 49.17 % → paints from x = 50.0, as before
 *   box bottom   = 38.5 − 0.0293 · W = 37.73 % → painted base on y = 61.5 %
 *
 * Painted extent: x 50.0 → 74.5 %, base y = 61.5 %, the same floor line the
 * Care and Badges facades stand on, measured the same way. It clears the Care
 * Store (which paints to x = 49.90 %) by the same whisker it always did.
 *
 * Note the box bottom moves WITH the width: widening the facade thickens the
 * transparent film under it, which sinks the painted base unless the anchor
 * follows it down. The Care Store facade records the same trap.
 */
export const CLOTHING_STORE_FACADE = {
  src: '/assets/locations/shop/clothing-store.webp',
  /** Names the action, not the picture: this is a way in. */
  alt: 'Clothing Store: go inside',
  containerClassName: 'absolute bottom-[37.73%] left-[49.17%] z-[15] w-[26.17%]',
  /**
   * Where the Blobbi stands to go in.
   *
   * Deliberately the SAME point it returns onto when it comes back out
   * (`EXIT_POSITIONS['shop:clothing-store-inside']`), so going in and coming out
   * cannot drift apart. It is on the middle level's walkable strip
   * `y ∈ [62.1, 63.1]` of `shopping-mall-inside.png`.
   *
   * Stated rather than derived, for the reason `care-store-config.ts` records:
   * `InteractiveElement` would otherwise take the sprite's own base, and this
   * storefront is set back against the wall, so "the floor at this sprite's
   * base" is not floor at all; it lands above the strip, off the mall's
   * walkable floor, and a route to a point outside the room is now correctly
   * refused rather than clamped and hoped for.
   */
  walkTarget: { x: 58, y: 62.6 } as Position,
} as const;

// ---------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------

/**
 * The things standing ON the floor.
 *
 * ```
 *   ┌────┬───┐ ▯      ▭▭▭▭▭        ╭──────────╮        ▭▭▭▭    ▯
 *   │ FR │FR │mirror  wall shelf   │ CHECKOUT │      rack bench │ bookcase
 *   │ L  │ R │                     ╰──────────╯                 │
 *   └────┴───┘◄─── open floor, wall to wall, in front of it all ─┘
 * ```
 *
 * The wall shelf, the rack's bench and the bookcase are absent on purpose: they
 * have no floor behind them, so the walk boundary's back edge already is their
 * footprint and a blocker would only duplicate it.
 */
export const clothingStoreBlockers: readonly ClothingStoreBlocker[] = [
  {
    /**
     * The LEFT fitting room, the one against the side wall, its curtain drawn
     * back over a stool and a star mat.
     *
     * Measured: its purple frame's outer post occupies x 0.2–1.8 % and its inner
     * post x 9.7–11.4 %, both constant from the arch down. The booth's threshold
     * is not level, because it is seen at an angle: the outer post meets the
     * floor at y ≈ 73.8 % and the inner one at y ≈ 69.7 %. The rectangle takes
     * the FRONT of that line rather than its average, a player reads the booth
     * as one alcove, and clipping the near corner while being stopped at the far
     * one is the kind of collision that feels broken even when the maths is
     * right.
     */
    id: 'clothing-store-fitting-room-left',
    x: 0,
    y: 62,
    width: 11.5,
    height: 10.5,
  },
  {
    /**
     * The RIGHT fitting room, the second booth, half a step further back, so
     * its whole footprint sits higher up the image than its neighbour's.
     *
     * Measured: frame posts at x 12.3–13.5 % and x 18.6–20.0 %, meeting the
     * floor at y ≈ 69 % and y ≈ 66.5 % respectively.
     */
    id: 'clothing-store-fitting-room-right',
    x: 12,
    y: 60,
    width: 8.2,
    height: 9,
  },
  {
    /**
     * The full-length mirror, leaning against the shelving between the booths
     * and the wall units.
     *
     * Measured on its purple frame: rails at x 21.8 % and x 25.8 % at y = 64 %,
     * with the bottom rail spanning x 21.8–25.5 % at y ≈ 66–67.5 %. It leans OUT
     * over the floor, which is why it is a blocker at all while the shelving
     * behind it is not.
     */
    id: 'clothing-store-mirror',
    x: 21.3,
    y: 61,
    width: 5,
    height: 6.7,
  },
  {
    /**
     * The checkout island, the room's one piece of free-standing furniture,
     * and the only blocker the player will really notice.
     *
     * Measured: the gold plinth paints x 37.7–60.5 % and its front edge meets
     * the floor at y ≈ 69.3 % on the centre line, rising to y ≈ 68 % at either
     * end. The counter's back is wedged between the wall shelving on its left
     * and the rack's bench on its right; there is no floor behind it, and the
     * rectangle reaches back past the wall line to say so. Walking round the
     * back of this till is not a route; standing in front of it is.
     */
    id: 'clothing-store-checkout',
    x: 37.5,
    y: 62.5,
    width: 23,
    height: 6.9,
  },
];

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/**
 * The checkout.
 *
 * The hotspot covers the counter's whole visible body: from the gold worktop at
 * y ≈ 52 %, the monitor and the little star sign stand above that and are not
 * part of the target, down to the plinth's base at y ≈ 69.5 %, across the
 * plinth's full painted width.
 *
 * Its stand point is on the CUSTOMER's side. y = 73 % is open floor 3.6 % below
 * the counter's front edge (25 world px, comfortably inside the 40 px arrival
 * threshold once the walk lands) and squarely inside the boundary band that
 * crosses the room in front of the till.
 */
export const CLOTHING_STORE_CHECKOUT: ClothingStoreHotspot = {
  id: 'clothing-store-checkout',
  label: 'Checkout counter: browse clothing',
  className: 'absolute left-[37.5%] top-[52%] h-[17.5%] w-[23%] z-[12]',
  opens: 'shop',
  standPoint: { x: 49, y: 73 },
};

/**
 * The two fitting rooms, left to right.
 *
 * TWO hotspots and ONE modal. They are separate controls because they are
 * separate booths and each is walked to separately, but they open the same
 * `<FittingRoomModal>` from the same surface slot; see `ClothingStoreRoom`.
 * A second preview surface is not a feature, it is a second copy of the same
 * dialog waiting to disagree with the first.
 *
 * Each hotspot covers its own booth's painted arch and opening, and each stand
 * point is on the floor directly in front of that booth's threshold, clear of
 * its blocker, and far enough apart that the two are never confused.
 */
export const CLOTHING_STORE_FITTING_ROOM_LEFT: ClothingStoreHotspot = {
  id: 'clothing-store-fitting-room-left',
  label: 'Left fitting room; try clothes on your Blobbi',
  /** The booth's arch crowns at y ≈ 18.5 %; its outer post reaches y ≈ 73.5 %. */
  className: 'absolute left-[0%] top-[18.5%] h-[55%] w-[11.5%] z-[12]',
  opens: 'fitting-room',
  standPoint: { x: 6, y: 76 },
};

export const CLOTHING_STORE_FITTING_ROOM_RIGHT: ClothingStoreHotspot = {
  id: 'clothing-store-fitting-room-right',
  label: 'Right fitting room; try clothes on your Blobbi',
  /** Set further back than its neighbour: arch at y ≈ 21.5 %, base at y ≈ 69 %. */
  className: 'absolute left-[12.2%] top-[21.5%] h-[47.5%] w-[8%] z-[12]',
  opens: 'fitting-room',
  standPoint: { x: 16.5, y: 75 },
};

/** Both booths, left to right. */
export const clothingStoreFittingRooms: readonly ClothingStoreHotspot[] = [
  CLOTHING_STORE_FITTING_ROOM_LEFT,
  CLOTHING_STORE_FITTING_ROOM_RIGHT,
];

/**
 * Every walk-to-interact control in the room, in render order.
 *
 * The corner Shop button is deliberately NOT here: it opens where the player
 * stands, so it has no stand point and nothing to route to.
 */
export const clothingStoreHotspots: readonly ClothingStoreHotspot[] = [
  CLOTHING_STORE_CHECKOUT,
  ...clothingStoreFittingRooms,
];

/**
 * Look a hotspot up by id, for the room and for its tests.
 *
 * Throws rather than returning undefined: every caller here is naming a control
 * it knows exists, and a silent `undefined` would become a button that quietly
 * does nothing.
 */
export function clothingStoreHotspot(id: string): ClothingStoreHotspot {
  const hotspot = clothingStoreHotspots.find((h) => h.id === id);
  if (!hotspot) {
    throw new Error(`No hotspot configured for "${id}"`);
  }
  return hotspot;
}

/**
 * The persistent Shop shortcut, lower-right, the Care and Badges Stores'
 * button in the same visual language, for the same reason: the painted checkout
 * is the immersive way in, and this is the discoverable one.
 *
 * It opens WHERE THE PLAYER STANDS, with no walk, because its job is
 * convenience rather than immersion; it and the checkout are two CONTROLS over
 * one shop, not two shops. It sits over the open floorboards to the right of the
 * rug so it covers no artwork, and above everything else because it is UI.
 */
export const CLOTHING_STORE_SHOP_BUTTON = {
  id: 'clothing-store-shop-shortcut',
  label: 'Open the Clothing Store shop',
  text: 'Shop',
  className: 'absolute bottom-[4%] right-[3%] z-[40]',
} as const;
