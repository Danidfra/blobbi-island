# NIP.md — Blobbi Island Custom Event Kinds

This document describes the custom Nostr event kinds used by **Blobbi Island**, a
Nostr-native virtual creature game. Some of these kinds are co-authored with the
**Ditto** backend, which acts as the canonical source of truth for game state and
may set additional tags not produced by this client. This client preserves unknown
tags when republishing replaceable/addressable events.

All custom kinds include a NIP-31 `alt` tag where applicable to provide a
human-readable description for clients that do not understand the kind.

> **Canonical registry.** The machine-checked inventory of every kind, every
> official kind:31632 item definition, every canonical address, the issuer, the
> definition relays and the recovery boundary lives in
> [`docs/protocol/blobbi-island-event-registry.md`](docs/protocol/blobbi-island-event-registry.md),
> which is **generated** from `src/protocol/event-registry.ts` (`npm run
> docs:registry`; a test fails if it goes stale). This document explains the
> protocol and the reasoning behind it; the registry is the source of truth for
> the facts. Where they disagree, the registry is right and this file needs
> updating.

## Summary

| Kind | Name | Class | Purpose |
|------|------|-------|---------|
| `1124` | Blobbi Social Interaction | Regular | Append-only log of care/social actions (feed, play, etc.) |
| `11125` | Blobbonaut Owner Profile | Replaceable | Player profile: owned pets, achievements, current companion. **Not the Coin balance** — see kind `31633` |
| `31124` | Blobbi Pet State | Addressable | Full state of a single Blobbi creature (stats, appearance, care timestamps) |
| `31632` | Game Item Definition | Addressable | Canonical item catalog (official issuer). See `@nostr-games/inventory`. |
| `31633` | Game Inventory | Addressable | Player consumable inventory **and the canonical Blobbi Coin / Arcade Ticket balances**. See `@nostr-games/inventory`. |
| `31950` | Island Presence | Addressable | Real-time multiplayer presence (location, position, movement) |
| `21201` | Island Communication | Ephemeral | In-world speech bubbles: free text, quick phrases, phrase templates and emotes |
| `31951` | Shared Playback Session | Addressable | Canonical state of a synchronized watch session (theater) |
| `21951` | Shared Playback Command | Ephemeral | Low-latency playback commands for a watch session |
| `36767` | Theme Definition | Addressable | A shareable UI theme. **Not an Island kind** — Ditto's, reused as-is |
| `16767` | Active Profile Theme | Replaceable | The palette a user advertises publicly. **Not an Island kind** — Ditto's |
| `30078` | App Settings (NIP-78) | Addressable | Ditto's encrypted settings, `d = "ditto/metadata"`. **Holds the theme a user is actually using** |

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
  - `["coins", "<number>"]` — **OBSOLETE.** Historical pre-cutover currency.
    Never written by this client, never read for any economic decision, never
    displayed. A pre-existing tag is preserved verbatim on republish. The live
    balance is the Blobbi Coin quantity in kind `31633` (see below).
  - `["current_companion", "<blobbiD>"]`
  - `["starter_blobbi", "<blobbiD>"]`
  - `["favorite_blobbi", "<blobbiD>"]`
  - `["pet", "<blobbiD>"]` (repeatable — owned pets)
  - `["achievement", "<id>"]` (repeatable)
  - `["alt", "Blobbonaut owner profile"]`

> **Note:** Neither the player's consumable inventory nor their **Coin balance**
> is stored on kind 11125 any more. Both live in **kind 31633** (Game
> Inventory): the Coin is the official item
> `31632:<issuer>:blobbi:currency:coin`, and its balance is that item's
> quantity. This client does not write inventory tags — or a `coins` tag — into
> 11125.

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

Items fall into two kinds of category. **Consumable care items** (`food`, `toy`,
`medicine`, `hygiene`, `energy`) carry stat effects and a gameplay `action`, and
are used on a Blobbi. **Currency items** (`currency`) carry no effects and no
action; they are held as a stackable quantity in the same 31633 inventory and can
never be used on a Blobbi. The Arcade Ticket
(`blobbi:currency:arcade-ticket`) is the first of these; the official Blobbi
Coin (`blobbi:currency:coin`) is the canonical player currency.

### The `allocation` marker tag (Island extension on kind:31633)

