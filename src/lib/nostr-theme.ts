/**
 * Blobbi Island — the Nostr THEME protocol, as Ditto defines it.
 *
 * This module is a compatible re-implementation of `src/lib/themeEvent.ts` in
 * the Ditto client, verified against that source. Nothing here was invented:
 * the kinds, the tag names, the role markers, the hex encoding and the legacy
 * fallback all exist so that a theme published by Ditto works in Blobbi Island
 * and a theme published by Blobbi Island works in Ditto.
 *
 * ## Two kinds, two different questions
 *
 * ```
 *   36767  addressable   A THEME — a named, shareable definition. Many per user.
 *   16767  replaceable   THE THEME I AM USING — one per user, the selection.
 * ```
 *
 * They must never be conflated. A definition is a thing that exists and can be
 * discovered by anyone; the active theme is one user's current choice, and it
 * carries a full copy of the colours (so a client can render a stranger's
 * chosen palette without resolving anything) plus an `a` tag pointing back at
 * the definition it came from, when it came from one.
 *
 * ## The event shape
 *
 * Kind 36767 — theme definition:
 *
 * ```jsonc
 * {
 *   "kind": 36767,
 *   "content": "",                                  // empty; colours are tags
 *   "tags": [
 *     ["d", "harbour-dusk"],                        // slug, addressable identity
 *     ["c", "#141a24", "background"],               // HEX, with a role marker
 *     ["c", "#f2f5fa", "text"],
 *     ["c", "#5b8cff", "primary"],
 *     ["title", "Harbour Dusk"],
 *     ["alt", "Custom theme: Harbour Dusk"],        // NIP-31
 *     ["t", "theme"],
 *     ["description", "..."]                        // optional
 *   ]
 * }
 * ```
 *
 * Kind 16767 — active theme: the same `c` tags, an optional `title` /
 * `description`, and `["a", "36767:<pubkey>:<d>"]` when a definition was
 * selected. Empty tags means "cleared".
 *
 * Ditto also defines `f` (font family + URL + body/title role) and `bg`
 * (an imeta-style background media tag). Island **reads neither and writes
 * neither** — see {@link ThemeCompatibilityNote} at the bottom of this file for
 * exactly what that costs.
 *
 * ## Colours on the wire are HEX; colours in memory are HSL channels
 *
 * The wire format is `#rrggbb`, because that is what Ditto writes. Island's
 * palette is bare HSL channel triplets (`"197 78% 63%"`), because that is what
 * `hsl(var(--island-x) / <alpha>)` needs. Conversion happens exactly here, at
 * the boundary, in both directions.
 *
 * ## Everything on a relay is untrusted
 *
 * A theme is a stranger's data being asked to colour the player's whole UI, so
 * this module is also the security boundary, and its rule is absolute:
 *
 *   **no string from an event ever reaches CSS.**
 *
 * A `c` tag is accepted only if it matches `#rgb`/`#rrggbb`, and it is then
 * PARSED INTO NUMBERS and re-emitted from those numbers. So even a value that
 * passed validation cannot carry a payload — what lands in a custom property is
 * arithmetic output, never the input. Titles and descriptions are length-capped
 * and rendered as text nodes by React, never interpolated into markup or style.
 */

import type { NostrEvent } from '@nostrify/nostrify';

// ─── Kinds ───────────────────────────────────────────────────────────────────

/** Addressable: a shareable, named theme definition. Many per user. */
export const THEME_DEFINITION_KIND = 36767;

/** Replaceable: the user's currently active theme. One per user. */
export const ACTIVE_THEME_KIND = 16767;

// ─── The three core colours ──────────────────────────────────────────────────

/**
 * The three colours a Nostr theme is made of, as bare HSL channel triplets.
 *
 * This is Ditto's whole model, and Island does not get to widen it: a theme
 * published from here has to be a theme Ditto can read. Island's sixteen-colour
 * palette is DERIVED from these three by `island-theme-adapter.ts`; it is an
 * implementation detail of this client and is never published.
 */
