/**
 * Cross-device reconciliation, and the ways it must NOT fire.
 *
 * `IslandThemeSync` is the only thing in the app that changes the player's
 * theme without them asking, so the interesting cases here are all refusals: a
 * silent read, an unresolvable id, a relay that is simply down. Adopting when
 * it should not is a worse bug than never adopting at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { TestApp } from '@/test/TestApp';
import { IslandThemeSync } from '@/components/IslandThemeSync';
import {
  ACTIVE_THEME_KIND,
  ISLAND_THEME_TAG,
  THEME_DEFINITION_KIND,
} from '@/lib/nostr-theme';
import { ISLAND_THEME_CACHE_KEY } from '@/lib/island-theme-cache';
import { DITTO_ACTIVE_THEME_ID } from '@/lib/island-themes';

const ME = 'f'.repeat(64);
const AUTHOR = 'a'.repeat(64);
const CONFIG_KEY = 'test-app-config';

let currentUser: { pubkey: string } | undefined;

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: currentUser, users: currentUser ? [currentUser] : [] }),
}));

let stored: NostrEvent[] = [];
let relayDown = false;

function matches(event: NostrEvent, filter: NostrFilter): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  const dFilter = (filter as Record<string, unknown>)['#d'] as string[] | undefined;
  if (dFilter) {
    const d = event.tags.find(([n]) => n === 'd')?.[1];
    if (!d || !dFilter.includes(d)) return false;
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
          relayDown ? [] : stored.filter((e) => filters.some((f) => matches(e, f))),
        req: async function* (filters: NostrFilter[]) {
          if (relayDown) {
            // Never EOSE: `relay-read.ts` reports this as `unknown`, not empty.
            await new Promise(() => {});
            return;
          }
          for (const event of stored.filter((e) => filters.some((f) => matches(e, f)))) {
            yield ['EVENT', 'sub', event];
          }
          yield ['EOSE', 'sub'];
        },
        event: async () => {
          throw new Error('IslandThemeSync must never publish');
        },
      },
    }),
  };
});

function activeThemeEvent(tags: string[][]): NostrEvent {
  return {
    id: '1'.repeat(64),
    pubkey: ME,
    created_at: 1_700_000_000,
    kind: ACTIVE_THEME_KIND,
    content: '',
    sig: '',
    tags: [
      ['c', '#141a24', 'background'],
      ['c', '#f2f5fa', 'text'],
      ['c', '#5b8cff', 'primary'],
      ...tags,
    ],
  } as NostrEvent;
}

function themeDefinition(d: string, title: string, pubkey = AUTHOR): NostrEvent {
  return {
    id: '2'.repeat(64),
    pubkey,
    created_at: 1_700_000_000,
    kind: THEME_DEFINITION_KIND,
    content: '',
    sig: '',
    tags: [
      ['d', d],
      ['c', '#141a24', 'background'],
      ['c', '#f2f5fa', 'text'],
      ['c', '#5b8cff', 'primary'],
      ['title', title],
    ],
  } as NostrEvent;
}

function seedTheme(theme: string) {
  localStorage.setItem(
    CONFIG_KEY,
    JSON.stringify({ theme, relayUrl: 'wss://relay.nostr.band' }),
  );
}

function storedTheme(): string {
  return JSON.parse(localStorage.getItem(CONFIG_KEY)!).theme;
}

beforeEach(() => {
  localStorage.clear();
  stored = [];
  relayDown = false;
  currentUser = { pubkey: ME };
});

describe('adopting a selection made elsewhere', () => {
  it('adopts a built-in named by the active-theme event', async () => {
    seedTheme('cozy-day');
    stored = [activeThemeEvent([[ISLAND_THEME_TAG, 'lantern-night']])];

    render(
      <TestApp>
        <IslandThemeSync />
      </TestApp>,
    );

    await waitFor(() => expect(storedTheme()).toBe('lantern-night'));
  });

  it('adopts a community theme named by the `a` tag alone', async () => {
    // A selection published by Ditto has no `island-theme` tag; only the
    // address of the definition it came from. That is enough.
    seedTheme('cozy-day');
    stored = [
      activeThemeEvent([['a', `${THEME_DEFINITION_KIND}:${AUTHOR}:harbour-dusk`]]),
      themeDefinition('harbour-dusk', 'Harbour Dusk'),
    ];

    render(
      <TestApp>
        <IslandThemeSync />
      </TestApp>,
    );

    await waitFor(() =>
      expect(storedTheme()).toBe(`nostr:${THEME_DEFINITION_KIND}:${AUTHOR}:harbour-dusk`),
    );
  });

  it('does not fight the player after adopting once', async () => {
    seedTheme('cozy-day');
    stored = [activeThemeEvent([[ISLAND_THEME_TAG, 'lantern-night']])];

    const { rerender } = render(
      <TestApp>
        <IslandThemeSync />
      </TestApp>,
    );
    await waitFor(() => expect(storedTheme()).toBe('lantern-night'));

    // The player then picks something else on THIS device. A repeating adopt
    // would drag them back to the remote value on every render.
    seedTheme('cozy-day');
    rerender(
      <TestApp>
        <IslandThemeSync />
      </TestApp>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(storedTheme()).toBe('cozy-day');
  });
});

describe('refusing to adopt', () => {
  it('changes nothing when there is no active-theme event', async () => {
    seedTheme('lantern-night');
    render(
      <TestApp>
        <IslandThemeSync />
      </TestApp>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(storedTheme()).toBe('lantern-night');
  });

  it('changes nothing when the relay is unreachable', async () => {
    // The read reports `unknown`, not empty, so there is no false "you have no
    // active theme" to act on.
    relayDown = true;
    seedTheme('lantern-night');
    render(
      <TestApp>
        <IslandThemeSync />
      </TestApp>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(storedTheme()).toBe('lantern-night');
  });

  it('falls back to the colours when the NAME cannot be resolved', async () => {
    /*
      Corrected in the interop phase.

      This used to assert "do nothing", which was wrong twice over. An active
      theme event is SELF-CONTAINED; it carries the colours regardless of
      whether it also names a definition, so an id this build cannot resolve
      is a reason to ignore the NAME, not the event. Leaving the player on a
      theme their account is not using, while holding a perfectly applicable
      palette, was the shape of the Ditto → Island bug.
    */
    seedTheme('lantern-night');
    stored = [activeThemeEvent([[ISLAND_THEME_TAG, 'a-theme-from-2027']])];

    render(
      <TestApp>
        <IslandThemeSync />
      </TestApp>,
    );
    await waitFor(() => expect(storedTheme()).toBe(DITTO_ACTIVE_THEME_ID));
  });

  it('does nothing at all when signed out', async () => {
    currentUser = undefined;
    seedTheme('lantern-night');
    stored = [activeThemeEvent([[ISLAND_THEME_TAG, 'cozy-day']])];

    render(
      <TestApp>
        <IslandThemeSync />
      </TestApp>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(storedTheme()).toBe('lantern-night');
  });
});

