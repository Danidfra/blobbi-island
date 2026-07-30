# Blobbi Renderer Contract (Phase 1)

_Established 2026-07-29. Companions: `docs/blobbi-actor-ui-audit.md` (why),
`docs/blobbi-actor-position-migration-notes.md` (what comes next)._

## 1. The canonical renderer box

The renderer box is a **square, fixed-pixel box** that is the single local
coordinate space for everything the Blobbi renderer paints. There is exactly
one box: the body fills it, accessories position and size against it, and the
editor edits against it. Implemented in
`src/components/blobbi/lib/blobbi-render-size.ts`.

## 2. Size tokens and dimensions

| Token | Box (px, world-design-space) | Tailwind classes |
|---|---|---|
| `sm` | 32 | `h-8 w-8` |
| `md` | 56 | `h-14 w-14` |
| `lg` | 96 | `h-24 w-24` |
| `xl` | 128 | `h-32 w-32` |
| `2xl` | 224 | `h-56 w-56` |
| `3xl` | 288 | `h-72 w-72` |

- Values are the previous **desktop** (`md:` breakpoint) sizes of the visible
  body SVG, so the primary in-world look is unchanged and the old sub-768 px
  size step is gone. **No responsive variants are permitted in the ladder** —
  inside the fixed 1046×697 `VirtualWorld` design space, the world transform is
  the only thing that scales the Blobbi with the viewport.
- `xl` (128) is the accessory editor's box; saved placements keep their meaning
  exactly.
- Sizes are Tailwind classes (not inline styles) so a caller can still override
  the box via `className` through tailwind-merge (the shell's account chip
  passes `size-full`); such callers must not render accessories.
- Room-level size intent still comes from `src/lib/location-blobbi-sizes.ts`
  (`lg`/`xl` per room) — unchanged; it now resolves to one deterministic box.

## 3. Body SVG fitting

The body wrapper is `absolute inset-0` in the box; the SVG string carries
`width="100%" height="100%"` (added by `ensureSvgFillsContainer`) and a square
`viewBox` (`0 0 100 100` baby, `0 0 200 200` adult) with default
`preserveAspectRatio` (`xMidYMid meet`) — it fills the box exactly, distorts
nothing, and overflows nothing. Transparent and framed modes share this
geometry; `transparent={false}` only adds the decorative circular frame.

The box is a **layout container, not the silhouette**: how much of the box the
artwork's visible body occupies still varies by stage/adult form (audit §4).
Ground/foot alignment is Phase 2's problem, not this contract's.

## 4. Accessory x/y semantics

`x`/`y` are **percentages (0–100) of the renderer box**, measured to the
accessory's **center**. They are stored with decimal precision:
`parseFiniteNumber` preserves decimals (the legacy `parseInt` truncation is
gone) and serialization rounds to 2 decimals only to stop float noise.
Absent/invalid values fall back to the shared `EQUIP_TAG_DEFAULTS`
(x 50, y 50, scale 1, rot 0, refw/refh 100) — both parsers now agree (the old
`x:'50'` vs `x:'5'` split is fixed).

## 5. Accessory scale semantics

```
rendered accessory size = renderer box × ACCESSORY_BASE_RATIO × accessory.scale
```

