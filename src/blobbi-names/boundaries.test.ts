/**
 * Where the name rules live, and where the classifier must NOT.
 *
 * The second half is the more important one. Communication V2 drops a
 * free-text message entirely under a curated policy; running it through a
 * profanity filter and rendering a masked version instead would be a strict
 * downgrade, `$%&#@` still tells a child someone is shouting at them, and
 * `come find me on discord` passes every filter ever written. These tests make
 * that regression fail loudly rather than quietly.
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

/** Strip comments: the prose here names these very identifiers. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every module specifier a file imports. */
function importsOf(file: string): string[] {
  const source = code(file);
  const specifiers: string[] = [];
  for (const pattern of [
    /\bimport\s+(?:[\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

describe('chat stays drop-based', () => {
  it('keeps the classifier out of the communication layer', () => {
    // A free-text message under a curated policy is DROPPED, not masked.
    // Importing a profanity filter here would be the first step toward
    // rendering a sanitised version of something that should not appear at all.
    const offenders = sourceFiles(join(SRC, 'communication'))
      .filter((file) => !isTest(file))
      .filter((file) => importsOf(file).some((spec) => spec.startsWith('@/user-text')))
      .map(relative);

    expect(offenders).toEqual([]);
  });

  it('keeps the classifier out of the safety admission layer', () => {
    const admission = code(join(SRC, 'safety/chat-admission.ts'));
    expect(admission).not.toContain('user-text');
    expect(admission).not.toContain('Prohibited');
  });

  it('leaves the free-text capability check exactly as it was', () => {
    // The rule is the capability, not the content, `admitChatMessage` still
    // decides by class and never inspects words.
    const admission = code(join(SRC, 'safety/chat-admission.ts'));
    expect(admission).toContain('policy.freeTextChat');
    expect(admission).toContain('free-text-not-permitted');
  });
});

describe('the classifier is invoked deliberately, not everywhere', () => {
  it('has a small, named set of consumers', () => {
    // Defence in depth means a surface CHOOSES to ask. A long consumer list
    // would mean it had quietly become the app's censor.
    const consumers = sourceFiles(SRC)
      .filter((file) => !isTest(file))
      .filter((file) => importsOf(file).some((spec) => spec.startsWith('@/user-text')))
      .map(relative);

    expect(consumers.sort()).toEqual(['src/blobbi-names/display-names.ts']);
  });
});

describe('names resolve at the model boundary', () => {
  it('is resolved wherever a stranger event becomes a visual', () => {
    // Both places a remote name is produced: the presence-driven visual fetch
    // and the info modal's later refresh from the full event.
    for (const file of [
      join(SRC, 'components/blobbi/MultiplayerLayer.tsx'),
      join(SRC, 'components/blobbi/PlayingView.tsx'),
    ]) {
      expect(code(file), relative(file)).toContain('resolveRemoteBlobbiDisplayName');
    }
  });

  it('is the only thing world labels read', () => {
    // The label, its title and its aria-label all come from `visual.name`,
    // which is already resolved, so no component needs to know this rule
    // exists, and a seventh surface added later is safe by default.
    const layer = code(join(SRC, 'components/blobbi/MultiplayerLayer.tsx'));
    expect(layer).toContain('aria-label={player.visual.name}');
    expect(layer).toContain('title={player.visual.name}');
  });

  it('never branches on a profile name', () => {
    for (const file of sourceFiles(join(SRC, 'blobbi-names')).filter((f) => !isTest(f))) {
      expect(code(file), relative(file)).not.toMatch(/profile\s*===/);
    }
  });
});

describe('the own-name writer has one validator', () => {
  it('is consulted by the adoption writer', () => {
    const writer = code(join(SRC, 'hooks/useFirstEggAdoption.ts'));
    expect(writer).toContain('admitOwnBlobbiName(');
  });

  it('refuses at the top of the adoption run, before anything else happens', () => {
    // Scoped to the `run` body: `strictPublish` is DEFINED earlier in the file,
    // so a whole-file index comparison would measure declaration order rather
    // than execution order.
    const writer = code(join(SRC, 'hooks/useFirstEggAdoption.ts'));
    const body = writer.slice(writer.indexOf('const run = async ()'));

    const admit = body.indexOf('admitOwnBlobbiName(');
    // The profile read went through `nostr.query` and now goes through the
    // completion-aware reader; what matters is that it happens AFTER the name
    // has been admitted, whichever helper does it.
    const read = body.indexOf('readRelayConfirmedOrThrow(');
    const publish = body.indexOf('strictPublish');

    expect(admit).toBeGreaterThan(-1);
    // Before the profile read and before any publish: a refused name costs no
    // relay round trip and never reaches a signer.
    expect(read).toBeGreaterThan(-1);
    expect(admit).toBeLessThan(read);
    expect(admit).toBeLessThan(publish);
  });

  it('is the only writer that puts a name on a Blobbi state event', () => {
    // If a rename is ever added it must route through the same validator. This
    // fails the moment a second module writes a `name` tag alongside kind 31124,
    // which is exactly when that decision has to be made.
    const writers = sourceFiles(SRC)
      .filter((file) => !isTest(file))
      .filter((file) => /\[\s*'name'\s*,/.test(code(file)))
      .filter((file) => /31124|KIND_BLOBBI_STATE/.test(code(file)))
      .map(relative);

    expect(writers.sort()).toEqual([
      // The generic tag builder, called by the adoption writer.
      'src/hooks/useBlobbiEvents.ts',
      // The adoption writer itself, where `admitOwnBlobbiName` is enforced.
      'src/hooks/useFirstEggAdoption.ts',
      // A parser, not a writer.
      'src/lib/blobbi-parsers.ts',
    ]);
  });
});

describe('the composer offers no free text', () => {
  it('renders selects and no text input', () => {
    const composer = code(join(SRC, 'components/blobbi/CuratedNameComposer.tsx'));
    expect(composer).toContain('<select');
    expect(composer).not.toContain('<input');
    expect(composer).not.toContain('<Input');
    expect(composer).not.toContain('<textarea');
  });
});
