/**
 * The arcade → inventory seam, defined but **not crossed**.
 *
 * This phase grants nothing. There is no `useInventoryMutation` call, no
 * publish, no ticket quantity and no fabricated success anywhere in
 * `src/arcade/`. What this module contains is the *contract* Phase 3 must
 * implement, expressed as pure data and pure transitions so the hard parts —
 * idempotency, retryability, and the refusal to trust a resolved publish — are
 * settled and tested before any code can write to a relay.
 *
 * ## The lifecycle, in full
 *
 * ```
 *   finished immutable result
 *        │
 *        ▼  calculateTicketAward()          (pure — reward-policy.ts)
 *   award with breakdown
 *        │
 *        ▼  createPendingClaim()            persisted BEFORE any write
 *   pending ──────────────────────────────────────────────┐
 *        │ beginPublish()                                 │
 *        ▼                                                │
 *   publishing ── strict publish (timeout = FAILURE) ──────┤
 *        │ beginVerify()                                   │ failure
 *        ▼                                                 │
 *   verifying ── re-read 31633, assert the quantity moved ─┤
 *        │ confirm()                                       │
 *        ▼                                                 ▼
 *   claimed  (terminal, one-way)                        failed (retryable,
 *                                                        SAME runId)
 * ```
 *
 * ## The rule the whole design turns on
 *
 * > **A grant may only be marked `claimed` once the new quantity has been
 * > confirmed to exist on a relay. A resolved `publish()` is not confirmation.**
 *
 * `docs/arcade-reward-publication-boundary.md` establishes why: the shared
 * `useNostrPublish` resolves on a 5-second timeout and logs a warning, so a
 * grant that never reached any relay currently looks exactly like a successful
 * one. Combined with optimistic cache updates, the player would be shown "+8
 * tickets", the invalidation would refetch the old inventory, and the tickets
 * would vanish with nothing ever reported as failed.
 *
 * ## The chosen publish strategy (do not re-litigate in Phase 3)
 *
 * **A local strict publish inside the reward hook, plus a verify-after-write
 * read. `useNostrPublish` is NOT changed.** Reasons, in order of weight:
 *
 *  - **Blast radius.** The primitive is used by presence, chat, playback,
 *    profile, Blobbi state and inventory. Tightening it globally turns every
 *    relay hiccup into a user-visible error across the whole app and needs
 *    compatibility proof for each caller. This phase has no reward code to
 *    justify that.
 *  - **Precedent.** `useFirstEggAdoption` already hit this exact bug and solved
 *    it with a local strict publish, so the pattern is established here rather
 *    than invented for the arcade.
 *  - **Verification closes the last gap.** Strict publishing removes "timeout
 *    read as success"; the read-back removes "accepted by a relay that then
 *    dropped it". Only the two together let the UI claim the tickets are real.
 *  - **Idempotency makes strictness cheap.** The expensive failure mode of a
 *    strict publish is retrying something that actually succeeded — and with a
 *    `runId`-keyed claimed set, that retry costs nothing.
 *
 * Rejected: changing `useNostrPublish` globally now; adding a `strict: true`
 * option to it for a caller that does not exist yet; trusting the optimistic
 * cache (that IS the bug); retrying on timeout without idempotency (turns one
 * unconfirmed grant into several confirmed ones).
 *
 * ## What this module deliberately does not import
 *
 * `src/inventory/*`, `@nostrify/*`, React, TanStack Query. A module that cannot
 * reach a relay cannot accidentally write to one.
 */

import type { ArcadeGameResult } from './types';
import { findNonSerialisable, validateArcadeGameResult } from './types';
import type { TicketAward } from './reward-policy';

export type ArcadeClaimStatus =
  /** Recorded locally, nothing has been sent. Survives a refresh. */
  | 'pending'
  /** A strict publish is in flight. */
  | 'publishing'
  /** Published; reading the inventory back to confirm the quantity moved. */
  | 'verifying'
  /** Confirmed on a relay. Terminal and one-way. */
  | 'claimed'
  /** Something went wrong. Retryable with the SAME runId. */
  | 'failed';

