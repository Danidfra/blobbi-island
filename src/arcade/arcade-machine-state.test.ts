/**
 * Contract tests for the arcade lifecycle reducer.
 *
 * The reducer is the only thing standing between "a game ended" and "tickets
 * were granted", so these tests pin the invariants rather than the happy path:
 * a run id is minted once, a result is written once, an abandoned run can never
 * claim, and a rewarded run can never be rewarded twice.
 */
import { describe, it, expect } from 'vitest';

import {
  INITIAL_ARCADE_MACHINE_STATE,
  arcadeMachineReducer,
  canClaim,
  hasPlayableGame,
  isGameAdvancing,
  isRunInProgress,
  isRunRewarded,
  type ArcadeEvent,
  type ArcadeMachineState,
} from './arcade-machine-state';
import type { ArcadeGameResult } from './types';
import { isJsonSerialisable } from './types';

const MACHINE = 'arcade-dance-machine';
const GAME = 'blobbi-dance';

const reduce = (state: ArcadeMachineState, ...events: ArcadeEvent[]): ArcadeMachineState =>
  events.reduce(arcadeMachineReducer, state);

function result(overrides: Partial<ArcadeGameResult> = {}): ArcadeGameResult {
  return {
    runId: 'run-1',
    gameId: GAME,
    machineId: MACHINE,
    difficulty: 'normal',
    cleared: true,
    score: 1200,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_090_000,
    stats: { accuracy: 92, maxCombo: 48 },
    ...overrides,
  };
}

/** Open the dance machine and get all the way to `playing` with `run-1`. */
function playing(): ArcadeMachineState {
  return reduce(
    INITIAL_ARCADE_MACHINE_STATE,
    { type: 'open', machineId: MACHINE, gameId: GAME, difficulty: 'normal' },
    { type: 'start', runId: 'run-1' },
    { type: 'countdown-complete' },
  );
}

describe('arcade lifecycle: the legal path', () => {
  it('runs closed → preview → countdown → playing → results → claiming → rewarded', () => {
    let s = INITIAL_ARCADE_MACHINE_STATE;
    expect(s.status).toBe('closed');

    s = arcadeMachineReducer(s, { type: 'open', machineId: MACHINE, gameId: GAME });
    expect(s.status).toBe('preview');
    expect(s.machineId).toBe(MACHINE);
    expect(s.runId).toBeNull();

    s = arcadeMachineReducer(s, { type: 'start', runId: 'run-1' });
    expect(s.status).toBe('countdown');
    expect(s.runId).toBe('run-1');

    s = arcadeMachineReducer(s, { type: 'countdown-complete' });
    expect(s.status).toBe('playing');
    expect(isGameAdvancing(s)).toBe(true);

    s = arcadeMachineReducer(s, { type: 'finish', result: result() });
    expect(s.status).toBe('results');
    expect(s.result).toEqual(result());

    s = arcadeMachineReducer(s, { type: 'claim' });
    expect(s.status).toBe('claiming');

    s = arcadeMachineReducer(s, { type: 'claim-succeeded' });
    expect(s.status).toBe('rewarded');
    expect(s.rewardedRunIds).toEqual(['run-1']);
  });

  it('pauses and resumes without disturbing the run', () => {
    const before = playing();
    const paused = arcadeMachineReducer(before, { type: 'pause' });

    expect(paused.status).toBe('paused');
    expect(isGameAdvancing(paused)).toBe(false);
    expect(paused.runId).toBe(before.runId);
    expect(paused.machineId).toBe(before.machineId);
    expect(paused.gameId).toBe(before.gameId);

    const resumed = arcadeMachineReducer(paused, { type: 'resume' });
    expect(resumed.status).toBe('playing');
    expect(resumed.runId).toBe(before.runId);
  });

  it('pauses out of the countdown too, and resumes into play', () => {
    const counting = reduce(
      INITIAL_ARCADE_MACHINE_STATE,
      { type: 'open', machineId: MACHINE, gameId: GAME },
      { type: 'start', runId: 'run-1' },
    );
    const paused = arcadeMachineReducer(counting, { type: 'pause' });
    expect(paused.status).toBe('paused');
    expect(arcadeMachineReducer(paused, { type: 'resume' }).status).toBe('playing');
  });
});

