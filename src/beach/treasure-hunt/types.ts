/**
 * Beach Treasure Hunt — the pure domain types.
 *
 * Everything in `src/beach/treasure-hunt/` is a pure simulation in the same
 * sense as `src/arcade/hockey/`: no React, no DOM, no timers, no audio, no
 * Nostr, no storage. A round is reproducible from `(seed, policy, actions)`,
 * which is what lets the tests assert "a target cannot be dug up twice" by
 * calling functions rather than by watching a screen.
 *
 * ## Coordinate system
 *
 * Positions are normalized logical coordinates over a rectangular sand field:
 * `x` in `0..fieldWidth`, `y` in `0..fieldHeight` (both `1` by default, so
 * effectively `0..1`). The UI maps pointer events into this space later; the
 * model never sees a pixel, a `PointerEvent` or a `getBoundingClientRect`.
 *
 * ## What is deliberately NOT here
 *
 * - No presentation text, image URLs or React nodes — `kind` is a stable
 *   identifier (`'bottle-cap'`), and display names live with the UI.
 * - No official kind:31632 item addresses, no event ids, no Coin values.
 *   `rawValue` is an abstract reward unit; mapping units to anything real is
 *   a later, separate boundary (Beach 2).
 * - No executable behavior carried in data.
 */

/** A normalized logical position on the sand field. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export type TreasureTargetCategory = 'litter' | 'valuable' | 'special';

/**
 * One buried target. Pure data: enough to simulate detection and digging,
 * nothing that couples the model to presentation or to a real economy.
 */
export interface TreasureTarget {
  /** Stable within a seeded round: `target-1` … `target-N` in placement order. */
  readonly id: string;
  readonly category: TreasureTargetCategory;
  /** Stable content identifier, e.g. `'bottle-cap'`. Display names live in the UI. */
  readonly kind: string;
  readonly position: Point;
  /** The coil starts sensing this target strictly inside this distance. */
  readonly detectionRadius: number;
  /** A dig at most this far from the target can reveal it. */
  readonly digRadius: number;
  /** Scales the detector signal, `0..1`. Litter reads slightly weaker than treasure. */
  readonly signalWeight: number;
  /** Abstract reward units. NOT Coins — see the module doc. */
  readonly rawValue: number;
  readonly found: boolean;
}

/**
 * What the detector reports for a coil position.
 *
 * Deliberately lossy: it never contains a target's coordinates, only an
 * intensity and the distance to the nearest in-range unresolved target — the
 * same information a real detector's beep carries. The UI/audio layer renders
 * this; it never gets to peek at the field.
 */
export interface DetectorSignal {
  /** `0..1`. `0` when no unresolved target is within detection range. */
  readonly intensity: number;
  /** Nearest unresolved target currently in detection range, else `null`. */
  readonly nearestTargetId: string | null;
  readonly nearestDistance: number | null;
  /** How many unresolved targets are contributing a non-zero signal. */
  readonly activeTargetCount: number;
}

export type DigRejectionReason =
  /** The point was non-finite. Never silently clamped. */
  | 'invalid-position'
  /** The point was finite but outside the field. Never silently clamped. */
  | 'out-of-field'
  | 'no-shovel-uses';

/**
 * The outcome of one dig attempt. A rejected attempt consumes nothing — a
 * shovel use is only ever spent on a valid attempt, hit or miss.
 */
export type DigResolution =
  | { readonly type: 'hit'; readonly targetId: string; readonly shovelUsesConsumed: 1 }
  | { readonly type: 'miss'; readonly shovelUsesConsumed: 1 }
  | {
      readonly type: 'rejected';
      readonly reason: DigRejectionReason;
      readonly shovelUsesConsumed: 0;
    };

/** One entry of the round's dig history. Misses stay visible for the UI. */
export interface DigRecord {
  readonly position: Point;
  readonly outcome: 'hit' | 'miss';
  /** The revealed target on a hit, `null` on a miss. */
  readonly targetId: string | null;
}

export type TreasureHuntStatus = 'ready' | 'searching' | 'finished';

export type TreasureHuntEndReason =
  | 'time-expired'
  | 'no-shovel-uses'
  | 'all-targets-found'
  | 'ended-by-player';

/**
 * Semantic actions only — no browser event objects, no wall-clock timestamps.
 * Time is advanced explicitly by the caller as a delta in seconds.
 */
export type TreasureHuntAction =
  | { readonly type: 'start' }
  | { readonly type: 'move-detector'; readonly position: Point }
  | { readonly type: 'dig'; readonly position: Point }
  | { readonly type: 'advance-time'; readonly seconds: number }
  | { readonly type: 'end-round' };

/** One find in the final result: identity, kind and abstract units only. */
export interface TreasureFindResult {
  readonly targetId: string;
  readonly kind: string;
  readonly rawValue: number;
}

/**
 * The economy-neutral round result. Derived purely from a finished round.
 *
 * `rawCleanupValue` / `rawTreasureValue` are abstract units. They are not
 * Coins, and `specialCandidateFound` records candidacy only — nothing here
 * claims any reward was granted anywhere.
 */
export interface TreasureHuntResult {
  readonly roundId: string;
  readonly seed: string;
  readonly endReason: TreasureHuntEndReason;
  readonly durationSeconds: number;
  readonly shovelUsesSpent: number;
  readonly successfulDigs: number;
  readonly missedDigs: number;
  readonly litterFinds: readonly TreasureFindResult[];
  readonly valuableFinds: readonly TreasureFindResult[];
  readonly specialFinds: readonly TreasureFindResult[];
  /** Sum of litter `rawValue` — the "you helped clean the beach" units. */
  readonly rawCleanupValue: number;
  /** Sum of valuable `rawValue`. Excludes the special candidate. */
  readonly rawTreasureValue: number;
  /** Candidacy only. A durable grant is a Beach 2 concern, not this model's. */
  readonly specialCandidateFound: boolean;
}
