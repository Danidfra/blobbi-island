import { describe, it, expect, beforeEach } from 'vitest';

import { ISLAND_DAY_MINUTES } from './island-clock';
import { computeIslandSkyState, islandPhaseMidpointProgress } from './island-sky';
import {
  ISLAND_SKY_DEV_DEFAULTS,
  __resetIslandSkyDevStoreForTests,
  islandSkyDevCloudOverride,
  islandSkyDevFreezeOverride,
  islandCloudPreviewParkPx,
  islandSkyDevPhaseOverride,
  resolveIslandCloudDev,
  resolveIslandDayProgress,
} from './island-sky-dev';

beforeEach(() => {
  __resetIslandSkyDevStoreForTests();
});

describe('production defaults', () => {
  it('ships the automatic clock with clouds on and no simulated preferences', () => {
    expect(ISLAND_SKY_DEV_DEFAULTS.mode).toBe('auto');
    expect(ISLAND_SKY_DEV_DEFAULTS.cloudsEnabled).toBe(true);
    expect(ISLAND_SKY_DEV_DEFAULTS.simulateReducedMotion).toBe(false);
    expect(ISLAND_SKY_DEV_DEFAULTS.panelOpen).toBe(false);
  });

  it('is frozen, so nothing can quietly make the shipped sky non-deterministic', () => {
    expect(Object.isFrozen(ISLAND_SKY_DEV_DEFAULTS)).toBe(true);
  });
});

describe('resolveIslandDayProgress', () => {
  it('returns the real clock untouched in auto mode', () => {
    for (const progress of [0, 0.001, 0.25, 0.6249, 0.75, 0.99999]) {
      expect(resolveIslandDayProgress(progress, ISLAND_SKY_DEV_DEFAULTS)).toBe(progress);
    }
  });

  it('ignores a stale held value while in auto mode', () => {
    // Turning the harness off has to restore production behaviour completely, not
    // leave the last scrubbed position lying around.
    const stale = { ...ISLAND_SKY_DEV_DEFAULTS, dayProgress: 0.8 };
    expect(resolveIslandDayProgress(0.2, stale)).toBe(0.2);
  });

  it('holds the override value in fixed mode, whatever the clock says', () => {
    const held = { ...ISLAND_SKY_DEV_DEFAULTS, mode: 'fixed' as const, dayProgress: 0.8 };
    expect(resolveIslandDayProgress(0.1, held)).toBe(0.8);
    expect(resolveIslandDayProgress(0.9, held)).toBe(0.8);
  });

  it('clamps an out-of-range override rather than propagating it', () => {
    const low = { ...ISLAND_SKY_DEV_DEFAULTS, mode: 'fixed' as const, dayProgress: -2 };
    const high = { ...ISLAND_SKY_DEV_DEFAULTS, mode: 'fixed' as const, dayProgress: 4 };
    expect(resolveIslandDayProgress(0.5, low)).toBe(0);
    expect(resolveIslandDayProgress(0.5, high)).toBe(1);
  });
});

describe('islandSkyDevFreezeOverride', () => {
  it('holds wherever the clock currently is', () => {
    const frozen = islandSkyDevFreezeOverride(0.4321, ISLAND_SKY_DEV_DEFAULTS);
    expect(frozen.mode).toBe('fixed');
    expect(frozen.dayProgress).toBe(0.4321);
    expect(resolveIslandDayProgress(0.9, frozen)).toBe(0.4321);
  });

  it('freezes the sky the player is actually looking at', () => {
    const now = 0.7;
    const before = computeIslandSkyState(now);
    const frozen = islandSkyDevFreezeOverride(now, ISLAND_SKY_DEV_DEFAULTS);
    const after = computeIslandSkyState(resolveIslandDayProgress(0.05, frozen));
    expect(after).toEqual(before);
  });

  it('preserves unrelated harness settings', () => {
    const current = { ...ISLAND_SKY_DEV_DEFAULTS, cloudsEnabled: false, panelOpen: true };
    const frozen = islandSkyDevFreezeOverride(0.3, current);
    expect(frozen.cloudsEnabled).toBe(false);
    expect(frozen.panelOpen).toBe(true);
  });
});

