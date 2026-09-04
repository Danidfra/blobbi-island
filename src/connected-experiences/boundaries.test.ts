/**
 * Blobbi Island is independent of Nostr Farm, structurally.
 *
 * Interoperability is Nostr events and nothing else: no Farm code is
 * imported, no Farm page is embedded, no runtime bridge exists, and the Farm
 * URL is written in exactly one place. These checks read the real source
 * tree, the same belt-and-braces arrangement `src/external-egress/
 * boundaries.test.ts` uses for the browser escape hatches.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NOSTR_FARM_URL } from './connected-experiences-config';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const REGISTRY = join(SRC, 'connected-experiences', 'connected-experiences-config.ts');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const relative = (file: string) => file.replace(`${ROOT}/`, '');
const isTest = (file: string) => /\.test\.tsx?$/.test(file);

/** Strip comments so prose about the Farm is not mistaken for code. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const allFiles = sourceFiles(SRC);
const featureFiles = allFiles.filter((file) => !isTest(file));
const stationFiles = featureFiles.filter(
  (file) =>
    file.includes('/connected-experiences/') ||
    file.includes('/nostr-station/') ||
    file.endsWith('/NostrHubModal.tsx'),
);

/** Every import specifier in a file. */
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

describe('no Farm code enters Blobbi Island', () => {
  it('has feature files to check', () => {
    expect(featureFiles.length).toBeGreaterThan(100);
    expect(stationFiles.length).toBeGreaterThan(2);
  });

  it('no source file imports a Farm module or package', () => {
    const offenders = featureFiles
      .filter((file) => importSpecifiers(code(file)).some((spec) => /farm/i.test(spec)))
      .map(relative);
    expect(
      offenders,
      `Blobbi Island must not import Farm code; interoperability is Nostr events only. Found in: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('package.json depends on nothing Farm-shaped', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((name) => /farm/i.test(name))).toEqual([]);
  });
});

describe('no Farm embed and no runtime bridge', () => {
  it('no feature file renders an iframe pointed at the Farm, and the Station renders none at all', () => {
    const iframeToFarm = featureFiles
      .filter((file) => /<iframe[^>]*farm/i.test(code(file)))
      .map(relative);
    expect(iframeToFarm).toEqual([]);
    const stationIframes = stationFiles.filter((file) => /<iframe/i.test(code(file))).map(relative);
    expect(stationIframes).toEqual([]);
  });

  it('the Station and the registry use no postMessage, no message listener, no shared storage handshake', () => {
    for (const file of stationFiles) {
      const source = code(file);
      expect(source, relative(file)).not.toMatch(/postMessage\s*\(/);
      expect(source, relative(file)).not.toMatch(/addEventListener\s*\(\s*['"]message['"]/);
      expect(source, relative(file)).not.toMatch(/BroadcastChannel/);
    }
  });

  it('the Station never opens a window itself: the launch is an egress request', () => {
    for (const file of stationFiles) {
      const source = code(file);
      expect(source, relative(file)).not.toMatch(/\bwindow\s*\.\s*open\s*\(/);
      expect(source, relative(file)).not.toMatch(/target\s*=\s*["'{]\s*["']?_blank/);
      expect(source, relative(file)).not.toMatch(/\blocation\s*\.\s*(href|assign|replace)\b/);
    }
    const terminal = code(join(SRC, 'components', 'blobbi', 'nostr-station', 'ConnectedExperiencesSection.tsx'));
    expect(terminal).toContain('requestEgress');
    expect(terminal).toContain("class: 'external-link'");
  });
});

describe('the Farm destination is written once', () => {
  it('appears in the registry and nowhere else in the source', () => {
    const host = new URL(NOSTR_FARM_URL).host;
    const offenders = allFiles
      .filter((file) => file !== REGISTRY && !isTest(file))
      .filter((file) => readFileSync(file, 'utf8').includes(host))
      .map(relative);
    expect(offenders).toEqual([]);
  });
});
