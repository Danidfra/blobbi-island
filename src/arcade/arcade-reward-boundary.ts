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
 *  - **Idempotency makes strictness cheap.** ~~The expensive failure mode of a
 *    strict publish is retrying something that actually succeeded — and with a
 *    `runId`-keyed claimed set, that retry costs nothing.~~ **This was wrong and
 *    it produced a duplicate grant.** A claimed set written only on confirmed
 *    success says nothing about an attempt whose outcome is unknown, and the
 *    grant is ADDITIVE, so retrying one that actually landed pays it twice. An
 *    unknown outcome is now `ambiguous` and is never republished — see the
 *    status documentation below and `docs/blobbi-dance.md` §8.
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
  /**
   * Something went wrong **before anything was sent**. Retryable with the SAME
   * runId, because nothing crossed the publish boundary.
   */
  | 'failed'
  /**
   * The event MAY have been published and we cannot prove either way.
   *
   * This status exists because of a real, reproduced defect: it used to be
   * folded into `failed`, the UI offered "Try again", and the retry issued a
   * SECOND additive `+N` — turning a 3-ticket reward into 6. See
   * `docs/arcade-reward-publication-boundary.md` §6.
   *
   * An `ambiguous` claim is **never republishable**. The only thing that may
   * happen to it is read-only reconciliation, which can move it to `claimed` if
   * the evidence is sufficient and otherwise leaves it exactly where it is.
   */
  | 'ambiguous';

/**
 * Why a claim failed. The UI must distinguish these: a `publish-timeout` is
 * "we don't know", a `publish-rejected` is "it definitely didn't happen", and a
 * `verify-mismatch` is "it may have happened but we can't see it". All three are
 * retryable; only the copy differs.
 */
export type ArcadeClaimFailure =
  /** Strict publish timed out — NOT treated as success, and NOT retryable. */
  | 'publish-timeout'
  /** Every relay definitively rejected the event. Nothing was stored. */
  | 'publish-rejected'
  /** The signer refused before returning a signed event. Nothing was sent. */
  | 'sign-failed'
  /** The read-back did not show the expected quantity. */
  | 'verify-mismatch'
  /** The verification read itself failed. */
  | 'verify-unavailable'
  /**
   * The BASELINE read failed, before anything was sent.
   *
   * Distinct from `verify-unavailable`, and the distinction is load-bearing:
   * without a baseline there is nothing to reconcile against later, so the claim
   * refuses to publish at all rather than becoming permanently unresolvable.
   * Nothing crossed the publish boundary, so this is retryable.
   */
  | 'baseline-unavailable'
  /** The claim could not be recorded durably, so nothing was sent. */
  | 'ledger-unavailable'
  /** Another tab or document holds the claim lock. Nothing was sent. */
  | 'lock-unavailable'
  /** The result or award was rejected before anything was sent. */
  | 'invalid-claim';

/**
 * Failures that are provably PRE-publication, and therefore safely retryable.
 *
 * Everything not in this set may have crossed the publish boundary and must
 * become {@link ArcadeClaimStatus} `ambiguous` instead. The default is
 * deliberately the unsafe-to-retry side: a failure mode nobody has classified
 * yet must not become a second additive write.
 */
export const RETRYABLE_FAILURES: ReadonlySet<ArcadeClaimFailure> = new Set([
  'sign-failed',
  'publish-rejected',
  'baseline-unavailable',
  'ledger-unavailable',
  'lock-unavailable',
  'invalid-claim',
]);

/** True when this failure happened before anything could have been published. */
export function isPrePublishFailure(failure: ArcadeClaimFailure): boolean {
  return RETRYABLE_FAILURES.has(failure);
}

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
  /**
   * The ticket quantity read immediately BEFORE the publish attempt.
   *
   * This is the only durable evidence reconciliation has. Without it, "did the
   * grant land?" has no answer at all — which is why a claim whose baseline read
   * failed never publishes (see `baseline-unavailable`).
   */
  readonly quantityBefore: number | null;
  /** How many read-only reconciliation attempts have been made. */
  readonly reconcileAttempts: number;
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
 *  - a durable record for this `runId` already BLOCKS a new grant — claimed,
 *    in flight, or ambiguous. This is the idempotency guarantee, and it is
 *    deliberately wider than "already claimed": a claim that may have been
 *    published is exactly as dangerous to repeat as one that certainly was.
 *
 * An ABORTED run never gets here: an aborted run has no result at all (see
 * `arcade-machine-state.ts`), so there is nothing to pass in.
 */
export function createPendingClaim(
  result: ArcadeGameResult,
  award: TicketAward,
  now: number,
  existing: ArcadeRewardClaim | null = null,
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
  if (existing && blocksNewGrant(existing)) {
    return { ok: false, reason: blockedReason(existing) };
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
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      // A retry after a PRE-publish failure is the same claim, so its attempt
      // count carries forward rather than restarting at zero.
      attempts: existing?.attempts ?? 0,
      failure: null,
      quantityBefore: null,
      reconcileAttempts: existing?.reconcileAttempts ?? 0,
    },
  };
}

/**
 * Whether a recorded claim forbids starting a new grant for the same run.
 *
 * The four blocking statuses, and why each one blocks:
 *
 * | status | why |
 * | --- | --- |
 * | `claimed` | it was paid; paying again is theft from the economy |
 * | `publishing` | a write is in flight in this or another tab |
 * | `verifying` | a write completed and is being checked |
 * | `ambiguous` | a write MAY have completed and cannot be proven either way |
 *
 * Only `pending` (recorded, nothing sent) and `failed` (provably pre-publish)
 * leave the door open.
 */
