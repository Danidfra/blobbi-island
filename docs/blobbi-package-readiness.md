# Blobbi renderer — package extraction readiness

**Status:** Phase 4 complete. No package was created, moved, or published.

This document records the **extraction boundary** for the Blobbi rendering
layer: what is already portable, what is deliberately Island-only, what the
future public API should be, and what still blocks a clean lift-out.

It is not another audit of the renderer's behavior — the behavior contract lives
in [`blobbi-renderer-contract.md`](./blobbi-renderer-contract.md) and the actor
model in [`blobbi-actor-architecture.md`](./blobbi-actor-architecture.md). Read
those first; this document only answers *"what would it take to ship the
renderer as a package?"*

The boundaries described here are **enforced by tests**, not by convention:

| Test | Enforces |
| --- | --- |
| `src/components/blobbi/renderer-boundary.test.ts` | The renderer's transitive import graph: forbidden categories, allowed directories, allowed external packages, the actor→renderer arrow, editor/preview parity, remote-vs-local hooks |
| `src/components/blobbi/BlobbiRendererView.plain-data.test.tsx` | Renders from plain JSON with **no providers at all**, across every stage/pose/accessory case |
| `src/components/blobbi/lib/blobbi-render-model.test.ts` | Normalization: defaults, clamping, id sanitization, CSS-safe accessory numbers |
| `src/components/blobbi/ActorRendererBoundary.test.tsx` | Renderer output is identical inside and outside `BlobbiActor`; local/remote pose parity |

---

## 1. Current dependency map

The complete **transitive** closure of `BlobbiRendererView` is 27 internal
modules and 4 external packages. Every entry below was resolved from real import
statements, not from inspection.

### Internal subtree (all of it)

| Module group | Files | React? | DOM? | Nostr? | Island? | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `src/blobbi/adult-blobbi/**` | 5 | no | no | no | no | **Reusable as-is** — SVG strings + pure customizer |
| `src/blobbi/baby-blobbi/**` | 4 | no | no | no | no | **Reusable as-is** |
| `src/blobbi/core/types/blobbi.ts` | 1 | no | no | no | no | **Reusable as-is** — visual/domain types |
| `src/blobbi/ui/lib/svg/**` (`colors`, `container`, `gaze`, `ids`, `rear-view`) | 6 | no | no | no | no | **Reusable as-is** — pure string→string SVG transforms |
| `src/lib/loadBlobbiSvg.ts` | 1 | no | no | no | no | **Reusable as-is** — synchronous SVG assembly |
| `src/components/blobbi/lib/blobbi-render-size.ts` | 1 | no | no | no | Tailwind | **Reusable after a small adapter** (see §9) |
| `src/components/blobbi/lib/blobbi-render-model.ts` | 1 | no | no | no | no | **Reusable as-is** |
| `src/components/blobbi/lib/accessory-types.ts` | 1 | no | no | protocol | no | **Reusable as-is** (protocol/domain types) |
| `src/components/blobbi/lib/accessory-normalize.ts` | 1 | no | no | no | no | **Reusable as-is** |
| `src/components/blobbi/lib/accessory-utils.ts` | 1 | no | no | protocol | asset URLs | **Reusable after split** (see §8) |
| `src/components/blobbi/lib/island-accessory-sources.ts` | 1 | no | no | no | **yes** | **Island adapter — replaced on extraction** |
| `src/lib/asset-paths.ts` | 1 | no | no | no | **yes** | **Island-only** — reached by the adapter alone |
| `src/lib/utils.ts` (`cn`) | 1 | no | no | no | no | Trivially reusable / replaceable |
| `src/components/blobbi/BlobbiRendererView.tsx` | 1 | **yes** | yes | no | no | **The component to extract** |

### External packages

`react`, `clsx`, `tailwind-merge`, `@blobbi-kit/core/color-guardrails`. That is
the entire peer-dependency surface — asserted exactly in the boundary test, so a
new one is a recorded decision rather than an accident.

### What is **not** in the subtree (and must never be)

