import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { InteractiveElements } from './InteractiveElements';

// Mock the useLocation hook
vi.mock('@/hooks/useLocation', () => ({
  useLocation: vi.fn(() => ({
    currentLocation: 'town',
    isMapModalOpen: false,
  })),
}));

// Mock the getBackgroundForLocation function
vi.mock('@/lib/location-backgrounds', () => ({
  getBackgroundForLocation: vi.fn(() => 'town-open.png'),
}));

describe('InteractiveElements', () => {
  it('renders town elements when background is town-open.png', () => {
    render(
      <TestApp>
        <InteractiveElements />
      </TestApp>
    );

    // Check that town elements are rendered
    expect(screen.getByAltText('Arcade')).toBeInTheDocument();
    expect(screen.getByAltText('Stage')).toBeInTheDocument();
    expect(screen.getByAltText('Shop')).toBeInTheDocument();
  });
});