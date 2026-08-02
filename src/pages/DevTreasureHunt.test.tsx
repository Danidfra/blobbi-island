/**
 * /dev/treasure-hunt — simulation-only, and provably so.
 *
 * Two layers, mirroring `DevEquipment.test.tsx`:
 *  1. the page SAYS it is simulation-only;
 *  2. the transitive import graph of the page and the whole treasure-hunt UI
 *     contains no write path — no coins mutation, no inventory mutation, no
 *     publisher, no signer, no owner-profile writer. Phase 1B has no reward
 *     code, and this test is what keeps that true by accident-proofing it.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { DevTreasureHunt } from './DevTreasureHunt';

const ROOT = process.cwd();

const FORBIDDEN_IMPORTS =
  /useCoinsMutation|useInventoryMutation|useBatchPurchase|usePurchaseItem|useNostrPublish|useBlobbiEvents|useBlobbonautProfile|arcade-reward-writer|arcade-prize-spend-writer|useArcadeReward|coin-wallet|useCoinWallet|useEconomyEntry|economy-entry|useTreasureHuntRewards/;

function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(ROOT, 'src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = join(dirname(fromFile), specifier);
  else return null; // package import — not part of the repo graph
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Import specifiers of a file, RUNTIME imports only: `import type { … }`
 * statements are erased at build time and cannot reach a write path, so the
 * graph walk skips them (the same rule DevEquipment's boundary test applies).
 */
function runtimeImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  // Both `import … from` and re-exporting `export … from` are runtime edges;
  // the `type` keyword marks either as erased.
  for (const match of source.matchAll(
    /(?:import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
  )) {
    if (match[1]) continue; // type-only
    specifiers.push(match[2]);
  }
  return specifiers;
}

function importGraph(entry: string): Set<string> {
  const visited = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const specifier of runtimeImportSpecifiers(source)) {
      const resolved = resolveImport(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }
  return visited;
}

describe('DevTreasureHunt', () => {
  it('labels itself simulation-only and renders the harness controls', () => {
    render(<DevTreasureHunt />);
    expect(screen.getByText(/Simulation only — nothing is published/)).toBeInTheDocument();
    expect(screen.getByLabelText('Seed')).toBeInTheDocument();
    expect(screen.getByLabelText('Composition')).toBeInTheDocument();
    expect(screen.getByLabelText('Shovel uses')).toBeInTheDocument();
    expect(screen.getByLabelText('Reveal hidden targets')).toBeInTheDocument();
  });

  it('surfaces an invalid forced policy as a harness error, not a crash', () => {
    render(<DevTreasureHunt />);
    // Zero shovel uses violates production policy validation.
    fireEvent.change(screen.getByLabelText('Shovel uses'), { target: { value: '0' } });
    expect(document.querySelector('[data-dev-policy-error]')).not.toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/shovelUses/);
  });

  it('reaches no write path through its whole import graph', () => {
    const visited = importGraph(join(ROOT, 'src/pages/DevTreasureHunt.tsx'));
    expect(visited.size).toBeGreaterThan(10); // the walk is real

    // Checked against IMPORT SPECIFIERS, not free text: registry records and
    // doc comments legitimately NAME writer files without importing them.
    const offenders = [...visited].filter((file) =>
      runtimeImportSpecifiers(readFileSync(file, 'utf8')).some((specifier) =>
        FORBIDDEN_IMPORTS.test(specifier),
      ),
    );
    expect(offenders.map((f) => f.replace(`${ROOT}/`, ''))).toEqual([]);
  });

  it('the pure model keeps its purity: no React/DOM/Nostr imports in src/beach', () => {
    const visited = importGraph(join(ROOT, 'src/beach/treasure-hunt/index.ts'));
    expect(visited.size).toBeGreaterThan(5);
    for (const file of visited) {
      const source = readFileSync(file, 'utf8');
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const specifier of imports) {
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\.?\//);
        expect(specifier.toLowerCase(), `${file} imports ${specifier}`).not.toContain('nostr');
        expect(specifier, `${file} imports ${specifier}`).not.toBe('react');
      }
      expect(file, 'the model graph must stay inside src/beach').toContain('/src/beach/');
    }
  });
});
