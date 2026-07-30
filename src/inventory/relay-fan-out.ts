/**
 * Blobbi Island — reading from and writing to SEVERAL relays at once.
 *
 * The app's shared `NPool` deliberately routes every request to the single
 * configured relay (see `NostrProvider`), which is right for gameplay traffic
 * and wrong for item definitions: the official kind:31632 events live on
 * `OFFICIAL_ITEM_RELAYS`, and a player whose relay is something else must still
 * see their items. `useItemCatalog` has always solved that by opening
 * short-lived `NRelay1` connections directly; this module is that same
 * orchestration, extracted so the catalog, the definition browser and the
 * publisher share ONE implementation instead of three.
 *
 * It is transport only. Nothing here parses, validates, selects or trusts an
 * event — `@nostr-games/inventory` and `protocol-adapter.ts` keep doing that.
 * What this module adds is per-relay attribution: which relay answered, and
 * for a write, which relay accepted. A diagnostic tool that reports "published"
 * without saying where would be worse than useless.
 */

import { NRelay1 } from '@nostrify/nostrify';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

/** Events returned by one relay, or the reason it returned none. */
export interface RelayQueryOutcome {
  relay: string;
  events: NostrEvent[];
  /** Present when the relay failed, timed out, or refused the connection. */
  error?: string;
}

/** The result of offering one event to one relay. */
export interface RelayPublishOutcome {
  relay: string;
  ok: boolean;
  error?: string;
}

/** Default per-relay budget. Matches the catalog's long-standing 4s. */
const DEFAULT_QUERY_TIMEOUT_MS = 4000;
const DEFAULT_PUBLISH_TIMEOUT_MS = 5000;

/**
 * Query every relay in parallel and report each one's answer separately.
 *
 * A relay that fails contributes an empty list and an error string rather than
 * rejecting the whole batch: partial reach is the normal condition on Nostr,
 * and one unreachable relay must not hide the events another one served.
 *
 * Connections are opened and closed per call. That is deliberately cheap and
 * stateless — these queries are rare (a catalog load, a browser refresh), and a
 * pool of long-lived sockets to relays the app otherwise never uses would be a
 * bigger cost than the handshake it saves.
 */
export async function queryRelays(
  relayUrls: readonly string[],
  filters: NostrFilter[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RelayQueryOutcome[]> {
  const { signal, timeoutMs = DEFAULT_QUERY_TIMEOUT_MS } = options;

  return Promise.all(
    relayUrls.map(async (url): Promise<RelayQueryOutcome> => {
      let relay: NRelay1 | undefined;
      try {
        relay = new NRelay1(url);
        const relaySignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs);
        const events = await relay.query(filters, { signal: relaySignal });
        return { relay: url, events };
      } catch (error) {
        return { relay: url, events: [], error: describeError(error) };
      } finally {
        try {
          await relay?.close();
        } catch {
          // A failed close cannot invalidate events already received.
        }
      }
    }),
  );
}

/**
 * Offer one signed event to every relay in parallel, reporting each outcome.
 *
 * Never throws. A publication that reached two relays out of three is a real,
 * common, and reportable state; collapsing it into a thrown error would force
 * the caller to guess. Deciding what "enough relays" means is the caller's job.
 */
export async function publishToRelays(
  relayUrls: readonly string[],
  event: NostrEvent,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RelayPublishOutcome[]> {
  const { signal, timeoutMs = DEFAULT_PUBLISH_TIMEOUT_MS } = options;

  return Promise.all(
    relayUrls.map(async (url): Promise<RelayPublishOutcome> => {
      let relay: NRelay1 | undefined;
      try {
        relay = new NRelay1(url);
        const relaySignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs);
        await relay.event(event, { signal: relaySignal });
        return { relay: url, ok: true };
      } catch (error) {
        return { relay: url, ok: false, error: describeError(error) };
      } finally {
        try {
          await relay?.close();
        } catch {
          // Closing after a successful publish cannot un-publish it.
        }
      }
    }),
  );
}

/** A short, human-readable reason from an unknown thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return 'Timed out';
    }
    return error.message || error.name;
  }
  return String(error);
}

/** De-duplicate relay URLs while preserving order, dropping blanks. */
export function dedupeRelayUrls(
  urls: readonly (string | undefined | null)[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (!url) continue;
    const trimmed = url.trim();
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