Nostr clients, TanStack Query, `useBlobbis`, `useBlobbonautProfile`,
`useCurrentUser`, `useAccessoryManagement`, `useLocation`, `useIslandPresence`,
`location-*`, `world-coordinates`, `boundaries`, `blobbi-ground`, `blobbi-pose`,
`blobbi-world-render`, `spatial-intent`, `multiplayer`, `theater-*`, `gaze`,
movement/pending-interaction, React Router, every app context, every other
component (including `BlobbiActor` and all modals).

### Adjacent modules audited but outside the renderer

| Module | Classification | Why |
| --- | --- | --- |
| `CurrentBlobbiDisplay` | **Island-only** | Owns `useBlobbis` / `useBlobbonautProfile` / `useAccessoryManagement`. This is its entire reason to exist. |
| `CurrentBlobbiPreview` | **Island-only** | Thin `w-fit/h-fit` shell over the above; its job is to be the editor's coordinate box. |
| `BlobbiActor` | **Island-only** | Ground anchor, depth scale rig, ground shadow, z-index, float, debug overlays. |
| `MovableBlobbi` | **Island-only** | Local input, movement controller, pose selection. |
| `MultiplayerLayer` / `RemoteBlobbiSprite` | **Island-only** | Presence, relay subscriptions, seat occupancy. Renders through the **pure** renderer. |
| `AccessoryOverlay` | **Island/editor-only** | Drag/wheel editing, `useAccessoryManagement`, document listeners. |
| `BlobbiInfoModal` | **Island-only** | Relay writes, tabs, inventory, editor host. |
| `BlobbiCard` | **Island-only** | Builds its own SVG (no accessory layers/gaze) but now shares the one render model. |
| `blobbi-pose` / `blobbi-ground` / `blobbi-world-render` | **Island-only** | World geometry by definition. |

---

## 2. Proposed future module layers

Two packages already exist and are consumed from npm: `@blobbi-kit/core`
(framework-agnostic domain/protocol) and `@blobbi-kit/react` (hooks — currently
**no** JSX components). The rendering layer should extend those rather than
introduce a third package.

```
@blobbi-kit/core                    (exists — pure, framework-agnostic)
└── render/
    ├── blobbi-render-model         visual types + normalizeBlobbiRenderModel
    ├── accessory-types             slots, rear-view rules, EquipmentConfig
    ├── accessory-normalize         placements, deterministic order, sources
    ├── accessory-tags              parse/serialize equip + inv tags
    ├── svg/                        colors, ids, gaze, rear-view, container
    ├── artwork/                    baby + adult SVG data and customizers
    └── loadBlobbiSvg               synchronous SVG assembly

@blobbi-kit/react                   (exists — currently hooks only)
└── render/
    ├── BlobbiRendererView          the pure component
    ├── AccessoryLayerView          one accessory layer group
    └── render-size                 BLOBBI_RENDER_SIZE_PX + class map

Blobbi Island                       (stays here)
├── CurrentBlobbiDisplay            local companion + equipment
├── CurrentBlobbiPreview            editor coordinate box
├── BlobbiActor                     ground anchor, depth, shadow, z, float
├── MovableBlobbi                   local input + movement
├── MultiplayerLayer                presence + remote actors
├── blobbi-pose / blobbi-ground     world pose + ground geometry
├── AccessoryOverlay                drag editor
├── BlobbiInfoModal                 editor host + persistence
├── island-accessory-sources        asset resolver (the adapter)
└── asset-paths                     public/ layout
```

**Rationale.** The split follows the one line that actually matters: *does the
module need to know where it is?* Everything above `BlobbiRendererView` in the
diagram answers "no" — it is fed. Everything below `Blobbi Island` answers
"yes" — it owns a position, a relay, a user, or an input device. The React/core
line is the second, easier cut: JSX on one side, strings and objects on the
other.

---

## 3. Renderer public props contract

```ts
interface BlobbiRendererViewProps {
  visual: BlobbiRenderVisual;      // stage, adultType, colors, name
  instanceId: string;              // SVG id namespace (required)
  size?: BlobbiRenderSize;         // 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'
  isSleeping?: boolean;
  eyesClosed?: boolean;            // legacy seated flag; collapses with isSleeping
  facing?: 'front' | 'back';
  eyeOffset?: { x: number; y: number };
  accessories?: readonly NormalizedAccessoryPlacement[];
  className?: string;
  title?: string;
  onClick?: () => void;
  interactive?: boolean;
  transparent?: boolean;           // false adds the legacy circular frame
}
```

