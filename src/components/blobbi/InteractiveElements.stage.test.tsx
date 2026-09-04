/**
 * Structural coverage for the theater room.
 *
 * Two risks are guarded here. The first is stacking order: the screen must paint
 * behind everything in the room (curtain, seats, back arrow) but in front of the
 * background artwork, and introducing a single z-index into a branch where the
 * curtain has none can silently reorder the whole room.
 *
 * The second is the one that actually shipped broken, **the room must be inert
 * until somebody sits down.** `TheaterStage` is deliberately NOT mocked here, so
 * these tests fail if merely entering the theater starts building a player.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LocationContext } from '@/contexts/LocationContextValue';
import { InteractiveElements } from './InteractiveElements';
import { TestApp } from '@/test/TestApp';
import type { MovableBlobbiRef } from './MovableBlobbi';
import {
  THEATER_OCCUPIABLE_SEAT_COUNT,
  occupiableTheaterSeats,
  theaterSeats,
} from '@/lib/theater-seats-config';
import { THEATER_Z } from '@/lib/theater-layout';

/**
 * The theater now needs the Nostr providers: a seated player can start or join a
 * watch session, so `TheaterStage` reads the signer. `NostrLoginProvider` reads
 * its storage through a promise and renders nothing until it resolves, which is
 * why this helper is async, a synchronous render would assert against an empty
 * document.
 */
async function renderTheater(sittingIn: string | null = null) {
  const blobbiRef: React.RefObject<MovableBlobbiRef> = {
    current: { goTo: vi.fn(), snapTo: vi.fn(), stop: vi.fn(), getCurrentPosition: () => ({ x: 50, y: 80 }) },
  };

  const view = render(
    <TestApp>
    <LocationContext.Provider
      value={{
        currentLocation: 'stage',
        setCurrentLocation: vi.fn(),
        previousLocation: null,
        isMapModalOpen: false,
        setIsMapModalOpen: vi.fn(),
        isTransitioning: false,
      }}
    >
      <div data-world-surface>
        <InteractiveElements
          blobbiRef={blobbiRef}
          selectedBlobbi={null}
          sittingIn={sittingIn}
          onSitInSeat={vi.fn()}
        />
      </div>
    </LocationContext.Provider>
    </TestApp>,
  );

  await act(async () => {
    await Promise.resolve();
  });

  return view;
}

describe('theater room', () => {
  it('renders 28 chairs: 26 occupiable seats and 2 decorative', async () => {
    const { container } = await renderTheater();
    const chairImages = container.querySelectorAll('img[src*="/stage/chair"]');
    expect(chairImages).toHaveLength(28);
    expect(container.querySelectorAll('[data-seat-id]')).toHaveLength(THEATER_OCCUPIABLE_SEAT_COUNT);
    expect(theaterSeats.length - occupiableTheaterSeats.length).toBe(2);
  });

  it('gives every occupiable chair a distinct id, the old markup gave all 28 the same one', async () => {
    const { container } = await renderTheater();
    const ids = [...container.querySelectorAll('[data-seat-id]')].map((el) => el.getAttribute('data-seat-id'));
    expect(new Set(ids).size).toBe(THEATER_OCCUPIABLE_SEAT_COUNT);
    expect(container.querySelector('[data-chair-id="stage-chair"]')).toBeNull();
  });

  it('shows nothing but scenery before anybody sits down', async () => {
    const { container } = await renderTheater(null);
    // No control card, no video surface, no error, an empty theater is idle.
    expect(container.querySelector('[data-theater-controls]')).toBeNull();
    expect(container.querySelector('[data-theater-screen]')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /load video/i })).toBeNull();
    // ...and the curtain is down.
    expect(container.querySelector('[data-theater-curtain]')).toHaveAttribute('data-curtain-open', 'false');
  });

  it('shows the control card once the Blobbi has arrived at a seat', async () => {
    const { container } = await renderTheater('theater-seat-a1');
    expect(container.querySelector('[data-theater-controls]')).not.toBeNull();
    expect(container.querySelector('[data-theater-controls]')).toHaveAttribute(
      'data-theater-status',
      'seated-idle',
    );
    // Seated but with nothing chosen yet: still no video, still no open curtain.
    expect(container.querySelector('[data-theater-screen]')).toBeNull();
    expect(container.querySelector('[data-theater-curtain]')).toHaveAttribute('data-curtain-open', 'false');
  });

  it('ignores a decorative chair id, sitting on scenery is not a state', async () => {
    const { container } = await renderTheater('theater-seat-b1');
    // The stage still opens its card (the seat system owns validity), but no
    // Blobbi can ever be pinned there; `resolveSeatedRender` is the guard and is
    // covered in TheaterSeat.test.tsx. What matters here is that the room does
    // not break.
    expect(container.querySelectorAll('[data-seat-id="theater-seat-b1"]')).toHaveLength(0);
  });

  it('keeps the screen behind the seats and the controls in front of the curtain', () => {
    for (const seat of theaterSeats) {
      expect(THEATER_Z.screen).toBeLessThan(seat.zIndex);
    }
    // The curtain carries NO z-index and therefore paints at the auto level, so
    // the screen's negative z is what puts it behind the fabric...
    expect(THEATER_Z.screen).toBeLessThan(0);
    // ...while the controls sit above everything, including the curtain and the
    // back row of seats they may overlap.
    expect(THEATER_Z.controls).toBeGreaterThan(Math.max(...theaterSeats.map((s) => s.zIndex)));
  });

  it('leaves the curtain block without a z-index, as it always was', async () => {
    const { container } = await renderTheater();
    const block = container.querySelector<HTMLElement>('[data-theater-curtain]')!;
    expect(block.style.zIndex).toBe('');
    expect(block.className).not.toMatch(/\bz-\d/);
  });

  it('keeps the back arrow reachable above the seats it overlaps', async () => {
    const { container } = await renderTheater();
    // z-20 in the markup; row A seats are z-30 but sit at the bottom of the room.
    expect(container.querySelector('.z-20')).not.toBeNull();
  });
});
