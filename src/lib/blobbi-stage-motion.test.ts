/**
 * Rest and walk by life stage: a baby floats and is otherwise still; an
 * adult never floats, breathes where it stands and walks when it moves; an
 * egg rests. The rule is the stage, never the artwork generation.
 */
import { describe, expect, it } from 'vitest';

import { devV3Visual } from './dev-v3-fixture';
import { resolveBodyMotion, stageFloats } from './blobbi-stage-motion';

describe('who floats', () => {
  it('a baby floats, whatever its generation; an adult and an egg stand', () => {
    expect(stageFloats({ stage: 'baby' })).toBe(true);
    expect(stageFloats(devV3Visual('baby'))).toBe(true);
    expect(stageFloats({ stage: 'adult' })).toBe(false);
    expect(stageFloats(devV3Visual('adult'))).toBe(false);
    expect(stageFloats({ stage: 'egg' })).toBe(false);
  });

  it('a visual without a stage is drawn as the renderer draws it: a baby', () => {
    expect(stageFloats({})).toBe(true);
    expect(stageFloats(null)).toBe(true);
  });
});

describe('the body motion at rest and on the move', () => {
  it('walking is walking for everyone', () => {
    expect(resolveBodyMotion({ stage: 'baby' }, 'walking')).toBe('walking');
    expect(resolveBodyMotion(devV3Visual('adult'), 'walking')).toBe('walking');
    expect(resolveBodyMotion({ stage: 'egg' }, 'walking')).toBe('walking');
  });

  it('at rest an adult breathes in place (the grounded idle); a baby and an egg are still', () => {
    expect(resolveBodyMotion(devV3Visual('adult'), 'still')).toBe('idle');
    expect(resolveBodyMotion({ stage: 'adult' }, undefined)).toBe('idle');
    expect(resolveBodyMotion(devV3Visual('baby'), 'still')).toBe('still');
    expect(resolveBodyMotion({ stage: 'egg' }, 'still')).toBe('still');
  });

  it('never hands an adult the baby\'s float: an adult at rest is grounded, not still-and-floating', () => {
    const adult = devV3Visual('adult');
    expect(stageFloats(adult)).toBe(false);
    expect(resolveBodyMotion(adult, 'still')).not.toBe('still');
  });
});
