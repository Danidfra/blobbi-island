# Player safety — Mute, Block and Report

**Status:** implemented. Available in every experience profile, Standard and
Family alike. **No new Nostr kind, tag convention or event was created.** Nothing
is published; every control is local and immediate.

- Rationale: [`family-safety-audit.md`](./family-safety-audit.md) (findings C-2, H-2)
- Capability model: [`family-safety-policy.md`](./family-safety-policy.md)
- Communication protocol: [`communication-v2.md`](./communication-v2.md)

---

## 1. The problem this solves

Communication V2 gave the island control over **what** a player may say. It had
no answer to the other half:

> I do not want to interact with **this** player.

A child could be followed from room to room and sent perfectly policy-compliant
quick phrases by someone they wanted nothing to do with, and their only option
was to close the tab. Restricting speech is not recourse.

---

## 2. Semantics

Three concepts, deliberately distinct.

### Mute — *I do not want to hear this player*

- Their communication is discarded at ingest: free text, quick phrases,
  templates and emotes alike.
- **They stay visible.** Their Blobbi still walks around, still gazes, still
  sits in the theater. Muting is "I do not want to read this", not "I do not
  want you here".
- Their presence is untouched — no filtering, no coarsening.
- One tap, no confirmation, and the button relabels itself to **Unmute**. A
  dialog asking "are you sure you want to stop reading this?" charges friction to
  the person being bothered.

### Block — *I do not want this player in my experience*

- Their presence is discarded **before it becomes application state**: no entry
  in the players map, no actor, no bubble anchor, no gaze target, no walk target.
- Their communication is discarded.
- A player already on screen is **evicted immediately**, not when their presence
  expires.
- Any open card about them closes.
- Confirmed first, because the effect is large — and the confirmation is where
  the honest description lives.

**What block cannot do, stated plainly in the UI.** This is local perception
filtering, not server authority. If you block Bob:

| | |
|---|---|
| ✅ your client stops showing Bob to you | |
| ✅ your client stops sending intentional interactions toward Bob | |
| ❌ **Bob's client keeps receiving the public presence you publish** | he can still see you |
| ❌ Bob is not removed from the room for anyone else | |

The dialog says: *"Blocking hides them from you. It does not hide you from them,
and it does not remove them from the island for other players."* Claiming
otherwise would promise privacy the architecture does not provide.

Hiding a protected player's presence **from** blocked users is a different
architecture — it needs either relay-side filtering or per-recipient presence,
neither of which exists. Recorded here as out of scope, not as solved.

### Report — *capture what happened*

- Captures evidence at report time, because kind 21201 expires in ~10 seconds.
- Does **not** block. A control that quietly does a second thing is one the
  player cannot reason about. "Report and block" is offered as its own button, so
  both actions are chosen, once each.

---

## 3. Existing Nostr primitives considered

**The architectural rule, for this phase and future ones:** before designing any
new kind, tag convention or list format, check whether Nostr already has one.
Ask three questions in order — *does a current NIP cover this?*, *does it fit
without distortion?*, *are its privacy properties acceptable for a child-facing
product?* — and record the answers. A standard that fits but publishes something
a child should not publish is a standard we decline **with a reason**, not one we
skipped.

