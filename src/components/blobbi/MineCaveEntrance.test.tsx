import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

import { LocationContext } from '@/contexts/LocationContextValue';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { InteractiveElements } from './InteractiveElements';
import { MineCaveEntrance } from './MineCaveEntrance';
import type { MovableBlobbiRef } from './MovableBlobbi';
import type { LocationId } from '@/lib/location-types';
import type { Position } from '@/lib/types';
import { mineCaveStructure } from '@/lib/mine-cave-config';
import { locationBoundaries } from '@/lib/location-boundaries';
import {
  calculateBlobbiZIndex,
  getInteractiveElementsForBackground,
} from '@/lib/interactive-elements-config';
import { constrainPosition } from '@/lib/boundaries';

/**
 * The Mine exterior's cave, after the background-asset migration took the cave
 * mouth out of `mine-open.webp`.
 *
 * What these cover is the composition and its three visual states, not
 * appearance: `:hover` and `filter` are not evaluated in jsdom, so anything that
 * depends on the cascade is asserted structurally (which element is inert, which
 * paints over which, what carries an opt-out attribute) and everything the
 * component actually decides is asserted through its behaviour.
 */

/** The Blobbi is parked far enough away that a walk is genuinely pending. */
const FAR: Position = { x: 50, y: 90 };
/** Standing on the approach anchor: the interaction resolves immediately. */
const AT_ENTRANCE: Position = mineCaveStructure.approach;

function renderRoom(currentLocation: LocationId, blobbiAt: Position = FAR) {
  const setCurrentLocation = vi.fn();
  const goTo = vi.fn();
  const blobbiRef: React.RefObject<MovableBlobbiRef> = {
    current: { goTo, getCurrentPosition: () => blobbiAt },
  };

  const view = render(
    <LocationContext.Provider
      value={{
        currentLocation,
        setCurrentLocation,
        previousLocation: null,
        isMapModalOpen: false,
        setIsMapModalOpen: vi.fn(),
        isTransitioning: false,
      }}
    >
      {/* Town's streetlights register movement blockers; the Mine has none, but
          the contrast case renders Town. */}
      <MovementBlockerProvider>
        <div data-world-surface data-island-world-graded="">
          <InteractiveElements blobbiRef={blobbiRef} selectedBlobbi={null} />
        </div>
      </MovementBlockerProvider>
    </LocationContext.Provider>,
  );

  return { ...view, setCurrentLocation, goTo };
}

const front = () => screen.getByAltText('Mine cave');
const preview = () => screen.getByAltText('Mine cave entrance');
const hotspot = () => screen.getByRole('button', { name: 'Enter the mine' });
const backing = () =>
  document.querySelector('[data-mine-cave-backing]') as HTMLElement;
const mouth = () => document.querySelector('[data-mine-cave-mouth]') as HTMLElement;
const structure = () =>
  document.querySelector('[data-mine-cave-structure]') as HTMLElement;

/** Opacity is the whole visual state model, so read it rather than a class. */
const opacityOf = (el: HTMLElement) => el.style.opacity;
const isRevealed = () => opacityOf(preview()) === '1' && opacityOf(backing()) === '0';
const isIdle = () => opacityOf(preview()) === '0' && opacityOf(backing()) === '1';

