/**
 * Settling a Blobbi's energy cost as an exactly-once DELTA.
 *
 * The Mine used to publish kind:31124 on every click, so the cost was durable
 * long before the reward. This module is the other half of the replacement:
 * one write, at the end, applied exactly once.
 *
 * ## Delta, never absolute
 *
 * ```
 *   start 80 · Mine consumes 30 · another tab spends 20 meanwhile
 *   stale absolute:  80 - 30 = 50   ← resurrects 10 energy the player spent
 *   fresh delta:     60 - 30 = 30   ← correct
 * ```
 *
 * The subtraction is always applied to the authoritative state read INSIDE the
 * transaction, never to the snapshot the session started from.
 *
 * ## Exhaustion policy (deliberate, user-favouring)
 *
 * ```
 *   finalEnergy = max(0, freshEnergy - requestedDelta)
 * ```
 *
 * If the Mine consumed 30 but only 20 energy remains (the rest was spent
 * elsewhere), the operation subtracts what is there, lands on 0, and is
 * **fully settled**. The unapplied remainder is deliberately forgiven and is
 * never re-attempted later: a settlement that could come back for more would
 * be a debt, and the economy has no concept of one. `appliedDelta` reports
 * what actually moved.
 *
 * ## Exactly-once, and how ambiguity is resolved
 *
 * Coins can be reconciled by reading a balance, because only the Coin wallet
 * moves it. Energy cannot: care actions, item use and sleep all change it, so
 * observing `energy === expected` proves nothing.
 *
 * So the replacement event carries an opaque marker tag:
 *
 * ```
 *   ["blobbi_op", "<opId>"]
 * ```
 *
 * `mergePetStateTags` preserves unknown tags verbatim, so the marker survives
 * ordinary care writes, which is what makes a later read able to prove that
 * THIS operation's event landed. Each settlement drops previous `blobbi_op`
 * tags before adding its own, so exactly one is ever present and the event
 * cannot accumulate one marker per session forever.
 *
 * Honest limit: the marker is app-specific, opaque, and carries no protocol
 * meaning. It is evidence for reconciliation, not a public schema. And if some
 * other client republishes this pet without preserving unknown tags, the
 * marker is lost, reconciliation then reports `ambiguous` and the operation
 * stays unresolved rather than silently subtracting twice.
 */

import type { NUser } from '@nostrify/react/login';

import {
  persistPetEnergyOp,
  petEnergyOpBlocksPublish,
  readPetEnergyOp,
  type PetEnergyOpRecord,
} from '@/lib/pet-energy-ledger';
import {
  PetStateTransactionError,
  readPetState,
  runPetStateTransaction,
  PET_OP_MARKER_TAG,
  type PetStateNostr,
} from '@/lib/pet-state-transaction';

/**
 * The tag name carrying a settlement marker on kind:31124. Owned by the
 * pet-state transaction primitive (shared with external-item consumption);
 * re-exported here so existing importers keep one name.
 */
export { PET_OP_MARKER_TAG };

/** Highest energy value the game recognises (matches the shared stat clamp). */
export const MAX_PET_ENERGY = 100;

export interface EnergySettlementDeps {
  readonly nostr: PetStateNostr;
  readonly user: Pick<NUser, 'pubkey' | 'signer'>;
  readonly now?: () => number;
}

export interface EnergyDeltaOperation {
  /** Stable per logical operation. Reused on every retry. */
  readonly opId: string;
  readonly petId: string;
  /** Positive integer energy to SUBTRACT. */
  readonly amount: number;
  /** Debug context for the ledger, e.g. 'mine-energy'. */
  readonly label: string;
}

export type EnergySettlementOutcome =
  /** Published. `appliedDelta` is what actually moved (bounded at zero). */
  | {
      readonly status: 'applied';
      readonly energyAfter: number;
      readonly appliedDelta: number;
      readonly verified: boolean;
    }
  /** This opId already settled. Idempotent success, nothing published. */
  | { readonly status: 'already-applied' }
  /** The publish MAY have landed. Recorded; reconcile, never blind-retry. */
  | { readonly status: 'ambiguous'; readonly reason: 'publish-timeout' | 'publish-unknown' }
  /** A durable in-flight/ambiguous record blocks a new publish. */
  | { readonly status: 'blocked'; readonly blockedBy: 'publishing' | 'ambiguous' }
  /** Provably nothing was sent. Safe to retry under the SAME opId. */
  | {
      readonly status: 'failed';
      readonly reason:
        | 'not-logged-in'
        | 'invalid-amount'
        | 'read-unknown'
        | 'pet-absent'
        | 'sign-failed'
        | 'ledger-unavailable';
    };

export interface EnergySettler {
  settleEnergyDelta(op: EnergyDeltaOperation): Promise<EnergySettlementOutcome>;
  /**
   * Read-only reconciliation of a publishing/ambiguous operation: looks for
   * this operation's marker on the pet's current state. Never publishes.
   */
  reconcileEnergyOp(opId: string, petId: string): Promise<PetEnergyOpRecord | null>;
}

function hasOpMarker(tags: readonly string[][], opId: string): boolean {
  return tags.some((tag) => tag[0] === PET_OP_MARKER_TAG && tag[1] === opId);
}

