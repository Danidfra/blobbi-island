/**
 * Blobbi Island: PURE resolver: which visual effects are ACTIVE on a Blobbi.
 *
 * The first production activation path (Phase 9), as one referentially
 * transparent function:
 *
 *   owned official item in kind:31633
 *           + equipped placement in kind:31634
 *           + trusted full-address registry
 *           + current Blobbi form
 *           ↓
 *   plain `BlobbiVisualEffect[]`, in the renderer's canonical slot order
 *
 * PURE means pure: no hooks, no queries, no signing, no publishing, no clock,
 * no randomness. Inputs are already-parsed placement entries, an
 * address→quantity map and a stage string; the output is JSON-serializable
 * renderer data plus diagnostics. Everything protocol-shaped happened before
 * this function (parsing is the package's job) and everything I/O-shaped
 * happens around it (`useCharacterEquipment`).
 *
 * ## The gates, in order
 *
 *  1. REGISTRY: the entry's item must resolve in the trusted full-address
 *     registry. A third-party event carrying `"effect": "celestial-aura"` under
 *     its own pubkey resolves to nothing and is not even this resolver's
 *     business (the wearable policy reports it separately).
 *  2. MODE: equip only. `place` is valid protocol for furniture, not for a
 *     character's active effects.
 *  3. SLOT: the entry must claim exactly the registry's expected slot. A
 *     placement that puts Celestial Aura in `ambient-particles` is refused, not
 *     honoured: the ISSUER (via the registry) says where an effect lives, never
 *     the placement document.
 *  4. OWNERSHIP: kind:31633 quantity ≥ 1 for the exact full address. A stale
 *     placement referencing an item no longer owned is not rendered, and not
 *     cleaned up either: publishing is never a side effect of rendering.
 *  5. FORM: when the current stage is known it must be among the registered
 *     forms. All twelve current effects support `baby` and `adult`; `egg`
 *     activates nothing. An UNKNOWN stage is no restriction (the same rule the
 *     wearable policy uses), so effects do not flicker off while the Blobbi
 *     list loads.
 *
 * ## Determinism
 *
 * One winner per effect slot: the LAST valid equip entry, matching the
 * package's `setEquippedPlacementForSlot` last-wins collapse and the wearable
 * policy: so a freshly-equipped effect beats a leftover duplicate. The result
 * is ordered by the renderer's own `EFFECT_SLOT_ORDER`; this module does not
 * invent a second order.
 */

import type { BlobbiVisualEffect } from '@blobbi/react';
import { EFFECT_SLOT_ORDER } from '@blobbi/react';
import type { GameItemPlacementEntry } from '@/inventory/package';
import {
  resolveOfficialVisualEffectItem,
  type AddressedVisualEffectItem,
} from './official-visual-effect-items';

/** Why an effect-item placement did not activate. */
export type EffectRejectionReason =
  | 'unsupported-mode'
  | 'slot-mismatch'
  | 'not-owned'
  | 'incompatible-form'
  /** A later valid entry claimed the same slot (deterministic last-wins). */
  | 'slot-conflict';

/** An effect-item placement that is live on the Blobbi right now. */
export interface ActiveEffectPlacement {
  entry: GameItemPlacementEntry;
  registration: AddressedVisualEffectItem;
}

/** An effect-item placement that was refused, and the first reason why. */
export interface RejectedEffectPlacement {
  entry: GameItemPlacementEntry;
  registration: AddressedVisualEffectItem;
  reason: EffectRejectionReason;
}

export interface ActiveBlobbiEffectResolution {
  /**
   * Renderer input, canonical slot order, at most one entry per effect slot.
   * Plain serializable data, exactly what `BlobbiRendererView.effects` takes.
   */
  effects: readonly BlobbiVisualEffect[];
  /** The winning placements, same order as {@link effects}. */
  active: readonly ActiveEffectPlacement[];
  /** Every refused effect-item placement, in document order, with its reason. */
  rejected: readonly RejectedEffectPlacement[];
}

const EMPTY_RESOLUTION: ActiveBlobbiEffectResolution = Object.freeze({
  effects: Object.freeze([]) as readonly BlobbiVisualEffect[],
  active: Object.freeze([]) as readonly ActiveEffectPlacement[],
  rejected: Object.freeze([]) as readonly RejectedEffectPlacement[],
});

