# Location resume

Where an existing player appears after a reload.

## The short answer

> The newest valid kind:31950 presence the player published for this island, if
> it is still fresh according to the **same presence lifetime multiplayer uses to
> decide whether that player is still visible to everyone else**; otherwise Town.

With one product caveat, stated in full below: the two Arcade-Pass floors resume
to the arcade entrance rather than to the floor itself, because the pass never
survives a reload and the elevator is the only way off those floors.

## Why this exists

`LocationProvider` opened every session with `useState('town')`. There was no
competing authority — no stored location, no route segment, nothing — so a
reload, including a reload after an error recovery, always dropped the player in
Town however far from Town they actually were.

The fact that was missing is already published. Kind:31950 presence carries the
player's current island location, and it already has a lifetime rule.

## The canonical freshness rule

| | |
| --- | --- |
| Kind | `31950` (addressable, `d = session:<uuid>`) |
| Constant | `EXP_SECONDS = 35` — `src/lib/multiplayer.ts` |
| Predicate | `isPresenceAlive(expiration, now)` → `expiration > now` |
| Basis | The **NIP-40 `expiration` tag**, written by `buildPresence31950` as `created_at + EXP_SECONDS` |

`isPresenceAlive` is the single comparison. Its two consumers:

1. **Remote visibility** — `explainPresenceEvent` (`src/lib/multiplayer.ts`)
   rejects any presence it returns `false` for. That rejection is the first gate
   every incoming event passes, so a failing event never enters the presence
   map and never renders a remote player.
2. **Local resume** — `resolveInitialIslandLocation`
   (`src/lib/location-resume.ts`).

`location-resume.test.ts` walks a table of ages across the boundary and asserts
the two verdicts are identical at every one. Changing `<` to `<=` to make a
resume case pass would widen remote visibility as a side effect, and that test
is what makes the coupling visible instead of surprising.

### The boundary

Because `expiration = created_at + 35` and alive means `expiration > now`:

| Age of presence | Alive? | Resume |
| --- | --- | --- |
| 34 s | yes | restore |
| 35 s (`expiration === now`) | **no** | Town |
| 36 s | no | Town |

### What is *not* a second freshness policy

`useIslandPresence` sweeps already-accepted remote players on `EXP_SECONDS + 5`
against the **local receive time** (`lastSeen`), and its subscription asks the
relay for the same window. Neither is a competing rule: both only ever see
events that already passed `isPresenceAlive`. The `+5` is transport slack on a
gate that has already been applied, not a different lifetime.

## The restoration matrix

One bounded read of the player's own presence, then:

| Case | Outcome | Starts in | Position |
| --- | --- | --- | --- |
| Alive, renderable, entitled | `fresh-presence` | **that location** | **restored** |
| Alive, arcade floor, no valid pass | `gated-presence` | `arcade` | canonical spawn |
| Alive, but location unknown to this build | `invalid-location` | Town | canonical spawn |
| Alive, but `loc:` tag and `content.location` disagree, or `loc:` absent | `invalid-location` | Town | canonical spawn |
| Expired | `stale-presence` | Town | canonical spawn |
| Relay answered, no usable presence for this island | `no-presence` | Town | canonical spawn |
| Read never completed | `unknown-read` | Town | canonical spawn |

The outcomes stay distinct even where several end at Town. "We confirmed you
have no presence" and "we could not reach a relay" are different facts and only
one of them is knowledge.

### Why stale → Town

A decision, not a fallback. Presence expiring is exactly what removes a Blobbi
from every other client's world. A player whose presence lapsed has *left*, as
far as the island is concerned. Restoring them into that spot days later would
resurrect a position the world already forgot, and asymmetrically: they would be
standing on the beach in their own client having never re-entered it in anyone
else's.

### Why unrecognised locations → Town

The location arrives as a string from a relay. Only strings that are keys of
`LOCATION_BACKGROUNDS` are accepted, so a resumed location always has a scene to
render. That set is derived from the record rather than written out again — the
compiler already forces it to stay exhaustive, and a second hand-kept list would
be free to drift.

Historical presence *can* carry locations this build no longer knows; the island
has renamed and removed rooms. Those go to Town.

### UNKNOWN relay reads

`src/lib/relay-read.ts` established that `unknown != empty`, and this read uses
its EOSE-aware primitive: a timeout, a refused REQ or a dead socket comes back
as `status: 'unknown'` and is classified as `unknown-read`, never as a confirmed
empty.

It then navigates to Town anyway, and that is safe here for a specific reason:
**this read owns no data.** The resilience rule exists to stop an uncertain
relay destroying player state. The resume decision is not state — nothing is
persisted, no location is written anywhere, and no "you were in Town" fact is
recorded as a result. The only cost of a wrong guess is one walk back.

