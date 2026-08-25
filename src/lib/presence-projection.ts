/**
 * What presence is allowed to say — the one place `detailedPresence` is decided.
 *
 * Presence is the island's most continuous disclosure: a kind 31950 event every
 * move and every twenty-five seconds, public, on a relay, for as long as a
 * player is on screen. This module is the admission step between the full local
 * runtime state and the wire.
 *
 * ## The rule is subtraction, not reduction
 *
 * The island stays a real multiplayer game under every policy. A coarse
 * presence carries everything another client needs to render the player, walk
 * them, seat them and play alongside them; what it drops is detail that no
 * consumer uses and that a stock client cannot show anyway.
 *
 * That test — *does any consumer need this to render or synchronise?* — is what
 * kept almost every field. The audit in `docs/presence-data-minimization.md`
 * records the answer for each one; the short version is that only ONE field
 * failed it.
 *
 * ## Hiding, which is the reason this capability exists
 *
 * A player hides in a bush. Every stock client draws nothing — `visualHidden`.
 * And the event says `hiddenIn: "town-bush-3"`, which is a machine-readable
 * statement of the one thing the player just asked the game to conceal.
 *
 * The spot id has no rendering value: the remote path tests it for TRUTHINESS
 * and nothing more (`MultiplayerLayer` → `resolveActorRender` → `visualHidden`,
 * and the gaze pass excludes anyone hidden). The only place the exact id is
 * compared against a real spot is a bush checking whether the LOCAL player is
 * inside it. So the fact is load-bearing and the identifier is not.
 *
 * Coarse presence therefore keeps the fact and withholds the identifier:
 * {@link WITHHELD_HIDING_SPOT}. Every existing client — this one, an older
 * build, another implementation — hides the Blobbi exactly as before, because
 * all of them only ask whether the field is there.
 *
 * **Omitting it entirely would be worse than publishing it.** A remote client
 * with no `hiddenIn` renders the player NORMALLY, standing at the coordinates
 * they are hiding at. "Minimizing" the field would take a player who is
 * invisible and make them visible, in the bush, to everybody. A test holds that
 * line.
 *
 * ## What this does NOT do
 *
 * The anchor still says where the player is standing, and while hidden that is
 * the bush. An observer with the room's geometry can still work out which one.
 * Withholding the position instead was measured and rejected: a reveal
 * interpolates from the last known position, so a false one there makes the
 * player step out of the wrong place. See §9 of the doc.
 *
 * This controls what THIS client publishes. It does not constrain a modified
 * client, does not hide anything from a relay, and does not make presence
 * private. See §14.
 */

import type { IslandSafetyPolicy } from '@/safety';

import type { PresenceContent } from '@/lib/multiplayer';

/**
 * The value coarse presence publishes in place of a real hiding-spot id.
 *
 * A reserved, non-identifying member of an existing optional field's
 * vocabulary — not a new field, tag, kind or schema. It has to be a non-empty
 * string because every consumer of `hiddenIn`, in this client and in any other,
 * decides by truthiness; an empty string would read as "not hidden" and undo
 * the concealment it exists to protect.
 *
 * It cannot collide with a real spot: hiding spots are room-scoped ids like
 * `town-bush-1`, and a test asserts no configured spot uses this value.
 */
export const WITHHELD_HIDING_SPOT = 'hidden';

/**
 * Project the local runtime presence onto what this policy permits.
 *
 * Pure and total. The input is never mutated — the caller keeps its full local
 * state, because this phase changes DISCLOSURE and not simulation: the game
 * still knows exactly which bush its player is in, and still needs to.
 *
 * Decided by the CAPABILITY. Nothing here knows a profile's name, so a future
 * profile that mixes the answers differently gets the right behaviour without
 * being enumerated.
 */
export function projectPresenceForPolicy(
  policy: IslandSafetyPolicy,
  content: PresenceContent,
): PresenceContent {
  if (policy.detailedPresence) return content;

  // Not `if (content.hiddenIn)` alone: a whitespace-only id is not a spot
  // either, and it must not become a claim of hiding.
  const hiding = typeof content.hiddenIn === 'string' && content.hiddenIn.trim() !== '';
  if (!hiding) return content;

  return { ...content, hiddenIn: WITHHELD_HIDING_SPOT };
}
