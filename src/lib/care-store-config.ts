/**
 * The Care Store: its storefront in the mall, and the geometry of the room
 * behind it.
 *
 * One file for both halves because they are two ends of the same door. The
 * facade's stand point and the interior's spawn point have to agree about where
 * a player is when they cross, and the checkout's stand point has to agree with
 * the counter blocker that stops them walking into it. Splitting those numbers
 * across a component and a boundary table is exactly how the town streetlights'
 * blockers drifted away from their artwork (`town-streetlights-config.ts`), so
 * they are stated together here.
 *
 * ## Coordinates
 *
 * Everything is WORLD PERCENT of the fixed 1046×697 design box, the same units
 * `locationBoundaries`, `MovementBlocker` and every approach target use. The
 * world scales as one uniform layer, so these numbers stay aligned with the
 * artwork at every viewport — there is not a raw screen pixel anywhere in this
 * file.
 *
 * ## Where the interior numbers come from
 *
 * `care-store-inside.webp` is 1600×1067 — aspect 1.4996 against the world's
 * 1.5007 — so it fills the world under `object-cover` with sub-pixel crop and
 * image percentages ARE world percentages. Every rectangle below was measured
 * off the artwork's own colour transitions (the teal drawer fronts, the blue
 * toy box, the cream counter body, the pet bed) rather than eyeballed, and each
 * one records the edge it came from.
 *
 * ## Ground-anchor semantics
 *
 * Blockers are tested against the Blobbi's GROUND point (its feet), like every
 * boundary in the game. So each rectangle is the floor FOOTPRINT of an object —
 * the band of floor the artwork stands on — not its full painted height. The
 * body is free to overlap an object above the floor, which is what makes a
 * Blobbi standing at the counter look like it is standing AT the counter.
 */

import type { Position } from '@/lib/types';

