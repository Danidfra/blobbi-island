# Blobbi Island — Arcade Foundation (Phase 2)

Status: implemented, and now **built on**. This document describes the shared
technical foundation every arcade game uses, as it was designed in Phase 2 and as
Phase 3 actually consumed it.

> **Superseded in places by Phase 3.** When it shipped, this document could say
> "no game is playable and no Arcade Ticket is granted". Both are now false:
> `arcade-dance-machine` runs a real rhythm game and the arcade grants tickets
> through one audited path. Sections 8, 9 and 13 carry inline notes where Phase 3
> changed or completed what they describe; **[`docs/blobbi-dance.md`](./blobbi-dance.md)**
> is the current word on the game, the reward policy and the claim semantics.

It is the follow-up to `docs/arcade-audit.md`, which found that the arcade had no
games and — more importantly — told the player it did: nine machines, including a
pool table and an air hockey table, all opened one modal titled "Dance Dance
Blobbi".

---

## 1. Architecture, before and after

### Before

```
InteractiveElements.tsx  (1549 lines, 12 sequential location branches)
└── arcade branch (285 lines)
    ├── 9 × InteractiveElement → handleElementClick('dance-machine')  ← all nine
    ├── 4 × chair (two byte-identical table groups, 2 alt values)
    ├── ticket counter, PRIZES counter (console.log only), microphone (dead)
    ├── 30 decorative sprites, every one alt="ticket counter"
    ├── elevator (z-10, ties with the Blobbi's depth band)
    └── ArcadePassModal / ElevatorModal / NoPassModal / GameModal
        └── GameModal: a plain `absolute inset-0` div INSIDE the scaled world
```

### After

```
InteractiveElements.tsx  (delegates; the arcade branch is now 20 lines)
└── arcade/ArcadeRoom.tsx
    ├── arcade/ArcadeMachine.tsx    × 9, from src/lib/arcade-machines-config.ts
    ├── arcade/ArcadeGameShell.tsx  Radix Dialog → portals OUT of the world
    │   └── arcade/ArcadeMachinePanel.tsx  honest preview / coming-soon
    ├── elevator, counters, chairs, decoration — all from config
    └── arcade/arcade-machine-state.ts  (pure lifecycle reducer)

src/arcade/                      pure, no React / Nostr / inventory
├── types.ts                     ArcadeGameResult + validation
├── arcade-machine-state.ts      the lifecycle reducer
├── reward-policy.ts             ticket arithmetic (calculates, never grants)
├── arcade-reward-boundary.ts    the write contract Phase 3 must implement
├── arcade-input-map.ts          key → action, no React
├── useArcadeInput.ts            listener wrapper
├── useArcadeInterruption.ts     pause on hide / blur
└── audio/arcade-audio.ts        AudioContext boundary, mute, latency offset
```

Supporting: `src/hooks/useReducedMotion.ts` (the repo's first
`prefers-reduced-motion` support), `src/lib/arcade-pass.ts` (pass lifecycle),
`src/hooks/useCancelInteractionOnWorldClick.ts` (extracted so the arcade's own
pending-interaction instance behaves identically to every other room).

---

## 2. The machine registry

`src/lib/arcade-machines-config.ts` — one record per machine.

> **Superseded in part by Phase 4.** `gameId`, `availability` and `blurb` were
> removed from this record and replaced by ONE discriminated field, `activation`,
> which says whether a machine opens the shared cabinet catalogue, launches one
> specific game, or shows one specific game's coming-soon screen. Six generic
> cabinets take the first; the dance machine, the pool table and the air hockey
> table are dedicated machines and now all three take `dedicated-game`. See
> `docs/arcade-catalogue.md` §2.

