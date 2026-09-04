/**
 * Measured geometry of the Blobbi Island theater screen.
 *
 * No new artwork was created for the player. `stage-inside.png` is a palette PNG
 * whose proscenium already contains a fully transparent rectangle; it renders
 * black today only because `PlaceBackground` puts `bg-black` behind the stage
 * background. That hole is the screen, and anything mounted inside it shows
 * through the artwork instead of sitting on top of it.
 *
 * Measured from the asset (1037 × 691 source, drawn into the 1046 × 697 virtual
 * world):
 *
 * ```
 *        0%   6.8%        19.8%                     78.8%       92.7%  100%
 *  0%    ┌────────────────────────────────────────────────────────────┐
 *        │  wooden proscenium frame (opaque art)                      │
 *  6.7%  │    ┌───────────────────────────────────────────────────┐   │ ← hole
 *        │    │        ┌───────────────────────────────┐          │   │  2.565:1
 *        │    │        │   16:9 player 617×347 px      │          │   │
 * 56.9%  │    └────────┴───────────────────────────────┴──────────┘   │
 *        │  stage floor, front wall, seat rows …                      │
 * 100%   └────────────────────────────────────────────────────────────┘
 * ```
 *
 * The hole is 2.565 : 1, wider than 16 : 9, so a video is fitted by HEIGHT and
 * centred horizontally. Fitting by width would overflow the frame vertically and
 * paint video over the painted proscenium.
 */

import { WORLD_ASPECT } from '@/lib/world-coordinates';

/** The transparent rectangle in the background artwork, in world percent. */
export const THEATER_SCREEN_HOLE = {
  leftPercent: 6.8,
  rightPercent: 92.7,
  topPercent: 6.7,
  bottomPercent: 56.9,
} as const;

/** Width/height of the hole, in world percent. */
export const THEATER_SCREEN_HOLE_SIZE = {
  widthPercent: THEATER_SCREEN_HOLE.rightPercent - THEATER_SCREEN_HOLE.leftPercent,
  heightPercent: THEATER_SCREEN_HOLE.bottomPercent - THEATER_SCREEN_HOLE.topPercent,
} as const;

/** Aspect ratio of the media surface. */
export const THEATER_VIDEO_ASPECT = 16 / 9;

/**
 * The 16 : 9 player rectangle fitted by height inside the hole and centred.
 *
 * World units: 617 × 347 px of the 1046 × 697 world.
 */
export const THEATER_PLAYER_RECT = (() => {
  const worldAspect = WORLD_ASPECT;
  // A percentage-of-width and a percentage-of-height are different units; convert
  // the target aspect into "percent width per percent height" before fitting.
  const widthPercent = (THEATER_SCREEN_HOLE_SIZE.heightPercent * THEATER_VIDEO_ASPECT) / worldAspect;
  const leftPercent = THEATER_SCREEN_HOLE.leftPercent + (THEATER_SCREEN_HOLE_SIZE.widthPercent - widthPercent) / 2;

  return {
    leftPercent,
    topPercent: THEATER_SCREEN_HOLE.topPercent,
    widthPercent,
    heightPercent: THEATER_SCREEN_HOLE_SIZE.heightPercent,
  };
})();

/**
 * Where the control card sits.
 *
 * NOT over the screen. The painted red curtain covers the proscenium down to
 * roughly y 60 %, so anything placed against the bottom of the video rectangle
 * (y ≈ 57 %) is drawn on top of scenery and reads as floating debris. The band
 * between the curtain's hem and the back row of seats, the stage front wall,
 * is the only clear strip in the room, and it is where the card lives.
 *
 * Row C's chair sprites start at y ≈ 72.4 %, so a card taller than ~12 % of the
 * world overlaps them. It is drawn above them ({@link THEATER_Z.controls}), which
 * is correct: controls must never be occluded by furniture.
 *
 * The top edge sits just below the curtain's painted hem (~60 %). It was moved
 * up by 2 points once the card grew a session row: the taller card was ending up
 * against the seats and reading as cramped, and this is the whole of the space
 * available above the hem.
 */
export const THEATER_CONTROL_CARD_RECT = {
  leftPercent: THEATER_PLAYER_RECT.leftPercent,
  topPercent: 58.5,
  widthPercent: THEATER_PLAYER_RECT.widthPercent,
} as const;

/**
 * Stacking order inside the theater.
 *
 * The screen must paint ABOVE the background image but BELOW everything else in
 * the room. The curtain block is a plain `absolute` div with no z-index, so it
 * paints at z 0 within the stage stacking context, the screen therefore uses a
 * NEGATIVE z so the curtain can still fall in front of it, while the seat rows
 * (z 10/20/30) and the back arrow (z 20) are untouched.
 *
 * The controls overlay is deliberately separate and sits above the curtain: it
 * is UI, and a curtain painting over the play button would be a bug, not a
 * flourish.
 */
export const THEATER_Z = {
  /** Video surface: inside the artwork's hole, behind the curtain. */
  screen: -1,
  /** Playback UI: above the curtain, below nothing in particular. */
  controls: 40,
} as const;
