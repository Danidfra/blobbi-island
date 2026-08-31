/**
 * The INITIAL official Arcade Prize catalog — six real kind:31632 items.
 *
 * This replaces the temporary fixture catalogue as what the Prize Counter
 * SHOWS. It deliberately contains only STABLE CATALOG DATA:
 *
 *   - the item's stable full address (`31632:<official-issuer>:<d>`), derived
 *     from the canonical registry's address builder — never a current event id,
 *     which changes on every republish of an addressable definition;
 *   - the ticket price;
 *   - a deterministic sort order;
 *   - the availability state (all `available` — see below);
 *   - the canonical definition's `max_stack`, proving the prize is unique.
 *
 * Names, artwork, descriptions and rarity are NOT duplicated here: the Prize
 * Counter resolves them from the kind:31632 catalog (fetched definition first,
 * bundled registry fallback second), so a definition update changes the shelf
 * without touching this file.
 *
 * ## Redemption is LIVE
 *
 * Every entry is `availability: 'available'`. A redemption spends Arcade
 * Tickets and grants the item into kind:31633 in ONE replacement event —
 * `src/inventory/arcade-cosmetic-redeemer.ts` — driven by the same hardened
 * ledger, lock, strict publish and never-respend rules the Arcade Pass uses.
 * The type still admits `'preview'` so a single entry can be pulled from sale
 * by changing data rather than code.
 *
 * ## Every entry must resolve to a canonical official definition
 *
 * {@link officialArcadePrize} does not accept a `d` on trust. It looks the `d`
 * up in the protocol registry, refuses anything that is not an ACTIVE official
 * cosmetic or effect item, refuses a `max_stack` other than 1 (these prizes are
 * unique wearables), and derives the address from the issuer key. A catalog
 * entry that does not resolve cleanly is a module-load failure, not a shelf
 * card that pretends to be redeemable — the same rule
 * `official-visual-effect-items.ts` applies to the renderer bindings.
 *
 * ## Ticket prices are PROVISIONAL
 *
 * The repository has no production ticket-earning rate yet (no arcade game
 * grants tickets in production — see `src/arcade/reward-policy.ts`), so these
 * values cannot claim economic balance. They encode the intended acquisition
 * LADDER, documented in `docs/arcade-prize-catalog.md`:
 *
 *   Block Builder Cap  (uncommon)   200 — first reachable prize
 *   Golden Sparkles    (rare)       400 — short-term goal
 *   Stargazer Glasses  (rare)       500 — short-to-medium goal
 *   Starlight Bow Tie  (epic)       900 — medium-term goal
 *   Mystic Fog         (epic)     1 100 — medium-term goal
 *   Celestial Aura     (legendary) 2 500 — long-term headline prize
 *
 * Rebalancing later must edit THIS module only. The Celestial Seraph Necklace
 * (mythic) is deliberately absent: it is reserved for a future special
 * acquisition path, not the Arcade.
 *
 * ## Why this module may import the protocol registry
 *
 * `src/arcade/` is barred from the inventory/relay layers by
 * `boundaries.test.ts`. `@/protocol/event-registry` is pure identity data and
 * an address builder — no relay, no query, no write path — and deriving the
 * address here is what keeps a hand-typed (possibly wrong) issuer out of the
 * catalog.
 */

import {
  officialCosmeticByD,
  officialEffectItemByD,
  officialItemAddress,
} from '@/protocol/event-registry';

import type { ArcadePrize } from './prize-catalogue';

/** What kind of item a prize unlocks — drives the type chip and the preview. */
export type OfficialArcadePrizeKind = 'accessory' | 'effect';

export type OfficialArcadePrizeAvailability =
  /** Browsable and previewable, but deliberately not for sale. */
  | 'preview'
  /** Redeemable for Arcade Tickets. Every current entry is this. */
  | 'available';

export interface OfficialArcadePrize {
  /** The kind:31632 `d` tag of the official item. */
  readonly d: string;
  /** `31632:<official-issuer>:<d>` — stable identity, derived, never an event id. */
  readonly itemAddress: string;
  readonly kind: OfficialArcadePrizeKind;
  /** Arcade Tickets. Positive integer. Provisional — see module doc. */
  readonly tickets: number;
  /** Deterministic shelf position, ascending. Unique per entry. */
  readonly sortOrder: number;
  /** Optional shelf highlight for the headline prize. */
  readonly featured?: boolean;
  readonly availability: OfficialArcadePrizeAvailability;
  /**
   * The published `max_stack` of the canonical definition — 1 for every prize
   * here. This is ITEM POLICY read from the registry, not a catalog opinion:
   * it is what makes "you already own it" a refusal rather than a second sale.
   */
  readonly maxOwned: number;
  /** Registry display name — FALLBACK ONLY; the fetched definition wins. */
  readonly fallbackName: string;
  /** Registry emoji — FALLBACK ONLY; the fetched definition wins. */
  readonly fallbackSymbol: string;
}

/**
 * Bumped whenever entries change shape or meaning, so any future redemption
 * ledger can record which catalog priced it.
 */
export const OFFICIAL_ARCADE_PRIZE_CATALOG_VERSION = 'official-v2-inventory';

/**
 * Build one catalog entry, PROVING it names a real official item first.
 *
 * Exported so the tests can assert the refusals directly rather than only
 * observing that the module happened to load.
 */
