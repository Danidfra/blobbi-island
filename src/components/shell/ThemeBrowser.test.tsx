/**
 * Discovery, selection and publication, driven through the picker with a fake
 * relay.
 *
 * No real event is ever published: the fake pool records what it was handed and
 * refuses nothing, so the tags below are the tags a relay would have received.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { TestApp } from '@/test/TestApp';
import { flushProviderInit } from '@/test/flushProviderInit';
import { ThemePicker } from '@/components/shell/ThemePicker';
import {
  ACTIVE_THEME_KIND,
  ISLAND_THEME_TAG,
  THEME_DEFINITION_KIND,
} from '@/lib/nostr-theme';
import { ISLAND_THEME_CACHE_KEY } from '@/lib/island-theme-cache';

const AUTHOR = 'a'.repeat(64);
const ME = 'f'.repeat(64);

/**
 * A signer that stamps rather than signs.
 *
 * Enough for `useNostrPublish`, which signs then hands the event to the pool —
 * and the pool here is the fake below, which records instead of publishing. No
 * key material and no relay is involved anywhere in this file.
 */
function fakeUser(pubkey: string) {
  return {
    pubkey,
    signer: {
      getPublicKey: async () => pubkey,
      signEvent: async (template: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
        ...template,
        id: 'e'.repeat(64),
        pubkey,
        sig: '0'.repeat(128),
      }),
    },
  } as unknown as { pubkey: string };
}

let currentUser: ReturnType<typeof fakeUser> | undefined;

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: currentUser, users: currentUser ? [currentUser] : [] }),
}));

/** Events the fake relay serves, and events the app tried to publish. */
let stored: NostrEvent[] = [];
let published: Array<Pick<NostrEvent, 'kind' | 'tags' | 'content'>> = [];
/** Set to make every read behave like an unreachable relay. */
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
        query: async (filters: NostrFilter[]) => {
          if (relayDown) return [];
          return stored.filter((e) => filters.some((f) => matches(e, f)));
        },
        /**
         * `req` is what `relay-read.ts` uses to tell a real empty from an
         * unusable read. Down = never EOSE, so those reads report `unknown`
         * instead of a fabricated empty.
         */
        req: async function* (filters: NostrFilter[]) {
          if (relayDown) {
            await new Promise(() => {});
            return;
          }
          for (const event of stored.filter((e) => filters.some((f) => matches(e, f)))) {
            yield ['EVENT', 'sub', event];
          }
          yield ['EOSE', 'sub'];
        },
        event: async (event: NostrEvent) => {
          published.push({ kind: event.kind, tags: event.tags, content: event.content });
        },
      },
    }),
  };
});

function themeEvent(
  overrides: Partial<NostrEvent> & { d: string; title: string; hexes?: [string, string, string] },
): NostrEvent {
  const [bg, text, primary] = overrides.hexes ?? ['#141a24', '#f2f5fa', '#5b8cff'];
  return {
    id: overrides.id ?? '0'.repeat(64),
    pubkey: overrides.pubkey ?? AUTHOR,
    created_at: overrides.created_at ?? 1_700_000_000,
    kind: THEME_DEFINITION_KIND,
    content: '',
    sig: '',
    tags: [
      ['d', overrides.d],
      ['c', bg, 'background'],
      ['c', text, 'text'],
      ['c', primary, 'primary'],
      ['title', overrides.title],
      ['alt', `Custom theme: ${overrides.title}`],
      ['t', 'theme'],
    ],
  } as NostrEvent;
}

function Harness() {
  const [open, setOpen] = useState(true);
  return <ThemePicker open={open} onOpenChange={setOpen} />;
}

async function renderPicker() {
  const result = render(
    <TestApp>
      <Harness />
    </TestApp>,
  );
  await flushProviderInit();
  return result;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-island-theme');
  document.documentElement.removeAttribute('style');
  stored = [];
  published = [];
  relayDown = false;
  currentUser = undefined;
  vi.useRealTimers();
});

