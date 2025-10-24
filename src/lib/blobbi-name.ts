/**
 * Utility functions for deriving Blobbi display names from d tags and IDs
 */

/**
 * Convert a kebab-case string to Title Case
 * Example: "foo-bar" → "Foo Bar"
 * Example: "pel" → "Pel"
 */
export function toTitleCaseFromKebab(slug?: string): string | undefined {
  if (!slug) return;
  return slug
    .split("-")
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

/**
 * Extract the name from a d tag by taking everything after the first "-"
 * and converting it to Title Case
 * Example: d: "blobbi-pel" → "Pel"
 * Example: d: "blobbi-foo-bar" → "Foo Bar"
 */
export function nameFromDTag(d?: string): string | undefined {
  if (!d) return;
  const i = d.indexOf("-");
  if (i < 0 || i === d.length - 1) return;
  return toTitleCaseFromKebab(d.slice(i + 1).trim());
}

/**
 * Get display name from an ID that mirrors the d tag format
 * This is useful when you have an ID in the same format as a d tag
 * Example: id: "blobbi-pel" → "Pel"
 */
export function displayNameFromId(id?: string): string | undefined {
  return nameFromDTag(id);
}