export function officialArcadePrize(
  d: string,
  kind: OfficialArcadePrizeKind,
  tickets: number,
  sortOrder: number,
  featured = false,
  availability: OfficialArcadePrizeAvailability = 'available',
): OfficialArcadePrize {
  // The registry is the authority on what an official item IS. A prize whose
  // `d` is not in it has no canonical definition to grant, and must never
  // reach the shelf as something a player can pay for.
  const definition =
    kind === 'accessory' ? officialCosmeticByD(d) : officialEffectItemByD(d);
  if (!definition) {
    throw new Error(`Arcade prize "${d}" is not an official ${kind} definition`);
  }
  if (definition.status !== 'active') {
    throw new Error(`Arcade prize "${d}" is ${definition.status}, not active`);
  }
  // Unique wearables. A prize the inventory would let a player hold twice is a
  // different economy question, and this catalog does not answer it.
  if (definition.maxStack !== 1) {
    throw new Error(`Arcade prize "${d}" has max_stack ${definition.maxStack}, expected 1`);
  }
  if (!Number.isInteger(tickets) || tickets <= 0) {
    throw new Error(`Arcade prize "${d}" has an invalid ticket price: ${tickets}`);
  }
  return Object.freeze({
    d,
    // Derived from the issuer key, never typed out — the address IS the
    // identity, and a hand-copied one is a wrong item waiting to happen.
    itemAddress: officialItemAddress(d),
    kind,
    tickets,
    sortOrder,
    ...(featured ? { featured: true } : {}),
    availability,
    maxOwned: 1,
    fallbackName: definition.name,
    fallbackSymbol: definition.symbol,
  });
}

/**
 * The six initial prizes: three accessories, three visual effects, priced as a
 * ladder from first-session to long-term. Sorted by `sortOrder` == ascending
 * ticket price, so the shelf reads cheapest → headline.
 */
export const OFFICIAL_ARCADE_PRIZE_CATALOG: readonly OfficialArcadePrize[] =
  Object.freeze([
    officialArcadePrize('blobbi:cosmetic:block-builder-cap', 'accessory', 200, 1),
    officialArcadePrize('blobbi:effect:golden-sparkles', 'effect', 400, 2),
    officialArcadePrize('blobbi:cosmetic:stargazer-glasses', 'accessory', 500, 3),
    officialArcadePrize('blobbi:cosmetic:starlight-bow-tie', 'accessory', 900, 4),
    officialArcadePrize('blobbi:effect:mystic-fog', 'effect', 1100, 5),
    officialArcadePrize('blobbi:effect:celestial-aura', 'effect', 2500, 6, true),
  ]) as readonly OfficialArcadePrize[];

/** The catalog in deterministic shelf order. */
export function orderedOfficialArcadePrizes(
  catalog: readonly OfficialArcadePrize[] = OFFICIAL_ARCADE_PRIZE_CATALOG,
): readonly OfficialArcadePrize[] {
  return [...catalog].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Look a prize up by its stable item address, or `null`. */
export function officialArcadePrizeByAddress(
  itemAddress: string,
  catalog: readonly OfficialArcadePrize[] = OFFICIAL_ARCADE_PRIZE_CATALOG,
): OfficialArcadePrize | null {
  return catalog.find((p) => p.itemAddress === itemAddress) ?? null;
}


/**
 * The redemption view of an official prize.
 *
 * `useArcadePrizeRedemption` and the durable ledger speak {@link ArcadePrize};
 * this is the one place an official catalog entry becomes one, so no component
 * assembles a prize record by hand.
 *
 * The parts that MATTER to the machine are all derived, never invented:
 *
 *  - `id` is the `d` tag — stable identity, recorded in every ledger record,
 *    and never an event id (kind:31632 is addressable and republished);
 *  - `price` is the catalog's ticket price, frozen into the record at
 *    reservation so a later rebalance cannot change what an in-flight
 *    redemption spends;
 *  - `repeatable` is absent: `max_stack` is 1, so a confirmed redemption
 *    blocks the next one forever;
 *  - `delivery` carries the CANONICAL ITEM ADDRESS, which is what the atomic
 *    redeemer grants. There is no second place that says where a prize goes;
 *  - `catalogVersion` names this catalog, so a record priced here is never
 *    mistaken for one priced by the fixture list.
 *
 * `title` may be improved by the caller from the fetched kind:31632 definition
 * — it is confirmation copy, not identity — but the registry fallback is
 * always present so a relay outage cannot leave a prize nameless.
 */
export function officialArcadePrizeAsRedeemable(
  prize: OfficialArcadePrize,
  title: string = prize.fallbackName,
): ArcadePrize {
  return Object.freeze({
    id: prize.d,
    title: title.trim().length > 0 ? title : prize.fallbackName,
    description: '',
    category: prize.kind === 'accessory' ? 'accessory' : 'effect',
    price: prize.tickets,
    emojiFallback: prize.fallbackSymbol,
    availability: prize.availability === 'available' ? 'available' : 'coming-soon',
    delivery: { type: 'inventory', itemAddress: prize.itemAddress },
    catalogVersion: OFFICIAL_ARCADE_PRIZE_CATALOG_VERSION,
  } satisfies ArcadePrize);
}

/** Look a prize up by its `d` tag (== its redemption id), or `null`. */
export function officialArcadePrizeById(
  prizeId: string,
  catalog: readonly OfficialArcadePrize[] = OFFICIAL_ARCADE_PRIZE_CATALOG,
): OfficialArcadePrize | null {
  return catalog.find((p) => p.d === prizeId) ?? null;
}