`ACCESSORY_BASE_RATIO = 60/128` (= the legacy editor's 60 px base inside its
128 px box, preserving every author's intent). Implemented as a CSS percentage
of the box (`ACCESSORY_BASE_PERCENT`), so body and accessories scale together
under any outer transform. The accessory's own `scale` is applied exactly once
(in its transform); actor depth scale transforms the whole renderer from
outside and is never re-applied inside.

## 6. Layer ordering

Deterministic, never dependent on Nostr tag order. Slots map to ranks
(`ACCESSORY_SLOT_RANK` in `lib/accessory-normalize.ts`); the body renders at
rank 0:

```
aura (-20) → back (-10) → [BODY 0] → neckwear (10) → face-mark (20)
→ eyewear (30) → headwear (40) → handheld (50) → unknown (60) → color-overlay (70)
```

Same-slot ties order by code. Unknown/legacy slots fall back **in front** of
the body (rank 60) so nothing silently disappears. Rear view still drops
`eyewear`/`face-mark`/`handheld` (`REAR_VIEW_HIDDEN_SLOTS`). The body remains
one SVG element — no artificial body layers in Phase 1.

**Intentional visual change:** `back` and `aura` accessories now paint BEHIND
the body (they previously painted above it in relay-tag order).

## 7. refw / refh — decision: Path B (compatibility only)

Every writer in the repository pins `refw`/`refh` to `100`
(`AccessoryEditPanel`, `AccessoryInventoryUI`, `DebugAccessoriesModal`), and
`blobbi-types.ts` documents the tag with `"refw","100","refh","100"`. They
name the reference space the coordinates are expressed in — and since x/y are
already normalized 0–100 percentages, that space is the identity. Applying a
pixel-dimension conversion would corrupt already-normalized coordinates, so:
**they are parsed, validated and round-tripped for compatibility, but apply no
runtime conversion.** The Nostr event schema is unchanged.

## 8. Purity split

- **`BlobbiRendererView`** (`src/components/blobbi/BlobbiRendererView.tsx`) is
  **pure**: renders exclusively from props (visual identity, size token,
  sleep/facing/gaze, pre-normalized accessory placements, instance id). It
  calls no Nostr, profile, or equipment hooks — its test suite renders it with
  zero providers as proof.
- **`CurrentBlobbiDisplay`** is the **local-player wrapper**: it resolves the
  current companion (`useBlobbis` + `useBlobbonautProfile`), fetches equipment
  (`useAccessoryManagement`), normalizes placements
  (`normalizeAccessoryPlacements`), and passes props down. `visualOverride`
  remains for the info modal's read-only remote preview.
- **Remote players** (`RemoteBlobbiSprite` in `MultiplayerLayer.tsx`) use
  `BlobbiRendererView` directly with explicit visual props — rendering someone
  else's Blobbi no longer subscribes to the local player's data. Remote
  accessories stay off (unchanged behavior).
- **`AccessoryOverlay`** is now editor-only (interactive drag/wheel surface in
  `BlobbiInfoModal`); static accessory painting lives in the pure
  `AccessoryLayerView`.
- Data flow boundary: raw `equip` tags → `parseEquipTags` (accessory-utils) →
  `EquipmentConfig[]` → `normalizeAccessoryPlacements` (pure) →
  `NormalizedAccessoryPlacement[]` → DOM.

## 9. What stays Island-specific

Movement, boundaries, depth scaling, z-index, shadows, seats/beds/hiding,
presence, chat anchors, room sizing choices (`location-blobbi-sizes.ts`), and
both actor wrappers (`MovableBlobbi`, `RemoteBlobbiSprite`). `MascotBlobbi`
(decorative, own explicit 80–240 px ladder, no accessories) and `BlobbiCard`
keep their own visual identity deliberately — they are not actor renderers.

## 10. What Phase 1 intentionally did NOT solve (since implemented in Phase 2)

- **Ground/foot anchoring** — IMPLEMENTED in Phase 2: the Island actor
  (`BlobbiActor`) now mounts this renderer above a GROUND anchor
  (`translate(-50%, -100%)`, bottom-center scaling). The renderer itself is
  unchanged: it still just fills its canonical box; where that box is anchored
  is the Island's business (see docs/blobbi-ground-anchor-implementation.md).
- Shadow geometry — now attached to the ground anchor (Phase 2).
- The stage/form silhouette fill-fraction differences inside the box.
- Touch/pointer-event accessory dragging (editor remains mouse-based;
  follow-up item).
- Remote accessories; expressions/emotions; unifying `MovableBlobbi` and
  `RemoteBlobbiSprite`.
- The egg stage rendering as a baby.

## 11. Known intentional visual differences (Phase 1)

1. Sub-768 px viewports: the body no longer shrinks a step — it keeps desktop
   proportions relative to the room (the old `md:` jump is gone).
2. At `lg`, the box now equals the visible body (96 px), so the ground shadow
   and chat-bubble anchor sit at the body's visual edge exactly as they always
   did at `xl` (previously the body overflowed the 80 px box by 8 px).
3. `back`/`aura` accessories paint behind the body (§6).
4. Accessories at non-`xl` sizes are a few px larger (one canonical ratio
   instead of four divergent multiplier tables); `xl` — the editor and the
   most common accessory context — is pixel-identical.
