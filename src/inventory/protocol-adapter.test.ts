import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  OFFICIAL_ITEM_ISSUER_PUBKEY,
  itemIdToAddress,
  parseOfficialItemDefinition,
  resolveFromDefinition,
  resolveItemDefinition,
  selectNewestValidDefinitions,
} from '@/inventory';
import { buildGameItemDefinitionEvent, type GameItemDefinition } from '@nostr-games/inventory';

function makeDefinitionEvent(
  overrides: Partial<{
    pubkey: string;
    created_at: number;
    d: string;
    name: string;
    type: string;
    category: string;
    image: string;
    content: unknown;
  }> = {},
): NostrEvent {
  const template = buildGameItemDefinitionEvent({
    id: overrides.d ?? 'blobbi:food:apple',
    name: overrides.name ?? 'Apple',
    type: overrides.type ?? 'consumable',
    category: overrides.category ?? 'food',
    image: overrides.image,
    content: overrides.content ?? '',
  });
  return {
    id: 'evt',
    pubkey: overrides.pubkey ?? OFFICIAL_ITEM_ISSUER_PUBKEY,
    created_at: overrides.created_at ?? 1000,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
}

describe('parseOfficialItemDefinition', () => {
  it('parses a valid definition from the official issuer', () => {
    const def = parseOfficialItemDefinition(makeDefinitionEvent());
    expect(def).not.toBeNull();
    expect(def!.name).toBe('Apple');
    expect(def!.issuer).toBe(OFFICIAL_ITEM_ISSUER_PUBKEY);
  });

  it('rejects definitions from an unexpected issuer', () => {
    const def = parseOfficialItemDefinition(
      makeDefinitionEvent({ pubkey: 'a'.repeat(64) }),
    );
    expect(def).toBeNull();
  });

  it('rejects a malformed definition (missing name)', () => {
    // Hand-craft an event with no name tag.
    const bad: NostrEvent = {
      id: 'evt',
      pubkey: OFFICIAL_ITEM_ISSUER_PUBKEY,
      created_at: 1,
      kind: 31632,
      tags: [['d', 'blobbi:food:apple'], ['type', 'consumable']],
      content: '',
      sig: 'sig',
    };
    expect(parseOfficialItemDefinition(bad)).toBeNull();
  });
});

describe('resolveFromDefinition', () => {
  it('merges bundled effects when the definition omits content effects', () => {
    const def = parseOfficialItemDefinition(makeDefinitionEvent())!;
    const resolved = resolveFromDefinition(def);
    // Effects fall back to bundled published values.
    expect(resolved.effects).toEqual({ hunger: 25, hygiene: -2, energy: 5 });
    expect(resolved.action).toBe('feed');
    expect(resolved.source).toBe('definition');
  });

  it('reads effects/action/emoji/stages from content JSON when present', () => {
    const def = parseOfficialItemDefinition(
      makeDefinitionEvent({
        content: {
          effects: { hunger: 99 },
          action: 'feed',
          stages: ['adult'],
          emoji: '🍏',
        },
      }),
    )!;
    const resolved = resolveFromDefinition(def);
    expect(resolved.effects).toEqual({ hunger: 99 });
    expect(resolved.stages).toEqual(['adult']);
    expect(resolved.emoji).toBe('🍏');
  });

  it('reads the CANONICAL published content shape (effects[game:blobbi] + metadata)', () => {
    const def = parseOfficialItemDefinition(
      makeDefinitionEvent({
        content: {
          effects: { 'game:blobbi': { hunger: 42, energy: 3 } },
          metadata: {
            itemId: 'food_apple',
            action: 'feed',
            stages: ['baby'],
            emoji: '🍏',
            stackable: true,
          },
        },
      }),
    )!;
    const resolved = resolveFromDefinition(def);
    expect(resolved.effects).toEqual({ hunger: 42, energy: 3 });
    expect(resolved.action).toBe('feed');
    expect(resolved.stages).toEqual(['baby']);
    expect(resolved.emoji).toBe('🍏');
  });

  it('prefers image over emoji (visual resolution order)', () => {
    const def = parseOfficialItemDefinition(
      makeDefinitionEvent({ image: 'https://example.com/apple.png' }),
    )!;
    const resolved = resolveFromDefinition(def);
    expect(resolved.image).toBe('https://example.com/apple.png');
  });
});

describe('resolveItemDefinition (full order)', () => {
  const appleAddress = itemIdToAddress('food_apple')!;

  it('prefers a fetched definition', () => {
    const def = parseOfficialItemDefinition(
      makeDefinitionEvent({ name: 'Fetched Apple' }),
    )!;
    const map = new Map<string, GameItemDefinition>([[appleAddress, def]]);
    const resolved = resolveItemDefinition(appleAddress, map);
    expect(resolved.name).toBe('Fetched Apple');
    expect(resolved.source).toBe('definition');
  });

  it('falls back to bundled when no fetched definition', () => {
    const resolved = resolveItemDefinition(appleAddress, new Map());
    expect(resolved.source).toBe('fallback');
    expect(resolved.name).toBe('Apple');
  });

  it('falls back to unknown for a non-official address', () => {
    const resolved = resolveItemDefinition(
      '31632:deadbeef:blobbi:mystery:thing',
      new Map(),
      'blobbi:mystery:thing',
    );
    expect(resolved.source).toBe('unknown');
    expect(resolved.itemId).toBeNull();
  });
});

describe('selectNewestValidDefinitions', () => {
  const appleAddress = itemIdToAddress('food_apple')!;

  it('selects the newest valid definition per address', () => {
    const older = makeDefinitionEvent({ created_at: 100, name: 'Old Apple' });
    const newer = makeDefinitionEvent({ created_at: 200, name: 'New Apple' });
    const selected = selectNewestValidDefinitions([[older, newer]]);
    expect(selected.get(appleAddress)!.name).toBe('New Apple');
  });

  it('a NEWER invalid-issuer event does not hide/replace an older valid one', () => {
    const olderValid = makeDefinitionEvent({ created_at: 100, name: 'Official Apple' });
    const newerWrongIssuer = makeDefinitionEvent({
      created_at: 900,
      name: 'Impostor Apple',
      pubkey: 'f'.repeat(64),
    });
    const selected = selectNewestValidDefinitions([[newerWrongIssuer, olderValid]]);
    expect(selected.get(appleAddress)!.name).toBe('Official Apple');
  });

  it('an invalid issuer never enters the fetched map', () => {
    const wrongIssuer = makeDefinitionEvent({ pubkey: 'a'.repeat(64) });
    const selected = selectNewestValidDefinitions([[wrongIssuer]]);
    expect(selected.size).toBe(0);
  });

  it('selects independently per address across relay batches', () => {
    const apple = makeDefinitionEvent({ d: 'blobbi:food:apple', name: 'Apple', created_at: 10 });
    const pizza = makeDefinitionEvent({ d: 'blobbi:food:pizza', name: 'Pizza', created_at: 20 });
    const selected = selectNewestValidDefinitions([[apple], [pizza]]);
    expect(selected.get(itemIdToAddress('food_apple')!)!.name).toBe('Apple');
    expect(selected.get(itemIdToAddress('food_pizza')!)!.name).toBe('Pizza');
  });
});
