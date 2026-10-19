/**
 * World Navigation end to end, with World Travel off (the default build):
 * the dock opens the Worlds sheet; a door starts the goodbye and the page
 * goes to the checked address, in this tab, exactly once, only after the
 * Blobbi has dissolved; a second tap or another door starts nothing more;
 * Stay brings it back; the Blobbi the world shows is the same one before and
 * after; a world that is not open is never a link; a policy that keeps the
 * player inside shows every door closed and never navigates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { DOCK_EVENTS } from '@/components/shell/dock-events';
import { ExternalEgressProvider } from '@/external-egress';
import type { Blobbi } from '@/hooks/useBlobbis';
import { IslandSafetyProvider, type ExperienceProfile } from '@/safety';
import { TestApp } from '@/test/TestApp';

import { PRESENCE } from './useBlobbiPresence';
import { DEPARTURE } from './useWorldDeparture';
import { WorldTravelProvider } from './WorldTravelProvider';
import { setTravelMode } from './travel-mode';
import { useWorldTravelView } from './world-travel-context';
import { worldById } from './worlds';

const BLOBBI: Blobbi = {
  id: 'blobbi-0123456789ab-brook00001',
  stage: 'baby',
  generation: 1,
  hunger: 80,
  happiness: 80,
  health: 100,
  hygiene: 80,
  energy: 80,
  experience: 0,
  careStreak: 0,
  baseColor: '#f7b267',
  secondaryColor: '#f4845f',
  eyeColor: '#2b2d42',
  name: 'Brook',
};

/** What the world below sees: how its Blobbi is drawn, and which one. */
function World({ blobbi }: { blobbi: Blobbi | null }) {
  const view = useWorldTravelView();
  return (
    <div data-testid="world" data-presence={view.presence} data-departure={view.departure} data-here={String(view.blobbiHere)} data-blobbi={blobbi?.id ?? ''}>
      <button type="button" onClick={view.openWorlds}>
        open worlds
      </button>
    </div>
  );
}

/** The test app mounts its children once its login provider has read storage (an effect): let that run. */
async function mount(profile: ExperienceProfile = 'standard', blobbi: Blobbi | null = BLOBBI) {
  const r = render(
    <TestApp>
      <IslandSafetyProvider profile={profile}>
        <ExternalEgressProvider>
          <WorldTravelProvider blobbi={blobbi} pubkey={undefined}>
            <World blobbi={blobbi} />
          </WorldTravelProvider>
        </ExternalEgressProvider>
      </IslandSafetyProvider>
    </TestApp>,
  );
  await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
  return r;
}

