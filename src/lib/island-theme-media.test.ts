/**
 * Fonts and background media — the two theme fields that are strings from a
 * stranger's event and have to reach a stylesheet.
 *
 * Colours cannot carry a payload: they are validated as hex, parsed into
 * numbers, and re-emitted from those numbers. A font family and a wallpaper URL
 * can, so this is where that is pinned.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  applyThemeBackground,
  applyThemeFont,
  backgroundDeclarations,
  safeFont,
  THEME_BG_ATTACHMENT_VAR,
  THEME_BG_IMAGE_VAR,
  THEME_BG_REPEAT_VAR,
  THEME_BG_SIZE_VAR,
} from './island-theme-media';
import { sanitizeCssIdentifier, sanitizeThemeUrl } from './nostr-theme';

const root = () => document.documentElement;
const styleText = (id: string) => document.getElementById(id)?.textContent ?? '';

beforeEach(() => {
  document.getElementById('island-theme-font-faces')?.remove();
  document.getElementById('island-theme-font')?.remove();
  root().removeAttribute('style');
  root().removeAttribute('data-theme-background');
});

describe('URL validation', () => {
  it('accepts https and nothing else', () => {
    expect(sanitizeThemeUrl('https://media.example/w.jpg')).toBe('https://media.example/w.jpg');
    for (const bad of [
      'http://media.example/w.jpg',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'blob:https://x/y',
      'file:///etc/passwd',
      '//media.example/w.jpg',
      'media.example/w.jpg',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(sanitizeThemeUrl(bad), String(bad)).toBeUndefined();
    }
  });

  it('re-serialises, so a URL cannot terminate the CSS string it sits in', () => {
    // The URL parser percent-encodes quotes and backslashes. That is what makes
    // `url("…")` safe without any escaping of our own.
    const hostile = sanitizeThemeUrl('https://x.example/a").evil{color:red}%20"')!;
    expect(hostile).not.toContain('"');
    expect(hostile).toContain('%22');

    // The only quotes in the declaration are the two this code wrote.
    const declaration = backgroundDeclarations({ url: hostile })![THEME_BG_IMAGE_VAR];
    expect(declaration.match(/"/g)).toHaveLength(2);
    expect(declaration.startsWith('url("')).toBe(true);
    expect(declaration.endsWith('")')).toBe(true);
  });
});

describe('font safety', () => {
  it('strips everything that could break out of a CSS string', () => {
    expect(sanitizeCssIdentifier('Playfair Display')).toBe('Playfair Display');
    // Period, hyphen, underscore and apostrophe survive — they are part of real
    // family names ("Noto Sans Mono", "PT Serif", "Sackers Gothic-Light").
    // Braces, quotes, semicolons and colons do not.
    const stripped = sanitizeCssIdentifier('Inter"; } html { display: none } .x{');
    expect(stripped).not.toMatch(/["{};:]/);
    expect(stripped).toContain('Inter');
    expect(sanitizeCssIdentifier('}*{color:red}')).not.toMatch(/["{};:]/);
    // A family of nothing but punctuation is not a family.
    expect(sanitizeCssIdentifier('{};:()')).toBe('');
    expect(safeFont({ family: '{};:()' })).toBeNull();
  });

  it('keeps a font whose URL is unusable, dropping only the URL', () => {
    // The family may still be installed locally, so discarding the whole font
    // would be a worse answer than discarding the link.
    expect(safeFont({ family: 'Georgia', url: 'http://x/f.woff2' })).toEqual({ family: 'Georgia' });
  });

  it('declares a remote face and points the app at it', () => {
    applyThemeFont({ family: 'Playfair Display', url: 'https://fonts.example/pf.woff2' });

    const face = styleText('island-theme-font-faces');
    expect(face).toContain('@font-face');
    expect(face).toContain('font-family: "Playfair Display"');
    expect(face).toContain('src: url("https://fonts.example/pf.woff2")');
    // `swap`, so the island renders in its own type until the file arrives —
    // and stays in it forever if the file never does.
    expect(face).toContain('font-display: swap');

    const override = styleText('island-theme-font');
    expect(override).toContain('--island-font: "Playfair Display"');
    // The island's own stack is the fallback, not something replaced.
    expect(override).toContain('Comfortaa');
  });

  it('declares no face for a family with no URL', () => {
    applyThemeFont({ family: 'Georgia' });
    // A rule with no `src` can never match; the family is only usable if the
    // reader already has it.
    expect(document.getElementById('island-theme-font-faces')).toBeNull();
    expect(styleText('island-theme-font')).toContain('"Georgia"');
  });

  it('replaces rather than accumulates', () => {
    applyThemeFont({ family: 'A', url: 'https://f.example/a.woff2' });
    applyThemeFont({ family: 'B', url: 'https://f.example/b.woff2' });
    const face = styleText('island-theme-font-faces');
    expect(face).toContain('b.woff2');
    expect(face).not.toContain('a.woff2');
  });

  it('restores the island type when cleared', () => {
    applyThemeFont({ family: 'A', url: 'https://f.example/a.woff2' });
    applyThemeFont(undefined);
    expect(document.getElementById('island-theme-font-faces')).toBeNull();
    expect(document.getElementById('island-theme-font')).toBeNull();
  });

  it('never emits a family it did not sanitise', () => {
    applyThemeFont({ family: 'X"; } html { display:none } @font-face { font-family:"Y' });
    const css = styleText('island-theme-font');

    // The declaration is `:root { --island-font: "<family>", <stack>; }`, so it
    // legitimately contains braces of its own. What must NOT survive is a
    // family that closes the string or the block: the value between the two
    // quotes this code wrote has to be inert.
    const family = css.match(/--island-font: "([^"]*)"/)![1];
    expect(family).not.toMatch(/["{}();:]/);
    expect(css).not.toContain('display:none');
    // One declaration, one block — no second rule smuggled in.
    expect(css.match(/\{/g)).toHaveLength(1);
  });
});

describe('background media', () => {
  it('uses Ditto\'s two modes with Ditto\'s declarations', () => {
    const cover = backgroundDeclarations({ url: 'https://m.example/w.jpg', mode: 'cover' })!;
    expect(cover[THEME_BG_SIZE_VAR]).toBe('cover');
    expect(cover[THEME_BG_REPEAT_VAR]).toBe('no-repeat');
    expect(cover[THEME_BG_ATTACHMENT_VAR]).toBe('fixed');

    const tile = backgroundDeclarations({ url: 'https://m.example/w.jpg', mode: 'tile' })!;
    expect(tile[THEME_BG_SIZE_VAR]).toBe('auto');
    expect(tile[THEME_BG_REPEAT_VAR]).toBe('repeat');
  });

  it('defaults to cover, as Ditto does', () => {
    expect(backgroundDeclarations({ url: 'https://m.example/w.jpg' })![THEME_BG_SIZE_VAR]).toBe(
      'cover',
    );
  });

  it('drops a background whose URL is not https', () => {
    expect(backgroundDeclarations({ url: 'http://m.example/w.jpg' })).toBeNull();
    expect(backgroundDeclarations({ url: 'javascript:alert(1)' })).toBeNull();
    expect(backgroundDeclarations(undefined)).toBeNull();
  });

  it('applies to the root element and flags itself for the stylesheet', () => {
    applyThemeBackground({ url: 'https://m.example/w.jpg', mode: 'tile' }, root());
    expect(root().style.getPropertyValue(THEME_BG_IMAGE_VAR)).toBe('url("https://m.example/w.jpg")');
    expect(root().getAttribute('data-theme-background')).toBe('tile');
  });

  it('removes every trace when cleared', () => {
    applyThemeBackground({ url: 'https://m.example/w.jpg' }, root());
    applyThemeBackground(undefined, root());
    for (const name of [
      THEME_BG_IMAGE_VAR,
      THEME_BG_SIZE_VAR,
      THEME_BG_REPEAT_VAR,
      THEME_BG_ATTACHMENT_VAR,
    ]) {
      expect(root().style.getPropertyValue(name)).toBe('');
    }
    expect(root().hasAttribute('data-theme-background')).toBe(false);
  });
});
