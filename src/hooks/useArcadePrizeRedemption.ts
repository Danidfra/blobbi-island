/**
 * `useArcadePrizeRedemption` — the Prize Counter's redemption boundary.
 *
 * The spend-side sibling of `useArcadeReward`, built on the same hard-won
 * rules: a durable record BEFORE anything is published, a synchronous lock
 * against same-tick double-clicks, strict publish with verify read-back, and
 * an unresolved outcome that can only ever be reconciled read-only — never
 * respent. `-40` retried after a publish that actually landed is `-80`.
 *
 * ## The sequence, and why it is in this order
 *
 * ```
 *   eligibility & ledger check
 *     → synchronous same-document lock        two clicks in one tick: one wins
 *     → persist the RESERVED record AND READ IT BACK   no record → publish NOTHING
 *     → read the baseline balance             cannot read → publish NOTHING (retryable)
 *     → persist the SPENDING record AND READ IT BACK   no record → publish NOTHING
 *     → strict spend publish                  a timeout is UNRESOLVED, not failed
 *     → read the balance again                confirmed only on EXACTLY −price
 *     → grant TEMPORARY ownership, per redemption id   (the local store, not inventory)
 *     → VERIFY the delivery was recorded
 *     → persist the CONFIRMED record AND READ IT BACK  no record → recoverable, not "done"
 * ```
 *
 * ## Every persistence point, classified by consequence
 *
 * | write | on failure |
 * | --- | --- |
 * | `reserved` | refuse — publish nothing (retryable, `ledger-unavailable`) |
 * | `spending` (with the baseline) | refuse — publish nothing. This record IS the reconciliation evidence; a spend that published without it could never be reconciled after a refresh |
 * | pre-publish failure transitions | best-effort. The durable record stays `spending`, which hydrates as UNRESOLVED — the safe side; never presented as "may have been spent" in-memory when it provably was not |
 * | post-publish transitions (`spent`, unresolved) | best-effort, and NEVER downgraded to retryable — the durable `spending` record keeps the refusal alive across a refresh |
 * | `delivering` | best-effort. The durable `spent` record plus per-id-idempotent delivery is what guarantees no re-spend |
 * | `confirmed` | REQUIRED for the confirmed UI. Ownership is kept, nothing is spent again, and the state stays a recoverable finalization until the record persists |
 *
 * Tickets are spent BEFORE ownership is granted, so the failure mode the order
 * allows is "paid but not yet delivered" — which the ledger keeps as a
 * `delivering` record that `finishDelivery` can complete WITHOUT spending
 * again. The opposite order could hand out a prize whose payment then failed,
 * and there is no clawback for that.
 *
 * ## Cross-system atomicity does not exist here, and this hook does not
 * pretend it does
 *
 * kind:31633 is a replaceable relay event; temporary ownership is local
 * storage. This machinery protects an honest player from application bugs
 * (double-clicks, remounts, refreshes, ambiguous publishes); it is not
 * anti-fraud and a modified client can bypass all of it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import type { ArcadePrize } from '@/arcade/prizes/prize-catalogue';
import { ARCADE_PRIZE_CATALOGUE_VERSION } from '@/arcade/prizes/prize-catalogue';
import type {
  ArcadePrizeRedemption,
  PrizeSpendFailure,
} from '@/arcade/prizes/prize-redemption';
import {
  advanceRedemption,
  createReservedRedemption,
  isPreSpendFailure,
} from '@/arcade/prizes/prize-redemption';
import {
  acquireRedemptionLock,
  blockingRedemptionForPrize,
  pendingDeliveries,
  persistRedemption,
  releaseRedemptionLock,
} from '@/lib/arcade-redemption-ledger';
import type { ArcadePrizeOwnership } from '@/lib/arcade-prize-ownership';
import { createLocalPrizeOwnership } from '@/lib/arcade-prize-ownership';
import type { ArcadePrizeSpendWriter } from '@/inventory/arcade-prize-spend-writer';
import {
  ArcadePrizeSpendError,
  createArcadePrizeSpendWriter,
} from '@/inventory/arcade-prize-spend-writer';
import { inventoryQueryKey } from '@/inventory/useIslandInventory';

/** The states the counter must render distinctly. */
export type PrizeRedemptionPhase =
  /** Nothing in flight for the represented prize. */
  | 'idle'
  /** A redemption is being recorded and the baseline read. */
  | 'reserving'
  /** The strict spend publish (and its verify read) is in flight. */
  | 'spending'
  /** The spend MAY have been published. Reconcile-only — NEVER respent. */
  | 'spend-unresolved'
  /** A read-only spend-status check is running. */
  | 'checking'
  /** Tickets are spent; the ownership write is running or being retried. */
  | 'delivering'
  /** Tickets are spent but delivery failed; a recovery action is on offer. */
  | 'delivery-recovery'
  /** Spent, delivered, done. */
  | 'confirmed'
  /** Provably nothing was published. Retryable. */
  | 'failed';

