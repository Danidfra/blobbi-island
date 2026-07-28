# Blobbi Island Arcade — Product & Technical Audit

Audit date: 2026-07-27 · Branch: `production` @ `13b1cad` · Working tree clean at start and end.

**Scope:** establish what the arcade actually is today, and recommend the architecture for
Arcade Tickets, a shared minigame foundation, and the first playable game. **No games,
ticket rewards, inventory writes or Nostr kinds were implemented.** Nothing was committed.

Evidence classes used throughout:

| Label | Meaning |
| --- | --- |
| **Working** | Implemented, reachable, and does what it appears to do |
| **Partial** | Implemented and reachable, but incomplete or lying about part of its effect |
| **Placeholder** | Renders an affordance that opens something with no behaviour behind it |
| **Visual-only** | Decoration; no handler, no cursor affordance |
| **Dead affordance** | Looks interactive (cursor, hover-scale) and does literally nothing |
| **Broken** | Reachable and fails, or produces a result the user is told is real and isn't |

---

## 1. Executive summary

**Headline finding: the arcade has no games, and — more importantly — it currently tells the
player it does.** Eight separate machines on two floors (six cabinets, a pool table, an air
hockey table, plus the basement dance pad) all open the *same* modal titled
"Dance Dance Blobbi" containing the text "Get ready to dance!" and a `Start Game` button with
no `onClick`. This was confirmed in a real browser: clicking the **pool table** opens a dance
game. The single largest product risk here is not missing functionality, it is *misrepresented*
functionality.

Second finding: **the one economic transaction the arcade already performs is not persisted.**
`ArcadePassModal` charges 20 coins by calling `useOptimizedStatus().updateOwnerCoins()`, which
is a purely local optimistic mutation. A WebSocket spy installed in the page during the
purchase recorded **zero** published events other than routine `kind:31950` presence
heartbeats. The coins are not deducted on kind:11125; the deduction is not even visible outside
the modal's own hook instance (the pending-update store is a per-instance `useRef`); and the
pass itself lives in `sessionStorage`, so a page reload yields a fresh purchase against the
untouched balance.

Third finding: **the inventory foundation the tickets need already exists and is good.** The
kind:31632/31633 layer (`src/inventory/`) has a single canonical write path, per-user
serialisation, read-modify-write against a fresh relay read, optimistic updates with rollback,
a bundled offline fallback catalog, and 100+ passing tests. Arcade Tickets should be an
official 31632 item held in the existing 31633 inventory, exactly as directed. The work is
adapting three small choke points (`ItemCategory`, `VALID_CATEGORIES`, the bag's category
sections), **not** building an economy.

Fourth finding: **there is no minigame framework, and no game code to reuse.** The only
existing "game" is `MiningGame` (cave, not arcade), a 248-line component that mixes its own
ad-hoc state enum, click handling, energy accounting, a relay publish *per click*, and its own
result screen. It should be treated as a cautionary reference, not a base class. The reusable
patterns worth copying come from the **theater** (`theater-state.ts` reducer + controller/view
separation) and from **`usePendingInteraction`** (walk-to-interact), plus the data-driven
placement configs (`theater-seats-config.ts`, `town-bushes-config.ts`).

**Recommended first vertical slice: the rhythm/dance game on the basement dance machine** —
confirmed, not merely accepted. The basement is already an entire music-themed room (dance pad
sprite with a visible arrow panel, 17 music-themed neon signs, a karaoke stage with a
microphone). It is the only candidate whose art already reads unambiguously as one specific
game, and it exercises every shared system the framework needs.

---

## 2. Current arcade map and interaction inventory

### 2.1 Rooms

| LocationId | Background | Boundary | Spawn |
| --- | --- | --- | --- |
| `arcade` | `arcade-inside.png` | `location-boundaries.ts:111-117` — full width `y[48,100]` **plus a narrow alcove `x[45,55] y[36,48]`** | `{x:50,y:75}`, or `{x:50,y:48}` **if a pass is held** (`location-initial-position.ts:67-76`) |
| `arcade-1` | `arcade-1.png` | `:118-129` composite (rect + two triangles) | `{x:50,y:63}` |
| `arcade-minus1` | `arcade-minus1.png` | `:130-142` composite | `{x:50,y:55}` |

Sources: `src/lib/location-types.ts:1`, `src/lib/location-backgrounds.ts:12-14`,
`src/lib/location-blobbi-sizes.ts:9-11`, `src/lib/location-scaling-config.ts:27-34`,
`src/lib/interactive-elements-config.ts:70-96` (per-floor Blobbi z-index thresholds).

**Reachability:** the arcade is reachable **only** from Town, via
`InteractiveElements.tsx:1141-1149` (`arcade-door.png` → `setCurrentLocation('arcade')`).
`MapModal.tsx` lists only home/beach/mine/nostr-station/plaza/town — the arcade has no map
entry. Exit is the `BackArrow` at `InteractiveElements.tsx:804-807`, returning to Town at
`{x:32,y:68}` (`location-initial-position.ts:35`).

Floors `arcade-1` and `arcade-minus1` are reachable **only** through the elevator modal.

### 2.2 Complete element inventory

Enumerated by rendering each floor's `InteractiveElements` branch in jsdom and reading the
React props off every `<img>` wrapper (probe run in the scratchpad, not committed), then
re-verified by clicking in Chrome. All line numbers are `src/components/blobbi/InteractiveElements.tsx`.

#### Ground floor — `arcade` (9 sprites)

| Element | Line | Handler | Status |
| --- | --- | --- | --- |
| Elevator door left/right (`elevator-door.png`, `effect="slide"`) | 540-558 | `handleElevatorClick` | **Working** (see §5 for the pass gate and §8 for a movement defect) |
| `ticket.png` counter base | 750-751 | none | Visual-only |
| `ticket-out.png` "Purchase Arcade Pass" (`effect="opacity"`) | 752-759 | `handleTicketPurchase` → `ArcadePassModal` | **Partial / Broken economy** (§6) |
| `wall-art-super-blobbi.png` | 762 | none | Visual-only |
| `wall-art-game-boy.png` | 763 | none | Visual-only |
| `play-up-neon.png` | 764 | none | Visual-only |
| `trophy-money-neon.png` | 765 | none | Visual-only |
| **`prizes.png` PRIZES counter** | 769-775 | `handleElementClick('prizes')` | **Dead affordance** — the handler's only effect is `console.log`. Browser-verified: nothing opens, the Blobbi does not even walk (no `requestInteraction`). |

#### Floor 1 — `arcade-1` (21 sprites)

| Element | Line | Handler | Status |
| --- | --- | --- | --- |
| Elevator ×2 | 540-558 | `handleElevatorClick` | Working |
| 11 neon / wall-art sprites (`trophy`, `sword`, `play`, `blobbizard`, `blobbi-adventure`, `controller`, `star`, `dice`, `pac-man`, `game-boy`, `retro-controller`) | 666-679 | none | Visual-only |
| `arcade-machine-pink.png` | 682-688 | `handleElementClick('dance-machine')` | **Placeholder** |
| `arcade-machine-black.png` (alt: "Arcade Machine classic") | 689-695 | idem | **Placeholder** |
| `arcade-machine-classic.png` (alt: "Arcade Machine classic" — duplicate) | 696-702 | idem | **Placeholder** |
| **`snooker.png`** (alt: "Arcade Machine Green" — wrong) | 705-711 | idem | **Placeholder, misleading** — a pool table opens a dance game (browser-verified) |
| **`air-hockey.png`** | 713-719 | idem | **Placeholder, misleading** — browser-verified |
| `arcade-machine-green.png` | 722-728 | idem | **Placeholder** |
| `arcade-machine-purple.png` | 729-735 | idem | **Placeholder** |
| `arcade-machine-red.png` | 736-742 | idem | **Placeholder** |

