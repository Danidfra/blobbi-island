# NIP.md — Blobbi Island Custom Event Kinds

This document describes the custom Nostr event kinds used by **Blobbi Island**, a
Nostr-native virtual creature game. Some of these kinds are co-authored with the
**Ditto** backend, which acts as the canonical source of truth for game state and
may set additional tags not produced by this client. This client preserves unknown
tags when republishing replaceable/addressable events.

All custom kinds include a NIP-31 `alt` tag where applicable to provide a
human-readable description for clients that do not understand the kind.

## Summary

| Kind | Name | Class | Purpose |
|------|------|-------|---------|
| `1124` | Blobbi Social Interaction | Regular | Append-only log of care/social actions (feed, play, etc.) |
| `11125` | Blobbonaut Owner Profile | Replaceable | Player profile: coins, owned pets, achievements, current companion |
| `31124` | Blobbi Pet State | Addressable | Full state of a single Blobbi creature (stats, appearance, care timestamps) |
| `31632` | Game Item Definition | Addressable | Canonical item catalog (official issuer). See `@nostr-games/inventory`. |
| `31633` | Game Inventory | Addressable | Player consumable inventory. See `@nostr-games/inventory`. |
| `31950` | Island Presence | Addressable | Real-time multiplayer presence (location, position, movement) |
| `21201` | Island Chat | Ephemeral | In-world speech-bubble chat messages |
| `31951` | Shared Playback Session | Addressable | Canonical state of a synchronized watch session (theater) |
| `21951` | Shared Playback Command | Ephemeral | Low-latency playback commands for a watch session |

### Legacy / superseded kinds (queried for backward compatibility, not written)

| Kind | Superseded by | Notes |
|------|---------------|-------|
| `14919` | `1124` | Old interaction kind from the original NIP-BB draft |
| `31125` | `11125` | Old owner-profile kind |

---

## Kind 1124 — Blobbi Social Interaction (Regular)

Append-only record of an interaction a player performed on a Blobbi (feeding,
playing, cleaning, etc.). Used as an audit/history log; the resulting state change
is reflected in the corresponding kind `31124` event.

- **`content`**: optional freeform text or empty string.
- **Tags**:
  - `["a", "31124:<pubkey>:<blobbiD>"]` — the Blobbi this interaction targets.
  - `["t", "<interaction-type>"]` — e.g. `feed`, `play`.
  - `["client", "blobbi-island"]`.
  - `["alt", "<human-readable description>"]`.

---

## Kind 11125 — Blobbonaut Owner Profile (Replaceable)

The player's account/profile. One per pubkey. Co-authored with Ditto; unknown tags
(e.g. `xp`, `level`, progression markers) are preserved by this client.

- **`content`**: optional; canonical structured fields are carried in tags.
- **Notable tags** (non-exhaustive):
  - `["coins", "<number>"]`
  - `["current_companion", "<blobbiD>"]`
  - `["starter_blobbi", "<blobbiD>"]`
  - `["favorite_blobbi", "<blobbiD>"]`
  - `["pet", "<blobbiD>"]` (repeatable — owned pets)
  - `["achievement", "<id>"]` (repeatable)
  - `["alt", "Blobbonaut owner profile"]`

> **Note:** The player's consumable inventory is **no longer stored on kind
> 11125**. It lives in **kind 31633** (Game Inventory). This client does not
> write inventory tags into 11125.

---

## Kinds 31632 / 31633 — Game Item Definition & Game Inventory

