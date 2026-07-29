# Pool

Status: **implemented and playable.** The arcade's third real game, and the
second one with physics.

> **Physics rewritten (Planck 1.5).** The first implementation shipped with a
> hand-written solver whose cushions were an unbroken rectangle while the picture
> showed pocket openings. Rebounds were wrong, balls stuck on pocket lips, and
> the table you saw was not the table you played. §3 is the replacement; §4
> covers what the migration did and did not touch.

It runs on exactly one machine — `arcade-pool-table`, game id `blobbi-pool` —
and nothing else in the arcade changed. The six generic cabinets still open a
catalogue that is still honestly empty, Blobbi Dance and Air Hockey are
untouched, and the shared lifecycle, loop, shell and launch rules were reused
without modification.

**It grants Arcade Tickets** (Arcade V1, client-trusted). See §8 — the join
point that section describes was exercised exactly as written.

Read alongside: [the arcade foundation](./arcade-foundation.md) for the shared
lifecycle, [the catalogue](./arcade-catalogue.md) for how a machine decides what
it is, and [Air Hockey](./blobbi-air-hockey.md) §2 for the dedicated-machine
pattern this game follows for the third time.

---

## 1. What was built

```
src/arcade/pool/                   pure: no React, no DOM, no Nostr
├── table.ts                       the numbers a ball is tuned by
├── pool-physics-geometry.ts       the SHAPE of the table: cushions, jaws, mouths
├── pool-physics-world.ts          the Planck adapter — the only file that imports it
├── physics.ts                     queries: the aim guide, blocked paths, placement
├── rack.ts                        the seeded legal rack + the PRNG
├── rules.ts                       groups, fouls, turn resolution — the rule book
├── ai.ts                          the rival: a shot planner, 2 difficulties
├── match.ts                       phases, turns, and where a shot is judged
├── pool-result.ts                 match → ArcadeGameResult (and back)
├── pool-audio.ts                  seven feedback sounds, no clock
└── pool-scenarios.ts              the 15 manual physics-review layouts

src/components/blobbi/arcade/pool/
├── PoolMachine.tsx                controller · joins the game to the arcade
├── PoolTable.tsx                  the playable surface · canvas + HUD + input
├── PoolPreview.tsx                start screen · rules, rival, controls
├── PoolResults.tsx                result screen
├── PoolSoundToggle.tsx            mute control
└── pool-draw.ts                   canvas rendering + the coordinate bridge
```

Everything else was a registry change and nothing more:

| file | change |
| --- | --- |
| `src/arcade/catalogue.ts` | Pool's entry became `playable`, gained controls and a duration |
| `src/lib/arcade-machines-config.ts` | the table's activation became `dedicated-game` |
| `src/components/blobbi/arcade/native-games.tsx` | a third renderer |
| `src/pages/DevArcade.tsx` | a "Pool (direct)" chip, so it can be reviewed without walking |

No shared module was modified. `useFixedStepLoop`, `useArcadeInterruption`,
`ArcadeGameShell`, `arcade-machine-state.ts` and `arcade-audio.ts` are used
exactly as they were.

---

## 2. The rules, in full

This is the whole game. It is deliberately shorter than real 8-ball, and every
omission is a choice.

1. The table starts with a legal rack: the 8-ball in the middle of the third
   row, one solid and one stripe in the back corners, the rest shuffled.
2. **The player always breaks.** No lag, no alternating break — one machine, one
   frame, and the interesting shot belongs to the person who walked up.
3. Solids and stripes stay **unassigned until the first legal pot after the
   break**. Balls potted on the break count for whoever later owns them, and
   assign nothing.
4. Pot one of your own and you **shoot again**.
5. Miss, pot only your opponent's, or foul, and your **turn ends**.
6. Every foul gives the incoming player **ball-in-hand**: the cue ball may be
   placed anywhere legal on the table.
7. The three fouls are **potting the cue ball**, **hitting nothing at all**, and
   **hitting the wrong ball first** (an opponent's ball, or the 8 before your
   group is gone).
