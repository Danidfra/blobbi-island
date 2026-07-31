/**
 * Blobbi Island — placement AUTHORIZATION POLICY.
 *
 * WHY THIS FILE EXISTS AT ALL.
 *
 * `@nostr-games/inventory` parses, validates and rebuilds kind:31634 documents
 * and refuses to decide anything else. It will happily parse a placement in
 * which a stranger dresses your Blobbi in an item they do not own, issued by
 * somebody nobody trusts, in a slot it does not fit. That is correct: a
 * protocol library that silently dropped such placements would make every
 * consumer's policy invisible and unauditable.
 *
 * So the policy is here, in one file, written down:
 *
 *   1. AUTHOR — the placement author must be allowed to modify the Blobbi.
 *      Island's rule is the simplest sound one: the author must be the Blobbi's
 *      owner. Delegation does not exist on Island today; when it does, it is
 *      widened HERE and nowhere else.
 *   2. OWNERSHIP — equipping requires the item in the player's kind:31633
 *      inventory with quantity > 0. Placement is not possession, so this is
 *      checked against the inventory, never inferred from the placement.
 *   3. ISSUER — only cosmetics whose kind:31632 definition is signed by the
 *      official issuer are offered or rendered in production.
 *   4. FORM — when the definition declares `visual.forms`, the Blobbi's current
 *      form must be among them.
 *   5. SLOT — the entry's slot must be a slot this renderer knows.
 *
 * WHAT IS DELIBERATELY NOT POLICY: quantity is NOT consumed by equipping, and
 * unequipping does NOT return anything. Ownership changes are kind:31633's job
 * and flow through `useInventoryMutation`; a placement never moves a quantity.
 */

import type { AccessorySlot } from '@blobbi/react';
import { REAR_VIEW_HIDDEN_SLOTS } from '@blobbi/react';
import type { GameItemPlacementEntry } from '@/inventory/package';
import { officialCosmeticByAddress } from '@/protocol/event-registry';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';

/** Every slot the Island renderer understands. `unknown` is not equippable. */
export const EQUIPPABLE_SLOTS: readonly AccessorySlot[] = [
  'headwear',
  'eyewear',
  'back',
  'neckwear',
  'handheld',
  'face-mark',
  'aura',
  'color-overlay',
];

const EQUIPPABLE_SLOT_SET: ReadonlySet<string> = new Set(EQUIPPABLE_SLOTS);

/** Whether `slot` is a slot this client can equip into and draw. */
export function isEquippableSlot(slot: string | undefined): slot is AccessorySlot {
  return slot !== undefined && EQUIPPABLE_SLOT_SET.has(slot);
}

export { REAR_VIEW_HIDDEN_SLOTS };

/**
 * Why a placement entry was refused.
 *
 * Machine-readable so the dev inspector can explain a hidden accessory instead
 * of leaving a developer guessing why their hat vanished.
 */
export type PlacementRejectionReason =
  | 'unauthorized-author'
  | 'not-owned'
  | 'untrusted-issuer'
  | 'unknown-definition'
  | 'incompatible-form'
  | 'unsupported-slot'
  | 'slot-mismatch'
  | 'unsupported-mode';

export interface PlacementPolicyContext {
  /** The pubkey that signed the placement event. */
  authorPubkey: string;
  /** The Blobbi owner's pubkey. */
  ownerPubkey: string;
  /** Current life stage / form of the Blobbi, when known. */
  form?: string | undefined;
  /** `itemAddress → quantity` from the player's kind:31633 inventory. */
  quantityByAddress: ReadonlyMap<string, number>;
  /** `itemAddress → resolved definition` from the official catalog. */
  definitionsByAddress: ReadonlyMap<string, ResolvedBlobbiItemDefinition>;
}

export interface PlacementDecision {
  allowed: boolean;
  /** Populated when `allowed` is false. */
  reason?: PlacementRejectionReason;
}

const ALLOWED: PlacementDecision = { allowed: true };

function refuse(reason: PlacementRejectionReason): PlacementDecision {
  return { allowed: false, reason };
}

/**
 * Whether `authorPubkey` may modify the given Blobbi's equipment.
 *
 * Owner-only. A placement event signed by anyone else is a valid kind:31634
 * document that Island does not act on — it is not corrupt, it simply is not
 * about a Blobbi its author controls.
 */
export function mayModifyCharacter(
  authorPubkey: string,
  ownerPubkey: string,
): boolean {
  return authorPubkey !== '' && authorPubkey === ownerPubkey;
}

/**
 * Whether the definition declares forms, and if so whether `form` is one.
 *
 * A definition with no declared forms fits every form: silence means "no
 * restriction", not "no forms allowed".
 */