Blobbi Island uses the framework-independent
[`@nostr-games/inventory`](https://www.npmjs.com/package/@nostr-games/inventory)
protocol for items and inventory. That package is the source of truth for the
tag schema, parsing, validation, and quantities.

- **Kind 31632 — Game Item Definition** (addressable, `31632:<issuer>:<d>`):
  the canonical item catalog. Blobbi's official items are signed by the official
  issuer `9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9` and
  use `d` values of the form `blobbi:<category>:<slug>` (e.g. `blobbi:food:apple`).
  This client only trusts definitions from the official issuer.
- **Kind 31633 — Game Inventory** (addressable, `31633:<owner>:<d>`): the
  player's inventory. Blobbi Island uses a single per-user inventory with
  `d = "blobbi:island"`. Item references are `a` tags pointing at 31632 item
  addresses with decimal-integer quantities.

See `docs/INVENTORY_ARCHITECTURE.md` for the full Island architecture.

---

## Kind 31124 — Blobbi Pet State (Addressable)

Full state of an individual Blobbi creature. Addressable by
`31124:<pubkey>:<d>` where `d` is the Blobbi's stable id. Co-authored with Ditto;
unknown tags are preserved.

- **`d`**: the Blobbi id.
- **`content`**: optional.
- **Notable tags** (non-exhaustive):
  - Identity: `["name", ...]`, `["stage", "egg"|"baby"|"adult"]`, `["generation", ...]`, `["adult_type", ...]`
  - Stats (0–100): `["hunger", ...]`, `["happiness", ...]`, `["health", ...]`, `["hygiene", ...]`, `["energy", ...]`
  - Progress: `["experience", ...]`, `["care_streak", ...]`
  - Appearance: `["base_color", ...]`, `["secondary_color", ...]`, `["eye_color", ...]`, `["pattern", ...]`, `["special_mark", ...]`
  - Personality: `["personality", ...]`, `["trait", ...]`, `["mood", ...]`
  - Behavior: `["is_sleeping", "true"|"false"]`, `["is_dirty", ...]`, etc.
  - `["alt", "Blobbi pet state"]`

---

## Kind 31950 — Island Presence (Addressable, NIP-40 Expiration)

Real-time multiplayer presence. Each browser session publishes one addressable
event keyed by session id, renewed by a heartbeat (~25s) and expiring via NIP-40
(~35s) so stale players disappear automatically. Movement is broadcast as a
*goal* (start/end/velocity/timestamp); each client interpolates remote motion
locally rather than streaming positions.

- **`d`**: `session:<uuid>` — one presence per session (latest session per pubkey wins).
- **Tags**:
  - `["a", "31124:<pubkey>:<blobbiD>"]` — links to the Blobbi being shown.
  - `["t", "blobbi:presence"]` — global presence index.
  - `["t", "island:<islandId>"]` — island scope.
  - `["t", "loc:<location>"]` — current location scope (enables relay-level location filtering).
  - `["expiration", "<unix-seconds>"]` — NIP-40.
- **`content`** (JSON):
  ```json
  {
    "state": "idle" | "moving" | "emote",
    "location": "<locationId>",
    "anchor": { "x": <0-100>, "y": <0-100>, "ts": <unix-seconds> },
    "goal": { "from": {"x","y"}, "to": {"x","y"}, "v": <px/s>, "ts": <unix-seconds> },
    "blobbiD": "<blobbiD>",
    "hiddenIn": "<hiding-spot-id>",
    "seatId": "<theater-seat-id>",
    "activity": { "type": "shared-playback", "session": "31951:<host-pubkey>:<session-d>" },
    "seq": <monotonic-counter>
  }
  ```
  Positions are percentages of the location's playable area (`0–100`), making them
  resolution-independent. `goal` is omitted when the player is stationary.

  The last four fields are **optional and additive** — clients that do not
  understand them ignore them and keep rendering the player normally:

  - **`hiddenIn`** — id of the hiding spot the player is hidden inside (e.g.
    `"town-bush-1"`). Remote clients suppress the Blobbi's visual entirely.
  - **`seatId`** — canonical id of the theater seat the player is sitting in
    (e.g. `"theater-seat-a4"`). Remote clients snap the Blobbi to that seat's
    configured anchor and draw it rear-facing, **ignoring `anchor`** for the
    seated pose. Set only on confirmed arrival, preserved across heartbeats, and
    always absent from `state: "moving"` presence — so the movement that leaves a
    seat is itself what clears it. This is advisory, self-expiring *visual*
    occupancy: it reserves nothing, and clients resolve two players claiming one
    seat locally (lowest hex pubkey wins).
  - **`activity`** — a reference to the shared activity the player is taking
    part in: `{"type": "shared-playback", "session": "31951:<host>:<d>"}`. It
    carries the session ADDRESS and nothing else — no revision, no playhead, no
    media — so presence can answer "who is watching this together?" without ever
    becoming a second copy of the session state. Set once a session is actually
    created or joined (never while a code is being typed) and preserved across
    heartbeats **and across all movement** — participation belongs to being in
    the room, not to a chair, so standing up, walking and changing seats all keep
    it while `seatId` alone is cleared. It is cleared by an explicit leave (an
    `idle` event, since there is no movement to preserve) and by a location
    change. Nothing else publishes a clear, which is also what stops a cleanup
    event from ever superseding the movement it would have followed.
  - **`seq`** — monotonic publish counter for the session. `created_at` has
    one-second resolution, so a sit/hide and the movement that ends it routinely
    share a second; `seq` orders them regardless of relay delivery order.

> Note: `state` (`idle`/`moving`/`emote`) describes MOTION only. Sitting and
> hiding are separate semantic fields, so a seated player is `state: "idle"`.

> Note: `state: "emote"` is reserved for a future emote/reaction feature and is not
> yet produced by this client.

---

## Kind 21201 — Island Chat (Ephemeral)

In-world chat shown as a speech bubble above a player's Blobbi. Ephemeral
(20000–29999) with a short NIP-40 expiration; messages are transient and not
expected to be stored.

- **Tags**:
  - `["d", "<sessionId>"]`
  - `["l", "<location>"]` — location scope.
  - `["i", "<islandId>"]` — island scope.
  - `["p", "<pubkey>"]` — author.
  - `["expiration", "<unix-seconds>"]` — NIP-40 (~10s).
  - `["alt", "Chat message: <preview>"]`.
- **`content`** (JSON):
  ```json
  {
    "type": "chat",
    "location": "<locationId>",
    "blobbiD": "<blobbiD>",
    "text": "<message, max 120 chars>",
    "ts": <unix-seconds>
  }
  ```
  Received `text` is HTML-stripped before rendering. Messages are deduplicated per
  `pubkey:d` within a short window.

---

## Kinds 31951 / 21951 — Shared Playback Session & Command

Host-authoritative synchronized playback of recorded media (the Blobbi Island
theater's "watch together"). The full specification, including the reasoning
behind every rule, is
[`docs/protocol/shared-playback-session.md`](docs/protocol/shared-playback-session.md);
what this client actually implements is
[`docs/theater-shared-watch-implementation.md`](docs/theater-shared-watch-implementation.md).

> **Experimental, and application-private by convention only.** These kind
> numbers are not registered anywhere — Nostr has no registry with allocation
> authority — so any other application may already use them. Every consumer
> MUST validate structurally and ignore anything that does not parse as this
> schema, rather than trusting the kind number.

**Two layers, one contract.** `31951` is the recoverable source of truth;
`21951` is a latency optimization. A client that never sees a single `21951` is
still correct, and a client that misses one is corrected by the next `31951`.
Both events for one action carry the same `rev`.

### Kind 31951 — Shared Playback Session (Addressable, NIP-40)

- **`d`**: a fresh UUIDv4 per session, never reused. Address:
  `31951:<host-pubkey>:<d>` — the host is the event's author, so authority is
  derived from authorship and a session's host can never change.
- **Tags**: `["r", "blobbi-island:theater:main"]` (reusable room),
  `["c", "<6-char code>"]` (invitation code, indexed, required while active),
  `["t", "shared-playback"]`, `["t", "<provider>"]`, `["provider", ...]`,
  `["media", ...]`, `["status", "active"|"ended"]`, `["client", "blobbi-island"]`,
  `["alt", ...]`, `["expiration", "<unix-seconds>"]` (4 h, rolled forward on
  every publish; 10 min once ended).
- **`content`** (JSON):
  ```json
  {
    "version": 1,
    "rev": 0,
    "media": { "provider": "youtube", "id": "<11-char id>" },
    "playback": { "state": "playing"|"paused", "position": 0, "updatedAt": 1785175200000, "rate": 1 },
    "permissions": { "mode": "host-only" }
  }
  ```
  `position` is in **seconds** and `updatedAt` is the host's wall clock in
  **milliseconds** — deliberately finer than `created_at`, which is too coarse
  for playback timing. Together they are an anchor, not a live value: clients
  extrapolate `position + elapsed × rate` while playing. `provider`, `media` and
  `status` are unqueryable mirrors of the content; on any disagreement the
  content wins.

The host republishes the current state every 20 s with the **same `rev`**, a
refreshed `expiration` and a re-anchored `updatedAt`/`position`. This keeps the
session alive, keeps every guest's clock-offset estimate fresh, and doubles as a
liveness signal.

### Kind 21951 — Shared Playback Command (Ephemeral, NIP-40)

- **Tags**: `["a", "31951:<host>:<d>", "<relay hint>"]` (exactly one; required),
  `["p", "<host pubkey>"]`, `["t", "shared-playback"]`, `["client", ...]`,
  `["alt", ...]`, `["expiration", "<now + 30s>"]`.
- **`content`** (JSON): one of
  `play` · `pause` · `seek` · `set-media` · `set-rate` · `end-session`, each
  carrying `version`, `rev`, `position`, `updatedAt` (and `rate`, except
  `end-session`). `seek` may carry `reason`
  (`direct`/`skip-forward`/`skip-backward`/`restart`) as **presentation-only**
  metadata.

**Absolute positions only.** `+10 s` publishes the resulting position, never a
delta — that is what makes a command idempotent under duplicate delivery,
independently applicable after a missed one, and safely ignorable when
superseded.

**Authority (v1: `host-only`).** A command is accepted only when its `a` tag
names the session the client is in AND `event.pubkey` equals the host pubkey
embedded in that address. Guests have no protocol write path; a command from any
other signer is discarded by signature, not by UI.

**Ordering.** Greater `rev` wins; ties break on `created_at`, then on the
lexicographically greater event id. A command or state with `rev` less than or
equal to the last applied revision is ignored, so a late or replayed event can
never rewind a player.

---

## Identity & Relays

Blobbi Island uses standard Nostr identity (NIP-07 / NIP-46 / nsec) and standard
kind `0` metadata for display names and avatars. Game state lives in the custom
kinds above. Relay configuration is standard Nostr; the default relay is
`wss://relay.ditto.pub`.
