/**
 * `useArcadeReward`: the claim boundary between a finished run and a ticket
 * balance.
 *
 * ## The defect this file was rebuilt around
 *
 * A manual test produced a **duplicate grant: a 3-ticket reward was added twice,
 * for 6 tickets**. The path was not exotic; it was the ordinary one:
 *
 * ```
 *   publish resolves → read the balance back → the relay has not caught up
 *   → verify-mismatch → recorded as `failed` → `failed` was retryable
 *   → the UI offered "Try again" → a SECOND additive +3 was published
 * ```
 *
 * The previous version of this comment claimed the retry was safe "because the
 * run id is the idempotency key: a retry re-reads the current quantity". **That
 * reasoning was wrong.** Re-reading prevents stale-state clobbering; it does
 * nothing for an ADDITIVE mutation. `+3` applied to a balance that already
 * includes the first `+3` is `+6`. The run id is not in kind:31633, so no relay
 * can know the run was paid.
 *
 * ## The rule now
 *
 * > **Anything that may have crossed the publish boundary is `ambiguous`, and an
 * > ambiguous claim is never republished; only reconciled, read-only.**
 *
 * ```
 *   validate
 *     → synchronous same-document lock          two clicks in one tick: one wins
 *     → cross-tab lock (Web Locks / lease)      a second tab: refused
 *     → ledger check                            claimed/publishing/verifying/ambiguous → refuse
 *     → persist the pending record AND READ IT BACK   no durable record → publish NOTHING
 *     → read the baseline quantity              cannot read → publish NOTHING (retryable)
 *     → strict publish                          a timeout is AMBIGUOUS, not failed
 *     → read the quantity again
 *     → confirm only if it moved by exactly the award; otherwise AMBIGUOUS
 * ```
 *
 * ## Retryable vs reconciliation-only
 *
 * | outcome | may we publish again? |
 * | --- | --- |
 * | `invalid-claim`, `lock-unavailable`, `ledger-unavailable`, `baseline-unavailable`, `sign-failed`, `publish-rejected` | **yes**: provably nothing was sent |
 * | `publish-timeout`, `verify-mismatch`, `verify-unavailable`, anything unclassified | **no**: reconciliation only |
 *
 * The default for an unrecognised error is the unsafe-to-retry side. A failure
 * nobody has classified must not become a second additive write.
 *
 * ## What a confirmed claim proves
 *
 * The signer signed a kind:31633 event; `NPool.event` resolved, which means at
 * least one configured relay accepted it (the pool rejects only when every relay
 * fails); and an independent read showed the ticket quantity exactly `award`
 * higher than the baseline read taken before the write.
 *
 * It does not prove every relay has it, that it survives, or that no concurrent
 * writer will replace it, kind:31633 is replaceable and newest-wins.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import type { ArcadeGameResult } from '@/arcade/types';
import type { ArcadeRewardCalculation } from '@/arcade/reward-policy';
import type {
  ArcadeClaimFailure,
  ArcadeRewardClaim,
  ArcadeRewardWriter,
} from '@/arcade/arcade-reward-boundary';
import {
  advanceClaim,
  blocksNewGrant,
  createPendingClaim,
  isPrePublishFailure,
} from '@/arcade/arcade-reward-boundary';
import {
  acquireClaimLock,
  hasClaimed,
  persistClaim,
  readClaim,
  releaseClaimLock,
  withClaimLock,
} from '@/lib/arcade-claim-ledger';
import {
  ARCADE_TICKET_ADDRESS,
  ArcadeRewardWriterError,
  createArcadeTicketWriter,
} from '@/inventory/arcade-reward-writer';
import { inventoryQueryKey } from '@/inventory/useIslandInventory';

export { ARCADE_TICKET_ADDRESS };

/**
 * The states the results screen must render distinctly.
 *
 * `unresolved` is a first-class phase, not a flavour of `failed`: one says
 * nothing was written and the other must never say that. Conflating them is
 * exactly what caused the duplicate grant.
 */
export type ArcadeRewardPhase =
  /** No claim has been attempted for this run. */
  | 'idle'
  /** A claim is in flight. */
  | 'claiming'
  /** Published AND verified. The tickets are real. */
  | 'confirmed'
  /** Provably nothing was sent. Retryable. */
  | 'failed'
  /** May have been published. Reconciliation only: NEVER republished. */
  | 'unresolved'
  /** A read-only reconciliation is running. */
  | 'checking'
  /** This run was already paid, on this browser. */
  | 'already-claimed';

