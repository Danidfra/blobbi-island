# Blobbi Dance (Phase 3)

Status: **implemented and playable.** The first real game in the Blobbi Island
arcade, and the first code path in the application that grants an Arcade Ticket.

Phase 3.2 added a presentation pass — the cabinet framing, the note and receptor
treatment, the judgement feedback, the Blobbi on stage, the rebuilt start and
results screens, a mute control, and the mobile and reduced-motion behaviour that
goes with them. See **§14**. It changed no rule: the chart, the judgement windows,
the scoring, the reward policy, the claim boundary and the Nostr event flow are
exactly as Phase 3 left them. **The track is still the synthesised placeholder.**

It runs on exactly one machine — `arcade-dance-machine`, game id `blobbi-dance`
— and nothing else in the arcade became playable. The other eight machines still
have `gameId: null`, which the lifecycle reducer treats as "cannot start a run".

Phase sequence: **Phase 1** Arcade Ticket registry and currency support →
**Phase 2** [shared arcade foundation](./arcade-foundation.md) → **Phase 3** this
document → **Phase 4** the shared arcade catalogue → then the Guest Game runtime,
and the Prize Shop after that (§16).

---

## 1. Architecture, before and after

### Before (end of Phase 2)

```
src/arcade/                       pure, no React / Nostr / inventory
├── types.ts                      ArcadeGameResult + validation
├── arcade-machine-state.ts       lifecycle reducer
├── reward-policy.ts              ticket arithmetic — DANCE policy was `draft`
├── arcade-reward-boundary.ts     the write CONTRACT, unimplemented
├── arcade-input-map.ts, useArcadeInput.ts, useArcadeInterruption.ts
└── audio/arcade-audio.ts         AudioContext boundary — no track, no scheduler

components/blobbi/arcade/
├── ArcadeRoom.tsx                → ArcadeGameShell → ArcadeMachinePanel
                                     (an honest "coming next" panel for the
                                      dance machine, with no Start button)

ARCADE_REWARD_WRITER_UNIMPLEMENTED rejected both its methods.
No game. No ticket. No publish.
```

### After

> **Phase 4 changed how it is WIRED, not what it is.** Blobbi Dance remains what
> it has always been: the game on the basement dance machine. Walking up to
> `arcade-dance-machine` opens it directly — there is no menu in between, and it
> is **not** listed in the shared cabinet catalogue, which the six generic
> cabinets open.
>
> Three wiring consequences, and nothing else in this document is affected:
>
> - `DanceMachine` takes `machineId`, `gameId` and `title` instead of an
>   `ArcadeMachineConfig`. `gameId` and `title` come from the game registry;
>   `machineId` comes from the machine the player walked to, which for this game
>   is **always** `arcade-dance-machine` — `canLaunchArcadeGame` refuses the game
>   on every other machine and from the shared catalogue, so a result and a claim
>   can only ever record the dance machine.
> - Leaving the game returns to the **arcade room**, not to a catalogue. The
>   single dismiss control says where it goes: *Leave* mid-run (which aborts,
>   exactly as before), *Back to the arcade* everywhere else. The footer's
>   duplicate "Close" was removed; the footer now holds one action, Start or Play
>   again.
> - The shell renders inside the game window rather than over the browser page.
>
> The chart, the clock, the judgement, the scoring, the reward policy, the claim
> ledger and the publish/verify semantics are untouched. See
> `docs/arcade-catalogue.md`.

```
src/arcade/dance/                 pure: no React, no DOM, no Nostr, no inventory
├── track.ts                      track identity + metadata + readiness
├── chart.ts                      note chart contract, the one chart, validation
├── judgment.ts                   windows, note selection, scoring, combo, grade
├── dance-result.ts               DanceRunSummary → ArcadeGameResult
├── dance-reward.ts               the ACTIVE ticket policy
└── dance-audio.ts                Web Audio engine + the authoritative song clock

src/arcade/reward-policy.ts       + policy id / version / shape / eligibility
                                  + calculateArcadeReward() (structured grant)

components/blobbi/arcade/dance/
├── DanceMachine.tsx              controller: shell, engine ownership, claim
├── BlobbiDanceGame.tsx           the playable surface (rAF + refs, not state)
├── DancePreview.tsx              controls, timing, tickets, audio honesty
├── DanceResults.tsx              summary + the seven distinct claim states
└── dance-visuals.ts              lane glyphs, colours, note geometry

src/lib/arcade-claim-ledger.ts    localStorage claim ledger + synchronous lock
src/hooks/useArcadeReward.ts      the claim boundary: persist → publish → verify
src/inventory/arcade-reward-writer.ts   the real kind:31633 grant

game result → validation → pure policy → claim boundary → ArcadeRewardWriter
            → canonical kind:31633 inventory mutation
```

`src/arcade/boundaries.test.ts` still proves, against the real import graph, that
**no module under `src/arcade/` can reach a relay or an inventory.** That is why
the writer lives in `src/inventory/` and the claim boundary in `src/hooks/`: the
game computes a number, and something outside the game turns a number into a
balance.

---

## 2. Gameplay

Four lanes — left, down, up, right — with notes falling toward a judgement line
at the bottom of the field. Hit each note as it arrives. A missed note breaks the
combo and costs its points; it costs nothing else, and there is no fail state.

| | |
| --- | --- |
| Session | ~68 seconds end to end |
| Notes | 110 |
| Difficulty | one (`normal`) |
| Fail state | none — every run that reaches the end produces a result |
| Clear condition | finished the song **and** ≥ 60% accuracy |

### Controls

| Lane | Desktop | Also | Touch |
| --- | --- | --- | --- |
| Left | `←` | `A` | far-left button, under the far-left lane |
| Down | `↓` | `S` | centre-left button, under the centre-left lane |
| Up | `↑` | `W` | centre-right button, under the centre-right lane |
| Right | `→` | `D` | far-right button, under the far-right lane |

Each touch button sits **directly under the lane it fires** and shows that lane's
arrow with its key cap (`A` / `S` / `W` / `D`) beneath it, so the mapping is
readable without a legend and without relying on colour. The buttons are 56 px
tall and the full width of their column — comfortably over the 44 px minimum in
`ARCADE_TOUCH_ZONE_MIN_PX`.

All input goes through the shared `useArcadeInput` layer from Phase 2 — there is
no ad-hoc global listener inside the game. Key auto-repeat is dropped, modified
keys (`Cmd`/`Ctrl`/`Alt`) are ignored, arrows and space are `preventDefault`ed
while playing so the page cannot scroll, and `Escape`/`Tab` are never suppressed.
The touch buttons fire on `pointerdown` and ignore the synthetic click that
follows (`event.detail === 0` is the keyboard path), so a tap counts once.

Input is dead outside `status === 'playing'` — enforced both by not binding the
listeners and by a guard inside the hook, so a touch zone cannot bypass it.

---

## 3. Track and chart

### Track

