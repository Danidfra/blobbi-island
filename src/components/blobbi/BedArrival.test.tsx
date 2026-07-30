/**
 * End-to-end coverage for the bed flow under GROUND-ANCHOR semantics, driven
 * through the real MovableBlobbi `onMoveComplete` path.
 *
 * The harness mirrors PlayingView's wiring exactly: walk to the bed's ground
 * WALK target → on gated arrival, snap (`goTo(pose, true)`) to the SLEEP POSE
 * anchor, with the synchronous re-entry lock.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { DebugOverlaysProvider } from '@/contexts/DebugOverlaysContext';
import { MovableBlobbi, type MovableBlobbiRef } from './MovableBlobbi';
import { getBedSleepPose, getBedWalkTarget, isBedArrival } from '@/lib/bed-arrival';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';
import { locationBoundaries } from '@/lib/location-boundaries';
import type { LocationId } from '@/lib/location-types';
import type { Position } from '@/lib/types';

vi.mock('./CurrentBlobbiDisplay', () => ({
  CurrentBlobbiDisplay: () => <div data-testid="blobbi-display">Blobbi</div>,
}));

const CONTAINER_RECT = {
  width: 1000, height: 1000, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 1000,
  toJSON: () => ({}),
} as DOMRect;

const DEFAULT_BED_POSITION: Position = { x: 75, y: 70 }; // PlayingView's default

const completions: Position[] = [];

/** Mirrors PlayingView's bed wiring under ground semantics. */
function Harness({ location }: { location: LocationId }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobbiRef = useRef<MovableBlobbiRef>(null);
  const [isSleeping, setIsSleeping] = useState(false);
  const [isAttachedToBed, setIsAttachedToBed] = useState(false);
  const bedLockRef = useRef(false);
  const background = getBackgroundForLocation(location);
  const boundary = locationBoundaries[background];

  const walkTarget = getBedWalkTarget(DEFAULT_BED_POSITION, boundary);

  const handleMoveComplete = (position: Position) => {
    completions.push(position);
    if (!bedLockRef.current && isBedArrival(position, walkTarget, background)) {
      bedLockRef.current = true;
      setIsSleeping(true);
      setIsAttachedToBed(true);
      blobbiRef.current?.goTo(getBedSleepPose(DEFAULT_BED_POSITION), true);
    }
  };

  return (
    <PhotoBoothProvider>
      <DebugOverlaysProvider>
      <MovementBlockerProvider>
        <div ref={containerRef} data-testid="world" data-world-surface>
          <div
            data-testid="sleep-state"
            data-sleeping={isSleeping}
            data-attached={isAttachedToBed}
          />
          <MovableBlobbi
            ref={blobbiRef}
            containerRef={containerRef}
            anchorId="my-blobbi-anchor"
            initialPosition={{ x: 50, y: 85 }}
            boundary={boundary}
            backgroundFile={background}
            isSleeping={isSleeping}
            isAttachedToBed={isAttachedToBed}
            onMoveComplete={handleMoveComplete}
          />
          <button
            type="button"
            data-testid="go-to-bed"
            onClick={() => blobbiRef.current?.goTo(walkTarget, true)}
          >
            go
          </button>
          <button
            type="button"
            data-testid="go-elsewhere"
            onClick={() => blobbiRef.current?.goTo({ x: 20, y: 95 }, true)}
          >
            go elsewhere
          </button>
        </div>
      </MovementBlockerProvider>
      </DebugOverlaysProvider>
    </PhotoBoothProvider>
  );
}

function setup(location: LocationId) {
  completions.length = 0;
  const view = render(<Harness location={location} />);
  const world = screen.getByTestId('world');
  vi.spyOn(world, 'getBoundingClientRect').mockReturnValue(CONTAINER_RECT);
  const state = () => screen.getByTestId('sleep-state');
  const anchor = () => view.container.querySelector('#my-blobbi-anchor') as HTMLElement;
  return { state, anchor };
}

describe('bed arrival (ground semantics)', () => {
  it('arriving at the bed walk target INSIDE the Home sleeps and snaps to the pose anchor', () => {
    const { state, anchor } = setup('home');
    const walkTarget = getBedWalkTarget(
      DEFAULT_BED_POSITION,
      locationBoundaries['home-inside.png'],
    );
    const pose = getBedSleepPose(DEFAULT_BED_POSITION);

    act(() => {
      screen.getByTestId('go-to-bed').click();
    });

    // Arrival at the walk target fired, then the snap moved it to the pose.
    expect(completions[0]).toEqual(walkTarget);
    expect(completions[completions.length - 1]).toEqual(pose);
    expect(state().dataset.sleeping).toBe('true');
    expect(state().dataset.attached).toBe('true');
    // The actor is pinned at the POSE anchor (boundary-bypassing snap).
    expect(anchor().style.left).toBe(`${pose.x}%`);
    expect(anchor().style.top).toBe(`${pose.y}%`);
  });

  it('the same arrival OUTSIDE the Home does not trigger sleeping', () => {
    const { state } = setup('plaza-inside');

    act(() => {
      screen.getByTestId('go-to-bed').click();
    });

    expect(completions.length).toBe(1); // no snap followed
    expect(state().dataset.sleeping).toBe('false');
    expect(state().dataset.attached).toBe('false');
  });

  it.each(['home', 'plaza-inside'] as LocationId[])(
    'ordinary move completions away from the bed are unaffected in "%s"',
    (location) => {
      const { state } = setup(location);

      act(() => {
        screen.getByTestId('go-elsewhere').click();
      });

      expect(completions).toEqual([{ x: 20, y: 95 }]);
      expect(state().dataset.sleeping).toBe('false');
      expect(state().dataset.attached).toBe('false');
    },
  );
});
