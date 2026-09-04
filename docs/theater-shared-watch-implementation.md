# Theater: shared watch sessions (implemented)

What exists in the code today for synchronized playback in the Blobbi Island
theater, after Phases 4–8 of the plan in
[`docs/protocol/shared-playback-session.md`](protocol/shared-playback-session.md) §19.

This document describes **implemented behavior only**. Where the implementation
stops short of the protocol document, it says so under
[Known limitations](#8-known-limitations); nothing planned is described here as
done.

The local, single-viewer half of the theater, seats, curtain, player, controls,
is unchanged and documented in
[`docs/theater-local-implementation.md`](theater-local-implementation.md).

---

## 1. Architecture

```
  TheaterControlCard · TheaterControls · TheaterSessionPanel        UI
             │  create · join · leave · end       ▲ SharedWatchState
             ▼                                    │
  useSharedPlayback                                          React, relay I/O
             │  subscribe · publish · reconcile   │
             ├───────────────────────────────┐    │
             ▼                               ▼    │
  src/lib/shared-playback/**        TheaterPlaybackController
  (pure protocol: parse, build,              │
   order, time, authorize)                   ▼
                                     MediaPlayerAdapter → YouTube IFrame API
```

**The UI never touches Nostr.** It calls controller methods, renders a
`TheaterPlaybackSnapshot` and a `SharedWatchState`, and never builds an event,
parses one, compares a revision, calculates drift, suppresses an echo or
authorizes a signer.

**The protocol library never touches the game.** `src/lib/shared-playback/**`
imports nothing but `zod` and Nostr *types*; no React, no DOM, no seats, no
presence, no rendering. `decoupling.test.ts` enforces that by reading the source,
so the rule cannot rot into a comment.

| File | Responsibility |
| --- | --- |
| `shared-playback/constants.ts` | every tuning value from the spec's appendix, in one place |
| `shared-playback/types.ts` | wire types, rejection reasons, `ParseResult` |
| `shared-playback/address.ts` | `31951:<host>:<d>` build/parse/compare |
| `shared-playback/invite-code.ts` | generation (bias-free), normalization, resolution |
| `shared-playback/parse.ts` | validation for both kinds, the security boundary |
| `shared-playback/builders.ts` | unsigned event construction |
| `shared-playback/ordering.ts` | `rev` → `created_at` → `id` total order, dedupe |
| `shared-playback/timing.ts` | expected position, clock offset, drift bands |
| `shared-playback/session-state.ts` | canonical transitions (host) and command folding (guest) |
| `shared-playback/session-client.ts` | the client state machine: believe / ignore / apply |
| `shared-playback/publish.ts` | publication sequence, rev reserve/commit/release, retry, coalescing |
| `shared-playback/errors.ts` | the user-facing error model |
| `hooks/useSharedPlayback.ts` | the only place protocol meets relay and player |
| `components/blobbi/theater/TheaterSessionPanel.tsx` | create / join / code / leave |

---

## 2. Implemented event shapes

### 2.1 Kind 31951, canonical session state

Exactly as built by `buildSessionEvent`:

```jsonc
{
  "kind": 31951,
  "created_at": 1785195091,
  "content": "{\"version\":1,\"rev\":0,\"media\":{\"provider\":\"youtube\",\"id\":\"dQw4w9WgXcQ\"},\"playback\":{\"state\":\"paused\",\"position\":0,\"updatedAt\":1785195091968,\"rate\":1},\"permissions\":{\"mode\":\"host-only\"}}",
  "tags": [
    ["d", "8018e024-5f59-4ffe-aa04-be3f77fdf7f2"],
    ["r", "blobbi-island:theater:main"],
    ["c", "UZYHVY"],
    ["t", "shared-playback"],
    ["t", "youtube"],
    ["provider", "youtube"],
    ["media", "dQw4w9WgXcQ"],
    ["status", "active"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback session in the Blobbi Island theater"],
    ["expiration", "1785209491"]
  ]
}
```

* `d`: `crypto.randomUUID()`, one per session, never reused.
* **Session address**: `31951:<host-pubkey-hex>:<d>`, built by `sessionAddress()`.
  The host pubkey is the event's author; it is *in* the address, which is why
  authority needs no extra tag and why a session's host can never change.
* `expiration`: `now + 4 h`, rewritten on **every** publish including keepalives;
  `now + 10 min` on the terminal event.
* `alt` on the terminal event is `Shared playback session ended`.

### 2.2 Kind 21951, ephemeral command

```jsonc
{
  "kind": 21951,
  "created_at": 1785195777,
  "content": "{\"version\":1,\"command\":\"seek\",\"rev\":2,\"position\":10,\"updatedAt\":1785195777123,\"rate\":1,\"reason\":\"skip-forward\"}",
  "tags": [
    ["a", "31951:a9d4…3f19:8018e024-5f59-4ffe-aa04-be3f77fdf7f2"],
    ["p", "a9d4…3f19"],
    ["t", "shared-playback"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback command: seek"],
    ["expiration", "1785195807"]
  ]
}
```

Implemented variants: `play`, `pause`, `seek`, `set-media`, `set-rate`,
`end-session`. **Every position is the absolute result**: `+10 s` at 0 publishes
`position: 10`, never `{skip: 10}`. `reason` is presentation metadata; no
behavior depends on it.

A relay hint is written as the `a` tag's third element when one is configured;
this client currently passes none (it is pinned to a single relay, §8).

---

## 3. Invitation codes

* Alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 glyphs; `0 O 1 I L` excluded),
  length 6 ⇒ 887 503 681 codes.
