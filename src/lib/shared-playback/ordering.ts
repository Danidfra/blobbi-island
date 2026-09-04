/**
 * Total order over shared-playback events (§7).
 *
 * `created_at` alone is never sufficient: a host can hit pause, seek and play
 * inside one second, and second-resolution timestamps cannot order those. `rev`
 * can: it is incremented once per canonical action, and both events for one
 * action carry the same value. This mirrors the `seq` mechanism island presence
 * already uses for exactly the same reason (`src/lib/multiplayer.ts`).
 */

/** The three ordering keys, in the order they are consulted. */
export interface RevisionOrder {
  rev: number;
  /** Unix seconds. */
  createdAt: number;
  /** Hex event id, the final tie-break, so every client picks the same one. */
  eventId: string;
}

/** `-1` when `a` is older, `1` when newer, `0` when they are the same event. */
export function compareRevisions(a: RevisionOrder, b: RevisionOrder): -1 | 0 | 1 {
  if (a.rev !== b.rev) return a.rev < b.rev ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.eventId !== b.eventId) return a.eventId < b.eventId ? -1 : 1;
  return 0;
}

/**
 * Should this canonical event replace the one we hold?
 *
 * Equal `rev` with a later `created_at` is the normal keepalive: the host
 * republishes the current state with a refreshed anchor and expiration, and
 * adopting it keeps the extrapolation accurate. Rules 2–3 also settle the
 * pathological case §7 calls a protocol violation (two different states under
 * one `rev`) identically on every client.
 */
export function isNewerCanonical(known: RevisionOrder | null, incoming: RevisionOrder): boolean {
  if (!known) return true;
  return compareRevisions(incoming, known) > 0;
}

/**
 * A command or state only ever *moves* the player when its revision is strictly
 * greater than the last one applied. Equal is a no-op; it is the matching half
 * of a pair already applied, or a publish retry. Lower is stale.
 */
export function isStaleRevision(lastAppliedRev: number, rev: number): boolean {
  return rev <= lastAppliedRev;
}

/**
 * Bounded "have I already handled this event id?" memory.
 *
 * Relays re-deliver: a reconnect replays, a fallback poller overlaps its own
 * window, and `nostr.req` can hand the same event to two subscriptions. Applying
 * a command twice is harmless by construction (absolute positions), but the
 * clock-sample stream and the debug log both lie if duplicates are counted, so
 * they are dropped at the door.
 */
export function createEventDedupe(limit = 128) {
  const seen = new Set<string>();
  const order: string[] = [];

  return {
    /** Records the id and answers whether it had already been seen. */
    check(eventId: string): boolean {
      if (seen.has(eventId)) return true;
      seen.add(eventId);
      order.push(eventId);
      if (order.length > limit) {
        const evicted = order.shift();
        if (evicted !== undefined) seen.delete(evicted);
      }
      return false;
    },
    reset(): void {
      seen.clear();
      order.length = 0;
    },
    get size(): number {
      return seen.size;
    },
  };
}
