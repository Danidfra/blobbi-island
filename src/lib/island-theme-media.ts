/**
 * Applying a theme's FONTS and BACKGROUND MEDIA, the two fields that are not
 * colours, and the only place event-sourced data reaches a stylesheet.
 *
 * ## Why this is separate from the palette
 *
 * A palette is sixteen numeric triplets written as inline custom properties; it
 * cannot carry a payload. A font family and a wallpaper URL are STRINGS from a
 * stranger's event that have to end up inside `font-family: "…"` and
 * `url("…")`. That is a different risk, so it gets its own file, its own
 * sanitisers, and its own `<style>` elements that nothing else writes to.
 *
 * The rules, both reproduced from Ditto and both non-negotiable:
 *
 *  - **URLs are https or they do not exist.** `sanitizeThemeUrl` parses and
 *    re-serialises, so what reaches CSS is the URL parser's own output with
 *    quotes and backslashes percent-encoded, a value that cannot terminate the
 *    `url("…")` string it sits in.
 *  - **Font families pass an allowlist**: Unicode letters and numbers, space,
 *    underscore, hyphen, apostrophe, period. Braces, semicolons, quotes and
 *    parentheses are removed, not escaped.
 *
 * Nothing here interpolates a raw event value. If a value cannot be made safe
 * it is dropped and the island keeps its own type and its own background.
 *
 * ## Two font roles, two variables
 *
 * ```
 *   --island-font-body      every surface, inherited from <html>
 *   --island-font-display   window titles and section headings only
 * ```
 *
 * `--island-font-display` defaults to the body font, so a theme that sets only
 * one still looks coherent. Ditto's `titleFont` maps here: in the Ditto source
 * it drives `--title-font-family`, which is applied to `<h2>` section headings,
 * sidebar item labels and `DialogTitle`: display typography generally, not
 * just a profile name.
 *
 * ## Scope: where a theme background is allowed to appear
 *
 * Ditto puts the theme wallpaper on `body`, which is right for a social feed
 * scrolling over it. Blobbi Island is a drawn world: Town, Beach, Mine and the
 * Arcade are ART, and covering them with somebody's photograph would not be
 * theming the game, it would be vandalising it. So the background is applied to
 * the PAGE BEHIND THE WOOD FRAME and nowhere else. See `docs/themes.md`.
 */

import { sanitizeCssIdentifier, sanitizeThemeUrl } from '@/lib/nostr-theme';
import type { ThemeBackground, ThemeFont } from '@/lib/nostr-theme';
import { isVariableFontFamily, resolveThemeFontUrl } from '@/lib/theme-fonts';

/** The `<style>` element carrying `@font-face` rules for remote theme fonts. */
const FONT_FACE_STYLE_ID = 'island-theme-font-faces';
/** The `<style>` element carrying the `font-family` variables. */
const FONT_OVERRIDE_STYLE_ID = 'island-theme-font';

/**
 * The island's own type, and the fallback behind every theme font.
 *
 * Mirrors `fontFamily.sans` in `tailwind.config.ts`. It is a FALLBACK, not a
 * default that gets replaced: a theme font that fails to load, a dead host, an
 * offline device, a blocked request, a CORS refusal, leaves the game rendered
 * in Comfortaa rather than in whatever the browser would otherwise pick, because
 * `font-display: swap` shows the fallback until (and unless) the real face
 * arrives, and forever if it does not.
 */
export const ISLAND_FONT_STACK = 'Comfortaa, system-ui, sans-serif';

/** Custom property every surface inherits its type from. */
export const FONT_BODY_VAR = '--island-font-body';
/** Custom property window titles and section headings use. */
export const FONT_DISPLAY_VAR = '--island-font-display';

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

export interface SafeFont {
  /** Sanitised family, safe inside a quoted CSS string. */
  family: string;
  /** https URL of the font FILE, when one is known. */
  url?: string;
  /** Whether to declare a weight RANGE rather than a single weight. */
  variable: boolean;
}

/**
 * A theme font reduced to values that are safe in CSS, or `null`.
 *
 * This is where the interop fix lives. A font may arrive with **no URL**,
 * that is the normal shape in Ditto's own settings, because Ditto bundles its
 * curated families and only attaches a CDN link when publishing. Island has no
 * such bundle, so a family with no URL used to mean "hope it is installed",
 * which for a Google font on a normal machine means "silently keep Comfortaa".
 * `resolveThemeFontUrl` supplies the same file Ditto would have published.
 *
 * Exported because the tests assert on it directly: what a hostile font does
 * NOT produce is easier to pin here than through the DOM.
 */
export function safeFont(font: ThemeFont | undefined): SafeFont | null {
  if (!font?.family) return null;
  const family = sanitizeCssIdentifier(font.family);
  if (!family) return null;

  // The author's own URL first, then the registry. Note the ORDER of the
  // validation: an explicit URL that fails (http, `javascript:`, malformed)
  // falls back to the curated file rather than costing the theme its font,
  // sanitising after resolution would have made a single bad character fatal
  // for a font we know exactly where to find.
  //
  // The registry is keyed on the family as PUBLISHED, not the sanitised one, so
  // a family that loses characters to the allowlist cannot accidentally match a
  // curated font.
  const url =
    sanitizeThemeUrl(font.url) ?? sanitizeThemeUrl(resolveThemeFontUrl(font.family));
  return { family, url, variable: isVariableFontFamily(font.family) };
}

