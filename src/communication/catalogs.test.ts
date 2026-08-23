/**
 * Properties every catalog must have, checked once rather than reviewed each
 * time someone adds a phrase.
 *
 * Three of these are load-bearing rather than tidy:
 *
 *  - **ids are language-independent**, so translating the island never changes
 *    what travels on the wire and never invalidates a published event;
 *  - **ids are stable-shaped**, so a typo cannot become a protocol id;
 *  - **every template hole names a declared parameter**, because a segment
 *    referring to a parameter that does not exist renders as `null` and would
 *    silently make a whole template unsendable.
 */
import { describe, expect, it } from 'vitest';

import { EMOTES } from './emotes';
import { QUICK_PHRASES } from './quick-phrases';
import {
  ACTIVITY_VALUES,
  DESTINATION_VALUES,
  PHRASE_TEMPLATES,
  TIME_VALUES,
  templateParamValues,
} from './templates';
import { renderTemplateText } from './render';

/** Lowercase, digits and single hyphens. A shape a display string cannot have. */
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const ALL_IDS = [
  ...QUICK_PHRASES.map((p) => ['quick phrase', p.id] as const),
  ...EMOTES.map((e) => ['emote', e.id] as const),
  ...PHRASE_TEMPLATES.map((t) => ['template', t.id] as const),
  ...DESTINATION_VALUES.map((v) => ['destination', v.id] as const),
  ...TIME_VALUES.map((v) => ['time', v.id] as const),
  ...ACTIVITY_VALUES.map((v) => ['activity', v.id] as const),
];

describe('protocol ids', () => {
  it.each(ALL_IDS)('%s "%s" is a machine id, not a display string', (_kind, id) => {
    expect(id).toMatch(ID_PATTERN);
  });

  it('never uses the display text as the id', () => {
    for (const phrase of QUICK_PHRASES) expect(phrase.id).not.toBe(phrase.text);
    for (const emote of EMOTES) {
      expect(emote.id).not.toBe(emote.glyph);
      expect(emote.id).not.toBe(emote.label);
    }
  });

  it('is unique within each catalog', () => {
    const check = (label: string, ids: readonly string[]) =>
      expect(new Set(ids).size, `${label} has a duplicate id`).toBe(ids.length);

    check('quick phrases', QUICK_PHRASES.map((p) => p.id));
    check('emotes', EMOTES.map((e) => e.id));
    check('templates', PHRASE_TEMPLATES.map((t) => t.id));
    check('destinations', DESTINATION_VALUES.map((v) => v.id));
    check('times', TIME_VALUES.map((v) => v.id));
    check('activities', ACTIVITY_VALUES.map((v) => v.id));
  });
});

describe('catalogs stay small enough to read', () => {
  it('offers a scannable number of quick phrases and emotes', () => {
    // A grid a child has to scroll is a grid a child does not read. If these
    // ever need raising, that is a product decision worth making deliberately.
    expect(QUICK_PHRASES.length).toBeLessThanOrEqual(12);
    expect(EMOTES.length).toBeLessThanOrEqual(10);
    expect(PHRASE_TEMPLATES.length).toBeLessThanOrEqual(8);
  });

  it('is frozen, so no consumer can extend a catalog at runtime', () => {
    for (const catalog of [QUICK_PHRASES, EMOTES, PHRASE_TEMPLATES, DESTINATION_VALUES]) {
      expect(Object.isFrozen(catalog)).toBe(true);
    }
  });
});

describe('emotes', () => {
  it('gives every emote an accessible label', () => {
    // An emote-only control is unusable with a screen reader without one, and a
    // bubble showing a bare glyph is unreadable for the same reason.
    for (const emote of EMOTES) {
      expect(emote.label.trim().length).toBeGreaterThan(0);
      expect(emote.glyph.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('templates', () => {
  it('declares a hole for every parameter and a parameter for every hole', () => {
    for (const template of PHRASE_TEMPLATES) {
      const declared = new Set(template.params.map((param) => param.name));
      const used = new Set(
        template.segments.flatMap((segment) => (typeof segment === 'string' ? [] : [segment.param])),
      );
      expect([...used].sort(), `${template.id} uses an undeclared parameter`).toEqual(
        [...declared].sort(),
      );
    }
  });

  it('draws every parameter from a non-empty catalog', () => {
    for (const template of PHRASE_TEMPLATES) {
      for (const param of template.params) {
        expect(templateParamValues(param.catalog).length).toBeGreaterThan(0);
      }
    }
  });

  it('renders a complete sentence for every combination of allowed values', () => {
    // Exhaustive rather than sampled: the catalogs are small, and a template
    // that renders `null` for one combination is a template a player can select
    // and then be unable to send.
    for (const template of PHRASE_TEMPLATES) {
      const combinations = template.params.reduce<Record<string, string>[]>(
        (acc, param) =>
          acc.flatMap((partial) =>
            templateParamValues(param.catalog).map((value) => ({
              ...partial,
              [param.name]: value.id,
            })),
          ),
        [{}],
      );

      for (const params of combinations) {
        const text = renderTemplateText(template, params);
        expect(text, `${template.id} with ${JSON.stringify(params)}`).toBeTruthy();
        expect(text).not.toContain('undefined');
        expect(text).not.toContain('null');
      }
    }
  });

  it('names only public destinations a player can actually be met at', () => {
    // No interiors, no arcade floors, no dev rooms, and not Home - which is
    // private, so "meet me at Home" is a sentence with no true reading.
    expect(DESTINATION_VALUES.map((value) => value.location).sort()).toEqual(
      ['arcade', 'beach', 'mine', 'nostr-station', 'plaza', 'town'].sort(),
    );
  });

  it('never lets a phrase carry transient private state', () => {
    // A phrase names a place at the granularity the map already shows publicly.
    // It cannot express a coordinate, a seat, a hiding spot or a session.
    const forbidden = ['seat', 'hidden', 'anchor', 'session', 'coordinate', 'x', 'y'];
    const catalogNames = PHRASE_TEMPLATES.flatMap((t) => t.params.map((p) => p.catalog));
    for (const name of catalogNames) {
      expect(forbidden).not.toContain(name);
    }
  });
});
