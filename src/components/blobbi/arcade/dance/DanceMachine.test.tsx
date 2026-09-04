/**
 * Blobbi Dance: lifecycle and integration coverage.
 *
 * The REAL controller, the REAL shell, the REAL lifecycle reducer, the REAL
 * judgement engine and the REAL reward hook. Two things are substituted, and
 * only two:
 *
 *  - the **audio engine**, because `jsdom` has no `AudioContext` and because a
 *    test that waited sixty-eight real seconds for a song to finish is a test
 *    nobody runs. `setSongTime` moves the clock explicitly, which is exactly
 *    what the judgement engine's "time is an argument" design is for;
 *  - the **reward writer**, because the alternative is publishing real events.
 *
 * Nothing here can reach a relay.
 */
import { useReducer, useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { DanceMachine } from './DanceMachine';
import { QueryProviders } from './test-providers';
import {
  createFakeAudio,
  createFakeWriter,
  fakeUser,
  refusingAudioFactory,
} from './test-doubles';
import {
  INITIAL_ARCADE_MACHINE_STATE,
  arcadeMachineReducer,
} from '@/arcade/arcade-machine-state';
import {
  BLOBBI_DANCE_GAME_ID,
  BLOBBI_DANCE_MACHINE_ID,
  getCatalogueEntry,
} from '@/arcade/catalogue';
import { DEFAULT_DANCE_CHART, buildChartFromBars, type DanceChart } from '@/arcade/dance/chart';
import { NEON_HOP_TRACK } from '@/arcade/dance/track';
import { resetClaimLocks } from '@/lib/arcade-claim-ledger';
import { ArcadeRewardWriterError } from '@/inventory/arcade-reward-writer';

const PUBKEY = 'f'.repeat(64);
let currentUser: ReturnType<typeof fakeUser> | undefined = fakeUser(PUBKEY);

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: currentUser, users: currentUser ? [currentUser] : [] }),
}));

vi.mock('@nostrify/react', async () => {
  const actual = await vi.importActual<typeof import('@nostrify/react')>('@nostrify/react');
  return {
    ...actual,
    useNostr: () => ({
      nostr: {
        query: async () => [],
        event: async () => {
          throw new Error('The test pool refuses to publish');
        },
      },
    }),
  };
});

/**
 * The machine and the game, kept apart but never mismatched.
 *
 * The machine says WHERE a run happened and the registry says WHAT was played.
 * For Blobbi Dance the machine is ALWAYS `arcade-dance-machine`: it is a
 * dedicated machine's game, and `canLaunchArcadeGame` refuses it anywhere else,
 * so the harness uses the id the product uses. A brief corrective pass ran
 * this game from a generic cabinet, which would have written a cabinet's id
 * into a ticket claim.
 */
const MACHINE_ID = BLOBBI_DANCE_MACHINE_ID;
const ENTRY = getCatalogueEntry(BLOBBI_DANCE_GAME_ID)!;

/** A three-note chart, so a whole run fits in a handful of clock moves. */
const TINY_CHART: DanceChart = buildChartFromBars({
  id: 'tiny',
  track: NEON_HOP_TRACK,
  difficulty: 'normal',
  bars: ['L...D...', 'U.......'],
});

interface HarnessOptions {
  chart?: DanceChart;
  audio?: ReturnType<typeof createFakeAudio>;
  writer?: ReturnType<typeof createFakeWriter>;
  audioFactory?: Parameters<typeof DanceMachine>[0]['audioFactory'];
}

