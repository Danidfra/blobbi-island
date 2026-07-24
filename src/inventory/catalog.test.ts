import { describe, it, expect } from 'vitest';
import {
  OFFICIAL_ITEM_REGISTRY,
  OFFICIAL_ITEM_ADDRESSES,
  OFFICIAL_ITEM_ISSUER_PUBKEY,
  itemIdToAddress,
  addressToItemId,
  dTagToAddress,
  isOfficialItemAddress,
  bundledFallbackDefinition,
  bundledFallbackCatalog,
  emojiForItemId,
  unknownItemDefinition,
  GENERIC_ITEM_EMOJI,
} from '@/inventory';

describe('official item registry', () => {
  it('contains exactly the 19 official items', () => {
    expect(OFFICIAL_ITEM_REGISTRY).toHaveLength(19);
    expect(OFFICIAL_ITEM_ADDRESSES).toHaveLength(19);
  });

  it('builds every address from the official issuer', () => {
    for (const entry of OFFICIAL_ITEM_REGISTRY) {
      expect(entry.address).toBe(
        `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:${entry.d}`,
      );
    }
  });

  it('has the exact expected addresses', () => {
    expect(itemIdToAddress('food_apple')).toBe(
      `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:blobbi:food:apple`,
    );
    expect(itemIdToAddress('med_elixir')).toBe(
      `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:blobbi:medicine:health-elixir`,
    );
    expect(itemIdToAddress('hyg_bubble')).toBe(
      `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:blobbi:hygiene:bubble-bath`,
    );
    expect(itemIdToAddress('nrg_drink')).toBe(
      `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:blobbi:energy:drink`,
    );
  });

  it('round-trips itemId <-> address <-> d', () => {
    for (const entry of OFFICIAL_ITEM_REGISTRY) {
      expect(addressToItemId(entry.address)).toBe(entry.itemId);
      expect(itemIdToAddress(entry.itemId)).toBe(entry.address);
      expect(dTagToAddress(entry.d)).toBe(entry.address);
    }
  });

  it('returns null for unknown identities', () => {
    expect(itemIdToAddress('nope')).toBeNull();
    expect(addressToItemId('31632:deadbeef:blobbi:food:nope')).toBeNull();
    expect(dTagToAddress('blobbi:food:nope')).toBeNull();
    expect(isOfficialItemAddress('31632:x:y')).toBe(false);
  });
});

describe('bundled fallback catalog', () => {
  it('resolves all 19 official addresses', () => {
    const catalog = bundledFallbackCatalog();
    expect(catalog).toHaveLength(19);
    for (const address of OFFICIAL_ITEM_ADDRESSES) {
      expect(bundledFallbackDefinition(address)).not.toBeNull();
    }
  });

  it('carries the EXACT published effects', () => {
    const apple = bundledFallbackDefinition(itemIdToAddress('food_apple')!)!;
    expect(apple.effects).toEqual({ hunger: 25, hygiene: -2, energy: 5 });

    const burger = bundledFallbackDefinition(itemIdToAddress('food_burger')!)!;
    expect(burger.effects).toEqual({
      hunger: 45,
      happiness: 10,
      hygiene: -8,
      energy: 8,
    });

    const superMed = bundledFallbackDefinition(itemIdToAddress('med_super')!)!;
    expect(superMed.effects).toEqual({ health: 50, energy: 20, happiness: -10 });

    const bubble = bundledFallbackDefinition(itemIdToAddress('hyg_bubble')!)!;
    expect(bubble.effects).toEqual({ hygiene: 70, happiness: 25 });

    const drink = bundledFallbackDefinition(itemIdToAddress('nrg_drink')!)!;
    expect(drink.effects).toEqual({ energy: 35, happiness: 5 });
  });

  it('maps the exact actions', () => {
    expect(bundledFallbackDefinition(itemIdToAddress('food_apple')!)!.action).toBe('feed');
    expect(bundledFallbackDefinition(itemIdToAddress('toy_ball')!)!.action).toBe('play');
    expect(bundledFallbackDefinition(itemIdToAddress('med_bandage')!)!.action).toBe('medicine');
    expect(bundledFallbackDefinition(itemIdToAddress('hyg_soap')!)!.action).toBe('clean');
    expect(bundledFallbackDefinition(itemIdToAddress('nrg_drink')!)!.action).toBe('boost');
  });

  it('applies stage restrictions (shell repair is egg-only)', () => {
    const shell = bundledFallbackDefinition(itemIdToAddress('med_shell_repair')!)!;
    expect(shell.stages).toEqual(['egg']);

    const otherMed = bundledFallbackDefinition(itemIdToAddress('med_calcium')!)!;
    expect(otherMed.stages).toEqual(['egg', 'baby', 'adult']);

    const food = bundledFallbackDefinition(itemIdToAddress('food_apple')!)!;
    expect(food.stages).toEqual(['baby', 'adult']);

    const hygiene = bundledFallbackDefinition(itemIdToAddress('hyg_soap')!)!;
    expect(hygiene.stages).toEqual(['egg', 'baby', 'adult']);
  });

  it('marks source as fallback', () => {
    const apple = bundledFallbackDefinition(itemIdToAddress('food_apple')!)!;
    expect(apple.source).toBe('fallback');
  });
});