#### Basement — `arcade-minus1` (27 sprites)

| Element | Line | Handler | Status |
| --- | --- | --- | --- |
| Elevator ×2 | 540-558 | `handleElevatorClick` | Working |
| **`dance-machine.png`** | 564-570 | `handleElementClick('dance-machine')` | **Placeholder** — the only machine whose art matches the modal |
| 17 music-themed neon / wall-art sprites | 575-595 | none | Visual-only |
| Left/Right chair ×4 (two identical table groups) | 598-647 | `handleChairClick` | **Partial** — walks the Blobbi to a computed seat point and stops. No seated pose, no state, no z-index change. Browser-verified: the Blobbi stands *inside* the chair sprite. |
| `table.png` ×2, `arcade-tundra-stage.png` | 621/646/650 | none | Visual-only |
| **`mic.png`** (alt: **"Right Chair"**) | 651-657 | **`onClick` is commented out** (line 656) | **Dead affordance** — still `effect='scale'` with `animated` defaulting true, so it renders `cursor-pointer` + `hover:scale-110` and does nothing. Browser-verified. |

### 2.3 Art already reserved for games

- **Basement = a music venue.** Dance pad with a visible 4-arrow panel, a raised stage with a
  standing microphone, and 17 neon signs (mics, headsets, guitar, CD, musical notes, "SONG",
  "DANCE"). Two seating groups face the stage. This room is designed for a rhythm game *and*
  a singing/karaoke game.
- **Floor 1 = a classic arcade.** Six differently-coloured cabinets (three per side), one pool
  table, one air hockey table, and neon for trophies, dice, a controller, Pac-Man, a Game Boy
  and a sword. The cabinets are generic shells: they reserve slots for six unspecified games.
- **Ground floor = commerce.** A ticket vending machine and a **PRIZES** counter. The prize
  counter is the ticket sink the product direction needs, and its art already exists.

---

## 3. File and component architecture trace

```
BlobbiIsland (pages/BlobbiIsland.tsx)
└── BlobbiAppShell (shell/) ── HUD, dock, fullscreen, portrait gate
    └── PlayingView (blobbi/PlayingView.tsx)          ← owns sittingIn / hiddenIn / activitySession
        ├── PlaceBackground ── VirtualWorld (1046×697, uniformly scaled)   ← WORLD SCALE BOUNDARY
        │   └── div[data-world-surface]
        │       ├── InteractiveElements  (1549 lines, 12 location branches)
        │       │   ├── arcade branch (lines 525-810)
        │       │   │   ├── InteractiveElement × N        (generic sprite + click/hover/walk)
        │       │   │   ├── ArcadePassModal   (Radix Dialog → portals OUT of the world)
        │       │   │   ├── ElevatorModal     (Radix Dialog → portals OUT)
        │       │   │   ├── NoPassModal       (Radix Dialog → portals OUT)
        │       │   │   └── GameModal         ← plain absolute div: STAYS INSIDE the scaled world
        │       │   └── stage branch (theater) — the reference architecture
        │       ├── MovableBlobbi   (movement, arrival, seated render)
        │       └── MultiplayerLayer (presence 31950)
        ├── ArcadePassIcon  (top-right; polls sessionStorage every 1000 ms, ALWAYS mounted)
        └── ItemBagModal / BlobbiInfoModal / ...
```

Supporting modules:

| Concern | File |
| --- | --- |
| Walk-to-interact | `src/hooks/usePendingInteraction.ts` |
| World click blocking | `src/components/blobbi/MovableBlobbi.tsx:376-413` |
| Per-floor Blobbi z-index | `src/lib/interactive-elements-config.ts:70-96` |
| Walk boundaries | `src/lib/location-boundaries.ts:111-142`, `src/lib/boundaries.ts` |
| Pass-dependent spawn | `src/lib/location-initial-position.ts:67-76` |
| Coins (read + optimistic) | `src/hooks/useOptimizedStatus.ts` |
| Coins (canonical write) | `src/inventory/useCoinsMutation.ts` |
| Inventory (canonical write) | `src/inventory/useInventoryMutation.ts` |
| Item catalog | `src/inventory/useItemCatalog.ts`, `catalog-fallback.ts`, `registry.ts` |
| Publishing primitive | `src/hooks/useNostrPublish.ts` |

**Note the world-scale boundary.** `GameModal` (`src/components/blobbi/GameModal.tsx:19`) is a
plain `absolute inset-0` div rendered *inside* `VirtualWorld`, so it is scaled with the world
and clipped to the 1046×697 box. Every other modal in the app uses Radix `Dialog`, which
portals to `document.body` and is unaffected. This is visible in the browser: the game modal
sits inside the world frame rather than over the viewport. **Any minigame surface must be
decided deliberately here** — see §10.

---

## 4. Working, partial and dead interactions (summary)

**Working (3):** elevator doors (both leaves), the elevator floor-selection modal, the
`NoPassModal` gate.

**Partial (3):**
- Arcade Pass purchase — opens, charges, grants the pass, but the charge is never persisted.
- Basement chairs (×4) — walk-to-position only, no seated state.
- Arcade Pass icon — correct, but implemented as a 1 Hz `setInterval` poll of `sessionStorage`
  that runs for the whole session in every location (`ArcadePassIcon.tsx:26`).

**Placeholder (9):** all six floor-1 cabinets, the pool table, the air hockey table, and the
basement dance machine — every one opens the identical inert "Dance Dance Blobbi" modal.

**Dead affordance (2):** the PRIZES counter (logs to console), the stage microphone
(`onClick` commented out but the hover-scale/cursor affordance left in place).

**Visual-only (30):** every neon sign, wall art, table and the karaoke stage platform. All 30
carry `alt="ticket counter"` (copy-paste), which is an accessibility defect across all three
floors.

**Broken (2):** see §8 — the pass-holder spawn point can strand the Blobbi in the elevator
alcove, and the coin charge is fictional.

---

## 5. Access / pass / floor flow

```
Town → arcade-door → arcade (ground)
   spawn = {50,75}  (no pass)  |  {50,48}  (pass held)
        │
        ├── ticket-out  → ArcadePassModal ── 20 coins ──► sessionStorage['has-arcade-pass'] = 'true'
        │                                    (coins NOT published)
        └── elevator ──► sessionStorage has pass?
                          ├── yes → ElevatorModal → arcade | arcade-1 | arcade-minus1
                          └── no  → NoPassModal ("purchase a ticket at the counter")

PlayingView effect (PlayingView.tsx:72-76):
   currentLocation does NOT start with 'arcade' → sessionStorage.removeItem('has-arcade-pass')
```

Implementation: `InteractiveElements.tsx:473-484` (`handleTicketPurchase`, `handleElevatorClick`),
`ArcadePassModal.tsx:16-40`, `ElevatorModal.tsx:20-51`, `NoPassModal.tsx`, `ArcadePassIcon.tsx`.

