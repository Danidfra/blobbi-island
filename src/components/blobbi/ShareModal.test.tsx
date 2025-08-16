import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { ShareModal } from './ShareModal';

// Mock the Web Share API
Object.assign(navigator, {
  share: vi.fn().mockResolvedValue(undefined),
});

// Mock the toast hook
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Mock the upload file hook
vi.mock('@/hooks/useUploadFile', () => ({
  useUploadFile: () => ({
    mutateAsync: vi.fn().mockResolvedValue([['url', 'https://example.com/image.png'], ['dim', '800x600']]),
  }),
}));

// Mock the nostr publish hook
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ id: 'test-event-id' }),
  }),
}));

// Mock the app context
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({
    config: {
      relayUrl: 'wss://relay.primal.net',
    },
    presetRelays: [
      { url: 'wss://ditto.pub/relay', name: 'Ditto' },
      { url: 'wss://relay.nostr.band', name: 'Nostr.Band' },
      { url: 'wss://relay.damus.io', name: 'Damus' },
      { url: 'wss://relay.primal.net', name: 'Primal' },
    ],
  }),
}));

// Mock the current user hook
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: {
      pubkey: 'test-pubkey',
      signer: {
        signEvent: vi.fn().mockResolvedValue({ id: 'test-event-id' }),
      },
    },
  }),
}));

describe('ShareModal', () => {
  const mockCapturedPhoto = 'data:image/png;base64,test-image-data';
const mockCapturedPolaroidSrc = 'data:image/png;base64,test-polaroid-image-data';

  it('renders correctly when open', () => {
    render(
      <TestApp>
        <ShareModal
          isOpen={true}
          onClose={vi.fn()}
          capturedPhoto={mockCapturedPhoto}
          capturedPolaroidSrc={mockCapturedPolaroidSrc}
        />
      </TestApp>
    );

    expect(screen.getByText('Share Your Photo 📸')).toBeInTheDocument();
    expect(screen.getByAltText('Captured Blobbi Photo')).toBeInTheDocument();
    expect(screen.getByText('Download Photo')).toBeInTheDocument();
    expect(screen.getByText('Share to App')).toBeInTheDocument();
    expect(screen.getByText('Post to Relay')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(
      <TestApp>
        <ShareModal
          isOpen={false}
          onClose={vi.fn()}
          capturedPhoto={mockCapturedPhoto}
          capturedPolaroidSrc={mockCapturedPolaroidSrc}
        />
      </TestApp>
    );

    expect(screen.queryByText('Share Your Photo 📸')).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const mockOnClose = vi.fn();
    render(
      <TestApp>
        <ShareModal
          isOpen={true}
          onClose={mockOnClose}
          capturedPhoto={mockCapturedPhoto}
          capturedPolaroidSrc={mockCapturedPolaroidSrc}
        />
      </TestApp>
    );

    const closeButton = screen.getByRole('button', { name: /close share modal/i });
    fireEvent.click(closeButton);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows relay selection options', () => {
    render(
      <TestApp>
        <ShareModal
          isOpen={true}
          onClose={vi.fn()}
          capturedPhoto={mockCapturedPhoto}
          capturedPolaroidSrc={mockCapturedPolaroidSrc}
        />
      </TestApp>
    );

    // Should show relay count and toggle button
    expect(screen.getByText('1 relay selected')).toBeInTheDocument();
    expect(screen.getByText('Show more')).toBeInTheDocument();

    // In collapsed state, should show the first selected relay (Primal by default)
    expect(screen.getByText('Primal')).toBeInTheDocument();
    expect(screen.getByText('wss://relay.primal.net')).toBeInTheDocument();

    // Should show the Post to Relay section with relay count
    expect(screen.getByText('Post to 1 Relay')).toBeInTheDocument();
  });

  it('allows relay selection', () => {
    render(
      <TestApp>
        <ShareModal
          isOpen={true}
          onClose={vi.fn()}
          capturedPhoto={mockCapturedPhoto}
          capturedPolaroidSrc={mockCapturedPolaroidSrc}
        />
      </TestApp>
    );

    // First, expand the relay list to see all options
    const showMoreButton = screen.getByText('Show more');
    fireEvent.click(showMoreButton);

    // Now should show "Show less" button
    expect(screen.getByText('Show less')).toBeInTheDocument();

    // Now find checkboxes by their role and associated text
    const dittoCheckbox = screen.getByRole('checkbox', { name: /Ditto/ });
    const nostrBandCheckbox = screen.getByRole('checkbox', { name: /Nostr\.Band/ });

    // Ditto should be unchecked by default (only primal is selected)
    expect(dittoCheckbox).not.toBeChecked();

    // Click to select Ditto
    fireEvent.click(dittoCheckbox);
    expect(dittoCheckbox).toBeChecked();

    // Click to select Nostr.Band
    fireEvent.click(nostrBandCheckbox);
    expect(nostrBandCheckbox).toBeChecked();
  });
});