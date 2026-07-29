# Blobbi Island — Arcade Machines and the Shared Catalogue (Phase 4)

> **What changed in one sentence.** The six generic cabinets now open a shared
> catalogue; the dance machine, the pool table and the air hockey table stay
> dedicated to their own game, and every arcade surface renders inside the game
> window rather than over the browser page.
>
> **Since then:** the air hockey table's game shipped, so its activation is now
> `dedicated-game` rather than `dedicated-preview`. The rule this document
> establishes is unchanged — a dedicated machine is one game and can never be
> another — and the tables below are updated. See
> [`docs/blobbi-air-hockey.md`](./blobbi-air-hockey.md).

Phase 2 built the arcade's foundation (`docs/arcade-foundation.md`) and Phase 3
built its first game (`docs/blobbi-dance.md`). Both were shaped by a rule that
made sense while exactly one game existed: `ArcadeMachineConfig.gameId` said what
a cabinet ran, and eight of the nine cabinets said `null`.

## 0. The correction, and why it was needed

The first Phase 4 pass replaced that rule with a worse one: **every** machine
opened the shared catalogue. That fixed the six interchangeable cabinets and
broke the three machines that are not interchangeable.

The arcade is not nine boxes with screens. It is:

- **six generic cabinets** — pink, black, classic, green, purple, red — whose
  screens can show anything, so they show a list;
- **three dedicated machines** — a dance pad, a pool table, an air hockey table —
  each of which *is* one physical game and can never be another.

Sending all nine to one catalogue produced three concrete defects:

1. A **pool table opened a menu** and said nothing about pool. Its own
   coming-soon copy, written in Phase 2, stopped being reachable.
2. **Blobbi Dance was launchable from any cabinet**, so a run's `machineId` —
   the value a ticket claim records as "where this happened" — could be a pool
   table's.
3. The catalogue **used Blobbi Dance to look full**. A player at a pink cabinet
   was offered a game that lives two floors down.

The root cause was an architectural rule ("a machine owns no game") applied as a
universal, when it was only ever true of the generic six. Machine behaviour is
now an explicit, discriminated field rather than an inference.

---

## 1. The audit this phase started from

Read before editing: the machine registry, `ArcadeRoom`, `ArcadeMachinePanel`,
`ArcadeGameShell`, the lifecycle reducer, the interruption hook, `DanceMachine`,
`/dev/arcade`, and the arcade tests and docs. What that found:

| Question | Answer before Phase 4 |
| --- | --- |
| How does a cabinet click select a machine? | `ArcadeMachine` computes a walk target from the live rect → `requestInteraction` → **on confirmed arrival** → `onActivate(machineId)` → `ArcadeRoom.handleMachineArrival`. Nothing opens on click. |
| Where was `gameId` stored? | On the machine, in `arcade-machines-config.ts`. Also carried in lifecycle state, set from the machine at `open`. |
| Did the lifecycle assume one game per machine? | Only through its CALLER. The reducer takes `machineId` and `gameId` as independent fields on `open`; the room happened to derive the second from the first. **The reducer needed no change.** |
| What closed the machine panel? | `ArcadeRoom.closeShell` — `dispatch({type:'close'})` plus clearing a local `target`. The shell's `open` was `lifecycle.status !== 'closed'`. |
| How was Dance mounted? | `ArcadeRoom` found the open machine whose `gameId === BLOBBI_DANCE_GAME_ID` and rendered `<DanceMachine>`, which brings its own `ArcadeGameShell`. |
| How were coming-soon machines represented? | `gameId: null` + `availability` + `blurb` on the machine, rendered by `ArcadeMachinePanel` inside the generic shell. |
| What could become catalogue-level? | Game identity, category, availability, controls, duration, ticket eligibility, and every word of product copy about a GAME. |
| What stays machine-level? | Id, floor, artwork, accessible name, placement, z-index, interaction anchor. |

