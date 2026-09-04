/**
 * The island sky as a pure function of the clock.
 *
 * Everything the day/night visuals need, colours, opacities, the sun's place in
 * its arc, how much the artwork should darken, is derived here from a single
 * number in `[0, 1)`. No React, no DOM, no timers. That split is the point: the
 * timing formulas are the part most likely to be wrong and the part hardest to
 * see with your eyes, so they live where a test can pin them down, and the
 * components stay dumb enough to be obviously correct.
 *
 * ## Phases are spans, not switches
 *
 * `IslandDayPhase` exists so that the rest of the app can *say* "it is sunset",
 * for a label, a future ambience hook, a test. It is deliberately **not** how
 * the visuals are computed. If the renderer branched on the phase, every
 * boundary would be a visible cut. Instead the visuals come from an interpolated
 * table of authored keyframes (§ {@link ISLAND_SKY_KEYFRAMES}) whose last entry
 * wraps onto its first, so the whole cycle is one continuous loop and the phase
 * name is just a label attached to a position in it.
 *
 * ## Phase layout (120 island minutes = 2 real hours)
 *
 * ```
 *  0 ─────── 10 ──────────────────────── 75 ─────── 90 ────────────── 115 ── 120
 *  │  dawn   │            day            │ sunset  │      night       │ →dawn │
 *  │  10 min │           65 min          │ 15 min  │      25 min      │ 5 min │
 * ```
 *
 * Day is by far the longest span, because the world has to be readable most of
 * the time. The final five minutes are still `phase === 'night'`; they are the
 * segment in which the night keyframe crossfades back into the dawn keyframe, so
 * the loop closes without a seam. `inFinalTransition` reports it.
 */

import { ISLAND_DAY_MINUTES, clamp01 } from '@/lib/island-clock';

export type IslandDayPhase = 'dawn' | 'day' | 'sunset' | 'night';

/**
 * Where each phase begins and ends, in island minutes. Contiguous and covering
 * `[0, 120)`: `islandPhaseAt` relies on both, and a test asserts them.
 */
export const ISLAND_PHASE_SPANS = [
  { phase: 'dawn', startMinute: 0, endMinute: 10 },
  { phase: 'day', startMinute: 10, endMinute: 75 },
  { phase: 'sunset', startMinute: 75, endMinute: 90 },
  { phase: 'night', startMinute: 90, endMinute: 120 },
] as const satisfies readonly { phase: IslandDayPhase; startMinute: number; endMinute: number }[];

/** The island minute at which night starts folding back into dawn. */
export const ISLAND_FINAL_TRANSITION_START_MINUTE = 115;

/**
 * The sun's arc runs from first light to the moment night begins: it rises at
 * minute 0 and sets at minute 90, so "the sun is down" and "it is night" are the
 * same statement rather than two settings that can disagree.
 */
export const ISLAND_SUN_RISE_MINUTE = 0;
export const ISLAND_SUN_SET_MINUTE = 90;

/**
 * The moon's arc wraps the end of the cycle: it rises late in sunset and sets
 * shortly after first light, crossing minute 120 → 0 mid-flight.
 */
export const ISLAND_MOON_RISE_MINUTE = 79;
export const ISLAND_MOON_SET_MINUTE = 11;

/**
 * Fraction of each body's arc spent fading in at the horizon, and out again at
 * the other side. Keeping visibility a function of arc position, rather than a
 * separate keyframed opacity, is what guarantees a body is invisible whenever
 * its position is parked outside the arc, so a hidden body can never flash into
 * view at the wrong end of the sky.
 */
const SUN_FADE = 5 / (ISLAND_SUN_SET_MINUTE - ISLAND_SUN_RISE_MINUTE);
const MOON_FADE_IN = 0.07;
const MOON_FADE_OUT = 0.12;

/** A colour stop set for one authored moment of the day. */
export interface IslandSkyGradient {
  /** Top of the sky. */
  top: string;
  /** Mid band, roughly a third of the way down. */
  mid: string;
  /** The horizon band. */
  bottom: string;
  /** Warm glow pooled at the horizon, strongest at dawn and sunset. */
  horizonGlow: string;
  /** Alpha of that glow, `0..1`. */
  horizonGlowAlpha: number;
}

/**
 * One authored moment of the island day.
 *
 * Adding a keyframe is the intended way to refine the look; the renderer derives
 * its layer count from this array, and continuity is guaranteed by construction
 * as long as the last entry's values match the first entry's (asserted by a
 * test).
 */
