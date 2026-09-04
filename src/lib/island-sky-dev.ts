/**
 * DEV-only overrides for the island sky.
 *
 * Waiting two real hours to look at a sunset is not a workflow, so the sky needs
 * a scrubber. What it must not have is a scrubber that can reach production.
 *
 * The guard is `import.meta.env.DEV`, which Vite replaces with a literal `false`
 * in a build. Both `isSkyDevMode` and every mutator check it, so in production
 * `setIslandSkyDev` is a no-op, the store never changes, and
 * `useSyncExternalStore` never notifies a subscriber. The production sky is
 * therefore automatic and deterministic by construction rather than by CSS
 * hiding a panel, the same approach `DebugOverlaysContext` already takes.
 *
 * A module-level store rather than a React context, deliberately: a context would
 * have to be mounted in `App.tsx` *and* `TestApp.tsx`, coupling every test to a
 * developer tool. This way production code reads one frozen object and nothing
 * else changes.
 */

import { useSyncExternalStore } from 'react';

import { clamp01 } from '@/lib/island-clock';
import { type IslandDayPhase, islandPhaseMidpointProgress } from '@/lib/island-sky';
import type { IslandCloudShape, IslandCloudSize } from '@/lib/island-sky-cloud-shapes';

/** True only in dev/local builds. Statically `false` in a production build. */
export const isSkyDevMode = import.meta.env.DEV;

export interface IslandSkyDevState {
  /**
   * `'auto'`: the real accelerated clock, which is the only production state.
   * `'fixed'`: hold `dayProgress`. Freezing, picking a phase and dragging the
   * slider all land here; they differ only in how the value was chosen, and
   * collapsing them keeps the resolution rule a single line.
   */
  mode: 'auto' | 'fixed';
  /** The held position in the island day, `0..1`. Ignored when `mode` is auto. */
  dayProgress: number;
  /** Force clouds off, to check a scene without them. */
  cloudsEnabled: boolean;
  /** Pretend the OS asked for reduced motion, without changing the OS. */
  simulateReducedMotion: boolean;
  /** Is the harness panel showing? */
  panelOpen: boolean;

  // ── Cloud preview ──────────────────────────────────────────────────────
  /** Which actor the shape/size overrides and the preview placement apply to. */
  cloudActorId: string;
  /** `'auto'` defers to the UTC-derived production policy. */
  cloudShape: IslandCloudShape | 'auto';
  /**
   * `'auto'` defers to the production size sequence. A forced size ignores the
   * actor's `allowedSizes`, so every size can be judged on every actor.
   */
  cloudSize: IslandCloudSize | 'auto';
  /**
   * `'preview'` parks the selected actor fully on screen and hides the other two,
   * so a silhouette can be judged immediately instead of after a five-minute wait.
   */
  cloudPlacement: 'auto' | 'preview';
}

/**
 * The production state, and the state every dev session starts in. Frozen so a
 * stray write cannot turn the shipped sky into something non-deterministic.
 */
export const ISLAND_SKY_DEV_DEFAULTS: IslandSkyDevState = Object.freeze({
  mode: 'auto',
  dayProgress: 0,
  cloudsEnabled: true,
  simulateReducedMotion: false,
  panelOpen: false,
  cloudActorId: 'cloud-a',
  cloudShape: 'auto',
  cloudSize: 'auto',
  cloudPlacement: 'auto',
});

/**
 * The position the sky should render at.
 *
 * The one place the override is allowed to influence anything. `auto` returns the
 * real clock untouched, so production behaviour is bit-identical to having no
 * harness at all.
 */
export function resolveIslandDayProgress(
  autoDayProgress: number,
  dev: IslandSkyDevState,
): number {
  if (dev.mode === 'auto') return autoDayProgress;
  return clamp01(dev.dayProgress);
}

/** The override that a phase button produces: hold the middle of that phase. */
export function islandSkyDevPhaseOverride(
  phase: IslandDayPhase,
  current: IslandSkyDevState,
): IslandSkyDevState {
  return { ...current, mode: 'fixed', dayProgress: islandPhaseMidpointProgress(phase) };
}

/** The override that "freeze" produces: hold wherever the clock is right now. */
export function islandSkyDevFreezeOverride(
  autoDayProgress: number,
  current: IslandSkyDevState,
): IslandSkyDevState {
  return { ...current, mode: 'fixed', dayProgress: clamp01(autoDayProgress) };
}

/**
 * What the cloud preview does to one actor.
 *
 * `hidden` empties the sky of everything but the actor under inspection, so a
 * silhouette can be judged without another cloud in frame. `parkPx` is a fixed
 * `translateX` that replaces the travel animation, the whole point of preview
 * mode is not waiting for a passage to come round.
 */
