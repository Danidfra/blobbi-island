# Blobbi Visual Effects: Pre-implementation Audit (Phase 8)

_Performed 2026-07-31, before any implementation code was written. Companion
document: [`blobbi-visual-effects.md`](./blobbi-visual-effects.md) (the design
and catalog that this audit authorised)._

The question this audit had to answer was not "how do we draw sparkles". It was
**where the effect layer is allowed to live** without breaking the boundary
Phases 5–6 established: `@blobbi/react` renders from plain data and knows no
protocol; Blobbi Island owns Nostr, inventory, trust and the world.

---

## 1. What was inspected

| Area | Files read |
| --- | --- |
| Renderer package | `packages/blobbi-react/src/**` (all 26 source files) |
| Renderer box / geometry | `blobbi-render-size.ts`, `blobbi-render-model.ts`, `BlobbiRendererView.tsx` |
| Accessory layering | `accessory-normalize.ts`, `accessory-types.ts` |
| Island actor | `src/components/blobbi/BlobbiActor.tsx`, `MovableBlobbi.tsx`, `MultiplayerLayer.tsx` |
| Local wrapper | `src/components/blobbi/CurrentBlobbiDisplay.tsx` |
| World grade | `src/index.css` §`[data-island-world-graded]` |
| Existing decorative motion | `src/index.css` (1097 lines, 33 `@keyframes`), `tailwind.config.ts` |
| Hatching ceremony | `src/components/blobbi/BlobbiHatchingCeremony.tsx` |
| Arcade visuals | `src/arcade/**`, `src/components/blobbi/arcade/**` (dance, pool, hockey, prizes) |
| Photo booth | `src/components/blobbi/PhotoBoothModal.tsx` |
| Theater | `src/components/blobbi/theater/**`, `docs/theater-local-implementation.md` |
| Environment | `src/lib/island-sky-clouds.ts`, `src/hooks/useIslandSky.ts`, `src/components/blobbi/TownBush.tsx` |
| Reduced motion | `src/hooks/useReducedMotion.ts` + 4 `@media (prefers-reduced-motion)` blocks |
| Visibility / perf conventions | `src/arcade/useFixedStepLoop.ts`, `useArcadeInterruption.ts`, `dance-visuals.ts` |
| Boundary tests | `package-purity.test.ts`, `package-api.test.ts`, `package-css.test.ts`, `renderer-boundary.test.ts`, `ActorRendererBoundary.test.tsx`, `dev-routes.test.ts` |
| Trust / identity | `src/inventory/constants.ts`, `src/inventory/registry.ts`, `src/protocol/event-registry.ts`, `src/placement/policy.ts` |

**No visual-effect item is active in production today.** The only official
cosmetic definition published is `blobbi:cosmetic:block-builder-cap`
(`OFFICIAL_COSMETIC_DEFINITIONS`), a wearable accessory. Nothing in the
repository maps an item to an animation.

---

## 2. Existing effect-related implementations, classified

### 2.1 Reusable as-is