| | |
| --- | --- |
| Id | `blobbi-dance-neon-hop-v1` |
| Title | Neon Hop |
| Source | **synthesised in the browser** (Web Audio oscillators + noise) |
| Tempo | 120 BPM, 4/4 |
| Structure | 1 bar count-in, 32 bars of music, 1 bar tail |
| Duration | 68,000 ms |
| Credit | Generated by Blobbi Island |
| Licence | **No third-party material.** No sample, no recording, nothing to clear. |
| Readiness | **`development`** — a placeholder, not final music |

#### Why it is synthesised

The phase brief's preferred order was (1) reuse a repository-owned asset,
(2) add an original placeholder asset, (3) generate one through the Web Audio
API.

Option 1 has nothing to reuse: the repository contains exactly one audio file,
`public/assets/audio/sfx/bush-rustle.mp3`, a one-shot UI effect. Option 2 is not
something a code change can honestly produce — "add an original recording" means
somebody records something. So option 3 ships: a kick, an offbeat hat, a backbeat
clap and a four-bar bass progression, all computed from code in this repository
and all scheduled against `AudioContext.currentTime`.

`readiness: 'development'` is a field on the track, not a note in a document, and
the preview renders it — so a placeholder cannot quietly become the shipped
experience by being forgotten about. Replacing it means adding a `DanceTrack`
with `source: { kind: 'asset', url }` and `readiness: 'production'`; **the chart
does not change**, because it references the track by id and expresses every note
in milliseconds from the track's own zero.

### Chart

| | |
| --- | --- |
| Id | `blobbi-dance-neon-hop-v1:normal` |
| Version | `1` (`DANCE_CHART_VERSION`) |
| Track | referenced by **id**, never by filename |
| Notes | 110 |
| Densest passage | one note per eighth note (4 per second) |
| Offset | `0` ms (chart-wide; distinct from per-device latency) |

The chart is **derived deterministically from committed source data**: 32 bar
patterns written as plain strings, one character per eighth-note slot
(`L` `D` `U` `R` `.`). Nothing is generated at run time, from a clock or from a
random source. The same input produces the same notes on every device, every run.

```ts
type DanceLane = 'left' | 'down' | 'up' | 'right';
interface DanceNote { id: string; lane: DanceLane; timeMs: number }
```

Note ids are stable and readable (`<chartId>:<bar>:<slot>:<lane>`), because the
engine resolves notes out of order and a rendered element is keyed by one.

### Validation, before the countdown

`validateDanceChart` runs on mount and Start does not exist when it fails. It
refuses:

- an unsupported `version`;
- a `trackId` with no registered track;
- an empty chart;
- duplicate note ids;
- an unknown lane;
- a negative or non-finite time;
- notes out of chronological order;
- two notes **in the same lane** less than 60 ms apart — one input cannot resolve
  both, so the second is an unavoidable miss and the chart is unwinnable;
- a note before the lead-in or inside the tail.

Two notes in *different* lanes at the same instant are a jump, not a bug, and are
allowed. Every problem is reported, not just the first.

---

## 4. Timing

**`AudioContext.currentTime` is the only clock.** It is the timebase the sound is
scheduled on, it advances in real seconds regardless of the renderer, and it
freezes when the context is suspended.

Explicitly not used as the song clock: `Date.now()` (wall time, and it can step),
`performance.now()` (monotonic but unrelated to the audio hardware, so it drifts
against the music), `requestAnimationFrame` deltas (throttled when backgrounded,
skipped under load), CSS animation events, and chained `setTimeout`s (error
accumulates at every link).

```
songTimeMs = (AudioContext.currentTime − originS) × 1000 − deviceLatencyOffsetMs
```

`requestAnimationFrame` **samples** that value and draws what it says. A dropped
frame costs a frame of animation and nothing else, because the next frame reads
the true song time. Judgement is made against the clock sampled **at the moment
the input arrives**, not against the last frame — a frame can be 16 ms stale,
which is a quarter of the Perfect window.

### The lookahead scheduler

A 25 ms `setInterval` tops the audio schedule up with everything due in the next
200 ms. This is the standard Web Audio pattern and it is not a violation of the
rule above: the timer decides *when to think about scheduling* and is allowed to
be late; every event it creates is given an explicit `AudioContext` start time
computed from the song's zero, so the sound is sample-accurate whatever the timer
did. Scheduling all ~1,100 events up front would also work, and was rejected
because it holds a thousand live nodes for the length of the song and makes a
mid-song pause much harder to unwind.

### Two different offsets

| | what it is | where it lives |
| --- | --- | --- |
| `chart.offsetMs` | the whole chart sits early/late against this track | authored, per chart |
| `getArcadeLatencyOffsetMs()` | this device plays sound late | persisted, per device |

Conflating them would mean a player's headphone calibration silently re-authored
the chart. The per-device offset is applied by the engine and is read from the
Phase 2 storage; **no calibration UI ships in this phase** (see §12).

---

## 5. Judgement, scoring, accuracy, combo, grade

### Judgement windows

Absolute offset from the note's scheduled time, early and late alike:

| Judgement | Window |
| --- | --- |
| Perfect | ≤ 60 ms |
| Good | ≤ 120 ms |
| Okay | ≤ 180 ms |
| Miss | beyond 180 ms |

The brief's starting values, kept unchanged. At 120 BPM an eighth note is 250 ms,
so the widest window stays comfortably inside one slot and a late hit can never
drift into the next note's territory.

### The five rules of judgement

1. **One input resolves at most one note.** It picks the single nearest eligible
   note in its own lane and consumes it.
2. **One note is judged at most once.** A resolved note is never eligible again.
3. **Eligibility is bounded by the widest window.** An input more than 180 ms
   from every unresolved note in its lane resolves *nothing* — it is not a miss,
   and it does not consume the next note. This is what stops early spam from
   eating the chart: mashing left destroys the combo through the notes you then
   fail to hit, not by pre-consuming notes you cannot see.
4. **Overdue notes miss on their own**, strictly past the window, with no input.
5. **An exact tie resolves to the earlier note**, deterministically.

The signed offset (negative = early) is kept on every resolved note.

### Scoring

```
points(note) = base(judgement) + min(comboBeforeThisHit, 50) × 4

  Perfect 1000   Good 700   Okay 400   Miss 0
```

The combo bonus is **additive and capped** at 200 points per note — a fifth of a
Perfect. Additive rather than multiplicative because a multiplier compounds, and
a compounding reward is one an early streak dominates. A single note can
therefore never be worth two Perfects.

### Accuracy

```
accuracy = earned BASE points ÷ (notes × 1000) × 100      (one decimal place)
```

Combo bonuses are **excluded**. Including them would mean a player who hit the
same notes with the same timing scored a different accuracy depending on the
*order* of their misses — indefensible when accuracy is what the reward tiers
read.

### Full combo

Every note hit, none missed. An Okay still counts: "full combo" means no dropped
notes, not all Perfects.

### Grades

| Grade | Accuracy |
| --- | --- |
| S | ≥ 95% |
| A | ≥ 88% |
| B | ≥ 75% |
| C | ≥ 60% |
| D | below 60% |

**The grade is presentation only.** Nothing downstream reads it — the reward
policy operates on the explicit validated metrics, because turning a letter into
money makes a presentation change an economy change.

### The result

