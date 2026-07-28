/**
 * `<ArcadeRoom>` integration coverage.
 *
 * The audit's browser session found: nine machines that all opened one "Dance
 * Dance Blobbi" modal (pool table and air hockey included), a PRIZES counter
 * whose only effect was a `console.log`, a microphone with a hover-scale and no
 * handler, and thirty decorative sprites announcing themselves as a ticket
 * counter. Everything below is one of those.
 *
 * The room is rendered with a stubbed `usePendingInteraction` so arrival can be
 * driven explicitly — that is the whole point of the contract being tested.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

import { ArcadeRoom } from './ArcadeRoom';
import { arcadeMachines, type ArcadeFloorId } from '@/lib/arcade-machines-config';
import { arcadePropsByFloor } from '@/lib/arcade-room-config';
import { clearArcadePass, grantArcadePass } from '@/lib/arcade-pass';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import type { MovableBlobbiRef } from '../MovableBlobbi';

// ---------------------------------------------------------------------------
// The room's collaborators are stubbed so this file tests the ROOM, not the
// movement system (covered by usePendingInteraction) or the pass economy
// (covered by ArcadePassModal.test.tsx).
// ---------------------------------------------------------------------------

const requests: RequestInteractionOptions[] = [];

vi.mock('@/hooks/usePendingInteraction', () => ({
  usePendingInteraction: () => ({
    requestInteraction: (opts: RequestInteractionOptions) => requests.push(opts),
    cancel: () => {},
    hasPending: () => requests.length > 0,
  }),
}));

const setCurrentLocation = vi.fn();
vi.mock('@/hooks/useLocation', () => ({
  useLocation: () => ({
    currentLocation: 'arcade',
    previousLocation: null,
    setCurrentLocation,
    setIsMapModalOpen: vi.fn(),
  }),
}));

vi.mock('../ArcadePassModal', () => ({
  ArcadePassModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="pass-modal" /> : null,
}));
vi.mock('../ElevatorModal', () => ({
  ElevatorModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="elevator-modal" /> : null,
}));
vi.mock('../NoPassModal', () => ({
  NoPassModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="no-pass-modal" /> : null,
}));

const SURFACE_RECT = {
  width: 1000,
  height: 1000,
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 1000,
  bottom: 1000,
  toJSON: () => ({}),
} as DOMRect;

const ELEMENT_RECT = {
  width: 100,
  height: 150,
  x: 300,
  y: 600,
  top: 600,
  left: 300,
  right: 400,
  bottom: 750,
  toJSON: () => ({}),
} as DOMRect;

function renderRoom(floor: ArcadeFloorId) {
  const blobbiRef = { current: null } as React.RefObject<MovableBlobbiRef>;
  const utils = render(
    <div data-world-surface>
      <ArcadeRoom blobbiRef={blobbiRef} floor={floor} selectedBlobbiId="test-blobbi" />
    </div>,
  );

  const surface = utils.container.querySelector('[data-world-surface]') as HTMLElement;
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(SURFACE_RECT);
  // Every element in the room reports the same plausible rect, so the walk
  // target is always computable.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this === surface ? SURFACE_RECT : ELEMENT_RECT;
  });

  return utils;
}

/** Click something and let the movement system report arrival. */
function clickAndArrive(element: HTMLElement) {
  const before = requests.length;
  fireEvent.click(element);
  if (requests.length === before) return false;
  act(() => requests[requests.length - 1].action());
  return true;
}

const shell = () => document.querySelector('[data-arcade-shell]') as HTMLElement | null;
/** The panel inside the shell — the shell's own title bar repeats the name. */
const panel = () => document.querySelector('[data-arcade-panel]') as HTMLElement | null;

beforeEach(() => {
  requests.length = 0;
  clearArcadePass();
  setCurrentLocation.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearArcadePass();
});

