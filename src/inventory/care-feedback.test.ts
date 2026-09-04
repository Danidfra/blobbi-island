/**
 * The feedback model: what a surface is told after a successful consumption.
 *
 * The number shown is the REAL applied change, clamped and scaled, never a
 * constant; the provenance is the source's name, never the item's.
 */

import { describe, it, expect } from 'vitest';

import type { PetState } from '@/lib/blobbi-types';

import { appliedCareEffect, planCareEffect } from './care-effect';
import {
  careFeedbackFrom,
  formatStatDelta,
  mintCareFeedbackId,
  provenanceCue,
  statGains,
} from './care-feedback';
import { applyExternalCompatibility, resolveExternalItemCompatibility } from './external-item-compatibility';
import { FARM_STRAWBERRY_EVENT } from './partner-item-event-fixtures';
import { parseTrustedItemDefinition, resolveFromDefinition } from './protocol-adapter';

const strawberry = resolveFromDefinition(parseTrustedItemDefinition(FARM_STRAWBERRY_EVENT)!);
const definition = applyExternalCompatibility(
  strawberry,
  resolveExternalItemCompatibility({ definition: strawberry })!,
);

function pet(hunger: number): PetState {
  return {
    id: 'blobbi-1',
    stage: 'adult',
    hunger,
    happiness: 80,
    health: 80,
    hygiene: 80,
    energy: 80,
    experience: 0,
    careStreak: 0,
    rawTags: [],
    rawContent: '',
  } as unknown as PetState;
}

const plan = (hunger: number, quantity: number) =>
  planCareEffect({ pet: pet(hunger), action: 'feed', effects: definition.effects, quantity, now: new Date() });

describe('the applied effect is the real change', () => {
  it('one segment of raw produce on a hungry Blobbi: the full published effect', () => {
    const effect = appliedCareEffect(plan(50, 1), 'feed', 1);
    expect(effect).toMatchObject({ action: 'feed', quantity: 1 });
    expect(effect.statDeltas).toEqual({ hunger: 25, happiness: 0, health: 0, hygiene: 0, energy: 0 });
    expect(effect.experienceGained).toBeGreaterThan(0);
  });

  it('a batch of 3 scales the change', () => {
    expect(appliedCareEffect(plan(10, 3), 'feed', 3).statDeltas.hunger).toBe(75);
  });

  it('is clamped: a Blobbi at 90 gains 10, and one at 100 gains nothing', () => {
    expect(appliedCareEffect(plan(90, 1), 'feed', 1).statDeltas.hunger).toBe(10);
    expect(appliedCareEffect(plan(100, 2), 'feed', 2).statDeltas.hunger).toBe(0);
  });

  it('is a copy: mutating the feedback cannot reach the plan', () => {
    const p = plan(50, 1);
    const effect = appliedCareEffect(p, 'feed', 1);
    effect.statDeltas.hunger = 0;
    expect(p.statDeltas.hunger).toBe(25);
  });
});

describe('the feedback', () => {
  const effect = appliedCareEffect(plan(50, 2), 'feed', 2);

  it('carries the id, the item, the change and, for another game, the source', () => {
    const feedback = careFeedbackFrom(effect, { id: 'spend-1', itemName: 'Strawberry', provenance: 'Nostr Farm' });
    expect(feedback).toMatchObject({
      id: 'spend-1',
      action: 'feed',
      quantity: 2,
      itemName: 'Strawberry',
      provenance: 'Nostr Farm',
      statDeltas: { hunger: 50 },
    });
    expect(provenanceCue(feedback)).toBe('From Nostr Farm');
  });

  it('has no provenance for an Island item, and no cue', () => {
    const feedback = careFeedbackFrom(effect, { id: 'care-1', itemName: 'Apple' });
    expect('provenance' in feedback).toBe(false);
    expect(provenanceCue(feedback)).toBeNull();
  });

  it('lists only the stats that moved, hunger first, with the sign', () => {
    expect(statGains({ hunger: 25, happiness: 0, health: 0, hygiene: 0, energy: 0 }).map((g) => g.text)).toEqual(['+25 Hunger']);
    expect(
      statGains({ hunger: 0, happiness: 10, health: 5, hygiene: 0, energy: -3 }).map((g) => g.text),
    ).toEqual(['+10 Happiness', '-3 Energy', '+5 Health']);
    expect(statGains({ hunger: 0, happiness: 0, health: 0, hygiene: 0, energy: 0 })).toEqual([]);
  });

  it('formats a delta with its sign', () => {
    expect(formatStatDelta(25)).toBe('+25');
    expect(formatStatDelta(-4)).toBe('-4');
    expect(formatStatDelta(0)).toBe('0');
  });

  it('mints a distinct id per Island consumption', () => {
    const ids = new Set(Array.from({ length: 50 }, () => mintCareFeedbackId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.startsWith('care:')).toBe(true);
  });
});
