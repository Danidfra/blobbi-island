/**
 * Blobbi Island — placement identity, policy and render-model tests.
 *
 * These are the PURE halves of the equipment system: what a placement document
 * is called, whether an entry is allowed to render, and how an allowed entry
 * becomes renderer input. The relay/hook halves are covered in
 * `useEquipmentMutation.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  KIND_GAME_ITEM_PLACEMENT,
  buildGameItemPlacementEvent,
  parseGameItemPlacementResult,
  parseGameItemPlacementAddress,
  type GameItemPlacementEntry,
} from '@/inventory/package';
import { ADDRESSED_OFFICIAL_COSMETICS } from '@/protocol/event-registry';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';

import {
  characterEquipmentAlt,
  characterEquipmentPlacementAddress,
  characterEquipmentPlacementD,
  placementTargetForCharacter,
} from './identity';
import {
  decidePlacementEntry,
  definitionForms,
  definitionSlot,
  formIsCompatible,
  isEquippableSlot,
  mayModifyCharacter,
  selectRenderablePlacements,
  type PlacementPolicyContext,
} from './policy';
import {
  buildEquipEntry,
  referenceIsRenderable,
  toAccessoryPlacementInput,
  ISLAND_PLACEMENT_REFERENCE,
  PLACEMENT_RENDER_DEFAULTS,
} from './render-model';
import { buildEmptyPlacement } from './usePlacementState';

const OWNER = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);
const CHARACTER = 'blobbi-abc123';

/** The one official cosmetic that actually exists today. */
const CAP = ADDRESSED_OFFICIAL_COSMETICS[0]!;
const CAP_ADDRESS = CAP.address;
const UNOFFICIAL = `31632:${STRANGER}:blobbi:cosmetic:fake_hat`;

function definition(
  overrides: Partial<ResolvedBlobbiItemDefinition> = {},
): ResolvedBlobbiItemDefinition {
  return {
    address: CAP_ADDRESS,
    itemId: CAP.legacyCode,
    d: CAP.d,
    name: CAP.name,
    type: 'cosmetic',
    category: 'unknown',
    effects: {},
    action: null,
    stages: [],
    emoji: CAP.symbol,
    image: 'https://fixtures.invalid/cap.png',
    images: [{ url: 'https://fixtures.invalid/cap.png' }],
    topics: [],
    slot: 'headwear',
    forms: null,
    source: 'definition',
    ...overrides,
  };
}

function context(
  overrides: Partial<PlacementPolicyContext> = {},
): PlacementPolicyContext {
  return {
    authorPubkey: OWNER,
    ownerPubkey: OWNER,
    quantityByAddress: new Map([[CAP_ADDRESS, 1]]),
    definitionsByAddress: new Map([[CAP_ADDRESS, definition()]]),
    ...overrides,
  };
}

const equipCap: GameItemPlacementEntry = {
  id: 'headwear',
  item: CAP_ADDRESS,
  mode: 'equip',
  slot: 'headwear',
};

describe('placement identity', () => {
  it('derives a stable, colon-containing placement d', () => {
    expect(characterEquipmentPlacementD(CHARACTER)).toBe(
      'blobbi-island:character:blobbi-abc123:equipment',
    );
  });

  it('round-trips through the package address helpers', () => {
    const address = characterEquipmentPlacementAddress(OWNER, CHARACTER);
    const parsed = parseGameItemPlacementAddress(address);
    expect(parsed).toEqual({
      kind: KIND_GAME_ITEM_PLACEMENT,
      pubkey: OWNER,
      placementId: 'blobbi-island:character:blobbi-abc123:equipment',
    });
  });

  it('rejects a blank character id rather than inventing one', () => {
    expect(() => characterEquipmentPlacementD('')).toThrow();
    expect(() => characterEquipmentPlacementD('   ')).toThrow();
  });

  it('keeps the placement d and the target distinct', () => {
    const target = placementTargetForCharacter(OWNER, CHARACTER);
    expect(target).toEqual({
      type: 'address',
      address: `31124:${OWNER}:${CHARACTER}`,
    });
    // The document id is NOT the target address.
    expect(characterEquipmentPlacementD(CHARACTER)).not.toBe(target.address);
  });

  it('builds an alt with and without a character name', () => {
    expect(characterEquipmentAlt('Blobby')).toBe(
      "Game item placement: Blobby's equipment",
    );
    expect(characterEquipmentAlt('  ')).toBe(
      'Game item placement: Blobbi equipment',
    );
  });
});

describe('empty placement state', () => {
  it('is a valid, parseable, empty document targeting the character', () => {
    const placement = buildEmptyPlacement(OWNER, CHARACTER);
    expect(placement.placements).toEqual([]);
    expect(placement.itemAddresses).toEqual([]);
    expect(placement.target).toEqual({
      type: 'address',
      address: `31124:${OWNER}:${CHARACTER}`,
    });
    expect(placement.id).toBe(characterEquipmentPlacementD(CHARACTER));
  });
});

