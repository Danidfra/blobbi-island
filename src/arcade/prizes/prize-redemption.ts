/**
 * The Prize Counter's redemption contract — pure eligibility and a pure state
 * machine, with **no I/O of any kind**.
 *
 * The shape deliberately mirrors `arcade-reward-boundary.ts`, the claim
 * machine that already survived a real duplicate-grant defect, because a spend
 * has the same failure physics as a grant run in reverse: the kind:31633 event
 * is a plain replaceable list of quantities, a resolved publish is not proof,
 * and an unresolved outcome must NEVER be retried — a `-40` retried after a
 * publish that actually landed is `-80`.
 *
 * ## The lifecycle
 *
 * ```
 *   reserved ── begin-spend ──▶ spending
 *      │                          │  spend-confirmed (after === before − price)
 *      │                          ▼
 *      │                        spent ── begin-delivery ──▶ delivering
 *      │                          ▲                            │ delivery-complete
 *      │       reconcile          │                            ▼
 *      │ (now === before − price, │                        confirmed  (terminal
 *      │  EXACTLY — see below)    │                         for THIS attempt)
 *      │                          │
 *      │                   spend-unresolved  ◀── spending, on timeout/mismatch
 *      │                     (reconcile-only, NEVER respent)
 *      ▼
 *   failed-before-spend  (retryable — provably nothing was published)
 * ```
 *
 * `delivering` is the honest name for "the tickets are spent but the prize has
 * not been handed over": the redemption is NOT lost, the ledger keeps the
 * record, and delivery may be retried without spending again.
 *
 * ## Two kinds of delivery, one machine
 *
 * The lifecycle above assumes the spend and the delivery are SEPARATE writes,
 * which is true for the Arcade Pass: tickets live in kind:31633 and an expiring
 * allowance does not, so there is a real gap between paying and receiving.
 *
 * A kind:31633 COSMETIC prize is different: the ticket debit and the prize
 * grant are the same replaceable event, so they land together or not at all.
 * That variant reuses every state here — the record, the lock, the strict
 * publish, the never-respend rule — and differs in exactly one place:
 * {@link PrizeRedemptionEvent} `reconcile-atomic`, which reconciles against
 * the PRIZE rather than against a balance other writers also move. See its
 * doc comment for why that is both stronger and safer.
 *
 * ## What this module does not know
 *
 * Storage, relays, React, the clock (every transition takes `now`), or what a
 * prize IS beyond the fields eligibility needs. `boundaries.test.ts` enforces
 * the imports.
 */

import type { ArcadePrize } from './prize-catalogue';

// ── Eligibility ────────────────────────────────────────────────────────────

export type PrizeIneligibleReason =
  | 'logged-out'
  | 'coming-soon'
  | 'owned'
  | 'balance-unavailable'
  | 'insufficient-tickets'
  | 'invalid-price';

export type PrizeEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: PrizeIneligibleReason };

export interface PrizeEligibilityInput {
  readonly prize: ArcadePrize;
  /** Current ticket balance, or `null` when it could not be read. */
  readonly balance: number | null;
  /** The player already owns this prize (temporary store). */
  readonly owned: boolean;
  readonly loggedIn: boolean;
}

/**
 * May this prize be redeemed right now?
 *
 * Checks are ordered so the reason a player sees is the most actionable one:
 * log in first, availability next, ownership, then the balance. An unavailable
 * balance is its own reason — "we could not check" must never be presented as
 * "you cannot afford it".
 */
export function evaluatePrizeEligibility(input: PrizeEligibilityInput): PrizeEligibility {
  const { prize, balance, owned, loggedIn } = input;
  if (!Number.isInteger(prize.price) || prize.price <= 0) {
    return { eligible: false, reason: 'invalid-price' };
  }
  if (!loggedIn) return { eligible: false, reason: 'logged-out' };
  if (prize.availability !== 'available') return { eligible: false, reason: 'coming-soon' };
  if (owned && !prize.repeatable) return { eligible: false, reason: 'owned' };
  if (balance === null) return { eligible: false, reason: 'balance-unavailable' };
  if (balance < prize.price) return { eligible: false, reason: 'insufficient-tickets' };
  return { eligible: true };
}

// ── The redemption record and its transitions ──────────────────────────────

