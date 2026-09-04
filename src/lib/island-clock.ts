/**
 * The Blobbi Island clock; one accelerated day, shared by every player.
 *
 * ## Why not the real time of day
 *
 * The island is a multiplayer world, so two Blobbonauts standing on the same
 * plaza have to see the same sky. A per-device clock would put one of them at
 * dusk and the other at noon, which is worse than having no sky at all. But a
 * real 24-hour cycle is no better in the other direction: a player who logs in
 * after school every day would only ever see one lighting state and would never
 * learn the island has a night.
 *
 * So the island runs an **accelerated day derived from UTC**: two real hours per
 * island day, measured as an offset from a fixed epoch. Every client computes the
 * same number from `Date.now()` alone; no backend, no Nostr events, no relay
 * round-trip, nothing persisted. Refreshing the page cannot restart the cycle
 * because there is no state to restart; the phase is a pure function of the
 * instant you ask.
 *
 * Timezones never enter the calculation. `Date.now()` is already UTC-based
 * (milliseconds since the Unix epoch), and `Date.UTC` pins the island epoch
 * without consulting the host's zone. A device whose clock is wrong will be out
 * of step by exactly that error, which is accepted for this phase.
 */

/** One island day: two real hours. */
export const ISLAND_DAY_MS = 2 * 60 * 60 * 1000;

/**
 * Island day 0 begins at 1 January 2026, 00:00 UTC.
 *
 * Fixed forever. Moving it would rotate the sky for every player at once, and
 * because nothing is persisted there would be no migration, just a jump.
 */
export const ISLAND_EPOCH_MS = Date.UTC(2026, 0, 1);

/** One island day expressed in island minutes, for readable phase tables. */
export const ISLAND_DAY_MINUTES = ISLAND_DAY_MS / 60_000;

/**
 * How often the visual state is recomputed.
 *
 * The sky does not need animation-frame resolution: nothing about it moves
 * faster than a sunrise. Ten seconds is 720 updates per island day, and the
 * visual gap between two updates is bridged by CSS transitions of the same
 * duration, so what the player sees is continuous while React re-renders twice a
 * minute.
 */
export const ISLAND_TICK_MS = 10_000;

/** Clamp to the unit interval. `NaN` collapses to 0 rather than propagating. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Position within the current island day, in `[0, 1)`.
 *
 * The double modulo is not redundant: `%` in JavaScript keeps the sign of the
 * dividend, so a timestamp *before* the epoch yields a negative remainder.
 * Adding one period and taking the modulo again folds it back into range, which
 * is what makes pre-epoch instants (and a badly-set device clock) return a real
 * phase instead of a negative one.
 */
export function islandDayProgressAt(nowMs: number): number {
  if (!Number.isFinite(nowMs)) return 0;
  const elapsed = nowMs - ISLAND_EPOCH_MS;
  const wrapped = ((elapsed % ISLAND_DAY_MS) + ISLAND_DAY_MS) % ISLAND_DAY_MS;
  return wrapped / ISLAND_DAY_MS;
}

/**
 * Which island day it is. Negative before the epoch, and it is `floor`, not
 * truncation, so the day number decreases monotonically going backwards in time
 * and stays consistent with {@link islandDayProgressAt}'s wrapping.
 */
export function islandDayNumberAt(nowMs: number): number {
  if (!Number.isFinite(nowMs)) return 0;
  return Math.floor((nowMs - ISLAND_EPOCH_MS) / ISLAND_DAY_MS);
}

/** Position within the current island day, in island minutes `[0, 120)`. */
export function islandMinuteAt(nowMs: number): number {
  return islandDayProgressAt(nowMs) * ISLAND_DAY_MINUTES;
}

/**
 * Milliseconds until the next tick boundary.
 *
 * Ticks are aligned to absolute multiples of {@link ISLAND_TICK_MS} since the
 * Unix epoch rather than to whenever a given tab happened to mount. Two clients
 * therefore step at the same instants instead of drifting up to a full tick
 * apart, which matters because the point of the whole module is that players
 * standing together see the same thing.
 *
 * Always returns at least 1 ms, so a caller that schedules on the result cannot
 * be trapped in a zero-delay loop when it is called exactly on a boundary.
 */
export function msUntilNextIslandTick(nowMs: number): number {
  if (!Number.isFinite(nowMs)) return ISLAND_TICK_MS;
  const sinceBoundary = ((nowMs % ISLAND_TICK_MS) + ISLAND_TICK_MS) % ISLAND_TICK_MS;
  return ISLAND_TICK_MS - sinceBoundary || ISLAND_TICK_MS;
}