* Generated with **rejection sampling**: bytes ≥ 248 are discarded rather than
  folded in, which would have made the first 8 glyphs measurably more likely.
* Published uppercase as the indexed `c` tag; input is trimmed, uppercased and
  stripped of spaces/dashes, then matched **exactly**.
* Before publishing, the host queries `#c` and regenerates on a live collision,
  up to 5 attempts. This is best-effort by construction: two hosts can still
  race, which is why resolution refuses to guess.
* Resolution (`resolveInviteCode`) drops candidates that fail validation, whose
  `c` does not match exactly (a relay may over-match its own filter), that are
  `ended`, or that are expired. One survivor joins. Several survivors are
  reported as **ambiguous**: "That code matches more than one session right
  now": unless one is from the same host and clearly newer (> 60 s).
* **The code is not a password.** It is an indexed tag on a public relay and is
  enumerable. The UI never presents it as a secret, and knowing it grants no
  write capability.

---

## 4. Authority: the command matrix

Authority is enforced by signature at parse time (`parseCommandEvent`), not by
the UI. Global controls are **absent** from the guest surface rather than
disabled, so ownership of the screen is legible at a glance.

| Control | Host | Guest | Synchronized | Enforcement |
| --- | --- | --- | --- | --- |
| play, pause | ✅ | ❌ not rendered | ✅ | `event.pubkey === host` |
| timeline seek, ±10 s, restart | ✅ | ❌ not rendered | ✅ | `event.pubkey === host` |
| change media | ✅ | ❌ not rendered | ✅ | `event.pubkey === host` |
| change rate | ✅ | ❌ not rendered | ✅ | `event.pubkey === host` |
| end session | ✅ | ❌ not rendered | ✅ | only the host can publish `31951` for its own address |
| leave session | ✅ (ends it) | ✅ |, | local |
| volume, mute | ✅ | ✅ | ❌ never | local |
| fullscreen | ✅ | ✅ | ❌ never | local |
| captions | ✅ | ✅ | ❌ never | local |

An event is refused, silently and with a debug reason, when any of these fail:

| Refusal | Reason code |
| --- | --- |
| not our session address, or two `a` tags | `wrong-session` / `missing-tag` |
| signer is not the host in that address | `unauthorized-signer` |
| `rev ≤ lastAppliedRev` | `stale` (ignored) |
| expiration passed | `expired` |
| unknown `command`, wrong `version` | `unknown-command` / `unsupported-version` |
| position, rate or revision out of bounds | `bad-position` / `bad-rate` / `bad-revision` |
| media this client cannot play | `unsupported-media` |
| session already ended | `ended` |
| `\|updatedAt − created_at×1000\| > 5 min` (31951) | `clock-inconsistent` |