/**
 * One `@font-face` rule.
 *
 * `font-weight` is the second half of the fix. A variable `.woff2` declared
 * with no weight descriptor matches 400 and nothing else, so every `font-bold`
 * heading, label and button in the island, and there are hundreds, would fall
 * back to a synthetic smear of the 400 face instead of the file's real bold
 * axis. `100 900` is the range fontsource's `latin-wght-normal` files carry.
 *
 * Static faces get no descriptor, which is correct: they genuinely are one
 * weight, and claiming a range would make the browser stop synthesising bold
 * where synthesis is the only option.
 */
function fontFaceRule(font: SafeFont): string {
  const weight = font.variable ? ' font-weight: 100 900;' : '';
  return (
    `@font-face { font-family: "${font.family}";` +
    ` src: url("${font.url}");${weight} font-display: swap; }`
  );
}

/** The `font-family` value for a safe font: the theme's, then the island's. */
export function fontStack(font: SafeFont | null): string {
  return font ? `"${font.family}", ${ISLAND_FONT_STACK}` : ISLAND_FONT_STACK;
}

/**
 * Apply a theme's fonts to the document.
 *
 * Both roles are handled together so the two `<style>` elements are rewritten
 * as a pair and can never disagree about which faces are live. Passing
 * `undefined` for both removes them and restores the island's type exactly.
 *
 * `body` is the font every surface inherits. `title` is Ditto's `titleFont`,
 * used by the island only for window titles and section headings; see the
 * header of this file for why that matches Ditto's own usage.
 */
export function applyThemeFonts(fonts: {
  body?: ThemeFont | undefined;
  title?: ThemeFont | undefined;
}): void {
  if (typeof document === 'undefined') return;

  const body = safeFont(fonts.body);
  const title = safeFont(fonts.title);

  if (!body && !title) {
    removeStyle(FONT_FACE_STYLE_ID);
    removeStyle(FONT_OVERRIDE_STYLE_ID);
    return;
  }

  // Rewritten, never appended: one theme is active at a time, so the element
  // holds exactly the faces in use and cannot accumulate the fonts of every
  // theme the player has ever tried. A face with no resolvable URL is omitted,
  // a rule with no `src` can never match, and the family may still be installed.
  const faces = [body, title]
    .filter((f): f is SafeFont => !!f?.url)
    // The same family in both roles needs only one face.
    .filter((f, i, all) => all.findIndex((o) => o.family === f.family) === i)
    .map(fontFaceRule);

  if (faces.length > 0) {
    styleElement(FONT_FACE_STYLE_ID).textContent = faces.join('\n');
  } else {
    removeStyle(FONT_FACE_STYLE_ID);
  }

  // The display font falls back to the body font rather than to the island's,
  // so a theme that sets only a body font still reads as one typeface.
  const bodyStack = fontStack(body);
  styleElement(FONT_OVERRIDE_STYLE_ID).textContent =
    `:root { ${FONT_BODY_VAR}: ${bodyStack};` +
    ` ${FONT_DISPLAY_VAR}: ${title ? fontStack(title) : bodyStack}; }`;
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
 * to show, and it is the page behind the wood frame; never the world. The
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
  // A hook for surfaces that need to know a wallpaper is present, the frame
  // drops its own page tint so the image is not viewed through a wash.
  root.setAttribute('data-theme-background', background?.mode === 'tile' ? 'tile' : 'cover');
}

// ─── Preview ────────────────────────────────────────────────────────────────

/** The `<style>` element holding faces declared for PREVIEW only. */
const PREVIEW_FACE_STYLE_ID = 'island-theme-preview-faces';

/**
 * How many previewed faces are kept declared at once.
 *
 * A browse list can hold sixty community themes and it would be rude to fetch
 * sixty font files to render sixty cards. The cap keeps what is on screen and
 * evicts the rest; a card whose face has been evicted simply renders in the
 * island's type, which is what it did before previews existed.
 */
const PREVIEW_FACE_LIMIT = 12;

const previewFaces = new Map<string, string>();

/**
 * Declare a font face so a PREVIEW can render in it, without touching the app.
 *
 * Returns the `font-family` value to put on the preview container. Nothing
 * global changes: the caller scopes it to a card with an inline style, so
 * looking at a theme cannot restyle the island; only choosing it can.
 */
export function previewFontStack(font: ThemeFont | undefined): string {
  if (typeof document === 'undefined') return ISLAND_FONT_STACK;

  const safe = safeFont(font);
  if (!safe) return ISLAND_FONT_STACK;

  if (safe.url && !previewFaces.has(safe.family)) {
    previewFaces.set(safe.family, fontFaceRule(safe));
    while (previewFaces.size > PREVIEW_FACE_LIMIT) {
      // Insertion-ordered, so this drops the least recently ADDED.
      const oldest = previewFaces.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      previewFaces.delete(oldest);
    }
    styleElement(PREVIEW_FACE_STYLE_ID).textContent = [...previewFaces.values()].join('\n');
  }

  return fontStack(safe);
}

/** Drop every preview face. Called when the theme browser closes. */
export function clearPreviewFonts(): void {
  previewFaces.clear();
  removeStyle(PREVIEW_FACE_STYLE_ID);
}
