# The shared day/night sky

Blobbi Island runs on an accelerated global clock. Every player, everywhere, sees
the same time of day; nobody's timezone, device locale or login habits change what
the sky looks like.

This document is the system. The pre-existing scene structure it had to fit into,
and the per-image findings behind the location table, are in
[`audits/day-night-sky-audit.md`](./audits/day-night-sky-audit.md).

---

## 1. Why it works this way

Two obvious designs are both wrong for a multiplayer world:

- **Local device time** would put two Blobbonauts standing on the same plaza at
  dusk and noon respectively. A shared world that cannot agree what time it is
  reads as broken.
- **A real 24-hour cycle** would mean a player who logs in after school every day
  never learns the island has a night at all.

So the island runs its own day: **two real hours**, measured from a fixed UTC
epoch. Every client computes the phase from `Date.now()` alone — no backend, no
Nostr events, no relay round-trip, nothing persisted. There is no state to
restart, which is what makes a page reload a no-op.

## 2. The global clock

`src/lib/island-clock.ts`

```ts
ISLAND_DAY_MS   = 2 * 60 * 60 * 1000   // 7_200_000
ISLAND_EPOCH_MS = Date.UTC(2026, 0, 1)
ISLAND_TICK_MS  = 10_000

islandDayProgressAt(nowMs):
  elapsed = nowMs - ISLAND_EPOCH_MS
  wrapped = ((elapsed % ISLAND_DAY_MS) + ISLAND_DAY_MS) % ISLAND_DAY_MS
  return wrapped / ISLAND_DAY_MS          // → [0, 1)
```

**The double modulo is load-bearing.** JavaScript's `%` keeps the sign of the
dividend, so a timestamp before the epoch yields a negative remainder; adding one
period and folding again is what makes pre-epoch instants (and a badly-set device
clock) return a real phase instead of a negative one.

Timezones never enter the calculation: `Date.now()` is already UTC-based and
`Date.UTC` pins the epoch without consulting the host zone.

`ISLAND_EPOCH_MS` is fixed forever. Moving it would rotate the sky for every
player simultaneously, and because nothing is persisted there would be no
migration — just a jump.

### Ticking

`src/hooks/useIslandSky.ts` holds **one timer for the whole application**, shared
through `useSyncExternalStore`, started on the first subscriber and stopped on the
last. It fires every `ISLAND_TICK_MS` — 720 times per island day — and is
**aligned to absolute multiples of the tick since the Unix epoch** rather than to
whenever a tab mounted, so two clients step at the same instants instead of
drifting up to a full tick apart.

There is no `requestAnimationFrame` loop and no per-frame state. The gap between
two ticks is bridged by CSS transitions of the same duration, so the pixels change
continuously at whatever rate the compositor likes while React renders twice a
minute.

## 3. Phases and boundaries

`src/lib/island-sky.ts`

```
 0 ─────── 10 ──────────────────────── 75 ─────── 90 ────────────── 115 ── 120
 │  dawn   │            day            │ sunset  │      night       │ →dawn │
 │  10 min │           65 min          │ 15 min  │      25 min      │ 5 min │
```

| Phase | Island minutes | Day progress |
| --- | --- | --- |
| `dawn` | 0 – 10 | 0 – 0.08333 |
| `day` | 10 – 75 | 0.08333 – 0.625 |
| `sunset` | 75 – 90 | 0.625 – 0.75 |
| `night` | 90 – 120 | 0.75 – 1 |

Day is by far the longest span, because the world has to be readable most of the
time.

**The brief's five segments, four phase names.** The final five minutes are still
`phase === 'night'`; they are the segment in which the night keyframe crossfades
back into the dawn keyframe so the loop closes without a seam.
`IslandSkyState.inFinalTransition` reports it.

**Phases are labels, not the rendering mechanism.** If the renderer branched on
the phase, every boundary would be a visible cut. The visuals come from an
interpolated keyframe table instead, and the phase name is just a label attached
to a position in the cycle. That is why the continuity tests can assert that no
value jumps at a boundary.

## 4. Architecture

```
src/lib/island-clock.ts           pure  accelerated UTC clock
src/lib/island-sky.ts             pure  keyframe table → IslandSkyState
src/lib/island-sky-locations.ts   pure  per-LocationId compatibility
src/lib/island-sky-clouds.ts      pure  three cloud actors: travel & passage policy
src/lib/island-sky-cloud-shapes.ts pure five silhouettes: geometry & sizes
src/lib/island-sky-dev.ts         pure + guarded store: DEV overrides
src/hooks/useIslandSky.ts         React one shared timer, one snapshot
src/components/sky/IslandSkyLayer.tsx     gradient · glow · stars · clouds · sun · moon
src/components/sky/IslandWorldLight.tsx   the single scene-wide veil
src/components/sky/IslandSkyDevPanel.tsx  DEV-only harness
```

No timing arithmetic lives in a component. Everything a layer needs for one
instant is a field of `IslandSkyState`, produced by
`computeIslandSkyState(dayProgress)` — deterministic, free of `Date.now()`, and
therefore walkable by a test and scrubbable by the harness.

### The keyframe table is the design

`ISLAND_SKY_KEYFRAMES` is ten authored moments (`first light`, `sunrise`,
`morning`, `midday`, `golden hour`, `sundown`, `dusk`, `deep night`, `late night`,
and a wrap entry identical to the first). Each holds sky colours, a horizon glow,
star and cloud values, warmth, night intensity, the artwork grade and the veil.
**Read that table, not the components, to understand what the island looks like.**
Adding or retuning a keyframe is the intended way to change the look; continuity
is guaranteed by construction as long as the wrap entry matches the first, which a
test asserts.

## 5. Layers and stacking

Integration point: **`PlaceBackground`, inside `VirtualWorld`** — the one place
that already owns the location's visual plate inside the scaled world coordinate
space, present identically in both `BlobbiFrame` presentations.

```
z-0     IslandSkyLayer        gradient · horizon glow · stars · clouds · sun · moon
z-[1]   location artwork      <img>, time-of-day graded via CSS filter
z-10    world content         [data-world-surface] — interactives, Blobbi, players
                              …also publishes --island-world-grade, which grades
                              every world sprite <img> inside it (characters opt out)
z-[20]  IslandWorldLight      one low-alpha colour veil over the whole world
```

