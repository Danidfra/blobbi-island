# Communication V2: structured Island messages

**Status:** implemented. Kind `21201` now carries four classes of message,
free text, quick phrases, filled-in templates and emotes, instead of only free
text. Nothing about Standard's behaviour changed: it can send and render all
four, and free text is byte-compatible with what shipped before.

- Protocol summary: [`../NIP.md`](../NIP.md) § kind 21201
- Capability model: [`family-safety-policy.md`](./family-safety-policy.md)
- Why any of this: [`family-safety-audit.md`](./family-safety-audit.md)

---

## 1. Why structured messages

Two problems, one answer.

**Communication was bad for everyone.** One text field is slow on a phone,
impossible for a child who cannot yet spell, and the wrong tool for the three
things players say most: hello, where are you going, do you want to play. Quick
phrases, a small phrase builder and emotes are faster than typing for all of
them.

**Free text is the only class that can carry anything at all.** A quick phrase
is a reference into a catalog this build ships; the receiver produces the words.
That is what makes it safe to show a player in a profile that does not permit
free text: and it is why Family mode is a *substitution* rather than a removal.
Three of the four classes survive.

---

## 2. Protocol decision

**Kind `21201`, structured `content`. No new kind.**

Nothing about a structured message needs different storage, expiration or
routing than a free-text one: same ephemeral range, same NIP-40 expiry, same
`l`/`i` scoping, same subscription, same bubble. A new kind would have bought a
second protocol to document and maintain in exchange for nothing.

The extension point was already there. The deployed receiver rejects any payload
whose `content.type` is not `"chat"`, so new `type` values are invisible to it,
an older tab ignores a phrase rather than mis-rendering it.

**Emotes ride on 21201, not on presence.** Kind `31950` reserves
`state: 'emote'` and `NIP.md` marks it "reserved for a future emote/reaction
feature", which reads like an existing affordance. It is not one: nothing
publishes it, nothing consumes it, and the same document states that `state`
"describes MOTION only". More importantly it is the wrong shape. Presence is a
replaceable event with a 35-second expiry and a heartbeat; an emote is a
momentary utterance. Putting one in presence would leave it hanging over a
Blobbi for half a minute or require a second clearing event, and it would race
the `seq` ordering that movement depends on. `state: 'emote'` remains reserved
and unused; a future *pose* (a Blobbi that visibly waves) is what it is for, and
that is a rendering concern layered on top of the message, not a replacement for
it.

---

## 3. Content schema

Every payload keeps the envelope the deployed schema already had.

| Field | Type | Notes |
|---|---|---|
| `type` | string | `"chat"` (free text) · `"quick"` · `"template"` · `"emote"` |
| `location` | string | the sender's `LocationId`; the receiver compares it to its own |
| `blobbiD` | string? | informational |
| `ts` | number | unix seconds |
| `v` | number | **structured classes only.** Currently `1`. Absent on free text. |

### Free text

```json
{ "type": "chat", "location": "town", "blobbiD": "b1", "ts": 1800000000, "text": "hello there" }
```

Unchanged, deliberately. Renaming it `"text"` would have broken the one class an
older client *can* render. The parser also accepts `"text"` so a future client
that prefers the clearer name interoperates; this client emits `"chat"`.

### Quick phrase

```json
{ "type": "quick", "v": 1, "location": "town", "ts": 1800000000, "phrase": "want-to-play" }
```

### Template

```json
{
  "type": "template", "v": 1, "location": "town", "ts": 1800000000,
  "template": "meet-at-in",
  "params": { "location": "arcade", "time": "10m" }
}
```

### Emote

```json
{ "type": "emote", "v": 1, "location": "town", "ts": 1800000000, "emote": "wave" }
```

Tags are unchanged: `d` (session), `l` (location), `i` (island), `p` (author),
`expiration` (~10 s), `alt`. The `alt` tag carries the LOCAL rendering as a
NIP-31 description for clients that do not know this kind. **No receiver in this
app reads it back**: it is documentation of the event, not data.

