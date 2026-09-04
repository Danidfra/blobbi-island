# Shared Playback Session: Protocol Specification v1

Experimental application protocol for host-authoritative, synchronized playback of recorded
media across Nostr clients, as used by the Blobbi Island theater.

| | |
| --- | --- |
| **Status** | Experimental application protocol. **Not a NIP.** Not submitted to, reviewed by, or accepted into `nostr-protocol/nips`. |
| **Version** | 1 |
| **Kinds** | `31951` Shared Playback Session (addressable) · `21951` Shared Playback Command (ephemeral) |
| **Authority model** | host-only (v1) |
| **Transport assumptions** | NIP-01 event/tag semantics, NIP-01 addressable + ephemeral kind ranges, NIP-40 expiration, single-letter tag indexing |
| **Supersedes** | the single-kind MVP recommendation in `docs/theater-watch-session-audit.md` §8.4 (see that document's *Decision change* note) |
| **Date** | 2026-07-27 |

These kinds are **application-private by convention only**. Nostr has no kind registry with
allocation authority; any other application may already use, or may later choose, the same
numbers. Every consumer MUST validate structurally (§4.4, §5.4) and ignore anything that does
not parse as this schema, rather than trusting the kind number alone.

---

## 1. Kind allocation and collision research

### 1.1 Why these numbers

* `31951` sits in the **addressable** range (`30000 ≤ n < 40000`, NIP-01) and is adjacent to
  `31950`, the kind Blobbi Island already uses for island presence (`NIP.md`). Keeping the
  project's world-state kinds in one numeric neighbourhood is a readability convention, nothing
  more.
* `21951` sits in the **ephemeral** range (`20000 ≤ n < 30000`, NIP-01) and mirrors the `…951`
  suffix so the pair reads as one protocol. Blobbi Island already occupies `21201` for island
  chat, so an unregistered ephemeral kind is established practice in this codebase.

### 1.2 Research performed (2026-07-27)

| Source | Method | 31951 | 21951 |
| --- | --- | --- | --- |
| This repository | `grep -rn "21951\|31951"` over `*.ts, *.tsx, *.md, *.json` excluding `node_modules`/`dist` | none | none |
| Official NIPs kind table | fetched `raw.githubusercontent.com/nostr-protocol/nips/master/README.md` (363 lines) | absent | absent |
| `nostr-protocol/registry-of-kinds` | fetched `master/schema.yaml` (4 410 lines): the machine-readable registry the NIPs README points to | absent | absent |
| `nostrbook.dev/kinds` | fetched and grepped (91 KB) | absent | absent |
| GitHub code search | `gh search code`: bare `31951`; `21951 nostr`; `"kind 21951"`; `"kinds: [31951]"`; `"shared-playback" nostr`; both numbers scoped to `--owner nostr-protocol` | no Nostr-related hit (bare `31951` returns only unrelated numeric data: stock CSVs, proxy lists, DOI fragments) | no hit |
| GitHub issue search | `gh search issues --repo nostr-protocol/nips "watch party"` | no hit | no hit |
| Web search | synchronized-playback / watch-party NIP proposals; `nostr kind 31951 / 21951` | nothing relevant | nothing relevant |
| **Live relays** | read-only `REQ` probe, no `EVENT` ever sent (§1.3) | 0 events | 0 events |

Nearest occupied neighbours in the registry: ephemeral `21000`, `21001–21003`, `21059`;
addressable `31871–31873`, `31890`, `31922–31925`, `31989`, `31990`. Nothing at `±1` of either
chosen number.

### 1.3 Relay probe result

A read-only WebSocket probe opened each relay, issued four `REQ`s
(`{kinds:[31951],limit:50}`, `{kinds:[21951],limit:50}`, and live `since: now` variants of both),
waited for `EOSE`, then held the live subscriptions open for 20 s. It never published.

| Relay | Role | Connected | stored 31951 | stored 21951 | live 31951 | live 21951 |
| --- | --- | --- | --- | --- | --- | --- |
| `wss://relay.ditto.pub` | **configured default** (`src/App.tsx:40`) | yes | 0 | 0 | 0 | 0 |
| `wss://relay.primal.net` | **configured preset** (`src/App.tsx:45`) | yes | 0 | 0 | 0 | 0 |
| `wss://nos.lol` | known ecosystem | yes | 0 | 0 | 0 | 0 |
| `wss://relay.nostr.band` | known ecosystem (indexer) | **no**: WebSocket handshake refused (non-101) from this environment |, |, |, |, |
| `wss://relay.damus.io` | known ecosystem | **no**: WebSocket handshake refused (non-101) from this environment |, |, |, |, |

All three reachable relays returned `EOSE` for every subscription with zero events, and no
`NOTICE` or `CLOSED`: i.e. they accepted queries for both custom kinds and simply had nothing.

### 1.4 Limits of this evidence, read this before treating either kind as "free"

1. **Absence from relays and registries does not guarantee global uniqueness.** Nostr kind
   numbers are not allocated by anyone. Another application may already use `31951` or `21951`
   on relays that were not queried, or may adopt them tomorrow.
2. **The `21951` result is weak by construction.** Kind `21951` is *ephemeral*: per NIP-01,
   relays are not expected to store events in `20000–29999`. A stored-event query returning zero
   is therefore **uninformative**: it would return zero even if the kind were in heavy use.
   Only the live subscription can observe usage, and a 20-second window across three relays is
   very thin evidence. Treat "no visible usage of 21951" as *no evidence of use*, not as
   *evidence of no use*.
3. **Two ecosystem relays could not be checked** (`relay.nostr.band`, `relay.damus.io`) because
   the WebSocket handshake was refused from this environment. `relay.nostr.band` is the one that
   would have mattered most, being a broad indexer.
4. **The registries are incomplete.** `nostrbook.dev/kinds` does not even list `30311`, and the
   NIPs README states outright that its table "is not exhaustive".
5. **Blobbi Island's own kinds are unregistered too** (`31950`, `21201`), so this project is
   already relying on convention rather than allocation.

**Consequence for implementation:** kind numbers are treated as a *routing hint*, never as
proof of provenance. Validation (§4.4, §5.4) is what makes the protocol safe: an event of the
right kind that fails schema validation, carries `version ≠ 1`, or is not signed by the session
host is discarded silently.

---

## 2. Concepts

| Concept | Carrier | Lifetime | Purpose |
| --- | --- | --- | --- |
| **Session** | `31951` addressable event, `d` = session id | until `status: ended` or `expiration` | the recoverable source of truth |
| **Room** | `r` tag | permanent | reusable physical/logical place (`blobbi-island:theater:main`) |
| **Invitation code** | `c` tag | session lifetime | short, human-typable discovery handle, **not** a secret |
| **Revision** | `rev` in both kinds' content | session lifetime | total order over canonical state transitions |
| **Canonical state** | `31951` content | durable | media + play/pause + position + rate at a known instant |
| **Command** | `21951` content | ~30 s | low-latency notification of a state transition |

### 2.1 The two-layer contract

```
        host action (play / pause / seek / +10 / -10 / restart / media / rate / end)
                                  │
                     compute next canonical state, rev = rev + 1
                                  │
                 ┌────────────────┴─────────────────┐
                 ▼                                  ▼
        21951 ephemeral command            31951 addressable canonical state
        "react now"                        "recover from this"
        best effort, ~30 s TTL             durable, retried until accepted
                 │                                  │
                 └────────────────┬─────────────────┘
                                  ▼
                     guest applies the FIRST arrival with a
                     greater rev, ignores the duplicate,
                     and reconciles on every canonical update
```

**Invariants**

* **I1**: A command is never the only source of truth. Any client that misses every `21951`
  for a transition is fully corrected by the next `31951` it receives.
* **I2**: Both events for one action carry the **same `rev`** and describe the **same** state.
* **I3**: `31951` alone is sufficient to reconstruct a correct client, from a single relay query.
* **I4**: The ephemeral layer is a **latency optimization**. If a relay drops kind `21951`
  entirely, the product still works, with `31951`-only latency.
* **I5**: Only the pubkey that authored the `31951` event may change session state in v1.

---

## 3. Session identity, room identity, invitation code

### 3.1 `d`: session identity

* A **new, high-entropy value per session**. Never reused across sessions.
* Recommended: lowercase UUIDv4 from `crypto.randomUUID()` (already used for presence session
  ids, `src/lib/multiplayer.ts:194`). ULID is an acceptable alternative when lexical sortability
  is wanted; this protocol does not rely on it.
* No prefix. The kind already scopes the namespace.
* The session **address** is the NIP-01 addressable coordinate:

```
31951:<host-pubkey-hex>:<d>
```

  This string is the only identifier other systems (presence, UI, deep links) are allowed to
  hold (§14).

### 3.2 `r`: reusable room identity

```
["r", "blobbi-island:theater:main"]
```

* Stable across sessions. A new session in the same theater gets a **new `d`**, a **new `c`**,
  and **the same `r`**.
* Format: `<app>:<place>:<instance>`, lowercase, colon-separated. Reserved for this project's own
  rooms; other applications using `r` for other purposes is expected and harmless because `r` is
  always read together with `t = shared-playback`.
* Enables "what is playing in the theater right now" queries (§16.7) without a session id.

### 3.3 `c`: invitation code

```
["c", "B7X4QP"]
```

**Alphabet (31 characters), normative:**

```
ABCDEFGHJKMNPQRSTUVWXYZ23456789
```

Excluded: `0`, `O`, `1`, `I`, `L` (visually ambiguous) and `U`…; note `U` **is** included; only
the five listed glyphs are removed. Length 6 ⇒ `31⁶ = 887 503 681` codes.

* **Case:** codes are generated and published **uppercase**; input is uppercased and trimmed
  before comparison. Comparison is exact on the normalized form.
* **Generation** MUST avoid modulo bias: draw bytes from `crypto.getRandomValues`, reject any
  byte `≥ 248` (`256 − 256 mod 31`), then index `byte mod 31`.
* **Collision probability** is birthday-bounded: with `N` simultaneously live sessions,
  `P ≈ N²/(2 × 8.875×10⁸)`: about `5.6×10⁻⁴` at `N = 1000`. Non-adversarial collisions are
  negligible; adversarial squatting on a code is trivially possible, which is why resolution
  (§13) never assumes uniqueness.
* **The code is public.** It is an indexed tag on a public relay and is enumerable. It is a
  convenience for typing, **not** access control, and the UI must never present it as a password.

---

## 4. Kind 31951: Shared Playback Session (addressable)

### 4.1 Tags

| Tag | Card. | Value | Notes |
| --- | --- | --- | --- |
| `d` | 1, required | session id (§3.1) | addressable identifier |
| `r` | 1, required | room identity (§3.2) | indexed (single letter) |
| `c` | 1, required while `status: active` | 6-char code (§3.3) | indexed; MAY be omitted on the final `ended` event |
| `t` | ≥1, required | `shared-playback` | protocol discriminator, always present |
| `t` | 1, recommended | provider, e.g. `youtube` | lets clients filter by provider at the relay |
| `provider` | 1, required | `youtube` | human/tooling-readable mirror of the provider `t` tag |
| `media` | 1, required | provider media id, e.g. `aVmB8bZ1kQs` | mirror of `content.media.id`; **`content` is authoritative** |
| `status` | 1, required | `active` \| `ended` | mirror of lifecycle; queryable |
| `client` | 1, recommended | `blobbi-island` | project convention (`useNostrPublish` injects `client`) |
| `expiration` | 1, required | unix **seconds** | NIP-40 (§12.3) |
| `alt` | 1, recommended | human-readable summary | NIP-31, required by `CLAUDE.md` for custom kinds |

`media`, `provider` and `status` are **denormalized mirrors** for querying and for clients that
cannot parse the content. On any disagreement, `content` wins.

### 4.2 Content schema

```ts
interface SharedPlaybackSessionContent {
  version: 1;
  rev: number;                       // non-negative integer, monotonically increasing
  media: {
    provider: 'youtube';
    id: string;                      // /^[A-Za-z0-9_-]{11}$/ for youtube
  };
  playback: {
    state: 'playing' | 'paused';
    position: number;                // seconds, >= 0, finite
    updatedAt: number;               // host wall clock, unix MILLISECONDS
    rate: number;                    // playback speed, 0.25 .. 4
  };
  permissions: {
    mode: 'host-only';               // v1: the only accepted value
  };
}
```

### 4.3 Field semantics

| Field | Meaning |
| --- | --- |
| `version` | Schema version. A client that does not implement a version MUST ignore the event rather than guess. `1` is the only defined value. |
| `rev` | Non-negative, monotonically increasing integer, one step per canonical action. `0` is the creation revision. It is the primary ordering key (§7). Not a counter of *events*, a retried publish reuses its `rev`. |
| `media.provider` / `media.id` | Identifies what to load. `id` is validated by provider-specific shape and, in Blobbi Island, additionally against the curated catalog (§10.7). |
| `playback.state` | Intent, not observation. `playing` means "the timeline is advancing"; a guest that is buffering is still in a `playing` session. |
| `playback.position` | Position **at the moment `updatedAt` was taken**, in seconds. Fractional allowed. This is a *sample*, not a live value, clients extrapolate (§8.1). |
| `playback.updatedAt` | The host's own wall clock in **milliseconds** when the sample was taken. Millisecond resolution exists precisely because `created_at` (seconds) is too coarse for playback timing. |
| `playback.rate` | Speed multiplier applied to the extrapolation. `1` unless the host changed it. |
| `permissions.mode` | `host-only` in v1. The field exists so a future `co-host` / `open` mode is additive. |
| `created_at` | Normal Nostr unix **seconds**. Used only as a coarse tie-breaker (§7) and a sanity bound on `updatedAt` (§4.4). Never used for playback math. |
| `event.pubkey` | **The session host.** Authority is derived from authorship, not from a tag. |

The **latest valid revision is canonical.** "Latest" is defined by §7, not by arrival order.

### 4.4 Validation (receiver)

An event is accepted as a session state only if **all** hold:

1. `kind === 31951`.
2. `d`, `r`, `t: shared-playback`, `status`, `expiration` tags present; `d` non-empty.
3. `expiration` parses as an integer and is `> now` (NIP-40 is advisory, relays may serve
   expired events, so the client filters).
4. `content` parses as JSON and matches §4.2 structurally.
5. `version === 1`.
6. `permissions.mode === 'host-only'`.
7. `rev` is an integer, `0 ≤ rev ≤ Number.MAX_SAFE_INTEGER`.
8. `playback.position` is finite, `0 ≤ position ≤ 86400` (24 h ceiling; rejects absurd values).
9. `playback.rate` is finite, `0.25 ≤ rate ≤ 4`.
10. `playback.updatedAt` is an integer and self-consistent with `created_at`:
    `|updatedAt − created_at × 1000| ≤ 300000` (5 min). Both come from the host, so a larger gap
    means a malformed or hand-crafted event.
11. `media.provider` is a supported provider and `media.id` matches that provider's shape.
12. For a session the client is already tracking: `event.pubkey === knownHostPubkey`. **The host
    of a session address can never change**: the address contains the pubkey, so this is a
    consistency check against spoofed addresses in UI input.
13. Application layer (Blobbi Island, not the protocol): `media.id ∈ curated catalog`.

Rejected events are dropped silently with a debug log. Never partially applied.

### 4.5 Invariants a well-behaved host maintains

* `rev` strictly increases; the host never publishes two *different* states with the same `rev`.
* Republishing the **same** `rev` with **identical** content is legal and expected (publish
  retry, keepalive).
* `status` only ever moves `active → ended`, never back.
* `expiration` is refreshed on every publish (§12.3).
* On `status: ended`, `playback.state` is `paused` and `position` is the final position.

---

## 5. Kind 21951: Shared Playback Command (ephemeral)

### 5.1 Tags

| Tag | Card. | Value | Notes |
| --- | --- | --- | --- |
| `a` | 1, required | `31951:<host-pubkey>:<session-d>`, optional relay hint as the 3rd element | binds the command to exactly one session; indexed |
| `p` | 1, required | host pubkey (hex) | redundant with `a`, but lets clients subscribe by host and lets relays route |
| `expiration` | 1, required | unix seconds, short-lived (**recommended `now + 30`**) | NIP-40 |
| `t` | 1, recommended | `shared-playback` | consistency with `31951`; enables coarse discovery |
| `client` | 1, recommended | `blobbi-island` | |
| `alt` | 1, recommended | e.g. `Shared playback command: seek` | NIP-31 |

No `d` tag: ephemeral events are not addressable.

**30 s TTL rationale:** long enough to survive relay hops and a brief client stall; short enough
that a replayed command is already invalid, and far shorter than the drift-correction interval so
a stale command can never "win" against the canonical event.

### 5.2 Content schema

```ts
type SharedPlaybackCommand =
  | { version: 1; command: 'play';     rev: number; position: number; updatedAt: number; rate: number }
  | { version: 1; command: 'pause';    rev: number; position: number; updatedAt: number; rate: number }
  | { version: 1; command: 'seek';     rev: number; position: number; updatedAt: number; rate: number;
      reason?: 'direct' | 'skip-forward' | 'skip-backward' | 'restart' }
  | { version: 1; command: 'set-media'; rev: number; media: { provider: 'youtube'; id: string };
      state: 'playing' | 'paused'; position: number; updatedAt: number; rate: number }
  | { version: 1; command: 'set-rate'; rev: number; position: number; updatedAt: number; rate: number }
  | { version: 1; command: 'end-session'; rev: number; position: number; updatedAt: number };
```

`position`, `updatedAt`, `rate` and `rev` carry **exactly the values published in the matching
`31951`** (I2). A command is a self-contained absolute state, not a delta.

### 5.3 Absolute positions only; no relative history

The UI exposes **−10 s**, **+10 s** and **Restart** as distinct buttons, and the protocol records
*intent* in `reason`, but the wire value is always the **resulting absolute position**:

Illustration only: the revision below is arbitrary and unrelated to the §16 timeline:

```jsonc
// +10 pressed at position 180 → correct: the RESULT is transmitted
{ "version": 1, "command": "seek", "rev": 42, "position": 190,
  "updatedAt": 1785175320000, "rate": 1, "reason": "skip-forward" }

// WRONG: never do this
{ "command": "skip-forward", "amount": 10 }
```

A relative command is only correct for a client that received every previous command. Absolute
positions make every command independently applicable, idempotent under duplicate delivery, and
safely ignorable when superseded. `reason` is **presentation metadata only** (toasts, "host
skipped ahead"); no client behavior may depend on it.

### 5.4 Validation (receiver)

A command is applied only if **all** hold:

1. `kind === 21951`.
2. `expiration` present, parses, and is `> now`.
3. Exactly one `a` tag, and it equals the address of the session the client is currently in,
   compared **string-exact** after normalization (lowercase hex pubkey).
4. `event.pubkey === hostPubkey` parsed out of that `a` tag. A command signed by anyone else is
   discarded: this is the entire guest-cannot-control guarantee, and it is enforced by signature
   verification, not by UI.
5. `content` parses as JSON and matches one variant of §5.2; `command` is a known literal.
6. `version === 1`.
7. `rev > lastAppliedRev` for that session (strictly greater, §7).
8. Numeric bounds as in §4.4 (7)–(10), plus `set-media` media validation and the catalog check.
9. The client is not in `ended` state for that session.

### 5.5 If a relay does not forward ephemeral events

Some relays reject or drop unknown ephemeral kinds. Clients MUST NOT depend on `21951`:

* A client that never observes a `21951` is still correct (I4): it follows `31951`.
* After joining, if the client has received ≥ 2 canonical updates but zero commands, it MAY log
  "ephemeral channel unavailable" for diagnostics. It MUST NOT change behavior or warn the user.

---

## 6. Authority and permissions

### 6.1 v1 is host-authoritative

* The **host** is `event.pubkey` of the `31951` event, i.e. it is embedded in the session address.
* Only the host may publish `31951` for that address (relays enforce this: a different pubkey
  produces a *different* address) and only the host's `21951` commands are accepted (§5.4 (4)).
* Guests have **no** protocol-level write path to shared state in v1.

### 6.2 Control surface split

| Control | Host | Guest | Synchronized |
| --- | --- | --- | --- |
| play, pause, timeline seek, ±10 s, restart, change media, change rate, end session | ✅ | ❌ (not rendered) | ✅ |
| volume, mute/unmute | ✅ | ✅ | ❌ never |
| fullscreen | ✅ | ✅ | ❌ never |
| captions on/off, caption language | ✅ | ✅ | ❌ never |
| quality selection (where locally controllable) | ✅ | ✅ | ❌ never |

Global controls MUST be **absent** from the guest UI (not merely disabled) so the ownership
model is legible.

### 6.3 When a guest desynchronizes through native player behavior

The YouTube embed always exposes its own play/pause/seek. A guest can therefore pause or scrub
locally. This is not an error and must not be fought frame-by-frame:

1. The client marks itself **locally desynchronized** (`localOverride = true`) the moment it
   observes a player state change it did not cause.
2. Shared state keeps flowing and being recorded; **nothing is published**.
3. On the next reconciliation (≤ 5 s, §8.3) the client returns to the canonical position and
   state, clears the flag, and resumes normal correction.
4. UI, non-blocking: **"Playback is controlled by the host"** on the local action, and
   **"Rejoining shared playback…"** while the corrective seek is applied.
5. If the guest pauses locally, the client rejoins on their next play; it does not force play on
   a user who deliberately paused (that would need a gesture-free `playVideo`, which browsers may
   refuse anyway). Instead it shows **"Rejoin"**.

---

## 7. Revision and ordering rules

Both kinds carry the same `rev` for the same action:

```
21951  rev 18  → command  'play'
31951  rev 18  → canonical { state: 'playing', … }
```

**Total order, applied identically by every client:**

1. **greater `rev`** wins;
2. if `rev` is equal → **greater `created_at`** wins;
3. if still equal → **lexicographically greater `event.id`** wins (hex string comparison).

Rule 3 exists so that two clients presented with the same pathological pair always choose the
same event; it never triggers for a well-behaved host.

**Application rules**

* A command or state with `rev ≤ lastAppliedRev` is **ignored**.
* Equal `rev` from the same host is expected (the command/canonical pair, or a publish retry) and
  is a **no-op**: the state was already applied.
* Equal `rev` with *materially different* state (media, play/pause, or position differing by
  > 0.25 s) is a **protocol violation**. The client prefers the `31951` (canonical) event,
  applies rules 2–3 among candidates, and logs. **Legitimate hosts MUST NOT do this.**
* A `rev` that jumps forward by more than 1 is normal; it means commands were missed. There is
  nothing to replay: the absolute state is complete.

**`created_at` alone is never sufficient.** A user can hit pause, seek and play inside one
second; `created_at` cannot order those, which is exactly the failure mode `rev` removes. This
mirrors the `seq` mechanism already used by island presence
(`src/lib/multiplayer.ts:88-134`).

---

## 8. Playback synchronization model

Each participant loads and plays the media **locally, in their own browser, from the provider**.
Blobbi Island never retransmits, proxies or re-encodes a stream. Nostr carries only: media
identity, play/pause state, canonical position, rate, revision, timing metadata, and commands.

### 8.1 Expected position

```
paused:
  expectedPosition = position

playing:
  elapsedMs        = nowMs − clockOffsetMs − updatedAt
  expectedPosition = position + (elapsedMs / 1000) × rate
```

Then, always:

```
expectedPosition = clamp(expectedPosition, 0, duration > 0 ? duration : +∞)
```

* `nowMs` is `Date.now()` on the receiving client.
* `clockOffsetMs` is the estimated offset of the local clock relative to the host's (§8.2).
* `elapsedMs` is clamped to `[0, 24 h]` before use, so a wildly wrong clock or a resurrected event
  can never produce a negative or astronomical target.

### 8.2 Clock strategy, do not assume synchronized clocks

`updatedAt` is the **host's** wall clock. Guest clocks routinely differ by seconds (and phones
that just woke from sleep can be worse). Using it raw would inject that error directly into every
position computation. Using `created_at` instead does not help: it is the same host clock at
second resolution, and relays may not correct it either.

**Recommended v1 approach: passive per-host offset estimate. No extra events, no round trips.**

On every accepted event from the host (command *or* canonical, including keepalives):

```
sample  = receivedAtLocalMs − content.updatedAt        // = clockSkew + oneWayLatency
offset  = median(last 8 samples)                       // clamped to ±5 min
```

* Until the first sample exists, `offset = 0`.
* The estimate is reset when the tracked session or host changes.
* The median over-estimates true skew by roughly the median one-way relay latency, typically
  well under 200 ms, i.e. an order of magnitude below the 750 ms ignore threshold (§8.3). Good
  enough, and it needs no protocol support at all.
* A keepalive every 20 s (§12.3) guarantees the estimate keeps refreshing during long pauses.

Rejected alternatives for v1: an explicit ping/pong exchange (needs a guest→host write path,
which v1 does not have); NTP-style multi-sample round trips (complexity without a measurable win
against a 750 ms threshold); trusting `created_at` (coarser, same clock, no benefit).

### 8.3 Drift correction

A **passive local check every 5 s**. It reads the player and the last canonical state and
publishes **nothing**. No network event is ever produced by a drift check, on host or guest.

```
drift = |playerCurrentTime − expectedPosition|

drift <  0.75 s          → ignore
0.75 s ≤ drift ≤ 2.0 s   → do nothing this tick; re-evaluate on the next check
drift >  2.0 s           → hard seek to expectedPosition
```

Additional guards:

* At most **one hard seek per 5 s** per client (the tick rate already enforces this) and a
  **2 s settle window** after any seek during which checks are skipped.
* Correction is suspended entirely while the player is `BUFFERING`, `UNSTARTED` or not ready
  (§9), while `localOverride` is set and being resolved, and while the local rate could not be
  matched (§8.4 *rate mismatch*).
* If the canonical state is `paused`, a wrong position is corrected by `seekTo` without playing.

### 8.4 Edge cases

| Case | Behavior |
| --- | --- |
| **Duration bounds** | `duration` is `0` until metadata loads. Never clamp against `0`; treat unknown duration as unbounded and re-clamp once `duration > 0`. |
| **Negative position** | Clamp at `0` on send *and* on receive. `−10 s` publishes `max(0, current − 10)`. |
| **Seek beyond end** | `+10 s` publishes `min(current + 10, duration − 0.25)` when duration is known, else `current + 10`; receivers clamp again. |
| **Video ended** | Player state `ENDED (0)`: stop correcting, hold at the end, show "Video finished". A canonical `playing` state whose `expectedPosition ≥ duration` is treated as ended, not as a seek target. The host decides what happens next (restart / change media / end). |
| **Unavailable, region-blocked, embed-disabled** | Local, per-client failures (§9.2). The client shows the reason and **stays in the session** (chat/presence continue). It publishes nothing and stops correcting. The host is not told (v1 has no guest→host channel), so the host UI states that guests may see errors independently. |
| **Playback-rate mismatch** | If the canonical `rate` is not in `getAvailablePlaybackRates()`, apply the nearest available rate, **suspend drift correction**, and show "This device can't match the host's playback speed; you may be out of sync". Without this, an un-matchable rate would trigger a hard seek every 5 s forever. |
| **Suspended browser tab** | Timers are throttled or stopped. On `visibilitychange → visible`, run a reconciliation immediately instead of waiting for the tick, and if the last canonical update is older than 90 s, re-query the session (§8.7) before reconciling. |
| **Device sleep** | Detected the same way, plus a wall-clock jump check inside the tick: if the measured gap since the previous tick exceeds `2 ×` the interval, treat it as a wake, force an immediate re-query + reconcile, and discard the oldest clock samples (a slept device's clock may have been corrected by the OS). |
| **Clock differences** | §8.2. |
| **Very long pause** | While `paused`, `expectedPosition` is time-independent, so drift cannot accumulate. Only the keepalive matters, to keep `expiration` and the offset estimate fresh. |

### 8.5 Initial join

1. Resolve the invitation code to a session address (§13).
2. Validate `status === 'active'` and `expiration > now` (§4.4). Reject `ended`/expired with an
   explicit message.
3. Load the media: `cueVideoById(media.id)`: **cue**, not load, so nothing plays before the
   position is known.
4. On `onReady`, compute `expectedPosition` (§8.1) with whatever offset estimate exists.
5. `seekTo(expectedPosition, true)`.
6. If canonical `state === 'playing'`: `mute()` then `playVideo()`, and show a prominent
   **"🔊 Unmute"** control. If `playVideo` is refused, show **"Tap to watch"** and apply the
   whole sequence again from the user's gesture. If `state === 'paused'`: remain paused.
7. Subscribe to **both** `21951` commands and `31951` canonical updates for the session (§16).
8. Start the 5 s passive check.

Autoplay policy is the reason for step 6's ordering: browsers block *unmuted* programmatic
playback without a gesture, so the join must be muted-first with a one-tap unmute rather than
silently failing to start.

### 8.6 Connected playback

On a valid `21951`:

1. validate host authority (§5.4 (4));
2. validate the session address (§5.4 (3));
3. reject stale revisions (§7);
4. **apply immediately**: this is the low-latency path;
5. record `lastAppliedRev` and the command's `position`/`updatedAt`/`rate` as the working state;
6. reconcile later against the matching `31951` (same `rev` ⇒ no-op; that is the expected case).

On a valid `31951`: same ordering rules; it both applies state and refreshes the durable record,
the offset sample and `expiration`.

### 8.7 Reconnection

After a relay reconnect (or a wake, or any suspicion of missed traffic):

1. **Query the latest `31951`** for the session address (§16.4).
2. **Discard local or cached playback state**: the queried canonical state wins outright,
   regardless of `lastAppliedRev`, when its `rev` is greater or equal; a *lower* `rev` from the
   relay means the host's last publish has not landed yet, so keep the local state and re-query
   shortly.
3. Compute `expectedPosition`.
4. Reconcile the player (seek, and play/pause to match).
5. Resubscribe to `21951`.

**Never attempt to recover missed ephemeral commands.** They are not stored, they are not needed
(I1), and a client that waits for them is a client that never recovers.

---

## 9. Buffering and player-state mapping

Buffering is **local and private**. It never pauses the shared session and never produces an
event. A participant whose network stalls falls behind and then catches up.

When one participant buffers:

* other participants continue unaffected;
* **no shared event is published** by anyone;
* while `BUFFERING`, drift correction is suspended (a buffering player's `getCurrentTime()` is
  not meaningful, and correcting mid-stall causes a seek/buffer loop);
* when playback resumes, the client recomputes `expectedPosition` and, if drift exceeds the hard
  threshold, seeks forward to catch up;
* if buffering persists beyond ~15 s, the UI says "still loading…" instead of accumulating
  corrective seeks.

### 9.1 Distinguishing the states that look alike

| Situation | Detection | Shared meaning |
| --- | --- | --- |
| **Host user-initiated pause** | host UI action | canonical `state: 'paused'`: the only pause that is shared |
| **Buffering** | `onStateChange → 3 (BUFFERING)` | none, local, invisible to the protocol |
| **Video ended** | `onStateChange → 0 (ENDED)` | none in v1, the host decides the next action |
| **Autoplay blocked** | `playVideo()` called while canonical is `playing`, but state never becomes `1` within ~2 s | none, local; show "Tap to watch" |
| **Player not ready** | no `onReady` yet, or state `−1 (UNSTARTED)` / `5 (CUED)` | none, hold all commands as "pending apply" and apply the newest on ready |

A guest that is buffering is still, protocol-wise, in a `playing` session. Nothing about local
readiness is synchronized (§15).

---

## 10. Complete host controls

Common to every control:

* `rev = lastCommittedRev + 1` reserved at intent time;
* `updatedAt = Date.now()` (host clock, ms) sampled **once** and used in both events;
* `position` = the resulting absolute position, clamped to `[0, duration]` when known;
* publication sequence per §11;
* on `expiration`: `now + 4 h` (§12.3);
* guests apply on the first arrival with a greater `rev`, then no-op the duplicate.

| # | Control | Local player action | `21951` command | Canonical `31951` | `rev` | Guest behavior | Error behavior |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Play** | `playVideo()` | `play` @ current position | `state: 'playing'` | +1 | seek to expected, then play (muted-first if no gesture yet) | if the host's own `playVideo` is refused, revert optimistic state, release the reserved `rev`, publish nothing, prompt for a gesture |
| 2 | **Pause** | `pauseVideo()` | `pause` @ current position | `state: 'paused'` | +1 | pause, then seek to the exact position | pause practically never fails; on publish failure see §11.3 |
| 3 | **Timeline seek** | `seekTo(t, true)` | `seek`, `reason: 'direct'` | `position: t`, state unchanged | +1 | `seekTo(t)`; if playing, keep playing | clamp out-of-range; ignore a seek while `duration === 0` (player not ready) |
| 4 | **Skip forward 10 s** | `seekTo(min(cur+10, dur−0.25), true)` | `seek`, `reason: 'skip-forward'`, **absolute** result | same position | +1 | identical to a direct seek | at/near the end: clamp; if already within 0.25 s of the end, no-op and publish nothing |
| 5 | **Skip backward 10 s** | `seekTo(max(0, cur−10), true)` | `seek`, `reason: 'skip-backward'` | same position | +1 | identical to a direct seek | at 0: no-op, publish nothing |
| 6 | **Restart** | `seekTo(0, true)` (+ `playVideo()` if paused and the host wants to start) | `seek`, `position: 0`, `reason: 'restart'` | `position: 0`, state preserved | +1 | seek to 0, match state | none beyond seek failure |
| 7 | **Change media** | `cueVideoById(id)` then honor state | `set-media` with `media`, `state`, `position: 0` | new `media`, `position: 0`, state preserved | +1 | `cueVideoById`, seek 0, then match state; on autoplay refusal show "Tap to watch" | reject ids outside the curated catalog **before** publishing; if the new video errors (100/101/150) the host keeps the session and picks another, the failed id stays canonical until replaced |
| 8 | **Change playback rate** | `setPlaybackRate(r)` | `set-rate` with `rate: r` @ current position | `rate: r` | +1 | apply if available, else nearest + suspend correction (§8.4) | host only offers rates from its own `getAvailablePlaybackRates()`; rates outside `0.25–4` are refused locally |
| 9 | **End session** | stop correcting; optionally `pauseVideo()` | `end-session` @ final position | `status: 'ended'`, `state: 'paused'`, final `position`, `expiration: now + 10 min` | +1 | stop synchronizing, keep the local player where it is, show "The host ended the session" | if the `31951` publish fails, retry hard, an un-ended session lingers until `expiration`; the ephemeral `end-session` alone is not durable |

**Reserved-but-unused revisions.** If an action is abandoned (signing declined, local player
refused), the reserved `rev` is **released** and reused by the next action. `rev` is only
*committed* when a publish is accepted (§11.2). This keeps `rev` gapless in the common case, and
gaps are harmless anyway (§7).

**Rate limiting.** Control publishes are rate-limited to **one per 3 s**, with timeline scrubbing
debounced to the drag end (publish on `pointerup`, not per move). This mirrors the existing chat
rate limit (`CHAT_RATE_LIMIT_MS`, `src/lib/chat-config.ts`) and prevents relay spam from slider
drags.

---

## 11. Canonical publication sequence

### 11.1 Recommended order

```
1. compute the resulting canonical state (rev, media, state, position, updatedAt, rate)
2. apply it OPTIMISTICALLY to the host's local player
3. publish 21951  (ephemeral command): fire-and-forget, not awaited
4. publish 31951  (canonical state): awaited, retried with backoff
5. commit rev, reconcile failures
```

**Why this order.** Step 2 makes the host's own UI instant (the host must never wait on a relay
to see its own click). Step 3 precedes step 4 because the ephemeral event is the latency path and
is one small write; delaying it behind an awaited addressable publish would add a full round trip
to every guest. Step 4 is the durable one and is therefore the one that gets retries and error
surfacing.

**Both events are built from the same immutable snapshot** computed in step 1; one `updatedAt`,
one `rev`, one position. They are never recomputed per event, which is what makes I2 hold.

### 11.2 Revision commitment

* `rev` is **reserved** in step 1.
* `rev` is **committed** when the `31951` publish is accepted, or when the host observes its own
  `31951` echo from the relay.
* If everything fails permanently, the reservation is released, and the next action reuses the
  number. The host must **not** blindly bump `rev` again after a failure, or it will publish
  `rev + 2` against a relay that still holds `rev − 1`.

### 11.3 Failure matrix

| Failure | Immediate effect | Recovery | UI |
| --- | --- | --- | --- |
| **`21951` ok, `31951` fails** | Connected guests are correct. A late joiner or reconnecting client would read a stale canonical state with a *lower* `rev`. | Retry `31951` with backoff (e.g. 3 attempts over ~6 s) reusing the **same** `rev` and the **same** `updatedAt`/`position` (idempotent: addressable replacement). The 20 s keepalive republishes the current state regardless, so the window closes even if retries fail. | host: "Syncing…" then silent on success |
| **`31951` ok, `21951` fails** | Guests receive the change through their `31951` subscription instead, correct, just at normal latency. | **No corrective action.** This is exactly why guests subscribe to both (§16.5, §16.6). | none |
| **Both fail** | Only the host moved. Guests continue extrapolating the previous canonical state and are *not* wrong, they are simply behind on the newest action. | Retry per above. If retries are exhausted, re-read the host's own canonical event from the relay and reconcile: if the relay's `rev` is lower, republish; if the local player has drifted from the relay's state, follow the relay. | host: **"Not synced, retrying"**, controls stay usable |
| **Signing rejected** (user dismisses the NIP-07/NIP-46 prompt) | Nothing was published. | **Revert the optimistic local action** (step 2) and release the reserved `rev`. | "Playback change cancelled" |
| **Host loses connectivity** | Host plays on locally; guests keep extrapolating the last canonical state, which for `playing` remains correct. | On reconnect: re-read own `31951`; republish if the relay is behind; then resume keepalives. Guests see no canonical update; after 90 s they show "Host may have disconnected" but keep playing. | host: offline indicator |
| **Relay delivers `31951` before `21951`** | Guests apply canonical `rev N`; the later command carries the *same* `rev N`. | The command is a **no-op** by §7 (not strictly greater). Nothing to fix, the ordering rules make delivery order irrelevant. | none |
| **Guest receives `21951` for an unknown/newer media while its player is not ready** | Cannot apply yet. | Hold the newest pending state and apply on `onReady`; discard older pending states. | "Loading…" |

The system remains recoverable from the addressable event under every row above (I3).

---

## 12. Session status and lifecycle

### 12.1 States

| `status` | Meaning |
| --- | --- |
| `active` | joinable; commands are accepted; canonical state is live |
| `ended` | terminal; no further commands are accepted from any pubkey; clients stop synchronizing |

There is no `paused` *session* status, pausing is playback state, not lifecycle.

### 12.2 Creation

A new session starts **paused at position 0**, `rev: 0`, `rate: 1`, unless the creator explicitly
configures otherwise. Rationale: it guarantees that the first thing every joiner does is a
gesture-driven play, which sidesteps autoplay blocking entirely for the host and makes the first
`play` a clean `rev: 1` transition.

### 12.3 Expiration: recommended default **4 hours, rolling**

| Option | Assessment |
| --- | --- |
| **2 h** | Too short. A 2.5 h film, or a 90-minute film with pause breaks, would expire *mid-session*, breaking late joins and reconnects precisely when they matter. Recovery would require creating a new session and redistributing the code. |
| **4 h** ✅ | Covers essentially every single-sitting watch, including long films plus pauses, with headroom. |
| Media duration + buffer | Attractive but fragile: YouTube duration is unknown until the player loads metadata (so not available at create time), it changes on every media change, and it says nothing about how long the session is paused. Rejected as the v1 default; the host MAY shorten/extend later. |
| Renewal while the host is active | ✅ **Adopted, combined with 4 h.** `expiration = now + 4 h` on **every** canonical publish, including the keepalive. |

* **Keepalive:** the host republishes the current canonical state **every 20 s** with the **same
  `rev`** and a refreshed `expiration`. This keeps the session alive, refreshes every guest's
  clock-offset estimate (§8.2), and doubles as a host-liveness signal.
* **Host-away detection is separate from expiration.** Guests treat "no canonical update for
  > 90 s" as *host may have disconnected* (a UI hint; playback continues). They do **not** treat a
  distant `expiration` as liveness.
* A long TTL is safe here, unlike island presence (35 s, because ghost Blobbis must not render),
  a lingering `31951` is only reachable by its code, is visibly stale, and is exactly what makes
  reconnect recovery possible.

### 12.4 Ending a session

The host, in order:

1. publishes the `21951` `end-session` command;
2. republishes `31951` with `status: 'ended'`, `rev + 1`, `playback.state: 'paused'`, the final
   `position`, and a **shortened** `expiration` (`now + 10 min`) so reconnecting guests learn it
   ended instead of finding nothing;
3. stops accepting and stops publishing commands;
4. stops its keepalive.

Guests stop synchronizing, keep their player where it is, and display that the session ended.
Any later `21951` for that address is rejected (§5.4 (9)).

### 12.5 The next session in the same theater

* **new `d`** (never reuse);
* **new `c`**;
* **same `r`** (`blobbi-island:theater:main`);
* new address, therefore possibly a different host.

---

## 13. Invitation-code resolution

### 13.1 Filter

```json
{
  "kinds": [31951],
  "#c": ["B7X4QP"],
  "limit": 20
}
```

### 13.2 Resolution algorithm

1. Normalize input: trim, uppercase, strip separators. Reject anything that is not exactly 6
   characters from the alphabet in §3.3, **before** querying.
2. Query as above (optionally `+ "#r": ["blobbi-island:theater:main"]` to scope to the theater).
3. Drop every candidate that fails §4.4 validation.
4. Drop candidates whose `c` tag does not match the normalized code **exactly** (a relay may
   over-match; never trust the filter alone).
5. Drop `status: 'ended'`.
6. Drop expired (`expiration ≤ now`).
7. If **one** candidate remains → join it.
8. If **several** remain → prefer the **most recently created** valid session (`created_at`, then
   `event.id` as a deterministic tie-break). If two candidates are within a small window
   (e.g. ≤ 60 s) or have different hosts, **do not silently join**: present an explicit chooser
   showing host name, media title and start time, or refuse with "That code matches more than one
   session". Silently joining the wrong host's session is worse than an error.
9. If **none** remain → "No active session with that code".

### 13.3 Collision handling at creation

Before publishing a new session, the host queries the code (§13.1). If a **valid, non-expired,
active** session with that code exists from **any** pubkey, generate a new code and retry, up to
5 attempts, then surface an error. This is best-effort: two hosts can still race, which is why
§13.2 (8) exists.

### 13.4 The code is not access control

Publicly indexed, enumerable, and guessable at scale. Guessing a code grants only what any
observer already has: the ability to watch a video from a public curated catalog and to read a
public session's state. No write capability follows from knowing a code (§6.1). If private
sessions are ever required, that needs NIP-44 encryption to invited pubkeys; not a longer code
(§15).

---

## 14. Presence, seats and this protocol

### 14.1 Nothing about participants lives in `31951`

No participant list, no seat map, no occupancy, no view count. Reasons: it would make every join
and leave a write by the *host* (who does not know when guests leave), it would collide with
`rev` ordering, and Blobbi Island already has a purpose-built, self-expiring presence system.

### 14.2 Presence carries the reference (kind 31950)

Island presence eventually carries theater activity as **optional, additive** content fields,
following the existing `hiddenIn` precedent (`src/lib/multiplayer.ts:59-72`):

```jsonc
{
  "state": "idle",
  "location": "stage",
  "anchor": { "x": 52.4, "y": 87.6, "ts": 1785175310 },
  "seq": 42,
  "seatId": "theater-seat-b4",
  "activity": {
    "type": "shared-playback",
    "session": "31951:<host-pubkey>:<session-d>"
  }
}
```

* `PresenceContent.state` (`idle | moving | emote`) is **not** touched; it describes motion and
  is validated by `explainPresenceEvent`.
* `seatId` and `activity` are optional; older clients ignore them.
* Presence remains authoritative for **seat occupancy rendering**; the session event is
  authoritative for **playback**. Neither is authoritative for the other.

### 14.3 Decoupling rules (enforced by dependency direction)

```
src/lib/shared-playback/**        pure protocol library; no React, no DOM,
   ▲                              no imports from theater / seats / presence / rendering
   │
src/hooks/useSharedPlayback.ts    React lifecycle, relay I/O
   ▲
src/components/blobbi/theater/**  UI + player + seats

src/lib/multiplayer.ts            may hold the session ADDRESS STRING only
```

* The protocol library MUST NOT import Blobbi rendering, seat config, presence, or chat.
* The seat system MUST NOT import the protocol library. A seated Blobbi does not know a session
  exists.
* Presence holds the session **address string** and nothing else; no rev, no position, no media.
* The theater UI is the only place the two meet, and it joins them by id, not by shared state.
* Chat stays kind `21201`, room-scoped, unaware of sessions (§15).

This is what allows watch sessions to work for a standing Blobbi, a seated Blobbi, or a future
non-theater room with no Blobbi at all.

---

## 15. Explicit v1 exclusions

Not in version 1, by decision:

co-hosts · guest playback control · voting · participant lists in the session event · seat
reservations in the session event · chat history · reactions · private/encrypted invitations ·
DRM handling · media proxying · YouTube scraping (only the official IFrame Player API) ·
synchronized volume · synchronized fullscreen · synchronized captions · synchronized buffering
state.

The schema is shaped so the plausible ones are **additive**: `permissions.mode` can gain values,
`p`-role tags can carry controllers, and new `command` variants can be added behind
`version`-gated parsing.

---

## 16. Event examples

One coherent timeline. Host
`9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8`, session
`3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34`, code `B7X4QP`, room `blobbi-island:theater:main`.
All events unsigned (`id`, `pubkey`, `sig` omitted).

| `rev` | host clock | action | canonical example | command example |
| --- | --- | --- | --- | --- |
| 0 | 18:00:00 | create, paused @ 0 | 16.1 |, |
| 1 | 18:00:30 | play | 16.2 | 16.8 |
| 2 | 18:01:13 | pause @ 42.5 | 16.3 | 16.9 |
| 3 | 18:01:35 | seek → 600 while playing | 16.4 | 16.10 |
| 4 | 18:02:00 | +10 s → 635 |, | 16.11 |
| 5 | 18:02:20 | −10 s → 645 |, | 16.12 |
| 6 | 18:02:40 | restart → 0 |, | 16.13 |
| 7 | 18:03:20 | change media | 16.5 | 16.14 |
| 8 | 18:03:55 | rate → 1.25 @ 35 | 16.6 | 16.15 |
| 9 | 18:05:00 | end session @ 116.25 | 16.7 | 16.16 |

> `position` values come from the host's **player**, not from arithmetic on wall time, so they may
> differ slightly from `previous + elapsed` (buffering, frame quantization). That is expected and
> is exactly why `position` is transmitted rather than inferred.

### 16.1, `31951` rev 0 · session created, paused at zero

```json
{
  "kind": 31951,
  "created_at": 1785175200,
  "content": "{\"version\":1,\"rev\":0,\"media\":{\"provider\":\"youtube\",\"id\":\"aVmB8bZ1kQs\"},\"playback\":{\"state\":\"paused\",\"position\":0,\"updatedAt\":1785175200000,\"rate\":1},\"permissions\":{\"mode\":\"host-only\"}}",
  "tags": [
    ["d", "3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34"],
    ["r", "blobbi-island:theater:main"],
    ["c", "B7X4QP"],
    ["t", "shared-playback"],
    ["t", "youtube"],
    ["provider", "youtube"],
    ["media", "aVmB8bZ1kQs"],
    ["status", "active"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback session in the Blobbi Island theater"],
    ["expiration", "1785189600"]
  ]
}
```

### 16.2, `31951` rev 1 · playing

```json
{
  "kind": 31951,
  "created_at": 1785175230,
  "content": "{\"version\":1,\"rev\":1,\"media\":{\"provider\":\"youtube\",\"id\":\"aVmB8bZ1kQs\"},\"playback\":{\"state\":\"playing\",\"position\":0,\"updatedAt\":1785175230000,\"rate\":1},\"permissions\":{\"mode\":\"host-only\"}}",
  "tags": [
    ["d", "3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34"],
    ["r", "blobbi-island:theater:main"],
    ["c", "B7X4QP"],
    ["t", "shared-playback"],
    ["t", "youtube"],
    ["provider", "youtube"],
    ["media", "aVmB8bZ1kQs"],
    ["status", "active"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback session in the Blobbi Island theater"],
    ["expiration", "1785189630"]
  ]
}
```

### 16.3, `31951` rev 2 · paused at 42.5 s

```json
{
  "kind": 31951,
  "created_at": 1785175273,
  "content": "{\"version\":1,\"rev\":2,\"media\":{\"provider\":\"youtube\",\"id\":\"aVmB8bZ1kQs\"},\"playback\":{\"state\":\"paused\",\"position\":42.5,\"updatedAt\":1785175273000,\"rate\":1},\"permissions\":{\"mode\":\"host-only\"}}",
  "tags": [
    ["d", "3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34"],
    ["r", "blobbi-island:theater:main"],
    ["c", "B7X4QP"],
    ["t", "shared-playback"],
    ["t", "youtube"],
    ["provider", "youtube"],
    ["media", "aVmB8bZ1kQs"],
    ["status", "active"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback session in the Blobbi Island theater"],
    ["expiration", "1785189673"]
  ]
}
```

### 16.4, `31951` rev 3 · seek to 600 s while playing

```json
{
  "kind": 31951,
  "created_at": 1785175295,
  "content": "{\"version\":1,\"rev\":3,\"media\":{\"provider\":\"youtube\",\"id\":\"aVmB8bZ1kQs\"},\"playback\":{\"state\":\"playing\",\"position\":600,\"updatedAt\":1785175295000,\"rate\":1},\"permissions\":{\"mode\":\"host-only\"}}",
  "tags": [
    ["d", "3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34"],
    ["r", "blobbi-island:theater:main"],
    ["c", "B7X4QP"],
    ["t", "shared-playback"],
    ["t", "youtube"],
    ["provider", "youtube"],
    ["media", "aVmB8bZ1kQs"],
    ["status", "active"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback session in the Blobbi Island theater"],
    ["expiration", "1785189695"]
  ]
}
```

### 16.5, `31951` rev 7 · media changed (state preserved: playing, position reset)

```json
{
  "kind": 31951,
  "created_at": 1785175400,
  "content": "{\"version\":1,\"rev\":7,\"media\":{\"provider\":\"youtube\",\"id\":\"Nk9pQ2rT7wY\"},\"playback\":{\"state\":\"playing\",\"position\":0,\"updatedAt\":1785175400000,\"rate\":1},\"permissions\":{\"mode\":\"host-only\"}}",
  "tags": [
    ["d", "3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34"],
    ["r", "blobbi-island:theater:main"],
    ["c", "B7X4QP"],
    ["t", "shared-playback"],
    ["t", "youtube"],
    ["provider", "youtube"],
    ["media", "Nk9pQ2rT7wY"],
    ["status", "active"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback session in the Blobbi Island theater"],
    ["expiration", "1785189800"]
  ]
}
```

### 16.6, `31951` rev 8 · playback rate 1.25

```json
{
  "kind": 31951,
  "created_at": 1785175435,
  "content": "{\"version\":1,\"rev\":8,\"media\":{\"provider\":\"youtube\",\"id\":\"Nk9pQ2rT7wY\"},\"playback\":{\"state\":\"playing\",\"position\":35,\"updatedAt\":1785175435000,\"rate\":1.25},\"permissions\":{\"mode\":\"host-only\"}}",
  "tags": [
    ["d", "3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34"],
    ["r", "blobbi-island:theater:main"],
    ["c", "B7X4QP"],
    ["t", "shared-playback"],
    ["t", "youtube"],
    ["provider", "youtube"],
    ["media", "Nk9pQ2rT7wY"],
    ["status", "active"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback session in the Blobbi Island theater"],
    ["expiration", "1785189835"]
  ]
}
```

### 16.7, `31951` rev 9 · session ended

Note: `status: ended`, `state: paused`, final position, **shortened** expiration, `c` retained so
a reconnecting guest resolving the code learns it ended.

```json
{
  "kind": 31951,
  "created_at": 1785175500,
  "content": "{\"version\":1,\"rev\":9,\"media\":{\"provider\":\"youtube\",\"id\":\"Nk9pQ2rT7wY\"},\"playback\":{\"state\":\"paused\",\"position\":116.25,\"updatedAt\":1785175500000,\"rate\":1.25},\"permissions\":{\"mode\":\"host-only\"}}",
  "tags": [
    ["d", "3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34"],
    ["r", "blobbi-island:theater:main"],
    ["c", "B7X4QP"],
    ["t", "shared-playback"],
    ["t", "youtube"],
    ["provider", "youtube"],
    ["media", "Nk9pQ2rT7wY"],
    ["status", "ended"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback session ended"],
    ["expiration", "1785176100"]
  ]
}
```

---

Command events share this tag shape (only `expiration`, `alt` and `content` vary):

```json
[
  ["a", "31951:9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8:3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34", "wss://relay.ditto.pub"],
  ["p", "9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8"],
  ["t", "shared-playback"],
  ["client", "blobbi-island"]
]
```

### 16.8, `21951` rev 1 · play

```json
{
  "kind": 21951,
  "created_at": 1785175230,
  "content": "{\"version\":1,\"command\":\"play\",\"rev\":1,\"position\":0,\"updatedAt\":1785175230000,\"rate\":1}",
  "tags": [
    ["a", "31951:9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8:3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34", "wss://relay.ditto.pub"],
    ["p", "9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8"],
    ["t", "shared-playback"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback command: play"],
    ["expiration", "1785175260"]
  ]
}
```

### 16.9, `21951` rev 2 · pause

```json
{
  "kind": 21951,
  "created_at": 1785175273,
  "content": "{\"version\":1,\"command\":\"pause\",\"rev\":2,\"position\":42.5,\"updatedAt\":1785175273000,\"rate\":1}",
  "tags": [
    ["a", "31951:9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8:3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34", "wss://relay.ditto.pub"],
    ["p", "9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8"],
    ["t", "shared-playback"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback command: pause"],
    ["expiration", "1785175303"]
  ]
}
```

### 16.10, `21951` rev 3 · direct seek to 600 s

```json
{
  "kind": 21951,
  "created_at": 1785175295,
  "content": "{\"version\":1,\"command\":\"seek\",\"rev\":3,\"position\":600,\"updatedAt\":1785175295000,\"rate\":1,\"reason\":\"direct\"}",
  "tags": [
    ["a", "31951:9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8:3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34", "wss://relay.ditto.pub"],
    ["p", "9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8"],
    ["t", "shared-playback"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback command: seek"],
    ["expiration", "1785175325"]
  ]
}
```

### 16.11, `21951` rev 4 · skip forward 10 s (absolute result 635)

```json
{
  "kind": 21951,
  "created_at": 1785175320,
  "content": "{\"version\":1,\"command\":\"seek\",\"rev\":4,\"position\":635,\"updatedAt\":1785175320000,\"rate\":1,\"reason\":\"skip-forward\"}",
  "tags": [
    ["a", "31951:9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8:3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34", "wss://relay.ditto.pub"],
    ["p", "9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8"],
    ["t", "shared-playback"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback command: seek"],
    ["expiration", "1785175350"]
  ]
}
```

### 16.12, `21951` rev 5 · skip backward 10 s (absolute result 645)

```json
{
  "kind": 21951,
  "created_at": 1785175340,
  "content": "{\"version\":1,\"command\":\"seek\",\"rev\":5,\"position\":645,\"updatedAt\":1785175340000,\"rate\":1,\"reason\":\"skip-backward\"}",
  "tags": [
    ["a", "31951:9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8:3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34", "wss://relay.ditto.pub"],
    ["p", "9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8"],
    ["t", "shared-playback"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback command: seek"],
    ["expiration", "1785175370"]
  ]
}
```

### 16.13, `21951` rev 6 · restart (absolute result 0)

```json
{
  "kind": 21951,
  "created_at": 1785175360,
  "content": "{\"version\":1,\"command\":\"seek\",\"rev\":6,\"position\":0,\"updatedAt\":1785175360000,\"rate\":1,\"reason\":\"restart\"}",
  "tags": [
    ["a", "31951:9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8:3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34", "wss://relay.ditto.pub"],
    ["p", "9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8"],
    ["t", "shared-playback"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback command: seek"],
    ["expiration", "1785175390"]
  ]
}
```

### 16.14, `21951` rev 7 · set media

```json
{
  "kind": 21951,
  "created_at": 1785175400,
  "content": "{\"version\":1,\"command\":\"set-media\",\"rev\":7,\"media\":{\"provider\":\"youtube\",\"id\":\"Nk9pQ2rT7wY\"},\"state\":\"playing\",\"position\":0,\"updatedAt\":1785175400000,\"rate\":1}",
  "tags": [
    ["a", "31951:9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8:3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34", "wss://relay.ditto.pub"],
    ["p", "9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8"],
    ["t", "shared-playback"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback command: set-media"],
    ["expiration", "1785175430"]
  ]
}
```

### 16.15, `21951` rev 8 · set playback rate

```json
{
  "kind": 21951,
  "created_at": 1785175435,
  "content": "{\"version\":1,\"command\":\"set-rate\",\"rev\":8,\"position\":35,\"updatedAt\":1785175435000,\"rate\":1.25}",
  "tags": [
    ["a", "31951:9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8:3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34", "wss://relay.ditto.pub"],
    ["p", "9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8"],
    ["t", "shared-playback"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback command: set-rate"],
    ["expiration", "1785175465"]
  ]
}
```

### 16.16, `21951` rev 9 · end session

```json
{
  "kind": 21951,
  "created_at": 1785175500,
  "content": "{\"version\":1,\"command\":\"end-session\",\"rev\":9,\"position\":116.25,\"updatedAt\":1785175500000}",
  "tags": [
    ["a", "31951:9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8:3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34", "wss://relay.ditto.pub"],
    ["p", "9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8"],
    ["t", "shared-playback"],
    ["client", "blobbi-island"],
    ["alt", "Shared playback command: end-session"],
    ["expiration", "1785175530"]
  ]
}
```

---

## 17. Nostr filters

### 17.1 Usage / collision check for both kinds

```json
[
  { "kinds": [31951], "limit": 50 },
  { "kinds": [21951], "limit": 50 }
]
```

Plus a **live** subscription, because ephemeral events are never stored:

```json
[{ "kinds": [21951], "since": 1785175200 }]
```

### 17.2 Resolve by invitation code

```json
{ "kinds": [31951], "#c": ["B7X4QP"], "limit": 20 }
```

Scoped to the theater:

```json
{ "kinds": [31951], "#c": ["B7X4QP"], "#r": ["blobbi-island:theater:main"], "limit": 20 }
```

### 17.3 Load a known addressable session

```json
{
  "kinds": [31951],
  "authors": ["9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8"],
  "#d": ["3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34"],
  "limit": 1
}
```

### 17.4 Subscribe to canonical updates for one session

Same filter as 17.3, held open (no `limit`, or `limit: 1` plus a live subscription depending on
the relay's semantics).

### 17.5 Subscribe to ephemeral commands for one session

```json
{
  "kinds": [21951],
  "#a": ["31951:9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8:3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34"],
  "since": 1785175200
}
```

Alternative for relays with weak `#a` indexing:

```json
{
  "kinds": [21951],
  "#p": ["9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8"],
  "since": 1785175200
}
```

…then filter the `a` tag client-side (§5.4 (3)).

### 17.6 List active sessions by host

```json
{
  "kinds": [31951],
  "authors": ["9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8"],
  "#t": ["shared-playback"],
  "limit": 20
}
```

`status` is a mirror tag, not single-letter, so it is **not** reliably indexed, filter
`status: active` client-side.

### 17.7 Sessions in the Blobbi theater

```json
{
  "kinds": [31951],
  "#r": ["blobbi-island:theater:main"],
  "#t": ["shared-playback"],
  "limit": 50
}
```

### 17.8 Where relay assumptions may not be portable

| Assumption | Risk |
| --- | --- |
| Single-letter tags `d`, `r`, `c`, `a`, `p`, `t` are indexed | NIP-01 says relays index single-letter tags, but coverage varies; some relays index only a subset, or cap the number of indexed values per query. Always re-filter client-side (§13.2 (4), §5.4 (3)). |
| Multi-letter tags (`provider`, `media`, `status`) are queryable | **They are not.** Present for readability only. Never build a filter on them. |
| Addressable replacement works for a *custom* kind | Most relays implement NIP-01 ranges generically, but a relay that hardcodes known kinds may store `31951` as a regular event, accumulating versions. Clients must therefore pick the newest by §7 rather than trusting "one event per address". |
| Ephemeral forwarding works for a *custom* kind | Some relays drop or reject unknown ephemeral kinds. Handle per §5.5, degrade to `31951`-only. |
| NIP-40 expiration is enforced | Optional. Relays may serve expired events indefinitely; clients must filter (§4.4 (3)). |
| `since` on an ephemeral subscription is meaningful | With nothing stored, `since` only affects any buffered replay. Harmless, but do not rely on it to backfill. |
| Blobbi Island routes to a **single** relay | `NostrProvider` pins `reqRouter`/`eventRouter` to `config.relayUrl` (`src/components/NostrProvider.tsx:32-44`). A session is therefore only visible to clients on the same relay. Cross-relay sessions need a relay-hint strategy, out of scope for v1, but the `a` tag already carries a hint slot. |

---

## 18. Client model

### 18.1 Session client state

```ts
interface SharedPlaybackClientState {
  address: string;                 // 31951:<host>:<d>
  hostPubkey: string;
  role: 'host' | 'guest';
  session: SharedPlaybackSessionContent | null;   // last accepted canonical state
  lastAppliedRev: number;          // -1 before the first apply
  lastCanonicalAtMs: number;       // local receive time of the last 31951
  clockSamples: number[];          // rolling, max 8
  clockOffsetMs: number;
  localOverride: boolean;          // guest touched the native player (§6.3)
  rateMatched: boolean;            // false ⇒ drift correction suspended (§8.4)
  playerReady: boolean;
  pending: SharedPlaybackCommand | null;          // newest state awaiting onReady
  status: 'joining' | 'synced' | 'correcting' | 'buffering' | 'error' | 'ended';
}
```

### 18.2 Pure library surface (no React, no DOM)

```ts
// builders
buildSessionEvent(input): UnsignedEvent
buildCommandEvent(input): UnsignedEvent
// parsers + validation
parseSessionEvent(event): SharedPlaybackSessionContent | null
parseCommandEvent(event, expectedAddress): SharedPlaybackCommand | null
// ordering
compareRevisions(a, b): -1 | 0 | 1
isSuperseded(known, incoming): boolean
// timing
expectedPosition(state, nowMs, clockOffsetMs, duration?): number
estimateClockOffset(samples): number
driftAction(drift): 'ignore' | 'wait' | 'seek'
// codes
generateInviteCode(randomBytes): string
normalizeInviteCode(input): string | null
resolveInviteCode(candidates, nowMs): Resolution
```

Everything above is deterministic and unit-testable without a browser, a relay or a player. That
is the point: the correctness-critical parts of this protocol must be provable in milliseconds,
not by two humans watching a video.

---

## 19. Implementation plan

Phases 1–3 contain **no protocol work**; Phase 4 is pure and offline; the network appears in
Phase 5. Every phase is independently shippable and revertable.

> **Prerequisite for the whole plan:** the audit's Phase-1 findings still apply, the theater's
> screen mount is the transparent hole in `stage-inside.png`
> (x 6.8–92.7 %, y 6.7–56.9 %; 16 : 9 player 617 × 347 px at x 19.8–78.8 %), and the dead chair
> path must be removed rather than revived. See `docs/theater-watch-session-audit.md` §1.4, §1.10.

### Phase 1: Rear-facing Blobbi renderer

| | |
| --- | --- |
| **Goal** | A semantic `facing="front" \| "back"` (component) / `view: 'front' \| 'rear'` (asset) state that removes face blocks while preserving silhouette, colours, gradients, limbs and particles. |
| **Files** | `src/blobbi/ui/lib/svg/rear-view.ts` (new), `src/blobbi/ui/lib/svg/index.ts`, `src/lib/loadBlobbiSvg.ts`, `src/components/blobbi/CurrentBlobbiDisplay.tsx`, `src/components/blobbi/AccessoryOverlay.tsx` (+ `REAR_VIEW_HIDDEN_SLOTS`) |
| **Tests** | Table-driven across **all 34 SVGs** (`ADULT_SVG_MAP` × {base, sleeping} + baby): rear output contains no `Eyes (`/`Pupils`/`Mouth`/`Nose`/blush block; still contains the body block and `<defs>`; is non-empty; ids still uniquified; `applyGazeMarkup` is a no-op on rear output. Guard test: FROGGI keeps `Big circular pop-out eyes`. Accessory test: eyewear/face-mark/handheld hidden, headwear/back/aura/neckwear kept. |
| **Risks** | Mixed Portuguese/English comment naming; a future SVG without comment blocks would silently render a front face. The exhaustive table is the tripwire. |
| **Dependencies** | none |
| **Two accounts?** | **No** |
| **Done when** | All 34 forms render a plausible back view in a dev harness; test table green; no visual change when `facing="front"`. |

### Phase 2: Theater seat system

| | |
| --- | --- |
| **Goal** | 26 claimable seats with stable ids (`theater-seat-a1 … theater-seat-c10`), explicit arrival/leave, seated scale, rear-facing state, correct row depth, local occupancy. |
| **Files** | `src/lib/theater-seats-config.ts` (new), `src/components/blobbi/theater/TheaterSeat.tsx` (new), stage branch of `src/components/blobbi/InteractiveElements.tsx`, `src/components/blobbi/PlayingView.tsx`, `src/components/blobbi/MovableBlobbi.tsx`, `src/lib/blobbi-world-render.ts` (new, extract the duplicated scale/z math), **deletion** of `_handleChairArrival`/`_handleChairLeave`/`_isSeated`/`_eyesClosed` |
| **Tests** | Config invariants (ids unique, 26 claimable + 2 non-claimable, claimable centers within 2–98 %, `zIndex` per row, `seatedScale` descending). Behavior harness mirroring `MovableBlobbi.hiding.test.tsx`: arrival sets `sittingIn`; any `onMoveStart` clears it; location change clears it; seated render has no shadow, no float, `facing="back"`, scale 0.85/0.78/0.72. |
| **Risks** | Pixel drift converting flex `-space-x-4` rows to absolute placement (use the measured centers in the audit §1.8). Row C's seat anchor sits only 2.6 points inside the walk boundary, verify arrival fires; widen to `y: [74, 98]` if not. Removing the dead chair path touches arcade/station/shop chairs: migrate them with tests in the same commit. |
| **Dependencies** | Phase 1 (for `facing`) |
| **Two accounts?** | **No** |
| **Done when** | Sitting is explicit local state with a clean stand-up transition, every seat has a unique id, the two off-world seats are non-claimable, no dead chair code remains. |

### Phase 3: Local YouTube player

| | |
| --- | --- |
| **Goal** | Official IFrame Player API in the theater screen, curated catalog, full local host controls (play/pause/timeline/±10/restart/rate), loading + error states, autoplay handling, fullscreen, captions. **No Nostr.** |
| **Files** | `src/lib/youtube-player.ts` (adapter), `src/hooks/useYouTubePlayer.ts`, `src/lib/theater-catalog.ts`, `src/lib/theater-layout.ts`, `src/components/blobbi/theater/TheaterScreen.tsx`, `src/components/blobbi/theater/HostControls.tsx` |
| **Tests** | Adapter unit tests against a fake `YT` global: script injected once; `destroy()` on unmount; error codes 2/5/100/101/150/153 mapped to user-facing states; `videoId` shape + catalog validation; `+10`/`−10`/restart clamp at duration bounds and 0. Integration: entering the theater and leaving stops audio. |
| **Risks** | Autoplay/mobile restrictions (muted-first join, `playsinline=1`, `allow="autoplay; encrypted-media; fullscreen"`); leaked iframes keeping audio alive after navigation; fullscreen fighting the existing `useFullscreen`/`FullscreenExitButton` shell. |
| **Dependencies** | screen mount from the audit's Phase 1 work (can be folded in here) |
| **Two accounts?** | **No** |
| **Done when** | One player can watch a catalog video alone on desktop and iOS Safari, every control works locally, and leaving the room stops playback. |

### Phase 4: Shared-playback protocol library (pure)

| | |
| --- | --- |
| **Goal** | The whole protocol as deterministic, framework-free code: schemas, builders, parsers, validation, revision comparison, expected-position, clock-offset estimation, drift decision, invite-code generation/normalization/resolution. |
| **Files** | `src/lib/shared-playback/types.ts`, `schema.ts`, `builders.ts`, `parse.ts`, `ordering.ts`, `timing.ts`, `invite-code.ts`, `index.ts`; `src/lib/blobbi-kinds.ts` (export `KIND_SHARED_PLAYBACK_SESSION = 31951`, `KIND_SHARED_PLAYBACK_COMMAND = 21951`); `NIP.md` (document both kinds); `docs/protocol/shared-playback-session.md` (this file, kept in sync) |
| **Tests** | The correctness core, all offline: every validation rejection in §4.4 and §5.4 (one test per numbered rule); `compareRevisions` for greater-rev / equal-rev-different-`created_at` / equal-both-different-id; `expectedPosition` for paused, playing, `rate ≠ 1`, clamping, unknown duration, negative/absurd elapsed; `estimateClockOffset` convergence and outlier rejection; `driftAction` at 0.5/0.75/1.0/2.0/3.0 s; invite-code alphabet + no modulo bias (statistical) + normalization + all nine resolution branches of §13.2; round-trip build → parse for all 7 canonical and 9 command examples in §16. |
| **Risks** | Schema churn later, mitigate by shipping `NIP.md` in the same commit and gating on `version`. Zod is already a dependency (`zod ^4.3.6`) and is the natural validator; keep it out of the hot path (validate on receive, not per tick). |
| **Dependencies** | none (deliberately) |
| **Two accounts?** | **No** |
| **Done when** | 100 % of the protocol's decision logic is unit-tested with no React, no relay and no player; the §16 examples parse and re-serialize identically. |

### Phase 5: Session creation and join flow

| | |
| --- | --- |
| **Goal** | Create a session; show/copy the code; resolve a code; subscribe; recover the latest state from a single query; distinct host and guest modes. |
| **Files** | `src/hooks/useSharedPlayback.ts` (new), `src/components/blobbi/theater/CreateSessionPanel.tsx`, `JoinByCodeDialog.tsx`, `SessionBadge.tsx`, `TheaterScreen.tsx` |
| **Tests** | Hook tests with a mocked `nostr` (the project already has `subscribe`/`nostr.req` fallback patterns to mimic): create publishes `rev 0` paused at 0; code collision retry; resolution ambiguity surfaces a chooser instead of joining; expired/ended sessions are refused with the right message; guest UI renders no global controls. |
| **Risks** | Duplicate-session creation by the same host (enforce one live session per pubkey per room locally); users mistyping codes (uppercase + trim + alphabet-restricted input). |
| **Dependencies** | Phases 3, 4 |
| **Two accounts?** | Not strictly, a second browser profile makes it far easier to see guest mode, but the flow can be smoke-tested with one account joining its own session's code as a guest view. |
| **Done when** | Two clients (or two profiles) reach the same session via a 6-character code, and a fresh reload recovers the exact state from one query. |

### Phase 6: Ephemeral commands and canonical updates

| | |
| --- | --- |
| **Goal** | The full paired publication path with optimistic host application, guest application, out-of-order handling and publication-failure recovery. |
| **Files** | `useSharedPlayback.ts`, `src/lib/shared-playback/publish.ts` (sequence + retry + rev commitment), `HostControls.tsx`, `TheaterScreen.tsx` |
| **Tests** | Sequence tests with a mocked publisher: order is optimistic → `21951` → `31951`; both events carry the same `rev`/`updatedAt`/`position`; retry reuses the same `rev`; signing rejection reverts the optimistic action and releases the `rev`; `31951`-before-`21951` delivery is a no-op; a `rev` jump of +3 applies cleanly; a command from a non-host pubkey is discarded; a command for another session address is discarded. |
| **Risks** | Publish storms from slider drags (debounce on `pointerup` + 3 s rate limit); `useNostrPublish` currently *swallows* failures for kind 31950 (`src/hooks/useNostrPublish.ts:44-48`): the new kinds must get **real** error propagation, so this hook needs a non-swallowing path or a dedicated publisher. |
| **Dependencies** | Phase 5 |
| **Two accounts?** | **Yes** for meaningful verification (guest application, ordering), though the failure matrix is unit-testable with mocks. |
| **Done when** | Host actions appear on a second client within ~1 s via `21951`, and blocking the ephemeral kind still yields correct (slower) behavior via `31951`. |

### Phase 7: Drift, buffering and reconnection

| | |
| --- | --- |
| **Goal** | The 5 s passive check, hard-seek threshold, clock-offset estimation, buffering suspension, tab-suspension/device-sleep wake handling, relay reconnect, late join, missing-ephemeral recovery. |
| **Files** | `src/lib/shared-playback/timing.ts`, `useSharedPlayback.ts`, `useYouTubePlayer.ts` |
| **Tests** | Fake-timer tests: no network call is produced by any passive check (assert publisher not called); correction suspended while `BUFFERING`; a 2 s settle window after a seek; one hard seek max per tick; `visibilitychange` forces immediate reconciliation; a simulated wall-clock jump triggers re-query and discards old clock samples; a stale `lastCanonicalAtMs` (> 90 s) surfaces "host may have disconnected" without seeking wildly; `rate` unavailable ⇒ correction suspended, not a seek loop. |
| **Risks** | Correction loops (seek → buffer → drift → seek): guarded by the settle window and buffering suspension; over-correcting a paused session; throttled timers on mobile. |
| **Dependencies** | Phase 6 |
| **Two accounts?** | **Yes** for the end-to-end drift and reconnect checks. |
| **Done when** | Two clients stay within ~1 s over a 10-minute video across a tab reload, a network blip, a background tab, and a mid-video join. |

### Phase 8: Presence and multiplayer seats

| | |
| --- | --- |
| **Goal** | `seatId` + `activity.session` in presence; remote seated rear-facing rendering; deterministic occupancy conflict handling; theater-leave cleanup. |
| **Files** | `src/lib/multiplayer.ts` (`PresenceContent.seatId`, `activity`, `publishSit`, heartbeat preservation), `src/hooks/useIslandPresence.ts` (`sitAt`/`clearSit`, `PlayerRenderState`), `src/components/blobbi/MultiplayerLayer.tsx`, `src/lib/blobbi-world-render.ts`, `NIP.md` |
| **Tests** | `multiplayer.seating.test.ts` beside `multiplayer.hiding.test.ts`: `seatId`/`activity` survive heartbeats, are absent from `publishMove`, are ordered by `seq`, are cleared on location change. Layer test: a remote with `seatId` renders at the seat anchor, rear-facing, at the row's seated scale; two players claiming one seat resolve to the **same** winner (lower hex pubkey) on both clients. Decoupling test: `src/lib/shared-playback/**` imports nothing from theater/seat/presence/render modules (assert via a static import scan). |
| **Risks** | Local/remote render divergence from the duplicated scale/z math, the shared module lands in Phase 2 and is *used* here; presence content growth (keep fields optional and small). |
| **Dependencies** | Phases 2, 5 |
| **Two accounts?** | **Yes** |
| **Done when** | Two profiles see each other seated in the correct seats, rear-facing, identically, and leaving the theater clears both seat and session references. |

### Phase 9: Two-account validation

| | |
| --- | --- |
| **Goal** | Manual end-to-end verification of the whole feature against real relays. |
| **Files** | `docs/theater-manual-validation.md` (new checklist, mirroring `docs/INVENTORY_MANUAL_VALIDATION.md`) |
| **Tests** | Scripted manual matrix: play · pause · timeline seek · +10 · −10 · restart · media change · rate change · one client buffering (throttle to 3G) · late join mid-video · relay reconnect (kill/restore network) · relay reordering (publish while one client is offline) · host ends session · guest native pause → auto-rejoin · guest with an unsupported rate · embed-disabled video · session expiry behavior. Record observed drift at 1, 5 and 10 minutes. |
| **Risks** | Real-world relay latency and single-relay routing (`NostrProvider` pins one relay) may mask cross-relay problems; note explicitly as untested. |
| **Dependencies** | Phases 1–8 |
| **Two accounts?** | **Yes, mandatory.** Two identities *and* two browser profiles (multiple devices for the same pubkey is its own row in the matrix). |
| **Done when** | Every row passes on desktop + mobile, and the observed drift stays inside the §8.3 ignore band in steady state. |

### 19.1 Phase dependency graph

```
Phase 1 (rear-facing) ──┐
                        ├─► Phase 2 (seats) ──────────────┐
Phase 3 (local player) ─┴─► Phase 5 (create/join) ──► 6 ──► 7 ──► Phase 8 ──► Phase 9
Phase 4 (pure protocol) ───► Phase 5
```

Phases 1, 3 and 4 are mutually independent and can be built in parallel.

---

## 20. Final recommendation

1. **Are `31951` and `21951` acceptable as experimental kinds?** **Yes**, with the framing in
   §1.4: they are application-private by convention, documented as experimental and explicitly
   not NIPs, chosen adjacent to this project's existing `31950`/`21201`, and made safe by
   structural validation rather than by number ownership. Document both in `NIP.md` alongside the
   existing kinds.
2. **Was any usage or collision found?** **No.** Zero hits in this repository, the official NIPs
   kind table, `registry-of-kinds` (`schema.yaml`, 4 410 lines), `nostrbook.dev/kinds`, GitHub
   code and issue search, and web search. A read-only relay probe of `relay.ditto.pub`,
   `relay.primal.net` and `nos.lol` returned **0 stored and 0 live events for both kinds**.
   Two ecosystem relays (`relay.nostr.band`, `relay.damus.io`) refused the WebSocket handshake
   from this environment and were **not** checked. **The `21951` finding is weak by construction**,
   ephemeral events are not stored, so only the 20-second live window carried any signal. None
   of this guarantees global uniqueness.
3. **Final `31951` schema.** Tags `d`, `r`, `c`, `t: shared-playback`, `t: <provider>`,
   `provider`, `media`, `status`, `client`, `alt`, `expiration`; content
   `{ version: 1, rev, media{provider,id}, playback{state,position,updatedAt,rate}, permissions{mode:'host-only'} }`
   (§4). `content` is authoritative; the multi-letter tags are unqueryable mirrors.
4. **Final `21951` schema.** Tags `a` (session address + relay hint), `p` (host),
   `t: shared-playback`, `client`, `alt`, `expiration` (`now + 30 s`); content is the
   discriminated union of `play | pause | seek | set-media | set-rate | end-session`, every
   variant carrying `version`, `rev`, `position`, `updatedAt` (and `rate` except `end-session`),
   with **absolute positions only** and `reason` as presentation-only metadata (§5).
5. **Session `d` generation.** A fresh lowercase UUIDv4 per session from `crypto.randomUUID()`,
   never reused, no prefix. Address = `31951:<host-pubkey>:<d>`.
6. **Reusable `r` identity.** `blobbi-island:theater:main`, stable across sessions; a new session
   reuses `r`, mints a new `d` and a new `c`.
7. **Invitation code.** 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 glyphs,
   `8.875×10⁸` codes), uppercase, generated with rejection sampling (reject bytes ≥ 248),
   published as the indexed `c` tag, resolved by `#c` with the nine-step algorithm in §13.2,
   collision-checked before publishing with ≤ 5 retries, ambiguity surfaced rather than guessed.
   **Public, not access control.**
8. **Publication order.** Compute canonical state → apply optimistically to the host's own player
   → publish `21951` (fire-and-forget) → publish `31951` (awaited, retried with the **same**
   `rev`/`updatedAt`/`position`) → commit `rev`. Reserve `rev` at intent, commit on acceptance,
   release on failure. The full failure matrix is §11.3; every branch recovers from the
   addressable event.
9. **Revision rules.** Same `rev` in both events for one action. Order by `rev`, then
   `created_at`, then `event.id`. Apply only strictly-greater `rev`; equal `rev` is a no-op;
   equal `rev` with materially different state is a protocol violation where the canonical event
   wins. Hosts MUST NOT publish two different states under one `rev`. `created_at` alone is never
   sufficient.
10. **Clock-drift strategy.** Do not trust `updatedAt` raw and do not assume synchronized clocks.
    Use a **passive per-host offset estimate**: `sample = receivedAtLocalMs − updatedAt`, offset =
    **median of the last 8 samples**, clamped to ±5 min, reset on host change, refreshed free of
    charge by the 20 s keepalive. Its bias (median one-way latency, typically < 200 ms) is an
    order of magnitude under the 750 ms ignore threshold. No ping/pong, no NTP, no extra events.
11. **Buffering recovery.** Local and private: never pauses the session, never publishes, always
    suspends drift correction while `BUFFERING`; on resume, recompute `expectedPosition` and hard
    seek only if drift > 2 s. Buffering, host pause, ended, autoplay-blocked and player-not-ready
    are five distinct states and only host pause is shared (§9.1).
12. **Default expiration.** **4 hours, refreshed on every canonical publish** (control action or
    20 s keepalive). Two hours risks expiring mid-film; duration-based expiry is unavailable at
    create time and breaks on media change and long pauses. Host-away is detected by a stale
    canonical update (> 90 s), **not** by expiration. On a clean end, shorten `expiration` to
    `now + 10 min` so reconnecting guests learn the session ended.
13. **Exact implementation order.** 1 rear-facing renderer → 2 seat system → 3 local player →
    4 pure protocol library → 5 create/join → 6 paired commands + canonical updates → 7 drift,
    buffering, reconnection → 8 presence + multiplayer seats → 9 two-account validation.
    Phases 1, 3 and 4 are parallelizable; the network appears only at Phase 5; two accounts
    become mandatory at Phase 6 and non-negotiable at Phase 9.
14. **What must be reviewed before any source implementation begins.**
    * **The two kind numbers**, accepting the §1.4 uniqueness caveat, especially that the
      `21951` probe is structurally weak.
    * **The `31951` content schema** (§4.2) and **`21951` command union** (§5.2): these are the
      hardest things to change once events are on relays.
    * **`updatedAt` in milliseconds** as a content field distinct from `created_at`.
    * **Host-only authority** and the decision that guests get no protocol write path in v1.
    * **The revision contract**, including "same `rev` in both events" and the reserve/commit/
      release lifecycle.
    * **The publication order** and the failure matrix (§11.3), particularly retrying `31951`
      with an unchanged `rev`.
    * **The clock-offset approach** (§8.2) and the **drift thresholds** 0.75 s / 2 s / 5 s.
    * **The 4 h rolling expiration** and 20 s keepalive cadence, and the 90 s host-away hint.
    * **The invitation alphabet and resolution rules**, including the deliberate refusal to
      silently join an ambiguous code.
    * **The decoupling rules** (§14.3): presence holds only the address string; the protocol
      library imports nothing from the game.
    * **The v1 exclusion list** (§15).
    * **Two open product decisions the protocol does not settle:** the initial curated catalog
      (three approved, embeddable videos) and whether media change should preserve the play state
      (recommended) or always land paused.

---

## Appendix: constants

```
KIND_SHARED_PLAYBACK_SESSION = 31951      addressable (30000..39999)
KIND_SHARED_PLAYBACK_COMMAND = 21951      ephemeral   (20000..29999)

CONTENT_VERSION              = 1
ROOM_THEATER_MAIN            = 'blobbi-island:theater:main'
INVITE_ALPHABET              = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'   // 31 glyphs
INVITE_LENGTH                = 6                                   // 887,503,681 codes
INVITE_REJECT_BYTE_AT        = 248                                 // 256 - (256 % 31)
INVITE_COLLISION_RETRIES     = 5

SESSION_TTL_MS               = 4 * 60 * 60 * 1000                  // 4 h, rolling
COMMAND_TTL_MS               = 30 * 1000
KEEPALIVE_INTERVAL_MS        = 20 * 1000
HOST_AWAY_AFTER_MS           = 90 * 1000
ENDED_TTL_MS                 = 10 * 60 * 1000

DRIFT_CHECK_INTERVAL_MS      = 5000
DRIFT_IGNORE_S               = 0.75
DRIFT_HARD_SEEK_S            = 2.0
SEEK_SETTLE_MS               = 2000
BUFFER_WARN_MS               = 15000

CONTROL_RATE_LIMIT_MS        = 3000
SKIP_STEP_S                  = 10
CLOCK_SAMPLE_WINDOW          = 8
CLOCK_OFFSET_CLAMP_MS        = 5 * 60 * 1000
MAX_POSITION_S               = 86400
MIN_RATE / MAX_RATE          = 0.25 / 4
UPDATED_AT_SANITY_MS         = 300000    // |updatedAt - created_at*1000| bound
```
