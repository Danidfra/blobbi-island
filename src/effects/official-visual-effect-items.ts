/**
 * Blobbi Island — TRUSTED visual-effect item registry (typed projection).
 *
 * `@blobbi/react` knows how to draw twelve effects, named by id. This module is
 * the only place that says which ITEM entitles a Blobbi to one of them, and it
 * answers the same way `isOfficialCosmeticAddress` answers its own question:
 *
 *   **the key is the full `31632:<issuer>:<d>` address, never the `d` alone.**
 *
 * kind:31632 is addressable. Anyone may publish `blobbi:effect:celestial-aura`,
 * put `"effect": "celestial-aura"` in its content, and relays will serve it
 * exactly as readily as the official one. If this registry were keyed by `d`,
 * or if anything read `visual.effect` off a fetched event, that copy would
 * light up a legendary aura for free. It is keyed by address, and the address
 * is BUILT from {@link OFFICIAL_ITEM_ISSUER_PUBKEY} rather than accepted from
 * anywhere — so there is no input by which a lookup can be made to succeed for
 * a stranger's item.
 *
 * ## Where the data lives
 *
 * Since Phase 9 the raw table is part of the canonical protocol registry
 * (`OFFICIAL_EFFECT_ITEM_DEFINITIONS` in `src/protocol/event-registry.ts`),
 * next to every other official kind:31632 identity, as plain strings — that
 * module must not depend on the renderer package. THIS module is the typed
 * view the activation path consumes: it narrows `effectId` to
 * {@link BlobbiVisualEffectId} and `effectSlot` to {@link BlobbiEffectSlot},
 * and REFUSES TO LOAD if any entry disagrees with what the renderer actually
 * implements ({@link validateOfficialVisualEffectRegistry}). A typo in the
 * canonical table is a build/test failure, never a silently dead item.
 *
 * ## What identity is — and is not
 *
 * The registry stores no event ids and no signatures. A kind:31632 definition
 * is addressable: the issuer will republish it (new event id, same address)
 * whenever metadata changes, and an activation path keyed on event ids would
 * break on the first such update. Current event ids live only in the fixture
 * module (`official-item-event-fixtures.ts`) for tests and dev diagnostics.
 *
 * Nothing published on a relay is ever evaluated, injected, or used to choose
 * a component, a class name or an animation: the animation, particles, CSS and
 * geometry live in this repository, and the ONLY thing an event contributes is
 * its identity, matched against the table below.
 */

import type { BlobbiEffectSlot, BlobbiVisualEffectId } from '@blobbi/react';
import { EFFECT_SLOTS, isBlobbiVisualEffectId } from '@blobbi/react';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';
import {
  ADDRESSED_OFFICIAL_EFFECT_ITEMS,
  officialItemAddress,
  type AddressedOfficialEffectItem,
} from '@/protocol/event-registry';

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

/** Blobbi forms an official effect item may be active on. */
export type VisualEffectForm = 'baby' | 'adult';

export interface OfficialVisualEffectItem {
  /** The kind:31632 `d` tag this effect's item definition carries. */
  d: string;
  /** The local effect the item entitles its owner to. */
  effectId: BlobbiVisualEffectId;
  /**
   * The ONLY placement slot this item may be equipped into. Always equal to
   * the renderer's own slot for the effect — enforced at load and in tests.
   */
  effectSlot: BlobbiEffectSlot;
  /** Blobbi forms the effect may be active on. Never empty. */
  forms: readonly VisualEffectForm[];
  rarity: VisualEffectRarity;
  /** Display name fallback; a fetched definition always wins. */
  name: string;
  /** Emoji fallback; a fetched definition always wins. */
  symbol: string;
  /**
   * Whether the published definition carries the `arcade-prize` topic —
   * acquisition metadata only, never an activation input.
   */
  arcadePrize: boolean;
}

/** An effect item with its canonical address derived from issuer + `d`. */
export interface AddressedVisualEffectItem extends OfficialVisualEffectItem {
  /** `31632:<official issuer>:<d>`, derived — never hardcoded, never supplied. */
  address: string;
}

const VALID_RARITIES: ReadonlySet<string> = new Set([
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
]);

const VALID_FORMS: ReadonlySet<string> = new Set(['baby', 'adult']);

/**
 * Validate the canonical effect-item table against the renderer.
 *
 * Returns human-readable issues rather than throwing, so the tests can assert
 * the empty list and print every problem at once. The module itself throws on
 * a non-empty result (below): this data is static, so a bad entry is a
 * programming error to surface at the first import, not a runtime condition to
 * limp through.
 */
