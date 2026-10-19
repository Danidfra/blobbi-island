/**
 * The local actor turns toward where it walks and turns back to the front
 * once it has arrived: the movement facing it hands the display follows the
 * heading while walking (real frames, real movement controller), and is gone
 * (the front) once the walk is over and settled. A walk interrupted by a new
 * destination keeps turning, never flicks to the front in between.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { TestApp } from '@/test/TestApp';
import { SETTLE_MS } from '@/hooks/useMovementFacing';
import { MovableBlobbi, type MovableBlobbiRef } from './MovableBlobbi';

vi.mock('./CurrentBlobbiDisplay', () => ({
  CurrentBlobbiDisplay: (props: Record<string, unknown>) => <div data-testid="blobbi-display" data-motion={String(props.motion)} data-movement-facing={String(props.movementFacing)} />,
}));
vi.mock('@/lib/interactive-elements-config', () => ({ calculateBlobbiZIndex: () => 20 }));

function Harness({ handle }: { handle: React.MutableRefObject<MovableBlobbiRef | null> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <TestApp>
      <div ref={containerRef} style={{ width: '400px', height: '300px' }}>
        <MovableBlobbi ref={handle} containerRef={containerRef} initialPosition={{ x: 50, y: 80 }} boundary={{ shape: 'rectangle', x: [0, 100], y: [60, 100] }} movementSpeed={2000} />
      </div>
    </TestApp>
  );
}

const display = (c: HTMLElement) => c.querySelector('[data-testid="blobbi-display"]') as HTMLElement;

afterEach(() => vi.useRealTimers());

describe('the actor\'s facing around a walk', () => {
  it('faces where it walks, then the front once it has arrived and settled', async () => {
    const handle: React.MutableRefObject<MovableBlobbiRef | null> = { current: null };
    const { container, findByTestId } = render(<Harness handle={handle} />);
    await findByTestId('blobbi-display');
    expect(display(container).dataset.movementFacing).toBe('undefined');

    act(() => void handle.current?.goTo({ x: 10, y: 80 }));
    await waitFor(() => expect(display(container).dataset.movementFacing).toBe('left'));
    expect(display(container).dataset.motion).toBe('walking');

    await waitFor(() => expect(display(container).dataset.motion).toBe('still'), { timeout: 8000 });
    // Arrived: the heading is kept for the grace, then it turns to the front
    await waitFor(() => expect(display(container).dataset.movementFacing).toBe('undefined'), { timeout: SETTLE_MS + 1000 });
    expect(display(container).dataset.motion).toBe('still');
  }, 10000);

  it('a new destination mid-walk turns it toward the new heading, never through the front; an interrupted walk settles to the front', async () => {
    const handle: React.MutableRefObject<MovableBlobbiRef | null> = { current: null };
    const { container, findByTestId } = render(<Harness handle={handle} />);
    await findByTestId('blobbi-display');

    act(() => void handle.current?.goTo({ x: 95, y: 80 }));
    await waitFor(() => expect(display(container).dataset.movementFacing).toBe('right'));
    act(() => void handle.current?.goTo({ x: 50, y: 62 }));
    // Up and a little left: the larger axis wins, and the front is never shown between the two
    await waitFor(() => expect(display(container).dataset.movementFacing).toBe('back'));
    act(() => void handle.current?.stop());
    expect(display(container).dataset.motion).toBe('still');
    await waitFor(() => expect(display(container).dataset.movementFacing).toBe('undefined'), { timeout: SETTLE_MS + 1000 });
  }, 10000);
});
