/**
 * The Item Studio's activation diagnostics.
 *
 * What is being protected here is not the pixels — it is the CLAIM the panel
 * makes. "Wearable" is a statement about this repository's trusted identity
 * registry AND about what the definition itself declares, and it must be false
 * for a third party's event even when that event carries the exact `d` the
 * registry names. The rest of the findings are work-remaining, and they must
 * not overstate progress either.
 *
 * Since the kind:31634 migration there is no legacy code mapping: a cosmetic is
 * wearable because its own `content.visual.slot` says where it goes.
 */

import { describe, it, expect } from 'vitest';

import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';
import {
  type ActivationSubject,
  activationStatus,
  activationSubject,
  registrySnippet,
  readVisualSlot,
} from './activation-status';

const D = 'blobbi:cosmetic:block-builder-cap';
const PRIMARY = 'https://blossom.invalid/cap.webp';
const BACK = 'https://blossom.invalid/cap-back.webp';
const STRANGER = 'd'.repeat(64);

function subject(over: Partial<ActivationSubject> = {}): ActivationSubject {
  return {
    address: `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:${D}`,
    issuer: OFFICIAL_ITEM_ISSUER_PUBKEY,
    d: D,
    type: 'cosmetic',
    image: PRIMARY,
    images: [
      { url: PRIMARY },
      { url: PRIMARY, marker: 'front' },
      { url: BACK, marker: 'back' },
    ],
    visualSlot: 'headwear',
    ...over,
  };
}

const labels = (s: ReturnType<typeof activationStatus>) =>
  s.findings.map((f) => f.label);

describe('applicability', () => {
  it('says nothing about a consumable', () => {
    const status = activationStatus(
      subject({ d: 'blobbi:food:apple', type: 'consumable', visualSlot: undefined }),
    );
    expect(status.applicable).toBe(false);
    expect(status.findings).toEqual([]);
  });

  it('applies to anything typed cosmetic', () => {
    expect(activationStatus(subject()).applicable).toBe(true);
  });
});

describe('the Block Builder Cap, as published', () => {
  it('reports it wearable once owned', () => {
    const status = activationStatus(subject());
    expect(status.isOfficialIssuer).toBe(true);
    expect(status.isRegistered).toBe(true);
    expect(status.declaredSlot).toBe('headwear');
    expect(status.wearable).toBe(true);
    expect(labels(status)).toContain('Registered official cosmetic');
    expect(labels(status)).toContain('Declares a supported slot');
    expect(labels(status)).toContain('Wearable once owned');
  });

  it('reports no outstanding artwork work', () => {
    const status = activationStatus(subject());
    expect(labels(status)).not.toContain('No front view');
    expect(labels(status)).not.toContain('No back view');
    expect(labels(status)).not.toContain('Missing primary image');
  });

  it('needs no registry edit, because it is already registered', () => {
    // The snippet is still derivable, but the panel only shows it when the item
    // is NOT wearable — asserted here so the two never drift apart.
    expect(activationStatus(subject()).wearable).toBe(true);
  });
});

describe('trust', () => {
  it('is NOT wearable when the same d is published by a third party', () => {
    // The registry resolves the official address; a stranger's event lives at a
    // different address and can never be what the renderer draws.
    const status = activationStatus(
      subject({
        issuer: STRANGER,
        address: `31632:${STRANGER}:${D}`,
      }),
    );

    expect(status.isOfficialIssuer).toBe(false);
    expect(status.isRegistered).toBe(false);
    expect(status.wearable).toBe(false);
    expect(labels(status)).toContain('Not the official issuer');
    expect(labels(status)).toContain('Not registered as an official cosmetic');
  });
});

describe('an unregistered cosmetic', () => {
  const unregistered = () =>
    subject({
      d: 'blobbi:cosmetic:sun-visor',
      address: `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:blobbi:cosmetic:sun-visor`,
    });

  it('is reported as unregistered and not wearable', () => {
    const status = activationStatus(unregistered());
    expect(status.isRegistered).toBe(false);
    expect(status.wearable).toBe(false);
    expect(labels(status)).toContain('Not registered as an official cosmetic');
  });

  it('still reports the slot it declares', () => {
    // Registration and declaration are independent facts, and conflating them
    // would hide half the remaining work from whoever is publishing.
    expect(activationStatus(unregistered()).declaredSlot).toBe('headwear');
  });

  it('produces a pasteable registry entry with no legacy code in it', () => {
    const snippet = registrySnippet(unregistered());
    expect(snippet).toContain("d: 'blobbi:cosmetic:sun-visor'");
    expect(snippet).toContain(`primaryImage: '${PRIMARY}'`);
    expect(snippet).not.toContain('legacyCode');
  });
});

describe('the declared slot is the activation switch', () => {
  it('is not wearable with no declared slot, and says why', () => {
    const status = activationStatus(subject({ visualSlot: undefined }));
    expect(status.declaredSlot).toBeNull();
    expect(status.wearable).toBe(false);
    expect(labels(status)).toContain('No content.visual.slot');
  });

  it('is not wearable with a slot this renderer does not support', () => {
    const status = activationStatus(subject({ visualSlot: 'tail' }));
    expect(status.declaredSlot).toBeNull();
    expect(status.wearable).toBe(false);
    expect(labels(status)).toContain('Declares an unsupported slot');
  });

  it('accepts any supported slot, without consulting the item id', () => {
    // `blobbi:cosmetic:block-builder-cap` reads like headwear; the definition
    // says eyewear, and the definition wins. Nothing infers from the id.
    const status = activationStatus(subject({ visualSlot: 'eyewear' }));
    expect(status.declaredSlot).toBe('eyewear');
    expect(status.wearable).toBe(true);
  });
});

describe('missing artwork', () => {
  it('reports a missing primary, front and back', () => {
    const status = activationStatus(subject({ images: [], image: undefined }));
    expect(labels(status)).toContain('Missing primary image');
    expect(labels(status)).toContain('No front view');
    expect(labels(status)).toContain('No back view');
  });

  it('reports only the back as missing when a front exists', () => {
    const status = activationStatus(
      subject({ images: [{ url: PRIMARY }, { url: PRIMARY, marker: 'front' }] }),
    );
    expect(labels(status)).not.toContain('No front view');
    expect(labels(status)).toContain('No back view');
  });
});

describe('reading the definition', () => {
  it('extracts visual.slot from content JSON', () => {
    expect(readVisualSlot({ visual: { slot: 'headwear' } })).toBe('headwear');
  });

  it('tolerates absent, malformed and empty content', () => {
    expect(readVisualSlot(undefined)).toBeUndefined();
    expect(readVisualSlot('not an object')).toBeUndefined();
    expect(readVisualSlot({})).toBeUndefined();
    expect(readVisualSlot({ visual: null })).toBeUndefined();
    expect(readVisualSlot({ visual: { slot: '  ' } })).toBeUndefined();
  });

  it('projects a parsed definition onto a subject', () => {
    const s = activationSubject({
      address: `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:${D}`,
      issuer: OFFICIAL_ITEM_ISSUER_PUBKEY,
      id: D,
      type: 'cosmetic',
      image: PRIMARY,
      images: [{ url: PRIMARY }],
      contentJson: { visual: { slot: 'headwear' } },
    });

    expect(s.d).toBe(D);
    expect(s.visualSlot).toBe('headwear');
    expect(activationStatus(s).wearable).toBe(true);
  });
});
