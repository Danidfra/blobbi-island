/**
 * Beach Treasure Hunt — the pure game model (Beach 1A).
 *
 * Public surface of `src/beach/treasure-hunt/`. Everything exported here is
 * deterministic and framework-free; see `types.ts` for the ground rules and
 * `docs/beach-treasure-hunt-model.md` for the overview. The React shell,
 * audio, and any real rewards are later phases and must not creep in here.
 */

export type {
  Point,
  TreasureTargetCategory,
  TreasureTarget,
  DetectorSignal,
  DigRejectionReason,
  DigResolution,
  DigRecord,
  TreasureHuntStatus,
  TreasureHuntEndReason,
  TreasureHuntAction,
  TreasureFindResult,
  TreasureHuntResult,
} from './types';

export {
  DEFAULT_TREASURE_HUNT_POLICY,
  TREASURE_TARGET_CATEGORIES,
  validateTreasureHuntPolicy,
  validCompositions,
  type TreasureHuntPolicy,
  type CategoryPolicy,
  type TargetKindSpec,
  type TargetComposition,
} from './policy';

export { nextRandom, treasureSeedFrom, seededShuffle } from './random';
export { distanceBetween, isFinitePoint, isWithinField } from './geometry';

export {
  generateTreasureTargets,
  validateTargetLayout,
  type TargetGenerationResult,
  type TargetGenerationFailure,
} from './generator';

export { evaluateDetectorSignal, signalStrengthForDistance } from './detector';
export { resolveDig } from './digging';

export {
  createTreasureHuntRound,
  treasureHuntReducer,
  treasureHuntRoundId,
  validateRoundState,
  type TreasureHuntRound,
  type CreateTreasureHuntRoundInput,
  type CreateTreasureHuntRoundResult,
} from './reducer';

export { buildTreasureHuntResult } from './result';
