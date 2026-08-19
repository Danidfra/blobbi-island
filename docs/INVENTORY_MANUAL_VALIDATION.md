# Blobbi Island — Inventory Manual Validation Checklist

Final pre-commit manual validation for the kind:31633 inventory implementation.
Run against the real app with two prepared Nostr accounts.

## Sources of truth (must hold throughout)

- Inventory: **kind:31633** (`d = blobbi:island`), address-based
  (`31632:<issuer>:<d>`).
- Item catalog: **official kind:31632** definitions from issuer
  `npub1nmac6vz9hf6n7dny65pnpz6f0qe4dvn2d405h9ztltzz8xh7vw5sg0wu5e`
  (hex `9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9`).
- Official item relays: `wss://relay.ditto.pub`, `wss://relay.dreamith.to`.
- Coin balance: the **official Blobbi Coin quantity inside kind:31633**
  (`31632:<issuer>:blobbi:currency:coin`). Since the Coin cutover, kind:11125
  `coins` is OBSOLETE historical data — never read for economic decisions,
  never displayed, never written; it rides the unknown-tag passthrough
  verbatim.
- Non-inventory profile (`has[]`, `current_companion`, achievements, accessory
  `inv`) stays in **kind:11125**; legacy 31125 dual-read for profile only.
  Inventory is NEVER written to 11125.

## Pre-test operator setup

- [ ] Account A: has an existing kind:31633 (some items) for consumption tests.
- [ ] Account B: confirm it has **no** kind:31633 event (empty-inventory tests).
- [ ] Record Account A + B current **11125 tags verbatim** (`inv`, `has[]`,
      `current_companion`, achievements, any historic `coins`, unknown Ditto
      tags) so profile + accessory preservation can be diffed after every
      write. **No write in this checklist may change any of them.**
- [ ] Record Account A + B current **31633 quantities verbatim** (Blobbi Coin,
      Arcade Tickets, every consumable) — the Coin balance lives here now, and
      every write must preserve the entries it does not target.
- [ ] Open a relay event monitor subscribed to both accounts for kinds
      `[1124, 11125, 31124, 31632, 31633]`.
- [ ] Results table columns: `action | expected events | actual events | UI result | reload result`.

## 1. Catalog resolution

- [ ] Load with BOTH official relays reachable → all 19 items resolve from
      fetched 31632 (`resolvedCount` = 19).
- [ ] Load with ONE official relay unavailable → still resolves (other relay +
      bundled fallback); UI never blocks on the fetch.
- [ ] Load with BOTH official relays unavailable → **bundled fallback** renders
      the full catalog; game remains playable; no empty/blocked state.
- [ ] Verify representative REMOTE metadata against bundled expectation:
  - [ ] `food_cake` (`blobbi:food:cake`) emoji = 🎂
  - [ ] `med_calcium` (`blobbi:medicine:calcium`) name = "Calcium Supplement"
  - [ ] `hyg_towel` (`blobbi:hygiene:soft-towel`) emoji = 🏖️
  - [ ] `nrg_drink` (`blobbi:energy:drink`) emoji = 🧃
  - [ ] Record any remote-vs-bundled divergence (image tag > JSON emoji >
        itemId emoji > 📦).

## 2. Empty inventory (Account B, no 31633)

- [ ] All inventory views (Refrigerator = food, Chest = toys, Item Bag =
      medicine/hygiene/energy) show empty states.
- [ ] No legacy `11125.storage` items appear anywhere.
- [ ] **No empty kind:31633 is published merely by opening the UI** (monitor:
      zero 31633 events until an explicit purchase/consume). Reads use
      `buildEmptyInventory` in-memory only.

## 3. Purchase (per item + reload)

For each: food, toy, medicine, hygiene, energy —
- [ ] Purchase 1 unit.
- [ ] The Blobbi Coin quantity in **31633** decreases by the local shop price,
      and the item quantity increases — **in ONE replacement event**.
- [ ] Quantity persists in **31633** after reload.
- [ ] kind:11125 is **not published at all** (no new 11125 event in the
      monitor); accessories (`inv`), `current_companion`, `has[]`,
      achievements and unknown Ditto tags unchanged.
