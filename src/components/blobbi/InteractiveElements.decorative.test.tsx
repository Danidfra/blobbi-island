/**
 * Props that look interactive but lead nowhere are rendered as what they are:
 * decoration. No cursor, no hover, no click — and, where it helps, a small
 * "Coming later". Artwork stays; only the false promise goes.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LocationContext } from '@/contexts/LocationContextValue';
import { TestApp } from '@/test/TestApp';
import { InteractiveElements } from './InteractiveElements';
import type { MovableBlobbiRef } from './MovableBlobbi';
import type { LocationId } from '@/lib/location-types';

async function renderAt(location: LocationId) {
  const goTo = vi.fn();
  const blobbiRef: React.RefObject<MovableBlobbiRef> = {
    current: { goTo, snapTo: vi.fn(), stop: vi.fn(), getCurrentPosition: () => ({ x: 50, y: 80 }) },
  };
  render(
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
        <div data-world-surface>
          <InteractiveElements blobbiRef={blobbiRef} selectedBlobbi={null} />
        </div>
      </LocationContext.Provider>
    </TestApp>,
  );
  // The providers settle asynchronously before the room paints.
  await act(async () => {
    await Promise.resolve();
  });
  return { goTo };
}

const inert = (alt: string) => screen.getByAltText(alt).closest('[data-inert-element]');

describe('unfinished props are decoration', () => {
  it('the beach boat: no walk, no click, a "Coming later" caption', async () => {
    const { goTo } = await renderAt('beach');
    const boat = inert('Boat')!;
    expect(boat).not.toBeNull();
    fireEvent.click(screen.getByAltText('Boat'));
    expect(goTo).not.toHaveBeenCalled();
    expect(boat.querySelector('[data-coming-later]')).not.toBeNull();
  });

  it("the mall's coffee shop", async () => {
    await renderAt('shop');
    expect(inert('Shopping coffe shop')).not.toBeNull();
  });

  it('the plaza kiosks: no pointer cursor on their base art, no hover lift, no walk', async () => {
    const { goTo } = await renderAt('plaza-inside');
    for (const alt of ['Chill lounge entrace', 'Drawing wall entrace', 'Information door']) {
      expect(inert(alt)).not.toBeNull();
      fireEvent.click(screen.getByAltText(alt));
    }
    for (const base of ['Plaza chill lounge', 'Plaza drawing wall', 'Plaza information']) {
      expect(screen.getByAltText(base).className).not.toContain('cursor-pointer');
    }
    expect(goTo).not.toHaveBeenCalled();
    expect(document.querySelector('.group-hover\\:scale-110')).toBeNull();
  });

  it('the plaza inside door still works — it is a real door', async () => {
    await renderAt('plaza-inside');
    expect(screen.getByAltText('Plaza inside door open').closest('[data-inert-element]')).toBeNull();
  });
});
