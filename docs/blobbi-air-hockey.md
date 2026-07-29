# Blobbi Air Hockey

Status: **implemented and playable.** The arcade's second real game, and the
first one with **physics**.

It runs on exactly one machine — `arcade-air-hockey`, game id
`blobbi-air-hockey` — and nothing else in the arcade changed. The six generic
cabinets still open a catalogue that is still honestly empty, and Blobbi Dance is
untouched.

> **Since then:** Pool shipped, following the pattern §2 sets out, and needed no
> change to this game or to the shared pieces it established. See
> [`docs/blobbi-pool.md`](./blobbi-pool.md).

**It grants no Arcade Tickets.** See §7 — that is a product decision with a
prepared join point, not an oversight.

Read alongside: [the arcade foundation](./arcade-foundation.md) for the shared
lifecycle, [the catalogue](./arcade-catalogue.md) for how a machine decides what
it is, and [Blobbi Dance](./blobbi-dance.md) for the first dedicated machine —
this game deliberately follows its shape.

---

## 1. What was built

```
src/arcade/
├── useFixedStepLoop.ts            NEW · shared, reusable · the game loop
└── hockey/                        NEW · pure: no React, no DOM, no Nostr
    ├── table.ts                   geometry + every tuning constant
    ├── physics.ts                 integrate, walls, mallets, goals, clamps
    ├── ai.ts                      the opponent: 4 modes, 2 difficulties
    ├── match.ts                   the match state machine + seeded RNG
    ├── hockey-result.ts           match → ArcadeGameResult (and back)
    └── hockey-audio.ts            four feedback sounds, no clock

src/components/blobbi/arcade/hockey/
├── AirHockeyMachine.tsx           controller · joins the game to the arcade
├── AirHockeyTable.tsx             the playable surface · canvas + HUD
├── AirHockeyPreview.tsx           start screen · rules, difficulty, controls
├── AirHockeyResults.tsx           result screen
├── HockeySoundToggle.tsx          mute control
└── hockey-draw.ts                 canvas rendering + the coordinate bridge
```

Registry changes, and nothing more: the catalogue entry became `playable`, the
machine's `activation` became `dedicated-game`, and `native-games.tsx` gained a
second renderer.

---

## 2. The dedicated-machine pattern (which Pool then copied)

Air Hockey is the second machine to follow this shape, which is the point of
writing it down — and Pool is the third, unchanged. The arcade already owned every piece; a dedicated game supplies
five files and wires them together.

```
ArcadeRoom                       owns the lifecycle reducer and the view
  └── native-games.tsx           id → renderer, refuses a wrong machine/surface
       └── <XMachine>            THE CONTROLLER — the only new "glue"
            ├── ArcadeGameShell  the dialog, pause/exit, the frame
            ├── <XPreview>       before the run
            ├── <XSurface>       during the run
            └── <XResults>       after it
```

The controller owns exactly six things, and nothing else:

| Responsibility | Rule |
| --- | --- |
| Minting the run id | Once, in the Start handler. The reducer is pure and refuses to overwrite one. |
| Building the audio engine | Inside the click, because a context built outside a gesture is silently muted. |
| Disposing it | On unmount. Whoever built it releases it. |
| Choosing what to render | From `lifecycle.status` only — never from a second local phase. |
| Reporting the result | One `dispatch({type:'finish', result})`, from one place. |
| Labelling the exit | From props: only the caller knows where leaving lands. |

**Everything else already exists.** The lifecycle, the abort semantics, the
pause/resume controls, the interruption hook, the focus restore, the containment
of the dialog inside the game window, and the launch rules that stop a game
starting on the wrong machine — a new game inherits all of it by rendering
`ArcadeGameShell` and reading `lifecycle.status`.

Two things Air Hockey adds to the pattern for whoever writes Pool:

- **`useFixedStepLoop`** (§3), which any simulated game needs and no rhythm game
  did;
- **a result summary that round-trips** (§7): the results panel derives its
  display from the lifecycle's one immutable result rather than keeping a
  parallel copy.

---

## 3. The game loop