The headline finding: **`gameId` on a machine had become a second source of truth
about what is playable**, and the first thing a second source of truth does is
disagree.

The first pass removed it — and `availability` and `blurb` with it — and replaced
it with nothing, which is how a pool table became a menu. The corrective pass
replaced all three with **one** field, `activation`, that says what a machine
does in a form a type-checker and a test can both read.

---

## 2. The domain model

Two registries, and keeping them apart is the point.

### The machine registry — `src/lib/arcade-machines-config.ts`

```ts
type ArcadeMachineActivation =
  | { type: 'shared-catalogue' }                        // a generic cabinet
  | { type: 'dedicated-game';    gameId: string }       // this machine IS this game
  | { type: 'dedicated-preview'; experienceId: string }; // …and it is not built yet
```

One discriminated field per machine, and `ArcadeRoom.handleMachineArrival` is a
single `switch` over it with no other branch — no test on an id, a filename, a
display name or a piece of artwork. That is what makes "a pool table opens pool"
a property of the data rather than a convention a component happens to follow.

| machine | floor | display name | activation |
| --- | --- | --- | --- |
| `arcade-dance-machine` | basement | Blobbi Dance Machine | `dedicated-game` → `blobbi-dance` |
| `arcade-pool-table` | floor-1 | Pool Table | `dedicated-preview` → `blobbi-pool` |
| `arcade-air-hockey` | floor-1 | Air Hockey Table | `dedicated-game` → `blobbi-air-hockey` |
| `arcade-cabinet-pink` | floor-1 | Pink Cabinet | `shared-catalogue` |
| `arcade-cabinet-black` | floor-1 | Black Cabinet | `shared-catalogue` |
| `arcade-cabinet-classic` | floor-1 | Classic Cabinet | `shared-catalogue` |
| `arcade-cabinet-green` | floor-1 | Green Cabinet | `shared-catalogue` |
| `arcade-cabinet-purple` | floor-1 | Purple Cabinet | `shared-catalogue` |
| `arcade-cabinet-red` | floor-1 | Red Cabinet | `shared-catalogue` |

Ids, floors, artwork, z-indexes, interaction anchors and movement behaviour are
unchanged. No asset changed.

**The dance machine's name.** It was "Dance Dance Blobbi", the first pass renamed
it "Dance Pad Cabinet" to satisfy the universal rule, and it is now **"Blobbi
Dance Machine"**. A dedicated machine should be findable by reading the room, so
it is named for the game it hosts — and named the *same* as that game, because
having a cabinet called "Dance Dance Blobbi" host a game called "Blobbi Dance"
was a second name for one thing. A test forbids a generic cabinet being named
after any game, and forbids the dance machine losing its game name.

### The game registry — `src/arcade/catalogue.ts`

Pure data. No React, no hooks, no components, no Nostr, no relay, no package URL,
no reward arithmetic. `catalogue.test.ts` asserts those absences **against the
module's own source**, so "the registry stayed pure" is checked rather than
promised.

```ts
type ArcadeGameCategory     = 'island' | 'guest';
type ArcadeGameAvailability = 'playable' | 'coming-soon' | 'disabled';
type ArcadeGameLaunchMode   = 'native' | 'guest-runtime';
type ArcadeGameHost         = 'shared-cabinet' | 'dedicated-machine';
type ArcadeGameSource       = 'blobbi-internal' | 'adapted-open-source' | 'external-publisher';

interface ArcadeCatalogueEntry {
  id: string;                 // stable; the SAME id the lifecycle, result, reward
                              // policy and claim ledger use. Never an alias.
  title: string;
  shortDescription: string;   // what the player DOES, in one sentence
  category: ArcadeGameCategory;
  availability: ArcadeGameAvailability;
  launchMode: ArcadeGameLaunchMode;
  host: ArcadeGameHost;
  machineIds?: readonly string[];  // required and non-empty when host is dedicated
  grantsTickets: boolean;     // a fact about the game, never an amount
  controls: readonly ArcadeCatalogueControl[];
  estimatedDurationMs?: number;
  thumbnail?: string;         // local /assets path only
  badge?: string;
  source: ArcadeGameSource;
}
```

