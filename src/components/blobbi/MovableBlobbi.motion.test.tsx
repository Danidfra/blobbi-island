/**
 * The local actor tells the renderer when it walks (`motion="walking"`) and
 * lets the renderer animate the body: the Island float is suppressed while
 * moving, so no two body animations ever run at once. The gait itself is the
 * renderer's; nothing here knows what a leg is.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { TestApp } from '@/test/TestApp';
import { MovableBlobbi, type MovableBlobbiRef } from './MovableBlobbi';

const seen: Array<Record<string, unknown>> = [];
vi.mock('./CurrentBlobbiDisplay', () => ({
  CurrentBlobbiDisplay: (props: Record<string, unknown>) => {
    seen.push(props);
    return <div data-testid="blobbi-display" data-motion={String(props.motion)} />;
  },
}));
vi.mock('@/lib/interactive-elements-config', () => ({ calculateBlobbiZIndex: () => 20 }));

function Harness({ handle }: { handle: React.MutableRefObject<MovableBlobbiRef | null> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <TestApp>
      <div ref={containerRef} style={{ width: '400px', height: '300px' }}>
        <MovableBlobbi ref={handle} containerRef={containerRef} initialPosition={{ x: 50, y: 75 }} boundary={{ shape: 'rectangle', x: [0, 100], y: [60, 100] }} />
      </div>
    </TestApp>
  );
}

describe('MovableBlobbi and the renderer\'s motion', () => {
  it('stands still with the float on; walking hands "walking" to the renderer and turns the float off; arriving hands "still" back', async () => {
    const handle: React.MutableRefObject<MovableBlobbiRef | null> = { current: null };
    const { container, findByTestId } = render(<Harness handle={handle} />);
    const display = await findByTestId('blobbi-display');
    expect(display.dataset.motion).toBe('still');
    expect(container.querySelector('.animate-float')).not.toBeNull();

    act(() => {
      handle.current?.goTo({ x: 90, y: 90 });
    });
    await waitFor(() => expect((container.querySelector('[data-testid="blobbi-display"]') as HTMLElement).dataset.motion).toBe('walking'));
    expect(container.querySelector('.animate-float')).toBeNull();

    await waitFor(() => expect((container.querySelector('[data-testid="blobbi-display"]') as HTMLElement).dataset.motion).toBe('still'), { timeout: 8000 });
    expect(container.querySelector('.animate-float')).not.toBeNull();
    // Only the two words ever reach the renderer from here.
    expect(new Set(seen.map((p) => p.motion))).toEqual(new Set(['still', 'walking']));
  }, 10000);
});