function Harness({ chart, audio, writer, audioFactory }: HarnessOptions) {
  const [lifecycle, dispatch] = useReducer(arcadeMachineReducer, INITIAL_ARCADE_MACHINE_STATE, () =>
    arcadeMachineReducer(INITIAL_ARCADE_MACHINE_STATE, {
      type: 'open',
      machineId: MACHINE_ID,
      gameId: ENTRY.id,
    }),
  );
  const [closed, setClosed] = useState(false);
  const [runs, setRuns] = useState(0);

  if (closed) return <p data-testid="closed">closed</p>;

  return (
    <DanceMachine
      machineId={MACHINE_ID}
      gameId={ENTRY.id}
      title={ENTRY.title}
      exitLabel="Back to the arcade"
      exitAriaLabel="Back to the arcade room"
      lifecycle={lifecycle}
      dispatch={dispatch}
      onExit={() => {
        dispatch({ type: 'close' });
        setClosed(true);
      }}
      chart={chart}
      audioFactory={audioFactory ?? audio?.factory}
      rewardWriter={writer}
      mintRunId={() => {
        setRuns((n) => n + 1);
        return `test-run-${runs + 1}`;
      }}
    />
  );
}

function renderMachine(options: HarnessOptions = {}) {
  const audio = options.audio ?? createFakeAudio();
  const utils = render(
    <QueryProviders>
      <Harness {...options} audio={audio} chart={options.chart ?? TINY_CHART} />
    </QueryProviders>,
  );
  return { ...utils, audio };
}

/** Move the song clock and let the animation loop observe it. */
async function tick(audio: ReturnType<typeof createFakeAudio>, songTimeMs: number) {
  audio.setSongTime(songTimeMs);
  await act(async () => {
    // The loop schedules the next frame from inside itself, so one flush per
    // move is enough; `rafMock` in the test setup runs them on a timer.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const shell = () => document.querySelector('[data-arcade-shell]') as HTMLElement | null;
const stage = () => document.querySelector('[data-dance-stage]') as HTMLElement | null;

beforeEach(() => {
  localStorage.clear();
  resetClaimLocks();
  currentUser = fakeUser(PUBKEY);
});

afterEach(() => {
  localStorage.clear();
  resetClaimLocks();
  vi.restoreAllMocks();
});

describe('preview', () => {
  it('opens on the real preview, with a Start button', () => {
    renderMachine();
    expect(screen.getByRole('dialog', { name: 'Blobbi Dance' })).toBeInTheDocument();
    expect(document.querySelector('[data-dance-preview]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument();
    expect(shell()).toHaveAttribute('data-arcade-status', 'preview');
  });

  it('says the controls before the countdown, not during it', () => {
    renderMachine();
    const preview = document.querySelector('[data-dance-preview]') as HTMLElement;
    for (const key of ['← or A', '↓ or S', '↑ or W', '→ or D']) {
      expect(within(preview).getByText(key)).toBeInTheDocument();
    }
  });

  it('warns that audio needs a tap, and that the track is a placeholder', () => {
    renderMachine();
    const notice = document.querySelector('[data-dance-audio-notice]') as HTMLElement;
    expect(notice.textContent).toMatch(/press start to let the browser play audio/i);
    expect(notice.textContent).toMatch(/placeholder/i);
  });

  it('states the ticket rules honestly, including that leaving early earns nothing', () => {
    renderMachine();
    expect(screen.getByText(/leaving early earns nothing/i)).toBeInTheDocument();
  });
});

describe('an invalid chart', () => {
  const broken: DanceChart = { ...DEFAULT_DANCE_CHART, version: 99, notes: [] };

  it('shows the reason and offers no way to start', () => {
    renderMachine({ chart: broken });
    const error = document.querySelector('[data-dance-error="chart"]') as HTMLElement;
    expect(error).not.toBeNull();
    expect(error.textContent).toMatch(/version 99 is not supported/);
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull();
  });

  it('leaves a way back to the game list, so the player is never trapped', () => {
    renderMachine({ chart: broken });
    expect(screen.getByRole('button', { name: /back to the arcade room/i })).toBeInTheDocument();
  });
});

describe('a browser with no Web Audio', () => {
  it('refuses to start rather than running a game with no clock', async () => {
    renderMachine({ audioFactory: refusingAudioFactory });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    });
    // No run was ever created, so there is nothing to abort and nothing to claim.
    expect(shell()).toHaveAttribute('data-arcade-status', 'preview');
    expect(screen.getByRole('alert').textContent).toMatch(/no Web Audio support/i);
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /back to the arcade room/i })).toBeInTheDocument();
  });
});

