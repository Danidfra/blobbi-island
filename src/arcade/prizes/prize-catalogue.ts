/**
 * The Prize Counter's catalogue — pure data, deliberately TEMPORARY content.
 *
 * ## What is permanent here, and what is not
 *
 * The TYPES are the contract the Prize Counter is built against: six
 * categories, a delivery union that already knows about badges, Blobbi effects
 * and Home furniture, and a prize shape with price, rarity and availability.
 * The ENTRIES are placeholder fixtures — the real prize list and artwork are
 * being designed separately, and every entry below exists only so the counter
 * has something to render, order, filter and redeem. Replacing them with
 * official kind:31632-backed definitions later means editing THIS module (and
 * the delivery writers), not the UI.
 *
 * ## Why this module is pure
 *
 * No React, no Nostr, no inventory, no storage, no clock. It lives under
 * `src/arcade/`, where `boundaries.test.ts` proves against the real import
 * graph that nothing here can reach a relay or a wallet. A catalogue that could
 * write inventory would be a shop with no checkout line.
 *
 * ## Delivery metadata is FUTURE intent, not current behaviour
 *
 * In V1 every redeemed prize is granted through the temporary local ownership
 * store (`src/lib/arcade-prize-ownership.ts`), whatever its `delivery` says.
 * The union records where each prize will eventually go:
 *
 *  - `badge` — a collectible achievement, later displayable on the profile
 *    card, the Blobbi card and arcade surfaces;
 *  - `blobbi-effect` — a cosmetic animation applied to the Blobbi by a future
 *    effect renderer;
 *  - `home-furniture` — a placeable Home item. The Mini Arcade Cabinet carries
 *    `gameplayMode: 'no-rewards'`: it will open arcade games from Home, and
 *    those games will grant NO Arcade Tickets;
 *  - `inventory` — a real kind:31632 item granted into kind:31633;
 *  - `mock-ownership` — nothing beyond the temporary store, ever intended or
 *    not yet decided.
 *
 * None of those future deliveries is implemented in this task, and nothing
 * here pretends otherwise.
 */

export const ARCADE_PRIZE_CATEGORIES = [
  'badge',
  'accessory',
  'effect',
  'consumable',
  'decoration',
  'furniture',
] as const;

export type ArcadePrizeCategory = (typeof ARCADE_PRIZE_CATEGORIES)[number];

/** Player-facing names for the categories and the filter tabs. */
export const ARCADE_PRIZE_CATEGORY_LABELS: Readonly<Record<ArcadePrizeCategory, string>> = {
  badge: 'Badges',
  accessory: 'Accessories',
  effect: 'Effects',
  consumable: 'Snacks',
  decoration: 'Decorations',
  furniture: 'Furniture',
};

export type ArcadePrizeDelivery =
  | { readonly type: 'mock-ownership' }
  | { readonly type: 'inventory'; readonly itemAddress: string }
  | { readonly type: 'badge'; readonly badgeId: string }
  | { readonly type: 'blobbi-effect'; readonly effectId: string }
  | {
      readonly type: 'home-furniture';
      readonly furnitureId: string;
      /** Games launched from this furniture will award no Arcade Tickets. */
      readonly gameplayMode?: 'no-rewards';
    };

export type ArcadePrizeRarity = 'common' | 'special' | 'premium';

export interface ArcadePrize {
  /** Stable id, unique within the catalogue. Recorded in redemptions. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: ArcadePrizeCategory;
  /** Arcade Tickets. Positive integer. TEMPORARY fixture value, not economy. */
  readonly price: number;
  /** Optional artwork URL. The emoji is the guaranteed fallback. */
  readonly image?: string;
  readonly emojiFallback: string;
  readonly availability: 'available' | 'coming-soon';
  readonly rarity?: ArcadePrizeRarity;
  /** May be redeemed more than once. Absent means once only. */
  readonly repeatable?: boolean;
  readonly delivery: ArcadePrizeDelivery;
}

/**
 * Bumped whenever the entries change shape or meaning. Recorded on every
 * redemption so a ledger record can always say which catalogue priced it.
 */
export const ARCADE_PRIZE_CATALOGUE_VERSION = 'temp-v1';

/**
 * The temporary starter catalogue.
 *
 * Prices are UI fixtures chosen to exercise every interface state (cheap,
 * mid, premium, aspirational) — they are not the final economy. Keep them
 * here, centralized, so replacing the list is one edit.
 */
