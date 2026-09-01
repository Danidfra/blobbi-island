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
  /**
   * What clicking this object does, for the objects that do something.
   *
   * Absent means SCENERY: no name, no cursor, no hover, `pointer-events-none`.
   * Present means the room renders it as a real button with a walk-to-interact
   * target — and `alt` must then be a real accessible name, which the config
   * test enforces so the two can never disagree.
   *
   * `opens` is which of the room's TWO modal states the arrival flips. Both
   * display tables and the checkout say `'shop'`, so they converge on one
   * purchase surface rather than growing one each.
   */
  readonly interaction?: {
    readonly opens: 'shop' | 'fitting-room';
    /** Where the Blobbi stands before the action fires. */
    readonly standPoint: Position;
  };
}

/**
 * Everything standing in the room, back to front.
 *
 * The order is the render order and the reading order: wall art, then the
 * counter, then the flanking furniture, then what sits out on the floor.
 *
 * ```
 *   [hat        [poster] [ SIGN ] [poster]
 *    shelf]                                  [ FITTING
 *                [   CHECKOUT   ]              ROOM   ]
 *              ← walkable behind →
 *   [table 1]        ( rug )        [table 2]
 *   ─────────────── open floor ───────────────
 * ```
 *
 * Four of these open the shop — the checkout, both display tables, and the
 * room's corner button — and exactly one opens something else: the fitting
 * room, which previews clothes and writes nothing.
 */
