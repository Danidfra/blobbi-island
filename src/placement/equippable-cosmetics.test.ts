/**
 * The production cosmetic catalog: what a player may equip, and why not.
 *
 * These assert the INTERSECTION rule that replaced the hardcoded accessory
 * catalogue: trusted definition ∩ owned ∩ supported slot ∩ compatible form,
 * and the corrected forms policy, where an ABSENT `content.visual.forms` is no
 * restriction and a MALFORMED one is a broken definition.
 *
 * The hook itself is thin; what is worth protecting is the decision table, so
 * these drive the same pure functions the hook composes.
 */
import { describe, it, expect } from 'vitest';

import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';
import { resolveFromDefinition } from '@/inventory/protocol-adapter';
import type { GameItemDefinition } from '@/inventory/package';

import {
  decidePlacementEntry,
  definitionSlot,
  formCompatibility,
  type PlacementPolicyContext,
} from './policy';

const OWNER = 'a'.repeat(64);
const ADDRESS = '31632:issuer:blobbi:cosmetic:hat';

/** A parsed definition whose `content.visual` is exactly what we hand it. */
function withVisual(visual: unknown): ResolvedBlobbiItemDefinition {
  const def = {
    id: 'blobbi:cosmetic:hat',
    address: ADDRESS,
    issuer: 'issuer',
    kind: 31632,
    name: 'Hat',
    type: 'cosmetic',
    images: [],
    contexts: [],
    topics: [],
    basedOn: [],
    content: '',
    contentJson: visual === undefined ? {} : { visual },
    event: {
      pubkey: 'issuer',
      created_at: 0,
      kind: 31632,
      tags: [],
      content: '',
    },
  } as unknown as GameItemDefinition;
  return resolveFromDefinition(def);
}

describe('slot policy: the definition is the only authority', () => {
  it('accepts a declared, supported slot', () => {
    const d = withVisual({ slot: 'headwear' });
    expect(d.slot).toBe('headwear');
    expect(d.visualDiagnostics.slot).toBe('declared');
    expect(definitionSlot(d)).toBe('headwear');
  });

  it('treats a missing slot as not equippable, and says it is missing', () => {
    const d = withVisual({});
    expect(d.slot).toBeNull();
    expect(d.visualDiagnostics.slot).toBe('missing');
    expect(definitionSlot(d)).toBeNull();
  });

  it('treats a malformed slot as not equippable, and says it is malformed', () => {
    for (const slot of ['', '   ', 7, null, {}]) {
      const d = withVisual({ slot });
      expect(d.visualDiagnostics.slot).toBe('malformed');
      expect(definitionSlot(d)).toBeNull();
    }
  });

  it('rejects a declared slot this renderer does not support', () => {
    const d = withVisual({ slot: 'tail' });
    // The issuer said something usable; Island simply cannot draw it.
    expect(d.slot).toBe('tail');
    expect(d.visualDiagnostics.slot).toBe('declared');
    expect(definitionSlot(d)).toBeNull();
  });

  it('never infers a slot from the item id', () => {
    // The `d` reads like headwear; with no declared slot it stays unequippable.
    expect(definitionSlot(withVisual(undefined))).toBeNull();
  });
});

describe('forms policy: absent is not empty', () => {
  it('treats an absent forms field as NO restriction', () => {
    const d = withVisual({ slot: 'headwear' });
    expect(d.forms).toBeNull();
    expect(d.visualDiagnostics.forms).toBe('absent');
    expect(formCompatibility(d, 'baby')).toBe('no-restriction');
    expect(formCompatibility(d, 'adult')).toBe('no-restriction');
  });

  it('restricts to a declared non-empty list', () => {
    const d = withVisual({ slot: 'headwear', forms: ['baby', 'teen'] });
    expect(d.forms).toEqual(['baby', 'teen']);
    expect(d.visualDiagnostics.forms).toBe('declared');
    expect(formCompatibility(d, 'baby')).toBe('compatible');
    expect(formCompatibility(d, 'adult')).toBe('incompatible');
  });

  it('treats a present-but-unusable forms field as MALFORMED, not universal', () => {
    // This is the corrected policy: `[]` is an issuer saying something broken,
    // and guessing "all forms" from it would silently equip an item they
    // deliberately restricted.
    for (const forms of [[], ['', '  '], 'baby', 42, {}, null]) {
      const d = withVisual({ slot: 'headwear', forms });
      expect(d.visualDiagnostics.forms).toBe('malformed');
      expect(formCompatibility(d, 'baby')).toBe('malformed');
    }
  });

  it('does not restrict when the current form is unknown', () => {
    const d = withVisual({ slot: 'headwear', forms: ['baby'] });
    expect(formCompatibility(d, undefined)).toBe('no-restriction');
  });
});

describe('the equip decision refuses a malformed definition outright', () => {
  const entry = {
    id: 'headwear',
    item: ADDRESS,
    mode: 'equip',
    slot: 'headwear',
  };

  function context(
    definition: ResolvedBlobbiItemDefinition,
    over: Partial<PlacementPolicyContext> = {},
  ): PlacementPolicyContext {
    return {
      authorPubkey: OWNER,
      ownerPubkey: OWNER,
      form: 'baby',
      quantityByAddress: new Map([[ADDRESS, 1]]),
      definitionsByAddress: new Map([[ADDRESS, definition]]),
      ...over,
    };
  }

  it('reports malformed-forms distinctly from incompatible-form', () => {
    // Untrusted issuer short-circuits before forms, so this drives the pure
    // form gate directly; `decidePlacementEntry` ordering is covered in
    // placement.test.ts.
    expect(formCompatibility(withVisual({ slot: 'headwear', forms: [] }), 'baby')).toBe(
      'malformed',
    );
    expect(
      formCompatibility(withVisual({ slot: 'headwear', forms: ['adult'] }), 'baby'),
    ).toBe('incompatible');
  });

  it('refuses an unofficial issuer before it ever looks at the definition', () => {
    const decision = decidePlacementEntry(entry, context(withVisual({ slot: 'headwear' })));
    expect(decision).toEqual({ allowed: false, reason: 'untrusted-issuer' });
  });
});