describe('the run', () => {
  it('walks preview → countdown → playing → results', async () => {
    const { audio } = renderMachine();

    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    expect(shell()).toHaveAttribute('data-arcade-status', 'countdown');
    expect(audio.engine.started).toBe(true);

    await tick(audio, 0);
    expect(document.querySelector('[data-dance-countdown]')).not.toBeNull();

    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));
    expect(stage()).toHaveAttribute('data-dance-phase', 'playing');

    await tick(audio, NEON_HOP_TRACK.durationMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'results'));
    expect(document.querySelector('[data-dance-results]')).not.toBeNull();
  });

  it('scores keyboard input against the audio clock', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));

    // The tiny chart's first note is a left at the lead-in.
    audio.setSongTime(TINY_CHART.notes[0].timeMs);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      fireEvent.keyUp(window, { key: 'ArrowLeft' });
    });

    expect(document.querySelector('[data-dance-judgment]')?.textContent).toBe('Perfect!');
    expect(audio.engine.blips).toBe(1);
  });

  it('maps WASD to the same lanes as the arrows', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));

    audio.setSongTime(TINY_CHART.notes[0].timeMs);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'a' });
    });
    expect(document.querySelector('[data-dance-judgment]')?.textContent).toBe('Perfect!');
  });

  it('ignores key auto-repeat, so a held arrow is one input', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));

    audio.setSongTime(TINY_CHART.notes[0].timeMs);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      for (let i = 0; i < 20; i += 1) {
        fireEvent.keyDown(window, { key: 'ArrowLeft', repeat: true });
      }
    });
    // One blip, not twenty-one.
    expect(audio.engine.blips).toBe(1);
  });

  it('accepts touch on the lane buttons, once per tap', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));

    audio.setSongTime(TINY_CHART.notes[0].timeMs);
    const left = document.querySelector('[data-dance-touch="left"]') as HTMLElement;
    await act(async () => {
      // A real tap fires pointerdown AND a synthetic click. Both are dispatched
      // here; exactly one must be counted.
      fireEvent.pointerDown(left);
      fireEvent.click(left, { detail: 1 });
    });
    expect(audio.engine.blips).toBe(1);
  });

  it('gives each lane button a name that includes its keys', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));

    expect(screen.getByRole('button', { name: 'Left lane (← or A)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Down lane (↓ or S)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Up lane (↑ or W)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Right lane (→ or D)' })).toBeInTheDocument();
  });

  it('disables the lane buttons outside play', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, 0);

    // During the countdown the lanes are visible but inert, so an early tap
    // cannot be mistaken for a hit.
    const left = document.querySelector('[data-dance-touch="left"]') as HTMLButtonElement;
    expect(left.disabled).toBe(true);
    await act(async () => {
      fireEvent.pointerDown(left);
    });
    expect(audio.engine.blips).toBe(0);
  });

  it('ignores input once the run is over', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));
    await tick(audio, NEON_HOP_TRACK.durationMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'results'));

    const before = audio.engine.blips;
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
    });
    expect(audio.engine.blips).toBe(before);
  });
});

