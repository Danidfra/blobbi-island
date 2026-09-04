/**
 * Playback timing: where should this player be, right now?
 *
 * The protocol never streams the current position. A canonical state is a
 * *sample*, "at host-time T the playhead was at P, advancing at rate R", and
 * every client extrapolates from it (§8.1). That is what makes a session
 * recoverable from a single stored event and what keeps the event rate at one
 * publish per user action rather than one per second.
 */

import {
  CLOCK_OFFSET_CLAMP_MS,
  CLOCK_SAMPLE_WINDOW,
  DRIFT_HARD_SEEK_S,
  DRIFT_IGNORE_S,
  MAX_POSITION_S,
} from './constants';
import type { SharedPlaybackSessionContent } from './types';

export type PlaybackAnchor = SharedPlaybackSessionContent['playback'];

/** Clamp a position into a media's valid range. Unknown duration is unbounded. */
export function clampToDuration(position: number, duration: number): number {
  if (!Number.isFinite(position)) return 0;
  const lower = Math.max(0, position);
  if (!Number.isFinite(duration) || duration <= 0) return lower;
  return Math.min(lower, duration);
}

/**
 * Where the playhead should be on THIS client at `nowMs`.
 *
 * ```
 * paused:   position
 * playing:  position + (elapsed / 1000) × rate,  elapsed = now − offset − updatedAt
 * ```
 *
 * `elapsed` is clamped to `[0, 24 h]` before use: a client whose clock is wildly
 * wrong, or an event resurrected from a relay's cellar, must not be able to
 * produce a negative or astronomical seek target.
 */
export function expectedPosition(
  playback: PlaybackAnchor,
  nowMs: number,
  clockOffsetMs = 0,
  duration = 0,
): number {
  if (playback.state === 'paused') return clampToDuration(playback.position, duration);

  const rawElapsedMs = nowMs - clockOffsetMs - playback.updatedAt;
  const elapsedMs = Math.min(Math.max(rawElapsedMs, 0), MAX_POSITION_S * 1000);
  const advanced = playback.position + (elapsedMs / 1000) * playback.rate;
  return clampToDuration(advanced, duration);
}

/**
 * A canonical `playing` state that has run past the end is *ended*, not a seek
 * target: chasing it produces a seek/buffer loop at the final frame (§8.4).
 */
export function hasReachedEnd(expected: number, duration: number): boolean {
  return duration > 0 && expected >= duration - 0.25;
}

// ── Clock offset (§8.2) ────────────────────────────────────────────────────

/**
 * Add one passive sample: `receivedAtLocalMs − updatedAt`.
 *
 * That difference is `clockSkew + oneWayLatency`. There is no round trip and no
 * extra event: every accepted event from the host, including the 20 s keepalive,
 * is a free sample, which is precisely why the keepalive exists during long
 * pauses.
 */
export function pushClockSample(samples: readonly number[], sample: number): number[] {
  const next = [...samples, sample];
  return next.length > CLOCK_SAMPLE_WINDOW ? next.slice(next.length - CLOCK_SAMPLE_WINDOW) : next;
}

/**
 * Median of the recent samples, clamped to ±5 min.
 *
 * The median (not the mean) because a single relay hiccup would otherwise drag
 * the estimate for eight samples. It over-estimates true skew by roughly the
 * median one-way latency, typically well under 200 ms, an order of magnitude
 * below the 750 ms ignore threshold, which is why v1 needs no ping/pong.
 */
export function estimateClockOffset(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return Math.min(CLOCK_OFFSET_CLAMP_MS, Math.max(-CLOCK_OFFSET_CLAMP_MS, median));
}

// ── Drift (§8.3) ───────────────────────────────────────────────────────────

export type DriftAction = 'ignore' | 'wait' | 'seek';

/**
 * What to do about a measured drift, in seconds.
 *
 * The middle band is the important one: a client that seeks on every 1-second
 * disagreement spends its life seeking, and each seek causes a buffer which
 * causes more drift. Waiting one tick lets normal jitter resolve itself.
 */
export function driftAction(drift: number): DriftAction {
  const magnitude = Math.abs(drift);
  if (!Number.isFinite(magnitude) || magnitude < DRIFT_IGNORE_S) return 'ignore';
  if (magnitude <= DRIFT_HARD_SEEK_S) return 'wait';
  return 'seek';
}
