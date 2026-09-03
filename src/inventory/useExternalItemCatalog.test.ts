/**
 * The trust gate in front of external definition resolution.
 *
 * `groupTrustedRequests` is where an untrusted issuer stops. It runs BEFORE any
 * query is constructed, which is the property worth testing: an item Island
 * will not show must also be an item Island does not connect to a relay about.
 *
 * `selectNewestTrustedDefinitions` is the second gate, on the way back in —
 * because what a relay serves is not necessarily what was asked for.
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  groupTrustedRequests,
  isUsableRelayHint,
  selectNewestTrustedDefinitions,
} from './useExternalItemCatalog';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from './constants';
import { FARM_STRAWBERRY_EVENT } from './partner-item-event-fixtures';

const FARM_ISSUER =
  'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';
const STRANGER = 'a'.repeat(64);

const STRAWBERRY = `31632:${FARM_ISSUER}:farm:produce:strawberry`;
const CARROT = `31632:${FARM_ISSUER}:farm:produce:carrot`;
const IMPOSTOR = `31632:${STRANGER}:farm:produce:strawberry`;
const BLOBBI_APPLE = `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:blobbi:food:apple`;

const ref = (address: string, relay = '') => ({ address, relay, quantity: 1 });

describe('grouping by trusted issuer', () => {
  it('groups a partner\'s items into one request keyed by their pubkey', () => {
    const [request, ...rest] = groupTrustedRequests([
      ref(STRAWBERRY),
      ref(CARROT),
    ]);

    expect(rest).toHaveLength(0);
    expect(request.issuer.pubkey).toBe(FARM_ISSUER);
    expect(request.dTags).toEqual(['farm:produce:carrot', 'farm:produce:strawberry']);
    expect([...request.addresses]).toContain(STRAWBERRY);
  });

  it('drops an untrusted issuer entirely — no request, so no query', () => {
    expect(groupTrustedRequests([ref(`31632:${STRANGER}:anything`)])).toEqual([]);
  });

  it('drops the SAME `d` published under an untrusted key', () => {
    const requests = groupTrustedRequests([ref(STRAWBERRY), ref(IMPOSTOR)]);
    expect(requests).toHaveLength(1);
    expect(requests[0].issuer.pubkey).toBe(FARM_ISSUER);
    expect([...requests[0].addresses]).toEqual([STRAWBERRY]);
  });

  it("leaves this game's own items to the official catalog", () => {
    expect(groupTrustedRequests([ref(BLOBBI_APPLE)])).toEqual([]);
  });

  it('drops references that are not well-formed addresses', () => {
    expect(groupTrustedRequests([ref('farm:produce:strawberry'), ref('')])).toEqual([]);
  });
});

describe('relay hints', () => {
  it('accepts only ws/wss URLs', () => {
    expect(isUsableRelayHint('wss://relay.primal.net')).toBe(true);
    expect(isUsableRelayHint('ws://localhost:4869')).toBe(true);
    expect(isUsableRelayHint('https://example.com')).toBe(false);
    expect(isUsableRelayHint('javascript:alert(1)')).toBe(false);
    expect(isUsableRelayHint('not a url')).toBe(false);
    expect(isUsableRelayHint('')).toBe(false);
  });

  it('collects a trusted issuer\'s hints, deduped and capped', () => {
    const [request] = groupTrustedRequests([
      ref(STRAWBERRY, 'wss://relay.primal.net'),
      ref(CARROT, 'wss://relay.primal.net'),
      ref(`31632:${FARM_ISSUER}:farm:produce:pumpkin`, 'wss://a.example'),
      ref(`31632:${FARM_ISSUER}:farm:produce:parsnip`, 'wss://b.example'),
    ]);

    expect(request.hints).toEqual(['wss://relay.primal.net', 'wss://a.example']);
  });

  it('never collects a hint from an untrusted issuer', () => {
    // The hint rides on an `a` tag; an untrusted issuer's reference is dropped
    // before its hint can influence which relays are opened.
    expect(groupTrustedRequests([ref(IMPOSTOR, 'wss://attacker.example')])).toEqual([]);
  });
});

describe('selecting definitions coming back', () => {
  const expected = new Set([STRAWBERRY]);

  it('accepts the trusted issuer\'s definition for a requested address', () => {
    const selected = selectNewestTrustedDefinitions([[FARM_STRAWBERRY_EVENT]], expected);
    expect(selected.get(STRAWBERRY)?.name).toBe('Strawberry');
  });

  it('rejects the same `d` signed by somebody else', () => {
    const impostor: NostrEvent = {
      ...FARM_STRAWBERRY_EVENT,
      pubkey: STRANGER,
      id: 'impostor',
      sig: '',
    };
    expect(selectNewestTrustedDefinitions([[impostor]], expected).size).toBe(0);
  });

  it('rejects a trusted definition nobody asked for', () => {
    // A relay that answers with extra events cannot inject them into the
    // catalog: only the addresses this fetch requested are admitted.
    expect(
      selectNewestTrustedDefinitions([[FARM_STRAWBERRY_EVENT]], new Set([CARROT])).size,
    ).toBe(0);
  });

  it('keeps the newest valid revision across relays', () => {
    const older: NostrEvent = {
      ...FARM_STRAWBERRY_EVENT,
      id: 'older',
      created_at: FARM_STRAWBERRY_EVENT.created_at - 100,
      tags: FARM_STRAWBERRY_EVENT.tags.map((t) =>
        t[0] === 'name' ? ['name', 'Old Strawberry'] : t,
      ),
    };
    const selected = selectNewestTrustedDefinitions(
      [[older], [FARM_STRAWBERRY_EVENT]],
      expected,
    );
    expect(selected.get(STRAWBERRY)?.name).toBe('Strawberry');
  });

  it('does not let a newer INVALID event hide an older valid one', () => {
    const newerBroken: NostrEvent = {
      ...FARM_STRAWBERRY_EVENT,
      id: 'broken',
      created_at: FARM_STRAWBERRY_EVENT.created_at + 100,
      // No `name`/`type` — not a definition at any age.
      tags: [['d', 'farm:produce:strawberry']],
    };
    const selected = selectNewestTrustedDefinitions(
      [[newerBroken], [FARM_STRAWBERRY_EVENT]],
      expected,
    );
    expect(selected.get(STRAWBERRY)?.name).toBe('Strawberry');
  });
});
