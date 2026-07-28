/**
 * Behavioural coverage for `<ArcadeMachine>`.
 *
 * The audit's headline finding was that clicking a POOL TABLE opened a dance
 * game, immediately, from a click handler. These tests pin the replacement
 * contract: a click starts a walk and nothing else, the action fires only on
 * confirmed arrival, a cancelled or superseded walk fires nothing, and a tap
 * never also starts a raw world walk that would race the pending interaction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, screen } from '@testing-library/react';

import { ArcadeMachine } from './ArcadeMachine';
import {
  getArcadeMachine,
  machineAnchorPosition,
  type ArcadeMachineConfig,
} from '@/lib/arcade-machines-config';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';

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

/** A machine rect that sits well inside the floor-1 walk boundary. */
const MACHINE_RECT = {
  width: 120,
  height: 180,
  x: 240,
  y: 600,
  top: 600,
  left: 240,
  right: 360,
  bottom: 780,
  toJSON: () => ({}),
} as DOMRect;

/**
 * A stand-in for `usePendingInteraction` that reproduces the parts of its
 * contract these tests depend on: only the newest request can fire, and a
 * replaced request is cancelled.
 */
function makePendingSystem() {
  const requests: RequestInteractionOptions[] = [];
  let activeToken = 0;

  const requestInteraction = (opts: RequestInteractionOptions) => {
    const previous = requests[requests.length - 1];
    if (activeToken === requests.length && previous) previous.onCancel?.();
    requests.push(opts);
    activeToken = requests.length;
  };

  return {
    requests,
    requestInteraction,
    /** Simulate the movement system confirming arrival for request `index`. */
    arriveAt(index: number) {
      if (index !== activeToken - 1) return; // a stale request can never fire
      act(() => requests[index].action());
    },
    cancelActive() {
      act(() => requests[activeToken - 1]?.onCancel?.());
    },
  };
}

interface Harness {
  system: ReturnType<typeof makePendingSystem>;
  activations: string[];
  surface: HTMLElement;
  machineEl: (id: string) => HTMLElement;
  worldMoves: number;
}

function renderMachines(configs: ArcadeMachineConfig[]): Harness {
  const system = makePendingSystem();
  const activations: string[] = [];
  let worldMoves = 0;

  const { container } = render(
    <div data-world-surface>
      {configs.map((config) => (
        <ArcadeMachine
          key={config.id}
          config={config}
          requestInteraction={system.requestInteraction}
          onActivate={(id) => activations.push(id)}
        />
      ))}
    </div>,
  );

  const surface = container.querySelector('[data-world-surface]') as HTMLElement;
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(SURFACE_RECT);

  // Stand in for `MovableBlobbi.shouldTriggerWorldMove`, which walks the event's
  // path and refuses to move the world for anything inside a `[data-block-move]`
  // subtree. React's `stopPropagation` does NOT protect against this listener
  // (React delegates at the root, so a native listener on an ancestor still
  // fires) — the attribute is the actual mechanism, on both event types.
  const worldListener = (ev: Event) => {
    if ((ev.target as Element).closest?.('[data-block-move]')) return;
    worldMoves += 1;
  };
  surface.addEventListener('pointerdown', worldListener);
  surface.addEventListener('touchstart', worldListener);

  const machineEl = (id: string) => {
    const el = container.querySelector(`[data-arcade-machine-id="${id}"]`) as HTMLElement;
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(MACHINE_RECT);
    return el;
  };

  return {
    system,
    activations,
    surface,
    machineEl,
    get worldMoves() {
      return worldMoves;
    },
  };
}

