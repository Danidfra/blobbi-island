/**
 * Treasure-hunt asset registry; every supplied asset resolves from its
 * permanent location, the calibration matches the real SVG, and nothing in
 * the source tree still points at the temporary drop folder.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  DETECTOR_CALIBRATION,
  DETECTOR_DOCK,
  PLAYFIELD_IMAGE_ASPECT,
  SAND_RECT,
  SHOVEL_CURSOR,
  SIGNAL_DISPLAY_STATES,
  TREASURE_FIELD_WIDTH,
  TREASURE_HUNT_UI_POLICY,
  TREASURE_HUNT_ASSETS,
  findPresentation,
  signalDisplayState,
} from './treasure-hunt-config';
import { DEFAULT_TREASURE_HUNT_POLICY } from '@/beach/treasure-hunt';

const ROOT = process.cwd();

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? allFiles(full) : [full];
  });
}

describe('asset locations', () => {
  it('every registered asset exists at its permanent public path', () => {
    for (const [name, path] of Object.entries(TREASURE_HUNT_ASSETS)) {
      expect(path.startsWith('/assets/'), `${name} must live under /assets/`).toBe(true);
      expect(existsSync(join(ROOT, 'public', path)), `missing asset: ${name} → ${path}`).toBe(
        true
      );
    }
  });

  it('keeps the detector and shovel as SVG', () => {
    expect(TREASURE_HUNT_ASSETS.detector.endsWith('.svg')).toBe(true);
    expect(TREASURE_HUNT_ASSETS.shovel.endsWith('.svg')).toBe(true);
  });

  it('the temporary public/beach/ drop folder is gone', () => {
    expect(existsSync(join(ROOT, 'public', 'beach'))).toBe(false);
  });

  it('no source file references the temporary folder or a /beach/ asset URL', () => {
    const offenders = allFiles(join(ROOT, 'src'))
      .filter((file) => /\.(ts|tsx|css)$/.test(file))
      // This test names the forbidden strings on purpose.
      .filter((file) => !file.endsWith('treasure-hunt-config.test.ts'))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        // `'@/beach/…'` module imports are fine; `'/beach/…'` URL strings and
        // any mention of the temp folder are not.
        return source.includes('public/beach') || /['"]\/beach\//.test(source);
      })
      .map((file) => file.replace(`${ROOT}/`, ''));
    expect(offenders).toEqual([]);
  });
});

describe('detector calibration', () => {
  const svg = readFileSync(
    join(ROOT, 'public', TREASURE_HUNT_ASSETS.detector),
    'utf8'
  );

  it('matches the shipped SVG viewBox', () => {
    expect(svg).toContain(
      `viewBox="0 0 ${DETECTOR_CALIBRATION.viewBoxWidth} ${DETECTOR_CALIBRATION.viewBoxHeight}"`
    );
  });

  it('anchors the logical coil on the artwork coil, not the canvas center', () => {
    // The coil ellipse in the shipped art is centered at (160, 176).
    expect(DETECTOR_CALIBRATION.coilAnchorX).toBeCloseTo(160 / 320, 10);
    expect(DETECTOR_CALIBRATION.coilAnchorY).toBeCloseTo(176 / 720, 10);
    expect(DETECTOR_CALIBRATION.coilAnchorY).not.toBeCloseTo(0.5, 1);
    expect(svg).toContain('cx="160" cy="176"');
  });

  it('keeps render sizing in sane fractions', () => {
    expect(DETECTOR_CALIBRATION.renderHeightSandFraction).toBeGreaterThan(0);
    expect(DETECTOR_CALIBRATION.renderHeightSandFraction).toBeLessThanOrEqual(1);
  });
});

describe('field policy', () => {
  it('derives an isotropic field from the sand rect and stays valid', () => {
    expect(TREASURE_FIELD_WIDTH).toBeGreaterThan(1);
    expect(TREASURE_FIELD_WIDTH).toBeLessThan(3);
    expect(TREASURE_HUNT_UI_POLICY.fieldWidth).toBe(TREASURE_FIELD_WIDTH);
    expect(TREASURE_HUNT_UI_POLICY.fieldHeight).toBe(1);
    // Balance values are the model's provisional defaults, untouched.
    expect(TREASURE_HUNT_UI_POLICY.roundDurationSeconds).toBe(
      DEFAULT_TREASURE_HUNT_POLICY.roundDurationSeconds
    );
    expect(TREASURE_HUNT_UI_POLICY.targetCount).toBe(DEFAULT_TREASURE_HUNT_POLICY.targetCount);
    expect(TREASURE_HUNT_UI_POLICY.shovelUses).toBe(DEFAULT_TREASURE_HUNT_POLICY.shovelUses);
  });

  it('keeps the sand rect inside the image and below the surf', () => {
    expect(SAND_RECT.x0).toBeGreaterThanOrEqual(0);
    expect(SAND_RECT.x1).toBeLessThanOrEqual(1);
    expect(SAND_RECT.y0).toBeGreaterThan(0.2); // water strip excluded
    expect(SAND_RECT.y1).toBeLessThanOrEqual(1);
    expect(PLAYFIELD_IMAGE_ASPECT).toBeCloseTo(1537 / 1023, 10);
  });
});

describe('find presentation', () => {
  it('covers every kind in the default policy', () => {
    for (const category of Object.values(DEFAULT_TREASURE_HUNT_POLICY.categories)) {
      for (const kindSpec of category.kinds) {
        const presentation = findPresentation(kindSpec.kind);
        expect(presentation.name.length).toBeGreaterThan(0);
        expect(presentation.icon.length).toBeGreaterThan(0);
      }
    }
  });

  it('falls back safely for unknown kinds', () => {
    expect(findPresentation('who-knows').name).toBe('Curious Find');
  });

});

describe('signal display states', () => {
  it('maps intensity to the five configured levels', () => {
    expect(signalDisplayState(0).level).toBe('none');
    expect(signalDisplayState(0.1).level).toBe('weak');
    expect(signalDisplayState(0.3).level).toBe('medium');
    expect(signalDisplayState(0.55).level).toBe('strong');
    expect(signalDisplayState(0.8).level).toBe('very-strong');
    expect(signalDisplayState(1).level).toBe('very-strong');
  });

  it('lights the dot from the first whisper and arcs progressively', () => {
    expect(signalDisplayState(0)).toMatchObject({ dotActive: false, activeArcs: 0, screenFill: null });
    expect(signalDisplayState(0.05)).toMatchObject({ dotActive: true, activeArcs: 0 });
    expect(signalDisplayState(0.4).activeArcs).toBe(1);
    expect(signalDisplayState(0.6).activeArcs).toBe(2);
    expect(signalDisplayState(0.95).activeArcs).toBe(3);
  });

  it('moves the screen tint from coral (far) through yellow to green (close)', () => {
    expect(signalDisplayState(0.05).screenFill).toMatch(/^#f/i); // coral
    expect(signalDisplayState(0.4).screenFill).toMatch(/^#fa/i); // yellow
    expect(signalDisplayState(0.6).screenFill).toMatch(/^#4a/i); // green
    expect(signalDisplayState(0.95).screenFill).toMatch(/^#22/i); // deeper green
  });

  it('keeps every threshold in the config, none-last and descending', () => {
    const mins = SIGNAL_DISPLAY_STATES.map((state) => state.minIntensity);
    for (let i = 1; i < mins.length; i += 1) {
      expect(mins[i]).toBeLessThanOrEqual(mins[i - 1]);
    }
    expect(SIGNAL_DISPLAY_STATES[SIGNAL_DISPLAY_STATES.length - 1].level).toBe('none');
    for (const state of SIGNAL_DISPLAY_STATES) {
      expect(state.label.length).toBeGreaterThan(0);
      expect(state.activeArcs).toBeGreaterThanOrEqual(0);
      expect(state.activeArcs).toBeLessThanOrEqual(3);
    }
  });

  it('ships the semantic hooks inside the detector SVG', () => {
    const svg = readFileSync(join(ROOT, 'public', TREASURE_HUNT_ASSETS.detector), 'utf8');
    for (const hook of [
      'id="th-display-screen"',
      'id="th-signal-dot"',
      'id="th-signal-arc-1"',
      'id="th-signal-arc-2"',
      'id="th-signal-arc-3"',
      '--th-screen-fill',
      '--th-dot-opacity',
      '--th-arc1-opacity',
      '--th-arc2-opacity',
      '--th-arc3-opacity',
    ]) {
      expect(svg, `detector.svg is missing hook ${hook}`).toContain(hook);
    }
    // The group the game references through the external <use>.
    expect(svg).toContain('id="metal-detector"');
  });
});

describe('shovel cursor and detector dock calibration', () => {
  it('anchors the shovel cursor on the blade apex of the shipped art', () => {
    const svg = readFileSync(join(ROOT, 'public', TREASURE_HUNT_ASSETS.shovel), 'utf8');
    expect(svg).toContain('M 150 40'); // the blade apex the anchor points at
    expect(SHOVEL_CURSOR.tipAnchorX).toBeCloseTo(150 / 300, 10);
    expect(SHOVEL_CURSOR.tipAnchorY).toBeCloseTo(40 / 600, 10);
    expect(SHOVEL_CURSOR.renderHeightSandFraction).toBeGreaterThan(0);
    expect(SHOVEL_CURSOR.renderHeightSandFraction).toBeLessThanOrEqual(1);
  });

  it('parks the docked detector inside the field with reduced presence', () => {
    expect(DETECTOR_DOCK.leftPercent).toBeGreaterThan(50);
    expect(DETECTOR_DOCK.leftPercent).toBeLessThanOrEqual(100);
    expect(DETECTOR_DOCK.topPercent).toBeGreaterThan(0);
    expect(DETECTOR_DOCK.topPercent).toBeLessThan(100);
    expect(DETECTOR_DOCK.scale).toBeGreaterThan(0);
    expect(DETECTOR_DOCK.scale).toBeLessThan(1);
    expect(DETECTOR_DOCK.opacity).toBeGreaterThan(0);
    expect(DETECTOR_DOCK.opacity).toBeLessThan(1);
  });
});
