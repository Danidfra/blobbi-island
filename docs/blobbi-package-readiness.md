# Blobbi renderer — package extraction

**Status: Phase 5 complete. The renderer was extracted into the local workspace
package `@blobbi/react` (`packages/blobbi-react/`). It was NOT published.**

This document was the Phase-4 *readiness* analysis; it is now the record of the
extraction that analysis called for. Sections 1–13 describe the boundary and are
kept because they are still the reasoning behind it, with paths updated to
where the code actually lives. Section 14 records what was done.

The behavior contract lives in [`blobbi-renderer-contract.md`](./blobbi-renderer-contract.md),
the actor model in [`blobbi-actor-architecture.md`](./blobbi-actor-architecture.md),
and the package's consumer-facing documentation in
[`packages/blobbi-react/README.md`](../packages/blobbi-react/README.md).

The boundaries described here are **enforced by tests**, not by convention:

| Test | Enforces |
| --- | --- |
| `packages/blobbi-react/src/package-purity.test.ts` | The package's import graph: forbidden categories, no `@/` aliases anywhere, the exact peer-dependency set, private-not-published, no runtime fetch, clean `dist/` |
| `packages/blobbi-react/src/package-api.test.ts` | The public export surface, exactly; internals stay internal; no `export *`; resolution by package name |
| `packages/blobbi-react/src/package-css.test.ts` | The Tailwind class contract, the px↔class agreement, and that the app scans the package |
| `packages/blobbi-react/src/BlobbiRendererView.plain-data.test.tsx` | Renders from plain JSON with **no providers at all** |
| `packages/blobbi-react-consumer/src/consumer.test.tsx` | An external consumer, importing only `@blobbi/react`, with no host application around it |
| `src/components/blobbi/renderer-boundary.test.ts` | Island holds no second renderer; imports go through the package entry point; the actor→renderer arrow; editor parity; remote-vs-local hooks |
| `src/components/blobbi/CurrentBlobbiDisplay.accessory-policy.test.tsx` | Accessory ownership: local vs. override vs. supplied |
| `src/components/blobbi/ActorRendererBoundary.test.tsx` | Renderer output is identical inside and outside `BlobbiActor` |

---

## 1. Dependency map — and where each module ended up

The complete **transitive** closure of `BlobbiRendererView` was 27 internal
modules and 4 external packages. Every entry below was resolved from real import
statements. Paths are post-extraction; the `Island?` column is why each one
landed where it did.

### Internal subtree (all of it)