const percent = (value: string) => Number.parseFloat(value);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('the composed cave structure', () => {
  it('renders both cave sprites in the Mine exterior', () => {
    renderRoom('mine');
    expect(front()).toBeInTheDocument();
    expect(preview()).toBeInTheDocument();
  });

  it('renders neither of them anywhere else', () => {
    renderRoom('town');
    expect(screen.queryByAltText('Mine cave')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Mine cave entrance')).not.toBeInTheDocument();
    expect(document.querySelector('[data-mine-cave-structure]')).toBeNull();
  });

  it('paints the entrance preview behind the arch', () => {
    renderRoom('mine');
    // Both are z-index-free siblings in one wrapper, so paint order IS document
    // order: whatever comes last wins. DOCUMENT_POSITION_FOLLOWING === 4.
    const relation = mouth().compareDocumentPosition(front());
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws the arch larger than the preview it frames', () => {
    renderRoom('mine');
    // jsdom lays nothing out, so compare the declared geometry: the arch fills
    // the wrapper, the preview is confined to the opening inside it.
    expect(front().className).toContain('w-full');
    expect(percent(mouth().style.width)).toBeLessThan(100);
    expect(percent(mouth().style.top)).toBeGreaterThan(0);
    expect(percent(mouth().style.left)).toBeGreaterThan(0);
  });

  it('leaves every piece of the artwork inert to pointer events', () => {
    renderRoom('mine');
    for (const el of [front(), preview(), mouth(), structure()]) {
      expect(el.className).toContain('pointer-events-none');
    }
  });

  it('keeps both sprites eligible for the day/night world grade', () => {
    renderRoom('mine');
    for (const img of [front(), preview()]) {
      // The grade reaches `[data-island-world-graded] img` unless something
      // opts out — neither the image nor any ancestor may.
      expect(img.closest("[data-island-world-grade='exclude']")).toBeNull();
      expect(img.closest('[data-island-world-graded]')).not.toBeNull();
    }
  });

  it('gives the wrapper nothing that would create a stacking context', () => {
    renderRoom('mine');
    /*
      Any of these on the wrapper would trap the three z-indexes inside the cave,
      leaving the whole structure to be sorted against the Blobbi as one block at
      `z-index: auto` — i.e. under it — so the Blobbi would walk in front of the
      arch and never appear to stand in the mouth. `transform` is the one that
      actually regressed: the wrapper was centred with `-translate-x-1/2`.
    */
    const el = structure();
    for (const property of [
      'transform',
      'filter',
      'opacity',
      'isolation',
      'contain',
      'willChange',
      'zIndex',
      'mixBlendMode',
      'perspective',
    ] as const) {
      expect(el.style[property], property).toBe('');
    }
    // Tailwind could smuggle the same properties in as classes.
    expect(el.className).not.toMatch(
      /translate|scale|rotate|skew|\bblur\b|opacity-|isolate|will-change|\bz-\d/,
    );
    expect(mouth().style.filter).toBe('');
  });

  it('centres the cave by arithmetic, not by a transform', () => {
    renderRoom('mine');
    const { wrapper } = mineCaveStructure;

    // Same visual result as `translateX(-50%)`, without the stacking context.
    expect(structure().style.left).toBe(
      `${wrapper.centerXPercent - wrapper.widthPercent / 2}%`,
    );
    expect(structure().style.width).toBe(`${wrapper.widthPercent}%`);
  });

  it('layers the opening below the Blobbi and the arch above it', () => {
    renderRoom('mine');
    const { depth } = mineCaveStructure;

    // A Blobbi standing at the entrance is z-10 in this room, so the opening
    // has to sit under that and the arch over it for the character to read as
    // standing IN the cave mouth rather than behind the hill.
    expect(depth.mouth).toBeLessThan(10);
    expect(depth.front).toBeGreaterThan(10);
    expect(depth.hotspot).toBeGreaterThan(depth.front);

    expect(mouth().style.zIndex).toBe(String(depth.mouth));
    expect(front().style.zIndex).toBe(String(depth.front));
    expect(hotspot().style.zIndex).toBe(String(depth.hotspot));
  });

  it('sorts against the depth the room actually gives a Blobbi', () => {
    const { depth } = mineCaveStructure;

    // Both the local Blobbi and remote players resolve their z-index from this
    // one function, so pinning it here covers multiplayer layering too.
    const atTheEntrance = calculateBlobbiZIndex(
      mineCaveStructure.approach.y,
      'mine-open.webp',
    );
    expect(depth.mouth).toBeLessThan(atTheEntrance);
    expect(depth.front).toBeGreaterThan(atTheEntrance);

    // Further down the path the Blobbi is nearer the camera and must clear the
    // whole structure.
    expect(calculateBlobbiZIndex(92, 'mine-open.webp')).toBeGreaterThan(depth.hotspot);

    // And the arch's depth is the one the shared config records for the cave.
    const registered = getInteractiveElementsForBackground('mine-open.webp');
    expect(registered.map((el) => el.id)).toEqual(['cave']);
    expect(registered[0].zIndex).toBe(depth.front);
  });
});

describe('the idle opening', () => {
  it('reads as a black cave mouth with the tunnel hidden', () => {
    renderRoom('mine');
    expect(isIdle()).toBe(true);
  });

  it('clips the black backing and the tunnel to the opening only', () => {
    renderRoom('mine');
    // The tunnel sprite is far wider than the arch; without this it spills out
    // either side of the rock.
    expect(mouth().className).toContain('overflow-hidden');
    expect(mouth().style.borderRadius).not.toBe('');
    // ...and the clip is scoped to the opening, so it cannot cut the arch.
    expect(mouth().contains(front())).toBe(false);
  });
});

describe('previewing the entrance', () => {
  it('lights the tunnel on hover and goes dark again on leave', () => {
    renderRoom('mine');

    fireEvent.mouseEnter(hotspot());
    expect(isRevealed()).toBe(true);

    fireEvent.mouseLeave(hotspot());
    expect(isIdle()).toBe(true);
  });

  it('lights the tunnel on keyboard focus and goes dark again on blur', () => {
    renderRoom('mine');

    fireEvent.focus(hotspot());
    expect(isRevealed()).toBe(true);

    fireEvent.blur(hotspot());
    expect(isIdle()).toBe(true);
  });

  it('does not enter the mine merely because it was hovered or focused', () => {
    const { setCurrentLocation, goTo } = renderRoom('mine', AT_ENTRANCE);

    fireEvent.mouseEnter(hotspot());
    fireEvent.focus(hotspot());

    expect(goTo).not.toHaveBeenCalled();
    expect(setCurrentLocation).not.toHaveBeenCalled();
  });
});

describe('activating the entrance', () => {
  it('locks the tunnel open on click and keeps it lit after the pointer leaves', () => {
    renderRoom('mine');

    fireEvent.click(hotspot());
    expect(isRevealed()).toBe(true);

    // The Blobbi is still walking; the pointer wandering off must not undo it.
    fireEvent.mouseLeave(hotspot());
    fireEvent.blur(hotspot());
    expect(isRevealed()).toBe(true);
  });

  it('locks the tunnel open on tap, and registers the tap exactly once', () => {
    const { goTo } = renderRoom('mine');

    /*
      A real tap on a <button> fires touchstart AND then a synthetic click.
      React 18 registers `touchstart` at the root as a PASSIVE listener, so an
      `onTouchStart` handler cannot `preventDefault()` that click away — which is
      why this component activates from `onClick` alone. Firing both here is the
      regression guard: a second activation would replace the first pending
      interaction, and the replacement's `onCancel` would clear the lock the tap
      had just set.
    */
    fireEvent.touchStart(hotspot());
    fireEvent.click(hotspot());

    expect(isRevealed()).toBe(true);
    expect(goTo).toHaveBeenCalledTimes(1);
  });

  it('stays locked when it is activated again while already walking', () => {
    const { goTo } = renderRoom('mine');

    fireEvent.click(hotspot());
    fireEvent.click(hotspot());

    // The second request cancels the first; only the newest one is allowed to
    // release the lock, so the stale cancellation must not darken the cave.
    expect(isRevealed()).toBe(true);
    expect(goTo).toHaveBeenCalledTimes(2);
  });

  it('is a real button, so Enter and Space activate it like a click', () => {
    renderRoom('mine');

    // Keyboard activation of a <button> is dispatched by the browser as a
    // click, which jsdom does not synthesise — so the contract worth pinning is
    // that the target IS a button and that a click runs the interaction.
    expect(hotspot().tagName).toBe('BUTTON');
    expect(hotspot()).toHaveAttribute('type', 'button');

    act(() => hotspot().focus());
    fireEvent.click(hotspot());
    expect(isRevealed()).toBe(true);
  });

  it('walks the Blobbi to the approach anchor instead of entering instantly', () => {
    const { goTo, setCurrentLocation } = renderRoom('mine');

    fireEvent.click(hotspot());

    expect(goTo).toHaveBeenCalledWith(mineCaveStructure.approach);
    expect(setCurrentLocation).not.toHaveBeenCalled();
  });

  it('enters cave-open once the Blobbi has arrived', () => {
    const { setCurrentLocation } = renderRoom('mine', AT_ENTRANCE);

    fireEvent.click(hotspot());

    expect(setCurrentLocation).toHaveBeenCalledWith('cave-open');
    // Arrival ends the lock: the room is about to change.
    expect(isIdle()).toBe(true);
  });

  it('puts the approach anchor somewhere the Blobbi can actually stand', () => {
    // The old target was derived from the sprite's rect and landed above the
    // Mine's walkable corridor, where a walk can never converge.
    const boundary = locationBoundaries['mine-open.webp'];
    expect(constrainPosition(mineCaveStructure.approach, boundary)).toEqual(
      mineCaveStructure.approach,
    );
  });
});

describe('releasing the lock', () => {
  it('goes back to idle when the player taps elsewhere in the world', () => {
    renderRoom('mine');
    fireEvent.click(hotspot());
    expect(isRevealed()).toBe(true);

    // `useCancelInteractionOnWorldClick` listens on the world surface; a
    // pointerdown that is not on a [data-block-move] element abandons the walk.
    const surface = document.querySelector('[data-world-surface]')!;
    fireEvent.pointerDown(surface);

    expect(isIdle()).toBe(true);
  });

  it('does not cancel itself when the hotspot is the thing being pressed', () => {
    renderRoom('mine');
    fireEvent.click(hotspot());

    fireEvent.pointerDown(hotspot());

    expect(isRevealed()).toBe(true);
  });

  it('resets its visual state when the room changes', () => {
    const requestInteraction = vi.fn();
    const { rerender } = render(
      <MineCaveEntrance
        requestInteraction={requestInteraction}
        onEnter={vi.fn()}
        locationKey="mine"
      />,
    );

    fireEvent.click(hotspot());
    expect(isRevealed()).toBe(true);

    rerender(
      <MineCaveEntrance
        requestInteraction={requestInteraction}
        onEnter={vi.fn()}
        locationKey="cave-open"
      />,
    );
    expect(isIdle()).toBe(true);
  });
});

describe('the hotspot', () => {
  it('is the only interactive target in the Mine exterior', () => {
    const { container } = renderRoom('mine');
    expect(within(container).getAllByRole('button')).toHaveLength(1);
    expect(hotspot()).toHaveAccessibleName('Enter the mine');
  });

  it('covers the opening only, not the whole cave', () => {
    renderRoom('mine');

    // Same box as the opening, so it stays registered to the arch at any size…
    expect(hotspot().style.left).toBe(mouth().style.left);
    expect(hotspot().style.width).toBe(mouth().style.width);
    expect(hotspot().style.top).toBe(mouth().style.top);
    expect(hotspot().style.bottom).toBe(mouth().style.bottom);
    expect(hotspot().style.borderRadius).toBe(mouth().style.borderRadius);
    // …and that box is a strict subset of the structure it sits in.
    expect(percent(hotspot().style.width)).toBeLessThan(100);
    expect(percent(hotspot().style.left)).toBeGreaterThan(0);
    expect(percent(hotspot().style.top)).toBeGreaterThan(0);
  });

  it('is positioned in percentages so it survives a resize of the cave', () => {
    renderRoom('mine');
    for (const value of [
      hotspot().style.left,
      hotspot().style.width,
      hotspot().style.top,
      structure().style.left,
      structure().style.width,
      structure().style.bottom,
    ]) {
      expect(value).toMatch(/%$/);
    }
  });

  it('is the only part of the structure that takes pointer events', () => {
    renderRoom('mine');
    // The rock covers a wide slice of the path; a click on it must fall through
    // to the world surface and move the Blobbi as usual.
    expect(structure().className).toContain('pointer-events-none');
    expect(hotspot().className).toContain('pointer-events-auto');
  });

  it('draws no debug outline unless the shared dev overlay switch is on', () => {
    renderRoom('mine');
    // `useDebugOverlays` falls back to a production-like "everything off" state
    // outside its provider, which is what this render gets.
    expect(hotspot().className).not.toContain('outline-fuchsia');
  });

  it('keeps a click on it from also starting a raw world walk', () => {
    renderRoom('mine');
    // MovableBlobbi cancels a world move for `button` and `[data-block-move]`.
    expect(hotspot()).toHaveAttribute('data-block-move');
  });
});
