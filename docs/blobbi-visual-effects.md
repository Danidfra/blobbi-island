# Blobbi Visual Effects (Phase 8)

_Established 2026-07-31. The audit that authorised this design, including the
alternatives that were rejected and why, is
[`blobbi-visual-effects-audit.md`](./blobbi-visual-effects-audit.md)._

Twelve renderer-local visual effects — auras, particles, fog, body overlays —
that a Blobbi can be drawn with, implemented entirely inside `@blobbi/react`
and addressed by a plain effect id.

---

## 1. The protocol relationship

A visual effect will be earned by owning a normal **kind:31632 Game Item
Definition**. Nothing about that is special: it is an item like any other, and
its definition may describe the effect in metadata —

```json
{
  "description": "A mysterious mist that swirls around the Blobbi.",
  "metadata": { "stackable": false, "effectId": "mystic-fog" },
  "visual":   { "kind": "blobbi-effect", "effect": "mystic-fog" }
}
```

— but **none of that is what makes the effect run.** The event contributes
identity and nothing else.

## 2. Why the effect code is local, not in the event

An event is data from a relay, published by anyone, fetched over a network that
this client does not control. Executing anything it contains would mean running
a stranger's code inside a player's session. So the rule is absolute, and it is
enforced by tests rather than by discipline:

**Never executed, injected or loaded from an event, ever:** remote JavaScript,
remote CSS, event-provided HTML, event-provided SVG markup, arbitrary component
names, arbitrary class names, arbitrary animation expressions.

The animation, particle geometry, timing, palettes and CSS all live in this
repository. What crosses the boundary is a string from a closed set of twelve —
and even that string is not read from the event (§3).

## 3. Trusted item mapping

`src/effects/official-visual-effect-items.ts` maps an item to an effect. The key
is the **full kind:31632 address**, never the `d` tag:

```
31632:<official issuer>:blobbi:effect:celestial-aura   →  'celestial-aura'
31632:<anyone  else  >:blobbi:effect:celestial-aura   →  null
```

kind:31632 is addressable, so anyone may publish `blobbi:effect:celestial-aura`
with `"effectId": "celestial-aura"` in its content and relays will serve it. A
`d`-keyed lookup, or any code path that read `metadata.effectId` off a fetched
definition and believed it, would hand out a legendary aura for free. The
addresses in the registry are **built** from `OFFICIAL_ITEM_ISSUER_PUBKEY`
rather than accepted from anywhere, so there is no input that makes a stranger's
item resolve.

This mirrors `isOfficialCosmeticAddress` in `src/inventory/registry.ts`, which
already documents the same rule.

**Entitlement is not activation.** Resolving an address to an effect id says
only which effect that item grants. Ownership (kind:31633) and equipped state
(kind:31634) are separate questions — see §14.

## 4. The renderer API

```ts
type BlobbiVisualEffectId =
  | 'golden-sparkles' | 'bubble-bliss'  | 'love-burst'      | 'firefly-friends'
  | 'mystic-fog'      | 'frost-breath'  | 'pixel-glitch'    | 'electric-charge'
  | 'celestial-aura'  | 'solar-radiance'| 'void-whispers'   | 'rainbow-dream';

interface BlobbiVisualEffect {
  id: BlobbiVisualEffectId;
  intensity?: number;   // 0 … 1.5, default 1; scales opacity only
}

interface BlobbiRendererViewProps {
  effects?: readonly BlobbiVisualEffect[];
  // …existing props unchanged
}
```

Guarantees, each asserted by a test:

| Property | Behaviour |
| --- | --- |
| Serializable | Plain JSON in, plain JSON out. No component, class name, CSS or callback is accepted. |
| Unknown ids | Ignored silently. Never rendered as "something". |
| Duplicates | First occurrence of an id wins, including its intensity. |
| Intensity | Clamped to 0…1.5; `NaN`/`Infinity`/absent → 1. Scales **opacity only** — never count, size or speed. |
| Slot conflicts | One effect per slot; the first competitor in the supplied order wins (§5). |
| Order | The result is always in canonical slot order, never input order. |
| Determinism | No `Math.random()`, no `Date.now()`. Same props → same markup, forever. |
| Malformed input | A non-array, a hole, a string, an object with no `id` — nothing throws, nothing renders. |
| Empty | `undefined` / `[]` / all-unknown produces **byte-identical markup to the pre-Phase-8 renderer**. |