interface IslandSkyKeyframe extends IslandSkyGradient {
  /** Island minute this keyframe describes. Must be ascending. */
  minute: number;
  /** Human label: documentation and DEV panel readout only. */
  label: string;
  starOpacity: number;
  cloudBrightness: number;
  cloudOpacity: number;
  /** How warm the light is, `0..1`. Drives cloud and celestial tinting. */
  warmth: number;
  /** How deep the night is, `0..1`. An extension point for future ambience. */
  nightIntensity: number;
  /** Multiplier applied to the location artwork's brightness. */
  artworkBrightness: number;
  /** Multiplier applied to the location artwork's saturation. */
  artworkSaturation: number;
  /** Colour of the single scene-wide veil. */
  worldLightColor: string;
  /** Alpha of that veil before per-location scaling. Kept small on purpose. */
  worldLightOpacity: number;
}

/**
 * The authored day.
 *
 * Read this table, not the components, to understand what the island looks like
 * at any moment. The entry at minute 120 is the wrap point and must be identical
 * to minute 0 in every field except `minute` and `label`.
 *
 * `worldLightOpacity` peaks at 0.14. That ceiling is a readability budget, not an
 * aesthetic preference: this veil is the one layer that also covers the Blobbi,
 * remote players, name labels and chat bubbles, so the night's weight is carried
 * by `artworkBrightness` (which cannot reach characters at all) instead.
 */
export const ISLAND_SKY_KEYFRAMES: readonly IslandSkyKeyframe[] = [
  {
    minute: 0,
    label: 'first light',
    top: '#3C4A7A', mid: '#8C6E96', bottom: '#E8A87C',
    horizonGlow: '#FF9A5C', horizonGlowAlpha: 0.35,
    starOpacity: 0.55,
    cloudBrightness: 0.62, cloudOpacity: 0.55,
    warmth: 0.5, nightIntensity: 0.45,
    artworkBrightness: 0.74, artworkSaturation: 0.88,
    worldLightColor: '#7A6392', worldLightOpacity: 0.11,
  },
  {
    minute: 5,
    label: 'sunrise',
    top: '#6FA3D9', mid: '#F3B58C', bottom: '#FFD9A0',
    horizonGlow: '#FFB067', horizonGlowAlpha: 0.55,
    starOpacity: 0.15,
    cloudBrightness: 0.85, cloudOpacity: 0.8,
    warmth: 0.9, nightIntensity: 0.12,
    artworkBrightness: 0.9, artworkSaturation: 1.02,
    worldLightColor: '#FFB273', worldLightOpacity: 0.07,
  },
  {
    minute: 10,
    label: 'morning',
    top: '#7FC4F2', mid: '#A8DAF7', bottom: '#D6EFFB',
    horizonGlow: '#FFD9A0', horizonGlowAlpha: 0.18,
    starOpacity: 0,
    cloudBrightness: 1, cloudOpacity: 0.92,
    warmth: 0.25, nightIntensity: 0,
    artworkBrightness: 1, artworkSaturation: 1,
    worldLightColor: '#FFE9B8', worldLightOpacity: 0.03,
  },
  {
    minute: 42.5,
    label: 'midday',
    top: '#55B8F0', mid: '#8FD3F7', bottom: '#CDEBFA',
    horizonGlow: '#FFFFFF', horizonGlowAlpha: 0,
    starOpacity: 0,
    cloudBrightness: 1, cloudOpacity: 0.95,
    warmth: 0, nightIntensity: 0,
    artworkBrightness: 1, artworkSaturation: 1,
    worldLightColor: '#FFFFFF', worldLightOpacity: 0,
  },
  {
    minute: 75,
    label: 'golden hour',
    top: '#6FBCE8', mid: '#F2C795', bottom: '#FFE1B0',
    horizonGlow: '#FFCE8A', horizonGlowAlpha: 0.3,
    starOpacity: 0,
    cloudBrightness: 0.96, cloudOpacity: 0.92,
    warmth: 0.45, nightIntensity: 0,
    artworkBrightness: 0.98, artworkSaturation: 1.04,
    worldLightColor: '#FFC27A', worldLightOpacity: 0.04,
  },
  {
    minute: 82.5,
    label: 'sundown',
    top: '#5D77B8', mid: '#EE9A6C', bottom: '#FFC98A',
    horizonGlow: '#FF8A4C', horizonGlowAlpha: 0.6,
    starOpacity: 0.25,
    cloudBrightness: 0.86, cloudOpacity: 0.85,
    warmth: 0.95, nightIntensity: 0.2,
    artworkBrightness: 0.9, artworkSaturation: 1.06,
    worldLightColor: '#FF9E5E', worldLightOpacity: 0.08,
  },
  {
    minute: 90,
    label: 'dusk',
    top: '#2A3468', mid: '#4A4E8C', bottom: '#7B6A9E',
    horizonGlow: '#6A5A9E', horizonGlowAlpha: 0.25,
    starOpacity: 0.8,
    cloudBrightness: 0.62, cloudOpacity: 0.6,
    warmth: 0.2, nightIntensity: 0.6,
    artworkBrightness: 0.78, artworkSaturation: 0.94,
    worldLightColor: '#5A5FA8', worldLightOpacity: 0.11,
  },
  {
    minute: 96,
    label: 'deep night',
    top: '#141B3D', mid: '#1F2A55', bottom: '#35406E',
    horizonGlow: '#2A3468', horizonGlowAlpha: 0.1,
    starOpacity: 1,
    cloudBrightness: 0.5, cloudOpacity: 0.45,
    warmth: 0, nightIntensity: 1,
    artworkBrightness: 0.7, artworkSaturation: 0.86,
    worldLightColor: '#3E4585', worldLightOpacity: 0.14,
  },
  {
    minute: ISLAND_FINAL_TRANSITION_START_MINUTE,
    label: 'late night',
    top: '#141B3D', mid: '#1F2A55', bottom: '#35406E',
    horizonGlow: '#2A3468', horizonGlowAlpha: 0.1,
    starOpacity: 1,
    cloudBrightness: 0.5, cloudOpacity: 0.45,
    warmth: 0, nightIntensity: 1,
    artworkBrightness: 0.7, artworkSaturation: 0.86,
    worldLightColor: '#3E4585', worldLightOpacity: 0.14,
  },
  {
    minute: ISLAND_DAY_MINUTES,
    label: 'first light (wrap)',
    top: '#3C4A7A', mid: '#8C6E96', bottom: '#E8A87C',
    horizonGlow: '#FF9A5C', horizonGlowAlpha: 0.35,
    starOpacity: 0.55,
    cloudBrightness: 0.62, cloudOpacity: 0.55,
    warmth: 0.5, nightIntensity: 0.45,
    artworkBrightness: 0.74, artworkSaturation: 0.88,
    worldLightColor: '#7A6392', worldLightOpacity: 0.11,
  },
];