`src/arcade/useFixedStepLoop.ts`. Blobbi Dance did not need one: a rhythm game
reads the audio clock and draws whatever it says, so a dropped frame costs a
frame of animation. A game with physics cannot work that way.

**The simulation advances in fixed 1/120 s steps; rendering happens whenever the
browser is ready.** Three properties, each of which exists because its absence is
a real bug:

1. **An accumulator.** Real elapsed time goes in; whole steps come out. The
   simulation clock tracks the wall clock without ever taking an irregular step,
   so the game plays identically at 60 Hz and 120 Hz.
2. **A catch-up cap (250 ms).** Time beyond it is *discarded*, not simulated. A
   hidden tab, a sleeping laptop or a blocked main thread cannot come back and
   advance the world by four seconds in one step — which would tunnel the puck
   through a wall — and cannot spiral (long frame → more steps → longer frame).
3. **A clean restart.** Going inactive cancels the frame and clears the
   accumulator; coming back re-anchors to the current time. A five-minute pause
   contributes zero steps.

Callbacks are read through a ref, so a parent re-rendering with new inline
functions never re-binds the loop. Re-binding is how a second loop appears and
everything silently runs at double speed.

---

## 4. Physics

All of it is pure functions over plain numbers in `physics.ts`, so a rebound
angle or a clamped speed is checked by calling a function rather than by watching
a canvas.

### Table units, not pixels

The simulation runs in a fixed **100 × 160 table-unit box** and knows nothing
about the screen — or about which way up it is drawn. A pixel-sized simulation
changes its own physics when the dialog is resized, and makes every physics test
depend on a layout.

That has paid for itself twice. The table was designed portrait; the arcade's
desktop game window turned out to be short and wide, so the renderer gained a
**quarter turn** and laid the long axis across the screen. Then handhelds needed
the tall layout back, so the renderer gained **both**, chosen from the measured
container (§8). Neither change moved a single number in `table.ts`, and neither
changed a single physics test — a rendering decision should not be able to reach
the physics, and here it structurally cannot.

### One step, five rules, in this order

1. **Integrate** — position advances by velocity × dt.
2. **Drag** — `v *= exp(−k·dt)`, exponential so it is framerate-independent. A
   per-frame multiplier would slow the puck twice as fast at 120 Hz as at 60.
3. **Walls** — reflect off the rails, *except* through a goal mouth.
4. **Mallets** — separate first, then transfer momentum.
5. **Clamp** — speed into its band, position into the table.

Walls before mallets, because a puck squeezed between the two must end up outside
the mallet and inside the table. The final clamp is the backstop.

### Tunnelling, and the one place a sweep is needed

The puck cannot tunnel by construction: at the fixed step it moves at most 1.4
units against its own 4-unit radius, and `physics.test.ts` pins that arithmetic
so a future speed increase fails a test rather than producing a puck that
occasionally passes through a rail.

A **mallet** can, because the player's is no longer speed-limited — it is
wherever the pointer is (§8). `resolveMalletSwept` covers that by testing the
path the mallet travelled rather than only the point it stopped at, and it
collapses to the plain discrete test whenever the mallet moved less than the
puck's radius, which is every step of ordinary play for both sides.

### The three rules that keep a rally a rally

| Rule | Without it |
| --- | --- |
| **Minimum puck speed** (28 u/s while live) | The puck creeps along a rail for forty seconds while neither player can reach it. Measured, in an early build. |
| **Minimum separation speed** off a mallet | A puck resting against a slowly-advancing mallet is re-resolved every step, never separates, and rides it around the table. |
| **Rate-limited mallets** | A pointer that jumps across the screen teleports the mallet through the puck. The limit is also what bounds a strike's speed and what stops the AI snapping onto an interception point. |

### A strike accounts for four things

Contact direction (through the normal), puck velocity and mallet velocity (the
impulse is computed on their *relative* speed), and mallet direction (a small
tangential term, so a sliced hit curves instead of returning down the same line).
The mallet is treated as infinitely heavy, and the outgoing speed is clamped — so
a committed swing feels different from a block without ever producing an absurd
puck.

### Recovery

