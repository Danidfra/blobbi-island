# Mine Session Durability and End-of-Run Settlement

Audit-only. No production behaviour was changed. Nothing implemented.

- **Branch:** `production` · **HEAD:** `a1036e9` · **tree:** clean
- **Validation:** `npm test` → exit 0 (243 files / 4731 tests)

Companion: [`player-session-resilience-audit.md`](player-session-resilience-audit.md),
which proves *why* the session dies. This document covers *what is lost* and
*how end-of-run settlement should work*.

> **RESOLVED.** The durable Mine session and end-of-run energy settlement
> designed in §7–§9 are **implemented**: see
> [`mine-session-settlement.md`](mine-session-settlement.md). Gameplay now
> publishes nothing (8 → **0** kind:31124 writes per run, 32 → **0**
> invalidations), the reward and energy cost settle once at the end under
> deterministic operation ids, and an interrupted run costs the player nothing.
> The one deliberate exception is §3's generic `useUpdatePetState`, left
> unchanged and recorded as follow-up in §12 of the implementation doc.
>
> Earlier note (relay-read phase):
>
> **PARTIALLY RESOLVED.** The relay-read phase
> ([`relay-read-resilience.md`](relay-read-resilience.md)) fixed the
> `refreshFromRelay` storm (11 → 1 refresh, 38 → **18** relay reads per session)
> and made an unlucky read unable to unmount the Mine at all. The energy write
> pattern (8 publishes, 32 invalidations) and everything in §5–§9 below are
> UNCHANGED and remain the next phase.

---

## 1. Verdict (audit-time; now fixed)

> **The Mine persists energy 8 times and the reward once, in that order, with
> no durable session identity. Any interruption between the first click and the
> finish leaves energy spent and no Coins, and the Mine's own writes are what
> cause the interruption.**

One measured session (energy 100 → 20) performs **8 kind:31124 publishes, 32
query invalidations and ~38 relay reads** in a few seconds. Each of those reads
can resolve empty (companion doc §2), and a single empty `['blobbis']` result
routes `'playing' → 'selection'`, unmounting the Mine.

---

## 2. Measured cost of one session

Driven through the real `MiningGame` component with mocked hooks counting calls:

```
clicks issued             = 12   (game ends after 8; energy 100 → 20 at 10/click)
kind:31124 publishes      = 8
query invalidations       = 32
   optimistic:owner-profile  8   (refetchType 'none')
   optimistic:pet-states     8   (refetchType 'none')
   refetch:pet-states        8   (refetching)
   refetch:blobbis           8   (refetching)
refreshFromRelay calls    = 11   → 22 relay refetches
coin grants               = 1    (one opId, correct)
```

**≈ 38 relay reads + 8 relay writes per session**, over roughly the time it
takes to tap eight times.

### Where the reads come from

**(a) One publish + two refetching invalidations per click.**
`MiningGame.tsx:145-150` calls `updatePetState(...)` on every click;
`useBlobbiEvents.ts:504-511` `onSuccess` invalidates **`['pet-states']` and
`['blobbis']`** with the default `refetchType`: so every click schedules a
`['blobbis']` refetch, and that query is the one that routes the app.

**(b) An unstable-callback refetch storm.**: **FIXED** in the relay-read
phase; `refreshFromRelay` now depends on React Query's stable `refetch`
functions, so the effect runs once per mount (11 → 1, measured). The description
below is the audit-time evidence.

```js
// src/components/blobbi/MiningGame.tsx:71-74
useEffect(() => {
  refreshFromRelay();
  // eslint intentionally satisfied: refreshFromRelay is stable per hook.
}, [refreshFromRelay]);
```

```js
// src/hooks/useOptimizedStatus.ts:190-194
const refreshFromRelay = useCallback(() => {
  clearPendingUpdates();
  ownerQuery.refetch();
  petsQuery.refetch();
}, [clearPendingUpdates, ownerQuery, petsQuery]);
```

**The comment is wrong.** `ownerQuery` and `petsQuery` are the objects returned
by `useQuery`: a new identity on **every render**. So `refreshFromRelay` is a
new function on every render, and the effect re-fires on every render of
`MiningGame`, issuing two more relay refetches each time. Measured: 11 calls =
22 refetches for one session. This is a bug independent of everything else.

---

## 3. Energy write path and its safety

```
click → local newEnergy = max(0, currentEnergy - 10)      (component state)
      → updatePetStats(petId, {energy})                   (optimistic, ref-only)
      → updatePetState({petId, updates:{energy}})         (publish kind:31124)
           mutationFn: existingPet = queryClient.getQueryData(['pet-states'])
                       mergedPet   = {...existingPet, energy}
                       tags        = mergePetStateTags(mergedPet)
                       createEvent(...)          ← NOT awaited (mutate)
           onSuccess : invalidate ['pet-states'] + ['blobbis']
```

