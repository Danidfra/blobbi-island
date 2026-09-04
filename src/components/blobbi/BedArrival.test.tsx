/**
 * End-to-end coverage for the bed flow (Phase 3), driven through the REAL
 * production wiring: `useBlobbiPoseController.requestBedSleep` → the canonical
 * pending-interaction walk → confirmed arrival → sleeping pose + `snapTo` onto
 * the sleep anchor.
 *
 * The old flow inferred bed arrival from movement-completion coordinates,
 * which meant ANY walk that happened to end near the bed put the Blobbi to
 * sleep. These tests pin the new contract: only a bed request sleeps, world
 * taps cancel a pending bed walk, movement wakes, and dragging the bed drags
 * the sleeper.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import { useRef } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { DebugOverlaysProvider } from '@/contexts/DebugOverlaysContext';
import { MovableBlobbi, type MovableBlobbiRef } from './MovableBlobbi';
import { useBlobbiPoseController } from '@/hooks/useBlobbiPoseController';
import { getBedSleepPose, getBedWalkTarget } from '@/lib/bed-arrival';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';
import { locationBoundaries } from '@/lib/location-boundaries';
import type { Position } from '@/lib/types';

vi.mock('./CurrentBlobbiDisplay', () => ({
  CurrentBlobbiDisplay: () => <div data-testid="blobbi-display">Blobbi</div>,
}));

const CONTAINER_RECT = {
  width: 1000, height: 1000, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 1000,
  toJSON: () => ({}),
} as DOMRect;

const DEFAULT_BED_POSITION: Position = { x: 75, y: 70 }; // pose controller default
const BACKGROUND = getBackgroundForLocation('home');
const BOUNDARY = locationBoundaries[BACKGROUND];
const WALK_TARGET = getBedWalkTarget(DEFAULT_BED_POSITION, BOUNDARY);
const SLEEP_POSE = getBedSleepPose(DEFAULT_BED_POSITION);

const completions: Position[] = [];

/** Mirrors PlayingView's bed wiring exactly (pose controller + MovableBlobbi). */
function Harness({ initialPosition }: { initialPosition: Position }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobbiRef = useRef<MovableBlobbiRef>(null);

  const {
    pose,
    handleMoveStart,
    handleMoveComplete,
    handleWakeUp,
    requestBedSleep,
    handleBedPositionChange,
  } = useBlobbiPoseController({
    blobbiRef,
    currentLocation: 'home',
    boundary: BOUNDARY,
    onMoveComplete: (position) => completions.push(position),
  });

  return (
    <PhotoBoothProvider>
      <DebugOverlaysProvider>
      <MovementBlockerProvider>
        <div ref={containerRef} data-testid="world" data-world-surface>
          <div data-testid="sleep-state" data-pose={pose.kind} />
          <MovableBlobbi
            ref={blobbiRef}
            containerRef={containerRef}
            anchorId="my-blobbi-anchor"
            initialPosition={initialPosition}
            boundary={BOUNDARY}
            backgroundFile={BACKGROUND}
            pose={pose}
            onMoveStart={handleMoveStart}
            onMoveComplete={handleMoveComplete}
            onWakeUp={handleWakeUp}
          />
          <button
            type="button"
            data-testid="bed"
            data-block-move
            onClick={(e) => {
              e.stopPropagation();
              requestBedSleep();
            }}
          >
            bed
          </button>
          <button
            type="button"
            data-testid="drag-bed"
            data-block-move
            onClick={(e) => {
              e.stopPropagation();
              handleBedPositionChange({ x: 40, y: 68 });
            }}
          >
            drag bed
          </button>
          <button
            type="button"
            data-testid="walk-near-bed"
            data-block-move
            onClick={(e) => {
              e.stopPropagation();
              blobbiRef.current?.snapTo(WALK_TARGET);
            }}
          >
            walk near bed
          </button>
        </div>
      </MovementBlockerProvider>
      </DebugOverlaysProvider>
    </PhotoBoothProvider>
  );
}

function setup(initialPosition: Position) {
  completions.length = 0;
  const view = render(<Harness initialPosition={initialPosition} />);
  const world = screen.getByTestId('world');
  vi.spyOn(world, 'getBoundingClientRect').mockReturnValue(CONTAINER_RECT);
  const state = () => screen.getByTestId('sleep-state');
  const anchor = () => view.container.querySelector('#my-blobbi-anchor') as HTMLElement;
  return { state, anchor, world };
}

describe('bed flow (pending-interaction based)', () => {
  it('requesting the bed beside it sleeps immediately and snaps to the pose anchor', () => {
    // Standing exactly on the walk target: the pending interaction fires its
    // underfoot path synchronously → sleep + snap.
    const { state, anchor } = setup(WALK_TARGET);

    act(() => {
      screen.getByTestId('bed').click();
    });

    expect(state().dataset.pose).toBe('sleeping');
    // The actor is pinned at the POSE anchor (boundary-bypassing snap).
    expect(anchor().style.left).toBe(`${SLEEP_POSE.x}%`);
    expect(anchor().style.top).toBe(`${SLEEP_POSE.y}%`);
    expect(completions[completions.length - 1]).toEqual(SLEEP_POSE);
  });

  it('a movement completion near the bed WITHOUT a bed request never sleeps', () => {
    const { state } = setup({ x: 50, y: 85 });

    act(() => {
      screen.getByTestId('walk-near-bed').click();
    });

    expect(completions).toEqual([WALK_TARGET]);
    expect(state().dataset.pose).toBe('standing');
  });

  it('a world tap cancels a pending bed walk before arrival; no sleep fires later', () => {
    // Far from the bed: the request starts a WALK (no immediate fire).
    const { state, world } = setup({ x: 20, y: 95 });

    act(() => {
      screen.getByTestId('bed').click();
    });
    expect(state().dataset.pose).toBe('standing'); // walking, not asleep

    // Player taps empty ground: the pending interaction is abandoned.
    act(() => {
      world.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });

    expect(state().dataset.pose).toBe('standing');
  });

  it('starting to move wakes and detaches (world tap while asleep only wakes)', () => {
    const { state, world, anchor } = setup(WALK_TARGET);

    act(() => {
      screen.getByTestId('bed').click();
    });
    expect(state().dataset.pose).toBe('sleeping');

    // First world tap while asleep: wake only, no walk.
    act(() => {
      world.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });
    expect(state().dataset.pose).toBe('standing');
    // Still lying where it woke (the pose anchor) until it walks somewhere.
    expect(anchor().style.left).toBe(`${SLEEP_POSE.x}%`);
  });

  it('dragging the bed while asleep drags the sleeper (re-snap onto the moved pose)', () => {
    const { state, anchor } = setup(WALK_TARGET);

    act(() => {
      screen.getByTestId('bed').click();
    });
    expect(state().dataset.pose).toBe('sleeping');

    act(() => {
      screen.getByTestId('drag-bed').click();
    });

    const movedPose = getBedSleepPose({ x: 40, y: 68 });
    expect(state().dataset.pose).toBe('sleeping');
    expect(anchor().style.left).toBe(`${movedPose.x}%`);
    expect(anchor().style.top).toBe(`${movedPose.y}%`);
  });
});
