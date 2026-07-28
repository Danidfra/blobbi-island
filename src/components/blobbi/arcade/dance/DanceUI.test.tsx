/**
 * Blobbi Dance — presentation contracts.
 *
 * `DanceMachine.test.tsx` owns the rules: the lifecycle, the judgement, the
 * reward arithmetic and the claim boundary. This file owns what the polish pass
 * is allowed to be judged on — and, more importantly, what it is **not** allowed
 * to break.
 *
 * The distinction matters because presentation is where honesty gets lost. A
 * prettier results screen that quietly turns an unresolved claim into a "Try
 * again" button is a regression of the worst kind, so the claim-state contracts
 * are asserted here a second time, from the outside, in the file whose whole
 * subject is appearance.
 *
 * What this file deliberately does NOT do is snapshot anything. A snapshot of a
 * game screen fails on every colour change and proves nothing about whether the
 * screen is readable; every assertion below is about a behaviour or a contract
 * that would be a real defect if it changed.
 *
 * The same two things are substituted as in the lifecycle tests, and only those
 * two: the audio engine (jsdom has no `AudioContext`) and the reward writer
 * (the alternative is publishing real events). Nothing here can reach a relay.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { useReducer, useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { DanceMachine } from './DanceMachine';
import { QueryProviders } from './test-providers';
import { createFakeAudio, createFakeWriter, fakeUser } from './test-doubles';
import { DANCE_LANE_VISUALS, comboTier, judgmentReadoutClass } from './dance-visuals';
import {
  INITIAL_ARCADE_MACHINE_STATE,
  arcadeMachineReducer,
} from '@/arcade/arcade-machine-state';
import { getArcadeMachine } from '@/lib/arcade-machines-config';
import { buildChartFromBars, type DanceChart } from '@/arcade/dance/chart';
import { NEON_HOP_TRACK } from '@/arcade/dance/track';
import { resetClaimLocks } from '@/lib/arcade-claim-ledger';

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

const MACHINE = getArcadeMachine('arcade-dance-machine')!;

const TINY_CHART: DanceChart = buildChartFromBars({
  id: 'tiny',
  track: NEON_HOP_TRACK,
  difficulty: 'normal',
  bars: ['L...D...', 'U.......'],
});

/**
 * Twenty-four notes, so a run can climb through the combo tiers that the
 * three-note chart can never reach (`blazing` starts at 20).
 */
const COMBO_CHART: DanceChart = buildChartFromBars({
  id: 'combo',
  track: NEON_HOP_TRACK,
  difficulty: 'normal',
  bars: ['LDURLDUR', 'LDURLDUR', 'LDURLDUR'],
});

interface HarnessOptions {
  audio?: ReturnType<typeof createFakeAudio>;
  writer?: ReturnType<typeof createFakeWriter>;
  chart?: DanceChart;
}

function Harness({ audio, writer, chart }: HarnessOptions) {
  const [lifecycle, dispatch] = useReducer(arcadeMachineReducer, INITIAL_ARCADE_MACHINE_STATE, () =>
    arcadeMachineReducer(INITIAL_ARCADE_MACHINE_STATE, {
      type: 'open',
      machineId: MACHINE.id,
      gameId: MACHINE.gameId,
    }),
  );
  const [runs, setRuns] = useState(0);

  return (
    <DanceMachine
      machine={MACHINE}
      lifecycle={lifecycle}
      dispatch={dispatch}
      onClose={() => dispatch({ type: 'close' })}
      chart={chart ?? TINY_CHART}
      audioFactory={audio?.factory}
      rewardWriter={writer}
      mintRunId={() => {
        setRuns((n) => n + 1);
        return `ui-run-${runs + 1}`;
      }}
    />
  );
}

function renderMachine(options: HarnessOptions = {}) {
  const audio = options.audio ?? createFakeAudio();
  const utils = render(
    <QueryProviders>
      <Harness {...options} audio={audio} />
    </QueryProviders>,
  );
  return { ...utils, audio };
}

async function tick(audio: ReturnType<typeof createFakeAudio>, songTimeMs: number) {
  audio.setSongTime(songTimeMs);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const shell = () => document.querySelector('[data-arcade-shell]') as HTMLElement | null;

async function play(options: HarnessOptions = {}) {
  const view = renderMachine(options);
  fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
  await tick(view.audio, NEON_HOP_TRACK.leadInMs);
  await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));
  return view;
}

