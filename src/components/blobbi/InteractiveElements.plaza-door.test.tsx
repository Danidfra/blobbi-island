import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { LocationContext } from '@/contexts/LocationContextValue';
import { InteractiveElements } from './InteractiveElements';
import type { MovableBlobbiRef } from './MovableBlobbi';
import type { LocationId } from '@/lib/location-types';

/**
 * Behavioural coverage for the Plaza inside door, whose open-door overlay used
 * to never appear: the decorative balcony/staircase layer covered it and
 * swallowed every pointer event, so `:hover` never reached the overlay.
 *
 * `:hover` itself cannot be exercised in jsdom (no Tailwind stylesheet, no
 * layout), so these tests cover the parts that ARE real component logic:
 * the touch-driven reveal, its auto-clear, and the structural invariants that
 * regressed (decorative layer must not capture pointer events; the door must
 * block world movement).
 */

function renderAt(currentLocation: LocationId) {
  const blobbiRef: React.RefObject<MovableBlobbiRef> = {
    current: { goTo: vi.fn(), snapTo: vi.fn(), stop: vi.fn(), getCurrentPosition: () => ({ x: 50, y: 80 }) },
  };

  return render(
    <LocationContext.Provider
      value={{
        currentLocation,
        setCurrentLocation: vi.fn(),
        previousLocation: null,
        isMapModalOpen: false,
        setIsMapModalOpen: vi.fn(),
        isTransitioning: false,
      }}
    >
      <div data-world-surface>
        <InteractiveElements blobbiRef={blobbiRef} selectedBlobbi={null} />
      </div>
    </LocationContext.Provider>,
  );
}

const openOverlay = () => screen.getByAltText('Plaza inside door open').parentElement!;

afterEach(() => {
  vi.useRealTimers();
});

describe('Plaza inside door', () => {
  it('renders the closed door with the open door as an overlay on top of it', () => {
    renderAt('plaza-inside');

    const closed = screen.getByAltText('Plaza inside door');
    const open = screen.getByAltText('Plaza inside door open');

    // Both live in the same positioned group, so the overlay lands on the door.
    expect(closed.parentElement).toBe(openOverlay().parentElement);
    expect(open).toBeInTheDocument();
  });

  it('keeps the open door hidden until it is hovered or tapped', () => {
    renderAt('plaza-inside');

    expect(openOverlay().className).toContain('opacity-0');
    expect(openOverlay().className).not.toContain(' opacity-100');
  });

  it('reveals the open door on tap and hides it again afterwards (mobile parity)', () => {
    vi.useFakeTimers();
    renderAt('plaza-inside');

    // Touch devices never get :hover, so a tap must drive the reveal itself.
    fireEvent.touchStart(openOverlay());
    expect(openOverlay().className).toContain('opacity-100');
    expect(openOverlay().className).not.toContain('opacity-0');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(openOverlay().className).toContain('opacity-0');
  });

  it('does not move or rescale the door when it is tapped', () => {
    renderAt('plaza-inside');

    fireEvent.touchStart(openOverlay());

    // The reveal must be opacity-only: no transform/scale and no animation
    // class, otherwise a large door visibly jumps.
    expect(openOverlay().className).not.toMatch(/\bscale-|\banimate-tap\b/);
  });

  it('blocks world movement so tapping the door never walks the Blobbi to it', () => {
    renderAt('plaza-inside');

    // MovableBlobbi cancels a world move when [data-block-move] is in the
    // event's composed path.
    expect(openOverlay()).toHaveAttribute('data-block-move');
  });

  it('leaves the decorative balcony/staircase layer transparent to pointer events', () => {
    renderAt('plaza-inside');

    // This layer spans the full width and covers the door. Capturing pointer
    // events here is exactly what broke the door's hover.
    expect(screen.getByAltText('Glass Barrier').className).toContain('pointer-events-none');
  });
});
