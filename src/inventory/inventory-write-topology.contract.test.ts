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
 * | `useInventoryMutation.ts`  | the React item-mutation hook: authoritative base read, shared per-tab chain, optimistic cache + rollback, `useNostrPublish` |
 * | `coin-wallet.ts`           | Coin grants/spends — runs a transaction |
 * | `arcade-reward-writer.ts`  | Arcade Ticket grants — runs a transaction |
 * | `arcade-prize-spend-writer.ts` | Arcade Ticket spends — runs a transaction |
 *
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

/** Writers that must run inside a shared transaction. */
const TRANSACTION_WRITERS = [
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

describe('every kind:31633 writer joins the shared serialization boundary', () => {
  it.each(TRANSACTION_WRITERS)('%s runs inside runInventoryTransaction', (writer) => {
    const code = readCode(writer);
    expect(code).toMatch(/runInventoryTransaction\(/);
    // It must NOT do its own locking, signing, publishing or timestamping.
    expect(code).not.toMatch(/withQueuedCrossTabLock/);
    expect(code).not.toMatch(/signEvent\(/);
    expect(code).not.toMatch(/nostr\.event\(/);
    expect(code).not.toMatch(/created_at:/);
  });

  it('useInventoryMutation serializes on the SAME per-user chain', () => {
    const source = read('src/inventory/useInventoryMutation.ts');
    expect(source).toMatch(/function serialize<T>/);
    expect(source).toMatch(/export function serializeInventoryWrite/);
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
    // The transaction primitive (covering all three transaction writers)…
    expect(read('src/inventory/inventory-transaction.ts')).toMatch(
      /readAuthoritativeInventoryBase\(nostr, pubkey\)/,
    );
    // …and the React item-mutation hook.
    expect(read('src/inventory/useInventoryMutation.ts')).toMatch(
      /readAuthoritativeInventoryBase\(/,
    );
  });

  it('no writer uses the raw empty-falling-back read as a publish base', () => {
    // `fetchInventory` returns an empty inventory on a resolved-empty answer.
    // It is fine for read-only guards; it must never feed a publish.
    const writers = [...TRANSACTION_WRITERS, 'src/inventory/useInventoryMutation.ts'];
    for (const writer of writers) {
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
