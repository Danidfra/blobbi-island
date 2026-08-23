# Blobbi Island — Child / Family Safety Audit

**Status:** Audit and product-architecture proposal only. **No behaviour was changed.**
No Family Mode was implemented, no age gate was added, no feature was removed, no
Nostr event was published.

| | |
|---|---|
| Branch | `production` |
| HEAD | `c0fa57868b6805b820a484d7cedc1f18d5d8ec6c` — *fix(island): resume fresh location state across reloads* |
| Working tree at audit start | clean |
| Files changed by this audit | `docs/family-safety-audit.md` (this file) only |
| Date | 2026-08-21 |

Everything below is grounded in the code at that commit. Where a claim is an
inference rather than something the repo proves, it is marked **[inference]**.

> **Status update (2026-08-23) — Phase A shipped.** The capability foundation this
> audit proposes in §11 now exists as `src/safety/`: `ExperienceProfile`,
> `IslandSafetyPolicy`, the frozen `STANDARD_POLICY` / `FAMILY_POLICY` literals, a
> resolver, a provider, and one enforced data boundary (`admitChatMessage`, wired
> into the kind 21201 send and receive paths). Production resolves to `standard`
> deterministically and nothing can select Family, so no player-visible behaviour
> changed. The implementation contract lives in
> [`family-safety-policy.md`](./family-safety-policy.md); this document remains the
> rationale and is **not** superseded by it. The findings below are otherwise
> unchanged — in particular C-2 (no blocking, muting or reporting) and C-3 (open
> YouTube catalog) are untouched by Phase A.

---

## 1. Executive verdict

Blobbi Island is **closer to child-appropriate than most Nostr clients**, and much
closer than a generic social app — but it is **not currently a child-safe product**,
and three surfaces are the reason.

**The good news, and it is substantial.** Several of the things that usually make a
social app unsafe for children simply do not exist here:

- There are **no direct messages** of any kind. No kind 4, no NIP-17/59 gift wrap,
  no `nip44` usage anywhere in `src/`. There is no private 1:1 channel at all.
- There is **no follow graph, no friends list, no player directory, no profile
  page**. `NoteContent.tsx` (which linkifies arbitrary URLs and renders `@mentions`)
  is **dead code** — imported only by its own test. There is no `/:npub` route in
  `AppRouter.tsx`.
- **Strangers' kind:0 metadata is never rendered.** Every `AvatarImage` in the app
  is bound to `currentUser.metadata.picture` or a logged-in account of the local
  user (`AccountMenu.tsx:126,258,318`, `AccountSwitcher.tsx:35,58`). A stranger
  cannot put an explicit avatar or a `name` from their Nostr profile onto this
  player's screen. **This is the single most valuable safety property the product
  currently has, and it is accidental — nothing enforces it.**
- The **item catalog is issuer-locked**. `useItemCatalog.ts` queries only
  `authors: [OFFICIAL_ITEM_ISSUER_PUBKEY]` with an allow-list of `d` tags, and
  `selectNewestValidDefinitions` rejects a wrong issuer *before* recency. Item
  names, descriptions and images are curated content, not user content.
- The **economy is not a gambling economy**. Prices are a fixed table
  (`shop-catalog.ts`), rewards are pure deterministic functions of a score
  (`arcade/reward-policy.ts`, `beach/rewards/policy.ts`), there are daily caps and
  hard per-run caps, and there is **no real money anywhere** — no zaps, no
  Lightning, no invoices, no IAP. Grep for `zap|lightning|lnurl|bolt11|stripe`
  returns nothing but false positives on the word "stripes" in the pool game.
- The **PhotoBooth has no camera**. It composes a canvas from the Blobbi's own
  rendered artwork (`PhotoBoothModal.tsx:405-561`). A child cannot accidentally
  photograph themselves.
- The **CSP is unusually good** for an app of this kind (`index.html`), with
  `default-src 'none'` and `frame-src` narrowed to YouTube only.

**The bad news.** Three surfaces are, today, sufficient to expose a child to
inappropriate content, unwanted contact and grooming, with **no recourse mechanism
of any kind**:

| # | Surface | Why it is decisive |
|---|---|---|
| **1** | **Free-form public chat** (kind 21201) | Any logged-in stranger in the same room can put up to 120 characters of arbitrary text — including a URL, a phone number, a Discord handle, or sexual content — into a speech bubble above their Blobbi, visible to every child in that room. There is **no profanity filter, no link stripping, no moderation, no reporting, no blocking, no muting**. |
| **2** | **No block / mute / report anything** | Grep for block/mute/report/kind 10000/kind 1984 across `src/` returns **zero** product surfaces. A child who is harassed has exactly one option: leave the location, or close the tab. |
| **3** | **Open YouTube catalog in the theater** | `TheaterMediaInput` + `youtube-url.ts` accept **any embeddable YouTube video**. The embed uses `www.youtube.com` with no restricted-mode signal. A guest who joins a session with a code is shown whatever the host loads, at full size, with audio. |

Two further surfaces are high-risk but narrower: **user-chosen Blobbi names** (32
chars of free text, shown to everyone on hover) and the **PhotoBooth → Nostr share**
path, which publishes a public kind 1 note and can hand a child off to
Twitter/Facebook/WhatsApp/Telegram in a popup.

**Verdict:** a credible "Family" experience is achievable *without* gutting the
game, because the parts children actually play — walking around together, the
Arcade, the Beach hunt, the Mine, the shop, dressing up a Blobbi, watching a movie
together — are almost entirely free of stranger-authored content. The work is
concentrated in **communication, external media, and the total absence of a safety
recourse layer**. But it requires a policy architecture first, because the current
code has **no place to put a safety decision** — there is no settings model, no
capability layer, no policy object. That absence, not any single feature, is the
core architectural finding.

---

## 2. Product attack / safety surface

### 2.1 Surface inventory

Legend: **Src** = who authors the data · **Trust** = curated / semi / arbitrary ·
**Stranger?** = can an arbitrary third party influence what this player sees ·
**Text/Img/URL** = supports free text / images-video / URLs · **Exit** = can lead the
player out of Blobbi · **1:1** = private contact · **B/R/M** = block / report /
moderation exists · **Persist** = content persists beyond the session.

| # | Surface | Where | Src | Trust | Stranger? | Text | Img | URL | Exit | 1:1 | B/R/M | Persist |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | **In-world chat** (kind 21201) | `MultiplayerLayer.tsx:706-843`, `ChatBubblesLayer.tsx` | any player | **arbitrary** | **yes** | **yes (120 ch)** | no | **yes, as plain text** | **yes (read & retype)** | no | **none** | ephemeral by design (~10 s); relay-dependent |
| S2 | **Multiplayer presence** (kind 31950) | `multiplayer.ts:499-543`, `useIslandPresence.ts` | any player | semi (schema-validated) | yes | no | no | no | no | no | none | 35 s NIP-40; **relay retention not guaranteed** |
| S3 | **Remote Blobbi name label** | `MultiplayerLayer.tsx:1614-1627`; source `31124` `name` tag | **the other player** | **arbitrary** | **yes** | **yes (32 ch)** | no | yes (as text) | yes (read & retype) | no | none | **yes — persists in kind 31124** |
| S4 | **Remote Blobbi appearance** | `RemoteBlobbiSprite`, `blobbi-parsers.ts` | other player + official catalog | semi | limited | no | catalog art only | no | no | no | none | yes |
| S5 | **Remote Blobbi info modal** (click a stranger) | `MultiplayerLayer.tsx:1632-1656` → `BlobbiInfoModal readOnly` | other player | semi | yes | name only | no | no | no | no | none | yes |
| S6 | **Theater — media choice** | `TheaterMediaInput.tsx`, `youtube-url.ts` | the **host** (any player) | **arbitrary within YouTube** | **yes, if you join** | no | **video+audio** | n/a | **yes (YouTube branding/links in embed)** | no | none | session lives ~4 h |
| S7 | **Theater — shared session** (31951/21951) | `useSharedPlayback.ts`, `lib/shared-playback/*` | host | schema-validated | yes, **opt-in by code** | no | via S6 | no | no | no | none | 4 h active / 10 min ended |
| S8 | **Theater invite code** (`c` tag) | `invite-code.ts` | any player | public, **enumerable** | yes | 6 chars | no | no | no | **quasi** — a code is a private-ish rendezvous | none | while session lives |
| S9 | **PhotoBooth → Nostr share** | `ShareModal.tsx:206-260` | **the local child** | outbound | n/a | **yes (free caption)** | **yes (uploaded image)** | yes | n/a | no | none | **permanent public kind 1** |
| S10 | **PhotoBooth → social popup** | `ShareModal.tsx:140-205`, `SocialShareModal.tsx:44-110` | local child | outbound | n/a | yes | yes | yes | **yes — Twitter/FB/LinkedIn/Reddit/WhatsApp/Telegram** | no | none | on those platforms |
| S11 | **Blossom upload** | `useUploadFile.ts` → `blossom.primal.net` | local child | outbound | n/a | n/a | **yes** | n/a | n/a | no | none | **permanent, content-addressed, public** |
| S12 | **Item catalog** (kind 31632) | `useItemCatalog.ts`, `protocol-adapter.ts` | **official issuer only** | **curated** | **no** | curated | curated remote URLs | no | no | no | issuer-locked | yes |
| S13 | **Item images (remote fetch)** | `item-image-resolution.ts` → `blossom.primal.net`, `assets.blobbi.pet` | official issuer | curated | no | no | yes | n/a | no | no | n/a | n/a |
| S14 | **Inventory / Coins** (kind 31633) | `inventory/*` | self | self | no | no | no | no | no | no | n/a | yes |
| S15 | **Blobbonaut profile** (kind 11125) | `useBlobbonautProfile.ts`, `blobbi-parsers.ts` | self + Ditto | semi | no (read of others is not wired to UI) | no | no | no | no | no | n/a | yes |
| S16 | **Relay selector** | `RelaySelector.tsx`, reachable via `AccountMenu.tsx:306` | **the child** | n/a | n/a | **yes — arbitrary `wss://` URL** | n/a | **yes** | changes *which* strangers appear | no | n/a | localStorage |
| S17 | **Nostr Hub modal** | `NostrHubModal.tsx` via `InteractiveElements.tsx:929` | app | curated | no | no | local icons | **no links today** | not today | no | n/a | n/a |
| S18 | **Game Item Tools** (`/tools/game-items`) | `GameItemTools.tsx`, ships in production, unlinked | the child, if they find it | n/a | n/a | **yes** | **yes (upload)** | **yes** | **yes** — external link at `GameItemTools.tsx:267` | no | n/a | publishes kind 31632 |
| S19 | **Signup / nsec** | `SignupDialog.tsx` | app | curated | no | no | no | no | downloads `nsec.txt` | no | n/a | **the credential, forever** |
| S20 | **Achievements** | kind 11125 `achievement` tags | self + Ditto | semi | no | no | no | no | no | no | n/a | yes — **but no social announcement surface exists** |
| S21 | **Toasts / notifications** | `useToast`, `sonner` | app only | curated | no | app copy | no | no | no | no | n/a | no |
| S22 | **Gaze / attention** | `useIdleGaze.ts`, `lib/gaze.ts`, `livePositionsRef` | derived from S2 | derived | yes | no | no | no | no | no | n/a | no |

