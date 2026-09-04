/**
 * Relay reads that can say "I don't know".
 *
 * ## The defect this exists to remove
 *
 * `NPool.query()`: the pool every read in this app goes through, **never
 * throws**. Its own documentation says so:
 *
 * > "If the signal is aborted, this method will return partial results instead
 * > of throwing."
 *
 * and the implementation ends in a bare `catch { }`. So a timeout, a dead
 * socket, a refused subscription and a genuinely empty relay all produce the
 * same value: `[]`. Callers then record that as fact, "this player owns no
 * Blobbis": and the app shows "Your nest is empty" to someone who owns
 * several, or ejects them from a live session.
 *
 * A read has to be able to answer three different things:
 *
 * ```
 *   answered, with events        → we know what exists
 *   answered, with no events     → we know nothing exists   (only after EOSE)
 *   unknown                      → we could not establish the state
 * ```
 *
 * ## How the distinction is obtained
 *
 * From `NRelay.req()`, the lower-level Nostrify API `query()` is built on. It
 * yields raw NIP-01 messages, and `NPool` only forwards `EOSE`/`CLOSED` once
 * EVERY routed relay has sent them:
 *
 * ```
 *   EVENT… then EOSE      → answered (complete for this relay set)
 *   EOSE with no EVENT    → answered-empty  ← the ONLY confirmed empty
 *   our timeout first     → unknown('timeout')      (partialCount may be > 0)
 *   caller aborted        → unknown('aborted')
 *   CLOSED before EOSE    → unknown('closed')       (relay refused the REQ)
 *   iteration threw       → unknown('unreachable')
 * ```
 *
 * The timeout is owned HERE, not delegated to the pool, because the pool
 * swallows the difference. `Machina` (the pool's message queue) throws
 * `AbortError` when its signal aborts and `NPool.req` propagates that, so an
 * aborted read is observable rather than silently truncated.
 *
 * ## What this does NOT claim
 *
 * It cannot prove a relay holds every relevant event. `EOSE` means "this relay
 * has sent everything it intends to send for this REQ": a relay that lost an
 * event, or that was never asked, still EOSEs. The narrower question this
 * answers is the one that was actually being got wrong:
 *
 * > did this read finish in a state we are willing to treat as usable, or did
 * > our own timeout / transport uncertainty make the result unusable?
 *
 * Partial results (events arrived, then we timed out before EOSE) are reported
 * as `unknown` with `partialCount > 0`. For critical state they must not
 * overwrite known-complete data, because "3 of your 5 Blobbis" is a worse lie
 * than "we don't know yet".
 */

import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

/** Why a read could not be treated as usable. */
export type RelayReadUnknownReason =
  /** Our own deadline elapsed before EOSE. */
  | 'timeout'
  /** The caller's signal aborted the read (unmount, query cancellation). */
  | 'aborted'
  /** The relay sent CLOSED before EOSE, the REQ was refused or dropped. */
  | 'closed'
  /** The subscription threw before completing (socket/transport failure). */
  | 'unreachable';

export type RelayReadOutcome =
  /**
   * The relay set completed the REQ (EOSE). `events` is what it holds for
   * these filters: an empty array here is a CONFIRMED empty.
   */
  | { readonly status: 'answered'; readonly events: NostrEvent[] }
  /**
   * The state could not be established. `partialCount` records how many
   * events had arrived; it is diagnostics only and must never be treated as
   * a result.
   */
  | {
      readonly status: 'unknown';
      readonly reason: RelayReadUnknownReason;
      readonly partialCount: number;
    };

/**
 * Thrown by the `…OrThrow` helpers so a TanStack query FAILS instead of
 * resolving with a fabricated empty result, which is what lets React Query
 * retain the previously known-good data.
 *
 * Product UI must not render this message. It only needs to distinguish "we
 * know there are none" from "we could not establish the state"; the reason and
 * partial count are for logs and tests.
 */
export class RelayReadUnknownError extends Error {
  constructor(
    readonly reason: RelayReadUnknownReason,
    readonly partialCount: number = 0,
  ) {
    super(`relay-read-${reason}`);
    this.name = 'RelayReadUnknownError';
  }
}

/** True for the error the `…OrThrow` helpers raise. */
export function isRelayReadUnknown(error: unknown): error is RelayReadUnknownError {
  return error instanceof RelayReadUnknownError;
}

/**
 * The relay surface this module needs.
 *
 * `req` is optional ONLY so that the many existing test fakes which expose
 * just `query` keep working; production always has it (`NPool` implements
 * `NRelay`). Without `req` the completion distinction is impossible, so the
 * fallback treats a resolved `query` as `answered`: the pre-existing, weaker
 * behaviour. Never rely on that path in production code.
 */
