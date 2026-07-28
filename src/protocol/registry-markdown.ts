/**
 * Deterministic Markdown renderer for the canonical protocol registry.
 *
 * Pure: no clock, no randomness, no filesystem, no network. Given the same
 * registry it always produces byte-identical output, which is what lets
 * `event-registry-doc.test.ts` fail when the checked-in document is stale.
 *
 * DEV/TOOLING ONLY. This module is imported by tests and by the doc-generation
 * script and by NOTHING in the application graph, so it is never part of a
 * production bundle. `registry-bundling.test.ts` enforces that.
 */

import {
  ADDRESSED_OFFICIAL_ITEMS,
  APPLICATION_EVENT_KINDS,
  type AddressedOfficialItem,
  type ApplicationEventKind,
  OFFICIAL_DEFINITION_RELAYS,
  OFFICIAL_ISSUER_PUBKEY,
  RECOVERY_BOUNDARY,
} from './event-registry';

/** Repo-relative path of the document this renderer produces. */
export const REGISTRY_DOC_PATH = 'docs/protocol/blobbi-island-event-registry.md';

/** Repo-relative path of the canonical source, quoted in the document. */
export const REGISTRY_SOURCE_PATH = 'src/protocol/event-registry.ts';

const CLASS_LABEL: Record<ApplicationEventKind['eventClass'], string> = {
  regular: 'Regular',
  replaceable: 'Replaceable',
  ephemeral: 'Ephemeral',
  addressable: 'Addressable',
};

const CLIENT_STATUS_LABEL: Record<
  ApplicationEventKind['clientStatus'],
  string
> = {
  implemented: 'Implemented (read + write)',
  'read-only': 'Implemented (read only)',
  'read-compat': 'Read for legacy compatibility',
  'not-implemented': 'Not implemented by this client',
};

const PROTOCOL_STATUS_LABEL: Record<
  ApplicationEventKind['protocolStatus'],
  string
> = {
  current: 'Current',
  superseded: 'Superseded',
  undetermined: 'Undetermined by this repository',
};

const AUTHORITY_LABEL: Record<ApplicationEventKind['authority'], string> = {
  player: 'The player',
  'official-item-issuer': 'Official item issuer',
  'session-host': 'Session host',
  'player-or-ditto': 'The player or Ditto (co-authored)',
};

const ITEM_STATUS_LABEL: Record<AddressedOfficialItem['status'], string> = {
  active: 'Active',
  reserved: 'Reserved',
  deprecated: 'Deprecated',
};

function code(value: string): string {
  return `\`${value}\``;
}

function codeList(values: readonly string[]): string {
  return values.length > 0 ? values.map(code).join(', ') : '—';
}

function effectsList(effects: Readonly<Record<string, number>>): string {
  const keys = Object.keys(effects);
  if (keys.length === 0) return 'none';
  return keys.map((k) => `${k} ${effects[k] > 0 ? '+' : ''}${effects[k]}`).join(', ');
}

function kindSummaryTable(kinds: readonly ApplicationEventKind[]): string[] {
  const rows = kinds.map((k) =>
    [
      code(String(k.kind)),
      k.name,
      CLASS_LABEL[k.eventClass],
      k.ownership === 'external-package'
        ? `External — ${code(k.owningPackage ?? 'unknown')}`
        : 'Blobbi Island',
      CLIENT_STATUS_LABEL[k.clientStatus],
      PROTOCOL_STATUS_LABEL[k.protocolStatus],
    ].join(' | '),
  );
  return [
    '| Kind | Name | Class | Defined by | This client | Protocol |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r} |`),
  ];
}

