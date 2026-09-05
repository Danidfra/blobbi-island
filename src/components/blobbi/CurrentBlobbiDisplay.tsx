/**
 * CurrentBlobbiDisplay: the LOCAL-PLAYER wrapper around the pure renderer.
 *
 * This component owns the data side: it resolves the current companion via
 * Nostr-backed hooks (`useBlobbis`, `useBlobbonautProfile`), fetches the local
 * player's equipped accessories, normalizes them, and hands everything to the
 * pure `BlobbiRenderer` as explicit props. Remote players do NOT go
 * through here, `RemoteBlobbiSprite` uses `BlobbiRenderer` directly, so
 * rendering someone else's Blobbi never subscribes to the local player's data.
 *
 * `visualOverride` remains supported for the info modal's read-only remote
 * preview (a single modal instance, where the extra local hooks are the
 * pre-existing behavior).
 *
 * ACCESSORY OWNERSHIP. Accessories follow the visual, never the component:
 *
 *   no `visualOverride`                    → local companion + local equipment
 *   `visualOverride`, no `accessoryOverride` → that visual, wearing nothing
 *   `visualOverride` + `accessoryOverride` → that visual, wearing exactly those
 *
 * The middle row is a deliberate behavior change (Phase 5). Previously the
 * local player's equipment was drawn on top of ANY visual, so the info modal's
 * read-only preview of another player's Blobbi rendered it wearing *your* hats.
 * Accessories are not a property of "the local user"; they are a property of
 * the Blobbi being drawn, and a caller that does not supply them does not have
 * them. Fetching another player's equipment is out of scope, the honest render
 * of "unknown equipment" is none.
 *
 * Geometry lives entirely in the pure renderer: one square fixed-px box per
 * size token, shared by body and accessories (see lib/blobbi-render-size.ts
 * and docs/blobbi-renderer-contract.md).
 *
 * ACCESSORY ARTWORK follows `facing`: a Blobbi seen from behind asks for each
 * accessory's `back` image view and a front-facing one asks for `front`, both
 * resolved here and handed to the renderer as plain URLs (see
 * lib/island-accessory-sources.ts and docs/game-item-image-views.md). Which
 * accessories are drawn at all is a separate, unchanged question answered by
 * the package's rear-view slot rules, a published `back` image never makes a
 * face-only accessory visible from behind.
 */
import { useId, useMemo } from "react";
import { useBlobbis } from "@/hooks/useBlobbis";
import { useBlobbonautProfile } from "@/hooks/useBlobbonautProfile";
import { getBlobbiDisplayName } from "@/lib/blobbi-legacy";
import { cn } from "@/lib/utils";
import type { SeatedAccessory } from "@/lib/room-seats-config";
import { SeatedAccessoryLayer } from "./SeatedAccessoryLayer";
import {
  BlobbiRenderer,
  DEFAULT_STAGE,
  resolveBlobbiRenderSize,
  normalizeAccessoryPlacements,
  type AccessoryPlacementInput,
  type BlobbiFacing,
  type BlobbiRendererSize,
  type BlobbiVisual,
  type BlobbiVisualEffect,
} from "@blobbi-kit/renderer";
import { applyDevVisualGeneration, useDevVisualGenerationOverride } from "@/lib/blobbi-visual-dev";
import { resolveBodyFacing } from "@/lib/blobbi-facing";
import { useCharacterEquipmentContext } from "@/hooks/useCharacterEquipmentContext";
import { createPlacementAccessorySourceResolver } from "@/placement/accessory-sources";
import type { ResolvedBlobbiItemDefinition } from "@/inventory/catalog-fallback";

