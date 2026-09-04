import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ISLAND_CLOUD_ACTORS,
  ISLAND_CLOUD_EDGE_MARGIN_PX,
  ISLAND_CLOUD_MAX_BOTTOM_PERCENT,
  islandCloudInkSpanPercent,
  islandCloudOnScreenAt,
  islandCloudTravel,
  islandCloudsOnScreenAt,
} from './island-sky-clouds';

/** The world is a fixed box; the cloud geometry is authored against it. */
const WORLD_W = 1046;
const WORLD_H = 697;

describe('cloud actors', () => {
  it('has exactly three', () => {
    // The whole point of replacing the tiled bands. Two dozen shapes on screen
    // read as a blanket; three individual clouds read as weather.
    expect(ISLAND_CLOUD_ACTORS).toHaveLength(3);
  });

  it('gives every actor a distinct id, path, speed and size sequence', () => {
    const unique = <T,>(values: T[]) => new Set(values).size === values.length;
    expect(unique(ISLAND_CLOUD_ACTORS.map((a) => a.id))).toBe(true);
    expect(unique(ISLAND_CLOUD_ACTORS.map((a) => a.topPercent))).toBe(true);
    expect(unique(ISLAND_CLOUD_ACTORS.map((a) => a.speedPxPerSecond))).toBe(true);
    // Deliberately NOT widthPx: that is the travel clearance now, and two actors
    // with the same largest allowed size legitimately share it. What must differ is
    // the authored size cycle, which is what varies a cloud between passages.
    expect(unique(ISLAND_CLOUD_ACTORS.map((a) => a.sizeSequence.join())))
      .toBe(true);
  });

  it('sends two the primary direction and one the reverse', () => {
    const byDirection = ISLAND_CLOUD_ACTORS.reduce<Record<string, number>>((acc, a) => {
      acc[a.direction] = (acc[a.direction] ?? 0) + 1;
      return acc;
    }, {});
    expect(byDirection).toEqual({ rightToLeft: 2, leftToRight: 1 });
  });

  it('makes the reverse-travelling cloud the least attention-seeking one', () => {
    // A cloud crossing against the others is a nice detail for a moment and an
    // irritation if it demands attention.
    const reverse = ISLAND_CLOUD_ACTORS.find((a) => a.direction === 'leftToRight')!;
    const others = ISLAND_CLOUD_ACTORS.filter((a) => a.direction !== 'leftToRight');
    // Never the biggest, always the faintest and the slowest. Compared on the
    // allowed size set and the mode of its authored cycle rather than on widthPx,
    // which is travel clearance and not what the player sees.
    expect(reverse.allowedSizes).not.toContain('large');
    const smallShare = (a: typeof reverse) =>
      a.sizeSequence.filter((s) => s === 'small').length / a.sizeSequence.length;
    for (const other of others) {
      expect(reverse.opacity).toBeLessThan(other.opacity);
      expect(reverse.speedPxPerSecond).toBeLessThan(other.speedPxPerSecond);
      expect(smallShare(reverse)).toBeGreaterThanOrEqual(smallShare(other));
    }
  });
});

describe('vertical placement', () => {
  it('keeps every cloud silhouette in the upper sky', () => {
    // Plaza turns opaque at ~38%, Mine's conifer line starts at ~30%. A cloud
    // below this line stops being sky and starts competing with buildings, hills
    // and the interactive art in front of them.
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const ink = islandCloudInkSpanPercent(actor, WORLD_H);
      expect(ink.topPercent, actor.id).toBeGreaterThan(0);
      expect(ink.bottomPercent, actor.id).toBeLessThanOrEqual(ISLAND_CLOUD_MAX_BOTTOM_PERCENT);
    }
  });

  it('orders the depth ladder: higher means slower, fainter and never largest', () => {
    // Sorted top-down. Height, speed and opacity are one depth cue; the size *set*
    // carries the rest of it, since only the lowest path may go large.
    const byHeight = [...ISLAND_CLOUD_ACTORS].sort((a, b) => a.topPercent - b.topPercent);
    for (let i = 1; i < byHeight.length; i += 1) {
      expect(byHeight[i].speedPxPerSecond, byHeight[i].id).toBeGreaterThan(
        byHeight[i - 1].speedPxPerSecond,
      );
      expect(byHeight[i].opacity, byHeight[i].id).toBeGreaterThan(byHeight[i - 1].opacity);
    }
    expect(byHeight[0].allowedSizes).not.toContain('large');
    expect(byHeight[byHeight.length - 1].allowedSizes).toContain('large');
  });

  it('never lets one cloud span most of the usable sky', () => {
    for (const actor of ISLAND_CLOUD_ACTORS) {
      // Horizontally: a fifth of the frame at most.
      expect(actor.widthPx / WORLD_W, actor.id).toBeLessThan(0.2);
      const ink = islandCloudInkSpanPercent(actor, WORLD_H);
      // Vertically: no more than half of the shallowest usable sky band.
      expect(ink.bottomPercent - ink.topPercent, actor.id).toBeLessThan(15);
    }
  });
});

