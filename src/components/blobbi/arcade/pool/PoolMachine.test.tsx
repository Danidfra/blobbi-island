/**
 * Pool — lifecycle, input and integration coverage.
 *
 * The REAL controller, the REAL shell, the REAL lifecycle reducer, the REAL
 * simulation and the REAL fixed-step loop. Three things are substituted, and
 * only three:
 *
 *  - **`requestAnimationFrame` and the clock**, so a frame is driven by hand
 *    rather than by waiting for real ones. This is not a shortcut around the
 *    loop — the loop under test is the shipping one, and it is what turns those
 *    driven frames into fixed simulation steps.
 *  - **the audio engine**, because jsdom has no `AudioContext`.
 *  - **the 2D canvas context**, which jsdom does not implement. The picture is
 *    the only thing lost: the simulation, the HUD and every control still work,
 *    which is itself worth knowing.
 *
 * The frames played here are real ones on a hand-built table, so a win, a foul
 * and a ball-in-hand are reached by playing rather than by forging a result.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useReducer, useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import {
  INITIAL_ARCADE_MACHINE_STATE,
  arcadeMachineReducer,
} from '@/arcade/arcade-machine-state';
import {
  ARCADE_POOL_MACHINE_ID,
  BLOBBI_POOL_GAME_ID,
  getCatalogueEntry,
} from '@/arcade/catalogue';
import { createPoolMatch, type PoolMatchState } from '@/arcade/pool/match';
import { CUE_BALL, EIGHT_BALL, type PoolBall } from '@/arcade/pool/physics';
import { POCKETS, TABLE_LENGTH, TABLE_WIDTH } from '@/arcade/pool/table';
import type { PoolAudioEngine } from '@/arcade/pool/pool-audio';

import { RAIL_WIDTH, tableOuterSize } from './pool-draw';
import { PoolMachine } from './PoolMachine';

const MACHINE_ID = ARCADE_POOL_MACHINE_ID;
const ENTRY = getCatalogueEntry(BLOBBI_POOL_GAME_ID)!;

// ── Doubles ─────────────────────────────────────────────────────────────────

function fakeAudio(): PoolAudioEngine & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    strike: () => calls.push('strike'),
    collide: () => calls.push('collide'),
    cushion: () => calls.push('cushion'),
    pocket: () => calls.push('pocket'),
    scratch: () => calls.push('scratch'),
    turn: () => calls.push('turn'),
    fanfare: () => calls.push('fanfare'),
    setMuted: () => calls.push('setMuted'),
    muted: false,
    dispose: () => calls.push('dispose'),
  };
}

let frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let clock = 0;
/** How many loops asked for a frame in the most recent tick. */
let lastFrameCount = 0;

function installFrameDriver() {
  frames = new Map();
  nextFrameId = 1;
  clock = 0;
  lastFrameCount = 0;
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
  lastFrameCount = due.length;
  frames.clear();
  act(() => {
    for (const cb of due) cb(clock);
  });
}

/** Drive frames until `done()` or the budget runs out. */
function advanceUntil(done: () => boolean, maxFrames = 600): boolean {
  for (let i = 0; i < maxFrames; i += 1) {
    if (done()) return true;
    if (frames.size === 0) return done();
    tick();
  }
  return done();
}

// ── Hand-built tables ───────────────────────────────────────────────────────

function ball(number: number, x: number, y: number, pocketed = false): PoolBall {
  return { number, x, y, vx: 0, vy: 0, pocketed };
}

/** Cue ball, 8-ball and a corner pocket in a line: one shot decides the frame. */
const CORNER = POCKETS[2];
const EIGHT_AT = { x: CORNER.x - 40, y: CORNER.y + 20 };
const AIM = Math.atan2(CORNER.y - EIGHT_AT.y, CORNER.x - EIGHT_AT.x);
const CUE_AT = {
  x: EIGHT_AT.x - Math.cos(AIM) * 40,
  y: EIGHT_AT.y - Math.sin(AIM) * 40,
};

/** A frame the player wins with one shot: their group is already clear. */
function onTheEightTable(): PoolMatchState {
  const base = createPoolMatch({ seed: 4242 });
  return {
    ...base,
    broken: true,
    assignment: { player: 'solids', opponent: 'stripes' },
    balls: [
      ball(CUE_BALL, CUE_AT.x, CUE_AT.y),
      ball(EIGHT_BALL, EIGHT_AT.x, EIGHT_AT.y),
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => ball(n, 0, 0, true)),
      ...[9, 10, 11, 12, 13, 14, 15].map((n, i) => ball(n, 30 + i * 8, 88)),
    ],
  };
}

