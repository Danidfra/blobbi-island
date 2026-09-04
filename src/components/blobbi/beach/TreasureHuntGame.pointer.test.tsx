/**
 * Playfield input: pointer capture, the clamped detector rule, the strict
 * shovel rule, and tool switching, exercised through real pointer events.
 *
 * The container measures a stubbed 800 × 500 rect (jsdom cannot lay out), so
 * every conversion runs through the same numbers the assertions compute with
 * the pure field-transform functions.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';

import { TreasureHuntGame, type TreasureTool } from './TreasureHuntGame';
import {
  PLAYFIELD_IMAGE_ASPECT,
  SAND_RECT,
  TREASURE_HUNT_UI_POLICY,
} from './treasure-hunt-config';
import { fieldPointToImagePercent, fitFieldLayout, type FieldMapping } from './field-transform';
import {
  createTreasureHuntRound,
  treasureHuntReducer,
  type Point,
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

const MAPPING: FieldMapping = {
  layout: fitFieldLayout(WIDTH, HEIGHT, PLAYFIELD_IMAGE_ASPECT),
  sandRect: SAND_RECT,
  fieldWidth: TREASURE_HUNT_UI_POLICY.fieldWidth,
  fieldHeight: TREASURE_HUNT_UI_POLICY.fieldHeight,
};

/** Container-local px for a logical field point (the exact render inverse). */
function pxFor(point: Point): { clientX: number; clientY: number } {
  const percent = fieldPointToImagePercent(point, MAPPING);
  return {
    clientX: MAPPING.layout.imageLeft + (percent.leftPercent / 100) * MAPPING.layout.imageWidth,
    clientY: MAPPING.layout.imageTop + (percent.topPercent / 100) * MAPPING.layout.imageHeight,
  };
}

const setPointerCapture = vi.fn();
const releasePointerCapture = vi.fn();

/**
 * jsdom has no real PointerEvent: fireEvent falls back to a bare Event and
 * `pointerId`/`clientX` never reach the handler. A MouseEvent subclass keeps
 * the coordinates and carries the pointer fields.
 */
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
  // jsdom implements neither pointer capture nor layout.
  Object.assign(HTMLElement.prototype, {
    setPointerCapture,
    releasePointerCapture,
    hasPointerCapture: () => true,
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(RECT);
  // A fine-pointer (desktop) device, so the decorative shovel cursor renders.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(pointer: fine)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  setPointerCapture.mockClear();
  releasePointerCapture.mockClear();
});

function startedRound(seed = 'pointer-test'): TreasureHuntRound {
  const created = createTreasureHuntRound({ seed, policy: TREASURE_HUNT_UI_POLICY });
  if (!created.ok) throw new Error('round creation failed');
  return treasureHuntReducer(created.round, { type: 'start' });
}

interface HarnessProps {
  round: TreasureHuntRound;
  paused?: boolean;
  initialTool?: TreasureTool;
  onMoveDetector?: (p: Point) => void;
  onDig?: (p: Point) => void;
  onToolChange?: (t: TreasureTool) => void;
}

function Harness({
  round,
  paused = false,
  initialTool = 'detector',
  onMoveDetector = () => {},
  onDig = () => {},
  onToolChange,
}: HarnessProps) {
  const [tool, setTool] = useState<TreasureTool>(initialTool);
  return (
    <TreasureHuntGame
      round={round}
      paused={paused}
      tool={tool}
      onToolChange={(next) => {
        setTool(next);
        onToolChange?.(next);
      }}
      onMoveDetector={onMoveDetector}
      onDig={onDig}
      muted={false}
      onToggleMuted={() => {}}
      reducedMotionOverride
    />
  );
}

function field(container: HTMLElement): HTMLElement {
  const element = container.querySelector('[data-treasure-field]');
  if (!(element instanceof HTMLElement)) throw new Error('field not rendered');
  return element;
}

