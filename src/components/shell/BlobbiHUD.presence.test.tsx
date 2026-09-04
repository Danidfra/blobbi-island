import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { LocationContext } from '@/contexts/LocationContextValue';
import { setPresenceStatus } from '@/lib/presence-status';
import { BlobbiHUD } from './BlobbiHUD';

function Located({ children }: { children: React.ReactNode }) {
  return (
    <LocationContext.Provider
      value={{
        currentLocation: 'town',
        setCurrentLocation: () => {},
        previousLocation: null,
        isMapModalOpen: false,
        setIsMapModalOpen: () => {},
        isTransitioning: false,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

afterEach(() => setPresenceStatus('idle'));

describe('the HUD and presence', () => {
  it('says nothing about presence while it is live or idle', async () => {
    setPresenceStatus('live');
    render(<TestApp><Located><BlobbiHUD onlineCount={3} /></Located></TestApp>);
    await act(async () => {
      await Promise.resolve();
    });
    expect(await screen.findByText('online')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says one plain thing when the player declined to sign presence — no kinds, signers or relays', async () => {
    setPresenceStatus('signer-declined');
    render(<TestApp><Located><BlobbiHUD /></Located></TestApp>);
    const status = await screen.findByRole('status');
    expect(status.textContent).toBe("You're exploring offline from other players.");
    expect(status.textContent).not.toMatch(/31950|nostr|relay|sign/i);
  });
});