`buildDanceResult` produces exactly one `ArcadeGameResult` per run, carrying:
total score, max possible base score, base score, accuracy, Perfect / Good /
Okay / Miss counts, max combo, total notes, full combo, completed-naturally,
duration, average absolute offset, ghost inputs, chart version, chart id (via
`difficulty` and the chart), track id, started-at and ended-at.

Two logically boolean facts (`fullCombo`, `completedNaturally`) travel as `1`/`0`
because `stats` is `Record<string, number>` by the Phase 2 contract. That costs
some legibility and buys something worth more: no change to a persisted,
validated result shape that a stored pending claim must still parse after a
refresh.

---

## 6. Reward policy

**`DANCE_REWARD_POLICY` was promoted from `draft` to `active` in this phase** —
the first and only production policy in the arcade. It was promoted only after
the result contract, its validator, the pure calculation, the aborted-run
exclusion, the claim idempotency and the writer integration all existed and were
tested.

```
policy id       blobbi-dance-tickets
policy version  1
item            31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:currency:arcade-ticket

participation (reached the end of the song)                   2
accuracy tier   ≥60% +1   ≥75% +2   ≥88% +3   ≥95% +4     ONE tier, not cumulative
full combo (every note hit)                                  +2
────────────────────────────────────────────────────────────────
maximum per run                                               8
minimum for a naturally completed valid run                   2
aborted / interrupted / invalid / incomplete run              0
```

### Worked examples

| Run | Tickets |
| --- | --- |
| 96%, full combo, finished | 2 + 4 + 2 = **8** |
| 96%, one miss, finished | 2 + 4 = **6** |
| 80%, finished | 2 + 2 = **4** |
| 61%, finished | 2 + 1 = **3** |
| 40%, finished | **2** (participation floor — the run did not clear) |
| 0%, finished | **2** |
| 100%, closed at bar 30 | **0** — an aborted run has no result at all |
| tab hidden mid-song | **0** |
| accuracy stat outside 0–100 | **0** |

### Why not `1 score = 1 ticket`

A perfect run scores over 130,000. Anything proportional to that would make one
afternoon worth more than every coin sink on the island combined, and would
reward grinding over playing well. A bounded per-run reward makes the ceiling a
product decision instead of an emergent property of a score formula.

### Why the policy is `flat`

The shared Phase 2 layer offers a difficulty multiplier and first-clear /
first-play-today / personal-best bonuses. This phase ships **no store for any of
them**: no first-clear ledger, no personal-best record, no per-day rewarded-run
counter, and exactly one difficulty. `shape: 'flat'` declares that in data rather
than feeding the shared layer a context of permanent `false`s and advertising
bonuses that can never fire.

A flat policy opts out of the multiplier and the history bonuses. It does **not**
opt out of the participation floor or the caps — those are still applied by the
one shared `calculateTicketAward`, so a flat game still cannot invent its own
economy.

### The structured calculation

`calculateArcadeReward()` is pure and **performs no writes**. It returns:

```ts
{ policyId, policyVersion, gameId, runId, itemAddress, quantity,
  eligible, ineligibleReason, components, capApplied, cap, award }
```

