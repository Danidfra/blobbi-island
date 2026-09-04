# Theater: local implementation

What exists in the code today for the Blobbi Island theater (`LocationId: 'stage'`), after
Phases 1–3 of the plan in
[`docs/protocol/shared-playback-session.md`](protocol/shared-playback-session.md) §19.

**This document covers the LOCAL half only**: seats, curtain, player, controls, which is
single-viewer and works with no relay at all. Shared watch sessions (kinds `31951`/`21951`,
invitation codes, host/guest authority) are now implemented on top of these seams and are
documented separately in
[`docs/theater-shared-watch-implementation.md`](theater-shared-watch-implementation.md).
The seams they attach to are called out below.

The one multiplayer thing that *is* implemented is **seating**: the existing island presence event
(kind `31950`) now carries which seat a player is sitting in, so everyone in the room sees everyone
else in their chair (§2, "Multiplayer seating"). It is rendering state only, advisory,
self-expiring, and authoritative over nothing.

---

## 1. Rear-facing Blobbi renderer

**Files**: `packages/blobbi-react/src/svg/rear-view.ts`,
`packages/blobbi-react/src/artwork/load-blobbi-svg.ts`,
`src/components/blobbi/CurrentBlobbiDisplay.tsx`,
`src/components/blobbi/lib/accessory-types.ts`,
`src/components/blobbi/AccessoryOverlay.tsx`.

### API

Two words for two levels, mirroring the existing `isSleeping` → sleeping-artwork split:

```ts
// asset level: which drawing to produce
loadBlobbiSvg(stage, adultType, base, secondary, eye, isSleeping, instanceId, view?: 'front' | 'rear')

// component level: which way the character is turned
<CurrentBlobbiDisplay facing="front" | "back" />
<AccessoryOverlay      facing="front" | "back" />
```

`facing` is the only input. A rear-facing Blobbi is *derived*, not authored and not mirrored.

### How it works

There is no rear artwork, and none is needed. All 34 drawings (16 adult forms × {base,
sleeping} + baby × 2) delimit their parts with HTML comments, and the renderer already treats
those comments as an API, `applyGazeMarkup` finds the pupils that way, and the eye-colour
customizer scopes its fill replacement to the same block.

`applyRearView(svg)` deletes the *face* blocks and keeps everything else:

| Removed | Kept |
| --- | --- |
| eyes (awake + all sleeping variants), pupils, mouths, nose / beak / whiskers / nostrils, blush and cheeks | body, silhouette, gradients, `<defs>`, ears, tails, limbs, wings, petals, leaves, pots, particles, outlines, the sleeping `Zzz` |

Two rules keep it safe:

1. **An explicit token list, never a pattern.** `REAR_VIEW_REMOVED_BLOCKS` matches whole,
   trimmed comment labels. A bare `/eyes/i` would strip froggi's `Big circular pop-out eyes`
   (body bulges that define its silhouette) and delete `Eye gradient` / `Pupil gradient` /
   `Mouth gradient` out of `<defs>`. `REAR_VIEW_KEPT_BLOCKS` documents the near misses.
2. **A structural guard.** A block is spliced out only if the markup it spans is tag-balanced,
   so a deletion can never orphan a `</g>`. `rear-view.test.ts` asserts every face block in
   every shipped drawing passes that check, so the guard is a tripwire for future artwork rather
   than a silent fallback.

Gaze is skipped outright when `facing="back"` (there are no pupils in the markup to move), and
`applyGazeMarkup` is asserted to be a no-op on rear output.

### Accessories

`REAR_VIEW_HIDDEN_SLOTS` (in `accessory-types.ts`) hides `eyewear`, `face-mark` and `handheld`.
`headwear`, `back`, `neckwear`, `aura` and `color-overlay` are kept.

> **`handheld` is HIDDEN, not repositioned.** Accessory sprites are placed by a single
> percent/scale/rotation triple authored against the FRONT drawing, and there is no rear-specific
> placement anywhere in `AccessoryOverlay`. A held item drawn at its front offsets would float in
> front of a Blobbi that is facing away, so the slot is dropped entirely. This is a loss: a seated
> Blobbi does not carry what it was carrying. Fixing it needs per-accessory rear offsets (or rear
> art), which is a separate piece of work. **Do not describe the rear view as "preserving all
> accessories": it does not.**

> Pre-existing limitation, unchanged: `AccessoryOverlay` reads the *local* user's equipment and
> has no override, which is why remote sprites pass `showAccessories={false}`. Remote accessories
> are out of scope for the theater work.

### Visual review: what it actually looks like

Reviewed by rendering front and rear side by side for all 17 forms × {base, sleeping} and looking
at them. **The transform does exactly what it says: it is the front drawing with the face erased.**
Whether that reads as a *back view* depends entirely on how much the silhouette asserts a front:

| | Forms | Reads as |
| --- | --- | --- |
| Silhouette is front/back symmetric | bloomi, breezy, cacti, cloudi, crysti, droppi, flammi, leafy, mushie, rocky, rosey, starri | A Blobbi seen from behind. Convincing. |
| Silhouette is neutral but featureless | baby | A blank egg. Not wrong, not expressive. |
| Silhouette asserts a front | catti, owli, froggi, pandi | **A front-facing Blobbi with its face erased.** |

Specifically, in the four forms in the last row:

* **catti**: the ears keep their *inner*-ear fill and the tail curls forward across the body. From
  behind you would see the backs of the ears and the tail behind or to the side.
* **owli**: the round facial disc shading and the forward-pointing ear tufts survive; only the beak
  is removed, leaving a plain front-facing face.
* **froggi**: the pop-out eye bulges are kept deliberately (they are body, not face; see the token
  list) but with the eyes and pupils gone they read as two blank eyeballs. Frog eyes do protrude
  visibly from behind, so this one is borderline rather than wrong.