export interface RelayReader {
  req?: (
    filters: NostrFilter[],
    opts?: { signal?: AbortSignal },
  ) => AsyncIterable<
    | ['EVENT', string, NostrEvent]
    | ['EOSE', string]
    | ['CLOSED', string, string]
  >;
  query: (
    filters: NostrFilter[],
    opts?: { signal?: AbortSignal },
  ) => Promise<NostrEvent[]>;
}

export interface RelayReadOptions {
  /** Deadline for reaching EOSE. Owned here, never delegated to the pool. */
  readonly timeoutMs?: number;
  /** Caller cancellation (React Query's `c.signal`). */
  readonly signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 3000;

/** Does this pool expose the EOSE-aware API? Used by tests and diagnostics. */
export function supportsCompletionAwareReads(nostr: RelayReader): boolean {
  return typeof nostr.req === 'function';
}

/**
 * Read once, reporting completion honestly.
 *
 * Never throws for relay conditions: every failure mode is returned as
 * `status: 'unknown'`. A caller that wants an exception uses
 * {@link readRelayEventsOrThrow}.
 */
export async function readRelay(
  nostr: RelayReader,
  filters: NostrFilter[],
  options: RelayReadOptions = {},
): Promise<RelayReadOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // No `req` (test fake): we cannot tell completion from truncation. Preserve
  // the historical behaviour rather than inventing certainty.
  if (typeof nostr.req !== 'function') {
    try {
      const events = await nostr.query(filters, { signal: options.signal });
      return { status: 'answered', events };
    } catch {
      return { status: 'unknown', reason: 'unreachable', partialCount: 0 };
    }
  }

  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;

  const events: NostrEvent[] = [];
  try {
    for await (const msg of nostr.req(filters, { signal })) {
      if (msg[0] === 'EVENT') {
        events.push(msg[2]);
        continue;
      }
      if (msg[0] === 'EOSE') {
        // The ONLY path that yields a trustworthy result, empty or not.
        return { status: 'answered', events };
      }
      if (msg[0] === 'CLOSED') {
        return { status: 'unknown', reason: 'closed', partialCount: events.length };
      }
    }
    // The iterator finished without EOSE; no relay was routed, or the
    // subscription ended early. Not a completion.
    return { status: 'unknown', reason: 'unreachable', partialCount: events.length };
  } catch {
    // `Machina` throws AbortError when the signal aborts; anything else is a
    // transport failure. Attribute it to whichever signal actually fired.
    const reason: RelayReadUnknownReason = deadline.aborted
      ? 'timeout'
      : options.signal?.aborted
        ? 'aborted'
        : 'unreachable';
    return { status: 'unknown', reason, partialCount: events.length };
  }
}

/**
 * Read, throwing {@link RelayReadUnknownError} when the state could not be
 * established. This is the shape TanStack query functions want: a rejected
 * query keeps the previous `data`, whereas a resolved `[]` destroys it.
 */
export async function readRelayEventsOrThrow(
  nostr: RelayReader,
  filters: NostrFilter[],
  options: RelayReadOptions = {},
): Promise<NostrEvent[]> {
  const outcome = await readRelay(nostr, filters, options);
  if (outcome.status === 'unknown') {
    throw new RelayReadUnknownError(outcome.reason, outcome.partialCount);
  }
  return outcome.events;
}

/**
 * Read with CONFIRMED-EMPTY semantics, for state whose false absence is
 * destructive (ownership lists, the companion profile, an inventory publish
 * base).
 *
 * ```
 *   answered non-empty            → accept immediately (one read)
 *   answered empty → read again
 *        second answered empty    → CONFIRMED empty
 *        second answered non-empty→ accept the non-empty answer
 *        second unknown           → unknown (NOT empty)
 *   unknown                       → unknown
 * ```
 *
 * Bounded to exactly two reads: no loop, no backoff, no sleep. Only the empty
 * branch pays the second round-trip, so the common case costs nothing extra.
 * This is the read-side twin of the kind:31633 publish-base rule.
 */
export async function readRelayConfirmed(
  nostr: RelayReader,
  filters: NostrFilter[],
  options: RelayReadOptions = {},
): Promise<RelayReadOutcome> {
  const first = await readRelay(nostr, filters, options);
  if (first.status === 'unknown') return first;
  if (first.events.length > 0) return first;
  return await readRelay(nostr, filters, options);
}

/** {@link readRelayConfirmed}, throwing on unknown. See the semantics above. */
export async function readRelayConfirmedOrThrow(
  nostr: RelayReader,
  filters: NostrFilter[],
  options: RelayReadOptions = {},
): Promise<NostrEvent[]> {
  const outcome = await readRelayConfirmed(nostr, filters, options);
  if (outcome.status === 'unknown') {
    throw new RelayReadUnknownError(outcome.reason, outcome.partialCount);
  }
  return outcome.events;
}
