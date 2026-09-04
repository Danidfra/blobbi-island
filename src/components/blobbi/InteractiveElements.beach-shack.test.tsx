/**
 * Beach shack integration, the treasure hunt launches through the canonical
 * walk-to-interact flow, plays its arrival hop, and suppresses the actor
 * LOCALLY only: the published hidden pose (presence) is never touched.
 *
 * Same harness shape as `InteractiveElements.chairs.test.tsx`: a stubbed
 * `MovableBlobbiRef` whose reported position decides whether a click walks
 * first or fires on the spot.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LocationContext } from '@/contexts/LocationContextValue';
import { TestApp } from '@/test/TestApp';
import { InteractiveElements } from './InteractiveElements';
import type { MovableBlobbiRef } from './MovableBlobbi';
import type { Position } from '@/lib/types';
import {
  treasureShackPlacement,
  treasureShackStandPoint,
} from '@/lib/beach-shack-config';
import { constrainPosition } from '@/lib/boundaries';
import { locationBoundaries } from '@/lib/location-boundaries';

let mockReducedMotion = false;
vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReducedMotion,
}));

async function renderBeach(blobbiAt: () => Position) {
  const goTo = vi.fn();
  const onHideInSpot = vi.fn();
  const onActorSuppressionChange = vi.fn();
  const blobbiRef: React.RefObject<MovableBlobbiRef> = {
    current: {
      goTo,
      snapTo: vi.fn(),
      stop: vi.fn(),
      getCurrentPosition: blobbiAt,
    } as unknown as MovableBlobbiRef,
  };

  render(
    <TestApp>
      <LocationContext.Provider
        value={{
          currentLocation: 'beach',
          setCurrentLocation: vi.fn(),
          previousLocation: null,
          isMapModalOpen: false,
          setIsMapModalOpen: vi.fn(),
          isTransitioning: false,
        }}
      >
        <div data-world-surface data-testid="world">
          <InteractiveElements
            blobbiRef={blobbiRef}
            selectedBlobbi={null}
            onHideInSpot={onHideInSpot}
            onActorSuppressionChange={onActorSuppressionChange}
          />
        </div>
      </LocationContext.Provider>
    </TestApp>
  );

  await screen.findByTestId('world');
  return { goTo, onHideInSpot, onActorSuppressionChange };
}

function shackButton(): HTMLElement {
  const element = document.querySelector('[data-treasure-shack]');
  if (!(element instanceof HTMLElement)) throw new Error('shack not rendered');
  return element;
}

afterEach(() => {
  mockReducedMotion = false;
  // NOT `vi.restoreAllMocks()`: that would strip the implementations off the
  // global setup mocks (ResizeObserver, matchMedia) for later tests here.
  vi.clearAllMocks();
});

describe('treasure-hunt shack on the beach', () => {
  it('renders alongside the boat, as a focusable button with the flip layer', async () => {
    await renderBeach(() => ({ x: 50, y: 81.9 }));
    expect(screen.getByAltText('Treasure Hunt Shack')).toBeInTheDocument();
    expect(screen.getByAltText('Boat')).toBeInTheDocument();

    const button = shackButton();
    expect(button.tagName).toBe('BUTTON'); // keyboard focus + Enter for free
    expect(button.dataset.blockMove).toBeDefined();

    // The horizontal flip comes from the config and lives on its OWN layer,
    // so the hover/press/hop transforms can never overwrite it.
    expect(treasureShackPlacement.flipX).toBe(true);
    const flip = button.querySelector('[data-shack-flip]') as HTMLElement;
    expect(flip).not.toBeNull();
    expect(flip.style.transform).toBe('scaleX(-1)');
    expect(button.querySelector('[data-treasure-shack-anim]')).not.toBeNull();
    // The button itself carries no transform: the hitbox is the placement box.
    expect(button.style.transform).toBe('');
  });

  it('a distant click walks to the authored stand point and does NOT open the hunt', async () => {
    const { goTo } = await renderBeach(() => ({ x: 20, y: 90 }));

    fireEvent.click(screen.getByAltText('Treasure Hunt Shack'));

    expect(goTo).toHaveBeenCalledTimes(1);
    expect(goTo.mock.calls[0][0].x).toBeCloseTo(treasureShackStandPoint.x, 6);
    expect(goTo.mock.calls[0][0].y).toBeCloseTo(treasureShackStandPoint.y, 6);
    expect(screen.queryByText('Beach Treasure Hunt')).not.toBeInTheDocument();
    // No hop either: activation feedback belongs to ARRIVAL, not to a far click.
    expect(shackButton().dataset.activated).toBeUndefined();
  });

  it('the stand point sits inside the beach boundary (no clamping)', () => {
    const boundary = locationBoundaries['beach-open.webp'];
    const clamped = constrainPosition(treasureShackStandPoint, boundary);
    expect(clamped.x).toBeCloseTo(treasureShackStandPoint.x, 6);
    expect(clamped.y).toBeCloseTo(treasureShackStandPoint.y, 6);
  });

  it('arrival plays the hop, then opens the hunt, without touching the hidden pose', async () => {
    const { onHideInSpot } = await renderBeach(() => treasureShackStandPoint);

    fireEvent.click(screen.getByAltText('Treasure Hunt Shack'));

    // Confirmed arrival: the hop state is on and the hunt opens after it.
    expect(shackButton().dataset.activated).toBe('true');
    expect(await screen.findByText('Beach Treasure Hunt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Practice Hunt' })).toBeInTheDocument();
    // The presence-published hiding mechanism is never involved.
    expect(onHideInSpot).not.toHaveBeenCalled();
  });

  it('reduced motion skips the hop and opens immediately', async () => {
    mockReducedMotion = true;
    await renderBeach(() => treasureShackStandPoint);

    fireEvent.click(screen.getByAltText('Treasure Hunt Shack'));

    expect(screen.getByText('Beach Treasure Hunt')).toBeInTheDocument();
    expect(shackButton().dataset.activated).toBeUndefined();
  });

  it('suppresses the actor only while a hunt runs, and restores it on close', async () => {
    mockReducedMotion = true; // immediate open keeps the test synchronous
    const { onHideInSpot, onActorSuppressionChange } = await renderBeach(
      () => treasureShackStandPoint
    );

    fireEvent.click(screen.getByAltText('Treasure Hunt Shack'));
    // Intro open: the Island is still the scene, actor stays visible.
    expect(onActorSuppressionChange).not.toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'Start Practice Hunt' }));
    await waitFor(() => expect(onActorSuppressionChange).toHaveBeenCalledWith(true));

    // Abandon mid-hunt: confirm, leave, the actor must come back.
    fireEvent.click(screen.getByRole('button', { name: /Leave Beach Treasure Hunt/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave Hunt' }));
    await waitFor(() => {
      const calls = onActorSuppressionChange.mock.calls;
      expect(calls[calls.length - 1][0]).toBe(false);
    });
    expect(onHideInSpot).not.toHaveBeenCalled();
  });

  it('source contract: the treasure-hunt UI never touches the published hidden pose', () => {
    const beachDir = join(process.cwd(), 'src/components/blobbi/beach');
    const offenders = readdirSync(beachDir)
      .filter((entry) => /\.tsx?$/.test(entry) && !entry.includes('.test.'))
      .filter((entry) => statSync(join(beachDir, entry)).isFile())
      .filter((entry) => {
        const source = readFileSync(join(beachDir, entry), 'utf8');
        return /hideInSpot|hiddenIn|hideAt\(|useIslandPresence|MultiplayerLayer/.test(source);
      });
    expect(offenders).toEqual([]);
  });
});