describe('islandCloudTravel', () => {
  it('starts and ends fully outside the world, in both directions', () => {
    // This is what makes the loop reset invisible: the jump from `to` back to
    // `from` happens while the shape cannot be seen.
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const { fromPx, toPx } = islandCloudTravel(actor, WORLD_W);
      for (const [label, x] of [['from', fromPx], ['to', toPx]] as const) {
        const fullyOffscreen = x >= WORLD_W || x + actor.widthPx <= 0;
        expect(fullyOffscreen, `${actor.id} ${label} at ${x}`).toBe(true);
      }
    }
  });

  it('clears the edge by the full margin, so no lobe is caught mid-reset', () => {
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const { fromPx, toPx } = islandCloudTravel(actor, WORLD_W);
      const entry = actor.direction === 'rightToLeft' ? fromPx : toPx;
      const exit = actor.direction === 'rightToLeft' ? toPx : fromPx;
      expect(entry - WORLD_W).toBeGreaterThanOrEqual(ISLAND_CLOUD_EDGE_MARGIN_PX);
      expect(-(exit + actor.widthPx)).toBeGreaterThanOrEqual(ISLAND_CLOUD_EDGE_MARGIN_PX);
    }
  });

  it('mirrors the reverse direction rather than approximating it', () => {
    const [primary] = ISLAND_CLOUD_ACTORS.filter((a) => a.direction === 'rightToLeft');
    const reverse = ISLAND_CLOUD_ACTORS.find((a) => a.direction === 'leftToRight')!;
    const p = islandCloudTravel(primary, WORLD_W);
    const r = islandCloudTravel(reverse, WORLD_W);
    // Right-to-left decreases, left-to-right increases, and each begins on the
    // edge it should: same construction, reflected.
    expect(p.toPx).toBeLessThan(p.fromPx);
    expect(r.toPx).toBeGreaterThan(r.fromPx);
    expect(p.fromPx).toBeGreaterThan(WORLD_W);
    expect(r.fromPx).toBeLessThan(0);
    expect(p.distancePx).toBeGreaterThan(0);
    expect(r.distancePx).toBeGreaterThan(0);
  });

  it('spends a substantial part of every cycle offscreen', () => {
    // The gap between clouds is arithmetic, not luck: surplus travel distance at
    // a constant speed becomes time spent invisible.
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const travel = islandCloudTravel(actor, WORLD_W);
      expect(travel.offscreenWaitSeconds, actor.id).toBeGreaterThan(60);
      const onScreenFraction = (WORLD_W + actor.widthPx) / travel.distancePx;
      expect(onScreenFraction, actor.id).toBeLessThan(0.45);
    }
  });

  it('keeps the three cycle lengths well apart, so pairings do not repeat', () => {
    // An earlier arrangement had two actors within 3% of the same period, which
    // froze their relative phase for the length of a play session.
    const durations = ISLAND_CLOUD_ACTORS.map(
      (a) => islandCloudTravel(a, WORLD_W).durationSeconds,
    ).sort((a, b) => a - b);
    for (let i = 1; i < durations.length; i += 1) {
      expect(durations[i] / durations[i - 1]).toBeGreaterThan(1.2);
    }
  });

  it('crosses the screen slowly enough to read as drift', () => {
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const crossingSeconds = (WORLD_W + actor.widthPx) / actor.speedPxPerSecond;
      expect(crossingSeconds, actor.id).toBeGreaterThan(60);
      expect(crossingSeconds, actor.id).toBeLessThan(600);
    }
  });
});

