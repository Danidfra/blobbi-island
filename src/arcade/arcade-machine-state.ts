/**
 * The arcade's shared minigame lifecycle; one pure reducer, no exceptions.
 *
 * Modelled on `src/lib/theater-state.ts`, which proved the pattern in this
 * codebase: a single `status` value that every view derives from, so no two
 * parts of the UI can disagree about what is happening. The arcade needs it more
 * than the theater did, because a minigame's states differ in what they are
 * ALLOWED to do, not merely in what they look like.
 *
 * ```
 *   closed ──open──► preview ──start──► countdown ──ready──► playing ⇄ paused
 *     ▲                 │                   │                  │        │
 *     │                 │                   └──────abort───────┴────────┘
 *     │                 │                             │                 │
 *     │                 │                             ▼              finish
 *     │                 │                          aborted              │
 *     │                 │                             │                 ▼
 *     └──── close ──────┴─────────────────────────────┴──────────── results
 *                                                                       │
 *                                                                     claim
 *                                                                       ▼
 *                                                    rewarded ◄──ok── claiming
 *                                                       │               │
 *                                                       └───replay──────┘ (fail → results)
 * ```
 *
 * ## The invariants this file exists to enforce
 *
 * 1. **`playing` is the only state that advances a game.** `countdown` counts,
 *    `paused` freezes; neither may accumulate score. The reducer cannot enforce
 *    "did not advance" for a game it does not simulate; it enforces the thing
 *    it CAN: a result is only accepted from `playing`.
 * 2. **`paused` preserves the run.** Same `runId`, same machine, same game;
 *    resuming returns to `playing` with nothing reset.
 * 3. **A `runId` is minted exactly once per run.** The caller supplies it (the
 *    reducer is pure and may not call `crypto.randomUUID()`), and the reducer
 *    refuses to overwrite one that already exists.
 * 4. **Results are immutable.** A second `finish` for the same run is ignored.
 * 5. **Aborted runs can never claim.** No result exists to claim, and `claim`
 *    is only legal from `results`.
 * 6. **Closing mid-run aborts it.** The closed state records `lastOutcome:
 *    'aborted'` so "did that run count?" has an answer after the shell is gone.
 * 7. **One reward per `runId`, ever.** A run that reached `rewarded` is recorded
 *    in `rewardedRunIds` and can never re-enter `claiming`.
 *
 *    This is necessary and NOT sufficient, and Phase 3 learned that the hard
 *    way: a run whose publish was unconfirmed never reaches `rewarded`, so this
 *    set does not cover it, and a "retry" of an additive grant that actually
 *    landed pays it twice. The durable claim ledger is what covers that case,
 *    see `src/lib/arcade-claim-ledger.ts` and `docs/blobbi-dance.md` §8.
 * 8. **Replay is a NEW run.** New `runId`, cleared result. Never a re-run of an
 *    old one.
 * 9. **No award arithmetic lives here.** The reducer never sees, stores or
 *    computes a ticket count. That is `reward-policy.ts`'s job, and keeping the
 *    two apart is why a game can never invent its own economy.
 *
 * ## Deliberately absent
 *
 * React, DOM, timers, audio, relays, inventory, and any component reference.
 * The state is plain JSON, `arcade-machine-state.test.ts` asserts that.
 */

import type { ArcadeDifficulty, ArcadeGameResult } from './types';
import { validateArcadeGameResult } from './types';

export type ArcadeStatus =
  | 'closed'
  | 'preview'
  | 'countdown'
  | 'playing'
  | 'paused'
  | 'results'
  | 'claiming'
  | 'rewarded'
  | 'aborted';

/**
 * Why a run ended without a result. Recorded so the UI can say something true
 * ("you left the machine") instead of pretending the run never happened.
 */
export type ArcadeAbortReason =
  /** The player dismissed the shell. */
  | 'closed'
  /** The player pressed an explicit quit/exit control inside the game. */
  | 'quit'
  /** The world took the player away (left the location, lost the Blobbi). */
  | 'interrupted'
  /** The game reported it could not continue. */
  | 'error';

/** How the last run ended, remembered after the shell returns to `closed`. */
export type ArcadeLastOutcome = 'aborted' | 'finished' | 'rewarded';