Blobbi Island records that an account's one-time initial Coin allocation was
processed with a forward-compatible extra tag on the SAME kind:31633 event:

```json
["allocation", "island-economy:v1"]
```

The tag is published atomically with the 200-Coin quantity increase, which is
what makes the allocation exactly-once across devices without any server: the
marker's presence on the newest inventory event is the durable proof, and a
retry after an ambiguous publish can never double-credit because marker and
quantity replace together. The tag is an unknown/extra tag under the
`@nostr-games/inventory` spec (which requires tolerating unknown tags), and
this client preserves ALL unknown tags, `context` tags, grant references and
event `content` verbatim on every inventory rewrite. Each future economy
version would use a new second element; the current Coin balance and the
legacy kind:11125 `coins` tag (obsolete, opaque, never migrated) play no role
in allocation eligibility.

The complete, machine-checked list — every official `d`, its canonical
`31632:<issuer>:<d>` address, category, action, effects, artwork and publication
status — is in
[`docs/protocol/blobbi-island-event-registry.md`](docs/protocol/blobbi-island-event-registry.md).
It is generated from `src/protocol/event-registry.ts` and is not duplicated here.

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

> Note: `state: "emote"` remains reserved and is still not produced by this
> client. Emotes are **communication**, not presence: they travel on kind `21201`
> (below), because an emote is a momentary utterance while presence is a
> replaceable event with a 35-second lifetime and a heartbeat — an emote stored
> there would either hang over a Blobbi for half a minute or need a second
> clearing event racing the movement ordering. The slot is kept for a future
> emote *pose* (a Blobbi that visibly waves), which is a rendering concern
> layered on top of the message rather than a replacement for it.

---

## Kind 21201 — Island Communication (Ephemeral)

In-world communication shown as a speech bubble above a player's Blobbi.
Ephemeral (20000–29999) with a short NIP-40 expiration; messages are transient
and not expected to be stored.

The full specification, including the reasoning behind every rule, is
[`docs/communication-v2.md`](docs/communication-v2.md).

- **Tags** (identical for every message class):
  - `["d", "<sessionId>"]`
  - `["l", "<location>"]` — location scope.
  - `["i", "<islandId>"]` — island scope.
  - `["p", "<pubkey>"]` — author.
  - `["expiration", "<unix-seconds>"]` — NIP-40 (~10s).
  - `["alt", "Chat message: <preview>"]` — NIP-31 description, built from the
    SENDER's local rendering. Descriptive only; this client never reads it back.
