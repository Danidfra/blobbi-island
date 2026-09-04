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
 * driven explicitly: that is the whole point of the contract being tested.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ARCADE_CATALOGUE, BLOBBI_DANCE_GAME_ID } from '@/arcade/catalogue';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

import { FREE_ARCADE_GAME_ENTRY } from '@/arcade/tokens/game-entry';

// These tests are about walking the room, opening cabinets and switching
// views: not about the arcade economy. The turnstile reads the player's
// inventory, so it is stubbed to free play here; what it actually charges is
// covered by `useArcadeGameEntry.test.tsx`.
/**
 * What the GENERIC cabinets have to play. Empty in production today, and an
 * empty catalogue makes the cabinets decoration, so the catalogue path is
 * exercised here with a stand-in shared-cabinet game.
 */
let cabinetGames: import('@/arcade/catalogue').ArcadeCatalogueEntry[] = [];
vi.mock('@/arcade/catalogue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/arcade/catalogue')>();
  return {
    ...actual,
    sharedCabinetCatalogue: () => cabinetGames,
    getCatalogueEntry: (id: string) => cabinetGames.find((e) => e.id === id) ?? actual.getCatalogueEntry(id),
  };
});

vi.mock('@/hooks/useArcadeGameEntry', () => ({
  useArcadeGameEntry: () => FREE_ARCADE_GAME_ENTRY,
}));

import { ArcadeRoom } from './ArcadeRoom';
import { arcadeMachines, type ArcadeFloorId } from '@/lib/arcade-machines-config';
import { arcadePropsByFloor } from '@/lib/arcade-room-config';
import { ELEVATOR_DOOR_TRANSITION_MS } from '@/lib/arcade-elevator-state';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import type { MovableBlobbiRef } from '../MovableBlobbi';

// ---------------------------------------------------------------------------
// The room's collaborators are stubbed so this file tests the ROOM, not the
// movement system (covered by usePendingInteraction) or the token economy
// (covered by the token store and entry-policy tests).
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

/*
  The dance machine's reward hook needs a relay pool, a query client and a login
  context. This file tests the ROOM, which machine opens what, and when, so the
  claim path is stubbed out rather than provided. It is exercised for real in
  `useArcadeReward.test.tsx` and `dance/DanceMachine.test.tsx`, both against a
  fake writer. Nothing in this file can publish.
*/
vi.mock('@/hooks/useArcadeReward', () => ({
  ARCADE_TICKET_ADDRESS: '31632:issuer:blobbi:currency:arcade-ticket',
  useArcadeReward: () => ({
    state: {
      phase: 'idle',
      claim: null,
      failure: null,
      quantity: 0,
      message: '',
      ledgerUnavailable: false,
    },
    claimReward: vi.fn(),
    reconcileClaim: vi.fn(),
    hydrate: vi.fn(),
    reset: vi.fn(),
    isAlreadyClaimed: () => false,
    isLoggedIn: false,
  }),
}));

/*
  The Prize Counter needs a query client, a relay pool and a login context for
  its balance and its redemption boundary. This file tests the ROOM; that the
  counter OPENS it: so the surface is stubbed; it is exercised for real in
  `prizes/PrizeCounter.test.tsx` against fake writers.
*/
vi.mock('./prizes/PrizeCounter', () => ({
  PrizeCounter: () => <div data-prize-counter data-testid="prize-counter-surface" />,
}));