async function playToResults(options: HarnessOptions = {}) {
  const view = await play(options);
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

beforeEach(() => {
  localStorage.clear();
  resetClaimLocks();
  currentUser = fakeUser(PUBKEY);
  setReducedMotion(false);
});

afterEach(() => {
  localStorage.clear();
  resetClaimLocks();
  vi.restoreAllMocks();
});

// ── The start screen ────────────────────────────────────────────────────────

describe('the start screen', () => {
  it('says what the game is, in a sentence, before anything technical', () => {
    renderMachine();
    const preview = document.querySelector('[data-dance-preview]') as HTMLElement;
    expect(within(preview).getByText(/tap each arrow the moment it reaches the line/i)).toBeInTheDocument();
  });

  it('shows every lane with its arrow, its name and its keys', () => {
    renderMachine();
    const controls = document.querySelector('[data-dance-controls]') as HTMLElement;
    for (const visual of DANCE_LANE_VISUALS) {
      expect(within(controls).getByText(visual.label)).toBeInTheDocument();
      expect(within(controls).getByText(visual.keys)).toBeInTheDocument();
    }
  });

  it('names BOTH input methods — a phone player must not have to guess', () => {
    renderMachine();
    const preview = document.querySelector('[data-dance-preview]') as HTMLElement;
    expect(within(preview).getByText(/on a keyboard,/i)).toBeInTheDocument();
    expect(within(preview).getByText(/on a touch screen,/i)).toBeInTheDocument();
    expect(preview.textContent).toMatch(/tap the four big buttons under the lanes/i);
  });

  it('says tickets can be earned WITHOUT printing the reward formula', () => {
    renderMachine();
    const preview = document.querySelector('[data-dance-preview]') as HTMLElement;
    expect(preview.textContent).toMatch(/arcade tickets/i);
    expect(preview.textContent).toMatch(/leaving early earns nothing/i);
    // The tuning table belongs at the results, where it describes something that
    // happened — not on a start screen a child has to read past to play.
    expect(preview.textContent).not.toMatch(/full combo/i);
    expect(preview.textContent).not.toMatch(/\bat most\b/i);
    expect(preview.textContent).not.toMatch(/\d+ms/);
  });

  it('shows no protocol, policy, run or chart identifiers', () => {
    renderMachine();
    const preview = document.querySelector('[data-dance-preview]') as HTMLElement;
    for (const leak of [
      /blobbi-dance-tickets/,
      /policy/i,
      /kind:\s*3\d{4}/,
      /runId/,
      /31633/,
      /naddr/,
    ]) {
      expect(preview.textContent).not.toMatch(leak);
    }
  });

  it('carries the sound control, and the honest placeholder-audio notice', () => {
    renderMachine();
    const toggle = screen.getByRole('button', { name: /mute the music/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const notice = document.querySelector('[data-dance-audio-notice]') as HTMLElement;
    expect(notice.textContent).toMatch(/placeholder/i);
  });

  it('keeps ONE name and moves aria-pressed — a toggle whose name flips lies out loud', async () => {
    // "Turn the music on, toggle button, pressed" is what an action-named toggle
    // announces once it is on, and it says the opposite of what it means. The
    // name is the control's function; `aria-pressed` is the state.
    renderMachine();
    const toggle = () => screen.getByRole('button', { name: /mute the music/i });
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    await act(async () => {
      fireEvent.click(toggle());
    });
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
  });

  it('remembers a mute across the run it starts', async () => {
    const { audio } = renderMachine();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /mute the music/i }));
    });

    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    // The setting reached the engine, so muting is a volume decision and not a
    // request the game quietly ignored.
    expect(audio.engine.muted).toBe(true);
    // …and the clock is untouched: the run is playing exactly as before.
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));
  });

  it('persists the setting, so a fresh mount and a replay both start muted', async () => {
    const first = renderMachine();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /mute the music/i }));
    });
    expect(localStorage.getItem('blobbi:arcade:audio-muted')).toBe('true');
    first.unmount();

    const second = renderMachine();
    expect(screen.getByRole('button', { name: /mute the music/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(second.audio, NEON_HOP_TRACK.leadInMs);
    expect(second.audio.engine.muted).toBe(true);
  });

  it('toggles twice in one tick without going stale', async () => {
    const { audio } = renderMachine();
    const toggle = screen.getByRole('button', { name: /mute the music/i });
    await act(async () => {
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      fireEvent.click(toggle);
    });
    // Three clicks from `false` must land on `true`, in React and in storage.
    expect(screen.getByRole('button', { name: /mute the music/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(localStorage.getItem('blobbi:arcade:audio-muted')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    expect(audio.engine.muted).toBe(true);
  });

  it('reaches the live engine when toggled mid-run, without stopping the clock', async () => {
    const { audio } = await play();
    expect(audio.engine.muted).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /mute the music/i }));
    });
    expect(audio.engine.muted).toBe(true);
    // The engine is still playing: mute is a gain change, never a suspend.
    expect(audio.engine.state).toBe('playing');
    expect(shell()).toHaveAttribute('data-arcade-status', 'playing');

    // And the run still judges exactly as before.
    audio.setSongTime(TINY_CHART.notes[0].timeMs);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
    });
    expect(document.querySelector('[data-dance-judgment]')?.textContent).toBe('Perfect!');
  });

  it('survives storage that refuses to write', async () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    const { audio } = renderMachine();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /mute the music/i }));
    });
    // The control still reflects the choice, and the run still honours it, even
    // though nothing was persisted.
    expect(screen.getByRole('button', { name: /mute the music/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, NEON_HOP_TRACK.leadInMs);
    expect(audio.engine.muted).toBe(true);
    setItem.mockRestore();
  });
});

// ── The playfield ───────────────────────────────────────────────────────────