### Global registry versus cabinet catalogue

`ARCADE_CATALOGUE` is **every game the arcade knows about**. What a generic
cabinet offers is a strictly smaller thing:

```ts
sharedCabinetCatalogue()   // host === 'shared-cabinet' && availability !== 'disabled'
dedicatedGamesForMachine(machineId)
```

Conflating the two is what put Blobbi Dance in front of a pink cabinet. They are
now different functions with different names, and a test asserts
`sharedCabinetCatalogue()` never contains `blobbi-dance`.

### Contents

| id | title | category | availability | host | machines | tickets |
| --- | --- | --- | --- | --- | --- | --- |
| `blobbi-dance` | Blobbi Dance | island | playable | dedicated | `arcade-dance-machine` | yes |
| `blobbi-pool` | Pool | island | coming-soon | dedicated | `arcade-pool-table` | no |
| `blobbi-air-hockey` | Air Hockey | island | playable | dedicated | `arcade-air-hockey` | no |

**`sharedCabinetCatalogue()` is empty.** That is the honest product state, and
the catalogue screen is designed around it (§7). It is not padded out.

### Design decisions worth stating

- **`machineIds` is now load-bearing.** It was an optional, unused field in the
  first pass — which is precisely why the rule it was meant to express was
  enforced nowhere. It is the input to `canLaunchArcadeGame`, required for every
  dedicated entry, and cross-checked against the machine registry by a test.
- **`disabled` exists as well as `coming-soon`.** A withdrawn game is not "coming
  soon", and showing it as one is a small lie repeated on every visit.
- **`grantsTickets` is a fact, not a promise.** It means "an active reward policy
  has been approved for this game". How much a run is worth is still
  `reward-policy.ts`'s sole business.
- **`estimatedDurationMs` is read from the track**, not written out again, so a
  screen cannot drift away from the song it describes.
- **The registry and every entry are frozen.**

### Category definitions

**Island Games** are part of Blobbi Island. They run inside the app, use the
shared arcade lifecycle, return a validated `ArcadeGameResult`, and may grant
Arcade Tickets through the existing reward boundary.

**Guest Games** are curated packages made by other people. They will run in a
restricted, Blobbi-owned runtime with **no signer, no inventory, no coins, no
profile and no Arcade Ticket access**. None exists, and nothing in this phase
downloads, parses or executes one.

Category is a **trust boundary**; `host` is a **placement** rule. They are
independent, and `canLaunchArcadeGame` checks both.

---

## 3. Launch: `canLaunchArcadeGame` and the resolver

`canLaunchArcadeGame` in `catalogue.ts` is the single answer to "may this game
start, here, from this kind of screen?".

```ts
canLaunchArcadeGame({ game, machineId, surface }): boolean
//   surface: 'shared-catalogue' | 'dedicated-machine'
```

Three rules, all of which must hold:

1. **`isNativeLaunchable`** — an island game, a `native` launch mode, and
   `playable`. A guest game is refused on CATEGORY first, before launch mode is
   even considered, so a guest entry mislabelled `launchMode: 'native'` and
   `availability: 'playable'` still fails.
2. **A dedicated game only starts on its own machine.** Blobbi Dance names
   `arcade-dance-machine` and nothing else, so a generic cabinet, the pool table
   and the air hockey table are all refused by one clause — and a *result* can
   therefore only ever carry the dance machine's id.
3. **Surface and host must agree.** A dedicated game is never launchable from
   the shared catalogue; a shared-cabinet game is never launchable as if it were
   a machine's own.