describe('discovery', () => {
  it('lists themes published by other people', async () => {
    stored = [
      themeEvent({ d: 'harbour-dusk', title: 'Harbour Dusk', id: '1'.repeat(64) }),
      themeEvent({ d: 'sunbleach', title: 'Sunbleach', id: '2'.repeat(64), hexes: ['#fffaf0', '#2b2118', '#d2691e'] }),
    ];
    await renderPicker();

    const group = await screen.findByRole('radiogroup', { name: 'Community themes' });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    expect(within(group).getByRole('radio', { name: /Harbour Dusk/ })).toBeInTheDocument();
  });

  it('shows only the newest version of a replaced theme', async () => {
    stored = [
      themeEvent({ d: 'harbour-dusk', title: 'Harbour Dusk', id: '1'.repeat(64), created_at: 100 }),
      themeEvent({ d: 'harbour-dusk', title: 'Harbour Dusk v2', id: '2'.repeat(64), created_at: 200 }),
    ];
    await renderPicker();

    const group = await screen.findByRole('radiogroup', { name: 'Community themes' });
    expect(within(group).getAllByRole('radio')).toHaveLength(1);
    expect(within(group).getByRole('radio', { name: /Harbour Dusk v2/ })).toBeInTheDocument();
  });

  it('ignores malformed themes instead of emptying the list', async () => {
    stored = [
      themeEvent({ d: 'good', title: 'Good One', id: '1'.repeat(64) }),
      // No `title`, so not a usable theme.
      {
        ...themeEvent({ d: 'bad', title: 'x', id: '2'.repeat(64) }),
        tags: [['d', 'bad'], ['c', '#000000', 'background']],
      } as NostrEvent,
    ];
    await renderPicker();

    const group = await screen.findByRole('radiogroup', { name: 'Community themes' });
    expect(within(group).getAllByRole('radio')).toHaveLength(1);
  });

  it('offers a relay switch when nothing is found', async () => {
    await renderPicker();
    expect(await screen.findByText(/no themes found here yet/i)).toBeInTheDocument();
  });

  it('never hides the built-ins, whatever the relay does', async () => {
    relayDown = true;
    await renderPicker();
    const builtins = await screen.findByRole('radiogroup', { name: 'Built-in themes' });
    expect(within(builtins).getAllByRole('radio').length).toBeGreaterThanOrEqual(2);
  });
});

describe('selecting a community theme', () => {
  it('applies it, remembers it, and caches its palette', async () => {
    stored = [themeEvent({ d: 'harbour-dusk', title: 'Harbour Dusk', id: '1'.repeat(64) })];
    await renderPicker();

    const group = await screen.findByRole('radiogroup', { name: 'Community themes' });
    fireEvent.click(within(group).getByRole('radio', { name: /Harbour Dusk/ }));

    const expectedId = `nostr:${THEME_DEFINITION_KIND}:${AUTHOR}:harbour-dusk`;
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-island-theme')).toBe(expectedId);
    });

    // The selection is the app config; the palette is a separate, disposable
    // cache so the next boot paints before any relay is asked.
    expect(JSON.parse(localStorage.getItem('test-app-config')!).theme).toBe(expectedId);
    const cached = JSON.parse(localStorage.getItem(ISLAND_THEME_CACHE_KEY)!);
    expect(cached.id).toBe(expectedId);
    expect(cached.palette.ink).toMatch(/^-?[\d.]+ -?[\d.]+% -?[\d.]+%$/);
  });

  it('publishes the selection as a Ditto-readable kind:16767', async () => {
    vi.useFakeTimers();
    currentUser = fakeUser(ME);
    stored = [themeEvent({ d: 'harbour-dusk', title: 'Harbour Dusk', id: '1'.repeat(64) })];

    render(
      <TestApp>
        <Harness />
      </TestApp>,
    );
    await vi.advanceTimersByTimeAsync(50);

    const group = screen.getByRole('radiogroup', { name: 'Community themes' });
    fireEvent.click(within(group).getByRole('radio', { name: /Harbour Dusk/ }));

    // Debounced: flipping through themes must not publish six events.
    expect(published).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2500);

    const selection = published.find((e) => e.kind === ACTIVE_THEME_KIND)!;
    expect(selection).toBeDefined();
    // Everything Ditto reads is present and correct…
    expect(selection.tags).toContainEqual(['c', '#141a24', 'background']);
    expect(selection.tags).toContainEqual(['c', '#f2f5fa', 'text']);
    expect(selection.tags).toContainEqual(['c', '#5b8cff', 'primary']);
    expect(selection.tags).toContainEqual([
      'a',
      `${THEME_DEFINITION_KIND}:${AUTHOR}:harbour-dusk`,
    ]);
    // …and the ORIGINAL three colours are published, not a re-derivation of
    // Island's derivation of them.
    expect(selection.tags.filter(([n]) => n === 'c')).toHaveLength(3);
    vi.useRealTimers();
  });

  it('publishes a built-in selection with Island\'s own id', async () => {
    vi.useFakeTimers();
    currentUser = fakeUser(ME);

    render(
      <TestApp>
        <Harness />
      </TestApp>,
    );
    await vi.advanceTimersByTimeAsync(50);

    const builtins = screen.getByRole('radiogroup', { name: 'Built-in themes' });
    fireEvent.click(within(builtins).getByRole('radio', { name: /Lantern Night/ }));
    await vi.advanceTimersByTimeAsync(2500);

    const selection = published.find((e) => e.kind === ACTIVE_THEME_KIND)!;
    // A built-in has no address, so the `island-theme` tag is what identifies
    // it on the way back. Ditto ignores the tag and reads the colours.
    expect(selection.tags).toContainEqual([ISLAND_THEME_TAG, 'lantern-night']);
    expect(selection.tags.some(([n]) => n === 'a')).toBe(false);
    expect(selection.tags.filter(([n]) => n === 'c')).toHaveLength(3);
    vi.useRealTimers();
  });

  it('does not publish anything when signed out', async () => {
    vi.useFakeTimers();
    currentUser = undefined;

    render(
      <TestApp>
        <Harness />
      </TestApp>,
    );
    await vi.advanceTimersByTimeAsync(50);

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Built-in themes' })).getByRole('radio', {
        name: /Lantern Night/,
      }),
    );
    await vi.advanceTimersByTimeAsync(3000);

    expect(published).toEqual([]);
    // The choice still applies locally — signing in is not a requirement for
    // choosing how your island looks.
    expect(document.documentElement.getAttribute('data-island-theme')).toBe('lantern-night');
    vi.useRealTimers();
  });
});

