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
 * ## Re-measured against the revised plate
 *
 * The artwork was replaced with a newer render of the same room. It is not an
 * edit — 94 % of its pixels differ — so every number here was probed again
 * rather than carried forward. Three of the four obstacles came out within a
 * whisker of where they were and were left alone; the checkout counter moved
 * and its blocker, its hotspot and its stand point moved with it. The floor
 * itself got deeper, which is in `location-boundaries.ts`.
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
 * It stands on the mall's MIDDLE level, in the bay the Photo Booth used to
 * occupy — the two traded places. That is the better home for it: the facade is
 * a full-width storefront like the Badges Store and the Clothing Store beside
 * it, whereas the Photo Booth is a single narrow booth that reads correctly in
 * the wide ground-floor bay. Sized by width only, so the sprite's own 567×391
 * aspect decides its height, exactly as its neighbours are.
 *
 * ## Why this size
 *
 * The bay is bounded by real ink and real STRUCTURE, not by boxes. Measured:
 * the mall's left structural pillar occupies x 22.2–25.4 %, and the Clothing
 * Store's artwork begins at x = 50.00 % — 24.6 % of clear wall between them.
 * The Care Store sprite carries a 1.59 % transparent margin on each side, so a
 * box of width W paints 0.968 · W and starts 0.0159 · W in from its left edge.
 *
 * `left-[25%] w-[25.3%]` therefore paints x = 25.40 -> 49.90: from the pillar's
 * inner face to a whisker short of its neighbour. It grew into the space the
 * middle level's left plant used to occupy — that plant is what made the
 * earlier 21.5 % the right answer, and removing it made this one.
 *
 * ## Why the anchor is not the neighbours' `bottom-[38.5%]`
 *
 * Because the sprites are padded differently below their artwork, and it is the
 * PAINTED BASES that have to line up. Every other storefront on this level has
 * essentially none (Clothing Store 0 %, Badges Store 0.7 %), so their painted
 * bases sit on the anchor itself at 38.5 %. The Care Store sprite has 5.37 % of
 * transparent film below its artwork — 1.41 % of world height at this size.
 * Dropping the anchor by exactly that stands them all on one line.
 *
 * Note the anchor moves WITH the width: widening the facade makes it taller,
 * which makes that film thicker, which sinks the painted base unless the anchor
 * follows it down. `bottom-[37.1%] = 38.5 − 0.0537 × 26.18`. Growing `w-[…]`
 * alone would have floated the shop off the walkway.
 *
 * The facade IS the door: there is no separate door overlay asset and none is
 * invented. Clicking anywhere on the storefront walks the Blobbi to
 * {@link CARE_STORE_FACADE.walkTarget} and, on arrival, changes location.
 */
export const CARE_STORE_FACADE = {
  src: '/assets/locations/shop/care-store.webp',
  /** Names the action, not the picture: this is a way in. */
  alt: 'Care Store — go inside',
  containerClassName: 'absolute bottom-[37.1%] left-[25%] z-[15] w-[25.3%]',
  /**
   * Where the Blobbi stands to go in.
   *
   * Stated rather than derived, for the reason `arcade-room-config.ts` records:
   * the facade is set back against the wall (its painted base sits at y ≈ 61.5 %)
   * while the middle level's walkable floor is the thin strip `y ∈ [62.1, 63.1]`
   * of `shopping-mall-inside.png`. "The floor at this sprite's base" is therefore
   * not floor at all, and clamping it only lands on the strip's top EDGE, where a
   * walk can slide sideways without converging.
   *
   * This point is the storefront's horizontal centre, on the strip itself — the
   * same walkway players already stand on to enter the Clothing Store next door.
   */
  walkTarget: { x: 37.6, y: 62.6 } as Position,
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
     * The checkout counter — the one fixture the revised artwork moved.
     *
     * Re-measured on the new plate: the teal top spans x 38.0–64.1 % and starts
     * at y ≈ 51.7 %; the cream body runs down to the teal plinth, whose base
     * meets the floor at y ≈ 70.3 % (70.5 with its shadow). It was x 37–61.5 %,
     * y 54–71.5 % before — so the till slid about a percent to the right, grew
     * two and a half percent wider, and rose a percent off the floor.
     *
     * The blocker covers the counter's FLOOR band and reaches back past the
     * wall line, so the back aisle (`y ∈ [68, 72]`) is sealed across the
     * counter's whole width — there is no slipping behind it. Its front edge
     * leaves the floor at y = 70.5 open, which is where
     * {@link CARE_STORE_CHECKOUT.standPoint} puts the player.
     */
    id: 'care-store-counter',
    x: 38,
    y: 64,
    width: 26.1,
    height: 6.5,
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
   * Covers the counter's visible face on the REVISED artwork: x 38–64.1 %, from
   * the teal top at y = 51.7 % down to its base at y = 70.3 %. It tracked the
   * counter when the plate was redrawn — a hotspot that stays where the old
   * till was is a button over empty floor.
   */
  className: 'absolute left-[38%] top-[51.7%] h-[18.6%] w-[26.1%] z-[12]',
  /**
   * Where the player stands to be served: centred on the counter's new span
   * (x 38–64.1 → centre 51), on open floor just clear of the counter blocker's
   * front edge (y = 70.5). Inside the upper-mid floor band, and 17 world px
   * from the counter base — well within the 40 px arrival threshold once the
   * walk lands.
   */
  standPoint: { x: 51, y: 73 } as Position,
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
