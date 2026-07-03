/**
 * useBlobbiCoreProbe — first local integration probe for the shared
 * `@blobbi-kit/core` package (consumed from the published npm package).
 *
 * READ-ONLY. This hook only *reads* the current user's Kind 31124 Blobbi
 * state events and derives a few values using shared `@blobbi-kit/core` helpers.
 * It publishes nothing, mutates nothing, and touches no inventory/equip,
 * shop/catalog, or write path. It exists to validate that the shared core
 * package parses/derives against real Island data before any deeper migration.
 *
 * Exercised core functions:
 * - parseBlobbiEvent        (event -> BlobbiCompanion)
 * - buildBlobbiAddress      (canonical `a`-tag coordinate)
 * - applyBlobbiDecay        (pure decay projection)
 * - getVisibleStats         (stage-appropriate visible stat keys)
 * - getBlobbiStatDisplayState (per-stat UI display derivation)
 */

import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import {
  parseBlobbiEvent,
  buildBlobbiAddress,
  KIND_BLOBBI_STATE,
  type BlobbiCompanion,
  type BlobbiStats,
} from '@blobbi-kit/core/blobbi';
import { applyBlobbiDecay, getVisibleStats } from '@blobbi-kit/core/blobbi-decay';
import {
  getBlobbiStatDisplayState,
  type StatDisplayState,
} from '@blobbi-kit/core/blobbi-segments';
// First read-only @blobbi-kit/react import — projection hook only (no mutations,
// no catalog resolver; defaults to core's generic effects).
import {
  useProjectedBlobbiState,
  type ProjectedBlobbiState,
} from '@blobbi-kit/react/hooks/useProjectedBlobbiState';

import { useCurrentUser } from './useCurrentUser';

/** Read-only, core-derived snapshot for a single Blobbi. */
export interface BlobbiCoreProbeEntry {
  /** Canonical d-tag. */
  d: string;
  /** Resolved display name (from core). */
  name: string;
  /** Canonical `a`-tag coordinate (31124:<pubkey>:<d>). */
  address: string;
  /** Whether core flags this event as legacy/unsupported. */
  isLegacy: boolean;
  /** Stats after applying pure decay projection (no publish). */
  projectedStats: BlobbiStats;
  /** Stage-appropriate visible stat keys. */
  visibleStatKeys: (keyof BlobbiStats)[];
  /** Per-visible-stat UI display derivation. */
  visibleStatDisplay: Array<{
    stat: keyof BlobbiStats;
    display: StatDisplayState;
  }>;
}

/**
 * Fetch the current user's Kind 31124 events and derive read-only,
 * `@blobbi-kit/core`-computed values from them.
 */
export function useBlobbiCoreProbe() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['blobbi-core-probe', user?.pubkey],
    enabled: !!user?.pubkey,
    staleTime: 60_000,
    queryFn: async (c): Promise<BlobbiCoreProbeEntry[]> => {
      if (!user?.pubkey) return [];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(2000)]);

      const events = await nostr.query(
        [{ kinds: [KIND_BLOBBI_STATE], authors: [user.pubkey], limit: 25 }],
        { signal },
      );

      const companions: BlobbiCompanion[] = events
        .map(parseBlobbiEvent)
        .filter((b): b is BlobbiCompanion => b !== undefined);

      return companions.map((companion) => {
        const { stats: projectedStats } = applyBlobbiDecay({
          stage: companion.stage,
          state: companion.state,
          stats: companion.stats,
          lastDecayAt: companion.lastDecayAt,
        });

        const visibleStatKeys = getVisibleStats(companion.stage);

        const visibleStatDisplay = visibleStatKeys.map((stat) => ({
          stat,
          display: getBlobbiStatDisplayState({
            stage: companion.stage,
            stat,
            value: projectedStats[stat],
          }),
        }));

        return {
          d: companion.d,
          name: companion.name,
          address: buildBlobbiAddress(companion.event.pubkey, companion.d),
          isLegacy: companion.isLegacy,
          projectedStats,
          visibleStatKeys,
          visibleStatDisplay,
        };
      });
    },
  });
}

/**
 * Read-only wrapper around `@blobbi-kit/react`'s `useProjectedBlobbiState`.
 *
 * Demonstrates that the shared React hook layer resolves and runs against
 * Island's React/Query/Nostrify instances. Read-only projection only — it
 * applies decay (and optional social interactions, if ever passed) without
 * publishing. No care-item resolver is provided, so core's generic effects
 * apply (no shop/catalog dependency).
 */
export function useBlobbiCoreProbeProjection(
  companion: BlobbiCompanion | null,
): ProjectedBlobbiState | null {
  return useProjectedBlobbiState(companion);
}