Only two of these reach the user: an unauthorized command ("Ignored a playback
command that was not signed by the host") and an unsupported schema version.
The rest are relay noise.

---

## 5. Playback synchronization

### 5.1 Expected position

```
paused:   expected = position
playing:  elapsedMs = now − clockOffsetMs − updatedAt        (clamped to [0, 24 h])
          expected  = position + (elapsedMs / 1000) × rate
always:   expected  = clamp(expected, 0, duration > 0 ? duration : ∞)
```

`updatedAt` is milliseconds; `created_at` is never used for playback math.

### 5.2 Clock offset

Passive, no round trips: every accepted event from the host contributes
`receivedAtLocalMs − updatedAt`; the estimate is the **median of the last 8**,
clamped to ±5 min, reset when the tracked session changes. Observed on the local
relay: **9–17 ms** in steady state.

### 5.3 Drift correction

A local check every 5 s that **publishes nothing**: no network event is ever
produced by a drift check, on host or guest.

| drift | action |
| --- | --- |
| < 0.75 s | ignore |
| 0.75 – 2.0 s | wait one tick and re-evaluate |
| > 2.0 s | seek to the expected position |

Correction is suspended entirely while the player is buffering, while it is not
ready, while the device cannot match the session's rate (otherwise an
unmatchable rate would seek forever), and for 2 s after any corrective seek.
A `playing` state whose expected position has run past the end is treated as
finished, not as a seek target.

**The host is never corrected.** Canonical position is *derived from* the host's
player (§5.1), so correcting the host toward it is a loop with nothing outside
it: the moment the two disagree, a play started from the provider's own controls
publishes nothing, so canonical still says "paused at 0": the check drags the
host's player back, every tick, forever. That was a real, reported bug ("jumps
back to the beginning every few seconds"). The host stays honest through the
keepalive instead, which re-anchors canonical **from the live player** every 20 s;
while the host has no player at all (standing up), the anchor is extrapolated so
the session keeps running for everyone else.

**Readings come from the player, not from React.** Both the drift check and the
keepalive refresh the controller before reading it. A rendered snapshot can be a
frame: or, in a throttled background tab, many seconds, behind, and measuring
drift against a stale position turns render lag into a seek.

### 5.4 Echo suppression

Every player action is classified, and exactly one class is published:

| origin | published | how |
| --- | --- | --- |
| local user pressed a control | **yes**, when hosting | default path |
| remote command being applied | no | suppression counter held across the call |
| drift correction being applied | no | same counter |
| player re-announcing the same media (retry, remount) | no | `set-media` for the current media id is dropped |

Guests never publish at all: `onLocalCommand` returns early unless the mode is
`hosting`.

---

## 6. Lifecycle

```
no session
   │ create ─────────────────────────────────────────────┐
   ▼                                                     │
hosting  ── invitation code shown ── guest joins ── commands flow
   │                                     │               │
   │ end session                         │ leave         │ host disappears
   ▼                                     ▼               ▼
terminal 31951 (status: ended)     guest → local    guests keep extrapolating;
short expiration, guests told      player kept      "host may have disconnected"
```

* **Create**: `rev 0`, paused at 0, rate 1, around media already on screen.
  Awaited and retried; until it lands there is no session.
* **Publication order per action**: compute one snapshot → apply optimistically
  to the host's own player → publish `21951` (fire-and-forget) → publish `31951`
  (awaited, retried 3× with the same `rev`/`position`/`updatedAt`) → commit `rev`.
* **Reserve / commit / release**: a revision is committed only when the
  addressable publish is accepted. A permanently failed publish releases it, so
  the next action reuses the number instead of publishing `rev + 2` at a relay
  still holding `rev − 1`. Verified by test and observable in the log.
* **Rate limiting**: control publishes are coalesced to one per 3 s. Coalescing
  is lossless because every command is an absolute state; the pending publish is
  superseded by the newer one and revisions stay gapless.
* **Keepalive**: every 20 s the host republishes the current state at the
  **same `rev`** with a refreshed expiration and a re-anchored
  `updatedAt`/`position`. Guests hold that revision, so it is a no-op for them;
  a late joiner reads a fresh, accurate anchor.
* **End**: `21951 end-session` then a terminal `31951` (`status: ended`,
  paused, final position, 10 min expiration). Guests stop synchronizing, keep
  their player exactly where it is, and are told the host ended the session.
