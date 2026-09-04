/**
 * The renderer's INPUT NORMALIZATION boundary (Phase 4).
 *
 * `BlobbiRendererView` accepts loose, partially-populated visual data; it is
 * fed by relay events, presence payloads, editor previews and test fixtures,
 * none of which can be trusted to be complete. This module is the single pure
 * function that turns that into a fully-resolved {@link BlobbiRenderModel}: the
 * renderer's JSX then contains no defaulting, no domain rules and no clamping.
 *
 * Everything here is pure and React-free, so the same normalization runs in the
 * world, in the profile-modal preview, in the accessory editor and in a plain
 * Node test: which is what makes "local and remote render identically" a
 * structural fact rather than a convention.
 *
 * Documented fallback behavior for incomplete input:
 *  - unknown/absent `stage` → `'baby'` (the historical fallback artwork; note
 *    `'egg'` also draws the baby body, as it always has);
 *  - `adultType` is carried ONLY for the adult stage, defaulting to
 *    {@link DEFAULT_ADULT_TYPE}; an unrecognized value is corrected downstream
 *    by the adult SVG resolver;
 *  - absent colors are left undefined, which means "the artwork's own colors";
 *  - a non-finite gaze axis becomes 0; finite axes clamp to -1..1;
 *  - rear facing has no pupils in its markup at all, so gaze is dropped
 *    outright rather than injected and left unused;
 *  - an empty/blank `instanceId` falls back to {@link FALLBACK_INSTANCE_ID}
 *    rather than producing an SVG id prefix shared by every such renderer.
 */
import type { NormalizedAccessoryPlacement } from './accessory-normalize';

/** The visual identity of a Blobbi; everything the pure renderer needs. */
export interface BlobbiRenderVisual {
  stage?: 'egg' | 'baby' | 'adult';
  adultType?: string;
  baseColor?: string;
  secondaryColor?: string;
  eyeColor?: string;
  /** Display name; used only for the title/tooltip. */
  name?: string;
}

/** Which drawing to produce. `'rear'` is derived from the front artwork. */
export type BlobbiRenderView = 'front' | 'rear';

export interface BlobbiRenderModelInput {
  visual: BlobbiRenderVisual;
  instanceId: string;
  facing?: 'front' | 'back';
  isSleeping?: boolean;
  /** Kept distinct from sleeping for the seated legacy prop; both close eyes. */
  eyesClosed?: boolean;
  /** Normalized gaze direction (-1..1 per axis); undefined renders statically. */
  eyeOffset?: { x: number; y: number };
  accessories?: readonly NormalizedAccessoryPlacement[];
}

/** Fully resolved, renderable state. Every field is defined and valid. */
export interface BlobbiRenderModel {
  stage: 'egg' | 'baby' | 'adult';
  /** Present only when `stage === 'adult'`. */
  adultType?: string;
  baseColor?: string;
  secondaryColor?: string;
  eyeColor?: string;
  name?: string;
  facing: 'front' | 'back';
  /** The SVG variant to build: `'rear'` iff `facing === 'back'`. */
  view: BlobbiRenderView;
  /**
   * Selects the closed-eye (sleeping) artwork. `isSleeping` and the legacy
   * seated `eyesClosed` collapse here: both mean the same thing to the drawing,
   * and nothing downstream can tell them apart.
   */
  eyesClosed: boolean;
  /** Clamped gaze, or null when gaze must not be applied at all. */
  gaze: { x: number; y: number } | null;
  accessories: readonly NormalizedAccessoryPlacement[];
  /** Sanitized SVG id namespace; safe to embed in an `id` attribute. */
  instanceId: string;
}

/** Stage used when the input names none, or names one we do not draw. */
export const DEFAULT_STAGE = 'baby' as const;

/** Adult form used when the adult stage arrives without a type. */
export const DEFAULT_ADULT_TYPE = 'bloomi';

/** Instance id used when the caller supplies nothing usable. */
export const FALLBACK_INSTANCE_ID = 'blobbi';

const VALID_STAGES: ReadonlySet<string> = new Set(['egg', 'baby', 'adult']);

function clampGazeAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

/**
 * Sanitize an id namespace to the characters that are safe in an SVG `id`.
 *
 * Matches the transformation `uniquifySvgIds` applies internally, so doing it
 * here is idempotent and changes no existing id; it only makes the rule part
 * of the public contract instead of an implementation detail.
 */
export function normalizeInstanceId(instanceId: string | undefined): string {
  const sanitized = (instanceId ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
  // `___` etc. is a caller passing punctuation only: still degenerate, still
  // shared between instances. Treat "nothing but separators" as nothing.
  return /[a-zA-Z0-9]/.test(sanitized) ? sanitized : FALLBACK_INSTANCE_ID;
}

/**
 * Resolve loose visual input into a complete, renderable model. Pure: same
 * input, same output, in any runtime.
 */
export function normalizeBlobbiRenderModel(
  input: BlobbiRenderModelInput,
): BlobbiRenderModel {
  const { visual, facing = 'front', isSleeping = false, eyesClosed = false } = input;

  const stage = VALID_STAGES.has(visual.stage ?? '')
    ? (visual.stage as 'egg' | 'baby' | 'adult')
    : DEFAULT_STAGE;

  const isRearFacing = facing === 'back';

  return {
    stage,
    adultType: stage === 'adult' ? visual.adultType || DEFAULT_ADULT_TYPE : undefined,
    baseColor: visual.baseColor,
    secondaryColor: visual.secondaryColor,
    eyeColor: visual.eyeColor,
    name: visual.name,
    facing,
    view: isRearFacing ? 'rear' : 'front',
    eyesClosed: isSleeping || eyesClosed,
    gaze:
      input.eyeOffset === undefined || isRearFacing
        ? null
        : { x: clampGazeAxis(input.eyeOffset.x), y: clampGazeAxis(input.eyeOffset.y) },
    accessories: input.accessories ?? [],
    instanceId: normalizeInstanceId(input.instanceId),
  };
}
