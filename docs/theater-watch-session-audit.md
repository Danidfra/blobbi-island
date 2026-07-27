# Theater Watch Session — Technical Audit

Audit of the existing Blobbi Island theater (`LocationId: 'stage'`) and a concrete technical
plan for turning it into a synchronized social watch room.

**Status: audit only.** No player was implemented, no Nostr kind was generated, no event was
published. Every "recommendation" below is a proposal for a later, separately-reviewed change.

Audited at commit `f9c2f62` (branch `feat/town-bush-hiding`).

> ### Decision change — 2026-07-27
>
> **The final product decision intentionally differs from this audit's minimal single-kind
> recommendation.** The shipping protocol uses **two** experimental kinds — `31951` Shared
> Playback Session (addressable canonical state) and `21951` Shared Playback Command (ephemeral
> low-latency command) — specified in **[`docs/protocol/shared-playback-session.md`](protocol/shared-playback-session.md)**.
>
> The audit recommended one addressable kind because it is *strictly simpler to make correct*
> (§8.2, §8.4). That reasoning was not overturned; the product scope was widened. The target is a
> complete shared playback experience (play, pause, seek, ±10 s, restart, media change, rate
> change, late join, reconnect, buffering recovery, drift correction), and for that scope the
> addressable-only design has one cost the wider product will not accept: **every control action
> pays a full addressable-publish round trip before any guest reacts.** The two-kind design keeps
> the audit's correctness model intact — the addressable event remains the sole source of truth
> and the only thing a joining, reconnecting or command-missing client needs — and adds the
> ephemeral event purely as a latency layer that carries the *same* revision.
>
> The audit's objections to Architecture B (§8.2) were answered rather than ignored:
> * *"Two sources of truth"* → the protocol states as invariant **I1/I3** that a command is never
>   the only source of truth and that `31951` alone reconstructs a correct client.
> * *"A joiner must reconstruct state from an unbounded command tail"* → commands carry
>   **absolute** state, never deltas, and joiners never read commands at all.
> * *"Two kinds to generate and document"* → accepted cost, both documented as experimental with
>   a collision-research report.
>
> Everything else in this audit stands. Sections superseded in part: §0 (summary row), §8.4,
> §14 items 8–9. The audit's findings on the theater, chairs, rear-facing renderer, seat geometry
> and media integration remain the basis of the implementation plan.

---

## 0. Executive summary

| Question | Answer |
| --- | --- |
| Is there a theater today? | Yes — `LocationId 'stage'`, background `stage-inside.png`, 28 clickable armchairs. |
| Does a screen placeholder exist? | **Yes, and it is better than expected**: the background PNG has a *rectangular transparent hole* at x 6.8–92.7 %, y 6.7–56.9 %, currently showing through as black. It is a ready-made player mount. |
| Does sitting work? | **No.** Clicking a chair only walks the Blobbi to a coordinate. The arrival/seated code path is dead (`_handleChairArrival`), so `isSeated` is never true anywhere. |
| Do seats have identity? | **No.** All 28 chairs share `alt="Stage Chair"`, so all 28 collapse to `data-chair-id="stage-chair"`. |
| Is seating multiplayer-aware? | **No.** Nothing about sitting is published; remote Blobbis are drawn from coordinates only. |
| Can a Blobbi face backward? | Not today, but it is cheap: all 34 Blobbi SVGs mark their face parts with `<!-- Eyes … -->` / `<!-- Pupils … -->` / `<!-- Mouth -->` comment blocks, and the renderer **already** post-processes those exact blocks (`applyGazeMarkup`, pupil-fill fallback). A `view: 'front' \| 'rear'` transform is the smallest clean change. |
| Does an existing Nostr kind fit? | **No.** Verified against the NIPs index and `registry-of-kinds`: nothing in the protocol models synchronized playback of *recorded* media. NIP-53 covers live streams and meeting rooms only. |
| Recommended MVP | Curated catalog + YouTube IFrame API + **one host-authored addressable session event** carrying canonical playback state with a monotonic revision. No ephemeral command events in v1. **→ Superseded:** the shipping decision adds an ephemeral command kind for latency. See the *Decision change* note above and [`docs/protocol/shared-playback-session.md`](protocol/shared-playback-session.md). |

> ### Implementation status — 2026-07-27
>
> Phases 1–3 of the plan in [`docs/protocol/shared-playback-session.md`](protocol/shared-playback-session.md) §19
> are implemented: the rear-facing renderer, the data-driven seat system, and the local YouTube
> player. See **[`docs/theater-local-implementation.md`](theater-local-implementation.md)** for
> what the code actually does now.
>
> Findings in this audit that have been ADDRESSED: §1.10 (all dead chair code removed, curtain
> `console.log` gone, curtain given touch parity, little door documented as decoration),
> §2 (seat identity, arrival, seated state), §3 (rear view), §4 (seated scale + the shared
> `blobbi-world-render.ts`), §5.2–5.7 (player adapter, lifecycle, failure modes, autoplay).
>
> One recommendation was **overridden by product decision**: §5.8 / §12's *curated catalog*. The
> theater accepts any embeddable YouTube video by URL or id. The moderation reasoning in §12 is
> therefore unmitigated and still open.

---

## 1. Audit of the current theater

### 1.1 Identity and files

| Concern | Location |
| --- | --- |
| Location id | `'stage'` — `src/lib/location-types.ts:1` |
| Background file | `'stage-inside.png'` — `src/lib/location-backgrounds.ts:15` |
| Background asset | `public/assets/world/backgrounds/stage-inside.png` (1037 × 691) |
| Room-specific art | `public/assets/locations/stage/` — `curtain.png` (895×378), `red-curtain.png` (917×372), `chair.png` (128×123), `chair-left.png` (128×123), `open-little-door.png` (46×65) |
| All interactive markup | `src/components/blobbi/InteractiveElements.tsx:818-940` (the `backgroundFile === 'stage-inside.png'` branch) |
| Walk boundary | `src/lib/location-boundaries.ts:162-166` |
| Blobbi z-index bands | `src/lib/interactive-elements-config.ts:53-60` |
| Blobbi size | `'xl'` — `src/lib/location-blobbi-sizes.ts:8` |
| Entry position | `{ x: 50, y: 75 }` — `src/lib/location-initial-position.ts:20` |
| Exit-to-town position | `town:stage → { x: 58, y: 65 }` — `src/lib/location-initial-position.ts:36` |
| Presence location mapping | `src/lib/multiplayer.ts:335`, duplicated at `src/components/blobbi/MultiplayerLayer.tsx:1216` |

### 1.2 Entering and leaving

**Enter** — only from Town. `InteractiveElements.tsx:1234-1250` renders the Town stage building
plus a `stage-door.png` overlay whose `onClick` calls `setCurrentLocation('stage')`, routed
through `requestInteraction` so the Blobbi walks to the door first and the navigation fires on
arrival (`src/hooks/usePendingInteraction.ts`).

**Leave** — the `BackArrow` at `InteractiveElements.tsx:935-938` calls
`setCurrentLocation('town')`. The theater is **not** on the island map
(`MapModal.tsx:33-76` lists only home, beach, mine, nostr-station, plaza, town), so Town is the
only way in and out.

`setCurrentLocation` is `transitionToLocation` (`src/contexts/LocationContext.tsx:16-34`):
500 ms fade-out, swap, 500 ms fade-in. On the swap, `PlayingView` remounts `MovableBlobbi` via
`key={currentLocation}` (`PlayingView.tsx:571`), clears `hiddenIn`
(`PlayingView.tsx:121-123`), and `useIslandPresence` drops every remote player, republishes
presence and re-subscribes (`useIslandPresence.ts:857-914`).

### 1.3 Visual layers (current, from back to front)

```
z  layer                                     source
-- -----------------------------------------  ---------------------------------------------
–  blurred letterbox fill (decorative)        PlaceBackground.tsx (outside VirtualWorld)
1  background img + bg-black                  PlaceBackground.tsx — `currentLocation === "stage" ? 'bg-black'`
9  Blobbi when y < 80 % (back rows)           interactive-elements-config.ts:58
10 chair row C (back), left + right           InteractiveElements.tsx:880, 923
15 Blobbi when y 80–85 %                      interactive-elements-config.ts:57
20 chair row B (middle), left + right         InteractiveElements.tsx:866, 909
20 BackArrow                                  InteractiveElements.tsx:937
25 Blobbi when y > 85 % (front row)           interactive-elements-config.ts:56
30 chair row A (front), left + right          InteractiveElements.tsx:852, 895
–  curtain block (`h-[55%] top-[5%]`, no z)   InteractiveElements.tsx:821-841
```

The curtain block is a plain `absolute` div with **no z-index**, inside the same stacking
context — it therefore paints below every `z-*` sibling, i.e. behind the chairs. It covers
`top-[5%]` to `top-[60%]`, exactly the transparent hole (see 1.4).

### 1.4 The screen already exists as a transparent hole

`stage-inside.png` is an 8-bit palette PNG whose palette index 0 is fully transparent
(`tRNS`). Measured runs of transparent pixels:

```
rows 10 %–55 %  → contiguous transparent span x = 71 … 961 px  (6.8 % … 92.7 %)
rows 58 %+      → no transparent span (solid stage floor)
cols 10 %–90 %  → contiguous transparent span y = 46 … 393 px  (6.7 % … 56.9 %)
```

So the art contains a clean rectangle:

* **x 6.8 % → 92.7 %** (890 px of 1046 world px = 85.8 % of world width)
* **y 6.7 % → 56.9 %** (347 px of 697 world px = 50.2 % of world height)
* aspect ratio **2.565 : 1**

It renders black today only because `PlaceBackground.tsx` adds `bg-black` to the background
`<img>` when `currentLocation === "stage"`. Anything mounted *behind* the background image (or
inside the hole with a lower z) shows through. **This is the player mount** — no new art is
required.

A 16 : 9 player fitted by height inside the hole is 617 × 347 px → **x 19.8 % … 78.8 %,
y 6.7 % … 56.9 %**, centered. Fitting by width would overflow the hole vertically.

```
        0%   6.8%        19.8%                     78.8%       92.7%  100%
  0%    ┌────────────────────────────────────────────────────────────┐
        │  wooden proscenium frame (opaque art)                      │
  6.7%  │    ┌───────────────────────────────────────────────────┐   │  ← transparent hole
        │    │        ┌───────────────────────────────┐          │   │     (2.565:1)
        │    │        │                               │          │   │
        │    │        │   16:9 player 617×347 px      │          │   │
        │    │        │                               │          │   │
 56.9%  │    └────────┴───────────────────────────────┴──────────┘   │
 57-64% │  stage floor (opaque)                                      │
 64-76% │  stage front wall  ▓▓▓  little door at x 45.4–49.8 %  ▓▓▓   │
 74.6%  │ [c1][c2][c3][c4][c5]        aisle        [c6][c7][c8][c9][c10]  row C  z10
 79.6%  │[b1][b2][b3][b4][b5]         aisle        [b6][b7][b8][b9][b10]  row B  z20
 84.6%  │ [a1][a2][a3][a4]            aisle            [a5][a6][a7][a8]   row A  z30
 100%   └────────────────────────────────────────────────────────────┘
```

### 1.5 Interactive elements, one by one

| Element | Markup | Behavior today |
| --- | --- | --- |
| Yellow curtain | `:826-834` | `effect="slide"` up on hover; `onClick={() => console.log('Curtain clicked')}` — **console-only dead interaction**. |
| Red curtain | `:835-839` | Static decoration, `pointer-events-none`. |
| Little door | `:842-848` | `effect="slide"` right, **no `onClick` at all** — pure hover decoration, unreachable behavior. |
| 28 armchairs | `:852-934` | `type="chair"` + `onClick={handleChairClick}`. Walks the Blobbi to a computed point. Nothing else. |
| Back arrow | `:935-938` | Returns to Town. |

**Curtain is desktop-only.** The slide is driven by `isHovered`, set by `onMouseEnter` /
`onMouseLeave` on the wrapper div at `:821-825`. That wrapper has no touch handlers, and
`InteractiveElement`'s own `isTouchActive` fallback is bypassed because the parent passes an
explicit `isHovered` prop (`InteractiveElement` line 158: `isHovered !== undefined ? isHovered
: (isSelfHovered || isTouchActive)`). On a touch device the curtain never opens.