export interface ArcadeMachineState {
  readonly status: ArcadeStatus;
  /** Which machine is open. Null exactly when `status === 'closed'`. */
  readonly machineId: string | null;
  /**
   * Which game the open machine offers, or null when it has none yet (every
   * coming-soon machine). A machine with no game can only ever reach `preview`.
   */
  readonly gameId: string | null;
  readonly difficulty: ArcadeDifficulty | null;
  /** Set from `countdown` onwards; cleared by `open`, `close` and `replay`. */
  readonly runId: string | null;
  /** Set once, at `finish`. Never edited. */
  readonly result: ArcadeGameResult | null;
  readonly abortReason: ArcadeAbortReason | null;
  /** Outcome of the most recent run, surviving into `closed`. */
  readonly lastOutcome: ArcadeLastOutcome | null;
  /**
   * Every `runId` that has been fully rewarded. The one-way door: a run listed
   * here can never enter `claiming` again, no matter how many times the button
   * is pressed, how many times React re-invokes an effect, or how many retries a
   * flaky relay provokes.
   */
  readonly rewardedRunIds: readonly string[];
}

export const INITIAL_ARCADE_MACHINE_STATE: ArcadeMachineState = {
  status: 'closed',
  machineId: null,
  gameId: null,
  difficulty: null,
  runId: null,
  result: null,
  abortReason: null,
  lastOutcome: null,
  rewardedRunIds: [],
};

export type ArcadeEvent =
  /**
   * The Blobbi ARRIVED at a machine and the shell opened. Never fired on click,
   * see `ArcadeMachine.tsx`.
   *
   * Always a clean slate: opening a machine can never resume a previous run,
   * which is what stops "reopening a coming-soon preview" from resurrecting an
   * aborted one.
   */
  | { type: 'open'; machineId: string; gameId?: string | null; difficulty?: ArcadeDifficulty }
  /** The player started a run. `runId` is minted by the caller, once. */
  | { type: 'start'; runId: string; difficulty?: ArcadeDifficulty }
  /** The countdown finished; the clock starts now. */
  | { type: 'countdown-complete' }
  /** Tab hidden, window blurred, or the pause control pressed. */
  | { type: 'pause' }
  | { type: 'resume' }
  /** The game produced its one and only result. */
  | { type: 'finish'; result: ArcadeGameResult }
  /** The run ended without a result. */
  | { type: 'abort'; reason: ArcadeAbortReason }
  /** Begin the reward claim for the finished result. */
  | { type: 'claim' }
  /** The claim was CONFIRMED (published and verified), not merely attempted. */
  | { type: 'claim-succeeded' }
  /** The claim failed; the same `runId` stays retryable. */
  | { type: 'claim-failed' }
  /** Play again: a brand-new run with a brand-new id. */
  | { type: 'replay'; runId: string; difficulty?: ArcadeDifficulty }
  /** Dismiss the shell. Aborts first if a run was in progress. */
  | { type: 'close' };

/** States in which a run exists and has not yet produced a result. */
const ADVANCING: readonly ArcadeStatus[] = ['countdown', 'playing', 'paused'];

/** True while a run is live, used by the shell to decide whether to warn. */
export function isRunInProgress(state: ArcadeMachineState): boolean {
  return ADVANCING.includes(state.status);
}

/** The only state in which a game may accumulate score or advance a clock. */
export function isGameAdvancing(state: ArcadeMachineState): boolean {
  return state.status === 'playing';
}

/** Whether the machine currently open has a playable game at all. */
export function hasPlayableGame(state: ArcadeMachineState): boolean {
  return state.gameId !== null;
}

/** Whether this run's reward has already been fully granted. */
export function isRunRewarded(state: ArcadeMachineState, runId: string | null): boolean {
  return runId !== null && state.rewardedRunIds.includes(runId);
}

/**
 * Whether `claim` would do anything right now.
 *
 * The shell disables the claim button on this, and the reducer enforces the same
 * rule: belt and braces, because a disabled button is a UI courtesy and the
 * reducer is the actual guarantee.
 */
export function canClaim(state: ArcadeMachineState): boolean {
  return (
    state.status === 'results' &&
    state.result !== null &&
    state.runId !== null &&
    !state.rewardedRunIds.includes(state.runId)
  );
}

function closedFrom(state: ArcadeMachineState, outcome: ArcadeLastOutcome | null): ArcadeMachineState {
  return {
    ...INITIAL_ARCADE_MACHINE_STATE,
    lastOutcome: outcome,
    // The rewarded set is the app's memory of what has been paid out. Closing a
    // modal must not erase it, or a reopened shell could pay the same run twice.
    rewardedRunIds: state.rewardedRunIds,
  };
}

