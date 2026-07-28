# Blobbi Island — Official Event & Item Registry

> **Generated file — do not edit by hand.** Every value below is derived from `src/protocol/event-registry.ts`.
> Regenerate with `npm run docs:registry`. A test fails if this file and the registry disagree.

This is the canonical description of every Nostr event kind Blobbi Island reads or writes, and of every official item definition it recognises. `NIP.md` explains the protocol in prose; this document is the machine-checked inventory.

## 1. Application event kinds

Two independent status axes. **This client** says what the code in this repository does with the kind. **Protocol** says what the wider Blobbi protocol says about it, and may only read *Superseded* when a document here names the replacement — the citation is shown in §4. A kind can be "not implemented by this client" while its protocol status is *Undetermined*: absence of code here is not evidence that another Blobbi client stopped using it.

| Kind | Name | Class | Defined by | This client | Protocol |
| --- | --- | --- | --- | --- | --- |
| `1124` | Blobbi Social Interaction | Regular | Blobbi Island | Implemented (read + write) | Current |
| `11125` | Blobbonaut Owner Profile | Replaceable | Blobbi Island | Implemented (read + write) | Current |
| `31125` | Blobbonaut Owner Profile (legacy) | Addressable | Blobbi Island | Read for legacy compatibility | Superseded |
| `31124` | Blobbi Pet State | Addressable | Blobbi Island | Implemented (read + write) | Current |
| `21201` | Island Chat | Ephemeral | Blobbi Island | Implemented (read + write) | Current |
| `31950` | Island Presence | Addressable | Blobbi Island | Implemented (read + write) | Current |
| `31951` | Shared Playback Session | Addressable | Blobbi Island | Implemented (read + write) | Current |
| `21951` | Shared Playback Command | Ephemeral | Blobbi Island | Implemented (read + write) | Current |
| `31632` | Game Item Definition | Addressable | External — `@nostr-games/inventory` | Implemented (read only) | Current |
| `31633` | Game Inventory | Addressable | External — `@nostr-games/inventory` | Implemented (read + write) | Current |
| `14919` | Blobbi Interaction (NIP-BB draft) | Regular | Blobbi Island | Not implemented by this client | Superseded |
| `14920` | Blobbi Breeding Event (NIP-BB draft) | Regular | Blobbi Island | Not implemented by this client | Undetermined by this repository |
| `14921` | Blobbi Record (NIP-BB draft) | Regular | Blobbi Island | Not implemented by this client | Undetermined by this repository |

## 2. Address formats

Addressable and replaceable kinds are referenced by coordinate. Non-addressable kinds are referenced by event id only.

| Kind | Address format |
| --- | --- |
| `1124` | not addressable |
| `11125` | not addressable |
| `31125` | `31125:<pubkey>:<d>` |
| `31124` | `31124:<pubkey>:<blobbiD>` |
| `21201` | not addressable |
| `31950` | `31950:<pubkey>:session:<uuid>` |
| `31951` | `31951:<host-pubkey>:<uuid>` |
| `21951` | not addressable |
| `31632` | `31632:<issuer>:<d>` |
| `31633` | `31633:<owner>:<d>` |
| `14919` | not addressable |
| `14920` | not addressable |
| `14921` | not addressable |

## 3. Ownership and authority

Authority in Nostr derives from authorship: an event is authoritative for a thing exactly when its signer is the thing’s owner. "Defined by" says who owns the *schema*; "signed by" says who may produce valid instances.

| Kind | Defined by | Signed by |
| --- | --- | --- |
| `1124` | Blobbi Island | The player |
| `11125` | Blobbi Island | The player or Ditto (co-authored) |
| `31125` | Blobbi Island | The player or Ditto (co-authored) |
| `31124` | Blobbi Island | The player or Ditto (co-authored) |
| `21201` | Blobbi Island | The player |
| `31950` | Blobbi Island | The player |
| `31951` | Blobbi Island | Session host |
| `21951` | Blobbi Island | Session host |
| `31632` | `@nostr-games/inventory` | Official item issuer |
| `31633` | `@nostr-games/inventory` | The player |
| `14919` | Blobbi Island | The player |
| `14920` | Blobbi Island | The player |
| `14921` | Blobbi Island | The player |