/** Everything the visual layers need for one instant of the island day. */
export interface IslandSkyState {
  /** Position in the island day, `[0, 1)`. */
  dayProgress: number;
  /** Position in the island day, in island minutes `[0, 120)`. */
  minute: number;
  phase: IslandDayPhase;
  /** Position within the current phase, `[0, 1)`. */
  phaseProgress: number;
  /** True during the final five minutes, while night folds back into dawn. */
  inFinalTransition: boolean;

  /** Position along the sun's arc, `0` (left) → `1` (right). */
  sunProgress: number;
  /** `0` whenever the sun is below the horizon, including all of night. */
  sunOpacity: number;
  /** Position along the moon's arc, `0` (left) → `1` (right). */
  moonProgress: number;
  /** `0` whenever the moon is below the horizon. */
  moonOpacity: number;

  starOpacity: number;
  cloudBrightness: number;
  cloudOpacity: number;
  warmth: number;
  nightIntensity: number;

  /** Brightness multiplier for the location artwork, `~0.7 .. 1`. */
  artworkBrightness: number;
  /** Saturation multiplier for the location artwork, `~0.86 .. 1.06`. */
  artworkSaturation: number;

  /** Colour of the scene-wide veil, `#rrggbb`. */
  worldLightColor: string;
  /** Alpha of that veil before per-location scaling, `0 .. 0.14`. */
  worldLightOpacity: number;

  /** Interpolated sky colours. Also the renderer's opaque base colour. */
  gradient: IslandSkyGradient;

  /**
   * Which pair of {@link ISLAND_SKY_KEYFRAMES} the current moment sits between,
   * and how far. The renderer crossfades pre-built gradient layers on these two
   * numbers rather than animating colours, which needs no `@property` support.
   */
  keyframeIndex: number;
  keyframeBlend: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Parse `#rgb` / `#rrggbb` into channel bytes. Unparseable input reads black. */
function parseHex(hex: string): [number, number, number] {
  const raw = hex.replace('#', '').trim();
  const full =
    raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) return [0, 0, 0];
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(channel: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(channel)));
  return clamped.toString(16).padStart(2, '0');
}

