/**
 * Blobbi Egg Preview / Tag Generation (first-egg adoption).
 *
 * Adapted from Ditto's onboarding/lib/blobbi-preview.ts. This module contains
 * ONLY pure data logic and depends solely on `@blobbi-kit/core` helpers, the
 * single source of truth for Blobbi identity, seed derivation, visual traits,
 * and canonical d-tags. No Ditto-specific publish/router/toast logic is copied.
 *
 * The preview is generated locally (no network, no publish) and drives the
 * ceremony's rendering. It is also the source of truth for the FINAL published
 * event: `previewToBabyTags` converts it directly into the kind 31124 baby tag
 * set with no regeneration. No egg (stage=egg) event is ever published; see
 * useFirstEggAdoption for the rationale.
 */

import {
  DEFAULT_EGG_STATS,
  BLOBBI_ECOSYSTEM_NAMESPACE,
  deriveVisualTraits,
  deriveBlobbiSeedV1,
  generatePetId10,
  getCanonicalBlobbiD,
  getLocalDayString,
  type BlobbiVisualTraits,
  type BlobbiStats,
} from '@blobbi-kit/core';

/**
 * Complete preview data for a Blobbi egg before adoption.
 * This is the source of truth, the same data is used to build the final event.
 */
export interface BlobbiEggPreview {
  /** Random 10-char hex petId */
  petId: string;
  /** Canonical d-tag: blobbi-{pubkeyPrefix12}-{petId10} */
  d: string;
  /** 64-char hex seed for deterministic visual traits */
  seed: string;
  /** Display name for the egg */
  name: string;
  /** Visual traits derived from the seed */
  visualTraits: BlobbiVisualTraits;
  /** Default stats for a new egg */
  stats: BlobbiStats;
  /** Unix timestamp when the preview was created (used for seed derivation) */
  createdAt: number;
  /** Owner pubkey */
  ownerPubkey: string;
}

/**
 * Generate a new egg preview with all data needed for adoption.
 *
 * Uses `@blobbi-kit/core` for every piece of core identity:
 * - `generatePetId10` / `getCanonicalBlobbiD` for the canonical d-tag
 * - `deriveBlobbiSeedV1` for the deterministic seed
 * - `deriveVisualTraits` for seed-derived colors/pattern/mark/size
 * - `DEFAULT_EGG_STATS` for starting stats
 */
export function generateEggPreview(pubkey: string, name = 'Egg'): BlobbiEggPreview {
  const petId = generatePetId10();
  const d = getCanonicalBlobbiD(pubkey, petId);
  const createdAt = Math.floor(Date.now() / 1000);
  const seed = deriveBlobbiSeedV1(pubkey, d, createdAt);

  // Derive visual traits from the seed (same routine parseBlobbiEvent uses).
  const visualTraits = deriveVisualTraits([], seed);

  return {
    petId,
    d,
    seed,
    name,
    visualTraits,
    stats: { ...DEFAULT_EGG_STATS },
    createdAt,
    ownerPubkey: pubkey,
  };
}

/**
 * Build the kind 31124 tags for the hatched baby, derived from the egg preview.
 *
 * The Island collection filters out eggs and has no egg-rendering pipeline, so
 * the first-egg ceremony promotes the new Blobbi straight to a playable baby
 * (full stats, active, no active progression). Identity tags (seed, visual
 * traits, d) are carried over unchanged from the egg so the baby renders with
 * the same appearance the player just hatched.
 */
export function previewToBabyTags(preview: BlobbiEggPreview): string[][] {
  const now = Math.floor(Date.now() / 1000).toString();
  const { visualTraits } = preview;

  return [
    ['d', preview.d],
    ['b', BLOBBI_ECOSYSTEM_NAMESPACE],
    ['name', preview.name],
    ['stage', 'baby'],
    ['state', 'active'],
    ['progression_state', 'none'],
    ['seed', preview.seed],
    ['generation', '1'],
    ['breeding_ready', 'false'],
    ['experience', '0'],
    ['care_streak', '1'],
    ['care_streak_last_at', now],
    ['care_streak_last_day', getLocalDayString(new Date())],
    ['hunger', '100'],
    ['happiness', '100'],
    ['health', '100'],
    ['hygiene', '100'],
    ['energy', '100'],
    ['last_interaction', now],
    ['last_decay_at', now],
    // Visual trait tags, deterministic rendering.
    ['base_color', visualTraits.baseColor],
    ['secondary_color', visualTraits.secondaryColor],
    ['eye_color', visualTraits.eyeColor],
    ['pattern', visualTraits.pattern],
    ['special_mark', visualTraits.specialMark],
    ['size', visualTraits.size],
  ];
}
