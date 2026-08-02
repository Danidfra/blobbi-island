/**
 * Beach Treasure Hunt — dig resolution, as one pure function.
 *
 * ## The rules
 *
 * 1. A dig at a non-finite point is **rejected** (`invalid-position`); a dig
 *    outside the field is **rejected** (`out-of-field`). Neither consumes a
 *    shovel use — the model refuses bad input, it never silently clamps a dig
 *    to somewhere the player did not aim.
 * 2. With no shovel uses remaining the dig is **rejected**
 *    (`no-shovel-uses`) and consumes nothing. (The reducer normally ends the
 *    round before this can happen; the guard makes the function safe
 *    standalone.)
 * 3. A valid attempt consumes **exactly one** use, hit or miss.
 * 4. Eligible targets are the unresolved ones whose distance to the dig point
 *    is within their own `digRadius`. Only the **closest** eligible target is
 *    revealed — never more than one, however tightly targets overlap.
 * 5. Distance ties resolve to the earlier target in array order, which is
 *    placement order and therefore deterministic per seed.
 * 6. A found target is never eligible again, so nothing can be dug up twice.
 *
 * Check order is: position validity → shovel budget → eligibility. A dig that
 * is both invalid and out of budget reports `invalid-position`, because bad
 * input is the caller's bug and should be surfaced first.
 */

import type { DigResolution, Point, TreasureTarget } from './types';
import type { TreasureHuntPolicy } from './policy';
import { distanceBetween, isFinitePoint, isWithinField } from './geometry';

export function resolveDig(
  position: Point,
  targets: readonly TreasureTarget[],
  shovelUsesRemaining: number,
  policy: TreasureHuntPolicy
): DigResolution {
  if (!isFinitePoint(position)) {
    return { type: 'rejected', reason: 'invalid-position', shovelUsesConsumed: 0 };
  }
  if (!isWithinField(position, policy.fieldWidth, policy.fieldHeight)) {
    return { type: 'rejected', reason: 'out-of-field', shovelUsesConsumed: 0 };
  }
  if (shovelUsesRemaining <= 0) {
    return { type: 'rejected', reason: 'no-shovel-uses', shovelUsesConsumed: 0 };
  }

  let closest: TreasureTarget | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    if (target.found) continue;
    const distance = distanceBetween(position, target.position);
    if (distance > target.digRadius) continue;
    // Strict `<` keeps the earlier (placement-order) target on an exact tie.
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = target;
    }
  }

  if (closest === null) {
    return { type: 'miss', shovelUsesConsumed: 1 };
  }
  return { type: 'hit', targetId: closest.id, shovelUsesConsumed: 1 };
}
