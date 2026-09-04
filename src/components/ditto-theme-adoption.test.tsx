/**
 * End to end, in one test file: an event a relay is holding becomes a styled
 * document.
 *
 * `cross-app-theme.test.ts` pins the resolution as pure functions; this pins the
 * wiring around it, the query, the sync, the config write, the palette, the
 * font and the wallpaper. It is the closest an automated test gets to the manual
 * cross-app checklist in `docs/themes.md`, and it is what would have caught the
 * original bug: every individual piece parsed correctly, and nothing happened.
 *
 * No real relay, no real signer, no published event.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { TestApp } from '@/test/TestApp';
import { IslandThemeSync } from '@/components/IslandThemeSync';
import { ACTIVE_THEME_KIND, hexToHslTriplet } from '@/lib/nostr-theme';
import { DITTO_SETTINGS_D, NIP78_KIND } from '@/lib/ditto-settings';
import { DITTO_ACTIVE_THEME_ID, resolveIslandTheme } from '@/lib/island-themes';
import { useTheme } from '@/hooks/useTheme';
import {
  FONT_BODY_VAR,
  FONT_DISPLAY_VAR,
  THEME_BG_IMAGE_VAR,
} from '@/lib/island-theme-media';

const ME = 'f'.repeat(64);
const CONFIG_KEY = 'test-app-config';
const FAKE = 'fake44:';

let currentUser: { pubkey: string } | undefined;
let stored: NostrEvent[] = [];

/**
 * A signer that can "decrypt" the fake blob, or one that cannot.
 *
 * The distinction is the whole point of two of these tests: the encrypted
 * settings channel needs NIP-44, and an account without it must still get its
 * theme from the public event.
 */
function userWithNip44(pubkey: string) {
  return {
    pubkey,
    signer: {
      getPublicKey: async () => pubkey,
      nip44: {
        encrypt: async (_pk: string, plaintext: string) => FAKE + plaintext,
        decrypt: async (_pk: string, ciphertext: string) => {
          if (!ciphertext.startsWith(FAKE)) throw new Error('not ours');
          return ciphertext.slice(FAKE.length);
        },
      },
    },
  } as unknown as { pubkey: string };
}

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: currentUser, users: currentUser ? [currentUser] : [] }),
}));

function matches(event: NostrEvent, filter: NostrFilter): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  const d = (filter as Record<string, unknown>)['#d'] as string[] | undefined;
  if (d) {
    const value = event.tags.find(([n]) => n === 'd')?.[1];
    if (!value || !d.includes(value)) return false;
  }
  return true;
}

vi.mock('@nostrify/react', async () => {
  const actual = await vi.importActual<typeof import('@nostrify/react')>('@nostrify/react');
  return {
    ...actual,
    useNostr: () => ({
      nostr: {
        query: async (filters: NostrFilter[]) =>
          stored.filter((e) => filters.some((f) => matches(e, f))),
        req: async function* (filters: NostrFilter[]) {
          for (const event of stored.filter((e) => filters.some((f) => matches(e, f)))) {
            yield ['EVENT', 'sub', event];
          }
          yield ['EOSE', 'sub'];
        },
        event: async () => {
          throw new Error('this test must not publish');
        },
      },
    }),
  };
});

/** Everything a themed Ditto account has on a relay. */
const DITTO_THEME = {
  title: 'Harbour Dusk',
  colors: {
    background: hexToHslTriplet('#141a24'),
    text: hexToHslTriplet('#f2f5fa'),
    primary: hexToHslTriplet('#5b8cff'),
  },
  /*
    NO URL: and that is the point.

    Ditto's `FontPicker.handleSelect` stores `{ family }` alone, because Ditto
    bundles its curated fonts and loads them with `import()`. A CDN link is
    attached only when a theme is PUBLISHED. So this is the exact shape a real
    Ditto account's encrypted settings carry, and the shape that used to leave
    Island silently rendering Comfortaa.
  */
  font: { family: 'Playfair Display' },
  titleFont: { family: 'Outfit' },
  background: { url: 'https://media.example/w.jpg', mode: 'cover' as const },
};

function dittoSettingsEvent(blob: Record<string, unknown>): NostrEvent {
  return {
    id: '7'.repeat(64),
    pubkey: ME,
    created_at: 1_700_000_000,
    kind: NIP78_KIND,
    content: FAKE + JSON.stringify(blob),
    sig: '',
    tags: [['d', DITTO_SETTINGS_D]],
  } as NostrEvent;
}

/** A self-contained 16767 exactly as Ditto publishes for a preset selection. */
function selfContainedActiveTheme(): NostrEvent {
  return {
    id: '8'.repeat(64),
    pubkey: ME,
    created_at: 1_700_000_000,
    kind: ACTIVE_THEME_KIND,
    content: '',
    sig: '',
    tags: [
      ['c', '#141a24', 'background'],
      ['c', '#f2f5fa', 'text'],
      ['c', '#5b8cff', 'primary'],
      ['f', 'Playfair Display', '', 'body'],
      ['bg', 'url https://media.example/w.jpg', 'mode cover'],
      ['alt', 'Active profile theme'],
      ['title', 'Harbour Dusk'],
    ],
  } as NostrEvent;
}

/** A button that selects a built-in, through the hook the picker uses. */
function BuiltinSwitch() {
  const { setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme(resolveIslandTheme('lantern-night'))}>
      Lantern Night
    </button>
  );
}

