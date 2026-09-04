# Arcade Prize Catalog, the six official prizes

The Prize Counter shows six REAL kind:31632-backed items, and all six are
REDEEMABLE: Arcade Tickets buy them, and the item lands in the player's
kind:31633 inventory where the ordinary wardrobe and effects panel pick it up.

Every redemption is ONE replacement event carrying both the ticket debit and
the item grant: see §7.

Catalog module: `src/arcade/prizes/official-prize-catalog.ts`: the single
source of truth for prices; rebalancing edits that one file.

## 1–2. The six prizes and their ticket values

| Prize | Stable `d` | Kind | Rarity | Tickets |
|---|---|---|---|---|
| Block Builder Cap | `blobbi:cosmetic:block-builder-cap` | Accessory | uncommon | 200 |
| Golden Sparkles | `blobbi:effect:golden-sparkles` | Effect | rare | 400 |
| Stargazer Glasses | `blobbi:cosmetic:stargazer-glasses` | Accessory | rare | 500 |
| Starlight Bow Tie | `blobbi:cosmetic:starlight-bow-tie` | Accessory | epic | 900 |
| Mystic Fog | `blobbi:effect:mystic-fog` | Effect | epic | 1,100 |
| Celestial Aura | `blobbi:effect:celestial-aura` | Effect | legendary | 2,500 |

Identity is the full stable address `31632:<official-issuer>:<d>`, derived
from the canonical registry's builder; never a current event id (addressable
definitions get new ids on every republish). Catalog entries carry only
stable data (address, price, sort order, featured flag, availability); names,
artwork, descriptions and rarity resolve from the kind:31632 catalog at
render time, falling back to the bundled registry when relays are
unreachable.

## 3. Balancing assumptions: PROVISIONAL VALUES

**These prices are provisional catalog values, not a finalized economy.** The
repository has no production ticket-earning rate: the audited reward policy
(`src/arcade/reward-policy.ts`) currently grants no tickets from any arcade
game in production. The prices therefore cannot claim economic balance; what
they encode is the intended acquisition LADDER:

- Block Builder Cap, the first reachable prize;
- Golden Sparkles, Stargazer Glasses, short-to-medium goals;
- Starlight Bow Tie, Mystic Fog, medium-term goals;
- Celestial Aura: the long-term headline prize (featured).

Rarities come from the published definitions and were NOT adjusted to fit
pricing. Final balancing happens only after measuring: average tickets per
completed game, average session length, tickets per active day, expected
sessions per rarity tier, the duplicate-ownership policy, and whether prizes
are permanent or seasonal.

## 4. Distribution

Three accessories and three visual effects, alternating up the price ladder
so both types have an early and a late goal.

## 5. Why the Celestial Seraph Necklace is excluded

It is the only MYTHIC wearable and is reserved for a future special
acquisition path. Putting the rarest item in the launch Arcade catalog would
spend the ecosystem's headline exclusive on the first prize shelf. Its
absence is pinned by `official-prize-catalog.test.ts`.

## 6. Preview behavior

The detail panel previews every prize on the CURRENT companion (or a labelled
sample Blobbi when none exists) through the real renderer paths
(`PrizePreviewStage`): accessories composite over the currently worn
equipment using the published front/back views with the rear hidden-slot
rules unchanged; effects render through the Phase-8 implementations, winning
their slot while other active effects stay. Previews mutate nothing; no
kind:31633, no kind:31634, no publish, no signer (behaviour-tested with a
recording signer mock).

## 7. Redemption: one atomic kind:31633 event

Arcade Tickets and cosmetic items are quantities in the SAME replaceable
kind:31633 event, so a cosmetic redemption does not pay first and deliver
second. `src/inventory/arcade-cosmetic-redeemer.ts` performs both halves as
one `set-many` mutation inside one `runInventoryTransaction`:

```
before:  { …, Arcade Ticket: 500 }
after:   { …, Arcade Ticket: 300, Block Builder Cap: 1 }
         └────────── ONE replacement event ──────────┘
```

Consequences:

- there is no state where the tickets are gone and the prize is missing;
- delivery is a VERIFICATION, not a write, `grantPrize` reads and confirms;
- an AMBIGUOUS publish is reconciled against the PRIZE (`reconcile-atomic`),
  which only this redemption's own event could have granted, rather than
  against a ticket balance every other writer also moves. Prize present ⇒
  spent and delivered; prize absent AND balance untouched ⇒ provably nothing
  happened, retryable; anything else ⇒ unresolved, never respent.

Everything financial still runs through the hardened
`useArcadePrizeRedemption`: durable ledger record before any publish, a
synchronous same-tick lock, the shared cross-tab inventory lock, an
authoritative empty-confirmed base, a strict publish (a timeout is never
success), and the never-respend-an-unresolved-outcome rule.

Uniqueness: every prize definition publishes `max_stack: 1`, so a prize is
redeemable exactly once. The catalog refuses to build an entry whose
definition says otherwise, the UI shows **Owned** instead of a price, and the
authoritative refusal happens inside the write lock against the newest
kind:31633 event: never against the rendered inventory alone.

### Where the write lives

`PrizeCounter` is still provably write-free. The redeem control arrives as a
`redeemSlot` render prop (`ArcadeCosmeticRedeemAction`), exactly as the Arcade
Pass arrives as a `featureSlot` node; neither a node nor a callback carries an
import, so `prize-counter-boundaries.test.ts` is unchanged and still passes.

## 8. The Arcade Pass is deliberately different

The Pass (180 Tickets → 15 free plays within 24 hours) stays a TEMPORARY
entitlement, not kind:31633 ownership. Its delivery genuinely is a second
write into a local expiring store, so it keeps the two-stage
`spent → delivering → confirmed` path, the paid-but-undelivered recovery and
the balance-based reconciliation. One redemption architecture, two delivery
adapters, `atomicWithSpend` is the flag that picks the reconciliation.

**See also:** `docs/arcade-prize-counter.md` (the V1 counter this supersedes)
· `docs/inventory-equipment-lab.md` · `docs/blobbi-effect-activation.md` ·
`docs/INVENTORY_ARCHITECTURE.md`