describe('the playfield', () => {
  it('frames the game as a cabinet, with the song on the marquee', async () => {
    await play();
    const cabinet = document.querySelector('[data-dance-cabinet]') as HTMLElement;
    expect(cabinet).not.toBeNull();
    expect(within(cabinet).getByText(NEON_HOP_TRACK.title)).toBeInTheDocument();
  });

  it('gives every lane a visible rail, a receptor and a touch control', async () => {
    await play();
    for (const visual of DANCE_LANE_VISUALS) {
      expect(document.querySelector(`[data-dance-lane-rail="${visual.lane}"]`)).not.toBeNull();
      expect(document.querySelector(`[data-dance-receptor="${visual.lane}"]`)).not.toBeNull();
      expect(document.querySelector(`[data-dance-touch="${visual.lane}"]`)).not.toBeNull();
    }
  });

  it('labels each lane by shape AND letter, never by colour alone', async () => {
    await play();
    for (const visual of DANCE_LANE_VISUALS) {
      const button = document.querySelector(`[data-dance-touch="${visual.lane}"]`) as HTMLElement;
      expect(button.textContent).toContain(visual.glyph);
      expect(button.textContent).toContain(visual.keyCap);
      expect(button).toHaveAttribute('aria-label', `${visual.label} lane (${visual.keys})`);
    }
  });

  it('paints the judgement word BEHIND the notes, so feedback never hides a target', async () => {
    // Same stacking context, so DOM order is the z-order. A note that arrives
    // while a judgement is up must stay visible: the word is transient feedback,
    // the note is the thing being aimed at.
    await play();
    const field = document.querySelector('[data-dance-field]') as HTMLElement;
    const children = [...field.children];
    const readoutIndex = children.findIndex((el) => el.querySelector('[data-dance-judgment]'));
    const firstNoteIndex = children.findIndex((el) => el.hasAttribute('data-dance-note'));
    expect(readoutIndex).toBeGreaterThanOrEqual(0);
    expect(firstNoteIndex).toBeGreaterThanOrEqual(0);
    expect(readoutIndex).toBeLessThan(firstNoteIndex);
  });

  it('shows the judgement as a WORD, and clears it again', async () => {
    const { audio } = await play();
    audio.setSongTime(TINY_CHART.notes[0].timeMs);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
    });

    const readout = document.querySelector('[data-dance-judgment]') as HTMLElement;
    expect(readout.textContent).toBe('Perfect!');
    expect(readout.className).toBe(judgmentReadoutClass('perfect', false));

    // It is transient by design; the results screen is where a score is read.
    await tick(audio, TINY_CHART.notes[0].timeMs + 1_000);
    expect(readout.textContent).toBe('');
  });

  it('pulses the hit lane and leaves the others alone', async () => {
    const { audio } = await play();
    audio.setSongTime(TINY_CHART.notes[0].timeMs);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
    });

    const left = document.querySelector('[data-dance-pulse="left"]') as HTMLElement;
    const right = document.querySelector('[data-dance-pulse="right"]') as HTMLElement;
    expect(left.className).toContain('dance-receptor-pulse');
    expect(right.className).not.toContain('dance-receptor-pulse');
  });

  it('keeps the pulse off the element React re-renders on a key press', async () => {
    // The regression this structure exists to prevent: holding a lane changes
    // `activeLanes`, React rewrites the receptor's className from props, and a
    // pulse written onto that same node would be erased by the render its own
    // key press caused.
    const { audio } = await play();
    audio.setSongTime(TINY_CHART.notes[0].timeMs);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
    });

    const receptor = document.querySelector('[data-dance-receptor="left"]') as HTMLElement;
    expect(receptor).toHaveAttribute('data-active', 'true');
    expect(receptor.className).not.toContain('dance-receptor-pulse');
    expect(receptor.querySelector('[data-dance-pulse="left"]')?.className).toContain(
      'dance-receptor-pulse',
    );
  });

  it('does not pulse a receptor for a note nobody touched', async () => {
    const { audio } = await play();
    // Walk past the first note without pressing anything: it expires as a miss.
    await tick(audio, TINY_CHART.notes[0].timeMs + 400);

    expect(document.querySelector('[data-dance-judgment]')?.textContent).toBe('Miss');
    const left = document.querySelector('[data-dance-pulse="left"]') as HTMLElement;
    expect(left.className).not.toContain('dance-receptor-pulse');
    // The lane still flashes — the player is told WHERE it went wrong.
    const flash = document.querySelector('[data-dance-lane-flash="left"]') as HTMLElement;
    expect(flash.className).toContain('dance-lane-flash');
  });

  it('scores exactly the same whether or not a decoration ran', async () => {
    // Reduced motion suppresses every animation above. The score must not move
    // by one point because of it — decoration is decoration.
    setReducedMotion(true);
    const { audio } = await play();
    audio.setSongTime(TINY_CHART.notes[0].timeMs);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
    });

    const readout = document.querySelector('[data-dance-judgment]') as HTMLElement;
    expect(readout.textContent).toBe('Perfect!');
    expect(readout.className).not.toContain('dance-judgment-pop');
    const left = document.querySelector('[data-dance-pulse="left"]') as HTMLElement;
    expect(left.className).not.toContain('dance-receptor-pulse');
    expect(
      (document.querySelector('[data-dance-lane-flash="left"]') as HTMLElement).className,
    ).not.toContain('dance-lane-flash');
    // The mascot still stops dancing, because that is a class the stage adds —
    // but the reaction, which is information, still lands.
    expect(document.querySelector('[data-dance-mascot]')).toHaveAttribute('data-mood', 'perfect');
    expect(audio.engine.blips).toBe(1);
  });

  it('grows the combo without moving anything', async () => {
    const { audio } = await play();
    const box = document.querySelector('[data-dance-combo]') as HTMLElement;
    // A fixed box. Every tier scales its CONTENTS; none of them resizes this.
    expect(box.className).toMatch(/\bh-8\b/);
    expect(box.className).toMatch(/\bw-24\b/);

    audio.setSongTime(TINY_CHART.notes[0].timeMs);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
    });
    await tick(audio, TINY_CHART.notes[0].timeMs);
    expect(box.textContent).toContain('1');
  });

  it('counts a combo up through its tiers', () => {
    // The tier table itself, so the thresholds are pinned rather than eyeballed.
    expect(comboTier(0).id).toBe('none');
    expect(comboTier(1).id).toBe('none');
    expect(comboTier(2).id).toBe('start');
    expect(comboTier(10).id).toBe('hot');
    expect(comboTier(20).id).toBe('blazing');
    expect(comboTier(40).id).toBe('unreal');
    // The lowest tier hides the number rather than showing a meaningless zero.
    expect(comboTier(0).className).toContain('text-transparent');
  });

  it('presents the countdown as a countdown, and hands over to the run', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, 0);

    const countdown = document.querySelector('[data-dance-countdown]') as HTMLElement;
    expect(countdown).not.toBeNull();
    expect(countdown.textContent).toMatch(/get ready/i);
    expect(countdown).toHaveAttribute('role', 'status');

    // One bar of lead-in at 120 BPM: the last three beats are 3, 2, 1.
    const beat = NEON_HOP_TRACK.leadInMs / 4;
    await tick(audio, NEON_HOP_TRACK.leadInMs - 3 * beat + 1);
    expect(document.querySelector('[data-dance-countdown]')?.textContent).toMatch(/3$/);

    await tick(audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));
    expect(document.querySelector('[data-dance-countdown]')).toBeNull();
  });

  it('keeps a live run from scrolling under the player', async () => {
    await play();
    const content = document.querySelector('[data-arcade-content]') as HTMLElement;
    expect(content.className).toContain('overflow-hidden');
  });
});