Normalization happens *inside* the renderer (unlike accessories, which arrive
pre-normalized) because none of it is host policy: dropping unknown ids,
clamping and slot resolution are decisions the package can make correctly alone.
`normalizeBlobbiVisualEffects` is exported for callers who want the resolved
list without rendering.

The particle presets are **not** exported. An effect is named by id; the
geometry behind it is an implementation detail, and a public preset would make
somebody's hand-edited copy a supported input.

## 5. Slots and compatibility

Four slots, one occupant each:

| Slot | Effects |
| --- | --- |
| `aura` | Celestial Aura, Solar Radiance, Void Whispers, Rainbow Dream |
| `ground-local` | Mystic Fog, Frost Breath |
| `ambient-particles` | Golden Sparkles, Bubble Bliss, Love Burst, Firefly Friends |
| `body-overlay` | Pixel Glitch, Electric Charge |

**Winner rule: first of its slot in the supplied order.** Chosen over a rarity
or priority table because it is a rule the caller can see and control — "why is
my aura not showing" has an answer the caller can act on. Frost Breath is
`ground-local` rather than ambient so that it composes with sparkles and bubbles
instead of competing with them.

Asking for all twelve draws four. It never draws twelve heavy effects at once.

## 6. Layer model

```
  fx: behind          ← auras, rear fog, rear particles
  accessories: behind
  ── BLOBBI BODY ──
  fx: mid             ← body overlays (glitch, arcs) — over the body, under hats
  accessories: front
  fx: front           ← foreground particles, foreground fog
```

An effect may use several layers: Mystic Fog is a rear bank *and* a foreground
veil, which is what gives it depth.

**The canonical renderer box is unchanged.** Effects may overflow it visually
(an aura is up to 1.7× the body), and the renderer has always clipped nothing.
What they may never do — all asserted:

- change any layout measurement (every element is `position: absolute`);
- move the ground anchor, shadow, depth scale or actor position (all owned by
  `BlobbiActor`, outside the box);
- alter click hit-boxes or intercept pointer events (`pointer-events: none` on
  every layer, track and piece);
- touch the body SVG (byte-identical with and without effects).

## 7. Deterministic particles

Every varying number comes from `unitFor(seed, index, field)` — a pure FNV-1a
hash, in `effects/deterministic.ts`. The seed is `` `${instanceId}:${effectId}` ``.

Consequences:
- re-rendering never teleports a particle, and a server render matches its
  hydration;
- two Blobbis side by side get different scatters instead of moving in lockstep;
- the field name decorrelates the streams, so a particle's position and its
  timing do not line up into a visible ramp.

Each particle is **two elements**: a box-sized `.blobbi-fx-track` that carries
travel, containing a small `.blobbi-fx-piece` that animates in place. The
wrapper exists because CSS percentage translations resolve against the
element's own size — a 3 %-wide mote asked to `translateY(-45%)` would move by
45 % of 3 %. On a box-sized track, `-45%` means 45 % of the box.

The particle system uses no SVG element and therefore mints no id. The one
exception is the lightning renderer, which needs SVG paint servers (a gradient,
a glow filter) — and those follow the body SVG's own rule: every id is
namespaced by the renderer's `instanceId`, so two instances on one page share
nothing. Asserted by test in both directions.

## 8. Reduced motion

