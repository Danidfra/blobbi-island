/**
 * The decoupling rule (protocol §14.3), enforced rather than documented.
 *
 * ```
 *   src/lib/shared-playback/**        pure protocol; no React, no DOM,
 *      ▲                              no theater / seats / presence / rendering
 *      │
 *   src/hooks/useSharedPlayback.ts    React lifecycle, relay I/O
 *      ▲
 *   src/components/blobbi/theater/**  UI + player + seats
 * ```
 *
 * This is what lets a watch session work for a seated Blobbi, a standing one, or
 * a future room with no Blobbi in it at all, and what keeps the protocol's
 * correctness provable without a browser. A single convenience import of, say,
 * the seat registry would quietly delete that property, so the direction is
 * checked by reading the source.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/lib/shared-playback';

/** Modules whose presence here would invert the dependency direction. */
const FORBIDDEN = [
  'react',
  'react-dom',
  '@/components',
  '@/hooks',
  '@/contexts',
  '@/pages',
  '@/blobbi',
  '@/lib/theater',
  '@/lib/multiplayer',
  '@/lib/youtube',
  '@/lib/blobbi',
  '@/lib/chat',
  '@/lib/location',
  '@/lib/boundaries',
  '@/lib/gaze',
];

function sourceFiles(): string[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.ts'))
    .filter((name) => !name.endsWith('.test.ts'))
    .filter((name) => name !== 'fixtures.ts');
}

/**
 * Comments are prose about the architecture and routinely mention the very
 * things the scan forbids ("no React", "the settle window"). Stripping them
 * first is what keeps this a check on CODE rather than on wording.
 */
function code(file: string): string {
  return readFileSync(join(DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function importsOf(file: string): string[] {
  const source = code(file);
  const specifiers: string[] = [];
  // Static imports/exports and dynamic import() alike.
  const pattern = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[1] ?? match[2]);
  }
  return specifiers;
}

describe('shared-playback stays a pure protocol library', () => {
  const files = sourceFiles();

  it('has source files to check (the scan cannot pass vacuously)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('%s imports nothing from the game or the framework', (file) => {
    for (const specifier of importsOf(file)) {
      for (const forbidden of FORBIDDEN) {
        expect(
          specifier === forbidden || specifier.startsWith(`${forbidden}/`),
          `${file} imports ${specifier}`,
        ).toBe(false);
      }
    }
  });

  it.each(files)('%s imports only its own directory and type-level Nostr/zod', (file) => {
    for (const specifier of importsOf(file)) {
      const allowed =
        specifier.startsWith('./') ||
        specifier === 'zod' ||
        specifier === '@nostrify/nostrify';
      expect(allowed, `${file} imports ${specifier}`).toBe(true);
    }
  });

  it('touches no browser global', () => {
    // `crypto.getRandomValues` is the one platform API used, and it is reached
    // through `globalThis` so the library runs identically under node.
    for (const file of files) {
      const source = code(file);
      expect(source, `${file} references window`).not.toMatch(/\bwindow\./);
      expect(source, `${file} references document`).not.toMatch(/\bdocument\./);
      expect(source, `${file} references localStorage`).not.toMatch(/\blocalStorage\b/);
    }
  });
});
