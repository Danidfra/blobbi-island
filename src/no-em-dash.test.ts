/**
 * Project-controlled text never uses the em dash character.
 *
 * The audit that removed it replaced every occurrence contextually (comma,
 * colon, semicolon, parentheses, hyphen or period). This check keeps it out of
 * everything the repository owns: source, tests, docs, config and copy.
 *
 * Deliberately NOT covered: binary assets and artwork under `public/assets`
 * (an SVG comment is artwork metadata, not copy), dependencies and build
 * output. Content fetched from relays or typed by players is data, not project
 * text, and is never in the tree.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const EM_DASH = '—';

const SKIP_PREFIXES = ['node_modules/', 'dist/', 'public/assets/'];
const SKIP_EXTENSIONS = [
  '.png', '.webp', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.mp3', '.ogg', '.wav', '.woff', '.woff2', '.lock',
];

function trackedTextFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return out
    .split('\0')
    .filter(Boolean)
    .filter((path) => !SKIP_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .filter((path) => !SKIP_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext)));
}

describe('project-controlled text', () => {
  it('contains no em dash character', () => {
    const offenders: string[] = [];
    for (const path of trackedTextFiles()) {
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      if (!text.includes(EM_DASH)) continue;
      text.split('\n').forEach((line, index) => {
        if (line.includes(EM_DASH)) offenders.push(`${path}:${index + 1}`);
      });
    }
    expect(
      offenders,
      `Replace the em dash with a comma, colon, semicolon, parentheses, hyphen or period:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