## 4. Lifecycle and implementation status

### Kind 1124 — Blobbi Social Interaction

Append-only log of a care/social action performed on a Blobbi (feed, play, clean, medicate, boost).

- **Class:** Regular
- **Address format:** not addressable
- **Signed by:** The player
- **Lifecycle:** Written once per interaction; never edited. The resulting state change is reflected in kind 31124.
- **Expiration:** none
- **This client:** Implemented (read + write)
- **Protocol status:** Current
- **Defined by:** Blobbi Island
- **Implemented in:** `src/lib/blobbi-kinds.ts`, `src/inventory/useUseItem.ts`, `src/hooks/useBlobbiEvents.ts`
- **Documented in:** `NIP.md`
- **Notes:** Kind number and event builder come from @blobbi-kit/core (blobbi-interaction).

### Kind 11125 — Blobbonaut Owner Profile

The player's account: coins, owned Blobbis, achievements, current companion.

- **Class:** Replaceable
- **Address format:** not addressable
- **Signed by:** The player or Ditto (co-authored)
- **Lifecycle:** One per pubkey, republished in full on every change. Unknown tags are preserved on republish.
- **Expiration:** none
- **This client:** Implemented (read + write)
- **Protocol status:** Current
- **Defined by:** Blobbi Island
- **Implemented in:** `src/lib/blobbi-parsers.ts`, `src/inventory/useCoinsMutation.ts`, `src/hooks/useBlobbiEvents.ts`, `src/hooks/useOptimizedStatus.ts`, `src/hooks/useFirstEggAdoption.ts`
- **Documented in:** `NIP.md`, `docs/INVENTORY_ARCHITECTURE.md`
- **Notes:** Consumable inventory is NOT stored here; it lives in kind 31633. Coins do live here.

### Kind 31125 — Blobbonaut Owner Profile (legacy)

Superseded owner-profile kind, still read for backward compatibility.

- **Class:** Addressable
- **Address format:** `31125:<pubkey>:<d>`
- **Signed by:** The player or Ditto (co-authored)
- **Lifecycle:** Queried alongside 11125; never written by this client.
- **Expiration:** none
- **This client:** Read for legacy compatibility
- **Protocol status:** Superseded — NIP.md, 'Legacy / superseded kinds': superseded by kind 11125. @blobbi-kit/core also marks KIND_BLOBBONAUT_PROFILE_LEGACY @deprecated.
- **Defined by:** Blobbi Island
- **Superseded by:** kind `11125`
- **Implemented in:** `src/lib/blobbi-kinds.ts`, `src/hooks/useOptimizedStatus.ts`
- **Documented in:** `NIP.md`
- **Notes:** Included in BLOBBONAUT_PROFILE_KINDS, so profile queries still return it.

### Kind 31124 — Blobbi Pet State

Full state of one Blobbi creature: stats, stage, appearance, personality, care timestamps.

- **Class:** Addressable
- **Address format:** `31124:<pubkey>:<blobbiD>`
- **Signed by:** The player or Ditto (co-authored)
- **Lifecycle:** One per Blobbi, republished on every state change. Unknown tags are preserved.
- **Expiration:** none
- **This client:** Implemented (read + write)
- **Protocol status:** Current
- **Defined by:** Blobbi Island
- **Implemented in:** `src/lib/blobbi-parsers.ts`, `src/hooks/useBlobbis.ts`, `src/hooks/useBlobbiEvents.ts`, `src/inventory/useUseItem.ts`
- **Documented in:** `NIP.md`

### Kind 21201 — Island Chat

In-world speech-bubble chat message shown above a player Blobbi.

- **Class:** Ephemeral
- **Address format:** not addressable
- **Signed by:** The player
- **Lifecycle:** Transient; not expected to be stored. Deduplicated per pubkey+session within a short window.
- **Expiration:** NIP-40, ~10 seconds
- **This client:** Implemented (read + write)
- **Protocol status:** Current
- **Defined by:** Blobbi Island
- **Implemented in:** `src/lib/chat-config.ts`, `src/hooks/useChatBubbles.ts`
- **Documented in:** `NIP.md`

