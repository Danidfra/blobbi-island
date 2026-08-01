# Arcade Prize Catalog — the initial six official prizes (Phase 9.5)

The Prize Counter now shows six REAL kind:31632-backed items, browsable and
previewable, with redemption deliberately disabled until the durable Arcade
grant/spending flow is implemented and audited.

Catalog module: `src/arcade/prizes/official-prize-catalog.ts` — the single
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
from the canonical registry's builder — never a current event id (addressable
definitions get new ids on every republish). Catalog entries carry only
stable data (address, price, sort order, featured flag, availability); names,
artwork, descriptions and rarity resolve from the kind:31632 catalog at
render time, falling back to the bundled registry when relays are
unreachable.

## 3. Balancing assumptions — PROVISIONAL VALUES

**These prices are provisional catalog values, not a finalized economy.** The
repository has no production ticket-earning rate: the audited reward policy
(`src/arcade/reward-policy.ts`) currently grants no tickets from any arcade
game in production. The prices therefore cannot claim economic balance; what
they encode is the intended acquisition LADDER:

- Block Builder Cap — the first reachable prize;
- Golden Sparkles, Stargazer Glasses — short-to-medium goals;
- Starlight Bow Tie, Mystic Fog — medium-term goals;
- Celestial Aura — the long-term headline prize (featured).

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
their slot while other active effects stay. Previews mutate nothing — no
kind:31633, no kind:31634, no publish, no signer (behaviour-tested with a
recording signer mock).

## 7. Redemption is disabled

There is NO redeem control — not a disabled button, none at all. The counter
and the detail panel say honestly: *"Prize redemption is being prepared. You
can preview rewards now."* The counter spends no tickets, decrements no local
balance, grants nothing, and cannot import any write path or the developer
lab (transitively proven by `prize-counter-boundaries.test.ts` and
`src/arcade/boundaries.test.ts`).

## 8. The future grant/redemption phase

The dormant machinery from the retired V1 flow is retained, tested and
unwired for it: the pure spend state machine (`prize-redemption.ts`, with its
never-respend-an-unresolved-outcome rule), `useArcadePrizeRedemption`, the
strict spend writer and the temporary ownership store. The future phase
replaces the temporary ownership store with a durable kind:31633 grant
(delivery `{ type: 'inventory', itemAddress }` — activation then needs no new
code: granted items equip through the existing Phase-9 path), re-audits the
spend flow end to end, and flips catalog entries to `availability:
'available'`.

**See also:** `docs/arcade-prize-counter.md` (the V1 counter this supersedes)
· `docs/inventory-equipment-lab.md` · `docs/blobbi-effect-activation.md` ·
`docs/INVENTORY_ARCHITECTURE.md`
