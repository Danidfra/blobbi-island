import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { BlobbiModal } from '@/components/ui/blobbi-modal';

/**
 * The contract every surface built on BlobbiModal inherits.
 *
 * These are the properties the game's hand-rolled `absolute inset-0` overlays
 * do NOT have, which is the whole reason the primitive exists — so they are
 * asserted here once rather than re-asserted in each migrated surface's test.
 *
 * Both presentations are exercised through the explicit `variant`, not by
 * faking a viewport: which one a given width selects is `useIsMobile`'s
 * contract, and a test that moved `window.innerWidth` around would be testing
 * that hook through this component.
 */

function open(props: Partial<React.ComponentProps<typeof BlobbiModal>> = {}) {
  return render(
    <BlobbiModal open onOpenChange={() => {}} title="Chest" {...props}>
      <button type="button">Take everything</button>
    </BlobbiModal>,
  );
}

describe.each(['dialog', 'sheet'] as const)('BlobbiModal (%s)', (variant) => {
  it('names the dialog with its title', () => {
    open({ variant });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Chest');
  });

  it('keeps the description out of the accessible name', () => {
    // The description belongs in `aria-describedby`. Nesting it under the
    // title makes a screen reader read the whole paragraph on every focus
    // entry, which is why title and description are separate slots.
    open({ variant, description: 'Everything you dug up on the beach.' });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Chest');
    expect(dialog).toHaveAccessibleDescription('Everything you dug up on the beach.');
  });

  it('shows the title visibly by default', () => {
    open({ variant });
    expect(screen.getByText('Chest')).toBeVisible();
  });

  it('keeps the accessible name when the plaque is hidden', () => {
    // `hideTitle` is for surfaces whose own artwork carries the heading. It
    // must never mean "this dialog has no name".
    open({ variant, hideTitle: true });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Chest');
  });

  it('offers a labelled close control', () => {
    const onOpenChange = vi.fn();
    open({ variant, onOpenChange });

    const close = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(close);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('can suppress the close control for a forced flow', () => {
    open({ variant, hideClose: true });
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('renders its content and footer', () => {
    open({ variant, footer: <button type="button">Done</button> });

    expect(screen.getByRole('button', { name: 'Take everything' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });
});

describe('BlobbiModal presentation', () => {
  it('renders a bottom sheet, not a centered card, when asked for a sheet', () => {
    // The Phase-11 rule in one assertion: the mobile presentation is a
    // different surface anchored to the bottom edge, not the desktop card
    // shrunk until it fits.
    open({ variant: 'sheet' });
    expect(screen.getByRole('dialog').className).toContain('bottom-0');
  });

  it('renders a centered card on the dialog variant', () => {
    open({ variant: 'dialog' });
    const cls = screen.getByRole('dialog').className;
    expect(cls).toContain('top-[50%]');
    expect(cls).not.toContain('bottom-0');
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