### What a structured payload deliberately does not contain

No `text`. No `fallback`. No display label. No localized string.

This is the property everything else rests on: **the discriminant is
unambiguous**. A message either *is* free text, or it is a reference into a local
catalog. A payload carrying both would force every receiver to hold the invariant
"ignore `text` when `phrase` is present": a rule one careless edit from being
violated, in the exact code path that decides what a child is shown.

A `fallback` string was considered for legacy rendering and **rejected**: an old
client rejects the whole event on `type` before it could ever read one, so it
would add risk and buy nothing.

---

## 4. Versioning

`v` is required on structured classes and refused if unrecognised. A future
version exists precisely because something about the meaning changed, and
guessing at a schema is how a receiver renders a message it did not understand.

Free text carries no `v`, because its shape predates versioning and must keep
parsing on clients that have never heard of it.

---

## 5. Legacy and interoperability

| Sender | Receiver | Result |
|---|---|---|
| old client, free text | new client, Standard | renders, exactly as before |
| old client, free text | new client, Family | **refused**: it is free text |
| new client, free text | old client | renders, exactly as before |
| new client, quick / template / emote | old client | **silently ignored** (`type !== "chat"`) |
| new client, structured | new client | renders from the local catalog |
| any client, unknown `type` | new client | ignored |
| any client, unknown phrase/emote/template id | new client | ignored |

**The known limitation:** a structured message does not render on a client that
predates Communication V2. That cost is bounded and was accepted deliberately,
Blobbi Island is a web app, so the "old client" population is a stale tab or a
third-party client, not an install base. Free text, which is what those clients
can render, is unaffected.

**The compatibility rule and the safety rule are the same rule.** Legacy free
text and new free text are byte-identical on the wire, and both are governed by
`freeTextChat`. Nothing downstream needs to tell them apart, which is why the
parser reports `legacy` as information rather than as a decision.

---

## 6. Validation

`src/communication/parse.ts`: pure, and it never throws (it runs inside the
multiplayer receive loop, where an exception would take out the subscription for
everyone in the room).

Rejected, each with a distinct typed reason: payloads over 2 KiB (measured in
bytes, checked before `JSON.parse`), malformed JSON, non-objects, missing or
non-string `type`, unknown `type`, unrecognised `v`, non-string or empty text,
unknown phrase id, unknown emote id, unknown template id, non-object `params`,
a missing parameter, an **unexpected** parameter, a non-string parameter value,
and a value outside its parameter's catalog, including a value from the *wrong*
catalog.

Unexpected parameters are refused rather than ignored: a passenger field is
something a more forgiving reader downstream might one day pick up.

### Trusted local reconstruction

For a structured message the parser keeps **only the ids**. `src/communication/render.ts`
then produces every character on screen from this build's catalogs.

So a spoofed payload:

```json
{ "type": "quick", "v": 1, "phrase": "want-to-play", "text": "whats your address" }
```

parses to exactly `{ type: 'quick', phrase: 'want-to-play' }`. The `text` field
is not copied, not read, and not reachable from anything downstream; it is
*gone*, not ignored. The bubble says "Want to play?" because that is what
`quick-phrases.ts` says, in Standard and in Family alike.

Free text is the exception, necessarily: it *is* the words. That asymmetry is
exactly what `freeTextChat` governs.

---

## 7. Catalogs

Ids are the protocol; text is presentation. `'want-to-play'` travels on the
wire, `'Want to play?'` never does, which is both the safety property above and
the thing that keeps translation possible without invalidating a single
published event.

**Quick phrases** (10): `hi`, `bye`, `want-to-play`, `lets-go`, `good-game`,
`follow-me`, `wait-for-me`, `brb`, `nice-blobbi`, `thank-you`.

**Emotes** (7): `wave`, `heart`, `laugh`, `clap`, `celebrate`, `thumbs-up`,
`question`. Each has a glyph *and* an accessible label; the glyph is one way to
draw the emote, replaceable with Blobbi artwork without touching the protocol.