Every prop was re-audited against the rule *"does this exist only because one
Island wrapper needs it?"*:

| Prop | Genuinely rendered? | Notes |
| --- | --- | --- |
| `visual.stage` / `adultType` | yes | Selects the artwork. `egg` draws the baby body (historical). |
| `visual.baseColor` / `secondaryColor` / `eyeColor` | yes | Fed to the SVG customizer. Absent = the artwork's own colors. |
| `visual.name` | title only | Documented as such; not drawn. |
| `instanceId` | yes | SVG id namespace. Required — see §10. |
| `size` | yes | The canonical box. |
| `isSleeping` / `eyesClosed` | yes | Collapse to one flag in the model; kept separate for callers. |
| `facing` | yes | Selects the rear drawing (semantic, not a CSS mirror). |
| `eyeOffset` | yes | Clamped to ±1; emitted as CSS variables only. |
| `accessories` | yes | Pre-normalized placements. |
| `className` / `title` / `onClick` / `interactive` | yes | Ordinary presentation/interaction surface. |
| `transparent` | yes | Legacy frame decoration. Geometry identical in both modes. |

**Explicitly NOT props:** `pattern` and `specialMark`. They exist on Island's
`BlobbiVisual` and on `CurrentBlobbiDisplay`'s `visualOverride`, but nothing in
the renderer draws them. They stay out of the public contract until artwork uses
them.

**Not on the contract either:** world scale, z-index, ground position, shadow,
float, seat id, hidden state, walk targets, labels, chat anchors. Those belong
to `BlobbiActor`, and `ActorRendererBoundary.test.tsx` proves the renderer emits
none of them.

---

## 4. Visual normalization model

`normalizeBlobbiRenderModel()` (`lib/blobbi-render-model.ts`) is the single pure
function between loose external data and renderable state. The renderer's JSX now
contains **no** defaulting, validation, or clamping.

```ts
normalizeBlobbiRenderModel({ visual, instanceId, facing, isSleeping, eyesClosed, eyeOffset, accessories })
  -> { stage, adultType?, baseColor?, secondaryColor?, eyeColor?, name?,
       facing, view, eyesClosed, gaze, accessories, instanceId }
```

Documented fallback behavior for incomplete input:

| Input | Result |
| --- | --- |
| absent / unrecognized `stage` | `'baby'` |
| `stage: 'egg'` | kept as `egg`; draws the baby body (unchanged historical behavior) |
| `stage: 'adult'`, no `adultType` | `'bloomi'` |
| `adultType` on a non-adult stage | dropped |
| absent colors | left `undefined` = the artwork's own colors |
| non-finite gaze axis | `0` |
| gaze outside ±1 | clamped |
| gaze + `facing: 'back'` | dropped entirely (that drawing has no pupils) |
| blank / punctuation-only `instanceId` | `'blobbi'` |

Duplicated defaulting was consolidated: `CurrentBlobbiDisplay`,
`MultiplayerLayer` and `BlobbiCard` previously each restated the
`stage ?? 'baby'` / `adultType ?? 'bloomi'` rules. `BlobbiCard` now calls the
model; the other two read the shared `DEFAULT_STAGE` constant for their tooltip
copy.

---

## 5. SVG transformation and asset-resolution boundary

Three concerns, now cleanly separated:

1. **Pure transformation** — `src/blobbi/ui/lib/svg/*` and the per-stage
   customizers. All `string -> string`, all testable with SVG literals, no DOM.
2. **Asset "loading"** — `loadBlobbiSvg` is *synchronous string selection* from
   inlined SVG data. There is no fetch, no network, and no filesystem, so **no
   async asset resolver is needed or introduced** for the body.
3. **React rendering** — `BlobbiRendererView` only.