* **pandi**: the eye patches ARE removed correctly; what remains (white body, black ear and limb
  dots) happens to resemble a panda's back reasonably well.

No rendering *bug* was found: no face block survives, nothing is orphaned, no stray face geometry
leaks through (`Enhanced nostrils` on the sleeping froggi was checked specifically and is removed).
The limitation is artistic, not structural, and **34 new rear drawings were deliberately NOT
created** in this correction pass.

### Tests

`packages/blobbi-react/src/svg/rear-view.test.ts`: table-driven over all 34 drawings (319 assertions):
no face block survives, every non-face block does, `<defs>` survives, output is balanced, the
transform is idempotent, gaze is a no-op, and the front view is untouched.

---

## 2. Theater seating

**Files**: `src/lib/theater-seats-config.ts`, `src/components/blobbi/theater/TheaterSeat.tsx`,
`src/lib/blobbi-world-render.ts`, the stage branch of
`src/components/blobbi/InteractiveElements.tsx`, `src/components/blobbi/PlayingView.tsx`,
`src/components/blobbi/MovableBlobbi.tsx`.

### What replaced what

The old room rendered six flex containers of identical
`<InteractiveElement alt="Stage Chair">` clones. Because `data-chair-id` was derived from the
`alt` text, all 28 chairs collapsed to `stage-chair`, and the arrival handler
(`_handleChairArrival`) was never called by anything, so `isSeated` was permanently `false`
everywhere in the app. Clicking a chair walked the Blobbi to a point and did nothing else.

All of that dead path is now gone: `_handleChairArrival`, `_handleChairLeave`, `_isSeated`,
`_eyesClosed`, `seatedChairId`, the `onChairArrival` / `onChairLeave` props, and the
`sleepOnSeat` / `sitZIndexOffset` chair-config fields that only that handler read.
`handleChairClick` remains for the arcade / Nostr Station / shop chairs, which have never had a
seated state, reduced to the `seatAnchor` it actually uses.

### Configuration

`theaterSeats` describes **28 chair sprites: 26 occupiable seats plus 2 decorative chairs**,
derived from the original containers' offsets, so the room looks unchanged. Both numbers are real;
the field that separates them is `occupiable: boolean`, and `occupiableTheaterSeats` /
`decorativeTheaterSeats` / `THEATER_OCCUPIABLE_SEAT_COUNT` (26) / `THEATER_DECORATIVE_CHAIR_COUNT`
(2) are exported so no caller has to re-derive it:

| Row | Seats | Sprite top | Seat line | Chair z | Seated scale |
| --- | --- | --- | --- | --- | --- |
| A (front) | 8 | 84.6 % | 87.6 % | 30 | 0.85 |
| B (middle) | 10 (8 occupiable + 2 decorative) | 79.6 % | 82.7 % | 20 | 0.78 |
| C (back) | 10 | 74.6 % | 77.6 % | 10 | 0.72 |

* **Stable ids**: `theater-seat-a1 … theater-seat-c10`, numbered left to right across the whole
  row. This is the id local state keys on and the id presence will carry.
* **26 occupiable, 2 decorative.** Row B's outermost chairs sit at x ≈ −0.6 % and ≈ 100.7 %, off
  the edges of the world and never reachable. They still render (removing them would visibly change
  the room) but they are `occupiable: false`, which means: no `data-seat-id`, no cursor, no click or
  touch handler, `pointer-events-none` so they cannot even swallow a world click, exclusion from
  `occupiableTheaterSeats`, and `resolveSeatedRender()` returning `null` for their ids so a stale or
  hostile id can never pin a Blobbi to one. Each of those is asserted by a test.
* **Placement is inline percentages, not Tailwind classes.** 28 seats of arbitrary-value classes
  would have to be written as string literals for Tailwind's scanner, and an arithmetic mistake
  would be invisible. The percentages are checked against the measured layout by tests.
* **Occupancy is not in the table.** It is runtime state, never configuration.
* **`zIndex` is constant.** Sitting never reorders the room, the `TownBush` rule.

### Sitting

```
click seat ─► requestInteraction({ target: cushion point, action })   (the shared walk-to-interact)
                                   │
                       Blobbi walks; nothing has happened yet
                                   │
                          CONFIRMED ARRIVAL
                                   ▼
          TheaterSeat.onSit(seatId) ─► PlayingView.sittingIn = seatId
                                       blobbiRef.goTo(seatAnchorPosition(seat), immediate)
```

**Verified in a real browser**, not only in jsdom: clicking a chair produces no seated state at all
until the walk finishes, and on arrival `sittingIn` is set, the Blobbi snaps to the configured seat
anchor (measured: seat `theater-seat-a4`, anchor `32.887 % / 87.647 %`, matching
`seatAnchorPosition()` exactly), renders rear-facing (no `Eyes`/`Pupils`/`Mouth` blocks in the
mounted SVG) and the theater UI appears. The arrival callback was **already working**; what was
broken was everything downstream of it.

`sittingIn` in `PlayingView` is the single source of truth, exactly like `hiddenIn`:

* set on confirmed arrival, never on click;
* cleared by `handleMoveStart`: so a ground click, a walk to another seat, or any other
  interaction stands the Blobbi up cleanly before the new arrival fires;
* cleared on location change, leaving the theater always resets the seated state.

There are no timers, no polling and no coordinate guessing.

The snap target comes from `seatAnchorPosition(seat)`: computed from configuration, not from
the rendered rect: so the Blobbi lands on exactly the point every other client will later draw
it at. Every claimable seat anchor is asserted to sit inside the theater's walk boundary
(`y: [75, 98]`), which is what makes arrival fire at all for row C (77.6 %, only 2.6 points
inside).

