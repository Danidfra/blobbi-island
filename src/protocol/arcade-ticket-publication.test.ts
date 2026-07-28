/**
 * The publication runbook must show EXACTLY what will be signed.
 *
 * A runbook that has drifted from the builder is worse than no runbook: the
 * operator would sign bytes the client cannot resolve, and the mistake would
 * only surface as a mysteriously "unpublished" item. So the template is rebuilt
 * here with the real `@nostr-games/inventory` builder and compared against both
 * the canonical registry and the checked-in document.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildGameItemDefinitionEvent } from '@nostr-games/inventory';

import {
  ARCADE_TICKET_D,
  ARCADE_TICKET_IMAGE_URL,
  OFFICIAL_DEFINITION_CONVENTIONS,
  OFFICIAL_DEFINITION_RELAYS,
  OFFICIAL_ISSUER_PUBKEY,
  officialDefinitionAlt,
  officialItemByD,
} from './event-registry';

const RUNBOOK_PATH = 'docs/protocol/arcade-ticket-publication.md';
const runbook = readFileSync(resolve(process.cwd(), RUNBOOK_PATH), 'utf8');

const ticket = officialItemByD(ARCADE_TICKET_D)!;

/**
 * The template exactly as the runbook instructs it to be built.
 *
 * `version`, `contexts` and the `alt` shape come from
 * {@link OFFICIAL_DEFINITION_CONVENTIONS}, which mirrors what all 19 published
 * definitions carry (verified against both official relays). Following them
 * keeps this definition consistent with the catalog it joins.
 */
const template = buildGameItemDefinitionEvent({
  id: ticket.d,
  name: ticket.name,
  type: ticket.type,
  category: ticket.category,
  image: ticket.image ?? undefined,
  version: OFFICIAL_DEFINITION_CONVENTIONS.version,
  contexts: [OFFICIAL_DEFINITION_CONVENTIONS.context],
  topics: [...ticket.topics],
  alt: officialDefinitionAlt(ticket.name),
  content: {
    effects: { 'game:blobbi': {} },
    metadata: {
      itemId: ticket.itemId,
      action: null,
      stages: ticket.stages,
      emoji: ticket.emoji,
      stackable: ticket.stackable,
      description: ticket.description,
    },
  },
});

describe('kind:31632 publication template', () => {
  it('produces exactly these tags, in this order', () => {
    // Order is the BUILDER's, not a preference: see dist/index.js:305-340 —
    // d/name/type, then optional category, image, …, version, then context,
    // then topics, then alt.
    expect(template.tags).toEqual([
      ['d', 'blobbi:currency:arcade-ticket'],
      ['name', 'Arcade Ticket'],
      ['type', 'currency'],
      ['category', 'currency'],
      ['image', 'https://assets.blobbi.pet/items/arcade/arcade-ticket-v1.webp'],
      // The builder coerces `version` to a STRING, per the spec's tag model.
      ['version', '1'],
      ['context', 'game:blobbi'],
      ['t', 'currency'],
      ['t', 'arcade'],
      ['alt', 'Game item definition: Arcade Ticket'],
    ]);
  });

  it('follows the conventions carried by all 19 published definitions', () => {
    const tag = (name: string) =>
      template.tags.find(([n]) => n === name)?.[1];

    expect(tag('context')).toBe(OFFICIAL_DEFINITION_CONVENTIONS.context);
    expect(tag('version')).toBe(String(OFFICIAL_DEFINITION_CONVENTIONS.version));
    expect(tag('alt')).toBe(officialDefinitionAlt('Arcade Ticket'));
    expect(tag('alt')).toMatch(/^Game item definition: /);
  });

  it('is kind 31632 and carries no signing fields', () => {
    expect(template.kind).toBe(31632);
    // The builder supplies content/tags only; created_at, pubkey, id and sig
    // are added at signing time.
    expect(Object.keys(template).sort()).toEqual(['content', 'kind', 'tags']);
  });

  it('describes a stackable currency with no action and no stat effects', () => {
    const content = JSON.parse(template.content);
    expect(content.metadata.action).toBeNull();
    expect(content.metadata.stackable).toBe(true);
    expect(content.metadata.itemId).toBe('cur_arcade_ticket');
    expect(content.metadata.emoji).toBe('🎟️');
    expect(content.effects['game:blobbi']).toEqual({});
  });

  it('invents no unsupported tags', () => {
    const tagNames = template.tags.map(([name]) => name);
    for (const invented of [
      'transferable',
      'tradeable',
      'soulbound',
      'price',
      'max_stack',
    ]) {
      expect(tagNames).not.toContain(invented);
    }
  });
});