export function createEnergySettler(deps: EnergySettlementDeps): EnergySettler {
  const { nostr, user } = deps;
  const now = deps.now ?? Date.now;

  const record = (
    partial: Omit<PetEnergyOpRecord, 'createdAt' | 'updatedAt'> & { createdAt?: number },
  ): PetEnergyOpRecord => {
    const timestamp = now();
    return {
      createdAt: partial.createdAt ?? timestamp,
      ...partial,
      updatedAt: timestamp,
    };
  };

  /** Marker present on the pet's newest state ⇒ this operation landed. */
  const reconcileAgainstMarker = async (
    pubkey: string,
    existing: PetEnergyOpRecord,
  ): Promise<PetEnergyOpRecord> => {
    const outcome = await readPetState(nostr, pubkey, existing.petId);
    if (outcome.status !== 'found') return existing;
    if (!hasOpMarker(outcome.value.event.tags, existing.opId)) return existing;
    const applied = record({
      ...existing,
      status: 'applied',
      energyAfter: outcome.value.pet.energy,
      note: 'reconciled-by-marker',
      createdAt: existing.createdAt,
    });
    persistPetEnergyOp(pubkey, applied);
    return applied;
  };

  return {
    async settleEnergyDelta(op): Promise<EnergySettlementOutcome> {
      if (!user?.pubkey || !user.signer) {
        return { status: 'failed', reason: 'not-logged-in' };
      }
      const pubkey = user.pubkey;
      if (!Number.isInteger(op.amount) || op.amount <= 0) {
        // Never silently clamped: a caller asking for a nonsense delta is a
        // bug, not something to reinterpret.
        return { status: 'failed', reason: 'invalid-amount' };
      }

      try {
        return await runPetStateTransaction(
          { nostr, user, now },
          op.petId,
          async (ctx): Promise<EnergySettlementOutcome> => {
            // Exactly-once: the durable ledger is consulted INSIDE the lock.
            const existing = readPetEnergyOp(pubkey, op.opId);
            if (existing?.status === 'applied') return { status: 'already-applied' };
            if (existing && petEnergyOpBlocksPublish(existing)) {
              const reconciled = await reconcileAgainstMarker(pubkey, existing);
              if (reconciled.status === 'applied') return { status: 'already-applied' };
              return {
                status: 'blocked',
                blockedBy: existing.status as 'publishing' | 'ambiguous',
              };
            }

            const base = await ctx.readBase();

            // A marker already on the newest state means a previous attempt
            // landed even though our ledger never recorded it (storage cleared
            // between publish and record). Trust the relay, not the journal.
            if (hasOpMarker(base.event.tags, op.opId)) {
              persistPetEnergyOp(
                pubkey,
                record({
                  opId: op.opId,
                  petId: op.petId,
                  requestedDelta: op.amount,
                  status: 'applied',
                  label: op.label,
                  energyBefore: null,
                  energyAfter: base.pet.energy,
                  note: 'marker-found-before-publish',
                }),
              );
              return { status: 'already-applied' };
            }

            const energyBefore = base.pet.energy;
            // THE DELTA: always against the fresh authoritative value, bounded
            // at zero. See the exhaustion policy in the module doc.
            const energyAfter = Math.max(
              0,
              Math.min(MAX_PET_ENERGY, energyBefore) - op.amount,
            );
            const appliedDelta = Math.max(0, Math.min(MAX_PET_ENERGY, energyBefore)) - energyAfter;

            // No durable record, no publish, the rule the arcade learned.
            const publishing = record({
              opId: op.opId,
              petId: op.petId,
              requestedDelta: op.amount,
              status: 'publishing',
              label: op.label,
              energyBefore,
              energyAfter,
            });
            if (!persistPetEnergyOp(pubkey, publishing)) {
              return { status: 'failed', reason: 'ledger-unavailable' };
            }

            try {
              await ctx.publish(base.pet, {
                overrides: { energy: String(energyAfter) },
                // Exactly one marker on the event at a time.
                dropTagNames: [PET_OP_MARKER_TAG],
                extraTags: [[PET_OP_MARKER_TAG, op.opId]],
              });
            } catch (error) {
              if (error instanceof PetStateTransactionError) {
                if (error.reason === 'publish-timeout' || error.reason === 'publish-unknown') {
                  persistPetEnergyOp(
                    pubkey,
                    record({ ...publishing, status: 'ambiguous', note: error.reason }),
                  );
                  return { status: 'ambiguous', reason: error.reason };
                }
                persistPetEnergyOp(
                  pubkey,
                  record({ ...publishing, status: 'failed', note: error.reason }),
                );
                if (error.reason === 'sign-failed') {
                  return { status: 'failed', reason: 'sign-failed' };
                }
              }
              throw error;
            }

            // Read-back verification. A mismatch does not un-publish anything,
            // so the outcome stays `applied` with `verified: false`.
            let verified = false;
            try {
              const after = await readPetState(nostr, pubkey, op.petId);
              verified =
                after.status === 'found' && hasOpMarker(after.value.event.tags, op.opId);
            } catch {
              verified = false;
            }

            persistPetEnergyOp(
              pubkey,
              record({
                ...publishing,
                status: 'applied',
                note: verified ? 'read-back-verified' : 'read-back-unverified',
              }),
            );
            return { status: 'applied', energyAfter, appliedDelta, verified };
          },
        );
      } catch (error) {
        if (error instanceof PetStateTransactionError) {
          if (error.reason === 'read-unknown') return { status: 'failed', reason: 'read-unknown' };
          if (error.reason === 'pet-absent') return { status: 'failed', reason: 'pet-absent' };
          if (error.reason === 'not-logged-in') {
            return { status: 'failed', reason: 'not-logged-in' };
          }
          if (error.reason === 'sign-failed') return { status: 'failed', reason: 'sign-failed' };
        }
        throw error;
      }
    },

    async reconcileEnergyOp(opId, petId): Promise<PetEnergyOpRecord | null> {
      if (!user?.pubkey) return null;
      const existing = readPetEnergyOp(user.pubkey, opId);
      if (!existing) return null;
      if (existing.status !== 'publishing' && existing.status !== 'ambiguous') {
        return existing;
      }
      return reconcileAgainstMarker(user.pubkey, { ...existing, petId });
    },
  };
}