Observations:

1. **The pass is per-page-load, not per-visit.** Because `LocationProvider` initialises to
   `town`, the clear effect fires on every mount. Browser-verified: after reloading directly
   into the arcade, `sessionStorage.getItem('has-arcade-pass')` was `null`.
2. **The elevator modal has no "you are here" state.** All three floors render identically,
   including the one you are standing on (`ElevatorModal.tsx:67-83`).
3. **The elevator modal is off-theme.** It uses raw `from-blue-100 to-indigo-100 / text-blue-800`
   while `ArcadePassModal` and `NoPassModal` use the `blobbi-card` / `island-*` design tokens.
4. **Floors are not gated individually.** One pass unlocks all three; there is no per-floor or
   per-machine cost, so the pass is the arcade's only paywall and it is currently free (§6).

---

## 6. Current economy and persistence behaviour

### 6.1 What the arcade writes today

**Nothing.** No arcade code path publishes any Nostr event.

Verified empirically. A `WebSocket.prototype.send` spy was installed in the live page before
purchasing an Arcade Pass. Across the whole purchase the only frames matching `["EVENT"` were
two `kind:31950` presence heartbeats:

```
["EVENT",{"kind":31950,"content":"{\"state\":\"idle\",\"location\":\"town\",...
["EVENT",{"kind":31950,"content":"{\"state\":\"idle\",\"loca...
```

`sessionStorage['has-arcade-pass']` became `"true"` and the toast "Arcade Pass Purchased!"
appeared. No 11125, no 31633.

### 6.2 Why the coin charge is fictional

`ArcadePassModal.tsx:29` calls `updateOwnerCoins(currentCoins - 20)`.
`useOptimizedStatus.updateOwnerCoins` (`useOptimizedStatus.ts:169-173`) forwards to
`applyOptimisticUpdate`, which pushes onto `pendingUpdatesRef` and invalidates the query with
`refetchType: 'none'` (`:131-154`). There is no publish anywhere in that path.

Two further consequences, both browser-verified:

- **`pendingUpdatesRef` is a `useRef` created per hook instance.** Every component calling
  `useOptimizedStatus()` gets its own pending list, so the deduction is visible *only inside
  `ArcadePassModal`*. Immediately after purchase the modal showed `983318`; the real relay
  balance was `983338`.
- **A reload restores the full balance and clears the pass**, so passes are effectively
  unlimited and free.

Compare `MiningGame.tsx:60-66`, which does it correctly-ish: optimistic `updateOwnerCoins`
*plus* `updateOwnerProfile({coins})`. And compare the canonical path,
`src/inventory/useCoinsMutation.ts`, which re-reads the freshest 11125 from the relay, merges
via `mergeOwnerProfileTags`, preserves raw `inv` tags, rejects negative balances and publishes
once. **`useCoinsMutation` is the only correct coin writer and the arcade does not use it.**

### 6.3 A third, silent failure mode: the loading state

`ArcadePassModal` renders `status.owner?.coins || 0`. While the 11125 profile query is in
flight — or if it fails — it displays **"Your current coins: 0"** and disables *Buy Ticket*.
Browser-verified after a reload. There is no skeleton and no error state, so a transient relay
problem is presented to the player as "you are broke".

### 6.4 The inventory layer (which the arcade does not touch)

For contrast, `src/inventory/` is in good shape and is what tickets should use:

- kind:31633, `d = "blobbi:island"`, address-based items (`constants.ts:57`).
- `useInventoryMutation` is the single write path: per-user promise-chain serialisation,
  **fresh relay read as the write base** (never a possibly-empty cache), package-owned quantity
  maths, optimistic cache update with rollback on error, single-key invalidation on settle.
- 19 official items derived from the issuer + `d` (`registry.ts`), with a bundled offline
  fallback (`catalog-fallback.ts`) so the game works with no relay.
- Known and documented limits (`docs/INVENTORY_ARCHITECTURE.md`): non-atomic multi-event
  operations, no cross-tab coordination, replaceable-event newest-wins races.

---

## 7. Reusable code

| Asset | File | Why it matters for the arcade |
| --- | --- | --- |
| **Walk-to-interact** | `src/hooks/usePendingInteraction.ts` | Token-invalidated, single rAF, stall detection, cancel-on-other-click, touch-aware thresholds, broadcasts the walk to presence. Exactly the "walk to the cabinet, *then* open the game" primitive. Use as-is. |
| **Reducer/controller split** | `src/lib/theater-state.ts` (+ `theater-state.test.ts`, 20 tests) | A pure, exhaustively-documented state machine with the view deriving *everything* from one status value. The correct model for the minigame state machine. |
| **Data-driven placement** | `src/lib/theater-seats-config.ts`, `src/lib/town-bushes-config.ts` | Stable ids + measured percentages + tests, replacing anonymous sprite clones. The arcade's 9 machines need exactly this (`arcade-machines-config.ts`). |
| **Arrival component** | `src/components/blobbi/theater/TheaterSeat.tsx`, `TownBush.tsx` | The "click → compute target from live rect → `requestInteraction` → fire on *confirmed arrival*" component shape. `<ArcadeMachine>` should be a sibling of these. |
| **Pure playback/timing logic** | `src/lib/theater-playback.ts` (559 lines, 38 tests) | Precedent for putting hard logic in a pure, DOM-free, heavily-tested module. Rhythm-timing logic should follow it. |
| **Inventory writes** | `src/inventory/useInventoryMutation.ts` | Ticket grants and prize-shop spends both go through this. No new write layer needed. |
| **Purchase flows** | `src/inventory/usePurchaseItem.ts`, `useBatchPurchase.ts` | The prize shop is a purchase flow with tickets instead of coins; the ordering/partial-failure reasoning is already written down and testable. |
| **Coin writes** | `src/inventory/useCoinsMutation.ts` | For milestone coin rewards, and to fix the pass purchase. |
| **Item bag UI** | `src/components/blobbi/ItemBagModal.tsx` | Where the ticket balance should surface (needs a `currency` section — §11). |
| **Movement blockers / boundaries** | `src/components/blobbi/MovementBlocker.tsx`, `src/lib/boundaries.ts` | Needed to stop the Blobbi walking through cabinets. |
| **SFX** | `src/hooks/useSfx.ts` | Autoplay-safe, cooldown-limited one-shots. Good for UI sounds; **not** sufficient for rhythm timing (§10). |
| **Dev harness pattern** | `src/pages/DevTheater.tsx` + `src/AppRouter.tsx:19-21` | `import.meta.env.DEV`-gated route that mounts the real shell with a fixture Blobbi, no login, no publishing. I built a temporary `/dev/arcade` clone of this to run the browser validation and removed it; it should be created for real in the next phase. |

**Not reusable:** `MiningGame.tsx`. It publishes a kind:31124 event on *every click*
(`:102-106`), keeps its own duplicate energy mirror, and inlines its own instructions/results
screens. It is the anti-pattern the shared framework exists to prevent.

---

## 8. Duplicated or risky code

Ordered by severity for the arcade work.

1. **All 9 machines share one handler and one hard-coded modal.**
   `handleElementClick` (`InteractiveElements.tsx:454-471`) `console.log`s, then — only for the
   literal string `'dance-machine'` — builds a JSX blob inline and opens `GameModal`. Snooker,
   air hockey and six cabinets all pass `'dance-machine'`. The `Start Game` button has no
   handler. Browser-verified on three machines.

