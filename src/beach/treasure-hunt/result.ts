/**
 * Beach Treasure Hunt — the economy-neutral result.
 *
 * `buildTreasureHuntResult` is a pure projection of a **finished** round:
 * same finished round, same result, no services called, nothing mutated.
 * An unfinished round throws — there is deliberately no "partial result"
 * here; if Beach 1B wants a live scoreboard it should read the round state
 * directly, not a half-built result object.
 *
 * ## Units are not Coins
 *
 * `rawCleanupValue` and `rawTreasureValue` are abstract reward units from
 * `policy.ts`. Mapping units to Coins (and a special find to a real
 * kind:31632 item) is Beach 2's reward boundary, which also owns durability
 * and exactly-once concerns. Nothing in this module grants anything, and
 * `specialCandidateFound` says "candidate", not "owned".
 */

import type { TreasureFindResult, TreasureHuntResult, TreasureTarget } from './types';
import type { TreasureHuntRound } from './reducer';

function toFind(target: TreasureTarget): TreasureFindResult {
  return { targetId: target.id, kind: target.kind, rawValue: target.rawValue };
}

export function buildTreasureHuntResult(round: TreasureHuntRound): TreasureHuntResult {
  if (round.status !== 'finished' || round.endReason === null) {
    throw new Error('buildTreasureHuntResult: the round has not finished');
  }

  const byId = new Map(round.targets.map((target) => [target.id, target]));
  // Find order = the order the player dug them up, from foundTargetIds.
  const found = round.foundTargetIds.map((id) => {
    const target = byId.get(id);
    if (!target) {
      throw new Error(`buildTreasureHuntResult: found id "${id}" is not a round target`);
    }
    return target;
  });

  const litterFinds = found.filter((t) => t.category === 'litter').map(toFind);
  const valuableFinds = found.filter((t) => t.category === 'valuable').map(toFind);
  const specialFinds = found.filter((t) => t.category === 'special').map(toFind);

  return {
    roundId: round.roundId,
    seed: round.seed,
    endReason: round.endReason,
    durationSeconds: round.elapsedSeconds,
    shovelUsesSpent: round.policy.shovelUses - round.shovelUsesRemaining,
    successfulDigs: round.digHistory.filter((record) => record.outcome === 'hit').length,
    missedDigs: round.digHistory.filter((record) => record.outcome === 'miss').length,
    litterFinds,
    valuableFinds,
    specialFinds,
    rawCleanupValue: litterFinds.reduce((sum, find) => sum + find.rawValue, 0),
    rawTreasureValue: valuableFinds.reduce((sum, find) => sum + find.rawValue, 0),
    specialCandidateFound: specialFinds.length > 0,
  };
}
