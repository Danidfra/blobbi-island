import { useCallback, useEffect, useRef } from 'react';
import type { Position } from '@/lib/types';
import type { MovableBlobbiRef } from '@/components/blobbi/MovableBlobbi';
import { DOCK_EVENTS, type PresenceMoveDetail } from '@/components/shell/dock-events';
import {
  worldDistancePx,
  ARRIVAL_THRESHOLD_PX,
  ARRIVAL_THRESHOLD_TOUCH_PX,
  WORLD_PX_PER_PERCENT_Y,
} from '@/lib/blobbi-ground';

/**
 * Tunable distance (in ISOTROPIC world-design pixels, 1046×697) within which
 * the local Blobbi's GROUND point is considered "close enough" to a pending
 * interaction target to trigger it. Shared with the rest of the arrival model
 * (see blobbi-ground.ts) so the same physical distance behaves identically on
 * both axes and never depends on the viewport. The default sits below the
 * theater seat half-pitch (48 px), so clicking an adjacent seat walks instead
 * of teleport-snapping.
 *
 * Touch devices get a more forgiving threshold so a tap reliably resolves even
 * if the walk path is constrained by boundaries/blockers.
 */
export const PENDING_INTERACTION_THRESHOLD = ARRIVAL_THRESHOLD_PX;
export const PENDING_INTERACTION_THRESHOLD_TOUCH = ARRIVAL_THRESHOLD_TOUCH_PX;

interface PendingInteraction {
  /**
   * Unique token for this pending interaction. Every rAF/proximity/stall
   * callback captures the token it was created for and only fires/clears if it
   * still matches the active token. cancel() and a replacing requestInteraction()
   * both bump the active token, so a stale (cancelled/replaced) interaction can
   * never fire later.
   */
  token: number;
  /** Target floor point (world percent) the Blobbi should reach. */
  target: Position;
  /** Action to fire once the Blobbi is close enough. */
  action: () => void;
  /** Resolved proximity threshold for this request. */
  threshold: number;
  /** Optional callback when this pending interaction is cancelled. */
  onCancel?: () => void;
  /** Last sampled Blobbi position (for stall detection). */
  lastPos?: Position;
  /** Consecutive frames the Blobbi has been effectively stationary. */
  stallFrames: number;
}

export interface RequestInteractionOptions {
  target: Position;
  action: () => void;
  /** Override the proximity threshold (world-design pixels). */
  threshold?: number;
  /** Treat as a touch interaction (more forgiving threshold). */
  touch?: boolean;
  /** Called if the interaction is cancelled before it fires. */
  onCancel?: () => void;
}

export interface PendingInteractionApi {
  /**
   * Request a walk-to-interact: move the local Blobbi toward `target` using the
   * existing movement system and fire `action` once it is within threshold.
   * Replacing an existing pending interaction cancels the previous one.
   */
  requestInteraction: (opts: RequestInteractionOptions) => void;
  /** Cancel any pending interaction without firing it. */
  cancel: () => void;
  /** Whether an interaction is currently pending (ref read, no re-render). */
  hasPending: () => boolean;
}

interface UsePendingInteractionArgs {
  blobbiRef: React.RefObject<MovableBlobbiRef>;
  /**
   * A string key that changes whenever a pending interaction must be cancelled
   * (e.g. `${currentLocation}:${selectedBlobbiId}`). When it changes, any
   * pending interaction is cancelled.
   */
  cancelKey?: string;
}

/** Isotropic world-design-px distance between two world-percent points. */
const distance = worldDistancePx;

/**
 * How many consecutive near-stationary frames count as "movement settled".
 * If the Blobbi can't get any closer (a boundary/blocker stops it short of the
 * threshold) we still fire the action so doors/items never feel dead. A
 * slightly larger settle-distance keeps this from firing mid-walk.
 */
const STALL_FRAMES = 12;
/** Near-stationary per-frame movement, in world-design px (was 0.15 percent-y). */
const STALL_EPSILON = 0.15 * WORLD_PX_PER_PERCENT_Y;

/**
 * Stall-firing only counts if the Blobbi settled within this multiple of the
 * proximity threshold of the target. If it stalls far away, it was redirected
 * elsewhere (e.g. the user tapped a different ground point), so we must NOT fire
 * the stale action, defense in depth alongside the world-surface cancel.
 */
const STALL_MAX_DISTANCE_FACTOR = 1.6;

/**
 * usePendingInteraction: a small, reusable "request interaction → walk toward
 * target → trigger when close" model for Blobbi Island gameplay.
 *
 * It reuses the existing movement system: `requestInteraction` calls
 * `blobbiRef.goTo(target)` and then polls `blobbiRef.getCurrentPosition()` on a
 * single rAF loop, firing the action once the Blobbi is within threshold. There
 * are no scattered timers; exactly one pending interaction + one rAF exist at a
 * time.
 *
 * Pending interactions are cancelled when:
 *   - a new interaction is requested (replaces the old one);
 *   - the user clicks/taps a different world point (a world-surface pointerdown
 *     that is not on an interactive target);
 *   - the `cancelKey` changes (location / selected Blobbi);
 *   - the component unmounts.
 */
