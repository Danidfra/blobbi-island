import type { Position } from '@/lib/types';

/**
 * Minimal shape needed to decide whether a Blobbi is an eligible gaze target.
 *
 * "Active" currently means *moving*, but this is intentionally an object (not a
 * bare boolean) so additional activity sources — emotes, animations, actions —
 * can be added later without touching every call site. Extend this interface
 * and {@link activityPriority} together when new activity kinds are introduced;
 * the attention resolver picks them up everywhere automatically.
 */
export interface BlobbiActivity {
  isMoving: boolean;
  // Future activity flags (uncomment / add as features land):
  // isEmoting?: boolean;
  // isAnimating?: boolean;
  // isActing?: boolean;
}

/**
 * Single source of truth for "is this Blobbi doing something worth looking at".
 *
 * A nearby Blobbi should only be a gaze target while it is active. Today that
 * is purely `isMoving`; future activity flags should be OR'd in here so the
 * gaze rules pick them up everywhere automatically. This is what prevents a
 * Blobbi from staring forever at a neighbour that is just standing still.
 */
export function isBlobbiActive(activity: BlobbiActivity): boolean {
  return activityPriority(activity) > 0;
}

/**
 * Maps an activity to a numeric "interestingness" priority. This is the single
 * extension point for the whole attention system: when a new activity kind is
 * added (emote, animation, interaction, action), give it a number here and the
 * resolver below will automatically prefer it over lower-priority activity.
 *
 *   0 = not active (nothing worth looking at)
 *   higher = more attention-grabbing, wins over lower priorities
 *
 * Movement is the lowest positive priority — anything intentional (an emote,
 * an interaction) should outrank a Blobbi simply walking past.
 */
export function activityPriority(activity: BlobbiActivity): number {
  // Future activity kinds plug in here (higher = more interesting):
  // if (activity.isInteracting) return 40;
  // if (activity.isActing)      return 30;
  // if (activity.isEmoting)     return 20;
  // if (activity.isAnimating)   return 10;
  if (activity.isMoving) return 5;
  return 0;
}

// ---------------------------------------------------------------------------
// Attention resolver — the single source of truth for "what is this Blobbi
// looking at?". Pure and deterministic (output depends only on inputs + the
// supplied `now`), so it scales to many Blobbis and is trivial to reason about.
// ---------------------------------------------------------------------------

/** How long (ms) to keep looking at a target after it stops being active. */
export const ATTENTION_HOLD_MS = 1500;

/**
 * Reserved key under which the local Blobbi's position/attention is stored in
 * the shared maps. Real candidate keys are `${pubkey}:${sessionId}` (which never
 * contain spaces), so this sentinel can't collide with a real Blobbi.
 */
export const LOCAL_GAZE_KEY = '__local__';

/** Any candidate the resolver can consider, including the Blobbi itself. */
export interface GazeCandidate {
  /** Stable identity. `null` is reserved for the local Blobbi. */
  key: string | null;
  position: Position;
  activity: BlobbiActivity;
}

/**
 * Remembered focus of attention for one Blobbi. Held in a ref (never React
 * state) and fed back into {@link resolveAttention} each tick so attention has
 * memory: it can track the *most recently active* interesting Blobbi and keep
 * looking briefly after that Blobbi goes quiet, instead of snapping to idle.
 */
export interface AttentionState {
  /** Identity of the Blobbi being watched, or null when attention is released. */
  targetKey: string | null;
  /** Last known position of the target (percent coords). */
  targetPosition: Position | null;
  /** Timestamp (ms) of the most recent moment the target was active. */
  lastActivityTime: number;
  /** Priority of the activity that earned the attention (see activityPriority). */
  priority: number;
}

/** Neutral "looking at nothing" attention state. */
export function emptyAttention(): AttentionState {
  return { targetKey: null, targetPosition: null, lastActivityTime: 0, priority: 0 };
}

