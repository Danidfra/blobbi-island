/**
 * `<ArcadeGameShell>` coverage.
 *
 * The shell replaces `GameModal`, which rendered as a plain `absolute inset-0`
 * div INSIDE the scaled `VirtualWorld` and never cleared its content on close.
 * These tests pin the properties that mattered: it portals out of the world, it
 * unmounts its children when closed, it restores focus, and its controls have
 * names.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

import { ArcadeGameShell, type ArcadeGameShellProps } from './ArcadeGameShell';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

function setReducedMotion(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () =>
      ({
        matches: reduced,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      }) as unknown as MediaQueryList,
  });
}

function renderShell(overrides: Partial<ArcadeGameShellProps> = {}) {
  const props: ArcadeGameShellProps = {
    open: true,
    onClose: () => {},
    title: 'Dance Dance Blobbi',
    description: 'Rhythm game coming in the next arcade update.',
    machineId: 'arcade-dance-machine',
    gameId: 'blobbi-dance',
    status: 'preview',
    children: <p data-testid="game-surface">game surface</p>,
    ...overrides,
  };

  // The world surface is the thing the shell must NOT render inside.
  return render(
    <div data-world-surface>
      <ArcadeGameShell {...props} />
    </div>,
  );
}

const shell = () => document.querySelector('[data-arcade-shell]') as HTMLElement | null;

describe('rendering position', () => {
  it('portals outside the scaled world surface', () => {
    const { container } = renderShell();

    const surface = container.querySelector('[data-world-surface]') as HTMLElement;
    expect(shell()).toBeInTheDocument();
    expect(surface.contains(shell())).toBe(false);
    // Radix portals to the body, exactly like every other modal in the app.
    expect(document.body.contains(shell())).toBe(true);
  });

  it('keeps world input from ever reaching the room behind it', () => {
    const { container } = renderShell();
    const surface = container.querySelector('[data-world-surface]') as HTMLElement;

    let worldMoves = 0;
    surface.addEventListener('pointerdown', () => {
      worldMoves += 1;
    });

    // A pointer event anywhere in the shell cannot bubble to the world, because
    // the shell is not inside it — the portal IS the isolation.
    fireEvent.pointerDown(screen.getByRole('dialog'), { bubbles: true });
    fireEvent.pointerDown(screen.getByRole('button', { name: /leave/i }), { bubbles: true });
    expect(worldMoves).toBe(0);

    // Belt and braces for any path that renders it inside the surface.
    expect(shell()).toHaveAttribute('data-block-move');
  });

  it('shows exactly one close affordance', () => {
    renderShell();
    const closers = screen
      .getAllByRole('button')
      .filter((b) => /leave|close/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));
    expect(closers).toHaveLength(1);
  });

  it('carries the machine, game and lifecycle status as data', () => {
    renderShell();
    expect(shell()).toHaveAttribute('data-arcade-machine', 'arcade-dance-machine');
    expect(shell()).toHaveAttribute('data-arcade-game', 'blobbi-dance');
    expect(shell()).toHaveAttribute('data-arcade-status', 'preview');
  });
});

describe('mounting lifetime', () => {
  it('renders nothing at all while closed', () => {
    renderShell({ open: false, status: 'closed' });
    expect(shell()).toBeNull();
    expect(screen.queryByTestId('game-surface')).toBeNull();
  });

  it('unmounts its children on close, leaving nothing behind', () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <ArcadeGameShell
          open={open}
          onClose={() => {}}
          title="Dance Dance Blobbi"
          machineId="arcade-dance-machine"
          status={open ? 'preview' : 'closed'}
        >
          <p data-testid="game-surface">game surface</p>
        </ArcadeGameShell>
      );
    }

    const { rerender } = render(<Harness open />);
    expect(screen.getByTestId('game-surface')).toBeInTheDocument();

    rerender(<Harness open={false} />);
    expect(screen.queryByTestId('game-surface')).toBeNull();
  });
});

describe('controls', () => {
  it('closes through the Leave button', () => {
    const onClose = vi.fn();
    renderShell({ onClose });

    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape, so a run can always be abandoned', () => {
    const onClose = vi.fn();
    renderShell({ onClose });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows no Pause control outside a live run', () => {
    renderShell({ status: 'preview', onPause: vi.fn() });
    expect(screen.queryByRole('button', { name: /pause/i })).toBeNull();
  });

  it('offers Pause while playing', () => {
    const onPause = vi.fn();
    renderShell({ status: 'playing', onPause });

    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('offers Resume only while paused', () => {
    const onResume = vi.fn();
    renderShell({ status: 'paused', onResume, onPause: vi.fn() });

    expect(screen.queryByRole('button', { name: /^pause/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('gives every control a meaningful name', () => {
    renderShell({ status: 'playing', onPause: vi.fn() });
    expect(screen.getByRole('button', { name: 'Pause Dance Dance Blobbi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave Dance Dance Blobbi' })).toBeInTheDocument();
  });

  it('lets the caller label the dismiss control for where it actually goes', () => {
    // Phase 4: this dialog hosts a catalogue, a game and a notice panel, and
    // "Leave" is only right for one of them. The label and its accessible name
    // are the caller's to set, because the caller is what knows the destination.
    renderShell({
      closeLabel: 'Back to games',
      closeAriaLabel: 'Back to the game list',
    });
    const back = screen.getByRole('button', { name: 'Back to the game list' });
    expect(back).toHaveTextContent('Back to games');
    expect(screen.queryByRole('button', { name: /^leave/i })).toBeNull();
  });

  it('offers exactly one dismiss control, whatever it is called', () => {
    renderShell({ closeLabel: 'Close' });
    expect(document.querySelectorAll('[data-arcade-close]')).toHaveLength(1);
  });

  it('declares a 44 px touch target on every header control', () => {
    renderShell({ status: 'playing', onPause: vi.fn() });
    for (const name of [/^pause/i, /^leave/i]) {
      expect(screen.getByRole('button', { name }).className).toContain('min-h-[44px]');
    }
  });
});

describe('surfaces without a run', () => {
  it('shows no pause control and reports no status when none is given', () => {
    // A catalogue is a screen, not a run. Borrowing an `ArcadeStatus` for it
    // would put a UI concept inside the lifecycle, which is the thing
    // `arcade-navigation.ts` exists to avoid.
    renderShell({ status: undefined, surface: 'catalogue', onPause: vi.fn() });

    expect(shell()!.getAttribute('data-arcade-status')).toBeNull();
    expect(shell()).toHaveAttribute('data-arcade-surface', 'catalogue');
    expect(screen.queryByRole('button', { name: /^pause/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^resume/i })).toBeNull();
  });

  it('distinguishes the three surfaces it hosts', () => {
    for (const surface of ['catalogue', 'game', 'notice'] as const) {
      const view = renderShell({ surface });
      expect(shell()).toHaveAttribute('data-arcade-surface', surface);
      view.unmount();
    }
  });
});

describe('accessibility', () => {
  it('names and describes the dialog', () => {
    renderShell();
    expect(screen.getByRole('dialog', { name: 'Dance Dance Blobbi' })).toBeInTheDocument();
    expect(screen.getByText('Rhythm game coming in the next arcade update.')).toBeInTheDocument();
  });

  it('wires the title and description to the dialog, not merely near it', () => {
    renderShell();
    const dialog = screen.getByRole('dialog');

    const labelledBy = dialog.getAttribute('aria-labelledby');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)).toHaveTextContent('Dance Dance Blobbi');
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      'Rhythm game coming in the next arcade update.',
    );
  });

  it('falls back to a screen-reader-only description rather than inventing copy', () => {
    renderShell({ description: undefined });
    const describedBy = screen.getByRole('dialog').getAttribute('aria-describedby');
    expect(document.getElementById(describedBy!)).toHaveTextContent(/arcade machine/i);
  });

  it('moves focus into the dialog when it opens', () => {
    renderShell();
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('contains no nested interactive controls', () => {
    // The shared `DialogContent` renders its default close as a <button> inside
    // a <button>; `hideDefaultClose` is what keeps that out of this dialog.
    renderShell({ status: 'playing', onPause: vi.fn() });
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelectorAll('button button, a button, button a')).toHaveLength(0);
  });

  it('restores focus to the opener when it closes', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
            open
          </button>
          <ArcadeGameShell
            open={open}
            onClose={() => setOpen(false)}
            title="Dance Dance Blobbi"
            machineId="arcade-dance-machine"
            status={open ? 'preview' : 'closed'}
          >
            <p>panel</p>
          </ArcadeGameShell>
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    });

    // Radix restores focus asynchronously as the layer unmounts.
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe('reduced motion', () => {
  /**
   * The in-frame dialog base carries `motion-reduce:` variants of the same
   * neutralising classes, so a substring match on "zoom-in-100" is always true.
   * These assert the UNPREFIXED tokens — the ones this component adds — which is
   * what actually differs between the two cases.
   */
  const unprefixed = (className: string) =>
    className.split(/\s+/).filter((token) => !token.includes(':') || token.startsWith('data-['));

  it('drops the decorative zoom when the OS asks for reduced motion', () => {
    setReducedMotion(true);
    renderShell();
    const tokens = unprefixed(shell()!.className);
    expect(tokens).toContain('data-[state=open]:zoom-in-100');
    expect(tokens).toContain('duration-0');
  });

  it('keeps the entrance animation otherwise', () => {
    setReducedMotion(false);
    renderShell();
    const tokens = unprefixed(shell()!.className);
    expect(tokens).not.toContain('data-[state=open]:zoom-in-100');
    expect(tokens).not.toContain('duration-0');
  });
});
