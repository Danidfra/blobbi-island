/**
 * The arcade's card dialogs are contained AND comfortable.
 *
 * ## What this file has always been for
 *
 * Containing these dialogs inside the game stage was right and is not in
 * question. What this file pins is the regression containment CAUSED: a dialog
 * moved into the stage lost its padding and its side margins, because the
 * mechanism that supplied them only existed on the viewport path. Three cards
 * ended up flush against the stage edges with their titles flush against the
 * card edge.
 *
 * ## Why the assertions changed shape
 *
 * The mechanism did. These three dialogs are now built on `BlobbiModal`
 * (`presentation="in-frame"`), which owns the frame, the sizing, the padding
 * and the scroll container, so the old `inFrameDialogPanelClass` literals it
 * used to assert — `p-5`, `w-[calc(100%-2rem)]`, `max-w-md` — no longer appear
 * and asserting them would only pin a dead implementation.
 *
 * Every PROPERTY they protected is still asserted here, and now measured
 * against the rendered result rather than against a class string: contained in
 * the stage, margins on every side, capped height with internal scrolling,
 * padding around the content, nothing sized in viewport units, 44px targets,
 * an accessible name, a focus trap and Escape.
 *
 * Asserting the property rather than the spelling is also what lets the
 * primitive keep evolving without three feature tests having to be rewritten
 * each time.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ArcadePassModal } from './ArcadePassModal';
import { ElevatorModal } from './ElevatorModal';
import { NoPassModal } from './NoPassModal';
import { StageOverlayContext } from '@/contexts/StageOverlayContext';

// ---------------------------------------------------------------------------
// Collaborators. Nothing here touches a relay — these tests are about layout.
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'a'.repeat(64) } }),
}));

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

/** Every dialog that lives inside the game stage. */
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

/** The scrolling content box inside the window frame. */
const scroller = () =>
  panel()!.querySelector<HTMLElement>('.overflow-y-auto') as HTMLElement | null;

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

  it('is positioned against the stage rather than the viewport', () => {
    // `absolute`, so the window covers the game window and the wood frame,
    // shell header and page behind it all stay visible. `fixed` here is the
    // bug that makes an in-world surface read as a website dialog.
    renderInStage();
    const tokens = panel()!.className.split(/\s+/);
    expect(tokens).toContain('absolute');
    expect(tokens).not.toContain('fixed');
  });

  it('keeps a margin from the stage edges rather than going flush', () => {
    // The original failure. Width is a percentage of the STAGE with room left
    // on both sides, and capped so a wide stage gets a card, not a banner.
    renderInStage();
    const className = panel()!.className;
    expect(className).toMatch(/w-\[min\(\d+%,[^\]]+\)]/);
    // The base `w-full` / `max-w-lg` must be REPLACED, not merely accompanied:
    // two widths in one class list is how a card ends up flush again.
    const tokens = className.split(/\s+/);
    expect(tokens).not.toContain('w-full');
    expect(tokens).not.toContain('max-w-lg');
  });

  it('never grows past the stage, and scrolls inside itself instead', () => {
    renderInStage();
    expect(panel()!.className).toContain('max-h-[calc(100%-1.5rem)]');
    // The scroller is the body, not the frame: the header and footer bands
    // must stay put while the content moves under them.
    expect(scroller()).not.toBeNull();
    expect(scroller()!.className).toContain('overflow-y-auto');
  });

  it('puts padding around its content, so nothing touches the border', () => {
    // The other half of the original failure. It now lives on the body rather
    // than the frame — the frame is `p-0` on purpose, because the header and
    // footer bands run edge to edge.
    renderInStage();
    expect(scroller()!.className).toMatch(/(^|\s)p-4(\s|$)/);
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

  it('exempts itself from world click-to-move', () => {
    // Read by src/lib/world-input.ts. Without it, a click inside the window
    // can cancel a pending walk-to-interact.
    renderInStage();
    expect(panel()).toHaveAttribute('data-block-move');
  });

  it('gives every control a 44 px touch target', () => {
    // The shared `Button` defaults to `h-10` — 40 px — so a dialog that wants
    // a 44 px target has to say so. The window's own close button is exempt:
    // it is 36 px by design and is not the surface's primary action.
    renderInStage();
    const buttons = screen
      .getAllByRole('button')
      .filter((b) => b.textContent?.trim() !== 'Close');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.className.split(/\s+/), button.textContent ?? '').toContain('min-h-[44px]');
    }
  });
});

describe('the shared window frame', () => {
  it('is one primitive, so the three cannot drift apart', () => {
    // Three dialogs that must keep looking like the same object. Rendering
    // each and comparing the frame's classes is the check a copy-pasted class
    // list used to need — and it catches a divergence the old string
    // comparison could not, because it compares what actually rendered.
    const frames = DIALOGS.map(({ Component }) => {
      const { unmount } = render(
        <WithStage>
          <Component isOpen onClose={() => {}} />
        </WithStage>,
      );
      // Only the size-dependent width may differ between surfaces.
      const className = panel()!
        .className.split(/\s+/)
        .filter((t) => !t.startsWith('w-['))
        .sort()
        .join(' ');
      unmount();
      return className;
    });

    expect(new Set(frames).size).toBe(1);
  });
});

describe('without a stage', () => {
  it('falls back to a viewport dialog rather than failing', () => {
    // A unit test rendering a modal on its own has no host. `absolute` with no
    // host would resolve against the document and land somewhere arbitrary, so
    // the primitive switches to the viewport presentation instead.
    render(<NoPassModal isOpen onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog').className).toContain('fixed');
  });
});
