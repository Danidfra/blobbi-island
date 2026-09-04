/**
 * Behavioural coverage for theater seating.
 *
 * The chair system this replaces was inert: clicking a chair walked the Blobbi
 * to a point and nothing else ever happened, because the arrival handler was
 * never called and all 28 chairs shared one id. These tests pin the contract
 * that replaces it, unique ids, arrival-gated sitting, a fixed z-index, and
 * decoration-only off-world seats.
 */
import { constrainPosition } from '@/lib/boundaries';
import { locationBoundaries } from '@/lib/location-boundaries';
import { boundaryYRange } from '@/lib/blobbi-world-render';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { TheaterSeat } from './TheaterSeat';
import {
  THEATER_OCCUPIABLE_SEAT_COUNT,
  getTheaterSeat,
  occupiableTheaterSeats,
  type TheaterSeatConfig,
  SEAT_APPROACH_TARGET,
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
  rerenderWith: (sittingIn: string | null, occupiedRemotely?: boolean) => void;
}

function renderSeat(
  config: TheaterSeatConfig,
  initialSittingIn: string | null = null,
  initialOccupiedRemotely = false,
): Harness {
  const requests: RequestInteractionOptions[] = [];
  const sits: string[] = [];

  const ui = (sittingIn: string | null, occupiedRemotely: boolean) => (
    <div data-world-surface>
      <TheaterSeat
        config={config}
        requestInteraction={(opts) => requests.push(opts)}
        sittingIn={sittingIn}
        occupiedRemotely={occupiedRemotely}
        onSit={(id) => sits.push(id)}
      />
    </div>
  );

  const { container, rerender } = render(ui(initialSittingIn, initialOccupiedRemotely));
  const surface = container.querySelector('[data-world-surface]') as HTMLElement;
  const seat = container.querySelector<HTMLElement>(`[data-seat-id="${config.id}"]`);
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(SURFACE_RECT);
  if (seat) vi.spyOn(seat, 'getBoundingClientRect').mockReturnValue(SEAT_RECT);

  return {
    requests,
    sits,
    seat,
    container,
    rerenderWith: (v, occupied = false) => rerender(ui(v, occupied)),
  };
}

afterEach(() => vi.restoreAllMocks());

const seatA1 = getTheaterSeat('theater-seat-a1')!;
const decorativeChair = getTheaterSeat('theater-seat-b1')!;

describe('TheaterSeat', () => {
  it('walks to the floor at the seat\'s front base, the APPROACH, never the cushion', () => {
    // GROUND semantics: the feet stop on the floor in front of the chair
    // (SEAT_APPROACH_TARGET, just below the sprite base, boundary-clamped);
    // the cushion fraction belongs to the seated POSE (seatAnchorPosition).
    const h = renderSeat(seatA1);
    fireEvent.click(h.seat!);

    expect(h.requests).toHaveLength(1);
    const { target } = h.requests[0];
    const rawX = ((SEAT_RECT.left + SEAT_RECT.width * SEAT_APPROACH_TARGET.x) / SURFACE_RECT.width) * 100;
    const rawY = ((SEAT_RECT.top + SEAT_RECT.height * SEAT_APPROACH_TARGET.y) / SURFACE_RECT.height) * 100;
    const expected = constrainPosition({ x: rawX, y: rawY }, locationBoundaries['stage-inside.png']);
    expect(target.x).toBeCloseTo(expected.x, 5);
    expect(target.y).toBeCloseTo(expected.y, 5);
    // And explicitly: NOT the cushion point.
    const cushionY = ((SEAT_RECT.top + SEAT_RECT.height * seatA1.interactionTarget.y) / SURFACE_RECT.height) * 100;
    expect(target.y).toBeGreaterThan(cushionY);
  });

  it('clamps the walk target into the theater boundary', () => {
    // A cushion point above the theater floor must be pulled down to a
    // reachable spot rather than becoming a target that never arrives. The
    // floor's top edge is the carpet strip along the stage lip.
    const { minY: floorTop } = boundaryYRange(locationBoundaries['stage-inside.png']);
    const highSeat: TheaterSeatConfig = { ...seatA1, interactionTarget: { x: 0.5, y: 0.0 } };
    const h = renderSeat(highSeat);
    const seat = h.container.querySelector<HTMLElement>(`[data-seat-id="${highSeat.id}"]`)!;
    vi.spyOn(seat, 'getBoundingClientRect').mockReturnValue({
      ...SEAT_RECT, top: 100, y: 100, bottom: 203,
    } as DOMRect);

    fireEvent.click(seat);
    expect(h.requests[0].target.y).toBeGreaterThanOrEqual(floorTop);
    expect(h.requests[0].target.y).toBeLessThan(75); // the strip in front of row C
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
    expect(h.seat).toHaveAttribute('data-seat-occupied-by', 'local');
  });

  it('looks occupied when a REMOTE player is sitting in it', () => {
    // Remote occupancy is derived from live presence (`theater-occupancy.ts`)
    // and keyed on the SAME canonical seat id the local state uses, so the room
    // has one notion of "taken" rather than a local one and a remote one.
    const h = renderSeat(seatA1, null, true);
    expect(h.seat).toHaveAttribute('data-seat-occupied', 'true');
    expect(h.seat).toHaveAttribute('data-seat-occupied-by', 'remote');
    // Nobody is hovering an empty chair: the invite-to-sit affordance is off.
    expect(h.seat!.className).not.toContain('hover:scale-105');
  });

  it('is free again once the remote occupant leaves or their presence expires', () => {
    const h = renderSeat(seatA1, null, true);
    act(() => h.rerenderWith(null, false));

    expect(h.seat).not.toHaveAttribute('data-seat-occupied');
    expect(h.seat!.className).toContain('hover:scale-105');
  });

  it('still accepts a click on a remotely occupied seat', () => {
    // Presence is advisory and self-expiring: refusing the click would let a
    // player who closed their laptop lock a chair for the whole expiry window.
    // A genuine double-claim is settled by the occupancy policy instead.
    const h = renderSeat(seatA1, null, true);
    fireEvent.click(h.seat!);
    expect(h.requests).toHaveLength(1);
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
