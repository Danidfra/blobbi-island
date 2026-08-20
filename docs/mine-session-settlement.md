# Mine Session Settlement

Status: **implemented.** A mining run is played locally and settled once, at
the end, through a durable session with recoverable exactly-once semantics.

Supersedes the design sections of
[`mine-session-settlement-audit.md`](mine-session-settlement-audit.md).
Builds on [`relay-read-resilience.md`](relay-read-resilience.md).

---

## 1. What was wrong

Energy was published on **every click** and the reward once, at the end — so
the cost was durable long before the benefit:

```
click → local energy −10 → publish kind:31124 → invalidate pet caches → repeat
finish → grantCoins(...)
```

An interruption anywhere in between left:

```
energy: already spent      Coins: none      reward opId: lost with a React ref
```

And the Mine's own writes were what caused the interruptions: each publish
invalidated `['blobbis']`, and any one of those refetches resolving empty
unmounted the world.

## 2. The lifecycle now

```
START   require user + resolved pet + usable energy
        → mint sessionId, persist an `open` record (VERIFIED by read-back)
        → NOTHING is published

PLAY    energy comes down in component state; loot accumulates locally
        → ZERO kind:31124 publishes, ZERO pet-query invalidations
        → the rest of the app keeps showing the pet's real energy

FINISH  freeze {energyDelta, coinReward} into the session   ← immutable
        → settle Coins    (canonical wallet, opId `mine:<id>:coin`)
        → settle energy   (delta,            opId `mine:<id>:energy`)
        → status `settled`

RECOVER on next entry: `open` → abandoned (nothing was owed);
        `finalized`/`coin-pending`/`energy-pending` → resume under the SAME ids
```

**No atomicity claim.** Energy is kind:31124 and Coins are kind:31633 — two
events, no shared transaction. Settlement here is **recoverable and
idempotent, not atomically committed across both kinds**.

## 3. Session record

`src/mine/mine-session-ledger.ts`, localStorage, per pubkey:

```ts
{ sessionId, petId, status, startedAt, startEnergy,
  energyDelta?, coinReward?, finishedAt?,
  coinStatus?, energyStatus?, updatedAt, note? }

status: 'open' | 'finalized' | 'coin-pending' | 'energy-pending'
      | 'settled' | 'abandoned'
```

`finalized` is the point of no return for the NUMBERS: recovery settles the
recorded values and never recomputes them from UI state that no longer exists.
`settled` is a one-way door. Persistence is read-back verified — **no durable
operation identity, no value-bearing run** (the same rule the Coin wallet
applies before it publishes); if storage refuses, Start fails with a friendly
message rather than starting a run that cannot be paid.

Operation ids are deterministic, so a retry can never mint a new one:

```
mine:<sessionId>:coin      mine:<sessionId>:energy
```

Namespaced so the Coin and energy ledgers can never collide on a key.

## 4. Ordering: Coins first, always

```
Coin then energy → a failure between them leaves the player UP
energy then Coin → a failure between them leaves the player DOWN   ← the old bug
```

An **ambiguous Coin grant stops settlement**: energy is not charged against a
reward we cannot confirm. The session stays `coin-pending` and a later run
reconciles it under the same id. Energy is attempted only once Coins are known
applied (or there was no reward to grant).

## 5. Energy is a delta against fresh state

```
start 80 · Mine consumes 30 · another tab spends 20 meanwhile
stale absolute:  80 − 30 = 50   ← resurrects 10 energy the player spent
fresh delta:     60 − 30 = 30   ← correct
```

The subtraction always uses the state read **inside** the transaction.
`startEnergy` is gameplay bookkeeping and is never a write base.

**Exhaustion policy (deliberate, user-favouring).**
`finalEnergy = max(0, freshEnergy − requestedDelta)`. If the Mine consumed 30
but only 20 remains, the operation subtracts 20, lands on 0, and is **fully
settled**; the remainder is forgiven and never chased later. A settlement that
could come back for more would be a debt, and the economy has no concept of
one. `appliedDelta` reports what actually moved. A non-integer or non-positive
amount is **refused**, never reinterpreted.

## 6. Exactly-once, and how ambiguity is resolved

Coins reconcile by reading a balance, because only the wallet moves it. Energy
cannot: care actions, item use and sleep all change it, so `energy === expected`
proves nothing. So the replacement event carries an opaque marker:

```
["blobbi_op", "<opId>"]
```

`mergePetStateTags` preserves unknown tags verbatim, so the marker survives
ordinary care writes — which is what lets a later read prove that *this*
operation's event landed. Each settlement drops previous `blobbi_op` tags
before adding its own, so exactly one is ever present and the event cannot
accumulate one per session forever.

Chosen over local-evidence-only (Strategy B in the audit) because cross-reload
verification is the whole point: after a reload the ledger may say `ambiguous`
and nothing else can settle the question.

