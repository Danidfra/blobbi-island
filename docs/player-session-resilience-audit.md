# Player Session Resilience: Why an Existing Player Sees "Your nest is empty"

Audit-only. No production behaviour was changed.

- **Branch:** `production` · **HEAD:** `a1036e90c5e7e8bcbf8b4c69dd278c4a5e9904b3`
  (`fix(economy): preserve coin deltas and serialize shared inventory writes`)
- **Working tree:** clean · `a1036e9` confirmed an ancestor of HEAD
- **Upstreams:** 1 ahead of `nostr/production`, 24 ahead of `origin/main`
- **Validation:** `npm test` → exit 0 (243 files / 4731 tests, eslint 0 errors)

Companion: [`mine-session-settlement-audit.md`](mine-session-settlement-audit.md).

> **RESOLVED.** Findings 1–4, 6 and 7 of §12 were fixed by
> `fix(state): preserve player data across uncertain relay reads`. See
> [`relay-read-resilience.md`](relay-read-resilience.md) for the implemented
> semantics. This document is kept as the audit-time evidence; the per-finding
> status is recorded in §12.

---

## 1. Verdict, in one line

> **Authentication never breaks. The relay layer silently converts every read
> failure into "the player owns nothing", and the app treats that as a fact.**

`NPool.query`: the pool the whole app reads through, **never throws**. On
timeout, abort, or any internal error it resolves with *partial results*, which
is usually `[]`. Every consumer therefore sees a **successful, empty** answer.
`useBlobbis` writes `[]` over the player's known Blobbis, `BlobbiIsland` routes
`'playing' → 'selection'`, and the selection screen, seeing no error and no
pets: renders "Your nest is empty. You don't have a Blobbi yet."

This is the **same defect class** as the kind:31633 empty-base bug fixed in
`a1036e9` ("relay returned no event ≠ the state does not exist"), in the pet and
profile read path, where nothing confirms it.

---

## 2. The proof

`node_modules/@nostrify/nostrify/dist/NPool.js`: its own doc comment, line 137:

> *"If the signal is aborted, this method will return partial results instead of
> throwing."*

and the implementation:

```js
async query(filters, opts) {
  const events = new NSet(map);
  try {
    for await (const msg of this.req(filters, { ...opts, eoseTimeout })) {
      if (msg[0] === "EOSE") break;
      if (msg[0] === "EVENT") events.add(msg[2]);
      if (msg[0] === "CLOSED") break;
    }
  } catch {          // <-- EMPTY CATCH: nothing ever propagates
  }
  return [...events];   // <-- [] on timeout, on connect failure, on any error
}
```

`src/components/NostrProvider.tsx:31` constructs exactly this `NPool`, so every
`nostr.query(...)` in the app inherits it.

### Reproductions run (all passed)

| # | Scenario | Result |
|---|---|---|
| 1 | Real `NPool.query` against an unreachable relay with `AbortSignal.timeout(300)` | `resolved=true length=0 after 304ms`: **no throw** |
| 2 | `useBlobbis`: load 1 pet, then a refetch that resolves `[]` | `before=1 pets → after=0 pets, isError=false`: **good state erased, reported as success** |
| 3 | `useBlobbis`: load 1 pet, then a refetch that **throws** | `before=1 → after=1, isError=true`: the safe path, **which NPool never takes** |
| 4 | `BlobbiIsland` routing expression while `'playing'` | `blobbis: []` → `'selection'`; `blobbiError` → `'selection'`; `selectedBlobbi: null` → `'selection'` |
| 5 | `BlobbiSelectionScreen` with `data: []`, `error: null`, `currentCompanion: 'blobbi-a'` | renders **"Your nest is empty" / "You don't have a Blobbi yet."** |

Reproduction source is reproduced verbatim in §11 so this is re-runnable.

---

## 3. Authentication is NOT the cause

`src/hooks/useCurrentUser.ts` derives `user` **synchronously** from
`useNostrLogin().logins` (localStorage-backed, `@nostrify/react/login`):

```
localStorage logins  →  useNostrLogin()  →  loginToUser()  →  NUser  →  user
```