export interface ArcadeRewardState {
  readonly phase: ArcadeRewardPhase;
  readonly claim: ArcadeRewardClaim | null;
  readonly failure: ArcadeClaimFailure | null;
  /** Tickets this claim is for. `0` when there is nothing to claim. */
  readonly quantity: number;
  /** One sentence, safe to render verbatim. */
  readonly message: string;
  /**
   * Durable storage refused the claim record.
   *
   * This is now FATAL to an attempt rather than a warning: without a durable
   * record the claim would be offered again after a remount or refresh, which is
   * how one additive grant becomes two.
   */
  readonly ledgerUnavailable: boolean;
}

export interface ArcadeClaimAttempt {
  readonly ok: boolean;
  readonly phase: ArcadeRewardPhase;
  readonly failure: ArcadeClaimFailure | null;
  readonly quantity: number;
  /** True when the claim did not publish and may be attempted again. */
  readonly retryable: boolean;
}

const IDLE: ArcadeRewardState = {
  phase: 'idle',
  claim: null,
  failure: null,
  quantity: 0,
  message: '',
  ledgerUnavailable: false,
};

const UNRESOLVED_COPY =
  'The ticket event may have been sent, but your inventory has not confirmed it yet. ' +
  'To avoid adding the reward twice, Blobbi Island will not send another grant for this run. ' +
  'You can check the status again.';

const FAILURE_COPY: Readonly<Record<ArcadeClaimFailure, string>> = {
  // Pre-publication: safe to say nothing was saved, and safe to retry.
  'publish-rejected': 'No relay accepted the tickets, so nothing was saved. You can try again.',
  'sign-failed': 'Your signer refused the request, so nothing was saved. You can try again.',
  'baseline-unavailable':
    'Your inventory could not be read, so nothing was sent. You can try again.',
  'ledger-unavailable':
    'This browser would not save a record of the claim, so nothing was sent. ' +
    'Tickets are only granted once a claim can be recorded, free some storage and try again.',
  'lock-unavailable':
    'Another tab is already claiming this run, so nothing was sent here. Finish it there.',
  'invalid-claim': 'This run cannot be claimed.',
  // Post-publication: all three say the same careful thing.
  'publish-timeout': UNRESOLVED_COPY,
  'verify-mismatch': UNRESOLVED_COPY,
  'verify-unavailable': UNRESOLVED_COPY,
};

/**
 * Turn whatever the writer threw into a failure classification.
 *
 * Only errors that PROVABLY happened before the event could reach a relay are
 * classified as retryable. `ArcadeRewardWriterError` carries that proof: it is
 * thrown by the writer's own guards, all of which run before `nostr.event()`.
 * Anything else: a timeout, an abort, a rejection whose shape we do not
 * recognise: is treated as possibly-published.
 */