/**
 * Decide what `self` should look at this tick.
 *
 * Selection rules (deterministic):
 *  1. Among active candidates in range, pick the highest {@link activityPriority}.
 *  2. Break ties by most-recent activity, then by nearest distance — so when a
 *     second Blobbi starts moving nearby, attention shifts to the newcomer
 *     rather than locking on the closest one forever.
 *  3. If nothing is active right now, KEEP the previous target (refreshing its
 *     position if we can still see it) until {@link ATTENTION_HOLD_MS} elapses
 *     since it was last active, then release to neutral. This is the natural
 *     "look briefly, then return to idle" behaviour.
 *
 * @param self        the Blobbi doing the looking
 * @param candidates  all candidates (may include `self`; it is skipped)
 * @param prev        this Blobbi's previous AttentionState
 * @param now         current time in ms (e.g. performance.now())
 * @param maxDistSq   squared range threshold (percent-units²)
 */
export function resolveAttention(
  self: GazeCandidate,
  candidates: readonly GazeCandidate[],
  prev: AttentionState,
  now: number,
  maxDistSq: number,
): AttentionState {
  let best: GazeCandidate | null = null;
  let bestPriority = 0;
  let bestDistSq = maxDistSq;

  for (const other of candidates) {
    if (other === self || other.key === self.key) continue;
    const priority = activityPriority(other.activity);
    if (priority <= 0) continue; // only active candidates are interesting

    const dx = other.position.x - self.position.x;
    const dy = other.position.y - self.position.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > maxDistSq) continue; // out of range

    // Prefer higher priority. Within the same priority, prefer the candidate
    // we're already watching (recency / stability), otherwise the nearest.
    const isCurrent = other.key !== null && other.key === prev.targetKey;
    const better =
      best === null ||
      priority > bestPriority ||
      (priority === bestPriority && isCurrent && best.key !== prev.targetKey) ||
      (priority === bestPriority && distSq < bestDistSq);

    if (better) {
      best = other;
      bestPriority = priority;
      bestDistSq = distSq;
    }
  }

  if (best) {
    return {
      targetKey: best.key,
      targetPosition: best.position,
      lastActivityTime: now,
      priority: bestPriority,
    };
  }

  // Nothing active right now: hold the previous target briefly, then release.
  if (prev.targetKey !== null && now - prev.lastActivityTime <= ATTENTION_HOLD_MS) {
    // Refresh the held target's last known position if it is still in range,
    // so a Blobbi that stopped (but is still visible) is tracked accurately.
    let heldPosition = prev.targetPosition;
    for (const other of candidates) {
      if (other.key === prev.targetKey) {
        heldPosition = other.position;
        break;
      }
    }
    return { ...prev, targetPosition: heldPosition };
  }

  return emptyAttention();
}

/**
 * Resolve the *live* gaze position for an attention state.
 *
 * {@link resolveAttention} only runs on a slow cadence (the attention
 * *decision* is intentionally throttled), so `state.targetPosition` is a stale
 * snapshot from the last decision. To make eye tracking feel alive while a
 * watched Blobbi keeps moving, callers should resolve the target's *current*
 * position at render time from a continuously-updated `livePositions` map
 * (keyed the same way as candidates / attention state).
 *
 * Falls back to the snapshot `targetPosition` when the target isn't present in
 * the live map — e.g. during the post-activity hold window if it left range —
 * so the gaze still points somewhere sensible until attention releases.
 *
 * The local Blobbi is represented by a `null` candidate key; pass `localKey` to
 * map that to its entry in `livePositions` so remotes can track the local
 * Blobbi live too (and the two paths use the exact same mechanism).
 *
 * @param state         the Blobbi's current AttentionState
 * @param livePositions key -> current position for every live candidate
 * @param localKey      the key under which the local Blobbi's live position is stored
 * @returns the position to look at, or null when attention is released
 */
export function attentionTargetPosition(
  state: AttentionState,
  livePositions: ReadonlyMap<string, Position>,
  localKey: string,
): Position | null {
  if (state.targetPosition === null && state.targetKey === null) return null;
  const key = state.targetKey === null ? localKey : state.targetKey;
  return livePositions.get(key) ?? state.targetPosition;
}

/**
 * Snapshot of the local player as a potential gaze target for remote Blobbis.
 * Written by MovableBlobbi every frame (via a ref to avoid re-renders) and read
 * by MultiplayerLayer's throttled gaze pass so remotes can notice and look at
 * the local Blobbi when it walks (or, later, emotes/acts) nearby.
 */
export interface LocalActiveState extends BlobbiActivity {
  position: Position;
}
