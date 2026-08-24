/**
 * Blobbi Island — the adapter from a Nostr theme's three colours to the
 * island's sixteen.
 *
 * ## The problem this solves
 *
 * Two models, both correct for what they are:
 *
 * - **Ditto's** theme is `{background, text, primary}`. Right for a social
 *   client: any colour a stranger picks must still produce a usable UI, so
 *   everything else is derived.
 * - **Island's** palette is sixteen authored values. Right for a game: sand is
 *   not a computed tint of cream, it is a specific warm sand, and the wood
 *   frame is art direction. See the header of `island-themes.ts`.
 *
 * A theme published from Ditto has three colours and no idea Blobbi Island
 * exists. It must not have to. So this module derives the other thirteen, and
 * it does so under one hard constraint:
 *
 *   **an adapted palette must satisfy the same contrast contract every
 *   built-in theme satisfies** (`island-theme-contrast.test.ts`).
 *
 * That is why this is not a table of `lighten(bg, 8)` calls. Fixed offsets
 * produce a plausible palette for a plausible theme and an unreadable one for a
 * theme with, say, a mid-grey background. Instead every role that carries text
 * is SOLVED: its hue and saturation come from the theme, and its lightness is
 * walked until the pairings it participates in clear their WCAG threshold. A
 * theme with terrible colours therefore comes out legible rather than pretty,
 * which is the correct trade — the alternative is a game the player cannot
 * read.
 *
 * ## What is derived from what
 *
 * ```
 *   background ─→ page, cream, cream-2, sand      the surface ladder
 *   text       ─→ ink, ink-soft                   text, contrast-solved
 *   primary    ─→ wood, wood-dark, purple, focus  chrome and actions
 *   (fixed hue)─→ danger, warn, grass, grass-dark semantic colours
 *   blend      ─→ sky, ocean, grass               scenery, dusked by the theme
 * ```
 *
 * ## Scenery is blended, not replaced
 *
 * `sky`, `ocean` and `grass` colour the WORLD — the sea is a sea. Deriving them
 * from an arbitrary primary would give a purple ocean. Ignoring the theme
 * entirely would put a bright midday sky above dark dusk panels. So each takes
 * the default theme's hue, blended a third of the way toward the theme's
 * background, with its lightness moved into the theme's register — which is,
 * by hand, exactly what Lantern Night does.
 */

import {
  contrastRatio,
  formatHslTriplet,
  isDarkBackground,
  parseHslTriplet,
  type CoreThemeColors,
} from '@/lib/nostr-theme';
import type { ThemeConfig } from '@/lib/nostr-theme';
import {
  DEFAULT_ISLAND_THEME_ID,
  resolveIslandTheme,
  type IslandPalette,
  type IslandTheme,
} from '@/lib/island-themes';

type Hsl = { h: number; s: number; l: number };

/** The default theme's palette — the reference the scenery blends from. */
const REFERENCE = resolveIslandTheme(DEFAULT_ISLAND_THEME_ID).palette;

function hsl(triplet: string, fallback: Hsl = { h: 0, s: 0, l: 50 }): Hsl {
  return parseHslTriplet(triplet) ?? fallback;
}

function fmt({ h, s, l }: Hsl): string {
  return formatHslTriplet(h, s, l);
}

