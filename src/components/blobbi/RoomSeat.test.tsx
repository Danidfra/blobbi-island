/**
 * The bucket-seat foreground slice: a chair CONFIGURED with `foregroundFrom`
 * is repainted from that line down IN FRONT of its sitter, and only while it
 * has one. No shipped seat uses it any more: the Nostr Station chairs used
 * to, and the slice hid the sitter's lower body; the whole Blobbi must stay
 * visible, so they carry no cut. The capability stays tested on a synthetic
 * chair.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { RoomSeat } from './RoomSeat';
import { getRoomSeat, roomSeats, type RoomSeatConfig } from '@/lib/room-seats-config';

/** A deep bucket chair with a cut, for the slice mechanism alone. */
const BUCKET: RoomSeatConfig = { ...getRoomSeat('nostr-station-chair-3')!, id: 'test-bucket', foregroundFrom: 0.615 };

function renderSeat(seatId: string, sittingIn: string | null, override?: RoomSeatConfig) {
  const config = override ?? getRoomSeat(seatId)!;
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
  it('a chair configured with a cut paints its cushion lip and pedestal over the local sitter', () => {
    const { config, foreground, chair } = renderSeat('test-bucket', 'test-bucket', BUCKET);
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
    expect(renderSeat('test-bucket', null, BUCKET).foreground()).toBeNull();
  });

  it('is not painted for a DIFFERENT occupied chair', () => {
    expect(renderSeat('test-bucket', 'nostr-station-chair-4', BUCKET).foreground()).toBeNull();
  });

  it('a Nostr Station VR chair paints NOTHING over its sitter: the entire Blobbi stays visible', () => {
    for (const id of ['nostr-station-chair-1', 'nostr-station-chair-2', 'nostr-station-chair-3', 'nostr-station-chair-4']) {
      const { config, foreground, chair } = renderSeat(id, id);
      expect(config.foregroundFrom).toBeUndefined();
      expect(foreground()).toBeNull();
      // The chair itself still renders, whole, at its own depth, below the sitter.
      expect(chair().querySelector('img')!.getAttribute('src')).toBe(config.src);
      expect(Number(chair().style.zIndex)).toBe(config.zIndex);
      expect(config.seatedZIndex).toBeGreaterThan(config.zIndex);
    }
  });

  it('no shipped seat, in any room, has a foreground cut', () => {
    for (const seat of roomSeats) expect(seat.foregroundFrom, seat.id).toBeUndefined();
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
