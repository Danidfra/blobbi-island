# `@blobbi/react`

The portable Blobbi renderer: a React component that draws a Blobbi from plain,
serializable data.

**Publication status: local and private. Not released to npm.** This package
lives in `packages/` and is consumed by Blobbi Island through the npm workspace
link. See [Publication status](#publication-status) for what still stands
between it and a release.

---

## 1. What this package is for

Rendering a Blobbi used to require being Blobbi Island: a relay connection, a
logged-in user, an equipment hook, a world coordinate system and a specific
`public/` directory layout. This package is the part of that with none of it.

```
                    plain data in
                          │
                          ▼
   ┌──────────────────────────────────────────┐
   │  @blobbi/react                           │
   │    visual  ──►  SVG body (synchronous)   │
   │    accessories ─►  positioned <img>s     │
   └──────────────────────────────────────────┘
                          │
                          ▼
                      markup out
```

**Non-goals**, stated up front so nobody looks for them here:

- no data fetching of any kind, and no network at runtime;
- no Nostr, no relay, no protocol, no tag parsing;
- no inventory, equipment persistence, or accessory editor;
- no world position, ground anchor, depth scale, shadow, z-index or movement;
- no presence, chat, name labels or interaction affordances;
- no asset directory conventions;
- no state. The component is a function of its props.

Everything in that list is a legitimate concern — it just belongs to whoever is
building the world, not to whatever draws the character.

## 2. Installation in this workspace

The repository root declares `"workspaces": ["packages/*"]`, so:

```bash
npm install          # links packages/blobbi-react into node_modules/@blobbi/react
```

The application imports it by name:

```ts
import { BlobbiRendererView } from '@blobbi/react';
```

Resolution goes to **TypeScript source**, not a build artifact
(`package.json` `main`/`types`/`exports` all point at `src/index.ts`). That is
deliberate for a local, unpublished package: no build ordering in `npm run
build`, and no stale `dist/` silently shadowing an edit. The publishable
artifact is produced separately:

```bash
npm run build:package             # from the repo root
npm run build --workspace @blobbi/react
```

which emits ESM + `.d.ts` + source maps into `dist/` (gitignored).

## 3. Public API

Everything is exported from the package root. There are no deep imports, and
`src/index.ts` contains no `export *` — the surface is a hand-written list,
asserted exactly by `package-api.test.ts`.

### Component

| Export | What it is |
| --- | --- |
| `BlobbiRendererView` | The renderer. The whole point. |
| `AccessoryLayerView` | One accessory layer group (`behind` / `front`). *Provisional* — only for consumers composing their own stack. |
| `BlobbiRendererViewProps` | Props type, for typed wrapping. |

### Visual normalization

| Export | What it is |
| --- | --- |
| `normalizeBlobbiRenderModel` | The single pure function from loose input to fully-resolved state. |
| `normalizeInstanceId` | The SVG-id sanitizer, as contract rather than implementation detail. |
| `DEFAULT_STAGE`, `DEFAULT_ADULT_TYPE`, `FALLBACK_INSTANCE_ID` | The documented fallbacks, so a caller's tooltip copy can agree with the drawing. |
| `BlobbiRenderVisual`, `BlobbiRenderModel`, `BlobbiRenderModelInput`, `BlobbiRenderView` | Types. |

### The canonical box

| Export | What it is |
| --- | --- |
| `BLOBBI_RENDER_SIZE_PX` | The framework-neutral source of truth: token → pixels. |
| `BLOBBI_RENDER_SIZE_CLASSES` | Its Tailwind projection (see §7). |
| `ACCESSORY_BASE_RATIO`, `ACCESSORY_BASE_PERCENT` | Accessory base size as a fraction of the box — what an editor needs to share the coordinate space. |
| `blobbiRenderSizePx`, `accessoryBasePx` | Convenience lookups. |
| `BlobbiRenderSize` | `'sm' \| 'md' \| 'lg' \| 'xl' \| '2xl' \| '3xl'`. |

### Accessories

| Export | What it is |
| --- | --- |
| `normalizeAccessoryPlacements` | Placement input → deterministic, render-ready placements. |
| `ACCESSORY_SLOT_RANK`, `REAR_VIEW_HIDDEN_SLOTS` | Paint order and rear-view visibility, so custom UI can reproduce them. |
| `DEFAULT_ACCESSORY_SOURCES` | The neutral source resolver (§5). |
| `AccessorySlot`, `AccessoryPlacementInput`, `NormalizedAccessoryPlacement`, `AccessoryLayer`, `NormalizeAccessoryOptions`, `AccessorySourceRequest`, `AccessorySourceResolver` | Types. |

### Rendering without React

| Export | What it is |
| --- | --- |
| `loadBlobbiSvg` | The same SVG pipeline as a string. Synchronous. |
| `applyGazeMarkup`, `applyRearView`, `uniquifySvgIds` | *Provisional* string→string transforms, for custom pipelines. They encode an artwork convention and may change with the artwork. |
| `BlobbiView` | `'front' \| 'rear'`. |

### Deliberately **not** exported

The artwork modules and their customizers, `cn`, the colour helpers, the SVG id
internals, `findRearViewRemovals` and the removal/keep block lists. They are all
used internally; none is a promise.

## 4. Rendering from plain data

```tsx
import {
  BlobbiRendererView,
  normalizeAccessoryPlacements,
  type BlobbiRenderVisual,
} from '@blobbi/react';

const visual: BlobbiRenderVisual = {
  stage: 'adult',
  adultType: 'bloomi',
  baseColor: '#F2A0C0',
  secondaryColor: '#FAD4E4',
  eyeColor: '#3A2A1A',
  name: 'Rosa',
};

const accessories = normalizeAccessoryPlacements([
  { code: 'headwear-8', slot: 'headwear', x: 50, y: 20, scale: 1, rot: 0, url: '/hat.png' },
]);

<BlobbiRendererView
  visual={visual}
  instanceId="rosa"
  size="xl"
  accessories={accessories}
  eyeOffset={{ x: 0.4, y: -0.2 }}
/>;
```

Every value above survives `JSON.parse(JSON.stringify(…))`. That is the actual
contract: whatever crosses the boundary can have come off a wire.

Incomplete input is handled rather than rejected:

| Input | Result |
| --- | --- |
| absent / unrecognized `stage` | `'baby'` |
| `stage: 'egg'` | kept as `egg`; draws the baby body (historical) |
| `stage: 'adult'` with no `adultType` | `'bloomi'` |
| `adultType` on a non-adult stage | dropped |
| absent colors | the artwork's own colors |
| non-finite gaze axis | `0`; finite axes clamp to ±1 |
| gaze with `facing: 'back'` | dropped (that drawing has no pupils) |
| blank / punctuation-only `instanceId` | `'blobbi'` |
| non-finite accessory `x`/`y`/`scale`/`rot` | `50` / `50` / `1` / `0` |

## 5. Accessory source contract

The package never builds an image path. It receives, per accessory, an **ordered
list of candidate URLs**, paints the first, advances on `onError`, and hides the
image when the list is exhausted.

```ts
type AccessorySourceResolver = (req: {
  code: string;
  slot: AccessorySlot;
  url?: string;
}) => readonly string[];
```

The default is `DEFAULT_ACCESSORY_SOURCES` — *"use the URL you gave me"*:

```ts
normalizeAccessoryPlacements(items);                       // sources = [item.url] or []
normalizeAccessoryPlacements(items, { resolveSources });   // your layout, your fallbacks
```

There is deliberately no built-in extension-guessing or CDN convention. A
package that guessed would force every consumer to mirror somebody else's
`public/` tree — which is exactly what this boundary exists to prevent. Blobbi
Island supplies its own resolver (`island-accessory-sources.ts`) and keeps its
asset layout entirely on its side of the line.

## 6. Body asset strategy: bundled, synchronous

Blobbi bodies are **inlined SVG string modules** compiled into the package
(`src/artwork/`). `loadBlobbiSvg` selects and customizes one synchronously.

- no fetch, no filesystem, no async, no loading state;
- deterministic: same input, same markup, in any runtime;
- no consumer setup — nothing to copy into `public/`.

The cost is size: the adult artwork is ~138 kB of source (all 17 forms and
their sleeping variants), which is the dominant term in the ~233 kB of emitted
JS. All of it is reachable through one lookup table, so tree-shaking a subset of
forms is **not** currently possible. That is a deliberate trade — synchronous,
zero-setup rendering was the requirement — and it is the first thing to revisit
if the package is ever published for size-sensitive consumers.

Front/rear and awake/sleeping are all derived from the same bundled artwork:
sleeping variants ship as their own drawings, rear views are derived by removing
the face comment-blocks (`applyRearView`).

## 7. CSS requirements

The package ships **no stylesheet**. It emits class names and expects the
consumer's Tailwind build to supply them.

**Required.** The canonical square box is expressed as literal Tailwind classes
(`h-8 w-8` … `h-72 w-72`, matching `BLOBBI_RENDER_SIZE_PX` exactly), plus stock
utilities: `relative`, `absolute inset-0`, `object-contain`, `max-w-none`,
`select-none`, `pointer-events-none`. A Tailwind consumer must include this
package in its `content` globs:

```ts
content: ['./src/**/*.{ts,tsx}', './packages/*/src/**/*.{ts,tsx}'],
```

Without that glob the box collapses to 0×0, and no test in jsdom would notice —
so `package-css.test.ts` asserts the glob is present in this repository's
config.

Classes rather than inline styles is a contract decision: it is what lets a
caller override the box through `className` (the shell's account chip passes
`size-full`) via `tailwind-merge` semantics.

**Optional.** Three decoration class names appear only behind
`transparent={false}` / `interactive`: `blobbi-gradient-frame`, `blobbi-hover`,
`theme-transition`. A consumer may define them or ignore them — the geometry is
identical either way. No other custom class names are emitted; no Island card,
gradient, room-grade or world vocabulary exists in this package.

**Non-Tailwind consumers** can use `BLOBBI_RENDER_SIZE_PX` directly and pass
their own `className`.

## 8. Instance ids and multiple Blobbis

Several Blobbis routinely share a page, and SVG ids are global to the document.

- `instanceId` is **required**. Every `id`, `url(#…)`, `href="#…"` and
  `xlink:href` inside the body SVG is prefixed with `b_<instanceId>_`.
- Caller-supplied ids always win and stay stable.
- Sanitization (`[^a-zA-Z0-9_-]` → `_`) is part of the contract via
  `normalizeInstanceId`, and is idempotent with the internal uniquifier.
- A blank or punctuation-only id falls back to `blobbi` rather than collapsing
  several unrelated Blobbis onto one prefix.
- Two renderers given the *same* id share a namespace. That is the caller
  getting what they asked for, and it is tested as such.

If you have no meaningful id, React's `useId()` is the right fallback: unique
per instance, and stable across a server render and its hydration.

## 9. Browser and SSR assumptions

- Every non-React module is pure and runs in a plain Node process. No `window`,
  `document`, `localStorage`, `location`, `Image`, `fetch`, or
  `import.meta.env` anywhere in the package (asserted by
  `package-purity.test.ts`).
- The component touches the DOM only through React, plus
  `dangerouslySetInnerHTML` for the body SVG and an `onError` handler on
  accessory images. Both are SSR-safe; the handler simply never fires on the
  server.
- Structurally safe to server-render. **No SSR infrastructure is provided or
  tested here** — the claim is about the absence of hazards, not the presence of
  support.

## 10. What stays with the consumer

For Blobbi Island specifically, all of this is on the other side of the line and
is not coming back:

`BlobbiActor` (ground anchor, depth scale, shadow, z-index, float) ·
`MovableBlobbi` and the movement controller · `CurrentBlobbiDisplay` /
`CurrentBlobbiPreview` (local companion data) · `MultiplayerLayer` and presence ·
`AccessoryOverlay` (the drag editor) · `BlobbiInfoModal` · equipment tag parsing
and persistence · `island-accessory-sources` and `asset-paths` · world
coordinates, boundaries, room and theater configuration · name labels, chat
anchors and interaction affordances.

## 11. Publication status

Local and private. `package.json` sets `"private": true`, and
`package-purity.test.ts` asserts it.

Known blockers before this could be published to npm:

1. **Extensionless relative specifiers in `dist/`.** The build uses `tsc` with
   `moduleResolution: "bundler"` (required to resolve
   `@blobbi-kit/core/color-guardrails`, an `exports`-map subpath). The emitted
   JS therefore keeps `from './svg'`, which every bundler resolves and bare Node
   ESM does not. Publishing needs an extension-rewriting build step (tsup or
   rollup) first.
2. **`exports` points at source.** Correct for a workspace-local package;
   a release must flip it to `./dist/index.js` + `./dist/index.d.ts` and add the
   build to a `prepublishOnly` hook.
3. **Bundle size / tree-shaking.** All adult forms load together (§6).
4. **Package name.** `@blobbi` is not a scope this project owns on npm, and the
   adjacent published packages use `@blobbi-kit`. A release would need to settle
   whether this becomes `@blobbi-kit/react`'s render entry point or claims its
   own scope.
5. **CSS contract is documentation, not code.** A published package would want
   to ship an optional stylesheet for the three decoration classes rather than
   describing them in a README.
