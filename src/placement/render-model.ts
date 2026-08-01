/**
 * Blobbi Island — turning kind:31634 placements into renderer input.
 *
 * THE BOUNDARY THIS FILE DEFENDS. `@blobbi/react` draws accessories from
 * `{ code, slot, x, y, scale, rot, flipX?, url? }` where x/y are percentages of
 * the renderer box. `@nostr-games/inventory` parses a coordinate-system-neutral
 * placement that may carry a 2D or 3D reference, an Euler or quaternion
 * rotation, a 2D or 3D scale, and any number of fields neither library knows.
 * Neither of them should learn the other's model, so the translation happens
 * here — in Island, which is the only party that knows both.
 *
 * DEFAULTS LIVE HERE, NOT IN THE PROTOCOL. The package deliberately writes no
 * rendering defaults into a parsed document: a placement with no `position` is
 * a placement with no position, not one at (50,50). Island supplies the
 * defaults because Island owns the renderer box.
 *
 * WHAT IS NOT TRANSLATED. A 3D position, a quaternion rotation and a
 * non-percent reference are all valid protocol that this 2D renderer cannot
 * honour. They are reported as unsupported rather than flattened into a
 * plausible-looking 2D approximation, because a silently wrong hat position is
 * harder to diagnose than a missing one.
 */

import type { AccessoryPlacementInput, AccessorySlot } from '@blobbi/react';
import type {
  GameItemPlacementEntry,
  GameItemPlacementReference,
} from '@/inventory/package';
import { isGameItemPlacement2DReference } from '@/inventory/package';
import type { PlacementSlot } from './policy';

/**
 * Island's rendering defaults for fields a placement omits.
 *
 * Identical to the legacy `EQUIP_TAG_DEFAULTS` so a cosmetic published without
 * an explicit transform lands exactly where the old system put an accessory
 * with no coordinates: centred, unrotated, unscaled.
 */
export const PLACEMENT_RENDER_DEFAULTS = {
  x: 50,
  y: 50,
  scale: 1,
  rot: 0,
  flipX: false,
} as const;

/**
 * The reference coordinate system Island writes and can draw.
 *
 * Percent of a 100x100 box with a top-left origin — the same space the
 * renderer's x/y percentages already live in, so no conversion is ever needed
 * and none is ever performed.
 */
export const ISLAND_PLACEMENT_REFERENCE = {
  space: '2d',
  unit: 'percent',
  origin: 'top-left',
  width: 100,
  height: 100,
} as const satisfies GameItemPlacementReference;

/**
 * Whether Island's 2D renderer can interpret coordinates in this reference.
 *
 * An ABSENT reference is accepted: a document that carries no coordinates needs
 * no coordinate system, and one that does carries them in the only space this
 * client writes. A reference that is present and is anything other than 2D
 * percent is refused — a 3D metre position means something this renderer cannot
 * represent.
 */
export function referenceIsRenderable(
  reference: GameItemPlacementReference | undefined,
): boolean {
  if (reference === undefined) return true;
  if (!isGameItemPlacement2DReference(reference)) return false;
  return reference.unit === ISLAND_PLACEMENT_REFERENCE.unit;
}

/** Why a transform could not be rendered. */
export type UnsupportedTransformReason =
  | 'unsupported-reference'
  | 'unsupported-rotation'
  | 'three-dimensional-position';

export type TransformResult =
  | { ok: true; input: AccessoryPlacementInput }
  | { ok: false; reason: UnsupportedTransformReason };

/**
 * Translate one policy-approved placement entry into renderer input.
 *
 * `code` is the ITEM ADDRESS, not a legacy accessory code. The renderer treats
 * it as an opaque stable identity and hands it back to the source resolver,
 * which is the only thing that needs to know it is an address — so the package
 * stays free of Blobbi concepts and the renderer stays free of Nostr ones.
 */