/** Shortest-arc hue interpolation, so blending 350 and 10 goes through 0. */
function mixHue(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

function mix(a: Hsl, b: Hsl, t: number): Hsl {
  return {
    h: mixHue(a.h, b.h, t),
    s: a.s + (b.s - a.s) * t,
    l: a.l + (b.l - a.l) * t,
  };
}

/**
 * Walk a colour's lightness until every constraint clears.
 *
 * `direction` is the first way tried; if it runs out of range without
 * satisfying everything, the other way is tried from the start point. If
 * NEITHER can satisfy the set — which happens when a role must contrast with
 * both a very light and a very dark surface — the best-scoring lightness found
 * is returned. That is a deliberate "least bad", not a silent failure: the
 * caller has already ordered the constraints so the most important one is
 * weighted first, and the picker warns the player when the result is still
 * below AA.
 */
function solveLightness(
  base: Hsl,
  constraints: readonly { against: string; min: number }[],
  direction: 'darker' | 'lighter',
): Hsl {
  if (constraints.length === 0) return base;

  const score = (l: number) => {
    const candidate = fmt({ ...base, l });
    let worst = Infinity;
    for (const { against, min } of constraints) {
      worst = Math.min(worst, contrastRatio(candidate, against) / min);
    }
    return worst;
  };

  let bestL = base.l;
  let bestScore = score(base.l);
  if (bestScore >= 1) return base;

  const order: number[] = [];
  const first = direction === 'darker' ? -1 : 1;
  for (const step of [first, -first as number]) {
    for (let i = 1; i <= 100; i += 1) {
      const l = base.l + step * i;
      if (l < 0 || l > 100) break;
      order.push(l);
    }
  }

  for (const l of order) {
    const s = score(l);
    if (s > bestScore) {
      bestScore = s;
      bestL = l;
    }
    if (s >= 1) return { ...base, l };
  }

  return { ...base, l: bestL };
}

/**
 * Push `candidate` away from `from` until the two are distinguishable.
 *
 * The threshold is the same 1.03 the built-in palette sanity check uses: not a
 * legibility bar (no text is involved) but a "can you see that this is a panel"
 * one. Bounded to 60 steps and returns the best it managed, because for a
 * surface at the very top or bottom of the lightness range there may be
 * nowhere left to go — and one flat surface is still better than a thrown error
 * in the middle of applying somebody's theme.
 */
function separate(from: Hsl, candidate: Hsl, step: number): Hsl {
  const fromT = fmt(from);
  let best = candidate;
  let bestRatio = contrastRatio(fromT, fmt(candidate));

  for (let i = 1; i <= 60 && bestRatio < 1.06; i += 1) {
    const next = { ...candidate, l: clampL(candidate.l + step * i) };
    const ratio = contrastRatio(fromT, fmt(next));
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = next;
    }
    if (next.l === 0 || next.l === 100) break;
  }

  return best;
}

/** How far a role is allowed to keep the theme's saturation. */
function desaturate(base: Hsl, max: number): Hsl {
  return { ...base, s: Math.min(base.s, max) };
}

/**
 * Derive a full Island palette from a Nostr theme's three core colours.
 *
 * Deterministic: the same three colours always produce the same sixteen, on
 * every device and in every build. That matters because the palette is not
 * stored — it is recomputed from the three colours every time the theme
 * resolves — so a non-deterministic derivation would mean a theme that looked
 * different on reload.
 */
