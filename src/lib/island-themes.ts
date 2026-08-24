/**
 * Blobbi Island — theme registry.
 *
 * ## What a theme is
 *
 * A theme is a palette and nothing else: the sixteen HSL channel triplets that
 * `--island-*` resolves to. Everything downstream — the shadcn semantic tokens,
 * every shadow, every `bg-island-cream` in the game — is derived from those by
 * reference (see the token block at the top of `src/index.css`).
 *
 * That is the whole point of the architecture. Adding a theme is adding an
 * entry to {@link islandThemes}. It is never a component edit, never a new
 * Tailwind class, and never a `theme === 'x' ? … : …` in a feature file. If a
 * theme ever needs a component to change, the component is hardcoding a colour
 * it should be reading from a token.
 *
 * ## What a theme is deliberately NOT
 *
 * - **Not light/dark.** Blobbi Island has no generic dark mode; an evening
 *   island would be a theme authored with the game's own colours, not an
 *   inversion of the daytime one. See the `.dark` note in `src/index.css`.
 * - **Not derived from three core colours.** Ditto derives its nineteen tokens
 *   from `{background, text, primary}`, which is right for a social client
 *   where any user-picked colour must produce a usable UI. The island's palette
 *   is art direction — sand is not a computed tint of cream, it is a specific
 *   warm sand — so every colour is authored. The cost is that a theme is
 *   sixteen values instead of three; the benefit is that a theme can be
 *   *designed*. An EXTERNAL theme does not get that luxury and does not need
 *   it — see `island-theme-adapter.ts` for how three colours become sixteen.
 *
 * ## Two sources, one shape
 *
 * A theme is either BUILT IN — authored here, sixteen colours, in the bundle —
 * or it comes from **Nostr**: a kind:36767 definition published by anybody,
 * carrying the three colours Ditto's theme protocol defines, with the other
 * thirteen derived by `island-theme-adapter.ts`. Both end up as an
 * {@link IslandTheme}, because everything downstream — the picker, the applier,
 * the boot cache — must not care which it is holding.
 *
 * ## Identity
 *
 * A built-in's id is a bare slug (`cozy-day`). A Nostr theme's id is
 * `nostr:36767:<pubkey>:<d>` — the protocol address, namespaced. The two
 * vocabularies cannot collide because a built-in slug contains no colon, and
 * that is the whole reason built-in ids were NOT renamed to `builtin:cozy-day`
 * when Nostr themes arrived: every stored preference in the wild is a bare
 * slug, and a rename would have silently reset every player on a non-default
 * theme through the unknown-id fallback below.
 */

/** The palette a theme owns. Values are bare HSL channels, e.g. `27 40% 54%`. */
export interface IslandPalette {
  /** Page behind the wood frame. */
  page: string;
  sky: string;
  /** Informational accents, and the sea. */
  ocean: string;
  /**
   * Focus rings.
   *
   * Separate from `ocean` because the two have different jobs: `ocean` is a
   * fill and may be any lightness the art wants, while a focus ring must clear
   * 3:1 against every surface it can land on (WCAG 2.2 non-text contrast). In
   * Cozy Day the sea is too pale to do that, so focus is a deeper version of
   * it; in a dark theme the same colour usually serves both.
   */
  focus: string;
  /** Success, "play", online. */
  grass: string;
  'grass-dark': string;
  /** Secondary surface. */
  sand: string;
  /**
   * The frame. A decorative fill, not an action colour — `--primary` is
   * `wood-dark`, because a button has to carry readable text and the frame
   * does not.
   */
  wood: string;
  /**
   * The deeper wood: the frame's edge, strong label text on cream, and the
   * PRIMARY action surface.
   */
  'wood-dark': string;
  /** The panel surface: cards, popovers, modals, HUD. */
  cream: string;
  /** The muted panel surface one step down from `cream`. */
  'cream-2': string;
  /**
   * Mascot accent — the accent CTA, highlights, active state, and prices.
   *
   * Deep enough to be readable in BOTH directions: as text on `cream`, and as
   * a surface under `cream`. That constraint is why it is a shade deeper than
   * the mascot's own artwork, which is a picture and not a token.
   */
  purple: string;
  /** Text. */
  ink: string;
  /** Muted text. */
  'ink-soft': string;
  /** Destructive actions and error text. Readable on `cream` in both directions. */
  danger: string;
  /**
   * Caution and cost.
   *
   * Held to 3:1 rather than 4.5:1 and used only as an icon tint and a low-alpha
   * border — it has no text call sites. Deepening it to text contrast would
   * turn the warning amber brown for no reader's benefit; if it ever carries
   * text, it has to be deepened first.
   */
  warn: string;
}