/**
 * Why a claim failed. The UI must distinguish these: a `publish-timeout` is
 * "we don't know", a `publish-rejected` is "it definitely didn't happen", and a
 * `verify-mismatch` is "it may have happened but we can't see it". All three are
 * retryable; only the copy differs.
 */
export type ArcadeClaimFailure =
  /** Strict publish timed out — NOT treated as success. */
  | 'publish-timeout'
  /** Every relay rejected the event. */
  | 'publish-rejected'
  /** The signer refused or is unavailable. */
  | 'sign-failed'
  /** The read-back did not show the expected quantity. */
  | 'verify-mismatch'
  /** The verification read itself failed. */
  | 'verify-unavailable'
  /** The result or award was rejected before anything was sent. */
  | 'invalid-claim';

/**
 * The persisted record of one reward claim.
 *
 * Written to storage **before** the first publish attempt, so a refresh in the
 * middle of a claim leaves a recoverable `pending`/`publishing` record instead
 * of silently losing the tickets. Plain JSON — no controllers, no promises.
 */
export interface ArcadeRewardClaim {
  /** Idempotency key. Identical across every retry of the same run. */
  readonly runId: string;
  readonly gameId: string;
  readonly machineId: string;
  readonly status: ArcadeClaimStatus;
  /** Tickets this claim is for. Fixed at creation; a retry never recomputes it. */
  readonly tickets: number;
  /** Epoch ms the claim was first recorded. Supplied by the caller. */
  readonly createdAt: number;
  /** Epoch ms of the most recent transition. Supplied by the caller. */
  readonly updatedAt: number;
  /** How many publish attempts have been made. */
  readonly attempts: number;
  readonly failure: ArcadeClaimFailure | null;
}

export type ArcadeClaimOutcome =
  | { readonly ok: true; readonly claim: ArcadeRewardClaim }
  | { readonly ok: false; readonly reason: string };

/**
 * The write capability Phase 3 must implement, and the ONLY one the arcade is
 * ever allowed to hold.
 *
 * It is an interface rather than a hook so that the lifecycle above can be
 * driven and tested without React, and so a game can never obtain one: games
 * receive no reference to a writer, by construction.
 */
export interface ArcadeRewardWriter {
  /**
   * Publish the ticket grant STRICTLY — a timeout or abort MUST reject. Resolving
   * on timeout is the exact defect this interface exists to forbid.
   */
  publishTicketGrant(claim: ArcadeRewardClaim): Promise<void>;
  /**
   * Re-read the canonical inventory and report the current ticket quantity.
   * Returning a number the caller can compare is what makes "verified" mean
   * something; returning `null` means the read itself failed.
   */
  readTicketQuantity(): Promise<number | null>;
}

/**
 * Not implemented in this phase — on purpose.
 *
 * Exported so a future caller wiring up the reward hook fails loudly and
 * immediately rather than silently doing nothing, and so a test can assert that
 * no reward path exists yet.
 */
export const ARCADE_REWARD_WRITER_UNIMPLEMENTED: ArcadeRewardWriter = {
  publishTicketGrant() {
    return Promise.reject(
      new Error('Arcade reward writing is not implemented (Phase 2 grants no tickets)'),
    );
  },
  readTicketQuantity() {
    return Promise.reject(
      new Error('Arcade reward reading is not implemented (Phase 2 grants no tickets)'),
    );
  },
};

/**
 * Record a claim, before anything is sent anywhere.
 *
 * Rejects rather than creating a claim when:
 *  - the result is malformed (`validateArcadeGameResult`);
 *  - the result is not serialisable, so the record could not survive a refresh;
 *  - the award belongs to a different run or game;
 *  - the award was itself rejected, or is zero (nothing to grant);
 *  - this `runId` has already been claimed — the idempotency guarantee.
 *
 * An ABORTED run never gets here: an aborted run has no result at all (see
 * `arcade-machine-state.ts`), so there is nothing to pass in.
 */