The one place Island's asset layout mattered was the accessory `<img>` fallback
chain, which used to live **inside** the renderer. It now lives in
`lib/island-accessory-sources.ts` behind a resolver type:

```ts
type AccessorySourceResolver = (req: { code, slot, url? }) => readonly string[];
```

`normalizeAccessoryPlacements(equipment, { facing, resolveSources })` resolves
each placement's ordered `sources` up front. The renderer walks that list on
load failure and knows nothing about `.webp`, `.png`, or `/assets/...`. The
boundary test asserts that exactly two modules may reach `asset-paths`, and that
the renderer component is not one of them.

**Net effect:** a future consumer supplies its own resolver (or just plain URLs)
without mirroring this repository's `public/` tree.

---

## 6. Accessory rendering boundary

| Reusable (static rendering) | Island / editor-only |
| --- | --- |
| `AccessorySlot`, `REAR_VIEW_HIDDEN_SLOTS` | fetching equipped items (`useAccessoryManagement`) |
| `NormalizedAccessoryPlacement` | persistence + Nostr equip-tag writes |
| deterministic `(layerRank, code)` ordering | drag / wheel / shift-wheel editing |
| rear-facing slot filtering | accessory inventory UI |
| box-relative sizing (`ACCESSORY_BASE_PERCENT`) | save/update actions |
| transforms (scale, rotate, flip) | Island asset URL conventions |
| ordered `sources` output | `AccessoryOverlay` as a whole |

The renderer consumes **only** `NormalizedAccessoryPlacement` — it never calls
the normalizer, never parses a tag, and never touches `refw`/`refh`. The editor
calls the same normalizer purely for its ordering and rear-filtering, which is
why editor stacking and world stacking cannot diverge.

Numeric hardening was added at this boundary: `x`, `y`, `scale`, `rot` are
guaranteed finite on the way out (`x`/`y` fall back to `50`, `scale` to `1`,
`rot` to `0`; non-positive scale is rejected). A `NaN` reaching CSS does not
throw — it silently deletes the declaration, which teleports or erases an
accessory. Decimal precision from drag editing is preserved.

---

## 7. CSS and runtime assumptions

The minimum CSS contract a future package requires:

| Requirement | Why | Source |
| --- | --- | --- |
| Tailwind's `h-*`/`w-*` scale (`h-8` … `h-72`) | The canonical square box per size token | `BLOBBI_RENDER_SIZE_CLASSES` |
| `absolute` / `relative` / `inset-0` positioning | Body and accessory layers share one coordinate space | renderer JSX |
| `object-contain`, `max-w-none`, `select-none`, `pointer-events-none` | Accessory image behavior | renderer JSX |
| `tailwind-merge` semantics | Callers override the box via `className` (the shell chip passes `size-full`) | `cn()` |

**Optional, Island-themed, and safe to drop:** `blobbi-gradient-frame`,
`blobbi-hover`, `theme-transition`, `shadow-lg` — all gated behind
`transparent={false}` / `interactive`. Island layout containers, cards and
gradients live in the wrappers and never in the renderer.

`BLOBBI_RENDER_SIZE_PX` is the framework-neutral source of truth; the class map
is the Tailwind projection of it. A non-Tailwind consumer can use the px table
directly. This is the one "reusable after a small adapter" item in §1.

---

## 8. Browser and SSR assumptions

Audited the whole subtree for `window`, `document`, `localStorage`, `location`,
`Image`, `fetch`, layout measurement and `import.meta.env`:

- **Zero hits** in every non-React module. All of them import and run in a plain
  Node process.
- The renderer component touches the DOM only through React, plus
  `dangerouslySetInnerHTML` for the body SVG and an `onError` handler on
  accessory images — both of which are fine under SSR (the handler simply never
  fires on the server).
- `Math.random()` in `CurrentBlobbiDisplay`'s instance-id fallback **was** an
  SSR/hydration hazard and has been replaced with `useId()`.
- No `import.meta.env` and no Vite-specific asset import anywhere in the
  subtree. The only bundler assumption left is the `@/` path alias, which
  disappears on extraction.

**No SSR infrastructure was added.** This is isolation and analysis only — but
the renderer is now structurally safe to server-render whenever that is wanted.

