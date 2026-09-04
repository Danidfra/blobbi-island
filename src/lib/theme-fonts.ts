/**
 * Blobbi Island: the curated font registry, mirrored from Ditto.
 *
 * ## The bug this exists to fix
 *
 * A theme's font arrived in Island, was parsed correctly, produced a correct
 * CSS variable: and changed nothing on screen. The reason is one line in
 * Ditto's `FontPicker`:
 *
 * ```ts
 * applyFont({ family });   // handleSelect; no `url`
 * ```
 *
 * Ditto's twenty-five curated fonts are **bundled** in its own build. When a
 * user picks one, Ditto stores the family ALONE and loads the file with a
 * dynamic `import()` of the matching `@fontsource` package. A URL only appears
 * when the theme is PUBLISHED, where `resolveFontUrl` substitutes the fontsource
 * CDN link so other clients have something to fetch.
 *
 * The catch is that Ditto's own encrypted settings (kind:30078): the channel
 * Island prefers, because it is the one Ditto renders from, hold the
 * *unpublished* value. So Island received `{ family: 'Playfair Display' }` with
 * no URL, correctly declined to invent one, wrote
 * `--island-font-body: "Playfair Display", Comfortaa, …`, and the browser fell
 * straight through to Comfortaa because Playfair Display is not installed on a
 * typical machine. Identical to no font at all.
 *
 * ## What this module does
 *
 * The same thing `resolveFontUrl` does, from the other side: given a family
 * Ditto curates, produce the fontsource CDN URL for it. Island does not bundle
 * these fonts: it has its own type, so it fetches the exact file Ditto would
 * have published.
 *
 * ## Why a hardcoded table and not a URL built from the family name
 *
 * Because the mapping is not mechanical. `Press Start 2P` is
 * `press-start-2p@latest/latin-400-normal.woff2`, `Playfair Display` is
 * `playfair-display:vf@latest/latin-wght-normal.woff2`, and only the registry
 * knows which families are variable. Deriving it would silently 404 for half the
 * list. The table is transcribed from `src/lib/fonts.ts` in the Ditto repo and
 * is asserted against those exact URLs by `theme-fonts.test.ts`.
 *
 * A family that is NOT in this table is not rejected; it simply needs to carry
 * its own URL, which is what a self-hosted or uploaded font does.
 */

export interface CuratedFont {
  /** The family name as it appears on the wire, in `f` tags and settings. */
  family: string;
  /** The fontsource CDN `.woff2`, exactly as Ditto publishes it. */
  url: string;
  /**
   * Whether the file is a VARIABLE font.
   *
   * Load-bearing, not metadata: a variable face declared without a weight range
   * matches only 400, so every `font-bold` heading in the island would get a
   * synthetic smear instead of the real bold axis. See `island-theme-media.ts`.
   */
  variable: boolean;
}

/**
 * Ditto's curated fonts, family → file.
 *
 * Transcribed from `bundledFonts` in `/Users/filemon/Developer/ditto`,
 * `src/lib/fonts.ts`. Keep in sync when Ditto adds one; a missing entry costs a
 * theme its font only when that theme omits a URL, so the failure is soft.
 */