`sanitisePuck` catches a non-finite or escaped puck; the match takes the point
back to the centre spot and re-serves rather than freezing or exploding. A small
overshoot past a rail is *not* treated as corruption — that is a rounding error,
and restarting a point over one would be worse than the bug.

---

## 5. The match

`match.ts` is one pure fixed-step function. No clock, no `Math.random`, no DOM.
Every random number comes from a seeded generator carried *in* the state, and the
seed is derived from the run id — so a match is reproducible from
`(seed, inputs)`, and nothing in the render path is ever random.

```
countdown ──3,2,1──► live ──goal──► goal ──┬── target reached ──► over
   ▲                  ▲                     │
   │                  └────── serve ◄───────┘
   └─ createHockeyMatch
```

Five invariants, each with a test:

1. **A goal is counted exactly once.** Detection only happens in `live`, and
   scoring leaves `live` in the same step. There is no flag to forget to clear.
2. **`over` is terminal.** Stepping it returns the same object, so a loop that
   keeps running after the match ends changes nothing.
3. **Nobody may leave their half.** Both mallets go through the same clamp and
   the same rate-limited move, every step, whatever the pointer or the AI asked
   for. A 6,000-step test drives deliberately hostile input — teleporting,
   out-of-bounds and `NaN` targets — and checks both mallets every step.
4. **The puck cannot be lost.** See recovery, above.
5. **Serving is fair.** The side that *conceded* serves next, which is
   self-correcting: a player being beaten keeps getting the puck. Only the
   opening serve is random, and it is a seeded coin toss rather than a fixed
   side.

### The score target: first to 7

Measured, not guessed. Running the opponent controller against a mirrored copy of
itself over thirty-six simulated matches, **first to 7** lands between about
**160 seconds** (Easy, one-sided) and **260** (Normal, a long one) — two and a
half to four and a half minutes, which is the arcade-session length the brief
asked for.

First to 5 ended matches around a hundred seconds, before a new player had worked
out how to aim. First to 10 pushed Normal past six minutes, which is a chore
rather than a match. `balance.test.ts` keeps checking this.

---

## 6. The opponent

A **target-based controller with four modes** (`defend`, `intercept`, `strike`,
`recover`), not a puck mirror and not a per-frame dice roll. It returns a
*target*; the match moves the mallet through the same rate limiter the player is
subject to, so the opponent is physically incapable of anything the player is
not — and it is slower than the player's mallet on both difficulties.

### Being beatable is engineered, and it took three attempts

Each mechanism below exists because removing it produced a specific, measured
kind of bad opponent:

| Mechanism | What its absence produced |
| --- | --- |
| **Perception lags** (`reactionMs`, an exponential chase toward the true puck) | Reactions inside one 8 ms step. No shot can beat that: not hard, *unbeatable*. |
| **Decisions are held** (`decisionIntervalMs`) | The mode flickered at threshold edges — visible jitter. The *target* is still recomputed every step, so it tracks smoothly inside a held decision. |
| **It commits** | A strike aims at a point drawn once, when the mode is entered. It cannot re-aim mid-swing, so a player who moves after it has committed gets the goal. |
| **`readError`** — a small absolute lateral error, redrawn per decision | The one that mattered most. `predictCrossingX` is *exact*: it unfolds every rail bounce, and its error is proportional to sideways travel, so a shot straight down the middle was predicted perfectly however low `predictionSkill` was set. Six hundred hits, not one goal, in four hundred simulated seconds. |
| **`looseSpeed`** — always attack a slow puck in your own half | Two cautious opponents both sat on their lines while the puck drifted around the centre spot for four hundred seconds. |
| **Follow-through** — a shot targets a point *past* the puck | Targeting the point just behind it produced an opponent that touched the puck constantly and could not score at all. Setting up behind it first is what keeps that from being a wild swipe. |

### Difficulty

`easy` and `normal` ship, as one frozen profile object each; `hard` is left for
later tuning and `isHockeyDifficulty` deliberately rejects it rather than
returning an undefined profile. Easy is gentler on every axis it varies — a test
asserts that, because a half-edited profile is easy to leave behind.

Difficulty is chosen on the start screen, fixed when the run starts, and echoed
into the result. Changing it mid-match would make the result describe a match
that did not happen.

---

