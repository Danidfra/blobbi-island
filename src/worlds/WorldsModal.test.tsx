/**
 * The world cards show each app's own icon; an icon that cannot load leaves the card's colours with the emoji, as
 * before, and a closed door shows the lock.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorldCardIcon, WorldsModal } from './WorldsModal';
import { worldById, worlds } from './worlds';

describe('the world cards', () => {
  it('each open card shows its world icon from this origin; a closed door shows the lock', () => {
    const list = worlds({});
    render(<WorldsModal open onClose={() => {}} name="Dotado" worlds={list} canLeave departing={false} onTravel={() => {}} />);
    for (const w of list) {
      const tile = screen.getByTestId(`world-icon-${w.id}`);
      const img = tile.querySelector('img');
      if (w.open) {
        expect(img, w.id).not.toBeNull();
        expect(img!.getAttribute('src')).toBe(w.icon);
        expect(img!.getAttribute('alt')).toBe('');
      } else {
        expect(img, w.id).toBeNull();
        expect(tile.getAttribute('data-fallback')).toBe('true');
      }
    }
  });

  it('an icon that cannot load falls back to the emoji on the colours', () => {
    const pixel = worldById('pixel', {})!;
    render(<WorldCardIcon world={pixel} open />);
    const tile = screen.getByTestId('world-icon-pixel');
    expect(tile.getAttribute('data-fallback')).toBeNull();
    fireEvent.error(tile.querySelector('img')!);
    expect(tile.getAttribute('data-fallback')).toBe('true');
    expect(tile.querySelector('img')).toBeNull();
    expect(tile.textContent).toBe(pixel.emoji);
  });
});
