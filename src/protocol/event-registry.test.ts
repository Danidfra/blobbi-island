/**
 * Structural invariants of the canonical protocol registry.
 *
 * These are the guarantees every downstream projection (inventory registry,
 * fallback catalog, shop catalog, generated Markdown) silently depends on. If
 * one breaks, the drift this registry exists to prevent has started.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ACTIVE_OFFICIAL_ITEMS,
  ADDRESSED_OFFICIAL_ITEMS,
  APPLICATION_EVENT_KINDS,
  ARCADE_TICKET_D,
  ARCADE_TICKET_IMAGE_URL,
  CONSUMABLE_ITEM_CATEGORIES,
  ITEM_ACTIONS,
  ITEM_CATEGORIES,
  ITEM_STAGES,
  OFFICIAL_DEFINITION_RELAYS,
  OFFICIAL_ISSUER_PUBKEY,
  RECOVERY_BOUNDARY,
  RESERVED_OFFICIAL_ITEMS,
  officialItemAddress,
  officialItemByAddress,
  officialItemByD,
} from './event-registry';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';
import { KIND_GAME_ITEM_DEFINITION } from '@nostr-games/inventory';

describe('application event kinds', () => {
  it('covers every kind the audit, NIP.md and the NIP-BB draft document', () => {
    const kinds = APPLICATION_EVENT_KINDS.map((k) => k.kind).sort((a, b) => a - b);
    expect(kinds).toEqual([
      1124, 1416, 1417, 11125, 14919, 14920, 14921, 21201, 21951, 31124, 31125,
      31632, 31633, 31634, 31950, 31951,
    ]);
  });

  it('lists each kind exactly once', () => {
    const kinds = APPLICATION_EVENT_KINDS.map((k) => k.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('does not claim ownership of the external inventory kinds', () => {
    for (const kind of [1416, 1417, 31632, 31633, 31634]) {
      const entry = APPLICATION_EVENT_KINDS.find((k) => k.kind === kind)!;
      expect(entry.ownership).toBe('external-package');
      expect(entry.owningPackage).toBe('@nostr-games/inventory');
    }
  });

  it('scopes the NIP-BB draft kinds to THIS CLIENT, not to the ecosystem', () => {
    for (const kind of [14919, 14920, 14921]) {
      const entry = APPLICATION_EVENT_KINDS.find((k) => k.kind === kind)!;
      // A fact this repository can prove: no code touches them.
      expect(entry.clientStatus, `kind ${kind}`).toBe('not-implemented');
      expect(entry.sourceFiles, `kind ${kind}`).toEqual([]);
      // The draft that defines them must stay linked.
      expect(entry.docs, `kind ${kind}`).toContain('MD/old-NIP.md');
    }
  });

  it('claims `superseded` ONLY where this repository documents a replacement', () => {
    // 14919: NIP.md's legacy table names kind 1124 as its replacement.
    const draftInteraction = APPLICATION_EVENT_KINDS.find((k) => k.kind === 14919)!;
    expect(draftInteraction.protocolStatus).toBe('superseded');
    expect(draftInteraction.supersededBy).toBe(1124);
    expect(draftInteraction.protocolStatusEvidence).toContain('NIP.md');

    // 14920 / 14921: nothing in this repository deprecates or replaces them, so
    // "Island does not implement it" must NOT be recorded as "the ecosystem
    // retired it".
    for (const kind of [14920, 14921]) {
      const entry = APPLICATION_EVENT_KINDS.find((k) => k.kind === kind)!;
      expect(entry.protocolStatus, `kind ${kind}`).toBe('undetermined');
      expect(entry.protocolStatusEvidence, `kind ${kind}`).toBeNull();
      expect(entry.supersededBy, `kind ${kind}`).toBeUndefined();
    }
  });

  it('requires a citation for every `superseded` claim, and none otherwise', () => {
    for (const k of APPLICATION_EVENT_KINDS) {
      if (k.protocolStatus === 'superseded') {
        expect(k.protocolStatusEvidence, `kind ${k.kind}`).toBeTruthy();
        expect(k.supersededBy, `kind ${k.kind}`).toBeDefined();
      } else {
        expect(k.protocolStatusEvidence, `kind ${k.kind}`).toBeNull();
      }
    }
  });

  it('never lets a not-implemented kind imply protocol deprecation', () => {
    const notImplemented = APPLICATION_EVENT_KINDS.filter(
      (k) => k.clientStatus === 'not-implemented',
    );
    expect(notImplemented.length).toBeGreaterThan(0);
    for (const k of notImplemented) {
      // Only an explicit, cited replacement may downgrade a kind.
      if (k.protocolStatus !== 'undetermined') {
        expect(k.protocolStatus, `kind ${k.kind}`).toBe('superseded');
        expect(k.protocolStatusEvidence, `kind ${k.kind}`).toBeTruthy();
      }
    }
  });

  it('gives every addressable/replaceable kind an address format, and no other', () => {
    for (const k of APPLICATION_EVENT_KINDS) {
      if (k.eventClass === 'addressable') {
        expect(k.addressFormat, `kind ${k.kind}`).toBeTruthy();
        expect(k.addressFormat!.startsWith(`${k.kind}:`)).toBe(true);
      } else {
        expect(k.addressFormat, `kind ${k.kind}`).toBeNull();
      }
    }
  });

  it('places every kind number in the range its class requires (NIP-01)', () => {
    for (const k of APPLICATION_EVENT_KINDS) {
      const n = k.kind;
      if (k.eventClass === 'addressable') {
        expect(n >= 30000 && n < 40000, `kind ${n}`).toBe(true);
      } else if (k.eventClass === 'ephemeral') {
        expect(n >= 20000 && n < 30000, `kind ${n}`).toBe(true);
      } else if (k.eventClass === 'replaceable') {
        expect(n >= 10000 && n < 20000, `kind ${n}`).toBe(true);
      }
    }
  });

  it('records an implementing file for every implemented kind', () => {
    for (const k of APPLICATION_EVENT_KINDS) {
      if (k.clientStatus === 'implemented' || k.clientStatus === 'read-only') {
        expect(k.sourceFiles.length, `kind ${k.kind}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('item categories', () => {
  it('includes currency alongside the five care categories', () => {
    expect([...ITEM_CATEGORIES]).toEqual([
      'food',
      'toy',
      'medicine',
      'hygiene',
      'energy',
      'currency',
    ]);
  });

  it('excludes currency from the consumable categories', () => {
    expect(CONSUMABLE_ITEM_CATEGORIES).not.toContain('currency');
    expect(CONSUMABLE_ITEM_CATEGORIES).toHaveLength(ITEM_CATEGORIES.length - 1);
  });

  it('keeps the action and stage vocabularies stable', () => {
    expect([...ITEM_ACTIONS]).toEqual([
      'feed',
      'play',
      'medicine',
      'clean',
      'boost',
    ]);
    expect([...ITEM_STAGES]).toEqual(['egg', 'baby', 'adult']);
  });
});

describe('official item definitions', () => {
  it('gives every entry a unique d', () => {
    const ds = ADDRESSED_OFFICIAL_ITEMS.map((i) => i.d);
    expect(new Set(ds).size).toBe(ds.length);
  });

  it('gives every entry a unique itemId', () => {
    const ids = ADDRESSED_OFFICIAL_ITEMS.map((i) => i.itemId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('derives a unique address per entry from the configured issuer', () => {
    const addresses = ADDRESSED_OFFICIAL_ITEMS.map((i) => i.address);
    expect(new Set(addresses).size).toBe(addresses.length);
    for (const item of ADDRESSED_OFFICIAL_ITEMS) {
      expect(item.address).toBe(
        `${KIND_GAME_ITEM_DEFINITION}:${OFFICIAL_ITEM_ISSUER_PUBKEY}:${item.d}`,
      );
    }
  });

  it('follows the blobbi:<category>:<slug> d convention', () => {
    for (const item of ADDRESSED_OFFICIAL_ITEMS) {
      expect(item.d, item.itemId).toMatch(/^blobbi:[a-z-]+:[a-z0-9-]+$/);
      expect(item.d.split(':')[1]).toBe(item.category);
    }
  });

  it('gives every ACTIVE item the metadata the fallback catalog requires', () => {
    for (const item of ACTIVE_OFFICIAL_ITEMS) {
      expect(item.name.length, item.d).toBeGreaterThan(0);
      expect(item.type.length, item.d).toBeGreaterThan(0);
      expect(item.emoji.length, item.d).toBeGreaterThan(0);
      expect(ITEM_CATEGORIES, item.d).toContain(item.category);
      expect(item.stages.length, item.d).toBeGreaterThan(0);
    }
  });

  it('gives every consumable a real action and real effects', () => {
    // Scoped to consumables: a currency legitimately has neither, which is what
    // keeps it out of the care flows.
    const consumables = ACTIVE_OFFICIAL_ITEMS.filter((i) =>
      CONSUMABLE_ITEM_CATEGORIES.includes(i.category),
    );
    expect(consumables).toHaveLength(19);
    for (const item of consumables) {
      expect(item.action, item.d).not.toBeNull();
      expect(ITEM_ACTIONS, item.d).toContain(item.action!);
      expect(Object.keys(item.effects).length, item.d).toBeGreaterThan(0);
    }
  });

  it('never gives a non-care item a gameplay action or effects', () => {
    for (const item of ADDRESSED_OFFICIAL_ITEMS) {
      if (item.category === 'currency') {
        expect(item.action, item.d).toBeNull();
        expect(item.effects, item.d).toEqual({});
      }
    }
  });

  it('holds no local economy configuration', () => {
    // A coin price is not a protocol/definition fact and must not live on the
    // canonical record. Prices are owned by src/inventory/shop-catalog.ts.
    const ECONOMY_FIELDS = ['shopPriceCoins', 'price', 'coins', 'ticketPrice'];
    for (const item of ADDRESSED_OFFICIAL_ITEMS) {
      const keys = Object.keys(item as unknown as Record<string, unknown>);
      for (const field of ECONOMY_FIELDS) {
        expect(keys, `${item.d} must not carry ${field}`).not.toContain(field);
      }
    }
  });

  it('resolves items by d and by address', () => {
    for (const item of ADDRESSED_OFFICIAL_ITEMS) {
      expect(officialItemByD(item.d)).toEqual(item);
      expect(officialItemByAddress(item.address)).toEqual(item);
    }
    expect(officialItemByD('blobbi:food:nope')).toBeNull();
    expect(officialItemByAddress('31632:x:y')).toBeNull();
  });
});

describe('Arcade Ticket (published)', () => {
  const ticket = officialItemByD(ARCADE_TICKET_D)!;

  it('uses the canonical d', () => {
    expect(ARCADE_TICKET_D).toBe('blobbi:currency:arcade-ticket');
    expect(ticket).not.toBeNull();
  });

  it('derives its address from the configured official issuer', () => {
    expect(ticket.address).toBe(
      `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:blobbi:currency:arcade-ticket`,
    );
    expect(ticket.address).toBe(officialItemAddress(ARCADE_TICKET_D));
  });

  it('is currency: no action, no effects, stackable', () => {
    expect(ticket.category).toBe('currency');
    expect(ticket.type).toBe('currency');
    expect(ticket.action).toBeNull();
    expect(ticket.effects).toEqual({});
    expect(ticket.stackable).toBe(true);
    // "Not for sale" is an economy fact, asserted in shop-catalog.test.ts.
  });

  it('carries the agreed name, description and emoji fallback', () => {
    expect(ticket.name).toBe('Arcade Ticket');
    expect(ticket.emoji).toBe('🎟️');
    expect(ticket.description).toBe(
      'Earned by playing games at the Blobbi Island Arcade. Exchange it for exclusive prizes.',
    );
  });

  it('carries the production artwork URL', () => {
    expect(ticket.image).toBe(ARCADE_TICKET_IMAGE_URL);
    expect(ticket.image).toBe(
      'https://assets.blobbi.pet/items/arcade/arcade-ticket-v1.webp',
    );
    // Versioned + immutable: a new revision is a new filename, never a mutated
    // one, so the immutable cache header stays honest.
    expect(ticket.image).toMatch(/-v\d+\.\w+$/);
  });

  it('is ACTIVE: the issuer-signed definition is published on both relays', () => {
    // `active` means "the definition is on the relays" — it was promoted only
    // after the event was fetched back from wss://relay.ditto.pub AND
    // wss://relay.dreamith.to with a verified signature and matching payload.
    // The pinned bytes live in src/inventory/arcade-ticket-published.test.ts.
    expect(ticket.status).toBe('active');
    expect(ACTIVE_OFFICIAL_ITEMS).toContainEqual(ticket);
    expect(RESERVED_OFFICIAL_ITEMS).toEqual([]);
  });

  it('does not reuse the Arcade PASS artwork', () => {
    // Pass (temporary floor access) and Ticket (persistent currency) are
    // distinct concepts; sharing art would conflate them in the UI.
    expect(ticket.image).not.toBe('/assets/items/tickets/arcade-ticket.png');
    expect(ticket.image).not.toContain('/assets/items/tickets/');
  });
});

describe('issuer material', () => {
  const registrySource = readFileSync(
    resolve(process.cwd(), 'src/protocol/event-registry.ts'),
    'utf8',
  );
  const generatedDoc = readFileSync(
    resolve(process.cwd(), 'docs/protocol/blobbi-island-event-registry.md'),
    'utf8',
  );

  it('identifies the issuer by PUBLIC key only', () => {
    expect(OFFICIAL_ISSUER_PUBKEY).toBe(OFFICIAL_ITEM_ISSUER_PUBKEY);
    expect(OFFICIAL_ISSUER_PUBKEY).toMatch(/^[0-9a-f]{64}$/);
  });

  it('contains no private key, nsec, mnemonic or signer URI', () => {
    const secretPatterns = [
      /nsec1[02-9ac-hj-np-z]{20,}/i,
      /\bprivate[_-]?key\b\s*[:=]\s*['"][^'"]+['"]/i,
      /\bsecret[_-]?key\b\s*[:=]\s*['"][^'"]+['"]/i,
      /bunker:\/\//i,
      /\bmnemonic\b\s*[:=]/i,
    ];
    for (const source of [registrySource, generatedDoc]) {
      for (const pattern of secretPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  it('contains no 64-hex string other than the issuer public key', () => {
    // Blossom is content-addressed, so official artwork URLs legitimately carry
    // a 64-hex sha256 AS A PATH SEGMENT (`https://…/<sha256>.webp`). That is the
    // hash of a public image, not key material, so a hex immediately preceded by
    // `/` is exempt. Every other 64-hex run must still be the issuer's PUBLIC
    // key — which is what makes an accidentally-pasted nsec or event id fail.
    for (const source of [registrySource, generatedDoc]) {
      const hexes = source.match(/(?<!\/)\b[0-9a-f]{64}\b/g) ?? [];
      for (const hex of hexes) {
        expect(hex).toBe(OFFICIAL_ITEM_ISSUER_PUBKEY);
      }
    }
  });

  it('records where official definitions are published', () => {
    expect(OFFICIAL_DEFINITION_RELAYS.length).toBeGreaterThan(0);
    for (const relay of OFFICIAL_DEFINITION_RELAYS) {
      expect(relay).toMatch(/^wss:\/\//);
    }
  });
});

describe('recovery boundary', () => {
  it('states what can and cannot be restored', () => {
    expect(RECOVERY_BOUNDARY.canRestore.length).toBeGreaterThan(0);
    expect(RECOVERY_BOUNDARY.cannotRestore.length).toBeGreaterThan(0);
  });

  it('never claims user-signed data is recoverable', () => {
    const canRestore = RECOVERY_BOUNDARY.canRestore.join(' ').toLowerCase();
    expect(canRestore).not.toContain('31633');
    expect(canRestore).not.toContain('coin');
    expect(canRestore).not.toContain('balance');

    const cannot = RECOVERY_BOUNDARY.cannotRestore.join(' ');
    expect(cannot).toContain('31633');
    expect(cannot).toContain('coin');
  });
});
