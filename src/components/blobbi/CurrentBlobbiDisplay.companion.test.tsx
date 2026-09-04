/**
 * The in-world actor draws the Blobbi the ROUTER selected, not whatever the
 * profile cache says today.
 *
 * After a hatch (or a switch) the profile cache can lag: it may still be the
 * confirmed-empty answer of a read issued before the relay indexed the
 * publish. Re-deriving the companion from it drew the "no Blobbi selected"
 * egg inside a world that was clearly showing a player. An explicit
 * `companionId` resolves from the owned list alone, and a Blobbi that is not
 * in that list yet is a handoff in progress, not an egg.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const COMPANION = {
  id: 'blobbi-new-1',
  name: 'Puck',
  stage: 'baby',
  baseColor: '#F2A0C0',
  secondaryColor: '#FAD4E4',
  eyeColor: '#222222',
};

vi.mock('@/hooks/useBlobbis', () => ({
  useBlobbis: () => ({ data: [COMPANION] }),
}));
// The lagging profile: confirmed empty.
vi.mock('@/hooks/useBlobbonautProfile', () => ({
  useBlobbonautProfile: () => ({ data: null }),
}));
const { CurrentBlobbiDisplay } = await import('./CurrentBlobbiDisplay');

describe('CurrentBlobbiDisplay with an explicit companion', () => {
  it('draws the egg when the profile names no companion and none is given (the HUD chip)', () => {
    const { container } = render(<CurrentBlobbiDisplay showFallback />);
    expect(container.textContent).toContain('🥚');
    expect(container.querySelector('[data-blobbi-renderer]')).toBeNull();
  });

  it('draws the selected Blobbi from the owned list even though the profile lags', () => {
    const { container } = render(
      <CurrentBlobbiDisplay showFallback companionId="blobbi-new-1" />,
    );
    expect(container.querySelector('[data-blobbi-renderer]')).not.toBeNull();
    expect(container.textContent).not.toContain('🥚');
  });

  it('draws nothing, never the egg, for a companion the list does not hold yet', () => {
    const { container } = render(
      <CurrentBlobbiDisplay showFallback companionId="blobbi-not-loaded" />,
    );
    expect(container.querySelector('[data-blobbi-renderer]')).toBeNull();
    expect(container.textContent).not.toContain('🥚');
  });
});