| id | floor | display name | activation |
| --- | --- | --- | --- |
| `arcade-dance-machine` | basement | Blobbi Dance Machine | dedicated-game → `blobbi-dance` |
| `arcade-pool-table` | floor-1 | Pool Table | dedicated-game → `blobbi-pool` |
| `arcade-air-hockey` | floor-1 | Air Hockey Table | dedicated-game → `blobbi-air-hockey` |
| `arcade-cabinet-pink` | floor-1 | Pink Cabinet | shared-catalogue |
| `arcade-cabinet-black` | floor-1 | Black Cabinet | shared-catalogue |
| `arcade-cabinet-classic` | floor-1 | Classic Cabinet | shared-catalogue |
| `arcade-cabinet-green` | floor-1 | Green Cabinet | shared-catalogue |
| `arcade-cabinet-purple` | floor-1 | Purple Cabinet | shared-catalogue |
| `arcade-cabinet-red` | floor-1 | Red Cabinet | shared-catalogue |

The dance machine was called **"Dance Dance Blobbi"**, and is now **"Blobbi Dance
Machine"** — named for the game it hosts, and named the same as that game. It is
a DEDICATED machine, so a player should be able to find the dance game by reading
the room. (An intermediate pass renamed it "Dance Pad Cabinet" to satisfy a rule
that turned out to apply only to the generic six; the rule, not the name, was the
mistake.) A config test forbids a *generic cabinet* being named after a game, and
forbids the dance machine losing its game name.

Rules the config enforces (all covered by `arcade-machines-config.test.ts`):

- **Identity is the id, never the filename.** `snooker.png` is the Pool Table and
  `arcade-machine-green.png` is the Green Cabinet; the two previously shared the
  `alt` "Arcade Machine Green".
- **What a machine does is one explicit field.** ~~`gameId` is `null` for eight of
  nine.~~ **Phase 4**: `activation` replaced `gameId`, `availability` and `blurb`,
  and a test asserts all three are absent rather than merely unused. The
  structural guarantee did not weaken — it moved: the lifecycle reducer still
  refuses `start` without a game id, and the only thing that can supply one is a
  registry entry that passes `canLaunchArcadeGame` for **this machine and this
  surface**. "A machine owns no game" was never a universal rule; it is true of
  the six generic cabinets and false of the three dedicated machines.
- **A game id is not a Nostr address or an item id.** `blobbi-dance` is a stable
  string with its own lifecycle, now declared once in `src/arcade/catalogue.ts`
  (it used to be written out in both this registry and the reward policy, each
  with a comment saying it mirrored the other).
- Unique ids, unique display names, unique accessible names; every machine on a
  real floor; deterministic back-to-front render order; every interaction anchor
  proven to land on walkable floor.

**No movement blockers are configured.** `MovableBlobbi.goTo` refuses a target
inside a blocker, so a blocker over a machine's footprint — placed before its
anchor has been validated in a browser — would silently make that machine
unreachable. Blockers belong in the phase that has a playable game to walk up to.

Non-machine furniture lives in `src/lib/arcade-room-config.ts`: decoration (with
**no `alt` field at all**, so a wrong label cannot be expressed), the two basement
seating groups, the elevator, and the two ground-floor counters.

---

## 3. The lifecycle state machine

> **Unchanged by Phase 4.** The reducer already took `machineId` and `gameId` as
> independent fields on `open`; only its CALLER assumed the second could be
> derived from the first. Which screen the player is on is a separate, tiny state
> machine (`src/arcade/arcade-navigation.ts`) rather than extra lifecycle
> statuses, and it now models three flows: generic cabinet → catalogue, dance
> machine → game, table → that table's own screen. See
> `docs/arcade-catalogue.md` §4.


`src/arcade/arcade-machine-state.ts` — pure, exhaustive, no React/DOM/timers.

```
closed ──open──► preview ──start──► countdown ──ready──► playing ⇄ paused
  ▲                 │                   │                  │        │
  │                 │                   └──────abort───────┴────────┘
  │                 │                             │                 │
  │                 │                             ▼              finish
  │                 │                          aborted              │
  │                 │                             │                 ▼
  └──── close ──────┴─────────────────────────────┴──────────── results
                                                                    │
                                                                  claim
                                                                    ▼
                                                 rewarded ◄──ok── claiming
                                                    │               │
                                                    └───replay──────┘ (fail → results)
```

Invariants, each with a test:

1. `playing` is the only state a result may come from. A `finish` from `paused`
   is refused, so a game cannot score while frozen.
