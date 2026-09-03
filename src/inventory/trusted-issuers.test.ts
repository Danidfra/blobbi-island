/**
 * The trusted issuer set — what it says, and what it deliberately does not.
 *
 * This is the whole of the cross-game trust decision, so it is worth pinning
 * that it stays a decision about KEYS. The failure this guards against is
 * subtle and would be invisible in a rendered grid: trusting an item because
 * its `d` looks familiar, rather than because its issuer is known.
 */

import { describe, it, expect } from 'vitest';

import {
  TRUSTED_ITEM_ISSUERS,
  TRUSTED_PARTNER_ISSUERS,
  getTrustedItemIssuer,
  isTrustedItemIssuer,
  isTrustedPartnerIssuer,
} from './trusted-issuers';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from './constants';

const FARM_ISSUER =
  'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';

describe('who is trusted', () => {
  it('trusts the official Blobbi issuer', () => {
    expect(isTrustedItemIssuer(OFFICIAL_ITEM_ISSUER_PUBKEY)).toBe(true);
    expect(getTrustedItemIssuer(OFFICIAL_ITEM_ISSUER_PUBKEY)?.role).toBe('blobbi');
  });

  it('trusts the Farm issuer, with a player-facing label', () => {
    expect(isTrustedItemIssuer(FARM_ISSUER)).toBe(true);
    const issuer = getTrustedItemIssuer(FARM_ISSUER);
    expect(issuer?.role).toBe('partner');
    expect(issuer?.label).toBe('Farm');
    expect(issuer?.relays.length).toBeGreaterThan(0);
  });

  it('trusts nobody else', () => {
    expect(isTrustedItemIssuer('b'.repeat(64))).toBe(false);
    expect(getTrustedItemIssuer('b'.repeat(64))).toBeNull();
    expect(isTrustedItemIssuer(undefined)).toBe(false);
    expect(isTrustedItemIssuer('')).toBe(false);
  });

  it('compares the WHOLE key — a prefix is a different person', () => {
    expect(isTrustedItemIssuer(FARM_ISSUER.slice(0, 60))).toBe(false);
    expect(isTrustedItemIssuer(`${FARM_ISSUER}00`)).toBe(false);
    expect(isTrustedItemIssuer(FARM_ISSUER.toUpperCase())).toBe(false);
  });
});

describe('partner separation', () => {
  it('lists partners without this game', () => {
    expect(TRUSTED_PARTNER_ISSUERS.map((i) => i.pubkey)).toEqual([FARM_ISSUER]);
    expect(isTrustedPartnerIssuer(OFFICIAL_ITEM_ISSUER_PUBKEY)).toBe(false);
    expect(isTrustedPartnerIssuer(FARM_ISSUER)).toBe(true);
  });
});

describe('the table records issuers, not products', () => {
  it('encodes no item `d` values for any issuer', () => {
    // The rule this asserts: Blobbi learns what a partner's items are by
    // reading their published definitions. Recording a crop id here would make
    // every new partner item a Blobbi release, and would re-introduce `d` as an
    // identity — the exact thing full addresses exist to prevent.
    const serialized = JSON.stringify(TRUSTED_ITEM_ISSUERS);
    expect(serialized).not.toContain('farm:produce');
    expect(serialized).not.toContain('strawberry');
    for (const issuer of TRUSTED_ITEM_ISSUERS) {
      expect(Object.keys(issuer).sort()).toEqual([
        'label',
        'pubkey',
        'relays',
        'role',
      ]);
    }
  });

  it('has unique keys', () => {
    const keys = TRUSTED_ITEM_ISSUERS.map((i) => i.pubkey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
