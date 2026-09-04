/**
 * Coverage for the extracted world-click cancellation rule.
 *
 * This was inline in `InteractiveElements` and is now shared, because the arcade
 * owns its own `usePendingInteraction` instance and must behave identically,
 * "the player chose somewhere else, so abandon the pending walk" is a rule of the
 * world, not of one room.
 *
 * Two instances are also mounted at once in the real app (the room's and
 * `InteractiveElements`' own), so the no-crosstalk case is pinned here too.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import { useCancelInteractionOnWorldClick } from './useCancelInteractionOnWorldClick';

interface HarnessProps {
  cancel: () => void;
  hasPending: () => boolean;
  locationKey?: string;
  children?: React.ReactNode;
}

function Harness({ cancel, hasPending, locationKey = 'arcade', children }: HarnessProps) {
  useCancelInteractionOnWorldClick({ cancel, hasPending }, locationKey);
  return (
    <div data-world-surface data-testid="surface">
      <div data-testid="ground" style={{ width: 100, height: 100 }} />
      <div data-block-move data-testid="element">
        <img alt="a machine" />
      </div>
      {children}
    </div>
  );
}

const ground = (c: HTMLElement) => c.querySelector('[data-testid="ground"]') as HTMLElement;
const element = (c: HTMLElement) => c.querySelector('[data-testid="element"]') as HTMLElement;

describe('cancelling on a world click', () => {
  it('cancels when the player taps empty ground', () => {
    const cancel = vi.fn();
    const { container } = render(<Harness cancel={cancel} hasPending={() => true} />);

    fireEvent.pointerDown(ground(container), { bubbles: true });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on touch as well as pointer', () => {
    const cancel = vi.fn();
    const { container } = render(<Harness cancel={cancel} hasPending={() => true} />);

    fireEvent.touchStart(ground(container));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('does NOT cancel when the tap lands on an interactive element', () => {
    // Those manage their own pending lifecycle, cancelling here would kill the
    // walk the very same tap just requested.
    const cancel = vi.fn();
    const { container } = render(<Harness cancel={cancel} hasPending={() => true} />);

    fireEvent.pointerDown(element(container), { bubbles: true });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('does not cancel through a nested child of an interactive element', () => {
    const cancel = vi.fn();
    const { container } = render(<Harness cancel={cancel} hasPending={() => true} />);

    const img = container.querySelector('img') as HTMLElement;
    fireEvent.pointerDown(img, { bubbles: true });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('does nothing when there is no pending interaction', () => {
    const cancel = vi.fn();
    const { container } = render(<Harness cancel={cancel} hasPending={() => false} />);

    fireEvent.pointerDown(ground(container), { bubbles: true });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('detaches its listeners on unmount', () => {
    const cancel = vi.fn();
    const { container, unmount } = render(
      <Harness cancel={cancel} hasPending={() => true} />,
    );
    const surface = container.querySelector('[data-world-surface]') as HTMLElement;

    unmount();
    // The surface is detached with the tree, so re-dispatch on the saved node:
    // a surviving listener would still fire.
    fireEvent.pointerDown(surface, { bubbles: true });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('keeps two mounted instances independent', () => {
    // The real app runs one instance in `InteractiveElements` and one in
    // `ArcadeRoom`; the room's is the only one with anything pending.
    const roomCancel = vi.fn();
    const idleCancel = vi.fn();

    function Two() {
      useCancelInteractionOnWorldClick(
        { cancel: idleCancel, hasPending: () => false },
        'arcade',
      );
      return <Harness cancel={roomCancel} hasPending={() => true} />;
    }

    const { container } = render(<Two />);
    fireEvent.pointerDown(ground(container), { bubbles: true });

    expect(roomCancel).toHaveBeenCalledTimes(1);
    expect(idleCancel).not.toHaveBeenCalled();
  });
});