export type PrizeRedemptionStatus =
  /** Recorded locally; nothing has been sent. */
  | 'reserved'
  /** A strict spend publish is in flight (or being verified). */
  | 'spending'
  /** The spend MAY have been published. Reconcile-only, never respent. */
  | 'spend-unresolved'
  /** The spend is confirmed on a relay; delivery has not started. */
  | 'spent'
  /** Tickets are spent; the ownership write has not completed. Recoverable. */
  | 'delivering'
  /** Spent, delivered, done. Terminal and one-way. */
  | 'confirmed'
  /** Something failed provably BEFORE any publish. Retryable. */
  | 'failed-before-spend';

export type PrizeSpendFailure =
  | 'sign-failed'
  | 'publish-rejected'
  | 'insufficient-tickets'
  /** The player already holds this unique prize. Refused before any publish. */
  | 'already-owned'
  | 'baseline-unavailable'
  | 'ledger-unavailable'
  | 'invalid-redemption'
  | 'publish-timeout'
  | 'verify-mismatch'
  | 'verify-unavailable';

/** Failures that provably happened before anything could have been published. */
export const RETRYABLE_SPEND_FAILURES: ReadonlySet<PrizeSpendFailure> = new Set([
  'sign-failed',
  'publish-rejected',
  'insufficient-tickets',
  'already-owned',
  'baseline-unavailable',
  'ledger-unavailable',
  'invalid-redemption',
]);

export function isPreSpendFailure(failure: PrizeSpendFailure): boolean {
  return RETRYABLE_SPEND_FAILURES.has(failure);
}

/**
 * One redemption attempt, as persisted by the ledger. Plain JSON.
 *
 * The identity is `prizeId` + `attemptId`; the price and catalogue version are
 * FROZEN at reservation, so a later price change can never alter what an
 * in-flight redemption spends.
 */
export interface ArcadePrizeRedemption {
  /** `${prizeId}:${attemptId}` — stable across every phase of one attempt. */
  readonly redemptionId: string;
  readonly prizeId: string;
  readonly attemptId: string;
  /** Tickets to spend. Fixed at reservation; never recomputed. */
  readonly price: number;
  readonly catalogueVersion: string;
  readonly status: PrizeRedemptionStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Publish attempts made. */
  readonly attempts: number;
  readonly failure: PrizeSpendFailure | null;
  /**
   * The ticket balance read immediately BEFORE the spend publish. The only
   * durable evidence reconciliation has; a spend with no baseline never
   * publishes.
   */
  readonly quantityBefore: number | null;
  readonly reconcileAttempts: number;
}

export type PrizeRedemptionOutcome =
  | { readonly ok: true; readonly redemption: ArcadePrizeRedemption }
  | { readonly ok: false; readonly reason: string };

/**
 * Record a redemption, before anything is sent anywhere.
 *
 * Refuses a prize that is not priced sanely, a blank attempt id, and an
 * existing record for the same attempt — the caller mints a fresh attempt id
 * per explicit confirmation, so an id collision means a bug, not a retry.
 */
export function createReservedRedemption(
  prize: ArcadePrize,
  attemptId: string,
  catalogueVersion: string,
  now: number,
): PrizeRedemptionOutcome {
  if (!Number.isInteger(prize.price) || prize.price <= 0) {
    return { ok: false, reason: 'prize has no valid price' };
  }
  if (typeof attemptId !== 'string' || attemptId.trim().length === 0) {
    return { ok: false, reason: 'attempt id must be a non-empty string' };
  }
  if (!Number.isFinite(now) || now <= 0) {
    return { ok: false, reason: 'invalid timestamp' };
  }
  return {
    ok: true,
    redemption: {
      redemptionId: `${prize.id}:${attemptId}`,
      prizeId: prize.id,
      attemptId,
      price: prize.price,
      catalogueVersion,
      status: 'reserved',
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      failure: null,
      quantityBefore: null,
      reconcileAttempts: 0,
    },
  };
}

