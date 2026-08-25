/**
 * There is exactly one way out.
 *
 * The ESLint rules in `eslint.config.js` say the same thing and give faster
 * feedback; this checks the real source, so a call reached by some construction
 * the selector does not model still fails. The pair is the same belt-and-braces
 * arrangement `src/safety/boundaries.test.ts` uses for the capability layer.
 *
 * It also pins the relay gate to the WRITER rather than to any component: the
 * selector is mounted three times, so gating it would leave three working
 * callbacks and a fourth mount away from being wrong.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const EGRESS = join(SRC, 'external-egress');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const relative = (file: string) => file.replace(`${process.cwd()}/`, '');

/** Everything that is neither the boundary itself nor a test. */
const featureFiles = sourceFiles(SRC)
  .filter((file) => !file.startsWith(`${EGRESS}/`))
  .filter((file) => !isTest(file));

/**
 * Strip comments before scanning.
 *
 * The prose in `island-safety-policy.ts` and the migrated components discusses
 * `window.open` at length, and a check that could not tell an explanation from a
 * call would either fail on documentation or push people into not writing any.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the browser escape hatches have one owner', () => {
  it('has feature files to check', () => {
    expect(featureFiles.length).toBeGreaterThan(100);
  });

  it.each([
    ['window.open', /\bwindow\s*\.\s*open\s*\(/],
    ['navigator.share', /\bnavigator\s*\.\s*share\s*\(/],
    ['target="_blank"', /target\s*=\s*["'{]\s*["']?_blank/],
  ])('no feature file calls %s', (label, pattern) => {
    const offenders = featureFiles.filter((file) => pattern.test(code(file))).map(relative);

    expect(
      offenders,
      `${label} belongs to src/external-egress/ alone — a feature should request egress by class, so the capability check, the confirmation and the opener isolation all happen once. Found in: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('opens windows with opener isolation, wherever it does open them', () => {
    // Centralising is only worth it if the central version is the safe one.
    const source = code(join(EGRESS, 'egress.ts'));
    const opens = source.match(/window\.open\([^)]*\)/g) ?? [];
    expect(opens.length).toBeGreaterThan(0);
    for (const call of opens) {
      expect(call).toContain('features');
    }
    expect(source).toContain("'noopener,noreferrer'");
  });
});

describe('the relay gate is on the writer', () => {
  it('lives in AppProvider, which every relay change goes through', () => {
    const provider = code(join(SRC, 'components/AppProvider.tsx'));
    expect(provider).toContain("isEgressAllowed(policy, 'relay-management')");
  });

  it('is not only the selector being hidden', () => {
    // RelaySelector returning null is presentation. If the gate ever moved
    // there and nowhere else, three existing mounts would still write.
    const selector = code(join(SRC, 'components/RelaySelector.tsx'));
    const provider = code(join(SRC, 'components/AppProvider.tsx'));
    expect(selector).toContain('isEgressAllowed');
    expect(provider).toContain('isEgressAllowed');
  });
});

describe('the authoring route is guarded where it mounts', () => {
  it('wraps the tools route in the guard', () => {
    const router = code(join(SRC, 'AppRouter.tsx'));
    expect(router).toContain('EgressRouteGuard');
    expect(router).toContain('authoring-tool');
  });
});

describe('NoteContent is gone', () => {
  it('no longer exists anywhere in src/', () => {
    // It linkified arbitrary URLs with `target="_blank"` and rendered stranger
    // kind:0 metadata, with no production importer — a dormant helper one
    // careless import away from putting a stranger-controlled exit inside a
    // chat bubble (audit M-3).
    const survivors = sourceFiles(SRC).filter((file) => /NoteContent/.test(file)).map(relative);
    expect(survivors).toEqual([]);
  });

  it('is referenced by nothing', () => {
    // This file names it, which is why it is excluded — the check is about
    // production code acquiring an importer, not about the test that guards it.
    const referrers = sourceFiles(SRC)
      .filter((file) => file !== join(EGRESS, 'boundaries.test.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes('NoteContent'))
      .map(relative);
    expect(referrers).toEqual([]);
  });
});