* **Standing up, walking, changing seats**: nothing happens to the session OR
  the screen. The control card disappears (it lives on the chair), and that is
  all: the same player keeps playing on the same iframe, the curtain stays up,
  the playhead keeps moving, and sitting down anywhere brings the card back with
  no rebuild and no catch-up seek. Membership is tied to explicit actions and to
  the room, never to a chair; it used to be tied to `seatId`, and a host that
  stood up silently lost the session only its own pubkey could ever author.
* **Watching alone is different, deliberately.** With no session attached,
  standing up still destroys the player and closes the curtain: walking away
  from your own film should stop it. Only a shared session, which is still
  playing for other people, keeps the screen alive without you in a chair.
* **Leaving the theater**: the one implicit way out: `PlayingView` clears the
  presence reference and forgets the session as the location changes, so walking
  back in starts clean rather than silently rejoining.
* **Host abandons without ending** (tab closed): nothing is published. Guests
  keep extrapolating the last canonical state, which for a playing session stays
  correct, and after 90 s without a canonical update the UI says the host may
  have disconnected. The session disappears on its own at `expiration`.

### 6.1 Reconnect and recovery

* The subscription reconnects in a loop while a session is open. Each attempt
  **re-queries the canonical event first**, because anything missed while the
  socket was down is recoverable from that one event and from nothing else.
* Ephemeral commands are never recovered; they are not stored, are not needed,
  and a client that waits for them is a client that never recovers.
* `visibilitychange → visible` forces an immediate re-query rather than trusting
  a throttled timer.
* No canonical update for 90 s ⇒ re-query plus a "host may have disconnected"
  hint; playback continues.
* A guest that missed every single command still converges: in the two-user run
  below, **every** applied change arrived through `31951`, with the matching
  `21951` correctly no-op'ing as already applied.

---

## 7. Presence integration

Presence (kind `31950`) gained one optional field, `activity`:

```jsonc
{ "state": "idle", "location": "stage", "anchor": { … }, "seq": 35,
  "seatId": "theater-seat-c5",
  "activity": { "type": "shared-playback", "session": "31951:<host>:<d>" } }
```

It carries the **address string only**: no revision, no position, no media, no
host name. Presence answers "which shared activity is this visible player in?";
the session event answers everything else. Neither is authoritative for the
other, and the theater UI is the only place they meet.

Observed lifecycle on the wire (real two-identity run, `seq` values verbatim):

| `seq` | event | `seatId` | `activity` |
| --- | --- | --- | --- |
| 34 | sat down | `theater-seat-c5` |, |
| 35 | created the session | `theater-seat-c5` | set |
| 36 | heartbeat | `theater-seat-c5` | preserved |
| 37 | walked away |, (stood up) | **preserved** |
| 38 | left the session |, | **cleared** |
| 39 | arrived at another seat | `theater-seat-a2` |, |

### 6.2 Three lifetimes, not one

| fact | governs |
| --- | --- |
| `isSeated` (`seatId`) | the control card, and the Blobbi drawn in a chair |
| `hasActiveSharedSession` | whether the screen survives standing up |
| `isInTheater` | whether any of it exists, leaving the room ends everything |

The theater's state machine takes a `retain` flag on `sit`/`stand` (set by
`TheaterStage` from the session mode) and, when it is set, moves ONLY `seatId`,
`status`, `request` and `error` carry straight across. The card keys on `seatId`;
the player keys on `request`; the curtain still keys on `status === 'video-ready'`,
so it opens for a ready player and never merely because a session exists.

---

### 7.1 Movement and participation are different claims

* **`seatId` is a claim about sitting still**, so movement clears it; that is
  what stands a Blobbi up on every other screen.
* **`activity` is a claim about being in the room**, so movement preserves it.
  Standing up, crossing the theater and changing seats all keep the session, and
  a walker never blinks out of the participant list.

Only two things clear `activity`: the explicit Leave/End buttons (an `idle`
event, since there is no movement to preserve) and leaving the location.

That also means **no cleanup event ever follows a walk**, which is what keeps the
movement canonical. An `idle` clear published a tick after a `moving` event
carries a higher `seq` and no `goal`, and presence is ordered by `seq`: every
remote client would take it as the last word and freeze the Blobbi mid-aisle.

Observed on the wire, changing seats mid-session (verbatim):

