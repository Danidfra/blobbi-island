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

    expect(screen.queryByText('Accessories')).not.toBeInTheDocument();
  });
});