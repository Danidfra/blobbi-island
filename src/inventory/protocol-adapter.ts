/**
 * Blobbi Island — thin protocol adapter (Phase 1).
 *
 * This module is the ONLY place that bridges the framework-free
 * `@nostr-games/inventory` package to Island concerns (view models, relay
 * hints, emoji/visual resolution). It deliberately delegates ALL protocol logic
 * (parsing, validation, addressing, quantities, duplicate handling) to the
 * package and never re-implements it.
 */

import {
  type GameItemDefinition,
  type GameInventory,
  parseGameItemDefinitionResult,
  parseGameInventoryResult,
  getInventoryItems,
} from './package';

import type { NostrEvent } from '@nostrify/nostrify';

import {
  ITEM_ACTIONS,
  ITEM_CATEGORIES,
  ITEM_STAGES,
} from '@/protocol/event-registry';

import {
  type DefinitionEffectVisual,
  type DefinitionVisualDiagnostics,
  type ItemAction,
  type ItemCategory,
  type ItemStage,
  type ResolvedBlobbiItemDefinition,
  bundledFallbackDefinition,
  emojiForItemId,
  unknownItemDefinition,
} from './catalog-fallback';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from './constants';
import { isTrustedItemIssuer } from './trusted-issuers';
import { addressToItemId } from './registry';

/**
 * Validation sets for the metadata a fetched definition may carry.
 *
 * All three DERIVE from the canonical registry (`src/protocol/event-registry.ts`)
 * rather than repeating literal lists here. That is what guarantees a category
 * added to the registry — `currency`, for example — is accepted by the adapter
 * instead of silently degrading a valid definition to `unknown`.
 */
const VALID_ACTIONS: ReadonlySet<string> = new Set<string>(ITEM_ACTIONS);
const VALID_STAGES: ReadonlySet<string> = new Set<string>(ITEM_STAGES);
const VALID_CATEGORIES: ReadonlySet<string> = new Set<string>(ITEM_CATEGORIES);

/**
 * Parse a kind:31632 event into a package `GameItemDefinition`, enforcing the
 * official issuer. Returns `null` for rejected events or events from an
 * unexpected issuer.
 *
 * Uses the package's structured parser (`parseGameItemDefinitionResult`).
 */
export function parseOfficialItemDefinition(
  event: NostrEvent,
): GameItemDefinition | null {
  if (event.pubkey !== OFFICIAL_ITEM_ISSUER_PUBKEY) return null;
  const result = parseGameItemDefinitionResult(event, { mode: 'permissive' });
  if (!result.ok) return null;
  // Extra guard: the parsed issuer must match (defensive; parser sets it from
  // the event pubkey).
  if (result.value.issuer !== OFFICIAL_ITEM_ISSUER_PUBKEY) return null;
  return result.value;
}

/**
 * Parse a kind:31632 event into a package `GameItemDefinition`, enforcing the
 * TRUSTED ISSUER SET (`trusted-issuers.ts`) rather than the single official
 * Blobbi issuer. Returns `null` for rejected events and for any issuer that is
 * not trusted.
 *
 * A SIBLING of {@link parseOfficialItemDefinition}, never a replacement. The
 * two answer different questions and guard different things:
 *
 * ```
 *   parseOfficialItemDefinition   is this an OFFICIAL BLOBBI item?
 *                                 → the catalog, the shop, gameplay
 *   parseTrustedItemDefinition    may this definition DESCRIBE an item a
 *                                 discovered inventory refers to?
 *                                 → display of external inventories only
 * ```
 *
 * Widening the official parser to admit a partner issuer would have made every
 * partner item an "official Blobbi item" everywhere at once — purchasable,
 * equippable, effect-eligible, consumable. Adding a second, narrower-purpose
 * parser leaves every pre-existing gate saying exactly what it said before.
 */