The scaled world box is a stacking context (it has a `transform`), so the world's
dense internal z-index range (`z-[2]` … `z-[28]` across `InteractiveElements` and
`MultiplayerLayer`) is local to the `z-10` content div. A sibling at any
`z-index > 10` is therefore reliably above **all** of it, and still below the HUD
(`z-30`), the switch-Blobbi overlay (`z-40`) and `SceneTransition` (`z-50`), which
are painted outside this subtree.

### Three things carry the light, on purpose

**The artwork is graded with a CSS `filter`, not covered by a tint.** A colour
veil between the artwork and the content div would also darken the sky and wash
the stars out, because the artwork is transparent exactly where the sky shows
through and a sibling overlay cannot follow another element's alpha channel. A
`filter: brightness() saturate()` on the `<img>` can: filters leave fully
transparent pixels transparent. It also costs zero extra DOM nodes, and both
functions interpolate natively under a transition.

**World sprites are graded from the same value**, via one CSS custom property.
This was the bright-shrub bug: only the background plate was graded, so at night
the plate dropped to `brightness(0.70)` while every *sprite* standing on it —
building shells, doors, props, the Town bushes, streetlights, floors, furniture —
stayed at `1.0`. `bush-1..3.png` are highly saturated greens sitting directly on
grass that *is* graded, which is why they were the visible symptom while the
darker blue-grey Plaza hall was not.

`PlaceBackground` publishes `--island-world-grade` on the existing
`[data-world-surface]` element, and one rule in `src/index.css` applies it to the
`<img>` elements inside. A custom property rather than a `filter` on that wrapper,
because a filtered wrapper becomes a stacking context and would flatten the
world-content layer's z-indexes — and the Blobbi's z-index is derived from its Y
position precisely so it can walk *behind* a bush or a building. A property is
inert: no stacking context, no layout change, no pointer change. On a leaf `<img>`
a filter has no descendants to reorder, so it is free.

Locations without sky support never set the property, so their sprites resolve to
`filter: none` and render exactly as before.

That rule deliberately carries **no `transition`**. The shorthand resets every
transition longhand and the selector outranks a class, so a transition there would
silently kill `.bush-sway-target`'s own `transition: transform 0.3s` — declared on
the bush image itself — along with any Tailwind `transition-*` on a future sprite.
Nothing is lost: the grade's fastest ramp moves brightness by ~0.003 per
ten-second tick, so sprites step imperceptibly while the plate eases between the
same values. A test pins the absence.

**One veil, above the players.** The remaining job is a shared warm/cool cast, and
that is the part that *should* reach characters — otherwise the Blobbi reads as a
daylight cut-out pasted onto a night scene. Above the content div is the only
robust placement (see the z-index reasoning above).

#### The opt-out contract

`data-island-world-grade="exclude"` means "this is not environment art; leave its
rendering alone." Matched **both** on the image and on any wrapper:

```css
[data-island-world-graded] img[data-island-world-grade='exclude'],
[data-island-world-graded] [data-island-world-grade='exclude'] img { filter: none; }
```

Used today by the local Blobbi (`MovableBlobbi`, on the `.blobbi-character`
wrapper) and remote players (`MultiplayerLayer`, on the `[data-player-key]`
wrapper). A future emissive or UI-like world sprite can opt out at its own call
site instead of someone widening the global rule.

This replaced two hardcoded selectors (`.blobbi-character img`,
`[data-player-key] img`). Auditing the real DOM found both were partly wrong:

- **The Blobbi body is an inline `<svg>`**, injected by `CurrentBlobbiDisplay` via
  `dangerouslySetInnerHTML` — so an `img`-scoped rule never reached it and the body
  was never at risk. What the exclusion actually protects is the **accessory
  overlay**, which *is* real `<img>` elements: without it, a hat would darken at
  night while the head it sits on did not. (It also means the grade rule must stay
  image-only. Extending it to `svg` would reach the body.)
- **They matched descendants only.** If `.blobbi-character` ever landed on an image
  itself, `.blobbi-character img` would not have matched it. The attribute form
  covers that case.

Streetlights are deliberately **not** excluded: their artwork has no separate
emissive layer, so grading them is correct. Exclusion is for art that
demonstrably needs it, not for anything that depicts a light.

`WorldGradeOptOut.test.tsx` and `WorldGradeOptOut.remote.test.tsx` check this
against the real rendered `MovableBlobbi` and a real presence-driven remote player,
including that scenery beside them still *is* graded and that pointer behaviour,
hover, transforms and z-index are untouched.

Because that veil also covers name labels, walk-up prompts and chat bubbles, its
alpha is **capped at 0.14** before per-location scaling. That is a contrast
budget, not a taste preference: at that weight a white chat bubble keeps ~86% of
its luminance, and the actual weight of night is carried by
`artworkBrightness` (0.70 at deep night), which cannot reach characters at all.
`island-sky.test.ts` asserts the cap, so raising it has to be a deliberate
decision.

### Invariants

Every layer this feature adds is `pointer-events: none` and `aria-hidden`, carries
no `data-world-surface`, and contains nothing focusable or clickable. Movement,
clicking, dragging, touch gestures, hover states and world controls are untouched.
`IslandSkyLayer.test.tsx` pins all of that in a real DOM, along with the paint
order above.

### Rendering without animating in React

The sky gradient is a stack of layers, one per keyframe, each holding that
moment's colours as a static `background-image`. Layers below the current keyframe
sit at `opacity: 1` (occluded, so no paint cost), the current one at `1`, the next
at the blend weight, the rest at `0`. Because every layer is fully opaque, that
composite is exactly a two-colour interpolation between two authored moments.

The gain over the obvious approach — one layer whose gradient colours are custom
properties — is that **`opacity` interpolates in every browser**, whereas
interpolating a colour held in a custom property needs `@property` registration
and would degrade to a visible step every ten seconds where that is unsupported.