## 7. Rewards: none, and where they would go

Air Hockey grants **no Arcade Tickets**. The catalogue says
`grantsTickets: false`, no reward policy exists for `blobbi-air-hockey`, and
nothing in the game imports `useArcadeReward`, the reward boundary, the claim
ledger or the inventory layer. The start screen says so in words rather than
leaving a player to notice an absence, and the results screen has no claim
panel — an empty or disabled one would advertise something that does not exist.

`catalogue.test.ts` already enforces both directions of the rule: an entry may
only claim `grantsTickets` if an *active* policy exists, and must not otherwise.
**Playable and paying are independent facts**, and this game is the arcade's
proof of it.

### The join point

`buildAirHockeyResult` produces the standard `ArcadeGameResult` the lifecycle
validates, carrying everything a policy would need:

| Field | |
| --- | --- |
| `cleared` | a **win**, not a completion — finishing a 0–7 loss is a completed match and an uncleared one |
| `score` | the player's goal count (the contract requires a non-negative integer) |
| `stats.goalDifference` | the margin, which *can* be negative, so it travels here |
| `stats.won`, `stats.completedNaturally` | the boolean facts, as `1`/`0` |
| `stats.playerGoals` / `opponentGoals` / `targetGoals` / `durationMs` | the match |
| `stats.playerHits` / `opponentHits` / `wallBounces` / `topPuckSpeed` | the flavour |

Enabling rewards later is: write a policy, register it in `reward-policy.ts`,
flip `grantsTickets`, and add the two hook calls `DanceMachine` already has. **No
change to the simulation, the result shape or this file is required.**

`summaryFromResult` is the exact inverse of `buildAirHockeyResult`, tested as a
round trip. That is why the results panel keeps no state: it derives its display
from the lifecycle's one immutable result and cannot drift out of step with the
run it describes.

---

## 8. Presentation

### Input responsiveness: the mallet is held, not steered

The first implementation ran the player's mallet through the same rate limiter
as the opponent's — 300 table units per second. Measured, that cost **117 ms**
of lag on an ordinary flick across a third of the table and **158 ms** corner to
corner. Direct manipulation stops feeling direct somewhere around 50 ms, and it
did not read as lag: it read as a second AI that followed you around.

The fix separates the two things the limit was doing at once:

| | before | now |
| --- | --- | --- |
| **where the mallet is** | eased toward the pointer at 300 u/s | exactly at the pointer, every step |
| **how hard it hits** | implied by that speed | velocity clamped to `PLAYER_MALLET_MAX_STRIKE_SPEED` |
| **can it pass through the puck** | no, because it was slow | no, because `resolveMalletSwept` tests the path |

