/**
 * Arcade surfaces live inside the game window, not over the browser page.
 *
 * The defect: `ArcadeGameShell` portaled to `document.body` and sized itself in
 * viewport units (`w-screen h-[100dvh]`), so walking up to a cabinet blacked out
 * the whole page, the cozy wood frame, the shell header and footer and the page
 * behind them all disappeared behind a full-viewport dialog. It read as "this
 * website opened a modal", which is exactly what a machine's screen is not.
 *
 * The fix is a containment ROOT, not a `max-width`: `BlobbiFrame` provides an
 * overlay host level with the world, and the shell portals into it. These tests
 * check the root, because a size can be tweaked back but a portal target cannot
 * be changed by accident.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ArcadeGameShell } from './ArcadeGameShell';
import { BlobbiFrame } from '@/components/shell/BlobbiFrame';

vi.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

/** The real frame, with an arcade surface open inside it. */
function renderInFrame(variant: 'desktop' | 'immersive' = 'desktop') {
  return render(
    <div data-test-page>
      <div data-test-outside-frame>page content around the game</div>
      <BlobbiFrame variant={variant}>
        <div data-world-surface>the world</div>
        <ArcadeGameShell
          open
          onClose={() => {}}
          title="Blobbi Dance"
          machineId="arcade-dance-machine"
          surface="game"
          status="preview"
        >
          <p data-testid="game-surface">game surface</p>
        </ArcadeGameShell>
      </BlobbiFrame>
    </div>,
  );
}

const host = () => document.querySelector('[data-stage-overlay-host]') as HTMLElement | null;
const shell = () => document.querySelector('[data-arcade-shell]') as HTMLElement | null;

describe('the overlay host', () => {
  it('exists inside the frame in both presentations', () => {
    for (const variant of ['desktop', 'immersive'] as const) {
      const view = render(
        <BlobbiFrame variant={variant}>
          <div data-world-surface />
        </BlobbiFrame>,
      );
      expect(host(), variant).not.toBeNull();
      view.unmount();
    }
  });

  it('covers the stage but lets world clicks through while empty', () => {
    // The host is `absolute inset-0` and therefore always over the world. If it
    // captured pointer events when empty, every click-to-move in the arcade
    // would silently stop working.
    render(
      <BlobbiFrame variant="immersive">
        <div data-world-surface />
      </BlobbiFrame>,
    );
    expect(host()!.className).toContain('absolute');
    expect(host()!.className).toContain('inset-0');
    expect(host()!.className).toContain('pointer-events-none');
    // …and its direct children re-enable them, which is the set Radix portals in.
    expect(host()!.className).toContain('[&>*]:pointer-events-auto');
  });

  it('sits above the HUD and dock, inside the frame', () => {
    render(
      <BlobbiFrame variant="desktop" hud={<div data-testid="hud" />} dock={<div data-testid="dock" />}>
        <div data-world-surface />
      </BlobbiFrame>,
    );
    // HUD and dock are z-30; a machine's screen must not leave them pokable.
    expect(host()!.className).toContain('z-40');
  });

  it('is NOT inside the world subtree, so no world transform can scale it', () => {
    render(
      <BlobbiFrame variant="desktop">
        <div data-world-surface>world</div>
      </BlobbiFrame>,
    );
    expect(host()!.closest('[data-world-surface]')).toBeNull();
  });
});

describe('an open arcade surface', () => {
  it('renders inside the overlay host, not directly under the body', () => {
    renderInFrame();
    expect(shell()).not.toBeNull();
    expect(host()!.contains(shell()!)).toBe(true);
    expect(shell()!.parentElement).not.toBe(document.body);
  });

  it('leaves the page around the frame untouched', () => {
    renderInFrame();
    // The thing the defect destroyed: content outside the game window is still
    // in the document and still outside the overlay.
    const outside = screen.getByText('page content around the game');
    expect(outside).toBeInTheDocument();
    expect(host()!.contains(outside)).toBe(false);
  });

  it('is measured against the stage, never against the viewport', () => {
    renderInFrame();
    const className = shell()!.className;
    // `absolute inset-0` against the host, the game window, with a small inset
    // on wider screens so the room shows through the soft backdrop.
    expect(className).toContain('absolute');
    expect(className).toContain('inset-0');
    expect(className).toContain('sm:inset-3');
    // The viewport units that made this a full-page modal are gone.
    expect(className).not.toContain('w-screen');
    expect(className).not.toContain('h-[100dvh]');
    expect(className).not.toContain('fixed');
  });

  it('dims only the game window', () => {
    renderInFrame();
    // Radix renders the overlay as the host's other direct child. `inFrame`
    // makes it absolute with the island's soft backdrop rather than
    // `fixed inset-0` with a black one.
    const overlay = [...host()!.children].find((el) => el !== shell()) as HTMLElement;
    expect(overlay).toBeDefined();
    expect(overlay.className).toContain('absolute');
    expect(overlay.className).not.toContain('fixed');
    expect(overlay.className).not.toContain('bg-black/80');
  });

  it('works the same in the immersive presentation', () => {
    renderInFrame('immersive');
    expect(host()!.contains(shell()!)).toBe(true);
  });

  it('keeps focus trapping and its own single dismiss control', () => {
    renderInFrame();
    expect(screen.getByRole('dialog', { name: 'Blobbi Dance' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-arcade-close]')).toHaveLength(1);
  });
});

describe('without a frame', () => {
  it('falls back to the Radix default rather than failing', () => {
    // A unit test rendering a room on its own has no host. `undefined` means
    // "use document.body", so nothing has to guard.
    render(
      <ArcadeGameShell
        open
        onClose={() => {}}
        title="Pool"
        machineId="arcade-pool-table"
        surface="notice"
      >
        <p>coming soon</p>
      </ArcadeGameShell>,
    );
    expect(shell()).not.toBeNull();
    expect(host()).toBeNull();
  });
});