---

## 9. Instance-id and SVG-id collision strategy

Several Blobbis routinely coexist: local player, every remote player, the
profile modal, the accessory editor, the photo booth, cards and previews.

- `uniquifySvgIds` prefixes **every** `id`, `url(#…)`, `href="#…"` and
  `xlink:href` in the SVG with `b_<instanceId>_`.
- `normalizeInstanceId` (in the render model) makes the sanitization part of the
  public contract instead of an implementation detail. It is **idempotent** with
  `uniquifySvgIds`, so no existing id changed.
- Caller-supplied ids always win and stay stable — remote actors key by
  `pubkey-sessionId`, the modal preview by `preview:<key>`, tests by literals.
- The generated fallback is `useId()`: unique per instance, and identical
  between a server render and its hydration.
- Punctuation-only or blank ids fall back to `blobbi` rather than collapsing
  several unrelated Blobbis onto one prefix.

Collision coverage lives in `BlobbiRendererView.plain-data.test.tsx`: four
simultaneous instances (baby / adult+gaze / rear / sleeping) share no id, and
**every** `url(#…)` reference is asserted to resolve to an id present in the same
document — the actual failure mode of colliding ids.

**No breaking id change was made.** The only namespace that changed is the
previously-random fallback, which no consumer could have depended on.

---

## 10. Proposed future public API

### `@blobbi-kit/core` (pure)

| Export | Why consumers need it | Stable? | React? |
| --- | --- | --- | --- |
| `BlobbiRenderVisual` | The input type they must construct | yes | no |
| `normalizeBlobbiRenderModel` | Resolve partial data before rendering / for non-DOM consumers | yes | no |
| `BlobbiRenderModel` | Output of the above | yes | no |
| `AccessorySlot`, `EquipmentConfig` | Describe equipped items | yes | no |
| `NormalizedAccessoryPlacement` | The renderer's accessory input type | yes | no |
| `normalizeAccessoryPlacements` | Turn equipment into placements | yes | no |
| `AccessorySourceResolver` | Point accessories at their own assets | yes | no |
| `REAR_VIEW_HIDDEN_SLOTS`, `ACCESSORY_SLOT_RANK` | Reproduce ordering/visibility in custom UI | yes | no |
| `parseEquipTags`, `createEquipTag` | Protocol logic — read/write kind 31124 equipment | yes | no |
| `loadBlobbiSvg` | Render a Blobbi without React at all | yes | no |
| `applyGazeMarkup`, `applyRearView`, `uniquifySvgIds` | Compose custom SVG pipelines | **provisional** | no |

### `@blobbi-kit/react`

| Export | Why consumers need it | Stable? |
| --- | --- | --- |
| `BlobbiRendererView` | The component; the whole point | yes |
| `BlobbiRendererViewProps` | Typed wrapping | yes |
| `BlobbiRenderSize` | Pick a size | yes |
| `BLOBBI_RENDER_SIZE_PX` | Lay out around the box without Tailwind | yes |
| `AccessoryLayerView` | **provisional** — only for consumers building their own composition | provisional |
| `ACCESSORY_BASE_PERCENT`, `ACCESSORY_BASE_RATIO` | Build an editor on the same coordinate space | yes |

### Explicit non-exports

`BlobbiActor`, `MovableBlobbi`, `useBlobbiMovementController`,
`CurrentBlobbiDisplay`, `CurrentBlobbiPreview`, `AccessoryOverlay`,
`BlobbiInfoModal`, `resolveActorRender` / `BlobbiActorPose`,
`blobbi-ground`, room boundaries, location background maps,
`location-blobbi-sizes`, presence adapters, `theater-seats-config`,
seat/furniture configs, pending interactions, `useAccessoryManagement`,
`asset-paths`, `island-accessory-sources`, every dev-room harness.

Also non-exported: `BLOBBI_RENDER_SIZE_CLASSES` (Tailwind-specific — the px
table is the public form), and `accessoryBasePx` / `blobbiRenderSizePx` unless a
consumer actually asks.

---

## 11. Remaining extraction blockers

None are behavioral; all are mechanical.

