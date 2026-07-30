/**
 * Canonical Blobbi renderer-box contract (Phase 1).
 *
 * THE CONTRACT — see docs/blobbi-renderer-contract.md for the full document:
 *
 *  - The renderer box is a SQUARE, fixed-pixel box and the single local
 *    coordinate space for everything the renderer paints.
 *  - The body SVG fills the box exactly (absolute inset-0 wrapper; the SVG
 *    carries width/height 100% and a square viewBox, so it letterboxes
 *    nothing and distorts nothing).
 *  - Accessory x/y are percentages (0-100) OF THIS BOX, measured to the
 *    accessory's center.
 *  - Accessory base size is a fixed FRACTION of the box
 *    ({@link ACCESSORY_BASE_RATIO}), multiplied by the accessory's own saved
 *    scale. No fixed CSS-pixel accessory sizes.
 *  - Accessories may overflow the box; nothing clips them (clipping only
 *    happens at stage/frame level, far above the renderer).
 *  - No viewport breakpoint (md: etc.) may change the box: inside the fixed
 *    1046×697 VirtualWorld design space the world transform is the ONLY thing
 *    that scales the Blobbi with the viewport.
 *
 * Pixel values are the previous DESKTOP (`md:` variant) sizes of the visible
 * body SVG — chosen so the primary (desktop) in-world look is unchanged and
 * the old sub-768px viewport size step disappears. `xl` (128) is also the
 * accessory editor's box, so saved accessory placements keep their meaning
 * exactly.
 */

export type BlobbiRenderSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

/** Canonical square box size per token, in world-design-space pixels. */
export const BLOBBI_RENDER_SIZE_PX: Record<BlobbiRenderSize, number> = {
  sm: 32,
  md: 56,
  lg: 96,
  xl: 128,
  '2xl': 224,
  '3xl': 288,
};

/**
 * Fixed Tailwind classes implementing {@link BLOBBI_RENDER_SIZE_PX}
 * (h-8=32px … h-72=288px). Classes rather than inline styles so a caller can
 * still override the box through `className` via tailwind-merge (the shell's
 * account chip passes `size-full`). NO responsive variants — that is the
 * point.
 */
export const BLOBBI_RENDER_SIZE_CLASSES: Record<BlobbiRenderSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-14 w-14',
  lg: 'h-24 w-24',
  xl: 'h-32 w-32',
  '2xl': 'h-56 w-56',
  '3xl': 'h-72 w-72',
};

/**
 * Accessory base size as a fraction of the renderer box.
 *
 * 60/128: the legacy editor rendered accessories at a fixed 60px inside the
 * 128px `xl` box, and the editor is where every saved placement was authored —
 * preserving that ratio preserves the author's intent in every context. A
 * saved `scale` multiplies this base.
 */
export const ACCESSORY_BASE_RATIO = 60 / 128;

/** Accessory base size as a CSS percentage string of the renderer box. */
export const ACCESSORY_BASE_PERCENT = `${ACCESSORY_BASE_RATIO * 100}%`;

/** Canonical pixel size for a token (world-design-space px). */
export function blobbiRenderSizePx(size: BlobbiRenderSize): number {
  return BLOBBI_RENDER_SIZE_PX[size];
}

/** Accessory base size in px for a token (before the accessory's own scale). */
export function accessoryBasePx(size: BlobbiRenderSize): number {
  return BLOBBI_RENDER_SIZE_PX[size] * ACCESSORY_BASE_RATIO;
}