export function validateOfficialVisualEffectRegistry(
  entries: readonly AddressedOfficialEffectItem[] = ADDRESSED_OFFICIAL_EFFECT_ITEMS,
): string[] {
  const issues: string[] = [];
  const seenD = new Set<string>();
  const seenAddress = new Set<string>();
  const seenEffect = new Set<string>();

  for (const entry of entries) {
    const label = entry.d || '(blank d)';

    if (entry.d.trim() === '') issues.push(`${label}: blank d tag`);
    if (seenD.has(entry.d)) issues.push(`${label}: duplicate d tag`);
    seenD.add(entry.d);

    if (seenAddress.has(entry.address)) {
      issues.push(`${label}: duplicate address ${entry.address}`);
    }
    seenAddress.add(entry.address);

    if (entry.address !== officialItemAddress(entry.d)) {
      issues.push(
        `${label}: address ${entry.address} is not derived from the official issuer`,
      );
    }

    if (!isBlobbiVisualEffectId(entry.effectId)) {
      issues.push(
        `${label}: effect id "${entry.effectId}" is not implemented by @blobbi/react`,
      );
      continue; // the slot check below needs a valid id
    }

    if (seenEffect.has(entry.effectId)) {
      issues.push(`${label}: duplicate effect id ${entry.effectId}`);
    }
    seenEffect.add(entry.effectId);

    // The renderer already knows which slot each effect competes for; the
    // registry's expected slot must be the SAME answer, or policy and painter
    // would disagree about where an effect lives.
    if (EFFECT_SLOTS[entry.effectId] !== entry.effectSlot) {
      issues.push(
        `${label}: registered slot "${entry.effectSlot}" disagrees with the renderer's "${EFFECT_SLOTS[entry.effectId]}"`,
      );
    }

    if (!VALID_RARITIES.has(entry.rarity)) {
      issues.push(`${label}: unknown rarity "${entry.rarity}"`);
    }

    if (entry.forms.length === 0) {
      issues.push(`${label}: empty forms list`);
    }
    for (const form of entry.forms) {
      if (!VALID_FORMS.has(form)) {
        issues.push(`${label}: unknown form "${form}"`);
      }
    }
  }

  return issues;
}

{
  const issues = validateOfficialVisualEffectRegistry();
  if (issues.length > 0) {
    throw new Error(
      `official-visual-effect-items: canonical registry is invalid:\n${issues.join('\n')}`,
    );
  }
}

/**
 * Every official effect item, typed and addressed.
 *
 * The cast is sound because the load-time validation above has already proven
 * every `effectId`, `effectSlot`, `rarity` and `forms` value against the
 * renderer's and this module's vocabularies.
 */
export const ADDRESSED_VISUAL_EFFECT_ITEMS: readonly AddressedVisualEffectItem[] =
  ADDRESSED_OFFICIAL_EFFECT_ITEMS.map((entry) => ({
    d: entry.d,
    effectId: entry.effectId as BlobbiVisualEffectId,
    effectSlot: entry.effectSlot as BlobbiEffectSlot,
    forms: entry.forms as readonly VisualEffectForm[],
    rarity: entry.rarity as VisualEffectRarity,
    name: entry.name,
    symbol: entry.symbol,
    arcadePrize: entry.arcadePrize,
    address: entry.address,
  }));

/** The same items without the derived address, for callers that key by `d`. */
export const OFFICIAL_VISUAL_EFFECT_ITEMS: readonly OfficialVisualEffectItem[] =
  ADDRESSED_VISUAL_EFFECT_ITEMS;

const byAddress = new Map(
  ADDRESSED_VISUAL_EFFECT_ITEMS.map((item) => [item.address, item]),
);

/**
 * Resolve an ITEM ADDRESS to its official effect registration, or `null`.
 *
 * `null` for every address this repository has not declared official —
 * including `31632:<stranger>:blobbi:effect:celestial-aura`, which differs from
 * the official item only in its author and is therefore a different item.
 *
 * Entitlement is not activation: a caller that has a registration still has to
 * establish ownership (kind:31633), an equipped placement (kind:31634) and a
 * compatible form before drawing anything — that is
 * `resolveActiveBlobbiEffects` in `active-effects.ts`.
 */
export function resolveOfficialVisualEffectItem(
  address: string,
): AddressedVisualEffectItem | null {
  return byAddress.get(address) ?? null;
}

/** The effect an ITEM ADDRESS entitles its owner to, or `null`. */
export function visualEffectForItemAddress(
  address: string,
): BlobbiVisualEffectId | null {
  return byAddress.get(address)?.effectId ?? null;
}

/** The full registry entry for an item address, or `null`. */
export function visualEffectItemByAddress(
  address: string,
): AddressedVisualEffectItem | null {
  return resolveOfficialVisualEffectItem(address);
}

/** The registry entry for a local effect id, or `null`. */
export function visualEffectItemForEffect(
  effectId: BlobbiVisualEffectId,
): AddressedVisualEffectItem | null {
  return (
    ADDRESSED_VISUAL_EFFECT_ITEMS.find((i) => i.effectId === effectId) ?? null
  );
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