export const clothingStoreObjects: readonly ClothingStoreObject[] = [
  {
    /**
     * The rug, centred — the room's floor anchor, with the counter behind it
     * and a display table well out to either side. Floor decoration, so no
     * blocker: it is walked on, not around.
     *
     * Sprite 1536×1024, ink margins l 1.82 % r 1.95 % t 15.43 % b 18.16 %.
     * Paints x 39.4 → 60.6, base y 95.
     */
    id: 'clothing-store-rug',
    src: `${ART}/rug.png`,
    alt: null,
    className: 'absolute bottom-[1%] left-[39%] z-[2] w-[22%]',
  },
  {
    /**
     * "Dress up your Blobbi!" — back wall, left of the sign.
     *
     * Sprite 1024×1536, ink margins l 2.54 % r 2.73 % t 1.04 % b 7.1 %.
     * Paints x 32 → 39.1, y 39.5 → 55. Dropped ~5.5 % down the wall with its
     * two siblings: they were hanging near the ceiling, disconnected from the
     * shop under them. Same size as before — lower, not bigger.
     */
    id: 'clothing-store-poster-dress-up',
    src: `${ART}/poster-dress-up.png`,
    alt: null,
    className: 'absolute top-[39.3%] left-[31.8%] z-[5] w-[7.5%]',
  },
  {
    /**
     * The shop's own sign, centred on the back wall directly above the counter.
     *
     * Sprite 1448×1086, ink margins l/r 1.24 % t 0.83 % b 7.83 %.
     * Paints x 43.2 → 56.8, y 39.6 → 54 — still twice either poster's width,
     * so the hierarchy is untouched; it simply hangs at eye level now.
     */
    id: 'clothing-store-sign',
    src: `${ART}/sign-fashion-shop.png`,
    alt: null,
    className: 'absolute top-[39.5%] left-[43%] z-[5] w-[14%]',
  },
  {
    /**
     * A framed picture of a Blobbi at the mirror — back wall, right of the sign.
     *
     * Sprite 1024×1536, ink margins l 5.57 % r 5.47 % t 1.95 % b 9.24 %.
     * Paints x 61 → 67.7, y 40 → 55.
     *
     * It fits beside the enlarged fitting room because that sprite's UPPER half
     * is empty on its left: measured per row, the booth's own ink starts at
     * 25.9 % of its box above the plant, which is x ≈ 69.9 here. So the poster
     * has 2.2 % of clear wall even though the booth's ink BOX starts at 63.
     */
    id: 'clothing-store-poster-mirror',
    src: `${ART}/poster-fitting-mirror.png`,
    alt: null,
    className: 'absolute top-[39.7%] left-[60.6%] z-[5] w-[7.5%]',
  },
  {
    /**
     * The hat shelf, moved up into the BACK-LEFT corner, where the back wall
     * meets the left one — a wall-mounted merchandise area rather than
     * furniture standing in the foreground.
     *
     * Sprite 1536×1024, ink margins l 14.91 % r 14.84 % t 3.03 % b 3.32 %.
     * Paints x 17.5 → 34.4 (from the left pillar's inner face), base y 79 —
     * tucked against the back wall, whose floor line is y = 77.
     *
     * Its blocker shrank with the move, and deliberately. A 6 %-deep rectangle
     * under a wall fixture is an invisible wall the player bumps into for no
     * visible reason; 1.7 % is the depth the thing actually has. It also has to
     * be that shallow for the room to stay CONNECTED: the strip behind the
     * counter starts at y = 80.2, so a deeper shelf would pinch the left-hand
     * way in against the counter's end and leave only one route round the back.
     */
    id: 'clothing-store-hat-shelf',
    src: `${ART}/hat-shelf.png`,
    alt: null,
    className: 'absolute bottom-[20.2%] left-[13.9%] z-[12] w-[24%]',
    blocker: { x: 17.5, y: 77.5, width: 16.9, height: 1.7 },
  },
  {
    /**
     * The checkout counter — centre, back, with real floor behind it.
     *
     * Sprite 1536×1024, ink margins l 6.51 % r 6.45 % t 15.62 % b 16.21 %.
     * Paints x 35.2 → 64.8, y 58.8 → 82. Its blocker is the counter's own floor
     * FOOTPRINT, so the staff side stays walkable.
     */
    id: 'clothing-store-checkout',
    src: `${ART}/checkout.png`,
    alt: 'Checkout counter — browse clothing',
    className: 'absolute bottom-[12.5%] left-[33%] z-[15] w-[34%]',
    blocker: { x: 35.2, y: 80.2, width: 29.6, height: 2.2 },
    interaction: { opens: 'shop', standPoint: { x: 50, y: 84 } },
  },
  {
    /**
     * The fitting room — the room's hero, now roughly DOUBLE its previous area
     * and pushed back toward the right-hand corner.
     *
     * Sprite 1536×1024, ink margins l 11.2 % r 10.81 % t 2.34 % b 5.37 %.
     * Paints x 63 → 99.5, y 43.8 → 87.
     *
     * 36.5 × 43.2 against the 27.3 × 32.3 it was: 1.79× the painted AREA, 1.34×
     * linear. A literal 2× width would have painted 54.6 across and reached
     * x ≈ 45 — through the checkout and most of the back wall — so this is the
     * largest that still reads as a room feature rather than as the room.
     *
     * It clears the counter (which paints to 64.8) by all but 1.8 %, and that
     * sliver is the sprite's potted plant, not the booth: measured per row, the
     * booth's own structure starts 6.9 % further right. A plant beside the till
     * is what it looks like, because it is what it is.
     *
     * The stand point is to the RIGHT of display table 2's legs rather than
     * straight in front of the curtain: the table sits between the room's
     * centre and the booth, so a centred approach would have been stopped by a
     * table leg and never arrived.
     *
     * Its footprint is the BOOTH, and a band of floor rather than its whole
     * painted depth. Two things fall out of that, both deliberate: the strip
     * behind the counter stays reachable up the lane between the till's right
     * end (x = 64.8) and the booth (x = 68), and the sprite's potted plant and
     * stool — small objects at either extreme — are not modelled as part of one
     * 33 %-wide slab.
     */
    id: 'clothing-store-fitting-room',
    src: `${ART}/fitting-room.png`,
    alt: 'Fitting room — try clothes on your Blobbi',
    className: 'absolute bottom-[10.5%] -right-[4.6%] z-[24] w-[46.8%]',
    blocker: { x: 68, y: 83, width: 28, height: 5.5 },
    interaction: { opens: 'fitting-room', standPoint: { x: 88, y: 91 } },
  },
  {
    /**
     * Accessory display table — pushed further LEFT, away from the rug.
     *
     * Sprite 1448×1086, ink margins l 0 % r 0.07 % t 4.05 % b 4.97 %.
     * Paints x 14 → 33.5, y 78 → 98. A touch larger (19.5 wide against 17) so it
     * reads as a merchandise display rather than a side table.
     *
     * The blocker is its FEET. A table on legs has floor behind it, and the
     * player browses from the aisle beside it.
     */
    id: 'clothing-store-display-table',
    src: `${ART}/display-table.png`,
    alt: 'Accessory display — browse clothing',
    className: 'absolute bottom-[0.9%] left-[14%] z-[28] w-[19.5%]',
    blocker: { x: 14, y: 95.8, width: 19.5, height: 2.4 },
    interaction: { opens: 'shop', standPoint: { x: 36, y: 95 } },
  },
  {
    /**
     * Clothing display table — pushed further RIGHT, its counterweight.
     *
     * Sprite 1536×1024, ink margins l/r 6.45 % t 7.71 % b 6.45 %.
     * Paints x 66.5 → 83.5, y 81.3 → 98.
     *
     * Not a mirror of its partner — a different table, different merchandise,
     * and slightly narrower ink at the same box width. Same feet-only footprint.
     */
    id: 'clothing-store-display-table-2',
    src: `${ART}/display-table-2.png`,
    alt: 'Clothing display — browse clothing',
    className: 'absolute bottom-[0.7%] left-[65.2%] z-[28] w-[19.5%]',
    blocker: { x: 66.5, y: 95.8, width: 17, height: 2.4 },
    interaction: { opens: 'shop', standPoint: { x: 64.5, y: 95 } },
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
  /** Over the counter's painted face: x 35.2 → 64.8, y 58.8 → 82. */
  className: 'absolute left-[35.2%] top-[58.8%] h-[23.2%] w-[29.6%] z-[16]',
} as const;

/**
 * Look an object's interaction up by id, for the room and for its tests.
 *
 * Throws rather than returning undefined: every caller here is naming an object
 * it knows is interactive, and a silent `undefined` would become a control that
 * quietly does nothing.
 */
export function clothingStoreInteraction(id: string) {
  const object = clothingStoreObjects.find((o) => o.id === id);
  if (!object?.interaction) {
    throw new Error(`No interaction configured for "${id}"`);
  }
  return object.interaction;
}

/** Every object the player can click, in render order. */
export const clothingStoreInteractiveObjects = clothingStoreObjects.filter(
  (object) => object.interaction !== undefined,
);

/**
 * The persistent Shop shortcut, lower-right — the Care Store's, in the same
 * visual language, for the same reason: the painted furniture is the immersive
 * way in, and this is the discoverable one.
 *
 * It is the FOURTH control over one `isShopOpen` flag, beside the checkout and
 * both display tables. It sits above every scene object (the display tables
 * reach z-28) because it is UI, not scenery, and over the open floor to the
 * right of the rug so it covers no artwork.
 */
export const CLOTHING_STORE_SHOP_BUTTON = {
  id: 'clothing-store-shop-shortcut',
  label: 'Open the Clothing Store shop',
  text: 'Shop',
  className: 'absolute bottom-[4%] right-[3%] z-[40]',
} as const;
