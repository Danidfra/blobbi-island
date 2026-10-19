# World Travel hand-off: automatic arrival after an explicit trip (proposal)

**Status: PROPOSAL, 2026-10-19. Nothing here is implemented.** It needs
changes in Blobbi Home, Blobbi Island and Blobbi Pixel together, and a
decision by the owner on the trust model in §3. The Island-only changes
shipped alongside this proposal (the arrival on entry, the follow threshold
of two, the away card) stand on their own and do not depend on it.

## 1. The problem

When the player chooses another world in the Worlds sheet, the origin plays
its departure and the page goes to the destination. The destination then has
no way to tell this arrival from the player simply opening it, so it treats
the Blobbi as away until the player's act: two meaningful interactions (one
in Pixel after its CONTINUE press) or "Bring here". The player who just
chose to travel has to act again.

The protocol is explicit about why nothing happens on load (kit
`WORLD-TRAVEL.md` §2, §4, §6): a World Location (kind 31126) is signed only
on the player's act, and "no timer, focus, load, subscription or re-render
writes a location". The egress carries nothing to the destination
(`src/external-egress/egress.ts`: "no key, no session, no query string, no
fragment"), and Home's worlds README rules out key sharing, cookies on
`.blobbi.pet` and URL parameters for identity.

So the question is narrower than it looks: **can the destination learn, in a
way it may trust enough, that the player chose to come, without carrying any
identity or secret, and without a load-time signature any link could
provoke?**

## 2. The trust boundary

- Home (`www.blobbi.pet`), Island (`island.blobbi.pet`) and Pixel
  (`pixel.blobbi.pet`) are different origins: no shared `localStorage`,
  `sessionStorage`, IndexedDB or cookies (a cookie on `.blobbi.pet` was
  rejected on purpose). `BroadcastChannel` is same-origin. The only channels
  across the hop are the URL, the `Referer` header and the `Origin`-scoped
  `document.referrer`, and the Nostr relays.
- A URL is public: anyone can write one and put it in a chat, a note, a QR
  code. Whatever travels in it proves nothing about who made it.
- The destination always has, on its own: the player's login (its own), the
  Blobbi's canonical World Location from the relays, and the kit's session
  with every protection (one move in flight, Web Locks across tabs,
  `already-here`, `contended`, `stale`, cooldown after a refusal, no second
  signature for a resend).
- The signer is the real consent boundary for an extension or a remote
  signer: it prompts. For an nsec login the app signs silently, so for that
  player an automatic move is exactly as strong as whatever decided it.

**What is at stake if a forged intention were honoured.** The destination
would sign a move of the player's own Blobbi to the world the player is
opening right now, with the player's own login, once, under cooldown. That
is the same event two taps would produce a moment later. It cannot move
anyone else's Blobbi, cannot move it anywhere else, and cannot sign
anything but a World Location. The harm is therefore small, but it is not
nothing: a link that makes a page sign on load is the thing the protocol
forbids, and an nsec player would never see it happen.

## 3. Two designs

### A. An unsigned, destination-bound, single-use intention (no protocol change)

The origin appends a fragment on the world-travel navigation only:

```
https://pixel.blobbi.pet/#blobbi-travel=v1.<to>.<from>.<a-hash>.<issued>.<nonce>
```

| Part | Meaning |
|---|---|
| `to` | The destination's World id (`blobbi-pixel`). A page that is not that World ignores it. |
| `from` | The origin's World id (`blobbi-island`). |
| `a-hash` | The first 16 hex of `sha256("31124:<owner>:<d>")`: which Blobbi, without naming the owner in the URL. |
| `issued` | Unix seconds. Valid for at most 90 s. |
| `nonce` | 16 random bytes, hex. Single use at the destination. |

The destination honours it only when **all** of these hold, otherwise it
falls back silently to the ordinary follow rule:

1. `to` is this World and the format is exactly v1 (no other parameter is
   ever read; the fragment is removed with `history.replaceState` before
   anything else runs, so a reload or Back does not present it again).
2. `issued` is within 90 s of now, on this clock (a clock skew beyond that
   simply means the ordinary rule).
3. `nonce` was not seen before on this origin (kept in `localStorage` under
   the destination's own key, with the issued time, pruned after 10
   minutes). Two tabs opened from the same link make one move at most: the
   kit's Web Lock already serialises them, and the second finds the Blobbi
   `already-here`.
4. `document.referrer` is the registered origin of `from` (every app keeps
   a registry of the other worlds' checked addresses: Island's `worlds.ts`,
   Home's `worlds.ts`; Pixel needs one). The world-travel navigation is a
   plain `location.assign` with the default referrer policy, so a
   cross-origin navigation sends the origin. Every other way out of the
   apps uses `noopener,noreferrer` (Island's `egress.ts`, Home's egress), so
   a link pasted into a chat and opened from inside an app carries no
   referrer and fails this check. A privacy extension that strips referrers
   makes the hand-off fall back to the ordinary rule, never to an error.
5. The player is signed in, the account owns a Blobbi whose `a` hashes to
   `a-hash`, and that Blobbi is the one the destination shows (its selected
   companion). Nothing is read from the URL about identity.
6. The kit's session has resolved (`confirmed` or `unreachable`), and the
   canonical location names `from` (the Blobbi really was there). A location
   that already names this World means nothing to do; any other World means
   the intention is stale (the Blobbi moved meanwhile) and is dropped.
7. The signer is available. For a prompting signer the destination shows its
   "Approve the request to bring {name} here" cue and the prompt is the
   consent; a refusal suspends casual following for the session as today.
   For an nsec login the move is silent, as every move of that player is.

Then the destination calls `session.travel({ explicit: true })` once, and
the existing arrival plays from the "on the way" cue. Every later
protection is the kit's: one move in flight, `stale` if a newer location
appeared, cooldown after a failure, the same signed event resent once if no
relay accepted.

**What this does not prevent.** A page the player trusts enough to open
cannot be told apart from the real origin if that page is on the same
registered origin (an XSS in Island could forge an Island hand-off). It also
cannot be told apart if the browser sends no referrer and the apps choose to
accept the fragment anyway; the proposal says they must not. And an nsec
player who clicks a crafted link **on the real origin's chat** still gets no
move, because the chat opens links without a referrer.

**Costs.** Island's `performEgress` must carry a fragment for the
`world-travel` class only (a deliberate change to its "nothing carried"
rule, documented; the structural test keeps `location.assign` in that one
file). Home's `useWorldDeparture` and Pixel's title (when it gains doors) do
the same. Each destination adds the reader (~150 lines plus tests). No kit
change, no new kind, no change to 31126.

### B. The origin signs the move (protocol change)

On the door press the origin itself signs the World Location naming the
destination (`world = blobbi-pixel`, `from = blobbi-island`,
`arrival_after = created_at + 2`), publishes it, plays the departure and
navigates. The destination opens, reads the canonical location, finds it
already names itself, and only plays the arrival (`change: historical` on a
first look, so it would need a new rule to play it as a journey when the
event is younger than, say, 30 s and names this World).

- It proves intent cryptographically: the player's own key signed "to
  Pixel" at the moment of the choice.
- It breaks §2 "A World publishes only to move the Blobbi to itself" and §4
  "the previous World needs to do nothing". `planTransfer` and the kit's
  `travel()` only move to `world` (self); the kit would need an explicit
  `travelTo(destination)`.
- For an extension login the prompt moves to the origin, where the door
  press just happened, which is the better moment. The destination then
  signs nothing.
- A failed navigation after a successful publish leaves the Blobbi "in
  Pixel" while the player is still in the Island; the origin's existing
  failure path (`useWorldDeparture` `failed`) would have to call it back
  with a second signed move, or show it away with "Bring here".

This is a kit change (0.12) and a schema-neutral protocol change (the
event is the same; the rule about who writes it changes). It needs the
owner's approval before any code.

## 4. Recommendation

Implement **A** across the three apps, in this order: the destination
readers first (Island, Home, Pixel; each inert until an origin sends the
fragment), then the origin writers (Island's egress, Home's departure).
Readers before writers means no deploy ever sends a fragment a destination
does not understand. Keep **B** as the later, stronger form if the owner
wants cryptographic intent; it is compatible (an origin-signed move simply
makes the destination's `travel()` return `already-here`).

Either way, the ordinary rule stays: a page opened without a valid hand-off
publishes nothing, counts two interactions, and offers "Bring here".

## 5. Tests the hand-off needs (per destination)

- a valid hand-off from the registered origin: exactly one 31126, the "on
  the way" cue, the arrival; nothing signed before the session resolved;
- the same link twice (nonce reuse), a reload, Back: nothing more signed;
- expired (`issued` older than 90 s), malformed, another `to`, another
  Blobbi's `a-hash`, a location that no longer names `from`: nothing signed,
  the ordinary rule applies;
- no referrer, a foreign referrer, an app's own chat opening the link:
  nothing signed;
- signer refusal: nothing written, following suspended, Try again;
- relays unreachable: `unreachable`, the same signed event resent once;
- the fragment is gone from the address before the first paint.