/** A frame where the player's only shot is straight into a pocket — a scratch. */
function scratchTable(): PoolMatchState {
  const base = createPoolMatch({ seed: 99 });
  return {
    ...base,
    broken: true,
    assignment: { player: 'solids', opponent: 'stripes' },
    balls: [
      ball(CUE_BALL, 40, 40),
      ball(1, 150, 60),
      ball(EIGHT_BALL, 170, 30),
      ...[9, 10].map((n, i) => ball(n, 60 + i * 10, 90)),
    ],
  };
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface HarnessProps {
  audio?: PoolAudioEngine;
  onClosed?: () => void;
  /** Force the whole-screen presentation, as a handheld would get. */
  expanded?: boolean;
  createMatchState?: () => PoolMatchState;
}

function Harness({ audio, onClosed, expanded, createMatchState }: HarnessProps) {
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
    <PoolMachine
      machineId={MACHINE_ID}
      gameId={ENTRY.id}
      title={ENTRY.title}
      exitLabel="Back to the arcade"
      exitAriaLabel="Back to the arcade room"
      lifecycle={lifecycle}
      dispatch={dispatch}
      audioFactory={() => audio ?? fakeAudio()}
      createMatchState={createMatchState ?? onTheEightTable}
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
const stage = () => document.querySelector<HTMLElement>('[data-pool-stage]');
const table = () => document.querySelector<HTMLElement>('[data-pool-table]');
const results = () => document.querySelector<HTMLElement>('[data-pool-results]');
const status = () => shell()?.getAttribute('data-arcade-status');
const phase = () => stage()?.dataset.poolPhase;
const turn = () => stage()?.dataset.poolTurn;
const powerStep = () =>
  Number(document.querySelector('[data-pool-power]')?.getAttribute('data-pool-power') ?? '-1');
const startButton = () => screen.getByRole('button', { name: /^start$/i });

function startMatch() {
  fireEvent.click(startButton());
}

/**
 * Pretend the table box has been laid out, because jsdom gives everything a
 * zero rect and a pointer that maps to nothing is a pointer that cannot aim.
 */
const BOX = { width: 856, height: 456, left: 40, top: 60 };

function stubTableRect() {
  const el = table();
  if (!el) return;
  const canvas = el.querySelector('canvas')!;
  const rect = {
    ...BOX,
    right: BOX.left + BOX.width,
    bottom: BOX.top + BOX.height,
    x: BOX.left,
    y: BOX.top,
    toJSON: () => ({}),
  } as DOMRect;
  el.getBoundingClientRect = () => rect;
  canvas.getBoundingClientRect = () => rect;
  // Pointer capture is not implemented in jsdom.
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  el.hasPointerCapture = () => true;

  // The component measured a ZERO rect on mount, because that is all jsdom
  // gives. Until it measures again the transform has `scale: 0` and every
  // pointer maps to the middle of the table — which is not a coordinate bug in
  // the component, it is the correct answer for a box with no size. A resize is
  // how the real page tells it the layout happened.
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

/** Table units → client pixels, using the same fit the component computes. */
function toClient(point: { x: number; y: number }) {
  const outer = tableOuterSize('landscape');
  const scale = Math.min(BOX.width / outer.width, BOX.height / outer.height);
  const offsetX = (BOX.width - outer.width * scale) / 2 + RAIL_WIDTH * scale;
  const offsetY = (BOX.height - outer.height * scale) / 2 + RAIL_WIDTH * scale;
  return { clientX: BOX.left + offsetX + point.x * scale, clientY: BOX.top + offsetY + point.y * scale };
}

function pointer(type: string, at: { x: number; y: number }, pointerId = 1) {
  const el = table()!;
  const init = { bubbles: true, cancelable: true, pointerId, isPrimary: true, ...toClient(at) };
  // jsdom has no PointerEvent constructor; a MouseEvent with the extra fields
  // is what React's synthetic pointer events read.
  const event = new MouseEvent(type, init) as MouseEvent & { pointerId: number };
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  act(() => {
    el.dispatchEvent(event);
  });
}

/**
 * Pull the cue back from `from` to `to` (both in table units) and let go.
 *
 * The gesture the whole game is played with: aim is away from the finger, power
 * is how far it was pulled.
 */
function pullAndRelease(from: { x: number; y: number }, to: { x: number; y: number }) {
  pointer('pointerdown', from);
  pointer('pointermove', to);
  pointer('pointerup', to);
  // The shot lands in a REF, not in React state — that is the whole point of
  // the render strategy. One frame is what publishes it to the HUD, so the
  // assertions below read what a player would actually see.
  tick(16);
}

/** A pull that sends the cue ball along `AIM` at a decent power. */
const PULL_START = { x: CUE_AT.x - Math.cos(AIM) * 6, y: CUE_AT.y - Math.sin(AIM) * 6 };
const PULL_END = { x: CUE_AT.x - Math.cos(AIM) * 34, y: CUE_AT.y - Math.sin(AIM) * 34 };

let getContextSpy: ReturnType<typeof vi.spyOn>;
let nowSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  installFrameDriver();
  // The loop's clock. Stubbing `requestAnimationFrame` alone is not enough: the
  // loop measures elapsed time with `performance.now()`, so without this every
  // driven frame reports a delta of zero and the simulation never moves.
  nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  // jsdom has no 2D context and logs a "not implemented" error if asked for
  // one. Returning null is the same answer, quietly — and it exercises the
  // component's own null-context path.
  getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  getContextSpy.mockRestore();
  nowSpy.mockRestore();
  vi.unstubAllGlobals();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('before the frame', () => {
  it('shows the start panel, not a table', () => {
    render(<Harness />);
    expect(status()).toBe('preview');
    expect(document.querySelector('[data-pool-preview]')).toBeInTheDocument();
    expect(table()).toBeNull();
  });

  it('offers a rival and defaults to Normal', () => {
    render(<Harness />);
    expect(screen.getByRole('radio', { name: /normal/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /easy/i })).not.toBeChecked();
  });

  it('lets the rival be chosen before starting, and says so in the header', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: /easy/i }));
    expect(screen.getByRole('radio', { name: /easy/i })).toBeChecked();
    expect(within(shell()!).getByText(/easy rival/i)).toBeInTheDocument();
  });

  it('teaches the gesture and the whole rule set up front', () => {
    render(<Harness />);
    const controls = document.querySelector('[data-pool-controls]')!;
    expect(controls.textContent).toMatch(/drag/i);
    expect(controls.textContent).toMatch(/let go/i);
    const rules = document.querySelector('[data-pool-rules]')!;
    expect(rules.textContent).toMatch(/solids/i);
    expect(rules.textContent).toMatch(/stripes/i);
    expect(rules.textContent).toMatch(/8-ball/i);
    expect(rules.textContent).toMatch(/foul/i);
  });

  it('says plainly that it pays no tickets yet', () => {
    // Playable and paying nothing are independent facts, and the screen must
    // not let a player infer one from the other.
    render(<Harness />);
    expect(document.querySelector('[data-pool-ticket-notice]')?.textContent).toMatch(
      /does not pay out tickets yet/i,
    );
    expect(within(shell()!).queryByRole('button', { name: /claim/i })).toBeNull();
  });
});

