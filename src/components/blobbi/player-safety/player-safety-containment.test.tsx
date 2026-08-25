/**
 * The safety controls stay inside the game window.
 *
 * Mute, Block and Report are opened from a player's card, and that card is an
 * IN-WORLD surface: the island renders inside a fixed 1046×697 stage wrapped in
 * a wood frame, with the browser page visible around it. A confirmation that
 * positions itself against the viewport instead lands outside that frame — over
 * the page, over the shell header, or anywhere a windowed or short viewport puts
 * it. The island already has a frame-aware portal for exactly this
 * (`StageOverlayContext`); these tests prove the safety surfaces use it.
 *
 * ## What jsdom can and cannot prove
 *
 * There is no layout engine here, so "is it visually inside the frame?" is not
 * a question this file can ask. What it CAN prove is the thing that decides the
 * answer: which element the layer is portalled into, and whether its size is
 * expressed against the stage or against the viewport. Those are the two
 * mechanisms, and a regression in either is what puts a dialog outside the
 * frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState, type ReactNode } from 'react';

import { StageOverlayContext } from '@/contexts/StageOverlayContext';
import { clearAllRelationships, clearStoredReports } from '@/player-safety';

import { PlayerSafetyActions } from './PlayerSafetyActions';

const RUDE = 'a'.repeat(64);
const ME = 'c'.repeat(64);

let mobile = false;
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile }));

/**
 * The stage and its overlay host, as `BlobbiFrame` builds them: a fixed-size
 * box with an `absolute inset-0` host inside it. Anything in-world portals into
 * the host; anything viewport-scoped escapes to `document.body`.
 */
function Stage({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={stageRef} data-testid="stage" style={{ width: 1046, height: 697 }}>
      <div ref={setHost} data-testid="stage-overlay-host" />
      <StageOverlayContext.Provider value={host}>{children}</StageOverlayContext.Provider>
    </div>
  );
}

function openCard() {
  const view = render(
    <Stage>
      <PlayerSafetyActions
        pubkey={RUDE}
        islandId="1"
        location="town"
        reporterPubkey={ME}
      />
    </Stage>,
  );
  return {
    ...view,
    stage: () => screen.getByTestId('stage'),
    host: () => screen.getByTestId('stage-overlay-host'),
    row: () => screen.getByRole('button', { name: /mute/i }).parentElement!,
  };
}

/** The window itself — the element Radix gives the dialog role. */
const surface = () => screen.getByRole('dialog');

beforeEach(() => {
  mobile = false;
  localStorage.clear();
  clearAllRelationships();
  clearStoredReports();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('every layer opens inside the game frame', () => {
  it('keeps the block confirmation in the stage host', () => {
    const view = openCard();
    fireEvent.click(screen.getByRole('button', { name: /^block$/i }));

    const dialog = surface();
    expect(view.host().contains(dialog)).toBe(true);
    expect(view.stage().contains(dialog)).toBe(true);
  });

  it('keeps the report window in the stage host', () => {
    const view = openCard();
    fireEvent.click(screen.getByRole('button', { name: /report/i }));

    const dialog = surface();
    expect(within(dialog).getByText(/what happened/i)).toBeInTheDocument();
    expect(view.host().contains(dialog)).toBe(true);
  });

  it('sizes the report window against the stage, never the viewport', () => {
    // The distinction that matters: `dvh`/`vw` measure the BROWSER, which is
    // the one thing a contained surface is no longer bounded by.
    openCard();
    fireEvent.click(screen.getByRole('button', { name: /report/i }));

    const className = surface().className;
    expect(className).toContain('max-h-[calc(100%-1.5rem)]');
    expect(className).not.toContain('dvh');
    expect(className).not.toMatch(/\bw-\[min\(9\d+vw/);
  });

  it('scrolls its content internally instead of growing past the frame', () => {
    // A small stage must not be solved by letting the window grow: the body is
    // the scroll container, and the window is capped above.
    openCard();
    fireEvent.click(screen.getByRole('button', { name: /report/i }));

    const body = within(surface()).getByText(/what happened/i).closest('.overflow-y-auto');
    expect(body).toBeTruthy();
  });

  it('moves keyboard focus into the window and offers a way out', () => {
    openCard();
    fireEvent.click(screen.getByRole('button', { name: /report/i }));

    const dialog = surface();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getByRole('button', { name: /cancel/i })).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('on a phone', () => {
  beforeEach(() => {
    mobile = true;
  });

  it('presents the report as a bottom sheet rather than a centred window', () => {
    // The stage on a phone is most of the screen, so a sheet IS the contained
    // form — thumb-reachable and safe-area aware, which a centred window in a
    // few hundred pixels is not.
    openCard();
    fireEvent.click(screen.getByRole('button', { name: /report/i }));

    const dialog = surface();
    // Anchored to the bottom edge and spanning the width — the sheet form,
    // not a centred window shrunk to fit.
    expect(dialog.className).toContain('bottom-0');
    expect(dialog.className).toContain('inset-x-0');
    expect(dialog.className).not.toContain('max-h-[calc(100%-1.5rem)]');
    expect(within(dialog).getByRole('button', { name: /save report/i })).toBeInTheDocument();
  });

  it('still reaches every action in the block confirmation', () => {
    openCard();
    fireEvent.click(screen.getByRole('button', { name: /^block$/i }));

    const dialog = surface();
    expect(within(dialog).getByRole('button', { name: /block player/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });
});

describe('the three controls have room to be themselves', () => {
  /*
    jsdom has no layout, so these assert the CONTRACT that produces the layout
    rather than the pixels it produces. That contract is what broke: the row is
    a flex item in the modal footer, flex items shrink by default, and three
    buttons inside a shrinking box get squeezed until their labels no longer
    fit. `shrink-0` and a real minimum height are the parts that must survive an
    edit; if they are removed, this fails and says why.
  */
  const buttons = () =>
    ['mute', 'block', 'report'].map((name) =>
      screen.getByRole('button', { name: new RegExp(`^${name}$`, 'i') }),
    );

  it('gives each control the same shape and a real touch target', () => {
    openCard();
    for (const button of buttons()) {
      expect(button.className, button.textContent ?? '').toContain('min-h-[2.75rem]');
      expect(button.className, button.textContent ?? '').toContain('shrink-0');
    }
  });

  it('stacks full-width on a narrow frame and forms a row when there is space', () => {
    openCard();
    for (const button of buttons()) {
      expect(button.className).toContain('w-full');
      expect(button.className).toContain('sm:w-auto');
    }
  });

  it('lets the row claim the footer instead of collapsing to its contents', () => {
    const view = openCard();
    expect(view.row().className).toContain('sm:flex-1');
    expect(view.row().className).toContain('min-w-0');
  });

  it('keeps every label on one line', () => {
    // `whitespace-nowrap` comes from the button base, which is what turns a
    // squeeze into a clipped pill rather than a two-line one — and why the
    // squeeze had to be fixed at the layout instead of by shortening labels.
    openCard();
    for (const button of buttons()) {
      expect(button.className).toContain('whitespace-nowrap');
    }
  });
});