- [ ] Arcade Tickets and every untargeted 31633 entry unchanged.
- [ ] Reload after each purchase confirms persistence.

Edge cases:
- [ ] Insufficient coins → purchase blocked against a FRESH relay read, clear
      toast, no 31633 write at all.
- [ ] Rapid double-click on Buy → serialized; quantity increments correctly (no
      lost/duplicated grant); coins deducted per successful purchase only.
- [ ] Atomicity: the charge and the item grant are the SAME kind:31633 event —
      there is no ordering to observe and no partial-success state. A failed
      publish leaves BOTH the balance and the item quantity unchanged.

## 4. Consumption (per surface + reload)

- [ ] Food via Refrigerator → `feed` effect + XP; hunger/happiness per
      definition.
- [ ] Toy via Chest → `play` effect + XP.
- [ ] Medicine via Item Bag → `medicine`/`medicate` effect.
- [ ] Hygiene via Item Bag → `clean` effect.
- [ ] Energy drink via Item Bag → `boost` effect.
- [ ] Reload after each use.
- [ ] Effects match the RESOLVED definition (never inferred from names).
- [ ] Quantity decrements by exactly the consumed units in 31633.
- [ ] Final-unit: consuming the last unit removes the item; a second immediate
      consume is rejected (fresh ownership read sees 0).
- [ ] Stage restrictions enforced (e.g. energy drink / cake baby+adult only).
- [ ] Shell-repair kit (`blobbi:medicine:shell-repair-kit`) usable on **egg
      only**; rejected on baby/adult.
- [ ] `careStreak` remains correct (new care day > 20h increments; otherwise
      unchanged); XP, stats clamped 0–100, equipped accessories preserved on the
      31124 republish.

## 5. Failure behavior

Use the existing mocking infra or a safe local failure mode. For each, confirm
the toast is accurate, the UI does NOT falsely report full success, optimistic
cache is reconciled (rollback or invalidation), and retry is understandable.

- [ ] Inventory publish failure during purchase → optimistic cache rolled back;
      no coin deduction; clear error.
- [ ] Coins publish failure AFTER inventory purchase succeeds → item kept,
      partial-success warning ("Item granted but coins were not charged").
- [ ] Blobbi interaction/state failure BEFORE inventory decrement → decrement
      not attempted; item retained; error surfaced.
- [ ] Inventory decrement failure AFTER Blobbi effect succeeds → effect applied,
      `inventoryDecremented=false`, warning ("Effect applied but inventory was
      not decremented"); no false success.
- [ ] Signing rejection → mutation fails cleanly; optimistic rollback; no event.
- [ ] Relay publication rejection (hard error, not timeout) → failure surfaced;
      rollback. Note: publish TIMEOUT is treated as partial success by
      `useNostrPublish` — verify UI messaging for that path too.

## 6. Multi-instance behavior (documented limitation — do NOT fix here)

Using two tabs or two clients on the same account, both holding the SAME final
unit:
- [ ] Attempt near-simultaneous consumption of the final unit.
- [ ] Record: resulting 1124 interaction events, 31124 Blobbi state, newest
      31633.
- [ ] Expected observation: in-memory serialization does NOT coordinate across
      instances; both may pass their fresh ownership read, BOTH may apply the
      Blobbi effect (published before decrement), their 31633 events race, and
      newest-wins resolves quantity WITHOUT atomicity. Record the observed
      double-effect.
- [ ] Also note: relay read-after-write is not guaranteed, so even a single
      instance's queued freshness depends on the relay reflecting the prior
      publish. Document, do not attempt to fix.

## Cross-instance risk summary (record explicitly)

Local per-user serialization does NOT protect against: two browser tabs, two
devices, another Nostr client, relay propagation delay, or simultaneous
replaceable-event writes. Because consumption publishes the Blobbi effect before
the inventory decrement, two clients may both observe the final unit, both apply
the effect, and their 31633 events may race; newest-wins does not make the
operation atomic. No locking or relay rollback is implemented.