describe('publication runbook', () => {
  it('shows the byte-exact content string that will be signed', () => {
    expect(runbook).toContain(JSON.stringify(template.content));
  });

  it('shows every tag pair the builder produces', () => {
    for (const [name, value] of template.tags) {
      expect(runbook, `missing tag ${name}`).toContain(`"${name}", "${value}"`);
    }
  });

  it('shows the production artwork URL and the canonical address', () => {
    expect(runbook).toContain(ARCADE_TICKET_IMAGE_URL);
    expect(runbook).toContain(ticket.address);
    expect(runbook).toContain(OFFICIAL_ISSUER_PUBKEY);
  });

  it('names both official relays', () => {
    for (const relay of OFFICIAL_DEFINITION_RELAYS) {
      expect(runbook).toContain(relay);
    }
  });

  it('does not reference a placeholder, a temporary asset or the PASS artwork', () => {
    expect(runbook).not.toContain('PENDING_OFFICIAL_ARTWORK');
    expect(runbook).not.toContain('/assets/items/tickets/');
    expect(runbook).not.toMatch(/\bTODO\b|<FINAL[^>]*>|placeholder URL/i);
    // Only the versioned production asset host may appear as an image source.
    const imageUrls = runbook.match(/https?:\/\/\S+\.(?:webp|png|jpg|jpeg|gif)/g) ?? [];
    for (const url of imageUrls) {
      expect(url).toBe(ARCADE_TICKET_IMAGE_URL);
    }
  });

  it('reports the item as active, matching the registry', () => {
    expect(ticket.status).toBe('active');
    expect(runbook).toContain('`active`');
    // The runbook must no longer describe the item as awaiting publication.
    expect(runbook).not.toContain('the event is not published yet');
  });

  it('records the verification that justified promoting it', () => {
    const recordAt = runbook.indexOf('## 7. Publication record');
    expect(recordAt).toBeGreaterThan(0);
    const record = runbook.slice(recordAt);

    // Both relays must be attested independently.
    for (const relay of OFFICIAL_DEFINITION_RELAYS) {
      expect(record).toContain(relay);
    }
    // Both valid signings are recorded, so "which id?" is never ambiguous.
    expect(record).toContain(
      '89901d7678d3bcab3043646e76cde0c47a7076e3f9ea17ab61baae2b407fe2b0',
    );
    expect(record).toContain(
      '9ba4cf0745fc827589fbfe3f981985c14f3ea4191ce25c0686ba0d4a152c63e6',
    );
  });

  it('contains no private key material', () => {
    for (const pattern of [
      /nsec1[02-9ac-hj-np-z]{20,}/i,
      /\bprivate[_-]?key\b\s*[:=]\s*['"][^'"]+['"]/i,
      /--sec\s+(?!"?\$)[^\s]+/, // a literal key after --sec, rather than a variable
    ]) {
      expect(runbook).not.toMatch(pattern);
    }
    // 64-hex strings are key-shaped, so every one must be accounted for: the
    // issuer PUBLIC key, or one of the two recorded published event ids.
    // Anything else is treated as a possible leaked secret.
    const PUBLISHED_EVENT_IDS = [
      '89901d7678d3bcab3043646e76cde0c47a7076e3f9ea17ab61baae2b407fe2b0',
      '9ba4cf0745fc827589fbfe3f981985c14f3ea4191ce25c0686ba0d4a152c63e6',
    ];
    const allowed = new Set([OFFICIAL_ISSUER_PUBKEY, ...PUBLISHED_EVENT_IDS]);
    for (const hex of runbook.match(/\b[0-9a-f]{64}\b/g) ?? []) {
      expect(allowed.has(hex), `unaccounted 64-hex string: ${hex}`).toBe(true);
    }
  });
});