/** Ordered palette keys. The single source of truth for what a theme must define. */
export const ISLAND_PALETTE_KEYS = [
  'page',
  'sky',
  'ocean',
  'focus',
  'grass',
  'grass-dark',
  'sand',
  'wood',
  'wood-dark',
  'cream',
  'cream-2',
  'purple',
  'ink',
  'ink-soft',
  'danger',
  'warn',
] as const satisfies readonly (keyof IslandPalette)[];

/** Where a theme came from. */
export type IslandThemeSource = 'builtin' | 'nostr';

export interface IslandTheme {
  /** Bare slug for a built-in; `nostr:36767:<pubkey>:<d>` for a Nostr theme. */
  id: string;
  /** Shown in the picker. */
  name: string;
  /** One line, shown under the name. Keep it in the world's voice. */
  description: string;
  /** Shown on the theme card, and in compact pickers. */
  emoji: string;
  palette: IslandPalette;
  source: IslandThemeSource;
  /** The kind:36767 author, for a Nostr theme. */
  authorPubkey?: string;
  /** `36767:<pubkey>:<d>`, for a Nostr theme. */
  address?: string;
}

/**
 * The default theme.
 *
 * Its palette is duplicated in `:root` in `src/index.css`, which is deliberate
 * and asserted by `island-themes.test.ts`: the stylesheet must render the
 * island correctly before any JavaScript runs, and the pre-paint boot script
 * needs a fallback that cannot itself fail to load.
 */
export const DEFAULT_ISLAND_THEME_ID = 'cozy-day';

const cozyDay: IslandTheme = {
  id: 'cozy-day',
  name: 'Cozy Day',
  description: 'Warm sand, painted wood and a bright afternoon sky.',
  emoji: '🏝️',
  source: 'builtin',
  palette: {
    page: '38 100% 96%',
    sky: '199 88% 80%',
    ocean: '197 78% 63%',
    focus: '197 78% 40%',
    grass: '113 46% 62%',
    'grass-dark': '115 36% 33%',
    sand: '43 82% 81%',
    wood: '27 40% 54%',
    'wood-dark': '30 42% 35%',
    cream: '43 100% 92%',
    'cream-2': '42 88% 87%',
    purple: '257 70% 56%',
    ink: '30 38% 16%',
    'ink-soft': '31 24% 34%',
    danger: '6 62% 46%',
    warn: '36 80% 57%',
  },
};

/**
 * Lantern Night.
 *
 * The second theme exists to prove the architecture rather than to fill a
 * picker, and it was chosen to be the *hardest* case: it inverts the lightness
 * relationship the whole app was built on — panels become darker than the page
 * is in Cozy Day, and text becomes light on dark. If a surface were hardcoding
 * a colour, this is the theme that exposes it.
 *
 * It is still the island: the same warm hue family, lantern-lit rather than
 * sunlit, and every role keeps its meaning (`cream` is still "the panel", it is
 * just a dusk panel now). It is not a generic dark mode, and it does not
 * respond to `prefers-color-scheme`.
 */
const lanternNight: IslandTheme = {
  id: 'lantern-night',
  name: 'Lantern Night',
  description: 'The island after dusk, lit by lanterns and a low warm moon.',
  emoji: '🏮',
  source: 'builtin',
  palette: {
    page: '256 26% 12%',
    sky: '250 40% 26%',
    ocean: '196 70% 62%',
    focus: '196 70% 62%',
    grass: '135 34% 52%',
    'grass-dark': '138 34% 62%',
    sand: '32 30% 32%',
    wood: '28 34% 58%',
    'wood-dark': '30 30% 82%',
    cream: '258 22% 20%',
    'cream-2': '256 20% 26%',
    purple: '265 80% 78%',
    ink: '40 60% 94%',
    'ink-soft': '38 22% 72%',
    danger: '6 74% 68%',
    warn: '38 86% 64%',
  },
};

