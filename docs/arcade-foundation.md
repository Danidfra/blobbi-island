# Blobbi Island — Arcade Foundation (Phase 2)

Status: implemented. **No game is playable, and no Arcade Ticket is granted.**
This document describes the shared technical foundation every arcade game will
use, and states precisely what Phase 3 has to build on top of it.

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

| id | floor | display name | game | availability |
| --- | --- | --- | --- | --- |
| `arcade-dance-machine` | basement | Dance Dance Blobbi | `blobbi-dance` | preview |
| `arcade-cabinet-pink` | floor-1 | Pink Cabinet | — | coming-soon |
| `arcade-cabinet-black` | floor-1 | Black Cabinet | — | coming-soon |
| `arcade-cabinet-classic` | floor-1 | Classic Cabinet | — | coming-soon |
| `arcade-cabinet-green` | floor-1 | Green Cabinet | — | coming-soon |
| `arcade-cabinet-purple` | floor-1 | Purple Cabinet | — | coming-soon |
| `arcade-cabinet-red` | floor-1 | Red Cabinet | — | coming-soon |
| `arcade-pool-table` | floor-1 | Pool Table | — | coming-soon |
| `arcade-air-hockey` | floor-1 | Air Hockey Table | — | coming-soon |

Rules the config enforces (all covered by `arcade-machines-config.test.ts`):

- **Identity is the id, never the filename.** `snooker.png` is the Pool Table and
  `arcade-machine-green.png` is the Green Cabinet; the two previously shared the
  `alt` "Arcade Machine Green".
- **Game identity is separate from visual identity.** `gameId` is `null` for
  eight of nine. That is the structural reason they cannot fake gameplay: the
  lifecycle reducer refuses `start` without a game id.
- **A game id is not a Nostr address or an item id.** `blobbi-dance` is a stable
  string with its own lifecycle.
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

`arcade/ArcadeGameShell.tsx` replaces `GameModal`, which has been deleted.

- **Renders outside the world.** Radix `Dialog`, portalled to `document.body`,
  exactly like every other modal in the app. `GameModal` was a plain
  `absolute inset-0` div inside `VirtualWorld`, so it was scaled with the room
  and clipped to the fixed 1046 × 697 box.
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
- **`useArcadeInterruption.ts`**: `visibilitychange → hidden` and `window` blur
  both PAUSE (never abort). No automatic resume, no background continuation, and
  no `focus`/`pageshow` handling (too noisy on mobile Safari).
- **`useReducedMotion.ts`**: `prefers-reduced-motion: reduce`, reactive,
  jsdom/SSR-safe, used by the shell to drop its decorative zoom. It must never
  change game timing or remove a gameplay cue — those are information, not
  flourish. No repository-wide animation refactor was done.

---

## 8. Audio decision

`src/arcade/audio/arcade-audio.ts`. **No track, no scheduler, no notes.**

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

The dance policy is registered as **`draft`**. `getProductionRewardPolicy()`
returns `undefined` for a draft, so there is currently no production policy at
all and a caller cannot accidentally pay out.

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
precedented rather than invented. Idempotency on `runId` is what makes strictness
cheap: retrying something that actually succeeded costs nothing.

`ARCADE_REWARD_WRITER_UNIMPLEMENTED` rejects both of its methods, so a future
caller wired up too early fails loudly instead of silently doing nothing.

---

## 10. Pass economy and lifecycle fixes

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

`useCoinsMutation` resolving means, in order: the freshest available kind:11125
was fetched and parsed, the new balance is non-negative, the signer produced a
signed event, and `nostr.event()` returned. It does **not** mean a relay
acknowledged it — `useNostrPublish` swallows a 5 s timeout and resolves. Nothing
verifies the write afterwards, and this phase deliberately does not add that (see
§9 for why the strict-publish + verify pattern belongs to the reward path). The
bounded consequence is a pass granted for coins that may not have been durably
deducted: it favours the player, costs 20 coins, and expires on leaving the
arcade. `ArcadePassModal`'s header comment states this in full; product copy must
not claim more.

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

## 13. What Phase 3 must implement

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

- The arcade still publishes **nothing** except the Arcade Pass coin charge. The
  ticket balance is read-only, and `src/arcade/boundaries.test.ts` enforces
  against the real import graph that `src/arcade/` can reach neither the
  inventory layer nor a Nostr client — so "grants no tickets" is structural, not
  a promise in a comment.
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
