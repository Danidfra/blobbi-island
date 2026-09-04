/**
 * Coverage for how a SEATED Blobbi is rendered.
 *
 * Sitting is an explicit state (`seatedIn`), not something inferred from
 * coordinates. Everything visual follows from the seat id via
 * `resolveSeatedRender`, and this suite pins each consequence: the rear view,
 * the per-row scale multiplied into the SPRITE wrapper only (never the anchor,
 * which chat bubbles portal into), the suppressed ground shadow, the stopped
 * float, and a clean stand-up on any movement.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { MovableBlobbi, type MovableBlobbiRef } from './MovableBlobbi';
import { getTheaterSeat, seatAnchorPosition } from '@/lib/theater-seats-config';
import type { Position } from '@/lib/types';

const facings: Array<string | undefined> = [];

vi.mock('./CurrentBlobbiDisplay', () => ({
  CurrentBlobbiDisplay: ({ facing }: { facing?: string }) => {
    facings.push(facing);
    return <div data-testid="blobbi-display" data-facing={facing}>Blobbi</div>;
  },
}));

const CONTAINER_RECT = {
  width: 1000, height: 1000, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 1000,
  toJSON: () => ({}),
} as DOMRect;

const moveStarts: Position[] = [];

/** Mirrors PlayingView: one `sittingIn` state, cleared by any movement start. */
function Harness({ initialSeat = null as string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobbiRef = useRef<MovableBlobbiRef>(null);
  const [sittingIn, setSittingIn] = useState<string | null>(initialSeat);

  return (
    <PhotoBoothProvider>
      <MovementBlockerProvider>
        <div ref={containerRef} data-testid="world" data-world-surface>
          <button type="button" data-testid="sit-a1" onClick={() => setSittingIn('theater-seat-a1')}>sit a1</button>
          <button type="button" data-testid="sit-c1" onClick={() => setSittingIn('theater-seat-c1')}>sit c1</button>
          <button type="button" data-testid="sit-bogus" onClick={() => setSittingIn('theater-seat-b1')}>sit off-world</button>
          <MovableBlobbi
            ref={blobbiRef}
            containerRef={containerRef}
            anchorId="my-blobbi-anchor"
            initialPosition={{ x: 50, y: 87 }}
            boundary={{ shape: 'rectangle', x: [0, 100], y: [75, 98] }}
            backgroundFile="stage-inside.png"
            pose={sittingIn ? { kind: 'seated', seatId: sittingIn } : { kind: 'standing' }}
            onMoveStart={(destination) => {
              moveStarts.push(destination);
              setSittingIn(null);
            }}
            onBlobbiClick={() => {}}
          />
        </div>
      </MovementBlockerProvider>
    </PhotoBoothProvider>
  );
}

function setup(initialSeat: string | null = null) {
  moveStarts.length = 0;
  facings.length = 0;
  const { container } = render(<Harness initialSeat={initialSeat} />);
  const world = screen.getByTestId('world');
  vi.spyOn(world, 'getBoundingClientRect').mockReturnValue(CONTAINER_RECT);

  const anchor = () => container.querySelector('#my-blobbi-anchor') as HTMLElement;
  return {
    container,
    world,
    anchor,
    display: () => container.querySelector('[data-testid="blobbi-display"]') as HTMLElement,
    /** The inner wrapper that carries the scale (sibling structure is load-bearing). */
    spriteWrapper: () => anchor().querySelector(':scope > div') as HTMLElement,
    shadow: () => anchor().querySelector('div[style*="radial-gradient"]'),
    floatEl: () => anchor().querySelector('.animate-float'),
    sit: (seat: 'a1' | 'c1' | 'bogus') => act(() => screen.getByTestId(`sit-${seat}`).click()),
    clickWorld: (x: number, y: number) =>
      act(() => {
        world.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, button: 0 }));
      }),
  };
}

describe('seated Blobbi rendering', () => {
  it('faces away from the camera while seated', () => {
    const h = setup();
    expect(h.display().dataset.facing).toBe('front');

    h.sit('a1');
    expect(h.display().dataset.facing).toBe('back');
  });

  it('applies the seat row\'s scale to the sprite wrapper', () => {
    const h = setup();
    expect(h.spriteWrapper().style.transform).toBe('scale(1)');

    h.sit('a1');
    expect(h.spriteWrapper().style.transform).toBe(`scale(${getTheaterSeat('theater-seat-a1')!.seatedScale})`);

    h.sit('c1');
    expect(h.spriteWrapper().style.transform).toBe(`scale(${getTheaterSeat('theater-seat-c1')!.seatedScale})`);
  });

  it('never scales the anchor, chat bubbles portal into it', () => {
    const h = setup('theater-seat-a1');
    // Ground anchor (Phase 2): translation only, never scale.
    expect(h.anchor().style.transform).toBe('translate(-50%, -100%)');
  });

  it('hides the ground shadow while seated', () => {
    const h = setup();
    expect(h.shadow()).not.toBeNull();
    h.sit('a1');
    expect(h.shadow()).toBeNull();
  });

  it('stops the float animation while seated', () => {
    const h = setup();
    expect(h.floatEl()).not.toBeNull();
    h.sit('a1');
    expect(h.floatEl()).toBeNull();
  });

  it('marks the occupied seat on the anchor', () => {
    const h = setup('theater-seat-c1');
    expect(h.anchor().dataset.seatedIn).toBe('theater-seat-c1');
  });

  it('refuses to seat a Blobbi in an off-world chair', () => {
    const h = setup();
    h.sit('bogus');
    expect(h.display().dataset.facing).toBe('front');
    expect(h.shadow()).not.toBeNull();
    expect(h.anchor().dataset.seatedIn).toBeUndefined();
  });

  it('stands up the moment any movement starts', () => {
    const h = setup('theater-seat-a1');
    expect(h.display().dataset.facing).toBe('back');

    h.clickWorld(500, 900);

    expect(moveStarts).toHaveLength(1);
    expect(h.display().dataset.facing).toBe('front');
    expect(h.shadow()).not.toBeNull();
    expect(h.anchor().dataset.seatedIn).toBeUndefined();
  });

  it('renders at the seat POSE with the row-derived seated z (parity with remotes)', () => {
    // A seated Blobbi is DRAWN at the seat's pose anchor with the row's
    // seated z: identical inputs for local and remote seated stacking.
    const h = setup();
    h.sit('a1');
    const seat = getTheaterSeat('theater-seat-a1')!;
    const pose = seatAnchorPosition(seat);
    expect(h.anchor().style.left).toBe(`${pose.x}%`);
    expect(h.anchor().style.top).toBe(`${pose.y}%`);
    // Seated z comes from the SEAT ROW (just behind the own chair's backrest),
    // never from the standing y-bands.
    expect(h.anchor().style.zIndex).toBe(String(seat.zIndex - 5));
  });
});

describe('seat anchors used for snapping', () => {
  it('are derived from configuration, not the DOM, so every client agrees', () => {
    const seat = getTheaterSeat('theater-seat-a1')!;
    const anchor = seatAnchorPosition(seat);
    expect(anchor).toEqual(seatAnchorPosition(seat));
    expect(anchor.y).toBeGreaterThan(75);
    expect(anchor.y).toBeLessThan(98);
  });
});