describe('islandSkyDevPhaseOverride', () => {
  it('jumps to the middle of the requested phase', () => {
    for (const phase of ['dawn', 'day', 'sunset', 'night'] as const) {
      const override = islandSkyDevPhaseOverride(phase, ISLAND_SKY_DEV_DEFAULTS);
      expect(override.mode).toBe('fixed');
      expect(override.dayProgress).toBe(islandPhaseMidpointProgress(phase));
      const state = computeIslandSkyState(
        resolveIslandDayProgress(0, override),
      );
      expect(state.phase, phase).toBe(phase);
      expect(state.phaseProgress).toBeCloseTo(0.5, 6);
    }
  });

  it('produces the island minutes a developer would expect', () => {
    const minutes = (phase: 'dawn' | 'day' | 'sunset' | 'night') =>
      islandSkyDevPhaseOverride(phase, ISLAND_SKY_DEV_DEFAULTS).dayProgress * ISLAND_DAY_MINUTES;
    expect(minutes('dawn')).toBeCloseTo(5, 6);
    expect(minutes('day')).toBeCloseTo(42.5, 6);
    expect(minutes('sunset')).toBeCloseTo(82.5, 6);
    expect(minutes('night')).toBeCloseTo(105, 6);
  });

  it('preserves unrelated harness settings', () => {
    const current = { ...ISLAND_SKY_DEV_DEFAULTS, cloudsEnabled: false, panelOpen: true };
    const override = islandSkyDevPhaseOverride('night', current);
    expect(override.cloudsEnabled).toBe(false);
    expect(override.panelOpen).toBe(true);
  });
});

describe('cloud preview overrides', () => {
  const AT = { worldWidthPx: 1046, renderedWidthPx: 136 };

  it('does nothing at all with the production defaults', () => {
    // The property that makes "Auto" an instant restore: with no override the
    // resolver reports nothing to change, so the caller uses the UTC-derived
    // passage untouched.
    for (const id of ['cloud-a', 'cloud-b', 'cloud-c']) {
      expect(resolveIslandCloudDev(id, ISLAND_SKY_DEV_DEFAULTS, AT)).toEqual({
        shape: null,
        size: null,
        hidden: false,
        parkPx: null,
      });
    }
  });

  it('forces a shape only on the selected actor', () => {
    const dev = { ...ISLAND_SKY_DEV_DEFAULTS, cloudActorId: 'cloud-b', cloudShape: 'heart' as const };
    expect(resolveIslandCloudDev('cloud-b', dev, AT).shape).toBe('heart');
    // The other two stay on production selection, a preview must not rewrite the
    // whole sky.
    expect(resolveIslandCloudDev('cloud-a', dev, AT).shape).toBeNull();
    expect(resolveIslandCloudDev('cloud-c', dev, AT).shape).toBeNull();
  });

  it('forces a size the actor is not normally allowed', () => {
    // cloud-c can never be large in production; the harness must still be able to
    // show a large one on it.
    const dev = {
      ...ISLAND_SKY_DEV_DEFAULTS,
      cloudActorId: 'cloud-c',
      cloudSize: 'large' as const,
    };
    expect(resolveIslandCloudDev('cloud-c', dev, AT).size).toBe('large');
  });

  it('parks the selected actor on screen and hides the others', () => {
    const dev = {
      ...ISLAND_SKY_DEV_DEFAULTS,
      cloudActorId: 'cloud-a',
      cloudPlacement: 'preview' as const,
    };
    const target = resolveIslandCloudDev('cloud-a', dev, AT);
    expect(target.hidden).toBe(false);
    expect(target.parkPx).toBe(islandCloudPreviewParkPx(AT));
    // Fully inside the world, with a margin, so nothing is judged half cut off.
    expect(target.parkPx!).toBeGreaterThan(0);
    expect(target.parkPx! + AT.renderedWidthPx).toBeLessThanOrEqual(1046);
    // …and over the LEFT of the frame, not the middle, where every sky-ready
    // location puts its main building.
    expect(target.parkPx!).toBeLessThan(1046 * 0.25);

    for (const other of ['cloud-b', 'cloud-c']) {
      expect(resolveIslandCloudDev(other, dev, AT).hidden, other).toBe(true);
    }
  });

  it('never parks anything while placement is automatic', () => {
    const dev = { ...ISLAND_SKY_DEV_DEFAULTS, cloudShape: 'blobbi-egg' as const };
    expect(resolveIslandCloudDev(dev.cloudActorId, dev, AT).parkPx).toBeNull();
  });
});

