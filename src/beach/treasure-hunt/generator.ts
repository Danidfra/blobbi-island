/**
 * Beach Treasure Hunt — seeded target generation.
 *
 * `generateTreasureTargets(seed, policy)` builds the round's buried field
 * deterministically: same seed + same policy → the identical targets, ids,
 * kinds and positions. Every draw comes from the threaded mulberry32 state;
 * there is no `Math.random()` anywhere in this directory.
 *
 * ## The two failure modes, and why they differ
 *
 * - An **invalid policy** (unsatisfiable composition, negative radius…) is a
 *   configuration bug and throws, via {@link validateTreasureHuntPolicy}.
 * - A **placement that cannot satisfy the constraints for this seed** (a
 *   valid-looking but overly tight separation, say) is a runtime possibility
 *   and returns a typed `{ ok: false }` failure after the explicit attempt
 *   budget. The generator never quietly drops targets to "make it fit" — a
 *   round either has exactly `policy.targetCount` targets or it does not
 *   exist.
 *
 * ## Placement constraints enforced
 *
 * 1. inside the field, at least `edgePadding` from every edge;
 * 2. at least `minTargetSeparation` from every already-placed target;
 * 3. at least `initialCoilExclusionRadius` from the initial coil position
 *    (nothing sits directly under the detector at round start);
 * 4. per-category composition drawn from {@link validCompositions};
 * 5. category order seeded-shuffled, so `target-1` is not always litter.
 */

import type { TreasureTarget, TreasureTargetCategory, Point } from './types';
import {
  validateTreasureHuntPolicy,
  validCompositions,
  TREASURE_TARGET_CATEGORIES,
  type TreasureHuntPolicy,
} from './policy';
import { nextRandom, seededShuffle } from './random';
import { distanceBetween } from './geometry';

export interface TargetGenerationFailure {
  readonly code: 'placement-exhausted';
  /** How many targets had been placed before the budget ran out. */
  readonly placedCount: number;
  /** The per-target attempt budget that was exhausted. */
  readonly attempts: number;
}

export type TargetGenerationResult =
  | {
      readonly ok: true;
      readonly targets: readonly TreasureTarget[];
      /** The advanced PRNG state, for callers that draw further from the same seed. */
      readonly rngState: number;
    }
  | { readonly ok: false; readonly failure: TargetGenerationFailure };

/** `seed` is the uint32 from `treasureSeedFrom(stringSeed)`. */
export function generateTreasureTargets(
  seed: number,
  policy: TreasureHuntPolicy
): TargetGenerationResult {
  validateTreasureHuntPolicy(policy);

  let state = seed >>> 0;

  // Composition: one deterministic draw over the fixed-order combination list.
  const compositions = validCompositions(policy);
  const compositionDraw = nextRandom(state);
  state = compositionDraw.state;
  const composition = compositions[Math.floor(compositionDraw.value * compositions.length)];

  // Category order: seeded shuffle so index never correlates with category.
  const categoryOrder: TreasureTargetCategory[] = [];
  for (let i = 0; i < composition.litter; i += 1) categoryOrder.push('litter');
  for (let i = 0; i < composition.valuable; i += 1) categoryOrder.push('valuable');
  for (let i = 0; i < composition.special; i += 1) categoryOrder.push('special');
  const shuffled = seededShuffle(categoryOrder, state);
  state = shuffled.state;

  const placeableWidth = policy.fieldWidth - 2 * policy.edgePadding;
  const placeableHeight = policy.fieldHeight - 2 * policy.edgePadding;
  const targets: TreasureTarget[] = [];

  for (let index = 0; index < shuffled.items.length; index += 1) {
    const category = shuffled.items[index];
    const categoryPolicy = policy.categories[category];

    const kindDraw = nextRandom(state);
    state = kindDraw.state;
    const kindSpec =
      categoryPolicy.kinds[Math.floor(kindDraw.value * categoryPolicy.kinds.length)];

    let placed: Point | null = null;
    for (let attempt = 0; attempt < policy.maxPlacementAttempts; attempt += 1) {
      const drawX = nextRandom(state);
      state = drawX.state;
      const drawY = nextRandom(state);
      state = drawY.state;
      const candidate: Point = {
        x: policy.edgePadding + drawX.value * placeableWidth,
        y: policy.edgePadding + drawY.value * placeableHeight,
      };
      if (
        distanceBetween(candidate, policy.initialCoilPosition) <
        policy.initialCoilExclusionRadius
      ) {
        continue;
      }
      if (
        targets.some(
          (existing) =>
            distanceBetween(candidate, existing.position) < policy.minTargetSeparation
        )
      ) {
        continue;
      }
      placed = candidate;
      break;
    }

    if (placed === null) {
      return {
        ok: false,
        failure: {
          code: 'placement-exhausted',
          placedCount: targets.length,
          attempts: policy.maxPlacementAttempts,
        },
      };
    }

    targets.push(
      Object.freeze({
        id: `target-${index + 1}`,
        category,
        kind: kindSpec.kind,
        position: Object.freeze(placed),
        detectionRadius: categoryPolicy.detectionRadius,
        digRadius: categoryPolicy.digRadius,
        signalWeight: categoryPolicy.signalWeight,
        rawValue: kindSpec.rawValue,
        found: false,
      })
    );
  }

  return { ok: true, targets: Object.freeze(targets), rngState: state };
}

/**
 * Independent layout check: every constraint the generator promises, verified
 * from the outside. Returns human-readable violations (empty array = valid),
 * so tests and dev tooling can audit a round without trusting the generator.
 */
export function validateTargetLayout(
  targets: readonly TreasureTarget[],
  policy: TreasureHuntPolicy
): readonly string[] {
  const violations: string[] = [];

  if (targets.length !== policy.targetCount) {
    violations.push(
      `target count ${targets.length} does not match policy targetCount ${policy.targetCount}`
    );
  }

  const ids = new Set<string>();
  for (const target of targets) {
    if (ids.has(target.id)) violations.push(`duplicate target id "${target.id}"`);
    ids.add(target.id);

    const { x, y } = target.position;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      violations.push(`target "${target.id}" has a non-finite position`);
      continue;
    }
    if (
      x < policy.edgePadding ||
      x > policy.fieldWidth - policy.edgePadding ||
      y < policy.edgePadding ||
      y > policy.fieldHeight - policy.edgePadding
    ) {
      violations.push(`target "${target.id}" violates the edge padding`);
    }
    if (
      distanceBetween(target.position, policy.initialCoilPosition) <
      policy.initialCoilExclusionRadius
    ) {
      violations.push(`target "${target.id}" is inside the initial coil exclusion zone`);
    }
  }

  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      if (
        distanceBetween(targets[i].position, targets[j].position) <
        policy.minTargetSeparation
      ) {
        violations.push(
          `targets "${targets[i].id}" and "${targets[j].id}" violate the minimum separation`
        );
      }
    }
  }

  const counts: Record<TreasureTargetCategory, number> = {
    litter: 0,
    valuable: 0,
    special: 0,
  };
  for (const target of targets) counts[target.category] += 1;
  for (const category of TREASURE_TARGET_CATEGORIES) {
    const bounds = policy.categories[category];
    if (counts[category] < bounds.minCount || counts[category] > bounds.maxCount) {
      violations.push(
        `category "${category}" count ${counts[category]} is outside ` +
          `${bounds.minCount}..${bounds.maxCount}`
      );
    }
  }

  return violations;
}