// ── Imperative DOM writes versus React ownership ────────────────────────────

/**
 * The playfield paints itself by writing `className`, `textContent`, `style` and
 * data attributes straight onto DOM nodes from inside the frame loop, because a
 * React render per hit at up to eight hits a second would put reconciliation on
 * the same thread as the input handler.
 *
 * That only works while React has **no opinion** about the properties being
 * written. React rewrites a DOM property when the corresponding prop differs
 * between renders — so an imperative write survives only if the element's props
 * are unchanged, or if React never rendered that property at all.
 *
 * Today every one of these holds. None of them is enforced by anything but the
 * shape of the JSX: making one `className` conditional (a `reducedMotion`
 * branch, a status tint, a new variant) would silently start erasing whatever
 * the frame loop had just painted, and the symptom would be an animation that
 * "sometimes doesn't fire" rather than a failing build. That has already
 * happened once in this file's history — the receptor pulse was originally
 * written onto the element whose className flips when a lane is held, so it was
 * wiped by the render its own key press caused.
 *
 * These tests pin each surface against the re-renders that actually occur.
 */
describe('imperative DOM writes survive the re-renders that really happen', () => {
  /** Everything the frame loop owns, read straight off the DOM. */
  function painted() {
    const note = document.querySelector('[data-dance-note]') as HTMLElement | null;
    return {
      noteTransform: note?.style.transform ?? null,
      noteOpacity: note?.style.opacity ?? null,
      judgmentText: document.querySelector('[data-dance-judgment]')?.textContent ?? null,
      judgmentClass: (document.querySelector('[data-dance-judgment]') as HTMLElement | null)
        ?.className,
      pulseClass: (document.querySelector('[data-dance-pulse="left"]') as HTMLElement | null)
        ?.className,
      flashClass: (document.querySelector('[data-dance-lane-flash="left"]') as HTMLElement | null)
        ?.className,
      mood: document.querySelector('[data-dance-mascot]')?.getAttribute('data-mood') ?? null,
      comboValue: document.querySelector('[data-dance-combo]')?.textContent ?? null,
      comboClass: (
        document.querySelector('[data-dance-combo] > div > div') as HTMLElement | null
      )?.className,
      fieldClass: (document.querySelector('[data-dance-field]') as HTMLElement | null)?.className,
      progressWidth: (document.querySelector('[data-dance-progress]') as HTMLElement | null)?.style
        .width,
    };
  }

  /**
   * Paint every surface, then freeze the loop.
   *
   * Pausing stops the frame loop, so nothing repaints — which is what makes the
   * assertion meaningful. If React wipes a property, it stays wiped, and there
   * is no 16 ms later redraw to hide it.
   */
  async function paintThenFreeze(chart: DanceChart, hits: number) {
    const view = await play({ chart });
    const notes = chart.notes.slice(0, hits);
    for (const note of notes) {
      view.audio.setSongTime(note.timeMs);
      const key = { left: 'ArrowLeft', down: 'ArrowDown', up: 'ArrowUp', right: 'ArrowRight' }[
        note.lane
      ];
      await act(async () => {
        fireEvent.keyDown(window, { key });
        fireEvent.keyUp(window, { key });
      });
    }
    // One more frame so the loop writes score, combo, progress and note positions
    // for the state the hits just produced.
    await tick(view.audio, notes[notes.length - 1].timeMs + 1);
    // A hit right on the freeze, so the transient surfaces (judgement word,
    // pulse, flash, mood) are still live when the loop stops.
    // A ghost input paints nothing, so the freezing hit must be a real LEFT
    // note — that is the lane whose pulse and flash these tests read.
    const left = chart.notes.slice(hits).find((note) => note.lane === 'left');
    if (!left) throw new Error('the chart has no left note left to freeze on');
    view.audio.setSongTime(left.timeMs);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
    });
    // One more frame, close enough that the judgement flash (420 ms) is still
    // live, so every note that has just entered the drawn window gets its first
    // position write before the loop stops. A note is mounted by the render that
    // follows the frame which decided it was visible, so it is positioned one
    // frame later — expected, and invisible in play because a newcomer belongs
    // at the top of the field anyway.
    await tick(view.audio, left.timeMs + 50);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^pause/i }));
    });
    expect(shell()).toHaveAttribute('data-arcade-status', 'paused');
    return view;
  }

  it('survives a pause, a mute toggle and a resume — nothing React renders is wiped', async () => {
    await paintThenFreeze(COMBO_CHART, 20);
    const before = painted();

    // Sanity: there is actually something to lose.
    expect(before.noteTransform).toMatch(/translate3d/);
    expect(before.judgmentText).toBeTruthy();
    expect(before.pulseClass).toContain('dance-receptor-pulse');
    expect(before.flashClass).toContain('dance-lane-flash');
    expect(before.mood).not.toBe('idle');
    expect(before.comboValue).toMatch(/\d/);
    expect(before.progressWidth).toBeTruthy();

    // Every re-render cause available while frozen: a prop change from the
    // controller (mute), and a lifecycle change (resume, which also clears the
    // held-lane set and rewrites every receptor's className).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /mute the music/i }));
    });
    const afterMute = painted();
    expect(afterMute).toEqual(before);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /mute the music/i }));
    });
    expect(painted()).toEqual(before);
  });

  it('survives a held lane — the render a key press causes must not erase its own feedback', async () => {
    const view = await paintThenFreeze(COMBO_CHART, 20);
    const before = painted();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^resume/i }));
    });
    // Hold a lane WITHOUT releasing: `activeLanes` gains a member, which changes
    // every receptor's className prop and re-renders the field's whole subtree.
    view.audio.setSongTime(COMBO_CHART.notes[23].timeMs + 5_000); // far from any note
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^pause/i }));
    });

    const after = painted();
    // The receptor React DID rewrite is a different element from the pulse.
    expect(after.pulseClass).toBe(before.pulseClass);
    expect(after.flashClass).toBe(before.flashClass);
    expect(after.comboClass).toBe(before.comboClass);
    expect(after.fieldClass).toBe(before.fieldClass);
    expect(after.mood).toBe(before.mood);
  });

  it('keeps the combo tier class and the field emphasis ring across re-renders', async () => {
    await paintThenFreeze(COMBO_CHART, 20);
    const before = painted();

    // 20+ hits is the `blazing` tier, which is the first one that rings the
    // field — the only imperative write that goes through `classList` rather
    // than a whole `className` assignment.
    expect(before.comboClass).toContain('scale-125');
    expect(before.fieldClass).toContain('ring-fuchsia-300/35');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /mute the music/i }));
    });
    const after = painted();
    expect(after.comboClass).toContain('scale-125');
    expect(after.fieldClass).toContain('ring-fuchsia-300/35');
  });

  it('keeps note transforms across a visible-note membership change', async () => {
    // The one React state the frame loop touches. When it changes, the note list
    // re-renders and every surviving note's ref is detached and re-attached.
    const view = await play({ chart: COMBO_CHART });
    await tick(view.audio, COMBO_CHART.notes[0].timeMs);
    const first = document.querySelector('[data-dance-note]') as HTMLElement;
    const id = first.getAttribute('data-dance-note');
    const before = first.style.transform;
    expect(before).toMatch(/translate3d/);

    // Advance far enough to add and drop notes from the drawn window. Two
    // frames, because membership is decided by a React render and the positions
    // are written by the frame AFTER the one that mounted a newcomer.
    await tick(view.audio, COMBO_CHART.notes[6].timeMs);
    await tick(view.audio, COMBO_CHART.notes[6].timeMs);
    const same = document.querySelector(`[data-dance-note="${id}"]`) as HTMLElement | null;
    if (same) {
      // Still on screen: it must have kept a transform, and a MOVED one.
      expect(same.style.transform).toMatch(/translate3d/);
      expect(same.style.transform).not.toBe(before);
    }
    // Whatever is on screen now is positioned, not stuck at the origin.
    for (const note of document.querySelectorAll('[data-dance-note]')) {
      expect((note as HTMLElement).style.transform).toMatch(/translate3d/);
    }
  });
});

