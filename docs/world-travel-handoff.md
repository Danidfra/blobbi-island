# World Travel: the departure and the arrival (revised)

**Status: IMPLEMENTED 2026-10-19, in Blobbi Island, Blobbi Home and Blobbi
Pixel.** This file keeps its old name because the other apps' docs point to
it; the URL-fragment hand-off it used to describe is **gone**. No change to
`@blobbi-kit`, no new event kind, no change to the World Location (kind
31126). The code is one file kept identical in the three apps:

| App | Shared module | Origin (a door) | Destination (direct opening) |
|---|---|---|---|
| Island | `src/worlds/world-travel-departure.ts` | `WorldTravelProvider` + `useIslandWorldTravel.departTo` | `useIslandWorldTravel` (the auto arrival) |
| Home | `src/features/presence/world-travel-departure.ts` | its Worlds surfaces + `useHomeTravel` | `useHomeTravel` |
| Pixel | `src/game/world-travel-departure.ts` | its travel menu | `travel-host.ts` (`autoArrive`) |

## 1. The rule

**Opening a world is itself the player's intention to bring their Blobbi
there.** No extra interaction is asked for, and nothing rides in a URL.

1. **An explicit trip** from the Worlds sheet (Island → Pixel, Island →
   Home, …): the **origin** moves the Blobbi. It reads the authoritative
   World Location again (`session.refresh`, every relay merged by NIP-01);
   if the Blobbi is already in the destination it signs and publishes
   nothing; else it signs ONE kind 31126 naming the destination (the kit's
   `buildWorldLocationTemplate`: `prev`, `from`, the ordering rules, the
   same schema and World ids as every other move, `departureWindowS: 0`),
   publishes it to the travel relays from the origin, waits for one
   acceptance or a bounded timeout (`departTo`), THEN navigates to the
   destination's plain address through the egress boundary
   (`requestEgress({ class: 'world-travel', url, label })`, no fragment).
   The destination reads the latest event on load, finds itself named,
   publishes nothing and plays its arrival. One event per trip.
2. **A direct opening** (the address bar, a bookmark, a reload, a new tab)
   with the Blobbi elsewhere: the **destination** moves the Blobbi to
   itself. Once the account is signed in and the kit session's resolution is
   `confirmed`, it starts the kit's own explicit move (`session.travel({
   explicit: true })`): one signature, one event, then the existing arrival
   through the existing sync. Already here: nothing is published. **Once per
   page load** per (owner, d) (`autoArrivalDecision` over a per-document
   `ArrivalIntent`): never again on React re-renders, remounts, reconnects,
   relay updates or focus/visibility changes; a tab opened hidden acts the
   first time it becomes visible; a reload is a new page and may move again;
   a tab that already decided never reclaims the Blobbi by itself (two open
   tabs never ping-pong). If the signer is unavailable, refuses or never
   answers, nothing moves; the away card's **Bring here** is the retry (an
   explicit `travel()`).

## 2. Invariants kept from the kit's own moves

- A fresh read before deciding; a place not confirmed by any relay
  (`pending`, `cached`, `unreachable`) is never signed over.
- Never over a newer location: a signature slower than 2 s (a person
  answered a prompt) re-reads first, and a newer location met meanwhile is
  `stale` (nothing is sent), or `already-there`.
- One move per Blobbi at a time, in the page (`inFlight`) and across tabs
  (the kit's Web Lock name `blobbi-world-travel:<owner>:<d>`).
- The account is still the signed-in one before signing and before sending;
  an event signed for another key is `wrong-account`.
- Events are trusted for their signature, never for their relay. `moved` on
  the first relay acceptance; the kit's sessions heal lagging relays.
- The signer wait is bounded (`DEPART_SIGN_TIMEOUT_MS`, 20 s) and so is each
  relay's acceptance (`DEPART_PUBLISH_TIMEOUT_MS`, 4 s): the page always
  goes, with the Blobbi moved or not.

## 3. What a door does, in the Island

`WorldTravelProvider.onTravel` only starts the goodbye scene; Stay is offered
throughout it and publishes nothing. When the scene is over (phase `gone`,
where Stay is no longer offered), `useWorldDeparture` calls the provider's
`navigate`, which makes the move there and then,
`await travel.departTo(world.travelId)` (an extension asks at this moment),
and whatever its outcome (`moved`, `already-there`, `declined`,
`unreachable`, `stale`, `read-only`, `wrong-account`, `busy`) calls
`requestEgress` with the plain address: one event per trip. The departure
card says "Approve the trip in your signer…" while a prompting signer is
waited for. A `moved` or `already-there` outcome marks the Blobbi as having
LEFT: should the navigation then not happen, the card says it has left but
the world did not open, Try again asks the page to go once more without a
new move, and Dismiss hides the card without bringing the Blobbi back (the
kit's sync shows it away). With World Travel off, `departTo` resolves
`read-only` and the page simply goes.

The destination's one automatic arrival is also bounded in time: the page
must be fresh (`pageIsFresh(pageAgeMs())`, within `ARRIVAL_INTENT_TTL_MS` of
its navigation start) and visible, so an old background tab shown later
moves nothing by itself; and the kit's own move waits for the signer through
`boundedSigner` (`SIGN_PROMPT_TIMEOUT_MS`, 60 s): a prompt left open longer
is declined and a late approval is dropped, never published.

## 4. Older builds' leftovers

An address that still carries the old fragment (`#blobbi-travel=…`, a link
made by an earlier build) has it removed **unread** before the app runs
(`dropLegacyHandoff` in `src/main.tsx`); the ids older builds kept in
`localStorage` (`blobbi:world-travel:handoff-used:v1`) are deleted
(`dropLegacyHandoffStore`). Nothing in a URL moves a Blobbi any more, and the
egress request has no field to attach anything to.

## 5. Tests

- Island: `src/worlds/world-travel-departure.test.ts` (the shared rules over
  a pretend session; the same file as Pixel's `tests/world-travel-departure.test.ts`)
  and `src/worlds/world-travel.nostr.test.tsx` (end to end over in-memory
  relays with real signatures; see `docs/world-travel.md`).
- Home and Pixel: their copies of the departure test and their end-to-end
  suites.