/** Every BUILT-IN theme, in picker order. */
export const islandThemes: readonly IslandTheme[] = [cozyDay, lanternNight];

const themesById = new Map(islandThemes.map((t) => [t.id, t]));

/** Every valid theme id. */
export const islandThemeIds: readonly string[] = islandThemes.map((t) => t.id);

/**
 * Resolve a stored id to a theme, falling back to the default.
 *
 * The fallback is the entire error-handling story for theme ids, and it is why
 * `IslandThemeId` is `string` rather than a union of the current ids: a stored
 * preference outlives the build that wrote it. A player who picked a seasonal
 * theme that has since been removed, or who is running an older cached bundle,
 * gets Cozy Day — not a crash, and not an unstyled island.
 */
export function resolveIslandTheme(id: string | undefined): IslandTheme {
  return (id ? themesById.get(id) : undefined) ?? themesById.get(DEFAULT_ISLAND_THEME_ID)!;
}

/** Whether `id` names a BUILT-IN theme in this build. */
export function isKnownIslandThemeId(id: string | undefined): boolean {
  return id !== undefined && themesById.has(id);
}

/** Whether `id` is a built-in id, as opposed to a Nostr address. */
export function isBuiltinThemeId(id: string | undefined | null): boolean {
  return typeof id === 'string' && id.length > 0 && !id.includes(':');
}

/**
 * The palette as CSS custom property declarations, without a selector.
 *
 * Returned as a declaration list (not a `:root { … }` block) so the caller
 * chooses the scope: {@link applyIslandTheme} writes it onto the document
 * element's inline style, and a future scoped preview can put the same string
 * on a container.
 */
export function islandThemeDeclarations(theme: IslandTheme): Array<[string, string]> {
  return ISLAND_PALETTE_KEYS.map((key) => [`--island-${key}`, theme.palette[key]] as [string, string]);
}

/**
 * Apply a theme to an element — `document.documentElement` in the app.
 *
 * Written as inline custom properties rather than a swapped `<style>` element
 * or a class, for three reasons:
 *
 *  - inline properties outrank the `:root` defaults in the stylesheet without
 *    needing `!important` or a specificity trick;
 *  - there is exactly one place the active palette lives, so nothing can go
 *    stale or double-apply;
 *  - it is trivially inspectable in devtools, and trivially assertable in a
 *    test, which is what `island-theme.test.ts` does.
 *
 * `data-island-theme` carries the id for CSS that genuinely needs to branch on
 * the theme (art direction, not colour) and for tests.
 */
export function applyIslandTheme(theme: IslandTheme, root: HTMLElement): void {
  for (const [prop, value] of islandThemeDeclarations(theme)) {
    root.style.setProperty(prop, value);
  }
  root.setAttribute('data-island-theme', theme.id);
}

/**
 * Build an {@link IslandTheme} from a kind:36767 definition.
 *
 * Lives here rather than in the adapter so there is one place that decides what
 * an Island theme IS, whichever direction it arrived from. The palette is
 * derived, never stored on the definition: the derivation is deterministic, so
 * recomputing is free and there is no second copy to go stale.
 */
export function islandThemeFromNostr(definition: {
  address: string;
  pubkey: string;
  title: string;
  description: string;
  palette: IslandPalette;
}): IslandTheme {
  return {
    id: `nostr:${definition.address}`,
    name: definition.title,
    description: definition.description,
    // One mark for every community theme. A per-theme emoji is not part of the
    // protocol, and inventing one from the colours would be noise.
    emoji: '✨',
    palette: definition.palette,
    source: 'nostr',
    authorPubkey: definition.pubkey,
    address: definition.address,
  };
}