| Property | kind:31633 writers (post-`a1036e9`) | `useUpdatePetState` (kind:31124) |
|---|---|---|
| Fresh authoritative read as base | ✅ (`readAuthoritativeInventoryBase`) | ❌ **React Query cache** (`useBlobbiEvents.ts:414`) |
| Empty-base confirmation | ✅ | ❌ |
| In-tab serialization | ✅ | ❌ |
| Cross-tab lock | ✅ | ❌ |
| Monotonic `created_at` | ✅ | ❌ (`useNostrPublish` stamps `Date.now()`) |
| Strict publish | ✅ | ❌ (`useNostrPublish` swallows a 5 s timeout) |
| Rollback / reconciliation | ✅ | ❌ |
| Optimistic update | n/a | ✅ but in a **ref**, invisible to the writer |

Consequences, all reachable today:

- **Stale-base writes.** `mergedPet` is built from a cache that the very
  invalidations above are concurrently replacing. Eight un-awaited publishes can
  overlap; two in the same second tie on `created_at` and NIP-01 resolves by
  lowest id: one silently loses.
- **The optimistic value is invisible to the writer.** `updatePetStats` pushes
  into `pendingUpdatesRef` and is applied only inside `useOptimizedStatus`'s
  `useMemo`; `useUpdatePetState` reads the raw cache. Energy happens to be
  correct only because `MiningGame` supplies it from its own local state.
- **Silent no-op.** If `['pet-states']` is empty (e.g. after an empty read),
  `existingPet` is undefined and the mutation throws `Pet with ID … not found`
  into an unhandled `mutate`: the energy write is simply lost.

---

## 4. Mine session dependency graph

```
 useCurrentUser().user ──────────────┐
 useBlobbis()  ['blobbis']           │
 useBlobbonautProfile() currentCompanion
        └──► BlobbiIsland.selectedBlobbi
                    └──► gameState switch          ← UNMOUNTS PlayingView
                              └──► PlayingView (key = currentLocation)
                                       └──► background === 'cave-inside.png'
                                                 └──► <MiningGame/>
                                                        ├─ useLocation()
                                                        ├─ useOptimizedStatus() → currentPet, energy
                                                        ├─ useUpdatePetState()
                                                        └─ useCoinWallet()
```

Anything that flips `gameState` away from `'playing'` destroys the session:

| Trigger | Source | Effect |
|---|---|---|
| `blobbis` resolves `[]` | any failed read | `'selection'` → **unmount** |
| `blobbiError`/`companionError` | thrown read | `'selection'` → **unmount** |
| `profile` resolves `null` (auto-entered players) | failed profile read | `selectedBlobbi = null` → **unmount** |
| first-load `isLoading` > 2 s | `BlobbiIsland.tsx:100-108` | `'selection'` |
| `currentLocation` change | `PlayingView key` | scene remount |
| portrait rotation (mobile) | `BlobbiPortraitGate` | tree replaced |

MiningGame keeps **all** session state in component state/refs, `clicks`,
`minedItems`, `holes`, `currentEnergy`, `rewardOpIdRef`, `finishedRef`. Unmount
destroys every one.

---

## 5. Reward lifecycle and exact loss semantics

The intended design is intact and correct: one `mintCoinOpId('mine-reward')` at
Start (`MiningGame.tsx:74`), held in `rewardOpIdRef`, reused by both finish
paths under a `finishedRef` guard, granted once at finish. A structural test
added in `a1036e9` pins it.

But `rewardOpIdRef` is a **React ref, memory only**. There is **no durable Mine
session record anywhere** (`rg 'mine.*ledger|mine-session'` → nothing).

| Unmount point | Energy | Coins | opId | Recoverable? |
|---|---|---|---|---|
| Before finish (the common case) | **spent** (already published per click) | **none** | gone | **No** |
| During `grantCoins` | spent | **granted**: the wallet promise is not tied to React; its ledger records the op | gone | Coins land; UI never confirms |
| After publish, before UI success | spent | granted | gone | Value fine, UX confusing |
| Grant returned `ambiguous` | spent | unknown | gone | **No**: nothing ever calls `reconcileOp` for the Mine |
| During an auth/pet transition | spent | none | gone | No |

**So the reported symptom, "energy consumed, no Coin reward, progress lost",
is the *designed* outcome of an interruption, not an anomaly.** The ordering is
the worst possible one: the cost is paid incrementally and durably up front, the
benefit is settled once at the very end.