### 1.6 Movement boundaries and blockers

`stage-inside.png` boundary (`location-boundaries.ts:162-166`):

```ts
{ shape: 'rectangle', x: [0, 100], y: [75, 98] }
```

* The full width is walkable, including x < 3 % and x > 97 % where there is no floor art.
* y ≥ 75 % keeps the Blobbi off the stage — but row C's seat point sits at **y ≈ 77.6 %**, only
  2.6 points inside the boundary. Any future seat anchor above 75 % is silently clamped by
  `constrainPosition` and the Blobbi will stop short of the seat.
* There are **no `MovementBlocker`s in the theater**. The only blockers in the codebase are the
  two Town streetlights (`InteractiveElements.tsx:1307`).

### 1.7 Scaling and z-index behavior

* **No perspective scaling.** `locationScalingConfig` (`src/lib/location-scaling-config.ts`)
  has **no `'stage-inside.png'` entry**, so `getDynamicScale` returns `1` for every position —
  both for the local Blobbi (`MovableBlobbi.tsx:249-295`) and for remotes
  (`MultiplayerLayer.tsx:1236-1282`). The Blobbi is the same size in the front row and the back
  row.
* **Size is `'xl'`**, i.e. the SVG box is `size-28 md:size-32` = 112/128 px inside the fixed
  1046 px world (`CurrentBlobbiDisplay.tsx:191-198`). A Blobbi is therefore **as wide as a
  chair** (112 px).
* **z-index bands line up with the rows by luck, and they work.** Measured seat anchors vs.
  bands (`positionFromBottom = 100 − y`):

| Row | sprite top | seat anchor y | band | Blobbi z | row container z | result |
| --- | --- | --- | --- | --- | --- | --- |
| A (front) | 84.6 % | 87.6 % | 0–15 | 25 | 30 | Blobbi behind row A chair backs ✔ |
| B (middle) | 79.6 % | 82.7 % | 15.01–20 | 15 | 20 | behind B, in front of A? ✖ (15 < 25 but A is z30 anyway) ✔ |
| C (back) | 74.6 % | 77.6 % | 20.01–100 | 9 | 10 | behind row C ✔ |

  Depth ordering is correct as-is; the seated scale work in §4 must not break it.

### 1.8 Geometry of the 28 chairs (measured, world = 1046 × 697)

Chairs render 112 × 107.6 px (`w-28`, intrinsic 128×123, `object-contain`). Rows are flex
containers with `-space-x-4` (−16 px), so the horizontal pitch is 96 px = 9.18 %.

| Row | container | seats | sprite | centers (x %) |
| --- | --- | --- | --- | --- |
| A left | `bottom-0 left-0 z-30` | 4 | `chair-left.png` | 5.4, 14.5, 23.7, 32.9 |
| A right | `bottom-0 right-0 z-30` | 4 | `chair.png` | 67.1, 76.3, 85.5, 94.6 |
| B left | `bottom-[5%] -left-[6%] z-20` | 5 | `chair-left.png` | **−0.7**, 8.5, 17.7, 26.9, 36.1 |
| B right | `bottom-[5%] -right-[6%] z-20` | 5 | `chair.png` | 63.9, 73.1, 82.3, 91.5, **100.6** |
| C left | `bottom-[10%] -left-[2%] z-10` | 5 | `chair-left.png` | 3.4, 12.5, 21.7, 30.9, 40.1 |
| C right | `bottom-[10%] -right-[2%] z-10` | 5 | `chair.png` | 59.9, 69.1, 78.3, 87.5, 96.6 |

Two seats (B-left outermost at −0.7 %, B-right outermost at 100.6 %) are **effectively
off-world** and must not be claimable. That leaves **26 usable seats**. There is a centre aisle
(no seats between 40.1 % and 59.9 %).

### 1.9 Mobile vs. desktop

* Everything world-side scales uniformly: the world is a fixed 1046 × 697 box transformed by
  `VirtualWorld` (`src/components/shell/VirtualWorld.tsx`). Percent positions and px sizes stay
  aligned at every viewport, and `getBoundingClientRect()` math is scale-invariant.
* `InteractiveElement` has explicit touch parity for `scale`, `door` and `opacity` effects
  (`TOUCH_FEEDBACK_MS = 900`, `InteractiveElements.tsx:120`, `160-216`), and `onTouchStart`
  calls `preventDefault()` so chairs respond to a single tap.
* **Gap:** the curtain (see 1.5) and, more importantly for this feature, **YouTube autoplay and
  inline playback are mobile-restricted** (see §5.7).
* Movement speed is world-scale-corrected for both local (`MovableBlobbi.tsx:328-331`) and
  remote (`useIslandPresence.ts:218,235`) Blobbis, so seat-walk timing is identical across
  devices.

### 1.10 Dead / unfinished code in and around the theater

1. `_handleChairArrival` (`InteractiveElements.tsx:442-460`) and `_handleChairLeave`
   (`:462-469`) are **never called**. Confirmed by grep: the only references are their own
   definitions.
2. Consequently `onChairArrival` / `onChairLeave` (`:309-310`), which `PlayingView` wires at
   `PlayingView.tsx:513-514`, are **never invoked** → `isSeated`, `eyesClosed` and
   `isAttachedToChair` in `PlayingView` are permanently `false`.
3. `_isSeated` / `_eyesClosed` state in `InteractiveElements` (`:341-342`) is written only by
   the dead handlers.
4. `MovableBlobbi`'s `_isSeated` prop (`MovableBlobbi.tsx:61,110`) is destructured and **never
   used** in the component body.
5. `sitZIndexOffset={2}` (`PlayingView.tsx:590`) is therefore never applied.
6. `handleChairClick` (`:387-421`) resolves the chair config by
   `document.querySelector('[data-chair-id="…"]')` — with 28 identical ids it can only ever find
   the first one.
7. Curtain `console.log` (`:832`); little door with no handler (`:842-848`).
8. `handleElementClick` (`:423-440`) still carries a `// TODO: Add navigation or action logic`.

### 1.11 Reusable from other rooms

| Pattern | Where | Reuse for the theater |
| --- | --- | --- |
| Data-driven props with stable semantic ids | `src/lib/town-bushes-config.ts` + `src/components/blobbi/TownBush.tsx` | **The template for `theater-seats-config.ts`.** Ids like `town-bush-1` are used identically in local state and presence. |
| Walk-to-interact with arrival callback | `src/hooks/usePendingInteraction.ts` | Replace the chair's fire-immediately click with confirmed arrival. |
| Explicit, position-independent multiplayer state | `PresenceContent.hiddenIn` (`multiplayer.ts:59-72`) + `publishHide` (`:482-518`) + `hideAt` (`useIslandPresence.ts:698-715`) | **The template for `seatId` / `watchSessionId`.** |
| Monotonic ordering for same-second events | `PresenceContent.seq`, `isSupersededPresence` (`multiplayer.ts:88-134`) | **The template for the playback revision counter.** |
| Rect-derived world target, clamped to boundary | `computeBushTarget` (`TownBush.tsx:25-45`) | Seat anchors computed from the rendered chair rect instead of hardcoded twice. |
| Modal opened by sitting | Nostr Station chairs → `setIsNostrHubModalOpen(true)` (`InteractiveElements.tsx:416-420`) | Precedent for "sitting opens a room UI". |
| SFX on arrival with cooldown | `useSfx` + `BUSH_RUSTLE_SFX` | Seat-sit sound. |
| Room-scoped ephemeral broadcast | chat: `CHAT_KIND 21201`, `#l` location + `#i` island filters (`MultiplayerLayer.tsx:599-737`) | Precedent for a room-scoped Nostr channel with NIP-40 expiration and rate limiting. |

---

## 2. Audit of the chair / sitting system

### 2.1 What exists

`InteractiveElementProps.chairConfig` (`InteractiveElements.tsx:105-112`):

```ts
chairConfig?: {
  sleepOnSeat?: boolean;
  seatAnchor?: { xPercent?: number; yPercent?: number };
  sitZIndexOffset?: number;
}
```

A duplicate, unused declaration of the same shape also lives in
`src/lib/interactive-elements-config.ts:16-27` (`InteractiveElementConfig.chairConfig`) — no
`interactiveElementsConfig` entry ever sets it.

`InteractiveElement` with `type="chair"` (`:275-278`) stamps two data attributes:

```
data-chair-id="{alt.replace(/\s+/g,'-').toLowerCase()}"
data-chair-config="{JSON.stringify(chairConfig || {})}"
```

`handleChairClick` (`:387-421`):

1. finds the nearest `.w-full.h-full.relative` ancestor as the coordinate container,
2. converts `chairRect` + `seatAnchor` (default `{50, 20}`) to a container percentage,
3. `setSeatedChairId(chairId)`,
4. `blobbiRef.current.goTo({x, y})` — a normal animated walk,
5. special-case: in `nostr-station-inside.png` it also opens the Nostr Hub modal.

That is **all** that happens. There is no arrival detection, no seated state, no occupancy, no
publication.

### 2.2 Chair inventory across the island

| Room | chairs | `chairConfig` | ids produced |
| --- | --- | --- | --- |
| Arcade B1 | 4 (`:598-648`) | `seatAnchor {50,20}` | `left-chair`, `right-chair` (×2 each) |
| Nostr Station inside | 4 (`:1154-1198`) | `seatAnchor {50,25}`, `sitZIndexOffset 1` | duplicated names |
| Shop (mall) | 4 (`:1568-1607`) | `seatAnchor {50,38}`, `sitZIndexOffset 1` | `shop-left-chair` ×2, `shop-right-chair` ×2 |
| **Theater** | **28** (`:852-934`) | **none** | **`stage-chair` ×28** |

Chair ids are derived from `alt` text and are **not unique anywhere**, worst of all in the
theater.

### 2.3 Answers to the audit questions

* **Chair targets / seat anchors** — computed at click time from the live DOM rect plus
  `seatAnchor` percentages. Default `{ xPercent: 50, yPercent: 20 }`. Theater chairs use the
  default because they pass no config.
* **`onChairArrival` / `onChairLeave`** — declared, wired by `PlayingView`, **never fired**
  (§1.10). `PlayingView.handleChairArrival` would set `isSeated`/`isAttachedToChair` and snap
  with `goTo(position, true)`; `handleMoveStart` (`PlayingView.tsx:185-206`) would clear them on
  any movement. The teardown half is correct and reusable; only the arrival half is missing.
* **Local movement state** — a seated Blobbi is indistinguishable from a standing one. Only
  `isAttachedToBed` (home) has a working attached state.
* **Multiplayer presence while seated** — nothing. `PresenceContent` has `state`, `location`,
  `anchor`, `goal`, `blobbiD`, `hiddenIn`, `seq`. A seated player publishes an ordinary idle
  presence at the seat coordinate.
* **Position and z-index** — `getDynamicZIndex` adds `sitZIndexOffset` only when
  `isAttachedToChair` is true (`MovableBlobbi.tsx:242-247`), which never happens. Remotes have
  **no** sit offset path at all: `MultiplayerLayer.getDynamicZIndex(pos, sitOffset = 0)`
  (`:1231-1234`) is always called with the default (`:1329`).
* **Chair occupancy** — does not exist in any form, locally or remotely.
* **Can two players sit in the same seat?** — Yes. Nothing prevents it; both Blobbis render at
  the same coordinate and overlap.
* **Explicit vs. inferred** — sitting is **entirely inferred from coordinates**, and only
  visually. There is no "seated" bit anywhere in the system.

### 2.4 Reuse vs. generalize

**Reuse as-is**
* `usePendingInteraction` for the walk + confirmed arrival (already used by doors and bushes).
* `PlayingView.handleMoveStart` as the universal "stand up / unhide" transition.
* `MovableBlobbi.goTo(pos, true)` to snap exactly onto the seat anchor on arrival.
* The `hiddenIn` end-to-end pattern (local state → presence field → remote render) as the
  literal blueprint for `seatId`.

**Generalize / replace**
1. **Seat identity must not come from `alt`.** Introduce explicit ids
   (`theater-seat-a1` … `theater-seat-c10`) supplied by data, and stamp `data-seat-id`.
