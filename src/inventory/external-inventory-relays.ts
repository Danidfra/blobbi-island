/**
 * Blobbi Island — WHERE other games' inventories live, and how Island reads
 * them.
 *
 * Island's own pool routes every read and write to the one configured relay
 * (`NostrProvider`). That is right for Island's own state and wrong for state
 * another game writes: the Farm publishes `farm:main`, its kind:1417 folds and
 * accepts kind:1416 spends on ITS relay set, and a snapshot that landed on one
 * of those relays but not on Island's would make Island derive a balance
 * from a stale base — or publish a spend where the Farm never looks.
 *
 * So cross-game reads and the spend publish fan out over ONE policy:
 *
 * ```
 *   every trusted partner issuer's relays   (trusted-issuers.ts)
 *   + the relay Island is configured with
 * ```
 *
 * deduplicated, in that order. It is defined here once; nothing else in the
 * cross-game path carries a relay list of its own.
 *
 * Reads merge every relay's answer and deduplicate by event id — relays hold
 * different subsets, and an immutable event delivered by three relays is one
 * event. One relay answering is enough to have AN answer; every relay failing
 * is not an empty result, it is an unusable read and the caller is told so.
 * None of this is a claim of global completeness, which no relay set gives.
 */

import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { RelayReadUnknownError, type RelayReader } from '@/lib/relay-read';

import { dedupeRelayUrls, queryRelays } from './relay-fan-out';
import { TRUSTED_PARTNER_ISSUERS } from './trusted-issuers';

/** Reads have the pool's usual budget; a fan-out is bounded per relay. */
const READ_TIMEOUT_MS = 4000;

/** The relay set for every cross-game read and for publishing spends. */
export function externalInventoryRelays(configuredRelayUrl?: string | null): string[] {
  return dedupeRelayUrls([
    ...TRUSTED_PARTNER_ISSUERS.flatMap((issuer) => issuer.relays),
    configuredRelayUrl,
  ]);
}

/** Keep the first copy of every event id. */
export function dedupeEventsById(events: readonly NostrEvent[]): NostrEvent[] {
  const seen = new Set<string>();
  const out: NostrEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out;
}

export interface ExternalReadResult {
  /** Every relay's events, deduplicated by id. */
  events: NostrEvent[];
  /** At least one relay answered without failing. */
  answered: boolean;
}

/**
 * Query one filter set on every relay, merged and deduplicated.
 *
 * `relayUrls` is a parameter rather than the policy above so a test can drive
 * it with fakes and so a by-id fetch can add the relay hints a fold chain
 * carries.
 */
export async function readFromExternalRelays(
  relayUrls: readonly string[],
  filters: NostrFilter[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ExternalReadResult> {
  const outcomes = await queryRelays(relayUrls, filters, {
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? READ_TIMEOUT_MS,
  });
  return {
    events: dedupeEventsById(outcomes.flatMap((outcome) => outcome.events)),
    answered: outcomes.some((outcome) => outcome.error === undefined),
  };
}

/**
 * A {@link RelayReader} over the cross-game relay set, so the existing
 * discovery read (`fetchExternalInventories`) keeps its signature and its
 * "unknown ≠ empty" semantics: no relay answering throws
 * `RelayReadUnknownError`, exactly as the pool path does.
 */
export function createExternalRelayReader(relayUrls: readonly string[]): RelayReader {
  return {
    async query(filters, opts) {
      const result = await readFromExternalRelays(relayUrls, filters, { signal: opts?.signal });
      if (!result.answered) throw new RelayReadUnknownError('unreachable', 0);
      return result.events;
    },
  };
}

/** Relay hints worth adding to a fetch: well-formed websocket URLs. */
export function usableRelayHints(hints: readonly string[]): string[] {
  return dedupeRelayUrls(hints.filter((hint) => /^wss?:\/\/\S+$/.test(hint)));
}