describe('creating a theme', () => {
  it('publishes a kind:36767 event and applies it', async () => {
    currentUser = fakeUser(ME);
    await renderPicker();

    fireEvent.click(await screen.findByTestId('open-theme-create'));

    fireEvent.change(await screen.findByLabelText('Name'), {
      target: { value: 'Harbour Dusk' },
    });
    fireEvent.change(screen.getByLabelText('Background hex value'), {
      target: { value: '#141a24' },
    });
    fireEvent.change(screen.getByLabelText('Text hex value'), { target: { value: '#f2f5fa' } });
    fireEvent.change(screen.getByLabelText('Primary hex value'), { target: { value: '#5b8cff' } });

    fireEvent.click(screen.getByTestId('publish-theme'));

    await waitFor(() => {
      expect(published.some((e) => e.kind === THEME_DEFINITION_KIND)).toBe(true);
    });

    const definition = published.find((e) => e.kind === THEME_DEFINITION_KIND)!;
    expect(definition.content).toBe('');
    expect(definition.tags).toContainEqual(['d', 'harbour-dusk']);
    expect(definition.tags).toContainEqual(['title', 'Harbour Dusk']);
    expect(definition.tags).toContainEqual(['c', '#141a24', 'background']);
    expect(definition.tags).toContainEqual(['t', 'theme']);
    expect(definition.tags).toContainEqual(['alt', 'Custom theme: Harbour Dusk']);

    // Applied immediately — the player just designed this island.
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-island-theme')).toBe(
        `nostr:${THEME_DEFINITION_KIND}:${ME}:harbour-dusk`,
      );
    });
  });

  it('will not publish a theme with no usable identifier', async () => {
    currentUser = fakeUser(ME);
    await renderPicker();
    fireEvent.click(await screen.findByTestId('open-theme-create'));

    // A title of nothing but punctuation slugs to the empty string, and an
    // empty `d` is a different addressable event, not this theme.
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: '!!!' } });
    expect(screen.getByTestId('publish-theme')).toBeDisabled();
  });

  it('previews without repainting the app', async () => {
    currentUser = fakeUser(ME);
    await renderPicker();
    fireEvent.click(await screen.findByTestId('open-theme-create'));

    const before = document.documentElement.style.getPropertyValue('--island-page');
    fireEvent.change(screen.getByLabelText('Background hex value'), {
      target: { value: '#ff00ff' },
    });

    // The draft is scoped to its own container; only publishing applies it.
    const preview = await screen.findByTestId('theme-draft-preview');
    expect(preview.style.getPropertyValue('--island-page')).toBe('300 100% 50%');
    expect(document.documentElement.style.getPropertyValue('--island-page')).toBe(before);
  });

  it('is not offered when signed out', async () => {
    currentUser = undefined;
    await renderPicker();
    expect(await screen.findByTestId('open-theme-create')).toBeDisabled();
  });
});

describe('when the relay cannot be reached', () => {
  it('keeps the chosen theme rather than resetting it', async () => {
    const themeId = `nostr:${THEME_DEFINITION_KIND}:${AUTHOR}:harbour-dusk`;
    stored = [themeEvent({ d: 'harbour-dusk', title: 'Harbour Dusk', id: '1'.repeat(64) })];

    // Choose it while the relay is up…
    const first = await renderPicker();
    const group = await screen.findByRole('radiogroup', { name: 'Community themes' });
    fireEvent.click(within(group).getByRole('radio', { name: /Harbour Dusk/ }));
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-island-theme')).toBe(themeId);
    });
    const applied = document.documentElement.style.getPropertyValue('--island-page');
    first.unmount();

    // …then lose the relay entirely and come back.
    relayDown = true;
    document.documentElement.removeAttribute('data-island-theme');
    document.documentElement.removeAttribute('style');
    await renderPicker();

    // The island is still theirs, painted from the cache, and the stored choice
    // is untouched — a relay outage is not a change of mind.
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-island-theme')).toBe(themeId);
    });
    expect(document.documentElement.style.getPropertyValue('--island-page')).toBe(applied);
    expect(JSON.parse(localStorage.getItem('test-app-config')!).theme).toBe(themeId);
  });
});
