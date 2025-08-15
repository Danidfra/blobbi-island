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

describe('MapModal', () => {
  it('renders modal when open', () => {
    render(
      <TestApp>
        <div className="relative w-full h-screen">
          <MapModal />
        </div>
      </TestApp>
    );

    expect(screen.getByText(/Click on a location to travel there/)).toBeInTheDocument();
    expect(screen.getByText(/home/)).toBeInTheDocument();
  });

  it('renders close button', () => {
    render(
      <TestApp>
        <div className="relative w-full h-screen">
          <MapModal />
        </div>
      </TestApp>
    );

    expect(screen.getByLabelText('Close Map')).toBeInTheDocument();
  });
});