export function parseTrustedItemDefinition(
  event: NostrEvent,
): GameItemDefinition | null {
  if (!isTrustedItemIssuer(event.pubkey)) return null;
  const result = parseGameItemDefinitionResult(event, { mode: 'permissive' });
  if (!result.ok) return null;
  // Defensive, exactly as in the official parser: the parsed issuer is set
  // from the event pubkey, and must still be one we trust.
  if (!isTrustedItemIssuer(result.value.issuer)) return null;
  return result.value;
}

/**
 * Read structured Blobbi metadata (effects/action/stages/emoji) out of a
 * fetched definition's content JSON.
 *
 * The official published content shape is:
 *   {
 *     "effects":  { "game:blobbi": { <stat>: <number>, ... } },
 *     "metadata": { "itemId", "action", "stages", "emoji", "stackable" }
 *   }
 *
 * This reader honors that canonical shape and, for forward-compatibility, also
 * tolerates a flat shape (`effects.<stat>`, top-level `action`/`stages`/`emoji`).
 * The package exposes `contentJson` verbatim; Island decides how to interpret
 * it. Fields the definition omits are left `undefined` so callers fall back to
 * bundled values.
 */
function readEffectsFromContent(contentJson: unknown): {
  effects?: ResolvedBlobbiItemDefinition['effects'];
  action?: ItemAction;
  stages?: ItemStage[];
  emoji?: string;
} {
  if (!contentJson || typeof contentJson !== 'object') return {};
  const obj = contentJson as Record<string, unknown>;

  const out: {
    effects?: ResolvedBlobbiItemDefinition['effects'];
    action?: ItemAction;
    stages?: ItemStage[];
    emoji?: string;
  } = {};

  // Effects: prefer the canonical `effects["game:blobbi"]` bag, fall back to a
  // flat `effects` object.
  const effectsContainer =
    obj.effects && typeof obj.effects === 'object'
      ? (obj.effects as Record<string, unknown>)
      : undefined;
  const effectsBag =
    effectsContainer &&
    effectsContainer['game:blobbi'] &&
    typeof effectsContainer['game:blobbi'] === 'object'
      ? (effectsContainer['game:blobbi'] as Record<string, unknown>)
      : effectsContainer;
  if (effectsBag) {
    const effects: ResolvedBlobbiItemDefinition['effects'] = {};
    for (const key of ['hunger', 'energy', 'hygiene', 'happiness', 'health']) {
      const v = effectsBag[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        effects[key as keyof typeof effects] = v;
      }
    }
    if (Object.keys(effects).length > 0) out.effects = effects;
  }

  // Metadata: prefer the canonical `metadata` bag, fall back to top-level.
  const meta =
    obj.metadata && typeof obj.metadata === 'object'
      ? (obj.metadata as Record<string, unknown>)
      : obj;

  if (typeof meta.action === 'string' && VALID_ACTIONS.has(meta.action)) {
    out.action = meta.action as ItemAction;
  }

  if (Array.isArray(meta.stages)) {
    const stages = meta.stages.filter(
      (s): s is ItemStage => typeof s === 'string' && VALID_STAGES.has(s),
    );
    if (stages.length > 0) out.stages = stages;
  }

  if (typeof meta.emoji === 'string' && meta.emoji.length > 0) {
    out.emoji = meta.emoji;
  }

  return out;
}

/**
 * Resolve a fetched (already package-parsed) `GameItemDefinition` into the
 * Island view model, merging bundled fallback metadata for any fields the
 * on-Nostr definition does not carry.
 *
 * Visual resolution order for emoji/image:
 *   1. definition `image` tags → `images` (all of them) + `image` (the primary);
 *   2. definition JSON `emoji`;
 *   3. bundled itemId→emoji fallback;
 *   4. generic package emoji.
 *
 * Step 1 copies the package's parsed collection through UNCHANGED — same
 * entries, same order, same markers, including markers this spec version does
 * not define. Island narrows the collection per render context later
 * (`item-image-resolution.ts`); it never narrows it here, because a lossy
 * projection at the adapter would make every downstream policy impossible.
 */