describe('authorization policy', () => {
  it('allows only the owner to modify a character', () => {
    expect(mayModifyCharacter(OWNER, OWNER)).toBe(true);
    expect(mayModifyCharacter(STRANGER, OWNER)).toBe(false);
    expect(mayModifyCharacter('', '')).toBe(false);
  });

  it('accepts a fully valid equipped cosmetic', () => {
    expect(decidePlacementEntry(equipCap, context())).toEqual({ allowed: true });
  });

  it('refuses a placement signed by somebody who does not own the Blobbi', () => {
    expect(
      decidePlacementEntry(equipCap, context({ authorPubkey: STRANGER })),
    ).toEqual({ allowed: false, reason: 'unauthorized-author' });
  });

  it('refuses an item that is not in the inventory', () => {
    expect(
      decidePlacementEntry(equipCap, context({ quantityByAddress: new Map() })),
    ).toEqual({ allowed: false, reason: 'not-owned' });
  });

  it('refuses an item held at quantity zero', () => {
    expect(
      decidePlacementEntry(
        equipCap,
        context({ quantityByAddress: new Map([[CAP_ADDRESS, 0]]) }),
      ),
    ).toEqual({ allowed: false, reason: 'not-owned' });
  });

  it('refuses a cosmetic from an untrusted issuer', () => {
    const entry = { ...equipCap, item: UNOFFICIAL };
    expect(decidePlacementEntry(entry, context())).toEqual({
      allowed: false,
      reason: 'untrusted-issuer',
    });
  });

  it('refuses an official address whose definition has not resolved', () => {
    expect(
      decidePlacementEntry(
        equipCap,
        context({ definitionsByAddress: new Map() }),
      ),
    ).toEqual({ allowed: false, reason: 'unknown-definition' });
  });

  it('refuses a non-equip mode', () => {
    expect(
      decidePlacementEntry({ ...equipCap, mode: 'place' }, context()),
    ).toEqual({ allowed: false, reason: 'unsupported-mode' });
  });

  it('refuses an unknown slot', () => {
    expect(
      decidePlacementEntry({ ...equipCap, slot: 'third-antenna' }, context()),
    ).toEqual({ allowed: false, reason: 'unsupported-slot' });
    expect(isEquippableSlot('third-antenna')).toBe(false);
    expect(isEquippableSlot('headwear')).toBe(true);
    expect(isEquippableSlot(undefined)).toBe(false);
  });

  it('refuses a slot the issuer did not declare for the item', () => {
    expect(
      decidePlacementEntry(
        { ...equipCap, id: 'eyewear', slot: 'eyewear' },
        context(),
      ),
    ).toEqual({ allowed: false, reason: 'slot-mismatch' });
  });

  it('refuses an item whose definition declares no slot at all', () => {
    expect(
      decidePlacementEntry(
        equipCap,
        context({
          definitionsByAddress: new Map([[CAP_ADDRESS, definition({ slot: null })]]),
        }),
      ),
    ).toEqual({ allowed: false, reason: 'slot-mismatch' });
  });

  it('treats declared forms as a restriction and silence as none', () => {
    const babyOnly = definition({ forms: ['baby'] });
    expect(formIsCompatible(babyOnly, 'baby')).toBe(true);
    expect(formIsCompatible(babyOnly, 'adult')).toBe(false);
    expect(formIsCompatible(definition(), 'adult')).toBe(true);
    expect(definitionForms(definition())).toBeNull();
    expect(definitionForms(babyOnly)).toEqual(['baby']);
    expect(definitionSlot(definition())).toBe('headwear');
    expect(definitionSlot(definition({ slot: 'nonsense' }))).toBeNull();
  });

  it('refuses an item that does not fit the current form', () => {
    expect(
      decidePlacementEntry(
        equipCap,
        context({
          form: 'adult',
          definitionsByAddress: new Map([
            [CAP_ADDRESS, definition({ forms: ['baby'] })],
          ]),
        }),
      ),
    ).toEqual({ allowed: false, reason: 'incompatible-form' });
  });

  it('resolves a duplicate equipped slot deterministically, last wins', () => {
    const first = { ...equipCap, id: 'headwear' };
    const second = { ...equipCap, id: 'headwear-2' };
    const renderable = selectRenderablePlacements([first, second], context());
    expect(renderable).toHaveLength(1);
    expect(renderable[0]!.entry.id).toBe('headwear-2');
  });

  it('does not consume or alter any inventory quantity', () => {
    const quantities = new Map([[CAP_ADDRESS, 3]]);
    selectRenderablePlacements([equipCap], context({ quantityByAddress: quantities }));
    expect(quantities.get(CAP_ADDRESS)).toBe(3);
  });
});

