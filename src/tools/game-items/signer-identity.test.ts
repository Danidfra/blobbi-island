/**
 * Signer identity and the access policy that hangs off it.
 *
 * The assertion that matters most is negative: a third-party key must never be
 * described as `official`, no matter what it publishes or how it is spelled.
 */

import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';

import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';

import { canPublish, describeSigner, isOfficialIssuer, safeNpub, shortHex } from './signer-identity';

const OTHER = 'd'.repeat(64);

describe('describeSigner', () => {
  it('reports unauthenticated with no signer', () => {
    for (const value of [undefined, null, '']) {
      const identity = describeSigner(value);
      expect(identity.mode).toBe('unauthenticated');
      expect(identity.pubkey).toBeNull();
      expect(identity.isOfficialIssuer).toBe(false);
      expect(canPublish(identity)).toBe(false);
    }
  });

  it('recognizes the official issuer', () => {
    const identity = describeSigner(OFFICIAL_ITEM_ISSUER_PUBKEY);
    expect(identity.mode).toBe('official');
    expect(identity.isOfficialIssuer).toBe(true);
    expect(canPublish(identity)).toBe(true);
    expect(identity.npub).toBe(nip19.npubEncode(OFFICIAL_ITEM_ISSUER_PUBKEY));
  });

  it('reports any other key as third-party, and still allows publishing', () => {
    const identity = describeSigner(OTHER);
    expect(identity.mode).toBe('third-party');
    expect(identity.isOfficialIssuer).toBe(false);
    expect(canPublish(identity)).toBe(true);
  });

  it('exposes both npub and abbreviated hex', () => {
    const identity = describeSigner(OTHER);
    expect(identity.npub?.startsWith('npub1')).toBe(true);
    expect(identity.shortHex).toBe(shortHex(OTHER));
    expect(identity.shortHex).toContain('…');
  });
});

describe('safeNpub', () => {
  it('returns null rather than throwing on a malformed pubkey', () => {
    expect(safeNpub('not-hex')).toBeNull();
    expect(safeNpub('')).toBeNull();
    expect(safeNpub(undefined)).toBeNull();
  });
});

describe('shortHex', () => {
  it('leaves short values alone', () => {
    expect(shortHex('abc')).toBe('abc');
  });
});

describe('isOfficialIssuer', () => {
  it('matches only the exact official pubkey', () => {
    expect(isOfficialIssuer(OFFICIAL_ITEM_ISSUER_PUBKEY)).toBe(true);
    expect(isOfficialIssuer(OFFICIAL_ITEM_ISSUER_PUBKEY.toUpperCase())).toBe(false);
    expect(isOfficialIssuer(OTHER)).toBe(false);
    expect(isOfficialIssuer(null)).toBe(false);
  });
});
