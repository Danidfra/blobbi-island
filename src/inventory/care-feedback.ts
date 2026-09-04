/**
 * Blobbi Island: what the player is SHOWN after a successful consumption.
 *
 * A consumption ends in an {@link AppliedCareEffect} (what happened to the
 * Blobbi) plus, for an item from another game, a source (where it came
 * from). This module turns the two into one presentation model, the
 * {@link CareFeedback}, that a surface can render as a short in-world
 * moment: the Blobbi reacts, `+25 Hunger` floats up, and, for Farm produce,
 * `From Nostr Farm` follows it.
 *
 * Two rules keep it generic:
 *
 *  - the CARE part comes only from the applied effect: the real, clamped
 *    stat deltas of this one action, scaled by its quantity, never a number
 *    typed here and never inferred from an item's name;
 *  - the PROVENANCE part comes only from the source: the trusted issuer's
 *    product name, present for an external row and absent for Island's own
 *    items. Nothing here knows what a strawberry is.
 *
 * Pure. No React, no relay, no timers.
 */

import type { AppliedCareEffect, CareStats } from './care-effect';
import type { ItemAction } from './catalog-fallback';

/** One successful logical consumption, ready to show. */
export interface CareFeedback {
  /**
   * Identity of the logical action: the spend id for an external
   * consumption, a fresh id for an Island one. A surface keys its reaction
   * on this, so a re-render, an optimistic-then-confirmed refresh or a
   * repeated callback for the same action can never play it twice.
   */
  id: string;
  action: ItemAction;
  quantity: number;
  itemName: string;
  /** The real clamped change per stat for this action. */
  statDeltas: CareStats;
  experienceGained: number;
  /**
   * The product name of the game the item came from ("Nostr Farm"), or
   * `undefined` for Island's own items, which get no provenance cue.
   */
  provenance?: string;
}

/** Display order and labels for the stat gains. Hunger first: it is the feed. */
const STAT_LABELS: ReadonlyArray<readonly [keyof CareStats, string]> = [
  ['hunger', 'Hunger'],
  ['happiness', 'Happiness'],
  ['energy', 'Energy'],
  ['hygiene', 'Hygiene'],
  ['health', 'Health'],
];

export interface StatGain {
  stat: keyof CareStats;
  label: string;
  /** Signed. `+25` renders as "+25"; a negative effect keeps its sign. */
  value: number;
  /** "+25 Hunger" */
  text: string;
}

/** Build the feedback for one applied effect. */
export function careFeedbackFrom(
  effect: AppliedCareEffect,
  detail: { id: string; itemName: string; provenance?: string },
): CareFeedback {
  return {
    id: detail.id,
    action: effect.action,
    quantity: effect.quantity,
    itemName: detail.itemName,
    statDeltas: { ...effect.statDeltas },
    experienceGained: effect.experienceGained,
    ...(detail.provenance ? { provenance: detail.provenance } : {}),
  };
}

/** "+25" / "-10". */
export function formatStatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * The stat changes worth showing, in display order: every stat that actually
 * moved. A stat the item does not touch, or one already at its cap, is
 * omitted rather than shown as "+0", so a full Blobbi fed once shows the
 * reaction and the provenance but claims no gain it did not get.
 */
export function statGains(deltas: CareStats): StatGain[] {
  const gains: StatGain[] = [];
  for (const [stat, label] of STAT_LABELS) {
    const value = deltas[stat];
    if (value === 0) continue;
    gains.push({ stat, label, value, text: `${formatStatDelta(value)} ${label}` });
  }
  return gains;
}

/** "From Nostr Farm", or `null` for an item with no provenance. */
export function provenanceCue(feedback: Pick<CareFeedback, 'provenance'>): string | null {
  return feedback.provenance ? `From ${feedback.provenance}` : null;
}

/**
 * A fresh feedback id for an Island consumption, which has no spend id.
 * Unique per call; never derived from the item, so two feeds of the same
 * item in a row are two reactions.
 */
export function mintCareFeedbackId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `care:${Date.now()}:${random}`;
}