### Kind 31950 — Island Presence

Real-time multiplayer presence: location, position, movement goal, seat, hiding spot and shared activity.

- **Class:** Addressable
- **Address format:** `31950:<pubkey>:session:<uuid>`
- **Signed by:** The player
- **Lifecycle:** One per browser session, renewed by a ~25 s heartbeat; stale players disappear when the event expires.
- **Expiration:** NIP-40, ~35 seconds
- **This client:** Implemented (read + write)
- **Protocol status:** Current
- **Defined by:** Blobbi Island
- **Implemented in:** `src/lib/multiplayer.ts`, `src/hooks/useIslandPresence.ts`, `src/lib/theater-occupancy.ts`
- **Documented in:** `NIP.md`
- **Notes:** The kind number is a literal in multiplayer.ts / useIslandPresence.ts; there is no exported constant to import.

### Kind 31951 — Shared Playback Session

Canonical, host-authoritative state of a synchronized watch session in the theater.

- **Class:** Addressable
- **Address format:** `31951:<host-pubkey>:<uuid>`
- **Signed by:** Session host
- **Lifecycle:** Fresh UUID per session, republished every ~20 s with the same rev; status flips to "ended" on teardown.
- **Expiration:** NIP-40, 4 h while active, 10 min once ended
- **This client:** Implemented (read + write)
- **Protocol status:** Current
- **Defined by:** Blobbi Island
- **Implemented in:** `src/lib/shared-playback/constants.ts`, `src/lib/shared-playback/parse.ts`, `src/lib/shared-playback/publish.ts`, `src/hooks/useSharedPlayback.ts`
- **Documented in:** `NIP.md`, `docs/protocol/shared-playback-session.md`, `docs/theater-shared-watch-implementation.md`
- **Notes:** Experimental and application-private by convention only; consumers MUST validate structurally rather than trusting the kind number.

### Kind 21951 — Shared Playback Command

Low-latency playback command (play/pause/seek/set-media/set-rate/end-session) for a watch session.

- **Class:** Ephemeral
- **Address format:** not addressable
- **Signed by:** Session host
- **Lifecycle:** Fire-and-forget optimization. A client that never receives one is still correct: kind 31951 is the recoverable source of truth.
- **Expiration:** NIP-40, ~30 seconds
- **This client:** Implemented (read + write)
- **Protocol status:** Current
- **Defined by:** Blobbi Island
- **Implemented in:** `src/lib/shared-playback/constants.ts`, `src/lib/shared-playback/parse.ts`, `src/lib/shared-playback/publish.ts`
- **Documented in:** `NIP.md`, `docs/protocol/shared-playback-session.md`
- **Notes:** Absolute positions only, so a command is idempotent under duplicate delivery.

### Kind 31632 — Game Item Definition

Canonical definition of an item. Blobbi Island trusts only definitions signed by the official issuer.

- **Class:** Addressable
- **Address format:** `31632:<issuer>:<d>`
- **Signed by:** Official item issuer
- **Lifecycle:** Published out-of-band by the issuer; republished to update metadata. This client never writes it.
- **Expiration:** none
- **This client:** Implemented (read only)
- **Protocol status:** Current
- **Defined by:** `@nostr-games/inventory` (Blobbi Island is a consumer)
- **Implemented in:** `src/inventory/useItemCatalog.ts`, `src/inventory/protocol-adapter.ts`, `src/inventory/registry.ts`, `src/inventory/catalog-fallback.ts`
- **Documented in:** `NIP.md`, `docs/INVENTORY_ARCHITECTURE.md`
- **Notes:** Schema, parsing and validation are owned by @nostr-games/inventory. Blobbi Island is a consumer and adds only issuer enforcement plus an offline fallback.

### Kind 31633 — Game Inventory

The player's item inventory: kind:31632 addresses with integer quantities.

