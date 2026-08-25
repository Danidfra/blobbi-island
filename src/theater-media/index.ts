/**
 * Theater media safety — what may appear on the theater screen.
 *
 * The catalog is bundled (no relay, no unknown state); admission is pure and is
 * consulted by every path that can put media on screen, not only by the input.
 *
 * See `docs/theater-media-safety.md`.
 */

export type { ApprovedMedia, ApprovedMediaProvider } from './catalog';
export {
  APPROVED_THEATER_MEDIA,
  approvedMediaFor,
  approvedMediaShelf,
  isApprovedMedia,
  isWellFormedApprovedMedia,
} from './catalog';

export type { TheaterMediaAdmission, TheaterMediaDenial, TheaterMediaRef } from './admission';
export {
  admitTheaterMedia,
  allowsOpenMediaEntry,
  allowsTheaterFullscreen,
  theaterMediaTitle,
} from './admission';
