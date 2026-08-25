# Theater media safety

**Status:** implemented. `openMediaEntry` is enforced at every path that can put
media on the theater screen, not only at the input. **No new Nostr kind, tag or
event was created** — the approved-media catalog is bundled, not published.

- Rationale: [`family-safety-audit.md`](./family-safety-audit.md) (finding C-3)
- Capability model: [`family-safety-policy.md`](./family-safety-policy.md)
- Session protocol: [`protocol/shared-playback-session.md`](./protocol/shared-playback-session.md)

---

## 1. The problem

The theater accepts an **open catalog**: any embeddable YouTube video, by URL or
by id. That was the last Critical finding in the audit, and the shape of it is
not "there is a text box".

```
  host input  ──┐
  set-media   ──┤
  join        ──┼──▶ media on screen
  re-seat     ──┘
```

Four ways media reaches a player and only one is a person typing. The one that
matters most is the second: **a guest joins while an approved video is playing
and the host swaps it a second later.** Consent at join time does not bound the
exposure, and a check on the input surface would have covered the only case that
was never a problem.

## 2. Architecture

```
                    ┌─────────────────────────────┐
  local input ─────▶│                             │
  session set-media▶│   admitTheaterMedia(policy, │──▶ dispatch ──▶ player
  session join ────▶│     media, catalog)         │
  re-seat ─────────▶│                             │──▶ refused
                    └─────────────────────────────┘
```

| File | Role |
|---|---|
| `src/theater-media/catalog.ts` | the approved list, bundled; identity + **trusted title** |
| `src/theater-media/admission.ts` | `admitTheaterMedia` — pure, the one decision |
| `TheaterStage.admitAndRequestMedia` | the funnel every path goes through |
| `useSharedPlayback` | the publication seam's own check (host side) |
| `TheaterMediaShelf` | the curated chooser |
| `lib/youtube-player.ts` | the only place an iframe is built |

A structural test asserts `dispatch({ type: 'submit' })` appears **once** in
`TheaterStage`, and that the admission call precedes it. A fifth entry path
cannot be added without passing the gate.

## 3. Nostr primitives investigated

The catalog could have been a published, issuer-signed list. Every plausible
primitive was checked against the current specs first.

| NIP / kind | Purpose | Status | Semantic fit | Publisher / addressing | Privacy | Decision |
|---|---|---|---|---|---|---|
| **NIP-71 kind 21 / 22** — video events | A dedicated post of externally hosted video, for video-first clients | `draft` `optional`, regular | **Poor.** Its primary data is an `imeta` tag with a **direct playable URL** (`.mp4`, `.m3u8`). A YouTube video has no such URL — it is embedded, not fetched — so the required field would be a fiction | anyone; not addressable | public | **Rejected** — the required media reference does not exist for an embed |
| **NIP-71 kind 34235 / 34236** — addressable video | Same, updatable via a `d` tag; has an `origin` tag for imported content: `["origin","<platform>","<external-id>","<url>"]` | `draft` `optional`, addressable | **Closest of the standards.** `origin youtube <id>` expresses exactly the identity we need — but it is an *optional* tag on an event whose *required* data is still a playable URL. Publishing a video event for a video we do not host, cannot serve and did not make is a category error | issuer via `d`; `a`-addressable | public | **Rejected** — right tag on the wrong event |
| **NIP-51 kind 30005** — video curation sets | "groups of videos picked by users", expected tag items `"e"` (kind 21 videos) | `draft` `optional`, addressable set | **Structurally exactly a curated list** — and it references NIP-71 events by `e`, so adopting it means adopting NIP-71 first, with the mismatch above. Two protocol layers for "six approved ids" | issuer via `d` | public | **Rejected** — inherits NIP-71's problem |
| **NIP-51 kind 10000** — mute list | Things not to see | `draft` `optional` | Inverted, and personal rather than editorial | per-user | public/private | **Not applicable** |
| **NIP-78 kind 30078** — app-specific data | Addressable store for apps that explicitly do not want interoperability; `content` and tags "can be anything" | `draft` `optional`, addressable | **Would work, and is honest about what it is.** It is the standard's own answer to "this does not fit anywhere else" — but it is a container, not a schema: adopting it still means inventing the tag layout inside it | issuer via `d` | public | **Viable if publication is ever wanted**; not needed yet |
| **NIP-92 / NIP-94** — `imeta` / file metadata | Media attachment metadata | `optional` | Field vocabulary only, no catalog semantics | n/a | n/a | **Not applicable** as a catalog |
| **NIP-32 kinds 1985 / `l`,`L`** — labelling | Attach labels to things | `optional` | Could mark a video "approved", but a label is an assertion *about* an event that must already exist | anyone | public | **Rejected** — needs the video event first |
| Blobbi **kind 31632** — item definitions | The official item catalog | in use | **Deliberately not reused.** It fits *architecturally* — trusted issuer, allow-listed `d`, strict parser — and not at all *semantically*: it carries stack sizes, categories, stat effects and gameplay actions, and its consumers are the inventory and the shop. A video is not an item, and making it one would put films in a system that will try to let you eat them | official issuer | public | **Rejected** — convenience is not fit |

