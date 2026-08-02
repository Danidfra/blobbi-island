/**
 * Beach Treasure Hunt — the one place every tunable number lives.
 *
 * Nothing in the model hardcodes a balance value; components later must read
 * this module too. The defaults below are the provisional V1 testing values
 * from `docs/beach-treasure-hunt-audit.md` §6.1 — 120 s, 9 targets, 5 digs —
 * and are expected to change during Beach 3 balancing, which is exactly why
 * they are all here and nowhere else.
 *
 * `validateTreasureHuntPolicy` rejects an invalid policy with a thrown,
 * programmer-facing error rather than silently clamping it: a policy is
 * authored configuration, so a bad one is a bug at the call site, not a
 * runtime condition to paper over. (Placement that merely *fails for a seed*
 * is different — that is a typed result from the generator, see
 * `generator.ts`.)
 */

import type { Point, TreasureTargetCategory } from './types';
import { isWithinField } from './geometry';

/** One find type: a stable identifier plus its abstract (non-Coin) unit value. */
export interface TargetKindSpec {
  readonly kind: string;
  readonly rawValue: number;
}

export interface CategoryPolicy {
  /** Inclusive bounds on how many targets of this category a round contains. */
  readonly minCount: number;
  readonly maxCount: number;
  readonly kinds: readonly TargetKindSpec[];
  readonly detectionRadius: number;
  readonly digRadius: number;
  /** Signal scale `0..1`; lets litter read weaker than treasure. */
  readonly signalWeight: number;
}

export interface TreasureHuntPolicy {
  /** Field bounds. Positions live in `0..fieldWidth` × `0..fieldHeight`. */
  readonly fieldWidth: number;
  readonly fieldHeight: number;
  readonly roundDurationSeconds: number;
  readonly targetCount: number;
  readonly shovelUses: number;
  /** No target center closer than this to any field edge. */
  readonly edgePadding: number;
  /** No two target centers closer than this to each other. */
  readonly minTargetSeparation: number;
  /** Where the coil starts; also the center of the placement exclusion zone. */
  readonly initialCoilPosition: Point;
  /** No target strictly inside this distance of the initial coil position. */
  readonly initialCoilExclusionRadius: number;
  /** At or inside this distance the signal saturates to the category weight. */
  readonly signalSaturationDistance: number;
  /** Response-curve exponent; `> 1` steepens the signal near the target. */
  readonly signalCurveExponent: number;
  /** Placement attempts per target before the generator gives up (typed failure). */
  readonly maxPlacementAttempts: number;
  readonly categories: Readonly<Record<TreasureTargetCategory, CategoryPolicy>>;
}

/** A concrete per-category target count satisfying the policy for one round. */
export interface TargetComposition {
  readonly litter: number;
  readonly valuable: number;
  readonly special: number;
}

export const TREASURE_TARGET_CATEGORIES: readonly TreasureTargetCategory[] = Object.freeze([
  'litter',
  'valuable',
  'special',
]);

export const DEFAULT_TREASURE_HUNT_POLICY: TreasureHuntPolicy = deepFreezePolicy({
  fieldWidth: 1,
  fieldHeight: 1,
  roundDurationSeconds: 120,
  targetCount: 9,
  shovelUses: 5,
  edgePadding: 0.06,
  minTargetSeparation: 0.12,
  initialCoilPosition: { x: 0.5, y: 0.5 },
  initialCoilExclusionRadius: 0.15,
  signalSaturationDistance: 0.02,
  signalCurveExponent: 1.4,
  maxPlacementAttempts: 120,
  categories: {
    litter: {
      minCount: 4,
      maxCount: 5,
      detectionRadius: 0.16,
      digRadius: 0.07,
      signalWeight: 0.85,
      kinds: [
        { kind: 'bottle-cap', rawValue: 1 },
        { kind: 'rusty-tab', rawValue: 1 },
        { kind: 'bent-wire', rawValue: 1 },
        { kind: 'old-screw', rawValue: 1 },
        { kind: 'scrap-piece', rawValue: 1 },
      ],
    },
    valuable: {
      minCount: 3,
      maxCount: 4,
      detectionRadius: 0.18,
      digRadius: 0.07,
      signalWeight: 1,
      kinds: [
        { kind: 'decorative-coin', rawValue: 4 },
        { kind: 'shell-pendant', rawValue: 5 },
        { kind: 'toy-badge', rawValue: 3 },
        { kind: 'nautical-trinket', rawValue: 6 },
        { kind: 'shiny-button', rawValue: 2 },
      ],
    },
    special: {
      minCount: 0,
      maxCount: 1,
      detectionRadius: 0.2,
      digRadius: 0.08,
      signalWeight: 1,
      // Candidacy only: the special slot has no unit value on purpose, so no
      // arithmetic downstream can accidentally price a future rare item.
      kinds: [{ kind: 'special-candidate', rawValue: 0 }],
    },
  },
});

function deepFreezePolicy(policy: TreasureHuntPolicy): TreasureHuntPolicy {
  for (const category of Object.values(policy.categories)) {
    for (const kindSpec of category.kinds) Object.freeze(kindSpec);
    Object.freeze(category.kinds);
    Object.freeze(category);
  }
  Object.freeze(policy.categories);
  Object.freeze(policy.initialCoilPosition);
  return Object.freeze(policy);
}