### Seated rendering

`MovableBlobbi` takes one seating input, `seatedIn?: string | null`, and derives everything from
it through `resolveSeatedRender(seatId)`:

| | |
| --- | --- |
| position | pinned to the seat anchor |
| facing | `back` → the rear-view SVG |
| scale | the row's `seatedScale`, multiplied into the **inner sprite wrapper only** |
| ground shadow | hidden; it is sitting on a chair, not standing on the floor |
| float animation | off, a bobbing seated Blobbi fights the chair |
| z-index | unchanged; the row bands already interleave correctly |

The scale never touches the outer positioned element: that is the chat-bubble portal anchor and
the logical world position. Scaling it would move every bubble.

An unknown or non-claimable seat id resolves to `null`, so a stale id can never pin a Blobbi to
an off-world chair.

### Local/remote parity

`src/lib/blobbi-world-render.ts` now owns `resolveBlobbiScale`, `resolveBlobbiZIndex` and
`resolveSeatedRender`. `MovableBlobbi` and `MultiplayerLayer` had private, identical copies of
the first two (~50 lines each); a change made in one and forgotten in the other renders the
local player differently from how everyone else sees them. Both now call the shared module.
Multiplayer seating uses `resolveSeatedRender` unchanged; see below.

### Multiplayer seating (remote players)

**Files**: `src/lib/multiplayer.ts`, `src/hooks/useIslandPresence.ts`,
`src/lib/theater-occupancy.ts`, `src/components/blobbi/MultiplayerLayer.tsx`,
`src/components/blobbi/PlayingView.tsx`, `src/components/blobbi/InteractiveElements.tsx`,
`src/components/blobbi/theater/TheaterSeat.tsx`, `NIP.md`.

This is **rendering and presence only**. No `31951`, no `21951`, no shared media state, no
invitation codes, no host/guest authority, no session discovery. A seated Blobbi still does not
know that sessions exist.

#### The presence field

Kind 31950 content gains one optional, additive string, following the `hiddenIn` precedent and
matching the shape reserved in the protocol document (§14.2):

```jsonc
{ "state": "idle", "location": "stage", "anchor": { … }, "seq": 42, "seatId": "theater-seat-a4" }
```

`state` is untouched: it describes MOTION, so a seated player is `idle`. The value is always a
canonical *occupiable* seat id; decorative chairs cannot be clicked, walked to or made
`sittingIn`, so they can never be published.

Why an explicit field rather than reading coordinates: three seat rows overlap, chairs are 96 px
apart, and the published `anchor` is the *walk-to cushion point*, not the *render anchor*. A
client that guessed from position would put Blobbis near chairs instead of in them. This is the
same reason `hiddenIn` exists.

#### Lifecycle

| moment | what happens |
| --- | --- |
| seat clicked | walk starts; `sittingIn` is still null; **nothing is published** |
| CONFIRMED ARRIVAL | `PlayingView.sittingIn = seatId` → `MultiplayerLayer` publishes `publishSit` (idle presence + `seatId`) |
| heartbeat (25 s) | `seatId` preserved, a whole film without moving must not eject you |
| any movement starts | `moveTo` clears the seat **synchronously, before publishing**, and the `moving` presence carries no `seatId`: that *is* the stand-up |
| location change | `PlayingView` clears `sittingIn`; `useIslandPresence` independently clears its own copy |
| active Blobbi swapped in place | the identity republish carries no `seatId`, so the seat is **re-asserted immediately afterwards** with a higher `seq`: swapping your Blobbi does not get you out of your chair |
| disconnect | nothing published; the whole presence event expires via NIP-40 |

`sitAt()` validates the id against the canonical registry **before publishing**, so a decorative or
unknown seat can never reach the wire even if a future caller invokes the hook incorrectly, the
guarantee `NIP.md` makes about `seatId` is enforced, not just documented. Refusal is permanent and
is never retried.

If the arrival publish itself fails (relay hiccup), it is retried a small, bounded number of times
about a second apart, because the heartbeat backstop is up to 25 s away and until then nobody would
see the player sit down. `clearSit()` publishes nothing: it is bookkeeping that stops later
heartbeats advertising a seat the player already left, and every path above already nulls that state
itself. There is deliberately no dedicated stand-up event.

Two guarantees fall out of this. First, no observer can ever see the contradictory "seated in A4
while walking across the room" state, because the clear precedes the publish. Second, standing up
needs no dedicated event, so there is no stand-up message to lose or reorder, and `seq` (already
present) orders a sit against a same-second move regardless of relay delivery order.

`MultiplayerLayer` publishes strictly on **transitions** of the `sittingIn` prop
(`syncedSeatIdRef`), so re-renders and re-arrivals in the same seat cannot duplicate events.

#### Remote rendering

For a remote player whose presence carries a usable `seatId`, `MultiplayerLayer` resolves the
pose through **the same `resolveSeatedRender(seatId)` the local Blobbi uses**: one resolver, so
there is no second interpretation of theater geometry to drift. The remote Blobbi is drawn:

* snapped to `seatAnchorPosition(seat)`, **ignoring the published coordinates**;
* rear-facing (`facing="back"`), whose markup contains no face elements at all;
* at the row's `seatedScale`, on the inner sprite wrapper only; never the positioned anchor,
  which chat bubbles portal into;
* with no ground shadow and no float animation;
* with depth and perspective scale read from the seat anchor, so it stacks exactly as the local
  seated Blobbi does.

There is **one element per player**: the seated pose replaces the floating renderer rather than
being drawn beside it, so a seated remote can never appear twice.

An id that is unknown, stale, decorative, non-string or lost to another claimant resolves to
`null` and the player falls back to normal presence-position rendering. Nothing crashes and
nothing snaps to an arbitrary chair. In development (`blobbiDebug`) an ignored claim logs why.

