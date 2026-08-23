/**
 * The safety layer's own layering rules, checked against the real import graph.
 *
 * Three claims, each cheap to break by accident and expensive to discover later:
 *
 *  1. **The policy core is pure.** A module that cannot import React, a relay or
 *     storage cannot make a capability decision depend on any of them — which is
 *     what lets `admitChatMessage` be the same function in a unit test and in
 *     the running game.
 *  2. **Family is unreachable.** No module outside this directory names the
 *     Family policy, the resolver, the active profile or the profile type. That
 *     is what "defined, tested, and not selectable by anyone" means in practice,
 *     and it is the same discipline `arcade/guest-game-trust.test.ts` applies to
 *     the guest-game publisher key.
 *  3. **Feature code consumes capabilities, not profiles.** The ESLint rule in
 *     `eslint.config.js` says the same thing and gives faster feedback; this
 *     checks the actual identifiers, so a relative-path import or a re-export
 *     cannot route around it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const SAFETY = join(SRC, 'safety');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const relative = (file: string) => file.replace(`${process.cwd()}/`, '');

/** Every module specifier a file actually imports, static or dynamic. */
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

/**
 * The two modules that are allowed to know React exists.
 *
 * Explicit rather than a glob, so adding a third is a decision recorded here.
 * Both are the delivery mechanism — a context and the provider that fills it —
 * and neither contains a capability decision.
 */
const REACT_ALLOWED = new Set(['island-safety-context.ts', 'IslandSafetyProvider.tsx']);

const FORBIDDEN_IN_SAFETY = [
  { pattern: /^@nostrify\//, why: 'a Nostr client' },
  { pattern: /^nostr-tools/, why: 'a Nostr library' },
  { pattern: /^@tanstack\//, why: 'a query client' },
  { pattern: /^@\/hooks\//, why: 'an application hook' },
  { pattern: /^@\/components\//, why: 'a component' },
  { pattern: /^@\/inventory/, why: 'the inventory layer' },
  { pattern: /^@\/lib\//, why: 'application library code' },
  { pattern: /^react($|\/)/, why: 'React' },
];

describe('the policy core is pure', () => {
  const files = sourceFiles(SAFETY).filter((file) => !isTest(file));

  it('has modules to check', () => {
    expect(files.length).toBeGreaterThan(4);
  });

  it.each(files.map((file) => [relative(file), file] as const))(
    '%s imports nothing that could make a capability depend on the world',
    (_label, file) => {
      const reactAllowed = REACT_ALLOWED.has(file.split('/').pop()!);

      for (const specifier of importsOf(file)) {
        for (const { pattern, why } of FORBIDDEN_IN_SAFETY) {
          if (why === 'React' && reactAllowed) continue;
          expect(
            pattern.test(specifier),
            `${relative(file)} imports ${why} ("${specifier}"); the safety layer must stay decidable without it`,
          ).toBe(false);
        }
      }
    },
  );

  it('reads no storage and no environment', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const forbidden of ['localStorage', 'sessionStorage', 'import.meta.env', 'process.env']) {
        expect(
          source.includes(forbidden),
          `${relative(file)} touches ${forbidden}; a capability must not depend on ambient state in this phase`,
        ).toBe(false);
      }
    }
  });
});

describe('Family is defined and unreachable', () => {
  /**
   * Identifiers that would let a caller pick a profile, or reason about one,
   * rather than reading a capability. Tests are exempt; the safety layer is the
   * place they belong.
   */
  const PROFILE_LEVEL_IDENTIFIERS = [
    'FAMILY_POLICY',
    'STANDARD_POLICY',
    'resolveSafetyPolicy',
    'ACTIVE_EXPERIENCE_PROFILE',
    'ExperienceProfile',
    'IslandSafetyPolicyContext',
  ];

  const outsideSafety = sourceFiles(SRC)
    .filter((file) => !file.startsWith(`${SAFETY}/`))
    .filter((file) => !isTest(file));

  it.each(PROFILE_LEVEL_IDENTIFIERS.map((name) => [name] as const))(
    'no module outside src/safety references %s',
    (identifier) => {
      const referrers = outsideSafety
        .filter((file) => new RegExp(`\\b${identifier}\\b`).test(readFileSync(file, 'utf8')))
        .map(relative);

      expect(
        referrers,
        `${identifier} is profile-level; feature code should read a capability from useIslandSafetyPolicy(). Found in: ${referrers.join(', ')}`,
      ).toEqual([]);
    },
  );

  it('nobody chooses a profile when mounting the provider', () => {
    // The `profile` prop is a testing affordance. A non-test caller supplying it
    // would be a way to reach Family that this phase deliberately does not have.
    const callers = outsideSafety
      .filter((file) => readFileSync(file, 'utf8').includes('<IslandSafetyProvider'))
      .map((file) => [relative(file), readFileSync(file, 'utf8')] as const);

    expect(callers.length, 'the provider should be mounted exactly once').toBe(1);
    for (const [label, source] of callers) {
      const tag = source.slice(source.indexOf('<IslandSafetyProvider'));
      expect(
        /^<IslandSafetyProvider\s*>/.test(tag),
        `${label} passes props to IslandSafetyProvider; production must take the build's active profile`,
      ).toBe(true);
    }
  });
});

describe('capability consumption', () => {
  it('is how the chat path asks: by capability, never by profile', () => {
    const chat = readFileSync(join(SRC, 'components/blobbi/MultiplayerLayer.tsx'), 'utf8');
    expect(chat).toContain('admitChatMessage');
    expect(chat).toContain('useIslandSafetyPolicy');
    expect(chat).not.toMatch(/\bprofile\s*===/);
  });

  it('places the inbound check before anything can present the message', () => {
    // Structural, not stylistic: the admission call must come before the first
    // `queueBubble` in `processChatEvent`, because everything after that point
    // is presentation.
    const chat = readFileSync(join(SRC, 'components/blobbi/MultiplayerLayer.tsx'), 'utf8');
    const admission = chat.indexOf('admitChatMessage(safetyPolicy, { text: sanitizedText })');
    const presentation = chat.indexOf('queueBubble(');

    expect(admission, 'the inbound admission check should exist').toBeGreaterThan(-1);
    expect(presentation, 'queueBubble should exist').toBeGreaterThan(-1);
    expect(
      admission,
      'chat admission must be decided before the message reaches the presentation layer',
    ).toBeLessThan(presentation);
  });
});