describe('arcade lifecycle: run identity', () => {
  it('mints exactly one runId per run and refuses to replace it', () => {
    const started = reduce(
      INITIAL_ARCADE_MACHINE_STATE,
      { type: 'open', machineId: MACHINE, gameId: GAME },
      { type: 'start', runId: 'run-1' },
    );
    const again = arcadeMachineReducer(started, { type: 'start', runId: 'run-2' });

    expect(again).toBe(started);
    expect(again.runId).toBe('run-1');
  });

  it('ignores a start with an empty runId', () => {
    const preview = arcadeMachineReducer(INITIAL_ARCADE_MACHINE_STATE, {
      type: 'open',
      machineId: MACHINE,
      gameId: GAME,
    });
    expect(arcadeMachineReducer(preview, { type: 'start', runId: '' })).toBe(preview);
  });

  it('refuses to start a machine that has no game', () => {
    const preview = arcadeMachineReducer(INITIAL_ARCADE_MACHINE_STATE, {
      type: 'open',
      machineId: 'arcade-cabinet-pink',
    });
    expect(hasPlayableGame(preview)).toBe(false);
    expect(arcadeMachineReducer(preview, { type: 'start', runId: 'run-1' })).toBe(preview);
  });

  it('gives replay a brand-new runId and clears the old result', () => {
    const finished = arcadeMachineReducer(playing(), { type: 'finish', result: result() });
    const replayed = arcadeMachineReducer(finished, { type: 'replay', runId: 'run-2' });

    expect(replayed.status).toBe('countdown');
    expect(replayed.runId).toBe('run-2');
    expect(replayed.result).toBeNull();
  });

  it('refuses a replay that reuses the previous runId', () => {
    const finished = arcadeMachineReducer(playing(), { type: 'finish', result: result() });
    expect(arcadeMachineReducer(finished, { type: 'replay', runId: 'run-1' })).toBe(finished);
  });

  it('replays out of a rewarded run without re-granting the old one', () => {
    const rewarded = reduce(
      playing(),
      { type: 'finish', result: result() },
      { type: 'claim' },
      { type: 'claim-succeeded' },
    );
    const replayed = arcadeMachineReducer(rewarded, { type: 'replay', runId: 'run-2' });

    expect(replayed.status).toBe('countdown');
    expect(replayed.rewardedRunIds).toEqual(['run-1']);
    expect(isRunRewarded(replayed, 'run-1')).toBe(true);
    expect(isRunRewarded(replayed, 'run-2')).toBe(false);
  });
});

describe('arcade lifecycle: result immutability', () => {
  it('accepts one result and ignores every later one', () => {
    const first = arcadeMachineReducer(playing(), { type: 'finish', result: result() });
    const second = arcadeMachineReducer(first, {
      type: 'finish',
      result: result({ score: 999_999 }),
    });

    expect(second).toBe(first);
    expect(second.result?.score).toBe(1200);
  });

  it('rejects a result whose runId belongs to another run', () => {
    const state = playing();
    expect(arcadeMachineReducer(state, { type: 'finish', result: result({ runId: 'other' }) })).toBe(
      state,
    );
  });

  it('rejects a result attributed to another game or machine', () => {
    const state = playing();
    expect(
      arcadeMachineReducer(state, { type: 'finish', result: result({ gameId: 'other-game' }) }),
    ).toBe(state);
    expect(
      arcadeMachineReducer(state, { type: 'finish', result: result({ machineId: 'other' }) }),
    ).toBe(state);
  });

  it('rejects a malformed result rather than storing it', () => {
    const state = playing();
    expect(arcadeMachineReducer(state, { type: 'finish', result: result({ score: NaN }) })).toBe(
      state,
    );
    expect(
      arcadeMachineReducer(state, {
        type: 'finish',
        result: result({ startedAt: 2, endedAt: 1 }),
      }),
    ).toBe(state);
  });

  it('refuses a result produced while paused', () => {
    const paused = arcadeMachineReducer(playing(), { type: 'pause' });
    expect(arcadeMachineReducer(paused, { type: 'finish', result: result() })).toBe(paused);
  });
});

