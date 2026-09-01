/**
 * The badge domain boundary.
 *
 * Two things are worth pinning down while the protocol does not exist:
 *
 *  1. the catalog is EMPTY and nothing quietly fills it with plausible-looking
 *     merchandise — a fabricated badge that reaches a relay cannot be edited
 *     back out;
 *  2. every acquisition branch REFUSES, explicitly and by acquisition type,
 *     rather than throwing, half-writing, or silently succeeding.
 *
 * These are guards against the tempting fix, not against a bug. The interesting
 * day is the one where a badge kind arrives: then the second block starts
 * failing, which is exactly the reminder it should be.
 */

import { describe, it, expect } from 'vitest';

import {
  BADGE_ACQUISITIONS,
  BADGE_ACQUISITION_IMPLEMENTED,
  BADGE_ACQUISITION_LABELS,
  BADGE_CATALOG,
  acquireBadge,
  badgesByAcquisition,
  stockedAcquisitions,
} from './index';

describe('the catalog', () => {
  it('is empty, because no badge protocol exists in this repository', () => {
    expect(BADGE_CATALOG).toEqual([]);
  });

  it('offers no tabs when nothing is stocked', () => {
    // A "Missions" tab over an empty list implies a mission system exists.
    expect(stockedAcquisitions(BADGE_CATALOG)).toEqual([]);
  });

  it('serves all three acquisition types once anything IS stocked', () => {
    const stocked = BADGE_ACQUISITIONS.map((acquisition) => ({
      id: `sample-${acquisition}`,
      name: acquisition,
      description: '',
      image: null,
      symbol: '🏅',
      acquisition,
      owned: null,
    }));
    expect(stockedAcquisitions(stocked)).toEqual([
      'purchase',
      'achievement',
      'mission',
    ]);
    for (const acquisition of BADGE_ACQUISITIONS) {
      expect(badgesByAcquisition(stocked, acquisition)).toHaveLength(1);
      expect(BADGE_ACQUISITION_LABELS[acquisition]).toBeTruthy();
    }
  });
});

describe('the acquisition adapter', () => {
  it('says plainly that nothing is implemented', () => {
    expect(BADGE_ACQUISITION_IMPLEMENTED).toBe(false);
  });

  it.each(BADGE_ACQUISITIONS)('refuses %s with a reason of its own', (acquisition) => {
    const result = acquireBadge({ badgeId: 'anything', acquisition });
    expect(result.outcome).toBe('unsupported');
    expect(result.badgeId).toBe('anything');
    expect(result.outcome === 'unsupported' && result.reason).toBeTruthy();
  });

  it('gives each branch a DIFFERENT reason — they are blocked on different things', () => {
    const reasons = BADGE_ACQUISITIONS.map((acquisition) => {
      const result = acquireBadge({ badgeId: 'x', acquisition });
      return result.outcome === 'unsupported' ? result.reason : '';
    });
    expect(new Set(reasons).size).toBe(BADGE_ACQUISITIONS.length);
  });

  it('refuses without throwing, so a refusal is a normal outcome', () => {
    for (const acquisition of BADGE_ACQUISITIONS) {
      expect(() => acquireBadge({ badgeId: 'x', acquisition })).not.toThrow();
    }
  });
});