describe('detector dragging', () => {
  it('captures the pointer and dispatches the field-space coil position', () => {
    const onMove = vi.fn();
    const { container } = render(<Harness round={startedRound()} onMoveDetector={onMove} />);

    const center: Point = { x: MAPPING.fieldWidth / 2, y: 0.5 };
    fireEvent.pointerDown(field(container), { pointerId: 7, ...pxFor(center) });

    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0].x).toBeCloseTo(center.x, 6);
    expect(onMove.mock.calls[0][0].y).toBeCloseTo(center.y, 6);
  });

  it('moves dispatch while dragging; release stops them', () => {
    const onMove = vi.fn();
    const { container } = render(<Harness round={startedRound()} onMoveDetector={onMove} />);
    const surface = field(container);

    fireEvent.pointerDown(surface, { pointerId: 7, ...pxFor({ x: 1, y: 0.5 }) });
    fireEvent.pointerMove(surface, { pointerId: 7, ...pxFor({ x: 1.2, y: 0.6 }) });
    expect(onMove).toHaveBeenCalledTimes(2);
    expect(onMove.mock.calls[1][0].x).toBeCloseTo(1.2, 6);

    fireEvent.pointerUp(surface, { pointerId: 7 });
    fireEvent.pointerMove(surface, { pointerId: 7, ...pxFor({ x: 1.4, y: 0.4 }) });
    expect(onMove).toHaveBeenCalledTimes(2); // nothing after release
  });

  it('ignores moves from a pointer that never went down', () => {
    const onMove = vi.fn();
    const { container } = render(<Harness round={startedRound()} onMoveDetector={onMove} />);
    fireEvent.pointerMove(field(container), { pointerId: 3, ...pxFor({ x: 1, y: 0.5 }) });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('pointer cancel and lost capture both end the drag', () => {
    const onMove = vi.fn();
    const { container } = render(<Harness round={startedRound()} onMoveDetector={onMove} />);
    const surface = field(container);

    fireEvent.pointerDown(surface, { pointerId: 7, ...pxFor({ x: 1, y: 0.5 }) });
    fireEvent.pointerCancel(surface, { pointerId: 7 });
    fireEvent.pointerMove(surface, { pointerId: 7, ...pxFor({ x: 1.2, y: 0.5 }) });
    expect(onMove).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(surface, { pointerId: 8, ...pxFor({ x: 1, y: 0.5 }) });
    fireEvent.lostPointerCapture(surface, { pointerId: 8 });
    fireEvent.pointerMove(surface, { pointerId: 8, ...pxFor({ x: 1.2, y: 0.5 }) });
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it('clamps a drag that leaves the sand to the field edge', () => {
    const onMove = vi.fn();
    const { container } = render(<Harness round={startedRound()} onMoveDetector={onMove} />);
    const surface = field(container);

    fireEvent.pointerDown(surface, { pointerId: 7, ...pxFor({ x: 1, y: 0.5 }) });
    // Way off to the right and above the water line.
    fireEvent.pointerMove(surface, { pointerId: 7, clientX: 5000, clientY: -50 });
    const last = onMove.mock.calls[onMove.mock.calls.length - 1][0];
    expect(last.x).toBeCloseTo(MAPPING.fieldWidth, 6);
    expect(last.y).toBeCloseTo(0, 6);
  });

  it('does not react while paused or after the round finishes', () => {
    const onMove = vi.fn();
    const round = startedRound();
    const { container, rerender } = render(
      <Harness round={round} paused onMoveDetector={onMove} />
    );
    fireEvent.pointerDown(field(container), { pointerId: 7, ...pxFor({ x: 1, y: 0.5 }) });
    expect(onMove).not.toHaveBeenCalled();

    const finished = treasureHuntReducer(round, { type: 'end-round' });
    rerender(<Harness round={finished} onMoveDetector={onMove} />);
    fireEvent.pointerDown(field(container), { pointerId: 7, ...pxFor({ x: 1, y: 0.5 }) });
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('shovel digs', () => {
  it('a tap on the sand dispatches exactly one strict-mapped dig', () => {
    const onDig = vi.fn();
    const { container } = render(
      <Harness round={startedRound()} initialTool="shovel" onDig={onDig} />
    );
    const target: Point = { x: 0.5, y: 0.8 };
    fireEvent.pointerDown(field(container), { pointerId: 5, ...pxFor(target) });
    expect(onDig).toHaveBeenCalledTimes(1);
    expect(onDig.mock.calls[0][0].x).toBeCloseTo(target.x, 6);
    expect(onDig.mock.calls[0][0].y).toBeCloseTo(target.y, 6);
    expect(setPointerCapture).not.toHaveBeenCalled(); // taps are not drags
  });

  it('a tap outside the sand (water or letterbox) dispatches nothing', () => {
    const onDig = vi.fn();
    const { container } = render(
      <Harness round={startedRound()} initialTool="shovel" onDig={onDig} />
    );
    // Water strip: inside the image, above the sand.
    fireEvent.pointerDown(field(container), {
      pointerId: 5,
      clientX: WIDTH / 2,
      clientY: MAPPING.layout.imageTop + 2,
    });
    // Letterbox margin, left of the image box.
    fireEvent.pointerDown(field(container), { pointerId: 5, clientX: 1, clientY: HEIGHT / 2 });
    expect(onDig).not.toHaveBeenCalled();
  });

  it('renders dig markers for the round history, misses included', () => {
    let round = startedRound();
    // One guaranteed miss: dig where no target sits.
    const miss = findMissPoint(round);
    round = treasureHuntReducer(round, { type: 'dig', position: miss });
    const { container } = render(<Harness round={round} />);
    expect(container.querySelectorAll('[data-dig-marker]')).toHaveLength(1);
    expect(container.querySelector('[data-dig-marker="miss"]')).not.toBeNull();
  });
});

describe('tools and HUD', () => {
  it('starts with the detector selected and switches to the shovel', () => {
    const onToolChange = vi.fn();
    render(<Harness round={startedRound()} onToolChange={onToolChange} />);

    const detectorButton = screen.getByRole('button', { name: /metal detector/i });
    const shovelButton = screen.getByRole('button', { name: /shovel/i });
    expect(detectorButton).toHaveAttribute('aria-pressed', 'true');
    expect(shovelButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(shovelButton);
    expect(onToolChange).toHaveBeenCalledWith('shovel');
    expect(shovelButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Tap the sand to dig/)).toBeInTheDocument();
    expect(screen.getByText(/5 digs remaining/)).toBeInTheDocument();

    fireEvent.click(detectorButton);
    expect(detectorButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('suppresses browser gestures on the field', () => {
    const { container } = render(<Harness round={startedRound()} />);
    const surface = field(container);
    expect(surface.className).toContain('touch-none');
    expect(surface.className).toContain('select-none');
    expect(surface.dataset.treasureField).toBeDefined();
  });
});

describe('detector docking', () => {
  it('parks a deactivated detector while the shovel is selected and restores the coil position', () => {
    const { container } = render(<Harness round={startedRound()} />);
    const detector = container.querySelector('[data-treasure-detector]') as HTMLElement;
    const activeLeft = detector.style.left;
    const activeOpacity = detector.style.opacity;
    expect(detector.dataset.docked).toBeUndefined();
    expect(detector.className).toContain('pointer-events-none');

    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    expect(detector.dataset.docked).toBe('true');
    expect(detector.dataset.signalLevel).toBe('none'); // display deactivated
    expect(detector.style.left).not.toBe(activeLeft);
    expect(Number(detector.style.opacity)).toBeLessThan(Number(activeOpacity));

    fireEvent.click(screen.getByRole('button', { name: /metal detector/i }));
    // Presentation returned to the LOGICAL coil position; never overwritten.
    expect(detector.dataset.docked).toBeUndefined();
    expect(detector.style.left).toBe(activeLeft);
  });

  it('switching to the shovel mid-drag releases the pointer capture and stops dispatches', () => {
    const onMove = vi.fn();
    const { container } = render(<Harness round={startedRound()} onMoveDetector={onMove} />);
    const surface = field(container);

    fireEvent.pointerDown(surface, { pointerId: 9, ...pxFor({ x: 1, y: 0.5 }) });
    expect(onMove).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    expect(releasePointerCapture).toHaveBeenCalledWith(9);

    fireEvent.pointerMove(surface, { pointerId: 9, ...pxFor({ x: 1.3, y: 0.5 }) });
    expect(onMove).toHaveBeenCalledTimes(1); // the drag is over
  });

  it('a docked (inactive) detector cannot be dragged', () => {
    const onMove = vi.fn();
    const { container } = render(
      <Harness round={startedRound()} initialTool="shovel" onMoveDetector={onMove} />
    );
    fireEvent.pointerDown(field(container), { pointerId: 2, ...pxFor({ x: 1, y: 0.5 }) });
    fireEvent.pointerMove(field(container), { pointerId: 2, ...pxFor({ x: 1.2, y: 0.5 }) });
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('desktop shovel cursor', () => {
  it('follows a fine pointer over the sand, hiding the OS cursor there', () => {
    const { container } = render(<Harness round={startedRound()} initialTool="shovel" />);
    const surface = field(container);

    fireEvent.pointerMove(surface, { pointerId: 3, ...pxFor({ x: 1, y: 0.5 }) });
    expect(container.querySelector('[data-treasure-shovel-cursor]')).not.toBeNull();
    expect(surface.style.cursor).toBe('none');
  });

  it('never renders outside the sand, water strip, letterbox, or after leaving', () => {
    const { container } = render(<Harness round={startedRound()} initialTool="shovel" />);
    const surface = field(container);

    // Water strip: inside the image, above the sand.
    fireEvent.pointerMove(surface, {
      pointerId: 3,
      clientX: WIDTH / 2,
      clientY: MAPPING.layout.imageTop + 2,
    });
    expect(container.querySelector('[data-treasure-shovel-cursor]')).toBeNull();
    expect(surface.style.cursor).not.toBe('none');

    // Back over sand, then leave the field entirely.
    fireEvent.pointerMove(surface, { pointerId: 3, ...pxFor({ x: 1, y: 0.5 }) });
    expect(container.querySelector('[data-treasure-shovel-cursor]')).not.toBeNull();
    fireEvent.pointerLeave(surface);
    expect(container.querySelector('[data-treasure-shovel-cursor]')).toBeNull();
  });

  it('does not follow the pointer while the detector is selected', () => {
    const { container } = render(<Harness round={startedRound()} />);
    fireEvent.pointerMove(field(container), { pointerId: 3, ...pxFor({ x: 1, y: 0.5 }) });
    expect(container.querySelector('[data-treasure-shovel-cursor]')).toBeNull();
  });
});

describe('signal presentation', () => {
  it('keeps one compact status instead of a second prominent meter', () => {
    const { container } = render(<Harness round={startedRound()} />);
    expect(container.querySelector('[data-treasure-meter]')).toBeNull();
    const status = container.querySelector('[data-treasure-signal-status]') as HTMLElement;
    expect(status).not.toBeNull();
    expect(status.dataset.signalLevel).toBe('none'); // initial coil sits in cleared sand
    expect(status.textContent).toContain('No signal'); // sr-only live text
  });

  it('dims inactive tools without hiding or disabling them', () => {
    render(<Harness round={startedRound()} />);
    const shovelButton = screen.getByRole('button', { name: /shovel/i });
    expect(shovelButton.className).toContain('opacity-45');
    expect(shovelButton).not.toBeDisabled();
    fireEvent.click(shovelButton);
    expect(shovelButton.className).not.toContain('opacity-45');
    expect(screen.getByRole('button', { name: /metal detector/i }).className).toContain(
      'opacity-45'
    );
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