describe('keeping the palette cache fresh', () => {
  it('rewrites the cache when the author edits their theme', async () => {
    const themeId = `nostr:${THEME_DEFINITION_KIND}:${AUTHOR}:harbour-dusk`;
    seedTheme(themeId);
    stored = [themeDefinition('harbour-dusk', 'Harbour Dusk')];

    render(
      <TestApp>
        <IslandThemeSync />
      </TestApp>,
    );

    await waitFor(() => {
      const cached = JSON.parse(localStorage.getItem(ISLAND_THEME_CACHE_KEY)!);
      expect(cached.id).toBe(themeId);
      expect(cached.name).toBe('Harbour Dusk');
    });
  });

  it('leaves an existing cache alone when the relay is down', async () => {
    const themeId = `nostr:${THEME_DEFINITION_KIND}:${AUTHOR}:harbour-dusk`;
    seedTheme(themeId);
    localStorage.setItem(
      ISLAND_THEME_CACHE_KEY,
      JSON.stringify({
        id: themeId,
        name: 'Harbour Dusk',
        description: '',
        palette: {
          page: '0 0% 10%', sky: '0 0% 20%', ocean: '0 0% 30%', focus: '0 0% 40%',
          grass: '0 0% 50%', 'grass-dark': '0 0% 60%', sand: '0 0% 70%', wood: '0 0% 80%',
          'wood-dark': '0 0% 90%', cream: '0 0% 15%', 'cream-2': '0 0% 25%',
          purple: '0 0% 35%', ink: '0 0% 95%', 'ink-soft': '0 0% 85%',
          danger: '0 0% 45%', warn: '0 0% 55%',
        },
      }),
    );
    relayDown = true;

    render(
      <TestApp>
        <IslandThemeSync />
      </TestApp>,
    );
    await new Promise((r) => setTimeout(r, 50));

    // Still the player's theme, still their colours.
    expect(JSON.parse(localStorage.getItem(ISLAND_THEME_CACHE_KEY)!).name).toBe('Harbour Dusk');
    expect(storedTheme()).toBe(themeId);
  });
});
