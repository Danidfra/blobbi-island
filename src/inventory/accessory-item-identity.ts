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
 * CURRENT STATE. One accessory is mapped: the Block Builder Cap. Every other
 * accessory resolves purely through the legacy chain in
 * `island-accessory-sources.ts`, exactly as it did before, and continues to do
 * so until its own definition is published and an entry is added below.
 *
 * The mapping is explicit rather than derived (e.g. `blobbi:accessory:<code>`)
 * on purpose: a derivation would silently start resolving the moment somebody
 * published an event at a guessable address, which is a decision that should be
 * made by editing this file.
 *
 * WHAT A MAPPING DOES AND DOES NOT MEAN. It says "when this code is worn, this
 * official definition describes it". It is NOT ownership, NOT a grant, and NOT
 * an equip: which accessory a player owns is still their kind:11125 `inv` tags,
 * and which one is worn — and where — is still their kind:31124 `equip` tag.
 * Publishing a definition changes what a hat LOOKS LIKE and what it is CALLED,
 * and nothing else.
 */

import type { ResolvedBlobbiItemDefinition } from './catalog-fallback';
import { ADDRESSED_OFFICIAL_COSMETICS } from '@/protocol/event-registry';
import { cosmeticDTagToAddress } from './registry';

/**
 * Legacy accessory `code` → the official definition's `d` tag.
 *
 * DERIVED, not hand-written: the pairing already exists on each entry of
 * `OFFICIAL_COSMETIC_DEFINITIONS` (as `legacyCode` + `d`), and writing it out a
 * second time here would be two places to edit and one place to forget. The
 * shape stays a plain record because that is what the tooling copies out as a
 * snippet and what the tests assert against.
 *
 * To map a new accessory, add its entry to `OFFICIAL_COSMETIC_DEFINITIONS` —
 * that is the single edit, and it is a source-code change reviewed by a human,
 * never something the browser writes.
 */
export const ACCESSORY_CODE_TO_OFFICIAL_ITEM_D: Readonly<
  Record<string, string>
> = Object.freeze(
  Object.fromEntries(
    ADDRESSED_OFFICIAL_COSMETICS.map((c) => [c.legacyCode, c.d]),
  ),
);

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
  return cosmeticDTagToAddress(d);
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