| NIP / kind | Purpose | Status | Fit | Privacy implications | Decision |
|---|---|---|---|---|---|
| **NIP-51 kind 10000 — Mute list** | People, hashtags, words and threads the user does not want to see | `draft` `optional`; standard replaceable | **Good** for mute. `p` tags carry pubkeys; public entries in `tags`, private entries NIP-44-encrypted in `content` (NIP-04 deprecated but still readable) | Public entries expose who a child has muted — a permanent, public record of unwanted contact. Private entries need a signer with NIP-44 support, which not every login method has | **Rejected for now, adopted as the future sync format.** §4 |
| **NIP-51 kind 30007 — Kind mute sets** | Mute a pubkey for specific event kinds (`d` = kind string) | `draft` `optional` | Poor. Expresses "mute this person's kind-21201 events everywhere", which is a cross-app effect the player did not ask for, and splits one decision across two list kinds | Same as above | **Rejected** — wrong scope |
| **NIP-51 kind 10006 — Blocked relays** | Relays a client should never connect to | `draft` `optional` | Not applicable — relays, not people | n/a | **Not applicable** |
| **NIP-02 kind 3 — Follow list** | Follows | Live | Not applicable; there is no follow graph on the island | n/a | **Not applicable** |
| **NIP-56 kind 1984 — Reporting** | Signals that referenced content is objectionable. `p` (required) + `e` for a note, with a report type: `nudity`, `malware`, `profanity`, `illegal`, `spam`, `impersonation`, `other` | `optional`; **regular event — public and permanent** | **Structurally good, situationally wrong.** See below | Severe for this use case | **Rejected for now; mapping recorded on every report** |
| **NIP-32 kinds 1985 / `L`,`l`** | Labelling; NIP-56 explicitly allows `l`/`L` for finer report categorisation | `optional` | Would carry "made me feel unsafe" precisely, which NIP-56's own vocabulary cannot | Inherits NIP-56's publicity | **Noted** as the vehicle if publication is ever built |
| **NIP-29 kinds 9000–9030 — Relay-based groups** | Relay-enforced membership and moderation | Live | Would be real enforcement rather than local filtering | n/a | **Out of scope** — this phase is client safety, not relay moderation |
| **NIP-72 — Moderated communities** | Community post approval | **`unrecommended`** in the NIP index | — | — | **Rejected** — deprecated by the index itself |
| **NIP-09 — Event deletion request** | Request deletion | Live | Advisory only; cannot retract a published report | Relevant to why publishing is hard to undo | **Noted** |

### Why NIP-56 was not used, in detail

The structure fits: `p` for the player, `e` for the message, a report type, free
`content`. Four properties make it wrong *today*:

1. **A report is public and permanent.** Kind 1984 is a regular event. Filing one
   publishes *"this pubkey reported that pubkey for profanity"* to a relay,
   forever, undeletably (NIP-09 is a request). For a child reporting harassment
   that is a permanent public link between them and an abuse incident — and an
   invitation to retaliation.
2. **The `content` field invites republishing the abuse.** The natural thing to
   put there is what was said. That broadcasts the harmful message to everyone,
   permanently, on the reporter's own signature.
3. **The `e` tag points at nothing.** Kind 21201 is ephemeral with a ~10 second
   expiry. A reviewer following the reference finds an event no relay holds. The
   evidence has to be captured, and NIP-56 has no field for a captured event.
4. **Nothing consumes it.** There is no moderation service, no relay-side queue,
   no reviewer. Publishing would be theatre — and theatre that costs a child
   their privacy.

**The vocabulary gap, recorded as a finding.** NIP-56's report types —
`nudity`, `malware`, `profanity`, `illegal`, `spam`, `impersonation`, `other` —
predate child-safety use cases. There is **no type for grooming or predatory
contact**, which is the category children most need. Ours maps to `other`, and
the precise meaning is preserved in our own field. If publication is ever built,
NIP-32 labels are where that precision belongs.

### Nothing custom was created

No new kind. No new tag convention. No Blobbi-specific safety event. The two
local stores are `localStorage` records, not protocol artefacts, and the NIP-56
mapping is recorded on every report so the data stays translatable.

---

## 4. Persistence: local-only, deliberately

**Chosen: option A/C — local action and local evidence, with NIP-51 kind 10000
(private entries) recorded as the future sync format.**

| Option | Durability | Privacy | Verdict |
|---|---|---|---|
| Local only | This device only | Nothing leaves the device | **Chosen** |
| NIP-51 public entries | Cross-device, interoperable | Publishes who a child blocked — a public record of unwanted contact | Rejected |
| NIP-51 private (NIP-44) entries | Cross-device, interoperable-ish | Encrypted to self; but requires a NIP-44-capable signer, and the *existence and size* of the list still leaks | Future |
| NIP-56 reports | Public, permanent | Publishes abuse history under the child's key | Rejected |

Four reasons, in order of weight:

1. **Enforcement must not wait for a relay.** Pressing Block has to work now. A
   round trip is hundreds of milliseconds on a good connection and unbounded on a
   bad one, and "the person harassing you is still on screen while we publish" is
   not an acceptable failure mode. The local write *is* the enforcement.
