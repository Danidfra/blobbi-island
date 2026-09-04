import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { MapModal } from './MapModal';

// Mock the useLocation hook
vi.mock('@/hooks/useLocation', () => ({
  useLocation: () => ({
    isMapModalOpen: true,
    setIsMapModalOpen: vi.fn(),
    currentLocation: 'home',
    setCurrentLocation: vi.fn(),
  }),
}));

function renderMap() {
  return render(
    <TestApp>
      <div className="relative w-full h-screen">
        <MapModal />
      </div>
    </TestApp>,
  );
}

describe('MapModal', () => {
  it('frames the map: the map image sits inside the wooden frame, markers and all', async () => {
    renderMap();
    const frame = (await screen.findByRole('dialog')).querySelector('[data-map-frame]') as HTMLElement;
    expect(frame).not.toBeNull();
    // Wood outside, a mat inside: the game's tokens, so every theme keeps it.
    expect(frame.className).toMatch(/border-island-wood/);
    expect(frame.className).toMatch(/bg-island-wood/);
    const map = frame.querySelector('img[alt="Blobbi Village Map"]');
    expect(map).not.toBeNull();
    // Every destination marker lives in the same box as the map image, so the
    // frame changed nothing about their coordinate space.
    for (const marker of frame.querySelectorAll('[data-map-destination]')) {
      expect(marker.parentElement).toBe(map!.parentElement);
    }
  });

  it('renders as a named dialog when open', async () => {
    renderMap();
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Island Map');
  });

  it('tells the player what to do and where they are', async () => {
    // The instruction used to be a floating white pill over the map. It is now
    // the window's description, which also makes it the dialog's accessible
    // description rather than a stray paragraph.
    renderMap();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleDescription(/Tap a place to travel there/);
    expect(dialog).toHaveAccessibleDescription(/Home/);
  });

  it('offers the shared close control', async () => {
    // The bespoke `bg-white/80 … hover:text-red-500` button is gone; the window
    // frame supplies one close affordance for every surface.
    renderMap();
    expect(await screen.findByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