**Templates** (5):

| id | sentence | parameters |
|---|---|---|
| `going-to` | I'm going to {location}. | location |
| `meet-at` | Let's meet at {location}. | location |
| `meet-at-in` | Meet me at {location} in {time}. | location, time |
| `want-to-play` | Want to play {activity}? | activity |
| `back-in` | I'll be back in {time}. | time |

| catalog | values |
|---|---|
| `location` | `town`, `plaza`, `beach`, `mine`, `arcade`, `nostr-station` |
| `time` | `5m`, `10m`, `15m`, `30m` |
| `activity` | `dance`, `pool`, `air-hockey`, `treasure-hunt`, `mining`, `hide-and-seek` |

Templates are a fixed sequence of literal fragments and named holes; no parser,
no inflection, no agreement. A small typed registry, not a grammar engine.

### Locations are a curated destination list, not `LocationId`

The world has sixteen `LocationId`s, most of them interiors, arcade floors or
private rooms. The template catalog keeps its own list of six public
destinations: the same six the Map modal offers, minus `home` (private, so
"meet me at Home" is a sentence with no true reading) and plus the Arcade, and
maps each to a canonical id.

**A phrase can never carry transient private state.** There is no way to express
a coordinate, a seat id, a hiding spot, or a session address. A phrase names a
place at the granularity a map already shows publicly.

---

## 8. Safety admission

`admitChatMessage(policy, message)` in `src/safety/chat-admission.ts`, extended
from Phase A to discriminate on message class. It reads **capabilities only**,
never a profile.

| class | capability | Standard | Family |
|---|---|---|---|
| legacy free text | `freeTextChat` | accept | **reject** |
| new free text | `freeTextChat` | accept | **reject** |
| quick phrase | `predefinedPhrases` | accept | accept |
| template | `predefinedPhrases` | accept | accept |
| emote | `emotes` | accept | accept |

Quick phrases and templates share one capability: both are a sentence assembled
from a catalog this build ships, and no one has a reason to allow "Hi!" while
refusing "Meet me at the Beach in 10 minutes".

The union is switched exhaustively, so **adding a message class is a compile
error until someone decides which capability governs it**. An unrecognised class
fails closed.

### Both boundaries

**Outbound** (`MultiplayerLayer.sendMessage`): refusing to send stops the app
offering an input whose output it would discard, and it sits below the composer
so no other holder of the send ref can route around it.

**Inbound** (`MultiplayerLayer.processChatEvent`): the one that actually
protects a player, because the sender is not necessarily this build. A Standard
player in the same room, or any third-party client, will emit whatever it likes
regardless of what this client's UI looks like.

The inbound order is checked structurally by `src/safety/boundaries.test.ts`:

```
scope → parse → duplicate → ADMIT → throttle → render → queue
```

Parsing first is what strips a spoofed payload to ids. Admitting before
rendering is what stops a refused message from being turned into words at all.
Both before `queueBubble` is what keeps unadmitted content out of the
presentation layer entirely.

### What admission does not do

It never inspects content: no length, no filter, no term list. Structure and
bounds are the parser's job; capability is admission's. Keeping them apart is
what makes the security claim checkable, the spoofing attack is defeated in the
parser, and admission then sees an ordinary quick phrase because that is all
that is left of it.

---

## 9. UI

`CommunicationPanel` (`src/components/blobbi/communication/`), opened from the
dock's **Talk** button. The dock is now a launcher: it used to transform in place
into a text field, which made it the owner of a composition surface it had no
other reason to know about.

Tabs are **derived from capabilities before render**: a tab that is not allowed
does not exist in the tablist, has no panel, and cannot be reached by arrow keys
or by a stale `value`. Hiding it with CSS would leave a composer mounted, and a
mounted composer is one `onSend` away from being reachable.

| | Standard | Family |
|---|---|---|
| Quick | ✅ | ✅ |
| Phrases | ✅ | ✅ |
| Emotes | ✅ | ✅ |
| Message | ✅ | **absent** |