Only the two *active* layers get a transition duration. When the cycle wraps, the
keyframe index jumps from last to first; if the layers being switched off
animated, the composite would briefly show a blend of the whole stack. Snapping
them is invisible because the wrap keyframe is authored to be identical to the
first.

The sun and moon use `left` / `top` percentages with transitions (natively
interpolable), and the veil uses `background-color` (likewise) — so nothing in the
system depends on `@property`.

## 6. Sun and moon

Simple visual arcs, no astronomy.

```
xPercent = 8 + progress * 84
yPercent = horizon - sin(π · progress) · (horizon - peak)
```

Left horizon → overhead near centre → right horizon, zero height at both ends so a
body always enters and leaves at the skyline.

| | Rises | Sets |
| --- | --- | --- |
| Sun | minute 0 (first light) | minute 90 (night begins) |
| Moon | minute 79 (late sunset) | minute 11 (after first light) |

The sun setting exactly when night starts means "the sun is down" and "it is
night" are the same statement rather than two settings that can disagree.

The moon's arc **wraps minute 120 → 0**, handled with forward-distance modulo
arithmetic so it keeps crossing the sky through the wrap rather than jumping back
to the eastern horizon mid-night.

Visibility is a function of arc position — a fade over the first and last slice of
each arc — rather than a separately keyframed opacity. That is what guarantees a
body is invisible whenever its position is parked outside its arc, so a hidden
body can never flash in at the wrong end of the sky. `sunProgress` is only
meaningful while `sunOpacity > 0`.

## 7. Clouds

`src/lib/island-sky-clouds.ts` — **three individual cloud actors, and nothing
else.**

### What the first attempt got wrong

Clouds were originally three **tiled bands**: a 200%-wide element per band, whose
`background-image` held four or five cloud shapes repeated with
`background-repeat: repeat-x`. In-app review showed two defects at once:

- **A blanket, not weather.** Thirteen cloud groups per tile, tiled twice, put
  roughly two dozen shapes on screen simultaneously — a continuous row of pale
  circles.
- **Permanently sliced shapes.** A repeated background tile is hard-clipped at its
  own edge; gradients do not bleed into the next repetition. Any cloud reaching
  within a few percent of the tile boundary was cut in half, and the offcut
  reappeared at the start of the next tile.

The band model is gone. Nothing tiles, and a test asserts that no `repeat-x`,
band class or band keyframe survives in the code.

### The actors

| Actor | Size | Direction | Path (ink) | Speed | Cycle | Offscreen |
| --- | --- | --- | --- | --- | --- | --- |
| `cloud-c` | small, 108 px | **left → right** | 3.8 % – 10.3 % | 5.5 px/s | ~787 s | ~555 s |
| `cloud-b` | medium, 136 px | right → left | 9.5 % – 17.7 % | 8 px/s | ~452 s | ~289 s |
| `cloud-a` | large, 172 px | right → left | 14.2 % – 24.6 % | 11 px/s | ~331 s | ~209 s |

Two travel one way, one the other. The reverse-travelling actor is deliberately
the smallest, slowest and faintest — a cloud crossing against the others is a nice
detail for a moment and an irritation if it demands attention.

Size, height, speed and opacity form **one depth cue**: small means high, pale and
slow (far away); large means lower, more opaque and faster (nearer). The large
cloud is lower only because it is nearer, never to separate it from the others.

### Staying in the upper sky

The island has far less usable sky than a gradient suggests — Plaza's artwork turns
opaque at ~38 % and its town hall fills the central upper sky, Mine's conifer line
starts at ~30 %, Beach's horizon sits at 50 %. Every actor's **drawn silhouette**
therefore stays above `ISLAND_CLOUD_MAX_BOTTOM_PERCENT` (26 %), and no actor is
wider than a fifth of the frame or taller than 15 % of it. Both are asserted
arithmetically, so an eyeballed tweak cannot quietly drop a cloud over a tree line.

Because the sky is behind everything, a cloud passing behind Plaza's town hall
simply disappears and re-emerges — correct depth, and it further limits how much
sky one cloud can hold.

### Sparseness is arithmetic, not luck

Each actor travels **further than it needs to**: the world width, plus its own
width, plus 60 px clearance each side, plus an explicit `offscreenWaitPx`. At a
constant linear speed that surplus becomes time spent completely offscreen — a real
gap from one linear keyframe and no JavaScript.

Sampling an hour at one-second resolution (`islandCloudsOnScreenAt`, asserted in
`island-sky-clouds.test.ts`):

| Clouds on screen | Share of the time |
| --- | --- |
| 0 | ~30 % |
| **1** | **~47 %** |
| 2 | ~21 % |
| 3 | ~3 % |

Mean ≈ 1.0. The large cloud is on screen ~34 % of the time, alone for ~47 % of
that, and sharing with *both* others only ~8 % of it — so a large passage is
normally solitary.

The three cycle lengths (331 s / 452 s / 787 s) are deliberately non-harmonic. An
earlier arrangement had two actors within 3 % of the same period, which froze
their relative phase for the length of a play session and kept repeating the same
pairing. A test now requires each successive duration to be at least 1.2× the last.

### Shape, and the rare formations

Five variants, all in `src/lib/island-sky-cloud-shapes.ts`:

```ts
type IslandCloudShape =
  | 'normal' | 'blobbi-egg' | 'blobbi-baby' | 'blobbi-adult' | 'heart' | 'poop';
```

Each is a **different part list** — different viewBox, different aspect, different
geometry. A test asserts no two share a fingerprint, so "same SVG, different
`data-*`" cannot slip in, and a second test asserts all six have distinct **ink**
aspect ratios (measured on the shape, not the viewBox — the character viewBoxes are
copied from the artwork and several are square).

#### The lobe-assembly correction

The three character formations were originally built the way the ordinary cloud is:
a stack of circles, ellipses and rounded rects. In-app review found that
`blobbi-egg`, `blobbi-baby` and `blobbi-adult` **all read as poop clouds**. The
cause was structural, not a tuning miss — each was a set of rounded tiers narrowing
towards the top, which *is* the poop-swirl construction. Any character assembled
that way lands on it.

So the characters no longer approximate anything:

- `blobbi-baby` is the **verbatim** `data-blobbi-body="true"` path from
  `BABY_BASE_SVG`.
