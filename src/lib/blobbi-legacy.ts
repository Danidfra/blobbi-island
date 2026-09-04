/**
 * Helpers to distinguish modern Blobbis from legacy ones in the UI.
 *
 * Legacy Blobbis predate the current data format. They frequently lack proper
 * names (falling back to raw IDs/codes) and don't carry the identity metadata
 * the modern game relies on. We never delete or mutate these events; we simply
 * exclude them from the collection UI so players only see Blobbis the modern
 * island can render correctly.
 *
 * A Blobbi is considered MODERN only when BOTH hold:
 *   1. its `d`/`id` matches the modern format `blobbi-<segment>-<segment>`
 *      (e.g. "blobbi-feb88e80a63d-f249499cc5"); and
 *   2. it carries a `seed` tag (core identity metadata of modern Blobbis).
 *
 * Anything else: a non-conforming `d` tag, a missing `seed`, or the old
 * `client=blobbi`-only legacy events without a seed, is treated as legacy.
 *
 * Note: the modern app's own publisher also adds `["client", "blobbi"]`, so a
 * bare `client=blobbi` value is NOT a reliable legacy signal on its own. The
 * authoritative checks are the `d`-tag shape and the presence of `seed`, which
 * together capture the intent without hiding any valid modern Blobbi.
 */

import type { Blobbi } from "@/hooks/useBlobbis";
import { displayNameFromId, nameFromDTag } from "@/lib/blobbi-name";

/**
 * Modern `d`/id shape: `blobbi-<segment>-<segment>`, where each segment is one
 * or more alphanumeric characters (hex or random). Trailing extra segments are
 * tolerated so future-format ids aren't accidentally hidden.
 */
const MODERN_D_TAG = /^blobbi-[a-z0-9]+-[a-z0-9]+/i;

function getTagValue(rawTags: string[][] | undefined, name: string): string | undefined {
  return rawTags?.find(([tagName]) => tagName === name)?.[1];
}

/** True when the Blobbi conforms to the modern format and should appear in the UI. */
export function isModernBlobbi(blobbi: Pick<Blobbi, "id" | "rawTags">): boolean {
  // Rule: modern d-tag format required.
  if (!MODERN_D_TAG.test(blobbi.id)) return false;

  // Rule: a seed tag is required (core identity metadata of modern Blobbis).
  const seed = getTagValue(blobbi.rawTags, "seed");
  if (!seed) return false;

  return true;
}

/** Convenience inverse of {@link isModernBlobbi}. */
export function isLegacyBlobbi(blobbi: Pick<Blobbi, "id" | "rawTags">): boolean {
  return !isModernBlobbi(blobbi);
}

/**
 * Resolve the user-facing display name for a Blobbi card.
 *
 * The authoritative source is the modern `["name", "..."]` event tag, read
 * straight from `rawTags`. We read it directly here because the parser builds
 * `blobbi.name` as `nameFromDTag(d) || name-tag || id`: the d-tag-derived value
 * comes FIRST, so for modern Blobbis (whose `d` is always `blobbi-<seg>-<seg>`)
 * the real `name` tag is shadowed by an id-like string. This helper restores the
 * intended priority for display without changing the parser/data model.
 *
 * Display priority:
 *   1. the real `name` tag value, if present and non-empty;
 *   2. `blobbi.name`, only if it's a real name and NOT just the d-tag/id;
 *   3. a friendly "Unnamed Blobbi" fallback;
 *   4. a shortened id, only as a last-resort debug-style fallback.
 */
export function getBlobbiDisplayName(
  blobbi: Pick<Blobbi, "id" | "name" | "rawTags">,
): string {
  // 1. The real modern `name` tag.
  const nameTag = getTagValue(blobbi.rawTags, "name")?.trim();
  if (nameTag) return nameTag;

  // 2. Parsed `blobbi.name`, but only if it's a genuine name; not the raw id
  //    and not the d-tag-derived placeholder the parser prepends.
  const dDerived = nameFromDTag(blobbi.id) ?? displayNameFromId(blobbi.id);
  const parsed = blobbi.name?.trim();
  if (parsed && parsed !== blobbi.id && parsed !== dDerived) {
    return parsed;
  }

  // 3. Friendly fallback for a truly unnamed modern Blobbi.
  if (blobbi.id) return "Unnamed Blobbi";

  // 4. Last-resort debug-style fallback (should be unreachable in practice).
  return `Blobbi ${blobbi.id.slice(0, 6)}`;
}
