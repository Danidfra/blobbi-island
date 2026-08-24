import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { flushProviderInit } from '@/test/flushProviderInit';
import { BlobbiInfoModal } from './BlobbiInfoModal';

describe('BlobbiInfoModal', () => {
  it('renders modal when open', async () => {
    render(
      <TestApp>
        <div className="relative w-full h-screen">
          <BlobbiInfoModal isOpen={true} onClose={() => {}} />
        </div>
      </TestApp>
    );

    // Since there's no current pet in the test environment, it should show the no pet message
    expect(await screen.findByText('No Blobbi selected')).toBeInTheDocument();
  });

  it('does not render when closed', async () => {
    render(
      <TestApp>
        <BlobbiInfoModal isOpen={false} onClose={() => {}} />
      </TestApp>
    );
    await flushProviderInit();

    expect(screen.queryByText('Blobbi Info')).not.toBeInTheDocument();
  });

  it('shows modal with no pet message', async () => {
    render(
      <TestApp>
        <div className="relative w-full h-screen">
          <BlobbiInfoModal isOpen={true} onClose={() => {}} />
        </div>
      </TestApp>
    );

    // The modal should show "No Blobbi selected" when there's no pet
    expect(await screen.findByText('No Blobbi selected')).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
  });

  it('shows read-only modal with external Blobbi data', async () => {
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

    // The window is NAMED after the Blobbi. It used to be titled
    // "Blobbi Info – Luna", which put a category label where the subject
    // belongs; the stage and generation moved to the header's subtitle.
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Luna');

    // Should show Blobbi info
    expect(screen.getByText('adult · Gen 2')).toBeInTheDocument();

    // Should not show inventory tab in read-only mode
    expect(screen.queryByText('Inventory')).not.toBeInTheDocument();

    // Should not show coins display in read-only mode
    expect(screen.queryByText('Coins')).not.toBeInTheDocument();

    // Should show the X close button in the header
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});