8. The 8-ball may only be potted once **every ball in your group is already
   down** and you strike the 8 first. Potting it before that **loses**.
9. Potting the 8-ball legally **wins**.
10. Potting the 8-ball **and** scratching on the same shot **loses**, however
    clear your group was.

### The one exception

**The 8-ball on the break is not a loss.** It goes back on the foot spot and
play continues. Losing to a shot whose whole point is that you cannot control it
is the least fair thing an 8-ball game can do to a new player, and re-spotting
is what real rule sets do about it. A scratch on the same break is still a
scratch.

### Intentional simplifications

No called pockets, no called safeties, no rail-after-contact requirement, no
tournament break requirement, no push-out, no three-foul rule, no kitchen
restriction after a scratch, and no penalty for a ball leaving the table (the
cushions make it impossible). Every one of them is a real rule, and every one
needs a paragraph of explanation before a player can avoid breaking it by
accident.

Two consequences worth stating because a pool player will notice them:

- **Potting your last group ball and the 8 on the same stroke loses.** That is
  the standard reading of rule 8, and the rule list says so.
- **A shot that drops one of each group on an open table is assigned by the
  FIRST ball down.** Never ambiguous, and never a question the player is asked.

The full rule set lives in the module header of `src/arcade/pool/rules.ts`, and
`rules.test.ts` covers every branch of it.

---

## 3. Physics