- No relay call, no query, no async step.
- `nostr` is only used to *construct* a bunker signer, never to validate.
- A `loginToUser` throw is caught per-login (`console.warn('Skipped invalid login')`)
  and only skips that login.
- Nothing anywhere calls a logout on a relay/query error
  (`rg 'logout|removeLogin'` finds only explicit user actions).

**State model, as implemented:**

| State | Representation | Reachable from a relay failure? |
|---|---|---|
| `AUTHENTICATED` | `user !== undefined` |, |
| `AUTH_LOADING` | **does not exist**: resolution is synchronous |, |
| `SIGNED_OUT` | `user === undefined` (no stored login) | **No** |
| `AUTH_ERROR` | **does not exist**: a bad login is silently skipped | No |

So the login screen (`gameState === 'login'`, gated on `!user`) is *not* what
players are seeing. The symptom is entirely **player-data resolution**, and the
UI conflates `player-data-unknown` with `player-data-empty`.

One genuine caveat, not the observed symptom: a NIP-07 extension signer is
resolved lazily, so `user.pubkey` stays valid while a later `signEvent` can
still fail (extension locked/removed). That affects *writes*, not the nest.

---

## 4. The exact render gate

`src/components/blobbi/BlobbiSelectionScreen.tsx`:

```
line 30  const { data: blobbis, isLoading, error } = useBlobbis()
line 31  const { data: profile, isLoading: isLoadingCompanion } = useBlobbonautProfile()
line 39  modernBlobbis = (blobbis ?? []).filter(isModernBlobbi)
line 76  if (!user || isLoading || isLoadingCompanion) → <BlobbiLoadingScreen/>
line 80  if (error)                                    → "The nest is hiding" + Try again
line 132 hasBlobbis = modernBlobbis.length > 0
line 179 hasBlobbis ? <grid/> : <EMPTY NEST/>          ← "Your nest is empty"
```

As pseudocode:

```
if (!user || isLoading || isLoadingCompanion)  → LOADING
else if (error)                                → ERROR ("The nest is hiding")
else if ((blobbis ?? []).filter(isModernBlobbi).length === 0)
                                               → "Your nest is empty.
                                                  You don't have a Blobbi yet."
else                                           → grid
```

> **Can this screen appear while the app does not actually know whether the
> user owns a Blobbi? YES.**

The empty branch is reached whenever `error` is falsy and the filtered list is
empty. `error` is falsy for **every relay problem**, because NPool swallows them
all. The gate has no notion of "we asked and could not find out"; the only
inputs it distinguishes are *loading*, *threw*, and *count*.

Three additional ways to hit it with pets actually owned:

1. **Resolved-empty read** (the main one): `blobbis === []`.
2. **Partial read**: NPool returns *some* events before aborting; if none of
   the returned ones are modern, `modernBlobbis` is empty. Silent.
3. **Egg-only / legacy-only owner**: `useBlobbis` drops `stage === 'egg'`
   (`useBlobbis.ts:100`) and the screen drops non-modern Blobbis; both are
   deliberate, but both render the same destructive copy.

---

## 5. The full ownership path, layer by layer

```
localStorage login ──► useCurrentUser().user.pubkey        (synchronous, stable)
        │
        ├──► useBlobbis()            key ['blobbis', pubkey]
        │       kinds [31124], limit 25, AbortSignal.timeout(2000)
        │       staleTime 120 000 · refetchInterval 120 000 · retry 1
        │       filter validatePetStateEvent → parsePetState → drop stage 'egg'
        │
        ├──► useBlobbonautProfile()  key ['blobbonaut-profile', pubkey]
        │       kinds 11125+31125, limit 1, timeout 3000, staleTime 30 000
        │       → null when no valid event
        │
        └──► useOptimizedStatus()    keys ['owner-profile', pubkey]
                                          ['pet-states',    pubkey]
                 both timeout 3000, staleTime 30 000
                 pets → [] when none; owner → null when none

BlobbiIsland: selectedBlobbi = manualSelectionId ?? profile.currentCompanion
              resolved against `blobbis`
            → gameState switch → PlayingView | BlobbiSelectionScreen
```