export type PrizeRedemptionEvent =
  /** Start the strict spend, recording the baseline balance. REQUIRED. */
  | { readonly type: 'begin-spend'; readonly now: number; readonly quantityBefore: number }
  /**
   * The read-back after the publish. The MACHINE decides whether the numbers
   * prove the spend: exactly `before − price` confirms; anything else is
   * unresolved, not failed.
   */
  | { readonly type: 'spend-confirmed'; readonly now: number; readonly quantityAfter: number }
  /** A failure. Pre-spend failures go to `failed-before-spend`; the rest to unresolved. */
  | { readonly type: 'spend-failed'; readonly now: number; readonly failure: PrizeSpendFailure }
  /** Read-only reconciliation observed the current balance. Never publishes. */
  | { readonly type: 'reconcile'; readonly now: number; readonly quantityNow: number | null }
  /**
   * Read-only reconciliation for an ATOMIC redemption — one where the ticket
   * debit and the prize grant ride on the SAME kind:31633 replacement event.
   * Never publishes.
   *
   * `owned` is evidence about THIS redemption in a way a balance can never be:
   * the event either landed (both halves present) or it did not (neither).
   * `quantityNow` is the ticket balance, used only for the negative proof.
   */
  | {
      readonly type: 'reconcile-atomic';
      readonly now: number;
      /** Does the inventory hold the prize? `false` when it could not be read. */
      readonly owned: boolean;
      /** Ticket balance now, or `null` when the read failed. */
      readonly quantityNow: number | null;
    }
  /** The spend is confirmed; the ownership write is starting. */
  | { readonly type: 'begin-delivery'; readonly now: number }
  /** The ownership write completed. */
  | { readonly type: 'delivery-complete'; readonly now: number }
  /** The ownership write failed. The redemption stays recoverable. */
  | { readonly type: 'delivery-failed'; readonly now: number };

/**
 * The transition function. Pure, exhaustive, and one-way in the direction that
 * matters: nothing reaches `spent` except numbers that add up, and nothing in
 * `spend-unresolved` can ever publish again.
 */