2. **`useNostrPublish` treats publish timeouts as success**
   (`src/hooks/useNostrPublish.ts:33-38`). A ticket grant that never reached a relay will
   resolve successfully, the optimistic cache will show the tickets, and `onSettled`
   invalidation will later silently remove them. `useFirstEggAdoption` already worked around
   this with a local `strictPublish`; reward claims need the same treatment or an explicit
   verify-after-publish read.

3. **Pass-holder spawn strands the Blobbi.** With a pass, `getBlobbiInitialPosition('arcade')`
   returns `{x:50, y:48}` — inside the narrow `x[45,55] y[36,48]` elevator alcove. Clicking the
   ticket counter from there produced no movement for 7+ seconds and **the modal never opened**
   (the pending interaction stalled far from its target and cancelled itself, by design:
   `usePendingInteraction.ts` `STALL_MAX_DISTANCE_FACTOR`). Clicking open floor first, then the
   counter, worked immediately. Browser-verified, reproducible.

4. **The Blobbi renders behind the elevator doors.** For `arcade-inside.png`, positions with
   ≤52 % from the bottom resolve to `zIndex: 10` (`interactive-elements-config.ts:70-76`), and
   the elevator container is also `z-10` (`InteractiveElements.tsx:532`). The tie resolves by
   DOM order, so a Blobbi standing at the elevator is occluded by the closed doors.
   Browser-observed.

5. **The `slide` effect branch skips the room's own interaction contract.**
   `InteractiveElement`'s slide return (`:244-260`) has no `data-block-move`, no `onTouchStart`
   and no `onPointerDown` stop-propagation, unlike the default branch (`:262-289`). Since
   `MovableBlobbi.shouldTriggerWorldMove` (`:376-413`) only skips elements matching
   `[data-block-move]` et al., clicking the elevator *also* starts a raw world walk to the raw
   click point, which then races the `requestInteraction` walk. Only the elevator uses `slide`
   in the arcade.

6. **`GameModal` lives inside the scaled world** (§3), unlike every other modal. It is also
   never torn down: `gameModalContent` is set but never cleared on close
   (`InteractiveElements.tsx:795-803`), so the last game's content stays mounted.

7. **`ArcadePassModal` is mounted unconditionally on all three floors** and calls
   `useOptimizedStatus()` (two live TanStack queries) even while closed. Proof: rendering any
   arcade floor without a `NostrProvider` in jsdom throws
   `useNostr must be used within a NostrProvider` *from `ArcadePassModal`*, which is why the DOM
   probe had to mock it out.

8. **Duplicated markup and metadata.**
   - Two byte-identical chair+table groups in the basement (`:598-622`, `:623-647`).
   - 30 sprites with `alt="ticket counter"`.
   - The microphone is `alt="Right Chair"`.
   - Two cabinets share `alt="Arcade Machine classic"`; `snooker.png` is `alt="Arcade Machine Green"`,
     colliding with the actual green cabinet.
   - `LOCATION_NAMES` exists twice (`shell/BlobbiHUD.tsx:8-27` and `blobbi/LocationIndicator.tsx:18-27`),
     already drifted — the latter says `"Villasge Shop"`.

9. **`handleChairClick` selects its container by class string**
   (`closest('.w-full.h-full.relative')`, `:426`). It happens to work, but it silently returns
   and does nothing if that exact class trio is ever refactored.

10. **`InteractiveElements.tsx` is 1549 lines** with 12 sequential location branches and every
    room's modal state hoisted into one component. Adding nine machines with their own state
    here would compound the problem; the arcade branch should be extracted (§19).

11. **Pre-existing failing test (baseline, not arcade, not fixed):**
    `src/components/blobbi/InteractiveElements.plaza-door.test.tsx` >
    *"reveals the open door on tap and hides it again afterwards (mobile parity)"*. The touch
    reveal never activates in jsdom because `computeBaseCenterTarget` returns `null` when
    `getBoundingClientRect()` is all zeros, so the code falls through to the immediate-click
    path without setting `isTouchActive`. It is worth noting that this same fall-through is a
    real production behaviour: **when the world surface has no measurable size, walk-to-interact
    silently degrades to an instant click.**

---

## 9. Candidate-game feasibility matrix

Assessed against the art that exists, not against a wish list.

| | **Rhythm / dance** | **Cabinet game (generic)** | **Air hockey** | **Pool / snooker** | **Singing / pitch** |
| --- | --- | --- | --- | --- | --- |
| Art fit | **Exact** — `dance-machine.png` has a visible 4-arrow pad; whole basement is music-themed | Shells only; 6 cabinets = 6 unspecified slots | Exact — `air-hockey.png` | Exact — `snooker.png` | Strong — stage + `mic.png` + karaoke neon, but the mic is currently dead |
| Complexity | Medium | Varies | Medium-high | **High** | Medium (tap variant) / High (real pitch) |
| Desktop controls | Arrow keys / WASD | Per game | Mouse drag | Aim + power drag | Space/keys |
| Mobile controls | 4 large tap zones — **good** | Per game | Drag — workable | Drag aiming on a small table — **poor** | Tap — good |
| Audio | **Critical path.** Needs `AudioContext.currentTime` scheduling + a latency-calibration step. `useSfx` is not enough | Optional | Optional | Optional | Critical + **microphone permission** if real pitch |
| Physics | None | None-to-some | Continuous 2-body + walls, fixed timestep | Full multi-body rigid dynamics, spin, pockets | None |
| Accessibility | Needs reduced-motion, a visual-only mode, adjustable timing window, remappable keys | Per game | Motion-sensitive | Fine-motor demanding | **Mic = privacy + permission friction**; tap variant avoids both |
| Multiplayer | Async (score share) natural; live "dance-off" possible later | Async | **Wants** real-time — the weakest fit for relay transport | Turn-based over relays is plausible but slow | Async duet |
| Nostr fit | Personal best / leaderboard / friend challenge | Same | Real-time match state — high protocol cost | Turn state — medium cost | Same as rhythm |
| Risk | **Low-medium** — main risks are audio latency and needing an original/CC-licensed track | Medium (undefined scope) | Medium-high | **High** | Medium-high (permissions) |
| Shared systems exercised | instructions, countdown, timer, score, combo, lives, input (kbd+touch), audio, pause, results, reward, replay | subset | physics loop, input | physics, aiming UI | audio in, score |
| First slice? | **Yes** | No — undefined | No | No | No — but reuses ~80 % of the rhythm framework, so it is the natural **second** |

**Prize shop** (`prizes.png`, ground floor) is not a game but is a hard dependency: shipping
tickets with no sink is worse than shipping no tickets. It should land in the same phase as the
first game.

---

## 10. Shared minigame framework recommendation

**Yes — build the framework before the first game, but build it *with* the first game**, in one
directory, and only generalise what the rhythm game actually needs. A framework designed for
five hypothetical games will be wrong; a framework extracted from one real game and reviewed
against the matrix in §9 will not.

### 10.1 State machine

Adopt the theater's model exactly: one pure reducer module, one status value, the view derives
everything.

```
idle → instructions → countdown → playing ⇄ paused
                                     │
                                     ├─► results → claiming → rewarded → (replay → countdown | exit)
                                     └─► aborted (walked away / left location)
```

