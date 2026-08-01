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
 *   - the availability state (all `preview` in this phase — see below).
 *
 * Names, artwork, descriptions and rarity are NOT duplicated here: the Prize
 * Counter resolves them from the kind:31632 catalog (fetched definition first,
 * bundled registry fallback second), so a definition update changes the shelf
 * without touching this file.
 *
 * ## Redemption is disabled in this phase
 *
 * Every entry is `availability: 'preview'`: browsable, previewable, honestly
 * NOT purchasable. The durable grant/spending flow is a later, separately
 * audited phase; until it lands, nothing in this catalog can be redeemed, no
 * ticket is spent, and no inventory is written from the Prize Counter. The
 * type admits `'available'` so the future phase flips data, not code shape.
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

import { officialItemAddress } from '@/protocol/event-registry';

/** What kind of item a prize unlocks — drives the type chip and the preview. */
export type OfficialArcadePrizeKind = 'accessory' | 'effect';

export type OfficialArcadePrizeAvailability =
  /** Browsable and previewable; redemption intentionally not implemented. */
  | 'preview'
  /** Redeemable — NOT used in this phase; reserved for the grant phase. */
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
}

/**
 * Bumped whenever entries change shape or meaning, so any future redemption
 * ledger can record which catalog priced it.
 */
export const OFFICIAL_ARCADE_PRIZE_CATALOG_VERSION = 'official-v1-preview';

function prize(
  d: string,
  kind: OfficialArcadePrizeKind,
  tickets: number,
  sortOrder: number,
  featured = false,
): OfficialArcadePrize {
  return Object.freeze({
    d,
    itemAddress: officialItemAddress(d),
    kind,
    tickets,
    sortOrder,
    ...(featured ? { featured: true } : {}),
    availability: 'preview',
  });
}

/**
 * The six initial prizes: three accessories, three visual effects, priced as a
 * ladder from first-session to long-term. Sorted by `sortOrder` == ascending
 * ticket price, so the shelf reads cheapest → headline.
 */
export const OFFICIAL_ARCADE_PRIZE_CATALOG: readonly OfficialArcadePrize[] =
  Object.freeze([
    prize('blobbi:cosmetic:block-builder-cap', 'accessory', 200, 1),
    prize('blobbi:effect:golden-sparkles', 'effect', 400, 2),
    prize('blobbi:cosmetic:stargazer-glasses', 'accessory', 500, 3),
    prize('blobbi:cosmetic:starlight-bow-tie', 'accessory', 900, 4),
    prize('blobbi:effect:mystic-fog', 'effect', 1100, 5),
    prize('blobbi:effect:celestial-aura', 'effect', 2500, 6, true),
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
