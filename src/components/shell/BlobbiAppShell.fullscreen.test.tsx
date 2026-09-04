/**
 * The shell must change its PRESENTATION on fullscreen, never its TREE.
 *
 * This is the regression that made a fullscreen click look like a page reload.
 * The shell used to `return` early for the fill-screen layout, so the framed and
 * fullscreen trees had different components at the same child positions. React
 * matches state by position, so every toggle unmounted the entire game and
 * mounted a fresh copy: the Blobbi reappeared at its spawn point, the seat was
 * gone, the YouTube player was destroyed, presence started a new session id, and
 * a host silently lost the watch session it had created, a session nobody else
 * could ever control, because authority is the author's pubkey.
 *
 * Nothing navigated. Nothing reloaded. It was a remount, which is why these
 * tests count mounts and assert on state that only survives if the same
 * component instance is still there.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { BlobbiAppShell } from './BlobbiAppShell';

// The chrome is irrelevant here and drags in the whole account/Nostr stack.
vi.mock('./BlobbiShellHeader', () => ({
  BlobbiShellHeader: ({ onToggleFullscreen }: { onToggleFullscreen: () => void }) => (
    <button type="button" data-testid="shell-fullscreen" onClick={onToggleFullscreen}>
      fullscreen
    </button>
  ),
}));
vi.mock('./BlobbiShellFooter', () => ({
  BlobbiShellFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('./BlobbiHUD', () => ({ BlobbiHUD: () => <div data-testid="hud" /> }));
vi.mock('./BlobbiActionDock', () => ({ BlobbiActionDock: () => <div data-testid="dock" /> }));
vi.mock('./FullscreenExitButton', () => ({
  FullscreenExitButton: ({ onExit }: { onExit: () => void }) => (
    <button type="button" data-testid="exit-fullscreen" onClick={onExit}>
      exit
    </button>
  ),
}));

// ── A fullscreen API jsdom does not have ───────────────────────────────────

let fullscreenElement: Element | null = null;

function installFullscreenApi() {
  fullscreenElement = null;
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  });
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    writable: true,
    value: vi.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    }),
  });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
    configurable: true,
    writable: true,
    value: vi.fn(async function (this: HTMLElement) {
      // `requestFullscreen` is a method on the element, so the element under
      // test is only reachable through `this`.
      fullscreenElement = this as HTMLElement;
      document.dispatchEvent(new Event('fullscreenchange'));
    }),
  });
}

/** Something OTHER than the shell root goes fullscreen, e.g. the video iframe. */
async function fullscreenSomethingElse(element: Element) {
  await act(async () => {
    fullscreenElement = element;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
}

// ── A game that remembers whether it was remounted ─────────────────────────

let mounts = 0;

function FakeGame() {
  const [seat] = useState(() => `seat-${++mounts}`);
  const instance = useRef({ id: mounts });
  useEffect(() => {
    // Nothing: the counter above already ran once per mount.
  }, []);
  return (
    <div data-testid="game" data-seat={seat} data-instance={instance.current.id}>
      world
    </div>
  );
}

const game = () => document.querySelector('[data-testid="game"]') as HTMLElement;

beforeEach(() => {
  mounts = 0;
  installFullscreenApi();
});

afterEach(() => {
  // Deliberately NOT `vi.restoreAllMocks()`: the shared test setup installs
  // `matchMedia` as a mock WITH an implementation, and restoring strips it for
  // every later test (`useImmersive` then throws on `.matches`). Undo only what
  // this file installed.
  fullscreenElement = null;
  Reflect.deleteProperty(document, 'fullscreenElement');
  Reflect.deleteProperty(document, 'exitFullscreen');
  Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
});

describe('BlobbiAppShell across a fullscreen toggle', () => {
  it('keeps the SAME game instance mounted when entering and leaving fullscreen', async () => {
    const { getByTestId } = render(
      <BlobbiAppShell screen="playing" showGameChrome>
        <FakeGame />
      </BlobbiAppShell>,
    );

    expect(mounts).toBe(1);
    const before = game().dataset.seat;

    await act(async () => {
      getByTestId('shell-fullscreen').click();
    });

    // Presentation changed…
    expect(getByTestId('exit-fullscreen')).toBeInTheDocument();
    // …the game did not.
    expect(mounts).toBe(1);
    expect(game().dataset.seat).toBe(before);

    await act(async () => {
      getByTestId('exit-fullscreen').click();
    });

    expect(mounts).toBe(1);
    expect(game().dataset.seat).toBe(before);
  });

  it('survives repeated toggling without ever rebuilding the game', async () => {
    const { getByTestId, queryByTestId } = render(
      <BlobbiAppShell screen="playing" showGameChrome>
        <FakeGame />
      </BlobbiAppShell>,
    );

    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        (queryByTestId('shell-fullscreen') ?? getByTestId('exit-fullscreen')).click();
      });
      await act(async () => {
        (queryByTestId('exit-fullscreen') ?? getByTestId('shell-fullscreen')).click();
      });
    }

    expect(mounts).toBe(1);
  });

  it('ignores a DESCENDANT going fullscreen, the video owns that layer, not the shell', async () => {
    // The theater's fullscreen button requests fullscreen on the YouTube iframe.
    // A shell that treated "something is fullscreen" as "I am fullscreen" would
    // switch layout underneath a video it never fullscreened.
    const { queryByTestId } = render(
      <BlobbiAppShell screen="playing" showGameChrome>
        <FakeGame />
      </BlobbiAppShell>,
    );

    await fullscreenSomethingElse(game());

    expect(mounts).toBe(1);
    expect(queryByTestId('exit-fullscreen')).toBeNull();
    expect(queryByTestId('shell-fullscreen')).not.toBeNull();
  });

  it('renders the framed chrome only when not filling the screen', async () => {
    const { getByTestId, queryByTestId } = render(
      <BlobbiAppShell screen="playing" showGameChrome footerSlot={<span data-testid="footer-slot" />}>
        <FakeGame />
      </BlobbiAppShell>,
    );

    expect(queryByTestId('footer-slot')).not.toBeNull();

    await act(async () => {
      getByTestId('shell-fullscreen').click();
    });

    expect(queryByTestId('footer-slot')).toBeNull();
    expect(queryByTestId('hud')).not.toBeNull();
  });
});
