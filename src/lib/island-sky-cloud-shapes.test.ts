import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ISLAND_CLOUD_SHAPES,
  ISLAND_CLOUD_SHAPE_GEOMETRY,
  ISLAND_CLOUD_SIZES,
  ISLAND_CLOUD_SPECIAL_SHAPES,
  cloudShapeHeightPx,
  cloudShapeInkBounds,
  cloudShapeInkSpanPercent,
  cloudShapeWidthPx,
  isSpecialCloudShape,
} from './island-sky-cloud-shapes';

const WORLD_H = 697;
const WORLD_W = 1046;

describe('the shape set', () => {
  it('is exactly the six variants this phase calls for', () => {
    expect([...ISLAND_CLOUD_SHAPES].sort()).toEqual([
      'blobbi-adult',
      'blobbi-baby',
      'blobbi-egg',
      'heart',
      'normal',
      'poop',
    ]);
  });

  it('treats everything but the ordinary cloud as a rare formation', () => {
    expect([...ISLAND_CLOUD_SPECIAL_SHAPES].sort()).toEqual([
      'blobbi-adult',
      'blobbi-baby',
      'blobbi-egg',
      'heart',
      'poop',
    ]);
    expect(isSpecialCloudShape('normal')).toBe(false);
    for (const shape of ISLAND_CLOUD_SPECIAL_SHAPES) {
      expect(isSpecialCloudShape(shape), shape).toBe(true);
    }
  });

  it('gives every variant genuinely different geometry, not a relabelled copy', () => {
    // The brief's explicit prohibition: distinct `data-*` over identical SVG.
    const fingerprints = ISLAND_CLOUD_SHAPES.map((shape) => {
      const geometry = ISLAND_CLOUD_SHAPE_GEOMETRY[shape];
      return JSON.stringify([geometry.viewBoxWidth, geometry.viewBoxHeight, geometry.parts]);
    });
    expect(new Set(fingerprints).size).toBe(ISLAND_CLOUD_SHAPES.length);
  });

  it('gives every variant a distinct silhouette proportion', () => {
    // Measured on the INK, not the viewBox. The character contours are copied
    // verbatim from the artwork and several of those viewBoxes are square, so the
    // viewBox says nothing about the shape inside it.
    const aspects = ISLAND_CLOUD_SHAPES.map((shape) => {
      const b = cloudShapeInkBounds(ISLAND_CLOUD_SHAPE_GEOMETRY[shape]);
      return ((b.maxX - b.minX) / (b.maxY - b.minY)).toFixed(3);
    });
    expect(new Set(aspects).size).toBe(ISLAND_CLOUD_SHAPES.length);
  });
});

describe('construction rules', () => {
  it('uses only rounded geometry; no polygons, no sharp corners', () => {
    for (const shape of ISLAND_CLOUD_SHAPES) {
      for (const part of ISLAND_CLOUD_SHAPE_GEOMETRY[shape].parts) {
        expect(['circle', 'ellipse', 'rect', 'path'], shape).toContain(part.kind);
        // A rect is only allowed as a *rounded* body, never a hard box.
        if (part.kind === 'rect') {
          expect(part.rx, shape).toBeGreaterThan(0);
          expect(part.rx * 2, shape).toBeLessThanOrEqual(part.height + 0.001);
        }
        // A contour must curve. `L` would be a straight edge, which is what makes a
        // silhouette read as a polygon, several adult forms in the artwork are
        // polygons and none of them belongs in the sky.
        if (part.kind === 'path') {
          expect(part.d, shape).toMatch(/Q/);
          expect(part.d, shape).not.toMatch(/[LlHhVv]/);
        }
      }
    }
  });

  it('keeps every part inside its own viewBox, so no lobe can be clipped', () => {
    // The old tiled clouds looked permanently sliced. Nothing may reintroduce a
    // shape whose own wrapper cuts it.
    for (const shape of ISLAND_CLOUD_SHAPES) {
      const geometry = ISLAND_CLOUD_SHAPE_GEOMETRY[shape];
      const bounds = cloudShapeInkBounds(geometry);
      expect(bounds.minX, `${shape} minX`).toBeGreaterThanOrEqual(0);
      expect(bounds.minY, `${shape} minY`).toBeGreaterThanOrEqual(0);
      expect(bounds.maxX, `${shape} maxX`).toBeLessThanOrEqual(geometry.viewBoxWidth);
      expect(bounds.maxY, `${shape} maxY`).toBeLessThanOrEqual(geometry.viewBoxHeight);
    }
  });

  it('draws every character as ONE continuous contour, never stacked lobes', () => {
    /*
      The correction this pass exists for. `blobbi-egg`, `blobbi-baby` and
      `blobbi-adult` were assembled from rounded tiers narrowing upward, and all
      three read as poop clouds, because that IS the poop-swirl construction. A
      single contour cannot be read as a stack.
    */
    for (const shape of ['blobbi-egg', 'blobbi-baby', 'blobbi-adult', 'poop'] as const) {
      const parts = ISLAND_CLOUD_SHAPE_GEOMETRY[shape].parts;
      // ONE part is the invariant. Whether it is a contour or a single real ellipse
      // from the artwork does not matter; what matters is that there is no stack.
      expect(parts.length, shape).toBe(1);
      expect(['path', 'ellipse'], shape).toContain(parts[0].kind);
    }
  });

  it('keeps the assembled shapes cheap, and only lets non-characters be assembled', () => {
    // `normal` and `heart` may be lobe-built: neither is a character, so neither can
    // be mistaken for one.
    for (const shape of ['normal', 'heart'] as const) {
      const parts = ISLAND_CLOUD_SHAPE_GEOMETRY[shape].parts;
      expect(parts.length, shape).toBeGreaterThanOrEqual(4);
      expect(parts.length, shape).toBeLessThanOrEqual(6);
    }
  });

  it('keeps every formation within a comparable visual mass', () => {
    // "Approximately the same visual mass as a normal cloud": compared at medium,
    // by bounding-box area, which is the crude but honest measure.
    const area = (shape: (typeof ISLAND_CLOUD_SHAPES)[number]) =>
      cloudShapeWidthPx(shape, 'medium') * cloudShapeHeightPx(shape, 'medium');
    const normal = area('normal');
    for (const shape of ISLAND_CLOUD_SPECIAL_SHAPES) {
      expect(area(shape) / normal, shape).toBeGreaterThan(0.7);
      expect(area(shape) / normal, shape).toBeLessThan(1.5);
    }
  });

  it('scales monotonically across the three sizes', () => {
    for (const shape of ISLAND_CLOUD_SHAPES) {
      const widths = ISLAND_CLOUD_SIZES.map((size) => cloudShapeWidthPx(shape, size));
      expect(widths[0], shape).toBeLessThan(widths[1]);
      expect(widths[1], shape).toBeLessThan(widths[2]);
    }
  });
});