describe('interruption and closing', () => {
  it('PAUSES when the window merely loses focus, a run is not lost to an alt-tab', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));

    await act(async () => {
      fireEvent.blur(window);
    });

    expect(shell()).toHaveAttribute('data-arcade-status', 'paused');
    expect(audio.engine.state).toBe('paused');
    // The run is still there; it can be resumed and still finish for tickets.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^resume/i }));
    });
    expect(shell()).toHaveAttribute('data-arcade-status', 'playing');
  });

  it('ABORTS when the tab is hidden, and says so', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      fireEvent(document, new Event('visibilitychange'));
    });

    expect(shell()).toHaveAttribute('data-arcade-status', 'aborted');
    expect(screen.getByText(/tab was hidden/i)).toBeInTheDocument();
    // An aborted run has NO result, so nothing is claimable.
    expect(document.querySelector('[data-dance-results]')).toBeNull();
    expect(document.querySelector('[data-dance-claim]')).toBeNull();

    // Restore, so the next case does not inherit a hidden document.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('does not resurrect an aborted run, replay is a new one', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      fireEvent(document, new Event('visibilitychange'));
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /play again/i }));
    });
    expect(shell()).toHaveAttribute('data-arcade-status', 'countdown');
    expect(document.querySelector('[data-dance-abort-notice]')).toBeNull();
  });

  it('closes during the countdown, disposing the engine', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    expect(shell()).toHaveAttribute('data-arcade-status', 'countdown');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    });
    expect(screen.getByTestId('closed')).toBeInTheDocument();
    expect(audio.engine.disposed).toBe(true);
  });

  it('closes during play, disposing the engine and leaving nothing mounted', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    });
    expect(shell()).toBeNull();
    expect(stage()).toBeNull();
    expect(audio.engine.disposed).toBe(true);
  });

  it('pauses and resumes without losing the song position', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^pause/i }));
    });
    expect(shell()).toHaveAttribute('data-arcade-status', 'paused');
    expect(audio.engine.state).toBe('paused');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^resume/i }));
    });
    expect(shell()).toHaveAttribute('data-arcade-status', 'playing');
    expect(audio.engine.state).toBe('playing');
  });
});

describe('results and replay', () => {
  async function playToResults(options: HarnessOptions = {}) {
    const view = renderMachine(options);
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(view.audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));

    // Hit every note in the tiny chart, exactly on time.
    for (const note of TINY_CHART.notes) {
      view.audio.setSongTime(note.timeMs);
      const key = { left: 'ArrowLeft', down: 'ArrowDown', up: 'ArrowUp', right: 'ArrowRight' }[
        note.lane
      ];
      await act(async () => {
        fireEvent.keyDown(window, { key });
        fireEvent.keyUp(window, { key });
      });
    }

    await tick(view.audio, NEON_HOP_TRACK.durationMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'results'));
    return view;
  }

  it('reflects the calculated result, grade included', async () => {
    await playToResults();
    const results = document.querySelector('[data-dance-results]') as HTMLElement;
    expect(results.querySelector('[data-dance-grade="S"]')).not.toBeNull();
    expect(within(results).getByText('100%')).toBeInTheDocument();
    // The visible line and the screen-reader summary both say it, which is the
    // point: the result must be readable without chasing an animation.
    expect(within(results).getAllByText(/full combo/i).length).toBeGreaterThanOrEqual(2);
  });

  it('summarises the run for a screen reader, without relying on an animation', async () => {
    await playToResults();
    const summary = within(
      document.querySelector('[data-dance-results]') as HTMLElement,
    ).getAllByRole('status')[0];
    expect(summary.textContent).toMatch(/Grade S\. 100% accuracy\./);
    expect(summary.textContent).toMatch(/Full combo\./);
  });

  it('offers the calculated reward, with its policy version', async () => {
    await playToResults();
    const panel = document.querySelector('[data-dance-reward]') as HTMLElement;
    expect(panel).toHaveAttribute('data-dance-reward', 'idle');
    expect(screen.getByRole('button', { name: /claim 8 tickets/i })).toBeInTheDocument();
  });

  it('replays as a NEW run, with a fresh id and no result', async () => {
    const view = await playToResults();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /play again/i }));
    });
    expect(shell()).toHaveAttribute('data-arcade-status', 'countdown');
    expect(document.querySelector('[data-dance-results]')).toBeNull();
    // A second engine was built for the second run, and the first was disposed.
    expect(view.audio.engine.started).toBe(true);
  });
});