| Module group | Files | React? | DOM? | Nostr? | Island? | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/blobbi-react/src/artwork/adult-blobbi/**` | 5 | no | no | no | no | **Reusable as-is** — SVG strings + pure customizer |
| `packages/blobbi-react/src/artwork/baby-blobbi/**` | 4 | no | no | no | no | **Reusable as-is** |
| `packages/blobbi-react/src/artwork/core/blobbi-domain-types.ts` | 1 | no | no | no | no | **Reusable as-is** — visual/domain types |
| `packages/blobbi-react/src/svg/**` (`colors`, `container`, `gaze`, `ids`, `rear-view`) | 6 | no | no | no | no | **Reusable as-is** — pure string→string SVG transforms |
| `packages/blobbi-react/src/artwork/load-blobbi-svg.ts` | 1 | no | no | no | no | **Reusable as-is** — synchronous SVG assembly |
| `packages/blobbi-react/src/blobbi-render-size.ts` | 1 | no | no | no | Tailwind | **Moved** — px table + class map both ship; see §7, §11 blocker 2 |
| `packages/blobbi-react/src/blobbi-render-model.ts` | 1 | no | no | no | no | **Reusable as-is** |
| `packages/blobbi-react/src/accessory-types.ts` (rendering half) | 1 | no | no | no | no | **Moved** — slots, rear-view rules, placement input, resolver types |
| `src/components/blobbi/lib/accessory-types.ts` (protocol half) | 1 | no | no | protocol | yes | **Stayed** — equip/inv tags, forms, errors; re-exports the package's slot vocabulary |
| `packages/blobbi-react/src/accessory-normalize.ts` | 1 | no | no | no | no | **Reusable as-is** |
| `src/components/blobbi/lib/accessory-utils.ts` | 1 | no | no | protocol | asset URLs | **Stayed** — tag parsing + Island URL conventions |
| `src/components/blobbi/lib/island-accessory-sources.ts` | 1 | no | no | no | **yes** | **Stayed** — the Island `AccessorySourceResolver` |
| `src/lib/asset-paths.ts` | 1 | no | no | no | **yes** | **Stayed** — Island-only, reached by the adapter alone |
| `src/lib/utils.ts` (`cn`) | 1 | no | no | no | no | **Reimplemented** as `packages/blobbi-react/src/internal/cn.ts` |
| `packages/blobbi-react/src/BlobbiRendererView.tsx` | 1 | **yes** | yes | no | no | **Moved** — the component |

### External packages

`react`, `clsx`, `tailwind-merge`, `@blobbi-kit/core/color-guardrails`. That is
the entire peer-dependency surface, and it is exactly what
`packages/blobbi-react/package.json` declares — asserted from the import graph,
from the manifest, and from the built `dist/`, so a new one is a recorded
decision rather than an accident.

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

## 2. Module layers, as built

Two packages were already consumed from npm before this phase and are published
from a **different repository** (`github.com/Danidfra/blobbi-kit`, built with
tsup): `@blobbi-kit/core` (framework-agnostic domain/protocol) and
`@blobbi-kit/react` (hooks — no JSX components). Phase 4 proposed extending
those. **That turned out to be impossible from here**: this repository has no
access to them, and `@blobbi-kit/react` is an installed dependency the app
already uses for hooks, so a local package could not claim that name without
shadowing it.

The renderer therefore became its own local workspace package, `@blobbi/react`,
which is also the name Phase 5's brief preferred. The ecosystem split it
implements:

```
@blobbi-kit/core     (external, npm)   framework-agnostic domain + protocol
@blobbi-kit/react    (external, npm)   Blobbi React hooks (no components)
@blobbi/react        (LOCAL, private)  React renderer primitives + artwork
Blobbi Island        (this app)        actor / world / data / editor adapters
```

`@blobbi/react` depends on `@blobbi-kit/core` (one subpath:
`color-guardrails`, used by the adult SVG customizer) as a peer. It does not
depend on `@blobbi-kit/react`.

```
packages/blobbi-react/
├── package.json                    private, ESM, peer deps only
├── tsconfig.json                   typecheck (noEmit)
├── tsconfig.build.json             emit dist/ + .d.ts
├── README.md                       the consumer-facing contract
└── src/
    ├── index.ts                    the entire public API, hand-written
    ├── BlobbiRendererView.tsx      the component (+ AccessoryLayerView)
    ├── blobbi-render-model.ts      visual types + normalizeBlobbiRenderModel
    ├── blobbi-render-size.ts       canonical box: px table + Tailwind classes
    ├── accessory-types.ts          slots, rear-view rules, placement input,
    │                               source resolver + neutral default
    ├── accessory-normalize.ts      placements, deterministic order, sources
    ├── internal/cn.ts              package-local clsx + tailwind-merge
    ├── svg/                        colors, ids, container, gaze, rear-view
    └── artwork/
        ├── load-blobbi-svg.ts      synchronous SVG assembly
        ├── core/                   domain types the artwork shares
        ├── baby-blobbi/            SVG data + resolver + customizer
        └── adult-blobbi/           SVG data + resolver + customizer

packages/blobbi-react-consumer/     test-only external consumer fixture
├── fixtures/                       3 tiny SVGs + plain accessory data
└── src/consumer.test.tsx           imports ONLY @blobbi/react

Blobbi Island                       (stays in src/)
├── CurrentBlobbiDisplay            local companion + equipment ownership
├── CurrentBlobbiPreview            editor coordinate box
├── BlobbiActor                     ground anchor, depth, shadow, z, float
├── MovableBlobbi                   local input + movement
├── MultiplayerLayer                presence + remote actors
├── blobbi-pose / blobbi-ground     world pose + ground geometry
├── AccessoryOverlay                drag editor
├── BlobbiInfoModal                 editor host + persistence
├── lib/accessory-types             equip/inv protocol types (re-exports the
│                                   package's slot vocabulary — no second copy)
├── lib/accessory-utils             tag parsing + Island URL conventions
├── lib/island-accessory-sources    the AccessorySourceResolver
└── lib/asset-paths                 public/ layout
```

**Rationale.** The split follows the one line that actually matters: *does the
module need to know where it is?* Everything in `@blobbi/react` answers "no" —
it is fed. Everything in Blobbi Island answers "yes" — it owns a position, a
relay, a user, or an input device.

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

1. **Pure transformation** — `packages/blobbi-react/src/svg/*` and the per-stage
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
Island boundary test asserts that exactly two modules may reach `asset-paths`
(the tag utils and the adapter), and the package cannot reach it at all.

Since extraction the package's **default** resolver is
`DEFAULT_ACCESSORY_SOURCES` — "use the URL you were given". Island passes
`islandAccessorySources` explicitly at every call site, so its fallback chain
(stored/derived URL → local `.webp` → local `.png`) is unchanged.

**Net effect:** a consumer supplies its own resolver (or just plain URLs)
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

## 10. Public API, as shipped

Exported from `@blobbi/react` and asserted exactly by `package-api.test.ts`.
There is no `export *` in the package, and no deep imports are supported.

| Export | Why a consumer needs it | Stable? |
| --- | --- | --- |
| `BlobbiRendererView` | The component; the whole point | yes |
| `BlobbiRendererViewProps` | Typed wrapping | yes |
| `AccessoryLayerView` | Building a custom composition | **provisional** |
| `normalizeBlobbiRenderModel` | Resolve partial data before rendering | yes |
| `normalizeInstanceId` | Reproduce id sanitization outside the renderer | yes |
| `BlobbiRenderVisual`, `BlobbiRenderModel`, `BlobbiRenderModelInput`, `BlobbiRenderView` | The input/output types | yes |
| `DEFAULT_STAGE`, `DEFAULT_ADULT_TYPE`, `FALLBACK_INSTANCE_ID` | Agree with the drawing in tooltip/label copy | yes |
| `BLOBBI_RENDER_SIZE_PX`, `BlobbiRenderSize` | Lay out around the box without Tailwind | yes |
| `BLOBBI_RENDER_SIZE_CLASSES` | The Tailwind projection — needed by any consumer that overrides the box | yes |
| `ACCESSORY_BASE_RATIO`, `ACCESSORY_BASE_PERCENT`, `blobbiRenderSizePx`, `accessoryBasePx` | Build an editor on the same coordinate space | yes |
| `normalizeAccessoryPlacements` | Turn placement data into render order | yes |
| `ACCESSORY_SLOT_RANK`, `REAR_VIEW_HIDDEN_SLOTS` | Reproduce ordering/visibility in custom UI | yes |
| `DEFAULT_ACCESSORY_SOURCES` | The neutral resolver, and a base to wrap | yes |
| `AccessorySlot`, `AccessoryPlacementInput`, `NormalizedAccessoryPlacement`, `AccessoryLayer`, `NormalizeAccessoryOptions`, `AccessorySourceRequest`, `AccessorySourceResolver` | Types | yes |
| `loadBlobbiSvg`, `BlobbiView` | Render a Blobbi without React at all | yes |
| `applyGazeMarkup`, `applyRearView`, `uniquifySvgIds` | Compose custom SVG pipelines | **provisional** |

**Deviations from the Phase-4 proposal**, and why:

- `BLOBBI_RENDER_SIZE_CLASSES` was proposed as a non-export. It is exported:
  the renderer's box IS those classes, Island's fallback tile and its actor need
  the same box, and hiding the map would only force consumers to re-derive it.
  The px table remains the framework-neutral form.
- `parseEquipTags` / `createEquipTag` were proposed for `@blobbi-kit/core`. They
  are protocol code, and this package is a renderer, so they stayed in Island
  (`lib/accessory-utils.ts`) rather than moving into a React package.
- `EquipmentConfig` did not move. The package's input type is
  `AccessoryPlacementInput`, a structural subset of it — Island passes its
  parsed equipment through unchanged, with no adapter object.

### Explicit non-exports

`BlobbiActor`, `MovableBlobbi`, `useBlobbiMovementController`,
`CurrentBlobbiDisplay`, `CurrentBlobbiPreview`, `AccessoryOverlay`,
`BlobbiInfoModal`, `resolveActorRender` / `BlobbiActorPose`, `blobbi-ground`,
room boundaries, location background maps, `location-blobbi-sizes`, presence
adapters, `theater-seats-config`, seat/furniture configs, pending interactions,
`useAccessoryManagement`, `asset-paths`, `island-accessory-sources`, every
dev-room harness — none of which is in the package at all.

Internal to the package but not exported: `cn`, every artwork module and
customizer (`customizeAdultSvg`, `getBabyBaseSvg`, `ADULT_SVG_MAP`, …), the
colour helpers, `ensureSvgFillsContainer`, `findRearViewRemovals` and the
rear-view block lists. `package-api.test.ts` asserts each one is absent from the
entry point.

---

## 11. Extraction blockers — how each was resolved

Phase 4 listed seven mechanical blockers. All are closed.

| # | Blocker | Resolution |
| --- | --- | --- |
| 1 | `accessory-utils.ts` mixed protocol tag parsing with Island URL conventions | Split by *ownership* rather than by file: the package defines only the rendering vocabulary (`AccessorySlot`, `REAR_VIEW_HIDDEN_SLOTS`, `AccessoryPlacementInput`, the resolver types). `accessory-utils.ts` kept every tag parser and Island URL convention and did not move. Island's `accessory-types.ts` re-exports the package's slot vocabulary so there is exactly one definition. |
| 2 | `blobbi-render-size.ts` mixed the px table and the Tailwind class map | Both ship, both exported, both asserted to agree (`package-css.test.ts` derives px from each class name and compares). Keeping the classes is what preserves the `className`-override contract — and the visual output — exactly. |
| 3 | `cn()` from `src/lib/utils` | Reimplemented in `src/internal/cn.ts` as four lines over `clsx` + `tailwind-merge` (already the renderer's only className dependencies). Island's `utils.ts` also exports button themes, so importing it would have dragged Island styling vocabulary in. |
| 4 | `@/` path aliases throughout | Rewritten to relative paths. The package tsconfig defines no `baseUrl` and no `paths`, and `package-purity.test.ts` sweeps **every** file on disk — tests included — for `@/` specifiers. |
| 5 | `@blobbi-kit/core/color-guardrails` imported by the SVG customizers | Declared a peer dependency. `package-purity.test.ts` asserts the external set is exactly `{@blobbi-kit/core/color-guardrails, clsx, react, tailwind-merge}` and that each is declared as a peer. |
| 6 | Artwork as inlined TS string modules; size budget undecided | Moved wholesale and kept bundled. Measured, not guessed: **616 kB of `dist/` total; 233 kB of JS, of which 138 kB is `adult-svg-data.js`; 48 kB of `.d.ts`.** Decision and its cost are recorded in the README (§6): synchronous, zero-setup rendering was the requirement, and every adult form is reachable through one lookup table, so a subset cannot currently be tree-shaken. |
| 7 | No test for the framed (`transparent={false}`) theme classes | `package-css.test.ts` names the three decoration classes, asserts they are gated behind `!transparent` / `interactive`, asserts the size class is applied unconditionally, and asserts no Island card/gradient/world class is present. They are documented as consumer-supplied. |

### The known issue from the Phase-4 audit — fixed

`CurrentBlobbiDisplay` rendered the local player's accessories even when a
`visualOverride` was supplied, so `BlobbiInfoModal`'s read-only remote preview
drew another player's Blobbi wearing *your* hats. Phase 4 recorded it and left
it alone (behavior preservation); Phase 5 fixed it, as the single intentional
visual change of this phase.

The API is an explicit `accessoryOverride?: readonly AccessoryPlacementInput[]`
rather than another ambiguous boolean, with the precedence stated in the
component's own doc comment and asserted by
`CurrentBlobbiDisplay.accessory-policy.test.tsx`:

| props | drawn |
| --- | --- |
| no `visualOverride` | local companion + its own equipment |
| `visualOverride`, no `accessoryOverride` | that visual, wearing nothing |
| `visualOverride` + `accessoryOverride` | that visual, wearing exactly those |

`accessoryOverride` is ignored on the local path, so it cannot be used to dress
the local Blobbi in items it does not own. Fetching another player's equipment
remains out of scope.

---

## 12. Extraction sequence, as executed

1. **Moved the subtree with `git mv`** so history follows the files: `src/blobbi/**`
   (all artwork + SVG transforms), `src/lib/loadBlobbiSvg.ts`, the renderer, the
   render model, the size table, the accessory normalizer, and their tests.
2. **Rewrote imports** inside the package to relative paths; added
   `src/internal/cn.ts`; split the reusable accessory vocabulary out of Island's
   protocol types.
3. **Wired the workspace**: `"workspaces": ["packages/*"]` at the root,
   `@blobbi/react` as a dependency, `optimizeDeps.exclude` in `vite.config.ts`,
   `packages/*/src` added to `tailwind.config.ts` content, `packages/*/dist`
   added to `.gitignore` and the eslint ignore list.
4. **Left the adapter behind**: `island-accessory-sources.ts` and
   `asset-paths.ts` stayed in Island; the package's default resolver became
   `DEFAULT_ACCESSORY_SOURCES`, and Island now passes its resolver explicitly.
5. **Migrated Island imports** in small groups (pure consumers → the local
   wrapper → the actor → the remote layer → preview/editor → tests), running
   focused tests after each.
6. **Replaced the boundary test** with two: package purity inside the package,
   and a "no second implementation" check on the Island side.

**No compatibility layer was created.** The churn was 16 files, which is
cheaper than a shim that would have to be removed later. The one re-export that
exists — Island's `accessory-types.ts` re-exporting `AccessorySlot` and
`REAR_VIEW_HIDDEN_SLOTS` — is not a compatibility shim: it is the protocol
module naming the shared vocabulary it uses, holds no implementation, and is
permanent.

---

## 13. Testing, as built

- `blobbi-render-model.test.ts`, `accessory-normalize.test.ts` and
  `rear-view.test.ts` moved with the code and run inside the package.
- `BlobbiRendererView.plain-data.test.tsx` and `BlobbiRendererView.test.tsx`
  moved and now import the package's **public entry point**, not its files.
- `package-purity.test.ts`, `package-api.test.ts` and `package-css.test.ts` are
  new, and are the package's structural lint.
- `packages/blobbi-react-consumer/` is a test-only workspace package that
  imports only `@blobbi/react` — no providers, no host application — covering
  egg/baby/adult, front/rear, sleeping, gaze, every size token, two accessories
  from local SVG fixtures, rear-view filtering, source fallback, the empty
  source list, two simultaneous instances, and headless `loadBlobbiSvg`.
- `ActorRendererBoundary.test.tsx` and `renderer-boundary.test.ts` stayed in
  Island — they assert Island integration properties.
- `CurrentBlobbiDisplay.accessory-policy.test.tsx` is new and covers the
  ownership fix.

### Development accessory fixtures

`packages/blobbi-react-consumer/fixtures/` holds three tiny local SVGs
(`cape.svg`, `goggles.svg`, `star-badge.svg`, 632 bytes total) and the plain
placement data that positions them. They are image files rather than emoji
deliberately: the renderer paints accessories through `<img src>`, so image
fixtures exercise the production path (candidate list, `onError` walk, transform
stack) where a text glyph would exercise none of it.

They are never published to Nostr, never inserted into an inventory, never
implicitly equipped, and touch no kind 31632/31633. They are passed explicitly,
as plain data, and require no authentication or relay.

---

## 14. Outcome

**The renderer is extracted. The package is local and private; nothing was
published.**

Verified:

- **Renderer output is unchanged.** The Phase-4 fingerprint comparison was
  re-run across 17 cases (every stage, size token, facing, eye state, gaze case
  including clamping, framed mode, accessory set, and degenerate inputs):
  all 17 hash byte-identically before and after extraction.
- **One implementation exists.** `renderer-boundary.test.ts` fails if a second
  copy of the renderer, render model, size table, accessory normalizer or SVG
  loader reappears under `src/`.
- **Island consumes the package** on every path — local companion, remote
  players, actor, cards, mascot, hatching ceremony, editor, previews.
- **The package contains no Island world or data dependency**, asserted from
  both the import graph and the built `dist/`.
- **Ground anchors, movement, boundaries, targets, presence and theater
  calibration were not touched.** `SEAT_CONTACT_RATIO` is unchanged.

The single intentional behavior difference is the accessory-ownership fix in
§11.

Publication blockers are listed in
[`packages/blobbi-react/README.md`](../packages/blobbi-react/README.md#11-publication-status):
extensionless relative specifiers in `dist/` (needs an extension-rewriting build
step), `exports` pointing at source, artwork bundle size, the unsettled package
identity, dependency policy (`react` stays a peer; `clsx` and `tailwind-merge`
should become dependencies; the `@blobbi-kit/core` question belongs to the
`blobbi-kit` repository), and the CSS contract being documentation rather than a
shipped stylesheet.

CI validates the package the way a consumer would receive it — `npm ci` from the
lockfile, standalone workspace typechecks, every suite including the external
consumer fixture, and the publishable `dist/` build — on every branch. It never
publishes.
