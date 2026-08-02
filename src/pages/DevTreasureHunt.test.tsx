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
  /useCoinsMutation|useInventoryMutation|useBatchPurchase|usePurchaseItem|useNostrPublish|useBlobbiEvents|useBlobbonautProfile|arcade-reward-writer|arcade-prize-spend-writer|signEvent|useArcadeReward/;

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

function importGraph(entry: string): Set<string> {
  const visited = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const resolved = resolveImport(file, match[1]);
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

    const offenders = [...visited].filter((file) =>
      FORBIDDEN_IMPORTS.test(readFileSync(file, 'utf8'))
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
