/**
 * Coin cutover: repository-wide source contracts.
 *
 * After the cutover there is exactly ONE canonical production balance (the
 * official Blobbi Coin quantity in kind:31633) and exactly ONE mutation
 * surface (the Coin wallet). These tests walk the real source tree so a
 * future feature cannot quietly reintroduce a second writer, an active
 * kind:11125 `coins` tag, or a dual-read fallback.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

describe('one canonical Coin balance', () => {
  it('no production module authors an active kind:11125 coins tag', () => {
    // The literal `['coins', …]` / ["coins", …] tag-construction shape. The
    // parser may still surface the historic tag as inert compat data; nothing
    // may BUILD one.
    const offenders = PRODUCTION_FILES.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /\[\s*['"]coins['"]\s*,/.test(source);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('the deleted kind:11125 coin writer stays deleted', () => {
    const offenders = PRODUCTION_FILES.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /useCoinsMutation/.test(source);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('legacy profile coins are never read for economic decisions', () => {
    // Parsed-profile `.coins` access, the dual-read fallback shape. Only the
    // parser and the type definition may mention the field (compat data, acted
    // on by NOTHING). Shop PRICES named `coins:` and UI copy are not balance
    // reads and are deliberately not matched.
    const allowed = new Set([
      'src/lib/blobbi-parsers.ts',
      'src/lib/blobbi-types.ts',
    ]);
    const dualRead =
      /\b(owner|ownerProfile|existingProfile|mergedProfile|profile)\??\.coins\b/;
    const offenders = PRODUCTION_FILES.filter((file) => {
      if (allowed.has(rel(file))) return false;
      const source = readFileSync(file, 'utf8');
      return dualRead.test(source);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('only the wallet moves the Coin balance (no second mutation surface)', () => {
    // Direct BLOBBI_COIN_ADDRESS mutations are the wallet's alone: every
    // other consumer goes through grantCoins/spendCoins or reads.
    const allowed = new Set([
      'src/inventory/coin-wallet.ts',
      'src/inventory/coin.ts',
      'src/inventory/useCoinWallet.ts',
    ]);
    const offenders = PRODUCTION_FILES.filter((file) => {
      if (allowed.has(rel(file))) return false;
      const source = readFileSync(file, 'utf8');
      // A mutation call passing the coin address into the generic inventory
      // layer would look like applyMutation(...BLOBBI_COIN_ADDRESS...).
      return (
        /applyMutation[\s\S]{0,200}BLOBBI_COIN_ADDRESS/.test(source) ||
        /BLOBBI_COIN_ADDRESS[\s\S]{0,120}(type:\s*['"](add|remove|set)['"])/.test(source)
      );
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('the legacy bootstrap stays deleted (no module may reintroduce it)', () => {
    const offenders = PRODUCTION_FILES.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /useCoinBootstrap|legacy-coin-bootstrap/.test(source);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('only the economy-entry service authors the allocation marker', () => {
    // The exact tag literal and the marker constant are economy-entry's alone.
    // The wallet/builder pass extraTags through opaquely without naming them;
    // no feature module may construct or re-declare the marker.
    const allowed = new Set(['src/inventory/economy-entry.ts']);
    const markerShape = /\[\s*['"]allocation['"]\s*,|ISLAND_ALLOCATION_MARKER|island-economy:v1/;
    const offenders = PRODUCTION_FILES.filter((file) => {
      if (allowed.has(rel(file))) return false;
      const source = readFileSync(file, 'utf8');
      return markerShape.test(source);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('the initial allocation has ONE constant and ONE stable op id; never minted randomly', () => {
    // The amount and identity live only in economy-entry.ts; nothing else may
    // define a second 200 or route the allocation through mintCoinOpId.
    const definitions = PRODUCTION_FILES.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /INITIAL_ISLAND_COIN_ALLOCATION\s*=/.test(source);
    }).map(rel);
    expect(definitions).toEqual(['src/inventory/economy-entry.ts']);

    const entrySource = readFileSync(
      join(ROOT, 'src/inventory/economy-entry.ts'),
      'utf8',
    );
    expect(entrySource).not.toMatch(/mintCoinOpId/);
    expect(entrySource).toMatch(/ISLAND_ALLOCATION_OP_ID = `initial-allocation:/);

    // The retired shared constant may not come back anywhere.
    const legacyConstant = PRODUCTION_FILES.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /INITIAL_BLOBBONAUT_COINS/.test(source);
    }).map(rel);
    expect(legacyConstant).toEqual([]);
  });

  it('adoption is currency-independent: no wallet, allocation, or inventory import', () => {
    const source = readFileSync(join(ROOT, 'src/hooks/useFirstEggAdoption.ts'), 'utf8');
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b|^\s*export\b.*\bfrom\b/.test(line) || /\bfrom\s+['"]/.test(line));
    for (const line of importLines) {
      expect(line, `adoption must not import economy modules: ${line}`).not.toMatch(
        /coin-wallet|useCoinWallet|economy-entry|useEconomyEntry|useInventoryMutation|usePurchaseItem|useBatchPurchase|coin-op-ledger/,
      );
    }
    // Code shapes only (comments legitimately EXPLAIN the decoupling): no
    // wallet method call and no allocation constant usage as an expression.
    expect(source).not.toMatch(/\.grantCoins\(|\.spendCoins\(/);
    expect(source).not.toMatch(/INITIAL_(ISLAND_COIN_ALLOCATION|BLOBBONAUT_COINS)\b\s*[,;)\]}]/);
  });

  it('the HUD balance is the canonical inventory Coin (never a profile fallback)', () => {
    const source = readFileSync(
      join(ROOT, 'src/components/blobbi/BlobbiInfoModal.tsx'),
      'utf8',
    );
    expect(source).toMatch(/useCoinBalance/);
    expect(source).not.toMatch(
      /\b(owner|ownerProfile|existingProfile|mergedProfile|profile)\??\.coins\b/,
    );
  });

  it('the retired single-item purchase hook stays deleted', () => {
    // `useBatchPurchase` is the canonical shop path and was always the only
    // one with a caller; `usePurchaseItem` duplicated it, drifted (it kept a
    // price contract the live path had moved past) and had no production or
    // dev caller. Deleting it is only durable if nothing reintroduces it.
    expect(existsSync(join(ROOT, 'src/inventory/usePurchaseItem.ts'))).toBe(false);
    expect(readFileSync(join(ROOT, 'src/inventory/index.ts'), 'utf8')).not.toMatch(
      /usePurchaseItem/,
    );

    const offenders = PRODUCTION_FILES.filter((file) =>
      /\busePurchaseItem\b/.test(readFileSync(file, 'utf8')),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it('exactly one production hook spends Coins on shop items', () => {
    const purchaseHooks = PRODUCTION_FILES.filter((file) =>
      /export function use\w*Purchase\w*\(/.test(readFileSync(file, 'utf8')),
    ).map(rel);
    expect(purchaseHooks).toEqual(['src/inventory/useBatchPurchase.ts']);
  });

  it('profile writers carry no coin responsibility', () => {
    for (const file of ['src/hooks/useBlobbiEvents.ts', 'src/hooks/useBlobbonautProfile.ts']) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source, `${file} must not author a coins tag`).not.toMatch(
        /\[\s*['"]coins['"]\s*,/,
      );
    }
    // The shared serializer no longer manages `coins`: it must ride the
    // unknown-tag passthrough instead.
    const parsers = readFileSync(join(ROOT, 'src/lib/blobbi-parsers.ts'), 'utf8');
    const managedBlock = parsers.slice(
      parsers.indexOf('MANAGED_OWNER_PROFILE_TAG_NAMES = new Set'),
      parsers.indexOf(']);', parsers.indexOf('MANAGED_OWNER_PROFILE_TAG_NAMES = new Set')),
    );
    expect(managedBlock).not.toContain("'coins'");
  });
});