// ── The Blobbi ──────────────────────────────────────────────────────────────

describe('the Blobbi on stage', () => {
  it('is decoration: hidden from assistive technology and untouchable', async () => {
    await play();
    const mascot = document.querySelector('[data-dance-mascot]') as HTMLElement;
    expect(mascot).not.toBeNull();
    expect(mascot).toHaveAttribute('aria-hidden');
    expect(mascot.className).toContain('pointer-events-none');
    // It contains nothing focusable, so it can never take a lane press.
    expect(mascot.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
  });

  it('sits outside the note highway, so it cannot cover a note', async () => {
    await play();
    const mascot = document.querySelector('[data-dance-mascot]') as HTMLElement;
    const field = document.querySelector('[data-dance-field]') as HTMLElement;
    expect(field.contains(mascot)).toBe(false);
  });

  it('reacts to a hit and settles back to idle', async () => {
    const { audio } = await play();
    const mascot = document.querySelector('[data-dance-mascot]') as HTMLElement;
    expect(mascot).toHaveAttribute('data-mood', 'idle');

    audio.setSongTime(TINY_CHART.notes[0].timeMs);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
    });
    expect(mascot).toHaveAttribute('data-mood', 'perfect');

    await tick(audio, TINY_CHART.notes[0].timeMs + 1_000);
    expect(mascot).toHaveAttribute('data-mood', 'idle');
  });
});

// ── The results screen ──────────────────────────────────────────────────────