describe('render model', () => {
  it('supplies Island defaults for an entry with no transform', () => {
    const result = toAccessoryPlacementInput(equipCap, 'headwear', undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toEqual({
      code: CAP_ADDRESS,
      slot: 'headwear',
      x: PLACEMENT_RENDER_DEFAULTS.x,
      y: PLACEMENT_RENDER_DEFAULTS.y,
      scale: PLACEMENT_RENDER_DEFAULTS.scale,
      rot: PLACEMENT_RENDER_DEFAULTS.rot,
      flipX: false,
    });
  });

  it('passes the item ADDRESS as the renderer code', () => {
    const result = toAccessoryPlacementInput(equipCap, 'headwear', undefined);
    expect(result.ok && result.input.code).toBe(CAP_ADDRESS);
  });

  it('translates a full 2D transform', () => {
    const entry: GameItemPlacementEntry = {
      ...equipCap,
      position: { x: 42, y: 17 },
      rotation: { type: 'euler', unit: 'degrees', z: -12 },
      scale: { x: 1.4, y: 1.4 },
      flip: { x: true, y: false },
    };
    const result = toAccessoryPlacementInput(
      entry,
      'headwear',
      ISLAND_PLACEMENT_REFERENCE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toMatchObject({
      x: 42,
      y: 17,
      rot: -12,
      scale: 1.4,
      flipX: true,
    });
  });

  it('accepts an absent reference and refuses a non-percent one', () => {
    expect(referenceIsRenderable(undefined)).toBe(true);
    expect(referenceIsRenderable(ISLAND_PLACEMENT_REFERENCE)).toBe(true);
    expect(
      referenceIsRenderable({
        space: '3d',
        unit: 'meters',
        origin: 'center',
      }),
    ).toBe(false);
    expect(
      referenceIsRenderable({
        space: '2d',
        unit: 'normalized',
        origin: 'center',
        width: 1,
        height: 1,
      }),
    ).toBe(false);
  });

  it('refuses transforms this 2D renderer cannot represent', () => {
    expect(
      toAccessoryPlacementInput(equipCap, 'headwear', {
        space: '3d',
        unit: 'meters',
        origin: 'center',
      }),
    ).toEqual({ ok: false, reason: 'unsupported-reference' });

    expect(
      toAccessoryPlacementInput(
        { ...equipCap, position: { x: 1, y: 2, z: 3 } },
        'headwear',
        undefined,
      ),
    ).toEqual({ ok: false, reason: 'three-dimensional-position' });

    expect(
      toAccessoryPlacementInput(
        {
          ...equipCap,
          rotation: { type: 'quaternion', x: 0, y: 0.7071, z: 0, w: 0.7071 },
        },
        'headwear',
        undefined,
      ),
    ).toEqual({ ok: false, reason: 'unsupported-rotation' });

    expect(
      toAccessoryPlacementInput(
        { ...equipCap, rotation: { type: 'euler', unit: 'radians', z: 1 } },
        'headwear',
        undefined,
      ),
    ).toEqual({ ok: false, reason: 'unsupported-rotation' });
  });
});

describe('buildEquipEntry', () => {
  it('uses the slot as the entry id and writes nothing it was not given', () => {
    const entry = buildEquipEntry({
      itemAddress: CAP_ADDRESS,
      slot: 'headwear',
    });
    expect(entry).toEqual({
      id: 'headwear',
      item: CAP_ADDRESS,
      mode: 'equip',
      slot: 'headwear',
    });
  });

  it('omits transform fields that equal the Island defaults', () => {
    const entry = buildEquipEntry({
      itemAddress: CAP_ADDRESS,
      slot: 'headwear',
      rot: 0,
      scale: 1,
      flipX: false,
    });
    expect(entry.rotation).toBeUndefined();
    expect(entry.scale).toBeUndefined();
    expect(entry.flip).toBeUndefined();
  });

  it('writes only the fields the player actually customized', () => {
    const entry = buildEquipEntry({
      itemAddress: CAP_ADDRESS,
      slot: 'headwear',
      x: 60,
      y: 30,
      rot: 15,
      scale: 1.25,
      flipX: true,
      form: 'baby',
      view: 'front',
    });
    expect(entry.position).toEqual({ x: 60, y: 30 });
    expect(entry.rotation).toEqual({ type: 'euler', unit: 'degrees', z: 15 });
    expect(entry.scale).toEqual({ x: 1.25, y: 1.25 });
    expect(entry.flip).toEqual({ x: true, y: false });
    expect(entry.form).toBe('baby');
    expect(entry.view).toBe('front');
  });

  it('produces an entry the package accepts in a real event', () => {
    const template = buildGameItemPlacementEvent({
      id: characterEquipmentPlacementD(CHARACTER),
      target: placementTargetForCharacter(OWNER, CHARACTER),
      reference: ISLAND_PLACEMENT_REFERENCE,
      placements: [
        buildEquipEntry({
          itemAddress: CAP_ADDRESS,
          slot: 'headwear',
          x: 50,
          y: 20,
        }),
      ],
    });
    const event: NostrEvent = {
      id: 'evt',
      pubkey: OWNER,
      created_at: 1,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: 'sig',
    };
    const result = parseGameItemPlacementResult(event, { mode: 'strict' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A canonical document produces no warnings at all.
    expect(result.warnings).toEqual([]);
    expect(result.value.itemAddresses).toEqual([CAP_ADDRESS]);
    expect(event.tags).toContainEqual(['a', CAP_ADDRESS, '', 'item']);
  });
});
