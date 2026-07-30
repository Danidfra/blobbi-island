/**
 * Blobbi Island — which kind:31632 definition, if any, describes a legacy
 * accessory code.
 *
 * THE PROBLEM. Accessories predate the item protocol in this codebase. They are
 * identified by a bare code (`headwear-8`, `back-3`, `glasses-2`) that lives in
 * a player's equip tags, carries an optional URL, and otherwise resolves through
 * a filename convention. Game items are identified by an addressable coordinate,
 * `31632:<issuer-pubkey>:<d>`. Those are different identity systems, and nothing
 * in either one converts to the other on its own.
 *
 * WHY MATCHING ON `d` ALONE IS NOT AN OPTION. Kind:31632 is addressable, so ANY
 * pubkey may publish a definition with the `d` tag `blobbi:accessory:headwear-8`
 * and relays will serve it. Resolving an accessory by `d` across arbitrary
 * issuers would let a stranger's event decide what the player's hat looks like.
 * Identity here is therefore always the FULL address, and the address is always
 * built from `OFFICIAL_ITEM_ISSUER_PUBKEY` via the existing registry — the same
 * trust boundary the 20 official items already use (`parseOfficialItemDefinition`
 * rejects every other issuer before a definition can enter the catalog at all).
 * This module widens no trust; it only maps a code onto an address the registry
 * already vouches for.
 *
 * CURRENT STATE. The map below is EMPTY, and that is a fact about the protocol,
 * not an unfinished edit: the official issuer has published 20 item definitions
 * (19 consumables + the Arcade Ticket) and NOT ONE accessory. So today every
 * accessory resolves purely through the legacy chain in
 * `island-accessory-sources.ts`, exactly as it did before this phase, and the
 * definition-aware branch is dormant but fully tested against fixtures.
 *
 * The mapping is explicit rather than derived (e.g. `blobbi:accessory:<code>`)
 * on purpose: a derivation would silently start resolving the moment somebody
 * published an event at a guessable address, which is a decision that should be
 * made by editing this file. Publishing accessory definitions is out of scope
 * for this phase — see `docs/game-item-image-views.md`.
 */

import type { ResolvedBlobbiItemDefinition } from './catalog-fallback';
import { dTagToAddress } from './registry';

/**
 * Legacy accessory `code` → the official definition's `d` tag.
 *
 * Add an entry ONLY when the official issuer has actually published that
 * definition; an entry pointing at an unpublished `d` resolves to nothing and
 * quietly costs a map lookup per accessory per render.
 */
export const ACCESSORY_CODE_TO_OFFICIAL_ITEM_D: Readonly<
  Record<string, string>
> = {};

/** Whether any accessory code currently maps to an official item definition. */
export const HAS_ACCESSORY_ITEM_DEFINITIONS =
  Object.keys(ACCESSORY_CODE_TO_OFFICIAL_ITEM_D).length > 0;

/**
 * The canonical address of the official definition describing `code`, or `null`.
 *
 * Returns `null` both for an unmapped code and for a mapped `d` the official
 * registry does not know — a mapping can never conjure an address outside the
 * trusted issuer's registry.
 */
export function accessoryItemAddress(code: string): string | null {
  const d = ACCESSORY_CODE_TO_OFFICIAL_ITEM_D[code];
  if (!d) return null;
  return dTagToAddress(d);
}

/**
 * Project a loaded catalog into the `code → definition` map the accessory source
 * resolver consumes.
 *
 * Deliberately keyed by accessory code, because that is the only identity the
 * renderer-facing `AccessorySourceRequest` carries — keeping the address lookup
 * on this side of the boundary is what stops `@blobbi/react` from ever needing
 * to know an address exists.
 *
 * Pure and cheap: it walks the mapping (not the catalog), so an empty mapping
 * costs nothing and the result is a stable empty map.
 */
export function accessoryDefinitionsByCode(
  byAddress: ReadonlyMap<string, ResolvedBlobbiItemDefinition> | undefined,
): ReadonlyMap<string, ResolvedBlobbiItemDefinition> {
  const out = new Map<string, ResolvedBlobbiItemDefinition>();
  if (!byAddress) return out;
  for (const code of Object.keys(ACCESSORY_CODE_TO_OFFICIAL_ITEM_D)) {
    const address = accessoryItemAddress(code);
    if (!address) continue;
    const definition = byAddress.get(address);
    if (definition) out.set(code, definition);
  }
  return out;
}