2. **A bad merge could silently unblock someone.** Reconciling a replaceable list
   across devices means deciding what an incomplete relay read means. Getting that
   wrong restores a blocked player — a safety regression that looks like nothing.
   The repo's own relay-resilience work exists because these reads are uncertain;
   this needs the same discipline, applied deliberately, not bolted on.
3. **Not every login can encrypt.** Private list entries need NIP-44 on the
   signer. Blobbi Island supports nsec, NIP-07 extensions and NIP-46 bunkers, and
   not all of them offer it. A safety feature that silently degrades to *public*
   for some users is worse than one that is honestly local.
4. **Publishing is irreversible; not publishing is not.** Adding sync later is
   additive. Un-publishing a child's block list is impossible.

**When sync is built**, the rules are set now: the local state stays the
enforcement mechanism; a remote read is durability only; an incomplete or failed
read must **never** clear a local block; and merging is union-biased — a block
present on either side wins.

---

## 5. Enforcement points

```
kind:31950 presence ──▶ [ blocked? ] ──▶ validate ──▶ parse ──▶ players map ──▶ actor
                            ▲
                       first, cheapest, before any state exists

kind:21201 message ──▶ own? ──▶ [ silenced? ] ──▶ parse ──▶ dedupe ──▶ capability
                                     ▲                                   ▲
                            sender-level, before parsing        class-level (Family)
                                                                    ──▶ throttle ──▶ render ──▶ bubble
```

**Presence** (`useIslandPresence.processPresenceEvent`) — the block check is the
first statement in the function. It is the cheapest test available (a map lookup
versus a `JSON.parse` and a tag scan), and it means a blocked player never
becomes application state at all. Filtering at render would leave the entry in
place and hide only the last step, which is how a "hidden" player still steals a
walk target and still reappears the moment another code path reads the map.

**Communication** (`MultiplayerLayer.processChatEvent`) — the mute/block check
sits after the own-event skip and **before the payload is parsed**, so a blocked
sender's flood costs a lookup rather than a parse of attacker-supplied JSON.

The two gates ask different questions and both are needed:

| gate | question | source |
|---|---|---|
| `isCommunicationSilenced(pubkey)` | may **this person** be heard? | `src/player-safety/` |
| `admitChatMessage(policy, message)` | may **this kind of message** be shown? | `src/safety/` |

**Precedence lives in one function.** `isCommunicationSilenced` returns
`blocked || muted`, so blocking implies silence without the mute bit being set,
and the two bits can never be combined differently in two places.

---

## 6. Immediate eviction

A gate only stops the *next* event. Blocking someone already present clears what
is already there, synchronously:

| State | Cleared on block | Cleared on mute |
|---|---|---|
| Presence entry in the players map | ✅ | — |
| Live-position entry (gaze targets) | ✅ | — |
| Visible speech bubbles | ✅ | ✅ |
| Queued bubbles awaiting an anchor | ✅ | ✅ |
| Remembered message (report evidence) | ✅ | ✅ |
| Open player card | ✅ (closes) | — |

Without this a blocked player would linger until their presence expired — up to
40 seconds — and a hostile message would stay up for the rest of its four-second
life *after* the player pressed the button to stop it. Waiting out a timeout is
not a safety control.

---

## 7. Report evidence

```ts
{
  id, createdAt,
  reportedPubkey, reporterPubkey,   // reporter recorded locally, never published
  category,                          // 'mean' | 'inappropriate' | 'spam' | 'unsafe' | 'other'
  nip56Type,                         // the standard equivalent, so the record stays translatable
  islandId, location,                // room granularity — never a coordinate
  evidence: {
    sourceEvent,                     // the signed original, verbatim
    messageClass,                    // text | quick | template | emote
    renderedText,                    // what THIS build put on screen
  } | null
}
```

**Both halves, because they answer different questions.** The signed event is
verifiable — anyone can check the signature and confirm the reported pubkey
really published it — but for a structured message it is only ids
(`{"type":"quick","phrase":"hi"}`), which means nothing to a reviewer. The
rendered text is readable but unverifiable alone. Together they are evidence.

**Evidence authorship is checked.** A report may only carry a kind 21201 event
whose author *is* the reported player. Without that check a client could attach
somebody else's signed message to a report about a third party, turning the one
verifiable part of a report into a way to frame people.