function classifyPublishError(error: unknown): ArcadeClaimFailure {
  if (error instanceof ArcadeRewardWriterError) {
    switch (error.reason) {
      case 'sign-failed':
        return 'sign-failed';
      case 'invalid-quantity':
      case 'not-logged-in':
        return 'invalid-claim';
      case 'publish-rejected':
        // Only a writer that can PROVE no relay stored the event throws this.
        return 'publish-rejected';
    }
  }
  const name = (error as { name?: string } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return 'publish-timeout';
  return 'verify-unavailable';
}

/*
 * ## Why an unrecognised publish rejection is treated as possibly-published
 *
 * Read from the actual client, not inferred from error text:
 *
 *  - `NPool.event` (`@nostrify/nostrify/NPool.ts`) is
 *    `await Promise.any(relays.map(r => r.event(...)))`. It rejects with an
 *    `AggregateError` only when EVERY relay's promise rejects, and it surfaces
 *    no per-relay OK/failure breakdown of its own.
 *  - `NRelay1.event` awaits an `ok:<id>` frame and throws `new Error(reason)`
 *    when the relay answers `OK false`. But it throws an indistinguishable
 *    plain `Error` when the socket dies, and an `AbortError`/`TimeoutError` when
 *    the signal fires.
 *
 * So "every sub-error is a plain Error" does NOT mean "every relay refused it":
 * a dropped connection after the `EVENT` frame was written looks identical, and
 * in that case the relay may well have stored the event. There is no way, with
 * this contract, to tell a definitive rejection from an unknown outcome, so the
 * unknown outcome wins, and the claim becomes unresolved rather than retryable.
 *
 * The cost is a claim that stays unresolved when the player was simply offline.
 * The alternative cost is paying a scarce reward twice, which is the defect this
 * file exists to fix.
 */

export interface UseArcadeRewardOptions {
  /**
   * Substitute writer, for the DEV harness and tests.
   *
   * Production passes nothing and gets the real kind:31633 writer. A harness
   * passes a fake and can exercise every branch without a signer, a relay, or a
   * single published event.
   */
  readonly writer?: ArcadeRewardWriter;
}

/** Map a durable record to the phase the UI should show for it. */
function phaseForClaim(claim: ArcadeRewardClaim): ArcadeRewardPhase {
  switch (claim.status) {
    case 'claimed':
      return 'already-claimed';
    case 'ambiguous':
      return 'unresolved';
    case 'publishing':
    case 'verifying':
      // A record left mid-flight by a crashed or closed tab. It blocks a new
      // grant exactly as an ambiguous one does, the write may have happened.
      return 'unresolved';
    default:
      return 'idle';
  }
}

export function useArcadeReward(options: UseArcadeRewardOptions = {}) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ArcadeRewardState>(IDLE);

  // A claim that resolves after the shell has closed must still finish its
  // bookkeeping (the write happened either way) but must not call setState.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const injectedWriter = options.writer;
  const writerRef = useRef(injectedWriter);
  writerRef.current = injectedWriter;

  const safeSet = useCallback((next: ArcadeRewardState) => {
    if (mountedRef.current) setState(next);
  }, []);

  const reset = useCallback(() => safeSet(IDLE), [safeSet]);

  const isAlreadyClaimed = useCallback(
    (runId: string) => hasClaimed(user?.pubkey, runId),
    [user?.pubkey],
  );

  const buildWriter = useCallback(
    (itemAddress: string): ArcadeRewardWriter =>
      writerRef.current ??
      createArcadeTicketWriter({
        nostr: nostr as unknown as Parameters<typeof createArcadeTicketWriter>[0]['nostr'],
        user: user as NonNullable<typeof user>,
        itemAddress,
      }),
    [nostr, user],
  );

  /**
   * Adopt whatever durable state exists for a run.
   *
   * Called when the results screen mounts for a run, so an ambiguous or
   * confirmed claim survives closing the shell, remounting the component, and a
   * full page refresh, instead of presenting a fresh "Claim" button over a run
   * that may already have been paid.
   */
  const hydrate = useCallback(
    (runId: string | null) => {
      if (!runId || !user?.pubkey) {
        safeSet(IDLE);
        return;
      }
      const claim = readClaim(user.pubkey, runId);
      if (!claim) {
        safeSet(IDLE);
        return;
      }
      const phase = phaseForClaim(claim);
      if (phase === 'idle') {
        // `pending` or `failed`: nothing was published, so a normal claim is
        // still on offer. Show the failure copy if there is one.
        safeSet(
          claim.failure
            ? {
                phase: 'failed',
                claim,
                failure: claim.failure,
                quantity: claim.tickets,
                message: FAILURE_COPY[claim.failure],
                ledgerUnavailable: false,
              }
            : IDLE,
        );
        return;
      }
      safeSet({
        phase,
        claim,
        failure: claim.failure,
        quantity: claim.tickets,
        message:
          phase === 'already-claimed'
            ? `${claim.tickets} Arcade Ticket${claim.tickets === 1 ? '' : 's'} were already added for this run.`
            : UNRESOLVED_COPY,
        ledgerUnavailable: false,
      });
    },
    [user?.pubkey, safeSet],
  );

  const claimReward = useCallback(
    async (
      result: ArcadeGameResult,
      calculation: ArcadeRewardCalculation,
    ): Promise<ArcadeClaimAttempt> => {
      // Capture the user for the whole attempt. If the player switches accounts
      // mid-claim, the write still belongs to, and is recorded against, the
      // account that earned it.
      const activeUser = user;
      const runId = result.runId;

      const settle = (
        phase: ArcadeRewardPhase,
        message: string,
        failure: ArcadeClaimFailure | null,
        claim: ArcadeRewardClaim | null,
        quantity: number,
        ledgerUnavailable = false,
      ): ArcadeClaimAttempt => {
        safeSet({ phase, claim, failure, quantity, message, ledgerUnavailable });
        return {
          ok: phase === 'confirmed',
          phase,
          failure,
          quantity,
          retryable: phase === 'failed',
        };
      };

      if (!activeUser?.pubkey || !activeUser.signer) {
        return settle('failed', 'Log in to keep the tickets you earned.', 'invalid-claim', null, 0);
      }
      const pubkey = activeUser.pubkey;

      // ── Durable refusals, checked before anything else ──
      const recorded = readClaim(pubkey, runId);
      if (recorded && blocksNewGrant(recorded)) {
        const phase = phaseForClaim(recorded);
        return settle(
          phase,
          phase === 'already-claimed'
            ? 'You have already claimed this run on this browser.'
            : UNRESOLVED_COPY,
          recorded.failure,
          recorded,
          recorded.tickets,
        );
      }

      if (!calculation.eligible || calculation.quantity <= 0) {
        return settle(
          'failed',
          calculation.ineligibleReason ?? 'This run earned no tickets.',
          'invalid-claim',
          null,
          0,
        );
      }
      if (calculation.runId !== runId || calculation.gameId !== result.gameId) {
        return settle('failed', 'That reward does not belong to this run.', 'invalid-claim', null, 0);
      }

      // THE same-document guard. Synchronous, so two presses inside one tick
      // cannot both pass it; no await and no re-render between check and set.
      if (!acquireClaimLock(pubkey, runId)) {
        return {
          ok: false,
          phase: 'claiming',
          failure: null,
          quantity: calculation.quantity,
          retryable: false,
        };
      }

      try {
        const locked = await withClaimLock(pubkey, runId, Date.now(), async () => {
          // Re-check inside the cross-tab lock: another tab may have written a
          // record between the check above and acquiring it.
          const insideLock = readClaim(pubkey, runId);
          if (insideLock && blocksNewGrant(insideLock)) {
            const phase = phaseForClaim(insideLock);
            return settle(
              phase,
              phase === 'already-claimed'
                ? 'You have already claimed this run on this browser.'
                : UNRESOLVED_COPY,
              insideLock.failure,
              insideLock,
              insideLock.tickets,
            );
          }

          const pending = createPendingClaim(result, calculation.award, Date.now(), insideLock);
          if (!pending.ok) {
            return settle('failed', pending.reason, 'invalid-claim', null, 0);
          }
          let claim = pending.claim;

          // ── Durable record is a PREREQUISITE, not a courtesy ──
          // `persistClaim` writes and reads back. Without a record that survives
          // a refresh, the claim would be offered again, the second half of the
          // duplicate-grant bug.
          if (!persistClaim(pubkey, claim)) {
            return settle(
              'failed',
              FAILURE_COPY['ledger-unavailable'],
              'ledger-unavailable',
              claim,
              claim.tickets,
              true,
            );
          }

          safeSet({
            phase: 'claiming',
            claim,
            failure: null,
            quantity: claim.tickets,
            message: 'Saving your tickets…',
            ledgerUnavailable: false,
          });

          const writer = buildWriter(calculation.itemAddress);

          // ── The baseline. Without it nothing can ever be reconciled, so a
          //    failed baseline read means we publish NOTHING. ──
          const before = await writer.readTicketQuantity();
          if (before === null) {
            claim = advanceClaim(claim, {
              type: 'fail',
              now: Date.now(),
              failure: 'baseline-unavailable',
            });
            persistClaim(pubkey, claim);
            return settle(
              'failed',
              FAILURE_COPY['baseline-unavailable'],
              'baseline-unavailable',
              claim,
              claim.tickets,
            );
          }

          claim = advanceClaim(claim, {
            type: 'begin-publish',
            now: Date.now(),
            quantityBefore: before,
          });
          persistClaim(pubkey, claim);

          try {
            await writer.publishTicketGrant(claim);
          } catch (error) {
            const failure = classifyPublishError(error);
            claim = advanceClaim(
              claim,
              isPrePublishFailure(failure)
                ? { type: 'fail', now: Date.now(), failure }
                : { type: 'ambiguous', now: Date.now(), failure },
            );
            persistClaim(pubkey, claim);
            return settle(
              isPrePublishFailure(failure) ? 'failed' : 'unresolved',
              FAILURE_COPY[failure],
              failure,
              claim,
              claim.tickets,
            );
          }

          claim = advanceClaim(claim, { type: 'begin-verify', now: Date.now() });
          persistClaim(pubkey, claim);

          const after = await writer.readTicketQuantity();
          if (after === null) {
            claim = advanceClaim(claim, {
              type: 'ambiguous',
              now: Date.now(),
              failure: 'verify-unavailable',
            });
            persistClaim(pubkey, claim);
            return settle(
              'unresolved',
              UNRESOLVED_COPY,
              'verify-unavailable',
              claim,
              claim.tickets,
            );
          }

          // The boundary: not this hook, decides whether the numbers add up,
          // against the baseline IT recorded.
          claim = advanceClaim(claim, { type: 'confirm', now: Date.now(), quantityAfter: after });
          persistClaim(pubkey, claim);

          if (claim.status !== 'claimed') {
            return settle(
              'unresolved',
              UNRESOLVED_COPY,
              claim.failure ?? 'verify-mismatch',
              claim,
              claim.tickets,
            );
          }

          queryClient.invalidateQueries({ queryKey: inventoryQueryKey(pubkey) });

          return settle(
            'confirmed',
            `${claim.tickets} Arcade Ticket${claim.tickets === 1 ? '' : 's'} added to your inventory.`,
            null,
            claim,
            claim.tickets,
          );
        });

        if (!locked.acquired) {
          return settle(
            'failed',
            FAILURE_COPY['lock-unavailable'],
            'lock-unavailable',
            readClaim(pubkey, runId),
            calculation.quantity,
          );
        }
        return locked.value!;
      } catch {
        // An unexpected throw inside the locked section. The durable record is
        // the only thing that knows how far the attempt got, so it decides: a
        // record that may have published stays unresolved, and anything else is
        // a clean failure. Guessing "failed" here would reopen the exact door
        // this fix closed.
        const recovered = readClaim(pubkey, runId);
        if (recovered && blocksNewGrant(recovered)) {
          return settle(
            'unresolved',
            UNRESOLVED_COPY,
            recovered.failure ?? 'verify-unavailable',
            recovered,
            recovered.tickets,
          );
        }
        return settle(
          'failed',
          'Something went wrong before the tickets were sent. You can try again.',
          'invalid-claim',
          recovered,
          calculation.quantity,
        );
      } finally {
        releaseClaimLock(pubkey, runId);
      }
    },
    [user, queryClient, safeSet, buildWriter],
  );

  /**
   * Read-only reconciliation for an unresolved claim. **Publishes nothing.**
   *
   * It re-reads the inventory and compares it against the baseline recorded
   * before the original attempt. Sufficient evidence confirms the claim;
   * anything else leaves it exactly where it was. There is deliberately no
   * branch that republishes: if the read cannot prove the grant landed, it also
   * cannot prove it did not, and a conservative unresolved claim is better than
   * paying twice.
   */
  const reconcileClaim = useCallback(
    async (runId: string, itemAddress: string = ARCADE_TICKET_ADDRESS): Promise<ArcadeRewardPhase> => {
      const activeUser = user;
      if (!activeUser?.pubkey) return 'failed';
      const pubkey = activeUser.pubkey;

      const claim = readClaim(pubkey, runId);
      if (!claim) return 'idle';
      if (claim.status === 'claimed') {
        safeSet({
          phase: 'already-claimed',
          claim,
          failure: null,
          quantity: claim.tickets,
          message: `${claim.tickets} Arcade Ticket${claim.tickets === 1 ? '' : 's'} were already added for this run.`,
          ledgerUnavailable: false,
        });
        return 'already-claimed';
      }
      // Only an unresolved claim is reconcilable. `publishing`/`verifying`
      // records left by a crashed tab are treated as ambiguous first.
      let working = claim;
      if (working.status === 'publishing' || working.status === 'verifying') {
        working = advanceClaim(working, {
          type: 'ambiguous',
          now: Date.now(),
          failure: 'verify-unavailable',
        });
        persistClaim(pubkey, working);
      }
      if (working.status !== 'ambiguous') return phaseForClaim(working);

      safeSet({
        phase: 'checking',
        claim: working,
        failure: working.failure,
        quantity: working.tickets,
        message: 'Checking whether the tickets were saved…',
        ledgerUnavailable: false,
      });

      const writer = buildWriter(itemAddress);
      const quantityNow = await writer.readTicketQuantity();

      const next = advanceClaim(working, { type: 'reconcile', now: Date.now(), quantityNow });
      persistClaim(pubkey, next);

      if (next.status === 'claimed') {
        queryClient.invalidateQueries({ queryKey: inventoryQueryKey(pubkey) });
        safeSet({
          phase: 'confirmed',
          claim: next,
          failure: null,
          quantity: next.tickets,
          message: `${next.tickets} Arcade Ticket${next.tickets === 1 ? '' : 's'} are in your inventory.`,
          ledgerUnavailable: false,
        });
        return 'confirmed';
      }

      safeSet({
        phase: 'unresolved',
        claim: next,
        failure: next.failure,
        quantity: next.tickets,
        message:
          quantityNow === null
            ? 'Your inventory could not be read just now. Nothing was sent. You can check again.'
            : UNRESOLVED_COPY,
        ledgerUnavailable: false,
      });
      return 'unresolved';
    },
    [user, buildWriter, queryClient, safeSet],
  );

  return {
    state,
    claimReward,
    reconcileClaim,
    hydrate,
    reset,
    isAlreadyClaimed,
    isLoggedIn: Boolean(user?.pubkey),
  };
}