Rules to encode, mirroring `theater-state.ts`'s discipline:

- `playing` is the **only** state that advances the clock; `paused` freezes it and freezes the
  score.
- `results` carries an **immutable, complete `ArcadeGameResult`** including a `runId` generated
  at `countdown → playing`. Nothing downstream may recompute a score.
- `claiming → rewarded` is a one-way door keyed on `runId`. Re-entering `claiming` for a
  `runId` already in the claimed set is a no-op, not a second grant.
- `aborted` never reaches `claiming`.
- Leaving the location or losing the modal is `aborted`, not `results`.

Put it in `src/arcade/arcade-machine-state.ts` as a pure reducer with its own test file. No
React, no Nostr, no DOM — like `theater-state.ts` and `theater-playback.ts`.

### 10.2 Shared runtime pieces

| Piece | Recommendation |
| --- | --- |
| Score / combo / timer / lives | Plain reducer fields. Each game declares which it uses; the shell renders only declared fields. |
| Difficulty | Part of the run request, echoed into the result, and an input to the reward policy. |
| Keyboard | One `useArcadeInput` hook with a per-game keymap, `preventDefault` on arrows (the page must not scroll), and a documented remap point. |
| Touch | Declarative hit zones sized ≥ 44 px, rendered by the shell so every game gets the same mobile ergonomics. |
| Gamepad | **Not justified now.** No precedent in the repo, no product requirement, and it doubles input-mapping surface. Revisit after two games ship. |
| Audio | A small `src/arcade/audio/` module over one `AudioContext`. `useSfx` stays for UI blips; rhythm timing must schedule against `AudioContext.currentTime`, never `setTimeout`. Include a one-time latency-calibration screen and persist the offset in `localStorage`. Mute must be global and persisted. |
| Countdown / pause | Shell-owned, not per-game. Pause must also trigger on `visibilitychange` and on blur. |
| Reduced motion | The repo has **no** `prefers-reduced-motion` handling today. The framework should introduce it: a `useReducedMotion` hook that suppresses background motion and particle effects while leaving timing unchanged. |
| Results | One shared `<ArcadeResults>` rendering score, per-game stat lines, tickets earned and the bonus breakdown. |
| Reward claim | One `useArcadeReward(result)` hook — the *only* thing allowed to write inventory (§13). |
| Idempotency | `runId` + a persisted claimed-set (§16). |
| Error recovery | A grant failure must show "couldn't save your tickets — retry", never silently succeed. A retry re-uses the same `runId`. |
| Future leaderboard | The result object should already be serialisable and stable, so publishing it later is additive. Do not publish anything now. |

### 10.3 Where the game renders — decide this first

`GameModal` today renders *inside* the scaled `VirtualWorld` (§3). Recommendation: **render
minigames outside the world**, as a full-viewport surface using the same Radix `Dialog`
primitive as every other modal, for three reasons: a rhythm game needs the full viewport height
on mobile; text at world-scale is unreadable on small screens; and input handling should not
compete with `data-world-surface` click routing. `GameModal` should be replaced by
`ArcadeGameShell`, not extended.

### 10.4 What to take from the theater — and what not to

Take: the reducer/derived-view discipline, the "fire on confirmed arrival, never on click"
rule, the data-driven config with stable ids, and the habit of testing the pure module hard.
Do **not** take: any import from `src/lib/theater-*` or `src/components/blobbi/theater/*`. The
arcade must not depend on theater code; the shapes are similar, the domains are not.

---

## 11. Arcade Ticket architecture recommendation

Per the product direction: an official kind:31632 definition, quantities in the existing
kind:31633 inventory, no new kind. This fits the existing architecture with **three small,
well-scoped changes** and no protocol invention.

### 11.1 Canonical address

The established convention is `blobbi:<category>:<slug>`, with the address derived as
`31632:<issuer>:<d>` by `buildGameItemAddress` (`registry.ts:68-72`). Every one of the 19
existing items follows it. **`blobbi:currency:arcade-ticket` is therefore consistent with the
repo's own convention and is the recommended `d`** — the audit found no naming convention that
suggests a better one. Do not publish it until the artwork and copy are final.

### 11.2 The three choke points that must change

1. **`ItemCategory`** (`src/inventory/catalog-fallback.ts:36`) is
   `'food' | 'toy' | 'medicine' | 'hygiene' | 'energy'`. Add `'currency'`.
2. **`VALID_CATEGORIES`** (`src/inventory/protocol-adapter.ts:41-47`) is the same closed set.
   Without `'currency'`, a fetched ticket definition resolves to `category: 'unknown'`.
3. **`ItemBagModal.CATEGORY_SECTIONS`** (`ItemBagModal.tsx:25-31`) drives both the section list
   and the filter `cat !== 'unknown' && map.has(cat)`. Tickets would be **silently dropped from
   the bag** without a section — a currency section (rendered read-only, at the top) is needed.

### 12.3-adjacent design answers

| Question | Answer |
| --- | --- |
| Is `currency` an appropriate category? | Yes — it is a UI/semantic label, and the protocol imposes no closed set. It keeps tickets out of the consumable sections and makes the read-only treatment natural. |
| Stackable? | **Yes.** 31633 quantities are decimal integers; `addInventoryItemQuantity` enforces integer/non-negative and guards `MAX_SAFE_INTEGER`. Nothing extra to build. |
| Consumable only via the prize shop? | **Yes.** Set `action: null` in the definition. `useUseItem` already throws `"Item has no usable action"` for a null action (`useUseItem.ts:117-119`), so tickets cannot be fed to a Blobbi. Spending goes through a dedicated prize-shop hook using `useInventoryMutation({type:'remove'})`. |
| Transferable? | **No, for v1.** The package exposes grant primitives (`GRANT_MARKER`, `BuildGameInventoryGrantInput`) but Island's `buildInventoryTemplate` does not emit them and there is no transfer UI. Player-to-player transfer would also make the anti-farming limits in §12 meaningless. |
| Preserving unrelated entries? | Already guaranteed. `buildInventoryTemplate` rebuilds from the **full** `getInventoryItems(inventory)` list, and the write base is a fresh relay read, not a cache snapshot. |
| Optimistic + rollback? | Already implemented in `useInventoryMutation` (`onMutate` snapshot → `onError` restore → `onSettled` invalidate). The arcade should not add a second layer. |
| Offline behaviour? | Add a `blobbi:currency:arcade-ticket` entry to `catalog-fallback.ts` so the ticket renders (name, emoji `🎟️`, category) with zero relays reachable, exactly like the other 19. |
| UI display | Three places: a persistent ticket chip in the arcade (reuse the `ArcadePassIcon` slot in `PlayingView.tsx:657-672`, but read the 31633 balance, not `sessionStorage`); a read-only currency section in `ItemBagModal`; and the balance + delta on the results screen. |

### 11.4 What must **not** happen

- No ticket balance on kind:11125. Coins live there; tickets do not.
- No new kind. 31632 + 31633 is sufficient.
- No second inventory `d`. Tickets belong in `blobbi:island` alongside everything else.
- No publishing of the official definition from client code, and no issuer key in the repo.

---

## 12. Reward economy recommendation

### 12.1 Shape