export interface PrizeRedemptionUiState {
  readonly phase: PrizeRedemptionPhase;
  /** The prize this state is about, or null when idle with no context. */
  readonly prizeId: string | null;
  readonly redemption: ArcadePrizeRedemption | null;
  readonly failure: PrizeSpendFailure | null;
  /** One sentence, safe to render verbatim. */
  readonly message: string;
}

const IDLE: PrizeRedemptionUiState = {
  phase: 'idle',
  prizeId: null,
  redemption: null,
  failure: null,
  message: '',
};

const UNRESOLVED_COPY =
  'The ticket spend may have been sent, but your inventory has not confirmed it yet. ' +
  'To avoid paying twice, Blobbi Island will not send it again. You can check the status.';

const RECOVERY_COPY =
  'Your tickets were spent, but the prize delivery did not finish. ' +
  'Nothing is lost — you can finish the delivery without paying again.';

const FINALIZE_COPY =
  'Your prize is delivered, but this browser could not record the redemption as finished. ' +
  'Finishing up completes the record — you will not be charged again.';

const FAILURE_COPY: Readonly<Record<PrizeSpendFailure, string>> = {
  'sign-failed': 'Your signer refused the request, so nothing was spent. You can try again.',
  'publish-rejected': 'No relay accepted the spend, so nothing was saved. You can try again.',
  'insufficient-tickets': 'Your inventory does not hold enough Arcade Tickets for this prize.',
  'baseline-unavailable':
    'Your ticket balance could not be read, so nothing was spent. You can try again.',
  'ledger-unavailable':
    'This browser would not save a record of the redemption, so nothing was spent. ' +
    'Free some storage and try again.',
  'invalid-redemption': 'This prize cannot be redeemed.',
  'publish-timeout': UNRESOLVED_COPY,
  'verify-mismatch': UNRESOLVED_COPY,
  'verify-unavailable': UNRESOLVED_COPY,
};

/**
 * Classify what the spend writer threw. Only PROVABLE pre-publish reasons
 * retry — and the proof is `ArcadePrizeSpendError` itself, which the writer
 * throws exclusively from guards that run before `nostr.event()`.
 *
 * `publish-rejected` deserves its own note, because it is the classification
 * a wishful reading of a generic publish error would reach for. Audited
 * against the actual client (the same audit `useArcadeReward` documents):
 * `NPool.event` is `Promise.any(relays…)` and rejects with an AggregateError
 * only when every relay's promise rejects, with no per-relay OK/failure
 * breakdown — and `NRelay1.event` throws an indistinguishable plain `Error`
 * for both an explicit `OK false` and a socket that died AFTER the EVENT
 * frame was written, in which case the relay may well have stored it. So the
 * PRODUCTION writer never throws `publish-rejected`: a generic publication
 * error lands in the `verify-unavailable` fallthrough below and the spend is
 * UNRESOLVED, reconcile-only. The classification exists for writers that CAN
 * prove it — the DEV harness's fake, the tests', or a future client with a
 * per-relay contract.
 */