/**
 * Read the wearable facts an issuer declares in `content.visual`.
 *
 * `visual.slot` says WHERE a cosmetic is worn and `visual.forms` says WHICH
 * Blobbi forms it fits. Both are optional in the kind:31632 spec, and both are
 * read defensively: `contentJson` is whatever the issuer published, so a wrong
 * type at any level resolves to "not declared" rather than throwing or being
 * coerced into a plausible-looking lie.
 *
 * Absent is NOT the same as empty. A missing `forms` means the issuer placed no
 * restriction (`null`); an empty array would mean they restricted it to nothing,
 * which no issuer means, so it is normalized to `null` too.
 */
function readVisualFromContent(contentJson: unknown): {
  slot: string | null;
  forms: readonly string[] | null;
  visualDiagnostics: DefinitionVisualDiagnostics;
} {
  const visual = readVisualObject(contentJson);
  if (visual === null) {
    return {
      slot: null,
      forms: null,
      visualDiagnostics: { slot: 'missing', forms: 'absent' },
    };
  }

  // --- slot ---------------------------------------------------------------
  // Missing and malformed both end in "not equippable", but they are reported
  // differently: one is an issuer who has not said yet, the other is an issuer
  // who said something unusable.
  let slot: string | null = null;
  let slotState: DefinitionVisualDiagnostics['slot'];
  const rawSlot = visual.slot;
  if (rawSlot === undefined) {
    slotState = 'missing';
  } else if (typeof rawSlot !== 'string' || rawSlot.trim() === '') {
    slotState = 'malformed';
  } else {
    slot = rawSlot;
    slotState = 'declared';
  }

  // --- forms --------------------------------------------------------------
  // ABSENT IS NOT EMPTY. An issuer who says nothing about forms has placed no
  // restriction, so a plain cosmetic with no `forms` key fits every Blobbi.
  // An issuer who publishes `forms: []`, or a non-array, or an array with no
  // usable strings, has said something that cannot be honoured — that is a
  // broken definition, not a universal one, and Island refuses to guess which
  // it meant.
  let forms: readonly string[] | null = null;
  let formsState: DefinitionVisualDiagnostics['forms'];
  const rawForms = visual.forms;
  if (rawForms === undefined) {
    formsState = 'absent';
  } else if (!Array.isArray(rawForms)) {
    formsState = 'malformed';
  } else {
    const usable = rawForms.filter(
      (f): f is string => typeof f === 'string' && f.trim() !== '',
    );
    if (usable.length === 0) {
      formsState = 'malformed';
    } else {
      forms = usable;
      formsState = 'declared';
    }
  }

  return { slot, forms, visualDiagnostics: { slot: slotState, forms: formsState } };
}

/**
 * Read the effect-visual declarations (`visual.kind`, `visual.effect`,
 * `visual.effectSlot`) out of a definition's content.
 *
 * DIAGNOSTICS ONLY. These are what the ISSUER claims the item does; whether an
 * item actually activates a local effect is decided by the trusted
 * full-address registry and never by these values (a third-party event may
 * claim any of them). They are parsed so fixture tests can assert
 * expected-vs-published agreement and the dev inspector can display it.
 *
 * Returns `undefined` when the definition declares none of the three fields,
 * so plain wearables and consumables carry no vestigial effect record.
 */
function readEffectVisualFromContent(
  contentJson: unknown,
): DefinitionEffectVisual | undefined {
  const visual = readVisualObject(contentJson);
  if (visual === null) return undefined;

  const readString = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

  const kind = readString(visual.kind);
  const effect = readString(visual.effect);
  const effectSlot = readString(visual.effectSlot);

  if (kind === null && effect === null && effectSlot === null) return undefined;
  return { kind, effect, effectSlot };
}

