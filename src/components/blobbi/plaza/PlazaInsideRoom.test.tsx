/**
 * The Plaza interior as a room: six pressable storefronts that walk the player
 * over and then say "Coming soon" (or go in, once a destination exists), the
 * door, the occluder, the fountain and the collision furniture.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { LocationContext } from '@/contexts/LocationContextValue';
import { MovementBlockerProvider, useMovementBlocker } from '@/contexts/MovementBlockerContext';
import { DebugOverlaysProvider } from '@/contexts/DebugOverlaysContext';
import { TestApp } from '@/test/TestApp';
import {
  PLAZA_DEPTH,
  PLAZA_DOOR,
  PLAZA_OVERLAY,
  plazaInsideBlockers,
  plazaStorefronts,
} from '@/lib/plaza-inside-config';
import { STOREFRONT_COMING_SOON_TEXT, type StorefrontHotspotConfig } from '@/lib/storefront-hotspots';
import type { Position } from '@/lib/types';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import type { MovableBlobbiRef } from '../MovableBlobbi';
import { InteractiveElements } from '../InteractiveElements';
import { StorefrontHotspot, STOREFRONT_COMING_SOON_MS } from '../StorefrontHotspot';

function BlockerProbe({ onReady }: { onReady: (rects: { id: string }[]) => void }) {
  const { blockers } = useMovementBlocker();
  onReady(blockers);
  return null;
}

/**
 * Render the room through the dispatcher, with a "teleporting" walker: `goTo`
 * records the target and `getCurrentPosition` reports it, so a pending
 * interaction resolves on its first check. The walk is not the subject here;
 * what happens on arrival is.
 */
async function renderRoom() {
  const walks: Position[] = [];
  const blobbiRef: React.RefObject<MovableBlobbiRef> = {
    current: {
      goTo: (target) => {
        walks.push(target);
      },
      snapTo: vi.fn(),
      stop: vi.fn(),
      getCurrentPosition: () => walks[walks.length - 1] ?? { x: 50, y: 46 },
    },
  };
  const setCurrentLocation = vi.fn();
  let blockers: { id: string }[] = [];
  render(
    <TestApp>
      <LocationContext.Provider
        value={{
          currentLocation: 'plaza-inside',
          setCurrentLocation,
          previousLocation: null,
          isMapModalOpen: false,
          setIsMapModalOpen: vi.fn(),
          isTransitioning: false,
        }}
      >
        <DebugOverlaysProvider>
          <MovementBlockerProvider>
            <div data-world-surface>
              <InteractiveElements blobbiRef={blobbiRef} selectedBlobbi={null} />
              <BlockerProbe onReady={(b) => { blockers = b; }} />
            </div>
          </MovementBlockerProvider>
        </DebugOverlaysProvider>
      </LocationContext.Provider>
    </TestApp>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return { walks, setCurrentLocation, blockers: () => blockers };
}

const hotspot = (id: string) => document.querySelector(`[data-storefront="${id}"]`) as HTMLButtonElement;
const signOf = (button: HTMLElement) => button.querySelector('[data-storefront-sign]') as HTMLElement;
const glowOf = (button: HTMLElement) => button.querySelector('[data-storefront-glow]') as HTMLElement;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the Plaza interior', () => {
  it('renders one pressable hotspot per storefront, named for what pressing it does', async () => {
    await renderRoom();
    for (const store of plazaStorefronts) {
      const button = hotspot(store.id);
      expect(button, store.id).not.toBeNull();
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('aria-label', `${store.name} — coming soon`);
      // Over the painted bay, in world percent.
      expect(button.style.left).toBe(`${store.box.x}%`);
      expect(button.style.top).toBe(`${store.box.y}%`);
      expect(button.style.width).toBe(`${store.box.width}%`);
      expect(button.style.height).toBe(`${store.box.height}%`);
      // Above the railing/stairs occluder, so a tap on an upper-floor bay lands.
      expect(Number(button.style.zIndex)).toBeGreaterThan(PLAZA_DEPTH.overlay);
    }
  });

  it('composes nothing that the plate already paints: no kiosk sprites, no inert props', async () => {
    await renderRoom();
    expect(document.querySelector('[data-inert-element]')).toBeNull();
    expect(screen.queryByAltText(/chill lounge|drawing wall|information/i)).toBeNull();
    // What IS composed: the door pair, the occluder, the fountain.
    expect(screen.getByAltText(PLAZA_DOOR.closedAlt)).toBeInTheDocument();
    expect(screen.getByAltText(PLAZA_DOOR.openAlt)).toBeInTheDocument();
    expect(screen.getByAltText(PLAZA_OVERLAY.alt)).toBeInTheDocument();
    expect(screen.getByAltText('Plaza fountain')).toBeInTheDocument();
  });

  it('stretches the door group to the painted door and keeps it below the occluder', async () => {
    await renderRoom();
    const group = document.querySelector('[data-plaza-door]') as HTMLElement;
    expect(group.style.transform).toBe(`scaleY(${PLAZA_DOOR.scaleY})`);
    expect(group.style.left).toBe(`${PLAZA_DOOR.placement.left}%`);
    expect(group.style.width).toBe(`${PLAZA_DOOR.placement.width}%`);
    expect(Number(group.style.zIndex)).toBeLessThan(PLAZA_DEPTH.overlay);
    const overlay = screen.getByAltText(PLAZA_OVERLAY.alt);
    expect(Number(overlay.style.zIndex)).toBe(PLAZA_DEPTH.overlay);
  });

  it('registers the fountain and the planters as collision furniture', async () => {
    const { blockers } = await renderRoom();
    const ids = blockers().map((b) => b.id).sort();
    expect(ids).toEqual(plazaInsideBlockers.map((b) => b.id).sort());
  });

  it('walks the player to the shop and then says "Coming soon" — it does not navigate', async () => {
    vi.useFakeTimers();
    const { walks, setCurrentLocation } = await renderRoom();
    const store = plazaStorefronts[0];
    const button = hotspot(store.id);

    // Quiet until pressed.
    expect(button).toHaveAttribute('data-storefront-phase', 'idle');
    expect(signOf(button).textContent).toBe(store.name);

    fireEvent.click(button);
    expect(walks).toEqual([store.standPoint]);

    // The teleporting walker is already there, so the first check fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(button).toHaveAttribute('data-storefront-phase', 'coming-soon');
    expect(signOf(button).textContent).toBe(STOREFRONT_COMING_SOON_TEXT);
    expect(setCurrentLocation).not.toHaveBeenCalled();

    // …and lets the sign fade again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STOREFRONT_COMING_SOON_MS + 10);
    });
    expect(button).toHaveAttribute('data-storefront-phase', 'idle');
    expect(signOf(button).textContent).toBe(store.name);
  });

  it('walks the door target and leaves for the Plaza square on arrival', async () => {
    const { walks, setCurrentLocation } = await renderRoom();
    fireEvent.click(screen.getByAltText(PLAZA_DOOR.openAlt));
    expect(walks).toEqual([PLAZA_DOOR.walkTarget]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(setCurrentLocation).toHaveBeenCalledWith('plaza');
  });
});