/**
 * Blend two hex colours in sRGB.
 *
 * sRGB rather than a perceptual space on purpose: the keyframes are hand-authored
 * three minutes apart at the fast-moving moments, so neighbouring colours are
 * close enough that the extra machinery would buy nothing, and staying in sRGB
 * keeps this function trivially checkable.
 */
export function lerpHexColor(from: string, to: string, t: number): string {
  const amount = clamp01(t);
  const [r1, g1, b1] = parseHex(from);
  const [r2, g2, b2] = parseHex(to);
  return `#${toHex(lerp(r1, r2, amount))}${toHex(lerp(g1, g2, amount))}${toHex(lerp(b1, b2, amount))}`;
}

/** The phase span containing a given island minute, and the position within it. */
export function islandPhaseAt(dayProgress: number): {
  phase: IslandDayPhase;
  phaseProgress: number;
} {
  const minute = clamp01(dayProgress) * ISLAND_DAY_MINUTES;
  for (const span of ISLAND_PHASE_SPANS) {
    if (minute < span.endMinute) {
      return {
        phase: span.phase,
        phaseProgress: clamp01((minute - span.startMinute) / (span.endMinute - span.startMinute)),
      };
    }
  }
  // `dayProgress === 1` is out of the half-open range the clock produces, but a
  // caller (or a DEV slider at its maximum) can still hand it over; it is the
  // very end of the last span.
  const last = ISLAND_PHASE_SPANS[ISLAND_PHASE_SPANS.length - 1];
  return { phase: last.phase, phaseProgress: 1 };
}

/**
 * Distance from `fromMinute` forward to `minute`, wrapping through the end of the
 * day. Used for the moon, whose arc straddles minute 120 → 0.
 */
function forwardMinutes(minute: number, fromMinute: number): number {
  return ((minute - fromMinute) % ISLAND_DAY_MINUTES + ISLAND_DAY_MINUTES) % ISLAND_DAY_MINUTES;
}

/** Fade in over the first `inFrac` of the arc and out over the last `outFrac`. */
function arcVisibility(progress: number, inFrac: number, outFrac: number): number {
  return clamp01(progress / inFrac) * clamp01((1 - progress) / outFrac);
}

/**
 * Where a celestial body sits, as percentages of the sky layer's own box.
 *
 * A sine arc, not an ephemeris: left horizon → overhead → right horizon, zero
 * height at both ends so a body always enters and leaves at the skyline. `y`
 * grows downward, matching CSS.
 */
export function islandCelestialPosition(
  progress: number,
  options: { horizonPercent?: number; peakPercent?: number } = {},
): { xPercent: number; yPercent: number } {
  const horizon = options.horizonPercent ?? 52;
  const peak = options.peakPercent ?? 8;
  const p = clamp01(progress);
  return {
    xPercent: 8 + p * 84,
    yPercent: horizon - Math.sin(Math.PI * p) * (horizon - peak),
  };
}

/**
 * The whole visual state for one position in the island day.
 *
 * Deterministic, allocation-light and free of `Date.now()`: the caller supplies
 * the position, so tests can walk the entire cycle and the DEV harness can
 * scrub it.
 */