Reject a global `score → tickets` conversion. Each game owns an explicit, **pure** policy. The
suggested shape in the brief is close; adapt it to the repo's preference for pure modules with
tests (`theater-playback.ts`) rather than object contracts:

```ts
// src/arcade/reward-policy.ts  — pure, no React, no Nostr, unit-tested
export interface ArcadeGameResult {
  gameId: string;
  runId: string;          // generated at countdown→playing; the idempotency key
  difficulty: 'easy' | 'normal' | 'hard';
  cleared: boolean;
  score: number;
  stats: Record<string, number>;   // per-game: maxCombo, accuracy, timeMs, ...
  startedAt: number;
  endedAt: number;
}

export interface TicketAward {
  base: number;
  bonuses: { firstClear?: number; dailyFirstPlay?: number; personalBest?: number };
  multiplier: number;
  total: number;          // after multiplier and cap
  capped: boolean;        // surfaced honestly in the results UI
}

export interface ArcadeRewardPolicy {
  gameId: string;
  base(result: ArcadeGameResult): number;       // participation floor applied by the shell
  maxTicketsPerRun: number;
}
```

Bonuses, multipliers and caps are applied by **one shared function**, not per game, so no game
can invent its own economy.

### 12.2 Numbers (starting point, tunable)

| Lever | Recommendation |
| --- | --- |
| Target per run (~90 s) | **3–15 tickets** |
| Losing / not clearing | **Yes — 1–2 participation tickets.** Zero on a loss makes a rhythm game feel punishing and pushes players to quit-and-retry, which is worse for the economy than the tickets it saves. |
| Difficulty multiplier | ×1.0 easy / ×1.25 normal / ×1.5 hard, applied **before** the cap |
| First clear of a game | **+10, once ever, per game** |
| First play of a game each day | **+5** |
| New personal best | **+5** (only when the run also cleared) |
| Hard cap per run | **25** |
| Anti-farming | After **6 rewarded runs of one game per UTC day**, further runs award participation tickets only. Announce it in the results UI ("daily bonus used up — come back tomorrow"), never silently. |
| Coins | **Milestone only.** e.g. 25 coins the first time a game is cleared. Never per run. |

### 12.3 Fairness across incompatible score scales

Because each policy converts to tickets locally, score scales never need to be comparable. The
invariant to enforce in tests is the *output* band, not the input: for any policy, a clear at
normal difficulty must fall inside 3–15 before bonuses, and no policy may exceed
`maxTicketsPerRun`. A single parameterised test over the policy registry keeps every future
game inside the band.

### 12.4 Honesty rules

- The results screen shows the breakdown (base + each bonus × multiplier, cap applied).
- If the cap or the daily limit truncated the award, say so.
- If the grant fails, say so and offer retry — never show "+8 tickets" for tickets that did not
  persist.

---

## 13. Inventory integration boundaries

```
  ┌──────────────────────────────────────────────────┐
  │  GAME (pure)                                     │  no Nostr, no inventory, no React Query
  │  input → simulation → ArcadeGameResult(runId)    │
  └───────────────────────┬──────────────────────────┘
                          ▼
  ┌──────────────────────────────────────────────────┐
  │  REWARD POLICY (pure)                            │  no I/O; deterministic
  │  ArcadeGameResult → TicketAward                  │
  └───────────────────────┬──────────────────────────┘
                          ▼
  ┌──────────────────────────────────────────────────┐
  │  useArcadeReward  (the ONLY arcade→Nostr seam)   │  idempotency, retry, error surface
  │  → useInventoryMutation({type:'add', ...})       │
  │  → (rarely) useCoinsMutation(+n) for milestones  │
  └──────────────────────────────────────────────────┘
```

Non-negotiable boundaries:

- **Games never import from `src/inventory/`.** A game that can write inventory is a game that
  can be made to write inventory in a loop.
- **`useArcadeReward` never re-derives a score.** It consumes a finished result.
- **No new inventory write layer.** `useInventoryMutation` already serialises per user, reads
  fresh, validates quantities and rolls back.
- **No 11125 writes from the arcade** except milestone coins through `useCoinsMutation`.
- The reward hook must **not** assume publish success. See §16.3.

---

## 14. Nostr opportunities and non-goals

**Direction (endorsed):** `local gameplay → deterministic final result → validated reward →
inventory update → optional publication`. Gameplay must never await a relay.

### Useful, additive, low-risk (future phases)

| Feature | Notes |
| --- | --- |
| Personal best | Fits naturally as *addressable* per-player-per-game state. Self-reported, but a personal best only competes with yourself, so trust is a non-issue. Lowest-cost first Nostr feature. |
| Shared result card | Reuse `ShareModal` / `SocialShareModal`, which already exist. Zero new protocol. |
| Achievements | kind:11125 already has an `achievement` tag (`NIP.md:62`). Arcade achievements can use the existing field with **no new kind at all**. This is the single cheapest Nostr win available. |
| Friend challenge | "Beat my score on this seed" — needs a seed in the result, which the framework should carry from day one even if unused. |

### Needs care

- **Global / relay-scoped leaderboards.** Technically easy, socially fragile: a fully
  client-side game's score is whatever the client says it is. If published, it must be labelled
  as self-reported. Consider scoping the first leaderboard to follows rather than global.
- **Tournament rounds** — requires an organiser and adjudication rules; a full protocol design,
  not a feature.

### Non-goals (recommend explicitly declining)

- **Real-time multiplayer over relays** (live air hockey). Relay round-trips are the wrong
  transport for a 60 Hz physics game.
- **Anti-cheat.** State it plainly in the docs: a client-side game **cannot** be made
  cheat-proof. Nothing short of server-side simulation or a trusted adjudicator changes that,
  and neither exists here. Design the economy so cheating is boring (caps, sinks, no transfers)
  rather than pretending it is prevented.
- **Replay/proof metadata as an anti-cheat measure.** A replay is only as trustworthy as the
  client that produced it. Useful as a *feature* (watch a run back); worthless as proof.
- **Inventing a leaderboard kind now.** Out of scope for this audit and premature until a game
  exists.

---

## 15. Official event-registry recommendation

Today the protocol truth is spread across four places that must be kept in sync by hand:
`NIP.md` (kinds), `src/inventory/registry.ts` (the 19 official item `d` values),
`src/inventory/catalog-fallback.ts` (their exact published metadata), and
`src/inventory/constants.ts` (issuer + relays). `docs/protocol/` currently holds a single
document (`shared-playback-session.md`).

**Recommendation: one machine-readable source of truth plus generated Markdown.**

- Source: `src/protocol/event-registry.ts` — a typed, exported const covering every kind
  (purpose, class, address format, signer, lifecycle, implementation status, implementing
  files) and every official 31632 item (`d`, canonical tags, canonical content, status).
- Generated: `docs/protocol/blobbi-island-event-registry.md`, produced by a small script.
- Guard: a test that regenerates and diffs, failing if the doc is stale. This is the pattern the
  repo already trusts (`theater-seats-config.test.ts` checks measured config; `catalog.test.ts`
  checks the fallback catalog matches).
- Migrate `registry.ts` + `catalog-fallback.ts` to *derive* from the single source rather than
  duplicating it, so "three catalogs drifting apart" cannot happen.

Recovery boundary, to be stated in the document itself: **the registry can recreate and
republish official kind:31632 definitions** (they are issuer-signed and deterministic from the
recorded tags/content), but it **cannot** reconstruct any player's kind:31633 balance,
ownership history or coins — those live only in the user's own events.