**What is deliberately not collected:** movement history, the room's other
messages, who else was present, session identifiers, anything about the wider
world. A safety feature that accumulates context is a surveillance feature
wearing a helpful label, and this one is used by children. A test asserts the
stored record's exact key set.

The evidence source is a memory-only buffer holding **one message per player**
(`recent-messages.ts`), cleared when the player changes room. Persisting a
transcript to make reporting easier would build a log of everything every child
was told, on the child's own device, for a feature used once.

### Where reports go

**Nowhere.** They are stored locally, capped at 50, and nothing publishes them.
The dialog says so:

> Reports are saved on this device. Nobody reviews them yet, so if someone is
> bothering you, block them too and tell a grown-up you trust.

A test asserts `report.ts` contains no publish path at all, and another asserts
the copy never says "our team will review this". That sentence is the one a
distressed child would take at face value, and the moment they most need help is
the worst possible moment to be optimistic about a roadmap.

---

## 8. Persistence and multi-tab

| | Behaviour |
|---|---|
| Reload | Blocks and mutes survive — `localStorage`, key `blobbi:safety:relationships:v1` |
| Unblock then reload | Stays unblocked |
| Second tab | Live: `localStorage` fires `storage` in every other document, so a block in tab A evicts the player from tab B's world immediately |
| Storage unavailable | The write reads back and **reports failure**; the UI shows an error rather than a success it cannot back up |
| Corrupt store | Reads as "no relationships" rather than throwing — this runs in the receive loop, where an exception would take down the room's subscription for everyone |

That last row is the unsafe failure direction and is stated rather than hidden: a
corrupt store forgets a block. The alternative — refusing to render until storage
can be read — fails the whole game closed for what is usually private browsing.
The mitigation is the read-back at write time.

**Bounds never cost a block.** The store is soft-capped at 500 players. When
full, a new entry displaces the oldest *mute-only* relationship; if every entry
is a block, the store exceeds the cap instead. Dropping a block to satisfy a size
limit would silently restore someone the player removed.

No `BroadcastChannel` and no new synchronisation mechanism: the `storage` event
already does it, and the store follows the same shape as `arcade-pass.ts`.

---

## 9. The re-key limitation

Nostr keys are free. A blocked player can generate a new one in seconds and
return as a stranger.

**Block is an identity-level local safety control. It is not a person-level ban,
and this phase does not pretend otherwise.** The settings screen says so in
words a child can read: *"Someone who makes a brand-new account will look like a
different player, so block them again if that happens."* A test asserts the
behaviour directly.

This is the strongest remaining argument for Family's capability restrictions: a
new key buys an attacker a fresh identity, but under a profile that refuses free
text it buys them **nothing to say**. Capability restriction does not care who is
speaking; blocking does. They cover each other's gaps.

Closing this properly needs identity friction at the relay — proof of work,
NIP-42 with a cost, an allow-list — which is relay moderation and explicitly out
of scope here.

---

## 10. Safety-policy interaction

**No new capability fields were added to `IslandSafetyPolicy`, and that is the
point.**

Mute, Block and Report are protective controls, available identically in
Standard and Family. A `canBlock` capability would imply a profile in which
blocking could be switched *off* — which is not a product decision anyone should
be able to make. Capabilities describe what an experience may *do*; these
describe what a player may *protect themselves from*. Different things,
deliberately not modelled together.

Family behaviour is therefore unchanged: its communication restrictions still
apply to everyone who is not blocked, and blocking one player does not disturb
the capability layer. Tests assert both.

---

## 11. UI

**Player actions** live in the footer of the card you get by tapping someone's
Blobbi — the surface you are already on when you decide you want them to stop.
Visually quiet (a soft chip and two text buttons), because most of the time you
opened the card to look at a Blobbi. Quiet is not hidden: always present, always
in the same place, one tap away.

**Settings › Safety › Blocked and muted** lists both groups with Unblock and
Unmute, an empty state, and a count on the row. A player who is both blocked and
muted appears once, under Blocked — two rows would offer an Unmute that appears
to do nothing.