function kindDetail(k: ApplicationEventKind): string[] {
  const lines: string[] = [];
  lines.push(`### Kind ${k.kind} — ${k.name}`);
  lines.push('');
  lines.push(k.purpose);
  lines.push('');
  lines.push(`- **Class:** ${CLASS_LABEL[k.eventClass]}`);
  lines.push(
    `- **Address format:** ${k.addressFormat ? code(k.addressFormat) : 'not addressable'}`,
  );
  lines.push(`- **Signed by:** ${AUTHORITY_LABEL[k.authority]}`);
  lines.push(`- **Lifecycle:** ${k.lifecycle}`);
  lines.push(`- **Expiration:** ${k.expiration ?? 'none'}`);
  lines.push(`- **This client:** ${CLIENT_STATUS_LABEL[k.clientStatus]}`);
  lines.push(
    `- **Protocol status:** ${PROTOCOL_STATUS_LABEL[k.protocolStatus]}${
      k.protocolStatusEvidence ? ` — ${k.protocolStatusEvidence}` : ''
    }`,
  );
  lines.push(
    `- **Defined by:** ${
      k.ownership === 'external-package'
        ? `${code(k.owningPackage ?? 'unknown')} (Blobbi Island is a consumer)`
        : 'Blobbi Island'
    }`,
  );
  if (k.supersededBy !== undefined) {
    lines.push(`- **Superseded by:** kind ${code(String(k.supersededBy))}`);
  }
  lines.push(`- **Implemented in:** ${codeList(k.sourceFiles)}`);
  lines.push(`- **Documented in:** ${codeList(k.docs)}`);
  if (k.notes) lines.push(`- **Notes:** ${k.notes}`);
  lines.push('');
  return lines;
}

function itemSummaryTable(items: readonly AddressedOfficialItem[]): string[] {
  const rows = items.map((i) =>
    [
      code(i.d),
      i.name,
      i.category,
      i.action ? code(i.action) : '—',
      ITEM_STATUS_LABEL[i.status],
    ].join(' | '),
  );
  return [
    '| `d` | Name | Category | Action | Status |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r} |`),
  ];
}

function itemDetail(i: AddressedOfficialItem): string[] {
  const lines: string[] = [];
  lines.push(`### ${i.name} — ${code(i.d)}`);
  lines.push('');
  if (i.description) {
    lines.push(i.description);
    lines.push('');
  }
  lines.push(`- **Address:** ${code(i.address)}`);
  lines.push(`- **Status:** ${ITEM_STATUS_LABEL[i.status]}`);
  lines.push(`- **Category:** ${code(i.category)} · **Type:** ${code(i.type)}`);
  lines.push(`- **Action:** ${i.action ? code(i.action) : 'none — cannot be used on a Blobbi'}`);
  lines.push(`- **Stages:** ${codeList(i.stages)}`);
  lines.push(`- **Effects:** ${effectsList(i.effects)}`);
  lines.push(`- **Emoji fallback:** ${i.emoji}`);
  lines.push(
    `- **Image:** ${i.image ? code(i.image) : '— (none published; the emoji fallback is used)'}`,
  );
  lines.push(`- **Topics:** ${codeList(i.topics)}`);
  lines.push(`- **Stackable:** ${i.stackable ? 'yes' : 'no'}`);
  if (i.sourceFiles && i.sourceFiles.length > 0) {
    lines.push(`- **Referenced by:** ${codeList(i.sourceFiles)}`);
  }
  lines.push('');
  return lines;
}

/**
 * Render the whole registry as Markdown.
 *
 * Sections are fixed and ordered; the content is derived entirely from the
 * canonical registry, so editing this file changes presentation only and
 * editing the registry changes content only.
 */