const original = window.location;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  setTravelMode('off');
  assign = vi.fn();
  Object.defineProperty(window, 'location', { value: { ...original, assign }, writable: true, configurable: true });
  window.open = vi.fn() as unknown as typeof window.open;
});
afterEach(() => {
  Object.defineProperty(window, 'location', { value: original, writable: true, configurable: true });
  setTravelMode(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const tick = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const world = () => screen.getByTestId('world');
const GOODBYE = DEPARTURE.noticeMs + DEPARTURE.waveMs;

describe('travelling to another world from the Island', () => {
  it('the dock opens the Worlds sheet, with every open world a door and the rest closed', async () => {
    await mount();
    expect(screen.queryByTestId('worlds-list')).toBeNull();
    act(() => void document.dispatchEvent(new CustomEvent(DOCK_EVENTS.openWorlds)));
    expect(screen.getByTestId('worlds-list')).toBeInTheDocument();
    expect(screen.getByTestId('world-home').tagName).toBe('BUTTON');
    expect(screen.getByTestId('world-pixel').tagName).toBe('BUTTON');
    expect(screen.getByTestId('world-farm').tagName).toBe('BUTTON');
    expect(screen.getByTestId('world-rumble').tagName).toBe('DIV');
    expect(screen.getByTestId('world-rumble')).toHaveTextContent('Coming soon');
  });

  it('a door: the goodbye plays, the Blobbi dissolves, and only then this tab goes to the checked address, once', async () => {
    await mount();
    act(() => void document.dispatchEvent(new CustomEvent(DOCK_EVENTS.openWorlds)));
    fireEvent.click(screen.getByTestId('world-pixel'));
    // The sheet closes; the card says where it is off to
    expect(screen.queryByTestId('worlds-list')).toBeNull();
    expect(screen.getByTestId('departure-notice')).toHaveTextContent('Brook is off to Blobbi Pixel');
    expect(world().dataset.departure).toBe('noticing');
    expect(world().dataset.here).toBe('false');
    await tick(GOODBYE);
    expect(world().dataset.presence).toBe('departing');
    expect(assign).not.toHaveBeenCalled();
    await tick(PRESENCE.departMs);
    expect(world().dataset.presence).toBe('absent');
    await tick(0);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(worldById('pixel', {})!.url);
    expect(screen.getByTestId('departure-notice')).toHaveTextContent('Opening Blobbi Pixel');
    expect(window.open).not.toHaveBeenCalled();
    await tick(1_000);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('the Blobbi\'s identity travels with nothing attached: the same Blobbi shown here, the address alone over there', async () => {
    await mount();
    act(() => void document.dispatchEvent(new CustomEvent(DOCK_EVENTS.openWorlds)));
    fireEvent.click(screen.getByTestId('world-home'));
    await tick(GOODBYE + PRESENCE.departMs + 1);
    const url = new URL(assign.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://blobbi.pet/');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    // The world kept its Blobbi the whole way (its d, the identity every app reads)
    expect(world().dataset.blobbi).toBe(BLOBBI.id);
  });

  it('repeated taps and another door start nothing more; the doors are disabled meanwhile', async () => {
    await mount();
    act(() => void document.dispatchEvent(new CustomEvent(DOCK_EVENTS.openWorlds)));
    fireEvent.click(screen.getByTestId('world-pixel'));
    act(() => void document.dispatchEvent(new CustomEvent(DOCK_EVENTS.openWorlds)));
    const pixel = screen.getByTestId('world-pixel');
    expect(pixel).toBeDisabled();
    expect(screen.getByTestId('world-home')).toBeDisabled();
    fireEvent.click(pixel);
    fireEvent.click(screen.getByTestId('world-home'));
    await tick(GOODBYE + PRESENCE.departMs + 10);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(worldById('pixel', {})!.url);
  });

  it('Stay before the page goes: the Blobbi is simply here again, and nothing navigates', async () => {
    await mount();
    act(() => void document.dispatchEvent(new CustomEvent(DOCK_EVENTS.openWorlds)));
    fireEvent.click(screen.getByTestId('world-farm'));
    await tick(GOODBYE + 300);
    expect(world().dataset.presence).toBe('departing');
    fireEvent.click(screen.getByTestId('departure-stay'));
    expect(screen.queryByTestId('departure-notice')).toBeNull();
    expect(world().dataset.presence).toBe('present');
    expect(world().dataset.here).toBe('true');
    await tick(10_000);
    expect(assign).not.toHaveBeenCalled();
  });

  it('a family experience keeps the player inside: every door is closed and nothing navigates', async () => {
    await mount('family');
    act(() => void document.dispatchEvent(new CustomEvent(DOCK_EVENTS.openWorlds)));
    expect(screen.getByTestId('worlds-list')).toBeInTheDocument();
    for (const id of ['home', 'pixel', 'farm', 'rumble']) {
      expect(screen.getByTestId(`world-${id}`).tagName).toBe('DIV');
    }
    expect(screen.getByTestId('world-pixel')).toHaveTextContent('Not available');
    expect(screen.getByTestId('worlds-note')).toHaveTextContent('turned off');
    fireEvent.click(screen.getByTestId('world-pixel'));
    await tick(10_000);
    expect(assign).not.toHaveBeenCalled();
    expect(world().dataset.presence).toBe('present');
  });

  it('with no Blobbi in the world there is no sheet to open', async () => {
    await mount('standard', null);
    act(() => void document.dispatchEvent(new CustomEvent(DOCK_EVENTS.openWorlds)));
    expect(screen.queryByTestId('worlds-list')).toBeNull();
  });

  it('with World Travel off, no away card and no travel status: the Blobbi is simply here', async () => {
    await mount();
    expect(screen.queryByTestId('world-travel-status')).toBeNull();
    expect(screen.queryByTestId('world-travel-away')).toBeNull();
    expect(world().dataset.presence).toBe('present');
  });
});