export interface ResolveActiveBlobbiEffectsInput {
  /** Parsed entries of the character's kind:31634 equipment document. */
  placements: readonly GameItemPlacementEntry[];
  /** `itemAddress → quantity` from the OWNER's kind:31633 inventory. */
  quantityByAddress: ReadonlyMap<string, number>;
  /** Current Blobbi stage (`egg` | `baby` | `adult`), when known. */
  stage?: string | undefined;
}

/**
 * Is this placement entry an OFFICIAL effect item's?
 *
 * Address-keyed, so a stranger's copy of an official `d` answers `false` and
 * stays entirely on the wearable-policy path (where it is refused as
 * `untrusted-issuer`). Used by callers to partition a document's entries.
 */
export function isEffectItemPlacement(entry: GameItemPlacementEntry): boolean {
  return resolveOfficialVisualEffectItem(entry.item) !== null;
}

/**
 * Resolve the active visual effects for one Blobbi. Pure; see module doc.
 *
 * Entries whose item is not an official effect item are IGNORED here, not
 * rejected: wearables and unknown items belong to `placement/policy.ts`, and
 * reporting them from two places would give one entry two contradictory
 * explanations.
 */
export function resolveActiveBlobbiEffects(
  input: ResolveActiveBlobbiEffectsInput,
): ActiveBlobbiEffectResolution {
  const { placements, quantityByAddress, stage } = input;
  if (placements.length === 0) return EMPTY_RESOLUTION;

  const rejected: RejectedEffectPlacement[] = [];
  const winnerBySlot = new Map<string, ActiveEffectPlacement>();

  for (const entry of placements) {
    const registration = resolveOfficialVisualEffectItem(entry.item);
    if (registration === null) continue; // not an effect item; not our business

    // 2. MODE: equip only.
    if (entry.mode !== 'equip') {
      rejected.push({ entry, registration, reason: 'unsupported-mode' });
      continue;
    }

    // 3. SLOT: exactly the registered expected slot, canonical comparison.
    if (entry.slot !== registration.effectSlot) {
      rejected.push({ entry, registration, reason: 'slot-mismatch' });
      continue;
    }

    // 4. OWNERSHIP: the exact full address, quantity ≥ 1. Placement is never
    // possession; a definition existing is never possession; being registered
    // official is never possession.
    if ((quantityByAddress.get(entry.item) ?? 0) <= 0) {
      rejected.push({ entry, registration, reason: 'not-owned' });
      continue;
    }

    // 5. FORM: a known stage must be registered; an unknown stage is not a
    // restriction. `egg` is not among any current effect's forms, so an egg
    // activates nothing without this module hardcoding that fact.
    if (
      stage !== undefined &&
      stage !== '' &&
      !registration.forms.includes(stage as (typeof registration.forms)[number])
    ) {
      rejected.push({ entry, registration, reason: 'incompatible-form' });
      continue;
    }

    // Deterministic winner: LAST valid entry per slot. The earlier occupant
    // becomes a diagnosed conflict loser rather than silently vanishing.
    const previous = winnerBySlot.get(registration.effectSlot);
    if (previous !== undefined) {
      rejected.push({
        entry: previous.entry,
        registration: previous.registration,
        reason: 'slot-conflict',
      });
    }
    winnerBySlot.set(registration.effectSlot, { entry, registration });
  }

  if (winnerBySlot.size === 0 && rejected.length === 0) return EMPTY_RESOLUTION;

  // Canonical order is the renderer's, not this module's.
  const active: ActiveEffectPlacement[] = [];
  for (const slot of EFFECT_SLOT_ORDER) {
    const winner = winnerBySlot.get(slot);
    if (winner) active.push(winner);
  }

  return {
    effects: active.map((a) => ({ id: a.registration.effectId })),
    active,
    rejected,
  };
}

/** Human-readable explanation for a refused effect placement. */
export function explainEffectRejection(reason: EffectRejectionReason): string {
  switch (reason) {
    case 'unsupported-mode':
      return 'Its placement mode is not "equip".';
    case 'slot-mismatch':
      return 'Its placement claims a different slot than this effect belongs to.';
    case 'not-owned':
      return 'It is not in the inventory any more (stale placement).';
    case 'incompatible-form':
      return 'It does not support this Blobbi’s current form.';
    case 'slot-conflict':
      return 'Another effect equipped later occupies the same slot.';
    default: {
      const exhaustive: never = reason;
      return String(exhaustive);
    }
  }
}