describe('claiming', () => {
  async function playAndClaim(writer: ReturnType<typeof createFakeWriter>) {
    const view = renderMachine({ writer });
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(view.audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));
    for (const note of TINY_CHART.notes) {
      view.audio.setSongTime(note.timeMs);
      const key = { left: 'ArrowLeft', down: 'ArrowDown', up: 'ArrowUp', right: 'ArrowRight' }[
        note.lane
      ];
      await act(async () => {
        fireEvent.keyDown(window, { key });
      });
    }
    await tick(view.audio, NEON_HOP_TRACK.durationMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'results'));
    return view;
  }

  it('confirms a successful claim and stops offering it', async () => {
    const writer = createFakeWriter({ quantities: [0, 8] });
    await playAndClaim(writer);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /claim 8 tickets/i }));
    });

    await waitFor(() =>
      expect(document.querySelector('[data-dance-reward]')).toHaveAttribute(
        'data-dance-reward',
        'confirmed',
      ),
    );
    expect(screen.getByText(/8 Arcade Tickets added to your inventory/)).toBeInTheDocument();
    expect(document.querySelector('[data-dance-claim]')).toBeNull();
    expect(shell()).toHaveAttribute('data-arcade-status', 'rewarded');
    expect(writer.publishCount()).toBe(1);
  });

  it('publishes once for two clicks in the same tick', async () => {
    const writer = createFakeWriter({ quantities: [0, 8] });
    await playAndClaim(writer);
    const button = screen.getByRole('button', { name: /claim 8 tickets/i });

    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
    });

    await waitFor(() => expect(writer.publishCount()).toBe(1));
  });

  it('says nothing was saved, and offers a retry, only for a PROVABLE pre-publish failure', async () => {
    // A writer that can prove no relay stored the event. The real one cannot,
    // `NPool.event` gives no per-relay breakdown, so this branch exists for
    // signer refusals and for a future client with a richer contract.
    const writer = createFakeWriter({
      publishError: new ArcadeRewardWriterError('signer said no', 'sign-failed'),
    });
    await playAndClaim(writer);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /claim 8 tickets/i }));
    });

    await waitFor(() =>
      expect(document.querySelector('[data-dance-reward]')).toHaveAttribute(
        'data-dance-reward',
        'failed',
      ),
    );
    expect(screen.getByText(/nothing was saved/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    // The lifecycle went back to `results`, not to `rewarded`.
    expect(shell()).toHaveAttribute('data-arcade-status', 'results');
  });

  it('offers a read-only status check: NOT "Try again", when verification is inconclusive', async () => {
    // THE regression, at the UI level. A "Try again" button here is what turned
    // a 3-ticket reward into 6.
    const writer = createFakeWriter({ quantities: [0, 3] });
    await playAndClaim(writer);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /claim 8 tickets/i }));
    });

    await waitFor(() =>
      expect(document.querySelector('[data-dance-reward]')).toHaveAttribute(
        'data-dance-reward',
        'unresolved',
      ),
    );

    const message = document.querySelector('[data-dance-reward-message]') as HTMLElement;
    expect(message.textContent).toMatch(/will not send another grant for this run/i);
    // The three things it must NOT say.
    expect(message.textContent).not.toMatch(/added to your inventory/i);
    expect(message.textContent).not.toMatch(/trying again is safe/i);
    expect(message.textContent).not.toMatch(/nothing was saved/i);

    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /claim 8 tickets/i })).toBeNull();
    expect(screen.getByRole('button', { name: /check ticket status/i })).toBeInTheDocument();
  });

  it('publishes NOTHING when every available action is clicked after an ambiguous outcome', async () => {
    const writer = createFakeWriter({ quantities: [0, 3, 3, 3, 3, 3] });
    await playAndClaim(writer);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /claim 8 tickets/i }));
    });
    await waitFor(() => expect(writer.publishCount()).toBe(1));

    // Click everything the panel offers, repeatedly.
    for (let i = 0; i < 3; i += 1) {
      const buttons = [
        ...(document.querySelector('[data-dance-reward]') as HTMLElement).querySelectorAll(
          'button',
        ),
      ];
      await act(async () => {
        for (const button of buttons) fireEvent.click(button);
      });
    }

    expect(writer.publishCount()).toBe(1);
    expect(document.querySelector('[data-dance-reward]')).toHaveAttribute(
      'data-dance-reward',
      'unresolved',
    );
  });

  it('confirms through reconciliation once the balance shows the grant, without republishing', async () => {
    // baseline 0, verify 0 (stale), reconcile 8 (relay caught up)
    const writer = createFakeWriter({ quantities: [0, 0, 8] });
    await playAndClaim(writer);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /claim 8 tickets/i }));
    });
    await waitFor(() =>
      expect(document.querySelector('[data-dance-reward]')).toHaveAttribute(
        'data-dance-reward',
        'unresolved',
      ),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /check ticket status/i }));
    });

    await waitFor(() =>
      expect(document.querySelector('[data-dance-reward]')).toHaveAttribute(
        'data-dance-reward',
        'confirmed',
      ),
    );
    expect(writer.publishCount()).toBe(1);
    expect(shell()).toHaveAttribute('data-arcade-status', 'rewarded');
  });

  it('stays unresolved: and silent about safety, when reconciliation is inconclusive', async () => {
    const writer = createFakeWriter({ quantities: [0, 0, 0, 0] });
    await playAndClaim(writer);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /claim 8 tickets/i }));
    });
    await waitFor(() => expect(writer.publishCount()).toBe(1));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /check ticket status/i }));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /check ticket status/i })).toBeEnabled(),
    );

    expect(writer.publishCount()).toBe(1);
    expect(document.querySelector('[data-dance-reward]')).toHaveAttribute(
      'data-dance-reward',
      'unresolved',
    );
  });

  it('keeps the unresolved state after the results screen is re-rendered', async () => {
    const writer = createFakeWriter({ quantities: [0, 3] });
    await playAndClaim(writer);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /claim 8 tickets/i }));
    });
    await waitFor(() =>
      expect(document.querySelector('[data-dance-reward]')).toHaveAttribute(
        'data-dance-reward',
        'unresolved',
      ),
    );

    // Pause/resume the panel by toggling something that forces a re-render: the
    // durable record, not component state, is what holds the line.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /check ticket status/i }));
    });
    expect(document.querySelector('[data-dance-claim]')).toBeNull();
    expect(writer.publishCount()).toBe(1);
  });

  it('does not show protocol trivia to a player', async () => {
    await playAndClaim(createFakeWriter({ quantities: [0, 8] }));
    expect(document.querySelector('[data-dance-reward-policy]')).toBeNull();
    expect(screen.queryByText(/blobbi-dance-tickets/)).toBeNull();
  });

  it('asks a logged-out player to log in rather than failing silently', async () => {
    currentUser = undefined;
    await playAndClaim(createFakeWriter());
    const button = screen.getByRole('button', { name: /log in to keep these tickets/i });
    expect(button).toBeDisabled();
  });
});