2. **Config must come from a table, not from JSX props + `JSON.stringify` in a DOM attribute.**
   Serializing config into `data-chair-config` and re-parsing it after a `querySelector` is
   fragile and already broken by duplicate ids.
3. **Arrival must be wired.** Prefer the `TownBush` shape: the seat component owns its
   `requestInteraction({ target, action })` and reports `onSit(seatId)` on arrival — instead of
   resurrecting `_handleChairArrival` and its DOM lookup.
4. **Seated state must be explicit and published**, exactly like `hiddenIn`.
5. Do **not** assume the existing chair system provides reliable occupancy. It provides none.

---

## 3. Audit: can the Blobbi visually face backward?

### 3.1 How a Blobbi is composed today

```
CurrentBlobbiDisplay (src/components/blobbi/CurrentBlobbiDisplay.tsx)
 ├─ picks data: local (useBlobbis + useBlobbonautProfile) or visualOverride (remote)
 ├─ loadBlobbiSvg(stage, adultType, baseColor, secondaryColor, eyeColor, isSleeping||eyesClosed, scopeId)
 │    src/lib/loadBlobbiSvg.ts
 │    ├─ adult → getAdultBaseSvg(form) | getAdultSleepingSvg(form)  → customizeAdultSvg(...)
 │    └─ baby  → getBabyBaseSvg()      | getBabySleepingSvg()       → customizeBabySvg(...)
 ├─ applyGazeMarkup(svg)  ← only when eyeOffset is provided
 ├─ dangerouslySetInnerHTML
 └─ AccessoryOverlay (absolute inset-0, PNG sprites on top)
```

* **Art inventory**: 1 baby form + 16 adult forms × {base, sleeping} = **34 inlined SVG
  strings** (`src/blobbi/baby-blobbi/lib/baby-svg-data.ts`,
  `src/blobbi/adult-blobbi/lib/adult-svg-data.ts`, 2 809 lines).
* **Colour**: `base_color` / `secondary_color` drive per-form gradient rebuilds
  (`adult-svg-customizer.ts`, `FORM_CUSTOMIZERS` at `:575`); `eye_color` rebuilds the pupil
  gradient or, as a fallback, replaces hardcoded fills **scoped to the `<!-- Pupils … -->`
  comment block** (`adult-svg-customizer.ts:739-743`).
* **`pattern`, `specialMark`, `manifestations`**: carried in `BlobbiVisual`
  (`multiplayer.ts:172-182`) and parsed from kind 31124, but **not rendered by the SVG pipeline
  at all** today. Nothing to hide in rear view because nothing is drawn.
* **Sleeping variants**: separate SVG strings, selected by `isSleeping || eyesClosed`.
* **Stage-specific visuals**: `stage === 'adult'` selects one of 16 forms; anything else falls
  back to the baby SVG (egg included).
* **IDs**: `uniquifySvgIds` prefixes every id so multiple Blobbis coexist.

### 3.2 The decisive structural fact

Every one of the 34 SVGs delimits its parts with HTML comments, and the codebase **already
treats those comments as a semantic API** (`gaze.ts:22` `PUPILS_BLOCK_REGEX`,
`adult-svg-customizer.ts:739`). Enumerated comment blocks per form:

| Form (base) | face blocks present |
| --- | --- |
| baby | `Eyes (white/base eye shapes)`, `Pupils (pupil + highlights)`, `Mouth`, `Soft blush for cuteness` |
| BLOOMI | `Eyes`, `Pupils`, `Mouth`, `Bochechas` |
| BREEZY, CACTI, CLOUDI, CRYSTI, DROPPI, FLAMMI, LEAFY, MUSHIE, ROCKY, STARRI | `Eyes`, `Pupils`, `Mouth` |
| CATTI | `Eyes`, `Pupils`, `Nose`, `Mouth`, `Enhanced whiskers` |
| FROGGI | `Big circular pop-out eyes` *(silhouette)*, `Eyes`, `Pupils`, `Mouth`, `Enhanced nostrils` |
| OWLI | `Eyes`, `Pupils`, `Enhanced beak` |
| PANDI | `Eyes (black patches + white base)`, `Pupils`, `Nose`, `Mouth` |
| ROSEY | `Eyes`, `Pupils`, `Mouth`, `Rosy cheeks` |
| sleeping variants | `Sleeping eyes` / `Olhos dormindo` / `Twinkling eyes` / `Large expressive eyes`, `Peaceful mouth` / `Boca calma` / `Boca tranquila`, plus `"Zzz"` |

**No existing artwork has a rear view**, and no `viewBox` transform can produce one (the face is
baked into the same flat drawing as the body).

### 3.3 Recommendation — smallest clean implementation

Add a **rear-view SVG transform in the renderer pipeline**, alongside `applyGazeMarkup`:

```
src/blobbi/ui/lib/svg/rear-view.ts          (new)
  export function applyRearView(svgText: string): string
```