export function advanceRedemption(
  redemption: ArcadePrizeRedemption,
  event: PrizeRedemptionEvent,
): ArcadePrizeRedemption {
  // Terminal. Late events — a duplicate delivery-complete, a stale timer —
  // cannot reopen a confirmed redemption.
  if (redemption.status === 'confirmed') return redemption;

  switch (event.type) {
    case 'begin-spend':
      // From `reserved` and `failed-before-spend` ONLY. `spend-unresolved` is
      // deliberately absent: that is the missing transition that stops a
      // "we don't know" outcome from becoming a second spend.
      if (redemption.status !== 'reserved' && redemption.status !== 'failed-before-spend') {
        return redemption;
      }
      if (!Number.isFinite(event.quantityBefore)) return redemption;
      return {
        ...redemption,
        status: 'spending',
        attempts: redemption.attempts + 1,
        failure: null,
        quantityBefore: event.quantityBefore,
        updatedAt: event.now,
      };

    case 'spend-confirmed': {
      if (redemption.status !== 'spending') return redemption;
      const baseline = redemption.quantityBefore;
      if (baseline === null || baseline - redemption.price !== event.quantityAfter) {
        return {
          ...redemption,
          status: 'spend-unresolved',
          failure: 'verify-mismatch',
          updatedAt: event.now,
        };
      }
      return { ...redemption, status: 'spent', failure: null, updatedAt: event.now };
    }

    case 'spend-failed': {
      if (!isPreSpendFailure(event.failure)) {
        return {
          ...redemption,
          status: 'spend-unresolved',
          failure: event.failure,
          updatedAt: event.now,
        };
      }
      // A pre-spend failure reported from a state that already published would
      // be a mislabelling; refuse rather than downgrade an unresolved spend.
      if (redemption.status === 'spend-unresolved' || redemption.status === 'spent') {
        return redemption;
      }
      return {
        ...redemption,
        status: 'failed-before-spend',
        failure: event.failure,
        updatedAt: event.now,
      };
    }

    case 'reconcile': {
      if (redemption.status !== 'spend-unresolved') return redemption;
      const next = {
        ...redemption,
        reconcileAttempts: redemption.reconcileAttempts + 1,
        updatedAt: event.now,
      };
      const baseline = redemption.quantityBefore;
      if (event.quantityNow === null || baseline === null) return next;
      // EXACTLY `baseline − price`, and nothing else. An earlier revision
      // accepted any drop of "at least the price", which misattributes
      // unrelated balance changes to THIS spend: baseline 100, price 40, this
      // publish never landed, another tab spends 50 → balance 50 ≤ 60 would
      // have delivered a prize that was never paid for. A drop by more, by
      // less, no drop, or a rise all stay unresolved — they are evidence of
      // OTHER writes, not of this one.
      //
      // Even exact equality is limited evidence: kind:31633 carries no
      // operation identity, so a coincidental combination of writes could land
      // on the same number. It is, honestly, the most conservative rule a
      // balance-only reconciliation can have; anything stronger needs the
      // deferred grant/redemption protocol.
      if (event.quantityNow === baseline - redemption.price) {
        return { ...next, status: 'spent', failure: null };
      }
      return next;
    }

    case 'reconcile-atomic': {
      if (redemption.status !== 'spend-unresolved') return redemption;
      const next = {
        ...redemption,
        reconcileAttempts: redemption.reconcileAttempts + 1,
        updatedAt: event.now,
      };
      // POSITIVE proof. The prize is granted by the spend's own event and by
      // nothing else, so holding it means that event landed — and because it
      // landed WHOLE, the tickets are spent and the prize is delivered. This
      // is strictly stronger evidence than the balance rule above, which can
      // only ever say "the number is consistent with my spend".
      if (event.owned) return { ...next, status: 'spent', failure: null };

      // NEGATIVE proof, and it needs BOTH halves to be missing. One event
      // carries the debit and the grant together: an untouched balance beside
      // an absent prize is the post-state of an inventory this redemption
      // never reached, so nothing was spent and a fresh attempt is safe.
      //
      // A drop, a rise, or an unreadable balance all stay unresolved. The
      // residual risk is a LATER kind:31633 write built from a stale base
      // (another device, outside this tab's lock) that both restored the
      // balance and removed the prize; that is the same replaceable-event
      // hazard every writer here lives with, and it is far narrower than the
      // balance-only rule's "some combination of writes hit the same number".
      const baseline = redemption.quantityBefore;
      if (
        event.quantityNow !== null &&
        baseline !== null &&
        event.quantityNow === baseline
      ) {
        return { ...next, status: 'failed-before-spend', failure: null };
      }
      return next;
    }

    case 'begin-delivery':
      if (redemption.status !== 'spent' && redemption.status !== 'delivering') return redemption;
      return { ...redemption, status: 'delivering', updatedAt: event.now };

    case 'delivery-complete':
      if (redemption.status !== 'delivering' && redemption.status !== 'spent') return redemption;
      return { ...redemption, status: 'confirmed', failure: null, updatedAt: event.now };

    case 'delivery-failed':
      if (redemption.status !== 'delivering') return redemption;
      // Stay in `delivering`: the tickets ARE spent, the record must survive,
      // and delivery may be retried without spending again.
      return { ...redemption, updatedAt: event.now };
  }
}

/**
 * Does this record forbid STARTING a new redemption of the same prize?
 *
 * Everything from "a spend may be in flight" to "paid but not delivered"
 * blocks unconditionally; `reserved` (nothing sent, likely an abandoned
 * confirmation) and `failed-before-spend` (provably nothing sent) leave the
 * door open. `confirmed` blocks a NON-repeatable prize forever — but for a
 * repeatable one it is a finished purchase, not a lock: `confirmed` is
 * terminal for one ATTEMPT, and a new explicit attempt (with a fresh attempt
 * id and its own record) is allowed.
 */
export function blocksNewRedemption(
  redemption: ArcadePrizeRedemption,
  prizeRepeatable = false,
): boolean {
  if (redemption.status === 'confirmed') return !prizeRepeatable;
  return (
    redemption.status === 'spending' ||
    redemption.status === 'spend-unresolved' ||
    redemption.status === 'spent' ||
    redemption.status === 'delivering'
  );
}

/** Spent but not delivered — the record a recovery pass must finish. */
export function needsDelivery(redemption: ArcadePrizeRedemption): boolean {
  return redemption.status === 'spent' || redemption.status === 'delivering';
}

/** May the spend be attempted (or re-attempted)? Unresolved is NOT retryable. */
export function isSpendRetryable(redemption: ArcadePrizeRedemption): boolean {
  return redemption.status === 'reserved' || redemption.status === 'failed-before-spend';
}
