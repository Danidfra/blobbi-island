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

describe('game simulation stays reward-free', () => {
  // The dependency arrow points ONE way: a reward policy reads a result; the
  // physics, match reducers, rules and result builders know nothing about
  // rewards. A simulation that imported the economy could start shaping play
  // around it — and a policy bug could then break a game.
  // The reward layer itself — the per-game policies, the shared calculator and
  // the claim boundary — is exempt: it is the thing being isolated FROM.
  const files = sourceFiles(ARCADE_DIR).filter(
    (f) =>
      !f.endsWith('.test.ts') &&
      !/-reward\.ts$/.test(f) &&
      !f.endsWith('reward-policy.ts') &&
      !f.endsWith('arcade-reward-boundary.ts'),
  );

  it.each(files.map((f) => [f.replace(`${process.cwd()}/`, ''), f]))(
    '%s imports no reward module',
    (_label, file) => {
      for (const specifier of importsOf(file)) {
        expect(
          /-reward$|reward-policy|arcade-reward-boundary/.test(specifier),
          `${_label} imports reward code (${specifier})`,
        ).toBe(false);
      }
    },
  );
});

describe('the Prize Counter keeps its boundaries', () => {
  // The catalogue and the redemption machine live under `src/arcade/prizes/`,
  // so the pure-arcade scan above already proves they import no React, no
  // Nostr client and no inventory writer. What is asserted here is the rest of
  // the seam.

  it('keeps game simulation and reward policies out of the prize shop', () => {
    // The games earn tickets; the counter spends them. Neither may know the
    // other exists: a policy that priced itself off a prize, or a simulation
    // that read the shop, would couple play to the economy's contents.
    const files = sourceFiles(ARCADE_DIR).filter(
      (f) => !f.endsWith('.test.ts') && !f.includes('/prizes/'),
    );
    for (const file of files) {
      for (const specifier of importsOf(file)) {
        expect(
          /prizes\//.test(specifier),
          `${file.replace(`${process.cwd()}/`, '')} imports prize code (${specifier})`,
        ).toBe(false);
      }
    }
  });

  it('routes ticket SPENDING nowhere — the counter is preview-only since Phase 9.5', () => {
    // The temporary V1 redemption was retired from the player-facing surface:
    // NO arcade component may reach the spend writer OR the (dormant)
    // redemption hook any more. The hook and writer stay in the tree for the
    // future audited grant phase, still bound to each other — asserted last so
    // their reunion cannot happen by accident on some other path.
    const componentFiles = sourceFiles(ARCADE_COMPONENTS_DIR).filter(
      (f) => !/\.test\.tsx?$|\/test-/.test(f),
    );
    const spendUsers = componentFiles
      .filter((file) => importsOf(file).some((s) => /arcade-prize-spend-writer/.test(s)))
      .map((f) => f.replace(`${process.cwd()}/`, ''));
    expect(spendUsers).toEqual([]);

    const hookUsers = componentFiles
      .filter((file) => importsOf(file).some((s) => /useArcadePrizeRedemption/.test(s)))
      .map((f) => f.replace(`${process.cwd()}/`, ''));
    expect(hookUsers).toEqual([]);

    const hook = importsOf(join(process.cwd(), 'src/hooks/useArcadePrizeRedemption.ts'));
    expect(hook.some((s) => /arcade-prize-spend-writer/.test(s))).toBe(true);
  });

  it('keeps the TEMPORARY ownership store behind the hook, out of the components', () => {
    const componentFiles = sourceFiles(ARCADE_COMPONENTS_DIR).filter(
      (f) => !/\.test\.tsx?$|\/test-/.test(f),
    );
    for (const file of componentFiles) {
      for (const specifier of importsOf(file)) {
        expect(
          /arcade-prize-ownership/.test(specifier),
          `${file.replace(`${process.cwd()}/`, '')} imports the ownership store (${specifier})`,
        ).toBe(false);
      }
    }
  });

  it('keeps the Mini Arcade Cabinet out of Home — the future is not imported yet', () => {
    // No module whose path mentions Home may import prize code until the
    // furniture delivery actually exists.
    const allSrc = sourceFiles(join(process.cwd(), 'src'));
    const homeFiles = allSrc.filter((f) => /home/i.test(f.replace(process.cwd(), '')));
    for (const file of homeFiles) {
      for (const specifier of importsOf(file)) {
        expect(
          /prizes\/|prize-catalogue|arcade-prize/.test(specifier),
          `${file.replace(`${process.cwd()}/`, '')} imports prize code (${specifier})`,
        ).toBe(false);
      }
    }
  });
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
    // Phase 3 gave the arcade a reward; Arcade V1 extended it to all three
    // dedicated games. The rule above still holds — no arcade component imports
    // a raw write hook — because every grant goes through one named boundary:
    // machine controllers use the shared `useArcadeRewardController` wiring,
    // which is the only module that calls `useArcadeReward`, which is the only
    // module allowed to hold an `ArcadeRewardWriter`. This asserts the exact
    // population of that boundary's users, so a fourth caller is a deliberate
    // edit here rather than an accident.
    const users = files
      .filter((file) => importsOf(file).some((s) => /useArcadeReward/.test(s)))
      .map((f) => f.replace(`${process.cwd()}/`, ''))
      .sort();
    const machines = [
      'src/components/blobbi/arcade/dance/DanceMachine.tsx',
      'src/components/blobbi/arcade/hockey/AirHockeyMachine.tsx',
      'src/components/blobbi/arcade/pool/PoolMachine.tsx',
    ];
    const resultsScreens = [
      'src/components/blobbi/arcade/dance/DanceResults.tsx',
      'src/components/blobbi/arcade/hockey/AirHockeyResults.tsx',
      'src/components/blobbi/arcade/pool/PoolResults.tsx',
    ];
    expect(users).toEqual(
      [
        // The shared claim panel, which imports the hook's STATE TYPE only.
        'src/components/blobbi/arcade/ArcadeRewardPanel.tsx',
        // The three machine controllers — the components that can start a claim
        // — reach the boundary ONLY through the shared controller wiring.
        ...machines,
        // The results screens import the STATE TYPE only, so their props cannot
        // drift away from the phases the panel has to distinguish.
        ...resultsScreens,
      ].sort(),
    );
    for (const machine of machines) {
      const specifiers = importsOf(join(process.cwd(), machine));
      expect(
        specifiers.some((s) => s === '@/hooks/useArcadeRewardController'),
        `${machine} must use the shared controller`,
      ).toBe(true);
      expect(
        specifiers.some((s) => s === '@/hooks/useArcadeReward'),
        `${machine} must not bypass the shared controller`,
      ).toBe(false);
    }
    for (const screen of [...resultsScreens, 'src/components/blobbi/arcade/ArcadeRewardPanel.tsx']) {
      expect(readFileSync(join(process.cwd(), screen), 'utf8')).toContain(
        'import type { ArcadeRewardState }',
      );
    }

    const controller = importsOf(join(process.cwd(), 'src/hooks/useArcadeRewardController.ts'));
    expect(controller.some((s) => s === '@/hooks/useArcadeReward')).toBe(true);

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

  it('leaves the ONE coin write at the Arcade Token counter, through the wallet', () => {
    // Buying Arcade Tokens is the arcade's only COIN write. It replaced the
    // Arcade Pass purchase, which is no longer bought with Coins at all — the
    // pass is redeemed with Arcade Tickets at the prize counter.
    //
    // Like every Coin spend since the cutover it goes through the canonical
    // Coin WALLET (official Blobbi Coin in kind:31633): never the raw inventory
    // mutation layer, and never the retired kind:11125 path.
    const path = join(process.cwd(), 'src/hooks/useArcadeTokens.ts');
    const specifiers = importsOf(path);
    expect(specifiers.some((s) => /useCoinWallet/.test(s))).toBe(true);
    expect(specifiers.some((s) => /useCoinsMutation/.test(s))).toBe(false);

    // The inventory mutation BINDING, not its module. `useInventoryMutation.ts`
    // also exports `getQuantity`, a pure reader over an already-fetched
    // inventory, and reading a Token balance through it is exactly right — an
    // import-path check would have to forbid that too. What must never appear
    // is a second writer: the wallet is the only thing that moves value here.
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/useInventoryMutation\s*\(/);
  });
});