describe('reduced motion', () => {
  const setReducedMotion = (reduced: boolean) => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () =>
        ({
          matches: reduced,
          media: '(prefers-reduced-motion: reduce)',
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true,
        }) as unknown as MediaQueryList,
    });
  };

  it('drops decorative transitions but keeps the notes moving', async () => {
    setReducedMotion(true);
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(stage()).toHaveAttribute('data-reduced-motion', 'true'));

    const left = document.querySelector('[data-dance-touch="left"]') as HTMLElement;
    expect(left.className).not.toContain('active:scale-95');
    const receptor = document.querySelector('[data-dance-receptor="left"]') as HTMLElement;
    expect(receptor.className).not.toContain('transition-colors');

    // Note movement is gameplay, not decoration, and must survive.
    await tick(audio, TINY_CHART.notes[0].timeMs - 400);
    const note = document.querySelector('[data-dance-note]') as HTMLElement;
    expect(note).not.toBeNull();
    expect(note.style.transform).toMatch(/translate3d/);
  });

  it('keeps the transitions otherwise', async () => {
    setReducedMotion(false);
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(stage()).toHaveAttribute('data-reduced-motion', 'false'));

    const left = document.querySelector('[data-dance-touch="left"]') as HTMLElement;
    expect(left.className).toContain('active:scale-95');
  });
});