| # | Blocker | Effort | Notes |
| --- | --- | --- | --- |
| 1 | `accessory-utils.ts` mixes protocol tag parsing with `generateAccessoryUrl` (a GitHub URL convention) and `resolveAccessoryImageUrl` | S | Split into `accessory-tags` (core) + the Island source adapter |
| 2 | `blobbi-render-size.ts` exports both the px table and the Tailwind class map | S | Ship px from core; keep the class map in the React package or Island |
| 3 | `cn()` from `src/lib/utils` | XS | Inline `clsx` + `tailwind-merge` in the package |
| 4 | `@/` path alias throughout | S | Mechanical rewrite to relative paths at move time |
| 5 | `@blobbi-kit/core/color-guardrails` is imported by the SVG customizers | XS | Already the target package — becomes an internal import |
| 6 | Artwork lives as inlined TS string modules under `src/blobbi/*-blobbi/lib/*-svg-data.ts` | M | Large but purely mechanical; decide package size budget vs. external assets |
| 7 | Renderer has no test for the framed (`transparent={false}`) theme classes outside Island CSS | XS | Document as consumer-supplied, or ship a minimal stylesheet |

### Known issue found during this audit (not fixed — behavior preservation)

`CurrentBlobbiDisplay` renders the **local player's** accessories even when a
`visualOverride` is supplied. In `BlobbiInfoModal`'s read-only remote preview
(`readOnly`, `selectedTab !== 'inventory'`, so `showAccessories` is true) that
means another player's Blobbi is drawn wearing *your* hats.

This is pre-existing behavior, not a Phase-4 regression, and fixing it changes
what is on screen — which §18 of this phase's brief explicitly forbids. It is
recorded here as a **product decision for a later phase**, and it is the one
reason `CurrentBlobbiDisplay` cannot be described as cleanly separated. The
renderer itself is unaffected: it draws exactly the accessories it is handed.

---

## 12. Recommended extraction sequence

1. **Split `accessory-utils`** into protocol tag code and Island URL conventions
   (blocker 1). Nothing else can move cleanly first.
2. **Move the pure core**: `svg/*`, artwork + customizers, `loadBlobbiSvg`,
   `blobbi-render-model`, `accessory-types`, `accessory-normalize`,
   `accessory-tags` into `@blobbi-kit/core/render`. Island keeps importing them
   from the package; the boundary test's allowed-directory list becomes the
   package's file list.
3. **Move the component**: `BlobbiRendererView` + `AccessoryLayerView` + the px
   size table into `@blobbi-kit/react/render`, inlining `cn()`.
4. **Leave the adapter behind**: `island-accessory-sources` and `asset-paths`
   stay in Island and are passed in via `resolveSources`.
5. **Flip the imports** in Island and delete the local copies. The four test
   files in this phase move with the code (the boundary test becomes the
   package's own lint) except the Island-specific parity assertions, which stay.

Compatibility for existing consumers is free at every step: Island imports the
same symbols from a different specifier, and the props contract does not change.

## 13. Testing strategy for the future package

The four Phase-4 test files are written to survive the move:

- `blobbi-render-model.test.ts` and the accessory tests are pure — they run in
  the package with no changes.
- `BlobbiRendererView.plain-data.test.tsx` uses no providers and no mocks, so it
  is already a package-shaped test.
- `renderer-boundary.test.ts` becomes the package's structural lint (its
  forbidden list mostly evaporates, since the forbidden modules will not exist).
- `ActorRendererBoundary.test.tsx` **stays in Island** — it asserts an Island
  integration property.

Island keeps an integration test proving it still renders through the package.

---

## 14. Readiness verdict

> **Ready after listed blockers** (§11, items 1–6).

The renderer is architecturally portable **today**: it renders from plain JSON
with no providers, reaches no relay/user/world/router/movement/presence module,
builds no asset path, hides no data fetching behind a prop, and produces
byte-identical output inside and outside the world actor. The remaining work is
file movement and two small module splits — no redesign, no behavior change, and
no open API questions.

The one open **product** question is the read-only-preview accessory leak
(§11), which is independent of extraction.