2. `paused` preserves the run — same run id, machine and game.
3. A `runId` is minted exactly once. The caller supplies it (the reducer is
   pure); the reducer refuses to overwrite one.
4. Results are immutable. A second `finish` is ignored, as is a result whose
   `runId` / `gameId` / `machineId` do not match, or one that fails validation.
5. An aborted run has no result, so it can never claim.
6. Closing during `countdown` / `playing` / `paused` records
   `lastOutcome: 'aborted'`.
7. One reward per `runId`, ever. `rewardedRunIds` grows only on **confirmed**
   success, which is what makes a retry after an unconfirmed publish safe.
8. Replay is a new run with a new id and a cleared result.
9. **The reducer never computes, stores or sees a ticket amount.**

An ignored event returns the SAME object reference, so a stray dispatch cannot
re-render every consumer.

---

## 4. The result contract

`src/arcade/types.ts`. JSON-serialisable, no functions, no Nostr events, no
inventory quantities, no controller references.

```ts
interface ArcadeGameResult {
  runId: string; gameId: string; machineId: string;
  difficulty: 'easy' | 'normal' | 'hard';
  cleared: boolean; score: number;
  startedAt: number; endedAt: number;
  stats: Record<string, number>;   // per-game, numbers only
  seed?: string;                   // reserved; nothing generates one yet
}
```

`validateArcadeGameResult` rejects impossible values (non-integer or negative
scores, `NaN`/`Infinity` stats, a run that ended before it started) **before** any
reward is evaluated. This is not anti-cheat — a client-authored score cannot be
verified client-side — it is a correctness gate.

`findNonSerialisable` walks the value and names anything JSON would silently drop
(`JSON.stringify` discards functions and returns valid JSON, so it is useless as
a check on its own).

There is deliberately **no leaderboard shape**.

---

## 5. The shell boundary

> **Extended in Phase 4.** `ArcadeGameShell` now hosts three surfaces — the
> shared catalogue, a running game, and a notice/coming-soon panel —
> distinguished by a `surface` prop rendered as `data-arcade-surface`. `status`
> became OPTIONAL, because a catalogue is a screen and not a run; when it is
> absent there is no `data-arcade-status` and no pause control. The dismiss
> control's label and accessible name are the caller's to set, so they can
> describe the destination.
>
> It also stopped portaling to `document.body` — see **Where it renders** below.

`arcade/ArcadeGameShell.tsx` replaces `GameModal`, which has been deleted.

- **Renders outside the world, and inside the game window.** A Radix `Dialog`
  portalled into the **stage overlay host** that `BlobbiFrame` provides through
  `StageOverlayContext` — `container={useStageOverlayHost()}` plus `inFrame`.
  Two separate mistakes are being avoided at once:
  - `GameModal` was a plain `absolute inset-0` div INSIDE `VirtualWorld`, so it
    inherited the world's scale transform and was clipped to the fixed
    1046 × 697 box. The host sits outside the world subtree, so that cannot
    recur.
  - Portalling to `document.body` (Phase 2 → the first Phase 4 pass) fixed the
    scaling but covered the whole browser page: the wood frame, the shell header
    and footer and the page behind them all disappeared behind a full-viewport
    dialog. The host is level with the world INSIDE the frame's bezel, so the
    overlay dims the game window and nothing else — on desktop, in immersive and
    in fullscreen alike, with no second code path.

  Every arcade modal takes this path, not just the shell: `ArcadePassModal`,
  `ElevatorModal` and `NoPassModal` too. See `docs/arcade-catalogue.md` §5.
- **Card dialogs must bring their own padding and margins.** `DialogContent`'s
  two branches are not symmetrical — the body-portal branch carries `p-6`, the
  `inFrame` branch carries positioning and animation only (the in-frame dialogs
  written first are full-bleed artwork boards that pass `p-0`). A dialog moved
  into the frame therefore loses its padding, and its `w-full` starts resolving
  against the stage instead of the viewport, so it loses its side margins too.
  `inFrameDialogPanelClass` in `ui/dialog.tsx` is the one rule that puts both
  back; `ArcadeDialogs.containment.test.tsx` holds the three arcade dialogs to
  it. `ArcadeGameShell` opts out deliberately — a machine's screen is *meant* to
  fill the stage.