| Implementation | Where | Why it is reusable |
| --- | --- | --- |
| **Deterministic index-derived particle layout** | `BlobbiHatchingCeremony.tsx` (inner ring, outer ring, drift motes) | Already the exact discipline Phase 8 requires: `Array.from({length: N}).map((_, i) => …)` with position/size/delay/duration all derived from `i`. No `Math.random()`, no per-particle timer, no state update per frame. Adopted as the model, but re-implemented inside the package, because the ceremony's copy is glued to a full-screen overlay. |
| **CSS-custom-property-driven keyframes** | `index.css` `leaf-burst` (`--leaf-dx`, `--leaf-dy`, `--leaf-rot`, `--leaf-duration`) | One keyframe definition, N particles fanning out in different directions via inline CSS variables. This is precisely the "one keyframe, many deterministic instances" pattern the effect system needs, and it is adopted wholesale. |
| **`useReducedMotion`** | `src/hooks/useReducedMotion.ts` | Correct, SSR-safe, `useSyncExternalStore`-based, handles the legacy WebKit API. **Island-side and stays there.** The package does not use it (see §5). |
| **`pointer-events-none` decorative overlay convention** | `BlobbiActor` debug overlay, `AccessoryLayerView`, ceremony layers | Already the house rule for every decorative layer. Effects inherit it verbatim. |
| **`data-island-world-grade="exclude"`** | `BlobbiActor.tsx` + `index.css` | The actor already opts the whole Blobbi subtree out of the night grade. Effects mounted inside the renderer box are inside that subtree, so they are correctly excluded with no new work. Verified: the opt-out is applied to the anchor `div`, and the CSS selector is `[data-island-world-graded] [data-island-world-grade='exclude'] img`. |
| **Fixed, tiny particle counts replayed by class toggle** | `dance-visuals.ts` `RECEPTOR_SPARK_COUNT = 5` and its comment ("an unbounded particle system is the one decoration that can genuinely cost a rhythm game its frame budget") | The repository has already made this decision once, with reasoning. Phase 8 restates it as an enforced cap rather than a convention. |

### 2.2 Reusable after extraction

| Implementation | Extraction needed |
| --- | --- |
| **Ceremony sparkle geometry** (ring placement by `cos/sin` of `i/N`) | The maths is reusable; the surrounding component is not (fixed 640 px conic gradient, `blur(30px)`, screen flash, full-viewport `absolute inset-0`). Extracted as *technique*, re-expressed in **percentages of the renderer box** so it works at 32 px and 288 px. The ceremony itself is **not** refactored onto the new system in this phase; it is a one-shot cinematic, not an equippable effect, and rewiring it would be an unrelated behavioural change. |
| **Reduced-motion suppression blocks** in `index.css` | The existing four blocks each name specific classes. The package needs the same idea but self-contained, because a portable package cannot depend on the consumer having written a media query. Re-expressed as a package-owned `@media (prefers-reduced-motion: reduce)` block inside the package's own stylesheet. |

### 2.3 Island/world-specific: must NOT move into the package

| Implementation | Why it stays |
| --- | --- |
| `animate-float` (the idle bob) | Owned by `BlobbiActor`, asserted by `package-purity.test.ts` (`renderer must not own animate-float`). It is a world/actor behaviour. |
| Ground shadow, scale rig, `translate(-50%, -100%)` anchor, `zIndex` | `BlobbiActor`. Asserted in both directions by `renderer-boundary.test.ts` and `package-purity.test.ts`. |
| Day/night world grade (`--island-world-grade`) | Environment lighting, not character decoration. |
| Sky/cloud/star system (`island-sky-clouds.ts`, `useIslandSky.ts`) | A world backdrop with its own time model; it animates the *room*, not a character. |
| `TownBush` shake/sway/leaf-burst | Bound to a specific interactive prop and its hit area. |
| Arcade machine visuals (dance bulbs, lane flashes, receptor sparks, combo bumps) | Game-state-driven, tied to an audio clock. `useReducedMotion` must never alter their *timing*, only their decoration, a rule that does not generalise to cosmetics. |
| Hatching ceremony | A one-shot full-screen cinematic with a scripted phase machine. |
| Photo booth compositing | Draws to a `<canvas>` by hand (`PhotoBoothModal.tsx` §"Create Polaroid-framed version"). See §7, known limitation. |
| Theater playback visuals | Shared-watch state machine. |

### 2.4 Unsuitable for reuse

| Implementation | Why |
| --- | --- |
| Ceremony `filter: blur(30px)` over a 640×640 element | A paint region larger than most rooms. Exactly the "avoid large blur radii that force huge paint regions" case in the brief. Effects use small (≤ 4 px) blurs or none. |
| `onboard-screen-flash` (full-screen white flash) | Full-screen flash is banned for effects (Electric Charge explicitly). |
| `hue-rotate` cycling | Not present in the repository, and deliberately not introduced: Rainbow Dream uses a fixed pastel gradient that *rotates in place* rather than a hue strobe. |
| `PoolMachine` / `AirHockeyMachine` `planck` physics loop | Simulation, not decoration. Nothing passive should run a physics step. |

