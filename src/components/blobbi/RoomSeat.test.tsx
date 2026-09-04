/**
 * The bucket-seat foreground slice: a deep chair is repainted from its
 * cushion lip down IN FRONT of its sitter, and only while it has one.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { RoomSeat } from './RoomSeat';
import { getRoomSeat } from '@/lib/room-seats-config';

function renderSeat(seatId: string, sittingIn: string | null) {
  const config = getRoomSeat(seatId)!;
  const view = render(
    <MovementBlockerProvider>
      <RoomSeat config={config} requestInteraction={vi.fn()} sittingIn={sittingIn} />
    </MovementBlockerProvider>,
  );
  const foreground = () => view.container.querySelector(`[data-seat-foreground="${seatId}"]`) as HTMLElement | null;
  const chair = () => view.container.querySelector(`[data-seat-id="${seatId}"]`) as HTMLElement;
  return { view, config, foreground, chair };
}

describe('RoomSeat foreground slice', () => {
  it('a Nostr Station chair paints its cushion lip and pedestal over the local sitter', () => {
    const { config, foreground, chair } = renderSeat('nostr-station-chair-3', 'nostr-station-chair-3');
    const slice = foreground();
    expect(slice).not.toBeNull();
    // Same sprite, same box, clipped to everything below the lip.
    expect(slice!.getAttribute('src')).toBe(config.src);
    expect(slice!.style.left).toBe(chair().style.left);
    expect(slice!.style.bottom).toBe(chair().style.bottom);
    expect(slice!.style.width).toBe(chair().style.width);
    expect(slice!.style.clipPath).toBe(`inset(${(config.foregroundFrom! * 100).toFixed(2)}% 0 0 0)`);
    // Over the seated Blobbi (seatedZIndex), which is over the chair itself.
    expect(Number(slice!.style.zIndex)).toBe(config.seatedZIndex + 1);
    expect(Number(chair().style.zIndex)).toBe(config.zIndex);
    // Scenery: never a click target, never announced.
    expect(slice!.getAttribute('aria-hidden')).toBe('true');
  });

  it('is not painted while the chair is empty (a standing Blobbi at the front edge stays in front)', () => {
    expect(renderSeat('nostr-station-chair-3', null).foreground()).toBeNull();
  });

  it('is not painted for a DIFFERENT occupied chair', () => {
    expect(renderSeat('nostr-station-chair-3', 'nostr-station-chair-4').foreground()).toBeNull();
  });

  it('a chair without a foreground cut (the terrace) never paints one, occupied or not', () => {
    const id = 'mall-terrace-1-left-chair';
    expect(getRoomSeat(id)!.foregroundFrom).toBeUndefined();
    expect(renderSeat(id, id).foreground()).toBeNull();
  });
});

describe('RoomSeat while already seated', () => {
  it('a click on the occupied chair re-fires the seated action without a walk or a second arrival', () => {
    const config = getRoomSeat('nostr-station-chair-1')!;
    const requestInteraction = vi.fn();
    const onSit = vi.fn();
    const onArrive = vi.fn();
    const onSeatedClick = vi.fn();
    const view = render(
      <MovementBlockerProvider>
        <RoomSeat
          config={config}
          requestInteraction={requestInteraction}
          sittingIn={config.id}
          onSit={onSit}
          onArrive={onArrive}
          onSeatedClick={onSeatedClick}
        />
      </MovementBlockerProvider>,
    );
    const chair = view.container.querySelector(`[data-seat-id="${config.id}"]`) as HTMLElement;
    fireEvent.click(chair);
    expect(onSeatedClick).toHaveBeenCalledTimes(1);
    expect(requestInteraction).not.toHaveBeenCalled();
    expect(onSit).not.toHaveBeenCalled();
    expect(onArrive).not.toHaveBeenCalled();
  });

  it('a click on the occupied chair with no seated action does nothing', () => {
    const config = getRoomSeat('nostr-station-chair-1')!;
    const requestInteraction = vi.fn();
    const view = render(
      <MovementBlockerProvider>
        <RoomSeat config={config} requestInteraction={requestInteraction} sittingIn={config.id} />
      </MovementBlockerProvider>,
    );
    fireEvent.click(view.container.querySelector(`[data-seat-id="${config.id}"]`) as HTMLElement);
    expect(requestInteraction).not.toHaveBeenCalled();
  });
});
