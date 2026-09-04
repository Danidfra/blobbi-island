/**
 * The in-game notice layer: inside the game window, in the Farm's chip
 * language, bounded to two, still at rest under reduced motion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { clearGameNotices, showGameNotice } from '@/lib/game-notices';
import { BlobbiFrame } from './BlobbiFrame';
import { GameNoticeLayer } from './GameNoticeLayer';

let immersive = false;
vi.mock('@/hooks/useImmersive', () => ({ useImmersive: () => immersive }));

const originalMatchMedia = window.matchMedia;
function reducedMotion(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('reduce') && matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  immersive = false;
  clearGameNotices();
});
afterEach(() => {
  clearGameNotices();
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: originalMatchMedia });
});

const strawberry = { title: '+1 Strawberry', description: 'Received from Nostr Farm', imageUrl: 'https://img/strawberry.webp', emoji: '🍓' };

describe('inside the game window', () => {
  it('BlobbiFrame renders the layer inside the bezel, level with the HUD, below the overlay host; never in document.body', () => {
    render(
      <BlobbiFrame hud={<div data-testid="hud">hud</div>}>
        <div data-testid="world">world</div>
      </BlobbiFrame>,
    );
    act(() => {
      showGameNotice(strawberry);
    });
    const layer = screen.getByTestId('game-notice-layer');
    const host = document.querySelector('[data-stage-overlay-host]')!;
    // Same parent as the overlay host (the cream bezel), so it moves and
    // clips with the game window in every presentation.
    expect(layer.parentElement).toBe(host.parentElement);
    expect(layer.parentElement).toContainElement(screen.getByTestId('hud'));
    // After the HUD wrapper in DOM order (paints above it at the same z band)
    // and before the overlay host (modals paint above it).
    const children = [...layer.parentElement!.children];
    expect(children.indexOf(layer)).toBeGreaterThan(children.indexOf(screen.getByTestId('hud').parentElement!));
    expect(children.indexOf(layer)).toBeLessThan(children.indexOf(host as HTMLElement));
    expect(layer.className).toContain('z-30');
    expect(layer.className).toContain('absolute');
    // Not the body toaster.
    expect(document.body.querySelector('[role="region"]')).toBeNull();
    expect(layer.closest('[data-stage-overlay-host]')).toBeNull();
  });

  it('is anchored top-right, below the HUD row, pointer-transparent, and follows the compact HUD in immersive layouts', () => {
    const { unmount } = render(<GameNoticeLayer />);
    act(() => {
      showGameNotice(strawberry);
    });
    let layer = screen.getByTestId('game-notice-layer');
    expect(layer.className).toContain('pointer-events-none');
    expect(layer.className).toMatch(/right-\[max\(0\.75rem,env\(safe-area-inset-right\)\)\]/);
    expect(layer.className).toContain('top-14');
    expect(layer.className).toContain('items-end');
    unmount();

    immersive = true;
    render(<GameNoticeLayer />);
    layer = screen.getByTestId('game-notice-layer');
    expect(layer.className).toContain('top-11');
  });

  it('renders nothing at all while there is nothing to say', () => {
    const { container } = render(<GameNoticeLayer />);
    expect(container.firstChild).toBeNull();
  });
});

describe('the chip', () => {
  it('shows the picture, "+N Item" and the source, in the Farm paper treatment', () => {
    render(<GameNoticeLayer />);
    act(() => {
      showGameNotice(strawberry);
    });
    const chip = screen.getByRole('status');
    expect(chip).toHaveTextContent('+1 Strawberry');
    expect(chip).toHaveTextContent('Received from Nostr Farm');
    const img = chip.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'https://img/strawberry.webp');
    expect(img.className).toContain('size-8');
    expect(img.className).toContain('object-contain');
    // The Farm chip: rounded-xl, 1px border, paper background, px-3 py-2, gap-3.
    for (const cls of ['rounded-xl', 'border', 'bg-island-cream', 'px-3', 'py-2', 'gap-3', 'items-center']) {
      expect(chip.className).toContain(cls);
    }
    expect(chip.querySelector('p')!.className).toMatch(/text-base/);
    expect(chip.querySelector('p')!.className).toMatch(/tabular-nums/);
    expect(chip.querySelectorAll('p')[1].className).toMatch(/text-xs/);
    expect(chip.textContent).not.toMatch(/31632|31633|1416|farm:main|wss:/);
  });

  it('falls back to the emoji without a picture', () => {
    render(<GameNoticeLayer />);
    act(() => {
      showGameNotice({ title: '+2 Carrot', description: 'Received from Nostr Farm', emoji: '🥕' });
    });
    const chip = screen.getByRole('status');
    expect(chip.querySelector('img')).toBeNull();
    expect(chip).toHaveTextContent('🥕');
  });

  it('enters like the Farm chip, and does not move under reduced motion', () => {
    const { unmount } = render(<GameNoticeLayer />);
    act(() => {
      showGameNotice(strawberry);
    });
    expect(screen.getByRole('status').className).toMatch(/animate-in fade-in slide-in-from-top-2/);
    unmount();
    clearGameNotices();

    reducedMotion(true);
    render(<GameNoticeLayer />);
    act(() => {
      showGameNotice(strawberry);
    });
    expect(screen.getByRole('status').className).not.toContain('animate-in');
  });
});

describe('the stack', () => {
  it('one, two, then the oldest leaves at once for the third; never more than two on screen', () => {
    render(<GameNoticeLayer />);
    act(() => {
      showGameNotice({ ...strawberry, title: 'A' });
    });
    expect(screen.getAllByRole('status')).toHaveLength(1);
    act(() => {
      showGameNotice({ ...strawberry, title: 'B' });
    });
    expect(screen.getAllByRole('status').map((c) => c.querySelector('p')!.textContent)).toEqual(['A', 'B']);
    act(() => {
      showGameNotice({ ...strawberry, title: 'C' });
    });
    expect(screen.getAllByRole('status').map((c) => c.querySelector('p')!.textContent)).toEqual(['B', 'C']);
    act(() => {
      for (let i = 0; i < 5; i += 1) showGameNotice({ ...strawberry, title: `X${i}` });
    });
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });
});
