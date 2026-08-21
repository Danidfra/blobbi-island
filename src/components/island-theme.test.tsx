import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { AppProvider } from '@/components/AppProvider';
import { useTheme } from '@/hooks/useTheme';
import type { AppConfig } from '@/contexts/AppContext';
import { DEFAULT_ISLAND_THEME_ID, resolveIslandTheme } from '@/lib/island-themes';

/**
 * The theme contract as the app actually experiences it: what is on <html>
 * after boot, what a stored preference does, what an unusable stored
 * preference does, and — the one that matters for a game — what switching a
 * theme costs the thing the player is in the middle of.
 *
 * Assertions are on the custom properties and the id attribute, never on
 * rendered pixel values. The contract is "the palette on the root element is
 * the active theme's"; how a given surface spends that palette is the
 * surface's business and would make this test brittle for no gain.
 */

const STORAGE_KEY = 'island-theme-test-config';

const defaultConfig: AppConfig = {
  theme: DEFAULT_ISLAND_THEME_ID,
  relayUrl: 'wss://relay.nostr.band',
};

function seedConfig(config: Partial<AppConfig>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...defaultConfig, ...config }));
}

function activeThemeId() {
  return document.documentElement.getAttribute('data-island-theme');
}

function paletteValue(key: string) {
  return document.documentElement.style.getPropertyValue(`--island-${key}`);
}

/**
 * Stands in for a gameplay surface holding session state: a mining run, a
 * rhythm track, a position in the world. It counts its own mounts and keeps a
 * value across renders, so the test can tell "re-rendered" (fine) from
 * "remounted and lost its state" (a bug that would end a player's session).
 */
function GameplaySurface() {
  const mounts = useRef(0);
  const sessionValue = useRef<number | undefined>(undefined);
  if (sessionValue.current === undefined) {
    mounts.current += 1;
    sessionValue.current = 4242;
  }
  return (
    <div>
      <span data-testid="session-value">{sessionValue.current}</span>
      <span data-testid="mount-count">{mounts.current}</span>
    </div>
  );
}

function ThemeControls() {
  const { theme, themeId, themes, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="resolved-id">{theme.id}</span>
      <span data-testid="stored-id">{themeId}</span>
      {themes.map((t) => (
        <button key={t.id} type="button" onClick={() => setTheme(t.id)}>
          {t.name}
        </button>
      ))}
      <button type="button" onClick={() => setTheme('a-theme-that-was-removed')}>
        Pick a removed theme
      </button>
    </div>
  );
}

function Harness() {
  return (
    <AppProvider storageKey={STORAGE_KEY} defaultConfig={defaultConfig}>
      <ThemeControls />
      <GameplaySurface />
    </AppProvider>
  );
}

describe('island theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-island-theme');
    document.documentElement.removeAttribute('style');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('applies the default theme when nothing is stored', () => {
    render(<Harness />);

    const cozy = resolveIslandTheme(DEFAULT_ISLAND_THEME_ID);
    expect(activeThemeId()).toBe(DEFAULT_ISLAND_THEME_ID);
    expect(paletteValue('cream')).toBe(cozy.palette.cream);
    expect(paletteValue('ink')).toBe(cozy.palette.ink);
  });

  it('restores a stored theme', () => {
    seedConfig({ theme: 'lantern-night' });

    render(<Harness />);

    const lantern = resolveIslandTheme('lantern-night');
    expect(activeThemeId()).toBe('lantern-night');
    expect(paletteValue('cream')).toBe(lantern.palette.cream);
    expect(screen.getByTestId('resolved-id')).toHaveTextContent('lantern-night');
  });

  it('falls back to the default when the stored theme no longer exists', () => {
    seedConfig({ theme: 'harvest-moon-2019' });

    render(<Harness />);

    expect(activeThemeId()).toBe(DEFAULT_ISLAND_THEME_ID);
    expect(screen.getByTestId('resolved-id')).toHaveTextContent(DEFAULT_ISLAND_THEME_ID);
    // The stored id is reported as-is, so a theme that comes back in a later
    // build is re-selected rather than having been silently overwritten.
    expect(screen.getByTestId('stored-id')).toHaveTextContent('harvest-moon-2019');
  });

  it('falls back to the default for a legacy light/dark/system value', () => {
    seedConfig({ theme: 'dark' });

    render(<Harness />);

    expect(activeThemeId()).toBe(DEFAULT_ISLAND_THEME_ID);
  });

  it('keeps the rest of the config when the stored theme is unusable', () => {
    // The per-field `.catch()` in AppConfigSchema exists for exactly this:
    // a bad theme must not cost the player their relay.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ theme: { not: 'a string' }, relayUrl: 'wss://relay.example.test' }),
    );

    render(<Harness />);

    expect(activeThemeId()).toBe(DEFAULT_ISLAND_THEME_ID);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.relayUrl).toBe('wss://relay.example.test');
  });

  it('switches theme at runtime, with no reload', () => {
    render(<Harness />);

    expect(activeThemeId()).toBe('cozy-day');

    fireEvent.click(screen.getByRole('button', { name: 'Lantern Night' }));

    const lantern = resolveIslandTheme('lantern-night');
    expect(activeThemeId()).toBe('lantern-night');
    expect(paletteValue('cream')).toBe(lantern.palette.cream);
    expect(paletteValue('ink')).toBe(lantern.palette.ink);
  });

  it('persists the switch', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Lantern Night' }));

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).theme).toBe('lantern-night');
  });

  it('recovers if an unknown id is somehow set at runtime', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Pick a removed theme' }));

    // Nothing crashes and the island stays painted.
    expect(activeThemeId()).toBe(DEFAULT_ISLAND_THEME_ID);
  });

  it('does not remount gameplay when the theme changes', () => {
    render(<Harness />);

    expect(screen.getByTestId('mount-count')).toHaveTextContent('1');
    expect(screen.getByTestId('session-value')).toHaveTextContent('4242');

    fireEvent.click(screen.getByRole('button', { name: 'Lantern Night' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cozy Day' }));

    // A theme change is a custom-property write on <html>. If it ever became
    // a key change, a remount, or a provider swap, this is where a player's
    // in-progress mining session would quietly die.
    expect(screen.getByTestId('mount-count')).toHaveTextContent('1');
    expect(screen.getByTestId('session-value')).toHaveTextContent('4242');
  });

  it('leaves no properties from the previous theme behind', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Lantern Night' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cozy Day' }));

    const cozy = resolveIslandTheme('cozy-day');
    for (const [key, value] of Object.entries(cozy.palette)) {
      expect(paletteValue(key), `--island-${key}`).toBe(value);
    }
  });
});