- **Class:** Addressable
- **Address format:** `31633:<owner>:<d>`
- **Signed by:** The player
- **Lifecycle:** One per player for Blobbi Island (d = "blobbi:island"), rebuilt in full on every mutation from a fresh relay read.
- **Expiration:** none
- **This client:** Implemented (read + write)
- **Protocol status:** Current
- **Defined by:** `@nostr-games/inventory` (Blobbi Island is a consumer)
- **Implemented in:** `src/inventory/useIslandInventory.ts`, `src/inventory/useInventoryMutation.ts`, `src/inventory/constants.ts`
- **Documented in:** `NIP.md`, `docs/INVENTORY_ARCHITECTURE.md`
- **Notes:** Replaceable semantics mean concurrent writes from two clients resolve newest-wins; there is no relay-side locking.

### Kind 14919 — Blobbi Interaction (NIP-BB draft)

Interaction log defined by the original NIP-BB draft; this client uses kind 1124 instead.

- **Class:** Regular
- **Address format:** not addressable
- **Signed by:** The player
- **Lifecycle:** Not produced or consumed by this client. Recorded so the number is neither reused nor mistaken for available.
- **Expiration:** none
- **This client:** Not implemented by this client
- **Protocol status:** Superseded — NIP.md, 'Legacy / superseded kinds': "14919 → superseded by 1124 — Old interaction kind from the original NIP-BB draft".
- **Defined by:** Blobbi Island
- **Superseded by:** kind `1124`
- **Implemented in:** —
- **Documented in:** `MD/old-NIP.md`, `NIP.md`
- **Notes:** No code in src/ queries, parses or publishes this kind. NIP.md heads its legacy table "queried for backward compatibility"; that is accurate for kind 31125 but NOT for 14919, which nothing reads. Other Blobbi clients may still write it — this repository only evidences that Island replaced it with 1124.

### Kind 14920 — Blobbi Breeding Event (NIP-BB draft)

Cross-breeding event between two adult Blobbis, defined by the original NIP-BB draft.

- **Class:** Regular
- **Address format:** not addressable
- **Signed by:** The player
- **Lifecycle:** Not produced or consumed by this client. Recorded so the number is neither reused nor mistaken for available.
- **Expiration:** none
- **This client:** Not implemented by this client
- **Protocol status:** Undetermined by this repository
- **Defined by:** Blobbi Island
- **Implemented in:** —
- **Documented in:** `MD/old-NIP.md`
- **Notes:** Blobbi Island has no breeding feature, so nothing here reads or writes it. NO document in this repository deprecates or replaces it, so its ecosystem status is undetermined: it may be live in another Blobbi client.

### Kind 14921 — Blobbi Record (NIP-BB draft)

Permanent milestone/lineage record (birth, hatching, evolution) defined by the original NIP-BB draft.

- **Class:** Regular
- **Address format:** not addressable
- **Signed by:** The player
- **Lifecycle:** Not produced or consumed by this client. Recorded so the number is neither reused nor mistaken for available.
- **Expiration:** none
- **This client:** Not implemented by this client
- **Protocol status:** Undetermined by this repository
- **Defined by:** Blobbi Island
- **Implemented in:** —
- **Documented in:** `MD/old-NIP.md`
- **Notes:** Blobbi Island publishes no hatch/milestone event: adoption publishes only the final kind 31124 baby state (src/hooks/useFirstEggAdoption.ts). NO document in this repository deprecates or replaces 14921, and NIP.md does not mention it at all, so its ecosystem status is undetermined — it may be live in another Blobbi client.

## 5. Official item issuer and relays

- **Issuer public key (hex):** `9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9`
- **Private key:** never stored in this repository. Publishing official definitions is a human, out-of-band action.
- **Definition relays:** `wss://relay.ditto.pub`, `wss://relay.dreamith.to`
- Definitions signed by any other pubkey are rejected by `parseOfficialItemDefinition`.

## 6. Official item definitions

Status meanings: **Active** — the issuer-signed kind:31632 event is published. **Reserved** — the identity is claimed and the client already resolves it from the bundled fallback, but the official event is not published yet. **Deprecated** — no longer offered, still resolvable so existing inventories render.