export interface CoreThemeColors {
  /** Page background. */
  background: string;
  /** Body text / foreground. */
  text: string;
  /** Primary accent — buttons, links, focus. */
  primary: string;
}

const CORE_ROLES = ['background', 'text', 'primary'] as const;

// ─── Colour conversion ───────────────────────────────────────────────────────

/** Whether a string is a hex colour Island will accept: `#rgb` or `#rrggbb`. */
export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Parse an HSL channel triplet like `"197 78% 63%"`.
 *
 * Returns `null` for anything that is not three finite in-range numbers, which
 * is what keeps a malformed stored palette from becoming `NaN%` in a custom
 * property.
 */
export function parseHslTriplet(value: unknown): { h: number; s: number; l: number } | null {
  if (typeof value !== 'string') return null;
  const parts = value.trim().replace(/%/g, '').split(/\s+/);
  if (parts.length !== 3) return null;
  const [h, s, l] = parts.map(Number);
  if (![h, s, l].every((n) => Number.isFinite(n))) return null;
  if (s < 0 || s > 100 || l < 0 || l > 100) return null;
  return { h: ((h % 360) + 360) % 360, s, l };
}

/** Format channels back into the triplet the palette uses. */
export function formatHslTriplet(h: number, s: number, l: number): string {
  const round = (n: number) => Math.round(n * 10) / 10;
  return `${round(((h % 360) + 360) % 360)} ${round(clamp(s, 0, 100))}% ${round(clamp(l, 0, 100))}%`;
}

