/**
 * Spend-aware derivation of an external inventory.
 *
 * Every RULE here is the package's (`resolveGameInventoryState`); what these
 * tests pin is that Island feeds it the right inputs and presents the answer
 * honestly — and, above all, the transition the whole design hinges on:
 *
 *   raw 3 + pending S1        → effective 2
 *   raw 2 + S1 folded by 1417 → effective 2   (never 1)
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  effectiveQuantity,
  missingFoldReferences,
  resolveExternalInventoryState,
} from './external-inventory-state';
import {
  KIND_GAME_INVENTORY,
  KIND_GAME_INVENTORY_FOLD,
  KIND_GAME_INVENTORY_SPEND,
  getInventoryItemQuantity,
} from './package';
import { parseInventoryEvent } from './protocol-adapter';

const OWNER = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);
const FARM_ISSUER = 'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';
const STRAWBERRY = `31632:${FARM_ISSUER}:farm:produce:strawberry`;
const CARROT = `31632:${FARM_ISSUER}:farm:produce:carrot`;
const FARM_MAIN = `31633:${OWNER}:farm:main`;
const CHEST = `31633:${OWNER}:guild:chest`;

function hex(seed: string): string {
  // Deterministic 64-hex id from a short label, so ordering by id is stable.
  return seed.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, '0');
}

function snapshot(items: [string, number][], options: { fold?: string; createdAt?: number } = {}) {
  const tags: string[][] = [['d', 'farm:main']];
  for (const [address, quantity] of items) tags.push(['a', address, '', String(quantity)]);
  if (options.fold) tags.push(['e', options.fold, 'wss://relay.primal.net', 'fold']);
  return parseInventoryEvent({
    id: hex('5'),
    pubkey: OWNER,
    created_at: options.createdAt ?? 1000,
    kind: KIND_GAME_INVENTORY,
    tags,
    content: '',
    sig: '',
  })!;
}

function spend(
  id: string,
  options: { item?: string; qty?: number; createdAt?: number; author?: string; inventory?: string } = {},
): NostrEvent {
  return {
    id: hex(id),
    pubkey: options.author ?? OWNER,
    created_at: options.createdAt ?? 2000,
    kind: KIND_GAME_INVENTORY_SPEND,
    tags: [
      ['a', options.inventory ?? FARM_MAIN, '', 'inventory'],
      ['a', options.item ?? STRAWBERRY, '', 'item'],
      ['quantity', String(options.qty ?? 1)],
    ],
    content: '',
    sig: '',
  };
}

function fold(
  id: string,
  options: { spends?: string[]; voids?: string[]; previous?: string; author?: string; inventory?: string } = {},
): NostrEvent {
  const tags: string[][] = [['a', options.inventory ?? FARM_MAIN, '', 'inventory']];
  if (options.previous) tags.push(['e', options.previous, '', 'previous']);
  for (const s of options.spends ?? []) tags.push(['e', s, '', 'spend']);
  for (const v of options.voids ?? []) tags.push(['e', v, '', 'void']);
  return {
    id: hex(id),
    pubkey: options.author ?? OWNER,
    created_at: 3000,
    kind: KIND_GAME_INVENTORY_FOLD,
    tags,
    content: '',
    sig: '',
  };
}

const qty = (r: ReturnType<typeof resolveExternalInventoryState>, address = STRAWBERRY) =>
  effectiveQuantity(r, address);

describe('effective quantity', () => {
  it('equals the raw snapshot when there are no spends', () => {
    const r = resolveExternalInventoryState({ snapshot: snapshot([[STRAWBERRY, 3]]), folds: [], spends: [] });
    expect(r.status).toBe('ready');
    expect(qty(r)).toBe(3);
  });

  it('one pending spend reduces it', () => {
    const r = resolveExternalInventoryState({ snapshot: snapshot([[STRAWBERRY, 3]]), folds: [], spends: [spend('s1')] });
    expect(qty(r)).toBe(2);
    expect(r.status === 'ready' && r.state.applied.map((s) => s.id)).toEqual([hex('s1')]);
  });

  it('a folded spend is NOT subtracted again', () => {
    const r = resolveExternalInventoryState({
      snapshot: snapshot([[STRAWBERRY, 2]], { fold: hex('f1') }),
      folds: [fold('f1', { spends: [hex('s1')] })],
      spends: [spend('s1')],
    });
    expect(r.status).toBe('ready');
    expect(qty(r)).toBe(2);
  });

  it('a voided spend is not subtracted', () => {
    const r = resolveExternalInventoryState({
      snapshot: snapshot([[STRAWBERRY, 3]], { fold: hex('f1') }),
      folds: [fold('f1', { voids: [hex('s1')] })],
      spends: [spend('s1')],
    });
    expect(qty(r)).toBe(3);
  });

  it('a late spend with an OLDER timestamp than the snapshot still counts as pending', () => {
    const r = resolveExternalInventoryState({
      snapshot: snapshot([[STRAWBERRY, 3]], { createdAt: 5000 }),
      folds: [],
      spends: [spend('s1', { createdAt: 10 })],
    });
    expect(qty(r)).toBe(2);
  });

  it('delegates same-created_at ordering to the package: the lower id wins the last unit', () => {
    const r = resolveExternalInventoryState({
      snapshot: snapshot([[STRAWBERRY, 1]]),
      folds: [],
      spends: [spend('bbbb', { createdAt: 2000 }), spend('aaaa', { createdAt: 2000 })],
    });
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.state.applied.map((s) => s.id)).toEqual([hex('aaaa')]);
    expect(r.state.rejected.map((s) => s.id)).toEqual([hex('bbbb')]);
    expect(qty(r)).toBe(0);
  });

  it('counts duplicate relay copies once', () => {
    const copy = spend('s1');
    const r = resolveExternalInventoryState({
      snapshot: snapshot([[STRAWBERRY, 3]]),
      folds: [],
      spends: [copy, { ...copy }, { ...copy }],
    });
    expect(qty(r)).toBe(2);
  });

  it('ignores a spend by anybody but the owner, via the package', () => {
    const r = resolveExternalInventoryState({
      snapshot: snapshot([[STRAWBERRY, 3]]),
      folds: [],
      spends: [spend('s1', { author: STRANGER })],
    });
    expect(qty(r)).toBe(3);
    expect(r.status === 'ready' && r.state.invalid.length).toBe(1);
  });

  it('a spend against ANOTHER inventory cannot affect this one', () => {
    const r = resolveExternalInventoryState({
      snapshot: snapshot([[STRAWBERRY, 3]]),
      folds: [],
      spends: [spend('s1', { inventory: CHEST })],
    });
    expect(qty(r)).toBe(3);
    expect(r.status === 'ready' && r.state.ignored.length).toBe(1);
  });

  it('rejects an overdraw in full, never partially', () => {
    const r = resolveExternalInventoryState({
      snapshot: snapshot([[STRAWBERRY, 1]]),
      folds: [],
      spends: [spend('s1', { qty: 2 })],
    });
    expect(qty(r)).toBe(1);
  });

  it('keeps items the spends never touched', () => {
    const r = resolveExternalInventoryState({
      snapshot: snapshot([[STRAWBERRY, 3], [CARROT, 1]]),
      folds: [],
      spends: [spend('s1')],
    });
    expect(qty(r, CARROT)).toBe(1);
  });
});

describe('the pending → folded transition', () => {
  it('leaves the effective quantity where it was: raw3+pending1 = 2, then raw2+folded1 = 2', () => {
    const s1 = spend('s1');
    const before = resolveExternalInventoryState({ snapshot: snapshot([[STRAWBERRY, 3]]), folds: [], spends: [s1] });
    expect(qty(before)).toBe(2);

    // The owner folds S1 into a new snapshot, and the reader still has S1 in
    // its spend set (it is immutable; it never goes away).
    const after = resolveExternalInventoryState({
      snapshot: snapshot([[STRAWBERRY, 2]], { fold: hex('f1') }),
      folds: [fold('f1', { spends: [hex('s1')] })],
      spends: [s1],
    });
    expect(qty(after)).toBe(2);

    // And a NEW spend after the fold is pending against the new snapshot.
    const later = resolveExternalInventoryState({
      snapshot: snapshot([[STRAWBERRY, 2]], { fold: hex('f1') }),
      folds: [fold('f1', { spends: [hex('s1')] })],
      spends: [s1, spend('s2', { createdAt: 4000 })],
    });
    expect(qty(later)).toBe(1);
  });

  it('follows previous links through a chain', () => {
    const r = resolveExternalInventoryState({
      snapshot: snapshot([[STRAWBERRY, 1]], { fold: hex('f2') }),
      folds: [fold('f1', { spends: [hex('s1')] }), fold('f2', { previous: hex('f1'), spends: [hex('s2')] })],
      spends: [spend('s1'), spend('s2')],
    });
    expect(r.status).toBe('ready');
    expect(qty(r)).toBe(1);
  });
});

describe('the unresolved state', () => {
  it('a snapshot referencing a manifest that cannot be retrieved has NO balance', () => {
    const r = resolveExternalInventoryState({
      snapshot: snapshot([[STRAWBERRY, 3]], { fold: hex('f1') }),
      folds: [],
      spends: [spend('s1')],
    });
    expect(r.status).toBe('unresolved');
    expect(qty(r)).toBe(0);
    expect(r.status === 'unresolved' && r.problems.map((p) => p.code)).toEqual(['missing-fold']);
  });

  it('a manifest scoped to another inventory fails the chain', () => {
    const r = resolveExternalInventoryState({
      snapshot: snapshot([[STRAWBERRY, 3]], { fold: hex('f1') }),
      folds: [fold('f1', { spends: [hex('s1')], inventory: CHEST })],
      spends: [spend('s1')],
    });
    expect(r.status).toBe('unresolved');
  });

  it('names the missing manifests with the best relay hint the chain offers', () => {
    const snap = snapshot([[STRAWBERRY, 3]], { fold: hex('f2') });
    const r = resolveExternalInventoryState({
      snapshot: snap,
      folds: [fold('f2', { previous: hex('f1'), spends: [hex('s2')] })],
      spends: [],
    });
    expect(r.status).toBe('unresolved');
    if (r.status !== 'unresolved') return;
    expect(missingFoldReferences(snap, r.chain)).toEqual([{ eventId: hex('f1'), relay: '' }]);
  });
});

describe('sanity: package quantity helper agrees', () => {
  it('reads the same effective number the derivation reports', () => {
    const r = resolveExternalInventoryState({ snapshot: snapshot([[STRAWBERRY, 3]]), folds: [], spends: [spend('s1')] });
    expect(r.status === 'ready' && getInventoryItemQuantity(r.inventory, STRAWBERRY)).toBe(2);
  });
});