`src/components/blobbi/arcade/native-games.tsx` is the one place a game id
becomes a React component, and it takes the whole request rather than a bare id:

```ts
resolveNativeArcadeGame(request: ArcadeLaunchRequest): NativeArcadeGameRenderer | null
```

That signature IS the correction. A resolver that answers "is there a component
for this id?" quietly implies every resolved game can run anywhere, and that
implication is what let Blobbi Dance be launched from a pool table. It now
refuses on `canLaunchArcadeGame` first and only then looks a component up, so a
missing implementation is a fourth refusal rather than a different kind of
failure.

There is **no dynamic import of remote code, no iframe, no WebXDC shim and no
package fetch**, and a test asserts the module's source contains none of
`import(`, `iframe`, `webxdc`, `srcdoc`, `eval(` or `new Function`, and reaches
neither the reward hook nor the inventory layer.

---

## 4. Navigation — three flows

`src/arcade/arcade-navigation.ts` — a second, tiny state machine, kept apart from
the lifecycle reducer on purpose. That reducer owns a **run**; this owns a
**screen**. Merging them would mean inventing lifecycle statuses like `browsing`
that no game will ever be in.

```
  generic cabinet (×6)
    Room ──arrive──► Shared catalogue ──[a shared-cabinet game]──► Game
     ▲                    │  ▲                                      │
     │                    │  └──────────── Back to games ───────────┘
     └────── Close ───────┘

  dance machine
    Room ──arrive──► Blobbi Dance (preview → run → results) ──Back to the arcade──► Room

  pool table / air hockey table
    Room ──arrive──► that game's own coming-soon screen ──Close──► Room
```

```ts
type ArcadeView =
  | { kind: 'closed' }
  | { kind: 'catalogue'; machineId: string }
  | { kind: 'game'; machineId: string; gameId: string; from: ArcadeGameOrigin }
  | { kind: 'preview'; machineId: string; experienceId: string }
  | { kind: 'notice'; machineId: string };
```

### The rules

1. **A catalogue game is only reachable from a catalogue**, and a dedicated game
   only from its machine. `launchGame` refuses from anywhere but a catalogue;
   `openDedicatedGame` is the only other way to reach `game`.
2. **The machine id survives the whole stack** — which, for a dedicated game,
   makes its machine id *always* its own.
3. **Exit goes where the player came from.** `exitGame` reads `from`: a
   catalogue-launched game returns to its catalogue, a dedicated machine's game
   goes out to the room. **Blobbi Dance is the second kind**, so leaving it
   returns the player to the arcade — not to a list that does not contain it,
   which is what the first pass did.
4. **Only `closeArcadeView` reaches `closed`**, from anywhere.

### Where the two state machines meet

Three handlers in `ArcadeRoom`, and no fourth place changes either:

- `handleMachineArrival` — one `switch` on `activation`. A `dedicated-game`
  dispatches `open` **and** sets the game view, with no menu in between.
- `handleSelectGame` — the shared-catalogue path, unreachable today.
- `handleExitGame` — `dispatch({type:'close'})` (which aborts a live run and
  records it as aborted) **and** `setView(exitGame(...))`.

Arriving at a generic cabinet or a table starts **no run at all**: the lifecycle
stays `closed` and the shell renders no `data-arcade-status`.

### Back and close, by screen

| Screen | Control | Destination |
| --- | --- | --- |
| Shared catalogue | **Close** ("Close and go back to the arcade") | Arcade Room |
| Dedicated coming-soon (pool) | **Close** ("Close and go back to the arcade") | Arcade Room |
| Blobbi Dance / Air Hockey preview, results, aborted | **Back to the arcade** ("Back to the arcade room") | Arcade Room |
| A catalogue-launched game, not mid-run | **Back to games** ("Back to the game list") | Catalogue |
| Any live run (`countdown`, `playing`) | **Leave** ("Leave *game* and end this run") | Aborts, then as above |
| Prize counter | **Close** | Arcade Room |

