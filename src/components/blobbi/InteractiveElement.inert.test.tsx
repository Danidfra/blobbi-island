import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InteractiveElement } from './InteractiveElement';

describe('an inert InteractiveElement', () => {
  it('is decoration: no pointer cursor, no hover lift, no handlers, no walk', () => {
    const onClick = vi.fn();
    const requestInteraction = vi.fn();
    render(
      <div data-world-surface>
        <InteractiveElement src="/x.png" alt="Boat" inert onClick={onClick} requestInteraction={requestInteraction} effect="scale" />
      </div>,
    );
    const art = screen.getByAltText('Boat');
    const wrapper = art.parentElement!;
    expect(wrapper).toHaveAttribute('data-inert-element');
    expect(wrapper.className).toContain('cursor-default');
    expect(wrapper.className).not.toContain('cursor-pointer');
    expect(wrapper.className).not.toContain('hover:');
    expect(wrapper).not.toHaveAttribute('data-block-move'); // a tap falls through to the floor
    fireEvent.click(art);
    fireEvent.touchStart(art);
    expect(onClick).not.toHaveBeenCalled();
    expect(requestInteraction).not.toHaveBeenCalled();
  });

  it('can carry a small, non-interactive "Coming later" caption', () => {
    render(<InteractiveElement src="/x.png" alt="Kiosk" inert comingLater />);
    const caption = document.querySelector('[data-coming-later]')!;
    expect(caption.textContent).toBe('Coming later');
    expect(caption.className).toContain('pointer-events-none');
  });

  it('shows no caption unless asked', () => {
    render(<InteractiveElement src="/x.png" alt="Kiosk" inert />);
    expect(document.querySelector('[data-coming-later]')).toBeNull();
  });
});
