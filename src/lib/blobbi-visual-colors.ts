/**
 * The colour gate for Blobbi visuals that arrive from a relay.
 *
 * A Blobbi's `base_color`, `secondary_color` and `eye_color` end up inside
 * SVG attribute values: `@blobbi-kit/renderer` splices them into the artwork
 * as strings and the result is mounted through `dangerouslySetInnerHTML`. The
 * renderer does not escape them, so the ONLY thing standing between a
 * stranger's kind 31124 tags and markup in every other player's page is this
 * check. It runs where relay data becomes a `BlobbiVisual`; nothing downstream
 * needs to know it exists.
 *
 * Accepts `#rgb` and `#rrggbb`, the two forms the artwork and the seed
 * derivation produce. Everything else, including CSS colour names and
 * `rgb(...)`, is refused: the renderer only ever needed hex, and an allow-list
 * of two shapes is easier to trust than a list of what is dangerous.
 */

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Whether a value is a hex colour the renderer may be handed as-is. */
export function isSafeBlobbiColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

/**
 * The colour if it is a plain hex colour, else `undefined`.
 *
 * `undefined` rather than a substitute: a Blobbi whose colours are all
 * refused draws the artwork's own defaults, the same thing it would do for a
 * 31124 that never carried colours at all.
 */
export function sanitizeBlobbiColor(value: unknown): string | undefined {
  return isSafeBlobbiColor(value) ? value : undefined;
}
