/**
 * Fonts and background media, the two theme fields that are strings from a
 * stranger's event and have to reach a stylesheet.
 *
 * Colours cannot carry a payload: they are validated as hex, parsed into
 * numbers, and re-emitted from those numbers. A font family and a wallpaper URL
 * can, so this is where that is pinned.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  applyThemeBackground,
  applyThemeFonts,
  backgroundDeclarations,
  FONT_BODY_VAR,
  FONT_DISPLAY_VAR,
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
    // Period, hyphen, underscore and apostrophe survive; they are part of real
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
    expect(safeFont({ family: 'Georgia', url: 'http://x/f.woff2' })).toEqual({
      family: 'Georgia',
      url: undefined,
      variable: false,
    });
  });

  it('falls back to the registry when a CURATED font\'s URL is unusable', () => {
    // An http link cannot be fetched, but the family is one Ditto curates, so
    // there is a known-good file for it. Losing the font over one bad character
    // would be the worse answer.
    expect(safeFont({ family: 'Inter', url: 'http://x/f.woff2' })?.url).toContain('jsdelivr');
    expect(safeFont({ family: 'Inter', url: 'javascript:alert(1)' })?.url).toContain('jsdelivr');
    expect(safeFont({ family: 'Inter' })?.url).toContain('jsdelivr');
  });

  it('declares a remote face and points the app at it', () => {
    applyThemeFonts({ body: { family: 'Playfair Display', url: 'https://fonts.example/pf.woff2' } });

    const face = styleText('island-theme-font-faces');
    expect(face).toContain('@font-face');
    expect(face).toContain('font-family: "Playfair Display"');
    expect(face).toContain('src: url("https://fonts.example/pf.woff2")');
    // `swap`, so the island renders in its own type until the file arrives,
    // and stays in it forever if the file never does.
    expect(face).toContain('font-display: swap');

    const override = styleText('island-theme-font');
    expect(override).toContain(`${FONT_BODY_VAR}: "Playfair Display"`);
    // The island's own stack is the fallback, not something replaced.
    expect(override).toContain('Comfortaa');
  });

  it('declares no face for an UNKNOWN family with no URL', () => {
    applyThemeFonts({ body: { family: 'Georgia' } });
    // A rule with no `src` can never match; an uncurated family with no URL is
    // only usable if the reader already has it installed.
    expect(document.getElementById('island-theme-font-faces')).toBeNull();
    expect(styleText('island-theme-font')).toContain('"Georgia"');
  });

  it('replaces rather than accumulates', () => {
    applyThemeFonts({ body: { family: 'A', url: 'https://f.example/a.woff2' } });
    applyThemeFonts({ body: { family: 'B', url: 'https://f.example/b.woff2' } });
    const face = styleText('island-theme-font-faces');
    expect(face).toContain('b.woff2');
    expect(face).not.toContain('a.woff2');
  });

  it('restores the island type when cleared', () => {
    applyThemeFonts({ body: { family: 'A', url: 'https://f.example/a.woff2' } });
    applyThemeFonts({});
    expect(document.getElementById('island-theme-font-faces')).toBeNull();
    expect(document.getElementById('island-theme-font')).toBeNull();
  });

  it('never emits a family it did not sanitise', () => {
    applyThemeFonts({
      body: { family: 'X"; } html { display:none } @font-face { font-family:"Y' },
    });
    const css = styleText('island-theme-font');

    // The declaration is `:root { --island-font: "<family>", <stack>; }`, so it
    // legitimately contains braces of its own. What must NOT survive is a
    // family that closes the string or the block: the value between the two
    // quotes this code wrote has to be inert.
    const family = css.match(/--island-font-body: "([^"]*)"/)![1];
    expect(family).not.toMatch(/["{}();:]/);
    expect(css).not.toContain('display:none');
    // One declaration, one block; no second rule smuggled in.
    expect(css.match(/\{/g)).toHaveLength(1);
  });
});

describe('the interop bug: a curated family with no URL', () => {
  /*
    The bug this phase exists to fix.

    Ditto's `FontPicker.handleSelect` calls `applyFont({ family })`: no URL,
    because Ditto bundles its curated fonts and loads them with `import()`. A
    URL only appears when the theme is PUBLISHED. Ditto's encrypted settings,
    which Island prefers because they are what Ditto renders from, therefore
    carry the family alone. Island wrote a correct variable pointing at a family
    nobody has installed, and the browser fell through to Comfortaa: visually
    identical to no font at all.
  */
  it('resolves the fontsource file Ditto would have published', () => {
    applyThemeFonts({ body: { family: 'Playfair Display' } });

    const face = styleText('island-theme-font-faces');
    expect(face, 'no @font-face was declared for a curated family').not.toBe('');
    expect(face).toContain(
      'https://cdn.jsdelivr.net/fontsource/fonts/playfair-display:vf@latest/latin-wght-normal.woff2',
    );
  });

  it('declares the weight RANGE for a variable font', () => {
    // Without this a variable face matches 400 only, and the island's hundreds
    // of `font-bold` labels get a synthetic smear instead of the real axis.
    applyThemeFonts({ body: { family: 'Playfair Display' } });
    expect(styleText('island-theme-font-faces')).toContain('font-weight: 100 900');
  });

  it('does not claim a range for a static font', () => {
    // Claiming one would stop the browser synthesising bold, which for a
    // single-weight file is the only way to get bold at all.
    applyThemeFonts({ body: { family: 'Pacifico' } });
    const face = styleText('island-theme-font-faces');
    expect(face).toContain('pacifico@latest/latin-400-normal.woff2');
    expect(face).not.toContain('font-weight');
  });

  it('lets the theme\'s own URL win over the registry', () => {
    // An explicit URL is the author's deliberate choice, a self-hosted file or
    // a Blossom upload, and Island is consuming it, not normalising its own.
    applyThemeFonts({ body: { family: 'Inter', url: 'https://mine.example/inter.woff2' } });
    const face = styleText('island-theme-font-faces');
    expect(face).toContain('https://mine.example/inter.woff2');
    expect(face).not.toContain('jsdelivr');
  });
});

describe('the two font roles', () => {
  it('gives body and title their own variables', () => {
    applyThemeFonts({
      body: { family: 'Inter' },
      title: { family: 'Playfair Display' },
    });
    const css = styleText('island-theme-font');
    expect(css).toContain(`${FONT_BODY_VAR}: "Inter"`);
    expect(css).toContain(`${FONT_DISPLAY_VAR}: "Playfair Display"`);
    // Both faces are declared, once each.
    const face = styleText('island-theme-font-faces');
    expect(face).toContain('inter:vf');
    expect(face).toContain('playfair-display:vf');
  });

  it('falls the display font back to the body font, not to the island\'s', () => {
    // A theme that sets only a body font should still read as ONE typeface.
    applyThemeFonts({ body: { family: 'Inter' } });
    const css = styleText('island-theme-font');
    expect(css).toContain(`${FONT_DISPLAY_VAR}: "Inter"`);
  });

  it('declares one face when both roles use the same family', () => {
    applyThemeFonts({ body: { family: 'Inter' }, title: { family: 'Inter' } });
    const face = styleText('island-theme-font-faces');
    expect(face.match(/@font-face/g)).toHaveLength(1);
  });

  it('applies a title font even with no body font', () => {
    applyThemeFonts({ title: { family: 'Pacifico' } });
    const css = styleText('island-theme-font');
    expect(css).toContain(`${FONT_DISPLAY_VAR}: "Pacifico"`);
    // Body stays the island's own type.
    expect(css).toContain(`${FONT_BODY_VAR}: Comfortaa`);
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