describe('arcade lifecycle: abort', () => {
  it.each(['countdown', 'playing', 'paused'] as const)('aborts from %s', (status) => {
    let s = reduce(
      INITIAL_ARCADE_MACHINE_STATE,
      { type: 'open', machineId: MACHINE, gameId: GAME },
      { type: 'start', runId: 'run-1' },
    );
    if (status !== 'countdown') s = arcadeMachineReducer(s, { type: 'countdown-complete' });
    if (status === 'paused') s = arcadeMachineReducer(s, { type: 'pause' });
    expect(s.status).toBe(status);

    const aborted = arcadeMachineReducer(s, { type: 'abort', reason: 'quit' });
    expect(aborted.status).toBe('aborted');
    expect(aborted.abortReason).toBe('quit');
    expect(aborted.result).toBeNull();
    expect(aborted.lastOutcome).toBe('aborted');
  });

  it('never lets an aborted run claim a reward', () => {
    const aborted = arcadeMachineReducer(playing(), { type: 'abort', reason: 'interrupted' });

    expect(canClaim(aborted)).toBe(false);
    expect(arcadeMachineReducer(aborted, { type: 'claim' })).toBe(aborted);
    expect(arcadeMachineReducer(aborted, { type: 'claim-succeeded' }).rewardedRunIds).toEqual([]);
  });

  it('ignores an abort outside a live run', () => {
    const preview = arcadeMachineReducer(INITIAL_ARCADE_MACHINE_STATE, {
      type: 'open',
      machineId: MACHINE,
      gameId: GAME,
    });
    expect(arcadeMachineReducer(preview, { type: 'abort', reason: 'closed' })).toBe(preview);

    const finished = arcadeMachineReducer(playing(), { type: 'finish', result: result() });
    expect(arcadeMachineReducer(finished, { type: 'abort', reason: 'closed' })).toBe(finished);
  });

  it.each(['countdown', 'playing', 'paused'] as const)(
    'records closing during %s as an abort',
    (status) => {
      let s = reduce(
        INITIAL_ARCADE_MACHINE_STATE,
        { type: 'open', machineId: MACHINE, gameId: GAME },
        { type: 'start', runId: 'run-1' },
      );
      if (status !== 'countdown') s = arcadeMachineReducer(s, { type: 'countdown-complete' });
      if (status === 'paused') s = arcadeMachineReducer(s, { type: 'pause' });

      const closed = arcadeMachineReducer(s, { type: 'close' });
      expect(closed.status).toBe('closed');
      expect(closed.lastOutcome).toBe('aborted');
      expect(closed.runId).toBeNull();
      expect(closed.result).toBeNull();
    },
  );

  it('does not resume an aborted run when the machine is reopened', () => {
    const aborted = arcadeMachineReducer(playing(), { type: 'abort', reason: 'closed' });
    const closed = arcadeMachineReducer(aborted, { type: 'close' });
    const reopened = arcadeMachineReducer(closed, { type: 'open', machineId: MACHINE, gameId: GAME });

    expect(reopened.status).toBe('preview');
    expect(reopened.runId).toBeNull();
    expect(reopened.result).toBeNull();
    expect(reopened.abortReason).toBeNull();
  });

  it('refuses to open a different machine while a run is live', () => {
    const live = playing();
    expect(arcadeMachineReducer(live, { type: 'open', machineId: 'arcade-pool-table' })).toBe(live);
  });
});

