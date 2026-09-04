/**
 * The Badges Store: its storefront in the mall, and what stands in the room.
 *
 * Same shape as `clothing-store-config.ts`: plain data, one room's worth, with
 * each object owning its id, artwork, placement, footprint and optional
 * interaction. Deliberately not a scene engine; the Clothing Store's note on
 * that applies here unchanged.
 *
 * ## Coordinates, and one wrinkle
 *
 * World percent of the fixed 1046×697 design box. `badges-store-inside.webp` is
 * 1600×1103: aspect 1.4506 against the world's 1.5007, so unlike the Clothing
 * Store's background, image percentages are NOT world percentages here.
 * `object-cover` crops the taller image top and bottom: 1066 of its 1103 rows
 * survive (rows 19…1084), and everything below was measured on that CROP, so
 * the numbers read directly as world percent.
 *
 * ## Where the numbers come from
 *
 * Probed off the artwork rather than guessed. The floor's back edge follows the
 * furniture: the left shelving meets the floor at y = 62.8 % against the left
 * wall and rises to 56.5 % by x = 26 %; the checkout's base sits at y ≈ 58.7 %;
 * the right units run 55.1 → 57.7 % across x 62 → 82 %; and past the door the
 * right wall's floor line drops back to y ≈ 63 % at x = 96 %. Horizontally the
 * floor is open wall to wall from y = 65 % down.
 *
 * Each sprite is placed from its measured ALPHA box, not its file box, because
 * both display units carry transparent padding, and the padding matters twice
 * over: it decides where the painted base lands, and the base is what has to
 * meet the floor.
 *
 * ## Ground-anchor semantics
 *
 * Blockers constrain the Blobbi's FEET, so a blocker is a floor FOOTPRINT and
 * not a painted silhouette. Both displays are therefore blocked at their BASE
 * only: a shallow band a couple of percent deep, which is what lets the
 * Blobbi walk BEHIND them while still being unable to walk through them. A
 * display case modelled as one tall painted rectangle would seal off the back
 * half of its own aisle.
 */

import type { Position } from '@/lib/types';

const ART = '/assets/locations/badges-store-inside';

// ---------------------------------------------------------------------------
// The storefront, in the mall
// ---------------------------------------------------------------------------

/**
 * The Badges Store facade on the mall's MIDDLE level, far left.
 *
 * ## The facade is the entrance
 *
 * It used to carry a separate `badges-store-door.png` overlay, and that overlay
 * had no `onClick`: a door-shaped affordance that hovered, invited a tap, and
 * did nothing. It is gone. The whole storefront is now the click target, which
 * is both the Care Store's rule and the honest one: there is exactly one way in
 * and it is the building.
 *
 * ## Placement
 *
 * `badges-store.webp` was REPLACED with a new render: 1536×1024 with ink
 * margins l/r 0.78 %, t 0.39 %, b 2.93 %, where the sprite it replaced was
 * 1510×1041 with l/r 1.39 %, b 2.79 %. Different box, different padding, so the
 * numbers were derived again rather than carried over: at the old `w-[24.5%]`
 * the new plate would have painted a percent wider and sat a hair low.
 *
 * The box below reproduces the PAINTED extent the storefront already had, so
 * nothing else on the level moves:
 *
 *   box width  W = 23.818 / 0.9844 = 24.2 %   → box height 24.21 %
 *   box left     = −2.159 − 0.0078 · W = −2.35 %
 *   box bottom   = 61.49 + 0.0293 · 24.21 = 62.2 %   (bottom-[37.8%])
 *
 * Painted extent: x −2.16 → 21.66 %, base y 61.5 %, the same floor line the
 * Care Store facade stands on, measured the same way. It runs off the left
 * frame edge exactly as it always has, and clears the Care Store facade (which
 * paints from x = 25.4 %) by 3.7 %.
 */
export const BADGES_STORE_FACADE = {
  src: '/assets/locations/shop/badges-store.webp',
  /** Names the action, not the picture. */
  alt: 'Badges Store: go inside',
  containerClassName: 'absolute bottom-[37.8%] -left-[2.35%] z-[15] w-[24.2%]',
  /**
   * Where the Blobbi stands to go in.
   *
   * The facade's painted horizontal centre (x = 9.75 %), on the middle level's
   * walkable strip `y ∈ [62.1, 63.1]` of `shopping-mall-inside.png`: the same
   * walkway the Care and Clothing Stores are entered from. Stated rather than
   * derived for the reason `care-store-config.ts` records: the sprite's own base
   * is set back against the wall and is not floor at all.
   */
  walkTarget: { x: 9.75, y: 62.6 } as Position,
} as const;

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

