/**
 * Air Hockey — lifecycle and integration coverage.
 *
 * The REAL controller, the REAL shell, the REAL lifecycle reducer, the REAL
 * simulation and the REAL fixed-step loop. Three things are substituted, and
 * only three:
 *
 *  - **`requestAnimationFrame` and the clock**, so a match is driven by hand
 *    rather than by waiting for real frames. This is not a shortcut around the
 *    loop — the loop under test is the shipping one, and it is what turns those
 *    driven frames into fixed simulation steps.
 *  - **the audio engine**, because jsdom has no `AudioContext`.
 *  - **the 2D canvas context**, which jsdom does not implement. The picture is
 *    the only thing lost: the simulation, the HUD and every control still work,
 *    which is itself worth knowing.
 *
 * The match played here is a real one — first to one goal, played out by the
 * real opponent against a stationary player mallet. Nothing about the result is
 * forged.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useReducer, useState } from 'react';
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import {
  INITIAL_ARCADE_MACHINE_STATE,
  arcadeMachineReducer,
} from '@/arcade/arcade-machine-state';
import {
  ARCADE_AIR_HOCKEY_MACHINE_ID,
  BLOBBI_AIR_HOCKEY_GAME_ID,
  getCatalogueEntry,
} from '@/arcade/catalogue';
import { createHockeyMatch } from '@/arcade/hockey/match';
import type { HockeyAudioEngine } from '@/arcade/hockey/hockey-audio';
import { resetClaimLocks } from '@/lib/arcade-claim-ledger';

import { QueryProviders } from '../test-providers';
import { createFakeWriter, fakeUser } from '../test-doubles';
import { AirHockeyMachine } from './AirHockeyMachine';

const MACHINE_ID = ARCADE_AIR_HOCKEY_MACHINE_ID;
const ENTRY = getCatalogueEntry(BLOBBI_AIR_HOCKEY_GAME_ID)!;

// ── Reward-path mocks, mirroring `DanceMachine.test.tsx` ────────────────────
// The machine now carries the shared claim wiring, whose hook needs a user and
// a Nostr pool. Both are faked at the module level; the writer is injected, so
// nothing in this file can reach a relay.

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

// ── Doubles ─────────────────────────────────────────────────────────────────

function fakeAudio(): HockeyAudioEngine & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    hit: () => calls.push('hit'),
    wall: () => calls.push('wall'),
    goal: () => calls.push('goal'),
    fanfare: () => calls.push('fanfare'),
    setMuted: () => calls.push('setMuted'),
    muted: false,
    dispose: () => calls.push('dispose'),
  };
}

let frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let clock = 0;

function installFrameDriver() {
  frames = new Map();
  nextFrameId = 1;
  clock = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
}

/** Advance the clock and run every queued frame. */
function tick(ms = 250) {
  clock += ms;
  const due = [...frames.values()];
  frames.clear();
  act(() => {
    for (const cb of due) cb(clock);
  });
}