export const ARCADE_PRIZE_CATALOGUE: readonly ArcadePrize[] = Object.freeze([
  Object.freeze({
    id: 'pixel-confetti',
    title: 'Pixel Confetti',
    description: 'A little burst of pixels to celebrate a good run. Pure joy, zero calories.',
    category: 'effect',
    price: 15,
    emojiFallback: '🎊',
    availability: 'available',
    rarity: 'common',
    delivery: { type: 'mock-ownership' },
  } satisfies ArcadePrize),
  Object.freeze({
    id: 'arcade-snack',
    title: 'Arcade Snack',
    description: 'Crunchy, salty, shaped like a joystick. The classic between-games fuel.',
    category: 'consumable',
    price: 20,
    emojiFallback: '🍿',
    availability: 'available',
    rarity: 'common',
    repeatable: true,
    delivery: { type: 'mock-ownership' },
  } satisfies ArcadePrize),
  Object.freeze({
    id: 'neon-star-glasses',
    title: 'Neon Star Glasses',
    description: 'Star-shaped shades that glow like the basement dance floor.',
    category: 'accessory',
    price: 40,
    emojiFallback: '🕶️',
    availability: 'available',
    rarity: 'common',
    delivery: { type: 'mock-ownership' },
  } satisfies ArcadePrize),
  Object.freeze({
    id: 'arcade-champion-cap',
    title: 'Arcade Champion Cap',
    description: 'Worn brim-back by every Blobbi who has ever hit a 7–0 shutout.',
    category: 'accessory',
    price: 60,
    emojiFallback: '🧢',
    availability: 'available',
    rarity: 'special',
    delivery: { type: 'mock-ownership' },
  } satisfies ArcadePrize),
  Object.freeze({
    id: 'mini-arcade-trophy',
    title: 'Mini Arcade Trophy',
    description:
      'A tiny golden cabinet on a plinth. A collectible badge — one day it will shine on your profile card.',
    category: 'badge',
    price: 75,
    emojiFallback: '🏆',
    availability: 'available',
    rarity: 'special',
    delivery: { type: 'badge', badgeId: 'mini-arcade-trophy' },
  } satisfies ArcadePrize),
  Object.freeze({
    id: 'arcade-glow',
    title: 'Arcade Glow',
    description:
      'A soft neon aura for your Blobbi — a premium effect that will light them up wherever they go.',
    category: 'effect',
    price: 120,
    emojiFallback: '✨',
    availability: 'available',
    rarity: 'premium',
    delivery: { type: 'blobbi-effect', effectId: 'arcade-glow' },
  } satisfies ArcadePrize),
  Object.freeze({
    id: 'golden-ticket-frame',
    title: 'Golden Ticket Frame',
    description: 'A gilded frame for your favourite arcade memory. Still being polished.',
    category: 'decoration',
    price: 250,
    emojiFallback: '🖼️',
    availability: 'coming-soon',
    rarity: 'special',
    delivery: { type: 'mock-ownership' },
  } satisfies ArcadePrize),
  Object.freeze({
    id: 'mini-arcade-cabinet',
    title: 'Mini Arcade Cabinet',
    description:
      'Your very own arcade cabinet for your Home. One day you will place it there and play arcade games without leaving the house — Home games are just for fun and award no Arcade Tickets.',
    category: 'furniture',
    price: 500,
    emojiFallback: '🕹️',
    availability: 'available',
    rarity: 'premium',
    delivery: {
      type: 'home-furniture',
      furnitureId: 'mini-arcade-cabinet',
      gameplayMode: 'no-rewards',
    },
  } satisfies ArcadePrize),
]) as readonly ArcadePrize[];

/** Look a prize up by id. `null` for an id the catalogue does not know. */
export function getArcadePrize(prizeId: string): ArcadePrize | null {
  return ARCADE_PRIZE_CATALOGUE.find((p) => p.id === prizeId) ?? null;
}

/**
 * The deliberate display order: everyday prizes by ascending price first, the
 * premium long-term goals last (also by price). Deterministic — same input,
 * same order, never dependent on render timing or player state, so the shelf
 * does not reshuffle between visits. Owned prizes keep their place; the UI
 * marks them rather than moving them.
 */
export function orderedArcadePrizes(
  catalogue: readonly ArcadePrize[] = ARCADE_PRIZE_CATALOGUE,
): readonly ArcadePrize[] {
  return [...catalogue].sort((a, b) => {
    const premiumA = a.rarity === 'premium' ? 1 : 0;
    const premiumB = b.rarity === 'premium' ? 1 : 0;
    if (premiumA !== premiumB) return premiumA - premiumB;
    if (a.price !== b.price) return a.price - b.price;
    return a.id.localeCompare(b.id);
  });
}

/** The categories that actually have entries, in canonical order. */
export function presentPrizeCategories(
  catalogue: readonly ArcadePrize[] = ARCADE_PRIZE_CATALOGUE,
): readonly ArcadePrizeCategory[] {
  return ARCADE_PRIZE_CATEGORIES.filter((category) =>
    catalogue.some((p) => p.category === category),
  );
}