- `blobbi-adult` is the **verbatim** `data-blobbi-body` ellipse from `CATTI_BASE`.
- `blobbi-egg` is derived from the baby contour, because the island has no egg
  artwork at all.
- Each is **one part**, so there are no tiers left to read as a swirl. A test pins
  that.

And the accidental shape was too good to discard, so **`poop` is now a deliberate
formation** — one continuous three-tier contour, and the rarest thing in the sky.

`normal` and `heart` are still lobe-assembled, and may stay that way: neither is a
character, so neither can be mistaken for one.

Construction rules, enforced arithmetically rather than by eye:

- **Rounded lobes only** — circles, ellipses, rounded rects. No polygons, no
  strokes, no text, no logos. A `rect` must have `rx > 0`.
- **One opaque fill, opacity on the wrapper**, so overlaps leave no darker patches.
- **Every part inside its own viewBox** (`cloudShapeInkBounds`), which is what
  guarantees no lobe is clipped by its own container. No wrapper in the chain has
  `overflow: hidden`.
- **4–6 parts each**, so a formation costs the same as an ordinary cloud.
- **Comparable visual mass** — every formation's bounding area at `medium` is
  within 0.7–1.5× the normal cloud's.

Softness is a single `blur(1.2px)` in the filter chain: enough to take the vector
hardness off the silhouette, far short of fog.

#### Where the Blobbi silhouettes come from

Simplifications of the project's own artwork, keeping only the **outer contour** —
no eyes, mouth, colours, patterns, internal lines, accessories or outlines.

| Variant | Production reference | Treatment |
| --- | --- | --- |
| `blobbi-baby` | `baby-svg-data.ts` → `BABY_BASE_SVG`, the `data-blobbi-body="true"` path `M 50 15 Q 50 10 50 15 Q 72 25 75 55 Q 75 80 50 88 Q 25 80 25 55 Q 28 25 50 15` (100×100) | **Verbatim.** The odd `Q 50 10 50 15` is in the artwork and is kept — it is the pinch at the crown that makes a baby a baby and not an egg |
| `blobbi-adult` | `adult-svg-data.ts` → `CATTI_BASE`, the `data-blobbi-body="true"` shape `ellipse cx=100 cy=120 rx=45 ry=60` (200×200) | **Verbatim.** A broad upright oval — see below for why this one out of sixteen |
| `blobbi-egg` | **None exists.** `loadBlobbiSvg` falls back to the baby drawing for the egg stage; `BlobbiHatchingCeremony` draws its egg from `borderRadius: '50%'` shapes | Derived: the baby ovoid with its crown pinch smoothed into a dome, drawn narrower and taller. The only formation here that is not copied, and the docs say so |
| `poop` | None — this one is the island's own | One continuous three-tier contour: the construction that used to happen by accident |

#### Which adult, out of sixteen

There is no shared adult path. Each of the sixteen `ADULT_SVG_MAP` forms draws its
own body: circles (bloomi, cloudi, owli, pandi, rosey, leafy), ovals (catti,
froggi), a rounded rect (cacti), polygons (crysti, rocky, starri) and a few paths.
Reproducing them all is out of scope, so one has to stand for the rest.

Two independent places choose the same one: `getDefaultAdultForm()` returns
`catti` (`ellipse rx=45 ry=60`), and `getFallbackAdultSvg` draws
`ellipse rx=50 ry=60`. Both are broad upright ovals, so that **is** the project's
shared adult direction.

The first attempt used `DROPPI_BASE`'s path instead — also real, and it carries the
same `Q x y x y` opening quirk as the baby path, marking it as the baby ovoid at
adult proportions. That turned out to be exactly the problem: rendered as a cloud it
was indistinguishable from `blobbi-baby`, because it is the same teardrop. The
default form's oval is equally real and visibly broader.

The lifecycle now reads as a genuine ladder of ink aspect ratios — narrow pointed
egg (0.43) → pinched teardrop baby (0.64) → broad oval adult (0.75) — with each step
asserted by a test.

#### Path bounds

`cloudShapeInkBounds` handles contours by taking the **control-point hull**: every
coordinate pair in the `d` string, min/maxed. A quadratic curve lies inside the hull
of its control points, so this over-estimates the ink and never under-estimates it —
the safe direction, since it is what the upper-sky budget and the
everything-inside-the-viewBox check are measured against. These are hand-checked
`M`/`Q`/`Z` contours, so a full path parser would be machinery without a purpose. A
test also rejects `L`/`H`/`V` in any contour: straight edges are what make a
silhouette read as a polygon, and several adult forms in the artwork *are* polygons.

`heart` is not a Blobbi reference: two top lobes over a tapering body, closed with
a soft round tip rather than a point. Deliberately imperfect — the right lobe is
smaller and higher than the left and the body ellipse is off-centre, because a
mirror-symmetric heart reads as a glyph. A test asserts the asymmetry.

The three tall formations get their **own high placement** (`topPercent` 4–6%)
rather than riding the actor's path, because a tall shape on the large actor's low
path would break the upper-sky budget. Every combination of shape × size is checked
against the 26% line.

#### How often a formation appears

Authored, not procedural: a 300-passage period with **16 special slots** — 4 egg,
4 baby, 4 adult, 3 heart, 1 poop, everything else normal. That is 5.3% special by
construction. Poop is deliberately the rarest by a factor of four: a joke formation
that turns up several times a day stops being a joke. Each actor reads the same table through its own coprime stride and
offset, so all three walk the whole table without marching in step.

Measured over 9,000 passages (`island-sky-cloud-selection.test.ts`):

| Shape | Slots | Target | Measured |
| --- | --- | --- | --- |
| `normal` | 284 | ~95% | ~95.0% |
| `blobbi-egg` | 4 | ~1.3% | ~1.1% |
| `blobbi-baby` | 4 | ~1.3% | ~1.1% |
| `blobbi-adult` | 4 | ~1.4% | ~1.3% |
| `heart` | 3 | ~1.0% | ~0.8% |
| `poop` | **1** | — | **~0.3%** |

Slightly under target across the board, because conflict resolution demotes some
authored specials to normal (below).