**Players are named by their key, not their Blobbi.** A Blobbi name is 32
characters of free text its owner chose. A list built to stop showing you
someone's words must not show you their words — and a blocked player could
otherwise write a message into the settings screen by renaming their Blobbi. Each
row is an abbreviated npub: stable, unchosen, and incapable of saying anything.

Built on the merged design system — `BlobbiModal`, `SettingsRow`,
`SettingsSection`, `StateCard`, `Button` — with no new visual language.

**Accessibility:** real `<button>`s throughout; `aria-pressed` on the mute
toggle; list buttons named with the player they act on (otherwise a screen reader
hears a column of identical "Unblock"s); the destructive confirmation
distinguished by its label (*"Block player"*) and not by colour alone; radio
groups in a labelled `<fieldset>`; dialogs with accessible names and managed
focus via the shared modal; touch targets at or above 44 px.

---

## 12. What this phase did not build

Explicitly out of scope, and not started: relay-side moderation, global bans,
shared blocklists, reputation or trust scores, automated or AI moderation, a
guardian dashboard, account verification, and any moderation backend. Also not
started: the Family selector, PIN, age gate, external-egress chokepoint, theater
curation, or stranger-name replacement.

---

## 13. Remaining gaps

- **Reports have no destination.** Honest, and still a gap: nobody reviews them.
- **Re-keying defeats a block** (§9).
- **Block does not hide you from them** (§2).
- **No cross-device durability.** A child who blocks on a tablet is unprotected
  on a laptop until NIP-51 sync is built (§4).
- **Presence is still island-wide.** A blocked player cannot be seen, but a
  determined one still receives the presence stream every player publishes and can
  follow someone room to room using it. Audit finding H-2 is only half addressed —
  the local half.
- **Stranger-authored Blobbi names are still rendered in-world** (audit H-1),
  even though the safety surfaces avoid them.

---

## Containment: these controls stay inside the game window

**Added 2026-08-25 (Phase F.1).** The island renders inside a fixed 1046×697
stage wrapped in a wood frame, with the browser page visible around it. Mute,
Block and Report are opened from a player's card, and that card is an in-world
surface (`BlobbiInfoModal` is `presentation="in-frame"`).

The two layers this flow opens — the Block confirmation and the Report window —
were using `BlobbiModal`'s default `presentation="auto"`, which resolves to
`dialog`: **app chrome**, portalled to the fullscreen root and sized in `vw` /
`dvh`. Correct for Settings and auth; wrong here. A confirmation that dims the
page around the frame reads as "the website opened a dialog" rather than "the
game asked you something", and on a windowed or short viewport it positions
itself against the browser rather than the stage it belongs to.

The fix is the island's existing frame-aware portal, not a second positioning
scheme: both now pass `presentation="in-frame"`, which portals into
`StageOverlayContext`'s host and sizes against the stage. `overflow: hidden`
was deliberately *not* used — it would turn an escaped dialog into a clipped
one. An in-frame window is capped at `max-h-[calc(100%-1.5rem)]` and its body
scrolls, so a long report form on a small frame scrolls **inside** the window.
On a phone both resolve to the bottom sheet, which is the contained form there.

`SafetySettingsDialog` deliberately stays `dialog`: it opens from the account
menu in the shell, outside the frame, and belongs to the application.

### Why the buttons were narrow and tall

The safety row is handed to `BlobbiModal`'s footer, which lays its children out
as flex items — and **a flex item shrinks by default**. The row collapsed toward
its content width and squeezed the three buttons inside it until their labels no
longer fit their pills. `whitespace-nowrap` on the button base meant the text
could not reflow, so it clipped instead.

Three changes, each at the level the problem lives at:

- the row claims the footer (`sm:flex-1`, `min-w-0`) instead of collapsing;
- each control is `shrink-0` with a 44px minimum target, full-width stacked on a
  narrow frame and a row when there is space;
- the shared footer **wraps rather than squeezes** (`sm:flex-wrap`,
  `sm:[&>*]:shrink-0`), so a row of actions too wide for the window gets a
  second right-aligned line. That was general: the in-frame widths are a
  percentage of the stage, so every in-world modal with three actions was one
  small frame away from the same squeeze.

**No safety behaviour changed.** Mute, unmute, block, unblock, report storage,
report evidence and the honest copy about where reports go are all untouched;
no new events, no network.
