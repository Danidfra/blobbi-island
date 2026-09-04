/**
 * GROUND-ANCHOR semantics: the Phase 2 actor contract
 * (replaces the Phase 0 legacy center-anchor pin tests deliberately).
 *
 *   - the stored position is the actor's GROUND-CONTACT point: the anchor uses
 *     `translate(-50%, -100%)`, so the box's bottom-center sits on left/top;
 *   - the visual rig grows upward and scales around `bottom center`: depth
 *     scale never moves the feet off the stored point;
 *   - the ground shadow is CENTERED on the stored point and never inherits
 *     the float bob;
 *   - movement targets, `goTo`, and callbacks all use ground points.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import { useRef } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { MovableBlobbi, type MovableBlobbiRef } from './MovableBlobbi';
import { resolveBlobbiScale } from '@/lib/blobbi-world-render';
import type { Boundary } from '@/lib/boundaries';
import type { Position } from '@/lib/types';

vi.mock('./CurrentBlobbiDisplay', () => ({
  CurrentBlobbiDisplay: () => <div data-testid="blobbi-display">Blobbi</div>,
}));

const CONTAINER_RECT = {
  width: 1000, height: 1000, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 1000,
  toJSON: () => ({}),
} as DOMRect;

// A room with a real depth ramp (nostr-station-open: front 1.2 → back 0.6),
// using its REAL migrated ground boundary range so the ramp is non-trivial.
const BACKGROUND = 'nostr-station-open.webp';
const BOUNDARY: Boundary = { shape: 'rectangle', x: [0, 100], y: [64, 100] };
const INITIAL: Position = { x: 50, y: 82 };

function Harness({ scaleByYPosition = true }: { scaleByYPosition?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobbiRef = useRef<MovableBlobbiRef>(null);

  return (
    <PhotoBoothProvider>
      <MovementBlockerProvider>
        <div ref={containerRef} data-testid="world" data-world-surface>
          <MovableBlobbi
            ref={blobbiRef}
            containerRef={containerRef}
            anchorId="my-blobbi-anchor"
            initialPosition={INITIAL}
            boundary={BOUNDARY}
            backgroundFile={BACKGROUND}
            scaleByYPosition={scaleByYPosition}
          />
          <button
            type="button"
            data-testid="snap-back"
            onClick={() => blobbiRef.current?.snapTo({ x: 30, y: 66 })}
          >
            snap
          </button>
        </div>
      </MovementBlockerProvider>
    </PhotoBoothProvider>
  );
}

function setup(scaleByYPosition = true) {
  const { container } = render(<Harness scaleByYPosition={scaleByYPosition} />);
  const world = screen.getByTestId('world');
  vi.spyOn(world, 'getBoundingClientRect').mockReturnValue(CONTAINER_RECT);

  const anchor = () => container.querySelector('#my-blobbi-anchor') as HTMLElement;
  const rig = () => anchor().querySelector<HTMLElement>('[data-blobbi-scale-rig]');
  const shadow = () => anchor().querySelector<HTMLElement>('[data-blobbi-shadow]');
  return { anchor, rig, shadow };
}

describe('ground-anchor actor semantics', () => {
  it('the stored position maps to the actor GROUND anchor (bottom-center translation)', () => {
    const { anchor } = setup();

    expect(anchor().style.left).toBe(`${INITIAL.x}%`);
    expect(anchor().style.top).toBe(`${INITIAL.y}%`);
    // translate(-50%, -100%): the box's BOTTOM-CENTER sits on the stored point
    // and the visual rig grows upward from it.
    expect(anchor().style.transform).toBe('translate(-50%, -100%)');
  });

  it('a movement target is a ground point: goTo places the feet there', () => {
    const { anchor } = setup();

    act(() => {
      screen.getByTestId('snap-back').click();
    });

    expect(anchor().style.left).toBe('30%');
    expect(anchor().style.top).toBe('66%');
    expect(anchor().style.transform).toBe('translate(-50%, -100%)');
  });

  it('depth scaling happens around BOTTOM CENTER on the rig, the feet never move', () => {
    const { anchor, rig } = setup();

    const expectedScale = resolveBlobbiScale(INITIAL, BACKGROUND, BOUNDARY);
    expect(expectedScale).not.toBe(1); // the fixture room really ramps

    // The anchor itself carries translation only; never scale (it is the
    // chat-bubble portal anchor).
    expect(anchor().style.transform).toBe('translate(-50%, -100%)');

    const rigEl = rig();
    expect(rigEl).not.toBeNull();
    expect(rigEl!.style.transform).toBe(`scale(${expectedScale})`);
    // Bottom-center origin: scaling shrinks/grows the body upward from the
    // ground point, keeping the feet planted on the stored position.
    expect(rigEl!.style.transformOrigin).toBe('bottom center');
  });

  it('changing depth scale does not change the ground position', () => {
    const { anchor, rig } = setup();

    const before = { left: anchor().style.left, top: anchor().style.top };
    // Snap toward the back of the room, the scale changes, the anchor is
    // still exactly the stored ground point.
    act(() => {
      screen.getByTestId('snap-back').click();
    });
    const scaleAtBack = resolveBlobbiScale({ x: 30, y: 66 }, BACKGROUND, BOUNDARY);
    expect(rig()!.style.transform).toBe(`scale(${scaleAtBack})`);
    expect(anchor().style.transform).toBe('translate(-50%, -100%)'); // unchanged rule
    expect(anchor().style.left).not.toBe(before.left); // it moved because the POSITION moved…
    // …and the anchor still marks the exact stored point (no scale-dependent offset).
    expect(anchor().style.top).toBe('66%');
  });

  it('the ground shadow is centered ON the anchor point and scales only its own width', () => {
    const { anchor, shadow } = setup();

    const el = shadow();
    expect(el).not.toBeNull();
    expect(el!.parentElement).toBe(anchor());
    // top-full of a translate(-50%,-100%) box is the ground line; the
    // translate(-50%,-50%) centers the ellipse exactly on the stored point.
    expect(el!.classList.contains('top-full')).toBe(true);
    const expectedScale = resolveBlobbiScale(INITIAL, BACKGROUND, BOUNDARY);
    expect(el!.style.transform).toBe(`translate(-50%, -50%) scale(${expectedScale})`);
    // The shadow is OUTSIDE the float wrapper (sibling of the rig): the bob
    // animation can never move it.
    expect(el!.closest('.animate-float')).toBeNull();
  });

  it('without scaleByYPosition the rig renders at scale(1) (control case)', () => {
    const { rig } = setup(false);
    expect(rig()!.style.transform).toBe('scale(1)');
  });
});