export function createPendingClaim(
  result: ArcadeGameResult,
  award: TicketAward,
  now: number,
  alreadyClaimedRunIds: readonly string[] = [],
): ArcadeClaimOutcome {
  const validation = validateArcadeGameResult(result);
  if (!validation.ok) {
    return { ok: false, reason: `invalid result: ${validation.problems[0].field}` };
  }
  const unserialisable = findNonSerialisable(result);
  if (unserialisable.length > 0) {
    return { ok: false, reason: `result is not serialisable at ${unserialisable[0]}` };
  }
  if (award.rejected !== null) {
    return { ok: false, reason: `award rejected: ${award.rejected}` };
  }
  if (award.runId !== result.runId || award.gameId !== result.gameId) {
    return { ok: false, reason: 'award does not belong to this result' };
  }
  if (!Number.isInteger(award.total) || award.total <= 0) {
    return { ok: false, reason: 'award has nothing to grant' };
  }
  if (alreadyClaimedRunIds.includes(result.runId)) {
    return { ok: false, reason: 'run already claimed' };
  }
  if (!Number.isFinite(now) || now <= 0) {
    return { ok: false, reason: 'invalid timestamp' };
  }

  return {
    ok: true,
    claim: {
      runId: result.runId,
      gameId: result.gameId,
      machineId: result.machineId,
      status: 'pending',
      tickets: award.total,
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      failure: null,
    },
  };
}

export type ArcadeClaimEvent =
  /** Start (or retry) a strict publish. */
  | { readonly type: 'begin-publish'; readonly now: number }
  /** The publish resolved strictly; now verify it. */
  | { readonly type: 'begin-verify'; readonly now: number }
  /**
   * The read-back confirmed the quantity moved by exactly the awarded amount.
   * The caller passes both numbers so the boundary — not the caller — decides
   * whether "confirmed" is true.
   */
  | {
      readonly type: 'confirm';
      readonly now: number;
      readonly quantityBefore: number;
      readonly quantityAfter: number;
    }
  | { readonly type: 'fail'; readonly now: number; readonly failure: ArcadeClaimFailure };

/**
 * The claim's transition function. Pure, exhaustive, and unforgiving in exactly
 * one direction: nothing reaches `claimed` except a `confirm` whose numbers add
 * up.
 */
export function advanceClaim(claim: ArcadeRewardClaim, event: ArcadeClaimEvent): ArcadeRewardClaim {
  // `claimed` is a one-way door. Late events — a duplicate confirm, a retry that
  // raced a success, a stale timer — cannot reopen it.
  if (claim.status === 'claimed') return claim;

  switch (event.type) {
    case 'begin-publish':
      // Retryable from `pending` and from `failed`, and only from those: a claim
      // already publishing must not be sent twice by a double-click.
      if (claim.status !== 'pending' && claim.status !== 'failed') return claim;
      return {
        ...claim,
        status: 'publishing',
        attempts: claim.attempts + 1,
        failure: null,
        updatedAt: event.now,
      };

    case 'begin-verify':
      if (claim.status !== 'publishing') return claim;
      return { ...claim, status: 'verifying', updatedAt: event.now };

    case 'confirm': {
      if (claim.status !== 'verifying') return claim;
      const moved = event.quantityAfter - event.quantityBefore;
      // The read-back must show EXACTLY the awarded delta. Anything else means
      // we are looking at a different write (or none), and a claim that cannot
      // prove itself stays retryable rather than being marked paid.
      if (moved !== claim.tickets) {
        return { ...claim, status: 'failed', failure: 'verify-mismatch', updatedAt: event.now };
      }
      return { ...claim, status: 'claimed', failure: null, updatedAt: event.now };
    }

    case 'fail':
      return { ...claim, status: 'failed', failure: event.failure, updatedAt: event.now };
  }
}

/** A failed claim can always be retried, and always with the same `runId`. */
export function isRetryable(claim: ArcadeRewardClaim): boolean {
  return claim.status === 'failed' || claim.status === 'pending';
}

/** Whether the tickets are real and the UI may say so. */
export function isClaimSettled(claim: ArcadeRewardClaim): boolean {
  return claim.status === 'claimed';
}

/**
 * Storage key for the persisted claim set.
 *
 * `localStorage`, not `sessionStorage`, and deliberately so: two tabs must see
 * the same claimed set, or the same run could be paid twice. Phase 3 owns the
 * reader/writer; the key lives here so both sides agree on it.
 */
export const ARCADE_CLAIMS_STORAGE_KEY = 'blobbi:arcade:reward-claims';