/** Drive frames until `done()` or the budget runs out. */
function advanceUntil(done: () => boolean, maxFrames = 400): boolean {
  for (let i = 0; i < maxFrames; i += 1) {
    if (done()) return true;
    if (frames.size === 0) return done();
    tick();
  }
  return done();
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface HarnessProps {
  /** Goals to win. One, so a whole match fits in a handful of driven frames. */
  targetGoals?: number;
  audio?: HockeyAudioEngine;
  onClosed?: () => void;
  /** Force the whole-screen presentation, as a handheld would get. */
  expanded?: boolean;
  /** Fake reward writer, for the claim tests. Unset means the claim is never pressed. */
  writer?: ReturnType<typeof createFakeWriter>;
}

/**
 * The query client lives OUTSIDE the stateful harness: `QueryProviders` builds
 * a fresh client per render, and the inner component is the one that re-renders
 * on every dispatch.
 */
function Harness(props: HarnessProps) {
  return (
    <QueryProviders>
      <HarnessInner {...props} />
    </QueryProviders>
  );
}

function HarnessInner({ targetGoals = 1, audio, onClosed, expanded, writer }: HarnessProps) {
  const [lifecycle, dispatch] = useReducer(
    arcadeMachineReducer,
    INITIAL_ARCADE_MACHINE_STATE,
    () =>
      arcadeMachineReducer(INITIAL_ARCADE_MACHINE_STATE, {
        type: 'open',
        machineId: MACHINE_ID,
        gameId: ENTRY.id,
      }),
  );
  const [closed, setClosed] = useState(false);

  if (closed) return <p data-testid="closed">closed</p>;

  return (
    <AirHockeyMachine
      machineId={MACHINE_ID}
      gameId={ENTRY.id}
      title={ENTRY.title}
      exitLabel="Back to the arcade"
      exitAriaLabel="Back to the arcade room"
      lifecycle={lifecycle}
      dispatch={dispatch}
      targetGoals={targetGoals}
      rewardWriter={writer}
      audioFactory={() => audio ?? fakeAudio()}
      createMatchState={() =>
        createHockeyMatch({ difficulty: 'normal', targetGoals, seed: 12_345 })
      }
      now={() => 1_700_000_000_000 + clock}
      forceExpanded={expanded}
      onExit={() => {
        dispatch({ type: 'close' });
        setClosed(true);
        onClosed?.();
      }}
    />
  );
}

const shell = () => document.querySelector<HTMLElement>('[data-arcade-shell]');
const stage = () => document.querySelector<HTMLElement>('[data-hockey-stage]');
const orientation = () => stage()?.dataset.hockeyOrientation;
const orientationToggle = () =>
  document.querySelector<HTMLElement>('[data-hockey-orientation-toggle]');
const status = () => shell()?.getAttribute('data-arcade-status');
const table = () => document.querySelector<HTMLElement>('[data-hockey-table]');
const results = () => document.querySelector<HTMLElement>('[data-hockey-results]');
const outcome = () =>
  document.querySelector('[data-hockey-outcome]')?.getAttribute('data-hockey-outcome') ?? null;
const startButton = () => screen.getByRole('button', { name: /^start$/i });

function startMatch() {
  fireEvent.click(startButton());
}

/** Play until the results panel is on screen. */
function playToResults(): boolean {
  return advanceUntil(() => results() !== null);
}

let getContextSpy: ReturnType<typeof vi.spyOn>;
let nowSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  resetClaimLocks();
  currentUser = fakeUser(PUBKEY);
  installFrameDriver();
  // The loop's clock. Stubbing `requestAnimationFrame` alone is not enough:
  // the loop measures elapsed time with `performance.now()`, so without this
  // every driven frame reports a delta of zero and the simulation never moves.
  nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  // jsdom has no 2D context and logs a "not implemented" error if asked for
  // one. Returning null is the same answer, quietly — and it exercises the
  // component's own null-context path.
  getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(null);
});

afterEach(() => {
  localStorage.clear();
  resetClaimLocks();
  getContextSpy.mockRestore();
  nowSpy.mockRestore();
  vi.unstubAllGlobals();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('before the match', () => {
  it('shows the start panel, not a table', () => {
    render(<Harness />);
    expect(status()).toBe('preview');
    expect(document.querySelector('[data-hockey-preview]')).toBeInTheDocument();
    expect(table()).toBeNull();
  });

  it('offers a difficulty and defaults to Normal', () => {
    render(<Harness />);
    const normal = screen.getByRole('radio', { name: /normal/i });
    expect(normal).toBeChecked();
    expect(screen.getByRole('radio', { name: /easy/i })).not.toBeChecked();
  });

  it('lets the difficulty be changed before starting', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: /easy/i }));
    expect(screen.getByRole('radio', { name: /easy/i })).toBeChecked();
    expect(within(shell()!).getByText(/easy opponent/i)).toBeInTheDocument();
  });

  it('says how tickets are earned, and offers no claim before a match exists', () => {
    render(<Harness />);
    expect(document.querySelector('[data-hockey-ticket-notice]')?.textContent).toMatch(
      /finishing a match earns tickets/i,
    );
    expect(within(shell()!).queryByRole('button', { name: /claim/i })).toBeNull();
  });

  it('names the win condition', () => {
    render(<Harness targetGoals={7} />);
    expect(within(shell()!).getAllByText(/first to 7/i).length).toBeGreaterThan(0);
  });
});