describe('the results screen', () => {
  it('leads with the outcome and shows every metric a player earned', async () => {
    await playToResults();
    const results = document.querySelector('[data-dance-results]') as HTMLElement;

    expect(results.querySelector('[data-dance-grade="S"]')).not.toBeNull();
    expect(within(results).getByText('100%')).toBeInTheDocument();
    expect(within(results).getByText('Accuracy')).toBeInTheDocument();
    expect(within(results).getByText('Best combo')).toBeInTheDocument();
    for (const label of ['Perfect', 'Good', 'Okay', 'Missed']) {
      expect(within(results).getByText(label)).toBeInTheDocument();
    }
    // A sentence, not just a letter: a grade means nothing on a first play.
    expect(within(results).getByText(/flawless dancing/i)).toBeInTheDocument();
  });

  it('shows the earned quantity and a status that does not claim success', async () => {
    await playToResults();
    const panel = document.querySelector('[data-dance-reward]') as HTMLElement;
    expect(panel).toHaveAttribute('data-dance-reward', 'idle');
    expect(within(panel).getByText('8')).toBeInTheDocument();
    expect(panel.querySelector('[data-dance-reward-chip]')?.textContent).toMatch(
      /ready to collect/i,
    );
    // Nothing on an unclaimed panel may suggest the tickets are already saved.
    expect(panel.textContent).not.toMatch(/added to your inventory/i);
    expect(screen.getByRole('button', { name: /claim 8 tickets/i })).toBeInTheDocument();
  });

  it('keeps every claim state visually distinct, and honest about what it knows', async () => {
    // Confirmed: the balance moved and was read back.
    const writer = createFakeWriter({ quantities: [0, 8] });
    await playToResults({ writer });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /claim 8 tickets/i }));
    });
    await waitFor(() =>
      expect(document.querySelector('[data-dance-reward]')).toHaveAttribute(
        'data-dance-reward',
        'confirmed',
      ),
    );
    const panel = document.querySelector('[data-dance-reward]') as HTMLElement;
    expect(panel.querySelector('[data-dance-reward-chip]')?.textContent).toMatch(
      /in your inventory/i,
    );
    expect(document.querySelector('[data-dance-claim]')).toBeNull();
    expect(writer.publishCount()).toBe(1);
  });

  it('never says "saved" for an unresolved claim, and offers only a read-only check', async () => {
    // THE regression, restated in the presentation suite: prettier panels are
    // exactly where this sentence would sneak back in.
    const writer = createFakeWriter({ quantities: [0, 3] });
    await playToResults({ writer });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /claim 8 tickets/i }));
    });
    await waitFor(() =>
      expect(document.querySelector('[data-dance-reward]')).toHaveAttribute(
        'data-dance-reward',
        'unresolved',
      ),
    );

    const panel = document.querySelector('[data-dance-reward]') as HTMLElement;
    expect(panel.querySelector('[data-dance-reward-chip]')?.textContent).toMatch(/not confirmed/i);
    expect(panel.textContent).not.toMatch(/in your inventory/i);
    expect(panel.textContent).not.toMatch(/added to your inventory/i);
    expect(panel.textContent).not.toMatch(/saved/i);

    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /claim 8 tickets/i })).toBeNull();
    expect(screen.getByRole('button', { name: /check ticket status/i })).toBeInTheDocument();
    expect(writer.publishCount()).toBe(1);
  });

  it('distinguishes a provable pre-publish failure, which MAY be retried', async () => {
    const writer = createFakeWriter({
      publishError: Object.assign(new Error('signer said no'), { code: 'sign-failed' }),
    });
    await playToResults({ writer });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /claim 8 tickets/i }));
    });
    await waitFor(() =>
      expect(document.querySelector('[data-dance-reward]')).toHaveAttribute(
        'data-dance-reward',
        'unresolved',
      ),
    );
    // An unclassified throw is treated as unsafe-to-retry, which is the correct
    // default and the reason this assertion reads the way it does.
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('explains a zero-ticket run gently, and offers no claim at all', async () => {
    // A run that never reached the end of the song: the policy refuses it, and
    // the screen says why without scolding.
    const view = await play();
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

    // An aborted run has NO result at all, which is the strongest form of the
    // same rule: nothing to claim, and nothing pretending otherwise.
    expect(shell()).toHaveAttribute('data-arcade-status', 'aborted');
    expect(document.querySelector('[data-dance-claim]')).toBeNull();
    expect(document.querySelector('[data-dance-reward]')).toBeNull();
    expect(view.audio.engine.state).toBe('stopped');
  });

  it('makes the status chip a readout, never a control', async () => {
    // A chip that could be clicked into a different claim state would be a way
    // around the ledger. It is a `<span>` with no handler, and the panel's only
    // buttons are the two the phase allows.
    await playToResults();
    const chip = document.querySelector('[data-dance-reward-chip]') as HTMLElement;
    expect(chip.tagName).toBe('SPAN');
    expect(chip).not.toHaveAttribute('role');
    expect(chip).not.toHaveAttribute('tabindex');
    expect(chip.querySelector('button, a, input')).toBeNull();

    const panel = document.querySelector('[data-dance-reward]') as HTMLElement;
    expect(panel.querySelectorAll('button')).toHaveLength(1);
  });

  it('keeps protocol trivia out of a player’s results', async () => {
    await playToResults({ writer: createFakeWriter({ quantities: [0, 8] }) });
    expect(document.querySelector('[data-dance-reward-policy]')).toBeNull();
    expect(screen.queryByText(/blobbi-dance-tickets/)).toBeNull();
  });

  it('replays into a brand-new run', async () => {
    await playToResults();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /play again/i }));
    });
    expect(shell()).toHaveAttribute('data-arcade-status', 'countdown');
    expect(document.querySelector('[data-dance-results]')).toBeNull();
  });
});

// ── Reduced motion ──────────────────────────────────────────────────────────