| `seq` | `state` | `seatId` | `activity` | `goal` |
| --- | --- | --- | --- | --- |
| 10 | `idle` | `theater-seat-a4` | set |, |
| 11 | `moving` |, | **set** | yes |
| 12 | `idle` (heartbeat, standing) |, | **set** |, |
| 13 | `idle` (arrival) | `theater-seat-a5` | **set** |, |
| 18 | `idle` (End session) | `theater-seat-a5` |, |, |

The participant count in the UI is derived from live presence (players in the
room claiming the same session address, plus you). It is advisory and
self-expiring: the session event carries no participant list by design.

---

## 7.2 Fullscreen and session ownership

Fullscreen is a **local, per-device** control (§4) and must never touch a
session. Two rules make that true:

* **Fullscreen ownership is per element.** `useFullscreen` asks "is *my* element
  the fullscreen element?", not "is anything fullscreen?". The theater's control
  fullscreens the YouTube **iframe**, and the shell no longer mistakes that for
  its own fullscreen and reshapes itself around a video it never fullscreened.
* **The shell changes presentation, never its tree.** `BlobbiAppShell` and
  `BlobbiFrame` used to `return` structurally different trees for the framed and
  fill-screen layouts. React identifies state by position, so every fullscreen
  toggle unmounted the whole game and mounted a new copy: the Blobbi reappeared
  at its spawn point, the seat was gone, the player was destroyed, presence
  minted a new session id, and a host silently lost the session it had created.
  Both components now render one tree whose classes and props change.

**Host ownership across an accidental remount.** Even with that fixed, a host
that lost its React state would be locked out of a session only it can author,
and nobody else could take it over, because authority is the author's pubkey. So
the tab remembers which session it is in (address, host, role, code) in a
module-level map, and on mount re-attaches by reading the **latest canonical
`31951` from the relay**: a resumed host adopts that event's revision and
continues from it, a resumed guest reconstructs exactly as a fresh joiner would.

It is deliberately **in memory only**: no `localStorage`, so a page reload is
still a clean slate, and every intentional exit (leave, end, standing up,
leaving the room) deletes the entry, so it can never revive a session the user
chose to leave.

---

## 8. Known limitations

1. **No session persistence across a page RELOAD.** An accidental remount is
   recovered (§7.2), but a reload returns the client to local mode and rejoining
   means re-entering the code. Reconstruction itself is sound, a single `31951`
   query restores the exact state, verified, but the address is held in memory
   only, deliberately.
2. **The first clock sample after joining is biased.** The join reads a *stored*
   canonical event, which can be up to one keepalive interval (20 s) old, so the
   first offset sample includes that age; measured 7.5 s on a rejoin. It decays
   as live keepalives dominate the median (~5 keepalives), and it is harmless
   while paused. A future revision could exclude the query-time sample.
3. **A host stall is corrected by the keepalive, not immediately.** The host is
   never seeked by the drift check (§5.3), so a host that buffers falls behind
   its own published anchor until the next keepalive re-states it from the live
   player: up to 20 s. Guests are briefly ahead in that window.
4. **Single relay.** `NostrProvider` pins reads and writes to one relay, so a
   session is only visible to clients on the same relay. The `a` tag has a relay
   hint slot; nothing fills it yet.
5. **Guest desynchronization through the native player is not surfaced.** A guest
   who pauses via YouTube's own controls is corrected by the next drift check
   (position) but gets no "Rejoin" affordance, and `localOverride` is not
   modelled separately.
6. **No co-hosts, no guest requests, no voting, no encrypted invitations.** v1 is
   host-only by decision; `permissions.mode` exists so a later mode is additive.
7. **Ambiguous codes are refused, not chosen.** The UI reports "That code matches
   more than one session" instead of offering a chooser.
8. **Moderation.** The theater has an open catalog (a product decision recorded
   in the local implementation doc), so the protocol's optional curated-catalog
   check (§4.4 (13)) has no catalog and is deliberately not implemented. Media
   is validated by shape only.

### 8.1 One clarification against the specification

The spec asks for a keepalive that republishes "the current canonical state" at
the same `rev` (§12.3) *and* for receivers to reject any `31951` whose
`updatedAt` differs from `created_at` by more than 5 minutes (§4.4 (10)). A
byte-identical keepalive therefore becomes **invalid to every receiver** after
five minutes: exactly during the long pauses the keepalive exists to survive.

