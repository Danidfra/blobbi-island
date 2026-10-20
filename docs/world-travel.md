# World Navigation and World Travel

How a Blobbi leaves the Island for another Blobbi world, how it comes back,
and how the Island knows where it is. Code: `src/worlds/`.

## Two different things

| | World Navigation | World Travel |
|---|---|---|
| What | The player takes their Blobbi to another Blobbi app. | Where the Blobbi IS, as a fact every Blobbi app and device agrees on. |
| How | The Blobbi says goodbye and dissolves (the Home's teleport), then THIS tab goes to the world's checked address. | The kit's World Travel protocol: the Blobbi's World Location (kind 31126) on the shared travel relays. |
| Always on? | Yes. | No: `VITE_BLOBBI_WORLD_TRAVEL=nostr` (the owner's release decision; the kinds are experimental). |
| Writes | Nothing. | One event per move: opening a world is the player's act. A door moves the Blobbi to the world it opens (the origin writes); opening a world directly moves it there (the destination writes). |

The same split, the same registry shape, the same departure and the same
switch as Blobbi Home (`nostr-pet/src/features/worlds`, `src/features/presence`)
and Blobbi Pixel, so the three apps feel like one connected experience.

## World Navigation (`worlds.ts`, `WorldsModal.tsx`, `useWorldDeparture.ts`)

1. The dock's **Worlds** button opens the Worlds sheet: Blobbi Home, Blobbi
   Pixel, Nostr Farm, Blobbi Rumble. A world is a door only with an address
   that was **checked** to answer as that app (HTTPS, its own page title), on
   the date in `worlds.ts`. One without is shown, labelled, never a link:
   Rumble answered 502 on 2026-10-19 and is "Coming soon" until a check finds
   it answering again. The Farm door is the Station registry's address
   (`NOSTR_FARM_URL`), written once. A build may point a door elsewhere with
   `VITE_BLOBBI_WORLD_URL_<ID>` (https only; anything else is ignored).
2. A door starts the **departure** (`useWorldDeparture`, Blobbi Home's scene):
   the Blobbi notices (450 ms), waves (a wiggle, 700 ms), then **leaves** with
   the Home's teleport (`teleport/`: gathers, dissolves top-down into rising
   motes, 2.3 s). The doors are disabled meanwhile; a second tap, or a tap on
   another world, starts nothing more. **Stay** ends it at any moment before
   the page goes: the Blobbi is simply here again. Reduced motion: no wave, a
   450 ms fade.
3. Only once the Blobbi is gone is the move to that world made (World
   Travel on: `departTo`, below; nothing is signed or published while Stay is
   still offered), and once it has come to an end does the page go:
   `requestEgress({ class: 'world-travel', url })`, the egress boundary's one same-tab navigation
   (`window.location.assign`, held to `src/external-egress/egress.ts` by a
   structural test). Nothing travels with it: no key, no session, no query
   string, no fragment. The other app signs the player in its own way.
   `world-travel` is governed by the `externalLinks` capability (a family
   experience shows every door closed) and asks for no confirmation dialog:
   the card names the world and Stay is the moment to change one's mind.
4. If the page is still here 5 s later (blocked, offline), or the boundary
   refused, the Blobbi comes back (arrives) and the card says so, with Try
   again; when its move WAS published it has left for that world already, so
   nothing offers to undo the trip: the card says it has left but the world
   did not open, Try again asks the page to go once more (no new move), and
   Dismiss hides the card and leaves the kit's sync to show it away. Back
   from the other world with the browser's Back (a cached page) brings it
   back too (unless it had left).

While the Blobbi is leaving, on its way, or away, the room publishes **no
presence** (kind 31950) for it (`MultiplayerLayer`'s `blobbiAway`): a Blobbi
in another world is not standing in an Island room, and its last presence
expires on its own (NIP-40, ~35 s). Back here, its presence is announced at
once at the spot it stands.

## The teleport (`src/worlds/teleport/`)

Copied from Blobbi Home's `src/features/teleport/` (commit a3836e4), file
for file and unchanged: `timeline.ts` (the choreography), `particles.ts` (the
motes), `presence.ts` (the state machine), `silhouette2d.ts` (the drawing's
outline), `react/usePresence.ts` and `react/TeleportFrame2D.tsx` (the 2D
painter: a CSS mask over the kit's drawing and a canvas of motes). Its tests
came along (`teleport.test.ts`). It is the Home's proposed
`@blobbi-kit/teleport` (its `KIT_EXTRACTION.md`); until that package exists,
this copy is kept in step with the Home's and nothing is changed here that is
not a bug in both. Pixel draws the same choreography on its pixel canvas
(`src/game/teleport.ts`).

In the Island, `MovableBlobbi` wraps its body in `TeleportFrame2D`, inside the
actor's scale rig, so the journey scales with depth and the anchor (the chat
bubble portal, the ground point) never moves. The motes leave through the
top of the room (`data-teleport-sky` on `PlaceBackground`). The eyes shut
tight while it gathers and forms (`eyesClosed`). `useBlobbiPresence` is the
Island's binding of the presence machine: `present`, `departing`, `absent`,
`arriving`, with `leave`, `enter`, `settle`, `cancel`.

## World Travel on Nostr (`travel-mode.ts`, `useIslandWorldTravel.ts`)

Off by default. On (`VITE_BLOBBI_WORLD_TRAVEL=nostr`, or on a dev server
`localStorage['blobbi:world-travel:v1'] = 'nostr'`), the Island is World
`blobbi-island` in the kit's World Travel protocol (`@blobbi-kit/core`
`WORLD-TRAVEL.md`, `useWorldTravel`, `useWorldTravelSync`):

- **Where it is.** The Blobbi's World Location (kind 31126) is read from the
  shared travel relays (`BLOBBI_WORLD_TRAVEL_RELAYS`: ditto and primal), on
  load, live, every minute, and on coming back online. With none, a Blobbi
  is at the default World, its Home. A newer signed event always wins over
  the device's kept copy.
- **Here, away, looking, coming.** Away: the Blobbi is not drawn and a card
  says where it is ("Brook is in Blobbi Pixel"), with **Bring here**. Looking
  (a fresh device, the first look under way): "Looking for Brook…", the
  Blobbi neither here nor away. Coming (a move here under way): "Brook is on
  the way…", then the teleport's arrival. The first answer is settled, never
  replayed as a journey.
- **Arriving on entry (`entry-arrival.ts`).** The Blobbi is never standing
  in the room when the world opens: it starts absent and arrives through the
  teleport (motes down, the body forms), once per mount of the playing view,
  after the entry gate has decided. With World Travel off, or no session
  (signed out, another account's Blobbi), the gate opens after a short beat.
  On Nostr it waits for the **first look at the relays**: a location this
  device merely kept (`resolution: 'cached'`) never draws the Blobbi, because
  the origin of a trip never learns the move the destination made and its
  cache says "here" after the Blobbi left. Once a relay answered
  (`confirmed`), or none did within the kit's timeout (`unreachable`: the
  kept place, or the default World, stands), the Blobbi arrives if it is
  here and stays absent if it is elsewhere. The wait is bounded
  (`ENTRY_HOLD_MAX_MS`, 6 s). While it waits, the kit's sync stands aside
  (`paused`) and the room's presence (31950) is not published: `blobbiHere`
  is true only for a Blobbi that has formed. Ordinary re-renders replay
  nothing (the gate is decided once); a Blobbi still forming or dissolving
  is not walked (`MovableBlobbi`).
- **Opening the Island IS the player's intention to bring the Blobbi here**
  (revised 2026-10-19, `docs/world-travel-handoff.md`,
  `world-travel-departure.ts`). Once the account is signed in and the first
  look has **confirmed** the place with the relays, an away Blobbi is moved
  here at once with the kit's own explicit move (`session.travel({ explicit:
  true })`): one signed World Location naming `blobbi-island`, from the
  Blobbi's previous World, with `prev`, to every travel relay; then the
  teleport's arrival. Already here: nothing is published. **Once per page
  load** per Blobbi (`autoArrivalDecision` over a per-document
  `ArrivalIntent`): never again on a re-render, a remount, a reconnect, a
  relay update or a focus or visibility change; a reload is a new page and
  may move again; a tab that already decided never reclaims the Blobbi by
  itself (two open tabs never ping-pong). And only while the page is FRESH:
  within `ARRIVAL_INTENT_TTL_MS` (5 min) of its navigation start
  (`performance.now`) and visible; an old background tab shown later, or a
  page left signing in for longer, moves nothing by itself (Bring here
  remains; a back/forward-cache restore keeps the page's state, so its
  earlier decision stands). An nsec login signs silently; an extension or a
  remote signer may ask ("Approve the request…") and gets
  `SIGN_PROMPT_TIMEOUT_MS` (60 s, `boundedSigner`): a prompt left open
  longer ends the move as declined, and a late approval is dropped, never
  published. A signer that is missing or refuses moves nothing; unreachable
  relays move nothing. No input moves the Blobbi: a trusted press or key is
  activity only (`session.noteActivity`).
- **The away card** says where the Blobbi is ("Brook is in Blobbi Pixel")
  and offers **Bring Brook here** as the one obvious action and the retry
  (an explicit `travel()`); a refusal, unreachable relays and a stale move
  are said in the card, with Try again. In plain words and with no protocol
  in them.
- **Leaving moves the Blobbi to the world it opens.** A door in the Worlds
  sheet plays the goodbye, with Stay offered throughout; only when the Blobbi
  is gone (`useWorldDeparture` calls `navigate`) does the Island make the move,
  `travel.departTo(destination)`, so nothing is signed or published before
  the last moment Stay can be pressed: the Island reads the authoritative location again
  (`session.refresh`), publishes nothing if the Blobbi is already there,
  else signs ONE World Location naming the destination (the kit's
  `buildWorldLocationTemplate`, `departureWindowS: 0`) and publishes it to
  the travel relays, waiting for one acceptance or a bounded timeout; a
  signature slower than 2 s re-reads first and never overwrites a newer
  location (`stale`). The page goes once the move has come to an end,
  whatever it came to (moved, already there, declined, unreachable: the page
  goes either way, to the plain address); one event per trip, and a Try
  again after a navigation that did not happen never makes a second one.
  The destination reads the latest event, finds itself named, publishes
  nothing and plays its arrival. A move made elsewhere (another device,
  another world) departs the Blobbi here when the stream brings it, after
  the Island's own moment is over (a departure waits while the Island is
  `busy`).
- **Active Presence (kind 21124) stays off.** The Island's room presence
  (31950) is a different fact (a position inside a room, for this World's
  players); the two never stand in for each other. Turning Active Presence
  on would be a later, opt-in choice, as in the other worlds.
- **The companion choice (11125 `current_companion`) is untouched.** The
  session follows whatever Blobbi the Island has selected, by its `d`; the
  identity every Blobbi app reads is that `d`, and it never changes with a
  trip.

For browser tests, a hidden `[data-testid="world-travel-status"]` carries the
same attributes as Blobbi Home's (`data-travel-place`, `data-travel-here`,
`data-travel-resolution`, `data-travel-view`, `data-travel-phase`, …).

## Tests

- `worlds.test.ts`: the registry, the checked doors, the overrides.
- `useBlobbiPresence.test.tsx`, `teleport/teleport.test.ts`: the presence
  machine and the Home's choreography, motes and reversal.
- `useWorldDeparture.test.tsx`: the goodbye in order, one navigation only
  after the Blobbi is gone, repeated taps, Stay, reduced motion, a refused or
  failed navigation, Back.
- `entry-arrival.test.ts`: the entry gate's decisions (no session, cached
  waits, confirmed, unreachable, the bounded hold).
- `WorldTravelProvider.test.tsx`: end to end with travel off: the arrival on
  entry (once, the room silent until it has formed), the dock, the sheet, the
  doors, the identity carried, repeated clicks, Stay, a family experience,
  the same-tab navigation through the boundary.
- `world-travel-departure.test.ts`: the shared departure rules over a
  pretend session (`departTo`: a fresh read, one event naming the
  destination with `from` and `prev`, already there, the place not
  confirmed, a refusal, a slow signer, read-only, another key, stale after a
  slow signature, no relay accepting, one move at a time, the kit's lock
  name), the one decision per page load (`autoArrivalDecision`,
  `ArrivalIntent`), and the leftovers of older builds dropped.
- `world-travel.nostr.test.tsx`: end to end over an in-memory relay with real
  signatures: opening the Island with the Blobbi in Pixel, in Home or with
  no location at all publishes one 31126 naming the Island after the first
  confirmed look, and the arrival plays once; already here publishes nothing;
  re-renders, remounts, the minute's look, play and visibility toggles never
  publish a second event; a stale kept "here" is never drawn before the
  relays answer; two relays that disagree resolve to the newest, named as
  `prev`; a hidden tab acts on first show; unreachable relays publish
  nothing, and Bring here works once they answer; an extension's refusal
  (nothing written, nothing asked again by play, re-renders or a remount,
  Bring here asking once more, two taps one move); a signer that never
  answers (nothing published); every relay refusing (the same signed event
  resent once they are back); a reload mid-arrival (one event, one arrival);
  a live move elsewhere departing it, never reclaimed by itself; a signer
  that never answers is declined after `SIGN_PROMPT_TIMEOUT_MS` and its late
  approval dropped, Bring here moving it once; an old page (older than
  `ARRIVAL_INTENT_TTL_MS`) signs and publishes nothing by itself. Leaving:
  Island → Pixel signs and publishes nothing while Stay is offered, then one
  31126 naming Pixel from the Island BEFORE the page goes to the plain
  address (an extension asked once; an nsec login silent); Stay during the
  goodbye publishes nothing; a published move whose navigation did not
  happen is not undone (has left, Try again, Dismiss); a refusal, a signer
  that never answers (the bounded wait) and relays refusing still let the
  page go, with nothing published.
- `src/external-egress/egress.world-travel.test.ts` and `boundaries.test.ts`:
  the class, the capability, the one owner of `location.assign`.

## Manual validation

1. `npm run dev`, open `/dev/theater` (no login): the dock's Worlds opens the
   sheet; Visit Blobbi Pixel: the Blobbi notices, wiggles, gathers, dissolves
   into motes rising to the top of the room, then the tab goes to
   `https://pixel.blobbi.pet/`. Stay mid-way brings it back. Add
   `?blobbi=baby`, `?blobbi=v3-adult`, `?blobbi=v3-baby` for other bodies.
