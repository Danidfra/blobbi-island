/**
 * Blobbi Island: the TRUSTED kind:31632 item issuers.
 *
 * Blobbi Island is not the only game publishing Game Item Definitions, and a
 * player's items do not all come from here. kind:31633 lets one player hold
 * several inventories: one per game context, and each `a` tag in them names
 * an item by its FULL address, `31632:<issuer>:<d>`. So the question "may this
 * item be shown to the player" is a question about the ISSUER, and this module
 * is where it is answered.
 *
 * ## Why a set, and not a second constant
 *
 * Before this module there was exactly one trust expression in the inventory
 * layer, `event.pubkey === OFFICIAL_ITEM_ISSUER_PUBKEY`, in
 * `parseOfficialItemDefinition`: plus generated FULL-ADDRESS sets in
 * `registry.ts` for cosmetics and effect items. Address-set trust is the
 * stronger of the two and stays exactly where it is, because what it guards
 * (equipping, renderer effects) needs to know the specific item.
 *
 * It cannot be used for a partner game. Island must not know another game's
 * item ids: hard-coding `farm:produce:strawberry` would make every new crop a
 * Blobbi release, and would still be the WRONG check, because a `d` is not an
 * identity: anyone may publish `31632:<stranger>:farm:produce:strawberry` and
 * relays will serve it. Trusting the ISSUER and then reading whatever they
 * published is the only model that interoperates without coupling.
 *
 * ## What trust here does and does not grant
 *
 * Being in this table grants exactly one thing: a definition signed by that key
 * may be PARSED and DISPLAYED as the item a discovered inventory refers to. It
 * does not make an item official, purchasable, equippable, effect-bearing or
 * consumable: every one of those is still decided by the Blobbi-only gates
 * that existed before (`parseOfficialItemDefinition`, `isOfficialItemAddress`,
 * `isOfficialCosmeticAddress`, `isOfficialEffectItemAddress`,
 * `placement/policy.ts`, the shop and prize catalogs). None of them consult
 * this file.
 */

import { OFFICIAL_ITEM_ISSUER_PUBKEY, OFFICIAL_ITEM_RELAYS } from './constants';
import type { ExternalCompatibilityProfile } from './external-item-compatibility';

/**
 * Whose catalog this is.
 *
 * - `'blobbi'`: this game's own issuer. Its definitions are loaded, resolved
 *   and gated by the pre-existing official path (`useItemCatalog`), which this
 *   module deliberately does not touch.
 * - `'partner'`: another game's issuer. Its definitions are loaded by
 *   `useExternalItemCatalog` and are display-only.
 *
 * The distinction exists so the two catalogs never fetch the same events
 * twice, not to express degrees of trust: both roles are trusted to describe
 * their OWN items and neither is trusted to describe anybody else's.
 */
export type TrustedIssuerRole = 'blobbi' | 'partner';

/** One trusted publisher of kind:31632 Game Item Definitions. */
export interface TrustedItemIssuer {
  /** The issuer's hex pubkey. The whole of the trust decision. */
  pubkey: string;
  /**
   * A short PLAYER-FACING name for where an item came from, "Farm", not a
   * pubkey, an npub or a `d` prefix. Rendered on the inventory tile.
   */
  label: string;
  /**
   * The issuer's full product name, "Nostr Farm", for surfaces with room for
   * it: the consume dialog and the feeding feedback say "From Nostr Farm"
   * where a tile pill says "Farm". Presentation only; never an input to any
   * trust, resolution or accounting decision.
   */
  name: string;
  role: TrustedIssuerRole;
  /**
   * Relays known to carry this issuer's definitions, and, for a partner game,
   * the relay set that game reads and writes its inventories, kind:1416
   * spends and kind:1417 folds on. Used as the preferred sources when
   * resolving their items and as the destination for spends against their
   * inventories; never as an authorization input.
   */
  relays: readonly string[];
  /**
   * Which Blobbi COMPATIBILITY PROFILES this issuer's items may be classified
   * into (`external-item-compatibility.ts`). Empty means "display only": the
   * issuer's items are shown and counted but never used on a Blobbi.
   *
   * This is the issuer's half of a two-part opt-in; the other half is the
   * item's own published semantics. Granting a profile here says "we are
   * willing to interpret this game's edible things as food", not "everything
   * this key signs is food".
   */
  compatibility: readonly ExternalCompatibilityProfile[];
}