Measured after: **8 ms**, which is one simulation step — the floor. In a live
browser the drawn mallet lands on the pointer's mapped table unit with **zero**
error (three probes at 0.00 units; a fourth reads 2 units because the pointer
was outside the player's legal half and the zone clamp did its job).

Two safety properties are unchanged: the mallet is still clamped into the
player's own half every step, and a non-finite pointer sample still cannot
poison it.

**The sweep collapses to the plain discrete test whenever a mallet moved less
than the puck's radius**, which is every step of ordinary play for both sides.
That threshold is not an optimisation — without it the player got two collision
samples per step where the opponent got one, resolving player contacts early and
weakly. It was worth six matches out of six: the opponent went from losing all
of them to winning all of them. `physics.test.ts` pins the two paths as
byte-identical below the threshold.

### Two layouts, and where each is used

The renderer supports a **wide** table (the long axis across the screen, player
on the left) and a **tall** one (long axis down the screen, player at the
bottom). The layout is chosen from the measured container — a wide box gets the
wide table, a tall box the tall one — and never from a user agent. Rotating a
phone changes the container's shape, so it changes the layout.

On desktop the choice is also a control: a small labelled button on the table
("Wide"/"Tall", with an accessible name that describes the action) overrides the
measurement. It is deliberately absent during expanded handheld play, where the
layout is not a preference but which way the device is being held.

### Using the space: the HUD moves out of the table's way

The arcade's game window is short and very wide — about 956 x 382 of usable
stage on a laptop — and a table locked to 8:5 in a box that wide is bound by
HEIGHT. A scoreboard and a line of instructions stacked above it therefore did
not cost a strip of table; they cost a fifth of every dimension, while 500 px of
width sat empty beside it. Measured, the table used 48% of the width it had.

So when the box is more than 1.3x wider than the table needs, the HUD moves into
the empty column. The table grew from **456 x 285 to 643 x 402** — about twice
the playfield, with nothing overlapping the puck.

Measured across the sizes this has to work at:

| viewport | layout | HUD | table | field used |
| --- | --- | --- | --- | --- |
| phone 390x780 | portrait | above | 378 x 605 | 89% |
| phone 780x390 | landscape | beside | 514 x 321 | 80% |
| short landscape 740x320 | landscape | beside | 402 x 251 | 67% |
| tablet 820x1180 | portrait | above | 673 x 1077 | 83% |
| tablet 1180x820 | landscape | above | 1147 x 717 | 98% |
| desktop 1440x900 | landscape | above | 989 x 618 | 85% |
| large 1920x1200 | landscape | above | 1469 x 918 | 91% |

Nothing overflows at any of them, and the aspect ratio is preserved everywhere.

### Expanded play on a handheld

A live match on a touch-first handheld takes the whole stage: the shell drops
its inset, rounding and border, the standing instructions go, the difficulty
line goes, and the scoreboard shrinks to one thin row. Both scores, the match
state, Pause and Leave all stay — that is the floor.

It is **not** a second modal, a second route or a second lifecycle. It is the
same shell told to stop insetting itself and the same table told to drop its
chrome, gated on `useImmersive` — the app's existing feature-based test for a
touch-first handheld, the same one `BlobbiAppShell` uses to decide whether the
world fills the screen. Because `BlobbiFrame` already makes the stage fill the
screen there, filling the stage is filling the screen.

**The Fullscreen API is deliberately not used.** `BlobbiAppShell` already owns
the fullscreen layer for the whole app; a second owner inside the arcade would
fight it (the shell's `isFullscreen` goes false when someone else's element is
the fullscreen element, which would flip its own presentation underneath the
game). The in-app expanded mode is the guaranteed path the brief asks for as the
fallback, and it needs no permission, cannot be refused, and cannot trap anyone.

Safe-area insets are applied on the three free edges in expanded mode; the top
edge is the shell's header, which is already inside the safe area.

### Why a canvas here and DOM in Blobbi Dance

Not inconsistency — opposite problems. A rhythm game's notes carry text, focus
rings and a screen-reader story, all of which elements give free. Air Hockey is
three moving circles, a puck trail and contact ripples, none of which carry text
and none of which a keyboard user tabs to; drawing them with elements would mean
a DOM node per trail sample and per ripple, created and destroyed several times a
second.

**Everything a player needs to read is real DOM above the canvas** — both scores
with visible labels, the phase, the countdown, the result. The canvas is
`aria-hidden`.

### Nothing high-frequency touches React

| what | where | how often |
| --- | --- | --- |
| the whole match state | a ref, advanced by a pure function | 120 Hz |
| puck, mallets, trail, ripples | pixels | ~60 Hz |
| both scores, the phase, the countdown | React state | ~30× a match |

### Input

- **Mouse** steers on hover — a desktop player expects the mallet to follow
  without clicking, and it is what makes it feel weightless.
- **Touch and pen** require a held contact: there is no hover to steer with, and
  a stray tap should not fling the mallet across the table. `touch-action: none`
  and `overscroll-behavior: contain` on the table stop a drag from scrolling the
  dialog or triggering pull-to-refresh.
- **Keyboard** (arrows / WASD) moves the same aim point the pointer sets, so
  neither path can produce a mallet speed the other cannot. The playfield is
  focusable and takes focus when a run starts.

The pointer's position is mapped to table units through the exact inverse of the
draw transform, so a resize, a fullscreen toggle or an orientation change cannot
desynchronise where the player points from where the mallet goes. A round-trip
test covers five box sizes.

### Interruption: pause, never abort

**The opposite of Blobbi Dance, deliberately.** A rhythm game left in a hidden
tab silently accumulates misses against an audio clock that keeps running, so it
must abort. Air Hockey's clock *is* its loop: stop the loop and the match stops
exactly where it was, with nothing to reconcile on the way back. Losing a
three-minute match to an OS dialog would be hostile, and nothing is gained by it.

### Motion and colour

Every decoration — the puck trail, the contact ripples, the goal wash, the
countdown and goal-banner pop — is suppressed or reduced under
`prefers-reduced-motion`, and the game stays completely playable without them.
The two sides are told apart by hue *and* by position *and* by labelled text, so
no game state is communicated by colour alone; the outcome is stated as a word
("You win" / "Rival wins") before it is stated as a tint.

---

## 9. Tests

| File | What it protects |
| --- | --- |
| `physics.test.ts` | rebounds, speed band, strikes, anti-stick, goal detection, zone clamps, the no-tunnelling arithmetic, recovery |
| `match.test.ts` | the state machine, exactly-once scoring, post-goal reset, serve fairness, match completion, JSON round trip, determinism, and both mallets' bounds under 6,000 steps of hostile input |
| `ai.test.ts` | the opponent's limits (absolute) and its behaviour (as tendency), difficulty ordering, determinism |
| `balance.test.ts` | matches always finish, in an arcade session; the opponent both scores and can be scored on |
| `hockey-result.test.ts` | the result validates, serialises, and round-trips to its own summary |
| `useFixedStepLoop.test.tsx` | fixed stepping, framerate independence, the catch-up cap, clean teardown, no re-binding |
| `hockey-draw.test.ts` | the coordinate bridge in BOTH layouts: uniform fit, pointer round trip at five box sizes, player-end placement, no mirroring, shadow direction |
| `AirHockeyMachine.test.tsx` | the real controller, shell, reducer, simulation and loop: start → a really-played match → result → restart → close and reopen; pause; accessibility; the layout switch (and that it disturbs no match state); expanded mode; one loop across every presentation change; pointer capture loss and cancellation; and that the catalogue advertises only controls the table implements |

Nothing here asserts a pixel or waits for a real frame.

---

## 10. A note on the machine being reachable

A report that walking to the air hockey table sometimes ended in a room corner
without opening anything was reproduced and traced, and it is **not a product
defect**. In the automation window used to test it, `requestAnimationFrame` was
firing **8 times in 13 seconds** — the window was occluded, so the browser had
stopped compositing — and the walk animation, the arrival watcher and the stall
detector all run on it. Nothing moved because nothing was animating.

The walk target itself was measured live at (61.2497, 89.4004), exactly what the
machine registry computes, inside the walkable band, and untouched by
`constrainPosition`. Shimming `requestAnimationFrame` onto timers made the same
click open the machine immediately.

`arcade-machines-config.test.ts` now pins the two properties that would have made
the report a real bug: every anchor sits clear of its boundary's edge rather than
on it, and every anchor is derived from percentages alone so it cannot vary with
the viewport.

## 11. Known limitations

- **One table layout.** No obstacles, no power-ups, no two-player mode.
- **`hard` has no profile.** The structure supports one; the numbers have not
  been tuned or measured.
- **Synthesised sound.** Four oscillator blips, like the dance track — no audio
  asset, no licence, no download.
- **The balance harness plays the AI against a mirror of itself.** It is the only
  fair yardstick available without a human, but a mirrored controller is not a
  person: it is more precise and less imaginative than a player, so the numbers
  are a floor on playability rather than a model of it.
- **No spectator, replay or leaderboard.** The result carries a seed-derived
  match, so a replay would be possible later; nothing depends on that today.
- **No true fullscreen.** By choice — see §8. The expanded presentation covers
  the stage, which on a handheld is the screen.
- **The chosen layout is per-session.** It is React state on the controller, so
  it survives a replay and is forgotten when the machine is closed. The
  repository has `useLocalStorage`, so persisting it later is a small change;
  nothing today needs it.
- **Match-length figures come from simulated play.** A full match was played
  through the real UI and won 7-0, but the automation window's throttling makes
  wall-clock timing there unreliable, so the durations quoted in §5 remain the
  harness's. Real human timings are still worth collecting.
