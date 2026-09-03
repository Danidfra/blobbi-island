/**
 * kind:31633 writer topology — the structural contract.
 *
 * kind:31633 is a REPLACEABLE event holding the Coin balance, the Arcade
 * Ticket balance and every consumable at once. A writer that builds its event
 * outside the shared serialization boundary can silently erase another
 * writer's work, and a writer that builds on an unconfirmed empty read erases
 * EVERYTHING. Both defects shipped, so the approved topology is pinned here
 * against the real source tree rather than left to review.
 *
 * ## The approved topology
 *
 * | module | role |
 * |---|---|
 * | `inventory-transaction.ts` | the ONE lock + serialize + authoritative read + monotonic `created_at` + strict publish primitive |
 * | `useInventoryMutation.ts`  | the React item-mutation hook + optimistic cache; its write path runs a transaction |
 * | `coin-wallet.ts`           | Coin grants/spends — runs a transaction |
 * | `arcade-reward-writer.ts`  | Arcade Ticket grants — runs a transaction |
 * | `arcade-prize-spend-writer.ts` | Arcade Ticket spends — runs a transaction |
 *
 * EVERY production kind:31633 writer runs inside `runInventoryTransaction` —
 * no writer may lock, read, timestamp, sign or publish on its own, and none
 * may publish through `useNostrPublish` (which treats a timeout as success).
 * Nothing else may build, sign or publish a kind:31633 event.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(full) ? [full] : [];
  });
}

const PRODUCTION_FILES = sourceFiles(join(ROOT, 'src')).filter(
  (file) => !/\.test\.tsx?$/.test(file),
);

const rel = (file: string) => file.replace(`${ROOT}/`, '');
const read = (relPath: string) => readFileSync(join(ROOT, relPath), 'utf8');

/**
 * Source with comments removed.
 *
 * These modules document the very patterns they must not USE ("→ sign", "→
 * nostr.event(…) STRICTLY"), so a negative assertion has to look at code.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const readCode = (relPath: string) => stripComments(read(relPath));

/** The only modules allowed to turn an inventory into a publishable event. */
const TEMPLATE_BUILDERS = [
  'src/inventory/useInventoryMutation.ts', // defines buildInventoryTemplate
  'src/inventory/inventory-transaction.ts', // the shared primitive
];

/** EVERY production kind:31633 writer — all must run inside the transaction. */
const TRANSACTION_WRITERS = [
  'src/inventory/useInventoryMutation.ts',
  'src/inventory/coin-wallet.ts',
  'src/inventory/arcade-reward-writer.ts',
  'src/inventory/arcade-prize-spend-writer.ts',
];