#### Size varies between passages

Each actor has an **allowed size set** and an authored 12-entry size cycle indexed
by passage:

| Actor | Allowed | Cycle |
| --- | --- | --- |
| `cloud-a` | medium, **large** | 4 large / 8 medium |
| `cloud-b` | small, medium | 5 small / 7 medium |
| `cloud-c` | small, medium | 9 small / 3 medium |

**Only `cloud-a` may ever be large.** That makes "never all three large at once" a
structural impossibility rather than a statistical hope, and it preserves the depth
ladder: the largest size only appears on the lowest path, and the highest path
never carries it.

#### Determinism and conflict resolution

A passage index is `floor((nowMs - ISLAND_EPOCH_MS)/1000 - delaySeconds) / duration)`
— a pure function of UTC and the actor's fixed cycle length, the same property the
sky phase relies on. Two clients with matching clocks compute the same cloud; a
3-second skew agrees >98% of the time, because passages last minutes. No
`Math.random()`, no local state, nothing persisted. Pre-epoch instants give
descending indices rather than folding.

The cycle duration is deliberately independent of size: `actor.widthPx` is the
**travel clearance** (the widest the actor can ever render), not the rendered
width. Otherwise the index — derived from the duration — would depend on the size
it selects, which the size depends on.

Two conflicts are resolved against higher-priority actors only (`a > b > c`, a
total order, so every client agrees without coordination), evaluated over the
**whole passage window** so the answer cannot change mid-flight:

1. **Never two special formations at once.** A rare shape is rare partly because it
   arrives alone.
2. **A large cloud travels with small company.** When a higher-priority actor is
   large across an overlapping passage, this actor drops to its smallest allowed
   size — so a large passage never shares the sky with a medium one.

Both are asserted second-by-second over eight simulated hours.

#### Stability

Shape, size, width and placement are functions of the passage index alone, so they
are fixed for the entire visible passage and can only change when the index
advances — which happens at the start of the travel, outside the world box. Tested
by sampling each passage at 0.1%, 25%, 50%, 75% and 99.9% of its length.

### Reset

Both animation endpoints lie outside the world box, so the jump from `to` back to
`from` always happens while the cloud is invisible. There is no tiling, therefore
no seam. Verified by pausing the animation either side of a reset: the sky is
simply empty across it.

No weather, no wind model, no collision.

## 8. Stars

Two elements — a dim far field of 16 and a brighter near field of 10 — each a
fixed, hand-scattered set of CSS radial-gradient stops. **Not one node per star**,
and not a random layout that would rearrange on every render.
`IslandSkyLayer.test.tsx` asserts the whole sky stays under 42 elements, so a
regression to per-star nodes shows up long before it shows up on a phone.

Behaviour follows the brief: 0 through the day, rising from minute 75 (sunset
start) to 1.0 at deep night, held through night, then fading out across dawn to 0
by minute 10. The near field has a 12-second, 20% opacity swell — air, not
twinkle.

## 9. Location compatibility

`src/lib/island-sky-locations.ts` — one record per `LocationId`, a `Record` rather
than a `Partial`, so adding a location to the union is a type error until somebody
decides whether it has a sky.

```ts
interface LocationSkyConfig {
  enabled: boolean;             // outdoor scene that should share the island sky
  showClouds: boolean;
  showStars: boolean;
  worldLightStrength: number;   // 0..1, scales BOTH the artwork filter and the veil
  artworkSkyReady: boolean;     // has the sky region actually been cut out yet?
  note: string;
}
```

**Keyed by `LocationId`, never by filename.** Much of the world (boundaries,
interactive elements, Blobbi sizing) is keyed by background filename, which is why
renaming one Plaza asset from `.png` to `.webp` touched six source files. This
table cannot be affected by the `.png` → `.webp` conversions, all of which have now
landed.

### Enabled in this phase

| Location | Asset | Sky transparent today? |
| --- | --- | --- |
| `town` | `town-open.webp` | **Yes** |
| `plaza` | `plaza-open.webp` | **Yes** |
| `beach` | `beach-open.webp` | **Yes** (~48%, above the ocean horizon) |
| `back-yard` | `back-yard-open.webp` | **Yes** (~28% strip above the fence) |
| `mine` | `mine-open.webp` | **Yes** (through the conifer gap) |
| `nostr-station` | `nostr-station-open.webp` | **Yes** |
| `plaza-inside` | `plaza-inside.webp` | **Yes** (the three arched windows, y 9–24 %) |

**The asset migration is complete: all six outdoor plates now expose a transparent
sky region**, verified by opening each current file. Every one is an outdoor scene with a
real sky. `mine-open.webp` is the mine **exterior**; `nostr-station-open.webp` is a
stylized outdoor hillside. Neither is a cave opening or an interior window, so both
take the global sky. `open` in a filename was treated as no evidence at all — see the
audit §10.

`back-yard` now gets clouds too. They were off while its sky was still painted into
the artwork; the real strip above the fence is ~28% of the frame (~195 world pixels)
and every cloud's ink stays above 26%, so a passage fits with room to spare.

**Note on the artwork's evolving composition.** These plates are being reduced to
ground and scenery, with structures moving out into separate sprites — Plaza's town
hall is no longer in `plaza-open.webp`, and the Mine's cave mouth has moved to
`world/buildings/mine-open-cave*.webp`. That is good for the sky (more visible sky,
and structures composite in front of clouds correctly), but it means the "usable
sky" figures above will keep growing, and any figure quoted here is a snapshot.

**`plaza-inside` is the one interior with a sky.** Its redrawn plate has three
arched windows whose panes are cut out (they are the only transparent pixels in
the file — a test on the location table pins the claim), so the live sky, clouds
and stars show through the glass while the walls stay opaque. Nothing is faked
behind the windows — the same `IslandSkyLayer` sits behind the plate as
everywhere else.

