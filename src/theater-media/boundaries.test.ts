/**
 * The theater's media boundary, checked against the real source.
 *
 * Two claims worth pinning structurally, because both are one refactor away
 * from quietly becoming false:
 *
 *  - media reaches the state machine through ONE call, so a fifth entry path
 *    cannot be added without passing the gate;
 *  - the iframe is constructed in ONE place, so its host and its permissions
 *    cannot diverge.
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

/** Strip comments: the prose here discusses these very identifiers. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const featureFiles = sourceFiles(SRC).filter((file) => !isTest(file));

describe('media enters the theater through one gate', () => {
  it('dispatches a media submission from exactly one place', () => {
    // Four paths can put media on screen — the input, a session `set-media`,
    // joining, and the re-seat fallback — and all four funnel here. A fifth that
    // dispatched directly would bypass admission entirely.
    const stage = code(join(SRC, 'components/blobbi/theater/TheaterStage.tsx'));
    const dispatches = stage.match(/dispatch\(\{\s*type:\s*'submit'/g) ?? [];
    expect(dispatches).toHaveLength(1);
  });

  it('admits before it dispatches', () => {
    const stage = code(join(SRC, 'components/blobbi/theater/TheaterStage.tsx'));
    const admit = stage.indexOf('admitTheaterMedia(');
    const dispatch = stage.indexOf("dispatch({ type: 'submit'");

    expect(admit).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(-1);
    // Order is the whole guarantee: refused media must never become a `request`,
    // because a `request` is what causes a player to be constructed.
    expect(admit).toBeLessThan(dispatch);
  });

  it('checks the publication seam too', () => {
    // The host's half. A caller holding `onLocalCommand` should not be able to
    // broadcast media this experience would refuse to play.
    const hook = code(join(SRC, 'hooks/useSharedPlayback.ts'));
    expect(hook).toContain('admitTheaterMedia(');
  });

  it('never branches on a profile name', () => {
    for (const file of [
      join(SRC, 'components/blobbi/theater/TheaterStage.tsx'),
      join(SRC, 'components/blobbi/theater/TheaterControlCard.tsx'),
      join(SRC, 'theater-media/admission.ts'),
    ]) {
      expect(code(file), relative(file)).not.toMatch(/profile\s*===/);
    }
  });
});

describe('the embed has one owner', () => {
  it('constructs a YouTube player in exactly one file', () => {
    const constructors = featureFiles
      .filter((file) => /new\s+YT\.Player\s*\(/.test(code(file)))
      .map(relative);

    expect(constructors).toEqual(['src/lib/youtube-player.ts']);
  });

  it('serves it from the privacy-enhanced host', () => {
    const player = code(join(SRC, 'lib/youtube-player.ts'));
    expect(player).toContain('https://www.youtube-nocookie.com');
    expect(player).toContain('host: YOUTUBE_EMBED_HOST');
  });

  it('ties fullscreen to the iframe permissions, not to a control', () => {
    // `fs` only removes YouTube's own button. Withholding `allowfullscreen` and
    // the Permissions-Policy token is what actually denies the capability.
    const player = code(join(SRC, 'lib/youtube-player.ts'));
    expect(player).toContain('allowFullscreen ? 1 : 0');
    expect(player).toContain('allowfullscreen');
  });

  it('keeps the nocookie host inside the CSP that already allows it', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('https://www.youtube-nocookie.com');
  });
});