export interface CurrentBlobbiDisplayProps {
  className?: string;
  /** A size token, a pixel number, or a CSS length such as `"100%"`. */
  size?: BlobbiRendererSize;
  showFallback?: boolean;
  onClick?: () => void;
  interactive?: boolean;
  transparent?: boolean;
  isSleeping?: boolean;
  eyesClosed?: boolean;
  showAccessories?: boolean;
  idSuffix?: string;
  /**
   * Normalized gaze direction (each axis roughly -1..1). When provided, the
   * Blobbi's face is nudged slightly toward this direction to convey "looking".
   * Undefined (the default) renders statically, used by previews/modals/cards.
   */
  eyeOffset?: { x: number; y: number };
  /**
   * Which way the character is turned. `"back"` renders the Blobbi seen from
   * behind: same body, colours, silhouette, limbs, accessories and particles,
   * with the face (eyes, pupils, mouth, nose/beak/whiskers, blush) not drawn.
   *
   * This is a semantic rendering mode, not a CSS trick, the SVG itself is
   * derived (`loadBlobbiSvg(..., 'rear')`), so nothing of the face survives in
   * the DOM and no mirroring is involved. Face-only accessories are hidden too
   * (see `REAR_VIEW_HIDDEN_SLOTS`).
   */
  facing?: "front" | "back";
  /**
   * The facing the actor's MOVEMENT implies while standing (down → front,
   * up → back, left/right → the profiles; see lib/blobbi-facing.ts). Only a
   * body with profile artwork turns: V1 ignores this and keeps `facing`; a V2
   * body follows it unless `facing` is `"back"` (a rear-facing seat wins).
   * Accessory artwork and the seat prop keep following `facing`.
   */
  movementFacing?: BlobbiFacing;
  /** If provided, component renders THIS visual instead of the local companion. */
  visualOverride?: BlobbiVisual;
  /**
   * Accessories to draw on a {@link visualOverride}. Plain, serializable data,
   * the caller states what that Blobbi is wearing.
   *
   * Meaningful ONLY alongside `visualOverride`: without an override the local
   * companion's own equipment is authoritative and this prop is ignored, so it
   * can never be used to dress the local Blobbi in something it does not own.
   * With an override and no value here, the Blobbi wears nothing (see the
   * ownership table in the module doc).
   */
  accessoryOverride?: readonly AccessoryPlacementInput[];
  /**
   * Visual effects to draw INSTEAD of whatever this component would resolve.
   *
   * Effects follow the visual, exactly like accessories:
   *
   *   no `visualOverride`                     → the local companion's ACTIVE
   *     effects (ownership + kind:31634, resolved at the app root); an
   *     `effectsOverride` replaces them; this is the preview path, purely
   *     visual and never persisted.
   *   `visualOverride`, no `effectsOverride`  → that visual, no effects (the
   *     honest render of unknown state; see the accessory ownership table).
   *   `visualOverride` + `effectsOverride`    → that visual, exactly those.
   *
   * Plain serializable data. Passing `[]` explicitly means "no effects".
   */
  effectsOverride?: readonly BlobbiVisualEffect[];
  /**
   * Extra `itemAddress → definition` entries for resolving accessory ARTWORK.
   *
   * The equipment context only carries definitions for what a Blobbi already
   * WEARS: that is all the world stage ever needs. A preview surface asks a
   * different question ("what would this look like on me?"), and the answer
   * involves items the Blobbi does not wear, whose artwork the context has
   * therefore never resolved. Without this the accessory placed correctly and
   * drew nothing.
   *
   * Merged OVER the context map, so a caller can also correct the artwork for
   * something already worn. It changes no ownership and no equipment: it says
   * where a picture comes from, not what anybody owns.
   */
  definitionsOverride?: ReadonlyMap<string, ResolvedBlobbiItemDefinition>;
  /**
   * Draw THIS owned Blobbi (by `d`) instead of the profile's
   * `current_companion`.
   *
   * The Island router already knows which Blobbi the player is playing as (a
   * manual selection wins over the profile there); the in-world actor must
   * agree with the router, not re-derive the answer from a profile cache that
   * can lag a fresh hatch or a switch. With this set, a Blobbi missing from
   * the owned list renders NOTHING: the egg fallback below means "no Blobbi
   * selected", which is never true of a world that is showing an actor.
   */
  companionId?: string;
  /**
   * A prop the CURRENT SEAT makes this Blobbi wear (the Nostr Station's VR
   * headset), resolved from the pose, never from equipment. Drawn over the
   * face of whatever visual is resolved above, at that form's eye line.
   */
  seatedAccessory?: SeatedAccessory | null;
}

