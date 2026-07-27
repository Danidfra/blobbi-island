/**
 * SVG Utilities for Blobbi Visual System
 *
 * Centralized exports for all SVG manipulation utilities.
 *
 * This module provides:
 * - Color manipulation (lighten/darken)
 * - ID uniquification (prevent gradient collisions)
 * - Container sizing adjustments
 * - Rear ("facing away") view derivation
 */

export { lightenColor, darkenColor } from './colors';
export { uniquifySvgIds } from './ids';
export { ensureSvgFillsContainer } from './container';
export { applyGazeMarkup } from './gaze';
export {
  applyRearView,
  findRearViewRemovals,
  isSelfContainedMarkup,
  REAR_VIEW_REMOVED_BLOCKS,
  REAR_VIEW_KEPT_BLOCKS,
  type BlobbiView,
} from './rear-view';
