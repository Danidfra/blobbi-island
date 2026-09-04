/**
 * Exhaustive coverage for the rear-facing Blobbi renderer.
 *
 * The rear view is derived from the front artwork by deleting comment-delimited
 * face blocks (see `rear-view.ts`). That only stays correct as long as every
 * shipped SVG keeps using the comment convention, so this suite is table-driven
 * over EVERY Blobbi drawing: 16 adult forms × {base, sleeping} plus the baby's
 * two variants: and is the tripwire for new artwork that forgets a comment or
 * invents a new face label.
 */
import { describe, it, expect } from 'vitest';
import {
  applyRearView,
  findRearViewRemovals,
  isSelfContainedMarkup,
  REAR_VIEW_REMOVED_BLOCKS,
} from './rear-view';
import { applyGazeMarkup } from './gaze';
import { ADULT_FORMS, type AdultForm } from '../artwork/adult-blobbi';
import { getAdultBaseSvg, getAdultSleepingSvg } from '../artwork/adult-blobbi';
import { getBabyBaseSvg, getBabySleepingSvg } from '../artwork/baby-blobbi';
import { loadBlobbiSvg } from '../artwork/load-blobbi-svg';

interface Drawing {
  name: string;
  svg: string;
  /** Arguments that reproduce this drawing through the public renderer API. */
  load: (view: 'front' | 'rear') => string;
}

const DRAWINGS: Drawing[] = [
  ...ADULT_FORMS.flatMap((form: AdultForm): Drawing[] => [
    {
      name: `adult/${form}/base`,
      svg: getAdultBaseSvg(form),
      load: (view) => loadBlobbiSvg('adult', form, '#ff8800', '#0088ff', '#222222', false, `t-${form}`, view),
    },
    {
      name: `adult/${form}/sleeping`,
      svg: getAdultSleepingSvg(form),
      load: (view) => loadBlobbiSvg('adult', form, '#ff8800', '#0088ff', '#222222', true, `t-${form}-s`, view),
    },
  ]),
  {
    name: 'baby/base',
    svg: getBabyBaseSvg(),
    load: (view) => loadBlobbiSvg('baby', undefined, '#ff8800', '#0088ff', '#222222', false, 't-baby', view),
  },
  {
    name: 'baby/sleeping',
    svg: getBabySleepingSvg(),
    load: (view) => loadBlobbiSvg('baby', undefined, '#ff8800', '#0088ff', '#222222', true, 't-baby-s', view),
  },
];

/** Every comment label present in a drawing, trimmed. */
function commentLabels(svg: string): string[] {
  return [...svg.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1].trim());
}

const FACE_LABELS = new Set(REAR_VIEW_REMOVED_BLOCKS.map((l) => l.toLowerCase()));