#### Visual occupancy and the duplicate policy

`src/lib/theater-occupancy.ts` is a pure module deriving which seats *look* taken, from live
remote presence plus the local `sittingIn`. `MultiplayerLayer` computes it and lifts it to
`PlayingView`, which passes it to the seats, so the room has one answer instead of two
components guessing separately. A taken seat reports `data-seat-occupied` and loses its
hover-to-sit affordance.

It is **visual occupancy only**: it reserves nothing, gates nothing and is never written back to
a relay. A remotely occupied seat therefore stays clickable, presence is advisory and
self-expiring, and refusing the click would let someone who closed their laptop lock a chair for
the whole expiry window.

Nothing prevents two players walking into the same chair, so the duplicate policy is explicit and
deterministic:

1. **The local player always keeps their own seat on their own screen.** A stranger's claim must
   never stand you up, spin your Blobbi around or tear down your control card. Remote claims on
   the local seat are dropped.
2. **Among the remaining remote claimants, the lowest hex pubkey wins**, ties broken by session
   id. Lexicographic order over a hex string is total and identical on every client, so no
   negotiation is needed.
3. **Losers fall back to normal presence-position rendering**: still in the room, still walking
   around, just not drawn in that chair.

Stated plainly: if A and B both sit in seat X, A sees itself seated and B standing, B sees itself
seated and A standing, and every third party sees exactly one seated Blobbi (the lower pubkey).
**No client ever draws two seated Blobbis in one chair.** The asymmetry between the two
conflicting players is the deliberate price of rule 1.

#### Stale presence

There is no expiry logic in the occupancy layer at all. Claims are read from the live presence
map, which is already self-cleaning: NIP-40 expiration (35 s) plus `useIslandPresence`'s
per-second sweep of anything older than `EXP_SECONDS + 5`. A player who closes their tab stops
publishing, ages out of `players`, and their seat is released by that alone; no second timer to
maintain, and no way for occupancy and presence to disagree about who is still in the room.

Because that behaviour is *entirely* borrowed, it is pinned from both ends rather than assumed:
`multiplayer.seating.test.ts` asserts the sit event actually carries a future `expiration` tag and
that `validatePresenceEvent` rejects it once that time passes, and the layer test drives the real
presence GC: seat still held at 30 s, released at 45 s, instead of deleting a claim by hand.

#### The boundary this stops at

Presence answers **"who is visibly sitting where, and which shared activity are they in"**: and
nothing else. It is advisory, self-expiring and per-client, and the `activity` field carries a
session ADDRESS STRING with no playback state in it. Authoritative shared state, who is hosting,
what is playing, where the playhead is, belongs to the session event (kind `31951`). The two meet
only in the theater UI, by id, never by shared state
(`docs/protocol/shared-playback-session.md` §14.1, §14.3).

### Tests

* `src/lib/theater-seats-config.test.ts`: 28 seats, unique ids, centres matching the measured
  layout, 26 claimable, z per row, scale descending, anchors on the measured seat lines and
  inside the walk boundary.
* `src/components/blobbi/theater/TheaterSeat.test.tsx`: arrival-gated sitting, cancellation,
  re-entry, fixed z-index, touch parity, inert off-world seats.
* `src/components/blobbi/MovableBlobbi.seating.test.tsx`: rear facing, per-row scale on the
  sprite wrapper only, no shadow, no float, stand-up on movement, off-world id rejected.
* `src/components/blobbi/InteractiveElements.stage.test.tsx`: room structure and stacking order.
* `src/lib/multiplayer.seating.test.ts`: `seatId` published on a sit, absent from every move,
  preserved across heartbeats, independent of `hiddenIn`, `seq`-stamped, idempotent on re-sit,
  valid with and without the field; and `parseSeatId` accepting only non-empty strings.
* `src/lib/theater-occupancy.test.ts`: the duplicate policy in full: order-independent lowest-
  pubkey winner, at most one winner per seat, session-id tiebreak, the local player's exemption,
  decorative/unknown/empty ids refused, junk claims unable to displace valid ones, release on
  claim removal.
* `src/components/blobbi/MultiplayerLayer.seating.test.tsx`: real presence events through the
  subscription: canonical-anchor snap despite contradictory coordinates, rear-facing renderer,
  per-row seated scale, no shadow/float, exactly one sprite (no floating copy), stand-up on a
  `moving` presence, stale re-delivery ignored, decorative/unknown/non-string claims falling back,
  duplicate claims resolving, occupancy reported to the seats, seat released by presence GC, and
  the publish lifecycle (nothing before arrival, once on arrival, no republish, cleared by
  movement and by a location change).

---

## 3. The screen and the player

**Files**: `src/lib/theater-layout.ts`, `src/lib/theater-state.ts`, `src/lib/youtube-url.ts`,
`src/lib/youtube-player.ts`, `src/hooks/useTheaterPlayback.ts`,
`src/components/blobbi/theater/{TheaterStage,TheaterCurtain,TheaterControlCard,TheaterMediaInput,TheaterControls}.tsx`.

### The state machine

Everything the room shows is derived from one value (`src/lib/theater-state.ts`):

```
                    ┌──────────────┐
                    │  not-seated  │◄──────── stand / leave, from anywhere
                    └──────┬───────┘
                       sit │  (CONFIRMED arrival only)
                    ┌──────▼───────┐
          ┌────────►│ seated-idle  │  URL input, curtain CLOSED, NO player
          │         └──────┬───────┘
          │          submit│  (valid id only)
          │         ┌──────▼───────┐
  change- │         │ loading-video│  spinner, curtain STILL CLOSED
  video   │         └──┬────────┬──┘
          │    ready   │        │  error
          │         ┌──▼─────┐ ┌▼─────────────┐
          ├─────────┤ video- │ │ video-error  │  honest copy + input,
          │         │ ready  │ │              │  curtain CLOSED
          │         └────────┘ └──────┬───────┘
          └───────────────────────────┘
```