export function paletteFromCoreColors(colors: CoreThemeColors): IslandPalette {
  const bg = hsl(colors.background, { h: 38, s: 100, l: 96 });
  const text = hsl(colors.text, { h: 30, s: 38, l: 16 });
  const primary = hsl(colors.primary, { h: 257, s: 70, l: 56 });
  const dark = isDarkBackground(fmt(bg));

  // ── The surface ladder ────────────────────────────────────────────────────
  // Three steps that must stay distinguishable from one another (the palette
  // sanity check in the contrast test), moving AWAY from the page in whichever
  // direction the theme has room for. A dark theme lifts its panels; a light
  // one deepens them, which is what Cozy Day does by hand.
  //
  // The DIRECTION is chosen by where the background has room, not by whether
  // the theme is dark. Those usually agree — a near-black page can only go up,
  // a near-white one can only go down — but they part company exactly where it
  // matters: a mid-lightness background counted as "light" would step its
  // panels DOWN into the 40s, where no text colour on earth clears 4.5:1.
  const step = bg.l < 58 ? 1 : -1;
  const page = bg;
  //
  // Lightness alone does not reliably separate two SATURATED surfaces. A pure
  // green at 50% and the same green at 55% differ by a ratio of 1.003, because
  // the green channel is already clipped at 1.0 in both and luminance barely
  // moves. So each step down the ladder also calms the colour, which moves
  // luminance for any hue — and does nothing at all to an already-desaturated
  // theme, where `min` keeps the author's value. `separate` is the backstop:
  // it widens the step until the two surfaces are actually distinguishable.
  const cream = separate(page, { ...bg, s: Math.min(bg.s, 62), l: clampL(bg.l + step * 5) }, step);
  const cream2 = separate(cream, { ...bg, s: Math.min(bg.s, 55), l: clampL(bg.l + step * 10) }, step);
  // Secondary surface: further along the ladder AND pulled toward the primary
  // hue, so it reads as a warm plaque rather than a fourth shade of grey.
  const sand = mix({ ...bg, l: clampL(bg.l + step * 17) }, desaturate(primary, 45), 0.28);

  const pageT = fmt(page);
  const creamT = fmt(cream);
  const cream2T = fmt(cream2);
  const sandT = fmt(sand);

  // ── Text ──────────────────────────────────────────────────────────────────
  // Solved against all three surfaces at once: body text sits on every one of
  // them, and a theme whose text colour is only readable on the page is a theme
  // whose panels are unreadable.
  const ink = solveLightness(
    text,
    [
      { against: creamT, min: 4.5 },
      { against: pageT, min: 4.5 },
      { against: cream2T, min: 4.5 },
    ],
    dark ? 'lighter' : 'darker',
  );
  // Muted text: a fifth of the way back toward the panel, then re-solved. The
  // move is what makes it read as secondary; the re-solve is what stops it
  // becoming decorative.
  const inkSoft = solveLightness(
    { ...mix(ink, cream, 0.22), s: ink.s * 0.7 },
    [
      { against: creamT, min: 4.5 },
      { against: cream2T, min: 4.5 },
    ],
    dark ? 'lighter' : 'darker',
  );

  // ── Chrome and actions ────────────────────────────────────────────────────
  // The frame. Decorative, so it only owes 3:1 against the page — it carries no
  // text, which is exactly why `--primary` points at `wood-dark` and not here.
  const wood = solveLightness(
    desaturate({ ...primary, l: dark ? 58 : 54 }, 45),
    [{ against: pageT, min: 3 }],
    dark ? 'lighter' : 'darker',
  );
  // The PRIMARY action surface. It must carry `cream` as a label, be readable
  // as text on `cream`, and be readable as the plaque label on `sand`.
  const woodDark = solveLightness(
    desaturate(primary, 55),
    [
      { against: creamT, min: 4.5 },
      { against: sandT, min: 4.5 },
    ],
    dark ? 'lighter' : 'darker',
  );
  // The accent. The theme's primary at full saturation, solved in BOTH
  // directions — it is the accent button's surface and the colour of every
  // price, so a value that fixes one breaks the other unless both are held.
  const purple = solveLightness(
    primary,
    [
      { against: creamT, min: 4.5 },
      { against: cream2T, min: 4.5 },
    ],
    dark ? 'lighter' : 'darker',
  );

  // ── Scenery ───────────────────────────────────────────────────────────────
  // Hue from the island, register from the theme. A third of the way toward the
  // background keeps a sea recognisably a sea while letting a dusk theme dusk it.
  const scenery = (reference: string, lightFallback: number) => {
    const ref = hsl(reference);
    const blended = mix(ref, bg, 0.34);
    return {
      ...blended,
      l: dark ? clampL(bg.l + (ref.l - 50) * 0.28 + 14) : clampL(lightFallback),
    };
  };
  const sky = scenery(REFERENCE.sky, hsl(REFERENCE.sky).l);
  const ocean = scenery(REFERENCE.ocean, hsl(REFERENCE.ocean).l);
  const grass = scenery(REFERENCE.grass, hsl(REFERENCE.grass).l);

  // The focus ring must clear 3:1 on every surface a control can sit on. This
  // is the pairing that forced `focus` out of `ocean` into its own role in the
  // built-ins, and the same split is needed here.
  const focus = solveLightness(
    ocean,
    [
      { against: creamT, min: 3 },
      { against: cream2T, min: 3 },
      { against: pageT, min: 3 },
    ],
    dark ? 'lighter' : 'darker',
  );
  // The readable counterpart of grass — a label colour, not a fill.
  const grassDark = solveLightness(
    { ...grass, s: Math.min(grass.s, 40) },
    [{ against: creamT, min: 4.5 }],
    dark ? 'lighter' : 'darker',
  );

  // ── Semantic colours ──────────────────────────────────────────────────────
  // Danger and caution keep their own hues in every theme. A red that is not
  // red is not a warning, so the theme moves their lightness and nothing else.
  const danger = solveLightness(
    { h: hsl(REFERENCE.danger).h, s: dark ? 74 : 62, l: dark ? 68 : 46 },
    [{ against: creamT, min: 4.5 }],
    dark ? 'lighter' : 'darker',
  );
  const warn = solveLightness(
    { h: hsl(REFERENCE.warn).h, s: dark ? 86 : 80, l: dark ? 64 : 57 },
    [{ against: creamT, min: 1.4 }],
    dark ? 'lighter' : 'darker',
  );

  return {
    page: fmt(page),
    sky: fmt(sky),
    ocean: fmt(ocean),
    focus: fmt(focus),
    grass: fmt(grass),
    'grass-dark': fmt(grassDark),
    sand: sandT,
    wood: fmt(wood),
    'wood-dark': fmt(woodDark),
    cream: creamT,
    'cream-2': cream2T,
    purple: fmt(purple),
    ink: fmt(ink),
    'ink-soft': fmt(inkSoft),
    danger: fmt(danger),
    warn: fmt(warn),
  };
}

