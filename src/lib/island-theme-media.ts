/**
 * Applying a theme's FONT and BACKGROUND MEDIA — the two fields that are not
 * colours, and the only place event-sourced data reaches a stylesheet.
 *
 * ## Why this is separate from the palette
 *
 * A palette is sixteen numeric triplets written as inline custom properties; it
 * cannot carry a payload. A font family and a wallpaper URL are STRINGS from a
 * stranger's event that have to end up inside `font-family: "…"` and
 * `url("…")`. That is a different risk, so it gets its own file, its own
 * sanitisers, and its own two `<style>` elements that nothing else writes to.
 *
 * The rules, both reproduced from Ditto and both non-negotiable:
 *
 *  - **URLs are https or they do not exist.** `sanitizeThemeUrl` parses and
 *    re-serialises, so what reaches CSS is the URL parser's own output with
 *    quotes and backslashes percent-encoded — a value that cannot terminate the
 *    `url("…")` string it sits in.
 *  - **Font families pass an allowlist**: Unicode letters and numbers, space,
 *    underscore, hyphen, apostrophe, period. Braces, semicolons, quotes and
 *    parentheses are removed, not escaped.
 *
 * Nothing here interpolates a raw event value. If a value cannot be made safe
 * it is dropped and the island keeps its own type and its own background.
 *
 * ## Scope: where a theme background is allowed to appear
 *
 * Ditto puts the theme wallpaper on `body`, which is right for a social feed
 * scrolling over it. Blobbi Island is a drawn world — Town, Beach, Mine and the
 * Arcade are ART, and covering them with somebody's photograph would not be
 * theming the game, it would be vandalising it.
 *
 * So the background is applied to the PAGE BEHIND THE WOOD FRAME
 * (`--island-theme-bg-*`, consumed by the app shell) and nowhere else. On a
 * desktop that is the visible border around the game window — exactly the
 * surface `--island-page` already owns, which is app chrome and not scenery.
 * The world keeps its own art at every size. See `docs/themes.md`.
 */

import { sanitizeCssIdentifier, sanitizeThemeUrl } from '@/lib/nostr-theme';
import type { ThemeBackground, ThemeFont } from '@/lib/nostr-theme';

/** The `<style>` element carrying `@font-face` rules for remote theme fonts. */
const FONT_FACE_STYLE_ID = 'island-theme-font-faces';
/** The `<style>` element carrying the `font-family` override. */
const FONT_OVERRIDE_STYLE_ID = 'island-theme-font';

/**
 * The island's own type, and the fallback behind every theme font.
 *
 * Mirrors `fontFamily.sans` in `tailwind.config.ts`. It is a FALLBACK, not a
 * default that gets replaced: a theme font that fails to load — a dead host,
 * an offline device, a blocked request — leaves the game rendered in Comfortaa
 * rather than in whatever the browser picks, because `font-display: swap` shows
 * the fallback until (and unless) the real face arrives.
 */
const ISLAND_FONT_STACK = 'Comfortaa, system-ui, sans-serif';

function styleElement(id: string): HTMLStyleElement {
  let element = document.getElementById(id) as HTMLStyleElement | null;
  if (!element) {
    element = document.createElement('style');
    element.id = id;
    document.head.appendChild(element);
  }
  return element;
}

function removeStyle(id: string): void {
  document.getElementById(id)?.remove();
}

/**
 * A theme font reduced to values that are safe in CSS, or `null`.
 *
 * Exported because the tests assert on it directly: what a hostile font does
 * NOT produce is easier to pin here than through the DOM.
 */
export function safeFont(font: ThemeFont | undefined): { family: string; url?: string } | null {
  if (!font?.family) return null;
  const family = sanitizeCssIdentifier(font.family);
  if (!family) return null;
  const url = sanitizeThemeUrl(font.url);
  return url ? { family, url } : { family };
}

