/**
 * The relay gate, proven at the writer.
 *
 * `RelaySelector` returning `null` under Family is presentation. The claim these
 * tests make is stronger and is the one that matters: calling `updateConfig`
 * directly: which is what all three mounts of the selector do, and what any
 * future fourth mount would do, cannot change the relay when the capability is
 * absent.
 *
 * A relay change is the quiet way around every other restriction: a different
 * relay is a different population of strangers and a different moderation
 * regime, so this gate has to hold below the UI.
 */
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { AppProvider } from '@/components/AppProvider';
import { useAppContext } from '@/hooks/useAppContext';
import { IslandSafetyProvider, type ExperienceProfile } from '@/safety';
import { DEFAULT_ISLAND_THEME_ID } from '@/lib/island-themes';

const START = 'wss://relay.ditto.pub';
const ELSEWHERE = 'wss://relay.somewhere-else.example';

let update: ((updater: (c: { theme: string; relayUrl: string }) => { theme: string; relayUrl: string }) => void) | null =
  null;

function Probe() {
  const { config, updateConfig } = useAppContext();
  update = updateConfig as typeof update;
  return (
    <>
      <span data-testid="relay">{config.relayUrl}</span>
      <span data-testid="theme">{config.theme}</span>
    </>
  );
}

function mount(profile: ExperienceProfile) {
  localStorage.clear();
  return render(
    <IslandSafetyProvider profile={profile}>
      <AppProvider
        storageKey={`relay-gate-${profile}-${Math.random()}`}
        defaultConfig={{ theme: DEFAULT_ISLAND_THEME_ID, relayUrl: START }}
      >
        <Probe />
      </AppProvider>
    </IslandSafetyProvider>,
  );
}

describe('Standard', () => {
  it('changes the relay', () => {
    mount('standard');
    act(() => update?.((current) => ({ ...current, relayUrl: ELSEWHERE })));

    expect(screen.getByTestId('relay').textContent).toBe(ELSEWHERE);
  });
});

describe('Family', () => {
  it('refuses a relay change made through the writer itself', () => {
    // Not "the picker is hidden": the underlying callback is invoked directly,
    // exactly as any mount of RelaySelector would.
    mount('family');
    act(() => update?.((current) => ({ ...current, relayUrl: ELSEWHERE })));

    expect(screen.getByTestId('relay').textContent).toBe(START);
  });

  it('still applies the rest of an update that also touched the relay', () => {
    // A refused relay change is dropped, not thrown: a caller changing the theme
    // and the relay together keeps the theme.
    mount('family');
    act(() =>
      update?.((current) => ({ ...current, theme: 'blobbi-night', relayUrl: ELSEWHERE })),
    );

    expect(screen.getByTestId('theme').textContent).toBe('blobbi-night');
    expect(screen.getByTestId('relay').textContent).toBe(START);
  });

  it('leaves changes that do not touch the relay completely alone', () => {
    mount('family');
    act(() => update?.((current) => ({ ...current, theme: 'blobbi-night' })));

    expect(screen.getByTestId('theme').textContent).toBe('blobbi-night');
  });
});