**Four overlapping caches hold pet/profile data**: `['blobbis']`,
`['pet-states']`, `['blobbonaut-profile']`, `['owner-profile']`: each fetched
by a different function with different timeouts and stale times, and each able
to disagree with the others.

### Per-layer state discrimination

| Layer | unknown / loading | known non-empty | known empty | error / unreachable | stale-but-known |
|---|---|---|---|---|---|
| `NPool.query` |: | events | `[]` | **collapsed into `[]`** |, |
| `useBlobbis` | `isLoading` | `data.length>0` | `data=[]` | **never reached** | data + `isStale` |
| `useBlobbonautProfile` | `isLoading` | profile | `null` | **never reached** | data |
| `useOptimizedStatus` | `isLoading` | pets | `[]` / `null` | **never reached** | data |
| `BlobbiIsland` | `'loading'` (≤2 s) | `'playing'` | `'selection'` | `'selection'` |, |
| Selection screen | loading screen | grid | **"nest is empty"** | error screen (unreachable) |, |

**Every layer collapses `error/unreachable` into `known empty`.** The collapse
happens once, in the dependency, and every layer above inherits it.

---

## 6. Where good known state is downgraded

| # | Site | Downgrade |
|---|---|---|
| 1 | `NPool.query` `catch {}` | any failure → `[]` |
| 2 | `useBlobbis` (no `placeholderData`/merge) | a successful `[]` **replaces** a non-empty list |
| 3 | `useBlobbonautProfile` queryFn `→ null` | a successful empty read **replaces** a known profile, losing `currentCompanion` |
| 4 | `useOptimizedStatus.petsQuery` `→ []` | same for the status cache |
| 5 | `BlobbiIsland.tsx:94` `if (blobbiError \|\| companionError) return 'selection'` | an error **ejects the player from `'playing'`** even though TanStack still holds the previous data |
| 6 | `BlobbiIsland.tsx:100-108` 2-second loading timeout → `'selection'` | a slow first load becomes "selection" (and, if data is empty, "empty nest") |
| 7 | `BlobbiSelectionScreen.tsx:80` `if (error)` before the data check | hides perfectly good cached pets behind "The nest is hiding" |

Sites 5 and 7 are the interesting pair: TanStack *does* retain `data` on a
thrown error (reproduction 3), so the app **has** the good state and chooses not
to use it. But because NPool never throws, those branches are close to dead code
in practice: the real path is site 2.

---

## 7. Current companion resolution

Two different resolvers, with different fallbacks:

```
BlobbiIsland.tsx:65-75         useOptimizedStatus.ts:88-92
  manualSelectionId               owner?.currentCompanion
    ?? profile.currentCompanion     ? allPets.find(id) || null
       (must be MODERN)             : allPets[0] || null      ← silent fallback
    else null → 'selection'
```

- If the profile read resolves empty, `profile` becomes `null`,
  `currentCompanionId` becomes `undefined`, and, when the player entered the
  world automatically rather than by clicking a card (`manualSelectionId ===
  null`): `selectedBlobbi` becomes `null` → **`'selection'`**, i.e. the player
  is ejected *even though `blobbis` is intact*.
- `useOptimizedStatus` instead falls back to `allPets[0]`, so the HUD can show a
  **different Blobbi** than the one the world thinks is active.

So "has pets but the companion is temporarily unresolved" is **not**
distinguished from "has no pets": both end in `'selection'`, and if `blobbis`
is also empty at that moment, in the destructive empty copy.

`useSetCurrentCompanion` is the one place that gets this right; it holds an
optimistic value and only invalidates after `confirmCompanionOnRelay` confirms
(read-your-write). That pattern is exactly what the read path lacks.

---

## 8. Query keys and invalidations (complete)

