/**
 * The DEV-only harnesses must not exist in a production build.
 *
 * `import.meta.env.DEV` becomes a literal `false` in a build, so the ternaries
 * in `AppRouter` collapse to `null` and the dynamic imports inside the dead
 * branches are dropped with them. That is the intent; this asserts the result,
 * because a bundler configuration change could silently reintroduce them and
 * "the route is behind a flag" would still read as true in the source.
 *
 * ## Staleness
 *
 * A build artifact only proves something about the source that produced it.
 * `npm test` runs `vitest` BEFORE `vite build`, so `dist/` here is always from a
 * PREVIOUS run — and a `dist/` older than `src/` proves nothing at all. Rather
 * than pass vacuously, this file:
 *
 *  - always asserts the source-level gate, which needs no build at all and is
 *    where most of the real protection lives;
 *  - **never asserts against a `dist/` that predates `src/`** — those checks are
 *    reported as SKIPPED, so "not verified" is visible rather than silently
 *    green;
 *  - fails loudly if `dist/` is missing or stale while `REQUIRE_FRESH_BUILD=1`
 *    is set. That is the explicit gate: build, then run
 *    `REQUIRE_FRESH_BUILD=1 npx vitest run src/dev-routes.test.ts` to demand
 *    artifact-level proof. A release check should do exactly that.
 *
 * Staleness is a skip rather than a failure in the DEFAULT flow only because
 * vitest runs before the build in this repo's chain; any source edit would
 * otherwise fail the suite on an artifact it has not had a chance to regenerate.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const REQUIRE_FRESH_BUILD = process.env.REQUIRE_FRESH_BUILD === '1';

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? allFiles(full) : [full];
  });
}

const newestMtime = (files: string[]): number =>
  files.reduce((newest, file) => Math.max(newest, statSync(file).mtimeMs), 0);

const distExists = existsSync(DIST);
const distFiles = distExists ? allFiles(DIST) : [];
const distChunks = distFiles.filter((f) => f.endsWith('.js'));

/**
 * Is the build new enough to say anything about the current sources?
 *
 * Compared against `src/` as a whole rather than a hand-picked list: if any
 * source changed after the build, the build predates the code under review.
 */
const sourceFiles = allFiles(join(ROOT, 'src'));
const buildIsFresh = distChunks.length > 0 && newestMtime(distChunks) >= newestMtime(sourceFiles);

describe('production build excludes the DEV harnesses', () => {
  it('has a fresh build to inspect when one is required', () => {
    if (!REQUIRE_FRESH_BUILD) return;
    expect(distExists, 'REQUIRE_FRESH_BUILD=1 but dist/ is missing — build first').toBe(true);
    expect(buildIsFresh, 'REQUIRE_FRESH_BUILD=1 but dist/ is older than src/ — rebuild').toBe(
      true,
    );
  });

  it.runIf(distExists && buildIsFresh)('emits no DevArcade or DevTheater chunk', () => {
    expect(distChunks.length).toBeGreaterThan(0);

    const named = distChunks.filter((f) => /DevArcade|DevTheater/i.test(f));
    expect(named, `unexpected dev chunks: ${named.join(', ')}`).toEqual([]);
  });

  it.runIf(distExists && buildIsFresh)(
    'references neither dev route path nor harness identifier in the shipped output',
    () => {
      const offenders = distFiles
        .filter((f) => /\.(js|html|css)$/.test(f))
        .filter((file) => {
          const source = readFileSync(file, 'utf8');
          return (
            source.includes('/dev/arcade') ||
            source.includes('/dev/theater') ||
            source.includes('DevArcade') ||
            source.includes('DevTheater')
          );
        });

      expect(offenders, `dev harness found in: ${offenders.join(', ')}`).toEqual([]);
    },
  );

  it('registers both harnesses behind import.meta.env.DEV in the router source', () => {
    // Source-level guard, always run: the routes must never be registered
    // unconditionally, whatever state `dist/` happens to be in.
    const router = readFileSync(join(ROOT, 'src/AppRouter.tsx'), 'utf8');
    for (const name of ['DevArcade', 'DevTheater']) {
      expect(router).toContain(`const ${name} = import.meta.env.DEV`);
      expect(router).toContain(`{${name} && (`);
    }
  });

  it('exposes exactly two dev routes, and imports neither harness eagerly', () => {
    const router = readFileSync(join(ROOT, 'src/AppRouter.tsx'), 'utf8');
    const devRoutes = [...router.matchAll(/path="(\/dev\/[^"]*)"/g)].map((m) => m[1]);
    expect(devRoutes.sort()).toEqual(['/dev/arcade', '/dev/theater']);
    // A static import would pull the harness into the main chunk regardless of
    // the route gate.
    expect(router).not.toMatch(/^import\s+.*Dev(Arcade|Theater)/m);
  });

  it('is reachable from no production module', () => {
    // Nothing outside the harness files themselves may reference them.
    const referrers = allFiles(join(ROOT, 'src'))
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => !/pages\/Dev(Arcade|Theater)\.tsx$/.test(f))
      .filter((f) => !f.endsWith('dev-routes.test.ts'))
      .filter((f) => /\bDev(Arcade|Theater)\b/.test(readFileSync(f, 'utf8')));

    expect(referrers.map((f) => f.replace(`${ROOT}/`, ''))).toEqual(['src/AppRouter.tsx']);
  });
});