describe('reduced motion removes decoration and nothing else', () => {
  it('keeps every informational surface, and the run itself, intact', async () => {
    setReducedMotion(true);
    const view = await play({ chart: COMBO_CHART });
    expect(document.querySelector('[data-dance-stage]')).toHaveAttribute(
      'data-reduced-motion',
      'true',
    );

    // Hold a lane: the held-lane indication is a cue, not a flourish.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(document.querySelector('[data-dance-receptor="right"]')).toHaveAttribute(
      'data-active',
      'true',
    );
    await act(async () => {
      fireEvent.keyUp(window, { key: 'ArrowRight' });
    });

    // Hit two notes: judgement word, score, combo and mascot mood all still work.
    for (const note of COMBO_CHART.notes.slice(0, 2)) {
      view.audio.setSongTime(note.timeMs);
      const key = { left: 'ArrowLeft', down: 'ArrowDown', up: 'ArrowUp', right: 'ArrowRight' }[
        note.lane
      ];
      await act(async () => {
        fireEvent.keyDown(window, { key });
        fireEvent.keyUp(window, { key });
      });
    }
    await tick(view.audio, COMBO_CHART.notes[1].timeMs + 10);

    const readout = document.querySelector('[data-dance-judgment]') as HTMLElement;
    expect(readout.textContent).toBe('Perfect!');
    expect(readout.className).not.toContain('dance-judgment-pop');
    expect(document.querySelector('[data-dance-combo]')?.textContent).toContain('2');
    expect(document.querySelector('[data-dance-mascot]')).toHaveAttribute('data-mood', 'perfect');
    expect(
      (document.querySelector('[data-dance-progress]') as HTMLElement).style.width,
    ).toBeTruthy();
    // Notes still move — that is the gameplay, not a decoration.
    expect((document.querySelector('[data-dance-note]') as HTMLElement).style.transform).toMatch(
      /translate3d/,
    );
  });

  it('still counts the countdown down, without the tick animation', async () => {
    setReducedMotion(true);
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    const beat = NEON_HOP_TRACK.leadInMs / 4;
    await tick(audio, NEON_HOP_TRACK.leadInMs - 3 * beat + 1);

    const countdown = document.querySelector('[data-dance-countdown]') as HTMLElement;
    expect(countdown.textContent).toMatch(/get ready/i);
    expect(countdown.textContent).toMatch(/3$/);
    expect(countdown.innerHTML).not.toContain('dance-countdown-tick');
  });

  it('produces the same result values as a run with every animation on', async () => {
    // The proof that reduced motion is presentation-only: identical inputs at
    // identical clock positions must produce an identical result.
    const scoreFor = async (reduced: boolean) => {
      setReducedMotion(reduced);
      const view = await playToResults();
      const results = document.querySelector('[data-dance-results]') as HTMLElement;
      const summary = within(results).getAllByRole('status')[0].textContent;
      view.unmount();
      return summary;
    };
    const withMotion = await scoreFor(false);
    const withoutMotion = await scoreFor(true);
    expect(withoutMotion).toBe(withMotion);
  });
});

// ── Styles that must actually exist ─────────────────────────────────────────

/**
 * A Tailwind class that is not in the generated stylesheet fails SILENTLY.
 *
 * Nothing throws, nothing logs, the class sits in the DOM and simply has no
 * rule behind it — so the only symptom is a colour that never appears. That is
 * hard enough to notice in review at the best of times, and these classes are
 * worse than average: most of them live as bare strings in `dance-visuals.ts`
 * and are applied by the frame loop, so a reviewer never sees them next to the
 * markup they style.
 *
 * This caught a real one: the results screen's judgement-count tiles were
 * written `bg-emerald-500/12`. The colour-opacity modifier resolves against the
 * `opacity` theme scale, `12` is not on it, and all four tiles shipped with no
 * background at all.
 */