describe('every machine has its own honest identity', () => {
  it.each(arcadeMachines.filter((m) => m.floor === 'floor-1').map((m) => [m.id, m] as const))(
    '%s opens its own panel, not a dance game',
    (_id, machine) => {
      renderRoom('floor-1');

      const el = screen.getByRole('button', { name: machine.alt });
      expect(clickAndArrive(el)).toBe(true);

      expect(within(panel()!).getByText(machine.displayName)).toBeInTheDocument();
      expect(within(panel()!).getByText(machine.blurb)).toBeInTheDocument();
      expect(shell()).toHaveAttribute('data-arcade-machine', machine.id);
      expect(screen.getByRole('dialog', { name: machine.displayName })).toBeInTheDocument();
      // No coming-soon machine may claim to be the dance game.
      expect(shell()!.getAttribute('data-arcade-game')).toBeNull();
      expect(shell()!.textContent).not.toMatch(/Dance Dance Blobbi/);
      expect(panel()).toHaveAttribute('data-arcade-panel', 'coming-soon');
    },
  );

  it('opens the dance machine preview, honestly labelled', () => {
    renderRoom('basement');

    const el = screen.getByRole('button', { name: /dance machine/i });
    expect(clickAndArrive(el)).toBe(true);

    expect(shell()).toHaveAttribute('data-arcade-game', 'blobbi-dance');
    expect(panel()).toHaveAttribute('data-arcade-panel', 'preview');
    expect(
      screen.getByRole('dialog', { name: 'Dance Dance Blobbi' }),
    ).toBeInTheDocument();
    expect(
      within(panel()!).getByText('Rhythm game coming in the next arcade update.'),
    ).toBeInTheDocument();
    // Honest: a preview, not a playable game. Nothing starts anything.
    expect(within(shell()!).queryByRole('button', { name: /start/i })).toBeNull();
    expect(within(shell()!).queryByRole('button', { name: /^play/i })).toBeNull();
  });

  it('announces the coming-soon state rather than only showing it', () => {
    renderRoom('floor-1');
    clickAndArrive(screen.getByRole('button', { name: /pool table/i }));

    const status = within(shell()!).getByRole('status');
    expect(status).toHaveTextContent('Pool Table');
    expect(status).toHaveTextContent(/not/i);
  });
});

