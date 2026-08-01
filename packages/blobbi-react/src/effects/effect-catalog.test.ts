/**
 * The PRESETS as a structural contract.
 *
 * Twelve presets is enough that "it looked fine when I added it" stops being a
 * review strategy. These tests read the catalogue's own numbers and enforce the
 * rules the phase committed to: bounded particle counts, no animation fast
 * enough to flicker, no keyframe that does not exist, and — the one a reviewer
 * cannot check by eye — no source file in the effect system that reaches for a
 * timer, a frame loop or `Math.random()`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import {
  BLOBBI_VISUAL_EFFECT_PRESETS,
  MAX_PIECES_PER_EFFECT,
  MAX_PIECES_TOTAL,
  MIN_ANIMATION_DURATION_S,
  presetPieceCount,
  getBlobbiVisualEffectInfo,
  type EffectPieceGroup,
  type EffectRange,
} from './effect-catalog';
import {
  BLOBBI_VISUAL_EFFECT_IDS,
  EFFECT_SLOTS,
  EFFECT_SLOT_ORDER,
} from './effect-model';
import {
  BLOBBI_EFFECT_STYLESHEET,
  EFFECT_ANIMATION_NAMES,
  effectStylesheetFor,
  isKnownEffectAnimation,
} from './effect-styles';
import { pieceShapeStyle, type EffectPieceKind } from './effect-shapes';

const PRESETS = Object.values(BLOBBI_VISUAL_EFFECT_PRESETS);
const allGroups = (): EffectPieceGroup[] => PRESETS.flatMap((p) => p.groups);

const EFFECTS_DIR = __dirname;
const PACKAGE_ROOT = resolve(EFFECTS_DIR, '../..');

function sourceFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesIn(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

const EFFECT_SOURCES = sourceFilesIn(EFFECTS_DIR);

/**
 * A file's CODE, with comments removed.
 *
 * The same discipline `package-purity.test.ts` applies by matching import
 * statements rather than free text: these modules explain at length why they
 * do not call `Math.random()` and why rarity is Island's concern, and a
 * document that names the thing it forbids must not trip the check that
 * forbids it. Comments are the only thing stripped — no string in this
 * directory contains `//`, so nothing else can be lost.
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('the catalogue covers exactly the declared effects', () => {
  it('has one preset per id, keyed by its own id', () => {
    expect(Object.keys(BLOBBI_VISUAL_EFFECT_PRESETS).sort()).toEqual(
      [...BLOBBI_VISUAL_EFFECT_IDS].sort(),
    );
    for (const [key, preset] of Object.entries(BLOBBI_VISUAL_EFFECT_PRESETS)) {
      expect(preset.id).toBe(key);
    }
  });

  it('agrees with the slot table, which is the single source of truth', () => {
    for (const preset of PRESETS) {
      expect(preset.slot, preset.id).toBe(EFFECT_SLOTS[preset.id]);
    }
  });

  it('gives every effect a name and a description a UI can show', () => {
    for (const preset of PRESETS) {
      expect(preset.displayName.length, preset.id).toBeGreaterThan(3);
      expect(preset.description.length, preset.id).toBeGreaterThan(30);
      expect(preset.description.trim().endsWith('.'), preset.id).toBe(true);
    }
    // Names must be distinct, or two cards in a picker read the same.
    expect(new Set(PRESETS.map((p) => p.displayName)).size).toBe(12);
  });

  it('exposes that metadata through the public info accessor', () => {
    for (const id of BLOBBI_VISUAL_EFFECT_IDS) {
      const info = getBlobbiVisualEffectInfo(id);
      expect(info.id).toBe(id);
      expect(info.slot).toBe(EFFECT_SLOTS[id]);
      expect(info.displayName).toBe(BLOBBI_VISUAL_EFFECT_PRESETS[id].displayName);
      expect(info.pieceCount).toBe(presetPieceCount(BLOBBI_VISUAL_EFFECT_PRESETS[id]));
    }
  });
});

describe('particle counts stay inside the documented caps', () => {
  it('no single effect exceeds the per-effect cap', () => {
    for (const preset of PRESETS) {
      const count = presetPieceCount(preset);
      expect(count, `${preset.id} has ${count} pieces`).toBeLessThanOrEqual(
        MAX_PIECES_PER_EFFECT,
      );
      expect(count, preset.id).toBeGreaterThan(0);
    }
  });

  it('the worst possible Blobbi — the heaviest effect in every slot — fits the total cap', () => {
    // Not the sum of all twelve: at most one effect occupies each slot, so the
    // real ceiling is the heaviest member of each.
    const worst = EFFECT_SLOT_ORDER.reduce((total, slot) => {
      const heaviest = Math.max(
        ...PRESETS.filter((p) => p.slot === slot).map(presetPieceCount),
      );
      return total + heaviest;
    }, 0);
    expect(worst, `worst case is ${worst} pieces`).toBeLessThanOrEqual(MAX_PIECES_TOTAL);
  });

  it('every group has a positive, small count', () => {
    for (const group of allGroups()) {
      expect(group.count).toBeGreaterThan(0);
      expect(group.count).toBeLessThanOrEqual(MAX_PIECES_PER_EFFECT);
      expect(Number.isInteger(group.count)).toBe(true);
    }
  });
});

describe('animation references and timing', () => {
  const durations = (): Array<{ where: string; range: EffectRange }> =>
    PRESETS.flatMap((preset) =>
      preset.groups.flatMap((group, i) => {
        const found: Array<{ where: string; range: EffectRange }> = [];
        if (group.track.animation && group.track.durationS) {
          found.push({ where: `${preset.id}[${i}].track`, range: group.track.durationS });
        }
        if (group.piece.animation && group.piece.durationS) {
          found.push({ where: `${preset.id}[${i}].piece`, range: group.piece.durationS });
        }
        return found;
      }),
    );

  it('never names a keyframe the package does not define', () => {
    for (const preset of PRESETS) {
      for (const group of preset.groups) {
        for (const name of [group.track.animation, group.piece.animation]) {
          if (!name) continue;
          expect(isKnownEffectAnimation(name), `${preset.id} → ${name}`).toBe(true);
        }
      }
      // Structural renderers declare their keyframes on the preset; a typo
      // there would emit an animation name with no rule behind it.
      for (const name of preset.extraAnimations ?? []) {
        expect(isKnownEffectAnimation(name), `${preset.id} → extra ${name}`).toBe(true);
      }
    }
  });

  it('gives every animated element a duration — a missing one would default to 0s', () => {
    for (const preset of PRESETS) {
      for (const [i, group] of preset.groups.entries()) {
        if (group.track.animation) {
          expect(group.track.durationS, `${preset.id}[${i}].track`).toBeDefined();
        }
        if (group.piece.animation) {
          expect(group.piece.durationS, `${preset.id}[${i}].piece`).toBeDefined();
        }
      }
    }
  });

  it('runs nothing fast enough to read as flicker', () => {
    for (const { where, range } of durations()) {
      expect(range[0], `${where} min duration`).toBeGreaterThanOrEqual(
        MIN_ANIMATION_DURATION_S,
      );
      expect(range[1], `${where} max ≥ min`).toBeGreaterThanOrEqual(range[0]);
    }
    expect(durations().length).toBeGreaterThan(20);
  });

  it('staggers with delays rather than with timers', () => {
    // A spread of start delays is what produces "intermittent bursts" with no
    // JavaScript at all. At least one group per effect must actually stagger.
    for (const preset of PRESETS) {
      const staggered = preset.groups.some(
        (group) =>
          (group.track.delayS && group.track.delayS[1] > group.track.delayS[0]) ||
          (group.piece.delayS && group.piece.delayS[1] > group.piece.delayS[0]) ||
          // Single-piece groups (an aura, a ray disc) have nothing to stagger.
          group.count === 1,
      );
      expect(staggered, preset.id).toBe(true);
    }
  });

  it('never pairs a fixed track rotation with a track animation', () => {
    // Both would write `transform`, and one would silently lose.
    for (const preset of PRESETS) {
      for (const group of preset.groups) {
        if (group.track.rotateDeg) {
          expect(group.track.animation, preset.id).toBeUndefined();
        }
      }
    }
  });
});

describe('ranges are well formed', () => {
  const RANGE_FIELDS = [
    'sizePct',
    'xPct',
    'yPct',
    'opacity',
    'durationS',
    'delayS',
  ] as const;

  it('every piece range is ordered, finite and inside sane bounds', () => {
    for (const preset of PRESETS) {
      for (const [i, group] of preset.groups.entries()) {
        for (const field of RANGE_FIELDS) {
          const range = group.piece[field];
          if (!range) continue;
          const [min, max] = range;
          const where = `${preset.id}[${i}].piece.${field}`;
          expect(Number.isFinite(min), where).toBe(true);
          expect(Number.isFinite(max), where).toBe(true);
          expect(max, where).toBeGreaterThanOrEqual(min);
        }
        const [oMin, oMax] = group.piece.opacity;
        expect(oMin, `${preset.id}[${i}] opacity`).toBeGreaterThan(0);
        expect(oMax, `${preset.id}[${i}] opacity`).toBeLessThanOrEqual(1);
        const [sMin] = group.piece.sizePct;
        expect(sMin, `${preset.id}[${i}] size`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every effect visible when its animations are switched off', () => {
    // The reduced-motion contract, expressed as a property of the DATA: a
    // resting piece is drawn at its authored opacity, so an effect whose
    // authored opacity were 0 would simply disappear for those users.
    for (const preset of PRESETS) {
      for (const group of preset.groups) {
        expect(group.piece.opacity[0], preset.id).toBeGreaterThanOrEqual(0.2);
      }
    }
  });

  it('keeps auras large and particles small, so the two never swap roles', () => {
    for (const preset of PRESETS) {
      for (const group of preset.groups) {
        const [, maxSize] = group.piece.sizePct;
        if (['halo', 'rays', 'ring', 'rainbow-ring'].includes(group.piece.kind)) {
          expect(maxSize, `${preset.id} aura shape`).toBeGreaterThan(100);
        } else if (group.piece.kind !== 'fog') {
          expect(maxSize, `${preset.id} particle shape`).toBeLessThanOrEqual(20);
        }
      }
    }
  });
});

describe('the layer model', () => {
  it('uses only the three defined layers', () => {
    for (const group of allGroups()) {
      expect(['behind', 'mid', 'front']).toContain(group.layer);
    }
  });

  it('puts body-overlay effects on the mid layer, where they belong', () => {
    for (const preset of PRESETS.filter((p) => p.slot === 'body-overlay')) {
      expect(preset.groups.some((g) => g.layer === 'mid'), preset.id).toBe(true);
    }
  });

  it('gives Mystic Fog the two coordinated layers its design calls for', () => {
    const layers = new Set(
      BLOBBI_VISUAL_EFFECT_PRESETS['mystic-fog'].groups.map((g) => g.layer),
    );
    expect(layers).toEqual(new Set(['behind', 'front']));
  });

  it('gives every effect at least one layer a rear-facing Blobbi still shows', () => {
    // Nothing may live exclusively on a layer the rear view suppresses — and
    // in fact no layer is suppressed, which is the point: effects surround the
    // character rather than attaching to its face.
    for (const preset of PRESETS) {
      expect(preset.groups.length, preset.id).toBeGreaterThan(0);
    }
  });
});

describe('shapes', () => {
  const KINDS: EffectPieceKind[] = [
    'dot', 'glow-dot', 'star4', 'star6', 'bubble', 'heart',
    'pixel', 'ring', 'halo', 'rays', 'fog', 'rainbow-ring',
  ];

  it('produces a style for every kind, with no undefined leaking into CSS', () => {
    for (const kind of KINDS) {
      const style = pieceShapeStyle(kind, '#ff8800', '#0088ff');
      const serialized = JSON.stringify(style);
      expect(serialized, kind).not.toContain('undefined');
      expect(Object.keys(style).length, kind).toBeGreaterThan(0);
    }
  });

  it('uses percentage clip-paths, so a shape scales with the renderer box', () => {
    for (const kind of ['star4', 'star6', 'heart'] as EffectPieceKind[]) {
      const clip = pieceShapeStyle(kind, '#fff', '#000').clipPath as string;
      expect(clip, kind).toMatch(/^polygon\(/);
      expect(clip, `${kind} must not use pixel coordinates`).not.toMatch(/\dpx/);
    }
  });

  it('keeps blur radii small enough not to blow up the paint region', () => {
    for (const kind of KINDS) {
      const filter = pieceShapeStyle(kind, '#fff', '#000').filter as string | undefined;
      if (!filter) continue;
      const blur = Number(/blur\((\d+(?:\.\d+)?)px\)/.exec(filter)?.[1] ?? 0);
      expect(blur, `${kind} blur`).toBeLessThanOrEqual(4);
    }
  });

  it('is used exhaustively — no shape is defined and then never drawn', () => {
    const used = new Set(allGroups().map((g) => g.piece.kind));
    const unused = KINDS.filter((kind) => !used.has(kind));
    expect(unused, 'dead shapes should be deleted, not kept').toEqual([]);
  });
});

describe('the stylesheet', () => {
  it('namespaces every class and keyframe under blobbi-fx-', () => {
    for (const name of EFFECT_ANIMATION_NAMES) {
      expect(name).toMatch(/^blobbi-fx-/);
    }
    const classNames = [...BLOBBI_EFFECT_STYLESHEET.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(
      (m) => m[1],
    );
    expect(classNames.length).toBeGreaterThan(0);
    for (const className of new Set(classNames)) {
      expect(className, `${className} is not namespaced`).toMatch(/^blobbi-fx-/);
    }
  });

  it('defines a keyframe block for every animation name it advertises', () => {
    for (const name of EFFECT_ANIMATION_NAMES) {
      expect(BLOBBI_EFFECT_STYLESHEET).toContain(`@keyframes ${name}{`);
    }
  });

  it('removes every animation under prefers-reduced-motion — and ONLY animation', () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\{([\s\S]*?)\n\}/.exec(
      BLOBBI_EFFECT_STYLESHEET,
    );
    expect(block, 'the reduced-motion block must exist').not.toBeNull();
    const rules = block![1];
    expect(rules).toContain('.blobbi-fx-track');
    expect(rules).toContain('.blobbi-fx-piece');
    expect(rules).toContain('animation:none !important');
    // Deliberately NOT `transform:none`: a static transform is placement — a
    // lightning segment's tilt, a radially arranged arc — and stripping it
    // would bend the resting composition into something never designed.
    // Animated transforms die with `animation:none` on their own.
    expect(rules).not.toContain('transform:none');
  });

  it('makes the resting opacity of a piece its own --fx-o', () => {
    // The whole reduced-motion design rests on this one declaration.
    expect(BLOBBI_EFFECT_STYLESHEET).toContain('opacity:var(--fx-o,1)');
  });

  it('never lets an animation override the caller intensity', () => {
    // Every opacity inside a PIECE keyframe must be expressed in terms of
    // `--fx-o`; a literal like `opacity:0.6` would ignore intensity entirely.
    const pieceKeyframes = ['blobbi-fx-twinkle', 'blobbi-fx-blink', 'blobbi-fx-pulse',
      'blobbi-fx-shimmer', 'blobbi-fx-glitch', 'blobbi-fx-bolt-seg', 'blobbi-fx-bolt-draw',
      'blobbi-fx-impact-flash'];
    for (const name of pieceKeyframes) {
      const block = new RegExp(`@keyframes ${name}\\{([\\s\\S]*?)\\}\\}`).exec(
        BLOBBI_EFFECT_STYLESHEET,
      );
      expect(block, name).not.toBeNull();
      for (const [, value] of block![1].matchAll(/opacity:([^;}]+)/g)) {
        const trimmed = value.trim();
        const isZero = trimmed === '0';
        expect(
          isZero || trimmed.includes('var(--fx-o'),
          `${name} has a literal opacity ${trimmed}`,
        ).toBe(true);
      }
    }
  });

  it('emits only the keyframes actually asked for', () => {
    const one = effectStylesheetFor(['blobbi-fx-twinkle']);
    expect(one).toContain('@keyframes blobbi-fx-twinkle{');
    expect(one).not.toContain('@keyframes blobbi-fx-glitch{');
    // The structural rules and the reduced-motion block are always present.
    expect(one).toContain('.blobbi-fx-piece{');
    expect(one).toContain('prefers-reduced-motion');
  });

  it('ignores an unknown animation name rather than emitting it', () => {
    const sheet = effectStylesheetFor(['blobbi-fx-twinkle', 'evil { } @import url(x)']);
    expect(sheet).not.toContain('@import');
    expect(sheet).not.toContain('evil');
  });

  it('is byte-identical for the same set in any order', () => {
    expect(effectStylesheetFor(['blobbi-fx-rise', 'blobbi-fx-twinkle'])).toBe(
      effectStylesheetFor(['blobbi-fx-twinkle', 'blobbi-fx-rise', 'blobbi-fx-rise']),
    );
  });

  it('marks the layers as non-interactive in CSS as well as in markup', () => {
    expect(BLOBBI_EFFECT_STYLESHEET).toContain('.blobbi-fx-layer{position:absolute;pointer-events:none');
    expect(BLOBBI_EFFECT_STYLESHEET).toContain('.blobbi-fx-track{position:absolute;inset:0;pointer-events:none');
  });
});

describe('the effect system runs no JavaScript at animation time', () => {
  it('found the source files it means to check', () => {
    expect(EFFECT_SOURCES.length).toBeGreaterThanOrEqual(5);
  });

  it('uses no Math.random, Date.now or new Date anywhere', () => {
    for (const file of EFFECT_SOURCES) {
      const source = codeOf(file);
      const where = relative(PACKAGE_ROOT, file);
      expect(/Math\.random\s*\(/.test(source), `${where} uses Math.random`).toBe(false);
      expect(/Date\.now\s*\(/.test(source), `${where} uses Date.now`).toBe(false);
      expect(/new\s+Date\s*\(/.test(source), `${where} uses new Date`).toBe(false);
    }
  });

  it('starts no timer and no frame loop', () => {
    for (const file of EFFECT_SOURCES) {
      const source = codeOf(file);
      const where = relative(PACKAGE_ROOT, file);
      for (const banned of [
        /\bsetInterval\s*\(/,
        /\bsetTimeout\s*\(/,
        /\brequestAnimationFrame\s*\(/,
        /\bnew\s+Worker\s*\(/,
      ]) {
        expect(banned.test(source), `${where} matches ${banned}`).toBe(false);
      }
    }
  });

  it('holds no React state and subscribes to nothing', () => {
    // A passive decoration that re-renders is a passive decoration that costs
    // something. The walker is a pure function of its props.
    for (const file of EFFECT_SOURCES) {
      const source = codeOf(file);
      const where = relative(PACKAGE_ROOT, file);
      for (const banned of [
        /\buseState\b/,
        /\buseEffect\b/,
        /\buseLayoutEffect\b/,
        /\buseSyncExternalStore\b/,
        /\baddEventListener\s*\(/,
        /\bmatchMedia\s*\(/,
      ]) {
        expect(banned.test(source), `${where} matches ${banned}`).toBe(false);
      }
    }
  });

  it('measures no DOM: no refs, no getBoundingClientRect, no offsetWidth', () => {
    for (const file of EFFECT_SOURCES) {
      const source = codeOf(file);
      const where = relative(PACKAGE_ROOT, file);
      for (const banned of [
        /getBoundingClientRect/,
        /offsetWidth|offsetHeight|clientWidth|clientHeight/,
        /\buseRef\b/,
        /document\./,
      ]) {
        expect(banned.test(source), `${where} matches ${banned}`).toBe(false);
      }
    }
  });

  it('speaks no protocol vocabulary — the package stays effect-ids-only', () => {
    for (const file of EFFECT_SOURCES) {
      const source = codeOf(file);
      const where = relative(PACKAGE_ROOT, file);
      for (const banned of [
        /\b3163[0-9]\b/,
        /\bnostr\b/i,
        /\bpubkey\b/i,
        /\bissuer\b/i,
        /\binventory\b/i,
        /\brelay\b/i,
        /\brarity\b/i,
      ]) {
        expect(banned.test(source), `${where} mentions ${banned}`).toBe(false);
      }
    }
  });
});
