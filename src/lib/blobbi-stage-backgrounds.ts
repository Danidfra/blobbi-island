/**
 * Blobbi Island — the Blobbi STAGE BACKGROUND slot.
 *
 * ## What this replaces
 *
 * The Blobbi window used to draw one hardcoded PNG behind the Blobbi, reached
 * through `getBlobbiBackground('blobbi-bg-default')` — a lookup table with one
 * row, fed by a prop default that nothing ever overrode. The picture was not a
 * choice, it was a constant with a map around it.
 *
 * It is now a real customization slot: an explicitly modelled DEFAULT, a
 * registry other backgrounds join, a resolution step that survives an id this
 * build has never heard of, and a selection persisted with the player.
 *
 * ## Why this is not kind:31634
 *
 * kind:31634 is the CHARACTER EQUIPMENT document, and `src/placement/policy.ts`
 * is explicit about what a slot in it means: a placement names a slot the
 * RENDERER draws on the Blobbi (`headwear`, `aura`, `color-overlay`, …), and a
 * definition is only equippable when the issuer declared `content.visual.slot`
 * as one of them. A stage background is drawn BEHIND the Blobbi by the window,
 * not on it by the renderer; giving it a placement slot would mean teaching
 * `@blobbi/react` about a slot it does not paint and widening `isPlacementSlot`
 * to a value no renderer honours. That is a bigger, worse change than the one
 * this feature needs.
 *
 * ## The representation actually used
 *
 * The smallest clean one, and it needed NO new kind and no new tag:
 *
 *   what exists   → this registry (built-ins), plus, for anything unlockable,
 *                   a trusted kind:31632 definition addressed by
 *                   `31632:<issuer>:<d>` — the exact identity rule
 *                   `official-visual-effect-items.ts` already uses
 *   what is owned → kind:31633 quantity, as for every other item
 *   what is chosen→ the `background` tag of the kind:11125 Blobbonaut profile,
 *                   which the parser has read and the serializer has written
 *                   since before this feature existed (`blobbi-parsers.ts`).
 *                   Nothing was invented; a managed tag stopped being unused.
 *
 * Ids are the STABLE part. A built-in's id is its own; an unlockable one's id
 * is its full `31632:<issuer>:<d>` address — never an event id, because a
 * kind:31632 definition is addressable and its issuer republishes it (new event
 * id, same address) whenever metadata changes.
 */

import { ASSET_DIRS } from '@/lib/asset-paths';

/**
 * The canonical aspect ratio of the stage box, as a CSS `aspect-ratio` value.
 *
 * 2:3 PORTRAIT, and this is the fix for the bug the redesign inherited. The
 * shipped backdrop is 484×726 — portrait — and the stage container asked for
 * `aspect-square` and then `object-cover`. Cover preserves the image's ratio
 * and fills the box, so a 2:3 picture in a 1:1 box loses a THIRD of its height,
 * cropped equally from top and bottom: the painted floor the Blobbi is supposed
 * to stand on was cut away, which is why the Blobbi — anchored to the bottom of
 * the box — appeared to float in the middle of a scene with no ground.
 *
 * The box now matches the art, so `cover` has nothing to crop. Backgrounds are
 * authored to this ratio; one that is not simply gets covered as before, which
 * is a defect in that background rather than in the window.
 */
export const STAGE_ASPECT_RATIO = '2 / 3';

/** How a background is painted. */
export type StageBackgroundArt =
  /** A bitmap in `public/`. */
  | { readonly kind: 'image'; readonly src: string }
  /**
   * A CSS gradient built from the ACTIVE THEME's own tokens.
   *
   * Not a shortcut for a missing asset: it is the one backdrop that follows the
   * player's theme, so a Lantern Night island gets a dusk stage rather than a
   * midday photo. It is also what proves the slot is a slot — a background that
   * is not an image at all still selects, renders and falls back like any
   * other.
   */
  | { readonly kind: 'gradient'; readonly css: string };

