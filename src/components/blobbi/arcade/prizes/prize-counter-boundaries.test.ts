/**
 * The Prize Counter's reward-flow boundary, proven against the TRANSITIVE
 * import graph.
 *
 * Phase 9.5 retired the temporary V1 redemption from this surface and made the
 * counter preview-only. These tests make that structural: starting from the
 * counter's modules and walking every `@/`-and-relative import they can reach,
 * NONE of the following may appear,
 *
 *   - the inventory write path (`useInventoryMutation`) or the equipment write
 *     path (`useEquipmentMutation`);
 *   - the retired redemption machinery (`useArcadePrizeRedemption`, the spend
 *     writer, the temporary ownership store);
 *   - the internal developer Inventory & Equipment Lab (`/tools/game-items`
 *     modules): the player-facing counter must never invoke developer
 *     mutations.
 *
 * A module that cannot be imported cannot be called, however a future refactor
 * is shaped.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = process.cwd();

const ENTRY_MODULES = [
  'src/components/blobbi/arcade/prizes/PrizeCounter.tsx',
  'src/components/blobbi/arcade/prizes/PrizeCard.tsx',
  'src/components/blobbi/arcade/prizes/PrizeDetail.tsx',
  'src/components/blobbi/arcade/prizes/PrizePreviewStage.tsx',
  'src/components/blobbi/arcade/prizes/useOfficialArcadePrizes.ts',
];

// The DOMAIN write paths and the retired redemption machinery. The generic
// `useNostrPublish` is deliberately NOT on this list for the transitive walk:
// shared read hooks (the profile hook the preview uses for the companion
// visual) live in modules that also export writes, and reaching such a module
// is not a spend path, the source-text check below and the behavioral tests
// (`signEvent` never called) cover the act itself.
const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /useInventoryMutation/, why: 'the kind:31633 write path' },
  { pattern: /useEquipmentMutation/, why: 'the kind:31634 write path' },
  { pattern: /useArcadePrizeRedemption/, why: 'the retired redemption hook' },
  { pattern: /arcade-prize-spend-writer/, why: 'the ticket spend writer' },
  { pattern: /arcade-prize-ownership/, why: 'the temporary ownership store' },
  { pattern: /useCoinsMutation/, why: 'the coins write path' },
  { pattern: /tools\/game-items/, why: 'the developer Inventory & Equipment Lab' },
];

function specifiersOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const match of source.matchAll(
    /\bimport\s+(?:[\s\S]*?\bfrom\s*)?['"]([^'"]+)['"]/g,
  )) {
    out.push(match[1]);
  }
  return out;
}

/** Resolve a specifier to a repo file, or null for packages/assets. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith('@/')) base = join(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  if (!base) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

/** Every repo module transitively reachable from the entries. */
function reachableModules(): Map<string, string[]> {
  const visited = new Map<string, string[]>();
  const queue = ENTRY_MODULES.map((m) => join(ROOT, m));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    const specs = specifiersOf(file);
    visited.set(file, specs);
    for (const spec of specs) {
      const next = resolveSpecifier(file, spec);
      if (next && !visited.has(next)) queue.push(next);
    }
  }
  return visited;
}

describe('the Prize Counter cannot reach a write path', () => {
  const graph = reachableModules();

  it('walks a non-trivial graph (the resolver is not silently broken)', () => {
    // The counter reaches the renderer, the catalog and the registries, far
    // more than its own five files.
    expect(graph.size).toBeGreaterThan(15);
  });

  it('imports no mutation, no retired redemption machinery, and no developer lab', () => {
    for (const [file, specs] of graph) {
      for (const spec of specs) {
        for (const { pattern, why } of FORBIDDEN) {
          expect(
            pattern.test(spec),
            `${file.replace(`${ROOT}/`, '')} imports "${spec}": ${why}`,
          ).toBe(false);
        }
      }
    }
  });

  it('spends no tickets and grants no items in source text either', () => {
    // Belt to the import graph's braces: no counter module may even name a
    // spend/grant call. Comments are stripped so prose may still explain.
    for (const entry of ENTRY_MODULES) {
      const source = readFileSync(join(ROOT, entry), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const banned of [/spendTickets/, /grantPrize/, /mutateAsync/, /\.mutate\(/]) {
        expect(banned.test(source), `${entry} matches ${banned}`).toBe(false);
      }
    }
  });
});