---

## 6. Mine vs Beach

| Concept | Beach | Mine | Worth adopting? |
|---|---|---|---|
| Stable round/session id | `roundKey` | none | **Yes** |
| Durable reservation before play | `reserveBeachReward` (localStorage) | none | **Yes** (as a session record, not a slot) |
| opId durable across remount | ledger | ref only | **Yes** |
| Amount fixed durably before publish | `finalizeBeachReward` | none | **Yes** |
| Startup recovery of unresolved ops | `unresolvedBeachRewardOps` + `recoverPendingReward` | none | **Yes** |
| Ambiguity reconciliation | read-only `reconcileOp` | none | **Yes** |
| Participation tracking mid-round | `reportParticipation` | none | No: Mine has no anti-farm window |
| Daily rewarded-hunt window | 10/UTC day | none | No, out of scope, and a policy decision |
| Practice mode | yes | none | No, the Mine has no reward scarcity to fall back from |

The useful half is the **durable session record + recovery**; the anti-farm
half (windows, reservations, participation, practice) would be overengineering
for the Mine.

---

## 7. End-of-run energy settlement, is it safe?

Proposed: snapshot energy at Start, spend locally, settle once at Finish.

| Question | Answer |
|---|---|
| Which kind stores energy? | **kind:31124** Blobbi Pet State, `energy` tag |
| Which writer would settle it? | `useUpdatePetState` today, **not fit for purpose** (§3). It needs the same hardening kind:31633 got |
| Must the final write use a fresh 31124 read? | **Yes.** The cache is exactly what makes today's writes stale-base |
| How to avoid clobbering unrelated care state? | `mergePetStateTags` already preserves unknown tags; the risk is not tag loss but **whole-field staleness** from a stale base. A fresh read fixes both |
| Preventing double-spend of energy | Settle a **delta**, never an absolute (§8) |
| Care in another tab while mining | Their write lands; the Mine's fresh-read-then-delta absorbs it. Without a lock, two writes in the same second can still tie |
| Final energy write fails | Player mined for free, favours the user; retryable from a durable record |
| Coin granted, energy write fails | Coins kept, energy not spent, favours the user |
| Energy spent, Coin grant fails | **The bug we are trying to remove**: must not be the failure mode |

**Verdict: safe and practical, and strictly better than today**, provided the
pet-state writer gains a fresh authoritative read and delta semantics.

---

## 8. Energy delta and stale-base concurrency

Absolute writes resurrect energy:

```
start snapshot 80 · Mine spends 30 · another tab spends 20
blind absolute write 80 − 30 = 50    → resurrects 10 energy
delta on fresh read  60 − 30 = 30    → correct
```

`applyMutation`-style lossless delta support exists for kind:31633 but **not**
for kind:31124. `useUpdatePetState` takes absolute field values
(`updates.energy`) merged onto a cached snapshot; no delta primitive, no fresh
read, no clamping policy at the writer.

What would need hardening (not implemented):

1. an authoritative kind:31124 read (empty/partial-confirming, like
   `readAuthoritativeInventoryBase`);
2. a delta mutation (`energy -= n`, clamped to `[0, max]` by game policy at the
   writer, never by the caller);
3. per-pet serialization + the shared cross-tab lock;
4. monotonic `created_at`;
5. strict publish with an honest ambiguous state.

Items 3–5 are exactly what `src/inventory/inventory-transaction.ts` already
provides for kind:31633; the natural move is to generalise that primitive rather
than write a second one.

---

## 9. Settlement ordering

Energy (31124) and Coins (31633) are different events, **no atomic
transaction is possible**.

| Option | Failure mode | Complexity | Favours |
|---|---|---|---|
| **A: energy first, then Coin** | energy spent, **no Coin** | low | the game |
| **B: Coin first, then energy** | Coin granted, energy **not** spent | low | the player |
| **C: durable session record, apply both, reconcile** | none permanent; incomplete settlement is recoverable | medium | the player |

**Recommended: C, with B's ordering inside it.**

```
START   mint sessionId (durable, localStorage)
        record { sessionId, petId, startEnergy, status:'open' }
PLAY    local energy only: ZERO durable writes
FINISH  record { energyDelta, coinReward, status:'settling' }
        1. grantCoins({ opId: sessionId, amount: coinReward })   ← existing ledger
        2. settle energy delta against a FRESH 31124 read
        mark 'settled' (or 'energy-pending' / 'coin-ambiguous')
BOOT    scan for unsettled sessions → finish or reconcile read-only
```

Why C, and why Coin first:

