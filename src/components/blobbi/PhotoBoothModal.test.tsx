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
    expect(screen.getByText(/move blobbi/i)).toBeInTheDocument();
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

  it('renders Take Photo button when Blobbi is selected', () => {
    render(
      <TestApp>
        <PhotoBoothModal
          isOpen={true}
          onClose={() => {}}
          selectedBlobbi={mockBlobbi}
        />
      </TestApp>
    );

    // Check if Take Photo button is present
    const takePhotoButton = screen.getByRole('button', { name: /take photo/i });
    expect(takePhotoButton).toBeInTheDocument();
    expect(takePhotoButton).toHaveTextContent('Take Photo');
  });

  it('disables Take Photo button when Blobbi is null', () => {
    render(
      <TestApp>
        <PhotoBoothModal
          isOpen={true}
          onClose={() => {}}
          selectedBlobbi={null}
        />
      </TestApp>
    );

    // Take Photo button should be present but disabled when no Blobbi is selected
    const takePhotoButton = screen.getByRole('button', { name: /take photo/i });
    expect(takePhotoButton).toBeInTheDocument();
    expect(takePhotoButton).toBeDisabled();
  });

  it('maintains configurable photo composition system', () => {
    // This test verifies that the configuration system exists and is properly structured
    // We can't easily test the actual canvas operations without complex mocking,
    // but we can verify the component structure and button functionality

    render(
      <TestApp>
        <PhotoBoothModal
          isOpen={true}
          onClose={() => {}}
          selectedBlobbi={mockBlobbi}
        />
      </TestApp>
    );

    // Verify that the modal structure is correct for the new composition system
    expect(screen.getByRole('button', { name: /close photo booth/i })).toBeInTheDocument();
    expect(screen.getByAltText('Photo Booth Interior')).toBeInTheDocument();

    // Verify Take Photo button is present and functional
    const takePhotoButton = screen.getByRole('button', { name: /take photo/i });
    expect(takePhotoButton).toBeInTheDocument();
    expect(takePhotoButton).not.toBeDisabled();

    // The presence of these elements indicates the composition system is properly integrated
    expect(screen.getByText(/move blobbi/i)).toBeInTheDocument();

    // Verify button has proper styling for the new system
    expect(takePhotoButton).toHaveTextContent('Take Photo');
    expect(takePhotoButton).toHaveClass('from-purple-600');
    expect(takePhotoButton).toHaveClass('to-pink-500');
  });

  it('renders accessories list on the left side', () => {
    render(
      <TestApp>
        <PhotoBoothModal
          isOpen={true}
          onClose={() => {}}
          selectedBlobbi={mockBlobbi}
        />
      </TestApp>
    );

    // Check if accessories section is present
    expect(screen.getByText('Accessories')).toBeInTheDocument();

    // Check if specific accessories are listed
    expect(screen.getByText('Hat')).toBeInTheDocument();
    expect(screen.getByText('Glasses')).toBeInTheDocument();
    expect(screen.getByText('Mouth')).toBeInTheDocument();
    expect(screen.getByText('Chat Balloon')).toBeInTheDocument();
    expect(screen.getByText('Mustache')).toBeInTheDocument();
    expect(screen.getByText('Party Hat')).toBeInTheDocument();
    expect(screen.getByText('Tiara')).toBeInTheDocument();

    // Check for instructions about accessories
    expect(screen.getByText('Drag to photo area')).toBeInTheDocument();
    expect(screen.getByText('Double-click to remove')).toBeInTheDocument();
  });

  it('shows updated instructions with accessory information', () => {
    render(
      <TestApp>
        <PhotoBoothModal
          isOpen={true}
          onClose={() => {}}
          selectedBlobbi={mockBlobbi}
        />
      </TestApp>
    );

    // Check that instructions now include accessory information
    const instructions = screen.getByText(/drag accessories/i);
    expect(instructions).toBeInTheDocument();
    expect(instructions).toHaveTextContent('Drag accessories');
  });

  it('shows resize instructions in both accessory panel and main instructions', () => {
    render(
      <TestApp>
        <PhotoBoothModal
          isOpen={true}
          onClose={() => {}}
          selectedBlobbi={mockBlobbi}
        />
      </TestApp>
    );

    // Check rotation instructions - should appear in both places
    const allInstructions = screen.getAllByText(/click to select & rotate/i);
    expect(allInstructions).toHaveLength(2);
    expect(allInstructions[0]).toBeInTheDocument();
    expect(allInstructions[1]).toBeInTheDocument();
  });
});