describe('upper-sky placement', () => {
  it('gives the tall formations their own high placement', () => {
    // The ordinary cloud rides its actor's path; that is the depth ladder. The
    // formations are taller, so a fixed high placement is what keeps them inside
    // the budget regardless of which actor is carrying them.
    expect(ISLAND_CLOUD_SHAPE_GEOMETRY.normal.topPercent).toBeUndefined();
    for (const shape of ISLAND_CLOUD_SPECIAL_SHAPES) {
      const top = ISLAND_CLOUD_SHAPE_GEOMETRY[shape].topPercent;
      expect(top, shape).toBeDefined();
      expect(top!, shape).toBeGreaterThan(0);
      expect(top!, shape).toBeLessThan(8);
    }
  });

  it('keeps every formation above the tree line at every size', () => {
    for (const shape of ISLAND_CLOUD_SPECIAL_SHAPES) {
      const top = ISLAND_CLOUD_SHAPE_GEOMETRY[shape].topPercent!;
      for (const size of ISLAND_CLOUD_SIZES) {
        const span = cloudShapeInkSpanPercent(shape, size, top, WORLD_H);
        expect(span.topPercent, `${shape}/${size}`).toBeGreaterThan(0);
        expect(span.bottomPercent, `${shape}/${size}`).toBeLessThanOrEqual(26);
      }
    }
  });

  it('never lets a formation take most of the frame width', () => {
    for (const shape of ISLAND_CLOUD_SHAPES) {
      expect(cloudShapeWidthPx(shape, 'large') / WORLD_W, shape).toBeLessThan(0.2);
    }
  });
});

describe('cloudShapeInkBounds', () => {
  it('measures the union of the parts, not the viewBox', () => {
    const bounds = cloudShapeInkBounds({
      viewBoxWidth: 100,
      viewBoxHeight: 100,
      widthPx: { small: 1, medium: 2, large: 3 },
      parts: [
        { kind: 'circle', cx: 50, cy: 50, r: 10 },
        { kind: 'ellipse', cx: 30, cy: 60, rx: 20, ry: 5 },
        { kind: 'rect', x: 70, y: 20, width: 25, height: 10, rx: 5 },
      ],
    });
    expect(bounds).toEqual({ minX: 10, maxX: 95, minY: 20, maxY: 65 });
  });
});