export interface IslandCloudDevPresentation {
  shape: IslandCloudShape | null;
  size: IslandCloudSize | null;
  hidden: boolean;
  parkPx: number | null;
}

/**
 * Resolve the DEV overrides for one actor.
 *
 * Pure, and **read-only with respect to the production policy**: it returns what to
 * draw *instead*, and never feeds back into `islandCloudPassage`. With the default
 * state every field is `null`/`false`, so the caller uses the UTC-derived passage
 * unchanged: which is what makes "back to Auto" an instant restore rather than a
 * reset of something that was mutated.
 *
 * Overrides apply only to `cloudActorId`; the other two actors stay on production
 * selection even while one is being previewed.
 */
export function resolveIslandCloudDev(
  actorId: string,
  dev: IslandSkyDevState,
  options: { worldWidthPx: number; renderedWidthPx: number },
): IslandCloudDevPresentation {
  const isTarget = actorId === dev.cloudActorId;
  const previewing = dev.cloudPlacement === 'preview';

  if (previewing && !isTarget) {
    return { shape: null, size: null, hidden: true, parkPx: null };
  }

  return {
    shape: isTarget && dev.cloudShape !== 'auto' ? dev.cloudShape : null,
    size: isTarget && dev.cloudSize !== 'auto' ? dev.cloudSize : null,
    hidden: false,
    parkPx: previewing && isTarget ? islandCloudPreviewParkPx(options) : null,
  };
}

/**
 * Where a previewed cloud is parked, in world pixels.
 *
 * **Not centred**, which was the obvious choice and the wrong one: every sky-ready
 * location puts its main structure in the horizontal middle: Plaza's town hall,
 * Town's three shopfronts, so a centred preview sat behind the scenery with only a
 * sliver showing. Parking over the left quarter puts the silhouette in the open sky
 * both scenes actually have, which is the whole point of preview mode.
 *
 * Clamped to keep the full width inside the world with a margin, so a large
 * formation is never judged while part of it is cut off by the frame.
 */
export function islandCloudPreviewParkPx(options: {
  worldWidthPx: number;
  renderedWidthPx: number;
}): number {
  const { worldWidthPx, renderedWidthPx } = options;
  const MARGIN = 8;
  const centredOnLeftQuarter = worldWidthPx * 0.12 - renderedWidthPx / 2;
  const maximum = Math.max(MARGIN, worldWidthPx - renderedWidthPx - MARGIN);
  return Math.round(Math.min(Math.max(centredOnLeftQuarter, MARGIN), maximum));
}

/**
 * The patch a cloud-preview control produces.
 *
 * Choosing a concrete shape or size also switches placement to `preview`, because
 * the brief's requirement is that forcing a variant must not mean waiting minutes
 * for that actor to drift into view. Returning both to `auto` releases placement
 * again, so one click restores production behaviour completely.
 */
export function islandSkyDevCloudOverride(
  patch: Partial<
    Pick<IslandSkyDevState, 'cloudActorId' | 'cloudShape' | 'cloudSize' | 'cloudPlacement'>
  >,
  current: IslandSkyDevState,
): IslandSkyDevState {
  const next = { ...current, ...patch };
  if (patch.cloudPlacement === undefined) {
    const forcing = next.cloudShape !== 'auto' || next.cloudSize !== 'auto';
    next.cloudPlacement = forcing ? 'preview' : 'auto';
  }
  return next;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let state: IslandSkyDevState = ISLAND_SKY_DEV_DEFAULTS;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): IslandSkyDevState {
  return state;
}

/**
 * Apply a patch. A no-op outside dev builds, and a no-op when nothing actually
 * changes, so subscribers are not woken for identical values.
 */
export function setIslandSkyDev(patch: Partial<IslandSkyDevState>): void {
  if (!isSkyDevMode) return;
  const next = { ...state, ...patch };
  const unchanged = (Object.keys(next) as (keyof IslandSkyDevState)[]).every(
    (key) => next[key] === state[key],
  );
  if (unchanged) return;
  state = next;
  listeners.forEach((listener) => listener());
}

/** Back to the production behaviour: the automatic clock, clouds on. */
export function resetIslandSkyDev(): void {
  setIslandSkyDev({ ...ISLAND_SKY_DEV_DEFAULTS, panelOpen: state.panelOpen });
}

/**
 * Current overrides. Always the frozen defaults in production, where the store
 * cannot be written and this therefore never triggers a re-render.
 */
export function useIslandSkyDev(): IslandSkyDevState {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return isSkyDevMode ? snapshot : ISLAND_SKY_DEV_DEFAULTS;
}

/** Test-only escape hatch, so one test's overrides cannot leak into the next. */
export function __resetIslandSkyDevStoreForTests(): void {
  state = ISLAND_SKY_DEV_DEFAULTS;
  listeners.clear();
}