describe('emoji fallback', () => {
  it('resolves emoji by itemId', () => {
    expect(emojiForItemId('food_apple')).toBe('🍎');
    expect(emojiForItemId('toy_teddy')).toBe('🧸');
  });

  it('falls back to generic emoji for unknown/null', () => {
    expect(emojiForItemId('nope')).toBe(GENERIC_ITEM_EMOJI);
    expect(emojiForItemId(null)).toBe(GENERIC_ITEM_EMOJI);
  });

  it('unknown item model uses generic emoji and no action', () => {
    const unknown = unknownItemDefinition('31632:x:blobbi:mystery:thing', 'blobbi:mystery:thing');
    expect(unknown.emoji).toBe(GENERIC_ITEM_EMOJI);
    expect(unknown.action).toBeNull();
    expect(unknown.itemId).toBeNull();
    expect(unknown.source).toBe('unknown');
  });
});

/**
 * Exact-metadata verification for ALL 19 bundled fallbacks against the values
 * published in the official kind:31632 events (fetched from the official relays
 * during the audit on the current definitions). Covers name, type, category,
 * effects, action, stages, emoji, and topics — not only effects/action/stages.
 */
describe('bundled fallback exact metadata (all 19)', () => {
  const EXPECTED: Record<
    string,
    {
      name: string;
      type: string;
      category: string;
      emoji: string;
      action: string;
      stages: string[];
      topics: string[];
      effects: Record<string, number>;
    }
  > = {
    food_apple: { name: 'Apple', type: 'consumable', category: 'food', emoji: '🍎', action: 'feed', stages: ['baby', 'adult'], topics: ['edible', 'food'], effects: { hunger: 25, hygiene: -2, energy: 5 } },
    food_burger: { name: 'Burger', type: 'consumable', category: 'food', emoji: '🍔', action: 'feed', stages: ['baby', 'adult'], topics: ['edible', 'food'], effects: { hunger: 45, happiness: 10, hygiene: -8, energy: 8 } },
    food_cake: { name: 'Cake', type: 'consumable', category: 'food', emoji: '🎂', action: 'feed', stages: ['baby', 'adult'], topics: ['edible', 'food'], effects: { hunger: 25, happiness: 30, hygiene: -10, energy: 10 } },
    food_pizza: { name: 'Pizza', type: 'consumable', category: 'food', emoji: '🍕', action: 'feed', stages: ['baby', 'adult'], topics: ['edible', 'food'], effects: { hunger: 40, happiness: 15, hygiene: -9, energy: 10 } },
    food_sushi: { name: 'Sushi', type: 'consumable', category: 'food', emoji: '🍣', action: 'feed', stages: ['baby', 'adult'], topics: ['edible', 'food'], effects: { hunger: 35, health: 10, hygiene: -5, energy: 7 } },
    toy_ball: { name: 'Ball', type: 'consumable', category: 'toy', emoji: '⚽', action: 'play', stages: ['baby', 'adult'], topics: ['toy', 'playable'], effects: { happiness: 25, energy: -10, hygiene: -5 } },
    toy_teddy: { name: 'Teddy Bear', type: 'consumable', category: 'toy', emoji: '🧸', action: 'play', stages: ['baby', 'adult'], topics: ['toy', 'playable'], effects: { happiness: 45, energy: -5 } },
    toy_blocks: { name: 'Building Blocks', type: 'consumable', category: 'toy', emoji: '🧱', action: 'play', stages: ['baby', 'adult'], topics: ['toy', 'playable'], effects: { happiness: 30, energy: -10 } },
    med_vitamins: { name: 'Vitamins', type: 'consumable', category: 'medicine', emoji: '💊', action: 'medicine', stages: ['egg', 'baby', 'adult'], topics: ['medicine', 'healing'], effects: { health: 25, energy: 5 } },
    med_super: { name: 'Super Medicine', type: 'consumable', category: 'medicine', emoji: '💉', action: 'medicine', stages: ['egg', 'baby', 'adult'], topics: ['medicine', 'healing'], effects: { health: 50, energy: 20, happiness: -10 } },
    med_bandage: { name: 'Bandage', type: 'consumable', category: 'medicine', emoji: '🩹', action: 'medicine', stages: ['egg', 'baby', 'adult'], topics: ['medicine', 'healing'], effects: { health: 25 } },
    med_elixir: { name: 'Health Elixir', type: 'consumable', category: 'medicine', emoji: '🧪', action: 'medicine', stages: ['egg', 'baby', 'adult'], topics: ['medicine', 'healing'], effects: { health: 75, happiness: 20, energy: 10 } },
    med_shell_repair: { name: 'Shell Repair Kit', type: 'consumable', category: 'medicine', emoji: '🥚', action: 'medicine', stages: ['egg'], topics: ['medicine', 'healing', 'egg'], effects: { health: 30 } },
    med_calcium: { name: 'Calcium Supplement', type: 'consumable', category: 'medicine', emoji: '🦴', action: 'medicine', stages: ['egg', 'baby', 'adult'], topics: ['medicine', 'healing'], effects: { health: 35 } },
    hyg_soap: { name: 'Soap', type: 'consumable', category: 'hygiene', emoji: '🧼', action: 'clean', stages: ['egg', 'baby', 'adult'], topics: ['hygiene', 'cleaning'], effects: { hygiene: 25 } },
    hyg_shampoo: { name: 'Shampoo', type: 'consumable', category: 'hygiene', emoji: '🧴', action: 'clean', stages: ['egg', 'baby', 'adult'], topics: ['hygiene', 'cleaning'], effects: { hygiene: 50, happiness: 10 } },
    hyg_bubble: { name: 'Bubble Bath', type: 'consumable', category: 'hygiene', emoji: '🛁', action: 'clean', stages: ['egg', 'baby', 'adult'], topics: ['hygiene', 'cleaning'], effects: { hygiene: 70, happiness: 25 } },
    hyg_towel: { name: 'Soft Towel', type: 'consumable', category: 'hygiene', emoji: '🏖️', action: 'clean', stages: ['egg', 'baby', 'adult'], topics: ['hygiene', 'cleaning'], effects: { hygiene: 25, happiness: 5 } },
    nrg_drink: { name: 'Energy Drink', type: 'consumable', category: 'energy', emoji: '🧃', action: 'boost', stages: ['baby', 'adult'], topics: ['energy', 'boost'], effects: { energy: 35, happiness: 5 } },
  };

  it('covers exactly the 19 official items', () => {
    expect(Object.keys(EXPECTED)).toHaveLength(19);
  });

  for (const entry of OFFICIAL_ITEM_REGISTRY) {
    it(`matches published metadata for ${entry.itemId}`, () => {
      const def = bundledFallbackDefinition(entry.address)!;
      const exp = EXPECTED[entry.itemId];
      expect(exp, `missing expected for ${entry.itemId}`).toBeTruthy();
      expect(def.name).toBe(exp.name);
      expect(def.type).toBe(exp.type);
      expect(def.category).toBe(exp.category);
      expect(def.emoji).toBe(exp.emoji);
      expect(def.action).toBe(exp.action);
      expect(def.stages).toEqual(exp.stages);
      expect(def.topics).toEqual(exp.topics);
      expect(def.effects).toEqual(exp.effects);
    });
  }
});
