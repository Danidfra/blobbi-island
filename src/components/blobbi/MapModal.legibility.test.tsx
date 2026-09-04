/**
 * A new player has to be able to READ the map: every destination labelled
 * without hovering, "You are here" on the place they are — including when
 * they are somewhere the map does not draw (an arcade floor is Town) — and
 * never a raw location id in sight.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import type { LocationId } from '@/lib/location-types';
import { MapModal } from './MapModal';
import { mapDestinationFor } from '@/lib/map-destinations';

let currentLocation: LocationId = 'home';
vi.mock('@/hooks/useLocation', () => ({
  useLocation: () => ({
    isMapModalOpen: true,
    setIsMapModalOpen: vi.fn(),
    currentLocation,
    setCurrentLocation: vi.fn(),
  }),
}));

async function renderMapAt(location: LocationId) {
  currentLocation = location;
  render(
    <TestApp>
      <div className="relative w-full h-screen">
        <MapModal />
      </div>
    </TestApp>,
  );
  return await screen.findByRole('dialog');
}

const DESTINATIONS = ['Town', 'Beach', 'Mine', 'Nostr Station', 'Plaza', 'Home'];

function markerNamed(dialog: HTMLElement, name: string): HTMLElement {
  const marker = [...dialog.querySelectorAll<HTMLElement>('[data-map-destination]')].find(
    (el) => el.getAttribute('title') === name,
  );
  if (!marker) throw new Error(`no marker named ${name}`);
  return marker;
}

describe('map legibility', () => {
  it('labels every destination visibly, with its player-facing name', async () => {
    const dialog = await renderMapAt('home');
    // jsdom cannot measure the map box, which keeps the marker layer
    // `visibility: hidden` until measured — so markers are found by their
    // destination attribute, and the name is read from the label itself.
    for (const name of DESTINATIONS) {
      const marker = markerNamed(dialog, name);
      expect(marker.textContent).toContain(name);
      expect(marker.getAttribute('aria-label')).toMatch(new RegExp(`^(Go to )?${name}`));
    }
  });

  it('marks where the player is with "You are here"', async () => {
    const dialog = await renderMapAt('beach');
    const here = dialog.querySelector('[data-map-here]') as HTMLElement;
    expect(here).toHaveAttribute('aria-label', 'Beach — you are here');
    expect(here).toHaveAttribute('aria-current', 'location');
    expect(here.textContent).toContain('You are here');
    expect(dialog.querySelectorAll('[data-map-here]')).toHaveLength(1);
    expect(dialog).toHaveAccessibleDescription(/You are at Beach/);
  });

  it.each([
    ['arcade', 'Town'],
    ['arcade-minus1', 'Town'],
    ['stage', 'Town'],
    ['clothing-store-inside', 'Town'],
    ['nostr-station-inside', 'Nostr Station'],
    ['plaza-inside', 'Plaza'],
    ['cave-open', 'Mine'],
    ['back-yard', 'Home'],
  ] as [LocationId, string][])('places a player inside %s on %s', async (location, destination) => {
    const dialog = await renderMapAt(location);
    const here = dialog.querySelector('[data-map-here]') as HTMLElement;
    expect(here).toHaveAttribute('aria-label', `${destination} — you are here`);
    expect(dialog).toHaveAccessibleDescription(new RegExp(`You are at ${destination}`));
  });

  it('never shows a raw location id', async () => {
    const dialog = await renderMapAt('arcade-minus1');
    const text = dialog.textContent ?? '';
    for (const raw of ['arcade-minus1', 'nostr-station', 'plaza-inside', 'cave-open', 'back-yard']) {
      expect(text).not.toContain(raw);
    }
  });

  it('maps every location the world has to a destination the map draws', () => {
    const drawn = new Set(['home', 'beach', 'mine', 'nostr-station', 'plaza', 'town']);
    const all: LocationId[] = [
      'town', 'home', 'beach', 'mine', 'nostr-station', 'nostr-station-inside', 'plaza', 'plaza-inside',
      'arcade', 'arcade-1', 'arcade-minus1', 'stage', 'shop', 'back-yard', 'cave-open',
      'clothing-store-inside', 'care-store-inside', 'badges-store-inside', 'furniture-store-inside',
    ];
    for (const location of all) expect(drawn.has(mapDestinationFor(location))).toBe(true);
  });
});
