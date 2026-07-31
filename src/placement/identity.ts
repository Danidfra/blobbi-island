/**
 * Blobbi Island — kind:31634 placement identity.
 *
 * TWO DIFFERENT IDENTITIES, DELIBERATELY NOT ONE.
 *
 * A placement event is addressable as `31634:<author>:<d>`, and the `d` names a
 * placement-state DOCUMENT. What that document points at is the `target`, and
 * the two are not interchangeable — the package is explicit that a `d` must
 * never be assumed to equal a character id, room id or map id. Island honours
 * that split here:
 *
 *   d      = blobbi-island:character:<characterId>:equipment
 *   target = { type: "address", address: "31124:<owner>:<characterId>" }
 *
 * The `d` embeds the character id because a player has one equipment document
 * per Blobbi and a stable `d` is what makes the event replaceable (newest
 * wins). That is a LOCAL CONVENTION for choosing a name, not a claim that the
 * two are the same thing: nothing in this codebase parses a character id back
 * out of a `d`, and `placementTargetForCharacter` is the only way to say what a
 * document applies to.
 *
 * The 31124 relationship lives here and only here. `@nostr-games/inventory`
 * knows nothing about Blobbi pet state, and adding a kind:31124 dependency to a
 * generic package would be exactly the coupling this architecture avoids.
 */

import { KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';
import {
  buildAddressableEventAddress,
  buildGameItemPlacementAddress,
  type GameItemPlacementAddressTarget,
} from '@/inventory/package';

/**
 * Namespace prefix for every placement document this client writes.
 *
 * Shared with the `context` tag below so a relay-level `#d` prefix scan and the
 * human-readable context can never drift apart.
 */
export const ISLAND_PLACEMENT_NAMESPACE = 'blobbi-island';

/**
 * The `context` tag value written on Island placement events.
 *
 * Used for local grouping and metadata discovery, NOT for relay filtering:
 * `context` is not a single-letter indexable tag, so queries go by author,
 * `#d` or `#a`. (This mirrors the clarification made to the kind:31633 spec.)
 */
export const ISLAND_PLACEMENT_CONTEXT = 'game:blobbi-island';

/** The `t` topic tag written on equipment documents — relay-indexable. */
export const ISLAND_PLACEMENT_TOPIC = 'equipment';

/**
 * The stable placement-document `d` for a Blobbi's equipment.
 *
 * One document per character, so equipping a hat replaces exactly that Blobbi's
 * equipment state and never touches another's.
 *
 * @throws {Error} for a blank character id. A blank `d` would make the address
 * unparseable, and silently substituting a placeholder would let one Blobbi's
 * equipment overwrite another's.
 */
export function characterEquipmentPlacementD(characterId: string): string {
  const trimmed = characterId.trim();
  if (trimmed === '') {
    throw new Error(
      'characterEquipmentPlacementD: characterId is required and must be non-empty',
    );
  }
  return `${ISLAND_PLACEMENT_NAMESPACE}:character:${trimmed}:equipment`;
}

/**
 * The full `31634:<author>:<d>` address of a Blobbi's equipment document.
 *
 * `authorPubkey` is whoever signed the placement, which for Island is always
 * the player. Whether that author is ALLOWED to dress this Blobbi is a separate
 * question, answered by `src/placement/policy.ts` — building an address never
 * implies permission.
 */
export function characterEquipmentPlacementAddress(
  authorPubkey: string,
  characterId: string,
): string {
  return buildGameItemPlacementAddress(
    authorPubkey,
    characterEquipmentPlacementD(characterId),
  );
}

/**
 * The authoritative `content.target` for a Blobbi character.
 *
 * An ADDRESS target rather than an internal one: a Blobbi is a real addressable
 * event (kind:31124), so pointing at it by address means any client can resolve
 * what the placement dresses without knowing Island's naming conventions. An
 * internal target would make the relationship private to this app.
 */
export function placementTargetForCharacter(
  ownerPubkey: string,
  characterId: string,
): GameItemPlacementAddressTarget {
  return {
    type: 'address',
    address: buildAddressableEventAddress(
      KIND_BLOBBI_STATE,
      ownerPubkey,
      characterId,
    ),
  };
}

/** The NIP-31 `alt` text for a Blobbi equipment document. */
export function characterEquipmentAlt(characterName: string): string {
  const name = characterName.trim();
  return name === ''
    ? 'Game item placement: Blobbi equipment'
    : `Game item placement: ${name}'s equipment`;
}
