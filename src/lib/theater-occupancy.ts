/**
 * Who is visually sitting where in the theater, right now.
 *
 * ## Visual occupancy, not a reservation system
 *
 * Everything here is derived from **live presence plus the local seat state**,
 * and it is thrown away and recomputed whenever either changes. It reserves
 * nothing, grants nothing and is never written back to a relay. A seat is
 * "occupied" here in exactly the sense a chair in a room is occupied: someone is
 * currently drawn in it.
 *
 * That boundary is deliberate and is the reason kind 31950 stays a presence
 * event. Authoritative seating, "this seat is MINE until I release it", would
 * need a writer, a conflict protocol and a release path, and would make an
 * ordinary network hiccup able to lock a chair. Shared playback gets its
 * authority from the session event (kind 31951, NOT implemented yet); seating
 * gets its truth from who is visibly there. See
 * `docs/protocol/shared-playback-session.md` §14.1.
 *
 * ## Duplicate claims
 *
 * Nothing stops two players walking into the same chair; there is no
 * reservation, by design. When that happens every client must still draw at most
 * ONE Blobbi per seat, or two sprites overlap at the same anchor and the room
 * looks broken. {@link resolveRemoteSeatOccupancy} is that rule, and it is a
 * pure function so every client computes the same answer from the same presence:
 *
 *  1. **The local player always keeps their own seat on their own screen.**
 *     Presence is advisory; a stranger's claim must never be able to stand you
 *     up, turn your Blobbi around or tear down your control card. A remote
 *     claiming the seat the local player occupies is therefore dropped here.
 *  2. **Among the remaining remote claimants of one seat, the lowest hex pubkey
 *     wins** (ties broken by session id, which is unique per browser session).
 *     Lexicographic order over a hex string is total and identical everywhere,
 *     so no exchange or negotiation is needed.
 *  3. **Losers fall back to normal presence-position rendering**: they are
 *     still in the room, still walking around, just not drawn in that chair.
 *
 * The visible consequence, stated plainly: if A and B both sit in seat X, A sees
 * itself seated and B standing, B sees itself seated and A standing, and every
 * third party sees exactly one seated Blobbi (whichever of A/B has the lower
 * pubkey). No client ever draws two seated Blobbis in one chair. The asymmetry
 * between the two conflicting players is the price of rule 1, and rule 1 is
 * worth it: local state is the only thing in this system that is actually
 * certain.
 *
 * ## Staleness
 *
 * There is no expiry logic here at all, on purpose. Claims come from the live
 * presence map, which is already self-cleaning: NIP-40 expiration (35 s) plus
 * `useIslandPresence`'s per-second sweep of anything older than `EXP_SECONDS + 5`.
 * A player who closes their tab stops publishing, their presence ages out, they
 * leave `players`, and their seat is released by that alone; no timer here, and
 * no way for this module and presence to disagree about who is still around.
 */

import { isOccupiableSeat } from '@/lib/theater-seats-config';

/** One remote player's claim to be sitting in a seat. */
export interface RemoteSeatClaim {
  /** Canonical theater seat id, as published in presence (`seatId`). */
  seatId: string;
  pubkey: string;
  sessionId: string;
}

/**
 * Resolve which REMOTE claim (if any) is drawn in each seat.
 *
 * @param claims       Seat claims from currently-active remote presence.
 * @param localSeatId  The seat the local player occupies, or null. Claims on it
 *                     are dropped: see rule 1 above.
 * @returns            seatId → the single winning remote claim.
 */
export function resolveRemoteSeatOccupancy(
  claims: readonly RemoteSeatClaim[],
  localSeatId: string | null | undefined,
): Map<string, RemoteSeatClaim> {
  const winners = new Map<string, RemoteSeatClaim>();

  for (const claim of claims) {
    // Unknown ids and decorative chairs are not seats anyone can occupy. This is
    // the same guard `resolveSeatedRender` applies at render time; both run,
    // because occupancy and rendering must never disagree about what a seat is.
    if (!isOccupiableSeat(claim.seatId)) continue;
    // Rule 1: the local player's seat is not up for grabs on this client.
    if (localSeatId && claim.seatId === localSeatId) continue;

    const current = winners.get(claim.seatId);
    if (!current || comparePriority(claim, current) < 0) {
      winners.set(claim.seatId, claim);
    }
  }

  return winners;
}

/** Rule 2: lowest hex pubkey wins, ties broken by session id. */
function comparePriority(a: RemoteSeatClaim, b: RemoteSeatClaim): number {
  if (a.pubkey !== b.pubkey) return a.pubkey < b.pubkey ? -1 : 1;
  if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1;
  return 0;
}

/**
 * The set of seats that should LOOK occupied, remote winners plus the local
 * player's own seat.
 *
 * This is what the chairs themselves read. It is intentionally a set of ids and
 * not a map to a person: a chair only needs to know that it is taken.
 */
export function occupiedSeatIds(
  remoteWinners: ReadonlyMap<string, RemoteSeatClaim>,
  localSeatId: string | null | undefined,
): Set<string> {
  const ids = new Set(remoteWinners.keys());
  if (localSeatId && isOccupiableSeat(localSeatId)) ids.add(localSeatId);
  return ids;
}
