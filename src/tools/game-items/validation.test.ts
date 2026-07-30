/**
 * The layering rule, asserted: only the blocking layer may stop a publication.
 *
 * Most of these cases exist to prove a NEGATIVE — that a missing primary image,
 * an unknown marker, an odd canvas size or an absent `alt` produce a warning
 * and leave `isPublishable` true. It is easy to write a validator that is
 * quietly stricter than the protocol, and those are the assertions that catch
 * it.
 */

import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { KIND_GAME_ITEM_DEFINITION } from '@/inventory/package';

import { formToUnsignedEvent, toPreviewEvent } from './form-event-conversion';
import {
  PRIMARY_MARKER,
  blankItemForm,
  nextRowId,
  type ItemFormState,
} from './item-form-model';
import { type ImageProbe, validateItemForm } from './validation';

const PUBKEY = 'a'.repeat(64);

function imageRow(url: string, marker = PRIMARY_MARKER) {
  return { id: nextRowId('image'), url, marker };
}

function baseForm(patch: Partial<ItemFormState> = {}): ItemFormState {
  return {
    ...blankItemForm(),
    d: 'blobbi:accessory:hat',
    name: 'Hat',
    type: 'cosmetic',
    ...patch,
  };
}

function validate(form: ItemFormState, probes = new Map<string, ImageProbe>()) {
  const build = formToUnsignedEvent(form);
  const previewEvent: NostrEvent | null = build.ok
    ? toPreviewEvent(build.value, PUBKEY, 1_700_000_000)
    : null;
  return validateItemForm({
    form,
    previewEvent,
    buildError: build.ok ? null : build.error,
    probes,
  });
}

function codes(issues: { code: string }[]) {
  return issues.map((issue) => issue.code);
}

describe('blocking layer', () => {
  it('blocks on a missing d, name and type, and attaches each to its field', () => {
    const result = validate(blankItemForm());
    expect(result.isPublishable).toBe(false);
    expect(codes(result.blocking)).toEqual(
      expect.arrayContaining(['empty-d', 'empty-name', 'empty-type']),
    );
    expect(result.fieldErrors.d).toBeDefined();
    expect(result.fieldErrors.name).toBeDefined();
    expect(result.fieldErrors.type).toBeDefined();
  });

  it('blocks on a non-positive-integer max_stack', () => {
    for (const value of ['0', '-1', '1.5', 'ten']) {
      const result = validate(baseForm({ maxStack: value }));
      expect(result.isPublishable, `max_stack ${value}`).toBe(false);
      expect(codes(result.blocking)).toContain('invalid-max-stack');
    }
  });

  it('accepts a valid max_stack', () => {
    expect(validate(baseForm({ maxStack: '10' })).isPublishable).toBe(true);
  });

  it('blocks on a malformed based_on address', () => {
    const result = validate(
      baseForm({
        basedOn: [{ id: nextRowId('based-on'), address: 'not-an-address', relay: '' }],
      }),
    );
    expect(result.isPublishable).toBe(false);
    expect(codes(result.blocking)).toContain('malformed-based-on');
  });

  it('blocks on invalid JSON content', () => {
    const result = validate(
      baseForm({
        content: { ...blankItemForm().content, mode: 'json', raw: '{ broken' },
      }),
    );
    expect(result.isPublishable).toBe(false);
  });

  it('blocks on two different unmarked images, which the builder cannot serialize', () => {
    const result = validate(
      baseForm({ images: [imageRow('https://a/1.png'), imageRow('https://a/2.png')] }),
    );
    expect(result.isPublishable).toBe(false);
    expect(codes(result.blocking)).toContain('build-failed');
  });

  it('does not double-report required fields from the package validator', () => {
    const result = validate(blankItemForm());
    expect(codes(result.blocking).filter((code) => code === 'empty-d')).toHaveLength(1);
  });

  it('suppresses the raw builder message when a field error already explains it', () => {
    // An empty form fails three required-field checks AND makes the builder
    // throw. Reporting both would say four things about three empty fields.
    const result = validate(blankItemForm());
    expect(codes(result.blocking)).toEqual(['empty-d', 'empty-name', 'empty-type']);
  });

  it('still surfaces the builder message when nothing else explains the failure', () => {
    const result = validate(
      baseForm({ images: [imageRow('https://a/1.png'), imageRow('https://a/2.png')] }),
    );
    expect(codes(result.blocking)).toEqual(['build-failed']);
  });
});