One dismiss control per dialog, labelled by whoever knows the destination — the
room passes `exitLabel` / `exitAriaLabel` into the game. The footer holds exactly
one action: Start or Play again.

### The interruption rule, unchanged

- **Tab hidden** → the run aborts. The game **stays on screen** with its notice
  and *Play again*; nothing jumps back on its own.
- **Explicit Leave during a live run** → aborts through the reducer, then exits
  as the table above says.
- **Window blur** → still only a pause. See `docs/blobbi-dance.md` §10.

---

## 5. The shell, and where it renders

`ArcadeGameShell` is the single dialog surface for all four screens, and it knows
the difference only as a `surface` string (`catalogue` | `game` | `notice`),
rendered as `data-arcade-surface`. `status` is optional, because a catalogue and
a coming-soon panel are screens and not runs; when it is absent there is no
`data-arcade-status` and no pause control. `closeLabel` / `closeAriaLabel` come
from the caller, because only the caller knows the destination.

### Containment — the root cause, and the fix

**The defect.** The shell used a plain Radix `DialogContent` with no `container`
and no `inFrame`, so it portaled to `document.body`, took the `fixed inset-0`
black overlay, and sized itself in viewport units (`w-screen h-[100dvh]`).
Walking up to a cabinet blacked out the entire browser page: the cozy wood frame,
the shell header and footer and the page behind them all vanished. It read as
"this website opened a modal", which is exactly what a machine's screen is not.

**Why a `max-width` would not have fixed it.** The dialog was in the wrong TREE,
not merely the wrong size. Constraining a body-level modal leaves it floating
over the page, unaligned with the game window, and still covering browser
furniture on a short viewport. The containment root had to move.

**The fix — a stage overlay host.** `BlobbiFrame` now renders one extra element
inside the cream bezel, level with the world:

```tsx
<div ref={setOverlayHost} data-stage-overlay-host
     className="pointer-events-none absolute inset-0 z-40 [&>*]:pointer-events-auto" />
```

and provides it through `StageOverlayContext`. The shell reads it with
`useStageOverlayHost()` and passes it as Radix's `container`, together with
`inFrame` (which switches the overlay to `absolute inset-0` with the island's
soft backdrop instead of `fixed inset-0` with a black one). Its own box is
`absolute inset-0 … sm:inset-3` — measured against the stage, never the viewport.

Four properties this buys, each with a test:

- **desktop** — the overlay fills the framed canvas; frame, header, footer and
  page stay visible and untouched;
- **immersive / fullscreen** — the same box IS the screen, so one rule covers
  every presentation and there is no second code path to keep in step;
- **not inside the world subtree** — so this does not reintroduce the scale-
  transform bug `GameModal` had in Phase 1;
- **no host** (a unit test rendering a room alone) — `undefined` falls back to
  `document.body`, Radix's default, so nothing has to guard.

The `pointer-events` split is load-bearing: the host always covers the whole
stage, so without it an EMPTY host would swallow every click-to-move in the
world. `z-40` puts it above the HUD and dock (`z-30`) — a machine's screen should
not leave the action dock pokable behind it.

The same host is now used by `ArcadePassModal`, `ElevatorModal` and
`NoPassModal`, so *every* arcade modal is contained, not just the new ones.

Portaling does not remount anything: the host is a stable sibling of the world in
both `BlobbiFrame` variants, and opening/closing a surface was verified in a
browser to leave the same world node (and the same Blobbi) in place.

---

## 6. The reward boundary — unchanged

No reward formula, no inventory behaviour and no publication semantics changed in
this phase. What the corrective pass *restored* is the guarantee that a Blobbi
Dance claim records the right machine:

- **Only `arcade-dance-machine` can create a Blobbi Dance run.**
  `canLaunchArcadeGame` refuses the game on every other machine and from the
  shared catalogue, checked at three layers — registry test, resolver test, and
  the room's own render-time re-check with the same surface the view was opened
  from. So `machineId` in a result and in a claim is always the dance machine's.
