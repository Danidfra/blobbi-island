/**
 * Treasure Hunt controller — screen flow, pause and interruption, the
 * exit-confirmation rule, and the audio engine's lifecycle (built on Start,
 * silenced by close: no beep may outlive the shell).
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { TreasureHuntModal } from './TreasureHuntModal';
import { TREASURE_HUNT_UI_POLICY, SAND_RECT, PLAYFIELD_IMAGE_ASPECT } from './treasure-hunt-config';
import { fieldPointToImagePercent, fitFieldLayout, type FieldMapping } from './field-transform';
import type { DetectorAudioEngine } from './detector-audio';
import {
  createTreasureHuntRound,
  treasureHuntReducer,
  type Point,
  type TreasureHuntPolicy,
  type TreasureHuntRound,
} from '@/beach/treasure-hunt';

const WIDTH = 800;
const HEIGHT = 500;
const RECT = {
  width: WIDTH,
  height: HEIGHT,
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: WIDTH,
  bottom: HEIGHT,
  toJSON: () => ({}),
} as DOMRect;

/** jsdom-safe PointerEvent that keeps coordinates and pointer fields. */
class TestPointerEvent extends MouseEvent {
  public pointerId: number | undefined;
  public pointerType: string;
  constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
    super(type, init);
    this.pointerId = init.pointerId;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

beforeAll(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  Object.assign(HTMLElement.prototype, {
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => true,
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(RECT);
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeEngine(): DetectorAudioEngine & {
  update: ReturnType<typeof vi.fn>;
  dig: ReturnType<typeof vi.fn>;
  finish: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return {
    update: vi.fn(),
    dig: vi.fn(),
    finish: vi.fn(),
    setMuted: vi.fn(),
    muted: false,
    dispose: vi.fn(),
  };
}

function renderModal(options?: {
  policy?: TreasureHuntPolicy;
  onClose?: () => void;
  onActorSuppressionChange?: (suppressed: boolean) => void;
}) {
  const engines: ReturnType<typeof makeEngine>[] = [];
  const audioFactory = vi.fn(() => {
    const engine = makeEngine();
    engines.push(engine);
    return engine;
  });
  const onClose = options?.onClose ?? vi.fn();
  const view = render(
    <TreasureHuntModal
      open
      onClose={onClose}
      onActorSuppressionChange={options?.onActorSuppressionChange}
      dev={{
        seed: 'modal-test',
        policy: options?.policy ?? TREASURE_HUNT_UI_POLICY,
        audioFactory,
        forceReducedMotion: true,
      }}
    />
  );
  return { view, audioFactory, engines, onClose };
}

function startHunt() {
  fireEvent.click(screen.getByRole('button', { name: 'Start Practice Hunt' }));
}

/** The same round the modal builds, for computing dig coordinates. */
function referenceRound(policy: TreasureHuntPolicy): TreasureHuntRound {
  const created = createTreasureHuntRound({ seed: 'modal-test', policy });
  if (!created.ok) throw new Error('reference round failed');
  return treasureHuntReducer(created.round, { type: 'start' });
}

function pxFor(point: Point, policy: TreasureHuntPolicy): { clientX: number; clientY: number } {
  const mapping: FieldMapping = {
    layout: fitFieldLayout(WIDTH, HEIGHT, PLAYFIELD_IMAGE_ASPECT),
    sandRect: SAND_RECT,
    fieldWidth: policy.fieldWidth,
    fieldHeight: policy.fieldHeight,
  };
  const percent = fieldPointToImagePercent(point, mapping);
  return {
    clientX: mapping.layout.imageLeft + (percent.leftPercent / 100) * mapping.layout.imageWidth,
    clientY: mapping.layout.imageTop + (percent.topPercent / 100) * mapping.layout.imageHeight,
  };
}

function fieldEl(): HTMLElement {
  const element = document.querySelector('[data-treasure-field]');
  if (!(element instanceof HTMLElement)) throw new Error('field not mounted');
  return element;
}

describe('screen flow', () => {
  it('opens on the intro without touching audio', () => {
    const { audioFactory } = renderModal();
    expect(screen.getByText('Beach Treasure Hunt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Practice Hunt' })).toBeInTheDocument();
    expect(audioFactory).not.toHaveBeenCalled();
  });

  it('Start Hunt builds the audio engine inside the click and mounts the game', () => {
    const { audioFactory } = renderModal();
    startHunt();
    expect(audioFactory).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-treasure-game]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /metal detector/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('closing from the intro needs no confirmation', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: /Close Beach Treasure Hunt/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Leave the hunt?')).not.toBeInTheDocument();
  });
});

describe('pause and interruption', () => {
  it('pauses and resumes through the shell controls', () => {
    renderModal();
    startHunt();
    fireEvent.click(screen.getByRole('button', { name: /Pause Beach Treasure Hunt/ }));
    expect(document.querySelector('[data-treasure-paused]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Resume Beach Treasure Hunt/ }));
    expect(document.querySelector('[data-treasure-paused]')).toBeNull();
  });

  it('window blur pauses a live round and never auto-resumes', () => {
    renderModal();
    startHunt();
    fireEvent.blur(window);
    expect(document.querySelector('[data-treasure-paused]')).not.toBeNull();
    fireEvent.focus(window);
    expect(document.querySelector('[data-treasure-paused]')).not.toBeNull();
  });
});

describe('exit rule', () => {
  it('mid-round close asks first; Keep Digging resumes', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    startHunt();

    fireEvent.click(screen.getByRole('button', { name: /Leave Beach Treasure Hunt/ }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Leave the hunt?')).toBeInTheDocument();
    expect(screen.getByText('The current hunt will be abandoned.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep Digging' }));
    expect(screen.queryByText('Leave the hunt?')).not.toBeInTheDocument();
    expect(document.querySelector('[data-treasure-paused]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('confirming the exit closes, discards the round and silences the engine', () => {
    const onClose = vi.fn();
    const { engines } = renderModal({ onClose });
    startHunt();

    fireEvent.click(screen.getByRole('button', { name: /Leave Beach Treasure Hunt/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave Hunt' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(engines[0].dispose).toHaveBeenCalled();
  });

  it('Escape follows the same confirmation path', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    startHunt();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.getByText('Leave the hunt?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('unmounting disposes the engine — no beep outlives the shell', () => {
    const { view, engines } = renderModal();
    startHunt();
    view.unmount();
    expect(engines[0].dispose).toHaveBeenCalled();
  });
});

describe('finish and results', () => {
  const onePolicy: TreasureHuntPolicy = { ...TREASURE_HUNT_UI_POLICY, shovelUses: 1 };

  it('a shovel-depleting miss ends the round and shows the findings summary', () => {
    const { engines } = renderModal({ policy: onePolicy });
    startHunt();

    const reference = referenceRound(onePolicy);
    const miss = findMissPoint(reference);

    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    fireEvent.pointerDown(fieldEl(), { pointerId: 4, ...pxFor(miss, onePolicy) });

    expect(engines[0].dig).toHaveBeenCalledWith(false);
    expect(engines[0].finish).toHaveBeenCalledWith(0);
    expect(screen.getByText('Findings Summary')).toBeInTheDocument();
    expect(screen.getByText(/No treasures this time/)).toBeInTheDocument();
    // Practice framing: says plainly that nothing durable was granted, and
    // never claims an inventory grant.
    expect(
      screen.getByText('Practice round — no Coins or items were awarded.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/inventory/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/added to/i)).not.toBeInTheDocument();
  });

  it('a dig on a target reveals it, updates the finds count and records a hit', () => {
    const { engines } = renderModal();
    startHunt();

    const reference = referenceRound(TREASURE_HUNT_UI_POLICY);
    const target = reference.targets[0];

    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    fireEvent.pointerDown(fieldEl(), {
      pointerId: 4,
      ...pxFor(target.position, TREASURE_HUNT_UI_POLICY),
    });

    expect(engines[0].dig).toHaveBeenCalledWith(true);
    expect(document.querySelector('[data-dig-marker="hit"]')).not.toBeNull();
    expect(document.querySelector('[data-find-marker]')).not.toBeNull();
  });

  it('Practice Again starts a completely fresh simulation with a new engine', () => {
    const { audioFactory, engines } = renderModal({ policy: onePolicy });
    startHunt();
    const reference = referenceRound(onePolicy);
    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    fireEvent.pointerDown(fieldEl(), { pointerId: 4, ...pxFor(findMissPoint(reference), onePolicy) });
    expect(screen.getByText('Findings Summary')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Practice Again' }));
    expect(audioFactory).toHaveBeenCalledTimes(2);
    expect(engines[0].dispose).toHaveBeenCalled();
    expect(document.querySelector('[data-treasure-game]')).not.toBeNull();
  });

  it('Return to Beach closes without confirmation after results', () => {
    const onClose = vi.fn();
    renderModal({ policy: onePolicy, onClose });
    startHunt();
    const reference = referenceRound(onePolicy);
    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    fireEvent.pointerDown(fieldEl(), { pointerId: 4, ...pxFor(findMissPoint(reference), onePolicy) });

    fireEvent.click(screen.getByRole('button', { name: 'Return to Beach' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Leave the hunt?')).not.toBeInTheDocument();
  });
});

describe('tool switching, audio and actor suppression', () => {
  const frames = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });

  it('detector audio only operates while the detector is the active tool', async () => {
    const { engines } = renderModal();
    startHunt();
    const engine = engines[0];

    await frames();
    expect(engine.update).toHaveBeenCalled(); // active detector reports

    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    engine.update.mockClear();
    await frames();
    await frames();
    expect(engine.update).not.toHaveBeenCalled(); // docked detector is silent

    fireEvent.click(screen.getByRole('button', { name: /metal detector/i }));
    await frames();
    await frames();
    expect(engine.update).toHaveBeenCalled(); // resumes from the live signal
    expect(engines).toHaveLength(1); // same engine — nothing duplicated
  });

  it('selecting the shovel docks and deactivates the detector; reselecting restores it', () => {
    renderModal();
    startHunt();

    const detector = document.querySelector('[data-treasure-detector]') as HTMLElement;
    const activeLeft = detector.style.left;
    expect(detector.dataset.docked).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    expect(detector.dataset.docked).toBe('true');
    expect(detector.dataset.signalLevel).toBe('none'); // display deactivated
    expect(detector.style.left).not.toBe(activeLeft);

    fireEvent.click(screen.getByRole('button', { name: /metal detector/i }));
    expect(detector.dataset.docked).toBeUndefined();
    // The logical coil position was never overwritten by dock coordinates.
    expect(detector.style.left).toBe(activeLeft);
  });

  it('suppresses the actor for playing and results, restoring it on close and unmount', () => {
    const onSuppress = vi.fn();
    const onClose = vi.fn();
    const onePolicy: TreasureHuntPolicy = { ...TREASURE_HUNT_UI_POLICY, shovelUses: 1 };
    const { view } = renderModal({
      policy: onePolicy,
      onClose,
      onActorSuppressionChange: onSuppress,
    });

    expect(onSuppress).not.toHaveBeenCalledWith(true); // intro keeps the actor

    startHunt();
    expect(onSuppress).toHaveBeenLastCalledWith(true);

    // Finish the round: still covered by the shell → still suppressed.
    const reference = referenceRound(onePolicy);
    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    fireEvent.pointerDown(fieldEl(), { pointerId: 4, ...pxFor(findMissPoint(reference), onePolicy) });
    expect(screen.getByText('Findings Summary')).toBeInTheDocument();
    expect(onSuppress).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'Return to Beach' }));
    expect(onSuppress).toHaveBeenLastCalledWith(false);

    onSuppress.mockClear();
    view.unmount();
    expect(onSuppress).toHaveBeenCalledWith(false);
  });
});

/** A dig point clear of every unresolved target's dig radius. */
function findMissPoint(round: TreasureHuntRound): Point {
  for (let x = 0.05; x < round.policy.fieldWidth; x += 0.02) {
    for (let y = 0.05; y < round.policy.fieldHeight; y += 0.02) {
      const candidate = { x, y };
      const clear = round.targets.every((target) => {
        const dx = candidate.x - target.position.x;
        const dy = candidate.y - target.position.y;
        return target.found || Math.hypot(dx, dy) > target.digRadius;
      });
      if (clear) return candidate;
    }
  }
  throw new Error('no miss point on this field');
}
