import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { StageOverlayContext } from '@/contexts/StageOverlayContext';

/**
 * The contract every surface built on BlobbiModal inherits.
 *
 * These are the properties the game's hand-rolled `absolute inset-0` overlays
 * do NOT have, which is the whole reason the primitive exists — so they are
 * asserted here once rather than re-asserted in each migrated surface's test.
 *
 * The presentations are exercised through the explicit `presentation` prop
 * rather than by faking a viewport, except where the point of the test IS the
 * responsive choice. Which presentation a given width selects is
 * `useIsMobile`'s contract; a test that moved `window.innerWidth` around for
 * every case would be testing that hook through this component.
 */

const PRESENTATIONS = ['dialog', 'sheet', 'in-frame'] as const;

function open(props: Partial<React.ComponentProps<typeof BlobbiModal>> = {}) {
  return render(
    <BlobbiModal open onOpenChange={() => {}} title="Chest" {...props}>
      <button type="button">Take everything</button>
    </BlobbiModal>,
  );
}

/**
 * Renders inside a stage host, so `in-frame` resolves to itself rather than
 * falling back to `dialog`. The host is the element BlobbiFrame provides.
 */
function openInStage(props: Partial<React.ComponentProps<typeof BlobbiModal>> = {}) {
  const host = document.createElement('div');
  host.setAttribute('data-stage-overlay-host', '');
  document.body.appendChild(host);
  const result = render(
    <StageOverlayContext.Provider value={host}>
      <BlobbiModal open onOpenChange={() => {}} title="Chest" presentation="in-frame" {...props}>
        <button type="button">Take everything</button>
      </BlobbiModal>
    </StageOverlayContext.Provider>,
  );
  return { ...result, host };
}

afterEach(() => {
  document.querySelectorAll('[data-stage-overlay-host]').forEach((el) => el.remove());
});

describe.each(PRESENTATIONS)('BlobbiModal (%s)', (presentation) => {
  it('names the window with its title', () => {
    open({ presentation });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Chest');
  });

  it('keeps the description out of the accessible name', () => {
    // The description belongs in `aria-describedby`. Nesting it under the
    // title makes a screen reader read the whole paragraph on every focus
    // entry, which is why title and description are separate slots.
    open({ presentation, description: 'Everything you dug up on the beach.' });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Chest');
    expect(dialog).toHaveAccessibleDescription('Everything you dug up on the beach.');
  });

  it('shows the title visibly by default', () => {
    open({ presentation });
    expect(screen.getByText('Chest')).toBeVisible();
  });

  it('keeps the accessible name when the header is hidden', () => {
    // `hideHeader` is for surfaces whose own artwork carries the heading. It
    // must never mean "this window has no name".
    open({ presentation, hideHeader: true });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Chest');
  });

  it('still offers a close control when the header is hidden', () => {
    open({ presentation, hideHeader: true });
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('offers a labelled close control', () => {
    const onOpenChange = vi.fn();
    open({ presentation, onOpenChange });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('can suppress the close control for a forced flow', () => {
    open({ presentation, hideClose: true });
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('renders its content and footer', () => {
    open({ presentation, footer: <button type="button">Done</button> });

    expect(screen.getByRole('button', { name: 'Take everything' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('marks the header icon decorative', () => {
    // The title already says what the window is; an emoji announced alongside
    // it is noise, and lucide icons have no accessible name to begin with.
    open({ presentation, icon: '🧰' });
    const icon = screen.getByText('🧰');
    expect(icon).toHaveAttribute('aria-hidden');
  });

  it('exempts itself from world click-to-move', () => {
    // `data-block-move` is read by src/lib/world-input.ts to decide whether a
    // pointerdown cancels a pending walk-to-interact. A window that omits it
    // can have a click inside it steer the Blobbi.
    open({ presentation });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-block-move');
  });
});

describe('BlobbiModal presentation choice', () => {
  it('anchors the sheet to the bottom edge rather than centring it', () => {
    // The mobile presentation is a different surface, not the desktop card
    // shrunk until it fits.
    open({ presentation: 'sheet' });
    expect(screen.getByRole('dialog').className).toContain('bottom-0');
  });

  it('centres the dialog', () => {
    open({ presentation: 'dialog' });
    const cls = screen.getByRole('dialog').className;
    expect(cls).toContain('top-[50%]');
    expect(cls).not.toContain('bottom-0');
  });

  it('renders in-frame inside the stage host, not the document body', () => {
    const { host } = openInStage();
    expect(host.contains(screen.getByRole('dialog'))).toBe(true);
  });

  it('positions in-frame against its container rather than the viewport', () => {
    // `absolute`, not `fixed`: the window covers the game stage and leaves the
    // wood frame and the page around it visible.
    openInStage();
    const cls = screen.getByRole('dialog').className;
    expect(cls).toContain('absolute');
    expect(cls).not.toContain('fixed');
  });

  it('falls back to a viewport dialog when there is no stage host', () => {
    // A room rendered on its own in a test, or a surface used outside the
    // shell. `absolute` with no host would resolve against the document and
    // land somewhere arbitrary.
    open({ presentation: 'in-frame' });
    expect(document.body.contains(screen.getByRole('dialog'))).toBe(true);
    expect(screen.getByRole('dialog').className).toContain('fixed');
  });

  it('does not render when closed', () => {
    render(
      <BlobbiModal open={false} onOpenChange={() => {}} title="Chest">
        contents
      </BlobbiModal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('BlobbiModal sizing', () => {
  it.each(['sm', 'md', 'lg', 'xl', 'full'] as const)('applies the %s width', (size) => {
    open({ presentation: 'dialog', size });
    // Whatever the size, the base `max-w-lg` from DialogContent must be
    // neutralised — otherwise lg, xl and full are all silently clamped to 32rem.
    expect(screen.getByRole('dialog').className).toContain('max-w-none');
  });

  it('caps its height so a tall window scrolls inside itself', () => {
    open({ presentation: 'dialog' });
    expect(screen.getByRole('dialog').className).toContain('max-h-[90dvh]');
  });

  it('caps an in-frame window against the stage, not the viewport', () => {
    openInStage();
    expect(screen.getByRole('dialog').className).toContain('max-h-[calc(100%-1.5rem)]');
  });
});