- **The shared catalogue computes nothing and claims nothing.** It renders cards
  and calls `onSelect(gameId)`. `catalogue.test.ts` asserts the registry's source
  contains no reference to `reward-policy`, `calculateTicketAward` or
  `calculateArcadeReward`.
- **The pool preview has no reward path at all** — no Start, no lifecycle, no
  result, nothing to claim.
- **Air Hockey is playable and still pays nothing.** `grantsTickets: false`
  with no active policy, which the registry test enforces in both directions:
  playable and paying are independent facts. See
  [`docs/blobbi-air-hockey.md`](./blobbi-air-hockey.md) §7 for the prepared
  join point.
- **A Guest Game reaches neither the native resolver nor the reward system.**
  Refused on category, before launch mode.
- **Returning to the room cannot reset an unresolved claim.** Leaving goes
  through `close`, which never clears the reducer's `rewardedRunIds`, and the
  durable claim ledger is keyed by `runId` and owner — neither is touched by a
  view change.
- `src/arcade/boundaries.test.ts` still enforces, against the real import graph,
  that `src/arcade/` reaches neither the inventory layer nor a Nostr client, and
  that exactly one arcade component reaches the reward boundary.
- Dance's reward, claim-ledger and idempotency tests are unchanged and passing.

Ticket copy stays conditional: **"Play well to earn tickets"**, never "Earn
Arcade Tickets" and never an amount.

---

## 7. Screens

### The shared catalogue (six generic cabinets)

It is built for being empty, because it is empty: every game the arcade has
belongs to a dedicated machine.

- a friendly panel using **the cabinet the player is standing at** as its
  illustration — no new artwork, different at every cabinet, and it makes the
  screen belong to the thing they walked up to;
- one heading, "Arcade Games";
- one sentence: *"New games are being prepared for these cabinets."* plus
  *"Come back another day — the Pink Cabinet will be ready for you."*;
- two short **notes**, not two sections: Island Games can earn tickets, Guest
  Games are just for fun, never give tickets, and official ones are coming soon;
- one Close.

What it deliberately is not: two headings over two empty grids with badges and
"0 results", which is what the first pass rendered — an administrative form
rather than a child's game menu. There are no placeholder cards, and no Blobbi
Dance borrowed from another machine to fill the space.

`ArcadeCatalogueCard` still exists and is rendered when
`sharedCabinetCatalogue()` returns anything, so the screen grows into cards
without being redesigned. Controls and duration are shown **only** for a game
that can actually be started; metadata for a game you cannot play is noise.

### Dedicated coming-soon (the pool table)

`ArcadeDedicatedPreview` — one component, used by the room and by the DEV
harness, so what is reviewed is what ships. Its whole job is to be about the
RIGHT game: the title, the sentence and the artwork come from the machine and
from that machine's own registry entry, so a pool table can only ever talk about
pool. No Start control, no catalogue, one Close to the room. A test asserts the
pool panel mentions cues and never mentions a puck or dancing, and vice versa.

The air hockey table used this screen until its game shipped, which is the
transition this design was built for: a machine moves from `dedicated-preview` to
`dedicated-game` and nothing else about it changes. See
[`docs/blobbi-air-hockey.md`](./blobbi-air-hockey.md).

### The prize counter

Not a game and does not pretend to be one: a `notice` surface with the same
panel, and it no longer touches the game lifecycle at all.

---

## 8. Guest Games — presentation only

`src/arcade/guest-game-trust.ts` records the product decision and nothing else.

When Guest Game discovery is built, Blobbi Island will initially accept packages
published by the **official Blobbi issuer** and nobody else — not because a wider
set is undesirable, but because a wider set needs a review process, a revocation
story and a runtime that has been attacked at least once, and none of those
exist.