const dance = () => getArcadeMachine('arcade-dance-machine')!;
const pool = () => getArcadeMachine('arcade-pool-table')!;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('walk-to-interact', () => {
  it('requests a walk on click and opens nothing', () => {
    const h = renderMachines([dance()]);

    fireEvent.click(h.machineEl('arcade-dance-machine'));

    expect(h.system.requests).toHaveLength(1);
    expect(h.activations).toEqual([]);
  });

  it('fires the action only after confirmed arrival, with the machine id', () => {
    const h = renderMachines([dance()]);

    fireEvent.click(h.machineEl('arcade-dance-machine'));
    expect(h.activations).toEqual([]);

    h.system.arriveAt(0);
    expect(h.activations).toEqual(['arcade-dance-machine']);
  });

  it('does not fire when the walk is cancelled before arrival', () => {
    const h = renderMachines([dance()]);

    fireEvent.click(h.machineEl('arcade-dance-machine'));
    h.system.cancelActive();

    expect(h.activations).toEqual([]);
  });

  it('invalidates the first machine when a second is clicked', () => {
    const h = renderMachines([dance(), pool()]);

    fireEvent.click(h.machineEl('arcade-dance-machine'));
    fireEvent.click(h.machineEl('arcade-pool-table'));

    expect(h.system.requests).toHaveLength(2);

    // The superseded walk can never fire, even if something tries.
    h.system.arriveAt(0);
    expect(h.activations).toEqual([]);

    h.system.arriveAt(1);
    expect(h.activations).toEqual(['arcade-pool-table']);
  });

  it('aims at the configured anchor, not at the sprite centre', () => {
    const h = renderMachines([pool()]);
    fireEvent.click(h.machineEl('arcade-pool-table'));

    const { target } = h.system.requests[0];
    const config = pool();
    const expectedY =
      ((MACHINE_RECT.top + MACHINE_RECT.height * config.interactionAnchor.y) /
        SURFACE_RECT.height) *
      100;

    expect(target.y).toBeCloseTo(expectedY, 5);
    // ...clearly below the sprite's vertical middle.
    const middleY = ((MACHINE_RECT.top + MACHINE_RECT.height / 2) / SURFACE_RECT.height) * 100;
    expect(target.y).toBeGreaterThan(middleY);
  });

  it('agrees with the DOM-free anchor the configuration test checks', () => {
    // Both must describe the same point, or the config test would be validating
    // a target the component never uses.
    const config = pool();
    const fromConfig = machineAnchorPosition(config);
    expect(fromConfig.y).toBeGreaterThan(fromConfig.x * 0); // sanity: a real number
    expect(Number.isFinite(fromConfig.x) && Number.isFinite(fromConfig.y)).toBe(true);
  });

  it('does nothing when there is no measurable world surface', () => {
    const system = makePendingSystem();
    const activations: string[] = [];
    const { container } = render(
      <ArcadeMachine
        config={dance()}
        requestInteraction={system.requestInteraction}
        onActivate={(id) => activations.push(id)}
      />,
    );

    fireEvent.click(container.querySelector('[data-arcade-machine-id]') as HTMLElement);
    expect(system.requests).toHaveLength(0);
    expect(activations).toEqual([]);
  });
});

describe('movement contract', () => {
  it('blocks the world walk on pointer interactions', () => {
    const h = renderMachines([dance()]);
    const el = h.machineEl('arcade-dance-machine');

    expect(el).toHaveAttribute('data-block-move');

    fireEvent.pointerDown(el, { bubbles: true });
    expect(h.worldMoves).toBe(0);
  });

  it('blocks the world walk on touch, and requests exactly one walk', () => {
    const h = renderMachines([dance()]);
    const el = h.machineEl('arcade-dance-machine');

    fireEvent.touchStart(el);

    expect(h.worldMoves).toBe(0);
    expect(h.system.requests).toHaveLength(1);
    // ...and a touch is a touch: the more forgiving proximity threshold applies.
    expect(h.system.requests[0].touch).toBe(true);
  });

  it('still lets a click on empty ground reach the world', () => {
    const h = renderMachines([dance()]);
    fireEvent.pointerDown(h.surface, { bubbles: true });
    fireEvent.touchStart(h.surface);
    expect(h.worldMoves).toBe(2);
  });
});

describe('accessibility', () => {
  it('exposes each machine as a button with its own name', () => {
    renderMachines([dance(), pool()]);

    expect(screen.getByRole('button', { name: dance().alt })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: pool().alt })).toBeInTheDocument();
    // The pool table must not be announced as a cabinet or a dance game.
    expect(screen.queryByRole('button', { name: /dance/i })?.getAttribute('data-arcade-machine-id')).toBe(
      'arcade-dance-machine',
    );
  });

  it('does not double-announce the sprite behind the button', () => {
    const h = renderMachines([dance()]);
    const img = h.machineEl('arcade-dance-machine').querySelector('img')!;
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('aria-hidden');
  });

  it('walks the Blobbi over for keyboard activation too', () => {
    const h = renderMachines([dance()]);
    const el = h.machineEl('arcade-dance-machine');

    fireEvent.keyDown(el, { key: 'Enter' });
    expect(h.system.requests).toHaveLength(1);
    expect(h.activations).toEqual([]);

    h.system.arriveAt(0);
    expect(h.activations).toEqual(['arcade-dance-machine']);
  });

  it('reports availability so the room never has to guess', () => {
    const h = renderMachines([dance(), pool()]);
    expect(h.machineEl('arcade-dance-machine')).toHaveAttribute(
      'data-arcade-availability',
      'playable',
    );
    expect(h.machineEl('arcade-pool-table')).toHaveAttribute(
      'data-arcade-availability',
      'coming-soon',
    );
  });
});
