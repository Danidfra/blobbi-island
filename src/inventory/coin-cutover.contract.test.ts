/**
 * Coin cutover — repository-wide source contracts.
 *
 * After the cutover there is exactly ONE canonical production balance (the
 * official Blobbi Coin quantity in kind:31633) and exactly ONE mutation
 * surface (the Coin wallet). These tests walk the real source tree so a
 * future feature cannot quietly reintroduce a second writer, an active
 * kind:11125 `coins` tag, or a dual-read fallback.
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

describe('one canonical Coin balance', () => {
  it('no production module authors an active kind:11125 coins tag', () => {
    // The literal `['coins', …]` / ["coins", …] tag-construction shape. The
    // parser may READ the historic tag (the bootstrap needs it); nothing may
    // BUILD one.
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

  it('legacy profile coins are read ONLY by the parser and the bootstrap', () => {
    // Parsed-profile `.coins` access — the dual-read fallback shape. The type
    // definition, the parser, and the bootstrap are the allowed readers;
    // `useBlobbiEvents` carries the inert field for type completeness without
    // publishing it. Shop PRICES named `coins:` and UI copy are not balance
    // reads and are deliberately not matched.
    const allowed = new Set([
      'src/lib/blobbi-parsers.ts',
      'src/lib/blobbi-types.ts',
      'src/inventory/useCoinBootstrap.ts',
      'src/hooks/useBlobbiEvents.ts',
      'src/hooks/useOptimizedStatus.ts', // generic StatusUpdate merge plumbing
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

  it('profile writers carry no coin responsibility', () => {
    for (const file of ['src/hooks/useBlobbiEvents.ts', 'src/hooks/useBlobbonautProfile.ts']) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source, `${file} must not author a coins tag`).not.toMatch(
        /\[\s*['"]coins['"]\s*,/,
      );
    }
    // The shared serializer no longer manages `coins` — it must ride the
    // unknown-tag passthrough instead.
    const parsers = readFileSync(join(ROOT, 'src/lib/blobbi-parsers.ts'), 'utf8');
    const managedBlock = parsers.slice(
      parsers.indexOf('MANAGED_OWNER_PROFILE_TAG_NAMES = new Set'),
      parsers.indexOf(']);', parsers.indexOf('MANAGED_OWNER_PROFILE_TAG_NAMES = new Set')),
    );
    expect(managedBlock).not.toContain("'coins'");
  });
});
