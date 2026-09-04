/**
 * The arcade elevator's door lifecycle, as one small explicit state machine.
 *
 * The doors used to be a hover boolean: the pointer opened them, the pointer
 * closed them, and nothing else had a say. So a Blobbi walked into a closed
 * elevator whenever the pointer left the doors mid-walk, and a tap on a phone
 * (which never hovers) opened the floor picker in front of shut doors.
 *
 * Two independent inputs decide whether the doors are open:
 *
 *  - `hovering`: the pointer is over the doors. Cosmetic, and only allowed to
 *    CLOSE the doors while nothing else is going on.
 *  - `phase`: what the interaction is doing. Anything but `idle` locks the
 *    doors open:
 *
 * ```
 *   idle ──interact──► engaged ──arrived──► selecting ──modal-closed──► exiting
 *     ▲                  │                                                 │
 *     └────cancelled─────┘◄────────────────departed───────────────────────┘
 * ```
 *
 *   engaged     the player clicked or tapped; the Blobbi is walking to (or is
 *               already standing in) the doorway. Locked open BEFORE the walk
 *               starts, so the actor never crosses a closed door.
 *   selecting   the Blobbi is in the doorway and the floor picker is up.
 *   exiting     the picker was dismissed; the Blobbi is still standing in the
 *               doorway, so the doors stay open until it walks away.
 *
 * Choosing a floor leaves the room, which unmounts the elevator; there is no
 * transition for it. Pure and DOM-free so the lifecycle is testable on its own.
 */

export type ElevatorPhase = 'idle' | 'engaged' | 'selecting' | 'exiting';

export interface ElevatorState {
  readonly phase: ElevatorPhase;
  readonly hovering: boolean;
}

export type ElevatorEvent =
  | { type: 'hover-enter' }
  | { type: 'hover-leave' }
  /** A click or tap on the doors: the walk-to-interact was requested. */
  | { type: 'interact' }
  /** Confirmed arrival at the doorway stand point. */
  | { type: 'arrived' }
  /** The walk was abandoned before arrival. */
  | { type: 'cancelled' }
  /** The floor picker was dismissed without choosing a floor. */
  | { type: 'modal-closed' }
  /** The Blobbi left the doorway (a walk elsewhere started). */
  | { type: 'departed' };

export const ELEVATOR_INITIAL_STATE: ElevatorState = { phase: 'idle', hovering: false };

/**
 * How long the door slide takes (`InteractiveElement`'s `duration-300`). An
 * arrival that lands before the doors have finished opening waits out the
 * remainder before the picker appears, so the sequence on screen is always
 * doors open, then Blobbi in the doorway, then the picker.
 */
export const ELEVATOR_DOOR_TRANSITION_MS = 300;

export function elevatorReducer(state: ElevatorState, event: ElevatorEvent): ElevatorState {
  switch (event.type) {
    case 'hover-enter':
      return state.hovering ? state : { ...state, hovering: true };
    case 'hover-leave':
      return state.hovering ? { ...state, hovering: false } : state;
    case 'interact':
      // Re-engaging from any phase is fine: a second click while exiting is
      // the player calling the elevator again.
      return state.phase === 'engaged' ? state : { ...state, phase: 'engaged' };
    case 'arrived':
      return state.phase === 'engaged' ? { ...state, phase: 'selecting' } : state;
    case 'cancelled':
      return state.phase === 'engaged' ? { ...state, phase: 'idle' } : state;
    case 'modal-closed':
      return state.phase === 'selecting' ? { ...state, phase: 'exiting' } : state;
    case 'departed':
      return state.phase === 'exiting' ? { ...state, phase: 'idle' } : state;
    default:
      return state;
  }
}

/** Whether the doors are drawn open. */
export function isElevatorDoorOpen(state: ElevatorState): boolean {
  return state.hovering || state.phase !== 'idle';
}

/** Whether the doors are locked open by the interaction (hover may not close them). */
export function isElevatorLockedOpen(state: ElevatorState): boolean {
  return state.phase !== 'idle';
}