/** A rectangle in world percent, matching `MovementBlocker`'s props. */
export interface CareStoreBlocker {
  /** Stable id; also the blocker id in `MovementBlockerContext`. */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// The storefront, in the shopping mall
// ---------------------------------------------------------------------------

/**
 * The Care Store facade on the mall's ground floor.
 *
 * Placed with the SAME conventions as the Coffee Shop it sits beside — sized by
 * width only, so the sprite's own 567×391 aspect decides its height — and fitted
 * into the bay between them, mirroring the plant → Coffee Shop → plant rhythm
 * already on that level. Nothing existing moves.
 *
 * ## Why this size, and not more
 *
 * The bay is bounded by real ink, not by boxes. Measured from the sprites' own
 * alpha channels: the Coffee Shop's artwork ends at x = 50.38 %, and the right
 * potted plant's begins at x = 72.70 % — 22.32 % of clear wall. The Care Store
 * sprite carries a 1.59 % transparent margin on each side, so a box of width W
 * paints 0.968 · W and starts 0.0159 · W in from its left edge.
 *
 * `left-[50.1%] w-[22.9%]` therefore paints x = 50.46 → 72.64: 22.17 % of ink,
 * 99 % of the available wall, with a hair of clearance at both ends. Anything
 * wider starts covering a neighbour. This is the largest the facade can be and
 * still read as a storefront standing NEXT to the Coffee Shop rather than in
 * front of it.
 *
 * ## Why `bottom-[10.7%]` and not the Coffee Shop's `bottom-[12%]`
 *
 * Because the two sprites are padded differently, and it is the PAINTED BASES
 * that have to line up. The Care Store sprite has 5.37 % of transparent film
 * below its artwork (the Coffee Shop has 0.26 %), which at this size is 1.28 %
 * of world height — enough to make the shop look like it is hovering just off
 * the mall floor. Dropping the anchor by that exact amount stands both
 * storefronts on one floor line. Matching the raw `bottom` values would have
 * matched the numbers and not the picture.
 *
 * The facade IS the door: there is no separate door overlay asset and none is
 * invented. Clicking anywhere on the storefront walks the Blobbi to
 * {@link CARE_STORE_FACADE.walkTarget} and, on arrival, changes location.
 */
export const CARE_STORE_FACADE = {
  src: '/assets/locations/shop/care-store.webp',
  /** Names the action, not the picture: this is a way in. */
  alt: 'Care Store — go inside',
  containerClassName: 'absolute bottom-[10.7%] left-[50.1%] z-20 w-[22.9%]',
  /**
   * Where the Blobbi stands to go in.
   *
   * Stated rather than derived, for the reason `arcade-room-config.ts` records:
   * the facade is set back against the wall (its base sits at y ≈ 88 %), while
   * the mall's ground-floor walkway is `y ∈ [90.6, 100]`. "The floor at this
   * sprite's base" is therefore not floor at all, and clamping it only lands on
   * the walkway's top EDGE. This point is the storefront's horizontal centre, a
   * comfortable step onto open floor.
   */
  walkTarget: { x: 61, y: 93 } as Position,
} as const;

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

/**
 * The room's free-standing obstacles.
 *
 * The walkable boundary (`location-boundaries.ts`) describes the floor's outer
 * perimeter; these four rectangles are the things standing ON that floor. Each
 * covers the object's floor footprint and stops there, so the passages between
 * them stay walkable:
 *
 * ```
 *   toy box ──┐                          ┌── pet bed ──┬── plant
 *             │      [ checkout ]        │             │
 *   ══════════╧══════════════════════════╧═════════════╧════════  open floor
 * ```
 */
export const careStoreBlockers: readonly CareStoreBlocker[] = [
  {
    /**
     * The toy box — the blue chest in the lower-left of the room, spilling
     * balls and bones.
     *
     * Measured: its blue body runs from the left frame edge to x ≈ 17.5 % at its
     * widest (y 72–78), tapering to x ≈ 13.5 % at its front-bottom corner, with
     * the rim at y ≈ 70.5 % and the bottom edge at y ≈ 83.3 %. The rectangle
     * takes the WIDEST extent rather than the taper: a player reads the box as
     * one solid object, and stopping short of the wide part while clipping the
     * narrow part is the kind of collision that feels broken even when the maths
     * is right. The spilled toys above the rim are deliberately NOT blocked —
     * they sit above the floor, and the Blobbi's body may pass in front of them.
     */
    id: 'care-store-toy-box',
    x: 0,
    y: 70,
    width: 18.2,
    height: 13.5,
  },
  {
    /**
     * The checkout counter.
     *
     * Measured: the cream body spans x 37.5–61 %, its teal top at y ≈ 54 % and
     * its base meeting the floor at y ≈ 71.5 %. The blocker covers the counter's
     * FLOOR band and reaches back past the wall line, so the back aisle
     * (`y ∈ [68.5, 72]`) is sealed across the counter's whole width — there is no
     * slipping behind it. Its front edge leaves the floor at y = 72.4 open, which
     * is where {@link CARE_STORE_CHECKOUT.standPoint} puts the player.
     */
    id: 'care-store-counter',
    x: 37,
    y: 66,
    width: 24.5,
    height: 6.4,
  },
  {
    /**
     * The pet bed in the lower-right corner.
     *
     * Measured: teal rim from x ≈ 78.5 % to x ≈ 92 %, back edge y ≈ 67.5 %, front
     * edge y ≈ 81.5 %. It also covers the base of the right-hand display cabinet
     * standing behind it, which shares that footprint.
     */
    id: 'care-store-pet-bed',
    x: 78.5,
    y: 67.5,
    width: 13.5,
    height: 14,
  },
  {
    /**
     * The big potted plant in the right corner.
     *
     * Measured on the WHITE POT — x ≈ 91.5–98 %, y ≈ 70–84 % — not the foliage,
     * which spreads far above the floor and blocks nothing.
     */
    id: 'care-store-plant',
    x: 91.5,
    y: 70,
    width: 6.5,
    height: 14.5,
  },
];

/**
 * The checkout interaction.
 *
 * A hotspot rather than a sprite, because the counter is painted INTO the
 * background — there is no counter image to hang an `InteractiveElement` on and
 * inventing a transparent one would be a prop that exists only to carry a click.
 * The room renders a labelled button over the counter face instead, and routes
 * it through the same canonical walk-to-interact path every door uses.
 *
 * The Blobbi never goes behind the counter: the counter stays a blocker and the
 * player stops in front of it, which is where a customer stands anyway.
 */
export const CARE_STORE_CHECKOUT = {
  id: 'care-store-checkout',
  /** Accessible name. Names the action's outcome, not the furniture. */
  label: 'Checkout counter — browse care items',
  /**
   * Covers the counter's visible face: x 37–61.5 %, from the teal top at y = 54 %
   * down to its base at y = 71.5 %.
   */
  className: 'absolute left-[37%] top-[54%] h-[17.5%] w-[24.5%] z-[12]',
  /**
   * Where the player stands to be served: centred on the counter, on open floor
   * just clear of the counter blocker's front edge (y = 72.4). Inside the mid
   * floor band, and 17 world px from the counter base — well within the 40 px
   * arrival threshold once the walk lands.
   */
  standPoint: { x: 49, y: 74 } as Position,
} as const;

/**
 * The persistent Shop shortcut in the room's lower-right corner.
 *
 * The counter is the immersive way in and stays exactly as it is; this is the
 * discoverable one. A player who has not yet worked out that the painted
 * checkout is clickable should still be able to shop, and a player who has
 * should not have to walk back across the room every time.
 *
 * It opens the SAME modal from the SAME state — the room owns one `isShopOpen`
 * flag and both controls set it. There is deliberately no second shop surface,
 * no second controller and no second copy of the purchase wiring.
 *
 * Placement is a UI decision, not a world one: it is anchored to the room's
 * lower-right in percentages so it rides the same uniform world scale as
 * everything else, and it sits over the plain floorboards to the right of the
 * rug — below the pet bed and clear of the potted plant, so it covers no
 * artwork anyone is looking at.
 */
export const CARE_STORE_SHOP_BUTTON = {
  id: 'care-store-shop-shortcut',
  /** Accessible name. Says what it opens, not what it looks like. */
  label: 'Open the Care Store shop',
  /** Short visible label beside the icon. */
  text: 'Shop',
  className: 'absolute bottom-[4%] right-[3%] z-[26]',
} as const;