What we refuse to do is block the world on an unreachable relay, so the read has
one deadline (`readRelay`'s own, 3 s) and the player enters the island either
way. The decision keeps its `unknown-read` classification, which is what a future
"couldn't reach your last spot" affordance would need.

Note `readRelay`, not `readRelayConfirmed`: the double-read confirmation exists
for state whose false absence is destructive, and a missed resume is not that.

## Position: what is restored, and from which field

A resumed session opens **standing where the player was standing**. Nothing else
about their motion or state comes back.

### `anchor` vs `goal`

Presence carries two points, and neither is plainly "where the player is":

| | `anchor` | `goal` |
| --- | --- | --- |
| stationary (`idle`, heartbeat) | the live position | absent |
| walking (`moving`) | where the walk **started** | `{from, to, v, ts}` |

So mid-walk, `anchor` is already *behind* the player — `publishMove` writes the
walk's origin there — and `goal.to` is where it ends.

Resume takes **`goal?.to ?? anchor`**. That is not a guess: it is exactly what
`processPresenceEvent` uses as the target for every REMOTE copy of that player
(`groundGoal ? groundGoal.to : groundAnchor`). Restoring anywhere else would put
the local player somewhere no other client ever drew them.

`goal.to` is taken as a **static point**. The goal itself never enters the
decision — there is no field on the result to hold it — so a reload can never
resume walking toward a target chosen 30 seconds ago.

### Coordinates

The wire carries legacy **CENTER** points in **world-percent (0–100)**; internal
island code uses **GROUND** points (feet). Resume converts with
`wireCenterToGround`, the same function at the same boundary presence ingest
uses (`src/lib/presence-ground.ts`).

### Validation

A coordinate off the relay is never trusted onto the screen:

| Input | Result |
| --- | --- |
| Non-numeric, `NaN`, `Infinity`, missing | canonical spawn |
| Outside 0–100 world-percent space | canonical spawn — malformed, not merely out of bounds; clamping `x: -9999` onto an edge would invent a spot the player never occupied |
| In range but off the scene's walkable floor | **clamped** by `constrainPosition` against `locationBoundaries` — the scene's own existing policy |
| Valid | used as-is |

Positions the app itself publishes already pass this untouched: `goal.to` is
clamped by `clampToWalkable` at publish time, and every published anchor is a
live actor position. The clamp branch exists for history — a room whose floor
moved between builds.

## What is NOT restored

`hiddenIn`, `seatId`, `activity` and the movement `goal` are all dropped. They
are sub-states with their own ownership and expiry rules, and a boot cannot
honour those rules.

- **`goal` / active walking** — a restored goal is a walk toward a target that
  made sense 30 seconds ago (the classic case being an old walk-to-door target).
  The presence layer already refuses to reuse stale movement targets when a
  player re-enters a room; resume follows the same rule.
- **`seatId`** — a seat claim is advisory occupancy arbitrated live among
  everyone in the room. Reasserting one at boot would claim a chair on the
  strength of an event nobody else is still holding.
- **`activity`** — shared-playback membership belongs to being in the room.
  `PlayingView` clears it on every location change and starts at `null`; walking
  back into the theater does not silently rejoin a session, and neither does
  reloading into it.
- **`hiddenIn`** — pose state, reset by `useBlobbiPoseController` on mount.

## Room-specific behaviour after a reload

### Mine

`cave-open` restores like any other room. A mining **run** does not.

The Mine's lifecycle deliberately abandons an unfinished run on unmount — no
energy charged, no Coins granted (`docs/mine-session-settlement.md`). Resume does
not touch that: `MiningGame` mounts at its instructions screen with no session
minted, exactly as if the player had walked in through the cave mouth.
`MineResumeBoundary.test.tsx` pins it, and fails if resume ever grows the ability
to rehydrate a run.

### Arcade — and the Arcade Pass lifecycle

`arcade` (the entrance) always restores. `arcade-1` and `arcade-minus1` restore
**if and only if the player still holds a valid Arcade Pass.**

Those two floors are reachable only through the elevator, and `ArcadeRoom`'s
elevator is pass-gated **on every floor** — including the one you arrive on. A
player restored upstairs without a pass would be stranded: the only exit refuses
them. So the entitlement is checked, and an unentitled player lands at the
entrance, where a pass can be bought. It is never granted: presence records
position, and position is not payment.

#### Why the pass used to vanish on reload

`sessionStorage` survives a reload in the same tab — that is what it is for. The
pass disappeared anyway because `LocationProvider` deleted it on the way out:

```js
// removed
window.addEventListener('beforeunload', () => {
  sessionStorage.removeItem('has-arcade-pass');
});
```

That handler was defensible before location resume: a reload always landed you
in Town, so you really had left the arcade. The moment reloads started restoring
where you were, it became a double charge — buy a pass, refresh, buy it again.

**The product rule is unchanged**: the pass is valid until the player leaves the
arcade. What changed is that a *reload is no longer mistaken for leaving*.
Revocation now happens on the one thing that actually means "left": the location
ceasing to be an arcade location, enforced in two places that agree —

| Trigger | Where |
| --- | --- |
| Navigating to a non-arcade location | `LocationProvider.transitionToLocation` |
| Entering (or resuming into) a non-arcade location | `PlayingView`'s `currentLocation` effect |

Both now route through `clearArcadePass()` rather than writing to
`sessionStorage` directly. The direct write fired no storage event in the same
tab and notified no subscriber, so the HUD chip kept showing a pass the player
no longer had; a regression test pins the notification.

A reload, a React remount, an orientation change and a mobile suspend/resume are
none of them location changes, and none of them revoke the pass.

### Theater / stage

`stage` restores directly — entering it is ungated. Seat occupancy and shared
watch-session membership do not come back, per **Location only** above.

## How the flash is avoided

`BlobbiIsland` holds the playing branch on the loading screen until the resume
decision settles, and `LocationProvider` takes the decision as its *initial*
`useState` value. So the world's first committed render is already the restored
location — there is no Town backdrop, no Town spawn, no Town presence publish,
and therefore nothing to teleport away from.

The position rides along the same path rather than racing it. `MovableBlobbi` is
keyed on `currentLocation`, so its `initialPosition` is read at the actor's first
mount in a scene; `resolveActorSpawn` supplies the bootstrap position there and
the canonical spawn everywhere else. **No effect moves the actor after the scene
is up** — there is no correcting step to see.

The wait is bounded by the read's own deadline, and in practice is already over:
the presence read starts in parallel with the Blobbi and companion reads that
must finish before the playing branch is reachable at all.

## Bootstrap only

Resume runs once and then gets out of the way. Two independent latches:

1. `useIslandLocationResume` is a query pinned with `staleTime: Infinity` and
   every automatic refetch disabled. It resolves once per authenticated island
   entry and never re-asks.
2. `LocationProvider` keeps a `bootstrappedRef` that is set by **either** the
   first adoption **or** the first navigation, whichever happens first. A
   navigation therefore beats an in-flight resume permanently, and a late or
   changed decision cannot move a player who is already somewhere.

The same latch covers position: location and position are adopted in one commit,
and `setCurrentLocation` clears `bootstrapPosition` immediately — not on the far
side of the fade — so from the first navigation onward the destination scene's
own spawn rules own it. A late presence answer can change neither.

After boot, location is owned entirely by `LocationContext` and the normal
navigation path. Presence continues to be published by the existing publisher,
which reads the live `currentLocation` — so the restored location goes out on the
wire through the ordinary path, and no second publisher exists.

## Multi-tab

Ordinary newest-event semantics: the newest `created_at` wins, so a second tab
that published more recently decides where a third one opens. Same-second ties
break on event id, for determinism only.

The newest presence is *judged*, not searched past. If the newest location is
unrenderable, that is a fact about where the player last was, not a reason to
reach further back for an older event that happens to be usable.

No `localStorage` or `sessionStorage` location authority was introduced. Nostr
presence is the only source.

## Desktop and mobile

Identical. There is no device-specific timeout and no device-specific branch —
the same `EXP_SECONDS`, the same read deadline, the same position handling
everywhere. No pointer or viewport input reaches any of this logic.

A mobile suspend/resume inside the 35 s window resumes exactly like a desktop
refresh, and an orientation change — which remounts React components — is not a
location change, so it neither re-runs the bootstrap nor touches the Arcade Pass.
The only mobile-specific behaviour on this path is the pre-existing portrait
gate, which sits above location entirely.

## Files

| File | Role |
| --- | --- |
| `src/lib/multiplayer.ts` | `EXP_SECONDS`, `isPresenceAlive`, `presenceExpirationOf` |
| `src/lib/location-resume.ts` | The pure decision: `resolveInitialIslandLocation` |
| `src/hooks/useIslandLocationResume.ts` | One bounded EOSE-aware read, once per entry |
| `src/contexts/LocationContext.tsx` | `initialLocation` / `initialPosition`, bootstrap latch, arcade-exit revocation |
| `src/lib/location-initial-position.ts` | `resolveActorSpawn` — bootstrap position vs canonical spawn |
| `src/components/blobbi/PlayingView.tsx` | Mounts the actor at the resolved spawn |
| `src/pages/BlobbiIsland.tsx` | Holds the world until the decision settles |
