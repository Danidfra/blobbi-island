/**
 * The PUBLIC API of `@blobbi/react`, asserted exactly.
 *
 * An export list is a promise, and promises made by accident are the expensive
 * kind. This test exists so that widening the surface is a deliberate edit to a
 * literal list — not something that happens because a helper got re-exported to
 * fix a test, or because somebody reached for `export *`.
 *
 * It also asserts what is deliberately NOT here. Internal SVG plumbing, the
 * artwork modules, and the id sanitizer's private constants stay private
 * because supporting them forever is a real cost and nobody has asked.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as api from './index';

const PACKAGE_ROOT = resolve(__dirname, '..');

/** The complete, intentional export surface. */
const PUBLIC_API = [
  // The component
  'AccessoryLayerView',
  'BlobbiRendererView',
  // Visual normalization
  'DEFAULT_ADULT_TYPE',
  'DEFAULT_STAGE',
  'FALLBACK_INSTANCE_ID',
  'normalizeBlobbiRenderModel',
  'normalizeInstanceId',
  // The canonical box
  'ACCESSORY_BASE_PERCENT',
  'ACCESSORY_BASE_RATIO',
  'BLOBBI_RENDER_SIZE_CLASSES',
  'BLOBBI_RENDER_SIZE_PX',
  'accessoryBasePx',
  'blobbiRenderSizePx',
  // Accessories
  'ACCESSORY_SLOT_RANK',
  'DEFAULT_ACCESSORY_SOURCES',
  'REAR_VIEW_HIDDEN_SLOTS',
  'normalizeAccessoryPlacements',
  // Visual effects
  'BLOBBI_EFFECT_STYLESHEET',
  'BLOBBI_VISUAL_EFFECT_IDS',
  'DEFAULT_EFFECT_INTENSITY',
  'EFFECT_SLOTS',
  'EFFECT_SLOT_ORDER',
  'MAX_EFFECT_INTENSITY',
  'MAX_PIECES_PER_EFFECT',
  'MAX_PIECES_TOTAL',
  'MIN_EFFECT_INTENSITY',
  'getBlobbiVisualEffectInfo',
  'isBlobbiVisualEffectId',
  'normalizeBlobbiVisualEffects',
  // Rendering without React
  'loadBlobbiSvg',
  // SVG post-processing (provisional)
  'applyGazeMarkup',
  'applyRearView',
  'uniquifySvgIds',
].sort();

describe('the public API is exactly what it claims to be', () => {
  it('exports the documented surface and nothing else', () => {
    expect(Object.keys(api).sort()).toEqual(PUBLIC_API);
  });

  it('keeps implementation details private', () => {
    // Each of these exists and is used INSIDE the package. None of them is a
    // promise: the artwork can be re-cut, the customizers can change signature,
    // and `cn` is an implementation choice, not an interface.
    for (const internal of [
      'cn',
      'customizeAdultSvg',
      'customizeBabySvg',
      'getAdultBaseSvg',
      'getBabyBaseSvg',
      'ADULT_SVG_MAP',
      'BABY_BASE_SVG',
      'ensureSvgFillsContainer',
      'lightenColor',
      'darkenColor',
      'findRearViewRemovals',
      'REAR_VIEW_REMOVED_BLOCKS',
      // Effect INTERNALS. The presets are particle geometry, timings and
      // palettes — the implementation of an effect, not its interface. A
      // consumer names an effect by id; if the preset were public, a
      // hand-edited copy of one would become somebody's supported input.
      'BLOBBI_VISUAL_EFFECT_PRESETS',
      'BlobbiEffectLayer',
      'BlobbiEffectStyles',
      'pieceShapeStyle',
      'effectStylesheetFor',
      'unitFor',
      'rangeFor',
      'pickFor',
      'hashString',
    ]) {
      expect(api, `${internal} must stay internal`).not.toHaveProperty(internal);
    }
  });

  it('uses no wildcard re-exports, which would make the list above a lie', () => {
    // Comments stripped first — the module doc discusses `export *` by name.
    const entry = readFileSync(join(PACKAGE_ROOT, 'src/index.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(entry).not.toMatch(/export\s+\*/);
  });

  it('every exported value is defined and of the shape callers expect', () => {
    for (const [name, value] of Object.entries(api)) {
      expect(value, `${name} is exported but undefined`).toBeDefined();
    }
    expect(typeof api.BlobbiRendererView).toBe('function');
    expect(typeof api.AccessoryLayerView).toBe('function');
    expect(typeof api.normalizeBlobbiRenderModel).toBe('function');
    expect(typeof api.normalizeAccessoryPlacements).toBe('function');
    expect(typeof api.loadBlobbiSvg).toBe('function');
    expect(api.BLOBBI_RENDER_SIZE_PX).toEqual({
      sm: 32, md: 56, lg: 96, xl: 128, '2xl': 224, '3xl': 288,
    });
  });

  it('resolves from the package name, not from a relative path', async () => {
    // Proves the workspace wiring works the way a consumer would use it. If the
    // package.json `exports`/`types` entry ever stops resolving, this fails
    // here rather than in a downstream application build.
    const byName = await import('@blobbi/react');
    expect(Object.keys(byName).sort()).toEqual(PUBLIC_API);
    expect(byName.BlobbiRendererView).toBe(api.BlobbiRendererView);
  });

  it('points its manifest entry points at files that exist', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    for (const entry of [manifest.main, manifest.types, manifest.exports['.'].default]) {
      expect(readFileSync(join(PACKAGE_ROOT, entry), 'utf8').length).toBeGreaterThan(0);
    }
  });
});
