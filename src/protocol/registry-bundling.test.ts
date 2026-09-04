/**
 * The doc generator must never reach the production bundle.
 *
 * `registry-markdown.ts` exists only to render documentation. Vite bundles what
 * is reachable from `index.html`, so the guarantee is simply that no module in
 * the application graph imports it. This test proves that by walking `src/` and
 * checking the import statements themselves; not a comment, not a convention.
 *
 * The canonical registry (`event-registry.ts`) is a different matter: the app
 * legitimately depends on it for item identities, so it IS bundled, and that is
 * correct.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');

/** Files that are allowed to import the DEV-only renderer. */
const ALLOWED_IMPORTERS = new Set(['src/protocol/event-registry-doc.test.ts']);

const DEV_ONLY_MODULES = ['registry-markdown'];

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Module specifiers imported (statically or dynamically) by a file. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) specs.push(match[1]);
  }
  return specs;
}

describe('DEV-only registry tooling', () => {
  const files = collectSourceFiles(SRC);

  it('finds source files to inspect (guards against a broken walker)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('is not imported by anything in the application graph', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(process.cwd(), file);
      if (ALLOWED_IMPORTERS.has(rel)) continue;

      const specs = importSpecifiers(readFileSync(file, 'utf8'));
      for (const spec of specs) {
        if (DEV_ONLY_MODULES.some((m) => spec.endsWith(m))) {
          offenders.push(`${rel} imports ${spec}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the doc-generation entry point out of the app entry chain', () => {
    // The generator is the doc test itself, run via `npm run docs:registry`.
    // Nothing in the app may reach a test file either.
    const appFiles = files.filter((f) => !/\.test\.tsx?$/.test(f));
    const offenders: string[] = [];
    for (const file of appFiles) {
      const specs = importSpecifiers(readFileSync(file, 'utf8'));
      for (const spec of specs) {
        if (/\.test$/.test(spec) || spec.includes('.test.')) {
          offenders.push(`${relative(process.cwd(), file)} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
