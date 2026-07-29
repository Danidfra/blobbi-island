/**
 * The arcade's layering rules, enforced against the real import graph.
 *
 * Two claims are load-bearing for this phase and both are cheap to break by
 * accident:
 *
 *  1. **`src/arcade/` cannot reach a relay or an inventory.** A module that
 *     cannot import `useInventoryMutation` cannot call it, however a future
 *     refactor is shaped. This is what makes "Phase 2 grants no tickets" a
 *     structural fact rather than a promise in a comment.
 *  2. **The arcade does not depend on theater code.** The shapes are similar and
 *     the domains are not; the audit called this out explicitly.
 *
 * Import statements are matched, not free text, so the prose in
 * `arcade-reward-boundary.ts` — which discusses `useInventoryMutation` and
 * `useNostrPublish` at length — does not trip the check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ARCADE_DIR = join(process.cwd(), 'src/arcade');
const ARCADE_COMPONENTS_DIR = join(process.cwd(), 'src/components/blobbi/arcade');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Every module specifier actually imported (static or dynamic) by a file. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const patterns = [
    /\bimport\s+(?:[\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

const FORBIDDEN_IN_PURE_ARCADE = [
  { pattern: /^@\/inventory/, why: 'the inventory layer' },
  { pattern: /^@nostrify\//, why: 'a Nostr client' },
  { pattern: /^nostr-tools/, why: 'a Nostr library' },
  { pattern: /^@\/hooks\/useNostr/, why: 'a Nostr hook' },
  { pattern: /^@tanstack\//, why: 'a query client' },
  { pattern: /^react($|\/)/, why: 'React' },
  { pattern: /^@\/components\//, why: 'a component' },
];

/**
 * `src/arcade/` modules that are deliberately React hooks.
 *
 * The list is explicit rather than a `use*.ts` glob so that adding one is a
 * decision recorded here. Every entry is a hook that owns a BROWSER concern no
 * pure module can (key events, visibility, animation frames) and still touches
 * no relay, no inventory and no component — the rest of the rules below apply to
 * them unchanged.
 */
const REACT_ALLOWED = new Set([
  'useArcadeInput.ts',
  'useArcadeInterruption.ts',
  'useFixedStepLoop.ts',
]);

describe('src/arcade cannot write to a relay or an inventory', () => {
  const files = sourceFiles(ARCADE_DIR).filter((f) => !f.endsWith('.test.ts'));

  it('has modules to check', () => {
    expect(files.length).toBeGreaterThan(4);
  });

  it.each(files.map((f) => [f.replace(`${process.cwd()}/`, ''), f]))(
    '%s imports nothing that could publish or mutate inventory',
    (_label, file) => {
      const isHook = REACT_ALLOWED.has(file.split('/').pop()!);

      for (const specifier of importsOf(file)) {
        for (const { pattern, why } of FORBIDDEN_IN_PURE_ARCADE) {
          if (why === 'React' && isHook) continue;
          expect(
            pattern.test(specifier),
            `${_label} imports ${why} (${specifier})`,
          ).toBe(false);
        }
      }
    },
  );
});

describe('the arcade does not depend on the theater', () => {
  const files = [...sourceFiles(ARCADE_DIR), ...sourceFiles(ARCADE_COMPONENTS_DIR)];

  it.each(files.map((f) => [f.replace(`${process.cwd()}/`, ''), f]))(
    '%s imports no theater module',
    (_label, file) => {
      for (const specifier of importsOf(file)) {
        expect(
          /theater/i.test(specifier),
          `${_label} imports theater code (${specifier})`,
        ).toBe(false);
      }
    },
  );
});

describe('no arcade component performs an inventory or coin write except the pass purchase', () => {
  const files = sourceFiles(ARCADE_COMPONENTS_DIR).filter(
    (f) => !/\.test\.tsx?$|\/test-/.test(f),
  );

  it.each(files.map((f) => [f.replace(`${process.cwd()}/`, ''), f]))(
    '%s imports no write hook',
    (_label, file) => {
      for (const specifier of importsOf(file)) {
        expect(
          /useInventoryMutation|useCoinsMutation|usePurchaseItem|useBatchPurchase|useUseItem|useNostrPublish/.test(
            specifier,
          ),
          `${_label} imports a write hook (${specifier})`,
        ).toBe(false);
      }
    },
  );

  it('routes the ONE inventory write through useArcadeReward, and nowhere else', () => {
    // Phase 3 gave the arcade a reward. The rule above still holds — no arcade
    // component imports a raw write hook — because the grant goes through one
    // named boundary, `useArcadeReward`, which is the only module allowed to
    // hold an `ArcadeRewardWriter`. This asserts BOTH halves: exactly one arcade
    // component reaches for the boundary, and the boundary is what actually
    // owns the writer.
    const users = files
      .filter((file) => importsOf(file).some((s) => /useArcadeReward/.test(s)))
      .map((f) => f.replace(`${process.cwd()}/`, ''))
      .sort();
    expect(users).toEqual([
      // The controller — the one component that can start a claim.
      'src/components/blobbi/arcade/dance/DanceMachine.tsx',
      // The results screen, which imports the hook's STATE TYPE only, so that
      // its copy cannot drift away from the phases it has to distinguish.
      'src/components/blobbi/arcade/dance/DanceResults.tsx',
    ]);
    expect(readFileSync(join(process.cwd(), users[1]), 'utf8')).toContain(
      "import type { ArcadeRewardState }",
    );

    const hook = importsOf(join(process.cwd(), 'src/hooks/useArcadeReward.ts'));
    expect(hook.some((s) => /arcade-reward-writer/.test(s))).toBe(true);

    // And the writer itself never touches coins. Checked against IMPORTS, not
    // free text — the module's header explains at length why kind:11125 is out
    // of scope, and a prose match would flag exactly the comment that says so.
    const writerImports = importsOf(
      join(process.cwd(), 'src/inventory/arcade-reward-writer.ts'),
    );
    expect(writerImports.some((s) => /useCoinsMutation|blobbi-kinds/.test(s))).toBe(false);
  });

  it('leaves the ONE coin write in ArcadePassModal, and nowhere else', () => {
    // The pass purchase is the arcade's only write of any kind, and it writes
    // coins (kind:11125), never inventory (kind:31633).
    const modal = readFileSync(
      join(process.cwd(), 'src/components/blobbi/ArcadePassModal.tsx'),
      'utf8',
    );
    const specifiers = importsOf(
      join(process.cwd(), 'src/components/blobbi/ArcadePassModal.tsx'),
    );
    expect(specifiers.some((s) => /useCoinsMutation/.test(s))).toBe(true);
    expect(specifiers.some((s) => /useInventoryMutation/.test(s))).toBe(false);
    expect(modal).not.toContain('31633');
  });
});
