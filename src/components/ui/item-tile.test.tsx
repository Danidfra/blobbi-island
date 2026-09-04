import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ItemTile, PriceTag, QuantityBadge } from '@/components/ui/item-tile';

/**
 * The economy tile's contract.
 *
 * These are semantic assertions, not appearance ones: whether the tile is a
 * button, what it announces, and whether it says anything a colour-blind
 * player would miss. How it looks is the token layer's job and is covered by
 * the contrast test.
 */

describe('ItemTile', () => {
  it('is a plain element when it has no handler', () => {
    // A display-only tile, the currency section of the item bag, must not
    // be focusable or announce itself as pressable.
    render(<ItemTile name="Arcade Ticket" art="🎟️" quantity={7} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Arcade Ticket')).toBeInTheDocument();
  });

  it('is a button when it has a handler', () => {
    const onClick = vi.fn();
    render(<ItemTile name="Apple" art="🍎" onClick={onClick} />);

    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('announces its selected state', () => {
    render(<ItemTile name="Apple" art="🍎" onClick={() => {}} selected />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not fire, or claim to be pressable, when disabled', () => {
    const onClick = vi.fn();
    render(<ItemTile name="Apple" art="🍎" onClick={onClick} disabled />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Apple').closest('[aria-disabled]')).not.toBeNull();
  });

  it('keeps the artwork out of the accessible name', () => {
    // The name is rendered as text right below the art, so an announced image
    // would make a screen reader say the item twice.
    render(<ItemTile name="Apple" art={<img src="/apple.png" alt="" />} onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Apple');
  });

  it('forwards data attributes to the root', () => {
    // The item bag marks its read-only tiles this way, and the image-resolution
    // tests locate them by it.
    render(<ItemTile name="Ticket" art="🎟️" data-readonly-item="addr-1" />);
    expect(document.querySelector('[data-readonly-item="addr-1"]')).not.toBeNull();
  });

  it('omits the count badge at zero rather than showing a zero', () => {
    render(<ItemTile name="Apple" art="🍎" quantity={0} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

describe('PriceTag', () => {
  it('reads the amount out with its unit', () => {
    render(<PriceTag amount={20} />);
    expect(screen.getByText(/coins/)).toBeInTheDocument();
  });

  it('says "not enough" in text, not only in red', () => {
    // Affordability shown only as a colour is affordability a colour-blind
    // player cannot see.
    render(<PriceTag amount={200} affordable={false} />);
    expect(screen.getByText(/not enough/)).toBeInTheDocument();
  });
});

describe('QuantityBadge', () => {
  it('says what the number means', () => {
    render(<QuantityBadge count={7} />);
    expect(screen.getByText(/owned/)).toBeInTheDocument();
    expect(screen.getByText('7', { exact: false })).toBeInTheDocument();
  });
});
