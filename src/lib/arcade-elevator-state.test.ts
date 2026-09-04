import { describe, it, expect } from 'vitest';

import {
  ELEVATOR_INITIAL_STATE,
  elevatorReducer,
  isElevatorDoorOpen,
  isElevatorLockedOpen,
  type ElevatorEvent,
  type ElevatorState,
} from './arcade-elevator-state';

function run(events: ElevatorEvent['type'][], from: ElevatorState = ELEVATOR_INITIAL_STATE): ElevatorState {
  return events.reduce((state, type) => elevatorReducer(state, { type }), from);
}

describe('elevator doors', () => {
  it('start closed', () => {
    expect(isElevatorDoorOpen(ELEVATOR_INITIAL_STATE)).toBe(false);
  });

  it('hover opens, and leaving closes, while idle', () => {
    const open = run(['hover-enter']);
    expect(isElevatorDoorOpen(open)).toBe(true);
    expect(isElevatorLockedOpen(open)).toBe(false);
    expect(isElevatorDoorOpen(run(['hover-leave'], open))).toBe(false);
  });

  it('a click or tap locks the doors open, with or without hover', () => {
    const tapped = run(['interact']);
    expect(tapped.phase).toBe('engaged');
    expect(isElevatorDoorOpen(tapped)).toBe(true);
    expect(isElevatorLockedOpen(tapped)).toBe(true);
    // Leaving with the pointer no longer closes anything.
    expect(isElevatorDoorOpen(run(['hover-enter', 'interact', 'hover-leave']))).toBe(true);
  });

  it('stays open through the walk, the floor picker and the exit', () => {
    const selecting = run(['interact', 'arrived']);
    expect(selecting.phase).toBe('selecting');
    expect(isElevatorDoorOpen(run(['hover-leave'], selecting))).toBe(true);

    const exiting = run(['modal-closed'], selecting);
    expect(exiting.phase).toBe('exiting');
    expect(isElevatorDoorOpen(exiting)).toBe(true);
  });

  it('closes only once the Blobbi has left the doorway after the picker was dismissed', () => {
    const exiting = run(['interact', 'arrived', 'modal-closed']);
    const gone = run(['departed'], exiting);
    expect(gone.phase).toBe('idle');
    expect(isElevatorDoorOpen(gone)).toBe(false);
    // ...unless the pointer is still on the doors, which is plain hover again.
    expect(isElevatorDoorOpen(run(['hover-enter', 'departed'], exiting))).toBe(true);
    expect(isElevatorLockedOpen(run(['hover-enter', 'departed'], exiting))).toBe(false);
  });

  it('a cancelled walk unlocks the doors', () => {
    const cancelled = run(['interact', 'cancelled']);
    expect(cancelled.phase).toBe('idle');
    expect(isElevatorDoorOpen(cancelled)).toBe(false);
  });

  it('ignores events that do not apply to the current phase', () => {
    expect(run(['arrived'])).toEqual(ELEVATOR_INITIAL_STATE);
    expect(run(['modal-closed'])).toEqual(ELEVATOR_INITIAL_STATE);
    expect(run(['departed'])).toEqual(ELEVATOR_INITIAL_STATE);
    // A departure while the picker is up is impossible (the picker is modal)
    // and is not allowed to close the doors on a Blobbi in the doorway.
    const selecting = run(['interact', 'arrived']);
    expect(run(['departed'], selecting)).toEqual(selecting);
    expect(run(['cancelled'], selecting)).toEqual(selecting);
  });

  it('can be called again while exiting', () => {
    const again = run(['interact', 'arrived', 'modal-closed', 'interact']);
    expect(again.phase).toBe('engaged');
    expect(run(['arrived'], again).phase).toBe('selecting');
  });
});