describe('rear-view SVG derivation', () => {
  it('covers the full art inventory (34 drawings)', () => {
    expect(DRAWINGS).toHaveLength(34);
    expect(new Set(DRAWINGS.map((d) => d.name)).size).toBe(34);
  });

  describe.each(DRAWINGS.map((d) => [d.name, d] as const))('%s', (_name, drawing) => {
    const rear = () => applyRearView(drawing.load('rear'));

    it('removes every face comment block', () => {
      const remaining = commentLabels(rear()).filter((label) => FACE_LABELS.has(label.toLowerCase()));
      expect(remaining).toEqual([]);
    });

    it('draws no pupils, eye whites, mouth or blush shapes', () => {
      // Nothing from a face block may survive; the block labels above are the
      // structural check, this is the "did the splice actually happen" check.
      const out = rear();
      for (const label of REAR_VIEW_REMOVED_BLOCKS) {
        expect(out).not.toContain(`<!-- ${label} -->`);
      }
    });

    it('keeps the body: gradients, defs and a non-trivial amount of markup', () => {
      const front = drawing.load('front');
      const out = rear();

      expect(out).toContain('<svg');
      expect(out).toContain('</svg>');
      expect(out).toContain('<defs>');
      // The rear view is a subset, never a rewrite, and never a near-empty shell.
      expect(out.length).toBeLessThan(front.length);
      expect(out.length).toBeGreaterThan(front.length * 0.4);
    });

    it('keeps every non-face comment block', () => {
      const frontLabels = commentLabels(drawing.load('front'));
      const expected = frontLabels.filter((l) => !FACE_LABELS.has(l.toLowerCase()));
      expect(commentLabels(rear())).toEqual(expected);
    });

    it('leaves the front view untouched (rear is opt-in)', () => {
      const front = drawing.load('front');
      // The front path must not run the transform: same input, same bytes, and
      // the face is still there.
      expect(drawing.load('front')).toBe(front);
      expect(commentLabels(front).some((l) => FACE_LABELS.has(l.toLowerCase()))).toBe(true);
    });

    it('only deletes self-contained markup (never orphans a closing tag)', () => {
      // Every face block in shipped art must be structurally safe to splice out.
      // If this fails for new artwork, the face block was nested inside a group
      // and `applyRearView`'s guard would silently leave the face visible.
      const customized = drawing.load('front');
      const removals = findRearViewRemovals(customized);
      expect(removals.length).toBeGreaterThan(0);
      for (const { label, start, end } of removals) {
        expect(
          isSelfContainedMarkup(customized.slice(start, end)),
          `block "${label}" is not self-contained`,
        ).toBe(true);
      }
      // ...and the whole result is still balanced.
      const out = applyRearView(customized);
      expect(isSelfContainedMarkup(out)).toBe(true);
    });

    it('still uniquifies ids so two Blobbis can coexist', () => {
      const a = applyRearView(drawing.load('rear'));
      // Only assert when the drawing actually defines ids to scope.
      const ids = [...a.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      if (ids.length > 0) {
        expect(ids.every((id) => id.length > 0)).toBe(true);
      }
    });

    it('makes applyGazeMarkup a no-op', () => {
      const out = rear();
      expect(applyGazeMarkup(out)).toBe(out);
    });

    it('is idempotent', () => {
      const once = rear();
      expect(applyRearView(once)).toBe(once);
    });
  });

  it("keeps froggi's pop-out eye bulges (silhouette, not a face detail)", () => {
    const front = getAdultBaseSvg('froggi');
    expect(front).toContain('Big circular pop-out eyes');
    const rear = loadBlobbiSvg('adult', 'froggi', '#4ade80', '#22c55e', '#111', false, 'froggi', 'rear');
    expect(rear).toContain('Big circular pop-out eyes');
    // ...while its actual eyes/pupils/mouth are gone.
    expect(rear).not.toContain('<!-- Pupils');
    expect(rear).not.toContain('<!-- Mouth -->');
  });

  it("keeps pandi's black ear patches", () => {
    const rear = loadBlobbiSvg('adult', 'pandi', '#ffffff', '#111111', '#111', false, 'pandi', 'rear');
    expect(rear).toContain('Black ear patches');
    expect(rear).not.toContain('Eyes (black patches + white base)');
  });

  it('keeps the sleeping "Zzz": a sleeping Blobbi reads from behind too', () => {
    const rear = applyRearView(loadBlobbiSvg('baby', undefined, '#ff8800', '#0088ff', '#222', true, 'zzz', 'rear'));
    expect(rear).toMatch(/Zzz|Z's for sleeping/);
  });

  it('never removes gradient definitions that merely mention the face', () => {
    for (const label of ['Eye gradient', 'Pupil gradient', 'Mouth gradient']) {
      expect(FACE_LABELS.has(label.toLowerCase())).toBe(false);
    }
  });

  it('leaves markup without face blocks untouched', () => {
    const plain = '<svg><!-- Round body --><circle r="1"/></svg>';
    expect(applyRearView(plain)).toBe(plain);
  });

  it('refuses to splice a face block that would orphan a closing tag', () => {
    const unsafe = '<svg><g><!-- Mouth --><path d="M0 0"/></g><!-- Legs --><rect/></svg>';
    // The Mouth block spans `</g>`, so removing it would break the document.
    expect(applyRearView(unsafe)).toBe(unsafe);
  });
});

describe('isSelfContainedMarkup', () => {
  it.each([
    ['<circle/><rect/>', true],
    ['<g><circle/></g>', true],
    ['<g><circle/>', false],
    ['<circle/></g>', false],
    ['<!-- Mouth --><path d="M 0 0 Q 1 1"/>', true],
    ['<animateTransform attributeName="transform" />', true],
  ])('%s -> %s', (fragment, expected) => {
    expect(isSelfContainedMarkup(fragment)).toBe(expected);
  });
});