- **Unmounts on close.** `GameModal` set its content and never cleared it, so the
  last game's markup stayed mounted forever behind a closed modal.
- **Owns** open/close, title, pause/resume/leave controls, and the
  reduced-motion decision. **Owns nothing else** — no score, no Nostr, no
  inventory. It imports none of them.
- **Blocks world input** by being a modal dialog outside `[data-world-surface]`;
  `data-block-move` is belt and braces.
- **Restores focus explicitly.** Radix returns focus to a `DialogTrigger`, and
  this dialog has none — it is opened by the movement system on ARRIVAL. The
  shell remembers the focused element in `onOpenAutoFocus` and restores it in
  `onCloseAutoFocus`.
- `DialogContent` gained a `hideDefaultClose` prop so the shell's own header
  controls are not doubled by the default X.

---

## 6. Interaction: walk first, always

`arcade/ArcadeMachine.tsx`, a sibling of `TheaterSeat` and `TownBush`:

```
click / tap / Enter
  → compute the target from the LIVE rect of the real world surface
  → clamp into the floor's walk boundary
  → requestInteraction(...)
  → …the Blobbi walks…
  → onActivate(machineId)      ON CONFIRMED ARRIVAL, never on click
```

`data-block-move` plus pointer/touch stop-propagation, so a tap never *also*
starts a raw world walk that races the pending interaction. The callback payload
is the machine **id** — not a modal, not copy — so what a machine does can change
without touching where it sits.

### Wall-mounted objects need a configured stand point

`MovableBlobbi.goTo` does not clamp its target; it clamps each animation STEP.
A target above the walkable floor is therefore never reached — every step is
pushed back onto the floor's top edge and the Blobbi slides along it. Worse, on
the ground floor that edge runs through the mouth of the narrow elevator alcove.

Two mitigations, both in place:

- `InteractiveElement` accepts an optional `walkBoundary` and clamps the derived
  target into it;
- the ticket counter, the prize counter and the elevator declare an explicit
  `interactionPoint` / stand point on open floor (`arcade-room-config.ts`), which
  is what they actually use. Tests assert each one is walkable and clear of the
  alcove.

---

## 7. Input, pause and reduced motion

- **`arcade-input-map.ts`** (pure): arrows + WASD → four lanes, `P` → pause,
  auto-repeat dropped, modified keys ignored, and the set of keys whose default
  must be suppressed while playing (arrows and space; **never** Escape or Tab).
- **`useArcadeInput.ts`**: binds only while `enabled` (the caller passes
  `status === 'playing'`), tracks simultaneously-held lanes, converges touch and
  keyboard on the same action type, and removes every listener on unmount or
  disable. **No gamepad** — no precedent in the repo, no requirement, and it
  would double the mapping surface.
- **`useArcadeInterruption.ts`**: `visibilitychange → hidden` and `window` blur.
  No automatic resume, no background continuation, and no `focus`/`pageshow`
  handling (too noisy on mobile Safari). **Phase 3 split the two signals**: the
  hook now reports which one fired, because a hidden tab (rAF stopped, audio
  clock still advancing — unrecoverable) and a blurred-but-visible tab (nothing
  is wrong, the player clicked elsewhere) are not equally severe. Blobbi Dance
  aborts on the first and pauses on the second.
- **`useReducedMotion.ts`**: `prefers-reduced-motion: reduce`, reactive,
  jsdom/SSR-safe, used by the shell to drop its decorative zoom. It must never
  change game timing or remove a gameplay cue — those are information, not
  flourish. No repository-wide animation refactor was done.

---

## 8. Audio decision

`src/arcade/audio/arcade-audio.ts`. **No track, no scheduler, no notes.**