Implemented as a `@media (prefers-reduced-motion: reduce)` block inside the
package's own stylesheet — **no hook, no JavaScript, no consumer wiring**. It
switches every animation off, and only animation: a *static* transform is
placement, not motion (a lightning segment's fixed tilt), so it survives — the
resting composition keeps the shape it was designed to be. Animated transforms
need no separate kill switch; with `animation: none` they cease to exist.

That works only because of the opacity protocol: a piece's resting `opacity` is
`var(--fx-o)` (its authored opacity × the caller's intensity), and every piece
keyframe expresses opacity as `var(--fx-o)` or a fraction of it. With animations
off, each piece falls back to its authored opacity at its authored position — a
**still, legible version of the effect, not an invisible one.** Every preset is
authored so that its unanimated state is a composition worth looking at.

Markup is identical in both modes, so the determinism guarantees still hold.

## 9. Performance constraints

| Constraint | Value |
| --- | --- |
| Pieces per effect | ≤ 18 (heaviest: Pixel Glitch, 14; Electric Charge adds 9 SVG strike elements) |
| Pieces across all four slots | ≤ 48 (worst case: 42) |
| Minimum animation cycle | 1.2 s — no decoration may read as flicker |
| Animated properties | `transform`, `opacity`, and (lightning only) `stroke-dashoffset` |
| Blur radius | ≤ 4 px CSS (fog uses 3 px); the lightning glow is a bounded two-pass SVG `feGaussianBlur` (σ 1.2/4 box units) |
| Timers / frame loops | **none** — no `setInterval`, `setTimeout`, `requestAnimationFrame` |
| React state / effects / refs | **none** — the walker is a pure function of props |
| DOM measurement | **none** |
| Canvas | not used; CSS + `clip-path` + one SVG stroke renderer proved sufficient |

No `effectQuality` mode is exposed. The caps put a fully-loaded Blobbi at ≤ 48
compositor-friendly elements, comparable to one existing dance receptor; adding
a quality API now would be a public promise with no measured problem behind it.
Hidden tabs are left to the browser's own CSS-animation throttling rather than a
`visibilitychange` listener per Blobbi.

An effect-free Blobbi costs **nothing**: `normalizeBlobbiVisualEffects` returns
a shared frozen empty array, every layer returns `null`, and no `<style>` is
emitted.

## 10. The twelve effects

| Effect | id | Slot | Rarity | Item `d` |
| --- | --- | --- | --- | --- |
| Golden Sparkles | `golden-sparkles` | ambient-particles | rare | `blobbi:effect:golden-sparkles` |
| Bubble Bliss | `bubble-bliss` | ambient-particles | uncommon | `blobbi:effect:bubble-bliss` |
| Love Burst | `love-burst` | ambient-particles | rare | `blobbi:effect:love-burst` |
| Firefly Friends | `firefly-friends` | ambient-particles | rare | `blobbi:effect:firefly-friends` |
| Mystic Fog | `mystic-fog` | ground-local | epic | `blobbi:effect:mystic-fog` |
| Frost Breath | `frost-breath` | ground-local | epic | `blobbi:effect:frost-breath` |
| Pixel Glitch | `pixel-glitch` | body-overlay | epic | `blobbi:effect:pixel-glitch` |
| Electric Charge | `electric-charge` | body-overlay | epic | `blobbi:effect:electric-charge` |
| Celestial Aura | `celestial-aura` | aura | legendary | `blobbi:effect:celestial-aura` |
| Solar Radiance | `solar-radiance` | aura | legendary | `blobbi:effect:solar-radiance` |
| Void Whispers | `void-whispers` | aura | legendary | `blobbi:effect:void-whispers` |
| Rainbow Dream | `rainbow-dream` | aura | mythic | `blobbi:effect:rainbow-dream` |

Rarity and `d` live on the **Island** side (`official-visual-effect-items.ts`) —
they are economy and protocol facts. The package knows only id, slot, display
name and description.

**Golden Sparkles** — golden four-point sparkles, rear ones larger than front,
slow upward drift with a lateral sway, staggered twinkle. Elegant, not noisy.

**Bubble Bliss** — translucent bubbles with a rim and an off-centre highlight,
several fixed sizes, vertical rise with sway, fading out at the top. No liquid
simulation.

**Love Burst** — small gradient hearts, front-weighted (6 front, 2 rear). The
"intermittent bursts" impression comes from a wide deterministic delay spread,
not from a timer, and never becomes a dense cloud.

**Firefly Friends** — warm yellow-green glow dots with a hot white core, carried
on two counter-rotating orbits, blinking independently. The dim phase is a fifth
of full rather than off, so they stay readable on bright backgrounds.

**Mystic Fog** — violet mist in two coordinated layers: a rear bank around the
lower body and a thinner, fainter foreground veil crossing the feet. Slow
lateral drift, 3 px blur — never a large blur that bleeds into nearby UI.

**Frost Breath** — pale cyan vapour pooling at the feet plus six-point crystals
that **settle downward**. Falling rather than rising is what keeps it from
reading as room weather.

**Pixel Glitch** — flat cyan/magenta/yellow squares on the `mid` layer, stepped
(`steps(1, end)`) displacement so fragments jump rather than slide. The body is
never transformed or filtered: silhouette, face and hat stay readable.

**Electric Charge** — two real lightning bolts flanking the body, drawn as SVG
strokes (`LightningEffect.tsx`): a blue→gold→white gradient outer channel with
a pure-white core down the same path, round joins, thin electric-blue branches
forking outward, a radial impact glow pooling at each origin, and a two-pass
`feGaussianBlur` bloom over all of it. Each bolt originates at the Blobbi's
feet and DRAWS itself upward via `stroke-dashoffset` (`pathLength="100"`) in
~180 ms, flickers like a real strike (1 → 0.3 → 1 → out over ~320 ms), and
extinguishes; the two bolts alternate half a cycle apart on one shared 2.8 s
cycle, with origin and tip sparks (ordinary catalog pieces) popping on the same
clock. Exact hand-authored geometry — structure, not scatter — with only a
small seeded per-instance jitter on branch timing. Local; no full-screen
flash.

**Celestial Aura** — a slow-pulsing blue-violet halo behind the body with tiny
stars on two counter-rotating orbits. Premium but readable.

**Solar Radiance** — a slowly rotating masked conic ray disc plus a warm halo
and rising motes. Distinct from Golden Sparkles: a structured light source
rather than discrete twinkles.

**Void Whispers** — a dark violet halo with pale-rimmed rings and motes drawn
inward and extinguished. The rings carry the *light* colour deliberately, so it
stays legible in the mine and under the night grade.

**Rainbow Dream** — a masked pastel conic ribbon rotating slowly in place, a
soft halo, and pastel sparkles. Colour shifts by **rotation**, never by
`hue-rotate`: no strobe.

## 11. Representative item images

Each effect item will carry a normal kind:31632 primary image — an object that
*represents* the effect, not a still of it:

golden star token · bubble vial · heart charm · lantern jar · violet mist bottle
· snowflake orb · arcade chip · lightning battery · halo crystal · sun emblem ·
dark cosmic orb · rainbow prism.

**Runtime rendering is not coupled to that URL.** The image is inventory
presentation; the effect is `effects/effect-catalog.ts`. Nothing in the renderer
path reads a primary image, and no image was generated or published in this
phase.

## 12. Development preview

`/dev/blobbi-effects` — dev-only, excluded from production builds exactly like
`/dev/arcade`, `/dev/theater`, `/dev/rooms` and `/dev/equipment`.

It drives `BlobbiRendererView` **directly**: no login, no signer, no relay, no
query client, no inventory, no equip state. If drawing an effect ever needed any
of those, the page would stop rendering — which is the point of building it that
way.

Provides: all twelve as cards (name, id, rarity, slot, description, planned `d`
and address); a focused large preview; no-effect vs effect side by side; two
simultaneous instances; every renderer size; baby/adult with adult-form
selection; front/back; six backgrounds including a real room and two dark ones;
a reduced-motion simulation (CSS, matching the package's own declarations); an
effect-only view; and slot-conflict demos including the same four auras in two
different orders.

It publishes nothing, mutates nothing, grants nothing, and never touches the
player's Blobbi.

## 13. Non-goals — explicitly NOT in this phase

Inventory ownership · kind:31634 publication · persistent activation · prize
granting · Arcade Ticket spending · remote effect synchronisation · effect item
publication · effect item images · trails, footprints, ground decals, speed
streaks or any world-persistent particle · any change to movement, ground
anchors, shadows, depth scaling, presence, theater, accessories or Blobbi
bodies.

`CurrentBlobbiDisplay` was deliberately **not** given an effect override in
this phase. (Phase 9 later added `effectsOverride` alongside the activation
path — see `blobbi-effect-activation.md` — with the same ownership semantics
as `accessoryOverride`.)

## 14. The activation path (implemented in Phase 9)

This section was written when activation was future work. It is now
implemented — `docs/blobbi-effect-activation.md` is the authoritative
description — and landed in almost exactly this shape:

```
kind:31634 placement (equipped)  →  entry.item is an ITEM ADDRESS
        │
        ├─ src/placement/policy.ts   author · mode · slot · issuer ·
        │                            definition · ownership · form
        ▼
visualEffectForItemAddress(address)  →  BlobbiVisualEffectId | null
        ▼
BlobbiRendererView effects={[{ id }]}
```

Every gate an effect needs — is the author allowed to dress this Blobbi, does
the player own the item, is the issuer trusted, does it fit this form — is a
gate `decidePlacementEntry` already answers for cosmetics. Phase 9 gave
placement a slot vocabulary that includes the effect slots and put the effect
gates in a PURE resolver (`src/effects/active-effects.ts`) beside the wearable
policy, keyed on `resolveOfficialVisualEffectItem` — the same full-address
trust rule this section described.

---

**See also:** [`blobbi-effect-activation.md`](./blobbi-effect-activation.md)
· [`blobbi-visual-effects-audit.md`](./blobbi-visual-effects-audit.md)
· [`blobbi-renderer-contract.md`](./blobbi-renderer-contract.md)
· [`blobbi-package-readiness.md`](./blobbi-package-readiness.md)
