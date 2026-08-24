import { describe, it, expect, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { flushProviderInit } from '@/test/flushProviderInit';

import { TestApp } from '@/test/TestApp';
import { ThemePicker } from '@/components/shell/ThemePicker';
import { islandThemes, DEFAULT_ISLAND_THEME_ID, resolveIslandTheme } from '@/lib/island-themes';

/**
 * The picker's behaviour, asserted through what a player (or a screen reader)
 * can actually perceive: which card is checked, and what happens to the
 * document when one is chosen.
 *
 * Scoped to the BUILT-IN section. The Nostr-backed sections are covered by
 * `nostr-themes.test.ts` (protocol + discovery) and are empty here anyway: the
 * test relay answers nothing.
 *
 * Nothing here asserts a colour value on a preview swatch. The previews are
 * built from the same tokens as the rest of the game and scoped with the
 * theme's own palette, so a test that pinned their computed colours would be
 * re-testing the token layer through jsdom's stylesheet handling and would
 * break on any visual refinement. `island-themes.test.ts` owns the palette
 * contract instead.
 */

function Harness() {
  const [open, setOpen] = useState(true);
  return <ThemePicker open={open} onOpenChange={setOpen} />;
}

async function renderPicker() {
  // NostrProvider renders nothing until its stored logins resolve, one
  // microtask after render(). Without this flush the picker is not in the
  // document yet and every query below misses.
  const result = render(
    <TestApp>
      <Harness />
    </TestApp>,
  );
  await flushProviderInit();
  return result;
}

describe('ThemePicker', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-island-theme');
    document.documentElement.removeAttribute('style');
  });

  it('offers one card per theme in the registry', async () => {
    await renderPicker();

    const group = screen.getByRole('radiogroup', { name: 'Built-in themes' });
    expect(within(group).getAllByRole('radio')).toHaveLength(islandThemes.length);

    for (const theme of islandThemes) {
      expect(within(group).getByRole('radio', { name: new RegExp(theme.name) })).toBeInTheDocument();
    }
  });

  it('marks exactly the active theme as checked', async () => {
    await renderPicker();

    const group = screen.getByRole('radiogroup', { name: 'Built-in themes' });
    const checked = within(group).getAllByRole('radio').filter(
      (el) => el.getAttribute('aria-checked') === 'true',
    );

    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAccessibleName(
      new RegExp(resolveIslandTheme(DEFAULT_ISLAND_THEME_ID).name),
    );
  });

  it('applies a theme on click and moves the checked state', async () => {
    await renderPicker();

    const group = screen.getByRole('radiogroup', { name: 'Built-in themes' });
    fireEvent.click(within(group).getByRole('radio', { name: /Lantern Night/ }));

    expect(document.documentElement.getAttribute('data-island-theme')).toBe('lantern-night');
    expect(within(group).getByRole('radio', { name: /Lantern Night/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(group).getByRole('radio', { name: /Cozy Day/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('is a dialog with an accessible name', async () => {
    await renderPicker();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Themes');
  });

  it('describes each theme so the choice is not colour-only', async () => {
    // A picker whose only differentiator is a swatch is unusable to anyone who
    // cannot compare the swatches. Name + description carry the choice.
    await renderPicker();

    for (const theme of islandThemes) {
      expect(
        screen.getByRole('radio', { name: new RegExp(theme.description.slice(0, 20)) }),
      ).toBeInTheDocument();
    }
  });
});
