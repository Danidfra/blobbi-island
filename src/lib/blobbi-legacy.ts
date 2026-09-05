/**
 * Display-name policy for Blobbi cards.
 *
 * Which Blobbis are modern is no longer decided here. `parsePetState`
 * delegates to `@blobbi-kit/core`'s canonical classification, so every
 * `Blobbi` the collection hands out is modern by construction and historical
 * events never reach the UI (identified and ignored, never migrated). The
 * former `isModernBlobbi` / `isLegacyBlobbi` helpers are gone with it.
 */

import type { Blobbi } from "@/hooks/useBlobbis";
import { displayNameFromId, nameFromDTag } from "@/lib/blobbi-name";

function getTagValue(rawTags: string[][] | undefined, name: string): string | undefined {
  return rawTags?.find(([tagName]) => tagName === name)?.[1];
}

/**
 * Resolve the user-facing display name for a Blobbi card.
 *
 * The authoritative source is the modern `["name", "..."]` event tag, read
 * straight from `rawTags`. The parser now resolves `blobbi.name` to that same
 * tag through core; reading the tag here keeps the display rule independent of
 * any parsed shape (dev fixtures build `Blobbi` objects by hand).
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