function classifySpendError(error: unknown): PrizeSpendFailure {
  if (error instanceof ArcadePrizeSpendError) {
    switch (error.reason) {
      case 'sign-failed':
        return 'sign-failed';
      case 'publish-rejected':
        return 'publish-rejected';
      case 'insufficient-tickets':
        return 'insufficient-tickets';
      case 'invalid-price':
      case 'not-logged-in':
        return 'invalid-redemption';
    }
  }
  const name = (error as { name?: string } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return 'publish-timeout';
  // Anything unrecognised may have crossed the publish boundary. The default
  // is deliberately the unsafe-to-retry side.
  return 'verify-unavailable';
}

function phaseForRedemption(redemption: ArcadePrizeRedemption): PrizeRedemptionPhase {
  switch (redemption.status) {
    case 'confirmed':
      return 'confirmed';
    case 'spent':
    case 'delivering':
      return 'delivery-recovery';
    case 'spend-unresolved':
    case 'spending':
      // `spending` from the ledger means a record left mid-flight by a closed
      // or crashed tab: the publish may have happened, so it is unresolved.
      return 'spend-unresolved';
    case 'failed-before-spend':
      return 'failed';
    default:
      return 'idle';
  }
}

export interface UseArcadePrizeRedemptionOptions {
  /** Substitute writer / ownership store, for the DEV harness and tests. */
  readonly writer?: ArcadePrizeSpendWriter;
  readonly ownership?: ArcadePrizeOwnership;
  readonly mintAttemptId?: () => string;
}

let attemptCounter = 0;
function defaultMintAttemptId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  attemptCounter += 1;
  return `attempt-${Date.now()}-${attemptCounter}`;
}

