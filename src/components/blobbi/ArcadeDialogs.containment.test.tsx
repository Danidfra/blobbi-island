/**
 * The arcade's card dialogs are contained AND comfortable.
 *
 * Containing them was right and is not in question here; what this file pins is
 * the regression containment caused. `DialogContent`'s two branches are not
 * symmetrical: the body-portal branch carries `p-6`, and the `inFrame` branch
 * carries positioning and animation only. So moving a dialog into the stage
 * silently dropped all of its padding, and its `w-full` started resolving
 * against the game stage instead of the viewport — dropping its side margins
 * too. `blobbi-card-xl` supplies background, border, radius and shadow, and no
 * padding at all, so nothing put it back.
 *
 * The result was three cards flush against the stage edges with their titles
 * flush against the card edge. These tests assert the four properties that fix
 * it, for every dialog that took that path.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ArcadePassModal } from './ArcadePassModal';
import { ElevatorModal } from './ElevatorModal';
import { NoPassModal } from './NoPassModal';
import { inFrameDialogPanelClass } from '@/components/ui/dialog';
import { StageOverlayContext } from '@/contexts/StageOverlayContext';

// ---------------------------------------------------------------------------
// Collaborators. Nothing here touches a relay — these tests are about layout.
// ---------------------------------------------------------------------------

vi.mock('@/inventory/useCoinWallet', () => ({
  useCoinWallet: () => ({
    spendCoins: vi.fn().mockResolvedValue({ status: 'applied', balance: 80, verified: true }),
    grantCoins: vi.fn(),
    wallet: null,
  }),
  useCoinBalance: () => ({
    balance: 100,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useOptimizedStatus', () => ({
  useOptimizedStatus: () => ({
    status: { owner: { coins: 100 }, isLoading: false },
    refreshFromRelay: vi.fn(),
  }),
}));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const setCurrentLocation = vi.fn();
vi.mock('@/hooks/useLocation', () => ({
  useLocation: () => ({
    currentLocation: 'arcade',
    previousLocation: null,
    setCurrentLocation,
    setIsMapModalOpen: vi.fn(),
  }),
}));

/** Every dialog that was migrated onto the stage overlay host. */
const DIALOGS = [
  { name: 'ArcadePassModal', Component: ArcadePassModal, title: /arcade pass/i },
  { name: 'ElevatorModal', Component: ElevatorModal, title: /select floor/i },
  { name: 'NoPassModal', Component: NoPassModal, title: /access denied/i },
] as const;

/**
 * A stand-in for `BlobbiFrame`'s overlay host: one element, provided through the
 * real context, so the dialogs take the real production path.
 */
function WithStage({ children }: { children: React.ReactNode }) {
  const [hostEl, setHostEl] = React.useState<HTMLDivElement | null>(null);
  return (
    <div data-test-page>
      <div data-test-outside-stage>page content around the game</div>
      <div data-test-stage style={{ position: 'relative' }}>
        <div ref={setHostEl} data-stage-overlay-host style={{ position: 'absolute', inset: 0 }} />
        <StageOverlayContext.Provider value={hostEl}>{children}</StageOverlayContext.Provider>
      </div>
    </div>
  );
}

const host = () => document.querySelector('[data-stage-overlay-host]') as HTMLElement | null;
const panel = () => document.querySelector('[role="dialog"]') as HTMLElement | null;

beforeEach(() => {
  setCurrentLocation.mockClear();
});

describe.each(DIALOGS)('$name', ({ Component, title }) => {
  function renderInStage() {
    return render(
      <WithStage>
        <Component isOpen onClose={() => {}} />
      </WithStage>,
    );
  }

  it('renders into the stage overlay host, not under the body', () => {
    renderInStage();
    expect(panel()).not.toBeNull();
    expect(host()!.contains(panel()!)).toBe(true);
    expect(panel()!.parentElement).not.toBe(document.body);
  });

  it('leaves the page around the stage outside the overlay', () => {
    renderInStage();
    const outside = screen.getByText('page content around the game');
    expect(host()!.contains(outside)).toBe(false);
  });

  it('keeps a safe margin from the stage edges and a normal card width', () => {
    renderInStage();
    const className = panel()!.className;
    // Percent of the STAGE — 1rem of visible room on each side at every size —
    // and capped so a wide stage gets a card rather than a banner.
    expect(className).toContain('w-[calc(100%-2rem)]');
    expect(className).toContain('max-w-md');
    // The base `w-full` must have been replaced, not merely accompanied: two
    // widths in one class list is how a card ends up flush again.
    expect(className.split(/\s+/)).not.toContain('w-full');
    expect(className.split(/\s+/)).not.toContain('max-w-lg');
  });

  it('never grows past the stage, and scrolls inside itself instead', () => {
    renderInStage();
    const className = panel()!.className;
    expect(className).toContain('max-h-[calc(100%-2rem)]');
    expect(className).toContain('overflow-y-auto');
  });

  it('declares explicit internal padding, so nothing touches the card border', () => {
    renderInStage();
    const tokens = panel()!.className.split(/\s+/);
    // `inFrame` gives none and `blobbi-card-xl` gives none, so the dialog must.
    expect(tokens).toContain('p-5');
    expect(tokens).toContain('sm:p-6');
    expect(tokens.some((t) => /^p-0$/.test(t))).toBe(false);
  });

  it('is sized against the stage, never against the browser viewport', () => {
    renderInStage();
    const className = panel()!.className;
    for (const forbidden of ['w-screen', 'h-screen', '100vw', '100dvh', '100vh']) {
      expect(className, forbidden).not.toContain(forbidden);
    }
  });

  it('still names itself, traps focus and closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <WithStage>
        <Component isOpen onClose={onClose} />
      </WithStage>,
    );
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
    expect(panel()!.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('gives every control a 44 px touch target', () => {
    // The shared `Button` defaults to `h-10` — 40 px — so a dialog that wants a
    // 44 px target has to say so. Asserted as the literal class rather than as
    // "declares some height", which `h-10` would have satisfied while being
    // four pixels short.
    renderInStage();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.className.split(/\s+/), button.textContent ?? '').toContain('min-h-[44px]');
    }
  });
});

describe('the shared in-frame panel rule', () => {
  it('is one definition, used by every contained card dialog', () => {
    // Three dialogs that must not drift apart. A copy-pasted class list is how
    // one of them quietly goes back to being flush.
    for (const token of ['w-[calc(100%-2rem)]', 'max-w-md', 'max-h-[calc(100%-2rem)]', 'p-5']) {
      expect(inFrameDialogPanelClass).toContain(token);
    }
  });

  it('measures nothing in viewport units', () => {
    for (const forbidden of ['vw', 'vh', 'dvh', 'svh']) {
      expect(inFrameDialogPanelClass, forbidden).not.toContain(forbidden);
    }
  });
});

describe('without a stage', () => {
  it('falls back to the Radix default rather than failing', () => {
    // A unit test rendering a modal on its own has no host; `undefined` means
    // `document.body`, so nothing has to guard.
    render(<NoPassModal isOpen onClose={() => {}} />);
    expect(panel()).not.toBeNull();
    expect(host()).toBeNull();
  });
});
