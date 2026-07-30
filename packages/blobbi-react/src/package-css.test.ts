/**
 * The package's CSS DELIVERY CONTRACT.
 *
 * `@blobbi/react` ships no stylesheet. It emits a small, fixed set of class
 * names and expects the consumer's Tailwind build to supply them. That is a
 * real dependency on the outside world, so it is written down here as
 * assertions rather than left as folklore:
 *
 *  1. The canonical box is expressed as LITERAL Tailwind classes, never built
 *     by string concatenation — a JIT scanner can only see literals.
 *  2. Those literals mean exactly the pixel sizes in `BLOBBI_RENDER_SIZE_PX`.
 *  3. This repository's Tailwind config actually scans the package. Without
 *     that glob every Blobbi renders in a zero-sized box, and nothing else in
 *     the suite would notice, because jsdom applies no CSS.
 *  4. The only non-Tailwind class names the renderer emits are the three
 *     optional decoration classes behind `transparent={false}`, and they are
 *     documented in the README as consumer-supplied.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BLOBBI_RENDER_SIZE_CLASSES, BLOBBI_RENDER_SIZE_PX } from './index';

const PACKAGE_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

/** Tailwind's spacing scale is 0.25rem per step at the default 16px root. */
const TAILWIND_STEP_PX = 4;

describe('the canonical box is delivered as scannable Tailwind classes', () => {
  it('states every class as a literal the JIT scanner can find', () => {
    const source = readFileSync(join(PACKAGE_ROOT, 'src/blobbi-render-size.ts'), 'utf8');
    for (const className of Object.values(BLOBBI_RENDER_SIZE_CLASSES)) {
      expect(source, `${className} must appear literally`).toContain(`'${className}'`);
    }
    // No template literals or concatenation anywhere in the map.
    expect(source).not.toMatch(/[hw]-\$\{/);
  });

  it('the classes mean exactly the documented pixel sizes', () => {
    for (const [token, className] of Object.entries(BLOBBI_RENDER_SIZE_CLASSES)) {
      const [h, w] = className.split(' ');
      expect(h.replace('h-', 'x')).toBe(w.replace('w-', 'x'));
      const steps = Number(h.slice('h-'.length));
      expect(steps * TAILWIND_STEP_PX, `${token} (${className})`).toBe(
        BLOBBI_RENDER_SIZE_PX[token as keyof typeof BLOBBI_RENDER_SIZE_PX],
      );
    }
  });

  it('the consuming application scans this package for those classes', () => {
    const config = readFileSync(join(REPO_ROOT, 'tailwind.config.ts'), 'utf8');
    expect(
      config,
      'tailwind.config.ts must include packages/*/src or the box collapses to 0×0',
    ).toContain('./packages/*/src/**/*.{ts,tsx}');
  });

  it('emits only the three optional decoration classes beyond Tailwind utilities', () => {
    // Everything else in the renderer's className list is a stock Tailwind
    // utility. These three are theme hooks the consumer may define or ignore;
    // both modes have identical geometry, which is why they can be ignored.
    const renderer = readFileSync(join(PACKAGE_ROOT, 'src/BlobbiRendererView.tsx'), 'utf8');
    const custom = ['blobbi-gradient-frame', 'blobbi-hover', 'theme-transition'];
    for (const className of custom) {
      expect(renderer).toContain(className);
    }
    // No Island layout/world vocabulary leaked in with them.
    for (const islandClass of ['blobbi-card', 'island-', 'room-grade', 'world-']) {
      expect(renderer, `${islandClass} is Island styling`).not.toContain(islandClass);
    }
  });

  it('the decoration classes are optional: geometry is identical without them', () => {
    const renderer = readFileSync(join(PACKAGE_ROOT, 'src/BlobbiRendererView.tsx'), 'utf8');
    // The size class is applied unconditionally; the decoration classes are
    // gated behind `!transparent` / `interactive`.
    expect(renderer).toMatch(/BLOBBI_RENDER_SIZE_CLASSES\[size\],/);
    expect(renderer).toMatch(/!transparent &&\s*'rounded-full blobbi-gradient-frame/);
  });
});