2. With an account, on `/`: the same from any room. Back from Pixel with the
   browser's Back: the Blobbi is here again.
3. World Travel on (a dev server: set `localStorage['blobbi:world-travel:v1']
   = 'nostr'` and reload, or build with `VITE_BLOBBI_WORLD_TRAVEL=nostr`),
   with Blobbi Home or Pixel built the same way: open Pixel (the Blobbi is
   moved there), then open the Island directly (the address bar): nothing is
   drawn until the relays answer, then the Island moves the Blobbi here (an
   extension asks once) and the arrival plays; the Pixel tab, still open,
   departs it. Then the Worlds sheet, Visit Blobbi Pixel: the goodbye, one
   event naming Pixel published from the Island, the page goes, Pixel plays
   the arrival. Reload while it is here: the arrival plays once on entry,
   nothing is published. `world-travel-status` shows place, resolution,
   phase and view.
4. A family experience (`src/safety`): every door closed, "Not available".

## Limitations

- Rumble is not open today (502); it opens by changing its address in
  `worlds.ts` once a check finds it answering.
- World Travel with Nostr Farm and Blobbi Rumble needs those apps to join the
  protocol (their World ids are registered here for naming only).
- Active Presence is not offered on the Island yet.
- The teleport is a copy of the Home's; the shared package it proposes does
  not exist yet.
