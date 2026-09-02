/**
 * The Furniture Store: its storefront on the mall's top level, and the geometry
 * of the showroom behind it.
 *
 * One file for both halves because they are two ends of the same door — the
 * facade's stand point and the interior's spawn have to agree about where the
 * player is when they cross. `care-store-config.ts` records why that is stated
 * together rather than split across a component and a boundary table.
 *
 * ## The artwork is the room
 *
 * `furniture-store-inside.webp` is a finished showroom: two roped-off display
 * platforms with a living-room set on the left and a bedroom set on the right,
 * a green checkout desk against the back wall, and a wooden aisle running
 * between them. Nothing is composed on top of it. There are no furniture
 * sprites, and there must not be: every sofa, bed and wardrobe the store sells
 * is already painted, and drawing them again would show the showroom twice.
 *
 * What is left is the part a picture cannot state: where the Blobbi's feet may
 * go, and which region of the image is a control.
 *
 * ## Coordinates
 *
 * World percent of the fixed 1046×697 design box, like every other room.
 *
 * `furniture-store-inside.webp` is 1600×1067 — aspect 1.4996 against the
 * world's 1.5007 — so it fills the world under `object-cover` with sub-pixel
 * crop and image percentages ARE world percentages, exactly as the Care Store's
 * plate does.
 *
 * ## Ground-anchor semantics
 *
 * Blockers are tested against the Blobbi's GROUND point (its feet), like every
 * boundary in the game. A rectangle here is a floor FOOTPRINT, not a painted
 * height; the body may overlap what it stands in front of.
 */

import type { Position } from '@/lib/types';

