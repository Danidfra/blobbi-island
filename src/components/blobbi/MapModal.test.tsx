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
