import { describe, it, expect } from 'vitest';

import { ISLAND_DAY_MINUTES } from './island-clock';
import {
  ISLAND_FINAL_TRANSITION_START_MINUTE,
  ISLAND_MOON_RISE_MINUTE,
  ISLAND_MOON_SET_MINUTE,
  ISLAND_PHASE_SPANS,
  ISLAND_SKY_KEYFRAMES,
  ISLAND_SUN_SET_MINUTE,
  type IslandDayPhase,
  type IslandSkyState,
  computeIslandSkyState,
  hexToRgba,
  islandArtworkFilter,
  islandCelestialPosition,
  islandPhaseAt,
  islandPhaseMidpointProgress,
  islandSkyKeyframeBackground,
  lerpHexColor,
} from './island-sky';

/** Day progress for an island minute, the unit the phase table is authored in. */
const at = (minute: number): IslandSkyState =>
  computeIslandSkyState(minute / ISLAND_DAY_MINUTES);

/** Every island minute at a 0.1-minute resolution: 1200 samples of one cycle. */
function sweep(): IslandSkyState[] {
  const states: IslandSkyState[] = [];
  for (let minute = 0; minute < ISLAND_DAY_MINUTES; minute += 0.1) {
    states.push(at(minute));
  }
  return states;
}

describe('phase table', () => {
  it('matches the product brief: dawn 10, day 65, sunset 15, night 25 + 5 min transition', () => {
    const durations = Object.fromEntries(
      ISLAND_PHASE_SPANS.map((span) => [span.phase, span.endMinute - span.startMinute]),
    );
    expect(durations).toEqual({ dawn: 10, day: 65, sunset: 15, night: 30 });
    // Night is 30 minutes of *phase*, the last 5 of which are the transition back
    // into dawn. That is how the brief's five segments fit four phase names.
    expect(ISLAND_DAY_MINUTES - ISLAND_FINAL_TRANSITION_START_MINUTE).toBe(5);
  });

  it('keeps day the longest phase, for world readability', () => {
    const longest = [...ISLAND_PHASE_SPANS].sort(
      (a, b) => b.endMinute - b.startMinute - (a.endMinute - a.startMinute),
    )[0];
    expect(longest.phase).toBe('day');
  });

  it('covers the whole day with no gap and no overlap', () => {
    expect(ISLAND_PHASE_SPANS[0].startMinute).toBe(0);
    expect(ISLAND_PHASE_SPANS[ISLAND_PHASE_SPANS.length - 1].endMinute).toBe(ISLAND_DAY_MINUTES);
    for (let i = 1; i < ISLAND_PHASE_SPANS.length; i += 1) {
      expect(ISLAND_PHASE_SPANS[i].startMinute).toBe(ISLAND_PHASE_SPANS[i - 1].endMinute);
    }
  });
});

describe('islandPhaseAt', () => {
  it('selects the phase on each side of every boundary', () => {
    const expectations: [number, IslandDayPhase][] = [
      [0, 'dawn'],
      [9.99, 'dawn'],
      [10, 'day'],
      [74.99, 'day'],
      [75, 'sunset'],
      [89.99, 'sunset'],
      [90, 'night'],
      [119.99, 'night'],
    ];
    for (const [minute, phase] of expectations) {
      expect(islandPhaseAt(minute / ISLAND_DAY_MINUTES).phase, `minute ${minute}`).toBe(phase);
    }
  });

  it('normalises phaseProgress to [0, 1) within each span', () => {
    expect(islandPhaseAt(0).phaseProgress).toBe(0);
    expect(at(5).phaseProgress).toBeCloseTo(0.5, 9); // halfway through 10-min dawn
    expect(at(10).phaseProgress).toBe(0); // day just started
    expect(at(42.5).phaseProgress).toBeCloseTo(0.5, 9); // halfway through 65-min day
    expect(at(82.5).phaseProgress).toBeCloseTo(0.5, 9); // halfway through 15-min sunset
    expect(at(105).phaseProgress).toBeCloseTo(0.5, 9); // halfway through 30-min night
  });

  it('resets phaseProgress to 0 at each boundary rather than carrying it over', () => {
    for (const span of ISLAND_PHASE_SPANS) {
      expect(at(span.startMinute).phaseProgress, span.phase).toBe(0);
      expect(at(span.endMinute - 0.001).phaseProgress).toBeGreaterThan(0.99);
    }
  });

  it('treats a fully-wound dayProgress of exactly 1 as the end of night', () => {
    // The clock only emits [0, 1), but the DEV slider can reach its maximum.
    const state = computeIslandSkyState(1);
    expect(state.phase).toBe('night');
    expect(state.phaseProgress).toBe(1);
  });
});