Two invariants the room depends on:

* **The curtain rises on `video-ready` and on nothing else**: not on mount, not on hover, not
  because an iframe appeared. Once up, only an explicit user action (change video, stand up, leave)
  or a real playback failure lowers it.
* **A player exists only while `request` is set.** No seat → no player; no chosen video → no player.
  An idle theater cannot produce a player error, because it has no player.

`TheaterStage` takes exactly one input, `seatId`, threaded down from `PlayingView.sittingIn` through
`InteractiveElements`. It never infers seating from the DOM, from Blobbi coordinates or from a
global query.

### Where the screen is

No new artwork was created. `stage-inside.png` already contains a fully transparent rectangle in
its proscenium (x 6.8–92.7 %, y 6.7–56.9 %; 2.565 : 1). `theater-layout.ts` records that
rectangle and derives the 16 : 9 player fitted **by height** and centred inside it, fitting by
width would overflow the frame vertically and paint video over the painted proscenium.

Stacking: the screen carries `z-index: -1`, so it paints behind the curtain (which has no
z-index and therefore sits at the auto level), behind all three seat rows (10/20/30) and behind
the back arrow (20). It is still in front of the background artwork, because everything in the
room lives inside `[data-world-surface]`, which is itself `z-10` above the background image.
Nothing else in the room's stacking order changed.

The control card is separate and sits at z 40, above the curtain; it is UI, and a curtain painting
over the play button would be a bug. It is anchored at **y 60.5 %**, on the stage front wall, NOT
against the bottom of the video rectangle: the painted red curtain covers the proscenium down to
about y 60 %, so anything placed at the screen's lower edge (y ≈ 57 %) is drawn on top of scenery.
`THEATER_CONTROL_CARD_RECT` records that.

### Provider adapter

`youtube-player.ts` wraps the **official IFrame Player API** and nothing else; no scraping, no
unofficial endpoints, no third-party wrapper package.

* `loadYouTubeIframeApi()`: promise-memoised script injection. One script tag however many callers
  (React Strict Mode double-invokes every effect, so concurrent callers are the normal case, not an
  edge case); chains rather than clobbers an existing `window.onYouTubeIframeAPIReady`; **polls
  `window.YT` as well as waiting on the callback**, because that callback is one-shot and
  page-global and may already have fired before this module registered, a callback-only loader
  would then wait forever; times out at 15 s rather than hanging; clears its memo on failure so a
  retry genuinely retries.
* `createYouTubeAdapter()`: returns a `MediaPlayerAdapter`, the entire surface anything above is
  allowed to use. Sets `playsinline=1` (iOS would otherwise take over the screen and the world
  would vanish), `enablejsapi`, `rel=0`, `origin`, and
  `allow="autoplay; encrypted-media; fullscreen; picture-in-picture"` on the iframe.
* `mapYouTubeError()`: codes are kept distinct, **messages are not allowed to over-claim.** Only
  `2` (malformed id) and `5` (HTML5 player failure) name a cause, because only those are
  unambiguous. `100` means "removed OR private"; `101`/`150` are documented as embedding-disabled
  but are also what region and age restrictions come back as, so all of them, and the unknown
  default, get `AMBIGUOUS_PLAYBACK_MESSAGE`: *"This video is unavailable or cannot be played inside
  Blobbi Island. Try another YouTube video."* A wrong diagnosis sends the user off to fix the wrong
  thing.
* A video that never reaches PLAYING reports no error code at all, so a 10 s timeout infers a
  failure: also with the ambiguous copy, for the same reason.
* **A rejected video is not a failed player.** `createYouTubeAdapter` used to *reject* when YouTube
  reported an error before `onReady`, which is the normal course of events for a private or
  non-embeddable video. It now resolves with the (real) player object and lets the error travel as
  an error, and every adapter method is failure-tolerant so a never-ready player cannot crash the
  UI rendered over it.

### Playback controller

```
  TheaterControlCard / HostControls / GuestControls
             │  commands ▲ snapshots
             ▼           │
     TheaterPlaybackController            src/lib/theater-playback.ts
             │
             ▼
       MediaPlayerAdapter                 src/lib/youtube-player.ts
             │
             ▼
       YouTube IFrame API
```

**The UI never talks to YouTube.** It calls controller methods and renders a
`TheaterPlaybackSnapshot`. That is the single most important structural property here, because
shared playback will *wrap* this controller rather than replace it.

The controller splits its surface the way the protocol does:

| Global: becomes host-only and synchronized | Local, per-device, never synchronized |
| --- | --- |
| `setMedia` `play` `pause` `togglePlay` `seek` `skip` `restart` `setRate` | `setVolume` `setMuted` `setCaptionsEnabled` `requestFullscreen` |

And it already obeys the protocol's rules, so the shared layer is additive:

* **Absolute results only, never deltas.** `skip(+10)` resolves to a concrete target position in
  `resolveSkipTarget`; the string "+10" appears nowhere downstream. Deltas cannot be replayed,
  reordered or joined late.
* **One immutable command per action.** `resolvePlaybackCommand` computes
  `{ type, position, rate, updatedAt }` once; the same object is applied locally and is exactly
  what a paired `21951` + `31951` publication needs.
* **No-ops publish nothing.** Skipping back at 0, or setting the rate to the current rate,
  produces no command: publishing an identical state would burn a revision and cause guests a
  pointless corrective seek.
* **`onCommand(command, state)`** is the publication hook. Local playback ignores it.
* **Play/pause is intent, not a player readout.** A player that refuses to start while the
  intent is "playing" is the *autoplay-blocked* case, surfaced as a "Tap to watch" affordance,
  never fought.