describe('starting a match', () => {
  it('opens the table with the score at nil-nil', () => {
    render(<Harness />);
    startMatch();

    expect(status()).toBe('countdown');
    expect(table()).toBeInTheDocument();
    expect(document.querySelector('[data-hockey-player-score]')?.textContent).toBe('0');
    expect(document.querySelector('[data-hockey-opponent-score]')?.textContent).toBe('0');
  });

  it('counts down before the puck moves', () => {
    render(<Harness />);
    startMatch();
    tick(16);
    expect(document.querySelector('[data-hockey-countdown]')).toBeInTheDocument();
  });

  it('reaches live play, and the lifecycle follows', () => {
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    expect(status()).toBe('playing');
    expect(document.querySelector('[data-hockey-countdown]')).toBeNull();
  });

  it('replaces the start button while a match is running', () => {
    render(<Harness />);
    startMatch();
    expect(within(shell()!).queryByRole('button', { name: /^start$/i })).toBeNull();
    expect(within(shell()!).getByRole('button', { name: /pause/i })).toBeInTheDocument();
  });
});

describe('finishing a match', () => {
  it('plays a real match through to a result', () => {
    render(<Harness />);
    startMatch();
    expect(playToResults()).toBe(true);

    expect(status()).toBe('results');
    expect(table()).toBeNull();
    // A first-to-one match: somebody scored exactly one goal.
    const panel = results()!;
    expect(panel.textContent).toMatch(/you win|rival wins/i);
    expect(outcome()).toMatch(/^(win|loss)$/);
  });

  it('states the outcome in words, not only in colour', () => {
    render(<Harness />);
    startMatch();
    playToResults();

    const word = outcome() === 'win' ? /you win/i : /rival wins/i;
    expect(within(results()!).getByRole('heading', { name: word })).toBeInTheDocument();
    // Both scores stay labelled on the result screen too.
    expect(results()!.textContent).toMatch(/you/i);
    expect(results()!.textContent).toMatch(/rival/i);
  });

  it('makes a sound for the goal and for the end of the match', () => {
    const audio = fakeAudio();
    render(<Harness audio={audio} />);
    startMatch();
    playToResults();

    expect(audio.calls).toContain('goal');
    expect(audio.calls).toContain('fanfare');
  });

  it('stops the loop once the match is decided', () => {
    render(<Harness />);
    startMatch();
    playToResults();

    // The table unmounted with the run, so nothing is left scheduled.
    tick();
    expect(frames.size).toBe(0);
  });

  it('offers the calculated ticket reward on the results screen', () => {
    render(<Harness />);
    startMatch();
    playToResults();

    const panel = document.querySelector('[data-hockey-reward]');
    expect(panel).toHaveAttribute('data-hockey-reward', 'idle');
    // First-to-one on the fixed seed is deterministic; whatever the outcome, a
    // completed match offers a positive integer claim.
    expect(
      within(results()!).getByRole('button', { name: /claim \d+ tickets/i }),
    ).toBeInTheDocument();
  });
});

describe('claiming tickets', () => {
  function playAndShowResults(writer: ReturnType<typeof createFakeWriter>) {
    render(<Harness writer={writer} />);
    startMatch();
    expect(playToResults()).toBe(true);
  }

  it('confirms a successful claim, advances the lifecycle, and stops offering it', async () => {
    const writer = createFakeWriter();
    playAndShowResults(writer);

    await act(async () => {
      fireEvent.click(within(results()!).getByRole('button', { name: /claim \d+ tickets/i }));
    });

    await waitFor(() =>
      expect(document.querySelector('[data-hockey-reward]')).toHaveAttribute(
        'data-hockey-reward',
        'confirmed',
      ),
    );
    expect(screen.getByText(/added to your inventory/i)).toBeInTheDocument();
    expect(within(results()!).queryByRole('button', { name: /claim \d+ tickets/i })).toBeNull();
    expect(status()).toBe('rewarded');
    expect(writer.publishCount()).toBe(1);
  });

  it('publishes once for repeated clicks in the same tick', async () => {
    const writer = createFakeWriter();
    playAndShowResults(writer);
    const button = within(results()!).getByRole('button', { name: /claim \d+ tickets/i });

    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
    });

    await waitFor(() => expect(writer.publishCount()).toBe(1));
  });

  it('keeps Play again available after a confirmed claim, and the new run claims afresh', async () => {
    const writer = createFakeWriter();
    playAndShowResults(writer);

    await act(async () => {
      fireEvent.click(within(results()!).getByRole('button', { name: /claim \d+ tickets/i }));
    });
    await waitFor(() => expect(status()).toBe('rewarded'));

    fireEvent.click(screen.getByRole('button', { name: /play again/i }));
    expect(playToResults()).toBe(true);

    // A replay is a NEW run with a new id: a fresh claim is on offer.
    expect(document.querySelector('[data-hockey-reward]')).toHaveAttribute(
      'data-hockey-reward',
      'idle',
    );
    await act(async () => {
      fireEvent.click(within(results()!).getByRole('button', { name: /claim \d+ tickets/i }));
    });
    await waitFor(() => expect(writer.publishCount()).toBe(2));
  });

  it('asks a logged-out player to log in rather than failing silently', () => {
    currentUser = undefined;
    playAndShowResults(createFakeWriter());
    const button = within(results()!).getByRole('button', {
      name: /log in to keep these tickets/i,
    });
    expect(button).toBeDisabled();
  });
});

