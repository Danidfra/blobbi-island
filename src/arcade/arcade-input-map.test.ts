import { describe, it, expect } from 'vitest';

import {
  ARCADE_CONTROL_HINTS,
  ARCADE_LANES,
  ARCADE_PAUSE_KEYS,
  ARCADE_TOUCH_ZONE_MIN_PX,
  DEFAULT_ARCADE_KEYMAP,
  resolveKeyAction,
  shouldPreventDefault,
} from './arcade-input-map';

describe('key → action mapping', () => {
  it.each([
    ['ArrowLeft', 'left'],
    ['ArrowDown', 'down'],
    ['ArrowUp', 'up'],
    ['ArrowRight', 'right'],
    ['a', 'left'],
    ['s', 'down'],
    ['w', 'up'],
    ['d', 'right'],
    ['W', 'up'],
  ] as const)('maps %s to the %s lane', (key, lane) => {
    expect(resolveKeyAction({ key }, 'down')).toEqual({ type: 'lane', lane, phase: 'press' });
    expect(resolveKeyAction({ key }, 'up')).toEqual({ type: 'lane', lane, phase: 'release' });
  });

  it('ignores keys that are not bound', () => {
    expect(resolveKeyAction({ key: 'q' }, 'down')).toBeNull();
    expect(resolveKeyAction({ key: 'Enter' }, 'down')).toBeNull();
  });

  it('drops auto-repeat so a held key is one press, not a stream', () => {
    expect(resolveKeyAction({ key: 'ArrowLeft', repeat: true }, 'down')).toBeNull();
    // ...but a release always counts, or the lane would stick down forever.
    expect(resolveKeyAction({ key: 'ArrowLeft', repeat: true }, 'up')).toEqual({
      type: 'lane',
      lane: 'left',
      phase: 'release',
    });
  });

  it('ignores modified keys: Cmd+R is a reload, not a lane hit', () => {
    expect(resolveKeyAction({ key: 'ArrowLeft', metaKey: true }, 'down')).toBeNull();
    expect(resolveKeyAction({ key: 'a', ctrlKey: true }, 'down')).toBeNull();
    expect(resolveKeyAction({ key: 'p', altKey: true }, 'down')).toBeNull();
  });

  it('maps the pause key on press only', () => {
    for (const key of ARCADE_PAUSE_KEYS) {
      expect(resolveKeyAction({ key }, 'down')).toEqual({ type: 'pause' });
      expect(resolveKeyAction({ key }, 'up')).toBeNull();
    }
  });

  it('honours a custom keymap', () => {
    expect(resolveKeyAction({ key: 'j' }, 'down', { j: 'left' })).toEqual({
      type: 'lane',
      lane: 'left',
      phase: 'press',
    });
    // ...and the default bindings no longer apply.
    expect(resolveKeyAction({ key: 'ArrowLeft' }, 'down', { j: 'left' })).toBeNull();
  });
});

describe('default browser behaviour', () => {
  it('suppresses the keys that would scroll the page', () => {
    for (const key of ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight', ' ']) {
      expect(shouldPreventDefault(key)).toBe(true);
    }
  });

  it('never suppresses Escape or Tab, closing and focus must keep working', () => {
    expect(shouldPreventDefault('Escape')).toBe(false);
    expect(shouldPreventDefault('Tab')).toBe(false);
  });
});

describe('control hints', () => {
  it('documents every lane exactly once, for both desktop and mobile', () => {
    expect(ARCADE_CONTROL_HINTS.map((h) => h.lane)).toEqual([...ARCADE_LANES]);
    for (const hint of ARCADE_CONTROL_HINTS) {
      expect(hint.desktop.trim().length).toBeGreaterThan(0);
      expect(hint.mobile.trim().length).toBeGreaterThan(0);
    }
  });

  it('describes bindings the keymap actually has', () => {
    const mappedLanes = new Set(Object.values(DEFAULT_ARCADE_KEYMAP));
    for (const hint of ARCADE_CONTROL_HINTS) {
      expect(mappedLanes.has(hint.lane)).toBe(true);
    }
  });

  it('keeps touch zones at least as large as the accessible minimum', () => {
    expect(ARCADE_TOUCH_ZONE_MIN_PX).toBeGreaterThanOrEqual(44);
  });
});