- **Exactly-once** already exists for the Coin half, the `coin-op-ledger`
  makes `grantCoins` idempotent per `opId`. Reusing `sessionId` as the `opId`
  gets recovery for free.
- **Refresh recovery**: the durable record is what today's `useRef` is not. A
  remount finds an `open`/`settling` session instead of losing it.
- **Coin first** because a failure after step 1 leaves the player *up* rather
  than down, inverting today's worst-case; and because step 1 already has
  ambiguity handling while step 2 would not initially.
- **Cross-tab**: the existing `withQueuedCrossTabLock` covers the Coin half; the
  energy half needs the same lock keyed per pet.
- **A Nostr event for the receipt is NOT necessary.** The economy is explicitly
  client-trusted and provisional (`docs/blobbi-coin-cutover.md`); a localStorage
  record matches the Beach ledger's proven precedent and adds no protocol
  surface. Its honest limit, per browser profile, not cross-device, is the
  same one the Beach already documents.

Cost of C over A/B: one small durable module plus a boot-time recovery pass,
the Beach's ledger is ~320 lines and does more.

---

## 10. Performance impact

| Metric | Today (measured) | With end-of-run settlement |
|---|---|---|
| kind:31124 publishes / session | **8** | **1** |
| `['blobbis']` refetches from Mine writes | **8** | **0** |
| `['pet-states']` refetches from Mine writes | **8** | **1** |
| `refreshFromRelay` refetches | **22** (unstable callback) | 2 (fix the dep) |
| Query invalidations | **32** | ~2 |
| Relay reads / session | **≈38** → **18** after the relay-read phase | **≈3** |
| Chances for an empty read to wipe state | ≈38 | ≈3 |

A **>90 % reduction in relay traffic per session**, and the same reduction in
exposure to the empty-read defect. On mobile this is also a direct battery and
radio-wake saving. Reliability and performance improve together, which is
unusual and worth taking.

Note the ordering: end-of-run settlement **reduces exposure** to the empty-read
bug but does not fix it. A single unlucky read can still wipe the nest.

---

## 11. Reproductions run

| Case | Result |
|---|---|
| A: pet/profile read rejects during Mine | TanStack **retains** data (`isError=true`), but `BlobbiIsland.tsx:94` still routes to `'selection'` → **Mine unmounts anyway** |
| B: one refetch resolves `[]` | `1 pet → 0 pets, isError=false`; nest becomes empty |
| C: is it auth? | **No.** `user` is synchronous/localStorage; unaffected by relay state |
| D: window focus/refocus | No refetch (`refetchOnWindowFocus:false`). Not a trigger |
| E: mobile visibility | Not directly simulated; `refetchOnReconnect:true` (unset → default) + resumed `refetchInterval` make a resume burst the highest-risk moment. Analytic, not measured |
| F: writes per session | **8 publishes, 32 invalidations, 22 extra refetches, 1 coin grant** (measured through the real component) |
| G: unmount before finish | energy **spent**, Coins **none**, opId **gone**, **not recoverable** |

Instrumentation lived in temporary `src/__audit_repro.test.tsx` and
`src/__audit_mine.test.tsx`, removed after the audit; both can be committed as
regression suites on request.

---

## 12. Recommended next phase; one narrowly scoped piece

> **Make relay reads able to say "unknown", and stop the app treating unknown as
> empty.**: **DONE**, see
> [`relay-read-resilience.md`](relay-read-resilience.md). The next phase is now
> the durable Mine session + end-of-run energy settlement described in §7–§9.

Not the Mine settlement first. Settlement reduces the *frequency* of the failure;
this removes the failure. It is also the smallest change with the largest effect,
and every later step (including settlement) depends on it.

Scope:

1. A read wrapper that distinguishes *answered-empty* from *never-answered*
   (NPool cannot), with an empty-confirming second read for pets/profile, the
   read-side twin of `readAuthoritativeInventoryBase`.
2. `useBlobbis` / `useBlobbonautProfile` / `useOptimizedStatus` throw on
   unknown instead of returning `[]`/`null`, so TanStack retains good data.
3. `BlobbiIsland.tsx:91-98`: never leave `'playing'` for an error or a stale
   read; only for a **confirmed** empty result.
4. `BlobbiSelectionScreen`: separate `player-data-error` from
   `known-empty-nest`; the destructive copy only for the latter.
5. Fix the `refreshFromRelay` dependency so the Mine's effect stops re-firing
   every render (one-line `useCallback` dep correction, 22 → 2 refetches).

Deliberately **not** in this phase: the durable Mine session record and
end-of-run energy settlement (§9), the kind:31124 writer hardening (§8), reward
amounts, drop tables, Beach, Coin migration, Arcade.