/**
 * Apply a theme's body font to the document.
 *
 * A remote face is declared with `@font-face` and `font-display: swap`, so the
 * page renders in the island's own type immediately and swaps only if the file
 * arrives. Passing `undefined` removes both style elements and restores the
 * island's type exactly.
 *
 * Only the BODY font is applied. Ditto's `titleFont` styles a profile display
 * name — a surface the island does not have — and is read, preserved and
 * republished without being rendered. See `docs/themes.md`.
 */
export function applyThemeFont(font: ThemeFont | undefined): void {
  if (typeof document === 'undefined') return;

  const safe = safeFont(font);
  if (!safe) {
    removeStyle(FONT_FACE_STYLE_ID);
    removeStyle(FONT_OVERRIDE_STYLE_ID);
    return;
  }

  if (safe.url) {
    // Rewritten rather than appended: one theme is active at a time, so the
    // element holds exactly the face in use and cannot accumulate the fonts of
    // every theme the player has ever previewed.
    styleElement(FONT_FACE_STYLE_ID).textContent =
      `@font-face { font-family: "${safe.family}"; src: url("${safe.url}"); font-display: swap; }`;
  } else {
    // No URL: the family is only usable if it is installed locally. Declaring
    // an `@font-face` with no source would be a rule that can never match.
    removeStyle(FONT_FACE_STYLE_ID);
  }

  styleElement(FONT_OVERRIDE_STYLE_ID).textContent =
    `:root { --island-font: "${safe.family}", ${ISLAND_FONT_STACK}; }`;
}

/** Custom properties the shell reads for the theme background. */
export const THEME_BG_IMAGE_VAR = '--island-theme-bg-image';
export const THEME_BG_SIZE_VAR = '--island-theme-bg-size';
export const THEME_BG_REPEAT_VAR = '--island-theme-bg-repeat';
export const THEME_BG_POSITION_VAR = '--island-theme-bg-position';
export const THEME_BG_ATTACHMENT_VAR = '--island-theme-bg-attachment';

/**
 * The CSS values for a background, or `null`.
 *
 * The two modes are Ditto's, with Ditto's own declarations: `cover` is
 * centred, non-repeating and `fixed`; `tile` repeats at natural size. `cover`
 * is the default when the tag omits a mode, again matching Ditto.
 */
export function backgroundDeclarations(
  background: ThemeBackground | undefined,
): Record<string, string> | null {
  const url = sanitizeThemeUrl(background?.url);
  if (!url) return null;

  const tile = background?.mode === 'tile';
  return {
    [THEME_BG_IMAGE_VAR]: `url("${url}")`,
    [THEME_BG_SIZE_VAR]: tile ? 'auto' : 'cover',
    [THEME_BG_REPEAT_VAR]: tile ? 'repeat' : 'no-repeat',
    [THEME_BG_POSITION_VAR]: 'center',
    [THEME_BG_ATTACHMENT_VAR]: tile ? 'scroll' : 'fixed',
  };
}

/**
 * Apply a theme background to `root` (the document element in the app).
 *
 * Written as custom properties rather than a rule against `body`, for the
 * reason in the header: the island decides WHERE a theme wallpaper is allowed
 * to show, and it is the page behind the wood frame — never the world. The
 * stylesheet consumes these on one selector, so the scope is a single place to
 * read and a single place to change.
 */
export function applyThemeBackground(
  background: ThemeBackground | undefined,
  root: HTMLElement,
): void {
  const declarations = backgroundDeclarations(background);
  const vars = [
    THEME_BG_IMAGE_VAR,
    THEME_BG_SIZE_VAR,
    THEME_BG_REPEAT_VAR,
    THEME_BG_POSITION_VAR,
    THEME_BG_ATTACHMENT_VAR,
  ];

  if (!declarations) {
    for (const name of vars) root.style.removeProperty(name);
    root.removeAttribute('data-theme-background');
    return;
  }

  for (const [name, value] of Object.entries(declarations)) {
    root.style.setProperty(name, value);
  }
  // A hook for surfaces that need to know a wallpaper is present — the frame
  // drops its own page tint so the image is not viewed through a wash.
  root.setAttribute('data-theme-background', background?.mode === 'tile' ? 'tile' : 'cover');
}