That publisher is the same key the item catalog already trusts, and it is already
defined once in `src/inventory/constants.ts`. The module **re-exports** it under
a name that says what it is trusted for rather than writing the key out again;
`guest-game-trust.test.ts` asserts the module's source contains no 64-hex
literal, that the key encodes to the npub the decision was taken against
(`npub1nmac6vz9hf6n7dny65pnpz6f0qe4dvn2d405h9ztltzz8xh7vw5sg0wu5e`), and that
**no other module in `src/` references the constant** — so "recorded, not wired
up" is checked, not claimed.

`GUEST_GAME_RUNTIME_AVAILABLE` is `false` and is not a feature flag: flipping it
would enable nothing, because there is no runtime behind it.

The player-facing copy says none of this. The Guest Games section reads: *"Little
games made by other people, shared just for fun. They never give Arcade
Tickets."* and *"Official Guest Games are coming soon."* A test asserts the
rendered catalogue contains none of `webxdc`, `nostr`, `npub`, `kind:`,
`sandbox`, `iframe`, `issuer` or `relay`.

---

## 9. Accessibility

- The catalogue panel is a `<section aria-labelledby>` pointing at its one `<h3>`.
  One heading, not a stack — the categories are sentences now.
- A game card is an `<article aria-labelledby>` naming the game, inside an `<li>`.
- **A coming-soon card has no button at all** — not a disabled one, which a
  screen reader still announces as a button and a mouse user still tries to
  click. Same for a Guest Game card.
- The dedicated coming-soon panel announces itself with `role="status"`, so a
  screen-reader user learns "Pool — coming soon" at the moment a sighted one
  does.
- Every interactive control in the dialog declares `min-h-[44px]`, including the
  shell's header Pause / Resume / dismiss controls.
- Close and back labels describe their destination (§4).
- Category, ticket eligibility and availability are carried **in words**, not
  only in colour or position.
- Nothing autoplays on opening a screen: `onSelect` only changes a view, and
  Dance's audio engine is still built inside the Start click.
- Focus: Radix traps focus in the open dialog and restores it on close; the host
  is a normal element in the document, so nothing about focus changed with
  containment.

---

## 10. Responsive behaviour

Verified in a real browser at **386 × 840**, rendered in an iframe so CSS media
queries genuinely evaluate narrow (the automated browser refuses to resize its
window below ~1120 px — the same limitation `docs/arcade-foundation.md` §14
records). `matchMedia` was patched inside the probe to report a touch-first
device, so the **immersive** presentation could be measured too — a desktop
Chrome iframe never triggers it on its own.

| Check | Immersive @ 386 × 840 | Desktop @ 1120 × 813 |
| --- | --- | --- |
| Overlay host | 386 × 840 — the whole screen | 1016 × 641 — the game window only |
| Shell computed inset | `0 / 0 / 0 / 0` | `absolute`, `sm:inset-3` |
| Inside the host | yes | yes |
| Covers the browser page | **no** | **no** |
| Document horizontal overflow | 0 px | 0 px |
| Shell horizontal overflow | 0 px | 0 px |
| `border-radius` | `0px` (full-bleed sheet) | rounded |
| Headings in the catalogue | 1 | 1 |
| Content scrolls internally | yes | yes |
| Dismiss control | visible, 44 px | visible, 44 px |

A live Dance run keeps its Phase 3.2 overflow behaviour untouched
(`overflow-hidden` plus tighter padding for `countdown`/`playing`/`paused` only),
and the footer's `pb-[max(0.75rem,env(safe-area-inset-bottom))]` inset is
unchanged.

Vertical centring uses `my-auto` on the panel inside a `flex flex-col` content
area, deliberately **not** `justify-center`: when content is taller than the box,
`justify-center` clips the top out of a scroll container while an auto margin
collapses to zero.

---

## 11. DEV harness