Eligibility is refused, in order, for: a non-production policy, a missing item
address, a rejected award (invalid result, wrong game, the game's own refusal),
and a zero total — each with a reason a human can read, because "not eligible"
with no explanation is the copy that makes players think the arcade is broken.

The item address is **passed in** rather than known by `src/arcade/`, which is
how the pure layer states an address without being able to reach an inventory.

---

## 7. The reward writer

`src/inventory/arcade-reward-writer.ts` implements the `ArcadeRewardWriter`
interface Phase 2 defined and deliberately left unimplemented.

```
read the FRESHEST kind:31633 from the relay      ← never the React cache
→ applyMutation({ type: 'add', address, amount })  ← the canonical helper
→ buildInventoryTemplate(next)                     ← the canonical builder
→ sign
→ nostr.event(…) with a 5 s timeout, STRICTLY      ← a timeout is a FAILURE
```

Every step after the read is the same code path `useInventoryMutation` uses, so a
ticket grant preserves unrelated item balances, rejects negative and non-integer
amounts, and omits zero-quantity entries exactly as every other inventory write
does. The two deliberate differences are both about honesty:

- **Strict publish.** `useNostrPublish` swallows a 5-second timeout and resolves
  — correct for presence heartbeats, wrong for a one-shot grant of a scarce
  resource. This signs and publishes locally instead, the same pattern
  `useFirstEggAdoption` already established here. `useNostrPublish` is unchanged,
  exactly as `docs/arcade-reward-publication-boundary.md` settled.
- **No optimistic update.** An optimistic balance is honest only when it is
  backed by a rollback, and there is nothing to roll a published replaceable
  event back to.

The writer refuses a non-positive or non-integer quantity, refuses without a
signed-in user, and reports a refusing signer distinctly from a refusing relay.
It never reads or writes kind:11125 coins. The Arcade **Pass** (temporary
`sessionStorage` floor access) is not an item and has no address, so it cannot be
confused with the Arcade **Ticket** by construction.

### Unknown non-item tags (limitation fixed by the economy reset)

`buildInventoryTemplate` is now LOSSLESS for data it does not own: unknown
tags, `context` tags, grant references and event `content` all ride through
every write by ANY caller — purchase, use, batch, or this one. (Historically
they were dropped; that defect was fixed in the inventory layer before the
economy-entry allocation marker could rely on surviving rewrites, and the old
destruction-pinning test became a preservation test.)

Unknown *item addresses* are likewise preserved with their quantities intact.

---

## 8. Claim idempotency

> ### The defect this section was rewritten around
>
> **A manual test produced a duplicate grant: a 3-ticket reward was added twice,
> resulting in 6 tickets.** The regression is covered by
> `src/hooks/useArcadeReward.test.tsx` →
> **`REGRESSION: the observed 3 → 6 duplicate grant`**.
>
> It was not a double-click and not a race. It was the ordinary path: the publish
> landed, the verification read had not caught up, the claim was recorded as
> `failed`, `failed` was retryable, the UI offered **"Try again"**, and the retry
> published a second additive `+3`.
>
> The earlier claim that this was safe "because the run id is the idempotency
> key: a retry re-reads the current quantity" was **wrong**. Re-reading prevents
> stale-state clobbering. It does nothing for an additive mutation — `+3` on a
> balance that already includes the first `+3` is `+6` — and `runId` appears
> nowhere in kind:31633, so no relay can know a run was paid.

### The rule

> **Anything that may have crossed the publish boundary is `ambiguous`, and an
> ambiguous claim is never republished — only reconciled, read-only.**

### The claim state machine

```
        ┌──────────── failed ◄──── pre-publish failure only
        │               │            (sign refused, no baseline, no ledger,
        ▼               │             lock held, invalid, provable rejection)
     pending ──────────►┴──► publishing ──► verifying ──► claimed  (one-way)
        ▲                        │              │            ▲
        │                        └──────┬───────┘            │ reconcile,
   retry (same runId)                   ▼                    │ read-only, only
                                    ambiguous ───────────────┘ when the balance
                                        │                      proves it
                                        └── reconcile (inconclusive) ─┐
                                        ▲                             │
                                        └─────────────────────────────┘
```

`begin-publish` is reachable **only** from `pending` and `failed`. There is no
transition from `ambiguous` to `publishing`, and its absence is the fix.

### Which statuses block a new grant

| status | blocks? | why |
| --- | --- | --- |
| `claimed` | yes | it was paid |
| `publishing` | yes | a write is in flight, here or in another tab |
| `verifying` | yes | a write completed and is being checked |
| `ambiguous` | yes | a write **may** have completed and cannot be proven either way |
| `pending` | no | recorded, nothing sent |
| `failed` | no | provably pre-publication |

### Reconciliation

An unresolved claim's only action is a **read-only** check. It re-reads the
inventory and compares it against the `quantityBefore` recorded before the
attempt:

- `now >= baseline + award` → **confirmed**.
- anything else, including an unreadable inventory → **stays unresolved**, the
  attempt is counted, nothing is published.

#### The `>=` rule is a conservative inference, not proof

It does **not** prove that our specific event landed. It proves only that the
balance is at least as high as it would be if it had. The known false positive:

```
baseline 10 · Dance reward 3 · the Dance publish never landed
an unrelated, legitimate operation adds 5 → balance 15
15 >= 10 + 3  →  the claim is CONFIRMED, and the 3 tickets are never paid
```

The player is under-paid by 3. That is accepted for this phase, deliberately:

- the alternative rule (`===`, or refusing to confirm without stronger evidence)
  does not pay the player either — it just leaves the claim unresolved for ever;
- the only rule that *would* pay them is "publish again when in doubt", which is
  precisely the 3 → 6 duplicate this whole design exists to prevent;
- so the choice is between **occasionally under-paying one player** and
  **inflating a scarce currency**, and this phase picks the first.

Fixing it properly needs per-event attribution — knowing that *this* grant is in
that balance. kind:31633 cannot express that without inventing per-operation
tags other clients would not understand (the builder now preserves unknown tags,
but a tag convention nobody else reads is still not attribution), which is
explicitly out of scope. It is recorded, not hidden: see
`src/hooks/useArcadeReward.test.tsx` → *"the >= baseline + award inference,
recorded deliberately"*, which asserts the false positive on purpose so nobody
"fixes" it into a republish.

There is deliberately no branch that republishes: a read that cannot prove the
grant landed also cannot prove it did not.

A claim whose **baseline read failed never publishes at all** — without a
baseline there is nothing to reconcile against, so the attempt is cancelled and
marked retryable instead of becoming permanently unresolvable.

### Retryable versus reconciliation-only

| failure | retryable? |
| --- | --- |
| `invalid-claim` (validation, wrong run, not logged in) | yes |
| `lock-unavailable` (another tab holds the claim) | yes |
| `ledger-unavailable` (no durable record could be written) | yes |
| `baseline-unavailable` (the pre-write read failed) | yes |
| `sign-failed` (the signer refused before returning an event) | yes |
| `publish-rejected` — **only** from a writer that can prove it | yes |
| `publish-timeout` | **no** |
| `verify-mismatch` | **no** |
| `verify-unavailable` | **no** |
| anything unrecognised | **no** |

The default for an unclassified error is the unsafe-to-retry side.

**"All relays rejected" is not provable with this client.** `NPool.event` is
`Promise.any` over the relays and surfaces no per-relay breakdown; `NRelay1`
throws an indistinguishable plain `Error` for an `OK false` and for a socket that
died after the frame went out. So an unrecognised publish rejection becomes
unresolved. The cost is a claim stuck unresolved when the player was merely
offline; the alternative cost is paying twice.

### Exactly what is protected, by scope

| scope | guarantee | mechanism |
| --- | --- | --- |
| same component | one publish per run | React state + the lifecycle reducer |
| **same document** — every mount, every hook instance, two clicks in one tick | one publish per run | a synchronous module-level `Set`, taken before any `await` |
| **same browser profile, after the first ledger write** | no second grant while a record is claimed / publishing / verifying / ambiguous | the `localStorage` ledger, checked before every attempt and again inside the lock |
| **across tabs**, for the whole check → persist → publish → verify window | one owner | `navigator.locks` where available; a verified `localStorage` lease otherwise |
| **after a refresh** | an ambiguous or claimed run stays blocked, and the results screen hydrates from the ledger rather than offering a fresh Claim button | the ledger is durable |
| **across devices** | **none** | — |
| **protocol level** | **none** | — |

### What is NOT protected, stated plainly

- **Cross-device: nothing.** A different browser or device starts with an empty
  ledger. The exposure is bounded — a `runId` is minted per run and never leaves
  the device that minted it, so another device has no run id to re-claim — but
  that is an obstacle, not a guarantee.
- **Protocol level: nothing.** Recording "run X has been paid" in kind:31633
  would mean inventing a per-run tag convention other clients do not read (the
  builder preserves unknown tags now, but preservation is not attribution).
  Rejected deliberately for per-run rewards; documented instead. The ONE
  protocol-level record of this shape that does exist is the economy-entry
  allocation marker — viable precisely because it is a single per-account fact,
  not an unbounded per-run history.
- **Two tabs racing before either has written to the ledger.** Excluded by the
  cross-tab lock. Where the Web Locks API exists that exclusion is real and
  atomic — **verified in Chrome across two genuine tabs**: tab B saw tab A's
  lock in `navigator.locks.query()`, was refused (`acquired: false`), and did not
  run the operation. Where Web Locks does not exist, the `localStorage` lease is a
  write-then-read-back protocol — strong in practice, but **not** an atomic
  compare-and-swap. Two tabs writing within the same millisecond could both
  believe they own it. That residual window is a limitation and no copy anywhere
  describes it otherwise.

  Test coverage splits along the same line: jsdom has no Web Locks, so the
  automated suite exercises the **lease fallback** (the weaker path, and the one
  worth pinning); the Web Locks path is covered by the browser verification
  above.
- **A player who edits or copies `localStorage`.** The same class of
  client-authored-state problem the audit already declares unfixable client-side.

### Durable storage is a prerequisite

The sequence is:

```
validate → same-document lock → cross-tab lock → ledger check
  → persist the record AND READ IT BACK  ← publish nothing if this fails
  → baseline read                        ← publish nothing if this fails
  → publish → verify
```

`persistClaim` verifies its own write by reading it back with the expected
status, because storage can accept a `setItem` and silently drop it (quota
eviction, private mode, an extension). A claim record that is not really there is
exactly the state that lets a grant be offered a second time — so **no durable
record means no publication**, and the player is told so.

---

## 9. Publish and verification semantics

```
eligible calculation
  → synchronous same-document lock on (pubkey, runId)
  → cross-tab lock: blobbi-arcade-claim:<pubkey>:<runId>
  → durable ledger check (4 blocking statuses)
  → createPendingClaim(), persisted and READ BACK before anything is sent
  → readTicketQuantity()                     ← the baseline; null cancels the publish
  → strict publish (a timeout is UNRESOLVED, not a failure)
  → readTicketQuantity()                     ← the verification
  → confirm ONLY if after − baseline === the awarded amount
```

### What a confirmed claim proves

In order: the signer produced a signed kind:31633 event; `NPool.event` resolved,
which means **at least one configured relay accepted it** (the pool rejects only
when every relay fails); and a subsequent independent read showed the ticket
quantity exactly `award` higher than the baseline.

### What it does not prove

That every relay has it. That it will still be there tomorrow. That no concurrent
writer will replace it — kind:31633 is replaceable and newest-wins, and
`docs/INVENTORY_ARCHITECTURE.md` documents that two tabs can still clobber one
another.

### The states the UI distinguishes

| Phase | What the player is told | What the button does |
| --- | --- | --- |
| calculation unavailable | tickets could not be worked out; the score still stands | — |
| not eligible | the reason, in words | — |
| ready | "Claim N tickets" — never "you have them" | claim |
| saving | "Saving your tickets…" | out of action |
| **confirmed** | "N Arcade Tickets added to your inventory" | — |
| **failed-before-publish** | nothing was saved; try again | claim again |
| **unresolved** | "The ticket event may have been sent, but your inventory has not confirmed it yet. To avoid adding the reward twice, Blobbi Island will not send another grant for this run. You can check the status again." | **Check ticket status** — read-only |
| **checking** | "Checking…" | out of action |
| already claimed | this run was paid, on this browser | — |

Two things must never appear: a confirmed balance increase the application cannot
substantiate, and a **"Try again" button on an unresolved claim**. The second is
not a wording problem — it is the duplicate grant.

Policy identity (`blobbi-dance-tickets v1`) is protocol trivia and is no longer
shown to players; it remains available in the DEV harness.

### Concurrency

The write base is always a fresh relay read taken immediately before building the
event, never the React Query cache. The baseline is read separately and recorded
durably, so a concurrent write landing between the two reads produces an
unresolved claim rather than a silent acceptance — and reconciliation can still
confirm it later once the balance settles.

## 10. Interruption behaviour

| Event | What happens |
| --- | --- |
| Tab hidden (`visibilitychange`) | **run ABORTS** (`interrupted`) |
| Window blur (tab still visible) | run **pauses**; explicit Resume continues it |
| Pause button | run **pauses**; audio stops, the clock freezes, the position is kept |
| Resume button | the engine re-anchors to the current audio time and continues |
| Shell closed mid-run | run aborts (`closed`) via the reducer |
| Component unmounts | frame loop cancelled, engine stopped and disposed |
| Web Audio unavailable | **no run is started at all** — the preview says why |
| Chart invalid | **no run is started at all** — the preview says why |

**An aborted run has no result**, so it cannot become claimable, cannot calculate
a production reward, and cannot publish anything. The reducer enforces this
structurally (`abort` clears the result; `claim` is only legal from `results`),
and the dance policy refuses a result whose `completedNaturally` is 0 as defence
in depth against a hand-built or restored one. A retry after an abort is a new
run with a new id.

### Why hidden aborts but blur only pauses

Phase 2's `useArcadeInterruption` treated both signals as a pause. Phase 3's
first browser session showed they are not the same event, and the hook now
reports **which** one fired so the game can decide:

- **Hidden is unrecoverable.** `requestAnimationFrame` is throttled to a stop
  while `AudioContext.currentTime` keeps advancing, so a run left alone in a
  background tab silently accumulates misses the player never had a chance to
  answer. Aborting is the safe outcome, and it has a decisive advantage: an
  aborted run has no result, so it cannot be claimed, rewarded, or argued about.
- **Blur is not.** The tab is still visible and still rendering; the notes are on
  screen and the music is playing. Ending a sixty-eight second run because
  someone clicked a devtools panel, a second monitor, or dismissed a phone
  keyboard is hostile — and pausing costs nothing, because the engine re-anchors
  to the current audio time on resume rather than trusting the clock to have
  frozen.

The first implementation aborted on both. It was changed after the automated
browser demonstrated how readily a real page loses focus. The trade this phase
made — a safe abort over a complex mid-song resume — still holds for the case
that genuinely cannot be resumed.

---

## 11. Accessibility and reduced motion

- **Keyboard play** through arrows and WASD; **touch play** through four large
  buttons that share the same action pipeline.
- Every lane button has a name that includes its keys — "Left lane (← or A)" —
  and a visible focus outline. They are `disabled` outside `playing`.
- The dialog has a title and a description; focus moves into it on open and
  returns to the machine on close.
- **Colour is never the only signal.** Each lane carries its arrow glyph, and the
  judgement readout is a *word* ("Perfect!", "Miss") that colour only reinforces.
- **The results summary is a sentence**, in a `role="status"` region, before the
  table it duplicates — readable without chasing a transient animation.
- **Live regions are restrained.** One polite region announces "Get ready",
  "Paused", "The run ended because the game lost focus", and the final summary.
  Notes are **never** announced; a live region narrating 110 notes would make the
  game unusable.
- Notes, receptors, lane guides and the score glyphs are `aria-hidden`; only the
  score number carries a screen-reader label.
- **No rapid full-screen flashes.** The judgement readout is a small centred word;
  the countdown is a static number over a dim overlay.

Added in Phase 3.2:

- **A second non-colour cue per lane.** Each touch control shows its arrow *and*
  its key cap (`A` / `S` / `W` / `D`). At 320 px two arrows a centimetre apart
  start to look alike, and colour is decoration in this game — the arrow and the
  letter are the information.
- **The Blobbi on stage is inert.** It is `aria-hidden`, `pointer-events-none`,
  contains nothing focusable, and is rendered outside the note field, so it can
  neither swallow a lane press nor cover a note.
- **The reward panel carries a status chip** as well as its message, and the chip
  vocabulary is deliberately non-committal: an unresolved claim reads "Not
  confirmed", never anything that could be mistaken for "saved".
- **Both reward actions declare `min-h-[44px]`**, so a long translation cannot
  squeeze a claim button below a comfortable touch target.
- **A mute control**, with `aria-pressed` carrying the state as well as the icon.
  It is a volume decision only: the `AudioContext` keeps running and the clock
  every judgement is made against is untouched.

### Reduced motion

`prefers-reduced-motion: reduce` removes every decoration added in Phase 3.2 —
the marquee bulbs, the judgement pop, the receptor pulse and its sparks, the lane
flash, the countdown tick, the combo bump and the mascot's bob and reactions —
along with the receptor colour transitions, the touch-button press scale and the
shell's entrance zoom.

It does **not** remove anything that carries information: the notes still move
(that is the gameplay, not a flourish), the judgement word still appears in the
same place, the receptors still light up while a lane is held, the combo still
grows, and the mascot's `data-mood` still changes. And it changes **no timing at
all** — a note is due when the audio clock says it is, and the accessibility
setting has no vote. `DanceUI.test.tsx` asserts exactly that: the same input
produces the same judgement and the same blip with every animation suppressed.

Suppression is belt and braces: the components omit the animation classes when
`useReducedMotion()` is true, *and* a `@media (prefers-reduced-motion: reduce)`
block in `src/index.css` disables the same animations by name. The stage exposes
`data-reduced-motion` so the state is inspectable.

---

## 12. Performance and render strategy

A rhythm game updates sixty times a second. React state updated sixty times a
second re-renders a tree sixty times a second, and the input handler then
competes with reconciliation for the main thread — which shows up as exactly the
thing a rhythm game may not have: input lag.

State is therefore split by frequency:

| What | Where | How often |
| --- | --- | --- |
| song time | `AudioContext.currentTime`, read per frame | 60 Hz |
| note positions | `element.style.transform` (`translate3d`) | 60 Hz |
| score, combo, progress, judgement | `textContent` / `style` | 60 Hz |
| which notes are on screen | React state | ~2 Hz, only when the set changes |
| lifecycle status | React state (the shared reducer) | a few times a run |

The run state lives in a ref and is advanced through the **pure** reducer
functions in `judgment.ts`, so the rules stay pure and stay tested by passing
numbers while the storage is a ref no re-render depends on. The rendered note
window is bounded — only notes within 1.6 s of the receptors exist as elements,
about a dozen at a time, never the whole 110-note chart.

**Canvas was considered and rejected:** a dozen elements is nowhere near a DOM
bottleneck, and a canvas would cost the focus outlines, the text scaling and the
screen-reader story that come free with elements.

### What the Phase 3.2 decorations cost

Every effect added in the polish pass obeys the same split, and none of them
queues a React render:

| Effect | Mechanism | Frequency |
| --- | --- | --- |
| judgement pop | one `className` write on a node React does not own | per judgement (≤ ~8/s) |
| receptor pulse + sparks | one class toggle on a static child | per hit |
| lane flash | one class toggle on a static overlay | per hit or miss |
| combo tier + bump | one `className` write, **only when the tier changes** | a few times a run |
| field emphasis ring | `classList` add/remove, same guard | a few times a run |
| mascot mood | one `setAttribute('data-mood', …)`; CSS does the rest | per judgement |
| mascot bob, marquee bulbs | pure CSS, duration from `--dance-beat` | never touched by JS |

Only `transform`, `opacity` and `box-shadow` are animated, so the compositor owns
every tween. Nothing is appended to the DOM on a hit: the sparks are five static
spans rendered once per receptor and replayed by a class, which is the difference
between a bounded decoration and a particle system that can eat a frame budget.

Two deliberate costs, both bounded:

1. **One forced reflow per judgement.** Restarting a CSS animation that is already
   running requires removing the class, reading layout, and re-adding it. That is
   a handful of reads a second, never one per frame — and it is skipped entirely
   under reduced motion.
2. **A layout measurement on resize and on phase change**, never inside the frame
   loop, to work out how far a note travels.

### Paint order inside the field

The field is one stacking context, so DOM order is the z-order. It is, deliberately:

```
lane rails → judgement readout → notes → receptors → countdown
```

The readout sits **below the notes**. A judgement is 420 ms of feedback; a note
is the thing the player is aiming at, and a note hidden behind a word is a note
that gets missed. The cost is that a note crossing the readout covers part of the
word — acceptable, because the word keeps its colour, its size and its position,
and the player's eye is at the judgement line rather than at mid-field when it
appears.

### One drawing bug fixed

Notes were positioned by `progress × fieldHeight` with the note's **top** edge on
that point, while the receptors sat in a padded row above the field's bottom
edge. At the moment a note was due, its token was therefore a full receptor-height
*below* the ring it was supposed to land in — the picture disagreed with the
clock by about 34 px at desktop size, measured in the browser.

The fix is presentation-only and is worth stating precisely, because it is the
one change in this pass that touched anything near the engine:

- `noteProgress()` and `isNoteVisible()` in `dance-visuals.ts` are **unchanged**;
- no note time, judgement window, audio origin or result value moved;
- the component now measures the receptor row's **centre** (`travelRef`) and
  draws each note as a zero-size point with the visible token centred on it, so
  `progress === 1` puts the token's centre exactly on the receptor's centre.

The judgement line moved inside the receptor row for the same reason: it was
offset from the field's bottom edge and drifted above the targets at small sizes.
It is now centred on the row, which is correct at every size by construction.

---

## 13. The DEV harness

`/dev/arcade` (`src/pages/DevArcade.tsx`), still behind `import.meta.env.DEV`, so
the chunk is never emitted in a build — `src/dev-routes.test.ts` proves it at
both source and artifact level.

Phase 3 additions, under **Blobbi Dance** and **Fake reward writer**:

| Control | What it does |
| --- | --- |
| `open dance machine` | mounts the REAL `DanceMachine` — real chart, real judgement, real lifecycle, real claim boundary |
| `chart: valid / invalid` | swaps in a deliberately broken chart to see the error state |
| `reduced motion: on / off` | forces `prefers-reduced-motion` for this tab and remounts |
| `confirm / reject / timeout / verify-mismatch / verify-unreadable / lagging-relay` | picks the fake writer's behaviour |
| `clear claim ledger` | wipes the `localStorage` claim record |
| writer log | the last few `publishTicketGrant` / `readTicketQuantity` calls |

Phase 3.2 additions, all of them there because the states they show are otherwise
either 68 seconds away or 420 milliseconds long:

| Control | What it does |
| --- | --- |
| `hide ▾ / show ▴` | collapses the panel, which is 45 vh tall and was covering the bottom half of the very screen it drives |
| `flawless / decent / scrappy / dud (0 tickets)` | dispatches a REAL `finish` with a hand-built result, so the results screen renders from the production reward policy without playing the song. `dud` is the zero-ticket case — `completedNaturally: 0`, refused by the policy's own rule |
| `already-claimed` | seeds the durable claim ledger before the machine hydrates it, the only way to reach that phase without publishing. Needs a signed-in browser (the ledger is keyed by owner) and says so when there isn't one |
| `320×568 / 375×667 / 390×844 / 768×1024` | shell-box presets for the viewport audit |
| `presentation gallery` | every judgement readout, every combo tier, the note / receptor / touch treatments and all four mascot moods, side by side and standing still |

The gallery renders from the **same helpers the live renderer calls** —
`judgmentReadoutClass`, `comboTier`, `DANCE_LANE_VISUALS` — so what a reviewer
compares there is what a player sees mid-song. It has a `replay pop` button
because the live readout's animation ends at `opacity: 0`: it is meant to vanish,
which makes the animated form useless for side-by-side comparison.

**Neither the panel nor the gallery can leak into production.** The whole module
is behind `import.meta.env.DEV`, nothing in `src/components/blobbi/arcade/`
imports it, and `src/dev-routes.test.ts` proves the chunk is absent from a build.
`showDebugDetails` — which is what puts `Policy blobbi-dance-tickets v1` on the
results screen — is passed only by this harness and defaults to `false`.

**It publishes nothing.** The fake `ArcadeRewardWriter` replaces the only
component that could, so every claim outcome — including the two that must never
be reported as success — is reachable with no key, no relay and no published
event. Walking the Blobbi to the dance machine in the world below opens the real
machine with the real writer; that still publishes nothing, because the harness
has no signed-in user and the claim path refuses before it sends anything.

The harness still **never fakes a playable game for a machine whose `gameId` is
`null`** — the lifecycle fixtures leave a coming-soon cabinet in `preview` and
say why, because the reducer genuinely refuses to start a run without a game id.

The viewport presets constrain the **box** only; CSS media queries still evaluate
at the real window width, so a `sm:` rule does not switch off just because the box
is 320 px wide. That makes them a *conservative* check — the shell is drawn with
the roomier desktop paddings and type sizes inside the smaller box, so anything
that fits under a preset also fits on the real device. Genuine breakpoint checks
still need device emulation, and the harness says so rather than proving less
than it appears to.

---

## 14. Presentation and visual design (Phase 3.2)

Phase 3 shipped a game that worked and looked like the developer prototype it
was: a grey bordered box of coloured squares on the shell's cream background,
with the tuning table printed on the start screen. Phase 3.2 is a presentation
pass over the same game. **No rule changed** — not the chart, not a judgement
window, not the scoring, not the reward policy, not the claim boundary, and not
one Nostr event.

### The direction

A **cozy neon cabinet**. The island's cream-and-wood palette forms the machine —
a marquee with blinking bulbs, a wood-toned bezel, soft depth from flat drop
shadows — and the playfield inside it is a deep violet screen with neon lane
accents. Rounded forms, chunky arcade tokens, expressive but restrained feedback,
and nothing that reads as a slot machine.

It is deliberately **not a picture of a cabinet**: no side art, no coin slot, no
image asset of any kind. The whole frame is four borders, a gradient and a row of
CSS dots, because on a 320 px phone every pixel spent drawing a machine is a pixel
taken from the lanes. The frame's job is to focus attention on the playfield.

### Screen by screen

| Screen | Before | After |
| --- | --- | --- |
| **Start** | a badge, a title, a two-column control table, and three paragraphs — judgement windows in milliseconds, the full ticket formula (participation, every accuracy tier, the full-combo bonus, the per-run cap), and the audio notice | a marquee with the Blobbi and the song title, one plain-language objective sentence, the duration, a control diagram showing each lane's coloured button with its name and keys, one line naming *both* input methods, and two short honest notes: tickets are earned by finishing and by playing well, and the audio is a placeholder |
| **Playfield** | a grey rounded box, thin lane dividers, 36 px coloured squares, a dashed line, a bare score/combo row | a cabinet with a bulb-lit marquee (song, mascot, mute, progress), a violet highway with four tinted rails, layered arcade tokens with a lift shadow, a bright judgement line running through the receptors, and a HUD of exactly two live numbers |
| **Feedback** | a coloured word that appeared and disappeared | the word pops and drifts, the hit receptor pulses a ring and throws five sparks, the lane flashes, the Blobbi reacts, and a long combo scales up and rings the field |
| **Countdown** | a bare number over a dim overlay | "Get ready" over `• · 3 · 2 · 1 · Go!`, each tick popping in on its own beat |
| **Results** | a grade box, a percentage, and a six-row two-column table of labels | a celebration card — grade, a sentence that says what the grade *means*, the score, a full-combo star — then two metric tiles, four colour-coded judgement counts, and a ticket panel with the earned quantity as the headline and a status chip |

### Combo, without moving the playfield

The combo lives in a **fixed 96 × 32 box** and grows by scaling its contents
through five tiers (`none → start → hot → blazing → unreal`, thresholds 0 / 2 /
10 / 20 / 40). The top two tiers add a soft ring around the field. Nothing
reflows: a counter that resized the HUD would move the lanes under the player's
hands at the exact moment they were doing well.

### The Blobbi on stage

`MascotBlobbi` — the existing standalone SVG mascot, no hooks, no Nostr, no
position system — rendered small in the marquee. It bobs on the beat (the CSS
duration is `--dance-beat`, set once per run from the track's tempo) and reacts
to Perfect / Good / Miss through a `data-mood` attribute the frame loop writes.

The player's own Blobbi was considered and rejected: `MovableBlobbi` is wired to
the world's position system, the gaze tracker, the accessory overlay, the
multiplayer layer and a live Nostr query, and dragging all of that into a rhythm
game's frame budget to make a character wave is not a trade worth making. A small
decorative mascot is what the brief asks for and what ships.

### Sound

A **mute toggle**, in the marquee during play and on the start screen before it.
The storage (`blobbi:arcade:audio-muted`) and the engine hook
(`DanceAudioEngine.setMuted`) both shipped in earlier phases and had simply never
been given a control. **This adds the control, not the capability.** There is no
volume slider: that would need a new persisted setting, a new engine parameter
and a migration, none of which exist.

**The track is still the synthesised placeholder** — `readiness: 'development'`,
generated in the browser from code in this repository, no asset and no licence to
clear. Nothing in this pass changed the audio, the schedule, or the timing model.

### What moved out of the player's way

- The **reward formula** is no longer on the start screen. The two facts a player
  needs are there in words ("finish to earn some, dance accurately to earn more",
  "leaving early earns nothing"); the arithmetic appears at the results, where it
  describes something that actually happened.
- The **judgement windows in milliseconds** are gone from the player's view
  entirely. They remain in `DANCE_JUDGMENT_WINDOWS` and in this document.
- **Policy identity** (`blobbi-dance-tickets v1`) stays behind `showDebugDetails`,
  which only the DEV harness passes.

### Responsive behaviour

The shell is already full-viewport on phones (`w-screen h-[100dvh]`, `dvh` so
browser chrome cannot crop the controls) and a panel from `sm:` up. On top of
that:

- a live run gets `overflow-hidden` on the shell's content area, so a stray drag
  cannot scroll the lanes off screen mid-song. Every other state keeps normal
  scrolling, because a results panel at 320 × 568 genuinely needs it;
- the lane controls carry `touch-action: none`, `user-select: none` and
  `-webkit-tap-highlight-color: transparent`, scoped to the buttons — the rest of
  the document scrolls normally;
- the shell footer and the lane strip respect `env(safe-area-inset-bottom)`;
- the field re-measures its note travel on `resize`, which covers orientation
  changes and a mobile browser collapsing its URL bar.

Measured in Chrome with the shell box constrained to 320 × 568 (see §13 for what
that does and does not prove): no horizontal overflow anywhere in the document or
the content area, a 264 × 221 CSS px playfield, 60 × 56 px lane buttons, and the
touch strip fully inside the shell. Landscape phone is usable but cramped — the
marquee and the lane strip leave little height for the highway — and portrait is
the supported orientation.

---

## 15. Known limitations

1. **The track is a placeholder.** `readiness: 'development'`. Replacing it is a
   new `DanceTrack` record and no chart change.
2. **No latency-calibration UI.** The per-device offset is read and applied, and
   Phase 2's storage exists, but nothing lets a player set it. On Bluetooth
   headphones the game will feel late until they can.
3. **Backgrounding the tab loses a run.** Deliberate (§10). A blur no longer
   does, but a phone that backgrounds the browser mid-song still costs the run.
   The alternative — a freeze-and-confirm screen on return — was judged more
   complex than the first version of this game should carry.
4. **Claim idempotency is per browser profile**, not cross-device and not
   protocol-level (§8). With the `localStorage` lease fallback (no Web Locks),
   two tabs writing in the same millisecond is a residual window.
5. **An unresolved claim can stay unresolved.** If the player was offline, or a
   relay never propagates the write, reconciliation will never see the balance
   move and the tickets are never granted. This is deliberate — the alternative
   is paying twice — but it is a real cost, and there is no in-app way to force
   the grant.
6. **kind:31633 unknown non-item tags are not preserved** by the canonical
   builder (§7). Pre-existing, pinned by a test.
7. **Two tabs can still clobber one inventory.** Newest-wins on a replaceable
   event; the ledger limits double-payment, not concurrent overwrite.
8. **No anti-cheat.** A client-authored score cannot be verified client-side. The
   economy is designed so cheating is boring (a bounded 8 tickets per run, no
   transfers) rather than pretending it is prevented.
9. **One song, one difficulty, no high scores, no leaderboard.** All out of scope.
10. **Movement blockers around cabinets are still absent**, so a Blobbi can walk
   through the dance machine.
11. **Real-browser audio was verified by hand, not by an automated test.** jsdom
    has no `AudioContext`; the component tests drive a scriptable fake engine, so
    the *rules* are covered and the *sound* is not.
12. **A visible tab whose `requestAnimationFrame` is starved freezes the field
    while the music plays on.** The abort in §10 fires on `hidden`, not on
    "rendering has stopped", so a heavily loaded or occluded window can produce a
    stalled-looking run that is still accumulating misses. A frame-gap watchdog
    would fix it; it is not in this phase because it could not be exercised in
    the automated browser (which starves rAF unconditionally) and an unverified
    watchdog that fires spuriously would be worse than the problem.

### Visual limitations remaining after Phase 3.2

13. **The mascot is a mascot, not the player's Blobbi.** It is the standalone
    purple `MascotBlobbi`, identical for everyone. Showing the player's own
    Blobbi would mean either mounting `MovableBlobbi` (and its position system,
    gaze tracker, accessory overlay and live query) inside a rhythm game, or
    building a second, lighter renderer for the same artwork. Neither belongs in
    a polish pass.
14. **The mascot's expression is a bubble, not a face.** Perfect / Good / Miss
    change a small emoji and a hop; the artwork itself does not change pose.
    Frame-by-frame or skeletal character animation was explicitly out of scope.
15. **Landscape phone is cramped.** Portrait is the supported orientation; in
    landscape the marquee and the lane strip leave little height for the highway.
    A landscape layout that moved the lane controls to the sides would be a real
    improvement and is deferred.
16. **The countdown reads `• 3 2 1 Go!`, not `3 2 1 Go!`.** The track's lead-in is
    four beats, so there is one tick before the three-count; it shows a dot rather
    than a "4". Making it a true three-count would mean changing `leadInMs`, which
    is a track property every note time is written against — a timing change for a
    cosmetic gain, which the brief rules out.
17. **Narrow-viewport checks were made with the shell box constrained, not with a
    320 px viewport.** Chrome on macOS will not open a window that narrow, so
    `sm:` rules were still active during the audit (§13 explains why this is
    conservative rather than optimistic). A real 320 px device has not been
    tested by hand.
18. **The reward breakdown is still a single "Clear +8" line.** The dance policy's
    `base` is one number, so the shared calculator has one line to show. Splitting
    it into participation / accuracy / full-combo lines would be a reward-policy
    change, which this pass may not make.
19. **No hit-error meter, no per-note timing feedback beyond the judgement word,
    and no lane-specific accuracy.** All deferred.
20. **A note crossing the judgement readout covers part of the word.** Notes paint
    above it on purpose (see §12); the alternative — feedback covering a target —
    is worse. Any in-field position for the readout is crossed by notes, so the
    only real fix is moving it out of the field, which costs it the player's
    eyeline.
21. **The mount-time note measurement is taken while the shell is still zooming
    in**, so it is a few per cent short for the length of the countdown. Nothing
    is due then (the first note is at the end of the lead-in) and the phase
    change into `playing` re-measures, so it is not visible in play — but it does
    mean the geometry is briefly wrong rather than briefly absent.
22. **A viewport change that fires neither `resize` nor `orientationchange` is
    not caught.** In practice both fire for window resizes, orientation changes
    and mobile URL-bar collapse; a `visualViewport`-only change (some in-app
    browsers) would leave the note travel stale until the next phase change.

### Deliberately deferred

Latency calibration UI, a second track or chart, multiple difficulties, a hit
score display during play, high scores, a landscape layout, real music, character
pose animation, and any decoration that would need an image asset.

---

## 16. What the next phase should implement

> **Phase 4 shipped, with one scope correction.** The catalogue described below
> exists — `docs/arcade-catalogue.md` — but it belongs to the **six generic
> cabinets only**. Blobbi Dance, Pool and Air Hockey are dedicated machines and
> are not in it; the dance machine opens this game directly. What remains from
> this section is the **Guest Game Runtime**, deliberately split out and now
> Phase 5.

**Phase 4 — the Shared Arcade Catalogue.** *(delivered, for generic cabinets)*

Today every cabinet is either Blobbi Dance or an honest "coming soon" panel, and
the only way to reach a game is to know which cabinet it lives on. The next phase
makes **every GENERIC arcade cabinet open the same catalogue**, so an
interchangeable cabinet becomes a door into the arcade's content rather than a
dead screen. Machines that ARE a specific physical game — the dance pad, the pool
table, the air hockey table — keep their own experience.

The catalogue separates two kinds of content, and the separation is the point:

1. **Island Games**
   - integrated with the Island;
   - may produce validated results;
   - may grant Arcade Tickets;
   - **Blobbi Dance is the first one**, and everything this document describes —
     the lifecycle reducer, the result contract, the reward policy and the claim
     boundary — is what an Island Game is *made of*.

2. **Guest Games**
   - curated external HTML5 / WebXDC packages;
   - initially only from the official Blobbi issuer;
   - **no signer, no inventory, no coins and no Arcade Tickets**;
   - executed later, through a Blobbi-owned restricted runtime.

The catalogue phase must define discovery, presentation, categories,
availability, controls, ticket labels and the launch lifecycle. **It must not yet
execute untrusted packages** — a Guest Game entry in the catalogue is a listing,
not a running program, until the runtime exists.

The secure **Guest Game Runtime** follows in a separate phase. Splitting it out
is deliberate: the catalogue is a presentation and data problem, the runtime is a
sandboxing and capability problem, and shipping them together would mean
reviewing both under whichever deadline the first one sets.

**The Prize Shop remains deferred** until the arcade has more content and more
earning sources. It is still the thing that makes a ticket worth having, and the
pieces it will need already exist — the canonical ticket address, the balance
read, and a `PRIZES` counter with an honest coming-soon state already wired to
the shell — but a shop stocked from a single 8-tickets-per-run source is a
smaller product than a shop stocked from an arcade.

Deliberately after all of that, not before: latency calibration, a second chart,
a second machine, and any leaderboard.
