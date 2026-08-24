/**
 * Reports: what gets captured, what gets refused, and what deliberately is not
 * collected.
 *
 * The evidence-authorship check is the security-relevant one. Without it a
 * client could attach somebody else's signed message to a report about a third
 * party, turning the one verifiable part of a report into a way to frame people.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  MAX_STORED_REPORTS,
  PLAYER_REPORT_STORAGE_KEY,
  REPORT_CATEGORIES,
  buildPlayerReport,
  clearStoredReports,
  listReports,
  reportCategoryById,
  storeReport,
} from './report';

const REPORTED = 'a'.repeat(64);
const REPORTER = 'b'.repeat(64);
const SOMEONE_ELSE = 'c'.repeat(64);

function messageEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'e'.repeat(64),
    kind: 21201,
    pubkey: REPORTED,
    created_at: 1_800_000_000,
    sig: 's'.repeat(128),
    content: JSON.stringify({ type: 'quick', v: 1, phrase: 'hi', location: 'town', ts: 1 }),
    tags: [['l', 'town']],
    ...overrides,
  };
}

const evidence = (event = messageEvent()) => ({
  sourceEvent: event,
  messageClass: 'quick',
  renderedText: 'Hi!',
});

const input = (overrides: Record<string, unknown> = {}) => ({
  reportedPubkey: REPORTED,
  reporterPubkey: REPORTER,
  category: 'mean',
  islandId: '1',
  location: 'town',
  now: 1_800_000_500_000,
  id: 'report-1',
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  clearStoredReports();
});

afterEach(() => localStorage.clear());

describe('what a report captures', () => {
  it('records the reported player, the category and where it happened', () => {
    const built = buildPlayerReport(input());
    expect(built.ok && built.report).toMatchObject({
      reportedPubkey: REPORTED,
      reporterPubkey: REPORTER,
      category: 'mean',
      islandId: '1',
      location: 'town',
      createdAt: 1_800_000_500_000,
    });
  });

  it('keeps the signed source event, which is the verifiable part', () => {
    const built = buildPlayerReport(input({ evidence: evidence() }));
    expect(built.ok && built.report.evidence?.sourceEvent.id).toBe('e'.repeat(64));
    expect(built.ok && built.report.evidence?.sourceEvent.sig).toBe('s'.repeat(128));
    expect(built.ok && built.report.evidence?.sourceEvent.kind).toBe(21201);
  });

  it('keeps the locally rendered meaning alongside it', () => {
    // The signed event for a structured message is only ids — meaningless to a
    // reviewer. The rendered text is what those ids meant here.
    const built = buildPlayerReport(input({ evidence: evidence() }));
    expect(built.ok && built.report.evidence?.renderedText).toBe('Hi!');
    expect(built.ok && built.report.evidence?.messageClass).toBe('quick');
  });

  it('records the NIP-56 equivalent so the record stays translatable', () => {
    const built = buildPlayerReport(input({ category: 'spam' }));
    expect(built.ok && built.report.nip56Type).toBe('spam');
  });

  it('files a report about a player when there is no message', () => {
    const built = buildPlayerReport(input({ evidence: null }));
    expect(built.ok && built.report.evidence).toBeNull();
  });

  it('collects nothing beyond the message, the room and the category', () => {
    // Data minimisation, asserted rather than intended: a safety feature that
    // accumulates context is a surveillance feature with a helpful label.
    const built = buildPlayerReport(input({ evidence: evidence() }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.keys(built.report).sort()).toEqual(
      [
        'category',
        'createdAt',
        'evidence',
        'id',
        'islandId',
        'location',
        'nip56Type',
        'reportedPubkey',
        'reporterPubkey',
      ].sort(),
    );
    const serialized = JSON.stringify(built.report);
    // Quoted key forms, so `"reportedPubkey":` cannot false-positive on `y":`.
    for (const forbidden of ['anchor', 'movement', 'transcript', '"x":', '"y":']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('what a report refuses', () => {
  it('rejects a malformed pubkey', () => {
    expect(buildPlayerReport(input({ reportedPubkey: 'nope' }))).toEqual({
      ok: false,
      reason: 'invalid-pubkey',
    });
  });

  it('rejects an unknown category', () => {
    expect(buildPlayerReport(input({ category: 'treason' }))).toEqual({
      ok: false,
      reason: 'unknown-category',
    });
  });

  it('rejects evidence of the wrong kind', () => {
    const built = buildPlayerReport(input({ evidence: evidence(messageEvent({ kind: 1 })) }));
    expect(built).toEqual({ ok: false, reason: 'evidence-wrong-kind' });
  });

  it('rejects evidence written by someone other than the reported player', () => {
    // The framing defence: you cannot attach a stranger's signed message to a
    // report about a third party.
    const built = buildPlayerReport(
      input({ evidence: evidence(messageEvent({ pubkey: SOMEONE_ELSE })) }),
    );
    expect(built).toEqual({ ok: false, reason: 'evidence-wrong-author' });
  });

  it('rejects evidence with no event id', () => {
    const built = buildPlayerReport(input({ evidence: evidence(messageEvent({ id: '' })) }));
    expect(built).toEqual({ ok: false, reason: 'evidence-missing-id' });
  });

  it('bounds captured text', () => {
    const built = buildPlayerReport(
      input({ evidence: { ...evidence(), renderedText: 'x'.repeat(5000) } }),
    );
    expect(built.ok && built.report.evidence!.renderedText.length).toBeLessThanOrEqual(500);
  });
});

describe('categories', () => {
  it('offers a short, readable list', () => {
    // A longer list is a form, and a form is what a distressed child abandons.
    expect(REPORT_CATEGORIES).toHaveLength(5);
    for (const category of REPORT_CATEGORIES) {
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.description.length).toBeGreaterThan(0);
    }
  });

  it('maps every category onto a real NIP-56 report type', () => {
    const official = ['nudity', 'malware', 'profanity', 'illegal', 'spam', 'impersonation', 'other'];
    for (const category of REPORT_CATEGORIES) {
      expect(official).toContain(category.nip56Type);
    }
  });

  it('lands the child-safety category on `other`, because NIP-56 has no type for it', () => {
    // Recorded as a finding, not an accident: the standard's vocabulary predates
    // child-safety use cases, so "made me feel unsafe" has nowhere better to go.
    // The precise meaning survives in our own `category` field.
    expect(reportCategoryById('unsafe')?.nip56Type).toBe('other');
    expect(reportCategoryById('unsafe')?.id).toBe('unsafe');
  });

  it('rejects an unknown category id', () => {
    expect(reportCategoryById('nope')).toBeNull();
  });
});

describe('local storage', () => {
  it('stores and lists a report', () => {
    const built = buildPlayerReport(input());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(storeReport(built.report)).toBe(true);
    expect(listReports()).toHaveLength(1);
  });

  it('keeps evidence after the ephemeral source event would have expired', () => {
    // The whole reason evidence is captured at report time: kind 21201 is gone
    // from the relay ~10 s later, and nothing else remembers it.
    const built = buildPlayerReport(input({ evidence: evidence() }));
    if (!built.ok) throw new Error('expected a report');
    storeReport(built.report);

    const [stored] = listReports();
    expect(stored.evidence?.sourceEvent.id).toBe('e'.repeat(64));
    expect(stored.evidence?.renderedText).toBe('Hi!');
  });

  it('is bounded, dropping the oldest', () => {
    for (let i = 0; i < MAX_STORED_REPORTS + 10; i += 1) {
      const built = buildPlayerReport(input({ id: `report-${i}`, now: 1000 + i }));
      if (built.ok) storeReport(built.report);
    }
    expect(listReports()).toHaveLength(MAX_STORED_REPORTS);
    expect(listReports().some((report) => report.id === 'report-0')).toBe(false);
  });

  it('tolerates a corrupt store', () => {
    localStorage.setItem(PLAYER_REPORT_STORAGE_KEY, '{not json');
    expect(() => listReports()).not.toThrow();
    expect(listReports()).toEqual([]);
  });

  it('has no publication path at all', () => {
    // There is no destination for reports yet, and the dialog says so. This
    // asserts the module cannot publish rather than merely happening not to:
    // a report that quietly reached a relay would put a child's abuse history
    // on a public, permanent, undeletable log.
    const source = readFileSync(join(process.cwd(), 'src/player-safety/report.ts'), 'utf8');
    for (const forbidden of ['useNostrPublish', 'nostr.event', 'signEvent', '@nostrify/react', '1984']) {
      expect(source.includes(forbidden), `report.ts must not reference ${forbidden}`).toBe(false);
    }
  });
});
