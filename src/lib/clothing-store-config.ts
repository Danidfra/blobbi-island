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
 *      [poster]      [ FASHION SHOP sign ]      [poster]
 *   [fitting                                          [hat
 *     room]          [   CHECKOUT   ]                shelf]
 *          ( rug )                    [display table]
 *   ─────────────────── open floor ───────────────────
 * ```
 */
export const clothingStoreObjects: readonly ClothingStoreObject[] = [
  {
    /**
     * The rug. Floor decoration, so NO blocker — it is walked on, not around,
     * exactly like the Care Store's.
     *
     * Sprite 1536×1024, ink margins l 1.82 % r 1.95 % t 15.43 % b 18.16 %.
     * Paints x 24.0 → 43.3, base y 96.
     */
    id: 'clothing-store-rug',
    src: `${ART}/rug.png`,
    alt: null,
    className: 'absolute bottom-[0.4%] left-[23.6%] z-[2] w-[20%]',
  },
  {
    /**
     * The shop's own sign, centred on the back wall above the counter.
     *
     * Sprite 1448×1086, ink margins l/r 1.24 % t 0.83 % b 7.83 %.
     * Paints x 39.8 → 60.2, y 30 → 51.6 — clear of the counter's top at 61.8.
     */
    id: 'clothing-store-sign',
    src: `${ART}/sign-fashion-shop.png`,
    alt: null,
    className: 'absolute top-[29.8%] left-[39.5%] z-[5] w-[21%]',
  },
  {
    /**
     * "Dress up your Blobbi!" — back wall, left of the sign.
     *
     * Sprite 1024×1536, ink margins l 2.54 % r 2.73 % t 1.04 % b 7.1 %.
     * Paints x 21.5 → 31.9, y 32 → 54.7: on the wall between the left pillar
     * (ends x 17.5) and the counter, and above the fitting room's roofline.
     */
    id: 'clothing-store-poster-dress-up',
    src: `${ART}/poster-dress-up.png`,
    alt: null,
    className: 'absolute top-[31.7%] left-[21.2%] z-[5] w-[11%]',
  },
  {
    /**
     * A framed picture of a Blobbi at the mirror — back wall, right of the sign.
     *
     * Sprite 1024×1536, ink margins l 5.57 % r 5.47 % t 1.95 % b 9.24 %.
     * Paints x 69.2 → 79.0, y 32 → 54.0, mirroring the left poster.
     */
    id: 'clothing-store-poster-mirror',
    src: `${ART}/poster-fitting-mirror.png`,
    alt: null,
    className: 'absolute top-[31.5%] left-[68.6%] z-[5] w-[11%]',
  },
  {
    /**
     * The checkout counter — centre of the room, close to the back wall, which
     * is where a boutique's till belongs and where a player looks for it.
     *
     * Sprite 1536×1024, ink margins l 6.51 % r 6.45 % t 15.62 % b 16.21 %.
     * Paints x 35.2 → 64.8, y 61.8 → 85.
     *
     * The blocker seals from the wall line (y = 77) to just past the painted
     * base, across the counter's full width: there is no walking behind the
     * till. Its front edge leaves y > 86 open, which is where
     * {@link CLOTHING_STORE_CHECKOUT.standPoint} puts the player.
     */
    id: 'clothing-store-checkout',
    src: `${ART}/checkout.png`,
    alt: null,
    className: 'absolute bottom-[9.5%] left-[33%] z-[15] w-[34%]',
    blocker: { x: 35, y: 77, width: 30, height: 9 },
  },
  {
    /**
     * The fitting room, against the left wall — the edge of the room, so it
     * never stands between the player and the counter.
     *
     * Sprite 1536×1024, ink margins l 11.2 % r 10.81 % t 2.34 % b 5.37 %.
     * Paints x 1.5 → 24.1, y 62.2 → 89. The sprite includes the plant and the
     * stool beside the booth, so the blocker covers the whole group's footprint.
     */
    id: 'clothing-store-fitting-room',
    src: `${ART}/fitting-room.png`,
    alt: null,
    className: 'absolute bottom-[9.4%] -left-[1.7%] z-[22] w-[29%]',
    blocker: { x: 1.5, y: 78, width: 23, height: 12 },
  },
  {
    /**
     * The hat shelf, against the right wall — the fitting room's counterweight.
     *
     * Sprite 1536×1024, ink margins l 14.91 % r 14.84 % t 3.03 % b 3.32 %.
     * Paints x 79.5 → 98.5, y 63.7 → 89.
     */
    id: 'clothing-store-hat-shelf',
    src: `${ART}/hat-shelf.png`,
    alt: null,
    className: 'absolute bottom-[10.1%] -right-[2.5%] z-[22] w-[27%]',
    blocker: { x: 79.5, y: 78, width: 19, height: 12 },
  },
  {
    /**
     * The accessory display table, out on the floor to the right of centre.
     *
     * Sprite 1448×1086, ink margins l 0 % r 0.07 % t 4.05 % b 4.97 %.
     * Paints x 60 → 75, y 82.6 → 98.
     *
     * Deliberately NOT in the middle: it sits off the centre line so the walk
     * from the door to the counter stays a clear corridor (x ≈ 43 → 60), and it
     * balances the rug on the other side.
     *
     * Its blocker is the band of floor its legs stand on, not its whole painted
     * height — the Blobbi walks around it, and may pass behind it.
     */
    id: 'clothing-store-display-table',
    src: `${ART}/display-table.png`,
    alt: null,
    className: 'absolute bottom-[1.2%] left-[60%] z-[28] w-[15%]',
    blocker: { x: 60, y: 92, width: 15, height: 6.5 },
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
  /** Over the counter's painted face: x 35.2 → 64.8, y 61.8 → 85. */
  className: 'absolute left-[35.2%] top-[61.8%] h-[23.2%] w-[29.6%] z-[16]',
  /**
   * Where the player stands to be served: centred on the counter, on open floor
   * a comfortable step clear of the counter blocker's front edge (y = 86).
   */
  standPoint: { x: 50, y: 87.5 } as Position,
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