export function computeIslandSkyState(dayProgress: number): IslandSkyState {
  const progress = clamp01(dayProgress);
  const minute = progress * ISLAND_DAY_MINUTES;

  // Bracketing keyframes. The table is short and ascending, so a scan is both
  // faster and clearer than a binary search.
  let index = 0;
  for (let i = 0; i < ISLAND_SKY_KEYFRAMES.length - 1; i += 1) {
    if (minute >= ISLAND_SKY_KEYFRAMES[i + 1].minute) index = i + 1;
    else break;
  }
  index = Math.min(index, ISLAND_SKY_KEYFRAMES.length - 2);

  const from = ISLAND_SKY_KEYFRAMES[index];
  const to = ISLAND_SKY_KEYFRAMES[index + 1];
  const span = to.minute - from.minute;
  const blend = span > 0 ? clamp01((minute - from.minute) / span) : 0;

  const { phase, phaseProgress } = islandPhaseAt(progress);

  const sunProgress = clamp01(
    (minute - ISLAND_SUN_RISE_MINUTE) / (ISLAND_SUN_SET_MINUTE - ISLAND_SUN_RISE_MINUTE),
  );
  const moonArcMinutes = forwardMinutes(ISLAND_MOON_SET_MINUTE, ISLAND_MOON_RISE_MINUTE);
  const moonProgress = clamp01(forwardMinutes(minute, ISLAND_MOON_RISE_MINUTE) / moonArcMinutes);

  return {
    dayProgress: progress,
    minute,
    phase,
    phaseProgress,
    inFinalTransition: minute >= ISLAND_FINAL_TRANSITION_START_MINUTE,

    sunProgress,
    sunOpacity: arcVisibility(sunProgress, SUN_FADE, SUN_FADE),
    moonProgress,
    moonOpacity: arcVisibility(moonProgress, MOON_FADE_IN, MOON_FADE_OUT),

    starOpacity: clamp01(lerp(from.starOpacity, to.starOpacity, blend)),
    cloudBrightness: lerp(from.cloudBrightness, to.cloudBrightness, blend),
    cloudOpacity: clamp01(lerp(from.cloudOpacity, to.cloudOpacity, blend)),
    warmth: clamp01(lerp(from.warmth, to.warmth, blend)),
    nightIntensity: clamp01(lerp(from.nightIntensity, to.nightIntensity, blend)),

    artworkBrightness: lerp(from.artworkBrightness, to.artworkBrightness, blend),
    artworkSaturation: lerp(from.artworkSaturation, to.artworkSaturation, blend),

    worldLightColor: lerpHexColor(from.worldLightColor, to.worldLightColor, blend),
    worldLightOpacity: clamp01(lerp(from.worldLightOpacity, to.worldLightOpacity, blend)),

    gradient: {
      top: lerpHexColor(from.top, to.top, blend),
      mid: lerpHexColor(from.mid, to.mid, blend),
      bottom: lerpHexColor(from.bottom, to.bottom, blend),
      horizonGlow: lerpHexColor(from.horizonGlow, to.horizonGlow, blend),
      horizonGlowAlpha: clamp01(lerp(from.horizonGlowAlpha, to.horizonGlowAlpha, blend)),
    },

    keyframeIndex: index,
    keyframeBlend: blend,
  };
}

/** `rgba()` string for a hex colour at a given alpha. */
export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}

/**
 * The CSS `background-image` for one authored keyframe: a warm horizon glow over
 * an opaque vertical gradient.
 *
 * Every layer being fully opaque is what makes the renderer's stacked-crossfade
 * exactly equal to a two-colour interpolation; see `IslandSkyLayer`.
 */
export function islandSkyKeyframeBackground(keyframe: IslandSkyGradient): string {
  const glow = hexToRgba(keyframe.horizonGlow, keyframe.horizonGlowAlpha);
  const glowFade = hexToRgba(keyframe.horizonGlow, 0);
  return [
    `radial-gradient(125% 62% at 50% 54%, ${glow} 0%, ${glowFade} 68%)`,
    `linear-gradient(to bottom, ${keyframe.top} 0%, ${keyframe.mid} 34%, ${keyframe.bottom} 52%, ${keyframe.bottom} 100%)`,
  ].join(', ');
}

/**
 * The CSS `filter` that carries the time-of-day grade on the location artwork.
 *
 * This is the half of the grade that must not touch characters, and it is applied
 * to the artwork `<img>` rather than as an overlay for one reason: a filter leaves
 * fully transparent pixels transparent, so the ground darkens at night while the
 * sky showing through the cut-out keeps the colours it was authored with. A tint
 * layer cannot do that; it has no way to follow the image's alpha channel.
 *
 * The function list is fixed so consecutive values interpolate under a CSS
 * transition; `extra` is prepended for the letterbox copy, which also needs its
 * existing blur.
 */
export function islandArtworkFilter(
  state: Pick<IslandSkyState, 'artworkBrightness' | 'artworkSaturation'>,
  strength: number,
  extra?: string,
): string {
  const amount = clamp01(strength);
  const brightness = 1 + (state.artworkBrightness - 1) * amount;
  const saturation = 1 + (state.artworkSaturation - 1) * amount;
  const parts = [`brightness(${brightness.toFixed(3)})`, `saturate(${saturation.toFixed(3)})`];
  return extra ? [extra, ...parts].join(' ') : parts.join(' ');
}

/**
 * The middle of a phase, as day progress, what the DEV harness jumps to when a
 * phase button is pressed. Midpoints, because the interesting part of a phase is
 * rarely its edge.
 */
export function islandPhaseMidpointProgress(phase: IslandDayPhase): number {
  const span = ISLAND_PHASE_SPANS.find((candidate) => candidate.phase === phase);
  if (!span) return 0;
  return ((span.startMinute + span.endMinute) / 2) / ISLAND_DAY_MINUTES;
}
