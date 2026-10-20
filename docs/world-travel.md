# World Navigation and World Travel

How a Blobbi leaves the Island for another Blobbi world, how it comes back,
and how the Island knows where it is. Code: `src/worlds/`.

## Two different things

| | World Navigation | World Travel |
|---|---|---|
| What | The player takes their Blobbi to another Blobbi app. | Where the Blobbi IS, as a fact every Blobbi app and device agrees on. |
| How | The Blobbi says goodbye and dissolves (the Home's teleport), then THIS tab goes to the world's checked address. | The kit's World Travel protocol: the Blobbi's World Location (kind 31126) on the shared travel relays. |
| Always on? | Yes. | No: `VITE_BLOBBI_WORLD_TRAVEL=nostr` (the owner's release decision; the kinds are experimental). |
| Writes | Nothing. | One event per move, by the world the Blobbi moves TO, on the player's act. |

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
3. Only once the Blobbi is gone does the page go: `requestEgress({ class:
   'world-travel', url })`, the egress boundary's one same-tab navigation
   (`window.location.assign`, held to `src/external-egress/egress.ts` by a
   structural test). Nothing travels with it: no key, no session, no query
   string, no fragment. The other app signs the player in its own way.
   `world-travel` is governed by the `externalLinks` capability (a family
   experience shows every door closed) and asks for no confirmation dialog:
   the card names the world and Stay is the moment to change one's mind.
4. If the page is still here 5 s later (blocked, offline), or the boundary
   refused, the Blobbi comes back (arrives) and the card says so, with Try
   again. Back from the other world with the browser's Back (a cached page)
   brings it back too.

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
  says where it is ("Brook is in Blobbi Pixel"), with **Call here**. Looking
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
- **The player's act moves it HERE**, and nothing else does: **Bring here**
  (explicit, at once), or the **second** trusted press or key in the world
  within a rolling 20 s (`session.interact` with `followAfter:
  ISLAND_FOLLOW_AFTER` = 2; the kit's gap of 1 s between counted inputs, its
  window and its suspension after a refusal are unchanged; presses inside a
  dialog, a sheet or the away card itself never count; a held key's repeat
  never counts). One signed World Location naming `blobbi-island`, from the
  Blobbi's previous World, with `prev`, to every travel relay. An nsec login
  signs silently; an extension or a remote signer may ask ("Approve the
  request…"). A refusal, unreachable relays and a stale move are said in the
  card, with Try again; after a refusal only the button moves it.
- **The away card** says where the Blobbi is ("Brook is in Blobbi Pixel"),
  offers **Bring Brook here** as the one obvious action, and shows the taps
  counted so far toward it coming over by itself (dots, `needed` from the
  session's `follow`), in plain words and with no protocol in them.
- **Leaving writes nothing.** Going to Pixel through the Worlds sheet does
  not move the Blobbi's location: Pixel moves it to itself when the player
  plays there (its own third interaction or explicit call), and the Island
  departs when its stream brings that event, after its own moment is over
  (a departure waits while the Island is `busy`). Returning to the Island
  works the same way, the other way round.
- **An explicit trip arrives by itself (the hand-off,
  `docs/world-travel-handoff.md`).** Going to another world through the
  Worlds sheet signs the move the destination will publish, here, on the
  door press (an extension asks here), and carries it in the address's
  fragment; the destination checks it (signature, account, Blobbi,
  destination, origin, freshness, the canonical previous location) and
  publishes it as signed, then its teleport plays the arrival. The
  destination never signs because of a URL. A refusal or a slow signer
  leaves without it, and the ordinary rule stands over there. Arriving here
  the same way from Home: `useIslandWorldTravel` holds the hand-off until
  the first look confirmed the place, publishes it once, and the live
  change brings the arrival; the away card says "on the way" meanwhile, and
  "Try again" resends the same event if no relay accepted it.
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
`data-travel-resolution`, `data-travel-view`, `data-follow-count`, …).

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
- `world-travel-handoff.test.ts`: the hand-off's payload, address, signing,
  every check, the ids honoured, the arrival controller.
- `world-travel.nostr.test.tsx`: end to end over an in-memory relay with real
  signatures: the hand-off from Home (one publication, nothing signed here,
  one arrival; again after a reload; wrong World, account, Blobbi,
  tampered, expired, stale; relays refusing then Try again) and to Pixel
  (signed once at the door, carried, nothing published; refused and silent
  signers); away at load with nothing written; a stale kept "here" never
  drawn before the relays answer; confirmed here arriving exactly once;
  unreachable relays (nothing kept: the default World; kept here: it
  stands); Bring here publishing exactly one 31126 and the arrival; two taps
  at once making one move; two meaningful interactions publishing one move
  (the card counting the first, a press on the card not counting); an
  extension's refusal (nothing written, following suspended, Try again); a
  relay failure (the same signed event resent once they are back); a reload
  mid-arrival (one event, one arrival); a live move elsewhere departing it;
  the default World.
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
   with Blobbi Home or Pixel built the same way: play the Blobbi in Pixel
   (its interactions, or its call), come to the Island: nothing is drawn
   until the relays answer, then it is away and the card says "in Blobbi
   Pixel" with Bring here; press it (an extension asks): the arrival plays;
   the Pixel tab, still open, departs it. Or tap twice in the world, a
   second apart: the card counts the first, the second brings it. Then the
   other way. Reload while it is here: the arrival plays once on entry.
   `world-travel-status` shows place, resolution and view.
4. A family experience (`src/safety`): every door closed, "Not available".

## Limitations

- A trip from Pixel has no hand-off yet (Pixel has no doors to other
  worlds): the Blobbi comes over on the second interaction or with Bring
  here.
- Rumble is not open today (502); it opens by changing its address in
  `worlds.ts` once a check finds it answering.
- World Travel with Nostr Farm and Blobbi Rumble needs those apps to join the
  protocol (their World ids are registered here for naming only).
- Active Presence is not offered on the Island yet.
- The teleport is a copy of the Home's; the shared package it proposes does
  not exist yet.
