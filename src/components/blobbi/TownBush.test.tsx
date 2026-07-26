/**
 * Behavioural coverage for the Town bush hiding interaction.
 *
 * The bush used to hide the Blobbi by temporarily raising its own z-index above
 * the Blobbi's dynamic z-index, aiming the walk at the bush's lower edge. That
 * was unreliable (parts of the Blobbi stayed visible, and a raised bush could
 * paint over another bush). Hiding is now an explicit state: the Blobbi walks to
 * the bush's CONFIGURED center and its visual stops being rendered, while the
 * bush keeps a fixed z-index forever.
 *
 * These tests pin that contract: the configured target is used, effects and the
 * hide fire only on confirmed arrival, the z-index never moves, and re-clicking
 * the bush the Blobbi is already hidden in is a no-op.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { TownBush } from './TownBush';
import { townBushes, type TownBushConfig } from '@/lib/town-bushes-config';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';

// ---------------------------------------------------------------------------
// Audio stub: jsdom has no media playback, and we want to count rustles.
// ---------------------------------------------------------------------------
let audioPlays: string[];

class FakeAudio {
  currentTime = 0;
  volume = 1;
  preload = '';
  constructor(public src: string) {}
  play() {
    audioPlays.push(this.src);
    return Promise.resolve();
  }
  pause() {}
}

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

/** Bush rect used by every test: 160×190 px sitting at (0, 640) in the surface. */
const BUSH_RECT = {
  width: 160,
  height: 190,
  x: 0,
  y: 640,
  top: 640,
  left: 0,
  right: 160,
  bottom: 830,
  toJSON: () => ({}),
} as DOMRect;

interface Harness {
  requests: RequestInteractionOptions[];
  hides: string[];
  bush: HTMLElement;
  rerenderWithHiddenIn: (hiddenIn: string | null) => void;
  leafCount: () => number;
}

function renderBush(
  config: TownBushConfig,
  initialHiddenIn: string | null = null,
): Harness {
  const requests: RequestInteractionOptions[] = [];
  const hides: string[] = [];

  const ui = (hiddenIn: string | null) => (
    <div data-world-surface>
      <TownBush
        config={config}
        requestInteraction={(opts) => requests.push(opts)}
        hiddenIn={hiddenIn}
        onHide={(id) => hides.push(id)}
      />
    </div>
  );

  const { container, rerender } = render(ui(initialHiddenIn));

  const surface = container.querySelector('[data-world-surface]') as HTMLElement;
  const bush = container.querySelector(`[data-bush-id="${config.id}"]`) as HTMLElement;
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(SURFACE_RECT);
  vi.spyOn(bush, 'getBoundingClientRect').mockReturnValue(BUSH_RECT);

  return {
    requests,
    hides,
    bush,
    rerenderWithHiddenIn: (hiddenIn) => rerender(ui(hiddenIn)),
    leafCount: () => bush.querySelectorAll('.animate-leaf-burst').length,
  };
}

/** World-percent point the configured fractions should resolve to. */
function expectedTarget(config: TownBushConfig) {
  return {
    x: ((BUSH_RECT.left + BUSH_RECT.width * config.interactionTarget.x) / SURFACE_RECT.width) * 100,
    y: ((BUSH_RECT.top + BUSH_RECT.height * config.interactionTarget.y) / SURFACE_RECT.height) * 100,
  };
}

beforeEach(() => {
  audioPlays = [];
  vi.stubGlobal('Audio', FakeAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Town bush hiding', () => {
  const bush1 = townBushes[0];

  it('walks to the bush\'s configured center, not its lower edge', () => {
    const h = renderBush(bush1);

    fireEvent.click(h.bush);

    expect(h.requests).toHaveLength(1);
    const target = h.requests[0].target;
    const expected = expectedTarget(bush1);
    expect(target.x).toBeCloseTo(expected.x, 5);
    expect(target.y).toBeCloseTo(expected.y, 5);

    // The old behavior aimed just above the bush's base (bottom - 10% of the
    // height); the center must sit clearly higher than that.
    const baseEdgeY = ((BUSH_RECT.bottom - BUSH_RECT.height * 0.1) / SURFACE_RECT.height) * 100;
    expect(target.y).toBeLessThan(baseEdgeY);
  });

  it('honours a per-bush target override instead of hard-coded coordinates', () => {
    const offCenter: TownBushConfig = {
      ...bush1,
      id: 'town-bush-test',
      interactionTarget: { x: 0.25, y: 0.4 },
    };
    const h = renderBush(offCenter);

    fireEvent.click(h.bush);

    const expected = expectedTarget(offCenter);
    expect(h.requests[0].target.x).toBeCloseTo(expected.x, 5);
    expect(h.requests[0].target.y).toBeCloseTo(expected.y, 5);
  });

  it('hides and plays the effects only after confirmed arrival', () => {
    const h = renderBush(bush1);

    fireEvent.click(h.bush);

    // Clicking only requests the walk: nothing has happened yet.
    expect(h.hides).toEqual([]);
    expect(audioPlays).toEqual([]);
    expect(h.leafCount()).toBe(0);

    // The movement system reports arrival.
    act(() => h.requests[0].action());

    expect(h.hides).toEqual([bush1.id]);
    expect(audioPlays).toHaveLength(1);
    expect(h.leafCount()).toBeGreaterThan(0);
  });

  it('does not hide when the walk is cancelled before arrival', () => {
    const h = renderBush(bush1);

    fireEvent.click(h.bush);
    act(() => h.requests[0].onCancel?.());

    expect(h.hides).toEqual([]);
    expect(audioPlays).toEqual([]);
    expect(h.leafCount()).toBe(0);
  });

  it('keeps a fixed z-index through click, arrival and hiding', () => {
    const h = renderBush(bush1);
    const zIndex = () => h.bush.style.zIndex;

    expect(zIndex()).toBe(String(bush1.zIndex));

    fireEvent.click(h.bush);
    expect(zIndex()).toBe(String(bush1.zIndex));

    act(() => h.requests[0].action());
    expect(zIndex()).toBe(String(bush1.zIndex));

    // And while the player is registered as hidden inside it.
    act(() => h.rerenderWithHiddenIn(bush1.id));
    expect(zIndex()).toBe(String(bush1.zIndex));
  });

  it('ignores repeated clicks on the bush it is already hidden in', () => {
    const h = renderBush(bush1);

    fireEvent.click(h.bush);
    act(() => h.requests[0].action());

    const leavesAfterArrival = h.leafCount();
    act(() => h.rerenderWithHiddenIn(bush1.id));

    fireEvent.click(h.bush);
    fireEvent.click(h.bush);

    // No second walk, no extra rustle, no extra leaf burst.
    expect(h.requests).toHaveLength(1);
    expect(audioPlays).toHaveLength(1);
    expect(h.leafCount()).toBe(leavesAfterArrival);
    expect(h.hides).toEqual([bush1.id]);
  });

  it('can be re-entered after the player has left it', () => {
    const h = renderBush(bush1, bush1.id);

    // Left the bush (PlayingView cleared the state when movement started).
    act(() => h.rerenderWithHiddenIn(null));

    fireEvent.click(h.bush);
    expect(h.requests).toHaveLength(1);

    act(() => h.requests[0].action());
    expect(h.hides).toEqual([bush1.id]);
  });

  it('is clickable while still blocking world movement', () => {
    const h = renderBush(bush1);
    expect(h.bush).toHaveAttribute('data-block-move');
  });

  it('gives every bush a unique hiding-spot id', () => {
    const ids = townBushes.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
