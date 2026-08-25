/**
 * Where the presence-detail decision lives, and where it must not.
 *
 * The projection is worth nothing if a publisher can build an event around it,
 * or if a renderer starts making its own judgement about how much detail a
 * player deserves to see. Both are the shapes this kind of rule decays into.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const relative = (file: string) => file.replace(`${process.cwd()}/`, '');

/** Strip comments: the prose in these files names the very identifiers below. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('one owner for the presence-detail decision', () => {
  it('is read in exactly one place outside the policy definitions', () => {
    // A second reader would mean two answers to "how much may we say", and the
    // one nobody remembered would be the one that leaked.
    const readers = sourceFiles(SRC)
      .filter((file) => !isTest(file))
      .filter((file) => /\bdetailedPresence\b/.test(code(file)))
      .map(relative)
      .sort();

    expect(readers).toEqual([
      // Where the capability is DECLARED…
      'src/safety/island-safety-policy.ts',
      'src/safety/policies.ts',
      // …and the one place it is APPLIED.
      'src/lib/presence-projection.ts',
    ].sort());
  });

  it('never branches on a profile name', () => {
    expect(code(join(SRC, 'lib/presence-projection.ts'))).not.toMatch(/profile\s*===/);
  });
});

describe('the wire is built from projected data', () => {
  it('routes every publish through the one builder', () => {
    // Six publish helpers, one funnel. A seventh that serialised its own
    // content would bypass the projection entirely.
    const multiplayer = code(join(SRC, 'lib/multiplayer.ts'));
    const builders = multiplayer.match(/kind:\s*31950/g) ?? [];
    expect(builders).toHaveLength(1);

    const publishers = multiplayer.match(/buildPresence31950\(\{/g) ?? [];
    expect(publishers.length).toBeGreaterThanOrEqual(6);
  });

  it('projects before it serialises', () => {
    const builder = code(join(SRC, 'lib/multiplayer.ts'));
    const body = builder.slice(builder.indexOf('export function buildPresence31950'));
    const project = body.indexOf('projectPresenceForPolicy(');
    const serialize = body.indexOf('JSON.stringify(content)');

    expect(project).toBeGreaterThan(-1);
    expect(project).toBeLessThan(serialize);
  });

  it('reads the policy at publish time, not at capture time', () => {
    // A heartbeat interval outlives the render that built it. This is the same
    // stale-closure shape the identity boundary was fixed for.
    const presence = code(join(SRC, 'hooks/useIslandPresence.ts'));
    expect(presence).toContain('policyRef.current');
    expect(presence).not.toMatch(/policy:\s*safetyPolicy\b/);
  });
});

describe('rendering does not decide how much to show', () => {
  it('keeps the capability out of the components', () => {
    // A remote client renders what it was sent. Deciding there would mean the
    // detail had already been published.
    const offenders = sourceFiles(join(SRC, 'components'))
      .filter((file) => !isTest(file))
      .filter((file) => /\bdetailedPresence\b/.test(code(file)))
      .map(relative);

    expect(offenders).toEqual([]);
  });
});