The implementation resolves this the only way that satisfies both rules: the
keepalive keeps `rev`, media, play/pause and rate, and refreshes `updatedAt`,
re-anchoring `position` to the value the previous anchor already implies when
playing, and leaving it untouched when paused. The described timeline is
unchanged (extrapolating either anchor to the same instant gives the same
playhead), guests treat it as the no-op it is, and late joiners get a fresher
anchor. Nothing else in the protocol was altered.

---

## 9. Tests

Offline, no browser, no relay (`src/lib/shared-playback/*.test.ts`, 190 tests):

* `parse.test.ts`: one test per numbered validation rule in §4.4 and §5.4, plus
  round trips of all 16 worked examples from the specification.
* `invite-code.test.ts`: alphabet, rejection sampling, statistical uniformity,
  normalization, and every branch of the resolution algorithm.
* `timing.test.ts`: paused/playing/rate-aware position, clamping, absurd
  elapsed times, clock-offset median and window, drift bands at 0.5/0.75/1/2/3 s,
  the full ordering triple and the dedupe window.
* `session-client.test.ts`: transitions, command folding, keepalive
  re-anchoring, and the ingestion rules (stale, duplicate, out-of-order, foreign
  host, ended, not-yet-ready).
* `publish.test.ts`: sequence order, one snapshot for two events, veto,
  coalescing, gapless revisions, retry with identical content, revision released
  on failure, keepalive behavior, terminal publish.
* `decoupling.test.ts`: the dependency direction, by reading the source.

With React and a fake player (`TheaterSession.test.tsx`, 20 tests): seating gate,
exactly one session under Strict Mode, paired publication, presence reporting,
guest surface, curtain gating, remote apply without echo, single player per media
change, unauthorized command ignored, terminal behavior, leave and stand-up.

Presence (`multiplayer.activity.test.ts`, 21 tests): what `activity` carries,
what it never carries, its lifecycle across sit/move/heartbeat/leave, and the
parser's tolerance of hostile content.

---

## 10. Manual two-user validation

**Setup.** Two real Nostr identities, two browser contexts kept apart by origin
(`localhost:5183` and `localhost:5184`, giving independent `localStorage` and
therefore independent logins), both pointed at a **local in-memory relay**
(`nak serve`, `ws://127.0.0.1:10547`) so nothing was written to a public relay.
Both loaded the real `/dev/theater` harness, which mounts the real `PlayingView`,
`MultiplayerLayer`, seats and `TheaterStage`. Media: `dQw4w9WgXcQ` (3:33).
Every event below was read back from the relay with `nak req --stream`.

| # | Step | Result |
| --- | --- | --- |
| 1 | A enters the theater and sits (`theater-seat-a4`) | seated, card shown, **nothing published** by sitting |
| 2 | A loads the video, creates a session | ✅ |
| 3 | Session events published | **exactly one** `31951`, `rev 0`, `paused`, `position 0`, `rate 1`, `permissions.host-only` |
| 4 | Invitation code displayed | `UZYHVY`: 6 glyphs from the alphabet, matching the `c` tag |
| 5 | B sits (`theater-seat-a6`) and joins with the code (typed lowercase) | ✅ resolved and joined |
| 6 | B resolved the right host and session | address `31951:a9d4…3f19:8018e024-…`, host = A |
| 7 | Both load the same media | both iframes on `dQw4w9WgXcQ`; B never typed a URL |
| 8 | A presses play | `21951 play rev 1` + `31951 rev 1 playing`, same `rev`/`position`/`updatedAt`; B applied it |
| 9 | A pauses | `rev 4 paused @ 20`; B applied |
| 10 | A seeks (+10 twice) | published **absolute** `position: 10` then `20`; B applied both |
| 11 | Restart, rate 1.5× | `rev 5 seek @ 0` (applied on B via the **ephemeral** path), `rev 7 set-rate 1.5`; guest surface stayed read-only throughout |
| 12 | Echo / flood check | B published **zero** events for the whole session; peak host traffic 4 events per 10 s |
| 13 | Reload B, reconstruct | B rejoined and reconstructed `rev 9, paused, position 10` from a **single** `31951`, with no command replay |
| 14 | Commands issued while B was away | `rev 8` and `rev 9` were published with B disconnected; B converged on rejoin (row 13) |
| 15 | Old and duplicate commands | stale `seek rev 3` → ignored (`stale`); expired command → `expired`; malformed `position` → `bad-position`; none reached the player |
| 16 | Unauthorized command from a third identity | rejected as `unauthorized-signer`; UI: "Ignored a playback command that was not signed by the host"; playhead untouched |
| 17 | B leaves | back to `Watching locally` with its own player intact and host controls for its own screen |
| 18 | A ends the session | terminal `31951 status: ended` + `21951 end-session`; B showed "The host ended this watch session", kept its player, and ignored the trailing command |
| 19 | Standing up | seat cleared, session left, presence `activity` cleared (seq 37 → 38), player destroyed (**0 iframes**), curtain closed |
| 20 | Seating unaffected | both Blobbis rendered seated and rear-facing throughout; participant count tracked 1 → 2 → 1 correctly |