describe('keyframe table', () => {
  it('is ascending and spans exactly one day', () => {
    expect(ISLAND_SKY_KEYFRAMES[0].minute).toBe(0);
    expect(ISLAND_SKY_KEYFRAMES[ISLAND_SKY_KEYFRAMES.length - 1].minute).toBe(ISLAND_DAY_MINUTES);
    for (let i = 1; i < ISLAND_SKY_KEYFRAMES.length; i += 1) {
      expect(ISLAND_SKY_KEYFRAMES[i].minute).toBeGreaterThan(ISLAND_SKY_KEYFRAMES[i - 1].minute);
    }
  });

  it('closes the loop: the wrap keyframe equals the first in every visual field', () => {
    // This is what makes the cycle seamless AND what lets the renderer snap the
    // inactive crossfade layers at the wrap without a visible flash.
    const first = ISLAND_SKY_KEYFRAMES[0];
    const wrap = ISLAND_SKY_KEYFRAMES[ISLAND_SKY_KEYFRAMES.length - 1];
    const { minute: _m1, label: _l1, ...firstVisuals } = first;
    const { minute: _m2, label: _l2, ...wrapVisuals } = wrap;
    expect(wrapVisuals).toEqual(firstVisuals);
  });

  it('renders each keyframe as a fully opaque background image', () => {
    // The renderer's stacked crossfade is only an exact interpolation if every
    // layer is opaque; a translucent layer would let lower ones bleed through.
    for (const keyframe of ISLAND_SKY_KEYFRAMES) {
      const background = islandSkyKeyframeBackground(keyframe);
      expect(background).toContain('linear-gradient(to bottom');
      expect(background).toContain(keyframe.top);
      expect(background).toContain(keyframe.bottom);
    }
  });
});

