import { describe, expect, it } from 'vitest';
import { isSafeBlobbiColor, sanitizeBlobbiColor } from './blobbi-visual-colors';

describe('sanitizeBlobbiColor', () => {
  it('keeps the two hex shapes the artwork uses', () => {
    expect(sanitizeBlobbiColor('#ff8800')).toBe('#ff8800');
    expect(sanitizeBlobbiColor('#FF8800')).toBe('#FF8800');
    expect(sanitizeBlobbiColor('#f80')).toBe('#f80');
  });

  it.each([
    ['attribute break-out', '"><b data-probe="x"><!--'],
    ['single-quote break-out', "'><b>"],
    ['angle brackets', '<svg onload=x>'],
    ['backtick', '`#fff`'],
    ['script-looking string', 'javascript:alert(1)'],
    ['encoded quote', '%22%3E'],
    ['css colour name', 'red'],
    ['rgb()', 'rgb(255, 0, 0)'],
    ['hex with trailing junk', '#ff8800 onload=x'],
    ['bare hex without hash', 'ff8800'],
    ['empty string', ''],
  ])('refuses %s', (_label, value) => {
    expect(sanitizeBlobbiColor(value)).toBeUndefined();
    expect(isSafeBlobbiColor(value)).toBe(false);
  });

  it('refuses non-strings', () => {
    expect(sanitizeBlobbiColor(undefined)).toBeUndefined();
    expect(sanitizeBlobbiColor(null)).toBeUndefined();
    expect(sanitizeBlobbiColor(0xff8800)).toBeUndefined();
    expect(sanitizeBlobbiColor({ toString: () => '#ff8800' })).toBeUndefined();
  });
});
