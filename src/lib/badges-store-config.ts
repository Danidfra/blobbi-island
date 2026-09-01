/**
 * The Badges Store: its storefront in the mall, and what stands in the room.
 *
 * Same shape as `clothing-store-config.ts` — plain data, one room's worth, with
 * each object owning its id, artwork, placement, footprint and optional
 * interaction. Deliberately not a scene engine; the Clothing Store's note on
 * that applies here unchanged.
 *
 * ## Coordinates, and one wrinkle
 *
 * World percent of the fixed 1046×697 design box. `badges-store-inside.webp` is
 * 1600×1103 — aspect 1.4506 against the world's 1.5007 — so unlike the Clothing
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
 * both display units carry transparent padding — and the padding matters twice
 * over: it decides where the painted base lands, and the base is what has to
 * meet the floor.
 *
 * ## Ground-anchor semantics
 *
 * Blockers constrain the Blobbi's FEET, so a blocker is a floor FOOTPRINT and
 * not a painted silhouette. Both displays are therefore blocked at their BASE
 * only — a shallow band a couple of percent deep — which is what lets the
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
 * had no `onClick` — a door-shaped affordance that hovered, invited a tap, and
 * did nothing. It is gone. The whole storefront is now the click target, which
 * is both the Care Store's rule and the honest one: there is exactly one way in
 * and it is the building.
 *
 * ## Placement
 *
 * `badges-store.webp` is 1510×1041 with ink margins l/r 1.39 %, t 0 %, b 2.79 %,
 * so at `w-[24.5%]` the box is 25.35 % of world height and the painted base sits
 * 0.71 % above the box's bottom edge. The box bottom is therefore set to
 * y = 62.21 % to put the PAINTED base on y = 61.5 % — the same floor line the
 * Care Store facade stands on, measured the same way. The old `bottom-[38.5%]`
 * assumed a zero bottom margin (true of the neighbouring `.png` facades, not of
 * this one) and left the shop hovering 0.7 % above its own floor.
 *
 * Painted extent: x −2.2 → 21.7 %, base y 61.5 %. It runs off the left frame
 * edge exactly as it always has, and clears the Care Store facade (which paints
 * from x = 25.4 %) by 3.7 %.
 */
export const BADGES_STORE_FACADE = {
  src: '/assets/locations/shop/badges-store.webp',
  /** Names the action, not the picture. */
  alt: 'Badges Store — go inside',
  containerClassName: 'absolute bottom-[37.8%] -left-[2.5%] z-[15] w-[24.5%]',
  /**
   * Where the Blobbi stands to go in.
   *
   * The facade's painted horizontal centre (x = 9.75 %), on the middle level's
   * walkable strip `y ∈ [62.1, 63.1]` of `shopping-mall-inside.png` — the same
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
  /** Accessible name, or `null` for scenery — a name arrives with a behaviour. */
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
 * background — only the two display units are sprites. So this list is short,
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
     * The glass display case — LEFT, near the front, on the entrance side.
     *
     * Sprite 320×333 (box aspect 0.961), ink margins l 2.50 % r 1.56 % t 4.80 %
     * b 4.50 %. At `w-[12%]` the box is 18.74 % of world height and its painted
     * base sits 0.84 % above the box's bottom edge, so `bottom-[10.2%]` puts that
     * base on y = 89 % and it paints x 8.3 → 19.8 %, y 72 → 89 %.
     *
     * y = 89 % is the rack's painted base too. Not a coincidence and not a
     * mirror: two units standing on the same floor line is what lets ONE depth
     * threshold decide whether the Blobbi is in front of them or behind them.
     *
     * Placed with room on every side: 8.3 % of floor to its left before the wall,
     * 12 % to its right before the rug, ~11 % in front of it to the frame edge,
     * and the whole mid-floor band behind it.
     */
    id: 'badges-store-display-case',
    src: `${ART}/badge-display-case.webp`,
    alt: 'Badge display case — browse badges',
    className: 'absolute bottom-[10.2%] left-[8%] z-[26] w-[12%]',
    /**
     * The plinth's footprint, not the case. 2.4 % deep against 17 % of painted
     * height: the glass is above the floor, and only the base stands on it.
     */
    blocker: { x: 8.3, y: 86.6, width: 11.5, height: 2.4 },
    /** Beside it on the right, in the aisle between the case and the rug. */
    interaction: { opens: 'badges', standPoint: { x: 23, y: 87.5 } },
  },
  {
    /**
     * The A-frame badge rack — RIGHT, near the front, balancing the case.
     *
     * Sprite 320×360 (box aspect 0.889), ink margins l 0 % r 5.94 % t 0 % b 0 %.
     * At `w-[11%]` the box is 18.56 % of world height and the ink fills it top
     * to bottom, so it paints x 76 → 86.4 %, y 70.4 → 89 %.
     *
     * Narrower and a shade taller than the case, sitting slightly further
     * forward — the pair reads as two different fixtures rather than a mirror.
     */
    id: 'badges-store-display-rack',
    src: `${ART}/badge-display-rack.webp`,
    alt: 'Badge rack — browse badges',
    className: 'absolute bottom-[11%] left-[76%] z-[26] w-[11%]',
    /** The rack's own foot: it stands flush on the floor, 2.4 % deep. */
    blocker: { x: 76, y: 86.6, width: 10.4, height: 2.4 },
    /** Beside it on the left, in the aisle between the rug and the rack. */
    interaction: { opens: 'badges', standPoint: { x: 72, y: 87.5 } },
  },
];

/** Just the objects that occupy floor, for the movement layer. */
export const badgesStoreBlockers = badgesStoreObjects.flatMap((object) =>
  object.blocker ? [{ id: object.id, ...object.blocker }] : [],
);

/**
 * The checkout counter — painted into the background, so it gets a hotspot.
 *
 * The counter is part of `badges-store-inside.webp`: a purple desk with a badge
 * medallion on its front, painted x 39 → 58.5 %, from the monitor at y ≈ 38 %
 * down to a base at y ≈ 58.7 %. There is no sprite to wrap in a button, so the
 * service point becomes a real labelled `<button>` positioned over the artwork —
 * the Clothing Store's arrangement, for the same reasons: keyboard reachable,
 * named for what it opens, and already move-blocking via `BLOCK_UI_SELECTOR`.
 *
 * Its FOOTPRINT is registered as a blocker too (`BADGES_STORE_CHECKOUT_BLOCKER`).
 * In this room that footprint sits behind the walk boundary's back edge, so the
 * boundary already forbids it — the blocker is registered because it is true,
 * not because it is currently load-bearing.
 */
export const BADGES_STORE_CHECKOUT = {
  id: 'badges-store-checkout',
  alt: 'Checkout counter — browse badges',
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
 * The persistent Badges shortcut, lower-right — the Care and Clothing Stores'
 * button in the same visual language, for the same reason: the painted fixtures
 * are the immersive way in, and this is the discoverable one.
 *
 * It is the FOURTH control over one modal state, beside the checkout, the case
 * and the rack, and it opens WHERE THE PLAYER STANDS — no walk, because its job
 * is convenience. It sits over open floor to the right of the rack's aisle so it
 * covers no artwork, and above every scene object because it is UI, not scenery.
 */
export const BADGES_STORE_SHOP_BUTTON = {
  id: 'badges-store-shop-shortcut',
  label: 'Open the Badges Store',
  text: 'Badges',
  className: 'absolute bottom-[4%] right-[3%] z-[40]',
} as const;
