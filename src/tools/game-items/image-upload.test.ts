/**
 * Filename → marker suggestions.
 *
 * These are SUGGESTIONS shown for review before anything is applied, which is
 * why the ordering rules matter more than the coverage: a file called
 * `hat-diagonal-front-right.png` matching the `front` rule would silently
 * publish a three-quarter view as the front view, and nothing downstream could
 * detect that.
 */

import { describe, expect, it } from 'vitest';

import { PRIMARY_MARKER } from './item-form-model';
import { SUGGESTABLE_MARKERS, suggestMarkerFromFilename } from './image-upload';

describe('suggestMarkerFromFilename', () => {
  it('suggests the primary (unmarked) image when nothing matches', () => {
    expect(suggestMarkerFromFilename('party-hat.png')).toBe(PRIMARY_MARKER);
    expect(suggestMarkerFromFilename('hat.webp')).toBe(PRIMARY_MARKER);
  });

  it('recognizes front and back', () => {
    expect(suggestMarkerFromFilename('hat-front.png')).toBe('front');
    expect(suggestMarkerFromFilename('hat-back.png')).toBe('back');
    expect(suggestMarkerFromFilename('hat_back.webp')).toBe('back');
  });

  it('recognizes the side views', () => {
    expect(suggestMarkerFromFilename('hat-side-right.png')).toBe('side-right');
    expect(suggestMarkerFromFilename('hat-side-left.png')).toBe('side-left');
    expect(suggestMarkerFromFilename('hat-right.png')).toBe('side-right');
    expect(suggestMarkerFromFilename('hat-left.png')).toBe('side-left');
  });

  it('matches diagonal views BEFORE the shorter front/side rules', () => {
    expect(suggestMarkerFromFilename('hat-diagonal-front-right.png')).toBe(
      'diagonal-front-right',
    );
    expect(suggestMarkerFromFilename('hat-diagonal-front-left.png')).toBe(
      'diagonal-front-left',
    );
  });

  it('is case insensitive and ignores the extension', () => {
    expect(suggestMarkerFromFilename('HAT-BACK.PNG')).toBe('back');
    expect(suggestMarkerFromFilename('hat-front.jpeg')).toBe('front');
  });

  it('only ever suggests markers the picker offers', () => {
    const samples = [
      'a.png',
      'a-front.png',
      'a-back.png',
      'a-side-left.png',
      'a-side-right.png',
      'a-diagonal-front-left.png',
      'a-diagonal-front-right.png',
    ];
    for (const sample of samples) {
      expect(SUGGESTABLE_MARKERS).toContain(suggestMarkerFromFilename(sample));
    }
  });

  it('never suggests the literal string "primary"', () => {
    expect(suggestMarkerFromFilename('hat-primary.png')).toBe(PRIMARY_MARKER);
    expect(SUGGESTABLE_MARKERS).not.toContain('primary');
  });
});
