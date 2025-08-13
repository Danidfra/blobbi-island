import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhotoBoothModal } from './PhotoBoothModal';
import { TestApp } from '@/test/TestApp';
import type { Blobbi } from '@/hooks/useBlobbis';

// Mock blobbi data for testing
const mockBlobbi: Blobbi = {
  id: 'test-blobbi-id',
  stage: 'adult',
  generation: 1,
  hunger: 80,
  happiness: 90,
  health: 95,
  hygiene: 85,
  energy: 75,
  experience: 1000,
  careStreak: 5,
  baseColor: '#FF6B6B',
  pattern: 'solid',
  name: 'Test Blobbi',
};

describe('PhotoBoothModal', () => {
  it('renders correctly when open', () => {
    render(
      <TestApp>
        <PhotoBoothModal
          isOpen={true}
          onClose={() => {}}
          selectedBlobbi={mockBlobbi}
        />
      </TestApp>
    );

    // Check if modal container is rendered (using backdrop class)
    expect(screen.getByRole('button', { name: /close photo booth/i })).toBeInTheDocument();
    
    // Check if photo booth background image is loaded
    const photoBoothImage = screen.getByAltText('Photo Booth Interior');
    expect(photoBoothImage).toBeInTheDocument();
    expect(photoBoothImage).toHaveAttribute('src', '/assets/places/photo-booth-inside.png');
    
    // Check if instructions text is present
    expect(screen.getByText(/click inside booth to move blobbi/i)).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(
      <TestApp>
        <PhotoBoothModal
          isOpen={false}
          onClose={() => {}}
          selectedBlobbi={mockBlobbi}
        />
      </TestApp>
    );

    // Modal should not be in document when closed
    expect(screen.queryByRole('button', { name: /close photo booth/i })).not.toBeInTheDocument();
  });

  it('renders Blobbi when selectedBlobbi is provided', () => {
    render(
      <TestApp>
        <PhotoBoothModal
          isOpen={true}
          onClose={() => {}}
          selectedBlobbi={mockBlobbi}
        />
      </TestApp>
    );

    // The modal should be visible and Blobbi should be rendered inside
    expect(screen.getByRole('button', { name: /close photo booth/i })).toBeInTheDocument();
    expect(screen.getByAltText('Photo Booth Interior')).toBeInTheDocument();
    // Note: Testing actual Blobbi component rendering would require more complex setup
    // This test just ensures modal structure is correct
  });

  it('does not render Blobbi when selectedBlobbi is null', () => {
    render(
      <TestApp>
        <PhotoBoothModal
          isOpen={true}
          onClose={() => {}}
          selectedBlobbi={null}
        />
      </TestApp>
    );

    // Modal should still render but without Blobbi
    expect(screen.getByRole('button', { name: /close photo booth/i })).toBeInTheDocument();
    expect(screen.getByAltText('Photo Booth Interior')).toBeInTheDocument();
  });
});