describe('starting a frame', () => {
  it('mints one run, racks up, and runs the break-setup beat', () => {
    render(<Harness />);
    startMatch();

    expect(status()).toBe('countdown');
    expect(table()).not.toBeNull();
    expect(phase()).toBe('ready');
    expect(document.querySelector('[data-pool-ready]')).toBeInTheDocument();
  });

  it('leaves the beat for the player’s shot, and tells the lifecycle', () => {
    render(<Harness />);
    startMatch();
    expect(advanceUntil(() => status() === 'playing')).toBe(true);
    expect(phase()).toBe('aiming');
    expect(turn()).toBe('player');
    expect(document.querySelector('[data-pool-ready]')).toBeNull();
  });

  it('runs exactly one loop, however many times the parent re-renders', () => {
    // Two loops would silently run the simulation at double speed, and it is
    // the single easiest thing to break by giving the loop a new callback.
    const { rerender } = render(<Harness />);
    startMatch();
    tick();
    rerender(<Harness />);
    rerender(<Harness />);
    tick();
    expect(lastFrameCount).toBe(1);
  });

  it('builds the audio engine inside the click, and disposes it on unmount', () => {
    const audio = fakeAudio();
    const { unmount } = render(<Harness audio={audio} />);
    expect(audio.calls).not.toContain('dispose');
    startMatch();
    expect(audio.calls).toContain('setMuted');
    unmount();
    expect(audio.calls).toContain('dispose');
  });
});