export function arcadeMachineReducer(
  state: ArcadeMachineState,
  event: ArcadeEvent,
): ArcadeMachineState {
  switch (event.type) {
    case 'open': {
      // Opening while a run is live would silently discard it. The caller must
      // close (which aborts) first; ignoring here keeps the run's fate explicit.
      if (isRunInProgress(state)) return state;
      return {
        ...INITIAL_ARCADE_MACHINE_STATE,
        rewardedRunIds: state.rewardedRunIds,
        status: 'preview',
        machineId: event.machineId,
        gameId: event.gameId ?? null,
        difficulty: event.difficulty ?? null,
      };
    }

    case 'start': {
      if (state.status !== 'preview') return state;
      // A machine with no game cannot start one. This is the structural reason
      // the eight coming-soon machines cannot fake gameplay: there is no game id
      // to run, so `start` is a no-op no matter what the UI does.
      if (state.gameId === null) return state;
      // Invariant 3: a run id is minted once. A `start` that arrives with a run
      // already in flight is a duplicate dispatch, not a second run.
      if (state.runId !== null) return state;
      if (!event.runId) return state;
      return {
        ...state,
        status: 'countdown',
        runId: event.runId,
        difficulty: event.difficulty ?? state.difficulty,
        result: null,
        abortReason: null,
      };
    }

    case 'countdown-complete':
      if (state.status !== 'countdown') return state;
      return { ...state, status: 'playing' };

    case 'pause':
      // Pausing a countdown is legitimate (the tab was hidden mid "3, 2, 1"),
      // and resuming returns to `playing`: the countdown is not replayed,
      // because the shell owns the countdown and will re-run it if it wants to.
      if (state.status !== 'playing' && state.status !== 'countdown') return state;
      return { ...state, status: 'paused' };

    case 'resume':
      if (state.status !== 'paused') return state;
      return { ...state, status: 'playing' };

    case 'finish': {
      // Invariant 1: only a run that was actually being played can produce a
      // result. A `finish` from `paused` would mean the game scored while frozen.
      if (state.status !== 'playing') return state;
      // Invariant 4: results are immutable.
      if (state.result !== null) return state;
      // The result must belong to THIS run. A mismatched runId is the shape a
      // replayed or forged result takes, and it must not become the run's truth.
      if (state.runId === null || event.result.runId !== state.runId) return state;
      if (state.gameId !== null && event.result.gameId !== state.gameId) return state;
      if (state.machineId !== null && event.result.machineId !== state.machineId) return state;
      if (!validateArcadeGameResult(event.result).ok) return state;
      return {
        ...state,
        status: 'results',
        result: event.result,
        difficulty: event.result.difficulty,
        lastOutcome: 'finished',
      };
    }

    case 'abort': {
      if (!isRunInProgress(state)) return state;
      return {
        ...state,
        status: 'aborted',
        // Invariant 5: no result is ever synthesised for an aborted run, so
        // `claim` has nothing to work with and the reward path is closed.
        result: null,
        abortReason: event.reason,
        lastOutcome: 'aborted',
      };
    }

    case 'claim':
      if (!canClaim(state)) return state;
      return { ...state, status: 'claiming' };

    case 'claim-succeeded': {
      if (state.status !== 'claiming' || state.runId === null) return state;
      // Invariant 7: the one-way door closes here, and only here, on CONFIRMED
      // success. An attempted claim leaves no trace, so a failure stays retryable.
      const runId = state.runId;
      return {
        ...state,
        status: 'rewarded',
        lastOutcome: 'rewarded',
        rewardedRunIds: state.rewardedRunIds.includes(runId)
          ? state.rewardedRunIds
          : [...state.rewardedRunIds, runId],
      };
    }

    case 'claim-failed':
      if (state.status !== 'claiming') return state;
      // Back to the results screen with the SAME runId, so the retry is the same
      // claim rather than a new one. The rewarded set is untouched.
      return { ...state, status: 'results' };

    case 'replay': {
      // Invariant 8: replay is only reachable from a finished run's tail, and
      // always creates a new run.
      if (state.status !== 'results' && state.status !== 'rewarded' && state.status !== 'aborted') {
        return state;
      }
      if (state.gameId === null) return state;
      if (!event.runId || event.runId === state.runId) return state;
      return {
        ...state,
        status: 'countdown',
        runId: event.runId,
        difficulty: event.difficulty ?? state.difficulty,
        result: null,
        abortReason: null,
      };
    }

    case 'close':
      // Invariant 6: dismissing the shell mid-run is an abort, recorded as one.
      return closedFrom(state, isRunInProgress(state) ? 'aborted' : state.lastOutcome);
  }
}