| Key | Owner | Timeout | staleTime | Refetch triggers |
|---|---|---|---|---|
| `['blobbis', pubkey]` | `useBlobbis` | 2 000 ms | 120 000 | `refetchInterval` 120 s; **`useUpdatePetState.onSuccess`**; `handleHatchComplete` |
| `['pet-states', pubkey]` | `useOptimizedStatus` | 3 000 ms | 30 000 | **`useUpdatePetState.onSuccess`**; `useUseItem.onSettled`; `refreshFromRelay()`; optimistic (`refetchType:'none'`) |
| `['owner-profile', pubkey]` | `useOptimizedStatus` | 3 000 ms | 30 000 | `refreshFromRelay()`; `useSetCurrentCompanion.onSuccess`; optimistic (`refetchType:'none'`) |
| `['blobbonaut-profile', pubkey]` | `useBlobbonautProfile` | 3 000 ms | 30 000 | `useSetCurrentCompanion.onSuccess`; `handleHatchComplete` |

Global defaults (`src/App.tsx:28-36`): `refetchOnWindowFocus: false`,
`staleTime 60 000`, `gcTime 300 000`, `retry 1`, `retryDelay 1000`.
`refetchOnReconnect` is **not** set → TanStack default **`true`**.

Note `refetchOnWindowFocus: false` means desktop tab-switching is *not* a
trigger: a useful negative result. `refetchOnReconnect: true` means every
network flap is.

---

## 9. Desktop and mobile

Nothing in the failure depends on input device; both symptoms are pure data-layer.

**Desktop**

- Tab switch / blur / focus: no refetch (`refetchOnWindowFocus: false`). Not a trigger.
- Minimised window: `refetchInterval` pauses (`refetchIntervalInBackground`
  defaults `false`) and fires on return; one extra empty-risk read on resume.
- Multiple tabs: independent QueryClients, no cross-tab coordination for pet state.
- Slow network: the 2 s `useBlobbis` timeout is the tightest in the app and the
  most likely to abort → `[]`.
- Signer extension popup: blocks a *write*, not a read; does not clear `user`.

**Mobile (the worse case)**

- Backgrounding / screen lock / tab suspension: sockets are dropped. On resume,
  `refetchOnReconnect: true` plus the resumed `refetchInterval` fire several
  reads at once against relays that have not reconnected yet → a burst of
  resolved-empty answers → nest wipe on return.
- Network switching (Wi-Fi ⇄ cellular): same reconnect burst.
- The 2 s / 3 s timeouts are aggressive for mobile radios waking from idle.
- Orientation change: `BlobbiIsland` re-renders and `BlobbiPortraitGate` can
  replace the tree in portrait, local Mine state does not survive rotation.
- No PWA/service-worker wrapper is present; no AudioContext dependency in this path.

**Conclusion:** the symptom should be markedly more frequent on mobile and after
resume, which matches "especially noticeable" reports.

---

## 10. Dev-vs-production

Not dev-specific. `StrictMode` is **not** used (`src/main.tsx` renders
`<App/>` directly: verified), there are no dev-only query settings, and the
reproductions above use production hooks with a production `NPool`. The empty
catch is in the shipped dependency.

---

## 11. Recommended model (not implemented)

### Player state machine

```
                 ┌──────────────┐
                 │ auth-loading │  (does not exist today; resolution is sync)
                 └──────┬───────┘
        no login ┌──────┴───────┐ login present
        ┌────────▼───┐      ┌───▼──────────────────┐
        │ signed-out │      │ player-data-loading  │  no cached pets, read pending
        └────────────┘      └───┬──────────────────┘
                                │
         ┌──────────────────────┼───────────────────────────┐
         │                      │                           │
┌────────▼─────────┐  ┌─────────▼──────────┐  ┌─────────────▼────────────┐
│ known-nonempty   │  │ player-data-error  │  │ known-empty-nest         │
│ (render world)   │  │ (no cached pets +  │  │ ONLY on a CONFIRMED      │
└────────┬─────────┘  │  read unusable)    │  │ authoritative empty read │
         │            └────────────────────┘  └──────────────────────────┘
         │ background read unusable
┌────────▼──────────────────────────────────┐
│ player-data-stale  → KEEP the known pets, │
│ subtle "reconnecting" chip, never eject   │
└───────────────────────────────────────────┘
```

Recommended UI per state:

