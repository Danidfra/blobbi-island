/**
 * Beach Treasure Hunt, the detector signal, as pure math.
 *
 * The signal is everything the UI and audio layer are allowed to know about
 * the buried field: an intensity, the distance to the nearest in-range
 * unresolved target, and how many targets are contributing. Coordinates are
 * never returned: the beep IS the information, exactly like a real detector.
 *
 * ## The response curve
 *
 * For one unresolved target at distance `d` with detection radius `R`,
 * saturation distance `S` (policy) and weight `w`:
 *
 * ```
 *   d >= R          → 0                        (silent outside the field)
 *   d <= S          → w                        (saturated on top of the target)
 *   S <  d <  R     → w · ((R − d)/(R − S))^k  (smooth rise, exponent k)
 * ```
 *
 * `k = signalCurveExponent > 1` makes the last stretch toward the target
 * steeper than the first, the "getting warmer" feel.
 *
 * ## Overlap rule: strongest wins
 *
 * Where detection fields overlap, the reported intensity is the **maximum**
 * of the individual signals, not the sum. Summing would let two mediocre
 * far targets impersonate one close target and would break the player's
 * mental model ("stronger = closer"); the maximum keeps intensity monotonic
 * in distance-to-nearest. `activeTargetCount` still reports how many targets
 * contribute, so a later UI could hint at a crowded spot without corrupting
 * the core signal.
 *
 * There is deliberately **no random noise** here: the pure value is exact so
 * tests can pin it, and any audio/visual wobble is presentation the
 * controller may layer on top later.
 */

import type { DetectorSignal, Point, TreasureTarget } from './types';
import type { TreasureHuntPolicy } from './policy';
import { distanceBetween, isFinitePoint } from './geometry';

/**
 * The per-target curve above, exposed for tests and for audio mapping later.
 * Returns `0..weight`.
 */
export function signalStrengthForDistance(
  distance: number,
  detectionRadius: number,
  signalWeight: number,
  policy: TreasureHuntPolicy
): number {
  if (distance >= detectionRadius) return 0;
  if (distance <= policy.signalSaturationDistance) return signalWeight;
  const normalized =
    (detectionRadius - distance) / (detectionRadius - policy.signalSaturationDistance);
  return signalWeight * Math.pow(normalized, policy.signalCurveExponent);
}

/**
 * Evaluate the detector at a coil position against the unresolved targets.
 *
 * Found targets are ignored entirely. A non-finite coil position throws, the
 * reducer rejects such moves before they get here, so reaching this error
 * means a caller bypassed the state machine.
 */
export function evaluateDetectorSignal(
  coilPosition: Point,
  targets: readonly TreasureTarget[],
  policy: TreasureHuntPolicy
): DetectorSignal {
  if (!isFinitePoint(coilPosition)) {
    throw new Error('evaluateDetectorSignal: coil position must be a finite point');
  }

  let intensity = 0;
  let nearestTargetId: string | null = null;
  let nearestDistance: number | null = null;
  let activeTargetCount = 0;

  for (const target of targets) {
    if (target.found) continue;
    const distance = distanceBetween(coilPosition, target.position);
    const strength = signalStrengthForDistance(
      distance,
      target.detectionRadius,
      target.signalWeight,
      policy
    );
    if (strength <= 0) continue;

    activeTargetCount += 1;
    if (strength > intensity) intensity = strength;
    // Nearest in-range unresolved target; ties resolve to the earlier target
    // in array order (stable, deterministic).
    if (nearestDistance === null || distance < nearestDistance) {
      nearestDistance = distance;
      nearestTargetId = target.id;
    }
  }

  return {
    intensity: Math.min(1, intensity),
    nearestTargetId,
    nearestDistance,
    activeTargetCount,
  };
}