describe('visible density over a full hour', () => {
  const samples = Array.from({ length: 3600 }, (_, second) =>
    islandCloudsOnScreenAt(WORLD_W, second),
  );
  const share = (predicate: (n: number) => boolean) =>
    samples.filter(predicate).length / samples.length;

  it('shows one cloud more often than any other count', () => {
    const counts = [0, 1, 2, 3].map((n) => share((v) => v === n));
    const most = counts.indexOf(Math.max(...counts));
    expect(most).toBe(1);
  });

  it('makes three simultaneous clouds rare', () => {
    expect(share((n) => n === 3)).toBeLessThan(0.08);
  });

  it('never fills the sky, and never empties it for long', () => {
    expect(share((n) => n >= 2)).toBeLessThan(0.35);
    expect(share((n) => n === 0)).toBeLessThan(0.45);
    expect(share((n) => n >= 1)).toBeGreaterThan(0.55);
  });

  it('keeps the average close to a single cloud', () => {
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeGreaterThan(0.7);
    expect(mean).toBeLessThan(1.5);
  });

  it('rarely puts the largest cloud on screen with both others', () => {
    // A large cloud should usually pass alone, or while another is mostly gone.
    const large = [...ISLAND_CLOUD_ACTORS].sort((a, b) => b.widthPx - a.widthPx)[0];
    let visible = 0;
    let crowded = 0;
    for (let second = 0; second < 3600; second += 1) {
      if (!islandCloudOnScreenAt(large, WORLD_W, second)) continue;
      visible += 1;
      if (islandCloudsOnScreenAt(WORLD_W, second) === 3) crowded += 1;
    }
    expect(visible).toBeGreaterThan(0);
    expect(crowded / visible).toBeLessThan(0.2);
  });
});

describe('islandCloudOnScreenAt', () => {
  it('is periodic in the actor’s own cycle', () => {
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const period = islandCloudTravel(actor, WORLD_W).durationSeconds;
      for (const t of [0, 37, 210, 999]) {
        expect(islandCloudOnScreenAt(actor, WORLD_W, t), `${actor.id}@${t}`).toBe(
          islandCloudOnScreenAt(actor, WORLD_W, t + period * 3),
        );
      }
    }
  });

  it('handles negative time without falling out of the cycle', () => {
    for (const actor of ISLAND_CLOUD_ACTORS) {
      expect(typeof islandCloudOnScreenAt(actor, WORLD_W, -5000)).toBe('boolean');
    }
  });
});

describe('the tiled cloud bands are gone', () => {
  const read = (relative: string) =>
    readFileSync(join(process.cwd(), relative), 'utf8');

  /**
   * Strip comments before asserting.
   *
   * These files deliberately *describe* the band model in prose; that history is
   * why the current design looks the way it does. What must not survive is the
   * band model in the code, so the assertions are made against code only.
   */
  const code = (relative: string) =>
    read(relative)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('leaves no trace of the band class, keyframes or repeat-x tiling', () => {
    // The band model is what produced both reported defects, a blanket of
    // repeated puffs, and shapes permanently sliced at the tile boundary. A
    // leftover rule would quietly resurrect either one.
    for (const file of [
      'src/index.css',
      'src/components/sky/IslandSkyLayer.tsx',
      'src/lib/island-sky-clouds.ts',
    ]) {
      const source = code(file);
      expect(source, file).not.toContain('island-sky-cloud-band');
      expect(source, file).not.toContain('island-sky-cloud-drift');
      expect(source, file).not.toContain('repeat-x');
      expect(source, file).not.toContain('backgroundRepeat');
    }
  });

  it('grades world sprites without a transition that would clobber their own', () => {
    // `.bush-sway-target` declares `transition: transform 0.3s` on the bush IMAGE,
    // and the grade's selector outranks it. A `transition` in the grade rule would
    // reset that longhand and silently kill the bush hover sway, so the rule
    // deliberately omits one, and the grade steps imperceptibly instead.
    const css = read('src/index.css');
    const rule = /\[data-island-world-graded\] img \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('--island-world-grade');
    expect(rule).not.toContain('transition');
    // The bush's own transition must still be the only one on that element.
    expect(css).toContain('transition: transform 0.3s ease-out');
  });

  it('exposes an explicit opt-out contract, matched on the image or a wrapper', () => {
    // The semantic contract that replaced the two hardcoded character selectors:
    // any world sprite can decline the grade at its own call site, and putting the
    // attribute on a wrapper covers the images inside it.
    const css = read('src/index.css');
    expect(css).toContain("[data-island-world-graded] img[data-island-world-grade='exclude']");
    expect(css).toContain("[data-island-world-graded] [data-island-world-grade='exclude'] img");
  });

  it('disables travel for reduced motion by the new actor class', () => {
    // jsdom applies no stylesheet, so the rule itself is what can be checked,
    // and it is the entire mechanism, in CSS by design so it needs no JS.
    const css = read('src/index.css');
    expect(css).toContain("[data-island-sky-reduced-motion='true'] .island-sky-cloud");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.island-sky-cloud,/);
  });
});
