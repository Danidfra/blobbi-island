/**
 * The Clothing Store's interior: what stands in it, where, and what it blocks.
 *
 * `clothing-store-inside.png` is an EMPTY SHELL — walls, ceiling lights, a
 * skirting board and a floor, and nothing else. Everything a boutique is made
 * of arrives as separate sprites, listed here.
 *
 * ## Why a scene list and not a pile of JSX
 *
 * Because these objects are going to grow behaviour one at a time. A fitting
 * room that lets you try clothes on, a rack you can browse, a mirror that
 * previews — each of those wants to attach to ONE object without touching the
 * other seven. So every object carries a stable id, its own artwork, its own
 * placement, its own depth and its own optional floor footprint, and the room
 * component renders the list. Adding an interaction later is a field, not a
 * refactor.
 *
 * It is deliberately NOT a generic scene engine. There is no layout solver, no
 * z-index resolver and no interaction dispatcher — the arcade's registry
 * (`arcade-machines-config.ts`) is the model: plain data, one room's worth.
 *
 * ## Coordinates
 *
 * World percent of the fixed 1046×697 design box, like every other room.
 * `clothing-store-inside.png` is 1033×689 — aspect 1.4993 against the world's
 * 1.5007 — so image percentages are world percentages to within a pixel.
 *
 * ## Where the numbers come from
 *
 * Each object's placement was computed from its sprite's measured ALPHA BOX,
 * not from its file dimensions, because every one of these assets carries
 * generous transparent padding (the checkout's artwork is 87 % of its file's
 * width and 68 % of its height; the fitting room's is 78 % × 92 %). Placing by
 * file box would have left objects floating off the floor and gapped from the
 * walls. The measured margins are recorded per object below so the placement
 * can be re-derived rather than re-guessed.
 *
 * The room's own geometry, probed off the artwork: the back wall meets the
 * floor at y = 77 %, the pillars stand at x ≈ 14–17.5 % and 82.5–86.5 %, and the
 * side walls fall away to the frame edges at y ≈ 88 %. The walk boundary in
 * `location-boundaries.ts` already sits inside all of that and is unchanged.
 *
 * ## Ground-anchor semantics
 *
 * Blockers constrain the Blobbi's FEET, like every boundary in the game, so a
 * blocker is an object's floor FOOTPRINT — not its painted height. A tall shelf
 * blocks the band of floor it stands on; the Blobbi's body may overlap it above
 * that.
 */

import type { Position } from '@/lib/types';

const ART = '/assets/locations/clothing-store-inside';

