import { afterEach, describe, expect, it } from 'vitest';

import { ENTRY_HOLD_MAX_MS, entryArrivalEnabled, entryDecision, setEntryArrivalEnabled } from './entry-arrival';

describe('the entry gate', () => {
  afterEach(() => setEntryArrivalEnabled(true));

  it('with no session (World Travel off, signed out, another account), the Blobbi simply arrives', () => {
    expect(entryDecision({ resolution: 'none', here: true, heldFor: 0 })).toBe('enter');
  });

  it('a kept location is never enough: cached waits, like pending, until the first look answers', () => {
    expect(entryDecision({ resolution: 'cached', here: true, heldFor: 0 })).toBe('wait');
    expect(entryDecision({ resolution: 'cached', here: false, heldFor: 0 })).toBe('wait');
    expect(entryDecision({ resolution: 'pending', here: false, heldFor: ENTRY_HOLD_MAX_MS - 1 })).toBe('wait');
  });

  it('once a relay answered, here arrives and elsewhere stays away', () => {
    expect(entryDecision({ resolution: 'confirmed', here: true, heldFor: 10 })).toBe('enter');
    expect(entryDecision({ resolution: 'confirmed', here: false, heldFor: 10 })).toBe('skip');
  });

  it('no relay answered: the kept place, or the default World, stands (nothing is claimed beyond it)', () => {
    expect(entryDecision({ resolution: 'unreachable', here: true, heldFor: 4_000 })).toBe('enter');
    expect(entryDecision({ resolution: 'unreachable', here: false, heldFor: 4_000 })).toBe('skip');
  });

  it('the hold is bounded: when it runs out, a place not known at all is not here, a kept place stands', () => {
    expect(entryDecision({ resolution: 'pending', here: false, heldFor: ENTRY_HOLD_MAX_MS })).toBe('skip');
    expect(entryDecision({ resolution: 'cached', here: true, heldFor: ENTRY_HOLD_MAX_MS })).toBe('enter');
    expect(entryDecision({ resolution: 'cached', here: false, heldFor: ENTRY_HOLD_MAX_MS })).toBe('skip');
  });

  it('the test seam turns the arrival off and on', () => {
    expect(entryArrivalEnabled()).toBe(true);
    setEntryArrivalEnabled(false);
    expect(entryArrivalEnabled()).toBe(false);
  });
});
