/**
 * The registry the Station presents: Nostr Farm is real, points at the
 * official site, launches externally, and speaks to players rather than to
 * protocol authors.
 */
import { describe, expect, it } from 'vitest';

import { classifyDestination } from '@/external-egress';
import { getTrustedItemIssuer, TRUSTED_ITEM_ISSUERS } from '@/inventory/trusted-issuers';

import {
  CONNECTED_EXPERIENCES,
  NOSTR_FARM_EXPERIENCE,
  NOSTR_FARM_URL,
  connectedExperienceUrlOverrides,
  getConnectedExperience,
  overrideEnvName,
  resolveConnectedExperienceUrl,
} from './connected-experiences-config';
import { clearLaunchHint, hasSeenLaunchHint, markLaunchHintSeen } from './launch-hint';

describe('the Nostr Farm experience', () => {
  it('is the one connected experience, with a stable id', () => {
    expect(CONNECTED_EXPERIENCES).toEqual([NOSTR_FARM_EXPERIENCE]);
    expect(NOSTR_FARM_EXPERIENCE.id).toBe('nostr-farm');
    expect(getConnectedExperience('nostr-farm')).toBe(NOSTR_FARM_EXPERIENCE);
    expect(getConnectedExperience('nope')).toBeUndefined();
  });

  it('resolves to the official site, and launches externally', () => {
    expect(NOSTR_FARM_URL).toBe('https://farm.blobbi.pet');
    expect(NOSTR_FARM_EXPERIENCE.url).toBe(NOSTR_FARM_URL);
    expect(resolveConnectedExperienceUrl(NOSTR_FARM_EXPERIENCE, {})).toBe('https://farm.blobbi.pet');
    expect(NOSTR_FARM_EXPERIENCE.launchMode).toBe('external');
  });

  it('is a destination the egress boundary will accept as external', () => {
    const destination = classifyDestination(NOSTR_FARM_URL, 'https://island.blobbi.pet');
    expect(destination.kind).toBe('external');
    if (destination.kind === 'external') expect(destination.host).toBe('farm.blobbi.pet');
  });

  it('names its source the way the inventory does', () => {
    const farm = TRUSTED_ITEM_ISSUERS.find((issuer) => issuer.role === 'partner')!;
    expect(NOSTR_FARM_EXPERIENCE.sourceLabel).toBe(getTrustedItemIssuer(farm.pubkey)?.label);
  });

  it('speaks to players: no kind numbers, relays, issuers or manifests in the copy', () => {
    const copy = [
      NOSTR_FARM_EXPERIENCE.name,
      NOSTR_FARM_EXPERIENCE.tagline,
      NOSTR_FARM_EXPERIENCE.description,
      NOSTR_FARM_EXPERIENCE.interoperability,
    ].join(' ');
    expect(copy).not.toMatch(/\b(kind|3163\d|1416|1417|relay|issuer|pubkey|npub|manifest|fold)\b/i);
    expect(copy).toMatch(/harvest|grow/i);
    expect(copy).toMatch(/Blobbi Island/);
  });
});

describe('destination overrides', () => {
  it('derives one environment name per experience', () => {
    expect(overrideEnvName('nostr-farm')).toBe('VITE_CONNECTED_EXPERIENCE_URL_NOSTR_FARM');
  });

  it('an override replaces the registry URL for that experience only', () => {
    const overrides = connectedExperienceUrlOverrides({
      VITE_CONNECTED_EXPERIENCE_URL_NOSTR_FARM: ' https://farm.local.test ',
    });
    expect(overrides).toEqual({ 'nostr-farm': 'https://farm.local.test' });
    expect(resolveConnectedExperienceUrl(NOSTR_FARM_EXPERIENCE, overrides)).toBe('https://farm.local.test');
  });

  it('a blank or absent override leaves the registry URL in place', () => {
    expect(connectedExperienceUrlOverrides({ VITE_CONNECTED_EXPERIENCE_URL_NOSTR_FARM: '  ' })).toEqual({});
    expect(connectedExperienceUrlOverrides({})).toEqual({});
    expect(resolveConnectedExperienceUrl(NOSTR_FARM_EXPERIENCE, connectedExperienceUrlOverrides({}))).toBe(
      NOSTR_FARM_URL,
    );
  });
});

describe('the first-launch note', () => {
  it('is unseen until marked, per experience, and survives a refused store', () => {
    clearLaunchHint('nostr-farm');
    expect(hasSeenLaunchHint('nostr-farm')).toBe(false);
    markLaunchHintSeen('nostr-farm');
    expect(hasSeenLaunchHint('nostr-farm')).toBe(true);
    expect(hasSeenLaunchHint('other')).toBe(false);
    clearLaunchHint('nostr-farm');

    const refusing = {
      getItem: () => {
        throw new Error('no');
      },
      setItem: () => {
        throw new Error('no');
      },
      removeItem: () => {
        throw new Error('no');
      },
    };
    expect(hasSeenLaunchHint('nostr-farm', refusing)).toBe(false);
    expect(() => markLaunchHintSeen('nostr-farm', refusing)).not.toThrow();
  });
});