---

## 3. Where visual effects must live, the decision

**Renderer-local effects belong INSIDE `@blobbi/react`, rendered by
`BlobbiRendererView` between its existing layer groups.**

The decisive evidence is the layer model. §6 of the brief requires an effect
layer *between the body and the front accessories* (Mystic Fog's foreground
mist, Pixel Glitch's body overlay). The renderer's DOM today is:

```
<div renderer box>            ← relative, size classes, the ONLY layout box
  <AccessoryLayerView behind>
  <div data-blobbi-body-box>  ← the inline SVG
  <AccessoryLayerView front>
</div>
```

There is no way to inject a layer between the body and `front` accessories from
outside that box. Every alternative was checked and rejected:

| Option | Verdict |
| --- | --- |
| **Wrap `BlobbiRendererView`** (effects as sibling overlays) | ✗ Cannot reach between body and front accessories. Would also require a second positioned box, which is precisely the "one canonical renderer box" rule in `docs/blobbi-renderer-contract.md` §1. |
| **Inside `BlobbiActor`** | ✗ The actor is Island-only, so remote players, the info-modal preview, `BlobbiCard` and any future non-Island consumer would silently lose effects. It would also put decoration on the far side of the scale rig, where it would inherit the float bob. |
| **A separate renderer-level + world-level split** | ✗ Premature. Every one of the twelve initial effects is renderer-local by construction (§3 of the brief). A world-level system with no members is speculative. Trails/footprints/decals, the genuine world cases, are explicitly out of scope, and when they arrive they belong in the actor, where movement state already lives. |
| **Inside `BlobbiRendererView`** | ✓ Reaches every layer, ships with every consumer of the package, stays plain-data, and adds nothing the actor already owns. |

**What this costs:** `package-purity.test.ts` currently asserts the package
contains *exactly one* `.tsx` file. That assertion is a deliberate list, not a
law, and widening it is the visible, reviewed edit the test exists to force.

**What must not follow it across the line:** the package learns effect *ids*
and nothing else. No `31632`, no issuer, no ownership, no `effectId` read from
an event. Island resolves a trusted item address to an id; the package receives
the id. `renderer-boundary.test.ts` already asserts the package's source text
mentions no kind number; that check now covers the effect modules too.

---

## 4. Boundary map

```
kind:31632 definition  ─┐
kind:31633 ownership   ─┼─→  Blobbi Island effect resolver
kind:31634 placement   ─┘    (trusted issuer + trusted `d` → effect id)
                                        │
                                        ▼
                        plain, serializable { id, intensity }[]
                                        │
                                        ▼
                             @blobbi/react effect renderer
                             (ids, presets, geometry, timing, CSS)
```

The resolver's input is a **full address** `31632:<issuer>:<d>`. A third-party
item that copies `metadata.effectId` resolves to nothing, because the lookup key
includes the issuer. This mirrors `isOfficialCosmeticAddress` in
`src/inventory/registry.ts`, which already documents the same rule ("Compares
the WHOLE address, not the `d` tail").

---

## 5. Reduced motion, why the package does not use `useReducedMotion`

Island's hook is good, but a *portable* package must not require a consumer to
wire up a media-query hook, and a JS-read media query re-renders the component
tree when the OS setting changes. A CSS `@media (prefers-reduced-motion: reduce)`
block inside the package's own stylesheet:

- needs no hook, no consumer wiring and no React state;
- produces **identical markup** in both modes, so SSR/hydration cannot mismatch
  and the deterministic-markup tests stay meaningful;
- responds to an OS change instantly, with no re-render.

Consequence for the effect design: **every effect's resting (unanimated) state
must be visible.** Opacity/scale live on the element as inline custom
properties; animations modulate them. Turning animations off leaves a static,
legible version of the effect rather than an invisible one. This is a design
constraint on all twelve presets, not an afterthought.

---

## 6. Performance conventions found, and adopted

| Convention | Source | Adopted as |
| --- | --- | --- |
| Fixed tiny particle counts, never spawned per event | `dance-visuals.ts` | Hard caps: ≤ 18 pieces per effect, ≤ 48 across all active slots, asserted by test. |
| No `requestAnimationFrame` for decoration | Only `useFixedStepLoop` (arcade simulation) and movement controllers use rAF | Banned in the effect system, asserted by test. |
| CSS keyframes + transforms, not JS animation | `index.css` throughout | The entire effect system is CSS keyframes on `transform`/`opacity`. |
| No runtime DOM measurement | Renderer measures nothing today | Preserved, sizes are percentages of the box. |
| `pointer-events: none` on decoration | Everywhere | Every effect layer. |
| Tab-hidden handling | `useArcadeInterruption` uses `visibilitychange` for *gameplay*; no decoration does | Not replicated. Browsers already throttle CSS animations in hidden tabs; adding a `visibilitychange` listener per Blobbi would be a listener per instance for no gain. |

**No quality mode is added.** The evidence does not support one: the caps above
put a fully-loaded Blobbi at ≤ 48 composited elements animating `transform` and
`opacity` only, which is comparable to what a single dance receptor already
costs. Adding `effectQuality` now would be a public API promise with no measured
problem behind it. Re-open if profiling on a real device says otherwise.

---

## 7. CSS delivery, the constraint that shaped the implementation

`package-css.test.ts` documents the current contract: the package ships **no
stylesheet**, emits literal Tailwind classes, and the consumer's Tailwind build
supplies them. Twelve effects need ~30 `@keyframes`, which Tailwind utilities
cannot express.

Three options were weighed:

1. **Add the keyframes to Island's `tailwind.config.ts`.** ✗ Makes the package
   depend on consumer configuration it cannot verify; a consumer that forgets
   gets silently static effects.
2. **Import a `.css` file from the package.** ✗ The package builds with plain
   `tsc -p tsconfig.build.json`, which emits JS and `.d.ts` only. A `.css`
   import would not be copied to `dist/` and would break every non-bundler
   consumer.
3. **Own the stylesheet as a TypeScript string, rendered as a `<style>` element
   scoped to the active effects.** ✓ Zero consumer configuration, nothing for
   Tailwind to scan, no build change, no dynamic class construction, and the
   keyframe names are namespaced (`blobbi-fx-*`) so they cannot collide with the
   generic `float`/`pulse`/`sparkle` names the brief warns about.

Option 3 was chosen. Its one real cost, a duplicated `<style>` element when
several effect-bearing Blobbis are on screen at once, is bounded (only the
active effects' rules are emitted, and a Blobbi with no effects emits nothing at
all) and is mitigated by also exporting the full sheet so a consumer rendering
many effect-bearing Blobbis can hoist it once. Recorded as a known limitation.

**Known limitation found during the audit:** `PhotoBoothModal` composites its
photo by drawing to a `<canvas>` by hand. It will not capture CSS-animated
effect layers. This is pre-existing behaviour (it does not capture the float bob
or the ground shadow either) and is out of scope here, but it is the first thing
a player will notice, so it is recorded rather than discovered later.

---

## 8. Conclusions carried into implementation

1. Effects render **inside `BlobbiRendererView`**, via a new `effects` prop.
2. The package learns **effect ids only**: never a kind, tag, issuer or owner.
3. Four slots (`aura`, `ambient-particles`, `body-overlay`, `ground-local`),
   one winner each, winner = first in supplied order, output in a fixed
   canonical slot order.
4. Three internal layers: `behind`, `mid` (between body and front accessories),
   `front`.
5. Particles are deterministic, seeded on `instanceId + effectId + index`; no
   `Math.random()`, no timers, no rAF.
6. Reduced motion is **CSS-only**, and every effect has a visible resting state.
7. The package owns its effect CSS as a namespaced string; Tailwind config is
   untouched.
8. The canonical renderer box, accessory geometry, ground anchor, shadow, depth
   scale and world grade are **not touched**.