> **Prices are not listed here, by design.** A coin price is Island-local economy configuration, not a kind:31632 definition fact: it is never published to a relay, it changes on its own schedule, and a second currency (arcade tickets) will have its own prices. The coin price table lives in `src/inventory/shop-catalog.ts` and is validated against this registry at module load — an item that is not an official registered consumable cannot be priced.

| `d` | Name | Category | Action | Status |
| --- | --- | --- | --- | --- |
| `blobbi:food:apple` | Apple | food | `feed` | Active |
| `blobbi:food:burger` | Burger | food | `feed` | Active |
| `blobbi:food:cake` | Cake | food | `feed` | Active |
| `blobbi:food:pizza` | Pizza | food | `feed` | Active |
| `blobbi:food:sushi` | Sushi | food | `feed` | Active |
| `blobbi:toy:ball` | Ball | toy | `play` | Active |
| `blobbi:toy:teddy` | Teddy Bear | toy | `play` | Active |
| `blobbi:toy:blocks` | Building Blocks | toy | `play` | Active |
| `blobbi:medicine:vitamins` | Vitamins | medicine | `medicine` | Active |
| `blobbi:medicine:super` | Super Medicine | medicine | `medicine` | Active |
| `blobbi:medicine:bandage` | Bandage | medicine | `medicine` | Active |
| `blobbi:medicine:health-elixir` | Health Elixir | medicine | `medicine` | Active |
| `blobbi:medicine:shell-repair-kit` | Shell Repair Kit | medicine | `medicine` | Active |
| `blobbi:medicine:calcium` | Calcium Supplement | medicine | `medicine` | Active |
| `blobbi:hygiene:soap` | Soap | hygiene | `clean` | Active |
| `blobbi:hygiene:shampoo` | Shampoo | hygiene | `clean` | Active |
| `blobbi:hygiene:bubble-bath` | Bubble Bath | hygiene | `clean` | Active |
| `blobbi:hygiene:soft-towel` | Soft Towel | hygiene | `clean` | Active |
| `blobbi:energy:drink` | Energy Drink | energy | `boost` | Active |
| `blobbi:currency:arcade-ticket` | Arcade Ticket | currency | — | Active |

## 7. Canonical kind:31632 addresses

Derived from the issuer public key and the `d` tag; never hardcoded.

| Item | Address |
| --- | --- |
| Apple | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:food:apple` |
| Burger | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:food:burger` |
| Cake | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:food:cake` |
| Pizza | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:food:pizza` |
| Sushi | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:food:sushi` |
| Ball | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:toy:ball` |
| Teddy Bear | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:toy:teddy` |
| Building Blocks | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:toy:blocks` |
| Vitamins | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:medicine:vitamins` |
| Super Medicine | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:medicine:super` |
| Bandage | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:medicine:bandage` |
| Health Elixir | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:medicine:health-elixir` |
| Shell Repair Kit | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:medicine:shell-repair-kit` |
| Calcium Supplement | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:medicine:calcium` |
| Soap | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:hygiene:soap` |
| Shampoo | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:hygiene:shampoo` |
| Bubble Bath | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:hygiene:bubble-bath` |
| Soft Towel | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:hygiene:soft-towel` |
| Energy Drink | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:energy:drink` |
| Arcade Ticket | `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:currency:arcade-ticket` |

## 8. Item detail

### Apple — `blobbi:food:apple`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:food:apple`
- **Status:** Active
- **Category:** `food` · **Type:** `consumable`
- **Action:** `feed`
- **Stages:** `baby`, `adult`
- **Effects:** hunger +25, hygiene -2, energy +5
- **Emoji fallback:** 🍎
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `edible`, `food`
- **Stackable:** yes

### Burger — `blobbi:food:burger`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:food:burger`
- **Status:** Active
- **Category:** `food` · **Type:** `consumable`
- **Action:** `feed`
- **Stages:** `baby`, `adult`
- **Effects:** hunger +45, happiness +10, hygiene -8, energy +8
- **Emoji fallback:** 🍔
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `edible`, `food`
- **Stackable:** yes

### Cake — `blobbi:food:cake`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:food:cake`
- **Status:** Active
- **Category:** `food` · **Type:** `consumable`
- **Action:** `feed`
- **Stages:** `baby`, `adult`
- **Effects:** hunger +25, happiness +30, hygiene -10, energy +10
- **Emoji fallback:** 🎂
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `edible`, `food`
- **Stackable:** yes