describe('islandCloudPreviewParkPx', () => {
  it('keeps even the widest formation fully inside the world', () => {
    for (const width of [88, 108, 136, 172, 400, 1200]) {
      const park = islandCloudPreviewParkPx({ worldWidthPx: 1046, renderedWidthPx: width });
      expect(park, `w=${width}`).toBeGreaterThanOrEqual(0);
      if (width < 1046) {
        expect(park + width, `w=${width}`).toBeLessThanOrEqual(1046);
      }
    }
  });

  it('avoids the centre, where the scenery is', () => {
    const park = islandCloudPreviewParkPx({ worldWidthPx: 1046, renderedWidthPx: 172 });
    const centre = park + 172 / 2;
    expect(centre).toBeLessThan(1046 * 0.3);
  });
});

describe('islandSkyDevCloudOverride', () => {
  it('switches to preview when a shape is forced, so nothing has to be waited for', () => {
    const next = islandSkyDevCloudOverride({ cloudShape: 'blobbi-adult' }, ISLAND_SKY_DEV_DEFAULTS);
    expect(next.cloudShape).toBe('blobbi-adult');
    expect(next.cloudPlacement).toBe('preview');
  });

  it('switches to preview when a size is forced', () => {
    const next = islandSkyDevCloudOverride({ cloudSize: 'large' }, ISLAND_SKY_DEV_DEFAULTS);
    expect(next.cloudPlacement).toBe('preview');
  });

  it('releases preview when both go back to auto', () => {
    const forced = islandSkyDevCloudOverride(
      { cloudShape: 'heart', cloudSize: 'small' },
      ISLAND_SKY_DEV_DEFAULTS,
    );
    const shapeAuto = islandSkyDevCloudOverride({ cloudShape: 'auto' }, forced);
    expect(shapeAuto.cloudPlacement).toBe('preview'); // size is still forced
    const bothAuto = islandSkyDevCloudOverride({ cloudSize: 'auto' }, shapeAuto);
    expect(bothAuto.cloudPlacement).toBe('auto');
    expect(bothAuto.cloudShape).toBe('auto');
    expect(bothAuto.cloudSize).toBe('auto');
  });

  it('honours an explicit placement choice over the inferred one', () => {
    const next = islandSkyDevCloudOverride(
      { cloudShape: 'heart', cloudPlacement: 'auto' },
      ISLAND_SKY_DEV_DEFAULTS,
    );
    expect(next.cloudPlacement).toBe('auto');
  });

  it('leaves the clock and every non-cloud setting untouched', () => {
    // Previewing a cloud must not move the island clock, and must not quietly
    // change what else the harness is doing.
    const current = {
      ...ISLAND_SKY_DEV_DEFAULTS,
      mode: 'fixed' as const,
      dayProgress: 0.42,
      simulateReducedMotion: true,
      cloudsEnabled: false,
      panelOpen: true,
    };
    const next = islandSkyDevCloudOverride({ cloudShape: 'blobbi-baby' }, current);
    expect(next.mode).toBe('fixed');
    expect(next.dayProgress).toBe(0.42);
    expect(next.simulateReducedMotion).toBe(true);
    expect(next.cloudsEnabled).toBe(false);
    expect(next.panelOpen).toBe(true);
  });

  it('changes actor without forcing anything', () => {
    const next = islandSkyDevCloudOverride({ cloudActorId: 'cloud-c' }, ISLAND_SKY_DEV_DEFAULTS);
    expect(next.cloudActorId).toBe('cloud-c');
    expect(next.cloudPlacement).toBe('auto');
  });
});

describe('production defaults for the cloud preview', () => {
  it('ship every cloud control on auto', () => {
    expect(ISLAND_SKY_DEV_DEFAULTS.cloudShape).toBe('auto');
    expect(ISLAND_SKY_DEV_DEFAULTS.cloudSize).toBe('auto');
    expect(ISLAND_SKY_DEV_DEFAULTS.cloudPlacement).toBe('auto');
  });
});