This audit deliberately did **not** create the registry: it is a real deliverable with a
generator and a test, not a documentation stub, and inventing a half version now would create
the fourth hand-maintained catalog the recommendation exists to prevent.

---

## 16. Security, idempotency and abuse risks

### 16.1 What can be handled locally

| Risk | Mitigation |
| --- | --- |
| Double-clicked claim | Disable during `claiming`, **and** guard on `runId`. `useInventoryMutation` serialises but does not deduplicate — two `add` mutations both add. |
| React re-render / StrictMode double-invoke | Claim from an explicit event, never from an effect keyed on the result object. Same `runId` guard catches the rest. |
| Retry after a visible failure | Reuse the same `runId`; a claimed `runId` is a no-op. |
| Replaying a completed result | The state machine forbids `results → playing`; `runId` is minted at `countdown → playing`. |
| Refresh mid-claim | Persist `{runId, award, status:'pending'}` to `localStorage` **before** publishing, replay unfinished claims on next arcade mount, mark `claimed` after verification. Without this the tickets are simply lost. |
| Same game in two tabs | Distinct `runId`s are legitimately two runs. The real hazard is kind:31633 being replaceable: two near-simultaneous writes can clobber (already documented in `docs/INVENTORY_ARCHITECTURE.md`). The daily cap limits the damage; the claimed-set should be shared via `localStorage` (not `sessionStorage`) so both tabs see it. |
| Empty-inventory overwrite | **Already mitigated** — `useInventoryMutation` uses a fresh relay read as the write base, never an empty cache. |
| Stale inventory read | Mitigated by the same fresh read + `onSettled` invalidation. |
| Farming by replay | Daily rewarded-run cap per game + per-run cap + participation floor (§12). |

### 16.2 The specific failure the current code would produce

`useNostrPublish` (`:33-38`) resolves successfully on timeout. Combined with optimistic updates,
the sequence "award 8 tickets → publish times out → optimistic cache shows +8 → `onSettled`
invalidates → refetch shows the old balance" presents as tickets appearing and then vanishing
with **no error at any point**. This is the single highest-severity defect standing between the
current code and a trustworthy reward loop, and it is *not* in the arcade — it is in the shared
publish primitive.

Recommended handling, in order of preference: (a) a `strictPublish` for reward grants, mirroring
`useFirstEggAdoption`'s existing workaround; or (b) a verify-after-publish read of 31633
confirming the new quantity before marking the claim `claimed`.

### 16.3 What cannot be protected

- **Client-modified scores and forged result objects.** The result is produced in the player's
  own browser. Nothing client-side changes this.
- **Relay replacement races** across devices — inherent to replaceable events.
- **Non-atomic multi-event operations** (grant + coins) — already documented and accepted for
  purchases; the same reasoning applies to milestone coin rewards, and the same favour-the-user
  ordering should be used.

**Do not claim otherwise in product copy.** The honest position is: rewards are bounded and
sinks are limited, so cheating buys little; scores shared over Nostr are self-reported.

---

## 17. Prioritised implementation roadmap

**Phase 0 — Stop the arcade lying (small, standalone, shippable immediately).**
Nine machines must not all claim to be a dance game. Either give each machine an honest
"Coming soon" state, or remove the click affordance from the eight that have no game. Remove
the hover-scale/cursor from the microphone and the PRIZES counter until they do something. Fix
the `alt` text across all 30 decorative sprites and the mislabelled mic/cabinets. This phase
has no dependencies and materially improves the product today.

**Phase 1 — Arcade foundation.**
`src/arcade/` with the pure state machine + tests, `ArcadeGameShell` (Radix Dialog, outside the
world), `useArcadeInput`, the audio module with latency calibration, `useReducedMotion`,
`arcade-machines-config.ts` + `<ArcadeMachine>` (stable ids, walk-to-interact via
`usePendingInteraction`, movement blockers). Add the real `/dev/arcade` route on the
`DevTheater` pattern. Extract the arcade branch out of `InteractiveElements.tsx`.

**Phase 2 — Arcade Ticket item.**
Finalise `blobbi:currency:arcade-ticket` + artwork, publish the official 31632 definition
(out-of-band, with the issuer key), add the registry entry, the bundled fallback, the
`currency` category through all three choke points (§11.2), and the balance UI.

**Phase 3 — First game: rhythm/dance.**
Smallest launchable version (§18) wired to the framework, plus `useArcadeReward` with full
idempotency and honest error surfacing, plus the publish-reliability fix from §16.2.

**Phase 4 — Prize shop.**
The PRIZES counter becomes a real shop spending tickets. Ships in the same release as tickets;
a currency with no sink is not a currency.

**Phase 5 — Hardening.**
Fix the pass economy (route through `useCoinsMutation`, or convert the pass itself into an
inventory item), fix the pass-holder spawn point and the elevator z-index tie, add the missing
`data-block-move` on the slide branch, add the loading/error state to the pass modal.

**Phase 6 — Second game and optional Nostr.**
The karaoke/singing game (tap variant) reuses most of the framework, then personal bests and
arcade achievements via the existing kind:11125 `achievement` tag.

---

## 18. Recommended first vertical slice

**Rhythm/dance game on the basement dance machine — confirmed.**

The code and the art both support it over the alternatives: it is the only machine whose sprite
depicts its own control scheme, it sits in a room already dressed as a music venue, it needs no
physics engine, it is the only candidate that is genuinely good on both desktop and mobile, and
it exercises every shared system in one pass. Air hockey and pool have exact art but demand
physics and (for the fun version) real-time netcode; the six cabinets have no defined game at
all; the singing game needs microphone permission for its interesting version.

**Smallest launchable version** (definition only — not implemented here):

- One track, one difficulty, ~60–90 seconds.
- Four lanes; arrow keys on desktop, four full-height tap zones on mobile.
- Three judgements: Perfect / Good / Miss, with a combo counter.
- Fixed, authored note chart in a plain data file — no generator, no editor.
- Countdown → play → results. Pause on `visibilitychange`/blur.
- Score = judgement weights + combo bonus. Clearing = finishing above a threshold.
- Reward: `calculateTickets` per §12, with the participation floor, first-clear and
  daily-first-play bonuses. No leaderboard, no personal best yet.
- Accessibility from day one: reduced-motion mode, adjustable timing window, an audio-latency
  calibration step, and a visual-only cue for every audio cue.
- **Explicitly out of the first slice:** multiple songs, difficulty selection, multiplayer, any
  Nostr publication beyond the ticket grant, and the other eight machines.

**The one thing that must be resolved before starting:** the music. A rhythm game needs a track
whose licence permits redistribution. Whether Blobbi Island commissions an original loop or uses
a CC-licensed one is a product decision that blocks the slice.

---

## 19. Exact files to change in the next phase

**New:**