### Pizza — `blobbi:food:pizza`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:food:pizza`
- **Status:** Active
- **Category:** `food` · **Type:** `consumable`
- **Action:** `feed`
- **Stages:** `baby`, `adult`
- **Effects:** hunger +40, happiness +15, hygiene -9, energy +10
- **Emoji fallback:** 🍕
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `edible`, `food`
- **Stackable:** yes

### Sushi — `blobbi:food:sushi`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:food:sushi`
- **Status:** Active
- **Category:** `food` · **Type:** `consumable`
- **Action:** `feed`
- **Stages:** `baby`, `adult`
- **Effects:** hunger +35, health +10, hygiene -5, energy +7
- **Emoji fallback:** 🍣
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `edible`, `food`
- **Stackable:** yes

### Ball — `blobbi:toy:ball`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:toy:ball`
- **Status:** Active
- **Category:** `toy` · **Type:** `consumable`
- **Action:** `play`
- **Stages:** `baby`, `adult`
- **Effects:** happiness +25, energy -10, hygiene -5
- **Emoji fallback:** ⚽
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `toy`, `playable`
- **Stackable:** yes

### Teddy Bear — `blobbi:toy:teddy`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:toy:teddy`
- **Status:** Active
- **Category:** `toy` · **Type:** `consumable`
- **Action:** `play`
- **Stages:** `baby`, `adult`
- **Effects:** happiness +45, energy -5
- **Emoji fallback:** 🧸
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `toy`, `playable`
- **Stackable:** yes

### Building Blocks — `blobbi:toy:blocks`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:toy:blocks`
- **Status:** Active
- **Category:** `toy` · **Type:** `consumable`
- **Action:** `play`
- **Stages:** `baby`, `adult`
- **Effects:** happiness +30, energy -10
- **Emoji fallback:** 🧱
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `toy`, `playable`
- **Stackable:** yes

### Vitamins — `blobbi:medicine:vitamins`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:medicine:vitamins`
- **Status:** Active
- **Category:** `medicine` · **Type:** `consumable`
- **Action:** `medicine`
- **Stages:** `egg`, `baby`, `adult`
- **Effects:** health +25, energy +5
- **Emoji fallback:** 💊
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `medicine`, `healing`
- **Stackable:** yes

### Super Medicine — `blobbi:medicine:super`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:medicine:super`
- **Status:** Active
- **Category:** `medicine` · **Type:** `consumable`
- **Action:** `medicine`
- **Stages:** `egg`, `baby`, `adult`
- **Effects:** health +50, energy +20, happiness -10
- **Emoji fallback:** 💉
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `medicine`, `healing`
- **Stackable:** yes

### Bandage — `blobbi:medicine:bandage`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:medicine:bandage`
- **Status:** Active
- **Category:** `medicine` · **Type:** `consumable`
- **Action:** `medicine`
- **Stages:** `egg`, `baby`, `adult`
- **Effects:** health +25
- **Emoji fallback:** 🩹
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `medicine`, `healing`
- **Stackable:** yes

### Health Elixir — `blobbi:medicine:health-elixir`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:medicine:health-elixir`
- **Status:** Active
- **Category:** `medicine` · **Type:** `consumable`
- **Action:** `medicine`
- **Stages:** `egg`, `baby`, `adult`
- **Effects:** health +75, happiness +20, energy +10
- **Emoji fallback:** 🧪
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `medicine`, `healing`
- **Stackable:** yes

### Shell Repair Kit — `blobbi:medicine:shell-repair-kit`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:medicine:shell-repair-kit`
- **Status:** Active
- **Category:** `medicine` · **Type:** `consumable`
- **Action:** `medicine`
- **Stages:** `egg`
- **Effects:** health +30
- **Emoji fallback:** 🥚
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `medicine`, `healing`, `egg`
- **Stackable:** yes