const root = () => document.documentElement;
const storedTheme = () => JSON.parse(localStorage.getItem(CONFIG_KEY)!).theme;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    CONFIG_KEY,
    JSON.stringify({ theme: 'cozy-day', relayUrl: 'wss://relay.nostr.band' }),
  );
  stored = [];
  currentUser = userWithNip44(ME);
  root().removeAttribute('style');
  root().removeAttribute('data-island-theme');
  root().removeAttribute('data-theme-background');
  document.getElementById('island-theme-font')?.remove();
  document.getElementById('island-theme-font-faces')?.remove();
});

describe('a Ditto account with a theme, opened in Island', () => {
  it('paints the palette, the font and the wallpaper from the settings blob', async () => {
    /*
      ONLY the encrypted settings; no 16767 at all.

      That is deliberate: this is the channel Ditto actually renders from, and
      Island read nothing from it before this phase. If the fallback were the
      thing making this pass, removing the public event would break it.
    */
    stored = [
      dittoSettingsEvent({
        theme: 'custom',
        customTheme: DITTO_THEME,
        feedSettings: { showReplies: false },
      }),
    ];

    render(
      <TestApp>
        <IslandThemeSync />
      </TestApp>,
    );

    // 1. The selection is adopted…
    await waitFor(() => expect(storedTheme()).toBe(DITTO_ACTIVE_THEME_ID));

    // 2. …the palette is derived from the author's three colours…
    await waitFor(() => {
      expect(root().getAttribute('data-island-theme')).toBe(DITTO_ACTIVE_THEME_ID);
    });
    expect(root().style.getPropertyValue('--island-page')).toBe(DITTO_THEME.colors.background);

    // 3. …the body font is declared, fetched from the file Ditto would have
    //    published, and pointed at by the variable every surface inherits…
    await waitFor(() => {
      expect(document.getElementById('island-theme-font')?.textContent).toContain(
        `${FONT_BODY_VAR}: "Playfair Display"`,
      );
    });
    const faces = document.getElementById('island-theme-font-faces')!.textContent!;
    expect(faces).toContain(
      'https://cdn.jsdelivr.net/fontsource/fonts/playfair-display:vf@latest/latin-wght-normal.woff2',
    );
    // A variable face needs its weight range or every bold label is synthetic.
    expect(faces).toContain('font-weight: 100 900');

    // 3b. …and the TITLE font drives the display variable, separately.
    expect(document.getElementById('island-theme-font')!.textContent).toContain(
      `${FONT_DISPLAY_VAR}: "Outfit"`,
    );
    expect(faces).toContain('outfit:vf');

    // 4. …and the wallpaper is applied to the page, not to the world.
    expect(root().style.getPropertyValue(THEME_BG_IMAGE_VAR)).toBe(
      'url("https://media.example/w.jpg")',
    );
    expect(root().getAttribute('data-theme-background')).toBe('cover');
  });

  it('adopts from the public event alone when the settings cannot be read', async () => {
    // A signer without NIP-44, so the settings channel is unavailable, and the
    // self-contained 16767 Ditto publishes is still a complete theme. This is
    // the event the previous implementation ignored entirely.
    currentUser = { pubkey: ME };
    stored = [selfContainedActiveTheme()];

    render(
      <TestApp>
        <IslandThemeSync />
      </TestApp>,
    );

    await waitFor(() => expect(storedTheme()).toBe(DITTO_ACTIVE_THEME_ID));
    await waitFor(() => {
      expect(root().style.getPropertyValue('--island-page')).toBe(DITTO_THEME.colors.background);
    });
  });

  it('leaves the island alone when Ditto is on a built-in mode', async () => {
    // `theme: 'dark'` with a leftover `customTheme` is a draft, not a selection.
    stored = [dittoSettingsEvent({ theme: 'dark', customTheme: DITTO_THEME })];

    render(
      <TestApp>
        <IslandThemeSync />
      </TestApp>,
    );

    await new Promise((r) => setTimeout(r, 60));
    expect(storedTheme()).toBe('cozy-day');
    expect(root().style.getPropertyValue(THEME_BG_IMAGE_VAR)).toBe('');
  });

  it('takes the wallpaper away again when the player picks a built-in', async () => {
    // Driven through the real setter rather than by poking localStorage: the
    // provider reads storage once, so a rerender would prove nothing.
    stored = [dittoSettingsEvent({ theme: 'custom', customTheme: DITTO_THEME })];

    render(
      <TestApp>
        <IslandThemeSync />
        <BuiltinSwitch />
      </TestApp>,
    );

    await waitFor(() => expect(root().style.getPropertyValue(THEME_BG_IMAGE_VAR)).not.toBe(''));
    expect(document.getElementById('island-theme-font')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Lantern Night' }));

    // A built-in carries no media, so switching to one must take the previous
    // theme's font and wallpaper with it rather than leaving them behind.
    await waitFor(() => {
      expect(root().style.getPropertyValue(THEME_BG_IMAGE_VAR)).toBe('');
      expect(root().hasAttribute('data-theme-background')).toBe(false);
      expect(document.getElementById('island-theme-font')).toBeNull();
    });
    expect(root().getAttribute('data-island-theme')).toBe('lantern-night');
  });
});