**Honest limits.** The marker is app-specific and opaque — no protocol meaning,
no new kind, no NIP claim. If another client ever republishes a pet without
preserving unknown tags, the marker is lost; reconciliation then reports
`ambiguous` and the operation stays unresolved rather than subtracting twice.

Durable ledgers (`pet-energy-ledger`, `mine-session-ledger`) are per browser
profile, like the Coin and Beach ledgers. A different device has no ledger —
and also no operation id to replay.

## 7. The hardened kind:31124 path

`src/lib/pet-state-transaction.ts`:

```
queued cross-tab Web Lock, keyed per OWNER+PET   (blobbi-pet-state:<pubkey>:<petId>)
→ shared per-tab chain on the same key
→ authoritative read (EOSE-aware; unknown ≠ absent; confirmed-empty)
→ caller mutates that ONE snapshot
→ mergePetStateTags: unrelated fields and unknown tags ride through
→ created_at = max(now, previous + 1)
→ sign
→ STRICT publish (a timeout is AMBIGUOUS, never success)
```

Per-pet, so settling one Blobbi never queues behind another; a **different**
lock namespace from the inventory, because kind:31124 and kind:31633 must not
block each other. The lock is the existing `withQueuedCrossTabLock`; the chain
is `serializeByKey`, now shared with the inventory writer via
`src/lib/replaceable-write.ts` rather than duplicated.

Reads distinguish `found` / `absent` / `unknown`. A read that cannot be
completed **publishes nothing** and leaves the session pending. A confirmed
absent pet is a refusal, not a blank base: this path never creates a kind:31124
from scratch.

## 8. What an interruption costs

| Situation | Energy | Coins | Session |
|---|---|---|---|
| App closes mid-run | **0** | **0** | abandoned on recovery |
| Coin settles, app closes before energy | untouched | kept | resumes `energy-pending` |
| Coin ambiguous | **untouched** | reconciled later | `coin-pending`, no blind retry |
| Energy ambiguous | reconciled by marker | kept | `energy-pending`, no second subtraction |
| Settlement called twice | one delta | one grant | `settled` |

## 9. Performance

Measured through the real component, one full run (energy 100 → 20, 8 clicks):

| Metric | Before this phase | After |
|---|---|---|
| kind:31124 publishes during play | 8 | **0** |
| pet-query invalidations from gameplay | 32 | **0** |
| `refreshFromRelay` calls | 1 (fixed last phase) | 1 |
| relay reads / session | ~18 | **~2 during play** + a small bounded settlement (1 Coin op, 1 energy op and their fresh reads/read-backs) |
| Coin settlements | 1 | 1 |
| energy settlements | 0 (8 partial publishes instead) | **1** |

Gameplay is now silent on the network, which also removes eight more chances
per run for a bad read to disturb the session.

## 10. Desktop and mobile

Correctness depends on none of: a foreground timer, the component staying
mounted, hover, pointer type, or audio.

- **Fast repeated clicks** — local state only; nothing races.
- **Tab switch / multiple tabs** — settlement takes the per-pet cross-tab lock
  and the shared per-tab chain; a concurrent care write serializes with it.
- **Background / screen lock / tab suspension mid-run** — the run is abandoned
  on recovery. Gameplay progress is lost; **nothing durable is**.
- **Network switch at settlement** — an unusable read publishes nothing; an
  ambiguous publish reconciles by marker. Neither double-charges.
- **Orientation remount** — same as any unmount: abandoned, cost 0.
- **Resume after Coins landed but energy did not** — recovery finishes energy
  under the original opId.

## 11. Scope

Unchanged: energy cost per click, click count, gem probabilities, the reward
table, run duration, animations, the low-energy threshold and its screen. Only
persistence and settlement semantics changed.

`useUpdatePetState` (the generic pet writer used by care actions) is
**deliberately unchanged**. Migrating every care action to the hardened
transaction would turn this into a full pet-state rewrite with a much larger
test surface; the Mine — the only value-bearing pet write — uses the safe path,
and the generic writer's stale-base/tie hazards are recorded as follow-up in
`mine-session-settlement-audit.md` §3.

## 12. Remaining risks

1. **`useUpdatePetState` is still cache-based**, unserialized, non-monotonic
   and non-strict. A care action can still lose an update to a concurrent care
   action. It cannot corrupt a Mine settlement (that path reads fresh inside a
   lock), but it can overwrite one *afterwards* with a stale snapshot.
2. **Ledgers are per browser profile.** Cross-device recovery does not exist —
   consistent with the Coin and Beach ledgers, and stated in each.
3. **The marker depends on unknown-tag preservation.** True for this client and
   asserted by a regression test; a third-party writer that strips unknown tags
   would degrade reconciliation to `ambiguous` (safe, but unresolved).
4. **Client-trusted throughout.** As with every other economy path here, a
   modified client can claim any reward. The ledgers protect against accident,
   not cheating.