describe('the styles the frame loop applies', () => {
  const DANCE_DIR = join(process.cwd(), 'src/components/blobbi/arcade/dance');
  const SOURCES = readdirSync(DANCE_DIR)
    .filter((name) => /\.(ts|tsx)$/.test(name) && !name.includes('.test.'))
    .concat([]);

  /** Tailwind's default `opacity` scale: 0 and every multiple of five to 100. */
  const OPACITY_SCALE = new Set(Array.from({ length: 21 }, (_, i) => i * 5));

  it('only uses colour-opacity modifiers Tailwind actually generates', () => {
    const offenders: string[] = [];
    for (const name of SOURCES) {
      const source = readFileSync(join(DANCE_DIR, name), 'utf8');
      const matches = source.matchAll(
        /\b(?:bg|text|border|ring|from|via|to|outline|divide|shadow|fill|stroke)-(?:white|black|[a-z]+-\d{2,3}|island-[a-z0-9-]+)\/(\d+)\b/g,
      );
      for (const match of matches) {
        // `/[12%]` — an arbitrary value in brackets — is always generated; only
        // the bare-number form has to be on the scale.
        if (!OPACITY_SCALE.has(Number(match[1]))) offenders.push(`${name}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('names every animation it toggles imperatively in the stylesheet', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    // The classes the frame loop adds and removes by hand. A rename in the
    // stylesheet without a rename here is a decoration that silently stops.
    for (const name of [
      'dance-judgment-pop',
      'dance-receptor-pulse',
      'dance-lane-flash',
      'dance-combo-bump',
      'dance-countdown-tick',
      'dance-mascot-bob',
      'dance-bulb',
      'dance-spark',
      'dance-touch-lane',
    ]) {
      expect(css, `${name} is used in TSX but has no rule in index.css`).toContain(`.${name}`);
    }
  });

  it('suppresses every one of them under prefers-reduced-motion, in CSS as well as in React', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    const block = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    for (const name of [
      'dance-judgment-pop',
      'dance-receptor-pulse',
      'dance-lane-flash',
      'dance-combo-bump',
      'dance-countdown-tick',
      'dance-mascot-bob',
      'dance-bulb',
    ]) {
      expect(block, `${name} is not disabled under reduced motion`).toContain(name);
    }
    // The two things that must NOT be in that block, because they are the
    // gameplay rather than decoration.
    expect(block).not.toContain('data-dance-note');
    expect(block).not.toContain('data-dance-field');
  });
});

// ── Input ───────────────────────────────────────────────────────────────────

describe('touch and keyboard', () => {
  it('counts a real tap once — pointerdown plus the synthetic click that follows', async () => {
    const { audio } = await play();
    audio.setSongTime(TINY_CHART.notes[0].timeMs);
    const left = document.querySelector('[data-dance-touch="left"]') as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(left);
      fireEvent.click(left, { detail: 1 });
    });
    expect(audio.engine.blips).toBe(1);
  });

  it('activates a focused lane button with Enter, through the keyboard path', async () => {
    const { audio } = await play();
    audio.setSongTime(TINY_CHART.notes[0].timeMs);
    const left = document.querySelector('[data-dance-touch="left"]') as HTMLElement;
    left.focus();
    // A browser turns Enter on a focused button into a click with `detail === 0`,
    // which is precisely the branch the handler keeps for keyboard users.
    await act(async () => {
      fireEvent.click(left, { detail: 0 });
    });
    expect(audio.engine.blips).toBe(1);
  });

  it('does not double-count a lane when its button is focused and the key is pressed', async () => {
    const { audio } = await play();
    audio.setSongTime(TINY_CHART.notes[0].timeMs);
    (document.querySelector('[data-dance-touch="left"]') as HTMLElement).focus();
    await act(async () => {
      // The global listener fires; the focused button is not an Enter/Space
      // activation, so nothing else does.
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      fireEvent.keyUp(window, { key: 'ArrowLeft' });
    });
    expect(audio.engine.blips).toBe(1);
  });

  it('accepts two lanes at once — a jump chart needs simultaneous hits', async () => {
    const view = await play({ chart: COMBO_CHART });
    const a = COMBO_CHART.notes[0]; // left
    const b = COMBO_CHART.notes[1]; // down, an eighth later
    view.audio.setSongTime(a.timeMs);
    const left = document.querySelector('[data-dance-touch="left"]') as HTMLElement;
    const down = document.querySelector('[data-dance-touch="down"]') as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(left);
      fireEvent.pointerDown(down);
    });
    // Both were accepted as input; the second is judged against the same clock,
    // so it is simply early for its own note rather than lost.
    expect(view.audio.engine.blips).toBeGreaterThanOrEqual(1);
    expect(b.lane).toBe('down');
  });

  it('cannot fire from a disabled lane control', async () => {
    const { audio } = renderMachine();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await tick(audio, 0);
    const left = document.querySelector('[data-dance-touch="left"]') as HTMLButtonElement;
    expect(left.disabled).toBe(true);
    await act(async () => {
      fireEvent.pointerDown(left);
      fireEvent.click(left, { detail: 0 });
    });
    expect(audio.engine.blips).toBe(0);
  });

  it('suppresses scrolling only inside the lane controls and the live surface', async () => {
    await play();
    for (const visual of DANCE_LANE_VISUALS) {
      const button = document.querySelector(`[data-dance-touch="${visual.lane}"]`) as HTMLElement;
      expect(button.className).toContain('dance-touch-lane');
      expect(button.className).toContain('touch-none');
    }
    // The live surface cannot scroll…
    expect((document.querySelector('[data-arcade-content]') as HTMLElement).className).toContain(
      'overflow-hidden',
    );
  });

  it('lets the preview and the results scroll — they are longer than a phone', async () => {
    const content = () => document.querySelector('[data-arcade-content]') as HTMLElement;
    // ONE machine, walked through both states: mounting a second would leave two
    // shells in the document and make every query ambiguous.
    const view = await playToResults();
    expect(content().className).toContain('overflow-y-auto');
    expect(content().className).not.toContain('overflow-hidden');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /play again/i }));
    });
    await tick(view.audio, NEON_HOP_TRACK.leadInMs);
    await waitFor(() => expect(shell()).toHaveAttribute('data-arcade-status', 'playing'));
    expect(content().className).toContain('overflow-hidden');
  });
});

// ── Narrow layouts ──────────────────────────────────────────────────────────

describe('a narrow layout', () => {
  /**
   * jsdom has no layout engine, so "does it overflow at 320 px?" is not a
   * question a unit test can answer — that one is checked in a real browser and
   * written down in `docs/blobbi-dance.md`.
   *
   * What IS checkable, and what actually regresses, is that the controls a
   * player cannot finish without are present and reachable in every state, and
   * that the touch targets are declared large enough to hit.
   */
  it('keeps a way out, and a way to play, on the start screen', () => {
    renderMachine();
    expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /leave/i })).toBeInTheDocument();
  });

  it('keeps pause and leave reachable during a run', async () => {
    await play();
    expect(screen.getByRole('button', { name: /^pause/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /leave/i })).toBeInTheDocument();
  });

  it('gives every lane control a target no smaller than the touch minimum', async () => {
    await play();
    for (const visual of DANCE_LANE_VISUALS) {
      const button = document.querySelector(`[data-dance-touch="${visual.lane}"]`) as HTMLElement;
      // h-14 is 56 px, comfortably over the 44 px floor the input map states.
      expect(button.className).toMatch(/\bh-14\b/);
      // No text selection and no page scroll started from inside a lane.
      expect(button.className).toContain('dance-touch-lane');
      expect(button.className).toContain('select-none');
    }
  });

  it('keeps the claim and replay actions reachable on the results screen', async () => {
    await playToResults();
    expect(screen.getByRole('button', { name: /claim 8 tickets/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /play again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument();
    // Both reward actions declare a 44 px minimum height rather than relying on
    // padding that a long translation could squeeze out.
    const claim = document.querySelector('[data-dance-claim]') as HTMLElement;
    expect(claim.className).toContain('min-h-[44px]');
  });
});
