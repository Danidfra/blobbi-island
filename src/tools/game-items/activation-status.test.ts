/**
 * The Item Studio's activation diagnostics.
 *
 * What is being protected here is not the pixels — it is the CLAIM the panel
 * makes. "Active in renderer" is a statement about this repository's trust
 * mapping, and it must be false for a third party's event even when that event
 * carries the exact `d` the mapping names. The rest of the findings are
 * work-remaining, and they must not overstate progress either.
 */

import { describe, it, expect } from 'vitest';

import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';
import {
  type ActivationSubject,
  activationStatus,
  activationSubject,
  mappingSnippet,
  readVisualSlot,
  suggestLegacyCode,
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
  it('reports it active in the renderer', () => {
    const status = activationStatus(subject());
    expect(status.isOfficialIssuer).toBe(true);
    expect(status.mappedCode).toBe('headwear-block-builder-cap');
    expect(status.activeInRenderer).toBe(true);
    expect(labels(status)).toContain('Active in renderer');
  });

  it('reports no outstanding artwork work', () => {
    const status = activationStatus(subject());
    expect(labels(status)).not.toContain('No front view');
    expect(labels(status)).not.toContain('No back view');
    expect(labels(status)).not.toContain('Missing primary image');
  });

  it('offers no registry snippet, because there is nothing to add', () => {
    // The snippet is still derivable, but the panel only shows it when the item
    // is NOT active — asserted here so the two never drift apart.
    const status = activationStatus(subject());
    expect(status.activeInRenderer).toBe(true);
  });
});

describe('trust', () => {
  it('is NOT active when the same d is published by a third party', () => {
    // The mapping resolves the official address; a stranger's event lives at a
    // different address and can never be what the renderer draws.
    const status = activationStatus(
      subject({
        issuer: STRANGER,
        address: `31632:${STRANGER}:${D}`,
      }),
    );

    expect(status.isOfficialIssuer).toBe(false);
    expect(status.activeInRenderer).toBe(false);
    expect(labels(status)).toContain('Not the official issuer');
    expect(labels(status)).toContain('Mapped, but to a different address');
  });
});

describe('an unmapped cosmetic', () => {
  const unmapped = () =>
    subject({
      d: 'blobbi:cosmetic:sun-visor',
      address: `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:blobbi:cosmetic:sun-visor`,
    });

  it('is reported as not mapped and not active', () => {
    const status = activationStatus(unmapped());
    expect(status.mappedCode).toBeNull();
    expect(status.activeInRenderer).toBe(false);
    expect(labels(status)).toContain('Not mapped to a legacy accessory code');
  });

  it('suggests a transitional code from the slot and the d slug', () => {
    expect(suggestLegacyCode(unmapped())).toBe('headwear-sun-visor');
  });

  it('produces a pasteable registry entry, not a bare pair', () => {
    const s = unmapped();
    const snippet = mappingSnippet(s, activationStatus(s))!;
    expect(snippet).toContain("d: 'blobbi:cosmetic:sun-visor'");
    expect(snippet).toContain("legacyCode: 'headwear-sun-visor'");
    expect(snippet).toContain(`primaryImage: '${PRIMARY}'`);
  });

  it('suggests nothing when the definition declares no slot', () => {
    expect(suggestLegacyCode(unmapped2())).toBeNull();
  });

  function unmapped2() {
    return subject({ d: 'blobbi:cosmetic:mystery', visualSlot: undefined });
  }
});

describe('slot agreement', () => {
  it('flags a definition whose visual.slot contradicts the mapped code', () => {
    // The mapped code is `headwear-…`, so a definition claiming `eyewear` means
    // the item would be drawn in the wrong place on the body.
    const status = activationStatus(subject({ visualSlot: 'eyewear' }));
    expect(labels(status)).toContain(
      'Slot mismatch between definition and mapping',
    );
  });

  it('does not flag agreement', () => {
    expect(labels(activationStatus(subject()))).not.toContain(
      'Slot mismatch between definition and mapping',
    );
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
    expect(activationStatus(s).activeInRenderer).toBe(true);
  });
});
