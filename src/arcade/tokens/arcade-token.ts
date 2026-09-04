/**
 * Arcade Token: the arcade's PAY-TO-PLAY currency, and the one module that
 * knows its identity.
 *
 * ## The three-layer arcade economy
 *
 * ```
 *   Blobbi Coin  ──buy──▶  Arcade Token  ──spend to play──▶  Arcade Ticket
 *   (island cash)          (entry fee)                       (prize currency)
 * ```
 *
 * Tokens flow IN to a game; Tickets flow OUT of one. They are separate items
 * with separate addresses and separate roles, and no surface may call one by
 * the other's name; that confusion is the whole reason this module states the
 * distinction where the identity is defined.
 *
 * ## Identity
 *
 * The canonical identity is the STABLE ADDRESS
 * `31632:<issuer>:blobbi:currency:arcade-token`, derived from the registry
 * rather than hand-written. The event id below records the revision that was
 * observed published; a definition can be republished (new id, same address)
 * without anything about ownership changing, so it is provenance only. Never
 * use it as an inventory key.
 *
 * Quantity lives in the player's kind:31633 inventory, exactly like the Coin
 * and the Ticket.
 */

import {
  ARCADE_TOKEN_D,
  OFFICIAL_ISSUER_PUBKEY,
  officialItemAddress,
} from '@/protocol/event-registry';

export { ARCADE_TOKEN_D };

/** The official issuer, the same trust root as every official item. */
export const ARCADE_TOKEN_ISSUER = OFFICIAL_ISSUER_PUBKEY;

/** `31632:<issuer>:blobbi:currency:arcade-token`: derived, never hand-written. */
export const ARCADE_TOKEN_ADDRESS = officialItemAddress(ARCADE_TOKEN_D);

export const ARCADE_TOKEN_NAME = 'Arcade Token';

/** The published `symbol` tag; the emoji fallback when artwork is unavailable. */
export const ARCADE_TOKEN_SYMBOL = '🕹️';

/**
 * Event id of the CURRENTLY OBSERVED published definition revision.
 * Provenance and verification only; never identity, never an inventory key.
 */
export const ARCADE_TOKEN_DEFINITION_EVENT_ID =
  '22f7e302f70b27e71722ae95b56561bd83a832c5bb9dde896310d9860d0b6b04';
