/**
 * Blobbi Island: the COMPATIBILITY POLICY for items owned in other games'
 * inventories.
 *
 * ```
 *   the item definition says WHAT the item is      (kind:31632, issuer-signed)
 *   this module says WHAT IT DOES to a Blobbi      (Blobbi Island policy)
 * ```
 *
 * A partner game publishes generic semantics, `type: consumable`,
 * `category: food`, topic `edible`: and deliberately nothing about hunger,
 * stages, cooldowns or any other Blobbi vocabulary. Interpreting those
 * semantics is the consuming game's job, and this is the ONE place Island does
 * it. Nothing in the generic protocol parser, the trusted-definition parser or
 * the inventory derivation knows this module exists.
 *
 * ## Opt-in, twice
 *
 * An external item becomes usable only when BOTH hold:
 *
 * 1. its issuer is a trusted partner that has been granted the profile
 *    (`TrustedItemIssuer.compatibility` in `trusted-issuers.ts`): trust is the
 *    issuer key, never a `d`, never an address;
 * 2. its published definition carries the generic semantics the profile
 *    requires.
 *
 * Neither alone is enough. A trusted issuer's crafting material is not food
 * because the issuer is trusted, and a stranger's "edible" is not food because
 * it says so. Everything that fails either test stays exactly what it was
 * before this module: visible, counted, and display-only.
 *
 * ## Profiles, not items
 *
 * A profile is a Blobbi gameplay interpretation ("raw produce: one food
 * segment"). Gameplay code consumes the profile; it never learns which
 * partner, item id or address produced it. New tiers, prepared food from a
 * cooking game, say, are new profiles here, not new branches elsewhere.
 */

import type {
  ItemAction,
  ItemEffects,
  ItemStage,
  ResolvedBlobbiItemDefinition,
} from './catalog-fallback';
import { parseGameItemAddress } from './package';
import { getTrustedItemIssuer } from './trusted-issuers';

/**
 * The Blobbi gameplay interpretations an external item can map to.
 *
 * - `'raw-produce'`: unprocessed edible food from a partner game. One food
 *   segment.
 */
export type ExternalCompatibilityProfile = 'raw-produce';

/** What an external item DOES, as decided by Island. Never performs anything. */
export interface ExternalItemCompatibility {
  /** The care action the item triggers. */
  action: ItemAction;
  profile: ExternalCompatibilityProfile;
  /** How many food segments this restores. Whole segments only. */
  hungerSegments: number;
}

/**
 * One FOOD SEGMENT in hunger points, derived from the existing balance rather
 * than chosen:
 *
 * - the hunger meter is 0–100 and the UI reads it in 25-point bands
 *   (`needLevel`: critical ≤ 25, low ≤ 50, good above, `src/lib/blobbi-mood.ts`);
 * - the smallest official food, the Apple, restores exactly 25
 *   (`src/protocol/event-registry.ts`);
 * - the optimistic feed update the care UI once applied assumed "+25".
 *
 * So the quantum the game already thinks in is 25, and raw produce restores
 * one of them. Prepared food from a future cooking game would map to more
 * segments: a different profile, the same unit.
 */
export const FOOD_SEGMENT_HUNGER = 25;

/**
 * Stages a raw-produce feed applies to: the same as every official food. An
 * egg is not fed.
 */
export const RAW_PRODUCE_STAGES: readonly ItemStage[] = ['baby', 'adult'];

/**
 * Does this published definition describe raw edible food, in the generic
 * vocabulary of kind:31632? Semantics only; no issuer, no id.
 */
export function hasRawProduceSemantics(
  definition: Pick<ResolvedBlobbiItemDefinition, 'type' | 'category' | 'topics'>,
): boolean {
  return (
    definition.type === 'consumable' &&
    definition.category === 'food' &&
    definition.topics.includes('edible')
  );
}

export interface ResolveExternalItemCompatibilityInput {
  /** The item's resolved definition (from a trusted issuer's kind:31632). */
  definition: ResolvedBlobbiItemDefinition;
  /**
   * The kind:31633 context the item is owned in. Not consulted by any current
   * profile: every profile is about the item, but part of the contract so a
   * future policy can be source-aware without changing every caller.
   */
  sourceInventoryId?: string;
}

/**
 * Decide what an external item does to a Blobbi, or `null` for "nothing":
 * it stays display-only.
 *
 * The issuer is taken from the definition's FULL address, so an item can never
 * borrow a profile through its `d` alone.
 */
export function resolveExternalItemCompatibility(
  input: ResolveExternalItemCompatibilityInput,
): ExternalItemCompatibility | null {
  const issuerPubkey = parseGameItemAddress(input.definition.address)?.pubkey;
  const issuer = getTrustedItemIssuer(issuerPubkey);
  // Only a trusted PARTNER's items are interpreted here; Blobbi's own items are
  // official definitions with their own effects and never pass through.
  if (!issuer || issuer.role !== 'partner') return null;

  if (
    issuer.compatibility.includes('raw-produce') &&
    hasRawProduceSemantics(input.definition)
  ) {
    return { action: 'feed', profile: 'raw-produce', hungerSegments: 1 };
  }

  return null;
}

/** The stat effects a compatibility profile produces, in Blobbi's own units. */
export function externalCompatibilityEffects(
  compatibility: ExternalItemCompatibility,
): ItemEffects {
  switch (compatibility.profile) {
    case 'raw-produce':
      return { hunger: FOOD_SEGMENT_HUNGER * compatibility.hungerSegments };
    default: {
      const _exhaustive: never = compatibility.profile;
      throw new Error(`Unknown compatibility profile ${String(_exhaustive)}`);
    }
  }
}

/** The stages a compatibility profile may be used on. */
export function externalCompatibilityStages(
  compatibility: ExternalItemCompatibility,
): ItemStage[] {
  switch (compatibility.profile) {
    case 'raw-produce':
      return [...RAW_PRODUCE_STAGES];
    default: {
      const _exhaustive: never = compatibility.profile;
      throw new Error(`Unknown compatibility profile ${String(_exhaustive)}`);
    }
  }
}

/**
 * The definition as Island will USE it: the issuer's semantic identity (name,
 * art, category, topics, rarity) with Island's interpretation (action, effects,
 * stages) laid over it.
 *
 * Used for both display (the consume dialog shows `effects`) and gameplay
 * (`useConsumeExternalItem` reads `action`/`effects`/`stages`), so the two can
 * never disagree about what eating a strawberry does. The issuer's definition
 * is not modified anywhere; this is a view.
 */
export function applyExternalCompatibility(
  definition: ResolvedBlobbiItemDefinition,
  compatibility: ExternalItemCompatibility,
): ResolvedBlobbiItemDefinition {
  return {
    ...definition,
    action: compatibility.action,
    effects: externalCompatibilityEffects(compatibility),
    stages: externalCompatibilityStages(compatibility),
  };
}