Family sees three tabs of things it *can* do. There is no disabled box and no
explanation of what the player may not do: a restricted experience that reads as
a punishment is one a child works around. A test asserts the panel contains no
"not allowed"/"disabled"/"cannot"/"blocked" copy.

**One layout for both pointers.** A bottom-anchored sheet on a phone and a
bottom-anchored panel on a desktop are the same component with a width cap.
Nothing depends on hover, every target is at least 44 px, and the panel renders
inside the game frame rather than in a portal, the island can be fullscreen, and
a portalled overlay would land outside it.

**Accessibility.** Real `<button>`s throughout; `role="dialog"` with a label;
`role="tablist"` / `role="tab"` with `aria-selected` and `aria-controls`; Escape
closes; emote controls are named by their label with the glyph `aria-hidden`;
bubbles are `role="status"` with an `aria-label` carrying the text equivalent, so
an emote reaches a screen reader as "Clap" rather than as a stray character. The
phrase builder uses native `<select>`: the best touch control on every phone,
keyboard- and screen-reader-correct by default, and it renders in place rather
than through a portal.

**The builder previews with the same function the receiver renders with**
(`renderTemplateText`). A preview built by different code is a preview that can
lie about what you are about to say.

**Sending closes the panel for one-tap classes** and keeps it open for typing,
which is a conversation.

---

## 10. Rate limits

Per class, because the cheaper the input, the higher the floor: typing is its own
rate limit and tapping is not.

| class | send cooldown |
|---|---|
| free text | 500 ms *(unchanged from what shipped)* |
| quick / template / emote | 1000 ms |

**Inbound is enforced separately**, per sender pubkey, at **400 ms** minimum
interval. A send cooldown lives in the client the sender controls, so it protects
nobody; this is the half that bounds what a player is subjected to. It is sized
below the *fastest* send cooldown so a player typing quickly is never throttled
by a receiver, and it is a minimum-interval gate rather than a token bucket, a
bucket would let a sender bank silence and spend it as a burst, which is exactly
"say nothing for a minute, then put twenty emotes over someone's head".

A refused message is dropped, never queued: a queue turns a flood into a delayed
flood. Throttle memory is bounded (TTL plus a tracked-sender cap).

### One deliberate change to duplicate suppression

Duplicate delivery now keys on the **event id**. It used to key on
`pubkey:sessionId` within 2 s, which suppressed every second message from a
sender in that window, including two *different* ones. That was duplicate
suppression doing rate limiting by accident and doing both badly: it would have
made "wave, then heart" silently lose the heart. The rate limit it was
accidentally providing is now stated explicitly above, and is more permissive
(400 ms rather than 2 s), so Standard chat became slightly *better*, not worse.

Bubbles remain bounded to one per player (a new bubble replaces the previous
one), so a flood cannot accumulate on screen.

---

## 11. Known limitations

- **Structured messages do not render on pre-V2 clients** (§5). Deliberate.
- **Client-side limits are client-side.** Cooldowns, catalogs and payload bounds
  constrain this build. A third-party client can emit anything; that is why every
  guarantee here is a *receiver* guarantee.
- **A Family player and a Standard player in the same room have an asymmetric
  conversation**: the Standard player's free text is not shown to the Family
  player, and nothing tells either of them so. Surfacing "someone said something
  we don't show here" is a deliberate open question, not an oversight; see the
  `ChatRejectionReason` carried by every refusal, which exists for it.
- **The receive path now bounds payload size (2 KiB) where it previously did
  not.** This is a small, intentional Standard behaviour change, closing audit
  finding H-7. The largest legitimate payload is roughly an order of magnitude
  smaller.
- **Emotes render as a bubble**, not as a Blobbi animation. The smallest solid
  implementation: it reuses the whole anchoring and lifetime machinery, and
  leaves a real emote *pose* as a later, purely visual change.
- **No moderation, blocking, muting or reporting exists.** Unchanged by this
  phase and still the highest-severity open finding in the audit.