> **Phase 3 built the layer above this one.** `src/arcade/dance/dance-audio.ts`
> owns the track scheduler and the song clock; this module still owns the single
> `AudioContext`, the persisted mute and the persisted latency offset. The
> decision below held exactly as written: `AudioContext.currentTime` is the
> authoritative clock, `requestAnimationFrame` only samples it, and the context is
> created inside the Start click. **The calibration UI was NOT built** — the
> offset is read and applied, but nothing lets a player set it (see
> `docs/blobbi-dance.md` §14).

| | UI one-shots | Timing-critical music |
| --- | --- | --- |
| examples | button blips, coin drop | the track a rhythm game is judged against |
| mechanism | `useSfx` (`HTMLAudioElement`) | `AudioContext` |
| clock | none | `AudioContext.currentTime` — **never** `setTimeout`/rAF |

`useSfx` stays exactly as it is for the first column. The module owns: one lazily
created `AudioContext` (created only from a user gesture, because a context built
outside one starts suspended and silently produces nothing), suspend/resume tied
to pause, a persisted global mute, and a persisted per-device latency offset.
Phase 3 owns the calibration UI.

---

## 9. Reward boundary — defined, not crossed

`src/arcade/reward-policy.ts` calculates; `src/arcade/arcade-reward-boundary.ts`
describes the write. **Neither grants anything, and no code path in `src/arcade/`
imports `src/inventory/` or `@nostrify/*`.**

Policy shape: each game owns only `base(result)`; the participation floor,
difficulty multiplier, first-clear / daily / personal-best bonuses, the daily
anti-farming limit and the caps are applied by ONE shared function, so no game
can invent its own economy. Order: `base → floor → × difficulty → + flat bonuses
→ cap`. The award carries a line-by-line breakdown and explicit `capped` /
`dailyLimitReached` flags so the results screen can be honest.

Starting values (`ARCADE_REWARD_TUNING`, all tunable): participation 2, ×1/1.25/1.5,
+10 first clear, +5 first play today, +5 personal best, hard cap 25, 6 rewarded
runs per game per UTC day, target band 3–15 for a normal clear before bonuses.

The dance policy was registered as **`draft`**. `getProductionRewardPolicy()`
returns `undefined` for a draft, so at the end of Phase 2 there was no production
policy at all and a caller could not accidentally pay out.

> **Phase 3 promoted it to `active`** — deliberately, once the game existed, the
> result contract was complete, the calculation was pure and tested, aborted runs
> were excluded and the writer was integrated. It is the only `active` policy in
> the arcade. Phase 3 also added `policyId`, `version`, a `shape` (`scaled` |
> `flat`) and a per-game `ineligible` hook to `ArcadeRewardPolicy`, plus
> `calculateArcadeReward()` — a structured, self-describing grant carrying the
> item address, the quantity, eligibility and the cap. Numbers and worked
> examples: `docs/blobbi-dance.md` §6.

### Claim lifecycle

```
finished immutable result → award → createPendingClaim (persisted BEFORE any write)
  → publishing (strict: timeout = FAILURE) → verifying (read back, compare quantity)
  → claimed (one-way)          … any failure → failed, retryable with the SAME runId
```

> **A grant may only be marked `claimed` once the new quantity has been confirmed
> to exist on a relay. A resolved `publish()` is not confirmation.**

**Chosen publish strategy (settled; do not re-litigate in Phase 3): a local
strict publish inside the reward hook plus a verify-after-write read.
`useNostrPublish` is NOT changed.** It resolves on a 5-second timeout, which is
correct for presence heartbeats and wrong for a one-shot grant of a scarce
resource — but tightening it globally would turn every relay hiccup into a
user-visible error across presence, chat, playback, profile, Blobbi state and
inventory. `useFirstEggAdoption` already solved this locally, so the pattern is
precedented rather than invented. ~~Idempotency on `runId` is what makes
strictness cheap: retrying something that actually succeeded costs nothing.~~

> **Corrected in Phase 3.** That last sentence was wrong and it produced a real
> duplicate grant (a 3-ticket reward paid twice). `runId` is not carried in
> kind:31633 and the grant is ADDITIVE, so a retry after a publish that actually
> landed simply adds the award a second time. An attempt that may have been
> published is now `ambiguous` and is never republished — only reconciled,
> read-only. See `docs/arcade-reward-publication-boundary.md` §6.

