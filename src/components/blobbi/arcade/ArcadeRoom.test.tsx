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

/*
  The dance machine's reward hook needs a relay pool, a query client and a login
  context. This file tests the ROOM — which machine opens what, and when — so the
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
const catalogue = () => document.querySelector('[data-arcade-catalogue]') as HTMLElement | null;

beforeEach(() => {
  requests.length = 0;
  clearArcadePass();
  setCurrentLocation.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearArcadePass();
});

const GENERIC_CABINETS = [
  'arcade-cabinet-pink',
  'arcade-cabinet-black',
  'arcade-cabinet-classic',
  'arcade-cabinet-green',
  'arcade-cabinet-purple',
  'arcade-cabinet-red',
];

describe('generic cabinets open the shared catalogue', () => {
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

  it('shows an honest prepared state rather than an empty grid', () => {
    renderRoom('floor-1');
    clickAndArrive(screen.getByRole('button', { name: /pink arcade cabinet/i }));

    expect(catalogue()).toHaveAttribute('data-catalogue-games', '0');
    expect(within(catalogue()!).getByRole('heading', { name: 'Arcade Games' })).toBeInTheDocument();
    expect(
      within(catalogue()!).getByText(/new games are being prepared for these cabinets/i),
    ).toBeInTheDocument();
    // No cards at all — real or placeholder.
    expect(catalogue()!.querySelector('[data-catalogue-card]')).toBeNull();
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

describe('pool and air hockey are dedicated too', () => {
  const TABLES = [
    {
      machineId: 'arcade-pool-table',
      alt: /pool table/i,
      title: 'Pool',
      own: /cue|balls/i,
      other: /puck|dance|arrow/i,
    },
    {
      machineId: 'arcade-air-hockey',
      alt: /air hockey table/i,
      title: 'Air Hockey',
      own: /puck/i,
      other: /cue|dance|arrow/i,
    },
  ];

  it.each(TABLES)('$title opens its own coming-soon screen', (table) => {
    renderRoom('floor-1');
    expect(clickAndArrive(screen.getByRole('button', { name: table.alt }))).toBe(true);

    // Not the shared catalogue, and not another game's screen.
    expect(catalogue()).toBeNull();
    expect(shell()).toHaveAttribute('data-arcade-machine', table.machineId);
    expect(screen.getByRole('dialog', { name: table.title })).toBeInTheDocument();

    const panel_ = panel()!;
    expect(within(panel_).getByText(table.title)).toBeInTheDocument();
    expect(panel_.textContent).toMatch(table.own);
    expect(panel_.textContent).not.toMatch(table.other);
    expect(within(panel_).getByText(/coming soon/i)).toBeInTheDocument();
  });

  it.each(TABLES)('$title offers no way to start anything', (table) => {
    renderRoom('floor-1');
    clickAndArrive(screen.getByRole('button', { name: table.alt }));

    expect(within(shell()!).queryByRole('button', { name: /^start$/i })).toBeNull();
    expect(within(shell()!).queryByRole('button', { name: /^play/i })).toBeNull();
    expect(document.querySelector('[data-dance-preview]')).toBeNull();
    // One way out, and it says where it goes.
    const buttons = within(shell()!).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/close and go back to the arcade/i);
  });

  it.each(TABLES)('$title closes back to the arcade room', (table) => {
    renderRoom('floor-1');
    clickAndArrive(screen.getByRole('button', { name: table.alt }));

    fireEvent.click(screen.getByRole('button', { name: /close and go back to the arcade/i }));
    expect(shell()).toBeNull();
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
  it('walks to the prize counter and tells the truth about it', () => {
    renderRoom('ground');

    const counter = screen.getByAltText('Prize counter');
    expect(clickAndArrive(counter.parentElement as HTMLElement)).toBe(true);

    expect(screen.getByRole('dialog', { name: 'Prize Counter' })).toBeInTheDocument();
    expect(shell()).toHaveAttribute('data-arcade-surface', 'notice');
    expect(within(panel()!).getByText(/not open yet/i)).toBeInTheDocument();
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