export const CURATED_FONTS: readonly CuratedFont[] = [
  { family: 'Inter', url: 'https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-wght-normal.woff2', variable: true },
  { family: 'DM Sans', url: 'https://cdn.jsdelivr.net/fontsource/fonts/dm-sans:vf@latest/latin-wght-normal.woff2', variable: true },
  { family: 'Outfit', url: 'https://cdn.jsdelivr.net/fontsource/fonts/outfit:vf@latest/latin-wght-normal.woff2', variable: true },
  { family: 'Montserrat', url: 'https://cdn.jsdelivr.net/fontsource/fonts/montserrat:vf@latest/latin-wght-normal.woff2', variable: true },
  { family: 'Lora', url: 'https://cdn.jsdelivr.net/fontsource/fonts/lora:vf@latest/latin-wght-normal.woff2', variable: true },
  { family: 'Merriweather', url: 'https://cdn.jsdelivr.net/fontsource/fonts/merriweather:vf@latest/latin-wght-normal.woff2', variable: true },
  { family: 'Playfair Display', url: 'https://cdn.jsdelivr.net/fontsource/fonts/playfair-display:vf@latest/latin-wght-normal.woff2', variable: true },
  { family: 'JetBrains Mono', url: 'https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono:vf@latest/latin-wght-normal.woff2', variable: true },
  { family: 'Comfortaa', url: 'https://cdn.jsdelivr.net/fontsource/fonts/comfortaa:vf@latest/latin-wght-normal.woff2', variable: true },
  { family: 'Comic Relief', url: 'https://cdn.jsdelivr.net/fontsource/fonts/comic-relief@latest/latin-400-normal.woff2', variable: false },
  { family: 'Permanent Marker', url: 'https://cdn.jsdelivr.net/fontsource/fonts/permanent-marker@latest/latin-400-normal.woff2', variable: false },
  { family: 'Cherry Bomb One', url: 'https://cdn.jsdelivr.net/fontsource/fonts/cherry-bomb-one@latest/latin-400-normal.woff2', variable: false },
  { family: 'Creepster', url: 'https://cdn.jsdelivr.net/fontsource/fonts/creepster@latest/latin-400-normal.woff2', variable: false },
  { family: 'Silkscreen', url: 'https://cdn.jsdelivr.net/fontsource/fonts/silkscreen@latest/latin-400-normal.woff2', variable: false },
  { family: 'Bungee Shade', url: 'https://cdn.jsdelivr.net/fontsource/fonts/bungee-shade@latest/latin-400-normal.woff2', variable: false },
  { family: 'Luckiest Guy', url: 'https://cdn.jsdelivr.net/fontsource/fonts/luckiest-guy@latest/latin-400-normal.woff2', variable: false },
  { family: 'Press Start 2P', url: 'https://cdn.jsdelivr.net/fontsource/fonts/press-start-2p@latest/latin-400-normal.woff2', variable: false },
  { family: 'Fredoka', url: 'https://cdn.jsdelivr.net/fontsource/fonts/fredoka:vf@latest/latin-wght-normal.woff2', variable: true },
  { family: 'Caveat', url: 'https://cdn.jsdelivr.net/fontsource/fonts/caveat@latest/latin-400-normal.woff2', variable: false },
  { family: 'Pacifico', url: 'https://cdn.jsdelivr.net/fontsource/fonts/pacifico@latest/latin-400-normal.woff2', variable: false },
  { family: 'Pirata One', url: 'https://cdn.jsdelivr.net/fontsource/fonts/pirata-one@latest/latin-400-normal.woff2', variable: false },
  { family: 'Special Elite', url: 'https://cdn.jsdelivr.net/fontsource/fonts/special-elite@latest/latin-400-normal.woff2', variable: false },
  { family: 'Nunito', url: 'https://cdn.jsdelivr.net/fontsource/fonts/nunito:vf@latest/latin-wght-normal.woff2', variable: true },
  { family: 'Courier Prime', url: 'https://cdn.jsdelivr.net/fontsource/fonts/courier-prime@latest/latin-400-normal.woff2', variable: false },
  { family: 'Comic Neue', url: 'https://cdn.jsdelivr.net/fontsource/fonts/comic-neue@latest/latin-400-normal.woff2', variable: false },
];

const byFamily = new Map(CURATED_FONTS.map((f) => [f.family.toLowerCase(), f]));

/** Look up a curated font by family, case-insensitively (Ditto's own rule). */
export function findCuratedFont(family: string | undefined): CuratedFont | undefined {
  if (!family) return undefined;
  return byFamily.get(family.trim().toLowerCase());
}

/**
 * The URL to fetch a family from, preferring the theme's own.
 *
 * Ditto's `resolveFontUrl` does the reverse precedence; it OVERRIDES a stored
 * URL with the CDN one when publishing, because it is normalising its own
 * output. Island is consuming somebody else's, so an explicit URL is the
 * author's deliberate choice (a self-hosted file, a Blossom upload) and wins.
 * The registry is the fallback for the case that broke: a curated family with
 * no URL at all.
 */
export function resolveThemeFontUrl(family: string, explicitUrl?: string): string | undefined {
  if (explicitUrl) return explicitUrl;
  return findCuratedFont(family)?.url;
}

/** Whether a family is a variable font, when we can tell. Unknown → `false`. */
export function isVariableFontFamily(family: string): boolean {
  return findCuratedFont(family)?.variable ?? false;
}