describe('nothing opens before the Blobbi arrives', () => {
  it('only requests a walk on click', () => {
    renderRoom('floor-1');

    fireEvent.click(screen.getByRole('button', { name: /pink arcade cabinet/i }));

    expect(requests).toHaveLength(1);
    expect(shell()).toBeNull();
  });

  it('opens nothing when the walk is cancelled', () => {
    renderRoom('floor-1');

    fireEvent.click(screen.getByRole('button', { name: /pink arcade cabinet/i }));
    act(() => requests[0].onCancel?.());

    expect(shell()).toBeNull();
  });

  it('closes the shell without leaving anything mounted', () => {
    renderRoom('basement');
    clickAndArrive(screen.getByRole('button', { name: /dance machine/i }));
    expect(shell()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    expect(shell()).toBeNull();
    expect(document.querySelector('[data-arcade-panel]')).toBeNull();
  });
});

describe('dead affordances are gone', () => {
  it('walks to the prize counter and tells the truth about it', () => {
    renderRoom('ground');

    const counter = screen.getByAltText('Prize counter');
    expect(clickAndArrive(counter.parentElement as HTMLElement)).toBe(true);

    expect(screen.getByRole('dialog', { name: 'Prize Counter' })).toBeInTheDocument();
    expect(within(panel()!).getByText(/not open yet/i)).toBeInTheDocument();
  });

  it('renders the stage microphone as scenery, with no affordance at all', () => {
    const { container } = renderRoom('basement');

    const mic = container.querySelector('[data-arcade-prop="stage-microphone"]') as HTMLElement;
    expect(mic).toBeInTheDocument();
    expect(mic).toHaveAttribute('alt', '');
    expect(mic).toHaveAttribute('aria-hidden');
    expect(mic.className).not.toContain('cursor-pointer');
    expect(mic.className).not.toContain('hover:scale');
    expect(mic.closest('[data-block-move]')).toBeNull();
  });
});

describe('decoration is decoration', () => {
  it.each(['ground', 'floor-1', 'basement'] as const)(
    'labels no %s sprite as a ticket counter',
    (floor) => {
      const { container } = renderRoom(floor);

      expect(screen.queryAllByAltText('ticket counter')).toHaveLength(0);

      for (const prop of arcadePropsByFloor[floor]) {
        const el = container.querySelector(`[data-arcade-prop="${prop.id}"]`);
        expect(el, prop.id).toBeInTheDocument();
        expect(el).toHaveAttribute('alt', '');
        expect(el).toHaveAttribute('aria-hidden');
      }
    },
  );

  it('gives the four basement chairs four different names', () => {
    renderRoom('basement');
    const chairAlts = screen
      .getAllByRole('img')
      .map((img) => img.getAttribute('alt'))
      .filter((alt): alt is string => alt !== null && /chair/i.test(alt));

    expect(chairAlts).toHaveLength(4);
    expect(new Set(chairAlts).size).toBe(4);
  });
});

describe('elevator', () => {
  it('gates on the pass and never opens both modals', () => {
    renderRoom('ground');

    const leftDoor = screen.getByAltText('Elevator, left door').parentElement!
      .parentElement as HTMLElement;
    expect(clickAndArrive(leftDoor)).toBe(true);

    expect(screen.getByTestId('no-pass-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('elevator-modal')).toBeNull();
  });

  it('opens the floor selector once a pass is held', () => {
    grantArcadePass();
    renderRoom('ground');

    const leftDoor = screen.getByAltText('Elevator, left door').parentElement!
      .parentElement as HTMLElement;
    clickAndArrive(leftDoor);

    expect(screen.getByTestId('elevator-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('no-pass-modal')).toBeNull();
  });

  it('blocks the raw world walk on the sliding doors', () => {
    const { container } = renderRoom('ground');
    const surface = container.querySelector('[data-world-surface]') as HTMLElement;

    let worldMoves = 0;
    const worldListener = (ev: Event) => {
      if ((ev.target as Element).closest?.('[data-block-move]')) return;
      worldMoves += 1;
    };
    surface.addEventListener('pointerdown', worldListener);
    surface.addEventListener('touchstart', worldListener);

    const doorWrapper = screen.getByAltText('Elevator, left door').parentElement!
      .parentElement as HTMLElement;

    // The `slide` branch used to have no data-block-move, no touch handler and
    // no pointer stop-propagation, so a tap started BOTH a raw world walk and a
    // walk-to-interact, and the two raced.
    expect(doorWrapper).toHaveAttribute('data-block-move');
    fireEvent.pointerDown(doorWrapper, { bubbles: true });
    fireEvent.touchStart(doorWrapper);
    expect(worldMoves).toBe(0);
    // The touch produced exactly one pending interaction, not two.
    expect(requests).toHaveLength(1);
  });
});

describe('ticket counter', () => {
  it('opens the pass modal only after arrival', () => {
    renderRoom('ground');

    const window_ = screen.getByAltText(/buy an Arcade Pass/i).parentElement as HTMLElement;
    fireEvent.click(window_);
    expect(screen.queryByTestId('pass-modal')).toBeNull();

    act(() => requests[0].action());
    expect(screen.getByTestId('pass-modal')).toBeInTheDocument();
  });

  it('does not mount the pass modal while it is closed', () => {
    renderRoom('ground');
    expect(screen.queryByTestId('pass-modal')).toBeNull();
  });
});

describe('leaving the arcade', () => {
  it('returns to town through the back arrow', () => {
    renderRoom('ground');
    const arrow = document.querySelector('[data-block-move] svg')!.parentElement as HTMLElement;
    fireEvent.click(arrow);
    expect(setCurrentLocation).toHaveBeenCalledWith('town');
  });
});