| File | Purpose |
| --- | --- |
| `src/arcade/arcade-machine-state.ts` + `.test.ts` | Pure state machine (§10.1) |
| `src/arcade/reward-policy.ts` + `.test.ts` | Pure policies, bonuses, caps (§12) |
| `src/arcade/useArcadeReward.ts` + `.test.tsx` | The only arcade→Nostr seam (§13, §16) |
| `src/arcade/useArcadeInput.ts` | Keyboard + touch mapping |
| `src/arcade/audio/arcade-audio.ts` + `.test.ts` | `AudioContext` scheduling, mute, latency offset |
| `src/hooks/useReducedMotion.ts` | First reduced-motion support in the repo |
| `src/lib/arcade-machines-config.ts` + `.test.ts` | Stable ids + measured placement for all 9 machines |
| `src/components/blobbi/arcade/ArcadeMachine.tsx` | Walk-to-interact machine (sibling of `TheaterSeat`/`TownBush`) |
| `src/components/blobbi/arcade/ArcadeGameShell.tsx` | Radix-Dialog game surface replacing `GameModal` |
| `src/components/blobbi/arcade/ArcadeResults.tsx` | Shared results + reward breakdown |
| `src/components/blobbi/arcade/ArcadeRoom.tsx` | The arcade branch extracted from `InteractiveElements` |
| `src/pages/DevArcade.tsx` | DEV-only harness, on the `DevTheater` pattern |
| `src/protocol/event-registry.ts` + generator + staleness test | §15 |
| `docs/protocol/blobbi-island-event-registry.md` | Generated output |

**Modified:**

| File | Change |
| --- | --- |
| `src/components/blobbi/InteractiveElements.tsx` | Remove `handleElementClick`'s dance-machine special case, the arcade branch (→ `ArcadeRoom`), the arcade modal state, and add `data-block-move`/pointer handling to the `slide` branch |
| `src/components/blobbi/GameModal.tsx` | Delete, or narrow to non-game use |
| `src/inventory/catalog-fallback.ts` | Add `'currency'` to `ItemCategory`; add the ticket fallback entry |
| `src/inventory/protocol-adapter.ts` | Add `'currency'` to `VALID_CATEGORIES` |
| `src/inventory/registry.ts` | Add `blobbi:currency:arcade-ticket` (or derive from the new registry) |
| `src/components/blobbi/ItemBagModal.tsx` | Add a read-only currency section |
| `src/components/blobbi/ArcadePassModal.tsx` | Route the charge through `useCoinsMutation`; add loading/error states |
| `src/components/blobbi/ArcadePassIcon.tsx` | Replace the 1 Hz `sessionStorage` poll; show the ticket balance |
| `src/components/blobbi/ElevatorModal.tsx` | Theme tokens; mark the current floor |
| `src/lib/location-initial-position.ts` | Fix the pass-holder spawn inside the elevator alcove |
| `src/lib/interactive-elements-config.ts` | Resolve the `z-10` tie at the elevator |
| `src/hooks/useNostrPublish.ts` *(or a local strict wrapper)* | Stop treating timeouts as success for reward grants |
| `src/AppRouter.tsx` | Register `/dev/arcade` behind `import.meta.env.DEV` |
| `NIP.md` | Point at the generated registry |

---

## 20. Open product decisions

1. **Ticket `d` value** — confirm `blobbi:currency:arcade-ticket`. It matches the repo's own
   `blobbi:<category>:<slug>` convention; the audit found no reason to deviate.
2. **Ticket artwork and identity** — paper ticket, token, or digital pass? This also decides
   whether the existing `public/assets/items/tickets/arcade-ticket.png` (currently the Arcade
   *Pass* art) is reused, and if so what the pass becomes.
3. **Prize catalog** — what tickets buy (consumables / cosmetics / trophies), and the price
   curve. Blocks Phase 4, and the ticket-per-run band in §12 is meaningless without it.
4. **Does the Arcade Pass survive?** Three options: keep it as a session flag but charge
   correctly; convert it into a 31632 inventory item with a real duration; or delete it and make
   the floors free. Also decide whether it survives leaving the arcade.
5. **Music licensing** — blocks the first vertical slice (§18).
6. **Does losing award tickets?** Recommendation: yes, 1–2. Needs a product ruling.
7. **Daily caps** — is 6 rewarded runs per game per day the right number, and is the cap per
   game or arcade-wide?
8. **Do coins stay in the arcade at all?** Recommendation: milestone-only. Confirm.
9. **Do the six generic floor-1 cabinets get games, or become themed scenery** pointing at the
   two "real" machines? Nine machines is a lot of unfulfilled promises.
10. **Leaderboard trust posture** — global, follows-scoped, or none. Because scores are
    self-reported, this is a product/communication decision, not a technical one.

---

## Appendix A — Validation performed

**Commands run**

| Command | Result |
| --- | --- |
| `npm test` (`tsc --noEmit && eslint && vitest run && vite build`) | `tsc` ✅ · `eslint` ✅ · `vitest` **1 failed / 1186 passed** (63 files) → chain stopped, `vite build` not reached |
| `npx vitest run src/components/blobbi/InteractiveElements.plaza-door.test.tsx` | 1 failed / 5 passed — confirms the failure is pre-existing and reproducible in isolation |
| Temporary jsdom probe (arcade DOM enumeration, run from `src/`, deleted) | Enumerated 9 / 21 / 27 sprites and their click handlers per floor |
| `npx vite` + Chrome click-through | See below |

The single failing test is **pre-existing on `production` and unrelated to the arcade**
(Plaza inside door, mobile-parity touch reveal — see §8 item 11). It was not fixed, per the
audit brief.

**Browser validation** (Chrome, `http://localhost:8081`, via a temporary DEV-only `/dev/arcade`
harness modelled on `DevTheater`; the harness and its route were **removed** and the working
tree is clean):

- Ground / Floor 1 / Basement all rendered correctly; screenshots captured of each.
- Ticket counter → `ArcadePassModal` opened; **Buy Ticket** granted the pass with **zero**
  published events (WebSocket spy), and the balance shown inside the modal dropped 983338 →
  983318 while the real balance was untouched.
- Elevator → floor modal → navigated to Floor 1 and Basement.
- **Pool table** → "Dance Dance Blobbi" modal. **Air hockey** → same modal. **Dance machine** →
  same modal. **Start Game** → no effect.
- **PRIZES counter** → nothing; console showed only
  `Interactive element clicked: prizes (location: arcade)`.
- **Stage microphone** → nothing at all (no walk, no modal).
- **Basement chair** → the Blobbi walked to the chair and stood inside the sprite; no seated
  pose or state.
- **Pass-holder spawn defect** → from the pass spawn point the Blobbi could not reach the ticket
  counter and the modal never opened; clicking open floor first fixed it.
- **Z-index defect** → the Blobbi rendered behind the closed elevator doors.
- Console errors during the session: **none** (only the app's own `console.log` diagnostics).

**Relay hygiene:** no rewards, items, profiles or inventory were published. The logged-in
browser session did emit routine `kind:31950` presence heartbeats (self-expiring via NIP-40 in
~35 s) carrying a fixture Blobbi id, which is unavoidable when mounting the real `PlayingView`
while signed in. Nothing durable was written.

**Remaining uncertainties**

- Whether the pass-holder spawn strands the Blobbi at every viewport size, or only at the
  ~760×520 world scale tested.
- Mobile/touch behaviour was not exercised on a real device; touch paths were read from code
  and from the jsdom probe only.
- The official kind:31632 definitions were not fetched from the official relays during this
  audit, so the "canonical published content" claims rest on `catalog-fallback.ts`, which the
  repo asserts mirrors them exactly.
- Audio latency on the target devices is unmeasured, and it is the main technical risk in the
  recommended first slice.