describe('only the approved modules can build a kind:31633 event', () => {
  it('buildInventoryTemplate is called nowhere else in production', () => {
    const offenders = PRODUCTION_FILES.filter((file) => {
      if (TEMPLATE_BUILDERS.includes(rel(file))) return false;
      // Ignore prose: only a real call site counts.
      return /buildInventoryTemplate\s*\(/.test(stripComments(readFileSync(file, 'utf8')));
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('the package builder for kind:31633 is not reached directly', () => {
    const allowed = new Set([
      'src/inventory/package.ts', // the re-export surface
      'src/inventory/useInventoryMutation.ts',
      'src/inventory/useIslandInventory.ts', // buildEmptyInventory only
    ]);
    const offenders = PRODUCTION_FILES.filter((file) => {
      if (allowed.has(rel(file))) return false;
      return /buildGameInventoryEvent\s*\(/.test(stripComments(readFileSync(file, 'utf8')));
    }).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('every kind:31633 writer joins the shared transaction boundary', () => {
  it.each(TRANSACTION_WRITERS)('%s runs inside runInventoryTransaction', (writer) => {
    const code = readCode(writer);
    expect(code).toMatch(/runInventoryTransaction\(/);
    // It must NOT do its own locking, signing, publishing or timestamping.
    expect(code).not.toMatch(/withQueuedCrossTabLock/);
    expect(code).not.toMatch(/signEvent\(/);
    expect(code).not.toMatch(/nostr\.event\(/);
    expect(code).not.toMatch(/created_at:/);
  });

  it('no kind:31633 writer publishes through useNostrPublish', () => {
    // `useNostrPublish` swallows a publish timeout and reports the event as
    // success — acceptable for fire-and-forget kinds, never for the
    // balance-bearing replaceable inventory. Only the transaction's STRICT
    // publish (timeout = AMBIGUOUS) is allowed.
    for (const writer of [...TRANSACTION_WRITERS, 'src/inventory/inventory-transaction.ts']) {
      expect(readCode(writer), `${writer} must not use useNostrPublish`).not.toMatch(
        /useNostrPublish/,
      );
    }
  });

  it('the transaction serializes every writer on ONE per-user chain', () => {
    const source = read('src/inventory/useInventoryMutation.ts');
    expect(source).toMatch(/export function serializeInventoryWrite/);
    expect(source).toMatch(/serializeByKey\(`inventory:\$\{pubkey\}`/);
    // The transaction primitive reuses that exact chain — not a second one.
    expect(read('src/inventory/inventory-transaction.ts')).toMatch(
      /serializeInventoryWrite\(pubkey,/,
    );
  });

  it('there is exactly ONE cross-tab lock implementation, and ONE lock name', () => {
    const transaction = readCode('src/inventory/inventory-transaction.ts');
    expect(transaction).toMatch(/inventoryWriteLockName\(pubkey\)/);
    expect(transaction).toMatch(/return `blobbi-inventory:\$\{pubkey\}`/);

    // No module may define a second lock helper, and no inventory writer may
    // invent its own lock name.
    const lockImplementations = PRODUCTION_FILES.filter((file) =>
      /export async function withQueuedCrossTabLock/.test(
        stripComments(readFileSync(file, 'utf8')),
      ),
    ).map(rel);
    expect(lockImplementations).toEqual(['src/lib/cross-tab-op-lock.ts']);

    const inventoryLockCallers = PRODUCTION_FILES.filter((file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      return (
        /withQueuedCrossTabLock\(/.test(code) && /blobbi-(coin|inventory|ticket)/.test(code)
      );
    }).map(rel);
    expect(inventoryLockCallers).toEqual(['src/inventory/inventory-transaction.ts']);
  });
});

describe('no writer may build on an unconfirmed empty base', () => {
  it('the confirming read exists and is the documented publish base', () => {
    // Structural only: that the helper EXISTS and is exported. Its confirming
    // behaviour is asserted behaviourally in
    // `inventory-authoritative-base.test.ts`, not by pinning its source shape.
    const source = read('src/inventory/useIslandInventory.ts');
    expect(source).toMatch(/export async function readAuthoritativeInventoryBase/);
    expect(source).toMatch(/readRelayConfirmedOrThrow/);
  });

  it('every writer reads its base through the confirming read', () => {
    // The transaction primitive covers ALL writers: each one is pinned to
    // `runInventoryTransaction` above, and the primitive's only base read is
    // the confirming one.
    expect(read('src/inventory/inventory-transaction.ts')).toMatch(
      /readAuthoritativeInventoryBase\(nostr, pubkey\)/,
    );
  });

  it('no writer uses the raw empty-falling-back read as a publish base', () => {
    // `fetchInventory` returns an empty inventory on a resolved-empty answer.
    // It is fine for read-only guards; it must never feed a publish.
    for (const writer of TRANSACTION_WRITERS) {
      expect(readCode(writer), `${writer} must not build on fetchInventory`).not.toMatch(
        /\bfetchInventory\(/,
      );
    }
  });
});

describe('replaceable-event ordering is one shared policy', () => {
  it('created_at is computed only by nextInventoryCreatedAt', () => {
    const transaction = readCode('src/inventory/inventory-transaction.ts');
    expect(transaction).toMatch(/export function nextInventoryCreatedAt/);
    expect(transaction).toMatch(/created_at: nextInventoryCreatedAt\(now\(\), meta\.createdAt\)/);

    // No inventory writer may stamp a bare wall-clock second of its own — that
    // is how two writes inside one second tie and one silently loses.
    for (const writer of TRANSACTION_WRITERS) {
      expect(readCode(writer), `${writer} must not stamp its own created_at`).not.toMatch(
        /Math\.floor\(Date\.now\(\) \/ 1000\)/,
      );
    }
  });
});

/**
 * The external-inventory READ path, and the wall between it and every writer.
 *
 * Blobbi Island discovers and displays kind:31633 inventories written by other
 * games. Those are replaceable events belonging to another application, and
 * there is no cross-origin lock, no compare-and-swap and no shared revision
 * protocol that would make a second writer safe. So Island reads them and stops
 * there — and "stops there" is asserted here against the source tree rather
 * than left to a code review to notice.
 */
describe('external inventories are read, never written', () => {
  /**
   * Every module in the discovery / derivation path. These READ. They sign
   * nothing and publish nothing.
   */
  const EXTERNAL_READ_MODULES = [
    'src/inventory/external-inventories.ts',
    'src/inventory/external-inventory-relays.ts',
    'src/inventory/external-inventory-state.ts',
    'src/inventory/established-spends.ts',
    'src/inventory/external-item-compatibility.ts',
    'src/inventory/useExternalInventories.ts',
    'src/inventory/useExternalInventoryStates.ts',
    'src/inventory/useExternalItemCatalog.ts',
    'src/inventory/trusted-issuers.ts',
  ];

  /**
   * The two modules that WRITE about a foreign inventory — and the only thing
   * they may write is a player-signed kind:1416 (plus the Blobbi's own
   * kind:31124 / kind:1124). They sign, so the no-signing rule does not apply;
   * every other wall does.
   */
  const EXTERNAL_SPEND_MODULES = [
    'src/inventory/external-spend.ts',
    'src/inventory/useConsumeExternalItem.ts',
  ];

  const EXTERNAL_MODULES = [...EXTERNAL_READ_MODULES, ...EXTERNAL_SPEND_MODULES];

  it.each(EXTERNAL_MODULES)('%s cannot build a kind:31633 event', (module) => {
    const code = readCode(module);
    expect(code).not.toMatch(/buildGameInventoryEvent\s*\(/);
    expect(code).not.toMatch(/buildInventoryTemplate\s*\(/);
  });

  it.each(EXTERNAL_MODULES)('%s cannot build a kind:1417 fold manifest', (module) => {
    // Folding is the OWNER's act. Island reads manifests; it never writes one
    // for an inventory it does not own — and it owns none of the external ones.
    const code = readCode(module);
    expect(code).not.toMatch(/buildGameInventoryFoldEvent/);
    expect(code).not.toMatch(/toBuildGameInventoryFoldInput/);
  });

  it('the kind:1417 builder is not even re-exported from the package surface', () => {
    const surface = readCode('src/inventory/package.ts');
    expect(surface).not.toMatch(/buildGameInventoryFoldEvent/);
    expect(surface).not.toMatch(/toBuildGameInventoryFoldInput/);
  });

  it('no production module anywhere builds a kind:1417', () => {
    const offenders = PRODUCTION_FILES.filter((file) =>
      /buildGameInventoryFoldEvent|toBuildGameInventoryFoldInput/.test(
        stripComments(readFileSync(file, 'utf8')),
      ),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it('the spend path never publishes through the timeout-swallowing generic hook', () => {
    for (const module of ['src/inventory/external-spend.ts', 'src/inventory/useConsumeExternalItem.ts']) {
      expect(readCode(module)).not.toMatch(/useNostrPublish/);
    }
  });

  it('a spend is built ONLY through the canonical builder, from full addresses', () => {
    const spend = readCode('src/inventory/external-spend.ts');
    expect(spend).toMatch(/buildGameInventorySpendEvent\(/);
    // No hand-rolled protocol tags.
    expect(spend).not.toMatch(/\['a',/);
    expect(spend).not.toMatch(/\['quantity'/);
  });

  it('no external spend query uses a timestamp cut-off', () => {
    for (const module of ['src/inventory/useExternalInventoryStates.ts', 'src/inventory/external-inventory-state.ts']) {
      expect(readCode(module)).not.toMatch(/since\s*:/);
    }
  });

  it.each(EXTERNAL_MODULES)('%s cannot reach the kind:31633 write layer', (module) => {
    const code = readCode(module);
    expect(code).not.toMatch(/inventory-transaction/);
    expect(code).not.toMatch(/runInventoryTransaction/);
    expect(code).not.toMatch(/useInventoryMutation/);
    expect(code).not.toMatch(/useNostrPublish/);
  });

  it.each(EXTERNAL_READ_MODULES)('%s signs nothing and publishes nothing', (module) => {
    const code = readCode(module);
    expect(code).not.toMatch(/nostr\.event\(/);
    expect(code).not.toMatch(/signEvent\(/);
    expect(code).not.toMatch(/publishToRelays\(/);
  });

  it('the spend modules sign only kind:1416, kind:31124 (via the pet-state primitive) and kind:1124', () => {
    // Every `signEvent(` call site in the spend modules is enumerated here so
    // a new one is a deliberate, reviewed addition.
    const spend = readCode('src/inventory/external-spend.ts');
    expect(spend.match(/signEvent\(/g)).toHaveLength(1); // the kind:1416
    const consume = readCode('src/inventory/useConsumeExternalItem.ts');
    expect(consume.match(/signEvent\(/g)).toHaveLength(1); // the kind:1124 receipt
    expect(consume).toMatch(/runPetStateTransaction\(/); // kind:31124 goes through the primitive
  });

  it('no writer reads a discovered external inventory', () => {
    // The other direction, and the one that actually matters: a writer that
    // built its replacement from a discovered inventory would publish another
    // game's items under Blobbi's own `d`, or Blobbi's items under theirs.
    for (const writer of [...TRANSACTION_WRITERS, 'src/inventory/inventory-transaction.ts']) {
      const code = readCode(writer);
      expect(code, `${writer} must not read external inventories`).not.toMatch(
        /external-inventories|useExternalInventories|fetchExternalInventories/,
      );
    }
  });

  it('the ONLY inventory `d` any writer targets is Blobbi\'s own', () => {
    // `buildInventoryTemplate` hard-codes `id: ISLAND_INVENTORY_D`; there is no
    // parameter through which a caller could aim a write at another context.
    const builder = readCode('src/inventory/useInventoryMutation.ts');
    expect(builder).toMatch(/id: ISLAND_INVENTORY_D,/);

    // And no production module names another game's inventory context at all.
    const offenders = PRODUCTION_FILES.filter((file) =>
      /['"`]farm:main['"`]/.test(stripComments(readFileSync(file, 'utf8'))),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it('no production module names a Farm item address or `d`', () => {
    // Compatibility is decided from issuer trust + published semantics, never
    // from a list of the partner's item ids.
    const offenders = PRODUCTION_FILES.filter(
      (file) =>
        // The captured wire fixture is test data; production never imports
        // it (asserted below).
        !/partner-item-event-fixtures\.ts$/.test(file) &&
        /farm:produce/.test(stripComments(readFileSync(file, 'utf8'))),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it('production never imports the partner fixture data', () => {
    // Fixtures are captured wire events for tests. A production import would
    // turn one partner's published items into bundled Blobbi knowledge — the
    // second-authoritative-catalog failure this architecture exists to avoid.
    const offenders = PRODUCTION_FILES.filter((file) =>
      /partner-item-event-fixtures/.test(stripComments(readFileSync(file, 'utf8'))),
    ).map(rel);
    expect(offenders).toEqual([]);
  });
});

/**
 * Trust stayed where it was.
 *
 * Adding a partner issuer must not have widened any gate that decides what a
 * Blobbi item IS — the catalog, the shop, equipping, renderer effects. Those
 * all key on the official issuer or on full official addresses, and none of
 * them may consult the cross-game trust table.
 */
describe('cross-game trust does not reach Blobbi gameplay', () => {
  const GAMEPLAY_GATES = [
    'src/inventory/useItemCatalog.ts',
    'src/inventory/registry.ts',
    'src/inventory/shop-catalog.ts',
    'src/inventory/care-store-catalog.ts',
    'src/inventory/clothing-store-catalog.ts',
    'src/placement/policy.ts',
    'src/effects/official-visual-effect-items.ts',
    'src/arcade/prizes/official-prize-catalog.ts',
    'src/inventory/useUseItem.ts',
  ];

  it.each(GAMEPLAY_GATES)('%s does not consult the trusted issuer set', (gate) => {
    const code = readCode(gate);
    expect(code).not.toMatch(/trusted-issuers/);
    expect(code).not.toMatch(/isTrustedItemIssuer|getTrustedItemIssuer/);
    expect(code).not.toMatch(/parseTrustedItemDefinition/);
  });

  it.each(GAMEPLAY_GATES)('%s does not consult the cross-game compatibility policy', (gate) => {
    const code = readCode(gate);
    expect(code).not.toMatch(/external-item-compatibility/);
    expect(code).not.toMatch(/resolveExternalItemCompatibility/);
  });

  it('the Island consumption path does not reach the spend path, nor the reverse', () => {
    expect(readCode('src/inventory/useUseItem.ts')).not.toMatch(/useConsumeExternalItem|external-spend|kind:1416|1416/);
    const external = readCode('src/inventory/useConsumeExternalItem.ts');
    expect(external).not.toMatch(/useInventoryMutation|runInventoryMutationTransaction|useUseItem/);
  });

  it('the official catalog still filters on the official issuer alone', () => {
    const catalog = readCode('src/inventory/useItemCatalog.ts');
    expect(catalog).toMatch(/authors: \[OFFICIAL_ITEM_ISSUER_PUBKEY\]/);
    expect(catalog).toMatch(/parseOfficialItemDefinition\(/);
  });

  it('the official parser still compares against the official issuer', () => {
    const adapter = readCode('src/inventory/protocol-adapter.ts');
    expect(adapter).toMatch(
      /export function parseOfficialItemDefinition[\s\S]{0,400}?event\.pubkey !== OFFICIAL_ITEM_ISSUER_PUBKEY/,
    );
  });
});
