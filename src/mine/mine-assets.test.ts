/**
 * Every sprite the Mine can draw exists on disk under the path it is drawn
 * from.
 *
 * The gem sprites broke when the drop table was extracted into `policy.ts`:
 * the mined item's `type` became a bare kind (`gem-1`) while the render kept
 * passing it to `miningItemPath`, which expects a filename. Four broken images
 * with no `alt` and no error handler, sitting over the cave wall. This pins
 * the reference chain, config → path → file, so the next refactor cannot
 * silently break it again.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { miningItemPath } from '@/lib/asset-paths';
import { MINE_GEM_TABLE, mineGem, type MineGemKind } from './policy';

const PUBLIC = join(process.cwd(), 'public');

function onDisk(publicPath: string): boolean {
  expect(publicPath.startsWith('/')).toBe(true);
  return existsSync(join(PUBLIC, publicPath));
}

describe('mining asset references', () => {
  it('every gem in the drop table resolves to a sprite that exists', () => {
    for (const gem of MINE_GEM_TABLE) {
      const path = miningItemPath(gem.asset);
      expect(onDisk(path), `${gem.kind} → ${path}`).toBe(true);
    }
  });

  it('a mined kind is drawn through its spec asset, never through the bare kind', () => {
    const kinds: MineGemKind[] = ['stone', 'gem-1', 'gem-2', 'gem-3'];
    for (const kind of kinds) {
      expect(onDisk(miningItemPath(mineGem(kind).asset))).toBe(true);
      // The bare kind has no extension and matches no file: the regression.
      expect(onDisk(miningItemPath(kind))).toBe(false);
    }
    const source = readFileSync(
      join(process.cwd(), 'src/components/blobbi/MiningGame.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/miningItemPath\(item\.type\)/);
    expect(source).toMatch(/miningItemPath\(mineGem\(item\.type\)\.asset\)/);
  });

  it('the wall hole sprite exists', () => {
    expect(onDisk(miningItemPath('mine-wall-hole.png'))).toBe(true);
  });
});