The room itself does NOT follow the night. It takes
`INTERIOR_WINDOW_LIGHT_STRENGTH` (0.1) rather than a number of its own: the
rule for any interior with cut-out windows is that the sky layer stays enabled
(the night is in the glass) while the grade — the brightness/saturation filter
on the plate and the veil over the scene — is reduced to a whisper, so a room
lit by its own lamps stays as bright at midnight as at noon (deep night comes to
a brightness of 0.97 on the plate and a 1.4 % veil). It was graded at half
strength at first, which darkened the whole plate — floor, shops, staircase —
to 85 % at night, because the filter cannot tell the windows from the walls;
the split between the sky layer and the grade is what lets the two behave
differently.

### Deliberately disabled

`home`, `nostr-station-inside`, `arcade`, `arcade-1`, `arcade-minus1`, `stage`,
`shop`, `clothing-store-inside` and the other shop interiors — interiors with no
window onto the sky.

`cave-open` — **despite the id**, its artwork is `cave-inside.png`, a cave
interior. The clearest illustration of why ids and filenames are not evidence.

A disabled location gets `worldLightStrength: 0` and renders no sky component at
all: its artwork has no `filter` and there is no veil, so it renders exactly as it
did before this feature existed.

## 10. How transparent artwork participates

The artwork is an `<img>`, not a CSS background, so its alpha composites against
whatever is painted earlier in the same stacking context — which is the sky. There
is no per-location masking, no chroma keying and no scene-specific hack; the sky is
simply *behind*, and the artwork decides how much of it shows.

Three consequences worth stating:

1. **Cut-out art needs no code change.** When `beach-open.webp` gets its sky
   removed, the sky appears. Nothing in `island-sky-locations.ts` has to move.
2. **Opaque art is harmless.** The sky is drawn and completely hidden. That costs
   one composited layer and buys the world-lighting grade, which is what keeps the
   whole island on one clock during the migration.
3. **Nothing forces the sky through opaque pixels.** There is no per-location
   opacity fudge and no "make the top 30% translucent" trick.

### The Mine's cave: a structure that moved out of the plate

Cutting the sky out of a background does not only add sky. `mine-open.webp` came
back from the migration as a bare forest path: the cave that used to be **painted
into** it is gone, and ships instead as two sprites that the scene composes on
top. This is the first location where a *structure* — not just weather — lives
above the plate, so it is worth writing down what that costs.

**The two assets.** `world/buildings/mine-open-cave.webp` (1271×642) is the
exterior rock arch, and `world/buildings/mine-open-cave-entrance.webp` (959×526)
is the lit tunnel seen through it. Everything positional lives in
`src/lib/mine-cave-config.ts`; the composition is `MineCaveEntrance.tsx`.

**Placement, and what may be retuned.** All of it. The starting values are
hand-picked against the artwork at world scale, not derived from anything:

| Value | Now | Measured against |
| --- | --- | --- |
| `wrapper.centerXPercent` / `bottomPercent` / `widthPercent` | 50 / 24 / 70 | the virtual world (1046×697) — the cave spans y ≈ 23%–76% |
| `mouth.left/width/top/bottom` | 41 / 24 / 44 / 5 | the **wrapper**, so the opening rides along when the cave is resized |
| `mouth.borderRadius` | `48% 48% 8% 8% / 34% 34% 4% 4%` | the arch's curve |
| `entranceObjectPosition` | `50% 62%` | which slice of the tunnel photo the opening shows |
| `approach` | `{ x: 50, y: 71 }` | the Mine's walk corridor (`x 42–58, y 68–75`) |

The wrapper is centred by arithmetic (`left: centre − width / 2`) rather than by
`translateX(-50%)`. That is not a style preference — see the depth note below.

**Layer order**, back to front: black backing → entrance preview → arch →
hotspot. The first two sit inside an `overflow-hidden` mouth element, because the
tunnel photo is much wider than the arch and would otherwise spill either side of
the rock. The clip is scoped to the opening precisely so it can never cut the
arch.

**Idle is black.** A plain black div behind the opening only — never a rectangle
behind the whole sprite. It is a little larger than the visible hole, and that
surplus hides behind the arch's own opaque rock, so it cannot leak. It is not an
`<img>`, so the grade does not touch it: black is black at every hour.

**One activation path.** Mouse, touch, Enter and Space all arrive as a single
`click` on the button, and that is the only event the component listens to. The
tempting extra `onTouchStart` + `preventDefault()` does not work here: React 18
registers `touchstart` at the root as a *passive* listener, so the synthetic
click survives and the tap activates twice — the second `requestInteraction`
replaces the first, and the replacement's cancellation clears the lock the tap
had just set, leaving the cave dark for the whole walk. The touch device still
gets its more forgiving proximity threshold, read from the click's
`pointerType`.

**Preview and active.** Hover or keyboard focus fades the backing out and the
tunnel in; neither enters the mine. A click, tap or Enter/Space *locks* it open
and requests the room's existing walk-to-interact
(`usePendingInteraction` → `blobbiRef.goTo`), which fires `setCurrentLocation('cave-open')`
on arrival — the same destination and the same mechanism as before. The lock is
released by that pending interaction and nothing else: it fires, or it is
cancelled (a tap on other ground, the location changing, unmount). There is no
timeout, so the cave stays lit for however long the walk takes.

**The hotspot is a real `<button>`**, covering the opening only. An `<img>`
receives pointer events across its whole rectangle including transparent pixels,
so a door-overlay element here would have swallowed clicks on the entire
hillside; instead every piece of art is `pointer-events: none`, the wrapper is
too, and only the button opts back in. `MovableBlobbi`'s block-list already
matches `button`, and `data-block-move` states the same contract explicitly. In
dev, the shared **Debug overlays** switch outlines it — that is the only way to
see it while tuning the numbers above, and `DebugOverlaysContext` hard-gates it
out of production.

**Depth is the interesting part.** The wrapper carries **no** `z-index` on
purpose. A positioned element with one creates a stacking context, and the three
layers would then be sorted against the Blobbi as a single opaque block. Left at
`auto` they interleave with the Blobbi's Y-derived z-index instead:

| Layer | z | Reading |
| --- | --- | --- |
| opening | 9 | *behind* a Blobbi at the entrance (z-10), so it stands **in** the mouth |
| arch | 15 | in front of it — rock and posts occlude it where they are opaque. Same depth as Town's shopfronts, and the depth `interactive-elements-config.ts` already records for `cave` |
| hotspot | 16 | above the art, invisible |

