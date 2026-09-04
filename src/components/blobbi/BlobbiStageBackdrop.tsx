import { BackgroundLayer } from './BackgroundLayer';
import type { StageBackground } from '@/lib/blobbi-stage-backgrounds';

/**
 * The picture behind the Blobbi on its stage.
 *
 * One component for both kinds of backdrop, because "is it a bitmap or a
 * gradient" is the backdrop's business and not the window's, the stage asks
 * for a background and gets one. An image keeps `BackgroundLayer`'s load /
 * error handling (a remote-ish asset that can 404 degrades to the themed
 * gradient rather than to a broken-image glyph); a gradient is a single painted
 * div built from theme tokens, so it repaints on a theme switch by itself.
 *
 * Always `aria-hidden`: it is scenery. The window's title says whose Blobbi
 * this is, and the backdrop's name is announced by the control that changes it.
 */
export function BlobbiStageBackdrop({ background }: { background: StageBackground }) {
  if (background.art.kind === 'gradient') {
    return (
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ backgroundImage: background.art.css }}
      />
    );
  }

  return (
    <BackgroundLayer
      src={background.art.src}
      alt=""
      /*
        `cover` is now safe: the stage box is authored to STAGE_ASPECT_RATIO and
        so is the art, so cover has nothing to crop. It stays `cover` rather
        than becoming `contain` so a backdrop that IS mildly off-ratio fills the
        stage instead of letterboxing it.
      */
      fit="cover"
      fallback={
        <div className="absolute inset-0 bg-gradient-to-b from-island-sky via-island-ocean to-island-sand" />
      }
    />
  );
}

/**
 * The same backdrop at swatch scale, for a row that names it.
 *
 * Shares `StageBackground` with the stage rather than re-deriving anything, so
 * a swatch cannot show one thing while the stage shows another. No load/error
 * handling: a swatch that fails is a blank rounded rectangle beside the name,
 * which is a fine thing for a 40px thumbnail to be.
 */
export function StageBackgroundSwatch({ background }: { background: StageBackground }) {
  if (background.art.kind === 'gradient') {
    return (
      <span
        aria-hidden
        className="block h-full w-full"
        style={{ backgroundImage: background.art.css }}
      />
    );
  }
  return (
    <img src={background.art.src} alt="" aria-hidden className="h-full w-full object-cover" />
  );
}