### 2.2 Surfaces that do **not** exist (verified absent)

Recording these matters as much as recording what exists, because a Family design
must not "protect" against them and thereby imply they were there.

- **Direct messages** — no kind 4, 1059, 1060; `nip04`/`nip44` appear nowhere in `src/`.
- **Voice / video / WebRTC** — nothing.
- **Follows / social graph** — no kind 3, no contact list.
- **Player directory / who's-online list** — the Map modal is a location map, not a roster.
- **Friend requests / invites to a player** — the only invite is a theater *code*, not addressed to a person.
- **Trading / gifting / item exchange between players** — inventory writes are self-signed only; nothing transfers.
- **User-generated rooms, furniture placement visible to others, decoration text** — placement is local/self.
- **Emotes** — `PlayerState` includes `'emote'` and NIP.md reserves it, but **nothing publishes it** and there is no emote UI. It is a designed-but-unbuilt slot.
- **Markdown or HTML rendering of user content** — the only `dangerouslySetInnerHTML` uses are locally generated Blobbi SVG (`MascotBlobbi.tsx:63`, `BlobbiCard.tsx:123`, `BlobbiHatchingCeremony.tsx:557`) and shadcn's chart CSS (`ui/chart.tsx:79`). **No user string reaches any of them.**
- **Analytics / telemetry / error reporting SDK** — no gtag, Sentry, PostHog, Plausible, Mixpanel, Segment. Nothing.

---

## 3. Nostr-specific trust model

Nostr is not the problem here; **the absence of a trust boundary is**. The
protocol's properties are neutral — what matters is which assumptions a
child-facing product is allowed to make. Blobbi Island already makes several of
them correctly and a few of them not at all.

### 3.1 The five assumptions a family experience cannot make

**A1 — "A signature proves the content is safe."**
A signature proves *who* said something and that it was not altered. It says
nothing about *what* was said. This matters most for kind:0 metadata, which is why
the current accidental non-rendering of stranger profiles is so valuable — and why
it must become a *rule* rather than an accident.

**A2 — "Blocking a pubkey removes a person."**
Keys are free and infinite. `SignupDialog.tsx` generates one in the browser in
under a second, with no email, phone or captcha. Any blocklist is therefore a
**friction mechanism, not an exclusion mechanism** — it stops casual repeat
contact and does nothing against a determined actor. A Family design that leans on
blocking as its primary control is building on sand; blocking must be the *last*
layer, under capability restriction.

**A3 — "NIP-40 expiration means the relay deleted it."**
It does not. NIP-40 is a *request*. `EXP_SECONDS = 35` on presence and ~10 s on
chat govern **what this client will render**, not what any relay stores.
`isPresenceAlive()` (`multiplayer.ts:44`) is honest about this — it is a rendering
gate. A relay that retains ephemeral kind 21201 events, or archives kind 31950,
can reconstruct a player's complete movement and speech history. **Any statement
to a parent that "chat disappears" would be false unless it is qualified as
"disappears from the game".**