describe('continuity across the whole cycle', () => {
  const states = sweep();

  const CONTINUOUS: (keyof IslandSkyState)[] = [
    'starOpacity',
    'cloudBrightness',
    'cloudOpacity',
    'warmth',
    'nightIntensity',
    'artworkBrightness',
    'artworkSaturation',
    'worldLightOpacity',
    'sunOpacity',
    'moonOpacity',
  ];

  it('never jumps a scalar between adjacent samples, including at phase boundaries', () => {
    for (const key of CONTINUOUS) {
      for (let i = 1; i < states.length; i += 1) {
        const delta = Math.abs((states[i][key] as number) - (states[i - 1][key] as number));
        expect(
          delta,
          `${key} jumped ${delta.toFixed(4)} at minute ${states[i].minute.toFixed(1)}`,
        ).toBeLessThan(0.05);
      }
    }
  });

  it('closes the loop continuously from the last sample back to minute 0', () => {
    const last = at(ISLAND_DAY_MINUTES - 0.1);
    const first = at(0);
    for (const key of CONTINUOUS) {
      const delta = Math.abs((first[key] as number) - (last[key] as number));
      expect(delta, `${key} jumped ${delta.toFixed(4)} across the wrap`).toBeLessThan(0.05);
    }
  });

  it('keeps the sky colour continuous across every phase boundary', () => {
    for (const span of ISLAND_PHASE_SPANS) {
      const before = at(span.startMinute - 0.05);
      const after = at(span.startMinute + 0.05);
      // Boundaries are inside interpolated keyframe segments, so the colours on
      // either side of a phase *name* change must be nearly identical.
      const channelDelta = (a: string, b: string) => {
        const parse = (hex: string) =>
          [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
        const [r1, g1, b1] = parse(a);
        const [r2, g2, b2] = parse(b);
        return Math.max(Math.abs(r1 - r2), Math.abs(g1 - g2), Math.abs(b1 - b2));
      };
      expect(channelDelta(before.gradient.top, after.gradient.top)).toBeLessThan(6);
      expect(channelDelta(before.gradient.bottom, after.gradient.bottom)).toBeLessThan(6);
    }
  });

  it('advances the crossfade monotonically and only ever blends two layers', () => {
    for (const state of states) {
      expect(state.keyframeIndex).toBeGreaterThanOrEqual(0);
      expect(state.keyframeIndex).toBeLessThanOrEqual(ISLAND_SKY_KEYFRAMES.length - 2);
      expect(state.keyframeBlend).toBeGreaterThanOrEqual(0);
      expect(state.keyframeBlend).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < states.length; i += 1) {
      expect(states[i].keyframeIndex).toBeGreaterThanOrEqual(states[i - 1].keyframeIndex);
    }
  });
});

describe('safe normalised bounds', () => {
  const states = sweep();

  it('keeps every normalised value inside [0, 1]', () => {
    for (const state of states) {
      for (const key of [
        'dayProgress',
        'phaseProgress',
        'sunProgress',
        'sunOpacity',
        'moonProgress',
        'moonOpacity',
        'starOpacity',
        'cloudOpacity',
        'warmth',
        'nightIntensity',
        'worldLightOpacity',
      ] as const) {
        expect(state[key], `${key} at minute ${state.minute.toFixed(1)}`).toBeGreaterThanOrEqual(0);
        expect(state[key], `${key} at minute ${state.minute.toFixed(1)}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('caps the world-light veil at the readability budget', () => {
    // This layer also covers the Blobbi, remote players, name labels and chat
    // bubbles. The cap is the contract that keeps them legible; raising it is a
    // deliberate decision that has to change this test.
    const peak = Math.max(...states.map((state) => state.worldLightOpacity));
    expect(peak).toBeLessThanOrEqual(0.14);
    expect(peak).toBeGreaterThan(0.1); // still does something at night
  });

  it('never darkens or desaturates the artwork past a playable floor', () => {
    for (const state of states) {
      expect(state.artworkBrightness).toBeGreaterThanOrEqual(0.65);
      expect(state.artworkBrightness).toBeLessThanOrEqual(1.05);
      expect(state.artworkSaturation).toBeGreaterThanOrEqual(0.8);
      expect(state.artworkSaturation).toBeLessThanOrEqual(1.15);
    }
  });

  it('leaves the world ungraded at midday', () => {
    const noon = at(42.5);
    expect(noon.worldLightOpacity).toBe(0);
    expect(noon.artworkBrightness).toBe(1);
    expect(noon.artworkSaturation).toBe(1);
  });
});

describe('dawn', () => {
  it('is warm, dim and still starry at first light', () => {
    const firstLight = at(0);
    expect(firstLight.phase).toBe('dawn');
    expect(firstLight.warmth).toBeGreaterThan(0.4);
    expect(firstLight.starOpacity).toBeGreaterThan(0.4);
    expect(firstLight.artworkBrightness).toBeLessThan(0.8);
  });

  it('is bright and neutral by the time day begins', () => {
    const dayStart = at(10);
    expect(dayStart.starOpacity).toBe(0);
    expect(dayStart.artworkBrightness).toBe(1);
    expect(dayStart.nightIntensity).toBe(0);
  });

  it('warms up into sunrise and cools again into morning', () => {
    expect(at(5).warmth).toBeGreaterThan(at(0).warmth);
    expect(at(5).warmth).toBeGreaterThan(at(10).warmth);
  });
});

describe('day', () => {
  it('is the brightest, least graded and least warm part of the cycle', () => {
    const states = sweep();
    const brightest = states.reduce((a, b) => (b.artworkBrightness > a.artworkBrightness ? b : a));
    expect(brightest.phase).toBe('day');
    for (const minute of [15, 30, 42.5, 60, 70]) {
      const state = at(minute);
      expect(state.phase).toBe('day');
      expect(state.starOpacity).toBe(0);
      expect(state.moonOpacity).toBe(0);
      expect(state.nightIntensity).toBe(0);
      expect(state.artworkBrightness).toBeGreaterThan(0.95);
    }
  });

  it('keeps the sun up for the whole of it', () => {
    for (const minute of [10, 25, 42.5, 60, 74]) {
      expect(at(minute).sunOpacity, `minute ${minute}`).toBe(1);
    }
  });
});

describe('sunset', () => {
  it('is the warmest part of the cycle', () => {
    const states = sweep();
    const warmest = states.reduce((a, b) => (b.warmth > a.warmth ? b : a));
    expect(warmest.phase).toBe('sunset');
  });

  it('brings the stars out gradually, and only during sunset', () => {
    // The brief: stars appear during sunset, not before it.
    expect(at(74.9).starOpacity).toBe(0);
    expect(at(75).starOpacity).toBe(0);
    const samples = [78, 82.5, 86, 89.9].map((minute) => at(minute).starOpacity);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
    expect(at(89.9).starOpacity).toBeGreaterThan(0.7);
    expect(at(89.9).starOpacity).toBeLessThan(1);
  });

  it('sets the sun exactly when night begins', () => {
    expect(at(89.9).sunOpacity).toBeGreaterThan(0);
    expect(at(ISLAND_SUN_SET_MINUTE).sunOpacity).toBe(0);
    expect(at(ISLAND_SUN_SET_MINUTE).phase).toBe('night');
  });
});

describe('night', () => {
  it('is fully starred, coolest and darkest', () => {
    const deepNight = at(96);
    expect(deepNight.phase).toBe('night');
    expect(deepNight.starOpacity).toBe(1);
    expect(deepNight.nightIntensity).toBe(1);
    expect(deepNight.warmth).toBe(0);
    const states = sweep();
    const darkest = states.reduce((a, b) => (b.artworkBrightness < a.artworkBrightness ? b : a));
    expect(darkest.phase).toBe('night');
  });

  it('keeps the sun down for all of it', () => {
    for (let minute = 90; minute < ISLAND_DAY_MINUTES; minute += 1) {
      expect(at(minute).sunOpacity, `minute ${minute}`).toBe(0);
    }
  });

  it('flags the final five minutes as the transition back to dawn', () => {
    expect(at(114.9).inFinalTransition).toBe(false);
    expect(at(ISLAND_FINAL_TRANSITION_START_MINUTE).inFinalTransition).toBe(true);
    expect(at(119.9).inFinalTransition).toBe(true);
    // Still called night, the type has four phases, not five.
    expect(at(119.9).phase).toBe('night');
  });

  it('actually moves toward dawn during that transition', () => {
    const lateNight = at(ISLAND_FINAL_TRANSITION_START_MINUTE);
    const almostDawn = at(119.5);
    const firstLight = at(0);
    expect(almostDawn.warmth).toBeGreaterThan(lateNight.warmth);
    expect(almostDawn.starOpacity).toBeLessThan(lateNight.starOpacity);
    expect(almostDawn.artworkBrightness).toBeGreaterThan(lateNight.artworkBrightness);
    // …and lands on the dawn keyframe.
    expect(almostDawn.warmth).toBeLessThan(firstLight.warmth + 0.01);
  });
});

describe('the sun', () => {
  it('rises on the left, peaks near the centre, descends on the right', () => {
    const rise = islandCelestialPosition(at(5).sunProgress);
    const peak = islandCelestialPosition(at(45).sunProgress);
    const set = islandCelestialPosition(at(85).sunProgress);
    expect(rise.xPercent).toBeLessThan(peak.xPercent);
    expect(peak.xPercent).toBeLessThan(set.xPercent);
    // y grows downward, so the highest point is the smallest y.
    expect(peak.yPercent).toBeLessThan(rise.yPercent);
    expect(peak.yPercent).toBeLessThan(set.yPercent);
    expect(peak.xPercent).toBeGreaterThan(40);
    expect(peak.xPercent).toBeLessThan(60);
  });

  it('starts and ends its arc at the horizon', () => {
    const horizon = islandCelestialPosition(0).yPercent;
    expect(islandCelestialPosition(1).yPercent).toBeCloseTo(horizon, 9);
    expect(islandCelestialPosition(0.5).yPercent).toBeLessThan(horizon - 30);
  });

  it('advances monotonically while it is visible', () => {
    let previous = -1;
    for (let minute = 0; minute <= ISLAND_SUN_SET_MINUTE; minute += 0.5) {
      const state = at(minute);
      expect(state.sunProgress).toBeGreaterThanOrEqual(previous);
      previous = state.sunProgress;
    }
    expect(at(0).sunProgress).toBe(0);
    expect(at(ISLAND_SUN_SET_MINUTE).sunProgress).toBe(1);
  });

  it('is invisible at both ends of its arc, so it never pops in mid-sky', () => {
    expect(at(0).sunOpacity).toBe(0);
    expect(at(ISLAND_SUN_SET_MINUTE).sunOpacity).toBe(0);
    // Fades in over the first five island minutes and out over the last five.
    expect(at(2.5).sunOpacity).toBeCloseTo(0.5, 2);
    expect(at(87.5).sunOpacity).toBeCloseTo(0.5, 2);
  });
});

describe('the moon', () => {
  it('rises late in sunset and sets shortly after first light', () => {
    expect(at(ISLAND_MOON_RISE_MINUTE - 1).moonOpacity).toBe(0);
    expect(at(ISLAND_MOON_RISE_MINUTE).moonOpacity).toBe(0);
    expect(at(ISLAND_MOON_RISE_MINUTE + 2).moonOpacity).toBeGreaterThan(0);
    expect(at(ISLAND_MOON_SET_MINUTE).moonOpacity).toBe(0);
    expect(at(ISLAND_MOON_SET_MINUTE + 1).moonOpacity).toBe(0);
  });

  it('is up for the whole of deep night', () => {
    for (const minute of [90, 96, 105, 115, 119]) {
      expect(at(minute).moonOpacity, `minute ${minute}`).toBeGreaterThan(0.9);
    }
    expect(at(0).moonOpacity).toBeGreaterThan(0.5);
  });

  it('crosses the sky continuously through the wrap, rather than restarting', () => {
    // The moon's arc straddles minute 120 → 0. If the wrap were handled naively
    // the moon would jump back to the eastern horizon in the middle of the night.
    const beforeWrap = at(119.9).moonProgress;
    const afterWrap = at(0).moonProgress;
    expect(afterWrap).toBeGreaterThan(beforeWrap);
    expect(afterWrap - beforeWrap).toBeLessThan(0.02);

    let previous = -1;
    for (let offset = 0; offset <= 52; offset += 0.5) {
      const minute = (ISLAND_MOON_RISE_MINUTE + offset) % ISLAND_DAY_MINUTES;
      const progress = at(minute).moonProgress;
      expect(progress, `minute ${minute}`).toBeGreaterThanOrEqual(previous);
      previous = progress;
    }
    expect(previous).toBe(1);
  });

  it('is parked and invisible outside its arc', () => {
    for (const minute of [20, 42.5, 60, 74]) {
      const state = at(minute);
      expect(state.moonOpacity, `minute ${minute}`).toBe(0);
    }
  });

  it('does not share the sky with a high sun', () => {
    for (let minute = 12; minute < 78; minute += 1) {
      expect(at(minute).moonOpacity, `minute ${minute}`).toBe(0);
    }
  });
});

describe('colour helpers', () => {
  it('interpolates hex colours and clamps the blend factor', () => {
    expect(lerpHexColor('#000000', '#ffffff', 0)).toBe('#000000');
    expect(lerpHexColor('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(lerpHexColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(lerpHexColor('#000000', '#ffffff', -5)).toBe('#000000');
    expect(lerpHexColor('#000000', '#ffffff', 5)).toBe('#ffffff');
  });

  it('accepts shorthand hex and survives malformed input', () => {
    expect(lerpHexColor('#fff', '#fff', 0.5)).toBe('#ffffff');
    expect(lerpHexColor('not-a-colour', '#000000', 0.5)).toBe('#000000');
  });

  it('emits usable rgba with a clamped alpha', () => {
    expect(hexToRgba('#3E4585', 0.14)).toBe('rgba(62, 69, 133, 0.14)');
    expect(hexToRgba('#ffffff', 9)).toBe('rgba(255, 255, 255, 1)');
    expect(hexToRgba('#ffffff', -1)).toBe('rgba(255, 255, 255, 0)');
  });
});

describe('islandArtworkFilter', () => {
  it('scales the grade toward neutral as strength drops', () => {
    const night = at(96);
    const full = islandArtworkFilter(night, 1);
    const half = islandArtworkFilter(night, 0.5);
    const none = islandArtworkFilter(night, 0);
    expect(full).toBe('brightness(0.700) saturate(0.860)');
    expect(half).toBe('brightness(0.850) saturate(0.930)');
    expect(none).toBe('brightness(1.000) saturate(1.000)');
  });

  it('keeps a constant function list so consecutive values interpolate', () => {
    const shape = (filter: string) => filter.replace(/\([^)]*\)/g, '()');
    const shapes = sweep().map((state) => shape(islandArtworkFilter(state, 1)));
    expect(new Set(shapes).size).toBe(1);
  });

  it('prepends an extra filter, for the blurred letterbox copy', () => {
    expect(islandArtworkFilter(at(96), 1, 'blur(40px)')).toBe(
      'blur(40px) brightness(0.700) saturate(0.860)',
    );
  });
});

describe('islandPhaseMidpointProgress', () => {
  it('lands in the middle of the requested phase', () => {
    for (const span of ISLAND_PHASE_SPANS) {
      const progress = islandPhaseMidpointProgress(span.phase);
      const state = computeIslandSkyState(progress);
      expect(state.phase).toBe(span.phase);
      expect(state.phaseProgress).toBeCloseTo(0.5, 6);
    }
  });
});