export function usePendingInteraction({
  blobbiRef,
  cancelKey,
}: UsePendingInteractionArgs): PendingInteractionApi {
  const pendingRef = useRef<PendingInteraction | null>(null);
  const rafRef = useRef<number | null>(null);
  // Monotonic token identifying the *currently active* pending interaction.
  // Bumped on every cancel() and on every new requestInteraction(), which
  // invalidates any in-flight rAF/stall callback that captured an older token.
  const activeTokenRef = useRef(0);

  const stopWatcher = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    const pending = pendingRef.current;
    // Invalidate any in-flight callbacks immediately, then clear state.
    activeTokenRef.current += 1;
    pendingRef.current = null;
    stopWatcher();
    pending?.onCancel?.();
  }, [stopWatcher]);

  const tick = useCallback(
    (token: number) => {
      // Bail if this rAF belongs to a cancelled/replaced interaction.
      const pending = pendingRef.current;
      if (!pending || pending.token !== token || token !== activeTokenRef.current) {
        return;
      }

      const current = blobbiRef.current?.getCurrentPosition?.();
      if (current) {
        if (distance(current, pending.target) <= pending.threshold) {
          // Reached: fire once and clear (without invoking onCancel).
          activeTokenRef.current += 1;
          pendingRef.current = null;
          rafRef.current = null;
          pending.action();
          return;
        }

        // Stall detection: if the Blobbi can't get any closer (blocked short of
        // the target by a boundary/blocker), fire anyway so the item isn't dead,
        // but only if it settled reasonably near the target. If it stalled far
        // away it was redirected elsewhere, so cancel instead of firing.
        if (pending.lastPos && distance(current, pending.lastPos) < STALL_EPSILON) {
          pending.stallFrames += 1;
          if (pending.stallFrames >= STALL_FRAMES) {
            const settledNear =
              distance(current, pending.target) <=
              pending.threshold * STALL_MAX_DISTANCE_FACTOR;
            activeTokenRef.current += 1;
            pendingRef.current = null;
            rafRef.current = null;
            if (settledNear) {
              pending.action();
            } else {
              pending.onCancel?.();
            }
            return;
          }
        } else {
          pending.stallFrames = 0;
        }
        pending.lastPos = current;
      }

      rafRef.current = requestAnimationFrame(() => tick(token));
    },
    [blobbiRef],
  );

  const requestInteraction = useCallback(
    ({ target, action, threshold, touch, onCancel }: RequestInteractionOptions) => {
      // Replace any existing pending interaction: invalidate + cancel it first
      // so its in-flight callbacks can never fire.
      const previous = pendingRef.current;
      activeTokenRef.current += 1;
      pendingRef.current = null;
      stopWatcher();
      previous?.onCancel?.();

      const token = activeTokenRef.current;

      const resolvedThreshold =
        threshold ??
        (touch ? PENDING_INTERACTION_THRESHOLD_TOUCH : PENDING_INTERACTION_THRESHOLD);

      pendingRef.current = {
        token,
        target,
        action,
        threshold: resolvedThreshold,
        onCancel,
        stallFrames: 0,
      };

      // Reuse the existing movement system to walk toward the target.
      blobbiRef.current?.goTo(target);

      // Broadcast the walk target to multiplayer presence so REMOTE clients see
      // this Blobbi walk to the target (e.g. to a door) before any location
      // change removes it, instead of vanishing instantly. Only broadcast for
      // real walks (target meaningfully far from the current position); an
      // underfoot interaction needs no remote movement.
      const here = blobbiRef.current?.getCurrentPosition?.();
      if (!here || distance(here, target) > resolvedThreshold) {
        if (typeof document !== 'undefined') {
          document.dispatchEvent(
            new CustomEvent<PresenceMoveDetail>(DOCK_EVENTS.presenceMove, {
              detail: { target: { x: target.x, y: target.y } },
            }),
          );
        }
      }

      // If already close enough (e.g. interacting with something underfoot),
      // fire immediately rather than waiting a frame.
      const current = blobbiRef.current?.getCurrentPosition?.();
      if (current && distance(current, target) <= resolvedThreshold) {
        activeTokenRef.current += 1;
        pendingRef.current = null;
        action();
        return;
      }

      rafRef.current = requestAnimationFrame(() => tick(token));
    },
    [blobbiRef, stopWatcher, tick],
  );

  const hasPending = useCallback(() => pendingRef.current !== null, []);

  // Cancel when the cancelKey changes (location / selected Blobbi) and on
  // unmount. cancelKey is excluded from the dep purpose of `cancel` itself; we
  // want the effect to re-run whenever the key changes.
  useEffect(() => {
    return () => cancel();
  }, [cancelKey, cancel]);

  return { requestInteraction, cancel, hasPending };
}

