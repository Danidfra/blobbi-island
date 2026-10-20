# World Travel hand-off: an explicit trip arrives by itself

**Status: IMPLEMENTED 2026-10-19 (option C of the design review), in Blobbi
Island, Blobbi Home and Blobbi Pixel.** No change to `@blobbi-kit`, no new
event kind, no change to the World Location (kind 31126) or to who writes
it. The code is one file kept identical in the three apps:

| App | Shared module | Origin (signs) | Destination (publishes) |
|---|---|---|---|
| Island | `src/worlds/world-travel-handoff.ts` | `WorldTravelProvider` + `useIslandWorldTravel.handoffFor` | `useIslandWorldTravel` |
| Home | `src/features/presence/world-travel-handoff.ts` | `BlobbiOverview`, `RoomPreviewPage` + `useHomeTravel.handoffFor` | `useHomeTravel` |
| Pixel | `src/game/travel-handoff.ts` | none (Pixel has no doors to other worlds yet) | `playground/main.ts` |

## 1. The problem it solves

When the player chooses another world in the Worlds sheet, the origin plays
its departure and the page goes to the destination. Before the hand-off the
destination could not tell that arrival from the player simply opening it,
so it treated the Blobbi as away until the player acted again (two
interactions, or "Bring here"). The protocol forbids anything else on load
(kit `WORLD-TRAVEL.md` §2, §4, §6): a World Location is signed only on the
player's act, and nothing signs on load.

## 2. How it works