A Blobbi further down the path resolves to z-20 and clears the whole structure,
which is correct — it is nearer the camera. Remote players read their depth from
the same `resolveBlobbiZIndex`, so they layer identically.

**Grading reaches both sprites for free.** They are ordinary `<img>` elements
inside `[data-world-surface]`, and neither carries
`data-island-world-grade="exclude"` — they are environment art and darken with
the rest of the scene. Nothing here adds a `filter` to a wrapper, which is the
one thing that would have broken the stacking above.

## 11. DEV controls

Open from **account menu → Developer tools → "Sky controls"**, which is the same
place the existing "Debug overlays" switch lives. The panel appears **inside the
live world**, so what is being adjusted is the real scene with the real Blobbi and
real remote players in it — the only way to judge whether night is too dark to
play in.

| Control | Effect |
| --- | --- |
| **Auto** | Back to the production clock, clouds on, no simulated preferences. |
| **Freeze** | Hold wherever the clock is right now. |
| **dawn / day / sunset / night** | Jump to the middle of that phase (minutes 5 / 42.5 / 82.5 / 105). |
| **Day progress** slider | Scrub the full 120 island minutes, 0.25-minute steps. |
| **Clouds** | Force the cloud bands off. |
| **Reduced motion** | Simulate the OS preference. Locked on, and shown as `OS: on`, when the OS really asks for it. |
| **Cloud preview → actor** | A / B / C — which actor the shape, size and placement overrides apply to. |
| **Cloud preview → shape** | Auto · Normal · Blobbi Egg · Blobbi Baby · Blobbi Adult · Heart. |
| **Cloud preview → size** | Auto · small · medium · large. A forced size ignores the actor's `allowedSizes`, so every size can be judged on every actor. |
| **Cloud preview → position** | Automatic · Preview. Preview parks the selected actor in the open sky and hides the other two. |
| Cloud readout | What production would be showing on each actor right now, so a forced variant can be compared against the real policy without switching the override off. |
| **Sky locations** | One-tap travel to each enabled scene. A `○` marks scenes whose artwork has no transparent sky yet, so an invisible sky is never mistaken for a broken one. |
| Readout | Phase, island `mmm:ss`, phase progress, and whether the clock is auto or held. |

While a position is held, CSS transitions drop from 10 s to 200 ms so the slider
feels responsive instead of broken.

Choosing a concrete shape or size also switches placement to `preview`
(`islandSkyDevCloudOverride`), because a production formation appears roughly once
in twenty passages and a passage lasts up to thirteen minutes — waiting for one is
not an inspection strategy. Returning both to Auto releases placement again, so one
click restores production behaviour completely.

The preview parks the cloud over the **left quarter** of the frame, not the centre.
Centring was the first attempt and the wrong one: every sky-ready location puts its
main structure in the horizontal middle — Plaza's town hall, Town's three shopfronts
— so a centred preview sat behind the scenery with a sliver showing.

`resolveIslandCloudDev` is read-only with respect to the production policy: it
returns what to draw *instead* and never feeds back into `islandCloudPassage`.
Overrides apply only to the selected actor; the other two stay on UTC-derived
selection even while one is previewed, and the island clock is a separate axis that
a cloud preview does not touch.

### Production safety

- `isSkyDevMode` is `import.meta.env.DEV`, which Vite replaces with a literal
  `false`. The `{isSkyDevMode && <IslandSkyDevPanel />}` branch is therefore dead
  code and the panel is **absent from the production bundle** — verified by
  grepping `dist/` for `IslandSkyDevPanel`, `Simulate reduced motion` and the
  slider's label. This is not CSS hiding.
- Every mutator in `island-sky-dev.ts` is itself guarded, so even if the panel
  were somehow mounted its controls would be inert.
- The default state is frozen (`Object.freeze`) and is `mode: 'auto'`, and
  `resolveIslandDayProgress` returns the real clock **untouched** in auto mode —
  so production behaviour is bit-identical to having no harness at all. A stale
  held value is ignored rather than lingering.
- The `AccountMenu` "Developer tools" section is now additionally gated on
  `import.meta.env.DEV` so the whole block, including the pre-existing debug
  switch, stops shipping as dead markup.

It is deliberately **not** a `/dev/sky` route: `src/dev-routes.test.ts` asserts
exactly two dev routes exist, and a route would have to rebuild the world shell to
show a sky, which would be testing a replica.

## 12. Reduced motion

Handled from two independent directions, both in `src/index.css`:

1. **`@media (prefers-reduced-motion: reduce)`** stops cloud travel and the star
   breathe with `!important`. In CSS, so it needs no JavaScript, no re-render and
   no hook, and applies before React hydrates.
2. **`[data-island-sky-reduced-motion='true']`**, set by the sky root from the DEV
   harness, so the presentation can be checked without changing system settings.

The media query wins over the attribute, so the harness can simulate reduced
motion but never simulate it *away* for someone who genuinely asked for it.

Switching the cloud animation off leaves each actor on its own inline `transform`,
which `IslandSkyLayer` sets to that actor's `restPx` — three clouds at three
different widths and three different heights, none stacked, all fully on screen so
nothing looks sliced in a still image. In Plaza one of the three rests behind the
town hall, which makes the static composition sparser still.

**No information is lost.** Time of day is communicated by colour, by where the
sun and moon are, and by whether stars are out. Motion is never the only signal,
so stopping it removes decoration only. The ten-second state crossfades are
deliberately *kept*: they are slow colour interpolation rather than motion, and
removing them would replace smooth change with a visible step every ten seconds.

## 13. Extension points for future weather

Nothing about weather is implemented, and nothing here should be read as a
half-built weather system. What exists that a later phase can build on:

- **`nightIntensity` and `warmth`** are already computed, normalised and unused by
  anything structural — the natural inputs for ambience, lantern glows or a fog
  density.
- **`IslandSkyState`** is one pure function of one number. A weather layer would
  add fields to the same struct and stay testable the same way.
- **`LocationSkyConfig`** is the established place for per-scene switches; a
  `weather` or `allowPrecipitation` flag belongs there, not in a component.