describe('image layer never blocks', () => {
  it('warns but publishes when there is no primary image', () => {
    const result = validate(
      baseForm({ images: [imageRow('https://a/front.png', 'front')] }),
    );
    expect(result.isPublishable).toBe(true);
    expect(codes(result.image)).toContain('missing-primary-image');
  });

  it('warns but publishes on an unknown marker', () => {
    const result = validate(
      baseForm({
        images: [imageRow('https://a/p.png'), imageRow('https://a/t.png', 'top-down')],
      }),
    );
    expect(result.isPublishable).toBe(true);
    expect(codes(result.image)).toContain('unknown-marker');
  });

  it('warns but publishes on a duplicate marker', () => {
    const result = validate(
      baseForm({
        images: [
          imageRow('https://a/f1.png', 'front'),
          imageRow('https://a/f2.png', 'front'),
        ],
      }),
    );
    expect(result.isPublishable).toBe(true);
    expect(codes(result.image)).toContain('duplicate-marker');
  });

  it('warns but publishes on a duplicate URL', () => {
    const result = validate(
      baseForm({
        images: [
          imageRow('https://a/same.png'),
          imageRow('https://a/same.png', 'front'),
        ],
      }),
    );
    expect(result.isPublishable).toBe(true);
    expect(codes(result.image)).toContain('duplicate-image-url');
  });

  it('warns about an empty image row without blocking', () => {
    const result = validate(
      baseForm({ images: [imageRow(''), imageRow('https://a/p.png')] }),
    );
    expect(result.isPublishable).toBe(true);
    expect(codes(result.image)).toContain('empty-image-url');
  });

  it('warns when the same unmarked URL is listed twice, and still publishes', () => {
    const result = validate(
      baseForm({ images: [imageRow('https://a/p.png'), imageRow('https://a/p.png')] }),
    );
    expect(result.isPublishable).toBe(true);
    expect(codes(result.image)).toContain('multiple-primary-images');
  });

  it('reports a failed browser load as a warning', () => {
    const probes = new Map<string, ImageProbe>([
      ['https://a/p.png', { status: 'error' }],
    ]);
    const result = validate(baseForm({ images: [imageRow('https://a/p.png')] }), probes);
    expect(result.isPublishable).toBe(true);
    expect(codes(result.image)).toContain('image-load-failed');
  });

  it('warns about dimensions that differ from the house convention', () => {
    const probes = new Map<string, ImageProbe>([
      ['https://a/p.png', { status: 'loaded', width: 512, height: 512 }],
    ]);
    const result = validate(baseForm({ images: [imageRow('https://a/p.png')] }), probes);
    expect(result.isPublishable).toBe(true);
    expect(codes(result.image)).toContain('unexpected-dimensions');
  });

  it('stays silent when the artwork matches the recommended size', () => {
    const probes = new Map<string, ImageProbe>([
      ['https://a/p.png', { status: 'loaded', width: 1024, height: 1024 }],
    ]);
    const result = validate(baseForm({ images: [imageRow('https://a/p.png')] }), probes);
    expect(codes(result.image)).not.toContain('unexpected-dimensions');
  });

  it('warns when views disagree about the canvas size', () => {
    const probes = new Map<string, ImageProbe>([
      ['https://a/p.png', { status: 'loaded', width: 1024, height: 1024 }],
      ['https://a/f.png', { status: 'loaded', width: 512, height: 512 }],
    ]);
    const result = validate(
      baseForm({
        images: [imageRow('https://a/p.png'), imageRow('https://a/f.png', 'front')],
      }),
      probes,
    );
    expect(result.isPublishable).toBe(true);
    expect(codes(result.image)).toContain('inconsistent-canvas');
  });

  it('notes an item with no artwork at all', () => {
    expect(codes(validate(baseForm()).image)).toContain('no-images');
  });
});

describe('authoring suggestions never block', () => {
  it('suggests an alt tag', () => {
    const result = validate(baseForm());
    expect(result.isPublishable).toBe(true);
    expect(codes(result.authoring)).toContain('missing-alt');
  });

  it('suggests a context tag', () => {
    expect(codes(validate(baseForm()).authoring)).toContain('no-context');
  });

  it('suggests the equipable topic for a cosmetic item', () => {
    expect(codes(validate(baseForm()).authoring)).toContain('cosmetic-not-equipable');
    expect(
      codes(validate(baseForm({ topics: ['equipable'] })).authoring),
    ).not.toContain('cosmetic-not-equipable');
  });

  it('questions a stacked cosmetic', () => {
    const result = validate(baseForm({ maxStack: '99' }));
    expect(result.isPublishable).toBe(true);
    expect(codes(result.authoring)).toContain('cosmetic-stacked');
  });

  it('does not question max_stack on a consumable', () => {
    expect(
      codes(validate(baseForm({ type: 'consumable', maxStack: '99' })).authoring),
    ).not.toContain('cosmetic-stacked');
  });

  it('nudges toward the recommended d shape', () => {
    expect(codes(validate(baseForm({ d: 'hat' })).authoring)).toContain(
      'unconventional-d',
    );
    expect(
      codes(validate(baseForm({ d: 'blobbi:accessory:hat' })).authoring),
    ).not.toContain('unconventional-d');
  });
});

describe('protocol layer', () => {
  it('surfaces the package parser’s own warnings', () => {
    const result = validate(
      baseForm({ images: [imageRow('https://a/front.png', 'front')] }),
    );
    // The package warns about a definition with only marked views.
    expect(result.protocol.length).toBeGreaterThan(0);
    expect(result.isPublishable).toBe(true);
  });

  it('reports nothing for a clean definition', () => {
    const result = validate(
      baseForm({
        alt: 'A hat',
        contexts: ['game:blobbi'],
        topics: ['equipable'],
        images: [imageRow('https://a/p.png')],
        content: {
          ...blankItemForm().content,
          visual: { slot: 'headwear', forms: [], extra: {} },
        },
      }),
    );
    expect(result.blocking).toEqual([]);
    expect(result.protocol).toEqual([]);
    expect(result.image).toEqual([]);
    expect(result.authoring).toEqual([]);
    expect(result.isPublishable).toBe(true);
  });
});

describe('preview event', () => {
  it('is never signed', () => {
    const build = formToUnsignedEvent(baseForm());
    if (!build.ok) throw new Error('build failed');
    const event = toPreviewEvent(build.value, PUBKEY, 1_700_000_000);
    expect(event.id).toBe('');
    expect(event.sig).toBe('');
    expect(event.kind).toBe(KIND_GAME_ITEM_DEFINITION);
  });
});