### Calcium Supplement — `blobbi:medicine:calcium`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:medicine:calcium`
- **Status:** Active
- **Category:** `medicine` · **Type:** `consumable`
- **Action:** `medicine`
- **Stages:** `egg`, `baby`, `adult`
- **Effects:** health +35
- **Emoji fallback:** 🦴
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `medicine`, `healing`
- **Stackable:** yes

### Soap — `blobbi:hygiene:soap`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:hygiene:soap`
- **Status:** Active
- **Category:** `hygiene` · **Type:** `consumable`
- **Action:** `clean`
- **Stages:** `egg`, `baby`, `adult`
- **Effects:** hygiene +25
- **Emoji fallback:** 🧼
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `hygiene`, `cleaning`
- **Stackable:** yes

### Shampoo — `blobbi:hygiene:shampoo`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:hygiene:shampoo`
- **Status:** Active
- **Category:** `hygiene` · **Type:** `consumable`
- **Action:** `clean`
- **Stages:** `egg`, `baby`, `adult`
- **Effects:** hygiene +50, happiness +10
- **Emoji fallback:** 🧴
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `hygiene`, `cleaning`
- **Stackable:** yes

### Bubble Bath — `blobbi:hygiene:bubble-bath`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:hygiene:bubble-bath`
- **Status:** Active
- **Category:** `hygiene` · **Type:** `consumable`
- **Action:** `clean`
- **Stages:** `egg`, `baby`, `adult`
- **Effects:** hygiene +70, happiness +25
- **Emoji fallback:** 🛁
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `hygiene`, `cleaning`
- **Stackable:** yes

### Soft Towel — `blobbi:hygiene:soft-towel`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:hygiene:soft-towel`
- **Status:** Active
- **Category:** `hygiene` · **Type:** `consumable`
- **Action:** `clean`
- **Stages:** `egg`, `baby`, `adult`
- **Effects:** hygiene +25, happiness +5
- **Emoji fallback:** 🏖️
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `hygiene`, `cleaning`
- **Stackable:** yes

### Energy Drink — `blobbi:energy:drink`

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:energy:drink`
- **Status:** Active
- **Category:** `energy` · **Type:** `consumable`
- **Action:** `boost`
- **Stages:** `baby`, `adult`
- **Effects:** energy +35, happiness +5
- **Emoji fallback:** 🧃
- **Image:** — (none published; the emoji fallback is used)
- **Topics:** `energy`, `boost`
- **Stackable:** yes

### Arcade Ticket — `blobbi:currency:arcade-ticket`

Earned by playing games at the Blobbi Island Arcade. Exchange it for exclusive prizes.

- **Address:** `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:currency:arcade-ticket`
- **Status:** Active
- **Category:** `currency` · **Type:** `currency`
- **Action:** none — cannot be used on a Blobbi
- **Stages:** `egg`, `baby`, `adult`
- **Effects:** none
- **Emoji fallback:** 🎟️
- **Image:** `https://assets.blobbi.pet/items/arcade/arcade-ticket-v1.webp`
- **Topics:** `currency`, `arcade`
- **Stackable:** yes
- **Referenced by:** `src/components/blobbi/ArcadeTicketBalance.tsx`, `src/components/blobbi/ItemBagModal.tsx`

## 9. Recovery boundary

**This registry CAN preserve / restore:**

- Every official kind:31632 Game Item Definition: its `d`, name, type, category, image, topics, effects, action, stages and emoji are all recorded here, so a definition lost from every relay can be rebuilt and republished by the issuer.
- The canonical address of every official item, derived from the issuer public key and the `d` tag.
- Which relays official definitions are expected to be found on.
- Which application kinds exist, what they are for, who signs them and how they expire.

**This registry CANNOT restore:**

- Any player's kind:31633 inventory quantities. Only the player can sign their inventory event; if it is lost from every relay, the balance is gone.
- Any player's coin balance, owned Blobbis, achievements or profile (kind:11125).
- Any Blobbi's state or history (kind:31124, kind:1124).
- Ownership or transaction history of any kind. Nothing here is a ledger.
- Any user-signed event whatsoever. This registry describes schemas and official issuer content only.

In one sentence: official, issuer-signed content is recoverable from this repository; anything a *user* signed is not, and no amount of registry data changes that.