export function blocksNewGrant(claim: ArcadeRewardClaim): boolean {
  return (
    claim.status === 'claimed' ||
    claim.status === 'publishing' ||
    claim.status === 'verifying' ||
    claim.status === 'ambiguous'
  );
}

function blockedReason(claim: ArcadeRewardClaim): string {
  switch (claim.status) {
    case 'claimed':
      return 'run already claimed';
    case 'ambiguous':
      return 'a previous attempt for this run may already have been published';
    default:
      return 'a claim for this run is already in progress';
  }
}

export type ArcadeClaimEvent =
  /**
   * Start (or retry) a strict publish, recording the baseline quantity.
   *
   * The baseline is REQUIRED. It is the only evidence reconciliation will have,
   * so a caller that could not read it must not reach this event at all.
   */
  | { readonly type: 'begin-publish'; readonly now: number; readonly quantityBefore: number }
  /** The publish resolved strictly; now verify it. */
  | { readonly type: 'begin-verify'; readonly now: number }
  /**
   * The read-back confirmed the quantity moved by exactly the awarded amount.
   * The caller passes the observed quantity; the boundary — not the caller —
   * decides whether "confirmed" is true, against the baseline it recorded.
   */
  | { readonly type: 'confirm'; readonly now: number; readonly quantityAfter: number }
  /**
   * A PRE-PUBLICATION failure. Retryable, because nothing was sent.
   *
   * The boundary refuses to accept a post-publication failure through this
   * event: passing one produces `ambiguous`, not `failed`. That refusal is the
   * fix for the duplicate-grant defect — a caller can no longer mislabel
   * "we don't know" as "it definitely didn't happen".
   */
  | { readonly type: 'fail'; readonly now: number; readonly failure: ArcadeClaimFailure }
  /**
   * The attempt MAY have been published. Terminal until reconciled, and never
   * republishable.
   */
  | { readonly type: 'ambiguous'; readonly now: number; readonly failure: ArcadeClaimFailure }
  /**
   * A READ-ONLY reconciliation observed the current quantity.
   *
   * Confirms only when the evidence is sufficient. Otherwise the claim stays
   * `ambiguous` with one more attempt recorded — it never becomes retryable, and
   * it never publishes.
   */
  | { readonly type: 'reconcile'; readonly now: number; readonly quantityNow: number | null };

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
      // From `pending` and `failed` ONLY. `ambiguous` is deliberately absent:
      // that is the transition whose absence stops a "we don't know" outcome
      // from becoming a second additive grant.
      if (claim.status !== 'pending' && claim.status !== 'failed') return claim;
      if (!Number.isFinite(event.quantityBefore)) return claim;
      return {
        ...claim,
        status: 'publishing',
        attempts: claim.attempts + 1,
        failure: null,
        quantityBefore: event.quantityBefore,
        updatedAt: event.now,
      };

    case 'begin-verify':
      if (claim.status !== 'publishing') return claim;
      return { ...claim, status: 'verifying', updatedAt: event.now };

    case 'confirm': {
      if (claim.status !== 'verifying') return claim;
      const baseline = claim.quantityBefore;
      // No baseline means nothing can be proven. `begin-publish` refuses to run
      // without one, so this is unreachable in practice and is kept as the
      // safe branch rather than an assumption.
      if (baseline === null) {
        return { ...claim, status: 'ambiguous', failure: 'verify-mismatch', updatedAt: event.now };
      }
      // The read-back must show EXACTLY the awarded delta. Anything else means
      // we are looking at a different write, or at a relay that has not caught
      // up — and a claim that cannot prove itself is AMBIGUOUS, not failed.
      if (event.quantityAfter - baseline !== claim.tickets) {
        return { ...claim, status: 'ambiguous', failure: 'verify-mismatch', updatedAt: event.now };
      }
      return { ...claim, status: 'claimed', failure: null, updatedAt: event.now };
    }

    case 'fail':
      // A caller that hands a post-publication failure to `fail` gets
      // `ambiguous` anyway. The boundary, not the caller, decides what is safe
      // to retry.
      if (!isPrePublishFailure(event.failure)) {
        return { ...claim, status: 'ambiguous', failure: event.failure, updatedAt: event.now };
      }
      // A pre-publish failure from a state that has already published would be
      // a mislabelling; refuse rather than downgrade an ambiguous claim.
      if (claim.status === 'verifying' || claim.status === 'ambiguous') return claim;
      return { ...claim, status: 'failed', failure: event.failure, updatedAt: event.now };

    case 'ambiguous':
      return { ...claim, status: 'ambiguous', failure: event.failure, updatedAt: event.now };

    case 'reconcile': {
      if (claim.status !== 'ambiguous') return claim;
      const next = {
        ...claim,
        reconcileAttempts: claim.reconcileAttempts + 1,
        updatedAt: event.now,
      };
      const baseline = claim.quantityBefore;
      if (event.quantityNow === null || baseline === null) return next;
      // Sufficient evidence is "the balance is at least the baseline plus the
      // award". `>=` rather than `===` on purpose: an unrelated grant landing in
      // between can only push the number UP, and erring toward confirming can
      // only ever cost the player a payment they were owed — never pay one
      // twice. Paying twice is the failure mode this whole file exists to stop.
      if (event.quantityNow >= baseline + claim.tickets) {
        return { ...next, status: 'claimed', failure: null };
      }
      return next;
    }
  }
}

/**
 * A claim that may safely be published (or re-published).
 *
 * `ambiguous` is NOT retryable, and that is the entire point.
 */
export function isRetryable(claim: ArcadeRewardClaim): boolean {
  return claim.status === 'failed' || claim.status === 'pending';
}

/** A claim whose only legal next step is a read-only reconciliation. */
export function needsReconciliation(claim: ArcadeRewardClaim): boolean {
  return claim.status === 'ambiguous';
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