**Engine: [Planck](https://piqnt.com/planck.js/) 1.5.0** — a TypeScript port of
Box2D 2.4. MIT, no runtime dependencies, first-party type declarations, a
synchronous constructor and an ESM build Vite consumes without a plugin.

### Why Planck, and not the others

| | Planck 1.5 | Matter.js 0.20 | Rapier 2D 0.19 |
| --- | --- | --- | --- |
| licence | MIT | MIT | Apache-2.0 |
| types | first-party `.d.ts` | DefinitelyTyped only | first-party |
| circles | **true circle shape, exact manifold** | polygon approximation (25-gon) | true ball shape |
| init | synchronous | synchronous | **async WASM** |
| Vite | plain ESM import | plain ESM import | needs a WASM plugin, or a base64 build |
| bundle (gzip) | 46 kB | ~25 kB | 150 kB+ |

Two things decided it, and both are about **circles**:

- A pool game lives or dies on the collision normal being the real line of
  centres. Matter.js approximates a circle as a polygon, which produces exactly
  the faceted, slightly-wrong rebound this rewrite was commissioned to fix.
- Box2D's sequential-impulse solver with position correction handles the fifteen
  simultaneous contacts of a rack without the cluster exploding.

Rapier's solver is at least as good; it was rejected on integration cost. It
would have meant WebAssembly, an `await init()` before a world can exist, and
either a Vite plugin this repository does not have or a base64-inlined build
three times Planck's size — to replace a synchronous one-line constructor.

Matter.js was the only serious bundle argument (≈21 kB gzip cheaper) and it lost
on the circle approximation, which is the defect, not a detail.

### What Planck costs the toolchain

Two things came with the dependency that are not about physics at all.

**Node 24 LTS is now the project's floor.** Planck 1.5.0 declares
`engines: { "node": ">=24.0" }`, so the repository standardised on Node 24 rather
than working around it. `.nvmrc` pins `24.18.0` (Krypton, the current LTS),
`package.json` declares `engines.node: ">=24 <25"`, and both GitHub workflows read
`node-version-file: .nvmrc` so there is one source of truth; `.gitlab-ci.yml` pins
`node:24.18.0` by hand because a job image cannot read a version file. Nothing
suppresses the requirement — on Node 22 `npm ci` warns `EBADENGINE` for both
`planck` and the root package, which is the intended signal. Node 23 is excluded
too, and correctly: it is an odd-numbered line that never became LTS.

**`stage-js` is resolved but never shipped.** Planck declares
`peerDependencies: { "stage-js": "^1.0.0-alpha.12" }` with no
`peerDependenciesMeta`, so npm treats it as required and installs `stage-js@1.0.1`
into the tree. It is only needed by `planck/with-testbed`, Planck's debug renderer.
This repository imports the `planck` root entry (`dist/planck.mjs`) and nothing
else, and that build is fully self-contained — it has no import statements at all.
Measured against the generated bundle: every string unique to stage-js
(`textureAlpha`, its `back-out-in` / `bounce-out-in` easing names, `MAX_ELAPSE`)
is absent from `dist/`, and no file under `src/` mentions it. It contributes zero
bytes to production. It is left in place rather than overridden away, because
removing a declared peer to tidy a graph that is already valid buys nothing and
breaks `npm ls`. Neither `planck` nor `stage-js` contributes an `npm audit`
advisory.

### The table's shape

`pool-physics-geometry.ts` is the single description of the table. The physics
world builds its bodies from it, the renderer draws it, and the aim guide
queries it — so there is no second copy to drift.

```
        nose                                  nose
          ●━━━━━━━━━━ cushion ━━━━━━━━━━━━━━━━━●          ← y = 0, cloth above
         ╱                                      ╲
        ╱  facing splays away from the pocket    ╲        ← the JAW
       ●──────────── cushion back ────────────────●       ← y = −5.5

   ◄── mouth ──►                                  ◄── mouth ──►
   (a real gap: no body, no fixture, nothing)
```

**Six cushion polygons, six real openings.** Two per long rail, one per short
rail. Nothing spans a pocket mouth. Each cushion end is cut on an angle so the
opening widens with depth — a real pocket facing — which is what makes a ball
that catches a jaw deflect rather than stop dead.

| | value | |
| --- | --- | --- |
| corner mouth | 12.7 units | ≈ 2.3 ball diameters (a real table is ≈ 2.0) |
| side mouth | 13.2 units | ≈ 2.4 ball diameters |
| cushion depth | 5.5 units | outside the cloth |
| corner facing / side facing | 3.2 / 2.2 units | the jaw angle |

### Pocket capture: a mouth plane, not a circle

**A ball is pocketed when its centre crosses the mouth plane** — the straight
line between the two cushion noses — by 0.5 units, within the mouth's own width
plus 2 units of slack.

Not a circle around the pocket, and the reasons are the three reported bugs:

- The drawn well is the part of a circle **beyond that same chord**, so *the dark
  region on screen is the capture region.* A ball that looks in, is in.
- A circle cannot cover the full width of the mouth at its edges without also
  reaching back onto playable cloth. The old one did not, so a ball entering near
  a jaw fell through into nothing.
- It gets the rail-runner asymmetry right for free. Past a **corner** a ball on
  the cushion drops, because the corner's mouth plane cuts across its path; past
  a **side pocket** it does not, because that mouth plane lies along its path and
  it never crosses it. That is how a real table plays, and no capture radius can
  express it.

This is the "equivalent non-solid detection region" the brief allows in place of
a sensor fixture. A sensor was considered and rejected: a half-space slab is not
expressible as a circle fixture, and Box2D sensor callbacks report *fixture
overlap* rather than *centre containment* — so a sensor would have needed this
same test afterwards anyway, with an extra frame of latency in between.

A backstop exists under it: a ball more than `CUSHION_DEPTH + CORNER_MOUTH + 6`
units outside the table is credited to the nearest pocket and logged as a
recovery. Nothing should ever reach it.

### Units

The game thinks in table units (200 × 100, ball radius 2.8). Box2D is tuned for
metres and its tolerances are **absolute**. The world therefore runs at
**0.1 m per table unit** — a 20 × 10 m table with 0.28 m balls — and the adapter
converts at the boundary. That scale was chosen so that **no Planck global has to
be mutated**:

| tolerance | default | in table units | verdict |
| --- | --- | --- | --- |
| `linearSlop` | 5 mm | 0.05 | 1.8% of a ball's radius — invisible |
| `maxTranslation` | 2 m/step | 20/step | our worst case is 1.6 |
| `velocityThreshold` | 1 m/s | 10 u/s | below it contacts are inelastic — and a ball under 10 u/s stops within 2 units anyway |

### Tuning

| | value | why |
| --- | --- | --- |
| gravity | `(0, 0)` | it is a table seen from above |
| ball shape | true circle, r = 0.28 m | exact manifolds; see above |
| mass | equal, density 1 | only the ratio matters, and it is 1 |
| `fixedRotation` | true | no spin is modelled, so angular momentum would only leak energy into a rotation nothing draws |
| `bullet` | true | CCD. Not needed at 0.16 m/step against a 0.56 m diameter, but free for sixteen bodies and a tunnelled ball is unrecoverable |
| ball↔ball restitution | 0.95 | near-elastic, as polished resin is |
| ball↔cushion restitution | 0.74 | cloth over rubber |
| friction | 0 everywhere | no spin |
| velocity / position iterations | 8 / 8 | position raised from Box2D's 3: three passes leave the back of a rack visibly interpenetrating for a few frames after a break, and 8 costs ≈0.1 ms a step |
| fixed step | 1/120 s | unchanged from before the migration |

**Restitution is set per contact**, in a `pre-solve` listener. Box2D mixes two
fixtures' values with `max`, so without the override a ball (0.95) touching a
cushion (0.74) would rebound at 0.95 and the table would play like a trampoline.

**Rolling friction is ours, not the engine's.** `linearDamping` is zero and a
constant deceleration is applied after each step. Damping is exponential and
never actually stops a ball — and "every ball has stopped" is the event the whole
turn structure hangs off. It also keeps `d = v² / 2a` true, which is the model
the AI's power calculation is built from, so the migration did not have to retune
the opponent.

### Settling

A domain rule, not the engine's sleep:

> Every ball's speed is zeroed below 1.4 u/s by the friction step, and the table
> counts as settled once **every ball has been stopped for 6 consecutive steps**
> (50 ms at 120 Hz).

The hard stop makes "stopped" exact rather than asymptotic. The six-step hold is
not there to wait for slow balls — it is there so that a ball momentarily
stationary between two frames of a contact being resolved cannot end the shot
early. `MAX_SHOT_MS` (22 s) remains as a backstop; a real shot cannot reach it.

### Performance

Measured headlessly over 20 full-power breaks on a full rack — 8,539 steps,
averaging 427 steps (3.6 s) per break — timing `step` + `drain` + `snapshot`:

| | |
| --- | --- |
| mean | **0.026 ms** |
| p50 / p95 / p99 | 0.020 / 0.051 / 0.133 ms |
| worst single step | 2.96 ms (the first step of the first run — JIT warm-up) |
| budget at 120 Hz | 8.33 ms |

So the simulation uses about **0.3% of its step budget**, and even the warm-up
outlier stays inside it.

## 4. The shot lifecycle

```
  ready ──1.5s──► aiming ──shot──► rolling ──settle──► banner ──┬─► aiming
                     ▲                                          ├─► ball-in-hand
                     │                                          ├─► thinking ──► rolling
  ball-in-hand ──place┘                                         └─► over
```

Two entry points, and the split matters. `stepPoolMatch` advances time and is
the only thing that moves a ball. `applyPlayerShot`, `placePlayerCueBall` and
`dragPlayerCueBall` are the player's discrete actions, and each **refuses
outright** unless the match is in the phase that allows it — which is where "no
input while balls are moving" is actually guaranteed. The UI also disables the
controls; a disabled control is a courtesy and this is the rule.

### The adapter boundary

Every one of those takes a `PoolPhysicsWorld`. **The match does not own the
simulation and does not contain it.** `PoolMatchState` stays a plain JSON value —
phases, timers, group ownership, statistics and a *snapshot* of the balls — while
the Planck bodies live in the world the caller passes in. `PoolTable.tsx` builds
one per run and disposes it on unmount.

```
PoolTable ──owns──► PoolPhysicsWorld ──wraps──► Planck
    │                     ▲
    └──── match.ts ───────┘   step / drain / snapshot / strike / setBall
             │
             ├── rules.ts   ← a ShotRecord of observations. Never sees the world.
             ├── ai.ts      ← ball snapshots in table units. Never sees the world.
             └── pool-result.ts
```

The adapter exposes nine verbs — `reset`, `setBall`, `strike`, `step`, `drain`,
`snapshot`, `isSettled`, `resetSettling`, `dispose` — all in table units. No
`Body`, `Fixture` or engine vector escapes it, which is why swapping the solver
touched neither the rules, the AI, the result contract nor the UI.

**Physics reports facts; the rules decide consequences.** `drain()` returns
contacts, cushion hits, pockets and recoveries; `match.ts` folds them into a
`ShotRecord` (first ball contacted, balls potted in order, whether the cue ball
scratched); `resolveShot` is asked once, when the world says the table has
settled. No 8-ball rule lives in an engine callback.

**A shot is resolved exactly once.** Resolution happens on the single transition
out of `rolling`, calls `resolveShot` once, and lands in `banner` — a phase that
cannot resolve anything. There is no incremental scoring, no per-step foul flag,
and no second place a turn can change.

---

## 5. Controls

### The gesture

One rule, the same for a mouse and a finger:

> **Press anywhere and drag. The cue aims AWAY from your finger, and how far you
> pull is how hard you hit. Let go to shoot.**

Everything useful falls out of that rather than being bolted on:

- **Aiming and power are one gesture**, so there is no mode to be in and no
  second control to find. Pulling a stick back and releasing it is a thing hands
  already know how to do.
- **A tap is a re-aim, not a shot.** A drag shorter than `MIN_SHOT_POWER` does
  not fire, so tapping behind the ball simply points the cue. That is the
  discoverable way in for a player who has not worked out the pull yet, and it
  is also the guard against an accidental shot while the dialog is opening or
  the phone is being turned.
- **Your finger is behind the ball, not on the target.** On a phone that is the
  difference between seeing the shot and covering it.

### Keyboard

Advertised in the catalogue, so it is complete. Left/right swing the cue,
up/down set the power, space or enter shoots, escape puts the cue down. During
ball-in-hand the arrows slide the cue ball and space or enter confirms it.

### Ball-in-hand

Drag the cue ball anywhere — the drag deliberately follows the finger even
somewhere illegal, because a ball that refuses to go where you point feels
broken long before the player works out why. A **"Place cue ball"** button
confirms, and an illegal position is snapped to the nearest legal one rather
than refused. Pressing the button without dragging at all works and puts the
ball somewhere legal, which is the safe default for a player who has not
understood the interaction.

### What the guide shows

Three marks, and no more: a dashed line to the first thing in the cue ball's
way, a ghost ball at the point of contact, and a short arrow showing which way
the struck ball would set off. The third is exact rather than approximate,
because the collision carries no spin.

It deliberately does **not** show how far the object ball travels, whether it
reaches the pocket, where the cue ball ends up, or anything past the first
contact. A guide that answers "does this shot go in?" has played the shot for
the player. The one exception is a red ring when the cue ball is headed straight
down a pocket — the mistake a beginner cannot see coming.

---

## 6. The rival

A **shot planner**, called exactly once when its turn begins. It returns a plan —
an angle, a power, and optionally where to put the cue ball — which the match
then plays through the *same* strike path a human's drag produces.

That structure is the whole safety argument: there is no "AI mode" in the physics
and no branch in the rules that asks who is shooting. It cannot move a ball,
cannot exceed the player's power, cannot re-aim once committed, and is judged by
the same `resolveShot` the player is.

### How it thinks

1. **Legal targets** — whatever the rules allow it to strike first.
2. **Every target against every pocket** — ninety pairs at most.
3. **The ghost ball** — where the cue ball's centre must be for the object ball
   to set off toward that pocket. That single construction is all of pool aiming.
4. **Rejections** — a cut too thin, a ghost ball off the cloth, a blocked path
   to the ghost, a blocked path to the pocket.
5. **A score** — favouring straight shots over thin cuts and short pots over
   long ones, and penalising a shot that would scratch afterwards.
6. **Error** — the chosen shot's angle and power are then knocked off target.
7. **A fallback** if nothing survived.

### Why it is beatable

Because the error is applied **after** the search, it aims at the right place
and then misses by a human amount. That is a much better failure mode than
picking a worse shot: it misses the pots a person misses (long ones, thin ones)
and makes the ones a person makes, so a run of three or four pots feels earned
and the miss that ends it looks like a miss rather than a decision.

| | Easy | Normal |
| --- | --- | --- |
| aim error (half-width) | 0.055 rad (~3.2°) | 0.019 rad (~1.1°) |
| power error | ±26% | ±11% |
| thinnest cut attempted | 63° | 77° |
| ranking noise | 26 | 8 |
| scratch aversion | 10 | 45 |
| thinking time | 950 ms | 720 ms |
| ball-in-hand placements tried | 5 | 12 |

Measured over 40 seeded frames with the planner in both seats: a Normal player
beats an Easy rival about 68% of the time and a Normal rival about 58%. The pot
rates are 15% and 18% of all shots — the rest are legal knocks with nothing on.

### Two things learned by playing it against itself

Both were invisible to unit tests and are now pinned by `balance.test.ts`.

- **The break is not a shot the pot search can find.** Every ball in an intact
  rack is screened by the one in front of it, so the search correctly rejects
  all ninety pairs and falls through to the fallback. The break is therefore a
  separate, explicit shot.
- **The fallback has to hit THROUGH the ball.** The first version played it at
  whatever speed just reached the target, which is a tap. Two planners tapping
  at each other never dislodge anything: the first run measured **five hundred
  consecutive scoreless shots** on a rack that was never broken.

---

## 7. Presentation

### Two layouts, one simulation

| where | box | layout |
| --- | --- | --- |
| desktop, inside the arcade frame | ~956 × 382 | landscape, break end on the left |
| phone upright, expanded | ~390 × 700 | portrait, break end at the bottom |
| phone sideways, expanded | ~740 × 350 | landscape |

Chosen from the **measured container**, never from a user-agent string, so
rotating a phone re-answers the question. Both transforms are proper rotations
(determinant +1), never mirrors, so a rebound on screen is the rebound the
simulation computed and a shot aimed at a pocket goes to that pocket in both.
Ball numbers are counter-rotated so they stay upright.

A 2:1 table fitted landscape into an upright phone is 390 × 195 — a quarter of
the screen, with the balls too small to tell apart. Turned a quarter it is
350 × 700, nearly four times the playfield.

### The table box fills its container

This is the one place Pool deliberately differs from Air Hockey. Air Hockey uses
an aspect-locked element; with `height: 100%` definite and `width: auto` from
`aspect-ratio`, `max-width: 100%` clamps the width **without** reducing the
height, so the element stretches whenever its ratio disagrees with its box —
which is what happens for the frame or two between a device rotating and the
measurement catching up.

For Pool that is not cosmetic. A stretched table means a pointer position no
longer maps back to a table unit the simulation agrees with, so the shot leaves
at a different angle from the one the guide drew. `fitTable` already computes a
uniform scale and letterboxes, so letting it own the fit makes distortion
**impossible** rather than merely unlikely: a mismatched orientation costs a
small table for one frame instead of a wrong one. The wooden frame is drawn into
the canvas, so the picture is unchanged.

### The HUD

Whose turn it is, each side's group, how many balls each has left, the status
line, the last event's banner, and the balls already down. All of it is text in
the DOM above the canvas — the canvas is `aria-hidden` — so nothing a player
needs to read lives inside the picture, and nothing is communicated by colour
alone. On a container wide enough for it the HUD moves beside the table rather
than above it, which is where the desktop's wasted width was going.

### Sound

Seven short feedback sounds through the one shared arcade `AudioContext` and the
one persisted mute setting. The simulation would play identically in silence.

**A break is forty collisions in a fifth of a second**, and one click each is a
burst of white noise that clips the bus. Two defences, at two levels: the table
component keeps only the hardest contact of each frame and calls the engine
once, and the engine refuses a second click within 32 ms whatever the caller
does. A break therefore sounds like a break.

---

## 8. Rewards (Arcade V1, client-trusted)

Pool grants **Arcade Tickets**. `POOL_REWARD_POLICY` in
`src/arcade/pool/pool-reward.ts` is `active`, the catalogue says
`grantsTickets: true`, and `PoolMachine` carries the same claim wiring as the
other two dedicated machines — the shared `useArcadeRewardController` hook
driving the shared `ArcadeRewardPanel` on the results screen. The simulation in
`src/arcade/pool/` still imports no inventory, relay or Nostr module;
`boundaries.test.ts` checks that against the real import graph. The trust model,
the shared economy table and the exactly-once claim rules live in
[`arcade-reward-publication-boundary.md`](./arcade-reward-publication-boundary.md)
§7.

The policy's numbers (v1, flat shape — same reasons as the dance policy):

| line | tickets |
| --- | --- |
| completed frame (natural end) | 2 |
| victory | +3 |
| Normal rival (on a victory) | +1 |
| legal 8-ball finish (you potted it properly) | +1 |
| clean frame (no scratches, no fouls; on a victory) | +1 |
| **maximum** | **8** |
| completed loss — outdrawn, or your own early 8 (shared floor) | 2 |
| abandoned frame (no result exists) | 0 |

Balls pocketed, shots taken, duration and the longest run are deliberately not
inputs — every one of them grows with time at the table, and paying for any of
them makes the dominant strategy a long frame of harmless safety shots. Fouls
cost the clean-frame bonus and nothing more; no award is ever negative. The
numbers are pinned by `pool-reward.test.ts` and cross-checked against the other
games by `reward-economy.test.ts`.

**Playable and paying tickets are independent facts.** `grantsTickets` is a
statement about whether an active reward policy exists, not about whether a game
is finished, and `catalogue.test.ts` asserts the two agree in both directions.

The join point the policy reads is one object. The `ArcadeGameResult` handed to
`dispatch({ type: 'finish' })` carries everything it wants:

| stat | meaning |
| --- | --- |
| `won` / `completedNaturally` | outcome, and whether the frame actually finished |
| `playerBallsPocketed` / `opponentBallsPocketed` | the frame's margin, in balls |
| `remainingOpponentBalls` | how close the rival got |
| `playerShots` / `playerSuccessfulShots` | how efficiently it was won |
| `longestPlayerRun` | the best sequence of pots |
| `playerScratches` / `opponentScratches` / `playerFouls` | how cleanly |
| `legalEightFinish` / `earlyEightLoss` | how it ended |
| `playerGroup` | solids, stripes, or the table never opened |
| `durationMs` | |

`score` is the player's own balls potted (0–7) and `cleared` is a **win**, not a
completion — losing 7–0 is a completed frame and an uncleared one.

Enabling the reward was exactly the promised move: a policy registered in
`reward-policy.ts`, `grantsTickets` flipped, and the shared claim wiring added
to the controller. **No change to the simulation or to this game's result
shape** — the one new file in `src/arcade/pool/` is the pure policy itself.

---

## 9. Tests

331 tests, in ten files.

| file | covers |
| --- | --- |
| `pool/pool-physics-world.test.ts` | **the engine**: world creation, zero gravity, equal mass, reset and dispose, the 90° rule against the real solver, chains and clusters, cushion restitution measured across the contact, every pocket slow and fast, mouth-edge entry, jaw rejection, the rail-runner asymmetry, one event per collision, settling, a full break, determinism, and that the physical table matches the described one |
| `pool/pool-scenarios.test.ts` | the 15 review layouts are all legal, settle, and — for the six that can be judged automatically — do what their sentence says |
| `pool/physics.test.ts` | the queries: the aim guide, blocked paths, legal placement, mouth crossings, NaN recovery, overlap separation, cue power |
| `pool/rules.test.ts` | every branch of `resolveShot` — break, assignment, continuing, every foul, all four 8-ball endings — and the rack's legality |
| `pool/match.test.ts` | phases, exactly-once resolution, exactly-once pocketing, settle-before-resolve, ball-in-hand, the 8-ball re-spot, determinism, pausing, recovery |
| `pool/ai.test.ts` | legal targets only, a finite legal plan from every layout, shot preference, difficulty error, determinism under a seed, and that it never mutates a ball |
| `pool/pool-result.test.ts` | the arcade contract, validation, JSON, the round trip, and that nothing reward-shaped is in it |
| `pool/balance.test.ts` | whole seeded frames: they end, they take about three minutes, the rival is beatable |
| `pool/pool-draw.test.ts` | the coordinate bridge — the inverse round-trips, both layouts are rotations not mirrors, numbers stay upright |
| `pool/PoolMachine.test.tsx` | the real controller, shell, reducer, simulation and loop: the pointer lifecycle, the minimum-shot threshold, cancellation, lost capture, multi-touch, keyboard, pause, resize, leaving, replay, one loop only |

`balance.test.ts` is the one that matters most and the one a unit-test-only suite
would not have: it is what found the five-hundred-shot stalemate, and it is what
would find it again.

### Regression coverage for the reported defects

The four problems this rewrite was commissioned for each have a test that fails
if they come back:

| reported | test |
| --- | --- |
| a ball visibly entering a pocket, rejected by an invisible cushion | `pool-physics-world.test.ts` → "swallows a ball entering near the edge of a mouth" (every pocket, 60% of the way to a jaw) |
| a ball not entering a side pocket at modest speed | → "swallows a ball rolled into either side pocket" (50, 120 and full power) |
| an angled collision rebounding wrongly | → "obeys the 90° rule closely enough to aim by" (within 0.12 rad of the line of centres) |
| a break with simultaneous contacts going unstable | → "scatters, settles, and keeps every ball accounted for" plus "keeps a four-ball cluster stable" |

### Manual review scenarios

`pool-scenarios.ts` holds the fifteen layouts from the migration brief, and
`/dev/arcade` renders each one **in the real game** under "Pool physics review":
straight and thin-cut collisions, a three-ball line, a cluster, a full break, all
four pocket approaches, both jaw grazes, a rail run past a side pocket, a
scratch, a frozen rail ball, two balls touching, and a maximum-power shot. Each
chip sets the table up and prints the sentence to check against.

---

## 10. Known limitations

- **No spin, and no cue-ball position play.** Deliberate (§3), and the biggest
  gap between this and a serious pool game.
- **Pockets are generous.** The mouths are about 2.3 ball diameters against a
  real table's 2.0, and capture begins half a unit past the mouth plane. Kinder
  than a real table, deliberately.
- **Bundle cost.** Planck adds 209.34 kB raw / 46.18 kB gzipped, in its own
  `physics` chunk. That chunk is *not* in `index.html`'s modulepreload set, so the
  landing page does not pay for it; it arrives with the `BlobbiIsland` and
  `PlayingView` route chunks. Within the world, though, Pool is not lazy-loaded —
  anyone who opens the island downloads it even if they never walk to the pool
  table, because `native-games.tsx` deliberately imports its games statically, and
  a dynamic import there is a change to the launch resolver's security story
  rather than a tweak.
- **No pocket "bag".** A ball that crosses a mouth plane is captured on the same
  step, so nothing is modelled behind the mouth. A ball cannot rattle in the jaws
  and drop a moment later; it either enters or it does not.
- **Only two difficulties.** Hard is left out rather than shipped untuned.
- **The rival plays no positional safeties.** Its fallback is an honest knock,
  not a snooker.
- **The aim guide stops at the first contact.** Deliberate (§5).

### Recommended follow-ups

1. A short post-contact cue-ball line, difficulty-gated, for players who want it.
2. Lazy-load the arcade's games so Planck is only fetched by someone who walks to
   the pool table. It needs a decision about `native-games.tsx`'s
   static-import rule first.
3. A pocket bag, so a ball can rattle in the jaws before dropping.
4. A Hard rival, once there is play data to tune against.
5. A shot clock, if frames against a deliberating human run long.
6. Reward policy, when the ticket economy is ready — see §8.
