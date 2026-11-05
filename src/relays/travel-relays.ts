/**
 * The relays the kit's world-travel session (kind 31126 / 21124) talks to on
 * the Island: the kit's fixed list, plus the Island's primary relay.
 *
 * The session is not routed through the pool. It keeps its own per-relay
 * census, its own "which relay lacks this" repair, and its own retry limits,
 * so it is handed a list (`WorldTravelRelays`) and left to it.
 *
 * ## The one thing added here: an empty newcomer is not evidence
 *
 * The session treats ONE relay answering as a confirmed read. That was sound
 * while the list was the two relays every Blobbi app has always written
 * locations to. A relay added to the list starts with nothing: if it were the
 * only one to answer, its empty answer would read as "this Blobbi has no
 * location, so it is at home", and the session would sign an arrival that
 * ignores where the Blobbi really is.
 *
 * So the added relay's EMPTY answer counts only when a relay of the kit's own
 * list answered in the same round. Alone, it is reported as no answer, and the
 * session shows "unreachable" instead of inventing a location. An answer WITH
 * events always counts, and once another relay has answered, the empty answer
 * counts too, which is what lets the session's own repair carry the location
 * to the new relay.
 *
 * ## And one thing withheld: the repair is a copy, and copies are opt-in
 *
 * The session repairs a relay that lacks the current location by re-sending
 * the existing signed event. On a page that was merely opened, that is an
 * `EVENT` nobody asked for. So an event a relay has already shown us is not
 * re-sent unless the account chose to have its existing events carried to that
 * relay (`mayCarryTo`). A move the player makes on this page is new, and is
 * published everywhere as before, including its retries within this page.
 */

import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { poolWorldTravelRelays, type PoolWorldTravelOptions, type TravelPoolLike } from '@blobbi-kit/react';
import type { WorldTravelRelays } from '@blobbi-kit/core/world-travel-session';

import { dedupeRelayUrls, normalizeRelayUrl } from './relay-routing';

export interface IslandWorldTravelOptions extends PoolWorldTravelOptions {
  /**
   * Whether the signed-in account agreed to its EXISTING events being copied
   * to this relay. Absent means no: the session then never re-sends a location
   * it found on a relay.
   */
  mayCarryTo?: (relay: string) => boolean;
}

/** The refusal the kit's repair reads as final (a `blocked:` prefix ends its retries for that event). */
export const CARRY_OFF_MESSAGE = 'blocked: copying existing events to relays is off for this account';

export function islandWorldTravelRelays(
  pool: TravelPoolLike,
  primary: string,
  kitRelays: readonly string[],
  options?: IslandWorldTravelOptions,
): WorldTravelRelays {
  const established = dedupeRelayUrls(kitRelays);
  const added = normalizeRelayUrl(primary);
  const isAdded = !!added && !established.includes(added);
  const base = poolWorldTravelRelays(pool, isAdded ? [added, ...established] : established, options);
  /** Each established relay's latest read: resolves to whether it answered. */
  const latest = new Map<string, Promise<boolean>>();
  /** Ids a relay has shown us: events that already existed, as opposed to a move made on this page. */
  const existing = new Set<string>();
  const note = (events: readonly NostrEvent[]) => {
    for (const event of events) existing.add(event.id);
  };

  const subscribe = base.subscribe;
  return {
    ...base,
    async query(url: string, filter: NostrFilter, signal: AbortSignal): Promise<NostrEvent[]> {
      if (!isAdded || url !== added) {
        const asked = base.query(url, filter, signal);
        latest.set(url, asked.then(() => true, () => false));
        const events = await asked;
        note(events);
        return events;
      }
      const events = await base.query(url, filter, signal);
      note(events);
      if (events.length > 0) return events;
      const others = await Promise.all(established.map((relay) => latest.get(relay) ?? Promise.resolve(false)));
      if (!others.some(Boolean)) throw new Error('An empty answer from a newly added relay is not evidence of absence');
      return events;
    },
    async publish(url: string, event: NostrEvent, signal: AbortSignal): Promise<void> {
      // A move signed on this page reaches `publish` before any relay has shown it: that is a new event and
      // always goes out. An event a relay already returned is a copy of something that exists, and copying
      // is the account's choice.
      if (existing.has(event.id) && !options?.mayCarryTo?.(url)) throw new Error(CARRY_OFF_MESSAGE);
      return base.publish(url, event, signal);
    },
    ...(subscribe
      ? {
          subscribe(filters: NostrFilter[], onEvent: (event: unknown) => void): () => void {
            return subscribe.call(base, filters, (event: unknown) => {
              const id = (event as { id?: unknown } | null)?.id;
              if (typeof id === 'string') existing.add(id);
              onEvent(event);
            });
          },
        }
      : {}),
  };
}
