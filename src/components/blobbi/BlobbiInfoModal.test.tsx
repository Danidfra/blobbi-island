import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { BlobbiInfoModal } from './BlobbiInfoModal';

describe('BlobbiInfoModal', () => {
  it('renders modal when open', () => {
    render(
      <TestApp>
        <div className="relative w-full h-screen">
          <BlobbiInfoModal isOpen={true} onClose={() => {}} />
        </div>
      </TestApp>
    );

    // Since there's no current pet in the test environment, it should show the no pet message
    expect(screen.getByText('No Blobbi selected')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(
      <TestApp>
        <BlobbiInfoModal isOpen={false} onClose={() => {}} />
      </TestApp>
    );

    expect(screen.queryByText('Blobbi Info')).not.toBeInTheDocument();
  });

  it('shows modal with no pet message', () => {
    render(
      <TestApp>
        <div className="relative w-full h-screen">
          <BlobbiInfoModal isOpen={true} onClose={() => {}} />
        </div>
      </TestApp>
    );

    // The modal should show "No Blobbi selected" when there's no pet
    expect(screen.getByText('No Blobbi selected')).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
  });

  it('shows read-only modal with external Blobbi data', () => {
    const mockBlobbiData = {
      id: 'test-blobbi-id',
      name: 'Luna',
      stage: 'adult' as const,
      hunger: 75,
      energy: 60,
      happiness: 90,
      health: 100,
      hygiene: 80,
      experience: 1500,
      careStreak: 5,
      generation: 2,
      isSleeping: false,
      isDirty: false,
      hasBuff: false,
      hasDebuff: false,
      inParty: true,
      visibleToOthers: true,
      personality: 'playful',
      trait: 'curious',
      mood: 'happy',
    };

    render(
      <TestApp>
        <div className="relative w-full h-screen">
          <BlobbiInfoModal
            isOpen={true}
            onClose={() => {}}
            readOnly={true}
            externalBlobbiData={mockBlobbiData}
          />
        </div>
      </TestApp>
    );

    // Should show the Blobbi name in the title
    expect(screen.getByText('Blobbi Info – Luna')).toBeInTheDocument();

    // Should show Blobbi info
    expect(screen.getByText('Luna')).toBeInTheDocument();
    expect(screen.getByText('adult • Gen 2')).toBeInTheDocument();

    // Should not show inventory tab in read-only mode
    expect(screen.queryByText('Inventory')).not.toBeInTheDocument();

    // Should not show coins display in read-only mode
    expect(screen.queryByText('Coins')).not.toBeInTheDocument();

    // Should show close button
    expect(screen.getByText('Close')).toBeInTheDocument();
  });
});