**A4 — "The app controls what events exist."**
It does not, and `event-registry.ts` and `feature-flags.ts` both say so explicitly
and correctly ("Anyone can construct their own Nostr events in another client;
what a flag controls is whether THIS build offers a given surface"). A third-party
client can publish a well-formed kind 21201 with any text, a kind 31950 with any
position, or a kind 31951 pointing at any YouTube id. **Client-side length limits
(`CHAT_MAX_LEN = 120`) and rate limits (`CHAT_RATE_LIMIT_MS = 500`) are UX
guidance, not enforcement.** The chat receive path does not re-check length; a
foreign client can send 10 000 characters and the bubble will render them
(`max-w-[220px]` + `break-words` will wrap, not truncate).

**A5 — "There is a moderator."**
There is not, and there cannot be at the protocol layer. Moderation in a Nostr
game is necessarily **client-side policy plus relay choice**. This is the single
most important architectural consequence: *the client is the moderator*, so
safety must be a first-class client capability, not a UI afterthought.

### 3.2 What the codebase already gets right

- **Issuer-locked catalog** (`useItemCatalog.ts`) — the correct pattern, applied to items. It should be the *template* for every other content class.
- **Authority by authorship, not by UI** (`shared-playback` §6.1: "a command from any other signer is discarded by signature, not by UI").
- **Structural validation over kind trust** (NIP.md: "Every consumer MUST validate structurally and ignore anything that does not parse as this schema, rather than trusting the kind number").
- **Honest naming of the invite code** (`TheaterSessionPanel.tsx:26-30`: "a handle, never a password... no 'keep this secret', no masking, no lock"). Exactly right.

### 3.3 Relay-specific consequences

The app routes **all traffic to one configured relay** (`NostrProvider.tsx:32-40`),
default `wss://relay.ditto.pub`. That is a meaningful safety property: a single
relay is a single moderation jurisdiction. Blobbi Island is co-designed with Ditto,
which means **relay-side moderation is actually possible here in a way it is not
for a generic client** — this is a significant strategic asset for a Family tier.

It is undermined by `RelaySelector`, reachable from the account menu
(`AccountMenu.tsx:306`), which lets the user type **any** relay URL
(`handleAddCustomRelay` normalises anything to `wss://…`). A child can move
themselves to an unmoderated relay in three taps, which changes which strangers
they meet and which chat they receive. **Blocked-content-reappears-elsewhere is not
hypothetical here; it is one menu away.**

Note also the **over-broad presence subscription**: `useIslandPresence.ts:752-760`
uses a single `'#t': ['blobbi:presence', 'island:<id>', 'loc:<loc>']`. Nostr filter
semantics are OR *within* a tag key, so this subscribes to **every presence event
on the island in every location**, and narrows to the current room client-side at
`useIslandPresence.ts:486`. Functionally correct; but it means the client
continuously receives the full island-wide movement stream, and a modified client
receives it too. See §7.

---

## 4. Communication audit

### 4.1 Exact architecture of the only chat that exists

| Property | Value | Source |
|---|---|---|
| Kind | `21201` (ephemeral range) | `chat-config.ts:19` |
| Scope | one **location** on one **island** | tags `l`, `i`; filter `MultiplayerLayer.tsx:834-840` |
| Public / private | **public** — anyone subscribing to the relay with that filter receives it | — |
| Persistence intent | ephemeral, `expiration = now + 10 s` | `chat-config.ts:13`, `MultiplayerLayer.tsx:715` |
| Actual persistence | **relay's decision, not the app's** | see §3.1 A3 |
| Max length (send) | 120 chars, enforced by `maxLength` on the input and `.slice(0, CHAT_MAX_LEN)` | `BlobbiActionDock.tsx:71,194` |
| Max length (receive) | **not enforced** | `processChatEvent`, `MultiplayerLayer.tsx:760-822` |
| Rate limit | 500 ms, **local client only**, throws on violation | `MultiplayerLayer.tsx:711-714` |
| Dedupe | per `pubkey:d` within 2 s | `useChatBubbles.ts:isDuplicate` |
| Sender display | speech bubble anchored above that player's Blobbi; **name only on hover** | `ChatBubblesLayer.tsx`, `MultiplayerLayer.tsx:1614` |
| Sanitisation | `content.text.replace(/<[^>]*>/g, '').trim()` | `MultiplayerLayer.tsx:806` |
| Rendering | React text node inside `whitespace-pre-wrap` — **not** `innerHTML` | `ChatBubblesLayer.tsx:161-163` |
| History load | `since: now - 5 s` — effectively none | `MultiplayerLayer.tsx:839` |
| Media | none — text only | — |
| Links | **not detected, not linkified, not stripped** — a URL renders as inert text | — |
| Profanity filter | **none** | — |
| Block / mute / report | **none** | — |
| Spam protection | dedupe + local rate limit only | — |

Send path: `BlobbiActionDock` chat input → `CustomEvent(DOCK_EVENTS.sendChat)` →
`PlayingView.tsx:466-482` → `chatFunctionRef` → `MultiplayerLayer.publishChatMessage`
(`:706-754`) → `useNostrPublish`.

### 4.2 Two notes on the sanitiser

`replace(/<[^>]*>/g, '')` is **not** what makes this safe — React's text
interpolation is. The regex is defence-in-depth at best and is trivially bypassed
(`<img src=x onerror=...` with no closing `>` survives it). It is currently
harmless because the output is never used as HTML. **The risk is that the regex
reads like a security control and could license someone to render the string as
HTML later.** It should be documented as cosmetic, or replaced with an explicit
"this is display text, never markup" comment.

Second: links are inert text today because nothing linkifies chat. But
`NoteContent.tsx` exists in the tree and *does* linkify with `target="_blank"`.
If anyone ever wires `NoteContent` into a chat bubble "to make links nice", the app
gains a one-click stranger-controlled exit for children. **That is the single most
likely future regression in the codebase**, and it should be prevented by
architecture (a policy check) rather than by memory.

### 4.3 Should Family mode use A / B / C / D / E / F?

Options as posed, judged against *this* product:

| Model | Fit | Trade-offs |
|---|---|---|
| **A. No communication** | Poor | The dock's Chat button is one of four actions; removing it makes rooms feel dead. Presence + gaze without any expression is uncanny, not calm. Over-restrictive relative to actual risk. |
| **B. Predefined phrases only** | Good | Zero free text ⇒ zero grooming vector, zero PII leak, zero link. Costs expressiveness; needs a phrase catalog and a picker UI (does not exist). |
| **C. Predefined phrases + emotes** | **Recommended** | Same safety as B, materially more expressive. Crucially, the **emote slot already exists in the protocol** (`PlayerState = 'idle'\|'moving'\|'emote'`, NIP.md "reserved for a future emote/reaction feature"). Family mode would be the reason to finally build it — a safety requirement that *adds* a feature instead of subtracting one. |
| **D. Friend-only free chat** | Not viable **now** | There is no friend graph, no mutual-consent mechanism, and no identity durability (§3.1 A2). Building one is a large project, and "friend" is precisely the relationship a groomer manufactures. Reconsider only alongside guardian-approved contacts. |
| **E. Moderated free chat** | Not viable **now** | Requires human moderators or a classifier plus an escalation path plus retention for review — none exist, and retention conflicts with the ephemeral design. Revisit only if Ditto provides relay-side moderation. |
| **F. Other — "C + guardian-unlockable D"** | The end state | Ship C. Leave a policy-level slot for a future guardian-approved contact list. Do not build D speculatively. |

**Recommendation: model C.** Family mode gets a curated phrase palette plus emotes,
delivered over the *same* kind 21201 (with a `phrase` id in content, so a Standard
client renders the localized text as a normal bubble and interoperability is
preserved). Free-text send is disabled, and — critically — **free-text receive is
also filtered**, because a Standard-mode or third-party player in the same room
will still be sending arbitrary text. A Family client must render only bubbles
whose content resolves to a known phrase id. **Disabling the input while still
rendering incoming free text would be the single worst possible half-measure.**

---

## 5. Media / content audit

### 5.1 Images

| Question | Answer |
|---|---|
| Where do image URLs originate? | (a) official kind:31632 item definitions — `blossom.primal.net/<sha256>.webp` and `assets.blobbi.pet`; (b) bundled local assets under `/assets`; (c) `blob:`/`data:` canvas output in PhotoBooth. |
| Are arbitrary remote URLs rendered? | **No** for gameplay. Item images come only from the issuer-locked catalog. |
| Are stranger avatars rendered? | **No.** `AvatarImage` is bound to the local user's own accounts only. |
| Blossom? | Yes, for **upload** (`useUploadFile.ts` → `blossom.primal.net`) and as the **host** of official item art. |
| Content-type validation? | **None in this app.** No `Content-Type` check, no magic-byte sniff, no size cap on the upload path. Blossom is content-addressed, which prevents *substitution* but not *initial* upload of anything. |
| SVG accepted? | Not from the network. The three `dangerouslySetInnerHTML` sites take SVG generated locally by the Blobbi renderer, never a fetched string. `<img src>` pointing at a remote SVG would be sandboxed by the browser (no script in `<img>`), and the CSP has `default-src 'none'`. |
| Remote tracking possible? | **Yes, structurally.** Every item image fetch reveals the player's IP, User-Agent and timing to `blossom.primal.net` / `assets.blobbi.pet`. Those are first-party-ish hosts, but they are third parties in a privacy sense. |
| Fallback behaviour | Good — ordered `<img onError>` chains with de-duplication (`item-image-resolution.ts:itemImageSourcesForView`), degrading to an emoji placeholder. No broken-image holes, no silent substitution of a wrong view. |

**CSP note:** `img-src 'self' data: blob: https:` permits **any** HTTPS image origin.
That is currently unreachable (nothing renders an arbitrary URL), but it means the
CSP is not the backstop — the absence of a code path is. A Family tier should
narrow `img-src` to the known asset hosts so that a future regression fails closed.

### 5.2 Video / media

| Question | Answer |
|---|---|
| Provider | YouTube only. `media.provider` is `'youtube'` throughout; NIP.md notes a future NIP-71/MP4 provider as a seam. |
| Catalog | **Open.** "The theater accepts an OPEN catalog: the host may load any embeddable YouTube video" (`youtube-url.ts:5-7`). |
| Accepted input | watch URL, `youtu.be`, `/embed`, `/shorts`, `/v`, `/live`, `music.youtube.com`, or a bare 11-char id — `parseYouTubeInput`. |
| Validation | **Syntactic only.** Host allow-list + `^[A-Za-z0-9_-]{11}$`. Nothing checks what the video *is*. |
| Embed host | `www.youtube.com` (the IFrame API default). `youtube-nocookie.com` is permitted by CSP but **not used**. |
| Player params | `enablejsapi`, `playsinline`, `rel: 0`, `modestbranding: 1`, `fs: 1`, `origin`. **No `safesearch`/restricted-mode signal** — YouTube's Restricted Mode for embeds is driven by a cookie/header the app does not set. |
| iframe permissions | `allow="autoplay; encrypted-media; fullscreen; picture-in-picture"`, `allowfullscreen` (`youtube-player.ts:379-381`). Fullscreen means the child can be alone with an arbitrary video, full screen, with the game gone. |
| Who chooses | The **host**. Authority is `host-only`; guests have no protocol write path. |
| How a guest is exposed | Only by **explicitly typing a 6-char invite code** (`TheaterSessionPanel`). There is no browse list, no auto-join, no "join nearby session" button. Presence `activity` carries only an address, deliberately (NIP.md §14.2). |
| Synchronised playback | 31951 canonical + 21951 ephemeral commands; `rev`-ordered; late/replayed events cannot rewind. Solid design. |
| Can a host swap the video mid-session? | **Yes** — `set-media` is a command. So consent given at join time does not cover what plays later. |

**Assessment.** The join model is genuinely good: opt-in, code-gated, host-authoritative,
with no discovery surface. The *content* model is the problem — an open YouTube
catalog is an open internet-video catalog, and `rel: 0` + `modestbranding` do not
make YouTube child-appropriate. `set-media` means the exposure is not bounded by
the moment of consent.

### 5.3 Text rendering

- All user-visible strings pass through React children. **No markdown renderer is used anywhere.** No `marked`, `remark`, `react-markdown` in `package.json`.
- `dangerouslySetInnerHTML`: 4 sites, all with locally generated content (§2.2).
- Linkification: exists **only** in dead code (`NoteContent.tsx`).
- URL handling in chat: none — URLs are inert text.

### 5.4 Cybersecurity risk vs child-content risk — kept separate

| | XSS / cybersecurity | Child-appropriateness |
|---|---|---|
| Chat text | **Low.** React escaping + `default-src 'none'` CSP + no HTML sink. | **Critical.** Arbitrary sexual/abusive text, phone numbers, off-platform handles. |
| Blobbi name | **Low**, same reasons. | **High.** 32 chars of arbitrary text attached to a body that follows the child around. |
| Item metadata | **Low** — issuer-locked. | **Low** — curated. |
| YouTube embed | **Low-medium.** Cross-origin iframe under YouTube's own CSP; `frame-src` is narrowed to two exact hosts. | **Critical.** Any embeddable video, audio at full volume, fullscreen. |
| Blossom image fetch | **Low.** | **Low today** (curated art), **but the pipeline is generic** — it would render any URL an issuer put in a definition. |
| Relay switch | **Low.** | **High** — changes the entire population and moderation regime. |

The headline: **this codebase's cybersecurity posture is better than its
child-content posture, by a wide margin.** Almost every finding below is a content
and contact finding, not a vulnerability.

---

## 6. External link audit

Every path that can take a player out of Blobbi Island:

| # | Path | Trigger | Destination | Confirm? | Visible? | New tab? | Arbitrary? |
|---|---|---|---|---|---|---|---|
| E1 | Social share popup | tap a platform icon in `ShareModal` / `SocialShareModal` | twitter.com, facebook.com, linkedin.com, reddit.com, wa.me, t.me | **no** | no — an icon | **yes**, `window.open(..., 'width=600,height=400')` | no — fixed set |
| E2 | Instagram branch | tap Instagram | none — downloads a PNG + toast | n/a | n/a | no | no |
| E3 | Clipboard | tap Copy | writes caption + `window.location.href` | no | no | n/a | no |
| E4 | `navigator.share` | tap Share | OS share sheet — **any installed app** | OS-level | OS-level | n/a | **effectively yes** |
| E5 | YouTube iframe | play anything in the theater | youtube.com embed; end-screens, channel links and "Watch on YouTube" are inside the iframe and outside this app's control | no | partially | iframe → can navigate out | **yes** |
| E6 | Blossom image fetch | any item render | `blossom.primal.net`, `assets.blobbi.pet` | n/a | no | no (subresource) | no |
| E7 | MKStack attribution | `/tools/game-items` footer (`GameItemTools.tsx:267`) | soapbox.pub | no | yes | yes | no |
| E8 | Item tools image link | `ImageManager.tsx:444` | whatever URL is in the draft | no | yes | yes | **yes** |
| E9 | nsec download | signup | local file `nsec.txt` | no | n/a | n/a | no |
| E10 | Relay switch | account menu | any `wss://` host the child types | no | yes | n/a | **yes** |
| E11 | `window.location.reload()` | error boundaries | self | n/a | n/a | n/a | no |

There is **no confirmation interstitial anywhere**, and **no central egress helper** —
`window.open` is called directly in two components with duplicated switch statements.
There is nothing a policy could hook today; that is itself a finding (F-EXT-1).

**Recommended Family policy for external navigation:** default **deny**, with a
narrow allow-list, and every permitted egress routed through a single
`openExternal(url, reason)` helper that (a) checks the policy, (b) shows an
"You're leaving Blobbi Island" confirmation naming the destination, (c) is the
only place `window.open`/`<a target="_blank">` may be constructed. An ESLint rule
banning raw `window.open` outside that module makes the invariant permanent —
the repo already ships custom rules under `eslint-rules/`, so the mechanism exists.

---

## 7. Privacy / presence audit

### 7.1 What another player can learn about this player

| Datum | Exposed? | Via | Notes |
|---|---|---|---|
| Public key (hex) | **yes, always** | every event's `pubkey` | the durable identifier |
| npub | derivable | trivially | no npub is *displayed* in-world |
| kind:0 name / avatar / about / nip05 / website / lud16 | **published if set, but never rendered by this app** | any Nostr client | if the child has a real Nostr profile, it is public — Blobbi just doesn't show it |
| Blobbi display name | **yes** | 31124 `name` tag, hover label | free text chosen by the child |
| Blobbi appearance | yes | 31124 | |
| Online status | **yes** | 31950 heartbeat every 25 s | |
| Game-world location (room) | **yes** | `loc:` tag + content `location` | one of 16 rooms |
| Exact in-room coordinates | **yes** | `anchor {x,y}` as % of playable area | resolution-independent |
| Movement vector | **yes** | `goal {from,to,v,ts}` | destination is broadcast *before* arrival |
| Which Blobbi is active | yes | `blobbiD` + `a` tag | |
| Hiding-spot id | **yes** | `hiddenIn` | the player is hidden *visually*, not *informationally* |
| Theater seat | yes | `seatId` | |
| Shared activity | yes | `activity.session` | reveals *who is watching with whom* |
| Session id | yes | `d: session:<uuid>` | rotates per browser session |
| Publish counter | yes | `seq` | |
| Timestamps | yes | `created_at`, `anchor.ts` | |
| Social graph | n/a | — | none exists |
| **Real-world geolocation** | **NO** | — | see below |

### 7.2 kind:31950 is a *virtual-world* location — stated explicitly

**The repository proves this.** `PresenceContent.anchor` is `{x, y, ts}` where
`x`/`y` are **percentages of the current location's playable area** (`0–100`),
converted through `groundToWireCenter` / `wireCenterToGround`
(`presence-ground.ts`) and clamped by `constrainPosition` against
`locationBoundaries`. `location` is one of sixteen hard-coded `LocationId` values
(`location-types.ts`). There is **no `navigator.geolocation` call anywhere in the
repository**, no GPS permission in the manifest, no lat/lon field, no IP-geo
lookup. **kind:31950 carries no physical-world location whatsoever**, and any
parental-facing documentation should say so plainly, because "the game broadcasts
your child's location every 25 seconds" is exactly the sentence a parent will
otherwise construct.

The residual real-world exposure is the ordinary web one: **the player's IP address
is visible to the configured relay, to `blossom.primal.net` / `assets.blobbi.pet`
when item art loads, and to Google when a YouTube embed is created.** That is a
data-flow fact worth disclosing, not a game-design flaw.

### 7.3 Presence and tracking analysis

- **Frequency:** heartbeat every 25 s (`HEARTBEAT_INTERVAL_MS`), plus an event on every login, move, hide, sit and activity change. A moving player publishes more often than once per 25 s.
- **Expiration:** `created_at + 35 s` (`EXP_SECONDS`), NIP-40. `isPresenceAlive` is a **render gate**, not a deletion guarantee (§3.1 A3).
- **Relay scope:** whichever single relay is configured.
- **Can an observer reconstruct a play schedule?** **Yes, trivially — if the relay retains the events.** A 25-second heartbeat carrying a room id is a near-perfect activity log: session start and end times, days of the week, hours of the day, which rooms, for how long. For a child this is a behavioural profile. Nothing in the app prevents it; only relay retention policy does.
- **Can a stranger follow a player room to room?** **Yes, and easily.** Because `useIslandPresence` subscribes with a single `#t` filter containing `blobbi:presence` (OR semantics), *any* client receives island-wide presence and narrows locally. Following a specific pubkey requires no modification at all — just reading the stream the app already receives. Room changes are visible within one heartbeat.
- **Does presence expose unnecessary state?** Partly. `hiddenIn` is the clearest case: a child hides in a bush, the app suppresses the sprite for everyone — and simultaneously broadcasts the exact bush id. Against a stock client that is fine; against a modified one, hiding does not hide. `goal` similarly broadcasts a destination before arrival.

**Minimisation opportunities (do not implement yet):**

1. **Narrow the subscription to a real AND.** Use `'#t': ['loc:<location>']` (the most selective tag) rather than a three-value OR. Same rendering, far less data received, and it stops the client from being a ready-made island-wide tracker. *Note: this changes only what this client asks for, not what a relay will serve.*
2. **Coarsen or drop `hiddenIn` in Family mode** — publish `state: 'hidden'` without the spot id.
3. **Reduce heartbeat granularity when idle** — a stationary player does not need 25 s resolution; the expiry window drives the floor, not the play experience.
4. **Consider a shorter `EXP_SECONDS` in Family mode** paired with the same heartbeat, so retained history is less dense.
5. **Relay-side retention is the real lever.** Because Blobbi co-designs with Ditto, "the Family relay does not retain 21201 or 31950 beyond expiry" is an achievable and *verifiable* commitment, unlike a client-side promise. This is the highest-leverage privacy action available and it lives outside this repository.

### 7.4 Data collection and storage — what the app actually does

Inspected rather than assumed.

| Channel | Present? | Detail |
|---|---|---|
| Analytics / product telemetry | **no** | no gtag, GA, Segment, Mixpanel, PostHog, Amplitude, Plausible, Fathom — nothing in `src/`, `index.html` or `package.json` |
| Crash / error reporting | **no** | no Sentry, Bugsnag, Rollbar. `ErrorBoundary.tsx` renders a local reload button and reports nowhere |
| Cookies | **no** | the app sets none. The YouTube iframe sets Google's, under YouTube's origin |
| Push notifications | **no** | no `Notification.requestPermission`, no `pushManager`, no push handler in the service worker |
| Service worker | **yes, offline caching only** | `public/sw.js` — same-origin GET cache-first, `install`/`fetch`/`activate` only, **no push or notification handlers**. `public/sw-register.js` exists but is **not referenced from `index.html`**, so it is not currently registered; `public/dev-cleanup.js` (which *is* loaded) actively unregisters workers and clears caches on `localhost` |
| `sessionStorage` | yes | `has-arcade-pass` (deliberately tab-scoped) |
| `localStorage` | yes | `nostr:app-config` (theme, relay URL), `nostr:login` (**the login credential**), `blobbi:mine:sessions`, `blobbi:arcade:reward-claims`, `blobbi:arcade:prize-redemptions:v1`, `blobbi:arcade:audio-muted`, `blobbi:pet-energy:ops`, `blobbi-game-item-drafts`, plus debug flags (`blobbi-debug-mp`, `blobbi-debug-watch`, `blobbiDebug`) |
| Console logging | yes, verbose | 61 `console.log/debug/info` sites. The pubkey-bearing ones are behind `import.meta.env.MODE === 'development'` or `DEBUG_MP`, but `useNostrPublish` logs the full published event unconditionally |
| Data sent to third parties | yes, by necessity | the configured relay (all game events + IP), `blossom.primal.net` / `assets.blobbi.pet` (IP + UA on every item-art fetch), `www.youtube.com` + `s.ytimg.com` (IP, UA, cookies, watch behaviour, once the theater is used), `fonts.googleapis.com` / `fonts.gstatic.com` (preconnected in `index.html`) |

**Data-minimisation opportunities for Family mode:** pin the relay so the data
flow is to one known operator; consider self-hosting fonts to drop the Google
preconnect; consider proxying or self-hosting item art to remove the Blossom IP
exposure; make the unconditional publish logging development-only; and note that
disabling the theater removes the largest third-party data flow in the product.

---

---

## 8. Economy / wellbeing audit

### 8.1 Economy

| Mechanic | Implementation | Child-safety read |
|---|---|---|
| **Real money** | **none** — no zaps, Lightning, invoices, IAP, card flows | **The most important single fact in this section.** No monetisation crossover exists. |
| **Coins** | official kind:31632 currency item; balance = quantity in kind:31633 | earned only |
| **Arcade Tickets** | second currency item, same mechanism | earned only |
| **Arcade Pass** | boolean in `sessionStorage`, bought with Coins, cleared on leaving the arcade | temporary access, tab-scoped, deliberately not an item |
| **Shop** | fixed price table (`shop-catalog.ts`), validated against the registry: no duplicate price, no unregistered item, no non-consumable, positive integers only; **an unpriced item is `null`, never `0`** | **exemplary.** Transparent, no dynamic or personalised pricing |
| **Arcade rewards** | pure deterministic function of the result: participation floor 2, difficulty ×1/1.25/1.5, first-clear +10, daily-first +5, personal-best +5, **hard cap 25/run**, 6 rewarded runs per game per UTC day | skill-based, capped, disclosed |
| **Beach hunt rewards** | 10 rewarded hunts per UTC day, base 4 + 1/unit, **max 25/round**, minimum participation (1 dig **and** 20 s) to earn; **unlimited free practice afterwards** | **the best-designed loop in the app** — the cap limits *earning*, never *playing* |
| **Mine** | costs Blobbi energy per click; settles at session end | a natural stopping point (see §8.2) |
| **Randomness** | 27 `Math.random()` sites — all gameplay (cloud shapes, AI jitter, particles, bubble ids). Treasure placement is **seeded** (`treasure-hunt/random.ts`) | **no random *reward* determination anywhere** |
| **Loot boxes** | **none.** The prize counter is a fixed ticket-priced shelf; the redemption machinery is documented as dormant and unwired | — |
| **Trading / player-to-player transfer** | **none** | removes an entire scam class |
| **Scarcity / FOMO / limited-time offers** | **none found** | — |
| **Misleading currency** | no — Coins and Tickets have no purchase path and no real-money equivalence, so there is no exchange-rate confusion to create | — |
| **Dark patterns** | none found. Reward breakdowns are itemised, caps are surfaced honestly ("capped at 25", "daily bonus used up") rather than silently paying less | `reward-policy.ts` "Honesty" section is explicitly designed against this |

**Assessment: the economy is already appropriate for children,** and in several
respects it is better than most commercial kids' games. The stated design intent —
"a bonus the app cannot SUBSTANTIATE must not be paid" — is an anti-dark-pattern
stance. The main residual concern is **communication**, not mechanics: a child
should be able to see why they earned what they earned, which the breakdown already
supports.

One structural caveat: every limit is **client-trusted** and says so
(`beach/rewards/policy.ts`: "a modified client or a changed system clock can
manipulate it... without pretending to be anti-cheat"). This is an economy-integrity
issue, not a safety issue — a child cheating themselves more coins is not a harm.

### 8.2 Time / wellbeing

| Mechanic | Present? | Read |
|---|---|---|
| **Energy limiting play** | yes — mining costs pet energy; a low-energy Blobbi cannot mine | **positive boundary.** A natural, narratively coherent "that's enough for now" that is not a punishment |
| **Daily reward windows** | yes — UTC day for arcade and beach | mild return pressure; **but practice remains unlimited**, so the loop is "come back to *earn*", not "come back or *lose*" |
| **Care streak** | yes — `care_streak`, resets after 2+ missed days (`useUseItem.ts:171-196`) | **the one genuine wellbeing concern.** A streak on a *pet* converts "I want to play" into "my creature will suffer if I don't" — guilt-driven daily engagement aimed at children. Worth a product conversation independent of Family mode |
| **First-clear / personal-best bonuses** | yes | one-time, healthy |
| **Countdown timers / limited events** | **none found** | — |
| **Push notifications / re-engagement mail** | **none** — no service-worker push, no notification permission request | **excellent** |
| **Autoplay** | only inside the theater, host-driven | bounded |
| **Infinite scroll / endless feed** | **none** | — |
| **Penalty for leaving mid-session** | **actively engineered against.** Mine settlement freezes and settles durably at session end; arcade claims are ledgered; beach reservations release or consume explicitly | **a genuine positive.** A child can be told "dinner" and close the tab without losing anything — this is unusually considerate design |
| **Session-length tracking or reminders** | **none** | a gap for Family mode, not a harm |

---

## 9. Moderation / block / report audit

### 9.1 Current state

**Nothing exists.** Verified by exhaustive grep across `src/`:

- no block list, no local blocklist, no kind 10000 mute list, no NIP-51 lists;
- no kind 1984 reporting, no report UI, no abuse contact;
- no mute, no hide-player, no ignore, no per-player content filter;
- no profanity/keyword filter of any kind;
- no rate limiting beyond the 500 ms local chat throttle;
- no relay-side moderation integration, and no client awareness of any;
- no admin/mod role, no in-game moderator presence;
- the only "block" identifiers in the codebase are movement blockers, physics path-blocking, and reward-claim guards.

A child who encounters an abusive stranger today has exactly two options: **walk to
another room, or close the tab.** Neither prevents the stranger from following
(§7.3), and neither creates any record.

### 9.2 Minimum necessary controls for a child/family experience

Ranked. This is a *design* recommendation; nothing here is implemented.

**Essential (a Family tier cannot ship without these):**

1. **Block a player** — one action, reachable from the same place a player is already tappable (the remote-Blobbi tap target at `MultiplayerLayer.tsx:1632`). Must be reachable *while* the harassment is on screen, in one tap, with no menu diving.
2. **Block means invisible, both ways** — suppress their bubbles, their sprite, their name, their gaze target, and their presence from the local map entirely. Not "greyed out"; **absent**. Half-blocking (hiding chat but still rendering the Blobbi that follows you) is worse than nothing because it preserves the intimidation while removing the evidence.
3. **Block survives restart** — persisted locally at minimum.
4. **Report a player / report a message** — capture the event id, pubkey, room, timestamp and rendered text at report time, because the event is ephemeral and will be gone in ten seconds. **A report that cannot reproduce what was said is not a report.**
5. **Report implies block** — never make a distressed child perform two actions.

**Useful:**

6. Guardian-visible report history (local; a shared account has no server to sync with).
7. A "leave and go home" panic action — instant teleport to `home`, which is already a single-player location.
8. Relay-side reporting handoff (kind 1984 to a Ditto-operated moderation queue), where relay-side action is the only thing that can actually remove a bad actor for *everyone*.
9. Rate-limit *inbound* rendering: cap bubbles per pubkey per minute, so flooding degrades gracefully.

**Overengineering for now:**

10. Publishing a NIP-51 mute list (kind 10000) — leaks who a child blocked, to everyone, forever. **Actively harmful.** Keep blocks local.
11. Reputation / trust scores. 12. Appeals workflows. 13. Cross-device block sync via Nostr.

### 9.3 The honest limitation

Blocking is a **friction control**, not an exclusion control (§3.1 A2). A determined
adult generates a new key in seconds. This must be stated plainly to guardians
rather than papered over — and it is the strongest argument for making Family mode's
default posture **capability restriction** (no free text at all) rather than
**reactive moderation** (block the bad ones as they appear). You cannot block your
way to child safety on an open protocol; you can *design* your way there.

---

## 10. Standard vs Family matrix

`allow` = unchanged · `restrict` = reduced form · `deny` = capability off.
"Enforcement point" is where the policy check belongs — deliberately at the data
boundary, not in the JSX, so that hiding UI can never diverge from what is
subscribed and rendered.

| # | Capability / surface | Standard | Family | Risk if unrestricted | Recommended Family behaviour | Technical enforcement point |
|---|---|---|---|---|---|---|
| 1 | **Multiplayer presence** | allow | **allow** | low — no content channel | unchanged: see and be seen | — |
| 2 | **Shared world / co-presence** | allow | **allow** | low | unchanged | — |
| 3 | **Player names (Blobbi name label)** | allow | **restrict** | **high** — 32 chars of arbitrary text | render only names passing a Family name policy (curated-token or allow-list); otherwise a neutral generated name (`genUserName` already produces deterministic "Swift Fox" style names from a pubkey seed — today it is only a fallback for the *local* account's display name, and it is exactly the right primitive to reuse here) | `MultiplayerLayer` label slot + the `31124` visual parser |
| 4 | **Own Blobbi name** | free text | **restrict** | high — a child names their pet with PII, or is coached to | word-pick composer (adjective + noun + number) rather than a text field | `BlobbiHatchingCeremony` naming step |
| 5 | **Avatars (stranger kind:0)** | not rendered | **deny (make it a rule)** | **critical if ever added** | never render stranger kind:0 pictures; assert with a lint rule + test | media policy; ban `useAuthor(otherPubkey)` in world components |
| 6 | **Stranger profiles / npub navigation** | none | **deny** | high | no profile surface, no npub display, no NIP-19 routes | routing + policy |
| 7 | **Public free-text chat (send)** | allow | **deny** | **critical** | phrase palette instead | `publishChatMessage` gate + dock UI |
| 8 | **Public free-text chat (receive)** | allow | **deny** | **critical** | drop any bubble not resolving to a known phrase id — **including from Standard and third-party clients** | `processChatEvent` — *before* `queueBubble` |
| 9 | **Predefined phrases** | allow | **allow** | low | curated, localized catalog | phrase catalog module |
| 10 | **Emotes** | *not built* | **allow (build it)** | low | build the reserved `state: 'emote'` slot; Family's expressive channel | presence content + renderer |
| 11 | **DMs** | *none exist* | **deny** | — | keep absent; encode as a policy so it cannot be added casually | policy assertion + test |
| 12 | **Follows / social graph** | *none exist* | **deny** | — | keep absent | policy assertion |
| 13 | **External links (outbound)** | allow | **deny** | **high** | no egress except an explicit guardian-unlocked allow-list; every egress routed through one confirmed helper | `openExternal()` + ESLint ban on raw `window.open` |
| 14 | **Social share popups** | allow | **deny** | **high** — hands a child to an adult platform | hide the platform row entirely | `ShareModal` / `SocialShareModal` behind policy |
| 15 | **`navigator.share` (OS sheet)** | allow | **deny** | high — arbitrary destination app | disable | same |
| 16 | **PhotoBooth capture** | allow | **allow** | none — no camera, own artwork | unchanged | — |
| 17 | **PhotoBooth download** | allow | **allow** | none | unchanged | — |
| 18 | **PhotoBooth → Nostr publish (kind 1)** | allow | **deny (default)** | **high** — permanent public post + free-text caption + Blossom upload | off by default; guardian-unlockable | `ShareModal` Nostr section behind policy |
| 19 | **Blossom upload** | allow | **deny** | high — permanent public content-addressed blob | disable the only caller | `useUploadFile` behind policy |
| 20 | **Arbitrary images** | not reachable | **deny** | critical if ever added | issuer-locked only; narrow CSP `img-src` | media policy + CSP |
| 21 | **Cinema / theater (watch alone)** | allow | **restrict** | **critical** — open YouTube catalog | curated catalog only: a Blobbi-published, issuer-signed list of approved videos | `TheaterMediaInput` + a media-source policy |
| 22 | **YouTube arbitrary id / URL entry** | allow | **deny** | **critical** | remove the input; browse the curated shelf instead | `TheaterMediaInput` |
| 23 | **Shared playback — host** | allow | **restrict** | high | may host, but only curated media | session create + `set-media` |
| 24 | **Shared playback — join by code** | allow | **restrict** | **critical** — host can `set-media` to anything after you join | join only sessions whose media is in the curated catalog; **re-check on every `set-media`, and leave the session if it goes off-catalog** | `useSharedPlayback` ingest path |
| 25 | **Theater fullscreen** | allow | **restrict** | medium — child alone with a full-screen video | keep the world frame visible | iframe `allow` attribute |
| 26 | **Item content (names, art)** | issuer-locked | **allow** | low | unchanged — already the right model | `useItemCatalog` |
| 27 | **Economy (coins, shop, rewards)** | allow | **allow** | low — no real money | unchanged | — |
| 28 | **Arcade / Beach / Mine gameplay** | allow | **allow** | low | unchanged | — |
| 29 | **Achievements** | allow | **allow** | low — no announcement surface | unchanged; **do not add social announcements in Family** | policy assertion |
| 30 | **Reporting** | *none* | **essential — build** | — | report player + report message, capturing ephemeral content at report time | new module |
| 31 | **Blocking** | *none* | **essential — build** | — | one-tap, bidirectional invisibility, persisted | presence + chat ingest filters |
| 32 | **Relay switching** | allow | **deny** | **high** — moves the child to an unmoderated population | pinned relay; guardian-only change | `RelaySelector` behind policy |
| 33 | **Game Item Tools (`/tools/game-items`)** | ships | **deny** | medium — publishes events, uploads, external links | not routed in Family builds | `AppRouter` + policy |
| 34 | **Nostr Hub modal** | inert | **restrict** | future — a designated external-app surface | Family-safe destinations only when it is built | policy at build time |
| 35 | **Presence detail (`hiddenIn`, `goal`)** | full | **restrict** | medium | publish coarser state | presence builder |
| 36 | **nsec display / download** | allow | **restrict** | medium — a child cannot steward a credential | guardian-held; guardian-gated reveal | signup flow |

**Family mode is not single-player.** Under this matrix a Family player still
walks around a shared island, sees other players' Blobbis move and gaze, sits in
the theater with them, watches a curated film together in sync, plays every arcade
and beach game, earns and spends the same currency, and communicates via phrases
and emotes. What they lose is: arbitrary text, arbitrary video, and the exits.

---

## 11. Proposed `IslandSafetyPolicy`

### 11.1 The problem this solves

Today a safety decision has nowhere to live. There is no settings model, no user
preferences beyond `theme` and `relayUrl` (`AppContext.ts`), and no capability
layer. If Family mode were added feature-by-feature, `isFamilyMode` would end up
scattered across `MultiplayerLayer`, `BlobbiActionDock`, `PlayingView`,
`TheaterStage`, `TheaterMediaInput`, `ShareModal`, `SocialShareModal`,
`AccountMenu`, `AppRouter` and `useUploadFile` — ten files, ten chances to forget
one, and no way to test "is Family mode actually safe?" other than clicking around.

The failure mode is specific and it is the one to design against: **a `hidden` prop
on a component while the subscription underneath keeps running.** Hiding the chat
input does not stop `processChatEvent` from queueing a bubble. The policy must be
consumed at the **data boundary**, not the render boundary.

### 11.2 Shape

```ts
// src/safety/experience-profile.ts

/**
 * WHICH EXPERIENCE this player is having. This is the ONLY place the notion of
 * a profile exists as a discriminated value; nothing outside `src/safety/`
 * compares against it. Features ask the POLICY what they may do — never who
 * the user is.
 */
export type ExperienceProfile = 'standard' | 'family';
```

```ts
// src/safety/policy.ts

/** How a communication channel behaves. Ordered least → most permissive. */
export type CommunicationMode =
  | 'none'              // nothing sent, nothing rendered
  | 'phrases'           // curated phrase ids only, both directions
  | 'phrases-emotes'    // + the reserved presence emote channel
  | 'free-text';        // today's kind 21201 behaviour

/** How untrusted external destinations are treated. */
export type EgressMode =
  | 'blocked'
  | 'confirm-allowlist' // named destinations, with an interstitial
  | 'confirm-any'       // any destination, with an interstitial
  | 'open';             // today's behaviour

/** Which media a player may put on the theater screen. */
export type MediaCatalogMode =
  | 'none'
  | 'curated'   // issuer-signed approved list only
  | 'open';     // any embeddable YouTube video — today's behaviour

/** How much identity a stranger may project into this player's client. */
export type StrangerIdentityMode =
  | 'anonymous'   // generated names, no user-authored strings at all
  | 'moderated'   // user-authored names that pass a name policy
  | 'as-published';

export interface IslandSafetyPolicy {
  readonly profile: ExperienceProfile;

  // ── Communication ────────────────────────────────────────────────────
  /** In-world chat, BOTH send and render. One value; they can never diverge. */
  readonly worldChat: CommunicationMode;
  /** Private 1:1 messaging. Currently always 'none' — encoded so it stays a decision. */
  readonly directMessages: 'none';
  /** The reserved presence emote channel. */
  readonly emotes: boolean;

  // ── Other people ─────────────────────────────────────────────────────
  readonly multiplayerPresence: boolean;
  readonly strangerNames: StrangerIdentityMode;
  /** Render another player's kind:0 avatar/name. Never true in v1. */
  readonly strangerProfileMetadata: false;
  /** Tap a stranger's Blobbi to open its info card. */
  readonly strangerBlobbiInspection: boolean;
  /** How much of the local player's state presence publishes. */
  readonly presenceDetail: 'full' | 'coarse';

  // ── Untrusted content ────────────────────────────────────────────────
  readonly externalLinks: EgressMode;
  readonly osShareSheet: boolean;
  readonly socialPlatformShare: boolean;
  /** Render an image from a URL this app did not curate. Never true in v1. */
  readonly arbitraryRemoteImages: false;
  readonly theaterMedia: MediaCatalogMode;
  readonly theaterHosting: boolean;
  readonly theaterJoining: boolean;
  readonly theaterFullscreen: boolean;

  // ── Publishing outward ───────────────────────────────────────────────
  readonly publishPublicNotes: boolean;   // kind 1 from the PhotoBooth
  readonly mediaUpload: boolean;          // Blossom
  readonly freeTextNaming: boolean;       // naming your own Blobbi

  // ── Configuration reach ──────────────────────────────────────────────
  readonly relaySelection: 'pinned' | 'preset-only' | 'any';
  readonly authoringTools: boolean;       // /tools/game-items
  readonly credentialDisclosure: 'guardian-gated' | 'open'; // nsec reveal

  // ── Recourse ─────────────────────────────────────────────────────────
  readonly blocking: boolean;
  readonly reporting: boolean;
}
```

```ts
// src/safety/profiles.ts — the ONLY two literals in the system.

export const STANDARD_POLICY: IslandSafetyPolicy = Object.freeze({
  profile: 'standard',
  worldChat: 'free-text',
  directMessages: 'none',
  emotes: true,
  multiplayerPresence: true,
  strangerNames: 'as-published',
  strangerProfileMetadata: false,
  strangerBlobbiInspection: true,
  presenceDetail: 'full',
  externalLinks: 'confirm-any',   // NOTE: a deliberate improvement on today's 'open'
  osShareSheet: true,
  socialPlatformShare: true,
  arbitraryRemoteImages: false,
  theaterMedia: 'open',
  theaterHosting: true,
  theaterJoining: true,
  theaterFullscreen: true,
  publishPublicNotes: true,
  mediaUpload: true,
  freeTextNaming: true,
  relaySelection: 'any',
  authoringTools: true,
  credentialDisclosure: 'open',
  blocking: true,
  reporting: true,
});

export const FAMILY_POLICY: IslandSafetyPolicy = Object.freeze({
  profile: 'family',
  worldChat: 'phrases-emotes',
  directMessages: 'none',
  emotes: true,
  multiplayerPresence: true,     // deliberately preserved
  strangerNames: 'anonymous',
  strangerProfileMetadata: false,
  strangerBlobbiInspection: true, // the card shows a pet, not a person
  presenceDetail: 'coarse',
  externalLinks: 'blocked',
  osShareSheet: false,
  socialPlatformShare: false,
  arbitraryRemoteImages: false,
  theaterMedia: 'curated',
  theaterHosting: true,
  theaterJoining: true,           // shared watching is preserved
  theaterFullscreen: false,
  publishPublicNotes: false,
  mediaUpload: false,
  freeTextNaming: false,
  relaySelection: 'pinned',
  authoringTools: false,
  credentialDisclosure: 'guardian-gated',
  blocking: true,
  reporting: true,
});
```

### 11.3 Where it lives and how features consume it

**Location:** a new `src/safety/` module — pure, no React, no Nostr, no storage,
following the discipline the codebase already applies to `src/arcade/`,
`src/beach/` and `src/lib/shared-playback/`. A `boundaries.test.ts` in the same
style should prove `src/safety/` cannot import a relay or a wallet.

**Delivery:** one `SafetyPolicyProvider` near the top of `App.tsx` (beside
`AppProvider`), exposing `useSafetyPolicy()`. Resolution order: guardian-locked
stored profile → stored preference → default. Because it is derived from stored
config, it is available synchronously on first render — **there must never be a
frame in which the policy is unknown and a permissive default renders.**

**Consumption — the three rules that make this work:**

1. **Features ask about capabilities, never about the user.**
   `if (policy.worldChat === 'free-text')`, never `if (isChild)`.
   `ExperienceProfile` is compared **only** inside `src/safety/`. An ESLint rule
   should forbid importing `ExperienceProfile` outside that directory —
   the repo already has `eslint-rules/`, so this is enforceable today.

2. **Enforce at the data boundary, not the render boundary.** Concretely:
   - `worldChat` is checked in `processChatEvent` **before `queueBubble`**, and in `publishChatMessage` before signing — *not* in `BlobbiActionDock`'s JSX. The dock's chat button then reads the same policy purely for presentation.
   - `theaterMedia` is checked in `parseYouTubeInput`'s **caller** and in the session **ingest** path, so a `set-media` command to an off-catalog video is rejected on arrival, not merely absent from the UI.
   - `strangerNames` is applied in the `31124` visual parser, so no component can accidentally receive an unfiltered name.
   - `externalLinks` is checked inside a single `openExternal()` helper that is the only construction site for `window.open` and `target="_blank"`.
   - `mediaUpload` is checked inside `useUploadFile` itself, so every present and future caller is covered.

3. **Every deny is a testable assertion.** A `family-policy.test.ts` should mount
   the world under `FAMILY_POLICY`, inject a hostile kind 21201 with free text and
   assert **no bubble renders**; inject a `set-media` for an off-catalog video and
   assert the session leaves; render `ShareModal` and assert no platform button
   exists. This is what makes "is Family mode safe?" a question CI answers.

**Why this shape and not feature flags:** `feature-flags.ts` is build-time and
operator-scoped, which is right for what it does and wrong for this. Safety is a
per-user, runtime, guardian-controlled property. They should coexist, not merge.

---

## 12. Guardian-control recommendations

Ranked as requested. Ranking assumes **no server** — there is no Blobbi backend to
hold a parent account, and inventing one is a far larger project than Family mode.

### Essential

| Control | Why |
|---|---|
| **Profile selection (Standard / Family)** | the root capability; everything else derives |
| **A lock so a child cannot silently switch to Standard** | without it the whole system is decorative. A device-local PIN or passphrase, stored hashed. **Be honest that this is a speed bump, not a security boundary** — a child who can reinstall the browser profile can reset it |
| **Blocking + reporting** (§9.2) | the minimum recourse layer; must exist in *both* profiles |
| **Pinned relay in Family mode** | otherwise every other control is one menu away from irrelevant |

### Useful

| Control | Why |
|---|---|
| **Communication level** (`none` / `phrases` / `phrases-emotes`) | families differ; a 5-year-old and a 12-year-old are not the same user |
| **Theater access** (`off` / `curated` / `curated + shared`) | the highest-variance capability |
| **Guardian-visible report history** | lets a parent see what happened without reading everything |
| **Session-length awareness** (a gentle "you've been playing for an hour") | there is no such mechanism today; energy is the only natural boundary |
| **Guardian unlock of the PhotoBooth → Nostr share** | genuinely nice for a family that *wants* to share |
| **Guardian custody of the nsec** | the child cannot steward an unrecoverable credential |

### Overengineering (do not build)

- Hard play-time limits and scheduling — high complexity, easily circumvented, and a family-negotiation problem rather than a software problem.
- Purchase controls — **there are no purchases**. Building this would imply a monetisation model that does not exist.
- Remote parental dashboard / companion app — requires the backend that does not exist.
- Chat transcript logging for parents — conflicts with the ephemeral design, creates a retention obligation, and is unnecessary once free text is off in Family mode.
- Per-capability granular toggles for all 36 matrix rows — a settings screen no parent will complete. Ship two profiles plus three or four dials.

---

## 13. Onboarding options

| | Approach | UX | Honesty | Circumvention | Privacy / age data | Consent implications | Complexity |
|---|---|---|---|---|---|---|---|
| **A** | "Are you a child? / Are you an adult?" | poor — a child answers "adult" for the better experience; an adult resents being asked | **states an age claim**, which is the problem | trivial, and *incentivised* | **collects an age assertion** — the thing to avoid | asking creates awareness of age, which can trigger obligations | low |
| **B** | "Family Experience / Standard Experience" | **good** — frames a *product choice*, not a status test | honest: it describes what you get | possible, but **not incentivised** if Family is desirable rather than lesser | **no age data collected** | no age assertion made | low |
| **C** | Guardian setup flow | best safety, worst funnel — a child alone cannot start | honest | strong if PIN-locked | may collect adult data | closest to verifiable consent | high |
| **D** | Family mode in Settings only | invisible; most families never find it | honest but useless | n/a | none | none | lowest |
| **E** | **B + optional guardian lock (recommended)** | good | good | proportionate | none by default | none by default | moderate |

### Recommended: E — describe the experience, do not ask the age

Two clearly-named experiences at first run, presented as equals, with a short,
concrete description of what each includes ("chat with words you pick from a list;
movies from our shelf" vs "type your own messages; any YouTube video"). Whoever is
setting up chooses. A "Lock this choice" step immediately after picking Family
sets a PIN. Switching *to* Family is always free; switching *away* requires the
PIN if one is set.

**Is an explicit "child / adult" selection recommended? No.** Three reasons:

1. **It does not work.** A self-declared age gate is the least effective control in the field, and it is *anti-effective* here because the honest answer costs the child features.
2. **It creates the data problem it was meant to solve.** The moment the app records "this user is a child", it has processed a child's personal data and may have created obligations (COPPA-style verifiable parental consent, GDPR Art. 8 age-of-consent handling). **Not asking is both safer and simpler.**
3. **It frames safety as a punishment.** "Family" as a product with things a child actually wants — a phrase palette with fun expressions, emotes that Standard doesn't have yet, a curated film shelf — is chosen willingly. "Child mode" is escaped.

The design goal follows: **make Family mode genuinely desirable.** If emotes ship
Family-first, a family choosing Family gains something. That is what makes the
choice stick without enforcement.

---

## 14. Legal / privacy review flags

**None of this is legal advice, and nothing below should be treated as a
conclusion.** These are the questions a lawyer must answer before Blobbi Island is
marketed to, or knowingly directed at, children. Each is flagged with what the
*technical* audit found, so counsel starts from facts.

| # | Area | Technical facts counsel needs | Question for counsel |
|---|---|---|---|
| L1 | **COPPA (US, under 13)** | No account server; identity is a locally generated keypair. Personal data collected by *Blobbi* directly: none. Data *published to a public relay* by the user's own signature: pubkey, Blobbi name, room, coordinates, timestamps, and chat text. | Does publishing user-authored content to a third-party public relay under the user's own key constitute "collection" by the operator? Does "directed to children" attach if a Family mode is marketed? Is verifiable parental consent required, and what would satisfy it with no accounts? |
| L2 | **GDPR Art. 8 (child consent, 13–16 by member state)** | Same. Public relay = a third-party processor the operator may or may not control (Ditto is co-designed; other relays are not). | Who is controller vs processor for relay-stored events? What is the lawful basis? How does the age of consent interact with a product that never learns the age? |
| L3 | **UK Age Appropriate Design Code** | 15 standards, several of which this audit touches directly: data minimisation (§7), default settings (§11), geolocation (**§7.2 — none collected**), profiling, nudge techniques (**§8.2 — the care streak**), connected toys, online tools (**§9 — none exist**). | Does the AADC's "likely to be accessed by children" test apply already, before any Family mode? Does the care-streak mechanic constitute a prohibited nudge technique? |
| L4 | **Age assurance regimes** (UK OSA, various EU/US state laws) | No age assurance of any kind. Recommendation §13 is to *avoid* collecting age. | Do any applicable regimes *mandate* age assurance for a product with open user-to-user text chat? Is "no free chat in Family mode" a recognised mitigation? |
| L5 | **Data retention & the right to erasure** | **Nostr events cannot be deleted by the operator.** NIP-40 is a request (§3.1 A3); NIP-09 deletion is advisory. `RECOVERY_BOUNDARY` in `event-registry.ts` already states plainly that user-signed events cannot be restored *or* controlled by the issuer. | How is an erasure request satisfied for content on relays the operator does not control? Must this be disclosed pre-signup? |
| L6 | **Parental consent for publishing** | A child publishing a kind 1 note with an image (S9/S11) creates permanent public content, cross-relay, content-addressed on Blossom. **Practically irreversible.** | Is parental consent required before a minor publishes public content? (This is a strong independent argument for §10 row 18 defaulting to deny.) |
| L7 | **Third-party embeds** | YouTube iframe sets Google cookies and receives the child's IP the moment a video loads. `youtube-nocookie.com` is CSP-permitted but unused. | Does embedding YouTube in a child-directed service create obligations (Google's own child-directed-content terms are relevant here)? Would `youtube-nocookie` change the analysis? |
| L8 | **Duty to report CSAM / illegal content** | No reporting pipeline, no retention, no moderation contact (§9.1). | What obligations attach to an operator of a service with child users and user-to-user chat? Does a Ditto-operated relay change who bears them? |
| L9 | **Credential handling** | `SignupDialog` generates an nsec in-browser and offers a `.txt` download. Loss = permanent, total account loss including all game progress. | Any consumer-protection or fairness issue in a child-directed product whose loss mode is unrecoverable? |
| L10 | **Marketing claims** | Any "safe for kids" claim must survive §3.1's limits — especially "messages disappear" (A3) and "you can block bad users" (A2). | What can be claimed truthfully? |

**Sharp line:** everything in §1–§12 and §15–§17 is a *technical safety
recommendation* that can be implemented on engineering judgement alone.
Everything in this section requires counsel **before** the product is marketed to
children, and none of it should be inferred from this document.

---

## 15. Ranked findings

Severity is **realistic child/family harm**, not CVSS. Effort is
S(mall) / M(edium) / L(arge) / A(rchitectural).

### Critical

| ID | Finding | Evidence | Effort |
|---|---|---|---|
| **C-1** | **Unrestricted free-text public chat between strangers, with no filter, no block, no report, no moderation.** Any adult on the relay can put arbitrary text in front of any child in the same room. This is the primary grooming and inappropriate-content vector. | `MultiplayerLayer.tsx:706-843`; `chat-config.ts` | M |
| **C-2** | **No blocking, muting or reporting anywhere in the product.** A harassed child has no recourse but to close the tab, and the harasser can follow them (see H-2). | verified absent across `src/` | M |
| **C-3** | **Open YouTube catalog in the theater**, with `set-media` able to change the video *after* a guest has joined. Full-screen, full-audio, arbitrary content. | `youtube-url.ts:5-7`; `TheaterMediaInput.tsx`; `useSharedPlayback.ts` | M |
| **C-4** | **No policy layer exists, so every safety fix will be a scattered conditional.** Without §11 first, Family mode will be inconsistent by construction and untestable. | `AppContext.ts` — config is `{theme, relayUrl}` | A |

### High

| ID | Finding | Evidence | Effort |
|---|---|---|---|
| **H-1** | **User-chosen Blobbi names (32 chars free text) are shown to every nearby player** and persist in kind 31124. A vector for slurs, sexual names, phone numbers and off-platform handles that follows the player around. | `BlobbiHatchingCeremony.tsx:663`; `MultiplayerLayer.tsx:1614-1627` | M |
| **H-2** | **A stranger can follow a child from room to room using data the stock client already receives.** The presence subscription's single `#t` OR-filter delivers island-wide presence. | `useIslandPresence.ts:752-760` (filter), `:486` (client-side narrowing) | S (narrow the filter) / L (fully mitigate) |
| **H-3** | **Relay switching is reachable from the account menu** and accepts any `wss://` URL — moving the child to an unmoderated population and defeating any relay-side control. | `RelaySelector.tsx:52-56`; `AccountMenu.tsx:306` | S |
| **H-4** | **PhotoBooth → social popups** hand a child directly to Twitter/Facebook/LinkedIn/Reddit/WhatsApp/Telegram with **no confirmation**. | `ShareModal.tsx:159-205`; `SocialShareModal.tsx:60-110` | S |
| **H-5** | **PhotoBooth → Nostr publish** creates a permanent public kind 1 with a free-text caption plus a permanent Blossom upload. Practically irreversible. | `ShareModal.tsx:206-260`; `useUploadFile.ts` | S |
| **H-6** | **No external-navigation chokepoint.** `window.open` is called directly in two components with duplicated logic; nothing can gate egress. | `ShareModal.tsx:205`, `SocialShareModal.tsx:110` | S |
| **H-7** | **Chat receive path applies no length or structural limit.** A third-party client can send far more than 120 characters and it renders. | `processChatEvent`, `MultiplayerLayer.tsx:760-822` | S |

### Medium

| ID | Finding | Evidence | Effort |
|---|---|---|---|
| **M-1** | **`hiddenIn` broadcasts the exact hiding-spot id** while suppressing the sprite — hiding does not hide from a modified client. | `multiplayer.ts` `PresenceContent.hiddenIn` | S |
| **M-2** | **25-second heartbeats with a room id are a high-resolution play-schedule log** if any relay retains them. NIP-40 does not guarantee deletion. | `HEARTBEAT_INTERVAL_MS`, `EXP_SECONDS` | M (protocol) |
| **M-3** | **`NoteContent.tsx` is dead code that linkifies arbitrary URLs with `target="_blank"`** and renders `@mentions` from stranger kind:0. A single future import into a chat bubble creates a one-tap stranger-controlled exit. | `NoteContent.tsx`; no non-test importer | S (delete or policy-gate) |
| **M-4** | **`/tools/game-items` ships in production**, unlinked but reachable, with upload, publish and an external link. | `AppRouter.tsx:20-24`; `GameItemTools.tsx:267` | S |
| **M-5** | **Care streak creates guilt-driven daily return pressure** on a child, mediated by a pet's wellbeing. | `useUseItem.ts:171-196` | M (product decision) |
| **M-6** | **A child is handed an unrecoverable credential** (`nsec.txt`) with no guardian custody path. | `SignupDialog.tsx:44-90` | M |
| **M-7** | **Theater fullscreen** removes the game frame entirely, leaving a child alone with an arbitrary video. | `youtube-player.ts:379-381` | S |
| **M-8** | **The chat HTML-strip regex reads like a security control but is not one.** Currently harmless (React escapes), but it can license a future `innerHTML` render. | `MultiplayerLayer.tsx:806` | S (comment/rename) |

### Low

| ID | Finding | Effort |
|---|---|---|
| **L-1** | `img-src ... https:` in CSP permits any HTTPS image origin — no current path reaches it, so the CSP is not the backstop. | S |
| **L-2** | `connect-src 'self' blob: data: https: ws: wss:` permits any relay/host — necessary for user-chosen relays, but broad. | S |
| **L-3** | Blossom uploads have no client-side type or size validation. | S |
| **L-4** | Item art loads from `blossom.primal.net` / `assets.blobbi.pet`, exposing the player's IP to those hosts. | M |
| **L-5** | 61 `console.log/debug/info` sites; some log pubkeys and session ids (mostly dev-gated). | S |
| **L-6** | Client-trusted daily windows and rate limits are manipulable — economy integrity, not safety. | — |

### Informational

- **I-1** — **No analytics, telemetry, error reporting, push notifications or cookies.** Verified absent (§7.4). This is a genuine and unusual privacy strength; do not lose it.
- **I-2** — **No real-money mechanics of any kind.** Removes an entire category of child-harm findings.
- **I-3** — **kind:31950 carries no real-world geolocation.** Percentages of a room's playable area, sixteen fixed rooms, no `navigator.geolocation` anywhere.
- **I-4** — **PhotoBooth has no camera.** Canvas composition of the player's own Blobbi artwork.
- **I-5** — **The item catalog's issuer-locking is the correct trust pattern** and should be the template for every future content class (guest games, theater catalog, phrase catalog).
- **I-6** — **`guest-game-trust.ts` already records the right decision** for third-party games (official issuer only, nothing executable) and proves it stays unwired with a test. Extend this discipline.
- **I-7** — **Session-interruption resilience is genuinely child-considerate**: a child can be called away mid-mine and lose nothing.
- **I-8** — The emote channel is **already reserved in the protocol** and unbuilt; it is the natural, additive centrepiece of Family communication.

---

## 16. Threat scenarios

| # | Scenario | Possible today? | Path | Severity | Family mitigation | Remaining limitation |
|---|---|---|---|---|---|---|
| 1 | **Stranger sends explicit text to a child** | **Yes** | log in → walk to Town → type into the dock → kind 21201 → bubble over their Blobbi, visible to every child present | **Critical** | `worldChat: 'phrases-emotes'` — free text neither sent nor **rendered**, including from Standard/third-party clients | a Family child sees Standard players' bubbles as nothing; a Standard child in the same room is still exposed |
| 2 | **Stranger uses an explicit avatar** | **No** | stranger kind:0 pictures are never rendered | — | encoded as `strangerProfileMetadata: false` + a lint rule so it stays true | a stranger's Blobbi *appearance* is still theirs, but constrained to the official catalog |
| 3 | **Stranger sends an external link** | **Yes** (as inert text a child can retype) | chat text `discord.gg/xyz` | **High** | free text off ⇒ no link | if `NoteContent` is ever wired into chat (M-3) this becomes one-tap; prevent architecturally |
| 4 | **Stranger moves the conversation off-platform** | **Yes** | "add me on <platform>, my name is X" in chat, or a name/theater code used as a rendezvous | **Critical** (grooming's decisive step) | phrases-only removes the channel; codes remain but carry no message | a phrase palette cannot express a handle, but two people who already know each other can still coordinate elsewhere. **Off-platform contact cannot be prevented by any client** |
| 5 | **Malicious / inappropriate theater content** | **Yes** | host loads any YouTube id; can `set-media` after guests join | **Critical** | `theaterMedia: 'curated'`, re-validated on every `set-media`, leaving the session if it goes off-catalog | curation cost is real and ongoing; a curated video's *YouTube end screen* is still YouTube's surface |
| 6 | **Harassment following a child across rooms** | **Yes** | read island-wide presence (the stock subscription already receives it) and walk to the target's room | **High** | blocking (bidirectional invisibility) + coarse presence + narrowed subscription | a modified client still reads the relay; **only relay-side restriction truly fixes this** |
| 7 | **Impersonation** | **Yes** | name a Blobbi the same as a friend's; nothing binds a name to a key, and no name uniqueness exists | **Medium** | `strangerNames: 'anonymous'` — generated, key-derived names are collision-resistant by construction | a determined actor can still mimic appearance |
| 8 | **Spam flooding a room** | **Yes** (limited) | third-party client ignores the 500 ms local throttle; each pubkey gets one bubble at a time, so the ceiling is one bubble per attacker | **Medium** | inbound rate limiting + blocking | new keys are free — flooding scales with attacker patience |
| 9 | **Inappropriate username** | **Yes** | name a Blobbi with a slur or sexual phrase (32 chars); shown on hover to everyone nearby, and it persists | **High** | anonymous names in Family; a name policy for Standard | a Standard player still sees it |
| 10 | **A child reveals personal information** | **Yes** | types their name/school/address/age into chat, or into their Blobbi's name | **Critical** (self-inflicted, extremely common) | no free text in either field ⇒ **structurally impossible** | a child could still say it out loud in an off-platform channel arranged elsewhere |
| 11 | **Inappropriate external image displayed to a child** | **No** | no path renders an uncurated image URL | — | `arbitraryRemoteImages: false` + narrowed CSP `img-src` | depends on the official issuer's own art review |
| 12 | **A child blocks someone** | **No — the feature does not exist** | — | **Critical gap** | build blocking (§9.2) | see 13 |
| 13 | **A blocked player changes key** | **Yes, in seconds** | `SignupDialog` → new nsec → new pubkey → unblocked | **High** | nothing client-side fixes this. Capability restriction (no free text) means a new key buys the attacker **nothing to say** | **This is why blocking must not be the primary control.** Relay-level identity friction is the only real answer |
| 14 | **A malicious client publishes Blobbi-recognised events** | **Yes** | any Nostr library can emit 21201/31950/31951/21951 | **High** | all ingest paths validate structurally (already the documented stance) and Family policy filters by *content class*, not by trust in the sender | cannot be prevented, only filtered. **This is the assumption the whole design must be built on** |
| 15 | **Economic manipulation / scam** | **Largely not** | no trading, no gifting, no real money, no P2P transfer; a scammer can only *lie* in chat about a nonexistent trade | **Low today** | free text off removes even the lie | **any future trading feature would reintroduce this whole class** — and should be treated as a Family-mode `deny` from day one |

---

## 17. Implementation roadmap

Ordered by dependency, then by harm-reduction per unit of effort. **Nothing here is
implemented.**

### Phase A — Policy foundation *(prerequisite for everything else)*
- Create `src/safety/` with `ExperienceProfile`, `IslandSafetyPolicy`, `STANDARD_POLICY`, `FAMILY_POLICY`, plus a `boundaries.test.ts` proving purity.
- Add `SafetyPolicyProvider` + `useSafetyPolicy()`, resolved synchronously from stored config.
- Add the ESLint rule forbidding `ExperienceProfile` imports outside `src/safety/`.
- **Ship with `STANDARD_POLICY` wired and no behaviour change.** The whole phase is a no-op the tests can verify.
- *Why first:* C-4. Every later phase either consumes this or duplicates it.

### Phase B — External egress chokepoint *(smallest effort, largest immediate reduction)*
- Add `openExternal(url, reason)` as the single construction site for `window.open` / `target="_blank"`, with a destination-naming confirmation.
- Migrate `ShareModal` and `SocialShareModal` to it; add the ESLint ban on raw `window.open`.
- Gate `RelaySelector` on `policy.relaySelection`; gate `/tools/game-items` on `policy.authoringTools`.
- Delete or policy-gate `NoteContent.tsx` (M-3).
- *Addresses:* H-3, H-4, H-6, M-3, M-4. Improves Standard mode too.

### Phase C — Blocking & reporting *(needed by both profiles)*
- Local persisted block list; one-tap block on the existing remote-Blobbi tap target.
- **Filter at ingest:** blocked pubkeys dropped in `processPresenceEvent` and `processChatEvent`, so a blocked player is absent, not hidden.
- Report capturing the rendered text, event id, pubkey, room and timestamp **at report time** (the event is ephemeral).
- Report implies block. Guardian-visible local history.
- *Addresses:* C-2, part of H-2. **Do not publish a kind 10000 mute list.**

### Phase D — Communication controls
- Phrase catalog (curated, localized, extensible) + phrase picker replacing the dock's free-text input under Family policy.
- Wire kind 21201 content to carry a `phrase` id **alongside** localized `text`, so Standard and third-party clients still render something sensible.
- **Enforce on receive**: under `phrases*`, drop any bubble that does not resolve to a known phrase id.
- Build the reserved **emote** channel (`state: 'emote'`) — Family's expressive win.
- Add inbound length/structure limits (H-7) in Standard too.
- *Addresses:* C-1, H-7, and delivers the feature that makes Family desirable.

### Phase E — Untrusted media
- Curated theater catalog as an **issuer-signed list** (reuse the `useItemCatalog` trust pattern).
- Under `theaterMedia: 'curated'`: replace `TheaterMediaInput` with a shelf; validate on join **and on every `set-media`**, leaving the session if it goes off-catalog.
- Disable fullscreen under Family; consider `youtube-nocookie` for both profiles.
- Gate `useUploadFile` and the ShareModal Nostr section on policy.
- Narrow CSP `img-src`.
- *Addresses:* C-3, H-5, M-7, L-1, L-3.

### Phase F — Identity & presence minimisation
- Anonymous stranger names under Family (reuse `genUserName`, which is already deterministic per pubkey); word-pick composer for the child's own Blobbi name.
- Narrow the presence subscription to an actual AND (H-2) — a one-line change with a real payoff.
- Coarse presence under Family: drop `hiddenIn` detail, consider dropping `goal`.
- *Addresses:* H-1, H-2, M-1, part of M-2.

### Phase G — Guardian controls & onboarding
- Profile chooser at first run (option E from §13) and in settings.
- PIN lock on the Family profile — **documented honestly as a speed bump**.
- Three dials: communication level, theater access, share-to-Nostr unlock.
- Guardian nsec custody guidance.
- *Addresses:* M-6, and makes the whole system usable by an actual parent.

### Phase H — Relay-side work *(outside this repository, highest leverage)*
- With Ditto: a Family relay policy — retention limits on 21201/31950, moderation queue for kind 1984 reports, identity friction for new keys.
- *Addresses:* the residual halves of scenarios 1, 6, 8, 13, 14 — **the parts no client can fix.**

**If only three things ship: A, C, D.** Policy foundation, recourse, and
communication. That is the difference between "a game with chat" and "a game a
parent can reasonably allow".

---

## 18. Explicit non-goals — what NOT to do

### Tempting approaches that would make things worse

1. **"We added a profanity filter, so chat is kid-safe."** It is not. Filters miss obfuscation, miss non-English, miss context, and catch nothing about grooming — which uses ordinary, kind, entirely clean words. A filter cannot detect "what's your name? how old are you? do you have Discord?" **Do not let a filter substitute for a capability decision.**

2. **Hiding the chat UI while the subscription keeps running.** The single most likely bug in this codebase's Family implementation. `BlobbiActionDock` is a *different file* from `processChatEvent`; hiding the button leaves inbound bubbles rendering over strangers' heads. **Policy must be enforced in `processChatEvent`, before `queueBubble`.**

3. **Trusting profile metadata because it is signed.** A signature authenticates the author, never the content. The current non-rendering of stranger kind:0 is a safety asset — **make it an enforced rule, not an accident of what has been built so far.**

4. **Treating NIP-40 expiration as deletion.** `EXP_SECONDS` and the chat expiration govern *this client's rendering*. Any parent-facing claim that "messages disappear" must say "disappear from the game", or it is false.

5. **Scattering `isChild` / `isFamilyMode` through components.** Ten files, ten chances to miss one, zero testability. Features ask *"is this capability allowed?"* — never *"who is this user?"* Enforce with the lint rule in §11.3.

6. **Relying on Terms of Service.** A ToS is not a control. It cannot be read by an eight-year-old and cannot be enforced against an anonymous keypair.

7. **Assuming blocking one pubkey blocks a person.** Keys are free (§3.1 A2, scenario 13). Blocking is friction. Capability restriction is the control.

8. **Collecting exact age.** Do not ask a birthdate. Do not ask "are you a child?". §13 explains why: it does not work, and it creates the legal exposure it was meant to reduce.

### Repo-specific traps

9. **Do not wire `NoteContent.tsx` into chat bubbles.** It linkifies arbitrary URLs with `target="_blank"` and renders `@mentions` from stranger kind:0 — both of the things this audit says must never happen, in one component that is already in the tree and looks helpful. **Delete it or policy-gate it (M-3).**

10. **Do not treat the chat HTML-strip regex as a security control** (`MultiplayerLayer.tsx:806`). React escaping is what keeps chat safe. The regex is cosmetic and trivially bypassed; leaving it unlabelled invites someone to conclude the string is sanitised and render it as HTML.

11. **Do not merge Family mode into `feature-flags.ts`.** Those are build-time operator decisions and correctly documented as "NOT a per-user permission, and NOT a protocol-level authorization mechanism". Safety is per-user and runtime. Keep them separate.

12. **Do not publish block lists as kind 10000.** It would broadcast, permanently and publicly, which accounts a child blocked. Keep blocks local.

13. **Do not "fix" the presence subscription's OR-filter by adding client-side trust.** Narrowing to `'#t': ['loc:<location>']` reduces what *this client asks for*; it does not and cannot stop a modified client from reading the relay. State the limitation rather than implying a fix.

14. **Do not build Family mode as single-player.** The evidence does not demand it. Presence, shared rooms, co-play, the Arcade, the Beach, and synchronised watching are all low-risk and are the reason a child wants to be there. **The risk is concentrated in free text, open video and external exits — remove those three, keep the world.**

15. **Do not assume the theater's join model is the risk.** It is genuinely well designed — opt-in, code-gated, host-authoritative, no discovery. The risk is the **open catalog** and the **post-join `set-media` swap**. Fix the content model, keep the join model.

16. **Do not add a trading, gifting or item-transfer feature without revisiting this audit.** Its absence currently removes an entire scam class (scenario 15). It would come straight back.

17. **Do not add social achievement announcements in Family mode.** Achievements exist in kind 11125 but have no broadcast surface. Keep it that way.

18. **Do not lose the things that are already right:** no analytics, no push notifications, no real money, no camera, no geolocation, issuer-locked catalog, interruption-safe sessions, honest reward breakdowns. **Every one of those is a finding that did not have to be written.**