/** `#rrggbb` -> `[r, g, b]`, each 0-255. Assumes {@link isValidHexColor} passed. */
export function hexToRgb(hex: string): [number, number, number] {
  let body = hex.slice(1);
  if (body.length === 3) body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
  return [
    parseInt(body.slice(0, 2), 16),
    parseInt(body.slice(2, 4), 16),
    parseInt(body.slice(4, 6), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return lN - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rN) h = ((gN - bN) / d + (gN < bN ? 6 : 0)) / 6;
  else if (max === gN) h = ((bN - rN) / d + 2) / 6;
  else h = ((rN - gN) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** `#rrggbb` -> `"h s% l%"`. */
export function hexToHslTriplet(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  return formatHslTriplet(h, s, l);
}

/** `"h s% l%"` -> `#rrggbb`. Returns `#000000` for an unparseable triplet. */
export function hslTripletToHex(triplet: string): string {
  const parsed = parseHslTriplet(triplet);
  if (!parsed) return '#000000';
  const [r, g, b] = hslToRgb(parsed.h, parsed.s, parsed.l);
  return rgbToHex(r, g, b);
}

// ─── Luminance / contrast ────────────────────────────────────────────────────

/** WCAG 2.x relative luminance of an HSL triplet. */
export function relativeLuminance(triplet: string): number {
  const parsed = parseHslTriplet(triplet);
  if (!parsed) return 0;
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hslToRgb(parsed.h, parsed.s, parsed.l).map((v) => linear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two HSL triplets. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Whether a background reads as dark.
 *
 * The 0.2 luminance cutoff is Ditto's (`isDarkTheme`), reproduced rather than
 * re-chosen so the two clients agree about which themes are dark ones.
 */
export function isDarkBackground(triplet: string): boolean {
  return relativeLuminance(triplet) < 0.2;
}

// ─── Untrusted-input limits ──────────────────────────────────────────────────

/**
 * Caps on the free text a theme may carry.
 *
 * Not a security control on their own — React renders these as text nodes, so
 * they cannot execute — but a 40KB "title" is a denial-of-layout, and a theme
 * list is rendered from strangers' events.
 */
export const THEME_TITLE_MAX = 64;
export const THEME_DESCRIPTION_MAX = 200;

/**
 * Strip control characters, collapse whitespace, and cap length.
 *
 * Written as a code-point scan rather than a regex on purpose: a character
 * class covering C0 and C1 has to contain literal control characters, and the
 * project lints those out of regex literals (correctly — there they are almost
 * always an accident). Here they are the subject. Theme titles arrive from
 * strangers, and a NUL, a bidi override or a lone escape in a list of names is
 * exactly what this removes before React ever renders it.
 */
export function sanitizeThemeText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    out += isControl ? ' ' : char;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

// ─── `c` tags ────────────────────────────────────────────────────────────────

/**
 * Read the three core colours out of an event's tags.
 *
 * Returns `null` unless all three roles are present AND every one of them is a
 * valid hex colour — a theme missing its text colour is not a theme with a
 * default text colour, it is an invalid event, and guessing would put an
 * unreadable UI in front of the player.
 */
function parseColorTags(tags: string[][]): CoreThemeColors | null {
  const byRole = new Map<string, string>();
  for (const tag of tags) {
    if (tag[0] !== 'c' || typeof tag[1] !== 'string' || typeof tag[2] !== 'string') continue;
    // First wins, so a duplicate role appended later cannot override.
    if (!byRole.has(tag[2])) byRole.set(tag[2], tag[1]);
  }

  const hexes = CORE_ROLES.map((role) => byRole.get(role));
  if (!hexes.every(isValidHexColor)) return null;

  const [background, text, primary] = hexes.map(hexToHslTriplet);
  return { background, text, primary };
}

/** Emit `c` tags in Ditto's order and encoding. */
function buildColorTags(colors: CoreThemeColors): string[][] {
  return CORE_ROLES.map((role) => ['c', hslTripletToHex(colors[role]), role]);
}

/**
 * Ditto's legacy format: the colours as JSON in `content`.
 *
 * Kept because themes published before the `c`-tag format exist on relays right
 * now, and a discovery list that silently dropped them would look like "there
 * are no themes". Three historical shapes are handled, exactly as Ditto handles
 * them: `{background,text,primary}`, the same plus a dropped `secondary`, and
 * the original nineteen-token blob whose `foreground` is today's `text`.
 */
function parseLegacyContentColors(content: string): CoreThemeColors | null {
  if (!content) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;

  // Legacy values are HSL TRIPLETS, not hex — that format predates the hex
  // encoding. Anything unparseable is rejected rather than defaulted.
  const raw = [record.background, record.text ?? record.foreground, record.primary];
  if (!raw.every((v) => parseHslTriplet(v) !== null)) return null;

  const [background, text, primary] = raw as string[];
  return { background, text, primary };
}

function parseColors(event: NostrEvent): CoreThemeColors | null {
  return parseColorTags(event.tags) ?? parseLegacyContentColors(event.content);
}

// ─── Theme definition (kind 36767) ───────────────────────────────────────────

export interface NostrThemeDefinition {
  /** `d` tag. Addressable identity together with the author. */
  identifier: string;
  /** The event's author. */
  pubkey: string;
  title: string;
  description: string;
  colors: CoreThemeColors;
  /** `36767:<pubkey>:<d>` — stable across republishes, unlike the event id. */
  address: string;
  /** For deterministic newest-wins resolution. */
  createdAt: number;
  /** Diagnostics only. Never identity: the author republishes on every edit. */
  eventId: string;
}

/**
 * The stable id Island stores for a Nostr theme.
 *
 * `nostr:36767:<pubkey>:<d>` — the protocol address with a namespace in front.
 * The prefix is what lets one `AppConfig.theme` field hold both kinds of
 * identity without a collision: a built-in id is a bare slug (`cozy-day`) and
 * contains no colon, so the two vocabularies cannot overlap. See
 * `island-themes.ts`.
 */
export function nostrThemeId(address: string): string {
  return `nostr:${address}`;
}

/** The `36767:<pubkey>:<d>` address inside a stored id, or `null`. */
export function addressFromNostrThemeId(id: string | undefined | null): string | null {
  if (!id || !id.startsWith('nostr:')) return null;
  const address = id.slice('nostr:'.length);
  const parts = address.split(':');
  if (parts.length < 3) return null;
  if (parts[0] !== String(THEME_DEFINITION_KIND)) return null;
  if (!/^[0-9a-f]{64}$/.test(parts[1])) return null;
  // The `d` may itself contain colons, so everything after the pubkey is it.
  if (parts.slice(2).join(':') === '') return null;
  return address;
}

/** The author pubkey inside a stored Nostr theme id, or `null`. */
export function pubkeyFromNostrThemeId(id: string | undefined | null): string | null {
  const address = addressFromNostrThemeId(id);
  return address ? address.split(':')[1] : null;
}

/** Parse and validate a kind:36767 event. `null` when it is not a usable theme. */
export function parseThemeDefinition(event: NostrEvent): NostrThemeDefinition | null {
  if (event.kind !== THEME_DEFINITION_KIND) return null;

  const identifier = event.tags.find(([n]) => n === 'd')?.[1];
  if (!identifier) return null;

  const title = sanitizeThemeText(
    event.tags.find(([n]) => n === 'title')?.[1],
    THEME_TITLE_MAX,
  );
  if (!title) return null;

  const colors = parseColors(event);
  if (!colors) return null;

  return {
    identifier,
    pubkey: event.pubkey,
    title,
    description: sanitizeThemeText(
      event.tags.find(([n]) => n === 'description')?.[1],
      THEME_DESCRIPTION_MAX,
    ),
    colors,
    address: `${THEME_DEFINITION_KIND}:${event.pubkey}:${identifier}`,
    createdAt: event.created_at,
    eventId: event.id,
  };
}

/**
 * Tags for a kind:36767 theme definition.
 *
 * Byte-compatible with Ditto's `buildThemeDefinitionTags` for a theme with no
 * font and no background media, which is every theme Island publishes: same
 * tags, same order, same `alt` wording, same `t` topic.
 */
export function buildThemeDefinitionTags(input: {
  identifier: string;
  title: string;
  colors: CoreThemeColors;
  description?: string;
}): string[][] {
  const title = sanitizeThemeText(input.title, THEME_TITLE_MAX);
  const tags: string[][] = [
    ['d', input.identifier],
    ...buildColorTags(input.colors),
    ['title', title],
    ['alt', `Custom theme: ${title}`],
    ['t', 'theme'],
  ];
  const description = sanitizeThemeText(input.description, THEME_DESCRIPTION_MAX);
  if (description) tags.push(['description', description]);
  return tags;
}

/**
 * Ditto's slug rule, reproduced.
 *
 * The `d` is the addressable identity, so publishing the same title twice
 * REPLACES rather than duplicating — which is what makes "edit my theme" work
 * without an update path of its own.
 */
export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

// ─── Active theme (kind 16767) ───────────────────────────────────────────────

/**
 * The extra tag Island writes on its active-theme event.
 *
 * A 16767 event carries the three colours, and for a theme selected from a
 * definition an `a` tag naming it. Neither can express "I am using the built-in
 * Cozy Day", because a built-in has no address and its sixteen authored colours
 * do not survive a round trip through three.
 *
 * So Island appends ONE tag Ditto does not read and does not need to: the id
 * from Island's own vocabulary. Nothing in the public protocol changes meaning
 * — the event is a fully valid Ditto active-theme event with a fully correct
 * colour triple — and Island can tell which of its own themes produced it. An
 * unknown or absent value falls back to matching on the `a` tag, and then to
 * the default.
 */
export const ISLAND_THEME_TAG = 'island-theme';

export interface ActiveThemeSelection {
  colors: CoreThemeColors;
  /** `36767:<pubkey>:<d>` of the source definition, when there was one. */
  sourceAddress: string | null;
  /** Island's own theme id, when the event was written by Island. */
  islandThemeId: string | null;
  title: string;
  createdAt: number;
}

/** Parse a kind:16767 event. `null` when it carries no usable colours. */
export function parseActiveTheme(event: NostrEvent): ActiveThemeSelection | null {
  if (event.kind !== ACTIVE_THEME_KIND) return null;

  const colors = parseColors(event);
  if (!colors) return null;

  const sourceAddress = event.tags.find(([n]) => n === 'a')?.[1] ?? null;
  const islandRaw = event.tags.find(([n]) => n === ISLAND_THEME_TAG)?.[1];

  return {
    colors,
    sourceAddress:
      typeof sourceAddress === 'string' &&
      sourceAddress.startsWith(`${THEME_DEFINITION_KIND}:`)
        ? sourceAddress
        : null,
    islandThemeId: sanitizeThemeText(islandRaw, 128) || null,
    title: sanitizeThemeText(event.tags.find(([n]) => n === 'title')?.[1], THEME_TITLE_MAX),
    createdAt: event.created_at,
  };
}

/** Tags for a kind:16767 active-theme event. */
export function buildActiveThemeTags(input: {
  colors: CoreThemeColors;
  title?: string;
  /** `36767:<pubkey>:<d>` when the selection came from a definition. */
  sourceAddress?: string | null;
  /** Island's own id for the selection. */
  islandThemeId?: string;
}): string[][] {
  const tags: string[][] = [...buildColorTags(input.colors), ['alt', 'Active profile theme']];
  const title = sanitizeThemeText(input.title, THEME_TITLE_MAX);
  if (title) tags.push(['title', title]);
  if (input.sourceAddress) tags.push(['a', input.sourceAddress]);
  if (input.islandThemeId) tags.push([ISLAND_THEME_TAG, input.islandThemeId]);
  return tags;
}

// ─── Discovery helpers ───────────────────────────────────────────────────────

/**
 * Resolve a set of raw kind:36767 events to one theme per address.
 *
 * Nostr replacement semantics, applied deterministically: an addressable event
 * is identified by `kind:pubkey:d`, and the newest `created_at` wins. Ties break
 * on the LOWER event id, which is the convention NIP-01 gives for replaceable
 * events and, more importantly, is stable — two clients resolving the same set
 * must pick the same theme, or a shared theme shows different colours to
 * different people.
 *
 * Invalid events are dropped silently. That is the correct handling for a
 * public feed: one malformed theme from one stranger must not empty the list.
 */
export function resolveThemeDefinitions(events: readonly NostrEvent[]): NostrThemeDefinition[] {
  const byAddress = new Map<string, { event: NostrEvent; parsed: NostrThemeDefinition }>();

  for (const event of events) {
    const parsed = parseThemeDefinition(event);
    if (!parsed) continue;
    const existing = byAddress.get(parsed.address);
    if (
      !existing ||
      parsed.createdAt > existing.parsed.createdAt ||
      (parsed.createdAt === existing.parsed.createdAt && event.id < existing.event.id)
    ) {
      byAddress.set(parsed.address, { event, parsed });
    }
  }

  return [...byAddress.values()]
    .map((v) => v.parsed)
    .sort((a, b) => b.createdAt - a.createdAt || (a.address < b.address ? -1 : 1));
}

/**
 * What Island does NOT implement of Ditto's theme protocol, and why.
 *
 * - **`f` (fonts).** A font tag carries a URL to a font file the client would
 *   load. Island ships its own type and does not fetch remote font files on a
 *   stranger's say-so; a Ditto theme with a font renders in Island with
 *   Island's type and its colours intact. Publishing from Island never emits an
 *   `f` tag, so re-publishing a Ditto theme through Island would DROP a font
 *   its author had set — which is why Island publishes new themes rather than
 *   editing other people's.
 *
 * - **`bg` (background media).** Same reasoning, plus: the island already has a
 *   background — it is a game world — and a full-bleed image behind it is not a
 *   theme, it is a different product.
 *
 * Neither omission affects whether Ditto can read an Island theme: an absent
 * `f`/`bg` is exactly what a theme without a font and without background media
 * looks like in Ditto too.
 */
export type ThemeCompatibilityNote = never;