`/dev/arcade` stays DEV-only twice over (the route is behind
`import.meta.env.DEV`, and `src/dev-routes.test.ts` proves the built output
contains no reference to it). Its arcade surfaces now render **inside**
`BlobbiAppShell`, where the real room's do — they used to be siblings of it,
outside the frame's overlay host, so the harness could not show the containment
it exists to verify.

- **Dedicated machines** — Blobbi Dance opening directly, and the pool and air
  hockey tables opening `ArcadeDedicatedPreview`, the real component. A readout
  shows `dedicated=3 · generic=6`.
- **Catalogue cabinet (generic only)** — the six generic cabinets, and only
  those. A chip that let you open the shared catalogue "from" the dance machine
  would demonstrate something the product refuses to do.
- **Catalogue** — four entry sets: `real` (the shipped registry, which offers no
  cabinet game and says so), `future-game` (a hypothetical shared-cabinet game so
  the card layout is reviewable), `with-guest` (a Guest Game claiming to be
  playable, which must get no Play button and no ticket badge), and
  `unresolvable` (a listed game with no implementation, which must fail safely
  and say so).
- **Blobbi Dance's machine is no longer a choice.** It is fixed to
  `arcade-dance-machine`, because that is the only machine the product will
  start it on.
- The lifecycle-fixture panel picks a **registry entry** and evaluates the REAL
  `canLaunchArcadeGame` against the selected machine, so it cannot demonstrate a
  run the product refuses to start.

---

## 12. Known limitations

- **Walk-to-arrival could not be observed** in the automated browser: the tab's
  `requestAnimationFrame` is starved there, which starves the movement loop. This
  is pre-existing and already recorded in `docs/arcade-foundation.md` §14; it was
  re-confirmed against an unmodified checkout of the previous commit, which
  behaves identically. The arrival CONTRACT is covered by `ArcadeRoom.test.tsx`,
  which drives the real arrival callback for every machine on every floor.
- **The DEV panel is unusable while a modal is open** — Radix marks the rest of
  the document inert, so a click on the panel dismisses the dialog instead of
  activating a chip. Pre-existing; the workflow is close → change chip → reopen.
- The immersive measurements come from a patched `matchMedia` in an iframe, not
  from physical hardware.
- **No shared-cabinet game exists**, so the catalogue's card layout has been
  reviewed only against a DEV fixture.
- Movement blockers are still absent, so a Blobbi can walk through a cabinet.

---

## 13. Phase 5 — the Guest Game Runtime

Exactly what this phase deferred, and nothing else:

1. **Discovery** — query the official issuer's published Guest Game events, parse
   them into `ArcadeCatalogueEntry` records with `category: 'guest'` and
   `launchMode: 'guest-runtime'`, and merge them into the catalogue behind a
   validation gate. This is where `OFFICIAL_GUEST_GAME_PUBLISHER_PUBKEY` is
   finally used, and where the "no other module references it" test is deleted
   with intent.
2. **Package handling** — fetch, verify and cache a WebXDC-style package. Nothing
   executes at this step.
3. **The restricted runtime** — a Blobbi-owned sandbox with **no signer, no
   inventory, no coins, no profile and no Arcade Ticket access**, and a
   capability surface small enough to enumerate in this document.
4. **A guest launch path** in the resolver, separate from the native one, that
   `isNativeLaunchable` still refuses — a guest game must never reach a native
   component.
5. **Revocation and review** — how a package is withdrawn (`availability:
   'disabled'` already exists for it) and what "curated" means operationally.

Explicitly **not** Phase 5: the first shared-cabinet game, Pool gameplay, the
Prize Shop, leaderboards, latency calibration, or opening the publisher set
beyond the official issuer. (Air Hockey, listed here as out of scope when this
was written, has since shipped as the arcade's second Island Game —
[`docs/blobbi-air-hockey.md`](./blobbi-air-hockey.md).)
