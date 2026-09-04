/**
 * The Photo Booth's placement in the shopping mall.
 *
 * Its own module, like `care-store-config.ts` and `town-streetlights-config.ts`,
 * for the reason the streetlights recorded: placement numbers that live inline
 * in `InteractiveElements` drift away from anything derived from them. The two
 * facades swapped levels, so both sets of numbers are now stated where a test
 * can read them and assert the swap actually happened.
 *
 * All values are world percent of the fixed 1046×697 design box.
 */

import type { Position } from '@/lib/types';

/**
 * The Photo Booth on the mall's GROUND floor, in the bay beside the Coffee Shop.
 *
 * It used to stand on the middle level at `left-[33.5%] w-[8.5%]`; it and the
 * Care Store traded places. The booth is a small object in a wide bay, so it is
 * CENTRED in the clear wall rather than stretched to fill it: measured from the
 * sprites' alpha channels, the Coffee Shop's artwork ends at x = 50.38 % and the
 * right potted plant's begins at x = 72.70 %, and the booth paints 9.46 % at
 * `w-[9.5%]` (its sprite has 0.45 % transparent margin on the right and none on
 * the left). Centring that in the bay puts its box at `left-[56.8%]`.
 *
 * `bottom-[12%]` matches the Coffee Shop exactly, and needs no correction here
 * because the booth sprite has NO transparent film below its artwork; its
 * painted base is its box base. (The Care Store's does, which is why that one
 * carries an offset anchor; see `care-store-config.ts`.)
 */
export const MALL_PHOTO_BOOTH = {
  src: '/assets/locations/shop/photo-booth.png',
  doorSrc: '/assets/locations/shop/doors/photo-booth-door.png',
  /** Names what the door does, which is open the booth's camera. */
  doorAlt: 'Photo booth open',
  containerClassName: 'absolute bottom-[12%] left-[56.8%] z-20 w-[9.5%]',
  /** The open-door overlay, positioned inside the booth's own box. */
  doorClassName: 'absolute bottom-[5.8%] right-[12.8%] w-[42.2%]',
  /**
   * Where the Blobbi stands to use the booth.
   *
   * Stated rather than derived, and new with the move. On the middle level the
   * derived base point landed ~24 world px from the walkway, inside the 40 px
   * arrival threshold, so the booth worked by luck of proximity. On the ground
   * floor the same derivation lands ~36 px away: still under the threshold, but
   * with almost nothing to spare, and it would have been one layout tweak away
   * from a door that silently stopped opening. Naming the point removes that.
   */
  walkTarget: { x: 61, y: 93 } as Position,
} as const;