describe('restarting', () => {
  it('starts a brand new match from the results', () => {
    render(<Harness />);
    startMatch();
    playToResults();

    fireEvent.click(screen.getByRole('button', { name: /play again/i }));

    expect(status()).toBe('countdown');
    expect(results()).toBeNull();
    expect(table()).toBeInTheDocument();
    expect(document.querySelector('[data-hockey-player-score]')?.textContent).toBe('0');
    expect(document.querySelector('[data-hockey-opponent-score]')?.textContent).toBe('0');
  });

  it('can be played through a second time', () => {
    render(<Harness />);
    startMatch();
    playToResults();
    fireEvent.click(screen.getByRole('button', { name: /play again/i }));

    expect(playToResults()).toBe(true);
    expect(status()).toBe('results');
  });
});

describe('pausing', () => {
  it('freezes the match and offers to resume', () => {
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');

    fireEvent.click(within(shell()!).getByRole('button', { name: /pause/i }));
    expect(status()).toBe('paused');
    expect(document.querySelector('[data-hockey-paused]')).toBeInTheDocument();

    // Nothing advances while paused, however many frames go by.
    tick(5_000);
    expect(status()).toBe('paused');

    fireEvent.click(within(shell()!).getByRole('button', { name: /resume/i }));
    expect(status()).toBe('playing');
    expect(document.querySelector('[data-hockey-paused]')).toBeNull();
  });

  it('pauses when the tab is hidden, rather than throwing the match away', () => {
    // The opposite of Blobbi Dance, and deliberately: this game's clock is its
    // own loop, so hiding the tab stops the match rather than desynchronising
    // it. Losing a three-minute match to an OS dialog would be hostile.
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');

    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    if (original) Object.defineProperty(Document.prototype, 'visibilityState', original);

    expect(status()).toBe('paused');
    expect(document.querySelector('[data-hockey-results]')).toBeNull();
  });

  it('does not resume a paused match by itself', () => {
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    fireEvent.click(within(shell()!).getByRole('button', { name: /pause/i }));

    advanceUntil(() => false, 20);
    expect(status()).toBe('paused');
  });
});

