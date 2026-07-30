/**
 * Chair flow (Phase 3): the shop and Nostr Station chairs route through the
 * canonical pending-interaction system.
 *
 * The legacy flow computed its own rect math and fired the Nostr Hub modal
 * IMMEDIATELY on click — while the Blobbi was still walking (or standing on
 * the far side of the room). These tests pin the migrated contract:
 *
 *  - a chair click starts a WALK to the accepted `{50, 85}` pseudo-sit point
 *    (boundary-clamped, via the canonical resolver);
 *  - the action (Nostr Hub) fires only on confirmed arrival — immediately
 *    only when the Blobbi is already at the chair;
 *  - shop chairs walk with no action at all;
 *  - a world tap cancels the pending chair interaction.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocationContext } from '@/contexts/LocationContextValue';
import { TestApp } from '@/test/TestApp';
import { InteractiveElements } from './InteractiveElements';
import type { MovableBlobbiRef } from './MovableBlobbi';
import type { LocationId } from '@/lib/location-types';
import type { Position } from '@/lib/types';
import { constrainPosition } from '@/lib/boundaries';
import { locationBoundaries } from '@/lib/location-boundaries';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';

const SURFACE_RECT = {
  width: 1046, height: 697, x: 0, y: 0, top: 0, left: 0, right: 1046, bottom: 697,
  toJSON: () => ({}),
} as DOMRect;

const CHAIR_RECT = {
  width: 125, height: 120, x: 200, y: 420, top: 420, left: 200, right: 325, bottom: 540,
  toJSON: () => ({}),
} as DOMRect;

/** The accepted pseudo-sit point: `{50, 85}` of the chair rect, boundary-clamped. */
function expectedChairTarget(location: LocationId): Position {
  const raw = {
    x: ((CHAIR_RECT.left + CHAIR_RECT.width * 0.5) / SURFACE_RECT.width) * 100,
    y: ((CHAIR_RECT.top + CHAIR_RECT.height * 0.85) / SURFACE_RECT.height) * 100,
  };
  return constrainPosition(raw, locationBoundaries[getBackgroundForLocation(location)]);
}

async function renderAt(location: LocationId, blobbiAt: () => Position) {
  const goTo = vi.fn();
  const blobbiRef: React.RefObject<MovableBlobbiRef> = {
    current: { goTo, snapTo: vi.fn(), stop: vi.fn(), getCurrentPosition: blobbiAt },
  };

  const view = render(
    <TestApp>
      <LocationContext.Provider
        value={{
          currentLocation: location,
          setCurrentLocation: vi.fn(),
          previousLocation: null,
          isMapModalOpen: false,
          setIsMapModalOpen: vi.fn(),
          isTransitioning: false,
        }}
      >
        <div data-world-surface data-testid="world">
          <InteractiveElements blobbiRef={blobbiRef} selectedBlobbi={null} />
        </div>
      </LocationContext.Provider>
    </TestApp>,
  );

  // TestApp's login provider renders null until it has read stored logins.
  const surface = await screen.findByTestId('world');
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(SURFACE_RECT);

  const chair = (alt: string) => {
    // The shop renders two identical table groups; any instance works.
    const el = screen.getAllByAltText(alt)[0].parentElement as HTMLElement;
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(CHAIR_RECT);
    return el;
  };

  return { view, goTo, chair, surface };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Nostr Station chairs', () => {
  it('a click far from the chair walks first — the Nostr Hub does NOT open on click', async () => {
    const { goTo, chair } = await renderAt('nostr-station-inside', () => ({ x: 90, y: 95 }));

    fireEvent.click(chair('Nostr Station Chair 1'));

    // The walk started, to the canonical pseudo-sit point…
    const target = expectedChairTarget('nostr-station-inside');
    expect(goTo).toHaveBeenCalledTimes(1);
    expect(goTo.mock.calls[0][0].x).toBeCloseTo(target.x, 6);
    expect(goTo.mock.calls[0][0].y).toBeCloseTo(target.y, 6);
    // …and the modal has NOT opened yet (legacy opened it immediately).
    expect(screen.queryByText(/NOSTR HUB/)).not.toBeInTheDocument();
  });

  it('a click with the Blobbi already at the chair opens the Nostr Hub (confirmed arrival, underfoot)', async () => {
    const target = expectedChairTarget('nostr-station-inside');
    const { chair } = await renderAt('nostr-station-inside', () => target);

    fireEvent.click(chair('Nostr Station Chair 2'));

    expect(screen.getByText(/NOSTR HUB/)).toBeInTheDocument();
  });

  it('a world tap after a chair click cancels the pending interaction — the modal never opens', async () => {
    let pos = { x: 90, y: 95 };
    const { chair, surface } = await renderAt('nostr-station-inside', () => pos);

    fireEvent.click(chair('Nostr Station Chair 3'));
    expect(screen.queryByText(/NOSTR HUB/)).not.toBeInTheDocument();

    // Player taps empty ground: the pending walk-to-interact is abandoned.
    fireEvent.pointerDown(surface);

    // Even if the Blobbi later ends up on the chair point, nothing fires.
    pos = expectedChairTarget('nostr-station-inside');
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
    expect(screen.queryByText(/NOSTR HUB/)).not.toBeInTheDocument();
  });
});

describe('shop chairs', () => {
  it('walk with no action: clicking a shop chair starts the pseudo-sit walk and nothing else', async () => {
    const { goTo, chair } = await renderAt('shop', () => ({ x: 10, y: 95 }));

    fireEvent.click(chair('Shop left chair'));

    const target = expectedChairTarget('shop');
    expect(goTo).toHaveBeenCalledTimes(1);
    expect(goTo.mock.calls[0][0].x).toBeCloseTo(target.x, 6);
    expect(goTo.mock.calls[0][0].y).toBeCloseTo(target.y, 6);
  });
});