export function CurrentBlobbiDisplay({
  className,
  size = "lg",
  showFallback = true,
  onClick,
  interactive = false,
  transparent = false,
  isSleeping = false,
  eyesClosed = false,
  showAccessories = true,
  idSuffix,
  visualOverride,
  accessoryOverride,
  effectsOverride,
  definitionsOverride,
  eyeOffset,
  facing = "front",
  movementFacing,
  companionId,
  seatedAccessory = null,
}: CurrentBlobbiDisplayProps) {
  // SVG id namespace for this instance. A caller-supplied `idSuffix` always
  // wins: remote actors and tests depend on a stable, meaningful id.
  //
  // The fallback is `useId()` rather than `Math.random()`: React guarantees it
  // is unique per component instance AND identical between a server render and
  // its hydration, so multiple Blobbis on one page still cannot share gradient
  // ids while the renderer stays safe to server-render later. (`useId` returns
  // e.g. `:r3:`; the punctuation is normalized away by the render model.)
  const generatedId = useId();
  const scopeId = idSuffix ?? `bb${generatedId}`;

  // Local-player data. These hooks are the reason this wrapper exists, the
  // pure renderer below must never call them.
  const { data: blobbis } = useBlobbis();
  const { data: profile } = useBlobbonautProfile();

  // What the local companion is wearing, resolved once at the app root from
  // kind:31634 (placement) + kind:31633 (ownership) + kind:31632 (artwork), and
  // already filtered by Island policy. This component receives renderer input
  // and makes no protocol or authorization decision of its own.
  const {
    accessories: wornEquipment,
    effects: activeEffects,
    definitionsByAddress,
  } = useCharacterEquipmentContext();

  // Accessory ARTWORK selection. Which picture an accessory uses depends on
  // which way this Blobbi is turned, so the resolver is built per `facing`
  // rather than being a module constant. Item definitions stay entirely on this
  // side of the boundary: the package's resolver contract still receives only
  // `{ code, slot, url }` and still returns plain URLs, `code` is now the item
  // ADDRESS, which is opaque to the renderer.
  //
  // Read from context, not fetched here: this component renders once per Blobbi
  // on screen, and drawing a Blobbi must not require an app config or a query
  // client. Outside the provider there are no definitions and no equipment, so
  // the Blobbi renders bare.
  const resolveAccessorySources = useMemo(
    () =>
      createPlacementAccessorySourceResolver({
        definitionsByAddress: definitionsOverride
          ? new Map([...definitionsByAddress, ...definitionsOverride])
          : definitionsByAddress,
        facing,
      }),
    [definitionsByAddress, definitionsOverride, facing],
  );

  // DEV-only: draw the Adult V2 body through this exact pipeline. `null` in
  // every production build and in every dev session that did not ask for it
  // (see lib/blobbi-visual-dev.ts); applied to the already-resolved visual
  // below, after parsing, so nothing upstream of the renderer ever sees it.
  const devGeneration = useDevVisualGenerationOverride();

  const resolvedCompanionId = companionId ?? profile?.currentCompanion;
  const currentBlobbi = visualOverride
    ? null
    : (resolvedCompanionId && blobbis
        ? blobbis.find((b) => b.id === resolvedCompanionId) ?? null
        : null);

  // A visualOverride without any colors renders nothing (legacy remote-preview
  // behavior: the caller refines the visual once relay data arrives).
  const overrideHasColors = !!(visualOverride?.baseColor || visualOverride?.secondaryColor);
  const resolvedVisual: BlobbiVisual | null = visualOverride
    ? (overrideHasColors ? visualOverride : null)
    : currentBlobbi
      ? {
          stage: currentBlobbi.stage,
          adultType: currentBlobbi.adultType,
          visualGeneration: currentBlobbi.visualGeneration,
          baseColor: currentBlobbi.baseColor,
          secondaryColor: currentBlobbi.secondaryColor,
          eyeColor: currentBlobbi.eyeColor,
          name: getBlobbiDisplayName(currentBlobbi),
        }
      : null;
  // Same object when there is no override: the production path is untouched.
  const visual = resolvedVisual ? applyDevVisualGeneration(resolvedVisual, devGeneration) : null;

  if (visual) {
    const displayName = currentBlobbi
      ? getBlobbiDisplayName(currentBlobbi)
      : (visualOverride?.name || 'Remote Blobbi');
    // The renderer resolves its own stage; this is only the tooltip's copy of
    // the same answer, so it reads the shared default instead of restating it.
    const stage = visual.stage || DEFAULT_STAGE;
    // Accessories follow the VISUAL. An override draws only what the caller
    // explicitly handed over; the local player's equipment is reachable solely
    // on the local-companion path. See the ownership table in the module doc.
    const wornAccessories = visualOverride ? accessoryOverride : wornEquipment;
    // Under the DEV V2 override accessories are not drawn: their placements
    // are authored against V1 anchors (head top / eye line) and there is no V2
    // accessory anchoring yet, so a hat would float. A real V2 Blobbi (no
    // override) is not affected by this line; V2 accessory anchoring is a
    // separate, open item.
    const accessoriesAllowed = showAccessories && !(devGeneration && visual.visualGeneration === 'v2');
    const accessories = accessoriesAllowed
      ? normalizeAccessoryPlacements(wornAccessories ?? [], {
          facing,
          resolveSources: resolveAccessorySources,
        })
      : [];
    // Effects follow the visual, exactly like accessories (see the prop doc):
    // an override visual draws only explicitly supplied effects; the local
    // companion draws its resolved ACTIVE effects, unless a preview override
    // replaces them. Gated by `showAccessories` with the same reasoning,
    // a caller that asked for a bare Blobbi gets a bare Blobbi.
    const wornEffects = visualOverride
      ? effectsOverride
      : (effectsOverride ?? activeEffects);
    const effects = showAccessories ? (wornEffects ?? []) : [];

    // Which way the BODY is drawn. The pose facing is the historical answer;
    // a V2 body standing still or walking follows its movement facing.
    const bodyFacing = resolveBodyFacing({ visual, poseFacing: facing, movementFacing });

    // The seat's prop goes over the face of THIS visual (its form sets the eye
    // line). With no seated accessory the layer is transparent: the renderer
    // is returned as is, so every other consumer of this component is
    // unaffected.
    return (
      <SeatedAccessoryLayer accessory={seatedAccessory} facing={facing} visual={visual}>
        <BlobbiRenderer
          visual={visual}
          instanceId={scopeId}
          size={size}
          isSleeping={isSleeping}
          eyesClosed={eyesClosed}
          facing={bodyFacing}
          eyeOffset={eyeOffset}
          accessories={accessories}
          effects={effects}
          transparent={transparent}
          interactive={interactive}
          onClick={onClick}
          className={className}
          title={`${displayName} - ${stage} stage${interactive ? ' (click to switch)' : ''}`}
        />
      </SeatedAccessoryLayer>
    );
  }

  // An explicit companion that is not (yet) in the owned list is a handoff in
  // progress, not "no Blobbi selected": draw nothing rather than the egg.
  if (companionId && !visualOverride) return null;

  // Fallback if enabled and no Blobbi/visual is available.
  if (showFallback && !currentBlobbi && !visualOverride) {
    const titleText = 'No Blobbi selected';
    const clickText = interactive ? ' (click to select)' : '';

    return (
      <div
        className={cn(
          "flex items-center justify-center",
          transparent
            ? interactive && "cursor-pointer hover:scale-105 transition-all duration-200"
            : cn(
                "rounded-full blobbi-card border-2 border-dashed border-purple-300 dark:border-purple-600 theme-transition",
                interactive && "cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all duration-200",
              ),
          className
        )}
        // The placeholder occupies the same inline box the renderer would, so a
        // layout never jumps when the Blobbi arrives.
        style={{ width: resolveBlobbiRenderSize(size).css, height: resolveBlobbiRenderSize(size).css }}
        title={`${titleText}${clickText}`}
        onClick={onClick}
      >
        <span className={cn(
          "text-muted-foreground",
          size === "sm" && "text-lg",
          size === "md" && "text-2xl",
          size === "lg" && "text-3xl",
          size === "xl" && "text-4xl",
          (size === "2xl" || size === "3xl") && "text-5xl"
        )}>
          🥚
        </span>
      </div>
    );
  }

  // No fallback and no Blobbi (or an override waiting for colors).
  return null;
}