export function useArcadePrizeRedemption(options: UseArcadePrizeRedemptionOptions = {}) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [state, setState] = useState<PrizeRedemptionUiState>(IDLE);
  /** Prize id → grant count, per the TEMPORARY store. */
  const [ownedCounts, setOwnedCounts] = useState<ReadonlyMap<string, number>>(new Map());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const ownership = useMemo<ArcadePrizeOwnership>(
    () => options.ownership ?? createLocalPrizeOwnership(),
    [options.ownership],
  );

  const safeSet = useCallback((next: PrizeRedemptionUiState) => {
    if (mountedRef.current) setState(next);
  }, []);

  const buildWriter = useCallback(
    (): ArcadePrizeSpendWriter =>
      optionsRef.current.writer ??
      createArcadePrizeSpendWriter({
        nostr: nostr as unknown as Parameters<typeof createArcadePrizeSpendWriter>[0]['nostr'],
        user: user as NonNullable<typeof user>,
      }),
    [nostr, user],
  );

  const refreshOwned = useCallback(async () => {
    const pubkey = user?.pubkey;
    if (!pubkey) {
      if (mountedRef.current) setOwnedCounts(new Map());
      return;
    }
    const owned = await ownership.listOwnedPrizes(pubkey);
    if (mountedRef.current) {
      setOwnedCounts(new Map(owned.map((o) => [o.prizeId, o.count])));
    }
  }, [user?.pubkey, ownership]);

  useEffect(() => {
    void refreshOwned();
  }, [refreshOwned]);

  /**
   * Adopt whatever durable state exists for a prize — called when a prize is
   * selected, so an unresolved spend or an undelivered redemption survives
   * closing the counter, remounting, and a refresh instead of presenting a
   * fresh Redeem button over tickets that may already be spent.
   *
   * Takes the PRIZE, not just its id: for a repeatable prize an old confirmed
   * attempt is a finished purchase, so it hydrates to idle (redeemable again)
   * rather than to a permanent `confirmed`.
   */
  const hydrateForPrize = useCallback(
    (prize: ArcadePrize | null) => {
      const pubkey = user?.pubkey;
      if (!prize || !pubkey) {
        safeSet(IDLE);
        return;
      }
      const blocking = blockingRedemptionForPrize(pubkey, prize.id, prize.repeatable === true);
      if (!blocking) {
        safeSet(IDLE);
        return;
      }
      const phase = phaseForRedemption(blocking);
      safeSet({
        phase,
        prizeId: prize.id,
        redemption: blocking,
        failure: blocking.failure,
        message:
          phase === 'confirmed'
            ? ''
            : phase === 'delivery-recovery'
              ? RECOVERY_COPY
              : phase === 'spend-unresolved'
                ? UNRESOLVED_COPY
                : '',
      });
    },
    [user?.pubkey, safeSet],
  );

  /** Redemptions whose tickets are spent but delivery never completed. */
  const listPendingDeliveries = useCallback(
    () => pendingDeliveries(user?.pubkey),
    [user?.pubkey],
  );

  /**
   * Complete the delivery half of a redemption whose spend is already
   * confirmed. Publishes nothing and spends nothing — it may run any number of
   * times for the same record, because the ownership store is idempotent per
   * REDEMPTION ID: retrying this attempt can never grant twice, and (for a
   * repeatable prize) can never eat a later attempt's legitimate increment.
   *
   * The explicit sequence, per the delivery contract:
   *
   *   1. transition to `delivering`, persist best-effort — a failure here is
   *      safe because the durable `spent` record plus per-id idempotency
   *      already guarantee a refresh can finish without spending again;
   *   2. grant ownership for THIS redemption id;
   *   3. VERIFY the delivery was recorded (`hasDelivery`), never assume it;
   *   4. transition to `confirmed` and persist WITH read-back — only that
   *      makes the confirmed UI true. If the final record will not persist,
   *      ownership is kept, nothing is respent, and the state remains a
   *      recoverable finalization instead of a false "done".
   */
  const deliver = useCallback(
    async (
      prize: ArcadePrize,
      redemption: ArcadePrizeRedemption,
    ): Promise<PrizeRedemptionUiState> => {
      const pubkey = user?.pubkey;
      if (!pubkey) return state;
      const settle = (next: PrizeRedemptionUiState): PrizeRedemptionUiState => {
        safeSet(next);
        return next;
      };

      let working = advanceRedemption(redemption, { type: 'begin-delivery', now: Date.now() });
      // Best-effort by design (rule 1 above): refusing delivery on a failed
      // `delivering` write would strand a paid prize over a bookkeeping line.
      persistRedemption(pubkey, working);
      safeSet({
        phase: 'delivering',
        prizeId: prize.id,
        redemption: working,
        failure: null,
        message: 'Wrapping up your prize…',
      });

      let delivered = false;
      try {
        await ownership.grantPrize(pubkey, prize, working.redemptionId);
        // A grant that resolved is still only a claim; the store answers
        // whether THIS attempt is actually on record.
        delivered = await ownership.hasDelivery(pubkey, prize.id, working.redemptionId);
      } catch {
        delivered = false;
      }
      if (!delivered) {
        working = advanceRedemption(working, { type: 'delivery-failed', now: Date.now() });
        persistRedemption(pubkey, working);
        return settle({
          phase: 'delivery-recovery',
          prizeId: prize.id,
          redemption: working,
          failure: null,
          message: RECOVERY_COPY,
        });
      }

      const confirmed = advanceRedemption(working, { type: 'delivery-complete', now: Date.now() });
      if (!persistRedemption(pubkey, confirmed)) {
        // Ownership IS granted and verified; only the final record refused to
        // stick. Never presented as fully confirmed — and never respent: the
        // durable record stays spent/delivering, and a retry re-runs this
        // sequence where the grant is a per-id no-op.
        await refreshOwned();
        return settle({
          phase: 'delivery-recovery',
          prizeId: prize.id,
          redemption: working,
          failure: null,
          message: FINALIZE_COPY,
        });
      }

      await refreshOwned();
      return settle({
        phase: 'confirmed',
        prizeId: prize.id,
        redemption: confirmed,
        failure: null,
        message: `${prize.title} is yours!`,
      });
    },
    [user?.pubkey, ownership, safeSet, refreshOwned, state],
  );

  /**
   * The whole redemption, from explicit confirmation to delivered prize.
   * Resolves with the final UI state; every intermediate state is also pushed
   * through `setState` so the surface can render the journey.
   */
  const redeem = useCallback(
    async (prize: ArcadePrize): Promise<PrizeRedemptionUiState> => {
      const activeUser = user;
      const settle = (next: PrizeRedemptionUiState): PrizeRedemptionUiState => {
        safeSet(next);
        return next;
      };

      if (!activeUser?.pubkey || !activeUser.signer) {
        return settle({
          phase: 'failed',
          prizeId: prize.id,
          redemption: null,
          failure: 'invalid-redemption',
          message: 'Log in to redeem prizes.',
        });
      }
      const pubkey = activeUser.pubkey;

      // ── Durable refusals first ──
      // A repeatable prize's confirmed attempts do not block; everything
      // in-flight, unresolved or undelivered blocks for every prize.
      const blocking = blockingRedemptionForPrize(pubkey, prize.id, prize.repeatable === true);
      if (blocking) {
        const phase = phaseForRedemption(blocking);
        if (phase === 'delivery-recovery') return deliver(prize, blocking);
        return settle({
          phase,
          prizeId: prize.id,
          redemption: blocking,
          failure: blocking.failure,
          message: phase === 'spend-unresolved' ? UNRESOLVED_COPY : '',
        });
      }

      // ── THE same-tick guard ──
      if (!acquireRedemptionLock(pubkey, prize.id)) {
        return {
          phase: 'spending',
          prizeId: prize.id,
          redemption: null,
          failure: null,
          message: 'Already redeeming this prize…',
        };
      }

      try {
        const reserved = createReservedRedemption(
          prize,
          optionsRef.current.mintAttemptId?.() ?? defaultMintAttemptId(),
          ARCADE_PRIZE_CATALOGUE_VERSION,
          Date.now(),
        );
        if (!reserved.ok) {
          return settle({
            phase: 'failed',
            prizeId: prize.id,
            redemption: null,
            failure: 'invalid-redemption',
            message: FAILURE_COPY['invalid-redemption'],
          });
        }
        let redemption = reserved.redemption;

        // ── Durable record is a PREREQUISITE ──
        if (!persistRedemption(pubkey, redemption)) {
          return settle({
            phase: 'failed',
            prizeId: prize.id,
            redemption,
            failure: 'ledger-unavailable',
            message: FAILURE_COPY['ledger-unavailable'],
          });
        }

        safeSet({
          phase: 'reserving',
          prizeId: prize.id,
          redemption,
          failure: null,
          message: 'Checking your tickets…',
        });

        const writer = buildWriter();

        // ── The baseline. Without it nothing can ever be reconciled. ──
        const before = await writer.readTicketQuantity();
        if (before === null) {
          redemption = advanceRedemption(redemption, {
            type: 'spend-failed',
            now: Date.now(),
            failure: 'baseline-unavailable',
          });
          persistRedemption(pubkey, redemption);
          return settle({
            phase: 'failed',
            prizeId: prize.id,
            redemption,
            failure: 'baseline-unavailable',
            message: FAILURE_COPY['baseline-unavailable'],
          });
        }

        redemption = advanceRedemption(redemption, {
          type: 'begin-spend',
          now: Date.now(),
          quantityBefore: before,
        });
        // ── The SPENDING record is a prerequisite for publishing, exactly as
        //    the reserved one is. It carries the baseline, the in-flight
        //    status, the attempt count and the price — the only evidence a
        //    refresh-mid-spend can ever reconcile against. `persistRedemption`
        //    writes AND reads back; if that round trip fails, NOTHING is
        //    published, and the failure is a provably-pre-spend refusal (the
        //    durable state is still the harmless `reserved`). ──
        if (!persistRedemption(pubkey, redemption)) {
          const refused = advanceRedemption(redemption, {
            type: 'spend-failed',
            now: Date.now(),
            failure: 'ledger-unavailable',
          });
          // Best-effort: if even this write fails, the durable record remains
          // `reserved`, which neither blocks nor misleads.
          persistRedemption(pubkey, refused);
          return settle({
            phase: 'failed',
            prizeId: prize.id,
            redemption: refused,
            failure: 'ledger-unavailable',
            message: FAILURE_COPY['ledger-unavailable'],
          });
        }
        safeSet({
          phase: 'spending',
          prizeId: prize.id,
          redemption,
          failure: null,
          message: 'Spending your tickets…',
        });

        try {
          await writer.spendTickets(redemption);
        } catch (error) {
          const failure = classifySpendError(error);
          redemption = advanceRedemption(redemption, {
            type: 'spend-failed',
            now: Date.now(),
            failure,
          });
          // Best-effort on BOTH branches, and safe on both: if this write
          // fails, the durable record remains `spending`, which hydrates as
          // UNRESOLVED after a refresh. For a post-publish failure that is
          // exactly right; for a provably-pre-publish one it is merely
          // conservative — never the reverse, and never a downgrade of a
          // possibly-published spend to retryable.
          persistRedemption(pubkey, redemption);
          return settle({
            phase: isPreSpendFailure(failure) ? 'failed' : 'spend-unresolved',
            prizeId: prize.id,
            redemption,
            failure,
            message: FAILURE_COPY[failure],
          });
        }

        const after = await writer.readTicketQuantity();
        if (after === null) {
          redemption = advanceRedemption(redemption, {
            type: 'spend-failed',
            now: Date.now(),
            failure: 'verify-unavailable',
          });
          // Best-effort: a failed write leaves durable `spending` → unresolved.
          persistRedemption(pubkey, redemption);
          return settle({
            phase: 'spend-unresolved',
            prizeId: prize.id,
            redemption,
            failure: 'verify-unavailable',
            message: UNRESOLVED_COPY,
          });
        }

        // The machine — not this hook — decides whether the numbers prove it.
        redemption = advanceRedemption(redemption, {
          type: 'spend-confirmed',
          now: Date.now(),
          quantityAfter: after,
        });
        // Best-effort: if the `spent` record will not stick, delivery still
        // proceeds (it is idempotent per redemption id) and the durable
        // `spending` record keeps a refresh on the reconcile-only path, where
        // the exact-balance rule re-derives `spent` without a second publish.
        persistRedemption(pubkey, redemption);

        if (redemption.status !== 'spent') {
          return settle({
            phase: 'spend-unresolved',
            prizeId: prize.id,
            redemption,
            failure: redemption.failure ?? 'verify-mismatch',
            message: UNRESOLVED_COPY,
          });
        }

        queryClient.invalidateQueries({ queryKey: inventoryQueryKey(pubkey) });
        return await deliver(prize, redemption);
      } finally {
        releaseRedemptionLock(pubkey, prize.id);
      }
    },
    [user, safeSet, buildWriter, deliver, queryClient],
  );

  /**
   * Read-only reconciliation for an unresolved spend. **Publishes nothing.**
   * If the balance proves the spend landed, the redemption proceeds straight
   * to delivery; otherwise it stays exactly where it was.
   */
  const checkSpendStatus = useCallback(
    async (prize: ArcadePrize): Promise<PrizeRedemptionUiState> => {
      const pubkey = user?.pubkey;
      if (!pubkey) return state;
      const blocking = blockingRedemptionForPrize(pubkey, prize.id, prize.repeatable === true);
      if (!blocking) return state;
      if (blocking.status === 'spent' || blocking.status === 'delivering') {
        return deliver(prize, blocking);
      }
      if (blocking.status !== 'spend-unresolved' && blocking.status !== 'spending') {
        hydrateForPrize(prize);
        return state;
      }

      // A `spending` record left by a crashed tab is unresolved first.
      let working =
        blocking.status === 'spending'
          ? advanceRedemption(blocking, {
              type: 'spend-failed',
              now: Date.now(),
              failure: 'verify-unavailable',
            })
          : blocking;
      if (working !== blocking) persistRedemption(pubkey, working);

      safeSet({
        phase: 'checking',
        prizeId: prize.id,
        redemption: working,
        failure: working.failure,
        message: 'Checking whether the tickets were spent…',
      });

      const quantityNow = await buildWriter().readTicketQuantity();
      working = advanceRedemption(working, { type: 'reconcile', now: Date.now(), quantityNow });
      persistRedemption(pubkey, working);

      if (working.status === 'spent') {
        queryClient.invalidateQueries({ queryKey: inventoryQueryKey(pubkey) });
        return deliver(prize, working);
      }

      const next: PrizeRedemptionUiState = {
        phase: 'spend-unresolved',
        prizeId: prize.id,
        redemption: working,
        failure: working.failure,
        message:
          quantityNow === null
            ? 'Your inventory could not be read just now. Nothing was sent. You can check again.'
            : UNRESOLVED_COPY,
      };
      safeSet(next);
      return next;
    },
    [user?.pubkey, state, deliver, hydrateForPrize, safeSet, buildWriter, queryClient],
  );

  const reset = useCallback(() => safeSet(IDLE), [safeSet]);

  return {
    state,
    /** Prize id → grant count, per the TEMPORARY local store. */
    ownedCounts,
    redeem,
    checkSpendStatus,
    /** Finish a paid-but-undelivered redemption. Never spends. */
    finishDelivery: deliver,
    hydrateForPrize,
    listPendingDeliveries,
    refreshOwned,
    reset,
    isLoggedIn: Boolean(user?.pubkey),
  };
}