/** A rectangle in world percent, matching `MovementBlocker`'s props. */
export interface ClothingStoreBlocker {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ClothingStoreObject {
  /**
   * Stable identity. Used as the React key, as the blocker id, and as the hook
   * a future interaction attaches to. Never derived from the filename.
   */
  readonly id: string;
  readonly src: string;
  /**
   * Accessible name, or `null` for scenery.
   *
   * `null` is not "no label yet" — it is a statement that the object does
   * nothing, and it renders as `alt="" aria-hidden`. The arcade learned this
   * the hard way: thirty decorative sprites there announced themselves as a
   * ticket counter, and a `alt` field that CAN be wrong is how that happens. An
   * object gets a name here when it gets a behaviour.
   */
  readonly alt: string | null;
  /** Tailwind placement, in world percent. Never raw pixels. */
  readonly className: string;
  /** Floor footprint, when the object physically occupies floor. */
  readonly blocker?: ClothingStoreBlocker;
}

/**
 * Everything standing in the room, back to front.
 *
 * The order is the render order and the reading order: wall art, then the
 * counter, then the flanking furniture, then what sits out on the floor.
 *
 * ```
 *       [poster]    [ FASHION SHOP sign ]    [poster]
 *   [hat            [   CHECKOUT   ]              [fitting
 *   shelf]        ← walkable behind →              room]
 *        [table 1]     ( rug )     [table 2]
 *   ─────────────────── open floor ───────────────────
 * ```
 *
 * The fitting room and the hat shelf traded sides, the rug moved to the middle,
 * and the counter moved back off the wall it used to be pinned to.
 */
export const clothingStoreObjects: readonly ClothingStoreObject[] = [
  {
    /**
     * The rug, CENTRED — the room's floor anchor, with the counter behind it
     * and a display table to either side. Floor decoration, so no blocker: it
     * is walked on, not around.
     *
     * Sprite 1536×1024, ink margins l 1.82 % r 1.95 % t 15.43 % b 18.16 %.
     * Paints x 39.4 → 60.6, base y 95. Its back edge tucks under the counter,
     * which is drawn over it.
     */
    id: 'clothing-store-rug',
    src: `${ART}/rug.png`,
    alt: null,
    className: 'absolute bottom-[1%] left-[39%] z-[2] w-[22%]',
  },
  {
    /**
     * The shop's own sign, centred on the back wall above the counter.
     *
     * Sprite 1448×1086, ink margins l/r 1.24 % t 0.83 % b 7.83 %.
     * Paints x 43.2 → 56.8, y 33 → 47.4 — a third smaller than it was. It is
     * still the largest wall piece by twice the posters' width, so the
     * hierarchy is unchanged; it simply stopped dominating the wall.
     */
    id: 'clothing-store-sign',
    src: `${ART}/sign-fashion-shop.png`,
    alt: null,
    className: 'absolute top-[32.9%] left-[43%] z-[5] w-[14%]',
  },
  {
    /**
     * "Dress up your Blobbi!" — back wall, left of the sign.
     *
     * Sprite 1024×1536, ink margins l 2.54 % r 2.73 % t 1.04 % b 7.1 %.
     * Paints x 26 → 33.1, y 34 → 49.5. Roughly a 10 % gap to the sign, matched
     * on the other side.
     */
    id: 'clothing-store-poster-dress-up',
    src: `${ART}/poster-dress-up.png`,
    alt: null,
    className: 'absolute top-[33.8%] left-[25.8%] z-[5] w-[7.5%]',
  },
  {
    /**
     * A framed picture of a Blobbi at the mirror — back wall, right of the sign.
     *
     * Sprite 1024×1536, ink margins l 5.57 % r 5.47 % t 1.95 % b 9.24 %.
     * Paints x 67.3 → 74, y 34 → 49, mirroring the left poster and sitting well
     * above the fitting room's roofline at y = 58.7.
     */
    id: 'clothing-store-poster-mirror',
    src: `${ART}/poster-fitting-mirror.png`,
    alt: null,
    className: 'absolute top-[33.7%] left-[66.9%] z-[5] w-[7.5%]',
  },
  {
    /**
     * The checkout counter — centre of the room, and now further back, with
     * REAL FLOOR BEHIND IT.
     *
     * Sprite 1536×1024, ink margins l 6.51 % r 6.45 % t 15.62 % b 16.21 %.
     * Paints x 35.2 → 64.8, y 58.8 → 82.
     *
     * The blocker used to seal everything from the wall line to the counter's
     * base, which made the till a wall rather than a piece of furniture. It is
     * now only the counter's own floor FOOTPRINT — the band of floor its body
     * actually stands on — so `y ∈ [77.5, 80.2]` behind it is open and the
     * player can walk round either end and along the back. The customer still
     * stands in FRONT: see {@link CLOTHING_STORE_CHECKOUT.standPoint}.
     */
    id: 'clothing-store-checkout',
    src: `${ART}/checkout.png`,
    alt: null,
    className: 'absolute bottom-[12.5%] left-[33%] z-[15] w-[34%]',
    blocker: { x: 35.2, y: 80.2, width: 29.6, height: 2.2 },
  },
  {
    /**
     * The hat shelf, now against the LEFT wall.
     *
     * Sprite 1536×1024, ink margins l 14.91 % r 14.84 % t 3.03 % b 3.32 %.
     * Paints x 1.5 → 20.5, base y 89. Unchanged in size — it reads clearly as a
     * merchandise wall without competing with the fitting room opposite.
     *
     * A shelf unit is shallow, so its footprint is a shallow band. Most of its
     * painted width sits over the left wall's perspective wedge, which the walk
     * boundary already excludes.
     */
    id: 'clothing-store-hat-shelf',
    src: `${ART}/hat-shelf.png`,
    alt: null,
    className: 'absolute bottom-[10.1%] -left-[2.5%] z-[22] w-[27%]',
    blocker: { x: 1.5, y: 84, width: 19, height: 6 },
  },
  {
    /**
     * The fitting room, now on the RIGHT and substantially bigger — 27.3 % of
     * the world wide against the 22.6 % it was, and half again as tall.
     *
     * Sprite 1536×1024, ink margins l 11.2 % r 10.81 % t 2.34 % b 5.37 %.
     * Paints x 71.7 → 99, y 58.7 → 91. It reads as an area you walk into rather
     * than a cupboard, and it clears the counter's right edge (x 64.8) entirely.
     *
     * Its footprint is the booth plus the plant and stool the sprite includes.
     * Floor stays open BEHIND it (`y < 84`), so the back of the room is a
     * through-route rather than a dead end.
     */
    id: 'clothing-store-fitting-room',
    src: `${ART}/fitting-room.png`,
    alt: null,
    className: 'absolute bottom-[7.1%] -right-[2.8%] z-[24] w-[35%]',
    blocker: { x: 71.7, y: 84, width: 27.3, height: 8 },
  },
  {
    /**
     * Accessory display table — left of centre, between the hat shelf and the
     * rug.
     *
     * Sprite 1448×1086, ink margins l 0 % r 0.07 % t 4.05 % b 4.97 %.
     * Paints x 21 → 38, y 80.6 → 98.
     *
     * The blocker is its FEET, not its tabletop. A table on legs has floor
     * behind it, and the previous 6.5 %-deep rectangle claimed all of it — so
     * the Blobbi could not walk between the table and the counter even though
     * the picture plainly says it should. Two percent of floor at the front
     * legs is the whole of what this object physically occupies.
     */
    id: 'clothing-store-display-table',
    src: `${ART}/display-table.png`,
    alt: null,
    className: 'absolute bottom-[1%] left-[21%] z-[28] w-[17%]',
    blocker: { x: 21, y: 95.8, width: 17, height: 2.2 },
  },
  {
    /**
     * Clothing display table — right of centre, the counterweight to the first.
     *
     * Sprite 1536×1024, ink margins l/r 6.45 % t 7.71 % b 6.45 %.
     * Paints x 62 → 76.8, y 83.4 → 98.
     *
     * Not a mirror of its partner: it is a different table, a little smaller,
     * and it overlaps the fitting room's lower corner the way a display stand
     * in front of a booth actually would. Same feet-only footprint, so the
     * floor behind it is walkable too.
     */
    id: 'clothing-store-display-table-2',
    src: `${ART}/display-table-2.png`,
    alt: null,
    className: 'absolute bottom-[0.9%] left-[60.9%] z-[28] w-[17%]',
    blocker: { x: 62, y: 95.8, width: 14.8, height: 2.2 },
  },
];

/** Just the objects that occupy floor, for the movement layer. */
export const clothingStoreBlockers = clothingStoreObjects.flatMap((object) =>
  object.blocker ? [{ id: object.id, ...object.blocker }] : [],
);

/**
 * The checkout interaction.
 *
 * A hotspot over the counter's face rather than a click handler on the sprite,
 * for the same reason the Care Store's is: the interactive thing is the SERVICE
 * POINT, and it should be a real labelled `<button>` — keyboard reachable, named
 * for what it opens, and already treated as move-blocking by
 * `BLOCK_UI_SELECTOR`. It sits just above the counter artwork and below every
 * Blobbi depth band, so the player never has to click "through" their own pet.
 */
export const CLOTHING_STORE_CHECKOUT = {
  id: 'clothing-store-checkout-hotspot',
  label: 'Checkout counter — browse clothing',
  /** Over the counter's painted face: x 35.2 → 64.8, y 58.8 → 82. */
  className: 'absolute left-[35.2%] top-[58.8%] h-[23.2%] w-[29.6%] z-[16]',
  /**
   * Where the player stands to be served: centred on the counter and IN FRONT
   * of it, a step clear of the footprint's front edge (y = 82.4).
   *
   * In front, deliberately. The floor behind the till is walkable now, so a
   * derived or lazily-chosen point could easily land back there — and being
   * served from the staff side is not the interaction.
   */
  standPoint: { x: 50, y: 84 } as Position,
} as const;

/**
 * The persistent Shop shortcut, lower-right — the Care Store's, in the same
 * visual language, for the same reason: the painted counter is the immersive
 * way in, and this is the discoverable one.
 *
 * Both controls set ONE `isShopOpen` flag on one modal. It sits above every
 * scene object (the display table reaches z-28) because it is UI, not scenery,
 * and over the open floor to the right of the rug so it covers no artwork.
 */
export const CLOTHING_STORE_SHOP_BUTTON = {
  id: 'clothing-store-shop-shortcut',
  label: 'Open the Clothing Store shop',
  text: 'Shop',
  className: 'absolute bottom-[4%] right-[3%] z-[40]',
} as const;