/**
 * The trusted issuer set.
 *
 * Deliberately tiny and hand-maintained. Adding a key here is a decision to
 * show another game's artwork and item names inside Blobbi Island, so it is a
 * source change and a review, never configuration or a runtime discovery.
 *
 * NOTE what is NOT recorded per issuer: item ids, `d` values, categories,
 * effects or any other product knowledge. Island learns what a partner's items
 * ARE by reading their published definitions, which is what keeps this generic,
 * a partner can add, rename or re-art an item without a Blobbi release.
 */
export const TRUSTED_ITEM_ISSUERS: readonly TrustedItemIssuer[] = [
  {
    // Blobbi Island itself. Same key the official catalog has always used,
    // this is a restatement, never a second source of truth.
    pubkey: OFFICIAL_ITEM_ISSUER_PUBKEY,
    label: 'Blobbi Island',
    name: 'Blobbi Island',
    role: 'blobbi',
    relays: OFFICIAL_ITEM_RELAYS,
    // Own items are interpreted by the official catalog, never by the
    // cross-game policy.
    compatibility: [],
  },
  {
    // The Farm: the first interoperability partner, and the reason this table
    // exists. npub173a27t3j08lxlnw7243nd50hgpc9zfkf5dlx8y8zah3pzegen76q8fl9lm
    //
    // Both relays were verified to serve all four of their published produce
    // definitions. `relay.ditto.pub` is also Blobbi's default, so a player on
    // stock settings resolves them without any extra connection.
    pubkey: 'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4',
    label: 'Farm',
    name: 'Nostr Farm',
    role: 'partner',
    // The Farm reads and writes `farm:main`, its kind:1416 spends and its
    // kind:1417 folds on this set (its `INVENTORY_RELAYS`), so a spend Island
    // publishes here is one the Farm's next fold will see.
    relays: ['wss://relay.primal.net', 'wss://relay.ditto.pub'],
    // Farm produce that is published as edible food is raw produce to a
    // Blobbi. Nothing else the Farm signs is interpreted.
    compatibility: ['raw-produce'],
  },
];

const BY_PUBKEY = new Map(
  TRUSTED_ITEM_ISSUERS.map((issuer) => [issuer.pubkey, issuer]),
);

/**
 * The trusted issuer with this pubkey, or `null`.
 *
 * Exact hex equality on the WHOLE key. There is no prefix match, no npub
 * form and no normalization: a near-miss is a different person.
 */
export function getTrustedItemIssuer(
  pubkey: string | undefined | null,
): TrustedItemIssuer | null {
  if (!pubkey) return null;
  return BY_PUBKEY.get(pubkey) ?? null;
}

/** May a definition signed by this key be parsed and displayed? */
export function isTrustedItemIssuer(pubkey: string | undefined | null): boolean {
  return getTrustedItemIssuer(pubkey) !== null;
}

/**
 * The trusted issuers that are NOT this game.
 *
 * `useExternalItemCatalog` resolves their definitions; the Blobbi issuer's own
 * catalog keeps coming from `useItemCatalog`, with its established filter,
 * cache key and coverage counters untouched.
 */
export const TRUSTED_PARTNER_ISSUERS: readonly TrustedItemIssuer[] =
  TRUSTED_ITEM_ISSUERS.filter((issuer) => issuer.role === 'partner');

/** Is this key a trusted issuer from another game? */
export function isTrustedPartnerIssuer(
  pubkey: string | undefined | null,
): boolean {
  return getTrustedItemIssuer(pubkey)?.role === 'partner';
}