describe('arcade lifecycle: reward claiming', () => {
  const finished = () => arcadeMachineReducer(playing(), { type: 'finish', result: result() });

  it('blocks a second claim for a run that was already rewarded', () => {
    const rewarded = reduce(finished(), { type: 'claim' }, { type: 'claim-succeeded' });
    expect(rewarded.rewardedRunIds).toEqual(['run-1']);

    // Even if the UI somehow got back to results with the same run, canClaim
    // says no and the reducer refuses.
    const backToResults = { ...rewarded, status: 'results' as const };
    expect(canClaim(backToResults)).toBe(false);
    expect(arcadeMachineReducer(backToResults, { type: 'claim' })).toBe(backToResults);
  });

  it('ignores a duplicate claim dispatched while one is already in flight', () => {
    const claiming = arcadeMachineReducer(finished(), { type: 'claim' });
    expect(arcadeMachineReducer(claiming, { type: 'claim' })).toBe(claiming);
  });

  it('keeps a failed claim retryable under the same runId', () => {
    const failed = reduce(finished(), { type: 'claim' }, { type: 'claim-failed' });

    expect(failed.status).toBe('results');
    expect(failed.runId).toBe('run-1');
    expect(failed.rewardedRunIds).toEqual([]);
    expect(canClaim(failed)).toBe(true);

    const retried = reduce(failed, { type: 'claim' }, { type: 'claim-succeeded' });
    expect(retried.status).toBe('rewarded');
    expect(retried.rewardedRunIds).toEqual(['run-1']);
  });

  it('remembers rewarded runs across a close/reopen cycle', () => {
    const rewarded = reduce(finished(), { type: 'claim' }, { type: 'claim-succeeded' });
    const reopened = reduce(
      rewarded,
      { type: 'close' },
      { type: 'open', machineId: MACHINE, gameId: GAME },
    );
    expect(reopened.rewardedRunIds).toEqual(['run-1']);
  });

  it('never stores a ticket amount, the reducer computes no rewards', () => {
    const rewarded = reduce(finished(), { type: 'claim' }, { type: 'claim-succeeded' });
    const keys = Object.keys(rewarded);
    expect(keys).not.toContain('tickets');
    expect(keys).not.toContain('award');
    expect(keys).not.toContain('reward');
  });
});

describe('arcade lifecycle: illegal transitions', () => {
  const every: ArcadeEvent[] = [
    { type: 'start', runId: 'x' },
    { type: 'countdown-complete' },
    { type: 'pause' },
    { type: 'resume' },
    { type: 'finish', result: result() },
    { type: 'abort', reason: 'quit' },
    { type: 'claim' },
    { type: 'claim-succeeded' },
    { type: 'claim-failed' },
    { type: 'replay', runId: 'y' },
  ];

  it('ignores every non-open event from the closed state', () => {
    for (const event of every) {
      expect(arcadeMachineReducer(INITIAL_ARCADE_MACHINE_STATE, event)).toBe(
        INITIAL_ARCADE_MACHINE_STATE,
      );
    }
  });

  it('returns the SAME object reference for an ignored event', () => {
    // Identity matters: a new object for a no-op would re-render every consumer
    // of this state on every stray dispatch.
    const state = playing();
    expect(arcadeMachineReducer(state, { type: 'resume' })).toBe(state);
    expect(arcadeMachineReducer(state, { type: 'countdown-complete' })).toBe(state);
    expect(arcadeMachineReducer(state, { type: 'claim' })).toBe(state);
  });

  it('reports run-in-progress only for the advancing states', () => {
    expect(isRunInProgress(INITIAL_ARCADE_MACHINE_STATE)).toBe(false);
    expect(isRunInProgress(playing())).toBe(true);
    expect(isRunInProgress(arcadeMachineReducer(playing(), { type: 'pause' }))).toBe(true);
    expect(
      isRunInProgress(arcadeMachineReducer(playing(), { type: 'finish', result: result() })),
    ).toBe(false);
  });
});