function clampL(l: number): number {
  return Math.min(100, Math.max(0, l));
}

/**
 * The three core colours a BUILT-IN Island theme publishes as.
 *
 * The reverse direction, and it is lossy by construction: sixteen authored
 * colours do not fit in three. The three chosen are the three that mean the
 * same thing in both models — the page, the body text, and the accent that
 * drives calls to action — so a Ditto user who applies an Island theme gets a
 * UI that reads like the island rather than a random tint of it.
 *
 * `purple` is published as `primary` and not `wood-dark`, because Ditto derives
 * its buttons AND its links AND its focus ring from `primary`, and the mascot
 * accent is the colour the island uses for exactly that job. The wood frame is
 * scenery; there is nowhere for it to go, and pretending otherwise would make
 * every Ditto button brown.
 */
export function coreColorsFromPalette(palette: IslandPalette): CoreThemeColors {
  return {
    background: palette.page,
    text: palette.ink,
    primary: palette.purple,
  };
}

// ─── Contrast report ─────────────────────────────────────────────────────────

/** One pairing an adapted palette is judged on. */
export interface ContrastFinding {
  what: string;
  ratio: number;
  min: number;
  passes: boolean;
}

/**
 * The pairings a theme has to survive, checked at RUNTIME.
 *
 * The same list the built-in themes are held to in
 * `island-theme-contrast.test.ts`, minus the ones the adapter cannot fail by
 * construction. It exists here because a community theme cannot be checked at
 * build time: it arrives from a relay, and the answer to "is this readable" has
 * to be computed the moment it is offered to the player.
 *
 * What is DONE with the answer is the policy question, and Island's answer is
 * deliberately not "block". A theme that fails is still offered and still
 * applies — it is the player's island — but the picker says so before they
 * choose, and the create flow says so before they publish. Silently correcting
 * would make the preview a lie; blocking would make Island reject themes Ditto
 * happily renders, which is the opposite of interoperable.
 */
export function contrastReport(palette: IslandPalette): ContrastFinding[] {
  const pairs: { what: string; fg: keyof IslandPalette; bg: keyof IslandPalette; min: number }[] = [
    { what: 'Body text on panels', fg: 'ink', bg: 'cream', min: 4.5 },
    { what: 'Body text on the page', fg: 'ink', bg: 'page', min: 4.5 },
    { what: 'Muted text on panels', fg: 'ink-soft', bg: 'cream', min: 4.5 },
    { what: 'Primary button label', fg: 'cream', bg: 'wood-dark', min: 4.5 },
    { what: 'Accent button label', fg: 'cream', bg: 'purple', min: 4.5 },
    { what: 'Error text', fg: 'danger', bg: 'cream', min: 4.5 },
    { what: 'Focus ring', fg: 'focus', bg: 'cream', min: 3 },
  ];

  return pairs.map(({ what, fg, bg, min }) => {
    const ratio = contrastRatio(palette[fg], palette[bg]);
    return { what, ratio: Number(ratio.toFixed(2)), min, passes: ratio >= min };
  });
}

/** The pairings a palette fails. Empty means it clears the whole contract. */
export function contrastFailures(palette: IslandPalette): ContrastFinding[] {
  return contrastReport(palette).filter((f) => !f.passes);
}

/**
 * The interoperable theme a BUILT-IN Island theme publishes as.
 *
 * A built-in has no font and no background media — it is authored art
 * direction, and the island's own type is part of that — so the config is the
 * three colours plus the name. That is a complete, valid Ditto theme: it is
 * exactly what Ditto's own presets look like on the wire.
 */
export function themeConfigFromIslandTheme(theme: IslandTheme): ThemeConfig {
  // A theme that CAME from Nostr republishes what it arrived with, so a hop
  // through the island never costs its author's font or wallpaper.
  if (theme.config) return theme.config;
  return { title: theme.name, colors: coreColorsFromPalette(theme.palette) };
}