`ARCADE_REWARD_WRITER_UNIMPLEMENTED` rejects both of its methods, so a future
caller wired up too early fails loudly instead of silently doing nothing.

> **Phase 3 implemented the real writer** in
> `src/inventory/arcade-reward-writer.ts` — outside `src/arcade/`, because
> `boundaries.test.ts` proves that nothing under `src/arcade/` can reach a relay
> or an inventory, and that property was worth more than keeping the files
> together. The lifecycle above shipped exactly as drawn: persist the pending
> claim, strict-publish, read the quantity back, and reach `claimed` only when the
> delta matches. `ARCADE_REWARD_WRITER_UNIMPLEMENTED` remains as the default for
> any game that has no writer.

---

## 10. Pass economy and lifecycle fixes

> **Historical record of this phase.** The coin-charge row below describes the
> fix as it shipped *then*. The Coin cutover has since replaced it: the pass is
> charged against the canonical Blobbi Coin quantity in **kind:31633** via
> `coinWallet.spendCoins()`, and `useCoinsMutation` is deleted. Every other row
> still describes current behaviour. See `docs/blobbi-coin-cutover.md`.

| Defect | Fix |
| --- | --- |
| The 20-coin charge published nothing (`updateOwnerCoins` is a local optimistic mutation on a per-hook-instance ref) | Routed through `useCoinsMutation`: fresh relay read as the write base, `mergeOwnerProfileTags` + raw `inv` passthrough, negative balance rejected, published exactly once |
| Pass granted before the charge | Granted **only after** the publish resolves. No optimistic pass and no optimistic balance — an optimistic update is honest only when it is backed by a rollback, and here the thing to roll back is access already used |
| Two clicks in one tick could both charge (`isPending` only flips after a re-render) | A synchronous `inFlightRef` is the actual guard; the disabled button is a courtesy on top of it |
| `grantArcadePass()` could not fail, so a browser that refuses storage left the player charged, passless, and congratulated | The store now **reads back** its own write and returns whether it stuck. The modal reports three distinct outcomes: charge failed (no coins deducted), charge succeeded but the pass could not be stored (copy must not claim the coins are safe), full success. **No compensating coin write is attempted** — a refund would be a second unverified publish on top of a first whose outcome is unknown |
| An unresolved coin query rendered as "Your current coins: 0" and disabled the button | Skeleton while loading, an error with a retry when unreadable, a number only when it is genuinely a number |
| `ArcadePassIcon` polled `sessionStorage` at 1 Hz for the whole session, in every location | `src/lib/arcade-pass.ts` + `useArcadePass`: writers notify, plus one shared cross-tab `storage` listener. No timers |
| Pass-holder spawn `{50, 48}` sat on the elevator alcove's boundary line, from which the ticket counter was unreachable | `ARCADE_PASS_HOLDER_SPAWN = {50, 58}`, on open floor. `arcade-spawn.test.ts` proves it is walkable, clear of the alcove, and that a straight line from it to every ground-floor destination stays on walkable floor |
| The Blobbi rendered behind closed elevator doors (`z-10` tied with its depth band; markup order won) | `ARCADE_ELEVATOR_Z_INDEX = 8`, strictly below every Blobbi band on every arcade floor. Stated as a rule and asserted by a test |
| The `slide` branch had no `data-block-move`, no touch handler and no pointer stop-propagation, so tapping the elevator started a raw world walk *and* a walk-to-interact, and the two raced | The contract is applied to the slide branch **when it has an action**, so decorative sliding art (the theater's little stage door) keeps its click-through behaviour |
| `ArcadePassModal` mounted unconditionally on all three floors, running two live queries behind a closed dialog | All arcade modals are mounted only while open |

The Arcade **Pass** (temporary `sessionStorage` floor access) and the Arcade
**Ticket** (persistent kind:31633 currency) remain deliberately separate. Turning
the pass into a 31632 item is a product decision and is out of scope.

### What a resolved charge does and does not prove

> **Superseded by the Coin cutover.** The pass is no longer charged against
> kind:11125. `useCoinsMutation` is deleted; the charge is
> `coinWallet.spendCoins()` against the canonical Blobbi Coin quantity in
> kind:31633.

`spendCoins` resolving with `applied` means, in order: a durable operation
record was written (no record ⇒ no publish), the shared cross-tab lock and the
per-user write chain were held, the newest kind:31633 was read authoritatively
(an empty answer confirmed by a second read), the balance covered the price,
one replacement event was signed with a monotonic `created_at`, **at least one
relay accepted it**, and a read-back was attempted (`verified`).

A timeout is NOT success: it resolves as `ambiguous`, is recorded durably, and
is reconciled read-only — never blind-retried. So the old "pass granted for
coins that may not have been deducted" hazard is gone in that direction. What
remains, and is stated honestly in `ArcadePassModal`'s header, is the reverse:
the pass itself is `sessionStorage`, granted AFTER the charge, so a storage
failure can leave the coins spent with no pass. Product copy must not claim
more.

### The pass is tab-scoped, deliberately

`sessionStorage` is per browsing context. A second tab starts without a pass and
buying one there does not appear here — that is the intended behaviour for
temporary access to the visit you are currently making, not a limitation being
worked around. The module keeps one `storage` listener purely so a write it did
not make cannot leave subscribers stale; it is **not** cross-tab synchronisation.
Moving between `arcade`, `arcade-1` and `arcade-minus1` never clears the pass
(`PlayingView` clears only when the location does not start with `arcade`), which
`arcade-pass.test.tsx` pins per floor.

---

## 11. Accessibility rules

- Decorative sprites carry `alt=""` + `aria-hidden` + `pointer-events-none`. The
  prop config **has no `alt` field**, so the 30 sprites labelled "ticket counter"
  cannot come back.
- Every machine is a `role="button"` with a unique accessible name; its sprite is
  `alt="" aria-hidden` so it is not announced twice. Keyboard activation walks
  the Blobbi over exactly as a click does.
- The microphone (previously `alt="Right Chair"`, `cursor-pointer`,
  `hover:scale-110`, `onClick` commented out) is now scenery with no affordance.
- The PRIZES counter (previously a `console.log`) keeps its affordance and gets
  an honest coming-soon state, because the prize shop is a real planned feature.
- The four basement chairs have four distinct names (previously two).
- Coming-soon and preview states are announced via `role="status"`, so a screen
  reader learns a machine is not playable at the same moment a sighted player
  does.
- Shell controls are named for their target ("Pause Dance Dance Blobbi").

---

## 12. DEV harness

`/dev/arcade` (`src/pages/DevArcade.tsx`), on the `DevTheater` pattern and gated
by `import.meta.env.DEV`, which Vite replaces with a literal `false` in a build —
so the chunk is never emitted.

`src/dev-routes.test.ts` proves it at two levels. The source-level assertions
always run: both harnesses are behind the DEV gate, exactly two `/dev/*` routes
exist, neither is imported statically, and `AppRouter` is the only production
module that mentions either. The artifact-level assertions run only against a
build that is **newer than `src/`** — a stale `dist/` proves nothing, so those
checks are reported as SKIPPED rather than passing vacuously. To demand them,
build and then run with `REQUIRE_FRESH_BUILD=1`, which turns a missing or stale
build into a failure.

The harness never fakes a game onto a machine that has none: selecting a
coming-soon cabinet and pressing a run-state fixture leaves it in `preview` and
says why, because the reducer genuinely refuses to start a run without a game id.

It mounts the REAL shell, `PlayingView`, `ArcadeRoom`, machines, movement and
lifecycle reducer — there is no second, fake arcade. It can switch floors, select
a machine, drive every lifecycle state, overlay each machine's configured walk-to
anchor, toggle the pass, and seed a ticket balance / fetched-vs-fallback
definitions / a broken image **into the TanStack cache only**. It publishes
nothing: with no signed-in user every publish attempt fails at "User is not
logged in".

---

## 13. What Phase 3 had to implement — and what it did

> **Scorecard.** 1 ✅ (one track, one difficulty, four lanes, an authored chart in
> committed data, exactly one `ArcadeGameResult`, no inventory or Nostr reference
> — but **four** judgements plus a combo counter, not three, because a distinct
> Okay tier is what makes the accuracy curve legible). 2 ✅ engine, ❌ calibration
> screen. 3 ✅ as `useArcadeReward`. 4 ✅. 5 ✅ as `DanceResults` (the daily-limit
> explanation is absent because a `flat` policy has no daily limit to explain).
> 6 ✅ — the touch zones are 56 px tall, above `ARCADE_TOUCH_ZONE_MIN_PX`. 7 ✅ for
> input and interruption; ❌ movement blockers, still deliberately absent.
>
> One deliberate change: `useArcadeInterruption` now reports WHICH signal fired,
> and Blobbi Dance aborts on `hidden` while pausing on `blur` — see
> `docs/blobbi-dance.md` §10 for why the two are not equally severe.

### The original list

1. **The rhythm game itself** on `arcade-dance-machine`: one track, one
   difficulty, ~60–90 s, four lanes, three judgements plus a combo counter, a
   fixed authored note chart in a plain data file. It must produce exactly one
   `ArcadeGameResult` and hold no reference to inventory or Nostr.
2. **The audio engine** on top of `arcade-audio.ts`: schedule against
   `AudioContext.currentTime`, never a timer; add the latency-calibration screen
   that writes `setArcadeLatencyOffsetMs`. **A licensed track is still a blocking
   product decision.**
3. **`useArcadeReward`**, implementing `ArcadeRewardWriter` per §9: persist the
   pending claim first, strict-publish, verify by reading the quantity back, mark
   claimed only then, and surface failure with a retry that reuses the `runId`.
4. **Promote `DANCE_REWARD_POLICY` to `active`** — deliberately, once the game's
   scoring exists and the numbers have been balanced.
5. **`ArcadeResults`**, rendering the award breakdown the policy already
   produces, including the cap and daily-limit explanations.
6. **Touch lane zones** in the shell, ≥ `ARCADE_TOUCH_ZONE_MIN_PX`.
7. Wire `useArcadeInterruption` and `useArcadeInput` to the live run, and add
   movement blockers around machines once anchors are confirmed in a browser.

### Explicit non-goals

Playable notes, a music track, a beat map, score accumulation, combo judgements,
final reward quantities, ticket grants, prize purchases, leaderboard events,
real-time multiplayer, pool physics, air-hockey physics, microphone/pitch
detection, gamepad support, and the six cabinet games. Also: **anti-cheat** — a
client-side game cannot be made cheat-proof, and the economy is designed so that
cheating is boring (caps, sinks, no transfers) rather than pretending it is
prevented.

---

## 14. Known limitations

- ~~The arcade still publishes **nothing** except the Arcade Pass coin charge.~~
  **Superseded by Phase 3**: the arcade now publishes kind:31633 ticket grants
  through `useArcadeReward`. `src/arcade/boundaries.test.ts` still enforces
  against the real import graph that `src/arcade/` can reach neither the
  inventory layer nor a Nostr client, and now additionally that exactly one
  arcade component reaches the reward boundary — so "the game itself grants
  nothing" remains structural rather than a promise in a comment.
- Movement blockers are absent, so a Blobbi can still walk through a cabinet.
- The basement chairs walk the Blobbi over and stop; there is no seated pose or
  state, exactly as before.
- `arcade-1` and `arcade-minus1` are reachable only through the elevator, and the
  arcade has no map entry.
- The shell's mobile layout **was** verified at a real narrow viewport (386 × 840,
  rendered in an iframe so CSS media queries genuinely evaluate narrow, since the
  automated browser refuses to resize its window): every lifecycle state gives a
  386 × 840 box with `border-radius: 0` and zero horizontal overflow on both the
  document and the shell. It has not been exercised on physical hardware.
- Walk timing could not be observed reliably in the automated browser: the tab's
  `requestAnimationFrame` is starved there, which starves the movement loop. The
  arrival CONTRACT is covered by tests; the feel of the walk is not.