- **The cloud band model** already takes a per-band count, scale, speed and
  opacity, so "more/denser cloud" is data rather than new code.
- **The crossfade stack** generalises: a precipitation layer would be another
  `pointer-events: none` sibling inside `IslandSkyLayer`.

A real weather feature would also need a shared source of truth so all players
see the same weather. The clock's approach — derive it deterministically from UTC
— is the obvious candidate and needs no backend either.

## 14. Known limitations

- **Device clock accuracy.** A client whose clock is wrong is out of step by
  exactly that error. Accepted for this phase; there is no correction mechanism
  because there is no server to correct against.
- **Four of six enabled scenes show no sky yet.** Their artwork is still opaque.
  They do get the world-lighting grade, so the island is on one clock, but the
  sky itself is invisible until the art lands. The `○` marker in the DEV panel and
  `artworkSkyReady` in the config both record this.
- **`sunProgress` is meaningless while the sun is down.** It clamps to 1 during
  night and resets to 0 at the wrap. Safe because `sunOpacity` is 0 at both ends
  of the arc, but a consumer must not read the position without the opacity.
- **The letterbox margins are graded, not skied.** On viewports that are not ~3:2,
  the margins show a blurred, dimmed copy of the artwork; it now receives the same
  time-of-day grade so it does not stay in daylight, but the sky itself lives
  inside the scaled world and does not extend into them. With Plaza and Town now
  transparent at the top, those margins show the frame's cream through the blurred
  copy — a consequence of the asset migration, not of this feature.
- **The sprite grade reaches every world `<img>`, including ones nobody has looked
  at at night.** It is scoped to sky-enabled locations and excludes characters, but
  any future decorative image added inside the world layer is graded by default.
  That is the intended direction (opt-out beats opt-in for environment art), but it
  means a new sprite that must stay at full brightness has to say so.
- **Two of the three actors can never be large.** That is how "never all three
  large" is guaranteed structurally, but it does mean size variation on `cloud-b`
  and `cloud-c` is small↔medium only.
- **Baby and adult are the closest pair of formations.** Both carry a top tuft; they
  differ by proportion and by the adult's shoulder flare. Distinguishable side by
  side, less so glimpsed alone at mobile scale.
- **A formation can be hidden by scenery.** Town has almost no open sky, so a
  formation there often passes entirely behind the tree line and shopfronts. The
  policy has no notion of per-location visibility, so a rare shape can be "spent"
  unseen.
- **Cloud visibility is measured against the world box, not against each
  location's usable sky.** `islandCloudsOnScreenAt` counts a cloud that happens to
  be behind Plaza's town hall as visible, so the real on-screen count in a
  building-heavy scene is lower than the table in §7 — in the sparse direction, but
  the numbers are an upper bound rather than an exact figure.
- **`PlaceBackground` re-renders every ten seconds** because it reads the grade.
  `children` is referentially stable across those renders, so React bails out on
  the whole world subtree and only a few wrapper divs are diffed — but it is a
  re-render, not zero.
- **No `@property` dependency, but no colour-space nicety either.** Keyframe
  colours interpolate in sRGB. The keyframes are close enough together at the
  fast-moving moments that a perceptual space would buy nothing measurable.
- **Not verified on a real device.** All visual checks were done in Chrome on
  macOS against the rendered components; see §15.

## 15. Manual QA

1. `npm run dev`, log in, and stand in **Town** or **Plaza** — the only two scenes
   whose sky is visible today.
2. Account menu → Developer tools → **Sky controls**.
3. Step **dawn → day → sunset → night** and confirm at each stop: the Blobbi is
   clearly visible, name labels and chat bubbles are legible, interactive objects
   still read as clickable, and the Map/HUD/dock are unaffected.
4. Drag the **Day progress** slider slowly across all 120 minutes. Watch for a
   pop at minutes 10, 75, 90 and at the 120 → 0 wrap. There should be none.
5. Set **Auto** and leave the tab for a few minutes; confirm the sky moves on its
   own and that no console warnings accumulate.
6. With the sky at night, **click to move, drag furniture, tap a bush, open a
   door, sit in a theater seat**. Nothing decorative may swallow input.
7. Toggle **Clouds** and **Reduced motion**; confirm travel stops with the three
   clouds at separated positions, and that the sky remains informative. Then enable
   reduced motion in macOS System Settings and confirm the OS preference is honoured
   and the switch locks on.
7a. **Clouds specifically.** Watch a full `cloud-a` cycle (~5½ minutes) and check:
   the silhouette reads as a cloud at scene scale; it stays in the upper sky and
   never drifts over the tree line or a doorway; usually one cloud is visible and
   the sky is often empty; the reverse-moving small cloud is easy to miss rather
   than distracting; nothing shows an internal cut edge; and the loop reset is
   invisible (the sky is simply empty across it).
7c. **Every cloud variant.** Open Cloud preview, pick actor A, and step through all
   five shapes at all three sizes. Check: egg, baby and adult are distinguishable;
   all three still read as clouds rather than white character sprites; the egg is not
   a plain oval; the baby has a rounded baby contour with its small tuft; the adult
   has convex flanks and is not a triangle; the heart is imperfect and soft. Then
   check at least one formation at night, one with reduced motion simulated, and one
   on a narrow viewport, and confirm none is internally clipped, none dominates the
   usable sky, and all sit near the top. Finally set shape and size back to Auto and
   confirm production selection returns immediately.
7b. **Night sprites.** At night, confirm the Town bushes, streetlights and the
   arcade/stage/shop shells are graded like the grass they stand on — not brighter —
   while the Blobbi and any remote player stay at full brightness. Then click a bush
   and confirm hiding still works, and hover a door and confirm the hover overlay
   still appears.
8. Toggle fullscreen while the sky is mid-transition — the world must not remount
   (position, seat and any watch session survive).
9. Visit each `○` location (**beach**, **back-yard**, **mine**, **nostr-station**)
   and confirm the scene looks *graded* but otherwise unchanged, with no sky
   bleeding through.
10. Visit **home**, **stage**, an **arcade** floor and **cave-open** and confirm
    they look exactly as they did before.
11. On a phone in landscape, check frame rate while clouds drift at day and at
    night.