/**
 * Every per-category count combination that satisfies the min/max bounds AND
 * sums to `targetCount`, in a fixed enumeration order (litter ascending, then
 * valuable ascending). The generator draws one of these with the seeded PRNG,
 * so composition is deterministic per seed. An empty list means the policy is
 * unsatisfiable — `validateTreasureHuntPolicy` rejects that outright.
 */
export function validCompositions(policy: TreasureHuntPolicy): readonly TargetComposition[] {
  const { litter, valuable, special } = policy.categories;
  const out: TargetComposition[] = [];
  for (let l = litter.minCount; l <= litter.maxCount; l += 1) {
    for (let v = valuable.minCount; v <= valuable.maxCount; v += 1) {
      const s = policy.targetCount - l - v;
      if (s >= special.minCount && s <= special.maxCount) {
        out.push({ litter: l, valuable: v, special: s });
      }
    }
  }
  return out;
}

function fail(message: string): never {
  throw new Error(`Invalid treasure-hunt policy: ${message}`);
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) fail(`${name} must be a positive finite number`);
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${name} must be a positive safe integer`);
}

/**
 * Throws on the first violation. Called by the generator and by
 * `createTreasureHuntRound`, so an invalid policy can never quietly produce a
 * round; call it directly when authoring a custom policy to fail early.
 */
export function validateTreasureHuntPolicy(policy: TreasureHuntPolicy): void {
  assertPositiveFinite(policy.fieldWidth, 'fieldWidth');
  assertPositiveFinite(policy.fieldHeight, 'fieldHeight');
  assertPositiveFinite(policy.roundDurationSeconds, 'roundDurationSeconds');
  assertPositiveSafeInteger(policy.targetCount, 'targetCount');
  assertPositiveSafeInteger(policy.shovelUses, 'shovelUses');
  assertPositiveSafeInteger(policy.maxPlacementAttempts, 'maxPlacementAttempts');
  assertPositiveFinite(policy.signalCurveExponent, 'signalCurveExponent');

  if (!Number.isFinite(policy.edgePadding) || policy.edgePadding < 0) {
    fail('edgePadding must be a non-negative finite number');
  }
  const smallestSide = Math.min(policy.fieldWidth, policy.fieldHeight);
  if (policy.edgePadding * 2 >= smallestSide) {
    fail('edgePadding leaves no placeable area');
  }
  if (!Number.isFinite(policy.minTargetSeparation) || policy.minTargetSeparation < 0) {
    fail('minTargetSeparation must be a non-negative finite number');
  }
  if (!isWithinField(policy.initialCoilPosition, policy.fieldWidth, policy.fieldHeight)) {
    fail('initialCoilPosition must be a finite point inside the field');
  }
  if (
    !Number.isFinite(policy.initialCoilExclusionRadius) ||
    policy.initialCoilExclusionRadius < 0
  ) {
    fail('initialCoilExclusionRadius must be a non-negative finite number');
  }
  if (
    !Number.isFinite(policy.signalSaturationDistance) ||
    policy.signalSaturationDistance < 0
  ) {
    fail('signalSaturationDistance must be a non-negative finite number');
  }

  const seenKinds = new Set<string>();
  for (const category of TREASURE_TARGET_CATEGORIES) {
    const entry = policy.categories[category];
    if (!entry) fail(`categories.${category} is missing`);
    if (!Number.isSafeInteger(entry.minCount) || entry.minCount < 0) {
      fail(`categories.${category}.minCount must be a non-negative safe integer`);
    }
    if (!Number.isSafeInteger(entry.maxCount) || entry.maxCount < entry.minCount) {
      fail(`categories.${category}.maxCount must be a safe integer >= minCount`);
    }
    assertPositiveFinite(entry.detectionRadius, `categories.${category}.detectionRadius`);
    assertPositiveFinite(entry.digRadius, `categories.${category}.digRadius`);
    if (policy.signalSaturationDistance >= entry.detectionRadius) {
      fail(`signalSaturationDistance must be smaller than categories.${category}.detectionRadius`);
    }
    if (
      !Number.isFinite(entry.signalWeight) ||
      entry.signalWeight <= 0 ||
      entry.signalWeight > 1
    ) {
      fail(`categories.${category}.signalWeight must be in (0, 1]`);
    }
    if (entry.kinds.length === 0) fail(`categories.${category}.kinds must not be empty`);
    for (const kindSpec of entry.kinds) {
      if (typeof kindSpec.kind !== 'string' || kindSpec.kind.trim() === '') {
        fail(`categories.${category} contains a kind with a blank identifier`);
      }
      if (seenKinds.has(kindSpec.kind)) {
        fail(`kind identifier "${kindSpec.kind}" is duplicated across categories`);
      }
      seenKinds.add(kindSpec.kind);
      if (!Number.isFinite(kindSpec.rawValue) || kindSpec.rawValue < 0) {
        fail(`kind "${kindSpec.kind}" must have a non-negative finite rawValue`);
      }
    }
  }

  if (validCompositions(policy).length === 0) {
    fail(
      `no category composition sums to targetCount ${policy.targetCount} ` +
        'within the per-category min/max bounds'
    );
  }
}
