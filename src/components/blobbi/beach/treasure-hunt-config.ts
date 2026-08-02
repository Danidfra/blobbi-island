/**
 * Treasure Hunt — the ONE registry of presentation configuration: asset
 * paths, artwork geometry, detector calibration, the UI round policy and the
 * per-kind display metadata. Components import from here and never hardcode a
 * path or a balance number.
 *
 * ## Assets
 *
 * The supplied final art lives under `/assets/minigames/treasure-hunt/`
 * (game-only art) and `/assets/locations/beach/` (the shack, which is beach
 * scenery). The detector and shovel are SVG on purpose and stay SVG.
 *
 * ## Detector calibration
 *
 * The metal-detector SVG (`viewBox 0 0 320 720`) is drawn handle-down,
 * coil-up: the search coil is the ellipse centered at (160, 176). In the
 * top-down playfield that orientation is already correct — the handle points
 * toward the player at the bottom of the screen, the coil sweeps the sand
 * ahead — so no rotation is applied. The LOGICAL sensing point is the coil
 * anchor fraction below, never the SVG canvas center; artwork padding can
 * change without touching detector math.
 *
 * ## Field policy
 *
 * The pure model's field is policy-defined. The UI plays on a field whose
 * width/height ratio equals the sand rectangle's on-screen aspect, so one
 * field unit is the same number of pixels in x and y — detection circles
 * render as circles, and dragging feels identical in both axes. Everything
 * else (durations, counts, radii) is the model's provisional V1 policy,
 * untouched.
 */

import {
  DEFAULT_TREASURE_HUNT_POLICY,
  validateTreasureHuntPolicy,
  type TreasureHuntPolicy,
} from '@/beach/treasure-hunt';
import { treasureHuntAssetPath } from '@/lib/asset-paths';
import type { SandRect } from './field-transform';

// ── Assets ──────────────────────────────────────────────────────────────────

export const TREASURE_HUNT_ASSETS = {
  /** 1537 × 1023 raster. Fills the letterboxed playfield box. */
  playfield: treasureHuntAssetPath('sand-playfield.webp'),
  /** 1024 × 1024 raster. Repeatable dig marker, never part of the background. */
  dugHole: treasureHuntAssetPath('dug-hole.webp'),
  /** SVG, viewBox 0 0 320 720. The draggable detector game object. */
  detector: treasureHuntAssetPath('metal-detector.svg'),
  /** SVG, viewBox 0 0 300 600. Tool-dock icon for the shovel. */
  shovel: treasureHuntAssetPath('shovel.svg'),
  /** 1024 × 1024 raster, beach scenery. Lives with the beach's other art. */
  shack: '/assets/locations/beach/treasure-shack.webp',
} as const;

/** Intrinsic aspect of the playfield art (1537 / 1023). Layout only —
 *  gameplay coordinates never touch these pixels. */
export const PLAYFIELD_IMAGE_ASPECT = 1537 / 1023;

/**
 * The playable sand, as fractions of the playfield image: below the surf
 * line, inside the decorative shell borders. Verified against the artwork.
 */
export const SAND_RECT: SandRect = { x0: 0.03, y0: 0.26, x1: 0.97, y1: 0.98 };

// ── Detector calibration ────────────────────────────────────────────────────

export const DETECTOR_CALIBRATION = {
  /** SVG intrinsic geometry, from the artwork's viewBox. */
  viewBoxWidth: 320,
  viewBoxHeight: 720,
  /**
   * The coil's center inside the viewBox, as fractions: ellipse (160, 176)
   * of 320 × 720. THIS is the logical sensing point — not the canvas center.
   */
  coilAnchorX: 160 / 320,
  coilAnchorY: 176 / 720,
  /** Rendered height, as a fraction of the sand rect's height. */
  renderHeightSandFraction: 0.52,
  /** No rotation: the art's handle-down orientation already reads correctly. */
  rotationDeg: 0,
  /**
   * The handle may visually overflow the sand rect's bottom edge while the
   * coil stays inside; the sprite is pointer-transparent so overflow is
   * purely visual.
   */
  allowVisualOverflow: true,
} as const;

/** Dig-marker render width as a fraction of the sand rect's height. */
export const DUG_HOLE_RENDER_FRACTION = 0.16;

// ── Field policy ────────────────────────────────────────────────────────────

/**
 * On-screen aspect of the sand rect: (0.94 × 1537) / (0.72 × 1023) ≈ 1.96.
 * Used as the logical field width so field units are isotropic on screen.
 */
export const TREASURE_FIELD_WIDTH =
  ((SAND_RECT.x1 - SAND_RECT.x0) * 1537) / ((SAND_RECT.y1 - SAND_RECT.y0) * 1023);

export const TREASURE_HUNT_UI_POLICY: TreasureHuntPolicy = {
  ...DEFAULT_TREASURE_HUNT_POLICY,
  fieldWidth: TREASURE_FIELD_WIDTH,
  initialCoilPosition: { x: TREASURE_FIELD_WIDTH / 2, y: 0.5 },
};

// An invalid derived policy is a build bug; fail at import, like shop-catalog.
validateTreasureHuntPolicy(TREASURE_HUNT_UI_POLICY);