export function toAccessoryPlacementInput(
  entry: GameItemPlacementEntry,
  slot: AccessorySlot,
  reference: GameItemPlacementReference | undefined,
): TransformResult {
  if (!referenceIsRenderable(reference)) {
    return { ok: false, reason: 'unsupported-reference' };
  }

  const position = entry.position;
  if (position !== undefined && position.z !== undefined) {
    return { ok: false, reason: 'three-dimensional-position' };
  }

  const rotation = entry.rotation;
  let rot: number = PLACEMENT_RENDER_DEFAULTS.rot;
  if (rotation !== undefined) {
    // Only a degrees Euler rotation maps onto a CSS rotation. A quaternion is
    // not converted: doing so would silently pick an axis convention this
    // renderer has never defined.
    if (rotation.type !== 'euler' || rotation.unit !== 'degrees') {
      return { ok: false, reason: 'unsupported-rotation' };
    }
    // 2D rotation is the z component. x/y tilts are out-of-plane and are
    // ignored rather than refused — a hat tipped 3° forward still reads as
    // that hat, and refusing would hide it entirely.
    rot = typeof rotation.z === 'number' ? rotation.z : PLACEMENT_RENDER_DEFAULTS.rot;
  }

  // Uniform scale only: the renderer multiplies one base size, so a placement
  // with different x and y is honoured on its x factor rather than refused.
  const scale = entry.scale?.x ?? PLACEMENT_RENDER_DEFAULTS.scale;

  const input: AccessoryPlacementInput = {
    code: entry.item,
    slot,
    x: position?.x ?? PLACEMENT_RENDER_DEFAULTS.x,
    y: position?.y ?? PLACEMENT_RENDER_DEFAULTS.y,
    scale,
    rot,
    flipX: entry.flip?.x ?? PLACEMENT_RENDER_DEFAULTS.flipX,
  };

  return { ok: true, input };
}

/**
 * Build the placement entry Island writes when a player equips an item.
 *
 * The entry `id` IS the slot. One equipped item per slot is Island's model, and
 * making the id the slot means `setEquippedPlacementForSlot`'s last-wins
 * collapse and a plain id lookup agree by construction — there is never an
 * `id: "abc123"` in a slot whose name is `head`.
 *
 * Only fields the player actually set are written. An item at the default
 * position writes no `position`, so a future change to Island's defaults moves
 * every un-customized accessory instead of leaving them frozen at values a
 * previous release happened to serialize.
 */
export function buildEquipEntry(options: {
  itemAddress: string;
  /** A wearable accessory slot or a visual-effect slot — same document. */
  slot: PlacementSlot;
  x?: number;
  y?: number;
  scale?: number;
  rot?: number;
  flipX?: boolean;
  form?: string;
  view?: string;
}): GameItemPlacementEntry {
  const entry: GameItemPlacementEntry = {
    id: options.slot,
    item: options.itemAddress,
    mode: 'equip',
    slot: options.slot,
  };

  if (options.x !== undefined || options.y !== undefined) {
    entry.position = {
      x: options.x ?? PLACEMENT_RENDER_DEFAULTS.x,
      y: options.y ?? PLACEMENT_RENDER_DEFAULTS.y,
    };
  }
  if (options.rot !== undefined && options.rot !== PLACEMENT_RENDER_DEFAULTS.rot) {
    entry.rotation = { type: 'euler', unit: 'degrees', z: options.rot };
  }
  if (options.scale !== undefined && options.scale !== PLACEMENT_RENDER_DEFAULTS.scale) {
    entry.scale = { x: options.scale, y: options.scale };
  }
  if (options.flipX !== undefined && options.flipX !== PLACEMENT_RENDER_DEFAULTS.flipX) {
    entry.flip = { x: options.flipX, y: false };
  }
  if (options.form !== undefined && options.form !== '') {
    entry.form = options.form;
  }
  if (options.view !== undefined && options.view !== '') {
    entry.view = options.view;
  }

  return entry;
}