- **`content`** (JSON) — an envelope plus one of four message classes.

  Envelope, on every class: `location` (the sender's location id), `blobbiD`
  (optional), `ts` (unix seconds). Structured classes additionally carry
  `v` (schema version, currently `1`); free text carries none, because its shape
  predates versioning.

  ```json
  { "type": "chat",     "location": "town", "ts": 0, "text": "<message, max 120 chars>" }
  { "type": "quick",    "v": 1, "location": "town", "ts": 0, "phrase": "want-to-play" }
  { "type": "emote",    "v": 1, "location": "town", "ts": 0, "emote": "wave" }
  { "type": "template", "v": 1, "location": "town", "ts": 0,
    "template": "meet-at-in", "params": { "location": "arcade", "time": "10m" } }
  ```

  **`"chat"` is free text and is unchanged** from the original schema, so clients
  that predate the structured classes keep rendering it. `"text"` is accepted as
  a synonym on receive; this client emits `"chat"`. A client that does not know
  the structured classes rejects them on `type` and ignores them.

  **Structured messages carry ids, never words.** A quick phrase is a reference
  into the receiver's own catalog, and a template is a template id plus one
  allowed value id per parameter. There is deliberately no `text` and no
  `fallback` field alongside them: the receiver reconstructs every character from
  its own local catalogs, so a sender cannot put words in another player's
  bubble. Ids are language-independent, which is also what makes translation
  possible without invalidating published events.

  Receivers MUST validate structurally — unknown `type`, unrecognised `v`,
  unknown phrase/emote/template id, a missing, unexpected or out-of-catalog
  parameter, and oversized payloads are all rejected rather than best-effort
  rendered. Received free-text `text` is HTML-stripped before rendering.
  Messages are deduplicated by event id.

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

## Kinds 36767 / 16767 — Themes (Ditto's protocol, reused)

**These are not Blobbi Island kinds.** They are [Ditto](https://soapbox.pub/)'s
theme protocol, and Island implements them so that a theme published anywhere in
the ecosystem works everywhere in it. Nothing here was designed for this game; it
is documented because Island both reads and writes these events and because the
one Island-specific addition below has to be written down.

| Kind | Class | Question it answers |
|------|-------|---------------------|
| `36767` | Addressable | "Here is a theme." Many per user, `36767:<pubkey>:<d>` |
| `16767` | Replaceable | "Here is the palette I am showing publicly." One per user |
| `30078` | Addressable | "Here is the theme I am **using**." NIP-78, encrypted to self |

The separation is load-bearing, and getting it wrong is what broke cross-app
selection in Island's first attempt:

- A **definition** is a thing anyone can discover and apply.
- An **active profile theme** (16767) is a PUBLIC advertisement. In Ditto its
  only reader is `useActiveProfileTheme`, consumed by `ProfilePage` and
  `FollowPage` — it decorates somebody's profile with their colours. Ditto also
  pulls its own 16767 back on pageload (when `autoShareTheme`, default `true`)
  into `customTheme`, but explicitly does **not** change the theme *mode*.
- The **settings blob** (30078) is what Ditto actually renders from. Publishing
  only a 16767 therefore leaves a Ditto account looking exactly as it did.

A client that wants to interoperate on *selection* has to write both.

### Kind 36767 — Theme Definition

```jsonc
{
  "kind": 36767,
  "content": "",
  "tags": [
    ["d", "harbour-dusk"],
    ["c", "#141a24", "background"],
    ["c", "#f2f5fa", "text"],
    ["c", "#5b8cff", "primary"],
    ["title", "Harbour Dusk"],
    ["alt", "Custom theme: Harbour Dusk"],
    ["t", "theme"],
    ["description", "Cold water at the end of the day."]
  ]
}
```

A theme is **three colours**: `background`, `text`, `primary`, each an
`#rrggbb`/`#rgb` value in a `c` tag whose third element is the role. `content` is
empty; a legacy format with the colours as JSON in `content` is still read, since
themes in that shape exist on relays.

Ditto also defines two non-colour fields, and Island reads, applies, caches and
republishes **both**:

```jsonc
["f", "Playfair Display", "https://fonts.example/pf.woff2", "body"]
["f", "Outfit", "https://fonts.example/outfit.woff2", "title"]
["bg", "url https://media.example/w.jpg", "mode cover", "m image/jpeg",
       "dim 1920x1080", "blurhash LKO2?U%2Tw=w]~RBVZRi};RPxuwH"]
```

- **`f`** — a CSS family name and an optional direct link to a font *file*
  (`.woff2`/`.ttf`/`.otf`), not a stylesheet. The fourth element is the role;
  a tag with **no** role is legacy and counts as the body font.
- **`bg`** — one variadic imeta-style tag of `key value` strings. The key is
  everything before the first space. `mode` is `cover` (centred, fixed,
  non-repeating) or `tile` (repeat at natural size); absent means `cover`.

**Island renders the body font, the title font and the background image.** The
title font maps to game-window titles and settings section headings — Ditto uses
its `--title-font-family` for `<h2>` headings, sidebar labels and dialog titles,
i.e. display typography generally rather than profile names alone.

Note that a `f` tag's URL element is often **empty** in Ditto's own encrypted
settings: Ditto bundles twenty-five curated families and only attaches a
fontsource CDN link when *publishing*. A consuming client that treats a missing
URL as "no font" will silently render its own type. Island keeps a mirror of that
registry (`src/lib/theme-fonts.ts`) and fetches the file Ditto would have
published. The wallpaper is applied to the
page *around* the game window rather than to `body` wholesale — Town, Beach,
Mine and the Arcade are drawn art, and a theme may dress the room the game sits
in but not the game.

### Kind 16767 — Active Profile Theme

The same `c` / `f` / `bg` tags, `["alt", "Active profile theme"]`, an optional
`title` and `description`, and `["a", "36767:<pubkey>:<d>"]` when the selection
came from a definition. Empty tags means "cleared".

**The `a` tag is optional and usually absent.** Ditto emits it only when the
selection came from a kind:36767 definition; a preset, an edited palette or a
colour tweak produces a fully SELF-CONTAINED event with no reference at all.
That is the common case, and a client that requires a reference in order to
apply an active theme will ignore most of what Ditto publishes.

Tag order, matching Ditto's builder exactly: colours, fonts, background, `alt`,
`title`, `description`, `a`.

**Island extension: the `island-theme` tag.** Blobbi Island appends one tag Ditto
does not read:

```jsonc
["island-theme", "cozy-day"]
["island-theme", "nostr:36767:<pubkey>:<d>"]
```

It exists because neither the colours nor the `a` tag can express "I am using the
built-in Cozy Day": a built-in theme has no address, and its sixteen authored
colours do not survive a round trip through three. The tag is additive — the
event remains a fully valid Ditto active-theme event with a fully correct colour
triple, and a client that ignores the tag loses nothing. An absent or unknown
value falls back to the `a` tag, and then to the default theme.

### Kind 30078 — the theme a user is *using* (NIP-78)

```jsonc
{
  "kind": 30078,
  "content": "<NIP-44 encrypted to the author's own pubkey>",
  "tags": [
    ["d", "ditto/metadata"],
    ["title", "Ditto Metadata"],
    ["client", "…"]
  ]
}
```

The decrypted content is one JSON object holding all of Ditto's app settings.
Two keys matter for themes:

| Key | Meaning |
|-----|---------|
| `theme` | `"light" \| "dark" \| "system" \| "custom"`. **Only `"custom"` renders `customTheme`.** |
| `customTheme` | A `ThemeConfig`: `{ title?, colors{background,text,primary}, font?, titleFont?, background? }`, colours as **HSL channel triplets** (not hex — that is the event encoding) |

There is also a `lastSync` in **milliseconds**, which is the ordering key
between devices and the one mechanism that disambiguates two selections inside
the same wall-clock second.

**Writing this blob is a merge, never a replacement.** Ditto validates it with a
`z.looseObject`, so unknown keys survive its own round trip; any other client
writing it must be at least as careful. Island reads the current event fresh,
decrypts it, replaces only `theme`, `customTheme` and `lastSync`, and
**abandons the write entirely if it cannot decrypt** — publishing a settings
event containing only a theme would erase the account's feed settings, content
filters and relay preferences.

### Selecting a theme, end to end

```
  choose a theme
       ↓
  kind:16767   public palette          ← what other people see on your profile
  kind:30078   theme = "custom"        ← what your own client renders
               customTheme = <config>
```

Reading it back:

```
  kind:30078  →  theme === "custom" ? customTheme : (a built-in mode)
       ↓ (unreadable: no NIP-44 signer, or a relay with only public events)
  kind:16767  →  the self-contained config it carries
       ↓ (unavailable)
  the client's own default
```

### The compatibility boundary

Island's palette is **sixteen** authored colours (`src/lib/island-themes.ts`);
the protocol carries **three**. The mapping is deterministic and lives in
`src/lib/island-theme-adapter.ts`:

- **Reading.** The three colours become sixteen, with every role that carries
  text solved against the surfaces it sits on until it clears its WCAG
  threshold. An adapted theme is held to the same contrast contract as a
  built-in one.
- **Writing.** A built-in theme publishes as `page` → `background`, `ink` →
  `text`, `purple` → `primary`. Lossy by construction, and the three chosen are
  the three that mean the same thing in both models.

Untrusted-input rules, because a theme is a stranger's data colouring the whole
UI:

- a `c` value is accepted only if it matches `#rgb`/`#rrggbb`, and is then
  parsed into numbers and re-emitted from those numbers — a colour cannot carry
  a payload because the input string is never reused;
- URLs (`f` and `bg`) are **https only**, and are re-serialised by the URL
  parser, which percent-encodes quotes and backslashes — so a URL cannot
  terminate the `url("…")` string it lands in;
- font families pass a Unicode allowlist (letters, numbers, space, underscore,
  hyphen, apostrophe, period); braces, quotes, semicolons and parentheses are
  removed, not escaped;
- titles and descriptions are stripped of control characters and capped at 64
  and 200 characters.

No arbitrary CSS from an event ever enters a `<style>` element.

---

## Identity & Relays

Blobbi Island uses standard Nostr identity (NIP-07 / NIP-46 / nsec) and standard
kind `0` metadata for display names and avatars. Game state lives in the custom
kinds above. Relay configuration is standard Nostr; the default relay is
`wss://relay.ditto.pub`.