/** The human-readable `content.description`, or `undefined`. Display only. */
function readDescriptionFromContent(contentJson: unknown): string | undefined {
  if (!contentJson || typeof contentJson !== 'object') return undefined;
  const description = (contentJson as Record<string, unknown>).description;
  return typeof description === 'string' && description.trim() !== ''
    ? description
    : undefined;
}

/** The `content.visual` object, or `null` when there is not one. */
function readVisualObject(contentJson: unknown): Record<string, unknown> | null {
  if (!contentJson || typeof contentJson !== 'object') return null;
  const visual = (contentJson as Record<string, unknown>).visual;
  if (!visual || typeof visual !== 'object' || Array.isArray(visual)) return null;
  return visual as Record<string, unknown>;
}

export function resolveFromDefinition(
  def: GameItemDefinition,
): ResolvedBlobbiItemDefinition {
  const address = def.address;
  const itemId = addressToItemId(address);
  const bundled = bundledFallbackDefinition(address);
  const fromContent = readEffectsFromContent(def.contentJson);
  const visual = readVisualFromContent(def.contentJson);
  const effectVisual = readEffectVisualFromContent(def.contentJson);
  const description = readDescriptionFromContent(def.contentJson);

  const category: ItemCategory | 'unknown' =
    def.category && VALID_CATEGORIES.has(def.category)
      ? (def.category as ItemCategory)
      : (bundled?.category ?? 'unknown');

  const emoji =
    fromContent.emoji ?? bundled?.emoji ?? emojiForItemId(itemId);

  return {
    address,
    itemId,
    d: def.id,
    name: def.name || bundled?.name || def.id,
    type: def.type || bundled?.type || 'unknown',
    category,
    effects: fromContent.effects ?? bundled?.effects ?? {},
    action: fromContent.action ?? bundled?.action ?? null,
    stages: fromContent.stages ?? bundled?.stages ?? ['egg', 'baby', 'adult'],
    emoji,
    // `def.image` IS the package's primary selection over `def.images`, so the
    // flattened field and the collection can never disagree.
    image: def.image,
    images: def.images,
    topics: def.topics.length > 0 ? def.topics : (bundled?.topics ?? []),
    // Wearable facts come from the PUBLISHED definition only. The bundled
    // fallback deliberately records neither, so these never silently inherit a
    // slot the issuer did not actually declare.
    slot: visual.slot,
    forms: visual.forms,
    visualDiagnostics: visual.visualDiagnostics,
    ...(description === undefined ? {} : { description }),
    // The published `rarity` tag, verbatim, when present. Display metadata.
    ...(def.rarity === undefined ? {} : { rarity: def.rarity }),
    // Issuer-claimed effect fields, for diagnostics — never for activation.
    ...(effectVisual === undefined ? {} : { effectVisual }),
    source: 'definition',
  };
}

/**
 * Full resolution order (Phase 3):
 *   1. valid fetched 31632 (passed in `definitions` by address);
 *   2. bundled canonical fallback by address;
 *   3. generic unknown-item model.
 */
export function resolveItemDefinition(
  address: string,
  definitions: ReadonlyMap<string, GameItemDefinition>,
  dHint?: string,
): ResolvedBlobbiItemDefinition {
  const fetched = definitions.get(address);
  if (fetched) return resolveFromDefinition(fetched);
  const bundled = bundledFallbackDefinition(address);
  if (bundled) return bundled;
  return unknownItemDefinition(address, dHint);
}

/**
 * Parse a kind:31633 event into a package `GameInventory`, using the package's
 * recommended default duplicate strategy (`last`, via permissive mode). Returns
 * `null` for rejected events.
 */
export function parseInventoryEvent(event: NostrEvent): GameInventory | null {
  const result = parseGameInventoryResult(event, { mode: 'permissive' });
  return result.ok ? result.value : null;
}

/** Re-export the package's item-list accessor for convenience. */
export { getInventoryItems };
