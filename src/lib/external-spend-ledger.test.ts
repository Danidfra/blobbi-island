import { describe, it, expect, beforeEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  clearExternalSpendOps,
  openExternalSpendOps,
  persistExternalSpendOp,
  readExternalSpendOp,
  type ExternalSpendRecord,
} from './external-spend-ledger';

const PUBKEY = 'a'.repeat(64);
const event: NostrEvent = { id: 's1', pubkey: PUBKEY, created_at: 1, kind: 1416, tags: [], content: '', sig: '' };

function record(status: ExternalSpendRecord['status'], overrides: Partial<ExternalSpendRecord> = {}): ExternalSpendRecord {
  return {
    spendId: 's1',
    inventoryAddress: `31633:${PUBKEY}:farm:main`,
    itemAddress: '31632:x:y',
    quantity: 1,
    petId: 'pet',
    status,
    event,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => clearExternalSpendOps());

describe('the external-spend ledger', () => {
  it('stores the SIGNED EVENT with the record, so a retry can republish it verbatim', () => {
    expect(persistExternalSpendOp(PUBKEY, record('signed'))).toBe(true);
    expect(readExternalSpendOp(PUBKEY, 's1')?.event).toEqual(event);
  });

  it('advances forward and never regresses a possibly-published spend', () => {
    persistExternalSpendOp(PUBKEY, record('publishing'));
    expect(persistExternalSpendOp(PUBKEY, record('unconfirmed'))).toBe(true);
    expect(persistExternalSpendOp(PUBKEY, record('signed'))).toBe(false);
    expect(persistExternalSpendOp(PUBKEY, record('established'))).toBe(true);
    expect(persistExternalSpendOp(PUBKEY, record('unconfirmed'))).toBe(false);
    expect(readExternalSpendOp(PUBKEY, 's1')?.status).toBe('established');
  });

  it('an established spend can never become failed — the debit exists', () => {
    persistExternalSpendOp(PUBKEY, record('established'));
    expect(persistExternalSpendOp(PUBKEY, record('failed'))).toBe(false);
  });

  it('an unconfirmed spend may become failed only through a definite refusal on republish', () => {
    persistExternalSpendOp(PUBKEY, record('unconfirmed'));
    expect(persistExternalSpendOp(PUBKEY, record('failed'))).toBe(true);
  });

  it('applied and failed are terminal', () => {
    persistExternalSpendOp(PUBKEY, record('applied'));
    expect(persistExternalSpendOp(PUBKEY, record('established'))).toBe(false);
    expect(persistExternalSpendOp(PUBKEY, record('applied'))).toBe(true);
  });

  it('lists the unfinished consumptions of one row, oldest first, and nothing else', () => {
    persistExternalSpendOp(PUBKEY, record('established', { spendId: 'b', createdAt: 2 }));
    persistExternalSpendOp(PUBKEY, record('unconfirmed', { spendId: 'a', createdAt: 1 }));
    persistExternalSpendOp(PUBKEY, record('applied', { spendId: 'c', createdAt: 0 }));
    persistExternalSpendOp(PUBKEY, record('failed', { spendId: 'd', createdAt: 0 }));
    persistExternalSpendOp(PUBKEY, record('established', { spendId: 'e', itemAddress: '31632:x:other' }));
    persistExternalSpendOp(PUBKEY, record('established', { spendId: 'f', petId: 'other-pet' }));
    expect(
      openExternalSpendOps(PUBKEY, `31633:${PUBKEY}:farm:main`, '31632:x:y', 'pet').map((r) => r.spendId),
    ).toEqual(['a', 'b']);
  });

  it('is per pubkey', () => {
    persistExternalSpendOp(PUBKEY, record('established'));
    expect(readExternalSpendOp('b'.repeat(64), 's1')).toBeNull();
  });
});