// ── Find presentation metadata ──────────────────────────────────────────────

export interface FindPresentation {
  /** Accessible display name — the pure model's `kind` is an identifier. */
  readonly name: string;
  /**
   * Centralized TEMPORARY local icon (no final find art was supplied for
   * Phase 1B; these are emoji on purpose, never remote URLs).
   */
  readonly icon: string;
}

export const FIND_PRESENTATION: Readonly<Record<string, FindPresentation>> = {
  'bottle-cap': { name: 'Bottle Cap', icon: '🍾' },
  'rusty-tab': { name: 'Rusty Tab', icon: '🥫' },
  'bent-wire': { name: 'Bent Wire', icon: '➰' },
  'old-screw': { name: 'Old Screw', icon: '🔩' },
  'scrap-piece': { name: 'Scrap Piece', icon: '🗑️' },
  'decorative-coin': { name: 'Decorative Old Coin', icon: '🪙' },
  'shell-pendant': { name: 'Shell Pendant', icon: '🐚' },
  'toy-badge': { name: 'Toy Badge', icon: '🎖️' },
  'nautical-trinket': { name: 'Nautical Trinket', icon: '⚓' },
  'shiny-button': { name: 'Shiny Button', icon: '🔘' },
  'special-candidate': { name: 'Mysterious Find', icon: '✨' },
};

export function findPresentation(kind: string): FindPresentation {
  return FIND_PRESENTATION[kind] ?? { name: 'Curious Find', icon: '❓' };
}

// ── Signal presentation ─────────────────────────────────────────────────────

export type SignalLevel = 'none' | 'weak' | 'medium' | 'strong' | 'very-strong';

/**
 * One display state per signal level, driving the detector SVG's OWN screen
 * (ids `th-display-screen`, `th-signal-dot`, `th-signal-arc-1..3` inside
 * `metal-detector.svg`): the dot plus a growing arc count is the structural
 * indicator, the screen tint is the redundant color channel (coral = far,
 * yellow = closer, green = close — distance, never danger). All thresholds
 * live here; nothing in JSX may hardcode one.
 */
export interface SignalDisplayState {
  readonly level: SignalLevel;
  /** Intensity floor for this state; states are matched highest-first. */
  readonly minIntensity: number;
  readonly dotActive: boolean;
  /** How many arcs light up, innermost first. */
  readonly activeArcs: 0 | 1 | 2 | 3;
  /** Screen tint, or `null` to keep the artwork's stock screen gradient. */
  readonly screenFill: string | null;
  /** Screen-reader status text. */
  readonly label: string;
}

export const SIGNAL_DISPLAY_STATES: readonly SignalDisplayState[] = Object.freeze([
  { level: 'very-strong', minIntensity: 0.8, dotActive: true, activeArcs: 3, screenFill: '#22c55e', label: 'Very strong signal' },
  { level: 'strong', minIntensity: 0.55, dotActive: true, activeArcs: 2, screenFill: '#4ade80', label: 'Strong signal' },
  { level: 'medium', minIntensity: 0.3, dotActive: true, activeArcs: 1, screenFill: '#facc15', label: 'Medium signal' },
  { level: 'weak', minIntensity: Number.MIN_VALUE, dotActive: true, activeArcs: 0, screenFill: '#fb7185', label: 'Weak signal' },
  { level: 'none', minIntensity: 0, dotActive: false, activeArcs: 0, screenFill: null, label: 'No signal' },
]);

export function signalDisplayState(intensity: number): SignalDisplayState {
  for (const state of SIGNAL_DISPLAY_STATES) {
    if (intensity >= state.minIntensity && (state.level !== 'none' ? intensity > 0 : true)) {
      return state;
    }
  }
  return SIGNAL_DISPLAY_STATES[SIGNAL_DISPLAY_STATES.length - 1];
}

// ── Shovel cursor calibration ───────────────────────────────────────────────

/**
 * Desktop-only decorative cursor: the shovel SVG follows a fine pointer over
 * the sand with its blade tip on the exact dig point. The tip anchor is the
 * blade apex at (150, 40) of the 300 × 600 viewBox — presentation only; dig
 * coordinates always come from the pointer, never from these bounds.
 */
export const SHOVEL_CURSOR = {
  viewBoxWidth: 300,
  viewBoxHeight: 600,
  tipAnchorX: 150 / 300,
  tipAnchorY: 40 / 600,
  /** Rendered height, as a fraction of the sand rect's height. */
  renderHeightSandFraction: 0.3,
} as const;

// ── Detector dock presentation ──────────────────────────────────────────────

/**
 * Where the idle detector parks (toward the right-side tool dock) while the
 * shovel is selected. Percent of the playfield image box — PRESENTATION ONLY:
 * the logical coil position in the round state is never overwritten, so
 * re-selecting the detector returns it to the searched spot.
 */
export const DETECTOR_DOCK = {
  leftPercent: 94,
  topPercent: 40,
  /** Scale applied to the docked sprite's rendered height. */
  scale: 0.55,
  opacity: 0.45,
} as const;