* **The position poll never publishes.** A 250 ms local interval, not a rAF loop, the same
  discipline the 5 s shared drift check will follow.

`clampPosition`, `resolveSkipTarget`, `normalizeRate`, `applyCommand` and
`resolvePlaybackCommand` are pure and exported: the shared implementation reuses them rather
than reimplementing the arithmetic.

### Lifecycle

`useTheaterPlayback(request)` owns nothing but the lifetime: build the adapter **around a concrete
video id**, forward its events into the controller, poll the position, destroy everything when the
request goes away.

> **This is where the theater was broken.** The hook used to build a player at mount with
> `videoId: undefined`. `new YT.Player(el, { videoId: undefined })` builds an embed for no video at
> all, which the API answers with error 2 and no `onReady`: so construction always failed, the
> room permanently displayed *"Couldn't load the video player."* to anyone who walked in, and
> because construction failed `controller` was always `null`, so the Load Video button called
> `controller?.setMedia(...)` on nothing and did nothing, silently. Both symptoms had one cause.

A different video id builds a different player. The alternative, keeping the embed and re-cueing
it: buys nothing here, because every path that changes the video (Change video, standing up,
leaving) already passes through "no request", which tears the player down anyway.

**Destruction is not optional**: an orphaned YouTube iframe keeps playing audio in a room the
player has walked out of, so the cleanup is what makes "leave the theater" mean silence. Verified in
a real browser: clicking the floor while a video was ready left **zero** iframes in the document.

### Content Security Policy

`index.html` ships a strict CSP, and `script-src 'self'` blocked
`https://www.youtube.com/iframe_api` outright: a second, independent reason the player never
initialised. Two exact hosts were added, no wildcards:

```
script-src 'self' https://www.youtube.com https://s.ytimg.com;
frame-src  'self' https://www.youtube.com https://www.youtube-nocookie.com;
```

* `https://www.youtube.com`: `/iframe_api` itself plus the widget bundle it pulls from
  `/s/player/<hash>/www-widgetapi.vflset/www-widgetapi.js`.
* `https://s.ytimg.com`: the legacy host that same bundle is still served from for some clients.

`connect-src`, `img-src` and `media-src` were **not** touched: a cross-origin iframe runs under its
own policy, so the video's connections, images and media streams are governed by youtube.com's CSP,
not by this page's. `frame-src` was *tightened* rather than widened; it was `'self' https:`, which
permitted framing any HTTPS origin, and the theater embed is the only iframe in the app.

### Media input: open catalog

The host may load **any embeddable YouTube video** from:

* a watch URL (`youtube.com/watch?v=…`, incl. `m.`, `music.`, extra params)
* a `youtu.be` short link
* an `embed` / `shorts` / `live` / `youtube-nocookie` URL
* a bare 11-character video id
* with or without a scheme, with `?t=`/`?start=`/`#t=` honoured as a start offset

`parseYouTubeInput` extracts the id and rejects everything else *before* a player is constructed,
with a specific message per failure (`empty`, `not-a-youtube-link`, `no-video-id`,
`invalid-video-id`). Failures that can only be discovered by attempting the embed, private,
deleted, embedding disabled, region blocked, surface from the player as the errors above.

> **Deviation from the audit, on instruction.** `docs/theater-watch-session-audit.md` §5.8 and
> §12 recommended a *curated* catalog for the MVP, and leaned on it as the entire moderation
> story. The product decision is an open catalog, which the protocol document explicitly left
> open (§20.14). The consequence is that the audit's §12 risks, arbitrary content, offensive
> titles and thumbnails, region blocks, are **not** mitigated by curation and will need an
> answer before watch sessions are public. Nothing in the protocol depends on the choice: the
> wire format carries a `media.id`, whatever produced it.

### The curtain

There are two curtain layers. The **red** one is static painted scenery and is unchanged. The
**yellow** one is movable and follows application state through a CSS transition:

> **One exception, added with shared playback:** while a shared session is
> attached, standing up keeps the screen (and therefore the curtain): the film
> is still running for everyone else in the room. Only the control card, which
> lives on the chair, disappears. Local-only playback is unchanged: standing up
> stops it. See `docs/theater-shared-watch-implementation.md` §6.2.

| state | curtain |
| --- | --- |
| not seated (local-only) | closed |
| seated, nothing loaded | closed |
| loading | closed |
| video ready | **open**, and it stays open |
| video error | closed |
| change video / stood up / left | closed |