**Conclusion: no primitive fits cleanly, and no new kind was created** — because
the catalog does not need to be published at all (§4). If it ever should be,
NIP-78 kind 30078 under the official issuer is the recommendation, and that
decision would come back for approval before implementation.

The **trust pattern** from `useItemCatalog` — trusted issuer, allow-listed
identifiers, strict parser, fail-closed — is reused *conceptually* in §5 without
reusing its kind.

## 4. The catalog is bundled

A fetched catalog has a state nobody wants: **unknown**. A relay times out, a
query returns partial results, the app boots offline — and a curated experience
holds an empty list it cannot distinguish from "nothing is approved". Failing
closed on that is correct and makes the theater unusable on a bad connection;
failing open is unthinkable.

A list compiled into the build has no unknown state. It is present at the first
frame, identical on every device, cannot be influenced by a relay, and cannot be
poisoned by a newer event from an unexpected author. For a set that changes on a
release cadence rather than a live one, that is strictly better than any
protocol — and it is why the "relay UNKNOWN" hazard the brief asks about simply
does not arise here.

```ts
interface ApprovedMedia {
  id: string;               // stable catalog id, provider-independent
  provider: 'youtube';
  providerMediaId: string;  // the 11-character video id
  title: string;            // TRUSTED — written here, never received
  category?: string;
}
```

### The production catalog ships EMPTY, deliberately

Deciding which videos are appropriate for children is editorial work with real
consequences, and it needs a person who can watch them and sign off. It is not
something to invent alongside the code that will show them — entries chosen here
would be a list this project asserts is safe for a nine-year-old on no evidence.

So the array ships empty, the enforcement around it is complete and tested, and
a curated theater honestly shows *"There is nothing on the shelf right now"*
rather than something nobody vetted. Populating it is one edit to
`src/theater-media/catalog.ts` and nothing else. A test asserts the list is
empty, so filling it is a deliberate change that arrives with its sign-off
rather than by drift.

A structural test also checks every entry is well-formed. That matters more than
it looks: a malformed id never matches, so a typo would silently mean "this film
is not approved" with no error anywhere.

## 5. Trust and failure

| Concern | Behaviour |
|---|---|
| Untrusted authors | Not possible — the catalog is not fetched |
| A newer event overriding official entries | Not possible — same reason |
| Malformed entries | Excluded by `isWellFormedApprovedMedia`; never candidates |
| Duplicates / conflicts | First well-formed entry wins, deterministically |
| Relay UNKNOWN | Does not arise |
| Catalog empty or unloadable | **Fails closed**: curated experiences play nothing. Asserted directly, and live today since the list is empty |
| Standard depending on catalog availability | It does not — open entry never consults the catalog to decide, only to find a title |

## 6. `openMediaEntry`

| | Standard | Family |
|---|---|---|
| `openMediaEntry` | `true` | `false` |
| Arbitrary URL / id | ✅ | ❌ — no input exists |
| Approved catalog media | ✅ | ✅ |
| Hosting a session | ✅ | ✅ |
| Joining a session | ✅ | ✅ |
| Synchronised playback | ✅ | ✅ |
| Fullscreen | ✅ | ❌ (§9) |

**It does not mean "theater disabled".** A curated experience still sits down,
still hosts, still joins, still watches in sync with other people. What changes
is the set of things that may appear on the screen.

## 7. Enforcement

### The gate

`admitTheaterMedia(policy, media, catalog)` — pure, exhaustive, three outcomes:

- **`unsupported-media`** — not something this client can play at all (wrong
  provider, malformed id). Checked first, in every experience, so a curated
  client says "can't be played" rather than "not approved" for something that is
  not media.
- **`not-approved`** — playable, but this experience shows only approved media.
- **admitted** — with the catalog entry attached when one exists, so a curated
  title is used wherever there is one.

### The set boundary

Every local path — the shelf, the URL input, the retry — goes through
`admitAndRequestMedia` in `TheaterStage`. Refusal happens **before** `dispatch`,
so unapproved media never becomes a `request`, and a `request` is what causes a
player to be constructed. A caller holding the setter directly cannot inject
anything.

The retry path re-admits rather than replaying: the catalog is read at admission
time, so a retry after it changed must not resurrect media that is no longer
approved.

### The publication seam

`useSharedPlayback.onLocalCommand` refuses to publish a `set-media` the policy
would not play, and `createSession` refuses to open a session around one. Both
use the **same catalog** the stage admits against — a defence-in-depth check
judging by a different list would refuse media the theater had already accepted.

### The receive boundary

`onRequestMedia` — the callback the session hook uses for *every* media change,
from a `set-media` command, from a canonical `31951` update, from a join, and
from the re-seat fallback — funnels into the same gate.

**There is no frame in which refused media is on screen.** It is not loaded and
then removed; the player for it is never constructed. The integration test
asserts on the fake YouTube constructor's record of every player ever built.