vi.mock('./ArcadeTokenShopModal', () => ({
  ArcadeTokenShopModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="token-shop-modal" /> : null,
}));
vi.mock('../ElevatorModal', () => ({
  ElevatorModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="elevator-modal">
        <button type="button" onClick={onClose}>Close picker</button>
      </div>
    ) : null,
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
const catalogue = () => document.querySelector('[data-arcade-catalogue]') as HTMLElement | null;

beforeEach(() => {
  requests.length = 0;
  setCurrentLocation.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const GENERIC_CABINETS = [
  'arcade-cabinet-pink',
  'arcade-cabinet-black',
  'arcade-cabinet-classic',
  'arcade-cabinet-green',
  'arcade-cabinet-purple',
  'arcade-cabinet-red',
];

const withCabinetGames = () => {
  const dance = ARCADE_CATALOGUE.find((e) => e.id === BLOBBI_DANCE_GAME_ID)!;
  cabinetGames = [
    // Listed but not launchable, so the catalogue opens without offering a
    // Play control the existing assertions rule out.
    { ...dance, id: 'test-cabinet-game', title: 'Test Cabinet Game', host: 'shared-cabinet', machineIds: [], availability: 'coming-soon' } as never,
  ];
};

describe('generic cabinets with nothing to play', () => {
  beforeEach(() => {
    cabinetGames = [];
  });

  it('are decoration: no button, no walk, no catalogue', () => {
    renderRoom('floor-1');
    expect(screen.queryByRole('button', { name: /pink arcade cabinet/i })).toBeNull();
    const cabinets = document.querySelectorAll('[data-arcade-machine-decorative]');
    expect(cabinets.length).toBeGreaterThan(0);
    for (const cabinet of cabinets) {
      expect(cabinet.getAttribute('role')).toBeNull();
      expect(cabinet.className).not.toContain('cursor-pointer');
    }
    fireEvent.click(cabinets[0]);
    expect(catalogue()).toBeNull();
    expect(shell()).toBeNull();
  });

  it('the dedicated machines are unaffected', () => {
    renderRoom('floor-1');
    // The pool table shares floor 1 with the generic cabinets.
    const pool = document.querySelector('[data-arcade-machine-id="arcade-pool-table"]')!;
    expect(pool).toHaveAttribute('role', 'button');
    expect(pool).not.toHaveAttribute('data-arcade-machine-decorative');
  });
});

describe('generic cabinets open the shared catalogue', () => {
  beforeEach(() => withCabinetGames());

  it.each(GENERIC_CABINETS.map((id) => [id, arcadeMachines.find((m) => m.id === id)!] as const))(
    '%s opens the shared game list',
    (_id, machine) => {
      renderRoom(machine.floor);

      expect(clickAndArrive(screen.getByRole('button', { name: machine.alt }))).toBe(true);

      expect(shell()).toHaveAttribute('data-arcade-surface', 'catalogue');
      expect(shell()).toHaveAttribute('data-arcade-machine', machine.id);
      expect(screen.getByRole('dialog', { name: machine.displayName })).toBeInTheDocument();
      expect(catalogue()).not.toBeNull();

      // Opening a list is not opening a run: no game is mounted and the
      // lifecycle has not been touched.
      expect(shell()!.getAttribute('data-arcade-status')).toBeNull();
      expect(shell()!.getAttribute('data-arcade-game')).toBeNull();
      expect(document.querySelector('[data-dance-preview]')).toBeNull();
    },
  );

  it('never offers Blobbi Dance on a cabinet', () => {
    // The correction. Blobbi Dance belongs to the dance machine, so it is not in
    // the shared catalogue and there is no control that could start it here.
    renderRoom('floor-1');
    clickAndArrive(screen.getByRole('button', { name: /pink arcade cabinet/i }));

    expect(catalogue()!.textContent).not.toMatch(/blobbi dance/i);
    expect(within(catalogue()!).queryByRole('button', { name: /^play /i })).toBeNull();
    expect(document.querySelector('[data-catalogue-card="blobbi-dance"]')).toBeNull();
  });

  it('lists the cabinet games it has (the empty prepared state is covered on the catalogue itself)', () => {
    renderRoom('floor-1');
    clickAndArrive(screen.getByRole('button', { name: /pink arcade cabinet/i }));

    expect(catalogue()).toHaveAttribute('data-catalogue-games', '1');
    expect(within(catalogue()!).getByRole('heading', { name: 'Arcade Games' })).toBeInTheDocument();
  });

  it('explains both kinds of game in one sentence each, with no protocol talk', () => {
    renderRoom('floor-1');
    clickAndArrive(screen.getByRole('button', { name: /pink arcade cabinet/i }));

    const island = catalogue()!.querySelector('[data-catalogue-note="island"]') as HTMLElement;
    const guest = catalogue()!.querySelector('[data-catalogue-note="guest"]') as HTMLElement;
    expect(island.textContent).toMatch(/earn arcade tickets/i);
    expect(guest.textContent).toMatch(/just for fun/i);
    expect(guest.textContent).toMatch(/never give arcade tickets/i);
    expect(guest.textContent).toMatch(/coming soon/i);

    const text = catalogue()!.textContent!.toLowerCase();
    for (const jargon of ['webxdc', 'nostr', 'npub', 'kind:', 'sandbox', 'iframe', 'issuer']) {
      expect(text, jargon).not.toContain(jargon);
    }
  });

  it('closes back to the arcade room', () => {
    renderRoom('floor-1');
    clickAndArrive(screen.getByRole('button', { name: /pink arcade cabinet/i }));

    fireEvent.click(screen.getByRole('button', { name: /close and go back to the arcade/i }));
    expect(shell()).toBeNull();
    expect(catalogue()).toBeNull();
  });

  it('carries the cabinet the player chose, and resets it for the next one', () => {
    renderRoom('floor-1');
    clickAndArrive(screen.getByRole('button', { name: /pink arcade cabinet/i }));
    expect(shell()).toHaveAttribute('data-arcade-machine', 'arcade-cabinet-pink');

    fireEvent.click(screen.getByRole('button', { name: /close and go back to the arcade/i }));
    clickAndArrive(screen.getByRole('button', { name: /^green arcade cabinet$/i }));

    expect(shell()).toHaveAttribute('data-arcade-machine', 'arcade-cabinet-green');
    expect(screen.getByRole('dialog', { name: 'Green Cabinet' })).toBeInTheDocument();
  });
});

describe('the dance machine is dedicated', () => {
  it('opens Blobbi Dance directly, with no catalogue in between', () => {
    renderRoom('basement');
    expect(clickAndArrive(screen.getByRole('button', { name: /blobbi dance machine/i }))).toBe(
      true,
    );

    expect(catalogue()).toBeNull();
    expect(shell()).toHaveAttribute('data-arcade-surface', 'game');
    expect(shell()).toHaveAttribute('data-arcade-game', 'blobbi-dance');
    expect(shell()).toHaveAttribute('data-arcade-status', 'preview');
    expect(screen.getByRole('dialog', { name: 'Blobbi Dance' })).toBeInTheDocument();
    expect(document.querySelector('[data-dance-preview]')).not.toBeNull();
    expect(within(shell()!).getByRole('button', { name: /^start$/i })).toBeInTheDocument();
  });

  it('always runs on arcade-dance-machine', () => {
    // What a result and a ticket claim record. It is fixed by the machine the
    // player walked to, and only one machine can start this game.
    renderRoom('basement');
    clickAndArrive(screen.getByRole('button', { name: /blobbi dance machine/i }));
    expect(shell()).toHaveAttribute('data-arcade-machine', 'arcade-dance-machine');
  });

  it('leaves to the arcade room, not to a game list', () => {
    renderRoom('basement');
    clickAndArrive(screen.getByRole('button', { name: /blobbi dance machine/i }));

    fireEvent.click(screen.getByRole('button', { name: /back to the arcade room/i }));

    expect(shell()).toBeNull();
    expect(catalogue()).toBeNull();
    expect(document.querySelector('[data-dance-preview]')).toBeNull();
    expect(document.querySelector('[data-dance-stage]')).toBeNull();
  });
});

describe('the air hockey table is dedicated too', () => {
  const openTable = () => {
    renderRoom('floor-1');
    return clickAndArrive(screen.getByRole('button', { name: /air hockey table/i }));
  };

  it('opens Air Hockey directly, with no catalogue in between', () => {
    expect(openTable()).toBe(true);

    expect(catalogue()).toBeNull();
    expect(shell()).toHaveAttribute('data-arcade-surface', 'game');
    expect(shell()).toHaveAttribute('data-arcade-game', 'blobbi-air-hockey');
    expect(shell()).toHaveAttribute('data-arcade-status', 'preview');
    expect(screen.getByRole('dialog', { name: 'Air Hockey' })).toBeInTheDocument();
    expect(document.querySelector('[data-hockey-preview]')).not.toBeNull();
    expect(within(shell()!).getByRole('button', { name: /^start$/i })).toBeInTheDocument();
  });

  it('always runs on arcade-air-hockey', () => {
    openTable();
    expect(shell()).toHaveAttribute('data-arcade-machine', 'arcade-air-hockey');
  });

  it('talks about air hockey and never about another machine’s game', () => {
    openTable();
    const dialog = screen.getByRole('dialog', { name: 'Air Hockey' });
    expect(dialog.textContent).toMatch(/puck/i);
    expect(dialog.textContent).not.toMatch(/cue|arrow keys or wasd lane|rhythm/i);
    expect(document.querySelector('[data-dance-preview]')).toBeNull();
  });

  it('leaves to the arcade room, not to a game list', () => {
    openTable();
    fireEvent.click(screen.getByRole('button', { name: /back to the arcade room/i }));

    expect(shell()).toBeNull();
    expect(catalogue()).toBeNull();
    expect(document.querySelector('[data-hockey-preview]')).toBeNull();
    expect(document.querySelector('[data-hockey-table]')).toBeNull();
  });
});

describe('the pool table is dedicated too', () => {
  const openTable = () => {
    renderRoom('floor-1');
    return clickAndArrive(screen.getByRole('button', { name: /pool table/i }));
  };

  it('opens Pool directly, with no catalogue in between', () => {
    expect(openTable()).toBe(true);

    expect(catalogue()).toBeNull();
    expect(shell()).toHaveAttribute('data-arcade-surface', 'game');
    expect(shell()).toHaveAttribute('data-arcade-game', 'blobbi-pool');
    expect(shell()).toHaveAttribute('data-arcade-status', 'preview');
    expect(screen.getByRole('dialog', { name: 'Pool' })).toBeInTheDocument();
    expect(document.querySelector('[data-pool-preview]')).not.toBeNull();
    expect(within(shell()!).getByRole('button', { name: /^start$/i })).toBeInTheDocument();
  });

  it('always runs on arcade-pool-table', () => {
    openTable();
    expect(shell()).toHaveAttribute('data-arcade-machine', 'arcade-pool-table');
  });

  it('talks about pool and never about another machine’s game', () => {
    openTable();
    const dialog = screen.getByRole('dialog', { name: 'Pool' });
    expect(dialog.textContent).toMatch(/cue|8-ball/i);
    expect(dialog.textContent).not.toMatch(/puck|rhythm|four lanes/i);
    expect(document.querySelector('[data-dance-preview]')).toBeNull();
    expect(document.querySelector('[data-hockey-preview]')).toBeNull();
  });

  it('says how tickets are earned, and offers no claim before a frame exists', () => {
    openTable();
    const notice = document.querySelector('[data-pool-ticket-notice]');
    expect(notice?.textContent).toMatch(/finishing a frame earns tickets/i);
    expect(within(shell()!).queryByRole('button', { name: /claim/i })).toBeNull();
  });

  it('leaves to the arcade room, not to a game list', () => {
    openTable();
    fireEvent.click(screen.getByRole('button', { name: /back to the arcade room/i }));

    expect(shell()).toBeNull();
    expect(catalogue()).toBeNull();
    expect(document.querySelector('[data-pool-preview]')).toBeNull();
    expect(document.querySelector('[data-pool-table]')).toBeNull();
  });
});

describe('no machine is a no-op', () => {
  it('opens something for every machine on every floor', () => {
    for (const floor of ['ground', 'floor-1', 'basement'] as const) {
      for (const machine of arcadeMachines.filter((m) => m.floor === floor)) {
        const view = renderRoom(floor);
        expect(clickAndArrive(screen.getByRole('button', { name: machine.alt })), machine.id).toBe(
          true,
        );
        expect(shell(), machine.id).not.toBeNull();
        expect(shell()!.getAttribute('data-arcade-machine'), machine.id).toBe(machine.id);
        view.unmount();
        requests.length = 0;
      }
    }
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
    clickAndArrive(screen.getByRole('button', { name: /blobbi dance machine/i }));
    expect(shell()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /back to the arcade room/i }));
    expect(shell()).toBeNull();
    expect(document.querySelector('[data-arcade-panel]')).toBeNull();
    expect(document.querySelector('[data-dance-preview]')).toBeNull();
    expect(document.querySelector('[data-dance-stage]')).toBeNull();
  });
});

describe('dead affordances are gone', () => {
  it('walks to the prize counter and opens the Prize Counter', () => {
    renderRoom('ground');

    const counter = screen.getByAltText('Prize counter');
    expect(clickAndArrive(counter.parentElement as HTMLElement)).toBe(true);

    expect(screen.getByRole('dialog', { name: 'Prize Counter' })).toBeInTheDocument();
    expect(shell()).toHaveAttribute('data-arcade-surface', 'notice');
    // The REAL counter surface mounts inside the shell (stubbed here; tested
    // for real in prizes/PrizeCounter.test.tsx).
    expect(screen.getByTestId('prize-counter-surface')).toBeInTheDocument();
    // A counter is not a cabinet: it opens no catalogue and lists no games.
    expect(catalogue()).toBeNull();
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
  const doors = () => document.querySelector('[data-elevator-phase]') as HTMLElement;
  const doorWrapper = (side: 'left' | 'right') =>
    screen.getByAltText(`Elevator, ${side} door`).parentElement!.parentElement as HTMLElement;
  /** The slide transform the door art carries: open is `translateX(100%)`. */
  const doorSlide = (side: 'left' | 'right') =>
    (screen.getByAltText(`Elevator, ${side} door`).parentElement as HTMLElement).style.transform;
  const isOpen = () => doors().dataset.elevatorOpen === 'true' && doorSlide('right') === 'translateX(100%)';

  it('opens the floor selector for everyone, with no entitlement check', () => {
    // The elevator used to demand an Arcade Pass and open a refusal modal
    // instead. The arcade charges for PLAYS now; one Arcade Token per game,
    // bought at the counter, so riding it is free and the refusal modal is
    // gone rather than merely unreachable.
    vi.useFakeTimers();
    try {
      renderRoom('ground');
      expect(clickAndArrive(doorWrapper('left'))).toBe(true);
      act(() => {
        vi.advanceTimersByTime(ELEVATOR_DOOR_TRANSITION_MS);
      });
      expect(screen.getByTestId('elevator-modal')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts closed, opens on hover and closes again when the pointer leaves while idle', () => {
    renderRoom('ground');
    expect(isOpen()).toBe(false);
    expect(doorSlide('left')).toBe('translate(0, 0)');

    fireEvent.mouseEnter(doors());
    expect(isOpen()).toBe(true);
    fireEvent.mouseLeave(doors());
    expect(isOpen()).toBe(false);
  });

  it('a click locks the doors open: leaving with the pointer no longer closes them', () => {
    renderRoom('ground');
    fireEvent.mouseEnter(doors());
    fireEvent.click(doorWrapper('right'));
    expect(requests).toHaveLength(1);
    expect(doors().dataset.elevatorPhase).toBe('engaged');

    fireEvent.mouseLeave(doors());
    expect(isOpen()).toBe(true);
  });

  it('opens the doors BEFORE the walk and shows the picker only once they have finished opening', () => {
    vi.useFakeTimers();
    try {
      renderRoom('ground');
      fireEvent.click(doorWrapper('right'));
      // Locked open at request time, before any arrival.
      expect(isOpen()).toBe(true);
      expect(screen.queryByTestId('elevator-modal')).toBeNull();

      // Arrival straight away (the Blobbi was already in the doorway): the
      // picker waits for the door slide to finish.
      act(() => requests[0].action());
      expect(doors().dataset.elevatorPhase).toBe('selecting');
      expect(screen.queryByTestId('elevator-modal')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(ELEVATOR_DOOR_TRANSITION_MS - 1);
      });
      expect(screen.queryByTestId('elevator-modal')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByTestId('elevator-modal')).toBeInTheDocument();
      // Still open with the picker up, pointer or no pointer.
      fireEvent.mouseLeave(doors());
      expect(isOpen()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a cancelled walk lets the doors close again', () => {
    renderRoom('ground');
    fireEvent.click(doorWrapper('left'));
    expect(isOpen()).toBe(true);

    act(() => requests[0].onCancel?.());
    expect(doors().dataset.elevatorPhase).toBe('idle');
    expect(isOpen()).toBe(false);
  });

  it('keeps the doors open after the picker is dismissed until the Blobbi walks away', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderRoom('ground');
      expect(clickAndArrive(doorWrapper('right'))).toBe(true);
      act(() => {
        vi.advanceTimersByTime(ELEVATOR_DOOR_TRANSITION_MS);
      });
      fireEvent.click(screen.getByText('Close picker'));
      expect(screen.queryByTestId('elevator-modal')).toBeNull();
      // Dismissed, but the Blobbi is still standing in the doorway.
      expect(doors().dataset.elevatorPhase).toBe('exiting');
      expect(isOpen()).toBe(true);
      fireEvent.mouseLeave(doors());
      expect(isOpen()).toBe(true);

      // A tap on UI is not a departure...
      fireEvent.pointerDown(doorWrapper('left'), { bubbles: true });
      expect(isOpen()).toBe(true);
      // ...a tap on the floor is: the Blobbi is walking off, close behind it.
      const surface = container.querySelector('[data-world-surface]') as HTMLElement;
      fireEvent.pointerDown(surface, { bubbles: true });
      expect(doors().dataset.elevatorPhase).toBe('idle');
      expect(isOpen()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a tap works without hover: the doors open and the walk starts', () => {
    renderRoom('ground');
    fireEvent.touchStart(doorWrapper('right'));
    expect(requests).toHaveLength(1);
    expect(isOpen()).toBe(true);
    expect(doors().dataset.elevatorPhase).toBe('engaged');
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

describe('token counter', () => {
  it('opens the token counter only after arrival', () => {
    renderRoom('ground');

    const window_ = screen.getByAltText(/buy Arcade Tokens/i).parentElement as HTMLElement;
    fireEvent.click(window_);
    expect(screen.queryByTestId('token-shop-modal')).toBeNull();

    act(() => requests[0].action());
    expect(screen.getByTestId('token-shop-modal')).toBeInTheDocument();
  });

  it('does not mount the token counter while it is closed', () => {
    renderRoom('ground');
    expect(screen.queryByTestId('token-shop-modal')).toBeNull();
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
