/**
 * Blobbi Egg Preview / Tag Generation (first-egg adoption).
 *
 * Adapted from Ditto's onboarding/lib/blobbi-preview.ts. This module contains
 * ONLY pure data logic and depends solely on `@blobbi-kit` helpers, the single
 * source of truth for Blobbi identity and canonical d-tags. No Ditto-specific
 * publish/router/toast logic is copied.
 *
 * A new Island Blobbi is born V3: it IS its address. `@blobbi-kit/core`
 * derives its seed from (owner pubkey, d), and Algorithm 1 derives everything
 * it looks like from that seed, so the event states no seed, colour, trait,
 * size or adult form, only `visual_generation = v3`. The preview therefore
 * holds the address and nothing the published event could disagree with:
 * the renderer draws the preview and the published baby from the same
 * `{ seed, algorithm }`, and `colors` (the kit's own reading of the seed) is
 * for the ceremony's backdrop only.
 *
 * The preview is generated locally (no network, no publish) and drives the
 * ceremony's rendering. It is also the source of truth for the FINAL published
 * event: `previewToBabyTags` builds the kind 31124 baby through the kit's own
 * creation path (`buildEggTags`, then the kit's republish merge to promote it
 * to a playable baby). No egg (stage=egg) event is ever published; see
 * useFirstEggAdoption for the rationale.
 */

import {
  BLOBBI_V3_ALGORITHM,
  DEFAULT_EGG_STATS,
  buildEggTags,
  deriveBlobbiV3Seed,
  generatePetId10,
  getCanonicalBlobbiD,
  getLocalDayString,
  updateBlobbiTags,
  type BlobbiStats,
} from '@blobbi-kit/core';
import { createBlobbiV3Identity, type BlobbiV3Colors, type BlobbiV3Visual } from '@blobbi-kit/renderer';

/**
 * Complete preview data for a Blobbi egg before adoption.
 * This is the source of truth, the same data is used to build the final event.
 */
export interface BlobbiEggPreview {
  /** Random 10-char hex petId */
  petId: string;
  /** Canonical d-tag: blobbi-{pubkeyPrefix12}-{petId10} */
  d: string;
  /** The V3 seed: the address (owner, d), hashed by the kit. Never a tag. */
  seed: string;
  /** Display name for the egg */
  name: string;
  /** Algorithm 1's colours for the seed (the renderer's reading): the ceremony's backdrop, never written anywhere. */
  colors: BlobbiV3Colors;
  /** Default stats for a new egg */
  stats: BlobbiStats;
  /** Unix timestamp when the preview was created */
  createdAt: number;
  /** Owner pubkey */
  ownerPubkey: string;
}

/**
 * Generate a new egg preview with all data needed for adoption.
 *
 * Uses `@blobbi-kit` for every piece of identity:
 * - `generatePetId10` / `getCanonicalBlobbiD` for the canonical d-tag
 * - `deriveBlobbiV3Seed` for the address-derived seed
 * - the renderer's `createBlobbiV3Identity` for the colours the backdrop shows
 * - `DEFAULT_EGG_STATS` for starting stats
 */
export function generateEggPreview(pubkey: string, name = 'Egg'): BlobbiEggPreview {
  const petId = generatePetId10();
  const d = getCanonicalBlobbiD(pubkey, petId);
  const createdAt = Math.floor(Date.now() / 1000);
  const seed = deriveBlobbiV3Seed(pubkey, d);

  return {
    petId,
    d,
    seed,
    name,
    colors: createBlobbiV3Identity(seed).colors,
    stats: { ...DEFAULT_EGG_STATS },
    createdAt,
    ownerPubkey: pubkey,
  };
}

/** The preview as the renderer draws it: exactly what the published baby will resolve to. */
export function previewVisual(preview: BlobbiEggPreview): BlobbiV3Visual {
  return { seed: preview.seed, algorithm: BLOBBI_V3_ALGORITHM };
}

/**
 * Build the kind 31124 tags for the hatched baby, derived from the egg preview.
 *
 * The Island collection filters out eggs and has no egg-rendering pipeline, so
 * the first-egg ceremony promotes the new Blobbi straight to a playable baby
 * (full stats, active, no active progression). The tags are the kit's own V3
 * creation (`buildEggTags`), promoted through the kit's republish merge, so
 * the baby carries exactly what a canonical V3 event carries: its `d`, its
 * `visual_generation`, and no seed, colour, trait, size or adult form. Its
 * identity is its address, the same the preview was drawn from.
 */
export function previewToBabyTags(preview: BlobbiEggPreview): string[][] {
  const now = Math.floor(Date.now() / 1000).toString();
  const egg = buildEggTags(preview.ownerPubkey, preview.petId, preview.createdAt, preview.name, { visualGeneration: 'v3' });
  return updateBlobbiTags(egg, {
    stage: 'baby',
    state: 'active',
    progression_state: 'none',
    hunger: '100',
    happiness: '100',
    health: '100',
    hygiene: '100',
    energy: '100',
    care_streak_last_at: now,
    care_streak_last_day: getLocalDayString(new Date()),
    last_interaction: now,
    last_decay_at: now,
  });
}