## 8. Host swaps, joins, and catalog changes

### Approved → unapproved, mid-session: **leave the session**

Chosen over "keep the last approved video" and "pause and explain".

The host controls the media and can change it again immediately. Staying turns a
single refusal into a loop of them, and every one is a moment where the only
thing between a child and the content is this check holding. Staying
synchronised to someone who is trying to show you disallowed content is not a
state worth preserving.

Leaving is local and immediate. It does not end the session for anyone else, and
it does not require the host's cooperation. A test drives three consecutive
hostile swaps and asserts nothing is ever loaded.

### Joining a session already on unapproved media

Same path, same result: admission runs on the session's current media before the
state machine is told there is any, so the guest never enters playback. No
one-frame leak. The join is then abandoned.

### Catalog changes while in session

The catalog is a **bundled snapshot**, so within a session it cannot change —
it changes when the app is reloaded on a new build. Membership is therefore
re-checked at every admission (each media change, each join, each retry) against
whatever the current build holds, and never cached per session.

The consequence, stated rather than left undefined: a video removed from the
catalog in a new release keeps playing in a tab that is still running the old
one, and is refused the next time that tab admits anything. Live revocation
would need a fetched catalog, which §4 explains is a worse trade.

## 9. Fullscreen

**Denied under a curated policy, enforced at the iframe.**

Three things are withheld together, because any one alone is insufficient:

- `fs: 0` removes YouTube's own fullscreen button — but only the button;
- `allowfullscreen` is not set;
- the `fullscreen` **and `picture-in-picture`** Permissions-Policy tokens are
  omitted from `allow`. Picture-in-picture is the other way a video leaves the
  island's frame.

A frame that never received the permission cannot be talked into fullscreen by
any control, including the browser's own context menu. Hiding a button would
have left all of that.

### Why no `theaterFullscreen` capability was added

`IslandSafetyPolicy` gained no field. It is derived from `openMediaEntry` in one
named function, `allowsTheaterFullscreen`, for two reasons: the policy's own
guidance is not to grow the matrix for a single call site, and this has exactly
one — the iframe's permissions.

They also express the same stance rather than two independent preferences. An
experience that curates what plays is one where the theater is a *room in the
game*: the screen is part of the island with the world visible around it.
Fullscreen removes the island and leaves a child alone with a video player,
which is the shape curation exists to avoid.

If fullscreen ever needs to vary independently, that is when it becomes a
capability — with a second call site to justify it. Deriving it once, and
naming it, is what keeps that reversible instead of scattered.

## 10. YouTube privacy

**`youtube-nocookie.com` is adopted, for both experiences.** This is a privacy
improvement, not a Family restriction — the theater embeds a video on behalf of
a player who did not ask to be measured.

It is a supported option of the IFrame Player API (`host`), not a URL rewrite:
the API script still loads from `www.youtube.com`, `postMessage` origin handling
is the API's own, `enablejsapi` and `origin` are unchanged, and every player
method behaves identically. Session synchronisation is unaffected — the
integration tests drive a full join, seek and swap against it. The CSP already
named the host in `frame-src`, so nothing there changed either.

### What it does not do — stated because overclaiming here would be worse than silence

- The embed is still a **cross-origin iframe**. YouTube receives the player's IP
  and User-Agent on load, and may set storage of its own once a video plays.
  "No cookies" is not what privacy-enhanced mode promises.
- **`rel=0` no longer disables related videos.** Since 2018 it only restricts
  suggestions to the same channel. There is no parameter that turns them off.
- **End screens, cards and channel links are inside the iframe**, on YouTube's
  origin, under YouTube's control. This page cannot remove them, cannot style
  them, and cannot intercept a click on them. `modestbranding` is also no longer
  honoured.
- A click on any of those can navigate the iframe, and from there the viewer is
  on YouTube. This is **not** the same as Phase D's egress boundary: that owns
  navigations *this* origin performs, and an iframe's internal navigation is not
  one of them.

Curation is what actually bounds this: the set of videos is small and vetted, so
the surrounding surface is bounded too. That is a mitigation, not a fix, and the
honest limit of an embedded third-party player.

## 11. Titles

Under a curated policy the displayed title is always the catalog's. There is no
host-supplied title to be tempted by — the session protocol carries
`{provider, id}` and no words at all — but `theaterMediaTitle` exists so that
stays true if the protocol ever carries more. An approved id with a hostile title
attached is not a content bypass this design can develop.

## 12. Limitations

- **The catalog is empty**, so a curated theater currently has nothing to play.
  Deliberate (§4); populating it is editorial, not engineering.
- **Bundled means no live revocation** (§8).
- **The iframe's internal surface is not controllable** (§10).
- **Standard is unchanged**, including its open catalog. This phase restricts a
  curated experience; it does not make the open one safer.
- **`arbitraryRemoteMedia` remains a `false` invariant** and is unrelated: it
  governs images, not the theater.
