/**
 * Behavioural coverage for theater seating.
 *
 * The chair system this replaces was inert: clicking a chair walked the Blobbi
 * to a point and nothing else ever happened, because the arrival handler was
 * never called and all 28 chairs shared one id. These tests pin the contract
 * that replaces it — unique ids, arrival-gated sitting, a fixed z-index, and
 * decoration-only off-world seats.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { TheaterSeat } from './TheaterSeat';
import {
  THEATER_OCCUPIABLE_SEAT_COUNT,
  getTheaterSeat,
  occupiableTheaterSeats,
  type TheaterSeatConfig,
} from '@/lib/theater-seats-config';
import { resolveSeatedRender } from '@/lib/blobbi-world-render';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';

const SURFACE_RECT = {
  width: 1000, height: 1000, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 1000,
  toJSON: () => ({}),
} as DOMRect;

/** Seat rect used by every test: a chair sitting on the floor of the surface. */
const SEAT_RECT = {
  width: 107, height: 103, x: 40, y: 840, top: 840, left: 40, right: 147, bottom: 943,
  toJSON: () => ({}),
} as DOMRect;

interface Harness {
  requests: RequestInteractionOptions[];
  sits: string[];
  seat: HTMLElement | null;
  container: HTMLElement;
  rerenderWith: (sittingIn: string | null) => void;
}

function renderSeat(config: TheaterSeatConfig, initialSittingIn: string | null = null): Harness {
  const requests: RequestInteractionOptions[] = [];
  const sits: string[] = [];

  const ui = (sittingIn: string | null) => (
    <div data-world-surface>
      <TheaterSeat
        config={config}
        requestInteraction={(opts) => requests.push(opts)}
        sittingIn={sittingIn}
        onSit={(id) => sits.push(id)}
      />
    </div>
  );

  const { container, rerender } = render(ui(initialSittingIn));
  const surface = container.querySelector('[data-world-surface]') as HTMLElement;
  const seat = container.querySelector<HTMLElement>(`[data-seat-id="${config.id}"]`);
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(SURFACE_RECT);
  if (seat) vi.spyOn(seat, 'getBoundingClientRect').mockReturnValue(SEAT_RECT);

  return { requests, sits, seat, container, rerenderWith: (v) => rerender(ui(v)) };
}

afterEach(() => vi.restoreAllMocks());

const seatA1 = getTheaterSeat('theater-seat-a1')!;
const decorativeChair = getTheaterSeat('theater-seat-b1')!;

describe('TheaterSeat', () => {
  it('walks to the seat\'s configured cushion point, not its base', () => {
    const h = renderSeat(seatA1);
    fireEvent.click(h.seat!);

    expect(h.requests).toHaveLength(1);
    const { target } = h.requests[0];
    const expectedX = ((SEAT_RECT.left + SEAT_RECT.width * seatA1.interactionTarget.x) / SURFACE_RECT.width) * 100;
    const expectedY = ((SEAT_RECT.top + SEAT_RECT.height * seatA1.interactionTarget.y) / SURFACE_RECT.height) * 100;
    expect(target.x).toBeCloseTo(expectedX, 5);
    expect(target.y).toBeCloseTo(expectedY, 5);
  });

  it('clamps the walk target into the theater boundary', () => {
    // The theater floor starts at y=75; a cushion point above it must be pulled
    // down to a reachable spot rather than becoming a target that never arrives.
    const highSeat: TheaterSeatConfig = { ...seatA1, interactionTarget: { x: 0.5, y: 0.0 } };
    const h = renderSeat(highSeat);
    const seat = h.container.querySelector<HTMLElement>(`[data-seat-id="${highSeat.id}"]`)!;
    vi.spyOn(seat, 'getBoundingClientRect').mockReturnValue({
      ...SEAT_RECT, top: 100, y: 100, bottom: 203,
    } as DOMRect);

    fireEvent.click(seat);
    expect(h.requests[0].target.y).toBeGreaterThanOrEqual(75);
  });

  it('sits only after CONFIRMED ARRIVAL, never on click', () => {
    const h = renderSeat(seatA1);

    fireEvent.click(h.seat!);
    expect(h.sits).toEqual([]);

    act(() => h.requests[0].action());
    expect(h.sits).toEqual([seatA1.id]);
  });

  it('does not sit when the walk is cancelled before arrival', () => {
    const h = renderSeat(seatA1);
    fireEvent.click(h.seat!);
    act(() => h.requests[0].onCancel?.());
    expect(h.sits).toEqual([]);
  });

  it('ignores repeated clicks on the seat it is already in', () => {
    const h = renderSeat(seatA1);
    fireEvent.click(h.seat!);
    act(() => h.requests[0].action());
    act(() => h.rerenderWith(seatA1.id));

    fireEvent.click(h.seat!);
    fireEvent.click(h.seat!);

    expect(h.requests).toHaveLength(1);
    expect(h.sits).toEqual([seatA1.id]);
  });

  it('can be re-entered after the player stood up', () => {
    const h = renderSeat(seatA1, seatA1.id);
    act(() => h.rerenderWith(null));

    fireEvent.click(h.seat!);
    act(() => h.requests[0].action());
    expect(h.sits).toEqual([seatA1.id]);
  });

  it('keeps a fixed z-index through click, arrival and occupancy', () => {
    const h = renderSeat(seatA1);
    const z = () => h.seat!.style.zIndex;

    expect(z()).toBe(String(seatA1.zIndex));
    fireEvent.click(h.seat!);
    expect(z()).toBe(String(seatA1.zIndex));
    act(() => h.requests[0].action());
    act(() => h.rerenderWith(seatA1.id));
    expect(z()).toBe(String(seatA1.zIndex));
  });

  it('marks the occupied seat in the DOM', () => {
    const h = renderSeat(seatA1, seatA1.id);
    expect(h.seat).toHaveAttribute('data-seat-occupied', 'true');
  });

  it('is clickable while still blocking world movement', () => {
    const h = renderSeat(seatA1);
    expect(h.seat).toHaveAttribute('data-block-move');
  });

  it('renders a DECORATIVE chair as scenery that cannot be sat in', () => {
    const h = renderSeat(decorativeChair);
    expect(decorativeChair.occupiable).toBe(false);

    // No seat id, so nothing can target it...
    expect(h.seat).toBeNull();
    const decoration = h.container.querySelector('img')!;
    // ...and no pointer events at all, so it cannot even swallow a world click.
    expect(decoration.parentElement).toHaveClass('pointer-events-none');

    // Clicking and tapping it start no walk and produce no seating.
    fireEvent.click(decoration.parentElement!);
    fireEvent.touchStart(decoration.parentElement!);
    expect(h.requests).toEqual([]);
    expect(h.sits).toEqual([]);
  });

  it('never resolves a decorative chair into a seated render', () => {
    // Defence in depth: even if a decorative id reached the seated state (a
    // stale value, a hostile presence event), nothing may pin a Blobbi to it.
    expect(resolveSeatedRender(decorativeChair.id)).toBeNull();
    expect(resolveSeatedRender(seatA1.id)).not.toBeNull();
  });

  it('responds to a single tap on touch devices', () => {
    const h = renderSeat(seatA1);
    fireEvent.touchStart(h.seat!);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].touch).toBe(true);
  });

  it('exposes a distinct DOM id for every occupiable seat', () => {
    const ids = occupiableTheaterSeats.map((s) => s.id);
    expect(new Set(ids).size).toBe(THEATER_OCCUPIABLE_SEAT_COUNT);
  });
});
