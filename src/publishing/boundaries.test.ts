/**
 * The two boundaries, and, just as important, what they deliberately did NOT
 * touch.
 *
 * `publicNotePublishing` is easy to over-apply. Read as "no Nostr", it would
 * disable presence, chat, pet state, inventory, equipment and themes, breaking
 * the island entirely while protecting nobody. So this file asserts both halves:
 * the social post is gated, and the game's own protocol writes are not.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const PUBLISHING = join(SRC, 'publishing');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const relative = (file: string) => file.replace(`${process.cwd()}/`, '');

/** Strip comments: the prose here discusses kind 1 and Blossom at length. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const featureFiles = sourceFiles(SRC).filter((file) => !isTest(file));

describe('media uploads have one owner', () => {
  it('constructs a Blossom uploader in exactly one file', () => {
    const constructors = featureFiles
      .filter((file) => /new\s+BlossomUploader\s*\(/.test(code(file)))
      .map(relative);

    expect(constructors).toEqual(['src/hooks/useUploadFile.ts']);
  });

  it('checks the capability there, before the uploader is built', () => {
    const source = code(join(SRC, 'hooks/useUploadFile.ts'));
    const gate = source.indexOf('policy.mediaUploads');
    const construct = source.indexOf('new BlossomUploader');

    expect(gate).toBeGreaterThan(-1);
    expect(construct).toBeGreaterThan(-1);
    // Constructing hands the signer over; the refusal must come first.
    expect(gate).toBeLessThan(construct);
  });
});

describe('the public note has one writer', () => {
  it('builds a kind 1 event in exactly one place', () => {
    // Anything else publishing a social note would be a second surface with no
    // capability check on it.
    const builders = featureFiles
      .filter((file) => /\bkind:\s*1\s*,/.test(code(file)))
      .map(relative);

    expect(builders).toEqual(['src/publishing/photo-share.ts']);
  });

  it('decides before it uploads', () => {
    const source = code(join(PUBLISHING, 'usePhotoShare.ts'));
    const permit = source.indexOf('permitPhotoShare(policy)');
    const upload = source.indexOf('uploadFile(');

    expect(permit).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(-1);
    // Blossom is content-addressed and public: an upload cannot be taken back,
    // so nothing may reach it until the whole operation is known to be allowed.
    expect(permit).toBeLessThan(upload);
  });
});

describe('gameplay Nostr publishing is untouched', () => {
  it('leaves the shared publisher free of policy', () => {
    // A gate here would disable presence, chat, pet state, inventory, equipment
    // and themes: the island would stop working.
    const source = code(join(SRC, 'hooks/useNostrPublish.ts'));
    expect(source).not.toContain('useIslandSafetyPolicy');
    expect(source).not.toContain('publicNotePublishing');
    expect(source).not.toContain('mediaUploads');
  });

  it('still has many gameplay consumers, none of them gated', () => {
    const consumers = featureFiles
      .filter((file) => /useNostrPublish\s*\(\s*\)/.test(code(file)))
      .map(relative);

    // Presence/chat, pet state, owner profile, item use, equipment, themes,
    // stage background: plus the photo share. (The kind:31633 inventory
    // writers are deliberately NOT here: they publish strictly through the
    // shared inventory transaction, which never treats a timeout as success.)
    expect(consumers.length).toBeGreaterThan(5);
    expect(consumers).toContain('src/components/blobbi/MultiplayerLayer.tsx');
    expect(consumers).toContain('src/hooks/useBlobbiEvents.ts');
    expect(consumers).toContain('src/inventory/useUseItem.ts');
    expect(consumers).not.toContain('src/inventory/useInventoryMutation.ts');
  });

  it('does not gate the game protocol kinds', () => {
    // Named explicitly so a future over-broad gate fails here rather than in a
    // player's session: these are all required for the island to function.
    const gameplayKinds = ['21201', '31950', '31124', '11125', '31633', '31634'];
    const publishing = sourceFiles(PUBLISHING)
      .filter((file) => !isTest(file))
      .map((file) => code(file))
      .join('\n');

    for (const kind of gameplayKinds) {
      expect(publishing, `the publishing boundary must not know about kind ${kind}`).not.toContain(
        kind,
      );
    }
  });
});