describe('a storefront hotspot on its own', () => {
  const store: StorefrontHotspotConfig = {
    id: 'test-shop',
    name: 'Test Shop',
    box: { x: 10, y: 10, width: 20, height: 20 },
    standPoint: { x: 20, y: 80 },
    destination: null,
  };

  function renderHotspot(config: StorefrontHotspotConfig) {
    const requests: RequestInteractionOptions[] = [];
    const onEnter = vi.fn();
    render(
      <StorefrontHotspot
        config={config}
        zIndex={11}
        requestInteraction={(opts) => {
          requests.push(opts);
        }}
        onEnter={onEnter}
      />,
    );
    return { requests, onEnter, button: hotspot(config.id) };
  }

  it('shows it was pressed for the whole walk, and remembers a touch', () => {
    const { requests, button } = renderHotspot(store);
    fireEvent.pointerDown(button);
    fireEvent.touchStart(button);
    fireEvent.click(button);

    expect(requests).toHaveLength(1);
    expect(requests[0].target).toEqual(store.standPoint);
    expect(requests[0].touch).toBe(true);
    // Selected: the light is on and pulsing, the sign is up and popped.
    expect(button).toHaveAttribute('data-storefront-phase', 'walking');
    expect(glowOf(button).className).toContain('animate-storefront-glow');
    expect(glowOf(button).className).not.toContain('opacity-0');
    expect(signOf(button).className).toContain('animate-cozy-pop');
    expect(signOf(button).className).not.toContain('opacity-0');
  });

  it('lights the storefront rather than boxing it: no ring, no rectangular shadow', () => {
    const { button } = renderHotspot(store);
    expect(button.className).not.toMatch(/\bring-/);
    expect(button.className).not.toMatch(/\bshadow-/);
    // The light is a soft, blurred bloom screened onto the artwork, larger than
    // the bay so its falloff, not the bay's edge, is what the eye meets.
    const glow = glowOf(button);
    expect(glow.className).toContain('radial-gradient');
    expect(glow.className).toContain('blur-md');
    expect(glow.className).toContain('mix-blend-screen');
    expect(glow.className).toContain('rounded-[50%]');
    // Off until pointed at or focused.
    expect(glow.className).toContain('opacity-0');
    expect(glow.className).toContain('group-hover:opacity-100');
    expect(glow.className).toContain('group-focus-visible:opacity-100');
  });

  it('clears when the walk is cancelled', () => {
    const { requests, button } = renderHotspot(store);
    fireEvent.pointerDown(button, { pointerType: 'mouse' });
    fireEvent.click(button);
    expect(requests[0].touch).toBe(false);
    act(() => requests[0].onCancel?.());
    expect(button).toHaveAttribute('data-storefront-phase', 'idle');
    expect(signOf(button).className).toContain('opacity-0');
    expect(glowOf(button).className).toContain('opacity-0');
    expect(glowOf(button).className).not.toContain('animate-storefront-glow');
  });

  it('goes inside on arrival once a destination is configured — the one-field upgrade', () => {
    const open = { ...store, destination: 'plaza' as const };
    const { requests, onEnter, button } = renderHotspot(open);
    expect(button).toHaveAttribute('aria-label', 'Test Shop — go inside');
    fireEvent.click(button);
    act(() => requests[0].action());
    expect(onEnter).toHaveBeenCalledWith('plaza');
    expect(button).toHaveAttribute('data-storefront-phase', 'idle');
    expect(signOf(button).textContent).not.toBe(STOREFRONT_COMING_SOON_TEXT);
  });

  it('is move-blocking UI: a real button, so a tap never also walks the floor', () => {
    const { button } = renderHotspot(store);
    expect(button.matches('button')).toBe(true);
  });
});