It used to slide on `mouseenter`, which was wrong three ways at once: it revealed the screen to
anyone brushing past with a mouse, it was permanently shut on touch devices (the parent passed an
explicit `isHovered`, which bypasses `InteractiveElement`'s own touch fallback), and it fell again
the moment the pointer left, mid-film. All hover and touch handling is gone; the whole block is
`pointer-events-none` so it cannot swallow the click that walks a Blobbi underneath it.

### UI

Not a modal. The player is a feature of the room: it sits inside the artwork, behind the
curtain and behind the seats, and Blobbis walk in front of the stage while it plays.

**One control card**, on the stage wall below the screen, holding BOTH halves of the interaction,
choosing what to watch and controlling it. Nothing essential is placed on the screen itself, because
the painted curtain covers part of it. The card exists only while the local Blobbi is seated, and
renders one of four things, chosen by the state machine and nothing else:

| state | card |
| --- | --- |
| `seated-idle` | "Paste a YouTube URL or video ID" + Load Video |
| `loading-video` | spinner + "Loading video…" + Change video; the input is *absent*, so a second submit cannot race |
| `video-ready` | title (when the embed offers one) + full playback controls |
| `video-error` | the honest sentence + the URL input again, ready for another try |

**Host view**: timeline (commits on drag *end*, never per pointer move), restart, −10,
play/pause, +10, playback speed, mute + volume, captions, fullscreen, and "Change video".

**Fullscreen** requests fullscreen on the embed iframe and **returns whether it was granted**. A
refusal (no user activation, an iframe without `allowfullscreen`, iOS) shows an honest sentence
rather than doing nothing, which is what a silently-swallowed rejection looked like before.

**Title** comes from the embed's `getVideoData().title`, read on the same 250 ms poll that drives
the timeline. It is not in the published IFrame API reference, so it is read through the adapter's
`safe()` wrapper: an embed that reports no title simply gets no title line, never a placeholder and
never a guess.

**Guest view**: implemented and reachable via `<TheaterStage role="guest" />`, unused today.
Global controls are **absent**, not disabled: a guest sees a read-only progress bar, volume,
captions, fullscreen and "Playback is controlled by the host". Building it now means the
shared-playback work only has to choose a role.

### Handled states

idle (no seat) · seated-idle · loading · buffering (spinner; "Still loading…" past 15 s) · ended ·
invalid input · invalid id · unavailable (100) · embedding blocked (101/150) · never-starts (timeout
heuristic) · autoplay blocked ("Tap to watch") · API unreachable ("Try again") · fullscreen refused ·
captions.

### Tests

* `src/lib/theater-state.test.ts`: the transition table and every derived UI fact.
* `src/components/blobbi/theater/TheaterStage.test.tsx`: the behavioural suite, driving the real
  components against a fake `YT` global: card hidden until seated, no API fetch before seating, no
  error before submission, the Load Video form actually reaching the player (with all five accepted
  input forms), curtain closed while loading, curtain opening only on readiness, curtain staying
  open under hover/touch events, curtain closing on Change video and on standing up, the player
  being destroyed each time, honest error copy per code, and Strict-Mode-safe initialisation.
* `src/lib/youtube-url.test.ts`: every accepted URL form, start offsets, every rejection.
* `src/lib/theater-playback.test.ts`: the whole decision layer against a fake adapter: clamping,
  absolute skips, no-ops, one command per action, local controls producing no command, rate
  normalization, error and autoplay handling, single destroy.
* `src/lib/youtube-player.test.ts`: the adapter against a fake `YT` global: single script injection
  under repeated/Strict-Mode calls, resolution when the script is already present and its one-shot
  callback already fired, timeout rather than hanging, retry after failure, honest error mapping,
  state mapping, iframe attributes, the requested id and start offset reaching the embed, title
  reading, destroy, and survival of a player that throws on every call.

---

## 4. What Phase 4+ attaches to

| Seam | Where |
| --- | --- |
| Publish a paired `21951` + `31951` | **done**: `useTheaterPlayback(request, { onCommand })` → `useSharedPlayback` |
| Apply a remote canonical state | **done**: the shared controller drives the local one with publication suppressed |
| Position arithmetic | `clampPosition` / `resolveSkipTarget` / `normalizeRate` |
| Choose the control surface | `<TheaterStage role="host" \| "guest" />` |
| Draw a remote seated Blobbi | **done**: `resolveSeatedRender(seatId)` in `MultiplayerLayer` |
| Publish who is sitting where | **done**: `PlayingView.sittingIn` → presence `seatId` |
| Attach a session to a seated player | **done**: `PresenceContent.activity` (address string only) |
| Drive the room's UI from a session | **done**: `useSharedPlayback` dispatches `submit` into `theaterReducer`; the reducer is unchanged |
| Turn a Blobbi around | `facing="back"`, derived from `theaterSeats[seatId].facing` |

The decoupling rules in the protocol document (§14.3) still hold: the seat system imports
nothing from playback, the playback controller imports nothing from seats or presence, and the
theater UI is the only place the two meet.

## 5. Manual verification

Run `npm run dev` and open `http://localhost:5183/dev/theater`: a **development-only** harness
(`src/pages/DevTheater.tsx`). `AppRouter` builds it as
`import.meta.env.DEV ? lazy(() => import(...)) : null`, and Vite replaces that flag with a literal
`false` in a build, so the ternary collapses and the dynamic import in the dead branch is dropped:
the page is not merely unrouted in production, **its chunk is never emitted**. Verified against
`dist/`: no `DevTheater` chunk and no reference to it anywhere in the output.

It is not an authentication bypass: it grants no session, signs nothing, publishes nothing and reads
no private data. It mounts the REAL `PlayingView`, `InteractiveElements` stage branch, seats,
movement/arrival system and `TheaterStage`; only the Blobbi identity is fixture data and only the
starting location is forced. It exists because the real entry path needs a Nostr key *and* a
published kind-31124 Blobbi on a live relay, and checking whether a curtain opens should not require
writing test data to a public relay.

> One trap worth recording: driving this from an automated browser, the Chrome window runs occluded
> (`document.hidden === true`), which throttles `requestAnimationFrame` to nothing. All Blobbi
> movement is rAF-driven, so seats appear not to respond at all. That is the harness environment,
> not the app, with the window visible, the walk and the arrival callback work normally.

Confirmed by hand in Chrome: curtain closed on entry · no card and no error before sitting · the
Blobbi walks first and no seated state appears on click · card appears only on arrival · the seated
Blobbi is snapped to the configured anchor and rendered rear-facing · pasting a watch URL loads ·
loading feedback shown with the curtain still closed · the video's title and duration arrive · the
curtain opens only on readiness and stays open with no hover · play/pause · ±10 s (timeline advanced
to 0:10) · playback speed (1.5×) · `youtu.be` short link · Enter-key submission · invalid input
rejected with a specific message and no player built · an unavailable id showing the ambiguous copy
with the curtain still closed and the input still available · Change video closing the curtain and
restoring the input · clicking the floor removing the card, closing the curtain and leaving **zero**
iframes · reloading the room clean.

### Two-user seating, verified with two real identities

Verified against **two separate Nostr identities on a local in-memory relay** (`nak serve`, so no
test data was written to a public relay), in two browser contexts kept apart by origin
(`localhost` vs `127.0.0.1`, which gives them independent `localStorage` and therefore independent
logins). Both loaded the real `/dev/theater` harness, which mounts the real `PlayingView`,
`MultiplayerLayer` and seats.

Confirmed by hand, reading both the rendered DOM and the relay's event log:

* **Walk before sit, remotely too.** The seat click published `state: "moving"` with a goal and
  **no `seatId`**; `seatId` appeared only in the later `idle` presence, after arrival. Sampling the
  sitter's own DOM across the walk showed `data-seated-in` still null mid-walk (at 29.4 % / 90.2 %)
  and set only on arrival.
* **Canonical anchor, on both sides.** Sitter and observer both put the Blobbi at
  **32.8872 % / 87.6471 %**: `seatAnchorPosition('theater-seat-a4')` exactly, to four decimals,
  from configuration rather than from the published coordinates.
* **Rear-facing.** The observer's mounted SVG for the seated remote contains no pupil, eye or mouth
  blocks; visually, the back of the Blobbi's head shows above the chair back.
* **No second copy.** One `[data-player-key]` element, one `<svg>`, no ground shadow, no float, and
  the row's `scale(0.85)` on the sprite wrapper only.
* **Occupancy.** The chair reported `data-seat-occupied="true"` with `data-seat-occupied-by="remote"`
  on the observer and `"local"` on the sitter.
* **Duplicate claim.** With both users claiming `theater-seat-a4`, **each screen rendered exactly
  one seated Blobbi** (`document.querySelectorAll('[data-seated-in]').length === 1`): each client
  seated its own player and drew the other with the normal floating renderer (shadow restored).
  This is the documented policy, asymmetry included.
* **Release and hand-off.** When the sitter stood up (a floor click), the observer saw the seated
  pose disappear and normal movement rendering resume within a second, and the still-claiming
  other user immediately won the seat, flipping the chair to `occupied-by="remote"`.
* **Stale presence.** Navigating one client away from the app stopped its heartbeats; the observer
  dropped the player and cleared `data-seat-occupied` entirely, through the existing presence GC.
* **No shared playback** *(true when this seating pass was validated)*. The relay saw only kinds
  `0`, `11125`, `31124` and `31950` for the whole session. Zero `31951`, zero `21951`. The later
  shared-playback validation, with those kinds live, is recorded in
  [`docs/theater-shared-watch-implementation.md`](theater-shared-watch-implementation.md) §10.

**Two real defects were found this way and fixed**: neither was reachable from jsdom:

1. **The seat fell out of presence ~25 s after sitting.** The heartbeat interval is rebuilt on every
   location change, and *entering the theater is a location change*; that rebuilt interval did not
   pass the seat, so the next heartbeat published presence without `seatId` and un-seated the player
   on every other screen. It needed location-change → sit → heartbeat in that order to show up. The
   regression test in `MultiplayerLayer.seating.test.tsx` now performs exactly that sequence (and
   was confirmed to fail before the fix).
2. **Remote Blobbis were drawn a size smaller than their owners saw them.** `MultiplayerLayer`
   hardcoded `size="lg"` while `MovableBlobbi` uses `getBlobbiSizeForLocation`, which is `xl` in the
   theater. Standing, this was a subtle mismatch; *seated*, it was the difference between visible
   above the chair back and completely hidden behind it, the seat looked empty on every screen but
   the sitter's own. Remote sprites (and their ground shadows) now use the room's size, which is
   what the local/remote parity module exists for.

> The `document.hidden` trap recorded above applies to this flow too, and is worse for it: an
> occluded automation window gets **zero** `requestAnimationFrame` callbacks, and all arrival is
> rAF-driven, so seats appear completely inert. Shimming `requestAnimationFrame` onto `setTimeout`
> in the page restores movement (throttled to ~1 fps, which the dt-based step handles fine) and was
> how the walk-and-arrive flow above was driven. That is a harness workaround, not an app change.

**Not exercised in a real browser:** the fullscreen *grant* path, and a video actually rendering
frames. The automated Chrome window runs occluded (`document.hidden === true`), which both throttles
`requestAnimationFrame` and prevents a user-activated fullscreen request; and this sandbox could not
reach YouTube's media CDN, so playback sat in `BUFFERING` (which did correctly show the buffering
spinner and the "Still loading…" copy). The fullscreen *refusal* path is covered by test.

## 6. Known gaps

* **Shared playback is implemented**: see
  [`docs/theater-shared-watch-implementation.md`](theater-shared-watch-implementation.md) for the
  event shapes, authority matrix, synchronization model and its own limitations. Presence now
  carries both `seatId` (who is visibly sitting where) and `activity` (which session they are
  watching, as an address string only).
* **Guest mode is reachable**: joining a session with a code selects the guest surface.
* **Moderation.** The open catalog removes the audit's only moderation mechanism; see the
  deviation note above.
* **Fullscreen** requests fullscreen on the embed iframe only. It has not been tested against the
  app shell's own `useFullscreen` / `FullscreenExitButton` on a real device, and the grant path has
  not been exercised in a browser at all (see §5).
* **Captions** toggle through the embed's caption module, whose availability is per-video and
  per-device; there is no UI for choosing a caption language.
* **iOS Safari** has not been verified by hand. `playsinline`, muted-first and the "Tap to watch"
  fallback are in place, but the audit's warning about programmatic play on a fresh element
  stands until someone tests it.