**Relay event counts** (26.6 min window, in-memory relay, two identities):

| kind | count | notes |
| --- | --- | --- |
| `31951` | 50 | across three sessions; for session `UZYHVY`: `rev 0`×11, `rev 1–6`×1 each, `rev 7`×11, `rev 8`×2, `rev 9`×6, `rev 10`×1, the repeats are 20 s keepalives at the **same revision**, as designed |
| `21951` | 15 | 14 from the host, 1 from the injected third-party key (the unauthorized test) |
| `31950` | 146 | presence for 4 session keys over 26 min, heartbeat cadence, no flood |

Ordering identifiers were verified directly: revisions strictly increased per
action, keepalives repeated the same revision, and presence `seq` ordered the
stand-up sequence (35 → 36 → 37 → 38 → 39) independently of `created_at`.

### 10.3 Standing up with a session, validated in a browser

Two identities, local relay, deterministic in-browser player, session `2DK3X7`.

| | host (walked a4 → a6) | guest (walked c4 → c5) |
| --- | --- | --- |
| card while standing | hidden | hidden |
| iframe node | `fake-player-1` throughout | `fake-player-1` throughout |
| curtain while standing | open | open |
| playhead while standing | 18.8 → 22 s, playing | 122.7 → 125.5 s, playing |
| after sitting | card back, `hosting`, code `2DK3X7` | card back, `joined`, code `2DK3X7`, no code re-entry |
| players constructed | 1 | 1 |
| corrective seeks caused by the seat change | **0** | **0** |

The canonical anchor kept advancing straight through both walks (0 → 16.9 → 36.9
→ 56.9 → 76.9 → 96.9 → 116.9, one keepalive each 20 s), and presence showed
`seq 8 moving` (seat cleared, activity kept) → `seq 9` arrival at the new seat
with the same activity. Ending the session published rev 2 `status: ended`, after
which **standing up destroyed the player and closed the curtain again**: local
rules, restored the moment the session ended. Counts for the run: `31951` ×9,
`21951` ×2, `31950` ×28.

### 10.2 Session lifecycle and sync, validated in a browser

The media CDN is unreachable from this sandbox, so this pass ran the real shared
controller, the real relay and the real UI against a **deterministic fake player**
injected into the page, a player whose clock actually runs. That is explicitly
not YouTube playback; it exercises the timing loop, not the provider.

| # | Step | Result |
| --- | --- | --- |
| 1–2 | Host creates a session (code `2RQQAX`), guest joins | ✅ |
| 3–5 | Host plays; both observed for 30 s | host 233 → 262 s, guest 182 → 209 s, **zero seeks on either** |
| 6 | Host walks to another seat | stays `hosting`, same code, rebuilt player seeked **once** (to 19 s) and resumed playing; not at zero |
| 7 | Guest walks to another seat | stays `joined`, same code, **no code re-entry**, rebuilt player caught up and kept playing |
| 8 | Anchor while the host is out of the chair | keepalives keep advancing (39.9 → 99.9 → 159.9 → 219.9 → 279.9), so the session does not stop for everyone else |
| 9–10 | Host controls after the seat change | play/pause/seek still publish, revisions continue from the same session |
| 11 | Fullscreen | unchanged from §10.1, same session, same player |
| 12 | Leaving the theater | clears the presence reference and forgets the session (covered by test; the dev harness pins the location) |
| 13 | Explicit End session | terminal `31951` `status: ended` at rev 2, `end-session` command, host back to `Watching locally` with its player intact |
| 14 | Event flood | none; see counts below |