/** A rectangle in world percent, matching `MovementBlocker`'s props. */
export interface BadgesStoreBlocker {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BadgesStoreObject {
  /** Stable identity: React key, blocker id, and the hook a test grabs. */
  readonly id: string;
  readonly src: string;
  /** Accessible name, or `null` for scenery, a name arrives with a behaviour. */
  readonly alt: string | null;
  /** Tailwind placement, in world percent. Never raw pixels. */
  readonly className: string;
  /** Floor footprint, when the object physically occupies floor. */
  readonly blocker?: BadgesStoreBlocker;
  /**
   * What clicking this does. Absent means scenery.
   *
   * `opens` is the room's single modal state. Every interactive object here
   * says `'badges'`, because there is one shop surface and four ways to reach
   * it, not four surfaces.
   */
  readonly interaction?: {
    readonly opens: 'badges';
    /** Where the Blobbi stands before the action fires. */
    readonly standPoint: Position;
  };
}

/**
 * Everything standing on the floor of the Badges Store.
 *
 * ```
 *     [ shelving ]      [ CHECKOUT ]      [ display wall ]   [door]
 *   ─────────────── walkable behind both ───────────────────────────
 *      [ CASE ]            ( rug )            [ RACK ]
 *   ─────────────────── open front floor ──────────────────────────
 * ```
 *
 * The shelving, the display wall, the rug and the counter are PAINTED into the
 * background: only the two display units are sprites. So this list is short,
 * and the checkout is a hotspot over artwork rather than an object (see
 * {@link BADGES_STORE_CHECKOUT}).
 *
 * The case and the rack are not mirrored: different widths, different silhouettes,
 * different distances from the front edge. They balance the room without being
 * the same object twice.
 */
export const badgesStoreObjects: readonly BadgesStoreObject[] = [
  {
    /**
     * The glass display case: LEFT, anchored against the left wall.
     *
     * Sprite 320×333 (box aspect 0.961), ink margins l 2.50 % r 1.56 % t 4.80 %
     * b 4.50 %. At `w-[24%]` the box is 37.48 % of world height and its painted
     * base sits 1.69 % above the box's bottom edge, so `bottom-[8.31%]` puts that
     * base on y = 90 % and it paints x 0 → 23 %, y 56 → 90 %.
     *
     * ## Twice the size it opened at, and deliberately
     *
     * It painted 11.5 × 17 % before, a prop on a shop floor rather than the
     * shop's furniture. This is exactly 2× linear, 4× the painted area, with no
     * compromise needed to get there: the ink lands flush with the left frame
     * edge without a pixel clipped, and the pair still leaves a 55.8 % corridor
     * down the middle of the room.
     *
     * `-left-[0.6%]` is not a nudge off-canvas: the sprite's own 2.50 % left
     * padding is 0.6 % of world at this width, so the negative offset is exactly
     * what puts the PAINTED edge on x = 0. Anchoring by the box would have left
     * a visible gap between the case and the wall.
     *
     * y = 90 % is the rack's painted base too. Not a mirror, two units standing
     * on the same floor line is what lets ONE depth threshold decide whether the
     * Blobbi is drawn in front of them or behind them.
     */
    id: 'badges-store-display-case',
    src: `${ART}/badge-display-case.webp`,
    alt: 'Badge display case, browse badges',
    className: 'absolute bottom-[8.31%] -left-[0.6%] z-[26] w-[24%]',
    /**
     * The GROUND QUAD, re-measured off the artwork rather than scaled with it.
     *
     * The sprite is drawn three-quarter on, so its silhouette holds full width
     * down to 82 % of the ink and then tapers to the near-bottom corner at
     * 100 %. That taper IS the floor the case stands on: 18 % of painted height,
     * which at this size is 6.1 % of world. Re-measured rather than scaled with
     * the artwork: the case grew upward and outward, not forward, so its floor
     * quad grew far less than its silhouette did. The glass, the shelves and the
     * badges are all above it, and the floor behind the case (y < 83.9) is open,
     * which is what walking behind it means.
     */
    blocker: { x: 0, y: 83.9, width: 23, height: 6.1 },
    /**
     * Beside its right-hand edge, at the base line, a browsing position rather
     * than a head-on one. Standing in FRONT would put the Blobbi over the case
     * it just walked up to look at.
     */
    interaction: { opens: 'badges', standPoint: { x: 26, y: 88 } },
  },
  {
    /**
     * The A-frame badge rack: RIGHT, anchored against the right wall.
     *
     * Sprite 320×360 (box aspect 0.889), ink margins l 0 % r 5.94 % t 0 % b 0 %.
     * At `w-[22%]` the box is 37.14 % of world height and the ink fills it top
     * to bottom, so `bottom-[10%]` paints x 78.8 → 99.5 %, y 52.9 → 90 %.
     *
     * Also exactly 2× its opening size (10.35 × 18.56 % before). Still narrower
     * and taller than the case, still a different silhouette: the two are
     * anchored the same way to opposite walls, but they are not one another
     * reflected: the rack is 2.3 % narrower and 3.1 % taller than the case.
     *
     * It reaches within half a percent of the right frame edge, and its 5.94 %
     * of right-hand padding is why the box stops short of the canvas, the ink
     * is what is anchored, not the box.
     */
    id: 'badges-store-display-rack',
    src: `${ART}/badge-display-rack.webp`,
    alt: 'Badge rack: browse badges',
    className: 'absolute bottom-[10%] left-[78.8%] z-[26] w-[22%]',
    /**
     * The GROUND QUAD, measured the same way as the case's: full width to 82 %
     * of the ink, then a taper to the near corner at 100 %. 18 % of painted
     * height is 6.7 % of world here. The A-frame's slope, its shelves and its
     * badge cards are all above it, and the floor behind the rack (y < 83.3) is
     * open.
     */
    blocker: { x: 78.8, y: 83.3, width: 20.7, height: 6.7 },
    /** Beside its left-hand edge, mirroring the case's browsing position. */
    interaction: { opens: 'badges', standPoint: { x: 75.5, y: 88 } },
  },
];

/** Just the objects that occupy floor, for the movement layer. */
export const badgesStoreBlockers = badgesStoreObjects.flatMap((object) =>
  object.blocker ? [{ id: object.id, ...object.blocker }] : [],
);

/**
 * The checkout counter, painted into the background, so it gets a hotspot.
 *
 * The counter is part of `badges-store-inside.webp`: a purple desk with a badge
 * medallion on its front, painted x 39 → 58.5 %, from the monitor at y ≈ 38 %
 * down to a base at y ≈ 58.7 %. There is no sprite to wrap in a button, so the
 * service point becomes a real labelled `<button>` positioned over the artwork,
 * the Clothing Store's arrangement, for the same reasons: keyboard reachable,
 * named for what it opens, and already move-blocking via `BLOCK_UI_SELECTOR`.
 *
 * Its FOOTPRINT is registered as a blocker too (`BADGES_STORE_CHECKOUT_BLOCKER`).
 * In this room that footprint sits behind the walk boundary's back edge, so the
 * boundary already forbids it, the blocker is registered because it is true,
 * not because it is currently load-bearing.
 */
export const BADGES_STORE_CHECKOUT = {
  id: 'badges-store-checkout',
  alt: 'Checkout counter: browse badges',
  /** Over the counter's painted face. */
  className: 'absolute left-[39%] top-[44%] h-[15%] w-[19.5%] z-[16]',
  /**
   * In FRONT of the counter, never behind it.
   *
   * y = 62 % is the back aisle: past the rug, clear of the counter's base at
   * 58.7 %, and inside the boundary's rearmost band. The Blobbi walks up to the
   * till and stops on the customer's side of it.
   */
  standPoint: { x: 48.5, y: 62 } as Position,
} as const;

/** The counter's floor footprint, measured off the artwork. */
export const BADGES_STORE_CHECKOUT_BLOCKER: BadgesStoreBlocker = {
  x: 39,
  y: 55,
  width: 19.5,
  height: 4.4,
};

/**
 * Look an object's interaction up by id.
 *
 * Throws rather than returning undefined: every caller is naming an object it
 * knows is interactive, and a silent `undefined` becomes a control that quietly
 * does nothing.
 */
export function badgesStoreInteraction(id: string) {
  const object = badgesStoreObjects.find((o) => o.id === id);
  if (!object?.interaction) {
    throw new Error(`No interaction configured for "${id}"`);
  }
  return object.interaction;
}

/** Every scene object the player can click, in render order. */
export const badgesStoreInteractiveObjects = badgesStoreObjects.filter(
  (object) => object.interaction !== undefined,
);

/**
 * The persistent Badges shortcut, lower-right, the Care and Clothing Stores'
 * button in the same visual language, for the same reason: the painted fixtures
 * are the immersive way in, and this is the discoverable one.
 *
 * It is the FOURTH control over one modal state, beside the checkout, the case
 * and the rack, and it opens WHERE THE PLAYER STANDS; no walk, because its job
 * is convenience. It sits over open floor to the right of the rack's aisle so it
 * covers no artwork, and above every scene object because it is UI, not scenery.
 */
export const BADGES_STORE_SHOP_BUTTON = {
  id: 'badges-store-shop-shortcut',
  label: 'Open the Badges Store',
  text: 'Badges',
  className: 'absolute bottom-[4%] right-[3%] z-[40]',
} as const;
