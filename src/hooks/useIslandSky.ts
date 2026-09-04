/**
 * React's window onto the island clock.
 *
 * One timer for the whole application, shared through `useSyncExternalStore`.
 * Two components consume the sky state (`IslandSkyLayer` and
 * `IslandWorldLight`) and a third reads it in dev (the harness panel); giving
 * each its own `setInterval` would drift them apart and triple the wakeups, so
 * the interval lives in the module and starts on the first subscriber, stops on
 * the last.
 *
 * ## Why this does not use requestAnimationFrame
 *
 * Nothing here is frame-rate work. The sky is recomputed every
 * {@link ISLAND_TICK_MS}: 720 times per island day, and the gap between two
 * values is bridged by CSS transitions of the same duration, so the *pixels*
 * change continuously at whatever rate the compositor likes while React does two
 * renders a minute. A `requestAnimationFrame` loop would burn a frame budget to
 * produce visually identical output, and it would keep the world re-rendering
 * forever.
 *
 * The re-render is also narrow on purpose: only the two decorative sky
 * components subscribe, so a tick never re-renders `PlayingView`,
 * `MultiplayerLayer`, the Blobbi or any interactive element.
 */

import { useMemo, useSyncExternalStore } from 'react';

import { ISLAND_TICK_MS, islandDayProgressAt, msUntilNextIslandTick } from '@/lib/island-clock';
import { type IslandSkyState, computeIslandSkyState, islandArtworkFilter } from '@/lib/island-sky';
import { resolveIslandDayProgress, useIslandSkyDev } from '@/lib/island-sky-dev';
import { getLocationSkyConfig } from '@/lib/island-sky-locations';
import {
  ISLAND_CLOUD_ACTORS,
  islandCloudPassageAt,
  islandCloudTravel,
} from '@/lib/island-sky-clouds';
import type { LocationId } from '@/lib/location-types';

/**
 * Cached snapshot. `useSyncExternalStore` compares snapshots by identity, so this
 * must be a stable object that is only replaced when the value really changed,
 * returning a fresh `computeIslandSkyState(...)` on every read would loop.
 */
let snapshot: IslandSkyState = computeIslandSkyState(islandDayProgressAt(Date.now()));
/**
 * The wall-clock instant the snapshot was taken at.
 *
 * Kept beside the sky state rather than inside it: `IslandSkyState` is a pure
 * description of a position in the island day, and cloud variation needs the
 * absolute UTC instant to derive passage indices from. Same tick, same store, one
 * timer.
 */
let snapshotNowMs = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function tick(): void {
  const nowMs = Date.now();
  const next = computeIslandSkyState(islandDayProgressAt(nowMs));
  if (next.dayProgress !== snapshot.dayProgress) {
    snapshot = next;
    snapshotNowMs = nowMs;
    listeners.forEach((listener) => listener());
  }
  schedule();
}

/**
 * Aligned to absolute tick boundaries rather than `setInterval` from mount, so
 * every client steps at the same instants and a long-backgrounded tab resumes on
 * the grid instead of carrying its drift forward.
 */
function schedule(): void {
  if (typeof window === 'undefined') return;
  timer = setTimeout(tick, msUntilNextIslandTick(Date.now()));
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (timer === null) {
    // A tab can be resumed hours later with a stale snapshot; refresh on the way
    // in so the first paint is correct rather than one tick behind.
    snapshotNowMs = Date.now();
    snapshot = computeIslandSkyState(islandDayProgressAt(snapshotNowMs));
    schedule();
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

function getSnapshot(): IslandSkyState {
  return snapshot;
}

function getNowMs(): number {
  return snapshotNowMs;
}

/** The automatic clock, with no DEV override applied. */
export function useIslandClockState(): IslandSkyState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The UTC instant of the current tick, from the same shared store.
 *
 * Cloud variation is keyed off absolute time rather than the island-day phase, so
 * that a passage index is a plain function of UTC, the property that makes two
 * players see the same cloud. Ten-second resolution is ample: a passage lasts
 * minutes.
 */
export function useIslandClockNowMs(): number {
  return useSyncExternalStore(subscribe, getNowMs, getNowMs);
}

/**
 * The three cloud passages in flight right now: which silhouette each actor is
 * carrying, at what size, and where it sits.
 *
 * Recomputed on the shared tick, not per frame. The values only actually change
 * when an actor's passage index advances, which happens while it is offscreen.
 */
export function useIslandCloudPassages(worldWidthPx: number) {
  const nowMs = useIslandClockNowMs();
  return useMemo(
    () =>
      ISLAND_CLOUD_ACTORS.map((actor) => ({
        actor,
        travel: islandCloudTravel(actor, worldWidthPx),
        passage: islandCloudPassageAt(actor, worldWidthPx, nowMs),
      })),
    [worldWidthPx, nowMs],
  );
}

/**
 * The sky state to render: the automatic clock in production, or the DEV
 * harness's held position when one is active.
 *
 * Returns the shared snapshot object unchanged whenever no override is in play,
 * so consumers that memoise on it do not see a new identity every tick.
 */
export function useIslandSkyState(): IslandSkyState {
  const auto = useIslandClockState();
  const dev = useIslandSkyDev();

  return useMemo(() => {
    const progress = resolveIslandDayProgress(auto.dayProgress, dev);
    return progress === auto.dayProgress ? auto : computeIslandSkyState(progress);
  }, [auto, dev]);
}

/**
 * How long CSS should take to travel between two sky states.
 *
 * Matching the tick makes the interpolation linear in time and invisible. While
 * the DEV harness holds a fixed position the value is being *dragged*, so a
 * ten-second ease would make the slider feel broken; it drops to something
 * responsive instead.
 */
export function useIslandSkyTransitionMs(): number {
  const dev = useIslandSkyDev();
  return dev.mode === 'auto' ? ISLAND_TICK_MS : 200;
}

/**
 * The `filter` / `transition` pair to apply to a location's background artwork.
 *
 * `filter` is `undefined` for locations that are not part of the day/night system,
 * which leaves their artwork byte-for-byte as it renders today, an unsupported
 * scene cannot be changed by this feature, not even subtly.
 *
 * `extraFilter` is prepended for the letterbox copy, which must keep its blur.
 */
export function useIslandArtworkGrade(
  location: LocationId,
  extraFilter?: string,
): { filter: string | undefined; transition: string | undefined } {
  const sky = useIslandSkyState();
  const transitionMs = useIslandSkyTransitionMs();
  const config = getLocationSkyConfig(location);

  if (!config.enabled) return { filter: undefined, transition: undefined };

  return {
    filter: islandArtworkFilter(sky, config.worldLightStrength, extraFilter),
    transition: `filter ${transitionMs}ms linear`,
  };
}
