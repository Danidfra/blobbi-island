/**
 * Coverage for `visualHidden` — how "hidden inside a hiding spot" (e.g. a Town
 * bush) is rendered for the LOCAL player.
 *
 * The requirement is that the Blobbi is truly not painted (removing the bush art
 * must reveal empty ground, not a Blobbi behind it) while everything else keeps
 * working: the logical world position, the movement animation and — critically —
 * the world-click listener, so the very next click both reveals the Blobbi and
 * walks it out. That is why hiding does NOT reuse `isVisible`, which unmounts
 * the character together with its input handling.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { MovableBlobbi, type MovableBlobbiRef } from './MovableBlobbi';
import type { Position } from '@/lib/types';

vi.mock('./CurrentBlobbiDisplay', () => ({
  CurrentBlobbiDisplay: () => <div data-testid="blobbi-display">Blobbi</div>,
}));

const CONTAINER_RECT = {
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

const moveStarts: Position[] = [];

/**
 * Mirrors PlayingView's wiring: a single `hiddenIn` state owns the hidden flag,
 * arrival sets it, and ANY movement start clears it.
 */
function Harness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobbiRef = useRef<MovableBlobbiRef>(null);
  const [hiddenIn, setHiddenIn] = useState<string | null>(null);

  return (
    <PhotoBoothProvider>
      <MovementBlockerProvider>
      <div ref={containerRef} data-testid="world" data-world-surface>
        <button type="button" data-testid="arrive" onClick={() => setHiddenIn('town-bush-1')}>
          arrive
        </button>
        <MovableBlobbi
          ref={blobbiRef}
          containerRef={containerRef}
          anchorId="my-blobbi-anchor"
          initialPosition={{ x: 50, y: 75 }}
          boundary={{ shape: 'rectangle', x: [0, 100], y: [60, 100] }}
          backgroundFile="town-open.png"
          visualHidden={hiddenIn !== null}
          onMoveStart={(destination) => {
            moveStarts.push(destination);
            setHiddenIn(null);
          }}
          onBlobbiClick={() => {}}
        />
      </div>
      </MovementBlockerProvider>
    </PhotoBoothProvider>
  );
}

function setup() {
  moveStarts.length = 0;
  const { container } = render(<Harness />);
  const world = screen.getByTestId('world');
  vi.spyOn(world, 'getBoundingClientRect').mockReturnValue(CONTAINER_RECT);
  return {
    container,
    world,
    anchor: () => container.querySelector('#my-blobbi-anchor') as HTMLElement,
    sprite: () => container.querySelector('[data-testid="blobbi-display"]'),
    hide: () => act(() => screen.getByTestId('arrive').click()),
    clickWorld: (clientX: number, clientY: number) =>
      act(() => {
        world.dispatchEvent(
          new MouseEvent('pointerdown', { clientX, clientY, bubbles: true, button: 0 }),
        );
      }),
  };
}

describe('MovableBlobbi visualHidden (hidden in a hiding spot)', () => {
  it('renders the Blobbi normally until it is hidden', () => {
    const h = setup();
    expect(h.sprite()).toBeInTheDocument();
    expect(h.anchor()).not.toHaveAttribute('data-visual-hidden');
  });

  it('renders no Blobbi visual at all while hidden', () => {
    const h = setup();
    h.hide();

    // Nothing of the Blobbi is painted: no sprite, no ground shadow, no
    // drop-shadow filter — only the (empty) position anchor survives.
    expect(h.sprite()).not.toBeInTheDocument();
    const anchor = h.anchor();
    expect(anchor).toBeInTheDocument();
    expect(anchor).toHaveAttribute('data-visual-hidden', 'true');
    expect(anchor.children).toHaveLength(0);
    expect(anchor.style.filter).toBe('');
  });

  it('keeps the logical world position while hidden', () => {
    const h = setup();
    const before = h.anchor().style.top;
    h.hide();
    expect(h.anchor().style.left).toBe('50%');
    expect(h.anchor().style.top).toBe(before);
  });

  it('still reacts to a world click while hidden, and reveals immediately', () => {
    const h = setup();
    h.hide();
    expect(h.sprite()).not.toBeInTheDocument();

    // Choosing another destination: movement starts...
    h.clickWorld(200, 800);

    expect(moveStarts).toHaveLength(1);
    expect(moveStarts[0]).toEqual({ x: 20, y: 80 });
    // ...and the Blobbi is visible again right away, from the bush position.
    expect(h.sprite()).toBeInTheDocument();
    expect(h.anchor()).not.toHaveAttribute('data-visual-hidden');
  });

  it('is not clickable while hidden (no invisible hit target)', () => {
    const h = setup();
    h.hide();
    expect(h.anchor().className).toContain('pointer-events-none');
    expect(h.anchor().className).not.toContain('pointer-events-auto');
  });
});