| State | UI |
|---|---|
| `signed-out` | login screen |
| `player-data-loading` (no cache) | loading screen |
| `known-nonempty` | world / grid |
| `player-data-stale` (cache + failed read) | **keep last known pets**, subtle reconnecting indicator, **stay in `'playing'`** |
| `player-data-error` (no cache + failed read) | "We couldn't reach your Blobbis" + Retry; never the empty copy |
| `known-empty-nest` | empty nest + Hatch, **only after a confirmed empty read** |

### The one structural change everything else depends on

The app cannot distinguish these states while its read primitive erases the
distinction. A thin wrapper is needed, the read-side twin of
`readAuthoritativeInventoryBase` from `a1036e9`:

```ts
// conceptual
async function queryOrThrow(nostr, filters, { timeoutMs }) {
  const controller = /* own timeout */;
  const events = await nostr.query(filters, { signal: controller.signal });
  if (controller.timedOut && events.length === 0) {
    throw new RelayUnavailableError();   // UNKNOWN, not empty
  }
  return events;
}
```

with an **empty-confirming second read** before any empty result is accepted as
authoritative for pets/profile: exactly the rule already proven for kind:31633.
Once reads can say "unknown", TanStack's existing `data`-retention (reproduction
3) gives stale-while-revalidate for free, and the gates in §6 can be corrected.

### Copy

`"You don't have a Blobbi yet."` is a **destructive semantic claim** the app
currently cannot back. It should be reachable only from `known-empty-nest`.
A distinct `"Reconnecting to your Blobbi Nest…"` (or the existing "The nest is
hiding" + Retry) belongs on `player-data-stale`/`player-data-error`.
*No wording was changed by this audit.*

### Reproduction source

The five reproductions in §2 were run from a temporary
`src/__audit_repro.test.tsx`, removed after the audit. They mock
`@nostrify/react`, `@/hooks/useNostr` and `@/hooks/useCurrentUser`, drive the
real `useBlobbis` / `BlobbiSelectionScreen`, and assert against
`queryClient.getQueryData(['blobbis', pubkey])` rather than `result.current`
(which lags a render). The NPool test constructs a real
`new NPool({ open: url => new NRelay1(url), reqRouter: … })` pointed at
`wss://unreachable.invalid` with `AbortSignal.timeout(300)`. They can be
committed as a regression suite on request.

---

## 12. Ranked root causes, with resolution status

1. **FIXED**: `NPool.query` never throws; every relay failure became a
   successful `[]`/`null`. Replaced by the EOSE-aware reader in
   `src/lib/relay-read.ts`, which reports `unknown` instead.
2. **FIXED**: `useBlobbis` / `useBlobbonautProfile` / `useOptimizedStatus` (and
   both kind:31633 reads) now throw on unknown, so React Query retains the
   known-good data instead of overwriting it.
3. **FIXED**: the routing rule is `nextGameState()`, which leaves `'playing'`
   only on a CONFIRMED empty list or a known list with no selectable companion.
   The last resolved companion is preserved across profile uncertainty.
4. **FIXED**: the destructive empty copy requires `Array.isArray(blobbis) &&
   !hasBlobbis && !isReadUnusable`. Cached pets survive a failed refetch behind
   a quiet `Reconnecting…` note; nothing-known + unusable read gets an error or
   reconnecting state.
5. **PARTIALLY FIXED**: the `refreshFromRelay` identity bug is fixed (11 → 1
   refresh; 38 → 18 relay reads per session). The 8 per-click kind:31124
   publishes are deliberately unchanged: that is the Mine settlement phase.
6. **REVIEWED, UNCHANGED**: `refetchOnReconnect: true` was an amplifier, not a
   cause. A reconnect burst now yields `unknown` (retained, quiet) rather than
   fabricated empties. Disabling it without evidence would trade a fixed problem
   for a staleness problem.
7. **OPEN (not destructive)**: four overlapping pet/profile caches with two
   companion-resolution rules remain. Consolidating them is a cache-architecture
   change, deliberately out of scope; the contradictory *fallback* was resolved
   in finding 3.
8. **(Ruled out)** Authentication loss. `user` is synchronous and localStorage-backed.
9. **(Ruled out)** StrictMode / HMR / dev-only behaviour.