export function renderRegistryMarkdown(): string {
  const lines: string[] = [];

  lines.push('# Blobbi Island — Official Event & Item Registry');
  lines.push('');
  lines.push(
    `> **Generated file — do not edit by hand.** Every value below is derived from ${code(
      REGISTRY_SOURCE_PATH,
    )}.`,
  );
  lines.push(
    '> Regenerate with `npm run docs:registry`. A test fails if this file and the registry disagree.',
  );
  lines.push('');
  lines.push(
    'This is the canonical description of every Nostr event kind Blobbi Island reads or writes, and of every official item definition it recognises. `NIP.md` explains the protocol in prose; this document is the machine-checked inventory.',
  );
  lines.push('');

  // 1 — application kinds summary
  lines.push('## 1. Application event kinds');
  lines.push('');
  lines.push(
    'Two independent status axes. **This client** says what the code in this repository does with the kind. **Protocol** says what the wider Blobbi protocol says about it, and may only read *Superseded* when a document here names the replacement — the citation is shown in §4. A kind can be "not implemented by this client" while its protocol status is *Undetermined*: absence of code here is not evidence that another Blobbi client stopped using it.',
  );
  lines.push('');
  lines.push(...kindSummaryTable(APPLICATION_EVENT_KINDS));
  lines.push('');

  // 2 — address formats
  lines.push('## 2. Address formats');
  lines.push('');
  lines.push(
    'Addressable and replaceable kinds are referenced by coordinate. Non-addressable kinds are referenced by event id only.',
  );
  lines.push('');
  lines.push('| Kind | Address format |');
  lines.push('| --- | --- |');
  for (const k of APPLICATION_EVENT_KINDS) {
    lines.push(
      `| ${code(String(k.kind))} | ${k.addressFormat ? code(k.addressFormat) : 'not addressable'} |`,
    );
  }
  lines.push('');

  // 3 — authority
  lines.push('## 3. Ownership and authority');
  lines.push('');
  lines.push(
    'Authority in Nostr derives from authorship: an event is authoritative for a thing exactly when its signer is the thing’s owner. "Defined by" says who owns the *schema*; "signed by" says who may produce valid instances.',
  );
  lines.push('');
  lines.push('| Kind | Defined by | Signed by |');
  lines.push('| --- | --- | --- |');
  for (const k of APPLICATION_EVENT_KINDS) {
    lines.push(
      `| ${code(String(k.kind))} | ${
        k.ownership === 'external-package'
          ? `${code(k.owningPackage ?? 'unknown')}`
          : 'Blobbi Island'
      } | ${AUTHORITY_LABEL[k.authority]} |`,
    );
  }
  lines.push('');

  // 4 — lifecycle + status detail
  lines.push('## 4. Lifecycle and implementation status');
  lines.push('');
  for (const k of APPLICATION_EVENT_KINDS) {
    lines.push(...kindDetail(k));
  }

  // 5 — issuer + relays
  lines.push('## 5. Official item issuer and relays');
  lines.push('');
  lines.push(
    `- **Issuer public key (hex):** ${code(OFFICIAL_ISSUER_PUBKEY)}`,
  );
  lines.push(
    '- **Private key:** never stored in this repository. Publishing official definitions is a human, out-of-band action.',
  );
  lines.push(`- **Definition relays:** ${codeList(OFFICIAL_DEFINITION_RELAYS)}`);
  lines.push(
    '- Definitions signed by any other pubkey are rejected by `parseOfficialItemDefinition`.',
  );
  lines.push('');

  // 6 — item summary
  lines.push('## 6. Official item definitions');
  lines.push('');
  lines.push(
    'Status meanings: **Active** — the issuer-signed kind:31632 event is published. **Reserved** — the identity is claimed and the client already resolves it from the bundled fallback, but the official event is not published yet. **Deprecated** — no longer offered, still resolvable so existing inventories render.',
  );
  lines.push('');
  lines.push(
    '> **Prices are not listed here, by design.** A coin price is Island-local economy configuration, not a kind:31632 definition fact: it is never published to a relay, it changes on its own schedule, and a second currency (arcade tickets) will have its own prices. The coin price table lives in `src/inventory/shop-catalog.ts` and is validated against this registry at module load — an item that is not an official registered consumable cannot be priced.',
  );
  lines.push('');
  lines.push(...itemSummaryTable(ADDRESSED_OFFICIAL_ITEMS));
  lines.push('');

  // 7 — canonical addresses
  lines.push('## 7. Canonical kind:31632 addresses');
  lines.push('');
  lines.push('Derived from the issuer public key and the `d` tag; never hardcoded.');
  lines.push('');
  lines.push('| Item | Address |');
  lines.push('| --- | --- |');
  for (const i of ADDRESSED_OFFICIAL_ITEMS) {
    lines.push(`| ${i.name} | ${code(i.address)} |`);
  }
  lines.push('');

  // 8 — item detail
  lines.push('## 8. Item detail');
  lines.push('');
  for (const i of ADDRESSED_OFFICIAL_ITEMS) {
    lines.push(...itemDetail(i));
  }

  // 9 — recovery boundary
  lines.push('## 9. Recovery boundary');
  lines.push('');
  lines.push('**This registry CAN preserve / restore:**');
  lines.push('');
  for (const entry of RECOVERY_BOUNDARY.canRestore) {
    lines.push(`- ${entry}`);
  }
  lines.push('');
  lines.push('**This registry CANNOT restore:**');
  lines.push('');
  for (const entry of RECOVERY_BOUNDARY.cannotRestore) {
    lines.push(`- ${entry}`);
  }
  lines.push('');
  lines.push(
    'In one sentence: official, issuer-signed content is recoverable from this repository; anything a *user* signed is not, and no amount of registry data changes that.',
  );
  lines.push('');

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