describe('leaving', () => {
  it('closes cleanly mid-match and leaves nothing running', () => {
    const audio = fakeAudio();
    render(<Harness audio={audio} />);
    startMatch();
    advanceUntil(() => status() === 'playing');

    fireEvent.click(screen.getByRole('button', { name: /leave air hockey/i }));

    expect(screen.getByTestId('closed')).toBeInTheDocument();
    expect(shell()).toBeNull();
    expect(table()).toBeNull();
    // The controller built the engine, so the controller released it.
    expect(audio.calls).toContain('dispose');

    // No frame survives the close.
    tick();
    tick();
    expect(frames.size).toBe(0);
  });

  it('says where the dismiss control goes, and changes it mid-match', () => {
    render(<Harness />);
    expect(
      screen.getByRole('button', { name: /back to the arcade room/i }),
    ).toBeInTheDocument();

    startMatch();
    expect(
      screen.getByRole('button', { name: /leave air hockey and end this match/i }),
    ).toBeInTheDocument();
  });

  it('reopens from a clean start panel', () => {
    // The shell unmounts its children on close, so a reopened machine cannot
    // inherit a score, a paused match or a live loop from the last one.
    const view = render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    fireEvent.click(screen.getByRole('button', { name: /leave air hockey/i }));
    view.unmount();

    render(<Harness />);
    expect(status()).toBe('preview');
    expect(document.querySelector('[data-hockey-preview]')).toBeInTheDocument();
    expect(results()).toBeNull();
    expect(table()).toBeNull();
    expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('gives the playfield a name and keyboard focus', () => {
    render(<Harness />);
    startMatch();
    const field = table()!;
    expect(field).toHaveAttribute('tabindex', '0');
    expect(field.getAttribute('aria-label')).toMatch(/mallet/i);
  });

  it('keeps both scores readable as text, with labels', () => {
    render(<Harness />);
    startMatch();
    const scoreboard = document.querySelector('[data-hockey-scoreboard]')!;
    expect(scoreboard.textContent).toMatch(/you/i);
    expect(scoreboard.textContent).toMatch(/rival/i);
  });

  it('announces the state of play in a live region', () => {
    render(<Harness />);
    startMatch();
    const live = document.querySelector('[data-hockey-stage] [aria-live]');
    expect(live).toBeInTheDocument();
    expect(live?.textContent).toMatch(/get ready/i);
  });

  it('offers a mute toggle that reports its own state', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: /mute the sound/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /mute the sound/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});


// ── Presentation ────────────────────────────────────────────────────────────

describe('table layout', () => {
  it('offers a layout switch with an accessible name that describes the ACTION', () => {
    // "Wide"/"Tall" on the face says which layout is in force; the name says
    // what pressing it does. A name matching the visible word would announce
    // the state twice and the action never.
    render(<Harness />);
    startMatch();

    const toggle = orientationToggle()!;
    expect(toggle).toBeInTheDocument();
    expect(toggle.getAttribute('aria-label')).toMatch(/lay the table out (tall|wide)/i);
    // And the visible label is a word, not only a shape.
    expect(toggle.textContent).toMatch(/wide|tall/i);
  });

  it('switches layout without disturbing the match', () => {
    // The one thing a presentation control must never do. Score, phase and the
    // run itself all belong to the lifecycle, not to the layout.
    render(<Harness targetGoals={7} />);
    startMatch();
    advanceUntil(() => status() === 'playing');

    const before = {
      status: status(),
      player: document.querySelector('[data-hockey-player-score]')?.textContent,
      rival: document.querySelector('[data-hockey-opponent-score]')?.textContent,
      phase: stage()?.dataset.hockeyPhase,
    };
    const wasLandscape = orientation() === 'landscape';

    fireEvent.click(orientationToggle()!);

    expect(orientation()).toBe(wasLandscape ? 'portrait' : 'landscape');
    expect(status()).toBe(before.status);
    expect(stage()?.dataset.hockeyPhase).toBe(before.phase);
    expect(document.querySelector('[data-hockey-player-score]')?.textContent).toBe(before.player);
    expect(document.querySelector('[data-hockey-opponent-score]')?.textContent).toBe(before.rival);
  });

  it('keeps exactly one game loop across a layout switch', () => {
    // A presentation change that re-bound the loop would run the simulation at
    // double speed, silently.
    render(<Harness targetGoals={7} />);
    startMatch();
    advanceUntil(() => status() === 'playing');

    expect(frames.size).toBe(1);
    fireEvent.click(orientationToggle()!);
    tick(16);
    expect(frames.size).toBe(1);
    fireEvent.click(orientationToggle()!);
    tick(16);
    expect(frames.size).toBe(1);
  });

  it('survives a resize and an orientation change mid-match', () => {
    render(<Harness targetGoals={7} />);
    startMatch();
    advanceUntil(() => status() === 'playing');

    act(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('orientationchange'));
    });
    tick(16);

    expect(status()).toBe('playing');
    expect(frames.size).toBe(1);
    expect(document.querySelector('[data-hockey-results]')).toBeNull();
  });
});

describe('the expanded presentation', () => {
  it('is contained by default, and marks which it is', () => {
    render(<Harness />);
    startMatch();
    expect(stage()?.dataset.hockeyPresentation).toBe('contained');
  });

  it('fills the screen and drops every non-essential control', () => {
    render(<Harness expanded />);
    startMatch();

    expect(stage()?.dataset.hockeyPresentation).toBe('expanded');
    // No layout switch: on a handheld the answer is which way the device is
    // held, and a button fighting the next rotation is worse than none.
    expect(orientationToggle()).toBeNull();
    // No standing instructions taking a strip of table.
    expect(stage()?.textContent).not.toMatch(/drag inside the table/i);
  });

  it('still shows both scores, and still lets the player pause and leave', () => {
    // The floor below which expanded mode must not go.
    render(<Harness expanded />);
    startMatch();

    expect(document.querySelector('[data-hockey-player-score]')).toBeInTheDocument();
    expect(document.querySelector('[data-hockey-opponent-score]')).toBeInTheDocument();
    expect(document.querySelector('[data-hockey-scoreboard]')?.textContent).toMatch(/you/i);
    expect(within(shell()!).getByRole('button', { name: /pause/i })).toBeInTheDocument();
    expect(within(shell()!).getByRole('button', { name: /leave air hockey/i })).toBeInTheDocument();
  });

  it('goes back to the panel presentation for the results', () => {
    // Only GAMEPLAY wants every pixel; a result is a panel to read.
    render(<Harness expanded />);
    startMatch();
    playToResults();

    expect(stage()).toBeNull();
    expect(results()).toBeInTheDocument();
    expect(within(shell()!).getByRole('button', { name: /play again/i })).toBeInTheDocument();
  });

  it('leaves nothing running when closed from expanded play', () => {
    const audio = fakeAudio();
    render(<Harness expanded audio={audio} />);
    startMatch();
    advanceUntil(() => status() === 'playing');

    fireEvent.click(screen.getByRole('button', { name: /leave air hockey/i }));
    tick();
    tick();
    expect(frames.size).toBe(0);
    expect(audio.calls).toContain('dispose');
  });
});

describe('pointer control', () => {
  it('keeps control through a drag and gives it up on release', () => {
    render(<Harness targetGoals={7} />);
    startMatch();
    const field = table()!;

    fireEvent.pointerDown(field, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(field, { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 });
    fireEvent.pointerUp(field, { pointerId: 1, pointerType: 'touch' });

    // Releasing must not leave the match stuck or the loop dead.
    tick(16);
    expect(status()).toBe('countdown');
    expect(frames.size).toBe(1);
  });

  it('recovers from a cancelled pointer and from lost capture', () => {
    // A phone taking the gesture away (a system swipe, an incoming call) must
    // not leave the mallet welded to a stale contact.
    render(<Harness targetGoals={7} />);
    startMatch();
    const field = table()!;

    fireEvent.pointerDown(field, { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(field, { pointerId: 2, pointerType: 'touch' });
    fireEvent.lostPointerCapture(field, { pointerId: 2, pointerType: 'touch' });

    // A NEW pointer is still accepted afterwards.
    fireEvent.pointerDown(field, { pointerId: 3, pointerType: 'touch', clientX: 30, clientY: 30 });
    fireEvent.pointerMove(field, { pointerId: 3, pointerType: 'touch', clientX: 40, clientY: 40 });
    tick(16);
    expect(status()).toBe('countdown');
  });

  it('swallows the arrow keys so a live match cannot scroll away', () => {
    render(<Harness targetGoals={7} />);
    startMatch();
    const field = table()!;

    const arrow = createEvent.keyDown(field, { key: 'ArrowLeft' });
    fireEvent(field, arrow);
    expect(arrow.defaultPrevented).toBe(true);

    // A key the game does not use is left alone. (Escape is deliberately not
    // the example: the dialog owns that one, and it should keep owning it.)
    const other = createEvent.keyDown(field, { key: 'q' });
    fireEvent(field, other);
    expect(other.defaultPrevented).toBe(false);
  });
});

describe('the catalogue tells the truth about the controls', () => {
  it('advertises only schemes the table actually implements', () => {
    const schemes = ENTRY.controls.map((c) => c.scheme).sort();
    expect(schemes).toEqual(['keyboard', 'pointer', 'touch']);

    render(<Harness />);
    startMatch();
    const field = table()!;

    // pointer + touch: both reach the same handler.
    expect(field.getAttribute('onpointermove')).toBeNull(); // React, not inline
    fireEvent.pointerMove(field, { pointerId: 1, pointerType: 'mouse', clientX: 5, clientY: 5 });
    fireEvent.pointerDown(field, { pointerId: 4, pointerType: 'touch', clientX: 5, clientY: 5 });
    // keyboard: the movement keys are consumed.
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd']) {
      const event = createEvent.keyDown(field, { key });
      fireEvent(field, event);
      expect(event.defaultPrevented, key).toBe(true);
      fireEvent.keyUp(field, { key });
    }
    expect(status()).toBe('countdown');
  });
});