/** How a background is obtained. */
export type StageBackgroundUnlock =
  /** Shipped with the client. Always available, to everybody. */
  | { readonly kind: 'builtin' }
  /**
   * Owned as an item: a trusted official kind:31632 definition, held with
   * quantity > 0 in the player's kind:31633 inventory.
   *
   * `address` is the FULL `31632:<issuer>:<d>` — the `d` alone would let anyone
   * publish a definition with the same identifier and unlock the background for
   * free, which is the exact hazard `official-visual-effect-items.ts` documents.
   */
  | { readonly kind: 'item'; readonly address: string };

export interface StageBackground {
  /** Stable id. Built-ins own their own; item-backed ones use their address. */
  readonly id: string;
  /** Shown in the picker. */
  readonly name: string;
  /** One line under the name, in the world's voice. */
  readonly description: string;
  /** Shown on the compact swatch. */
  readonly emoji: string;
  readonly art: StageBackgroundArt;
  readonly unlock: StageBackgroundUnlock;
}

/**
 * The default background's id.
 *
 * It is the string the old hardcoded prop already used, on purpose: every
 * profile that has ever stored a background stored this, so modelling the
 * default explicitly costs no migration.
 */
export const DEFAULT_STAGE_BACKGROUND_ID = 'blobbi-bg-default';

const studio: StageBackground = {
  id: DEFAULT_STAGE_BACKGROUND_ID,
  name: 'Blobbi Studio',
  description: 'The little painted room every Blobbi is photographed in.',
  emoji: '🖼️',
  art: {
    kind: 'image',
    src: `${ASSET_DIRS.blobbiBackgrounds}/blobbi-bg-default.png`,
  },
  unlock: { kind: 'builtin' },
};

const islandSky: StageBackground = {
  id: 'blobbi-bg-island-sky',
  name: 'Island Sky',
  description: 'Open sky over warm sand — and it follows your theme.',
  emoji: '🌅',
  art: {
    kind: 'gradient',
    // Theme tokens only. Written as a token reference rather than a colour so
    // this backdrop is repainted by a theme switch with no code involved,
    // exactly like every other surface in the game.
    css:
      'linear-gradient(180deg, hsl(var(--island-sky)) 0%, ' +
      'hsl(var(--island-ocean)) 52%, hsl(var(--island-sand)) 53%, ' +
      'hsl(var(--island-sand)) 100%)',
  },
  unlock: { kind: 'builtin' },
};

/** Every background this build ships, in picker order. */
export const stageBackgrounds: readonly StageBackground[] = [studio, islandSky];

const byId = new Map(stageBackgrounds.map((b) => [b.id, b]));

/** The default background, as an object. */
export const DEFAULT_STAGE_BACKGROUND: StageBackground = studio;

/**
 * Resolve a stored id to a background, falling back to the default.
 *
 * The fallback is the whole error-handling story, and it is why the stored
 * value is typed `string`: a selection outlives the build that wrote it. A
 * player who chose a seasonal backdrop that has since been removed, whose
 * profile carries a value written by another Blobbi client, or who is running a
 * cached bundle, gets the default studio — never a blank stage.
 */
export function resolveStageBackground(id: string | undefined | null): StageBackground {
  return (id ? byId.get(id) : undefined) ?? DEFAULT_STAGE_BACKGROUND;
}

/** Whether `id` names a background in this build. */
export function isKnownStageBackgroundId(id: string | undefined | null): boolean {
  return id !== undefined && id !== null && byId.has(id);
}

/**
 * Whether the player may select `background`.
 *
 * Built-ins are always selectable. An item-backed background needs the item in
 * kind:31633 with quantity > 0 — possession, checked against the inventory and
 * never inferred from the fact that it was previously selected. This is the
 * same rule `decidePlacementEntry` applies to cosmetics, and it is written here
 * so that shipping an unlockable backdrop later is a registry entry rather than
 * a policy change.
 *
 * No production background is item-backed today; the gate exists so the first
 * one cannot arrive without it.
 */
export function isStageBackgroundOwned(
  background: StageBackground,
  quantityByAddress: ReadonlyMap<string, number>,
): boolean {
  if (background.unlock.kind === 'builtin') return true;
  return (quantityByAddress.get(background.unlock.address) ?? 0) > 0;
}