describe('arcade lifecycle: nothing but a finished run is claimable', () => {
  /** One state per status, reached the way production would reach it. */
  const statesByStatus = (): Record<string, ArcadeMachineState> => {
    const preview = arcadeMachineReducer(INITIAL_ARCADE_MACHINE_STATE, {
      type: 'open',
      machineId: MACHINE,
      gameId: GAME,
    });
    const countdown = arcadeMachineReducer(preview, { type: 'start', runId: 'run-1' });
    const play = arcadeMachineReducer(countdown, { type: 'countdown-complete' });
    const paused = arcadeMachineReducer(play, { type: 'pause' });
    const results = arcadeMachineReducer(play, { type: 'finish', result: result() });
    const claiming = arcadeMachineReducer(results, { type: 'claim' });
    const rewarded = arcadeMachineReducer(claiming, { type: 'claim-succeeded' });
    const aborted = arcadeMachineReducer(play, { type: 'abort', reason: 'interrupted' });
    return {
      closed: INITIAL_ARCADE_MACHINE_STATE,
      preview,
      countdown,
      playing: play,
      paused,
      results,
      claiming,
      rewarded,
      aborted,
    };
  };

  it('allows a claim from `results` and from no other state', () => {
    const states = statesByStatus();
    for (const [status, state] of Object.entries(states)) {
      expect(state.status, `${status} fixture`).toBe(status);
      expect(canClaim(state), `canClaim in ${status}`).toBe(status === 'results');
    }
  });

  it('leaves no claimable result after any interruption path', () => {
    const states = statesByStatus();

    // Every way a run can end WITHOUT finishing: an explicit abort, a pause that
    // is then abandoned, the shell being closed, and the tab being hidden or
    // blurred (both of which dispatch `pause`).
    const interruptions: ArcadeEvent[] = [
      { type: 'abort', reason: 'closed' },
      { type: 'abort', reason: 'quit' },
      { type: 'abort', reason: 'interrupted' },
      { type: 'abort', reason: 'error' },
      { type: 'pause' },
      { type: 'close' },
    ];

    for (const from of ['countdown', 'playing', 'paused'] as const) {
      for (const event of interruptions) {
        const after = arcadeMachineReducer(states[from], event);
        expect(canClaim(after), `${from} + ${event.type}`).toBe(false);
        expect(after.result, `${from} + ${event.type} result`).toBeNull();
      }
    }
  });

  it('cannot be talked into a reward from an interrupted run', () => {
    const states = statesByStatus();
    const aborted = states.aborted;

    // Dispatching the whole claim sequence at an aborted run changes nothing.
    const attempted = reduce(
      aborted,
      { type: 'claim' },
      { type: 'claim-succeeded' },
      { type: 'claim' },
      { type: 'claim-succeeded' },
    );
    expect(attempted.rewardedRunIds).toEqual([]);
    expect(attempted.status).toBe('aborted');
  });
});

describe('arcade lifecycle: the state is plain data', () => {
  it('stays JSON-serialisable through the whole lifecycle', () => {
    const states = [
      INITIAL_ARCADE_MACHINE_STATE,
      arcadeMachineReducer(INITIAL_ARCADE_MACHINE_STATE, {
        type: 'open',
        machineId: MACHINE,
        gameId: GAME,
      }),
      playing(),
      arcadeMachineReducer(playing(), { type: 'finish', result: result() }),
      reduce(
        arcadeMachineReducer(playing(), { type: 'finish', result: result() }),
        { type: 'claim' },
        { type: 'claim-succeeded' },
      ),
      arcadeMachineReducer(playing(), { type: 'abort', reason: 'closed' }),
    ];

    for (const state of states) {
      expect(isJsonSerialisable(state)).toBe(true);
    }
  });
});