describe('the cue', () => {
  function readyToShoot(props: HarnessProps = {}) {
    render(<Harness {...props} />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    stubTableRect();
  }

  it('fires on a real pull, and only once', () => {
    readyToShoot();
    expect(phase()).toBe('aiming');
    pullAndRelease(PULL_START, PULL_END);
    expect(phase()).toBe('rolling');
  });

  it('treats a tap as a re-aim, never as a shot', () => {
    // The accidental-fire guard, and the discoverable way in for a player who
    // has not found the pull yet.
    readyToShoot();
    pullAndRelease(PULL_START, PULL_START);
    expect(phase()).toBe('aiming');
  });

  it('refuses a pull too short to mean anything', () => {
    readyToShoot();
    const barely = { x: CUE_AT.x - Math.cos(AIM) * 4, y: CUE_AT.y - Math.sin(AIM) * 4 };
    pullAndRelease(PULL_START, barely);
    expect(phase()).toBe('aiming');
  });

  it('shows the power rising as the cue is drawn back, and clamps it', () => {
    readyToShoot();
    pointer('pointerdown', PULL_START);
    tick();
    const near = powerStep();

    pointer('pointermove', PULL_END);
    tick();
    expect(powerStep()).toBeGreaterThan(near);

    // Absurdly far: clamped rather than compounding.
    pointer('pointermove', { x: CUE_AT.x - Math.cos(AIM) * 400, y: CUE_AT.y - Math.sin(AIM) * 400 });
    tick();
    expect(powerStep()).toBe(20);

    pointer('pointerup', PULL_END);
  });

  it('drops the shot when the gesture is cancelled', () => {
    // `pointercancel` is the browser taking the gesture over — a system scroll,
    // a palm, a rotation mid-drag. Firing on the strength of it is the worst
    // possible reading.
    readyToShoot();
    pointer('pointerdown', PULL_START);
    pointer('pointermove', PULL_END);
    pointer('pointercancel', PULL_END);
    expect(phase()).toBe('aiming');
    tick();
    expect(powerStep()).toBe(0);
  });

  it('drops the shot when pointer capture is lost', () => {
    readyToShoot();
    pointer('pointerdown', PULL_START);
    pointer('pointermove', PULL_END);
    pointer('lostpointercapture', PULL_END);
    expect(phase()).toBe('aiming');
  });

  it('ignores a second finger mid-pull', () => {
    readyToShoot();
    pointer('pointerdown', PULL_START, 1);
    pointer('pointermove', PULL_END, 1);
    // A different pointer id must not move the aim or fire the cue.
    pointer('pointerup', PULL_START, 2);
    tick(16);
    expect(phase()).toBe('aiming');
    pointer('pointerup', PULL_END, 1);
    tick(16);
    expect(phase()).toBe('rolling');
  });

  it('accepts nothing at all while the balls are moving', () => {
    readyToShoot();
    pullAndRelease(PULL_START, PULL_END);
    expect(phase()).toBe('rolling');
    pullAndRelease(PULL_START, PULL_END);
    expect(phase()).toBe('rolling');
  });

  it('shoots from the keyboard too, which is what the catalogue advertises', () => {
    readyToShoot();
    const el = table()!;
    act(() => {
      el.focus();
      fireEvent.keyDown(el, { key: 'ArrowUp' });
    });
    tick();
    tick();
    act(() => {
      fireEvent.keyUp(el, { key: 'ArrowUp' });
      fireEvent.keyDown(el, { key: ' ' });
    });
    tick(16);
    expect(phase()).toBe('rolling');
  });

  it('swings the cue with the arrow keys without scrolling the dialog', () => {
    readyToShoot();
    const el = table()!;
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    act(() => {
      el.focus();
      el.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets go of every held key when the table loses focus', () => {
    readyToShoot();
    const el = table()!;
    act(() => {
      el.focus();
      fireEvent.keyDown(el, { key: 'ArrowUp' });
      fireEvent.blur(el);
    });
    const before = powerStep();
    tick();
    tick();
    expect(powerStep()).toBe(before);
  });
});

describe('playing the frame out', () => {
  it('wins on a clean 8-ball and reports exactly one result', () => {
    const audio = fakeAudio();
    render(<Harness audio={audio} />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    stubTableRect();
    pullAndRelease(PULL_START, PULL_END);

    expect(advanceUntil(() => results() !== null, 4000)).toBe(true);
    expect(status()).toBe('results');
    expect(
      document.querySelector('[data-pool-outcome]')?.getAttribute('data-pool-outcome'),
    ).toBe('win');
    expect(within(results()!).getByText(/you win/i)).toBeInTheDocument();
    expect(audio.calls).toContain('fanfare');
    expect(audio.calls).toContain('pocket');

    // Driving more frames cannot produce a second result.
    const before = results()!.textContent;
    tick();
    tick();
    expect(results()!.textContent).toBe(before);
  });

  it('describes how the frame ended, not just that it did', () => {
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    stubTableRect();
    pullAndRelease(PULL_START, PULL_END);
    advanceUntil(() => results() !== null, 4000);

    expect(document.querySelector('[data-pool-ending]')?.textContent).toMatch(/8-ball/i);
    expect(document.querySelector('[data-pool-stats]')?.textContent).toMatch(/pot rate/i);
  });

  it('offers a replay that is a brand-new frame', () => {
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    stubTableRect();
    pullAndRelease(PULL_START, PULL_END);
    advanceUntil(() => results() !== null, 4000);

    fireEvent.click(screen.getByRole('button', { name: /play again/i }));
    expect(status()).toBe('countdown');
    expect(results()).toBeNull();
    expect(phase()).toBe('ready');
    expect(advanceUntil(() => status() === 'playing')).toBe(true);
    expect(turn()).toBe('player');
  });

  it('hands the table over on a scratch and asks the player to place the ball', () => {
    render(<Harness createMatchState={scratchTable} />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    stubTableRect();

    // Straight at the top-left corner pocket from (40, 40).
    const aim = Math.atan2(-40, -40);
    pullAndRelease(
      { x: 40 - Math.cos(aim) * 6, y: 40 - Math.sin(aim) * 6 },
      { x: 40 - Math.cos(aim) * 30, y: 40 - Math.sin(aim) * 30 },
    );

    // The rival takes ball-in-hand, plays, and eventually hands it back.
    expect(advanceUntil(() => turn() === 'opponent', 4000)).toBe(true);
  });
});

describe('ball-in-hand', () => {
  /** A table where it is the player's turn WITH ball-in-hand from the off. */
  function ballInHandTable(): PoolMatchState {
    const base = createPoolMatch({ seed: 7 });
    return {
      ...base,
      phase: 'ball-in-hand',
      timerMs: 0,
      broken: true,
      ballInHand: true,
      turn: 'player',
      assignment: { player: 'solids', opponent: 'stripes' },
      balls: [
        ball(CUE_BALL, 50, 50),
        ball(1, 120, 50),
        ball(EIGHT_BALL, 160, 30),
        ball(9, 90, 80),
      ],
    };
  }

  function placing() {
    render(<Harness createMatchState={ballInHandTable} />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    stubTableRect();
  }

  it('says what to do and offers an explicit confirmation', () => {
    placing();
    expect(phase()).toBe('ball-in-hand');
    expect(screen.getByRole('button', { name: /place cue ball/i })).toBeInTheDocument();
    expect(stage()!.textContent).toMatch(/drag the cue ball/i);
  });

  it('does not fire the cue while the ball is being placed', () => {
    placing();
    pullAndRelease({ x: 70, y: 30 }, { x: 30, y: 30 });
    expect(phase()).toBe('ball-in-hand');
  });

  it('confirms to aiming, and the confirm alone is enough', () => {
    // The safe default: a player who never drags can still get on with it.
    placing();
    fireEvent.click(screen.getByRole('button', { name: /place cue ball/i }));
    expect(phase()).toBe('aiming');
    expect(screen.queryByRole('button', { name: /place cue ball/i })).toBeNull();
  });

  it('drags the ball, then confirms where it was left', () => {
    placing();
    pointer('pointerdown', { x: 80, y: 25 });
    pointer('pointermove', { x: 84, y: 28 });
    pointer('pointerup', { x: 84, y: 28 });
    expect(phase()).toBe('ball-in-hand');
    fireEvent.click(screen.getByRole('button', { name: /place cue ball/i }));
    expect(phase()).toBe('aiming');
  });

  it('confirms from the keyboard as well', () => {
    placing();
    const el = table()!;
    act(() => {
      el.focus();
      fireEvent.keyDown(el, { key: 'Enter' });
    });
    tick(16);
    expect(phase()).toBe('aiming');
  });
});

describe('pausing and interruption', () => {
  function playing() {
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    stubTableRect();
  }

  it('freezes the table, and says so', () => {
    playing();
    fireEvent.click(screen.getByRole('button', { name: /pause pool/i }));
    expect(status()).toBe('paused');
    expect(document.querySelector('[data-pool-paused]')).toBeInTheDocument();
  });

  it('stops the loop entirely while paused', () => {
    playing();
    pullAndRelease(PULL_START, PULL_END);
    fireEvent.click(screen.getByRole('button', { name: /pause pool/i }));

    frames.clear();
    tick();
    tick();
    // Nothing asked for a frame, so nothing advanced.
    expect(lastFrameCount).toBe(0);
    expect(status()).toBe('paused');
  });

  it('resumes without a giant catch-up step', () => {
    playing();
    pullAndRelease(PULL_START, PULL_END);
    fireEvent.click(screen.getByRole('button', { name: /pause pool/i }));

    // Five minutes away.
    clock += 300_000;
    fireEvent.click(screen.getByRole('button', { name: /resume pool/i }));
    expect(status()).toBe('playing');
    // The loop re-anchors on resume, so the frame that follows is an ordinary
    // one rather than a five-minute leap.
    tick(16);
    expect(status()).toBe('playing');
  });

  it('pauses rather than aborting when the tab is hidden', () => {
    // The opposite of Blobbi Dance, and for a stated reason: this game's clock
    // IS its loop, so stopping the loop loses nothing.
    playing();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(status()).toBe('paused');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('pauses on a lost window, and drops any half-drawn cue', () => {
    playing();
    pointer('pointerdown', PULL_START);
    pointer('pointermove', PULL_END);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(status()).toBe('paused');

    // Coming back to a cue already drawn back, with no finger on it, is a shot
    // waiting to go off.
    fireEvent.click(screen.getByRole('button', { name: /resume pool/i }));
    tick();
    expect(powerStep()).toBe(0);
    expect(phase()).not.toBe('rolling');
  });
});

describe('leaving and coming back', () => {
  it('leaves mid-frame, aborts the run, and tears the loop down', () => {
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);
    startMatch();
    advanceUntil(() => status() === 'playing');

    fireEvent.click(screen.getByRole('button', { name: /leave pool/i }));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('closed')).toBeInTheDocument();
    expect(table()).toBeNull();

    frames.clear();
    tick();
    expect(lastFrameCount).toBe(0);
  });

  it('leaves while the balls are rolling', () => {
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    stubTableRect();
    pullAndRelease(PULL_START, PULL_END);
    expect(phase()).toBe('rolling');

    fireEvent.click(screen.getByRole('button', { name: /leave pool/i }));
    expect(screen.getByTestId('closed')).toBeInTheDocument();
  });

  it('leaves while the rival is thinking', () => {
    render(<Harness createMatchState={scratchTable} />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    stubTableRect();
    const aim = Math.atan2(-40, -40);
    pullAndRelease(
      { x: 40 - Math.cos(aim) * 6, y: 40 - Math.sin(aim) * 6 },
      { x: 40 - Math.cos(aim) * 30, y: 40 - Math.sin(aim) * 30 },
    );
    advanceUntil(() => turn() === 'opponent', 4000);

    fireEvent.click(screen.getByRole('button', { name: /leave pool/i }));
    expect(screen.getByTestId('closed')).toBeInTheDocument();
  });

  it('starts clean every time it is reopened', () => {
    const first = render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    stubTableRect();
    pullAndRelease(PULL_START, PULL_END);
    advanceUntil(() => results() !== null, 4000);
    first.unmount();

    render(<Harness />);
    expect(status()).toBe('preview');
    expect(results()).toBeNull();
    expect(document.querySelector('[data-pool-preview]')).toBeInTheDocument();
    startMatch();
    expect(advanceUntil(() => status() === 'playing')).toBe(true);
    expect(phase()).toBe('aiming');
  });

  it('unmounts without leaving a frame scheduled', () => {
    const { unmount } = render(<Harness />);
    startMatch();
    tick();
    unmount();
    frames.clear();
    tick();
    expect(lastFrameCount).toBe(0);
  });
});

describe('presentation', () => {
  it('keeps its chrome inside the arcade window', () => {
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    expect(stage()!.dataset.poolPresentation).toBe('contained');
    expect(shell()).toHaveAttribute('data-arcade-surface', 'game');
    expect(shell()).toHaveAttribute('data-arcade-machine', MACHINE_ID);
    expect(shell()).toHaveAttribute('data-arcade-game', BLOBBI_POOL_GAME_ID);
  });

  it('takes the whole screen on a handheld, and only while playing', () => {
    render(<Harness expanded />);
    // The start panel is a panel: it wants to be readable, not full-bleed.
    expect(stage()).toBeNull();
    startMatch();
    advanceUntil(() => status() === 'playing');
    expect(stage()!.dataset.poolPresentation).toBe('expanded');
    // The header's prose is dropped, because the scoreboard already says it.
    expect(within(shell()!).queryByText(/8-ball ·/i)).toBeNull();
  });

  it('never lets a drag scroll the page instead of pulling the cue', () => {
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    expect(table()!.className).toContain('touch-none');
  });

  it('recovers from a resize without duplicating a loop or firing the cue', () => {
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    stubTableRect();

    pointer('pointerdown', PULL_START);
    pointer('pointermove', PULL_END);
    act(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('orientationchange'));
    });
    // The half-finished pull is dropped rather than fired at a geometry that
    // has changed underneath it.
    pointer('pointerup', PULL_END);
    expect(phase()).toBe('aiming');

    tick();
    expect(lastFrameCount).toBe(1);
    // And the frame is still the same frame.
    expect(turn()).toBe('player');
    expect(status()).toBe('playing');
  });

  it('still plays with no canvas at all', () => {
    // jsdom gives none, which is exactly the degraded path a browser refusing a
    // 2D context would take. The picture is lost; the frame is not.
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    stubTableRect();
    pullAndRelease(PULL_START, PULL_END);
    expect(advanceUntil(() => results() !== null, 4000)).toBe(true);
  });
});

describe('accessibility', () => {
  it('names the table and says how to use it', () => {
    render(<Harness />);
    startMatch();
    const el = screen.getByRole('application');
    expect(el).toHaveAccessibleName(/pool table/i);
    expect(el).toHaveAccessibleName(/drag back/i);
  });

  it('keeps both sides’ state in text, never in colour alone', () => {
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    const board = document.querySelector('[data-pool-scoreboard]')!;
    expect(board.textContent).toMatch(/you/i);
    expect(board.textContent).toMatch(/rival/i);
    // Whose turn it is, as a data attribute AND as words in the status line.
    const active = board.querySelector('[data-pool-side="player"]');
    expect(active).toHaveAttribute('data-pool-active', 'true');
    expect(document.querySelector('[data-pool-status]')?.textContent).toMatch(/your shot/i);
  });

  it('announces what happened without narrating every frame', () => {
    render(<Harness />);
    startMatch();
    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toMatch(/break/i);
    advanceUntil(() => status() === 'playing');
    expect(live.textContent).toMatch(/drag back/i);
  });

  it('offers a sound toggle whose name does not contradict its state', () => {
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    const toggle = document.querySelector('[data-pool-sound]')!;
    expect(toggle).toHaveAttribute('aria-label', 'Mute the sound');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAttribute('aria-label', 'Mute the sound');
  });
});

describe('the table stays a table', () => {
  it('draws every ball inside the cloth, whatever the box looks like', () => {
    // The letterboxing guarantee, checked through the transform the component
    // actually uses rather than through the element's CSS.
    render(<Harness />);
    startMatch();
    advanceUntil(() => status() === 'playing');
    stubTableRect();

    for (const point of [
      { x: 0, y: 0 },
      { x: TABLE_LENGTH, y: TABLE_WIDTH },
      { x: TABLE_LENGTH / 2, y: TABLE_WIDTH / 2 },
    ]) {
      const { clientX, clientY } = toClient(point);
      expect(clientX).toBeGreaterThanOrEqual(BOX.left);
      expect(clientX).toBeLessThanOrEqual(BOX.left + BOX.width);
      expect(clientY).toBeGreaterThanOrEqual(BOX.top);
      expect(clientY).toBeLessThanOrEqual(BOX.top + BOX.height);
    }
  });
});