1. **The door press is the act.** The origin prepares the World Location the
   destination would write, with the kit's own template builder for the
   destination World (`world = <destination>`, `from` = the canonical World,
   `prev` = the canonical event's id, `created_at` after it), from the
   canonical location it has **confirmed** with the relays (a kept or
   unknown place is never signed over). It asks the account's signer for
   it (`signHandoff`): an nsec login and Pixel's vault sign silently; an
   extension or a remote signer prompts here, where the choice was made.
   The signing starts on the press, while the goodbye plays; the page
   waits for the answer at most `HANDOFF_SIGN_TIMEOUT_MS` (20 s), with the
   departure card saying "Approve the trip in your signer".
2. **The origin publishes nothing.** A refusal, a timeout, Stay, or a
   navigation that fails leaves no event anywhere: the signed event is
   discarded, and an unsent one expires (§3).
3. **The event rides in the fragment** of the one same-tab navigation:
   `https://pixel.blobbi.pet/#blobbi-travel=v1.<base64url JSON>`. A
   fragment is never sent to a server or a log. Island's egress boundary
   carries it for the `world-travel` class only (`egress.ts`, its one
   exception to "nothing carried"); Home's departure appends it to its
   `location.assign`.
4. **The destination removes it from the address before anything else
   runs** (`handoff-capture.ts`, imported first in `main.tsx`; Pixel reads
   it next to its own hash parameters). A reload, Back or a copied address
   never presents it again. It is kept in memory only.
5. **The destination holds it until its own session has confirmed the
   canonical location** with the relays (`resolution: 'confirmed'`; while
   relays are unreachable it keeps holding, and the kit keeps looking). It
   then takes the Web Lock the kit's own moves take, asks the session to
   look once more, and checks everything (§3). Only then does it publish
   the event **as signed** to the travel relays, mark the id used, and ask
   the session to look again. The kit learns its new canonical location as
   a **live** change, so the World's teleport plays the arrival: Island's
   and Home's presence sync `enter()`, Pixel's held entry or its sync.
6. **The destination signs nothing**, ever, because of a URL. If any check
   fails it says nothing and the ordinary rule stands: the Blobbi follows
   the player's play (two interactions) or "Bring here".

## 3. What the destination checks (every one, else dropped)

| Check | Protects against |
|---|---|
| The signature verifies and the event is a valid World Location (`parseWorldLocation` with `verify`) | Forged or tampered events, malformed payloads |
| The author is the signed-in account | Someone else's hand-off, a shared or captured link opened by another player |
| `d` and `a` name the Blobbi this World shows | Another Blobbi of the same account |
| `world` is this World | A hand-off meant for another destination |
| `from` names another World | A move "here from here" |
| `created_at` at most 120 s old (`HANDOFF_MAX_AGE_S`) | Old links, replays after the fact |
| `created_at` at most 60 s ahead (`HANDOFF_MAX_AHEAD_S`) | A far-future event that would pin relays (kit §7b) |
| `prev` is the id of the canonical location just read, `from` is that location's World, and the event replaces it by NIP-01 | A stale intention: the Blobbi moved meanwhile (another device, another tab), or the relays know something newer |
| The id is not already the canonical location (then nothing to do) | A reload or a second tab publishing twice |
| The id was not honoured before on this device (`usedHandoffs`, localStorage, 10 min) | Replay within the freshness window |
| The account is still the signed-in one, right before sending | An account switch during the wait |

Publishing holds the kit's lock name `blobbi-world-travel:<owner>:<d>`, so
it never overlaps `session.travel()` in this page or another tab. It
publishes to every travel relay with a 4 s timeout each; one acceptance is
a move (as for the kit); none is `failed`, said with "Try again", which
sends the same signed event again (never a second signature). Island and
Home show the failure in the away card; Pixel says it once and tries once
more by itself after 5 s. "Bring here" stays available throughout and goes
through the kit's own `travel()`, which looks first and finds
`already-here` if the hand-off did land.

## 4. Security assumptions, plainly

- **A link proves nothing; the owner's signature does.** Any link can
  carry a payload. Only the owner's key can produce an event that passes
  the checks, and that key is asked only on the door press.
- **What a captured link can do:** publish the owner's own decision, once,
  while fresh and still the newest. That is the move the owner chose. It
  cannot move anyone else's Blobbi, cannot move it anywhere else, cannot
  make the destination sign anything, and cannot undo a later move.
- **The public key is in the fragment**, inside the signed event. It is the
  owner's public identity, already on the relays, and the fragment stays in
  the browser (history of the destination's address entry until
  `replaceState`, never a server). No private key, no signer credential, no
  session travels.
- **The kit's invariants hold** although the destination publishes outside
  `session.travel()`: one move in flight per Blobbi (the lock), a fresh look
  before writing and never over a newer location (the `prev`/NIP-01
  checks), only to move the Blobbi to this World, the same signed event on
  a retry, the owner still signed in when sending. The kit then heals
  lagging relays with the canonical event on its own looks, as for any
  move.
- **Nothing signs on load.** The destination's signer is never called by
  the hand-off. An extension user is prompted exactly once per trip, at the
  origin, in context.
- **Refusal is honoured silently.** A player who refuses the prompt still
  travels (the page goes); the Blobbi stays where it was, and the
  destination offers "Bring here".

## 5. Tests

- Island: `world-travel-handoff.test.ts` (payload, address, signing,
  every check, used ids, the arrival controller over a pretend session) and
  `world-travel.nostr.test.tsx` (Home → Island over the in-memory relays
  with real signatures: one publication, nothing signed at the destination,
  one arrival; the same hand-off again; direct opening; wrong World,
  account, Blobbi, tampered, expired, stale; relays refusing then Try
  again; Island → Pixel: signed once at the door, carried in the fragment,
  nothing published; refusal and a silent signer: the page goes without it).
- Home: `world-travel-handoff.test.ts` (the same unit suite) and
  `WorldTravel.test.tsx` (Island → Home over the real router: arrival
  without a signature; departure to Island carrying the fragment; refusal).
- Pixel: `tests/travel-handoff.test.ts` (the unit suite plus the controller
  over the kit's real session: a live change and no signature at the
  destination; relays refusing then retry).

## 6. Deployment order

Readers before writers, so no deploy ever sends a fragment a destination
does not understand: every app's reader is inert until an origin sends
one, and an unknown fragment is ignored by the older builds anyway.
1. Pixel (reader only).
2. Island (reader, then its writer is in the same build; it only matters
   once Home and Pixel read).
3. Home (reader and writer).
Any order works without harm; this one means no trip is ever "half" done.

## 7. Limitations

- Pixel has no departure UI, so a trip from Pixel still ends with two
  interactions or "Bring here" at the destination.
- A hand-off is honoured only once the destination's relays answered; with
  all relays down it is held until they do or it expires, then the ordinary
  rule applies.
- The two alternatives considered (an unsigned fragment with a referrer
  check; the origin publishing the move itself) were rejected: the first
  would let the destination sign on load, the second changes who writes a
  move in the protocol.
