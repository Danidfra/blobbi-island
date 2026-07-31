/**
 * Blobbi Island — TRUSTED visual-effect item registry (Phase 8 preparation).
 *
 * `@blobbi/react` knows how to draw twelve effects, named by id. This file is
 * the only place that says which ITEM entitles a Blobbi to one of them. That is
 * an Island question, and it is a TRUST question, so it is answered the same
 * way `isOfficialCosmeticAddress` answers its own:
 *
 *   **the key is the full `31632:<issuer>:<d>` address, never the `d` alone.**
 *
 * kind:31632 is addressable. Anyone may publish `blobbi:effect:celestial-aura`,
 * put `"effectId": "celestial-aura"` in its content, and relays will serve it
 * exactly as readily as the official one. If this registry were keyed by `d`,
 * or if anything read `metadata.effectId` off a fetched event, that copy would
 * light up a legendary aura for free. It is keyed by address, and the address
 * is BUILT here from {@link OFFICIAL_ITEM_ISSUER_PUBKEY} rather than accepted
 * from anywhere — so there is no input by which a lookup can be made to
 * succeed for a stranger's item.
 *
 * ## What an event may and may not contain
 *
 * An effect item is an ordinary kind:31632 definition. Its content may describe
 * the effect in trusted metadata — a name, a description, an `effectId` — and
 * none of that is executable. The animation, the particles, the CSS and the
 * geometry live in this repository. Nothing published on a relay is ever
 * evaluated, injected, or used to choose a component, a class name or an
 * animation: the ONLY thing an event can contribute is its identity, and
 * identity is matched against the table below.
 *
 * ## Scope of this phase — deliberately inert
 *
 * This module resolves an address to an effect id and stops. It does not read
 * inventory, does not read kind:31634 placements, does not decide whether a
 * player owns anything, and is not wired into any production render path. Its
 * only consumers today are the dev preview and its tests
 * (`official-visual-effect-items.test.ts` asserts exactly that).
 *
 * When activation arrives it belongs next to `src/placement/policy.ts`, whose
 * gates — author, ownership, issuer, form, slot — are the same gates an effect
 * needs, and which already has one answer for each of them.
 */

import type { BlobbiVisualEffectId } from '@blobbi/react';
import { isBlobbiVisualEffectId } from '@blobbi/react';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';
import { officialItemAddress } from '@/protocol/event-registry';

/**
 * Rarity, as the game economy will price it.
 *
 * Island's vocabulary, not the renderer's: `@blobbi/react` has no idea an
 * effect can be rare, and adding rarity to a preset would put an economy
 * decision inside a drawing package.
 */
export type VisualEffectRarity =
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'legendary'
  | 'mythic';

export interface OfficialVisualEffectItem {
  /** The kind:31632 `d` tag this effect's item definition will carry. */
  d: string;
  /** The local effect the item entitles its owner to. */
  effectId: BlobbiVisualEffectId;
  rarity: VisualEffectRarity;
}

/**
 * The intended `d` → effect mapping for the twelve official effect items.
 *
 * A CLAIM OF IDENTITY, not a claim of publication: none of these definitions
 * exists on a relay yet, and this phase publishes nothing. What the table
 * fixes is the naming, so that whoever publishes them later cannot pick a
 * different `d` and quietly break the resolver.
 */
export const OFFICIAL_VISUAL_EFFECT_ITEMS: readonly OfficialVisualEffectItem[] = [
  { d: 'blobbi:effect:golden-sparkles', effectId: 'golden-sparkles', rarity: 'rare' },
  { d: 'blobbi:effect:bubble-bliss', effectId: 'bubble-bliss', rarity: 'uncommon' },
  { d: 'blobbi:effect:love-burst', effectId: 'love-burst', rarity: 'rare' },
  { d: 'blobbi:effect:firefly-friends', effectId: 'firefly-friends', rarity: 'rare' },
  { d: 'blobbi:effect:mystic-fog', effectId: 'mystic-fog', rarity: 'epic' },
  { d: 'blobbi:effect:frost-breath', effectId: 'frost-breath', rarity: 'epic' },
  { d: 'blobbi:effect:pixel-glitch', effectId: 'pixel-glitch', rarity: 'epic' },
  { d: 'blobbi:effect:electric-charge', effectId: 'electric-charge', rarity: 'epic' },
  { d: 'blobbi:effect:celestial-aura', effectId: 'celestial-aura', rarity: 'legendary' },
  { d: 'blobbi:effect:solar-radiance', effectId: 'solar-radiance', rarity: 'legendary' },
  { d: 'blobbi:effect:void-whispers', effectId: 'void-whispers', rarity: 'legendary' },
  { d: 'blobbi:effect:rainbow-dream', effectId: 'rainbow-dream', rarity: 'mythic' },
];

/** An effect item with its canonical address derived from issuer + `d`. */
export interface AddressedVisualEffectItem extends OfficialVisualEffectItem {
  /** `31632:<official issuer>:<d>`, derived — never hardcoded, never supplied. */
  address: string;
}

export const ADDRESSED_VISUAL_EFFECT_ITEMS: readonly AddressedVisualEffectItem[] =
  OFFICIAL_VISUAL_EFFECT_ITEMS.map((item) => ({
    ...item,
    address: officialItemAddress(item.d),
  }));

const byAddress = new Map(
  ADDRESSED_VISUAL_EFFECT_ITEMS.map((item) => [item.address, item]),
);

/**
 * The effect an ITEM ADDRESS entitles its owner to, or `null`.
 *
 * `null` for every address this repository has not declared official —
 * including `31632:<stranger>:blobbi:effect:celestial-aura`, which differs from
 * the official item only in its author and is therefore a different item.
 *
 * Entitlement is not activation: a caller that has an effect id from here still
 * has to establish ownership and an equipped state before drawing anything.
 * Nothing in this phase does.
 */
export function visualEffectForItemAddress(
  address: string,
): BlobbiVisualEffectId | null {
  return byAddress.get(address)?.effectId ?? null;
}

/** The full registry entry for an item address, or `null`. */
export function visualEffectItemByAddress(
  address: string,
): AddressedVisualEffectItem | null {
  return byAddress.get(address) ?? null;
}

/** The registry entry for a local effect id, or `null`. */
export function visualEffectItemForEffect(
  effectId: BlobbiVisualEffectId,
): AddressedVisualEffectItem | null {
  return ADDRESSED_VISUAL_EFFECT_ITEMS.find((i) => i.effectId === effectId) ?? null;
}

/** Is this one of the official effect item addresses? */
export function isOfficialVisualEffectAddress(address: string): boolean {
  return byAddress.has(address);
}

/**
 * The official issuer, re-exported for the tests and the dev preview.
 *
 * Named here so a reader of this file can see WHOSE signature the addresses
 * above are built from without having to follow an import.
 */
export const VISUAL_EFFECT_ITEM_ISSUER = OFFICIAL_ITEM_ISSUER_PUBKEY;

/**
 * Guard used by the tests: every mapping target must be an effect the renderer
 * actually implements. A typo here would produce an item that entitles its
 * owner to nothing, silently.
 */
export function everyMappingResolvesToAKnownEffect(): boolean {
  return OFFICIAL_VISUAL_EFFECT_ITEMS.every((item) =>
    isBlobbiVisualEffectId(item.effectId),
  );
}