describe('the Blobbi contours come from the production artwork', () => {
  const pathOf = (shape: 'blobbi-baby' | 'blobbi-egg' | 'poop') => {
    const part = ISLAND_CLOUD_SHAPE_GEOMETRY[shape].parts[0];
    if (part.kind !== 'path') throw new Error(`${shape} is not a contour`);
    return part.d;
  };

  it('uses the baby body path verbatim', () => {
    // `data-blobbi-body="true"` in BABY_BASE_SVG. Read from the source so a change
    // to the artwork shows up here rather than drifting silently.
    const source = readFileSync(
      join(process.cwd(), 'packages/blobbi-react/src/artwork/baby-blobbi/lib/baby-svg-data.ts'),
      'utf8',
    );
    const body = pathOf('blobbi-baby').replace(/ Z$/, '');
    expect(source).toContain(body);
  });

  it('uses the default adult form\u2019s real body ellipse verbatim', () => {
    // `getDefaultAdultForm()` returns `catti`, whose `data-blobbi-body` shape is
    // `ellipse cx=100 cy=120 rx=45 ry=60`. Read from the source so an artwork change
    // surfaces here instead of drifting.
    const types = readFileSync(
      join(process.cwd(), 'packages/blobbi-react/src/artwork/adult-blobbi/types/adult.types.ts'),
      'utf8',
    );
    expect(types).toMatch(/getDefaultAdultForm[\s\S]{0,80}return 'catti'/);

    const source = readFileSync(
      join(process.cwd(), 'packages/blobbi-react/src/artwork/adult-blobbi/lib/adult-svg-data.ts'),
      'utf8',
    );
    const part = ISLAND_CLOUD_SHAPE_GEOMETRY['blobbi-adult'].parts[0];
    if (part.kind !== 'ellipse') throw new Error('adult is no longer an ellipse');
    expect(source).toContain(
      `cx="${part.cx}" cy="${part.cy}" rx="${part.rx}" ry="${part.ry}"`,
    );
  });

  it('keeps the baby crown pinch, which is what separates it from the egg', () => {
    // The production baby path opens `M 50 15 Q 50 10 50 15`: a pinch at the crown.
    // The egg is the same ovoid with that pinch smoothed into a dome, so the pinch is
    // the whole distinction and must survive.
    expect(pathOf('blobbi-baby')).toContain('Q 50 10 50 15');
    expect(pathOf('blobbi-egg')).not.toContain('Q 50 10 50 15');
  });

  it('derives the egg rather than claiming a source it does not have', () => {
    // There is no egg artwork anywhere: `loadBlobbiSvg` falls back to the baby
    // drawing for the egg stage. Asserting the absence keeps the docs honest.
    const loader = readFileSync(join(process.cwd(), 'packages/blobbi-react/src/artwork/load-blobbi-svg.ts'), 'utf8');
    expect(loader).toContain('Baby stage (also used as fallback for egg/unknown)');
  });

  it('gives the three lifecycle contours distinct proportions', () => {
    const ink = (shape: 'blobbi-egg' | 'blobbi-baby' | 'blobbi-adult') => {
      const g = ISLAND_CLOUD_SHAPE_GEOMETRY[shape];
      const b = cloudShapeInkBounds(g);
      return (b.maxX - b.minX) / (b.maxY - b.minY);
    };
    /*
      A real ladder, and the reason the adult uses the default form's oval rather
      than the generic teardrop path: narrow pointed egg (0.43) → pinched teardrop
      baby (0.64) → broad oval adult (0.75). Each step is visible at sky scale.
    */
    expect(ink('blobbi-egg')).toBeLessThan(ink('blobbi-baby'));
    expect(ink('blobbi-baby')).toBeLessThan(ink('blobbi-adult'));
    // Meaningfully apart, not distinguishable only to a calculator.
    expect(ink('blobbi-baby') - ink('blobbi-egg')).toBeGreaterThan(0.15);
    expect(ink('blobbi-adult') - ink('blobbi-baby')).toBeGreaterThan(0.08);
    // …and the adult always renders larger than the baby, which is the other half of
    // how a player tells them apart.
    expect(cloudShapeWidthPx('blobbi-adult', 'medium')).toBeGreaterThan(
      cloudShapeWidthPx('blobbi-baby', 'medium'),
    );
  });

  it('gives the poop shape three widening tiers, on purpose this time', () => {
    // Tiers narrowing upward is the construction that made the old character shapes
    // read as poop. Here it is the point.
    const d = pathOf('poop');
    expect((d.match(/Q/g) ?? []).length).toBeGreaterThanOrEqual(8);
    const bounds = cloudShapeInkBounds(ISLAND_CLOUD_SHAPE_GEOMETRY.poop);
    // Broad base, narrow tip.
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(80);
  });

  it('keeps the heart asymmetric, so it does not read as an icon', () => {
    const heart = ISLAND_CLOUD_SHAPE_GEOMETRY.heart;
    const lobes = heart.parts.filter(
      (part) =>
        part.kind === 'circle' && part.r > 15 && part.cy < heart.viewBoxHeight * 0.5,
    ) as Extract<(typeof heart.parts)[number], { kind: 'circle' }>[];
    expect(lobes.length).toBe(2);
    expect(lobes[0].r).not.toBe(lobes[1].r);
    expect(lobes[0].cy).not.toBe(lobes[1].cy);
    const tip = heart.parts.filter((part) => part.kind === 'circle' && part.r < 12);
    expect(tip.length).toBeGreaterThanOrEqual(1);
  });
});