export function formIsCompatible(
  definition: ResolvedBlobbiItemDefinition | undefined,
  form: string | undefined,
): boolean {
  const declared = definitionForms(definition);
  if (declared === null || declared.length === 0) return true;
  if (form === undefined || form === '') return true;
  return declared.includes(form);
}

/**
 * The forms a definition declares, or `null` when it declares none.
 *
 * Reads the already-parsed `forms` field rather than re-reading
 * `content.visual`: the content is parsed exactly once, in
 * `resolveFromDefinition`, so there is one interpretation of what an issuer
 * said and not two that can drift.
 */
export function definitionForms(
  definition: ResolvedBlobbiItemDefinition | undefined,
): readonly string[] | null {
  return definition?.forms ?? null;
}

/**
 * The slot a definition declares, when it is one this renderer can draw.
 *
 * Returns `null` for an undeclared slot and for a declared slot outside
 * {@link EQUIPPABLE_SLOTS} — an issuer naming a slot Island does not know is
 * not an error, it just is not something this client can place.
 */
export function definitionSlot(
  definition: ResolvedBlobbiItemDefinition | undefined,
): AccessorySlot | null {
  const slot = definition?.slot ?? undefined;
  return isEquippableSlot(slot) ? slot : null;
}

/**
 * Decide whether a single parsed placement entry may render in production.
 *
 * Every gate is applied; the FIRST failure is reported, in the order author →
 * mode → slot → issuer → definition → ownership → form. That order is from
 * broadest to narrowest so the reason a developer sees is the most useful one:
 * "you do not own this Blobbi" beats "…and also the hat does not fit a baby".
 */
export function decidePlacementEntry(
  entry: GameItemPlacementEntry,
  context: PlacementPolicyContext,
): PlacementDecision {
  if (!mayModifyCharacter(context.authorPubkey, context.ownerPubkey)) {
    return refuse('unauthorized-author');
  }

  // Island renders equipment only. `place` entries are valid protocol and are
  // simply not what a character equipment document is for.
  if (entry.mode !== 'equip') {
    return refuse('unsupported-mode');
  }

  if (!isEquippableSlot(entry.slot)) {
    return refuse('unsupported-slot');
  }

  // Trust is the FULL address, never the `d` alone: kind:31632 is addressable,
  // so anyone may publish `blobbi:cosmetic:<anything>` and relays will serve it.
  if (officialCosmeticByAddress(entry.item) === null) {
    return refuse('untrusted-issuer');
  }

  const definition = context.definitionsByAddress.get(entry.item);
  if (definition === undefined) {
    return refuse('unknown-definition');
  }

  // The issuer says where their cosmetic goes. A placement that claims a
  // different slot is not drawn there: it would let a client decide a hat is
  // eyewear. A definition that declares no usable slot cannot be placed at all,
  // rather than being placed wherever the placement asked.
  const declaredSlot = definitionSlot(definition);
  if (declaredSlot === null || declaredSlot !== entry.slot) {
    return refuse('slot-mismatch');
  }

  // Possession is kind:31633. Equipping requires it; equipping never spends it.
  if ((context.quantityByAddress.get(entry.item) ?? 0) <= 0) {
    return refuse('not-owned');
  }

  if (!formIsCompatible(definition, context.form)) {
    return refuse('incompatible-form');
  }

  return ALLOWED;
}

export interface RenderablePlacement {
  entry: GameItemPlacementEntry;
  slot: AccessorySlot;
  definition: ResolvedBlobbiItemDefinition;
}

/**
 * Filter parsed placement entries down to the ones production may draw.
 *
 * Deterministic slot conflict handling: when a document carries more than one
 * equipped entry for a slot — which the package tolerates and warns about —
 * the LAST one wins, matching `getLastEquippedPlacementBySlot` and the
 * last-wins semantics of `setEquippedPlacementForSlot`. The alternative
 * (drawing both) would stack two hats on one head.
 */
export function selectRenderablePlacements(
  entries: readonly GameItemPlacementEntry[],
  context: PlacementPolicyContext,
): RenderablePlacement[] {
  const bySlot = new Map<AccessorySlot, RenderablePlacement>();

  for (const entry of entries) {
    if (!decidePlacementEntry(entry, context).allowed) continue;
    // The decision above guarantees both of these.
    const slot = entry.slot as AccessorySlot;
    const definition = context.definitionsByAddress.get(
      entry.item,
    ) as ResolvedBlobbiItemDefinition;
    bySlot.set(slot, { entry, slot, definition });
  }

  return [...bySlot.values()];
}