**Presence trace across a seat change** (`seq` verbatim, host):

| `seq` | `state` | `seatId` | `activity` | `goal` |
| --- | --- | --- | --- | --- |
| 10 | `idle` | `theater-seat-a4` | set |, |
| 11 | `moving` |, | **set** | yes |
| 12 | `idle` |, | **set** |, |
| 13 | `idle` | `theater-seat-a5` | **set** |, |
| 18 | `idle` (End session) | `theater-seat-a5` |, |, |

**Event counts** for the whole follow-up run (three sessions, ~25 min):
`31951` ×32 (creations, one control revision each, 20 s keepalives, one terminal),
`21951` ×4, `31950` ×83. No burst exceeded the previous run's peak.

**Environment caveats.** The occluded automation window throttles background
timers: two keepalives landed 60 s apart instead of 20 s, which is why the guest
in the 30 s window sat a constant ~50 s behind the host rather than converging,
it was following the newest anchor it had been given. With the tab visible the
20 s cadence holds. A real fullscreen GRANT still cannot be produced by
automation.

### 10.1 Blocker fixes, validated in a browser

Same harness, plus one change: `/dev/theater` now mounts the **real app shell**.
It previously rendered `PlayingView` in a bare `div`, which is why a fullscreen
bug that reset the entire world had been invisible to it.

**Standing up out of a hosted session, the exact `31950` sequence**

| `seq` | `state` | `seatId` | `activity` | `anchor` | `goal` |
| --- | --- | --- | --- | --- | --- |
| 8–11 | `idle` (heartbeats) | `theater-seat-a4` | set | 32.9 / 87.6 |, |
| 12 | `moving` |, |, | 32.9 / 87.6 | 32.9 / 87.6 → 87.5 / 77.6 |

The second client sampled the host being rendered at
32.9 / 87.6 (seated) → 72.9 / 76.6 → 87.5 / 77.6 and finally seated at
`theater-seat-c9`: the walk animated to completion, the session was left exactly
once, the player was destroyed, and no cleanup event followed the movement.
(One `idle` heartbeat did land a second into the walk carrying neither field;
heartbeats publish the player's current target position and have always done so,
independent of sessions.)

**Fullscreen: before and after, same simulated grant**

The browser refuses fullscreen to automated clicks (no genuine user activation),
so both real clicks exercised the refusal path, and the grant was simulated by
setting `document.fullscreenElement` and firing `fullscreenchange`: which is
precisely the signal the application reacts to.

| observation | before the fix | after the fix |
| --- | --- | --- |
| `performance.getEntriesByType('navigation')` | 1, type `navigate` | 1, type `navigate` |
| `beforeunload` fired | 0 | 0 |
| `history.pushState` calls | 0 | 0 |
| seat after entering fullscreen | **lost** (`null`) | `theater-seat-a4` |
| Blobbi position | **50 % / 75 % (spawn)** | 32.8872 % / 87.6471 % |
| watch session | **dropped** (`null`, code gone) | `hosting`, code unchanged |
| control card | **gone** | present, `video-ready` |
| iframes / same DOM node | **0**, node replaced | 1, same node |
| presence session id | new id minted | unchanged |

So the page never reloaded and never navigated: it was a **remount**, and it is
gone. Exiting fullscreen restores the framed chrome with the same player. The
theater's own (iframe) fullscreen no longer moves the shell at all.

**Not exercised in this environment.** The sandbox could not reach YouTube's
media CDN, so both players sat in `BUFFERING` and no frames ever advanced. That
means observed playhead convergence, real drift correction and the hard-seek
threshold were **not** verified against a moving video; everything about them is
covered by unit tests only. Note also that the guest's player deferred
reconciliation exactly as designed while not ready (`pendingApply`), which is why
the reconcile trace shows a single forced reconcile at join and none afterwards.
Three further environment notes: an embed loaded from the `127.0.0.1` origin was
refused by YouTube (the same video loaded fine from `localhost`); a real
fullscreen GRANT cannot be produced by automation and still needs a human in a
visible window; and an occluded automation window throttles timers, two keepalives landed 40–109 s apart instead
of 20 s, which is browser throttling, not a protocol failure.