/** A rectangle in world percent, matching `MovementBlocker`'s props. */
export interface FurnitureStoreBlocker {
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
 * The Furniture Store facade, on the mall's TOP level.
 *
 * ## The facade IS the entrance
 *
 * It used to be `furniture-store.png` plus a `doors/furniture-store-door.png`
 * overlay that carried NO click handler at all — a door-shaped affordance that
 * hovered, invited a tap and did nothing, so the shop had no way in. The new
 * artwork is an open-front storefront with no door painted in it, so the
 * overlay is deleted rather than finally wired up, and the whole storefront is
 * the way in. That is the arrangement the Badges, Care and Clothing Stores
 * downstairs already use.
 *
 * ## Placement
 *
 * `furniture-store.webp` is 1536×1024 (a 1.5 box, the world's own ratio) with
 * ink margins l/r 1.89 %, t 0.20 %, b 1.76 %. The old `.png` was 689×392 — a
 * much wider, shorter sprite — so matching its painted WIDTH would have made
 * the new facade 30.9 % of the world tall and pushed its roof to y = 2.7,
 * through the top level's ceiling trim.
 *
 * It is sized to the LEVEL instead, which is the constraint that actually
 * matters. The top level runs from its trim at y ≈ 5 down to the walkway at
 * y ≈ 33:
 *
 *   box width  W = 27.02 %  → box height 27.03 % (the sprite is a 1.5 box)
 *   box left     = 50 − W/2 = 36.49 %  → paints x 37.0 → 63.0
 *   box bottom   = 33.02 + 0.0176 · 27.03 = 33.50 %  → painted base on y = 33.02
 *
 * Painted extent: x 37.0 → 63.0 %, y 6.5 → 33.02 % — the same vertical slot the
 * old storefront filled (7.4 → 33.0), so nothing else on the level moves.
 *
 * Note the box bottom moves WITH the width: widening the facade thickens the
 * transparent film under it, which sinks the painted base unless the anchor
 * follows it down. The Care Store facade records the same trap.
 *
 * ## Why z-8, and not the neighbours' z-15
 *
 * Because the mall has TWO glass barriers, one per balcony, and they are not at
 * the same depth. Read off the rendered scene:
 *
 * ```
 *   background            z-1
 *   MIDDLE level:  facade z-15  <  Blobbi z-19  <  glass-barrier-bottom z-20
 *   TOP level:     facade z-8   <  Blobbi z-9   <  glass-barrier-top    z-10
 * ```
 *
 * The three middle-level storefronts sit at z-15 and their glass is at z-20, so
 * the barrier reads in front of them. The top level's glass is at z-10 — half
 * the depth — because `shopping-mall-inside.png`'s own Blobbi band gives an
 * actor on the top walkway z-9. Putting this facade at the neighbours' z-15
 * would have hung the storefront in front of BOTH its glass and any Blobbi
 * standing at its door.
 *
 * So z-8 is not a smaller number picked to duck under something; it is the same
 * RELATIONSHIP the level below already uses, resolved against the top level's
 * own two layers. Nothing about the glass was touched to make it fit.
 */
export const FURNITURE_STORE_FACADE = {
  src: '/assets/locations/shop/furniture-store.webp',
  /** Names the action, not the picture: this is a way in. */
  alt: 'Furniture Store — go inside',
  containerClassName: 'absolute bottom-[66.5%] left-[36.49%] z-[8] w-[27.02%]',
  /**
   * Where the Blobbi stands to go in.
   *
   * The facade's painted horizontal centre (x = 50 %), on the TOP level's
   * walkable strip `y ∈ [32.5, 33.5]` of `shopping-mall-inside.png` — the level
   * the right-hand stair column climbs to.
   *
   * Stated rather than derived, for the reason `care-store-config.ts` records:
   * `InteractiveElement` would otherwise take the sprite's own base, and a
   * storefront set back against the wall does not stand on floor.
   *
   * Reaching it from the ground floor is a TWO-stair route — left column up to
   * the middle walkway, along it, right column up to the top — which is exactly
   * the cross-floor routing `mall-routing.test.ts` guards.
   */
  walkTarget: { x: 50, y: 33 } as Position,
} as const;

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

/**
 * The things standing ON the showroom floor.
 *
 * Exactly one, and that is a finding rather than an omission. The showroom is
 * two raised display platforms either side of an aisle:
 *
 * ```
 *   ┌───────────┐   ╔═══════════╗   ┌───────────┐
 *   │ living    │   ║  CHECKOUT ║   │  bedroom  │
 *   │ room set  ╲   ╚═══════════╝  ╱  set       │
 *   └────────────╲──── aisle ─────╱─────────────┘
 *   ══════════════ open floor, wall to wall ══════════════
 * ```
 *
 * The sofa, the bed, the wardrobe and the rest do not stand on walkable floor —
 * they stand on the platforms, which are raised, roped off and signed "do not
 * touch". The walk boundary's funnel shape excludes those platforms outright,
 * so blockers over them would only restate the boundary while making the room
 * look like it is full of invisible walls. `location-boundaries.ts` owns the
 * platforms; this file owns what stands in the aisle.
 */
export const furnitureStoreBlockers: readonly FurnitureStoreBlocker[] = [
  {
    /**
     * The checkout desk, centred against the back wall.
     *
     * Measured: the wooden top paints x 42.3–60.1 % from y ≈ 43.6 %, the green
     * body runs down to a wooden plinth, and that plinth meets the floor at
     * y ≈ 55.3 %. There is no floor behind it — the wall is — so the rectangle
     * reaches back past the wall line to say so.
     *
     * Like the Badges Store's counter, this footprint sits at the walk
     * boundary's own back edge, so the boundary already forbids it. It is
     * registered because it is TRUE, not because it is currently load-bearing:
     * a blocker that describes the room correctly keeps describing it correctly
     * when the room changes.
     */
    id: 'furniture-store-checkout',
    x: 42.3,
    y: 48,
    width: 17.8,
    height: 7.5,
  },
];

/**
 * The checkout.
 *
 * A hotspot rather than a sprite, because the desk is painted INTO the
 * background — there is no image to hang an `InteractiveElement` on and
 * inventing a transparent one would be a prop that exists only to carry a
 * click. The room renders a real labelled `<button>` over the artwork instead:
 * keyboard reachable, named for what it opens, and already move-blocking via
 * `BLOCK_UI_SELECTOR`, so a tap never also starts a raw world walk. The Care
 * Store's checkout established the shape.
 */
export const FURNITURE_STORE_CHECKOUT = {
  id: 'furniture-store-checkout',
  /** Accessible name. Names the action's outcome, not the furniture. */
  label: 'Checkout desk — browse furniture',
  /** Over the desk's painted body: x 42.3–60.1 %, y 43.6 → 55.3 %. */
  className: 'absolute left-[42.3%] top-[43.6%] h-[11.7%] w-[17.8%] z-[12]',
  /**
   * Where the player stands to be served: centred on the desk (its painted span
   * 42.3–60.1 gives a centre of 51.2), on the aisle floor just clear of the
   * desk's base at y = 55.5.
   *
   * y = 58 is inside the boundary's deepest band and 17 world px from the
   * desk — comfortably inside the 40 px arrival threshold once the walk lands,
   * and on the CUSTOMER's side of a desk the Blobbi never gets behind.
   */
  standPoint: { x: 51, y: 58 } as Position,
} as const;

/**
 * The persistent Shop shortcut in the room's lower-right corner.
 *
 * The painted desk is the immersive way in and stays exactly as it is; this is
 * the discoverable one. A player who has not worked out that the checkout is
 * clickable should still be able to browse, and a player who has should not
 * have to walk the length of the aisle every time.
 *
 * It opens the SAME modal from the SAME state — the room owns one
 * `isShopOpen` flag and both controls set it. There is deliberately no second
 * shop surface, no second controller and no second copy of the wiring.
 *
 * It sits over the open boards in the room's front-right, clear of the right
 * platform's front edge at y ≈ 88.5, so it covers no artwork.
 */
export const FURNITURE_STORE_SHOP_BUTTON = {
  id: 'furniture-store-shop-shortcut',
  /** Accessible name. Says what it opens, not what it looks like. */
  label: 'Open the Furniture Store',
  /** Short visible label beside the icon. */
  text: 'Furniture',
  className: 'absolute bottom-[4%] right-[3%] z-[40]',
} as const;