It removes the *face* comment blocks by an **explicit token list** (never a bare `/eyes/i`,
which would also strip FROGGI's silhouette bulges), using the same
"comment-block until the next comment or `</svg>`" convention `gaze.ts` uses. Face tokens to
remove:

```
Eyes (            Pupils            Mouth             Nose
Bochechas         Rosy cheeks       Soft blush        Enhanced whiskers
Enhanced beak     Enhanced nostrils Enhanced cat nose Sleeping eyes
Olhos dormindo    Twinkling eyes    Large expressive eyes
Peaceful mouth    Boca calma        Boca tranquila
```

Explicitly **kept**: `Big circular pop-out eyes` (FROGGI body), all body/ear/tail/petal/leaf/
arm/leg/spine/wing/texture blocks, all `<defs>`/gradients, `"Zzz"` (a sleeping Blobbi is
plausible from behind).

Public API — a **semantic renderer prop**, not external CSS:

```ts
// src/lib/loadBlobbiSvg.ts
export type BlobbiView = 'front' | 'rear';
loadBlobbiSvg(stage, adultType, baseColor, secondaryColor, eyeColor, isSleeping, instanceId, view = 'front')

// src/components/blobbi/CurrentBlobbiDisplay.tsx
facing?: 'front' | 'back';   // default 'front'
```

`facing` is the component-level word (it describes the character), `view` the asset-level word
(it describes which drawing to produce) — mirroring the existing `isSleeping` → sleeping-SVG
split. Thread `facing` through `MovableBlobbi` (local) and `RemoteBlobbiSprite`
(`MultiplayerLayer.tsx:80-153`) so both paths use one code path.

Why this and not the alternatives:

* **Author 34 rear SVGs** — 4× the art surface (34 → 68 strings), guaranteed drift on every
  colour-customizer change. Rejected.
* **Hide face nodes with external CSS** — explicitly undesirable, and structurally wrong here:
  the SVG is injected via `dangerouslySetInnerHTML` with per-instance id prefixes and no stable
  class names on face shapes (`.blobbi-pupil` is added only when gaze is enabled). Rejected.
* **`transform: scaleX(-1)`** — mirrors, does not turn. Rejected.

### 3.4 What disappears, what remains

| Element | Rear view |
| --- | --- |
| base body shape + gradients | **kept** (silhouette and colours are the identity) |
| secondary colour / inner highlight | **kept** |
| eyes (white base) | removed |
| pupils + highlights | removed (and `applyGazeMarkup` becomes a no-op — no `Pupils` block to mark, `gaze.ts:55-59` already returns unchanged) |
| mouth | removed |
| nose / beak / whiskers / nostrils | removed |
| blush / cheeks | removed |
| ears, tail, arms, legs, wings, petals, leaves, spines, pot, stem | **kept** |
| animated particles (pollen, sparkles, raindrops, flames) | **kept** |
| `Zzz` on sleeping variants | **kept** |
| pattern / specialMark / manifestations | not rendered today — nothing to do |

**Baby vs. adult** need no different handling: same comment convention, same transform, same
prop. Only the *token list* must cover the Portuguese-named sleeping blocks, which appear in
both families.

### 3.5 Remote representation

`facing` must **not** be a new network field. It is derived: a remote player is drawn rear-facing
iff their presence says they occupy a theater seat whose configured `facing` is `'back'`:

```
remote presence.seatId → theaterSeats[seatId].facing === 'back' → facing="back"
```

This keeps one source of truth (the seat table), costs zero extra bytes, and cannot desync from
the seat the Blobbi is drawn in. It also means a future rear-facing seat elsewhere (e.g. the
Nostr Station) works automatically.

### 3.6 Accessory rules (per slot)

Slots are `headwear | eyewear | back | neckwear | handheld | face-mark | aura | color-overlay`
(`src/components/blobbi/lib/accessory-types.ts:14`). Accessories are PNG sprites positioned by
percent + scale + rotation over the SVG (`AccessoryOverlay.tsx:125-172`).

| Slot | Rear view | Rationale |
| --- | --- | --- |
| `headwear` | **keep** | Hats read correctly from behind. |
| `back` | **keep** (arguably more visible) | Wings/capes are back-mounted. |
| `aura` | **keep** | Radial, view-independent. |
| `color-overlay` | **keep** | Tint. |
| `eyewear` | **hide** | Front-of-face only. |
| `face-mark` | **hide** | Front-of-face only. |
| `neckwear` | **keep** | A collar/scarf wraps the neck; acceptable from behind. |
| `handheld` | **hide in v1** | Held in front; a mirrored position would need per-accessory art. |

Implementation: a `REAR_VIEW_HIDDEN_SLOTS` set consumed by `AccessoryOverlay` behind a new
`facing` prop. **Pre-existing bug worth noting:** `AccessoryOverlay` reads the *local* user's
equipment via `useAccessoryManagement()` and has no override, which is why remote sprites pass
`showAccessories={false}` (`MultiplayerLayer.tsx:147`). Remote accessories are therefore out of
scope for the theater work — do not try to fix it here.

---

## 4. Audit: theater scaling and positioning

### 4.1 Current numbers

| Quantity | Value | Source |
| --- | --- | --- |
| Blobbi size class | `xl` → 112 px (mobile class) / 128 px (`md:`) in a 1046 px world | `location-blobbi-sizes.ts:8`, `CurrentBlobbiDisplay.tsx:191-198` |
| Dynamic scale in theater | **1.0 always** (no `stage-inside.png` entry) | `location-scaling-config.ts` |
| Chair sprite | 112 × 107.6 px | measured, §1.8 |
| Seat anchor default | 50 % / 20 % of the sprite | `InteractiveElements.tsx:400` |

A 112 px Blobbi in a 112 px chair fills the chair completely and occludes its neighbours.

### 4.2 Recommendation

**Scale by *seat*, driven by the *sitting state* — not by the room and not by y-position.**

* Do **not** add `locationScalingConfig['stage-inside.png']`. Continuous y-based scaling would
  fight the three discrete rows (a Blobbi walking the aisle would grow/shrink between rows) and
  would also change how *standing* Blobbis look in a room where that currently works.
* Give each seat an explicit `seatedScale`, applied **only while seated**:

| Row | seat y | `seatedScale` | effective width |
| --- | --- | --- | --- |
| A (front) | 87.6 % | **0.85** | 95 px |
| B (middle) | 82.7 % | **0.78** | 87 px |
| C (back) | 77.6 % | **0.72** | 81 px |

  0.85 for the front row is the headline recommendation ("slightly smaller"); B and C continue
  the same ratio downward so the rows read as depth. A seated Blobbi's head then clears the
  chair back without covering the row behind it.

### 4.3 Where to apply it (chat-bubble safety)

Both renderers already separate the **anchor** from the **scaled sprite**:

* local: outer positioned div `#my-blobbi-anchor` with `translate(-50%,-50%)` and **no scale**
  (`MovableBlobbi.tsx:598-616`); inner wrapper carries `scale(dynamicScale)` (`:620-625`).
* remote: outer div `[data-player-key]` with no scale (`MultiplayerLayer.tsx:1359-1373`); inner
  sprite wrapper carries `scale(dynamicScale)` (`:1411-1414`).

Chat bubbles portal into the **outer** element (`getAnchorEl`, `MultiplayerLayer.tsx:1288-1300`;
`ChatBubblesLayer`). Therefore:

> Multiply `seatedScale` into the **existing inner wrapper transform only**. The bubble anchor,
> the logical world position and the presence anchor are all untouched by construction.

Two secondary details:

1. The ground shadow is a sibling of the sprite that applies its own `scale(dynamicScale)`
   (`MovableBlobbi.tsx:644-657`, `MultiplayerLayer.tsx:1434-1444`). A seated Blobbi should
   **hide** the shadow — it is sitting on a chair, not standing on the floor.
2. `animate-float` should be disabled while seated (`MovableBlobbi.tsx:629`,
   `MultiplayerLayer.tsx:1416-1419`) — a bobbing seated Blobbi looks wrong and would fight the
   chair.

### 4.4 Local/remote parity

`getDynamicScale` and `getDynamicZIndex` are **duplicated** between `MovableBlobbi` and
`MultiplayerLayer` (identical bodies, ~50 lines each), as is the `LocationId → background`
map (`multiplayer.ts:322-343` vs `MultiplayerLayer.tsx:1203-1223`). Any seated-scale or
seated-z change made in one place and forgotten in the other produces exactly the
local/remote divergence this feature cannot tolerate.

**Recommendation:** before touching either, extract the shared math into
`src/lib/blobbi-world-render.ts` (`resolveBlobbiScale`, `resolveBlobbiZIndex`,
`resolveSeatedRender`) and have both call it. This is a prerequisite of Phase 6, not a
nice-to-have.

### 4.5 Proposed seat configuration shape

```ts
// src/lib/theater-seats-config.ts  (new)

export type SeatRow = 'a' | 'b' | 'c';

export interface TheaterSeatConfig {
  /** Stable id — local state, presence and occupancy all key on this. */
  id: `theater-seat-${SeatRow}${number}`;   // theater-seat-a1 … theater-seat-c10
  row: SeatRow;
  side: 'left' | 'right';
  /** Chair sprite (chair-left.png mirrors chair.png). */
  src: string;
  /** Absolute placement inside the world, replacing the flex rows. */
  positionClass: string;                    // e.g. 'left-[0.9%] bottom-0 w-[10.7%]'
  /** Fractional aim point inside the sprite rect → the walk-to target. */
  interactionTarget: { x: number; y: number };   // default { x: 0.5, y: 0.2 }
  /** Extra sprite-relative offset applied to the seated Blobbi, if the art needs it. */
  seatedOffset?: { xPercent: number; yPercent: number };
  /** Sprite scale multiplier applied ONLY while seated (see §4.2). */
  seatedScale: number;
  /** Fixed chair z-index — constant, never raised (the TownBush rule). */
  zIndex: number;                           // a: 30, b: 20, c: 10
  /** Which way the seated Blobbi faces. */
  facing: 'front' | 'back';                 // 'back' for every theater seat
  /** false for the two off-world seats (§1.8) — rendered, never claimable. */
  claimable: boolean;
}
```

Occupancy is deliberately **not** in this table — it is runtime state derived from presence
(§11), not configuration.

---

## 5. Audit: media-player integration

### 5.1 There is nothing to build on

* No `<video>`, no `<iframe>`, no `youtube` reference anywhere in `src/`.
* `public/assets/video/cutscenes/` exists and is **empty**.
* No media dependency in `package.json`.

So the player is greenfield.

### 5.2 Integration approach

Use the **official YouTube IFrame Player API** (`https://www.youtube.com/iframe_api`) behind a
thin internal adapter. Two files:

```
src/lib/youtube-player.ts     imperative adapter: loadYouTubeApi(), createPlayer(), typed wrapper
src/hooks/useYouTubePlayer.ts React lifecycle: mount, ready/error state, cleanup
```

Why an adapter:

* The API is a global-callback, script-injection API (`window.onYouTubeIframeAPIReady`) that
  must be loaded **once per page**; a promise-memoized loader is the only sane React fit.
* It keeps the synchronization layer (§9) testable against a small interface
  (`play/pause/seek/getCurrentTime/getState`) instead of against YouTube.
* It is the seam where a second provider (self-hosted MP4, Nostr NIP-71 video) can be added
  later without touching the sync algorithm.

No third-party wrapper package: one small file avoids a dependency that would need auditing, and
the project already has no media deps. **No scraping, no unofficial endpoints, no
`youtube-dl`-style extraction** — the embed API only.

Also required: an `origin` player var, `enablejsapi=1`, and `allowfullscreen` on the iframe.

### 5.3 Lifecycle

```
mount (enter theater, session active)
  └─ loadYouTubeApi()  → memoized script injection
     └─ new YT.Player(el, { videoId, playerVars, events })
        ├─ onReady        → adapter ready; apply canonical state (§9)
        ├─ onStateChange  → feed the sync layer (host: publish; guest: drift/buffer tracking)
        └─ onError        → surface error state (§5.6)
unmount (leave theater / close player / location change)
  └─ player.destroy()   → removes the iframe
```

`PlayingView` remounts on `currentLocation` change (`key={currentLocation}`), so a player
mounted inside the stage branch is destroyed automatically on exit. **Explicit `destroy()` in a
`useEffect` cleanup is still required** — leaving the iframe alive would keep audio playing.

**Playback must stop when navigating away.** Blobbi Island is a single-page app with no
persistent audio layer; background audio from a room the player has left is unacceptable and
also violates the spirit of the YouTube embed terms.

### 5.4 Capability matrix

| Capability | API | Notes for this feature |
| --- | --- | --- |
| play | `playVideo()` | Guests: may be blocked without a gesture → start muted (§5.7). |
| pause | `pauseVideo()` | Safe. |
| seek | `seekTo(seconds, allowSeekAhead)` | Use `allowSeekAhead = true` for host seeks and hard corrections. |
| current time | `getCurrentTime()` | Fractional seconds; unreliable while `BUFFERING`. |
| duration | `getDuration()` | `0` until metadata loads. |
| state | `onStateChange` / `getPlayerState()`: `-1` unstarted, `0` ended, `1` playing, `2` paused, `3` buffering, `5` cued | `3` must suspend drift correction. |
| playback rate | `setPlaybackRate()`, `getAvailablePlaybackRates()` | Include `rate` in canonical state; **keep it at 1.0 in the MVP** (rate is the single biggest source of divergence). |
| volume / mute | `setVolume()`, `getVolume()`, `mute()`, `unMute()` | **Strictly local.** Never synchronized. |
| buffered | `getVideoLoadedFraction()` | Useful for a "buffering" indicator. |
| load / cue | `loadVideoById()` (plays), `cueVideoById()` (prepares) | Guests should `cueVideoById` then follow the canonical state. |
| fullscreen | Fullscreen API on the iframe container | The project already has `useFullscreen` / `FullscreenExitButton` for the app shell; a video fullscreen must not fight them. Postpone. |
| captions | `cc_load_policy=1`, `cc_lang_pref` player vars | Availability is per-video. **Local preference, never synchronized.** |

### 5.5 Video-id validation

YouTube ids are exactly 11 chars from `[A-Za-z0-9_-]`:

```ts
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
```

Validate **before** constructing a player and **on every received event**. In the recommended
MVP (§5.8) the check is stronger: the id must be present in the local catalog, so an
unrecognized id is rejected outright rather than sanitized.

### 5.6 Failure modes to handle explicitly

| Code / condition | Meaning | UI |
| --- | --- | --- |
| `2` | invalid parameter (malformed id) | "This video can't be played" + host can pick another |
| `5` | HTML5 player error | retry once, then the same message |
| `100` | not found / removed / private | "Video unavailable" |
| `101`, `150` | **embedding disabled by the owner** | "The owner doesn't allow this video to be embedded" — the single most likely failure with arbitrary links, and a strong argument for a curated catalog |
| `153` | missing `Referer` / client identification | check `origin` player var |
| region blocked | no error code; the video simply refuses to play | timeout heuristic: `PLAYING` never reached within ~10 s of a play command → show "unavailable in your region" |
| API script blocked | `loadYouTubeApi()` rejects | "Couldn't load the video player" + retry |

Loading states: skeleton in the screen area while the API script loads and while the player is
`-1`/`5`; a small spinner overlay while `3` (buffering). Follow the project convention —
skeletons for structure, spinners for short operations (`CLAUDE.md`).

### 5.7 Autoplay and mobile restrictions

* Browsers block unmuted autoplay without a user gesture (documented in the IFrame API
  reference). A guest joining a session mid-video therefore **cannot be started unmuted
  programmatically**.
* **Design consequence:** guests join **muted and playing**, with a prominent one-tap
  "🔊 Unmute" affordance. This makes synchronization work on the first frame and needs exactly
  one gesture from the user.
* iOS requires `playsinline=1`, otherwise playback takes over the screen natively and the world
  disappears.
* iOS also historically refuses programmatic `play()` on a *fresh* element without a gesture
  even when muted; the join flow must tolerate "play was refused" and show a "Tap to watch"
  overlay rather than silently desyncing.
* Cross-origin iframes need an autoplay Permissions Policy; add `allow="autoplay; encrypted-media; fullscreen"`.

### 5.8 Source of videos — recommendation

| Option | Safety | Effort | Verdict |
| --- | --- | --- | --- |
| **1. Fixed curated local playlist** (ids in the repo) | highest — every id reviewed, embeddable, region-checked before shipping | lowest — no input UI, no validation surface, no moderation system | ✅ **MVP** |
| 2. Arbitrary YouTube links from the host | lowest — arbitrary content to strangers, embedding failures, region blocks, misleading titles | highest — needs reporting, blocking, rate limits, title/thumbnail sanitization | ❌ postpone |
| 3. Approved catalog fetched from Nostr (e.g. a Blobbi-signed kind 31633-style catalog) | high, but adds a trust root, a fetch path and a cache | medium | ⏭ Phase 11 |

**Recommendation: option 1 for the MVP** — `src/lib/theater-catalog.ts` exporting a typed
`TheaterCatalogEntry[]` (`{ videoId, title, durationHint, thumbnail }`). The host picks from a
list; the wire format carries only the `videoId`, and every client resolves the title/thumbnail
**from its own catalog**, never from the event. That single decision removes the whole
"offensive title/thumbnail" and "misleading link" attack surface (§12) at zero cost.

The catalog should contain only **Blobbi-owned or manually approved, embeddable** videos.
Verify each entry's embeddability (no 101/150) and rough region availability before adding it.

### 5.9 Child-focused implications (documented, not built)

* There is **no public YouTube Kids embed API**. "Kid-safe" cannot be delegated to a product;
  it has to be a curation decision.
* Videos marked "made for kids" on YouTube have platform-level feature restrictions
  (no personalized ads, comments disabled, some playback features limited). They remain
  embeddable, so a curated MFK-only catalog is technically viable.
* Related-video surfaces and end screens are the practical risk with arbitrary embeds; a curated
  catalog plus `rel=0`-style constraints and never leaving the embed reduces but does not
  eliminate them.
* If Blobbi Island later targets children specifically, the honest options are (a) curated
  catalog only — already the MVP, or (b) self-hosted media, which removes YouTube's discovery
  surfaces entirely. **Do not** design a moderation system now; design so that arbitrary links
  are never enabled by default.

---

## 6. Audit: existing multiplayer and Nostr infrastructure

### 6.1 Inventory

| Concern | Implementation |
| --- | --- |
| Presence kind | **31950**, addressable, `d = session:<uuid>` (`multiplayer.ts:352-378`) |
| Presence tags | `a` = `31124:<pubkey>:<blobbiD>`, `t=blobbi:presence`, `t=island:<id>`, `t=loc:<location>`, `expiration` |
| Presence content | `{ state, location, anchor{x,y,ts}, goal?, blobbiD?, hiddenIn?, seq? }` (`multiplayer.ts:53-89`) |
| Session identity | `crypto.randomUUID()` per browser session (`makeSessionId`, `useIslandPresence.ts:120`) |
| Movement sync | **goal-based**, not position streaming: `{from, to, v, ts}`; clients interpolate with `posAt` (`multiplayer.ts:219-241`) and a rAF loop (`useIslandPresence.ts:205-338`) |
| Location filtering | relay-level `'#t': ['blobbi:presence', 'island:<id>', 'loc:<loc>']` (`useIslandPresence.ts:641-649`) |
| Monotonic sequence | `PresenceContent.seq`, pre-incremented at publish-intent time (`nextSeq`, `:166-169`); ordering via `isSupersededPresence` (`multiplayer.ts:111-122`) |
| Chat | kind **21201**, ephemeral, tags `d=sessionId`, `l=location`, `i=islandId`, `p`, `expiration`, `alt`; 120-char limit, 500 ms rate limit, 10 s evict, HTML-stripped, deduped per `pubkey:d` |
| Relays | single relay from app config (`NostrProvider.tsx:32-44`), default `wss://relay.ditto.pub`; `reqRouter`/`eventRouter` both pin to it |
| Subscriptions | `nostr.req()` streaming with automatic fallback to `nostr.query()` polling (`MultiplayerLayer.tsx:431-500`) |
| Signing | `user.signer.signEvent` via `useNostrPublish`, which injects `["client","blobbi"]` and swallows kind-31950 publish failures (`useNostrPublish.ts:24-52`) |
| Expiration | NIP-40, `EXP_SECONDS = 35`, heartbeat every `25 s` (`multiplayer.ts:19-25`) |
| Stale cleanup | 1 s GC interval removing players unseen for `EXP_SECONDS + 5` (`useIslandPresence.ts:752-782`) |
| Optimistic local state | local Blobbi is authoritative locally (`MovableBlobbi`); own presence events are skipped on receive (`:367-370`); chat bubbles show optimistically (`MultiplayerLayer.tsx:643`) |
| Addressable vs. ephemeral | addressable 31950 for presence (last-write-wins per session, republished on every change); ephemeral 21201 for chat |
| Documentation | `NIP.md` — kinds 1124, 11125, 31124, 31632, 31633, 31950, 21201 |

### 6.2 What to reuse

1. **The `hiddenIn` pattern in full.** `hiddenIn` is exactly the precedent this feature needs:
   an optional, explicit, position-independent semantic field on presence; set on confirmed
   arrival; preserved across heartbeats (`publishHeartbeat`, `multiplayer.ts:523-561`); cleared
   by the next movement because `publishMove` simply omits it; ignored by older clients.
   `seatId` and `watchSessionId` should be introduced the same way.
2. **`seq` / `isSupersededPresence`.** The same reasoning ("`created_at` has one-second
   resolution and relays reorder") applies verbatim to playback commands. Reuse the *shape*
   (`rev` in the watch-session content) and the *comparison discipline*.
3. **NIP-40 + heartbeat** as the session lifetime mechanism, with the same "expire unless
   renewed" default so an abandoned session disappears by itself.
4. **Relay-level `t`-tag scoping.** Presence already proves single-letter `t` filtering works
   against the default relay; the watch session should be discoverable the same way.
5. **`subscribe()` with streaming + polling fallback** — pass it into the new hook rather than
   re-implementing.
6. **Location-change teardown** (`useIslandPresence.ts:857-914`) as the model for leaving a
   session.

### 6.3 What must stay independent

* **Do not put playback state in 31950.** Presence is republished on every mouse click by every
  player; it is per-session, expires in 35 s, and is deliberately lossy (`useNostrPublish`
  *swallows* 31950 publish errors, `useNostrPublish.ts:44-48`). Playback truth must not inherit
  any of that.
* **Do not make presence the source of truth for the session.** Presence may *reference* the
  session (`watchSessionId`) and the seat (`seatId`) — those are properties of the player.
  `mediaId`, `status`, `position`, `rev` are properties of the *session* and belong to the
  session event, authored by the host.
* **Do not reuse the per-session `d`.** The watch session outlives browser sessions and must be
  addressable by its own id.
* **Publish cadence must differ.** Presence heartbeats every 25 s regardless of activity;
  playback publishes on *control actions* plus a keepalive. Never per frame, never per tick.

---

## 7. Research: do existing Nostr standards fit?

Verified against `https://github.com/nostr-protocol/nips` (`README.md` kind table, `53.md`,
`78.md`) and the machine-readable `nostr-protocol/registry-of-kinds` `schema.yaml`
(4 410 lines), fetched during this audit.

### 7.1 NIP-53 — Live Streaming and Spaces

| Kind | What it is | Fit |
| --- | --- | --- |
| `30311` Live Event | addressable advertisement of a **live** stream: `streaming` (URL of the live broadcast), `recording` (URL where the edited video is placed *after* the activity), `starts`, `ends`, `status: planned\|live\|ended`, `current_participants`, `p` role tags, `pinned` | ❌ **No playback position, no play/pause/seek, no revision.** Its model is "a broadcast exists at this URL"; every viewer joins a stream that is inherently at the same point. Recorded-video co-watching is precisely the case it does not cover. |
| `30312` Interactive Room / `30313` Conference Event | a persistent room (`service` URL, `status: open\|private\|closed`, host/moderator/speaker `p` roles) and scheduled meetings inside it | ⚠️ Structurally the closest thing to "a theater with a host and guests", but the media is a *service endpoint* (a WebRTC/meeting provider), not a synchronized timeline. No position semantics. |
| `10312` Room Presence | **replaceable** (not addressable) presence in one room, `a` tag + `hand` | ❌ Replaceable means one room per pubkey and one device per pubkey. Blobbi Island already has richer per-session presence in 31950. Adopting 10312 would be a regression. |
| `1311` Live Chat Message | chat scoped to a 30311 activity | ⚠️ Reasonable *later* if theater chat should be session-scoped rather than room-scoped, but Blobbi already has 21201 chat with location scoping. |

**Conclusion:** NIP-53 genuinely does not fit. Bending 30311 into a watch party would mean
publishing a `streaming` URL that is not a stream, a `status` that does not describe playback,
and stuffing position/rev into undocumented tags — i.e. a custom kind wearing a standard kind's
number, which is worse for interoperability than an honest custom kind.

### 7.2 NIP-78 — Application-specific Data (kind 30078)

Explicitly for apps that "do not want or do not need interoperability"; `d` is any app-scoped
string; content and tags may be anything.

**Fit:** technically usable, and it would avoid minting a kind. Rejected as the primary carrier
because:

* 30078 is conventionally **per-user private-ish app storage** (settings, client state), not a
  multi-reader coordination channel. Guests subscribing to another user's 30078 is an abuse of
  the convention.
* A generic kind cannot be validated or reasoned about by relays or other clients; the schema
  lives nowhere.
* Blobbi Island has already chosen the opposite pattern for every multiplayer concern
  (31950, 21201 are purpose-specific, documented in `NIP.md`). Using 30078 here would be
  inconsistent with the codebase's own precedent.

### 7.3 NIP-40 — Expiration

Applies cleanly and is already used by both 31950 and 21201. Use it for the session event with
a window comparable to presence (see §8.5). Note the standard caveat: expiration is advisory —
relays *may* delete, clients *must* ignore expired events. Client-side filtering is required
regardless (`explainPresenceEvent` already does this, `multiplayer.ts:593-595`).

### 7.4 Ranges

Per NIP-01: `1000–9999` regular, `10000–19999` replaceable, `20000–29999` ephemeral,
`30000–39999` addressable. The relevant neighbourhood:

* Ephemeral assigned: `21000` (Lightning Pub RPC), `21001-21003` (CLINK), `21059`, `22242`,
  `23194-23197`, `23333` (Ephemeral Chat Room), `23903`, `24133`, `24242`, `25050-25055`
  (WebRTC calls), `27235`, `28934-28936`. Blobbi's `21201` is unassigned in both the NIPs table
  and the registry — consistent with how this project has picked kinds before.
* Addressable: dense but with wide gaps; `31950` (Blobbi presence) is unassigned upstream.

### 7.5 Any existing watch-party / media-control / collaborative-session proposal?

Searched the NIPs kind table, `registry-of-kinds/schema.yaml`, and the web for a watch-party or
synchronized-playback NIP.

* `schema.yaml` matches for `watch|party|playback|sync|seek|cinema|theater|theatre`: **zero**.
* Nearest neighbours are all one-way or non-timeline: `30311/30312/30313` (live), `21`/`22`/
  `34235`/`34236` (NIP-71 video *metadata*), `34139` Music Playlist, `31337` Audio Track,
  `30296-30298` Interactive Story (which does have a "Reading State" — interesting precedent for
  per-user progress, but not shared-clock synchronization), `25050-25055` WebRTC call signaling
  (per-peer, not room-canonical), `23333` Ephemeral Chat Room.
* Nothing in this repository's own kinds covers it either (`NIP.md`, `src/lib/blobbi-kinds.ts`).

**Verified conclusion: there is no established Nostr kind for synchronized playback of recorded
video.** A custom kind is required. Per `CLAUDE.md`, the number **must** be produced with
`nostr__generate_kind` at implementation time — this audit deliberately does **not** pick one,
and no number should be hardcoded before that tool has been run. Whatever it is, it must carry a
NIP-31 `alt` tag and be documented in `NIP.md`.

---

## 8. Proposed watch-session event architecture

### 8.1 Architecture A — addressable session event only (**recommended**)

One addressable event per watch session, authored by the host, republished on every control
action, carrying the canonical playback state and a monotonic revision.

```jsonc
{
  "kind": <generated addressable kind>,
  "content": "{\"mediaProvider\":\"youtube\",\"mediaId\":\"<11-char id>\",\"status\":\"playing\",\"positionSec\":412.5,\"ts\":1753564800,\"rev\":17,\"rate\":1}",
  "tags": [
    ["d", "watch:<uuid>"],                       // session id
    ["t", "blobbi:watch"],                       // global index
    ["t", "island:1"],                           // island scope
    ["t", "loc:stage"],                          // room scope (relay-level filter)
    ["t", "watch-code:<CODE>"],                  // invite code, relay-queryable
    ["title", "<catalog title>"],                // display only; clients prefer their catalog
    ["status", "open"],                          // open | closed
    ["capacity", "12"],
    ["p", "<hostPubkey>", "", "Host"],           // playback authority (= event author in v1)
    ["expiration", "<unix seconds>"],            // NIP-40
    ["alt", "Blobbi Island watch session"],      // NIP-31
    ["client", "blobbi"]
  ]
}
```

Structured playback state lives in `content` because none of it is queryable and all of it
changes together; queryable metadata (`code`, `loc`, `island`, `status`) lives in tags. This
follows the project's own content/tag guidance in `CLAUDE.md` and matches how 31950 splits
scope-tags from JSON content.

**Properties**
* One event per session ⇒ addressable last-write-wins gives dedupe and replacement for free.
* Relay reordering and duplicate delivery are handled by `rev` alone (§9.6).
* A late joiner needs **one query** to be fully synchronized — no request/response round trip.
* Host disconnect ⇒ no republish ⇒ NIP-40 expiry ⇒ the session disappears. Same mental model as
  presence.
* Every state transition is signed by the host; the relay verifies signatures, so
  "unauthorized command" reduces to "is `event.pubkey === session.host`".

**Costs**
* One relay write per control action. A host scrubbing a slider could publish dozens — needs
  debouncing plus a rate limit (§12).
* No transport for guest→host messages (resync request, "I'm buffering"). Not needed in the MVP:
  guests read the addressable event, and a guest that needs to resync just re-reads it.

### 8.2 Architecture B — addressable definition + ephemeral commands

The split described in the brief: an addressable session definition (identity, host, code,
capacity, media) plus ephemeral events for `play`, `pause`, `seek`, `media-change`,
`sync-request`, `sync-response`, `host-transfer`, `session-close`.

**Pros:** lighter writes for high-frequency commands; a natural channel for guest→host messages;
cleaner audit trail of actions.

**Cons that decide it:**
* **Two sources of truth.** A joiner must reconstruct current state from a definition plus an
  unbounded, possibly-missed command tail. Ephemeral events are explicitly not stored — a guest
  that joins between commands has no way to learn the current position without a
  `sync-request`/`sync-response` round trip, which is exactly the fragile path.
* It needs **two** kinds generated and documented instead of one.
* Every failure mode (missed command, reordered command, duplicate seek) must be solved in the
  command stream *and* reconciled with the definition. With Architecture A the same guarantees
  fall out of "addressable + rev".
* The claimed write saving is illusory in the MVP: with host-only control and debounced seeks,
  control actions are rare (a handful per video).

### 8.3 Architecture C (considered, rejected) — NIP-53 30311 with extra tags

Reuse `30311` with `status`, plus custom `position`/`rev` tags. Rejected in §7.1: it
misrepresents recorded playback as a live stream, produces meaningless `streaming` semantics for
other clients, and gains no real interoperability.

### 8.4 Recommendation

> **Superseded on 2026-07-27** by the two-kind decision in
> [`docs/protocol/shared-playback-session.md`](protocol/shared-playback-session.md) (`31951` +
> `21951`). The recommendation below is retained as the record of the narrower MVP that was
> considered; the *Decision change* note at the top of this document explains why the wider
> product scope changed the answer, and how the correctness model was preserved.

> **Architecture A for the MVP.** One generated addressable kind. Every action (play, pause,
> seek, media change, close) is a republish of the same event with `rev + 1`. No ephemeral
> command events in v1.
>
> Add **one** ephemeral kind later, and only when a concrete need appears — realistically
> `sync-request` (guest asks the host to republish) once sessions get long enough that a guest
> can outlive the relay's copy, or a "host presence ping" if expiry proves too coarse. Design
> the content schema now so that adding it is additive.

Answering the brief's question directly: **no, not every action needs an ephemeral event.** The
addressable event with a monotonic revision is sufficient for the MVP, and it is *strictly
simpler to make correct*.

### 8.5 Lifecycle

| Phase | Mechanism |
| --- | --- |
| Create | Host publishes `rev: 1`, `status: open`, `mediaId` from the catalog, `positionSec: 0`, `status(playback): paused`, invite code tag, `expiration = now + SESSION_TTL`. |
| Join | Guest queries by `#t: ['watch-code:<CODE>']` (+ `island`/`loc`), validates (§9.6), subscribes to the session address, applies canonical state. |
| Control | Host republishes with `rev + 1` and a fresh `expiration`. |
| Keepalive | Host republishes unchanged state every ~20 s (below a 35 s TTL) — mirrors the presence heartbeat and doubles as a "host is alive" signal. |
| Guest leaves | Local only: unsubscribe, `destroy()` the player, drop `watchSessionId` from presence. No session write (guests are not authors). |
| Host leaves cleanly | Republish `status: closed` with a short `expiration`; guests show "the host ended the session". |
| Host disappears | No keepalive → guests notice a stale `ts` (> ~40 s) → show "host disconnected", stop correcting drift, keep playing locally. Relay expiry removes the event. |
| Expiration | NIP-40, `SESSION_TTL ≈ 35 s` rolling (same constant family as `EXP_SECONDS`), so an abandoned session self-cleans. |

### 8.6 Edge cases and how the design absorbs them

| Edge case | Handling |
| --- | --- |
| Relay reordering | `rev` comparison; lower or equal `rev` is dropped (`isSupersededPresence` discipline). |
| Duplicate delivery | Same `rev` ⇒ dropped. Addressable replacement means the relay stores one copy anyway. |
| Delayed events | Same as reordering. Additionally, a `ts` older than ~40 s is treated as "host may be gone" rather than as a correction. |
| Reconnecting | Re-query the session address, apply the newest state. Idempotent by construction. |
| Joining midway | Compute expected position from `positionSec + (now − ts) × rate`, `cueVideoById`, `seekTo`, then play muted. |
| Multiple devices for the same pubkey | Fine for guests. For a **host**, two devices publishing the same address is a last-write-wins fight. Mitigation: `rev` is stored in the session event, so each device reads-then-increments; additionally include a `hostSession` (the browser session uuid) in content and have a host device stand down if it sees a *higher* `rev` from a different `hostSession`. Simple and sufficient. |
| Host disconnect | §8.5. |
| Simultaneous controls | Impossible in v1 — only the host is authorized, and a single host device wins by `rev`. |
| Clock drift | §9.4. |
| Buffering | §9.5. |
| Autoplay restrictions | Join muted + "Tap to watch" fallback (§5.7). |
| Malicious / unauthorized commands | Reject any event whose `pubkey ≠ session host`. Reject `mediaId` not in the local catalog. Reject non-monotonic `rev`. Clamp `positionSec` to `[0, duration]`. |

---

## 9. Playback synchronization model

### 9.1 Canonical state

```ts
interface WatchPlaybackState {
  mediaProvider: 'youtube';
  mediaId: string;        // validated against the catalog
  status: 'playing' | 'paused';
  positionSec: number;    // position AT publication time
  ts: number;             // publisher's own unix seconds (NOT created_at — 1 s resolution + relay clocks)
  rev: number;            // monotonic per session, incremented at publish-intent time
  rate: number;           // 1 in the MVP
  controller: string;     // pubkey that produced this state
}
```

`ts` is carried in content for the same reason `PresenceContent.seq` exists: `created_at` has
one-second resolution and is not a reliable ordering or timing source.

### 9.2 Expected position

```
expectedPosition(state, nowSec) =
  state.status === 'paused'
    ? state.positionSec
    : clamp(state.positionSec + (nowSec - state.ts - skew) * state.rate, 0, duration)
```

`skew` is the estimated local-vs-host clock offset (§9.4).

### 9.3 Newly joined client

1. Query the session address; validate; take the highest `rev`.
2. `cueVideoById(mediaId)` and wait for `onReady`.
3. `target = expectedPosition(state, now)`; `seekTo(target, true)`.
4. If `status === 'playing'`: `mute()` then `playVideo()`, and show "🔊 Unmute". If `playVideo`
   is refused, show "Tap to watch".
5. If `status === 'paused'`: stay paused at `target`.
6. Start the passive resync loop.

### 9.4 Clock drift

Host and guest wall clocks can differ by seconds. Estimate the offset instead of trusting either:

```
sampleSkew = receivedAtLocalSec − state.ts
skew       = median(last N samples)     // N ≈ 5, clamped to ±30 s, reset on host change
```

Because every keepalive contributes a sample, `skew` converges within a couple of heartbeats and
is robust to a single delayed event. Network latency biases `sampleSkew` by the one-way delay
(sub-second on a relay), which is well inside the drift tolerance below.

### 9.5 Drift correction

| Drift `|actual − expected|` | Action |
| --- | --- |
| < **0.75 s** | **ignore** — inside seek granularity and human perception; correcting here causes visible stutter. |
| 0.75 s – **2.0 s** | ignore in the MVP; log. (A future refinement may nudge with `setPlaybackRate(1.02)` for a few seconds — deliberately postponed, since rate changes are themselves a desync source.) |
| > **2.0 s** | **hard `seekTo(expected, true)`**, at most once every 5 s per client. |

* **Passive resync cadence:** evaluate every **5 s** from a local `setInterval`, using the last
  known canonical state. **No network traffic** and **no per-frame work** — never publish or
  poll the position on an animation frame.
* **Buffering:** while `getPlayerState() === 3`, suspend correction entirely, and skip the next
  evaluation after returning to `1` (the player needs a moment to settle). A client stuck
  buffering for > 15 s shows "still loading…" instead of accumulating seek attempts.
* **Ended (`0`):** stop correcting; the host's next state change decides what happens.
* **Local pause by a guest** (they hit pause on the embed) is treated as opting out of sync until
  they press play again, at which point a hard seek re-joins them.

### 9.6 Rejecting stale and hostile commands

```ts
function acceptState(known: WatchPlaybackState | undefined, incoming: WatchPlaybackState, event: NostrEvent, session: SessionMeta): boolean {
  if (event.pubkey !== session.hostPubkey) return false;         // authority
  if (!isCatalogMediaId(incoming.mediaId)) return false;         // curated catalog only
  if (!Number.isFinite(incoming.rev)) return false;
  if (known && incoming.rev <= known.rev) return false;          // monotonic, same rule as presence seq
  if (incoming.rate !== 1) return false;                         // MVP
  return true;
}
```

**Deterministic ordering of same-second events** (`rev` equal or absent — only possible with a
buggy or foreign publisher): fall back to `created_at`, then to lexicographic comparison of
`event.id`. Event ids are collision-resistant hashes, so this is a total order that every client
computes identically — the same trick that makes the seat tie-break in §11 deterministic.

---

## 10. Session ownership and permissions

### 10.1 Recommendation: single host, host-only control

| Model | Complexity | Abuse surface | Verdict |
| --- | --- | --- | --- |
| **One host creates, only the host controls, guests follow, guests may leave, session auto-expires** | lowest | smallest (one authorized pubkey; authority = event author, verified by signature) | ✅ **MVP** |
| Everyone can control | needs conflict resolution on every action, and any guest can grief | high | ❌ |
| Host-approved co-hosts | needs a controller allow-list in the session event and per-event authority checks | medium | ⏭ later (the `p`-role tag shape is already reserved) |
| Democratic voting | needs a whole voting protocol and quorum semantics over an unreliable transport | high | ❌ |
| Transferable ownership | needs a handoff protocol and changes "authority = author" into "authority = a mutable field", which weakens the signature guarantee | medium | ⏭ later |

Host-only control also makes the sync algorithm *provably* single-writer, which is why it is
worth accepting the "host leaves and the party dies" limitation in v1 (the session simply
expires; someone else creates a new one).

The session event should already carry `["p", host, "", "Host"]` so that adding
`["p", other, "", "Controller"]` later is additive and the authority check becomes
"pubkey ∈ controllers" without a schema break.

### 10.2 Invitation code design

**Recommendation: generated locally, carried as an indexed tag, resolved by relay query.**

```
code = 6 chars from Crockford base32 minus ambiguous glyphs (no I, L, O, U, 0, 1)
     → 26 chars ** 6 ≈ 3.1e8 combinations
tag  = ["t", "watch-code:<CODE>"]      // single-letter tag ⇒ relay-indexed ⇒ #t queryable
```

Why not the alternatives:

* **Derived from the session id** (e.g. first 6 chars of the uuid) — no independent collision
  control, leaks nothing useful, and couples the human-facing string to an internal identifier
  that may need to change.
* **Purely local mapping table** — needs a server or a separate registry event; the relay query
  is already available and free.
* **Not queryable (stored in `content`)** — would force clients to fetch *all* sessions and
  filter locally. Single-letter `t` tags are the project's established, relay-indexed way to
  scope (`island:`, `loc:`, `blobbi:presence`).

**Collision handling:** before publishing, query
`{ kinds: [K], '#t': ['watch-code:<CODE>', 'island:<id>'] }`. If a **non-expired** event from a
different pubkey exists, regenerate (bounded retries, e.g. 5). On join, if a code resolves to
more than one live session, pick deterministically (highest `created_at`, then lowest `event.id`)
and show the host's name so the user can tell they joined the wrong one.

**Is the code secret?** **No, and it must not be treated as one.** It sits in a public tag on a
public relay and is enumerable. It is a *convenience for typing*, not access control. Real limits
come from: host-only playback control, `capacity`, and the fact that joining grants nothing
beyond watching a video that is already in a public curated catalog. If private sessions are
ever needed, that requires actual cryptography (NIP-44 encrypted content to invited pubkeys), not
a longer code.

---

## 11. Theater presence, seats and session membership

### 11.1 Four related but distinct states

| State | Owner | Representation |
| --- | --- | --- |
| **In the theater** | `LocationContext.currentLocation === 'stage'` | already published as `t=loc:stage` + `content.location` |
| **Seated in a specific seat** | `PlayingView` local state, mirrored to presence | proposed `PresenceContent.seatId?: string` |
| **Member of a watch session** | `PlayingView` local state, mirrored to presence | proposed `PresenceContent.watchSessionId?: string` |
| **Receiving synchronized playback** | local player + sync loop | not published at all |

Keeping them separate is what makes the UX forgiving: the room, the chair, the session and the
player each fail independently.

### 11.2 Recommended MVP behavior

| Question | Answer |
| --- | --- |
| Can someone stand in the theater and still watch? | **Yes.** The screen is a room feature. Anyone in `'stage'` with the session open sees synchronized playback. Sitting is cosmetic + social. |
| Must someone sit before joining? | **No.** Sitting is encouraged (it is the only way to *appear* seated to others), never required. |
| Can a seat be reserved? | **No.** Reservation needs a coordinator; Nostr gives none. Seats are claimed by occupation. |
| Two players pick the same seat? | Both claim optimistically; rendering resolves deterministically: **the lower hex pubkey keeps the seat**, the other is auto-stood-up to a floor point beside the seat and shown a "that seat was taken" nudge. Every client computes the same winner from the same presence data, so nobody sees a different arrangement. (This is the same deterministic-total-order trick as §9.6.) |
| Does leaving the theater leave the watch session? | **Yes.** Follows the `hiddenIn` precedent exactly: a location change clears `seatId` and `watchSessionId` (`useIslandPresence.ts:873-875` is the hook), destroys the player and unsubscribes. |
| Does closing the player leave the physical room? | **No.** Closing the player leaves the *session*; the Blobbi stays in the theater, and stays seated. |
| Should presence include `seatId` / `watchSessionId` / a general activity state? | **`seatId` and `watchSessionId` as separate optional fields.** Do not overload the existing `state: 'idle'\|'moving'\|'emote'` enum — it describes *motion*, is validated by `explainPresenceEvent`, and `'emote'` is already reserved in `NIP.md`. Two explicit optional fields match `hiddenIn` and stay backward compatible. |
| Which state is authoritative for rendering seat occupancy? | **Presence** (`seatId` on the newest presence per player, ordered by `seq`). It is already the thing that renders remote Blobbis, it already expires (35 s) and it already garbage-collects. The watch-session event must **not** carry an occupancy list — that would be a second, slower, conflicting truth. |

### 11.3 Rendering derivation

```
presence(player).seatId → theaterSeats[seatId]
  ├─ position  = seat anchor (NOT the published x/y — snap remotes onto the seat)
  ├─ facing    = seat.facing            → rear-view SVG (§3.5)
  ├─ scale     = seat.seatedScale       → inner wrapper only (§4.3)
  ├─ zIndex    = row band (unchanged)   → §1.7
  └─ shadow    = hidden, float animation = off
```

Snapping remotes to the seat anchor (rather than trusting the published coordinate) makes every
client draw seated Blobbis identically and removes sub-pixel jitter from interpolation — the same
reason `hiddenIn` exists rather than a coordinate comparison.

---

## 12. Privacy, moderation and abuse

| Risk | Severity with a curated catalog | First-release policy |
| --- | --- | --- |
| Arbitrary inappropriate YouTube links | **eliminated** | Only catalog ids accepted, enforced on **publish and on receive**. |
| Offensive titles / thumbnails | **eliminated** | Clients resolve title/thumbnail from their own catalog and ignore event-provided strings for known ids. |
| Embedding-disabled / region-blocked videos | low | Verified when curating; error states from §5.6 as a backstop. |
| Host rapidly changing videos ("media flipping") | low | Client-side rate limit on control publishes (min 3 s, mirroring `CHAT_RATE_LIMIT_MS`), and guests debounce media changes (ignore a change within 2 s of the previous one). |
| Misleading invitation codes | low | Show the host's display name + the video title on the join confirmation, before the player starts. |
| Session spam / relay spam | low | One live session per pubkey per island (enforced locally: reuse your own existing session instead of creating another). NIP-40 auto-cleanup. Capacity cap. |
| Replayed control events | **eliminated** | Monotonic `rev` rejection (§9.6). Replays are also signature-bound to the host. |
| Joining a session from an untrusted host | low | The host can only pick from the same public catalog; the worst they can do is pause/seek. |
| Public exposure of who is watching what | **inherent and unavoidable** | Document it. Presence *already* publishes location publicly; the session event publishes the video and the host. State plainly in the UI that watch sessions are public. Do **not** claim privacy that the transport cannot provide. |
| Guest griefing | n/a in v1 | Guests have no write path to the session. |

Deliberately **out of scope** for the first release: reporting, blocklists, per-user mute of
hosts, content ratings, catalog moderation workflow. The curated catalog is the moderation
system for v1 — that is the whole point of choosing it.

---

## 13. Implementation phases

Each phase is independently shippable and independently revertable. Phases 1–6 contain **no
Nostr work at all**; the feature is playable single-player before any protocol change.

### Phase 1 — Theater visual cleanup + central player mount

* **Goal.** A `<TheaterScreen>` region mounted in the transparent hole (16 : 9, 617 × 347 px,
  centered at x 19.8–78.8 %, y 6.7–56.9 %) rendering a placeholder. Curtain interaction fixed
  for touch or removed. Little door either given a behavior or documented as decoration.
* **Files.** `src/components/blobbi/InteractiveElements.tsx` (stage branch),
  new `src/components/blobbi/theater/TheaterScreen.tsx`, `src/lib/theater-layout.ts` (hole and
  player rects as named constants).
* **Tests.** Render the stage branch; assert the screen region exists with the expected
  rect; assert the curtain responds to `touchStart` (or that the mouse-only handler is gone).
* **Dependencies.** None.
* **Risks.** The screen must sit *behind* the curtain and *behind* the chairs but *in front of*
  the background; the curtain block currently has no z-index (§1.3), so introducing one z value
  can reorder the whole room. Verify all three rows and both curtains visually.
* **Done when.** The placeholder is visible in the hole on desktop and mobile, no existing
  element changed stacking order, `npm test` green.

### Phase 2 — Rear-facing Blobbi renderer state

* **Goal.** `facing="front" | "back"` on `CurrentBlobbiDisplay`, `view` in `loadBlobbiSvg`, new
  `applyRearView` transform.
* **Files.** `src/blobbi/ui/lib/svg/rear-view.ts` (new), `src/blobbi/ui/lib/svg/index.ts`,
  `src/lib/loadBlobbiSvg.ts`, `src/components/blobbi/CurrentBlobbiDisplay.tsx`,
  `src/components/blobbi/AccessoryOverlay.tsx` (+ `REAR_VIEW_HIDDEN_SLOTS`).
* **Tests.** **Table-driven over all 34 SVGs** (`ADULT_SVG_MAP` × {base, sleeping} + baby):
  rear view contains no `Pupils`/`Eyes (`/`Mouth`/`Nose`/blush block; still contains the body
  block and `<defs>`; is not empty; `uniquifySvgIds` still applied; `applyGazeMarkup` is a no-op
  on rear output. Plus a guard test that FROGGI keeps `Big circular pop-out eyes`.
* **Dependencies.** None (independent of Phase 1).
* **Risks.** Inconsistent comment naming (mixed Portuguese/English) — mitigated by the explicit
  token list plus the exhaustive test. Any future SVG that omits comment blocks would silently
  render a front face in rear view; the test is the tripwire.
* **Done when.** All 34 forms render a plausible back view in a dev harness; test table green.

### Phase 3 — Data-driven theater seats

* **Goal.** Replace the six flex rows with 26 explicitly-placed `<TheaterSeat>` components
  driven by `theaterSeats`, each with a stable id, preserving the current visual layout
  (measured centers in §1.8).
* **Files.** `src/lib/theater-seats-config.ts` (new),
  `src/components/blobbi/theater/TheaterSeat.tsx` (new), stage branch of
  `InteractiveElements.tsx`.
* **Tests.** Config invariants: ids unique, 26 claimable + 2 non-claimable, every claimable
  center within 2–98 %, `zIndex` matches the row, `seatedScale` descending by row. Render test:
  28 sprites present, each claimable one exposing `data-seat-id`.
* **Dependencies.** Phase 1 (same JSX region).
* **Risks.** Pixel drift when converting flex + `-space-x-4` into absolute placement. Mitigate
  by deriving `positionClass` from the measured table and comparing screenshots.
* **Done when.** The room looks unchanged, every seat has a unique id, `handleChairClick`'s
  `alt`-derived id path is no longer used in the theater.

### Phase 4 — Local single-player YouTube MVP

* **Goal.** Host-less local playback: pick a catalog video, play/pause/seek locally in the
  theater screen. No Nostr.
* **Files.** `src/lib/youtube-player.ts`, `src/hooks/useYouTubePlayer.ts`,
  `src/lib/theater-catalog.ts`, `TheaterScreen.tsx`, a small picker UI.
* **Tests.** Adapter unit tests against a fake `YT` global: script loaded once; `destroy()` on
  unmount; error codes 100/101/150 mapped to user-facing states; `videoId` validation rejects
  non-catalog ids.
* **Dependencies.** Phase 1.
* **Risks.** Autoplay/mobile restrictions (§5.7); leaked iframes keeping audio alive. Test
  explicitly: enter theater → play → back arrow → **silence**.
* **Done when.** A player can watch a catalog video alone, on desktop and iOS Safari, and
  leaving the room stops it.

### Phase 5 — Explicit local sitting and seat state

* **Goal.** Clicking a seat walks the Blobbi there and, **on confirmed arrival**, sets
  `sittingIn: seatId` in `PlayingView`; the Blobbi snaps to the anchor, renders rear-facing at
  `seatedScale`, loses its shadow and float; any movement stands it up.
* **Files.** `PlayingView.tsx`, `TheaterSeat.tsx`, `MovableBlobbi.tsx`, and **deletion** of the
  dead chair path (`_handleChairArrival`, `_handleChairLeave`, `_isSeated`, `_eyesClosed`, and
  `MovableBlobbi`'s unused `_isSeated` prop).
* **Tests.** Harness mirroring `MovableBlobbi.hiding.test.tsx`: arrival sets `sittingIn`; any
  `onMoveStart` clears it; a location change clears it; seated render has no shadow, no float,
  `facing="back"`, correct scale.
* **Dependencies.** Phases 2 + 3.
* **Risks.** Removing the dead path touches four other rooms' chairs — keep `handleChairClick`
  working for arcade/station/shop, or migrate them in the same commit with their own tests.
  Row-C seat anchors sit only 2.6 points inside the walk boundary (§1.6): verify arrival
  actually fires there, and widen the boundary to `y: [74, 98]` if it does not.
* **Done when.** Sitting is a real, explicit local state with a clean stand-up transition, and
  no dead chair code remains.

### Phase 6 — Remote seated rendering

* **Goal.** `seatId` published in presence; remote Blobbis render seated identically to local.
* **Files.** `src/lib/multiplayer.ts` (`PresenceContent.seatId`, `publishSit`, heartbeat
  preservation), `src/hooks/useIslandPresence.ts` (`sitAt` / `clearSit`, `PlayerRenderState.seatId`),
  `src/components/blobbi/MultiplayerLayer.tsx`, **new** `src/lib/blobbi-world-render.ts` (§4.4),
  `NIP.md` (document the new presence field), `docs/` update.
* **Tests.** `multiplayer.seating.test.ts` alongside `multiplayer.hiding.test.ts`: `seatId`
  survives heartbeats, is absent from `publishMove`, and is ordered by `seq`. Layer test: a
  remote with `seatId` renders at the seat anchor, rear-facing, at `seatedScale`, and two
  players claiming one seat resolve to the same winner on both clients.
* **Dependencies.** Phase 5.
* **Risks.** Local/remote divergence from the duplicated scale/z math — that is why the shared
  module is part of this phase, not a follow-up.
* **Done when.** Two browser profiles show each other seated in the same seats, identically.

### Phase 7 — Nostr watch-session definition

* **Goal.** The session event: create, read, validate, keepalive, close. Still no
  synchronization applied to the player.
* **Blocking prerequisite.** Run `nostr__generate_kind` to obtain the addressable kind number.
  **Do not hardcode a guess.**
* **Files.** `src/lib/watch-session.ts` (builders, validators, `rev` comparison — modeled on
  `multiplayer.ts`), `src/hooks/useWatchSession.ts`, `src/lib/blobbi-kinds.ts`, `NIP.md`.
* **Tests.** Builder/validator unit tests: required tags, NIP-31 `alt`, NIP-40 `expiration`,
  expired rejection, `rev` monotonicity, non-host author rejected, non-catalog `mediaId`
  rejected.
* **Dependencies.** Phase 4 (catalog), Phase 6 (presence plumbing patterns).
* **Risks.** Schema churn later. Mitigate by shipping `NIP.md` in the same commit and keeping
  every optional field genuinely optional.
* **Done when.** A host can create a session and a second client can fetch and validate it.

### Phase 8 — Invite-code joining

* **Goal.** Code generation with collision check, a share/copy affordance, a join-by-code dialog,
  and `watchSessionId` in presence.
* **Files.** `src/lib/watch-invite-code.ts`, `useWatchSession.ts`,
  `src/components/blobbi/theater/*` (host panel + join dialog), `multiplayer.ts` +
  `useIslandPresence.ts` (`watchSessionId`), `NIP.md`.
* **Tests.** Code alphabet excludes ambiguous glyphs; collision retry path; a code resolving to
  two sessions picks deterministically; joining sets `watchSessionId`; leaving the location
  clears it.
* **Dependencies.** Phase 7.
* **Risks.** Users mistyping codes — restrict the alphabet, uppercase on input, trim spaces.
* **Done when.** Two accounts end up in the same session via a 6-character code.

### Phase 9 — Host-authoritative synchronization

* **Goal.** Host control actions publish `rev + 1`; guests apply canonical state and follow.
* **Files.** `src/lib/watch-sync.ts` (`expectedPosition`, `acceptState`, drift decision — pure
  functions), `useWatchSession.ts`, `useYouTubePlayer.ts`, `TheaterScreen.tsx`.
* **Tests.** **Pure-function tests are the core of this phase**: `expectedPosition` across
  paused/playing/rate/clamping; `acceptState` for every rejection reason; the drift decision at
  0.5 / 1.0 / 3.0 s; stale-`rev` rejection; same-`created_at` tie-break by `event.id`.
* **Dependencies.** Phase 8.
* **Risks.** Publish storms from slider scrubbing (debounce + 3 s rate limit); guests fighting the
  host (guest actions are local-only opt-out, §9.5).
* **Done when.** Host play/pause/seek is reflected on a second client within a couple of seconds,
  with no publish traffic while simply watching (beyond the keepalive).

### Phase 10 — Reconnect and drift correction

* **Goal.** The 5 s passive resync loop, clock-skew estimation, buffering suspension, host-gone
  detection, mid-video joins.
* **Files.** `src/lib/watch-sync.ts`, `useWatchSession.ts`.
* **Tests.** Skew estimator converges and rejects an outlier; correction is suppressed while
  buffering; a stale `ts` produces "host disconnected" rather than a wild seek; a simulated
  mid-video join lands within tolerance.
* **Dependencies.** Phase 9.
* **Risks.** Correction loops (seek → buffer → drift → seek). Mitigate with the ≥ 5 s
  minimum between hard seeks and the post-buffer settle skip.
* **Done when.** Two clients stay within ~1 s over a 10-minute video, including a tab reload and
  a network blip.

### Phase 11 — Moderation and curated catalog hardening

* **Goal.** Catalog enforcement on both publish and receive; rate limits; capacity; a clear
  "watch sessions are public" notice; optional move of the catalog to a signed Nostr event.
* **Files.** `theater-catalog.ts`, `watch-session.ts`, `watch-sync.ts`, theater UI, `NIP.md`.
* **Tests.** Non-catalog id rejected on receive; control publishes rate-limited; capacity
  enforced; event-provided titles ignored for known ids.
* **Dependencies.** Phase 9.
* **Risks.** None significant; this phase mostly *removes* capability.
* **Done when.** No code path can play a non-catalog video, and the public nature of sessions is
  stated in the UI.

### Phase 12 — Later social features (explicitly deferred)

Co-hosts / controller allow-list, host transfer, an ephemeral `sync-request` kind, reactions and
session-scoped chat, arbitrary links behind moderation, playback-rate sync, fullscreen, captions
UI, seat reservations, a theater lobby listing public sessions.

---

## 14. Final recommendations

1. **Rear-facing Blobbi is feasible with the current rendering.** No new artwork. All 34 SVGs
   delimit their face parts with comment blocks, and the renderer already post-processes those
   exact blocks (`applyGazeMarkup`, the pupil-fill fallback).
2. **Renderer API:** `facing="front" | "back"` on `CurrentBlobbiDisplay`, `view: 'front' | 'rear'`
   in `loadBlobbiSvg`, implemented by a new `applyRearView(svg)` in
   `src/blobbi/ui/lib/svg/rear-view.ts` driven by an **explicit** face-token list (never a bare
   `/eyes/i`). Not external CSS, not 34 extra SVGs, not `scaleX(-1)`.
3. **Seated Blobbi scale:** **0.85** front row, **0.78** middle, **0.72** back — per seat, applied
   only while seated, multiplied into the **existing inner wrapper transform** so the chat-bubble
   anchor, the world position and the presence anchor are untouched. Hide the ground shadow and
   the float animation while seated.
4. **Theater seat architecture:** a data-driven `src/lib/theater-seats-config.ts` modeled on
   `town-bushes-config.ts`, with stable ids `theater-seat-a1 … theater-seat-c10`, 26 claimable
   seats (two of the current 28 are off-world), per-seat `interactionTarget`, `seatedScale`,
   fixed `zIndex`, and `facing: 'back'`. Occupancy is **not** in the table — it is derived from
   presence.
5. **Initial media provider:** YouTube via the **official IFrame Player API**, wrapped in a small
   internal adapter (`src/lib/youtube-player.ts` + `useYouTubePlayer`). No third-party wrapper, no
   scraping.
6. **Fixed catalog, not arbitrary links.** A curated, code-reviewed `theater-catalog.ts` of
   Blobbi-owned or manually approved embeddable videos. The wire format carries only the
   `videoId`; titles and thumbnails are resolved locally. This single decision removes most of
   §12. Arbitrary links are postponed and must not be the default when they arrive.
7. **No existing Nostr kind fits.** Verified: NIP-53 (30311/30312/30313/10312) models live
   streams and meeting rooms with no playback timeline; NIP-78 (30078) is per-user app storage;
   nothing in the NIPs index or `registry-of-kinds` mentions watch parties or playback
   synchronization.
8. **A custom kind is needed** — exactly **one** addressable kind for the MVP, generated with
   `nostr__generate_kind` (a blocking prerequisite of Phase 7), carrying a NIP-31 `alt` tag, a
   NIP-40 `expiration`, and documented in `NIP.md`. Do not commit a guessed number.
   **→ Superseded 2026-07-27:** the shipping decision is **two** experimental kinds, `31951`
   (addressable session) and `21951` (ephemeral command), both documented with a collision-research
   report in [`docs/protocol/shared-playback-session.md`](protocol/shared-playback-session.md) §1.
9. **Event lifecycle:** host publishes `rev 1` → republishes with `rev + 1` on every control
   action → keepalive every ~20 s against a ~35 s TTL → `status: closed` on a clean end →
   NIP-40 expiry on an unclean one. Guests never write to the session.
   **→ Amended 2026-07-27:** creation is `rev 0` (paused at 0), each action publishes a paired
   `21951` + `31951` at the same revision, the TTL is **4 h rolling** (not 35 s) with a 20 s
   keepalive, and the terminal status is `ended` (not `closed`). "Guests never write" is unchanged.
10. **Host permissions:** one host, host-only playback control, guests follow and may leave
    freely, session auto-expires. `["p", host, "", "Host"]` is in the schema from day one so
    co-hosts are additive later.
11. **Invitation code:** 6 characters of ambiguity-free Crockford base32, generated locally,
    published as an indexed `["t", "watch-code:<CODE>"]` tag, resolved by a relay `#t` query,
    collision-checked before publishing with bounded retries and a deterministic tie-break on
    join. **The code is not a secret** and must never be treated as access control.
12. **Synchronization algorithm:** canonical `{mediaId, status, positionSec, ts, rev, rate,
    controller}`; `expected = positionSec + (now − ts − skew) × rate` while playing; **ignore**
    drift < 0.75 s, **hard seek** > 2.0 s (at most one per 5 s), passive re-evaluation every 5 s
    with **zero** network traffic; median clock-skew estimate over the last 5 events; correction
    suspended while buffering; states rejected unless authored by the host with a strictly
    greater `rev`; same-second ties broken by `created_at` then `event.id`. **Never publish the
    position on an animation frame.**
13. **MVP scope:** transparent-hole player mount → rear-facing renderer state → data-driven seats
    → local catalog playback → explicit local sitting → remote seated rendering → session event →
    invite code → host-authoritative sync → drift correction → catalog hardening
    (Phases 1–11).
14. **Explicitly postponed:** arbitrary YouTube links; any moderation system beyond the catalog;
    ephemeral command events; co-hosts, host transfer and voting; playback-rate and caption
    synchronization; fullscreen; seat reservations; a public session lobby; remote accessory
    rendering (a pre-existing limitation, not this feature's problem); pattern/specialMark/
    manifestation rendering (not drawn by the SVG pipeline at all today).

### Prerequisites before Phase 7

* `nostr__generate_kind` must be run for the session kind (per `CLAUDE.md`).
* Two accounts / browser profiles are required to validate Phases 6, 8, 9 and 10 — presence,
  seat conflicts and playback synchronization cannot be tested single-client.

---

## Appendix A — file index

| File | Relevance |
| --- | --- |
| `src/components/blobbi/InteractiveElements.tsx` | theater markup (`:818-940`), chair system (`:87-421`), dead chair path (`:442-469`) |
| `src/components/blobbi/PlayingView.tsx` | room composition, chair callbacks (`:169-206`), `hiddenIn` ownership |
| `src/components/blobbi/MovableBlobbi.tsx` | local Blobbi, scale/z (`:242-295`), anchor vs. sprite split (`:598-657`) |
| `src/components/blobbi/MultiplayerLayer.tsx` | remote sprites (`:80-153`), subscribe (`:431-500`), chat (`:599-737`), remote render (`:1314-1463`) |
| `src/components/blobbi/CurrentBlobbiDisplay.tsx` | SVG composition entry point |
| `src/components/blobbi/AccessoryOverlay.tsx` | accessory sprites (local equipment only) |
| `src/components/blobbi/TownBush.tsx` | the pattern to copy for `TheaterSeat` |
| `src/components/blobbi/PlaceBackground.tsx` | background + `bg-black` for stage; `data-world-surface` |
| `src/components/shell/VirtualWorld.tsx` | fixed 1046 × 697 world |
| `src/hooks/useIslandPresence.ts` | presence lifecycle, rAF interpolation, GC |
| `src/hooks/usePendingInteraction.ts` | walk-to-interact |
| `src/lib/multiplayer.ts` | 31950 schema, `seq` ordering, publishers |
| `src/lib/location-boundaries.ts` | stage boundary (`:162-166`) |
| `src/lib/interactive-elements-config.ts` | stage z bands (`:53-60`) |
| `src/lib/location-scaling-config.ts` | **no stage entry** → scale 1 |
| `src/lib/location-blobbi-sizes.ts` | stage = `xl` |
| `src/lib/town-bushes-config.ts` | data-driven prop template |
| `src/lib/loadBlobbiSvg.ts`, `src/blobbi/**` | SVG pipeline, 34 art strings, customizers, `gaze.ts` |
| `src/lib/chat-config.ts`, `src/lib/blobbi-kinds.ts` | kind constants and limits |
| `NIP.md` | custom-kind documentation that must be updated |

## Appendix B — measured constants

```
world                 1046 × 697 px (WORLD_WIDTH × WORLD_HEIGHT)
background            stage-inside.png, 1037 × 691, palette PNG, tRNS index 0 transparent
screen hole           x 6.8 % … 92.7 %   y 6.7 % … 56.9 %   (890 × 347 px, 2.565 : 1)
16:9 player in hole   x 19.8 % … 78.8 %  y 6.7 % … 56.9 %   (617 × 347 px)
walk boundary         rectangle x [0,100] y [75,98]
chair sprite          128 × 123 source → 112 × 107.6 rendered (w-28)
row pitch             96 px = 9.18 %
row A  sprite top 84.6 %  seat y 87.6 %  z 30  Blobbi z 25  seats  8
row B  sprite top 79.6 %  seat y 82.7 %  z 20  Blobbi z 15  seats 10 (2 off-world)
row C  sprite top 74.6 %  seat y 77.6 %  z 10  Blobbi z  9  seats 10
centre aisle          x 40.1 % … 59.9 %
little door           x 45.4 % … 49.8 %, bottom 22.8 %
Blobbi sprite (xl)    112 px / 128 px (md:) — scale 1.0 in the theater today
presence              kind 31950, TTL 35 s, heartbeat 25 s
chat                  kind 21201, evict 10 s, rate limit 500 ms, max 120 chars
relay                 single, default wss://relay.ditto.pub
```
