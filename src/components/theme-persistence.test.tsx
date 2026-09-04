/**
 * The theme a player chose is still there after a reload.
 *
 * `island-theme.test.tsx` pins the offline half, config in, palette out. This
 * pins the half that broke: what happens when that local answer meets the
 * ACCOUNT's answer, which arrives from a relay a moment later and is stale by
 * construction for as long as the publish debounce lasts.
 *
 * A "reload" here is `cleanup()` followed by a fresh `render()`: localStorage
 * survives, every provider, query cache and ref does not. That is the boundary
 * the bug lived on; it needed real bootstrap ordering to show itself, and no
 * amount of testing the resolver in isolation would have found it.
 *
 * No real relay, no real signer, no published event.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { TestApp } from '@/test/TestApp';
import { IslandThemeSync } from '@/components/IslandThemeSync';
import { useThemeSelection } from '@/hooks/useThemeSelection';
import { useCommunityThemes } from '@/hooks/useNostrThemes';
import { DEFAULT_ISLAND_THEME_ID, resolveIslandTheme } from '@/lib/island-themes';
import { ACTIVE_THEME_KIND, THEME_DEFINITION_KIND } from '@/lib/nostr-theme';
import type { AppConfig } from '@/contexts/AppContext';

const ME = 'f'.repeat(64);
const OTHER_ACCOUNT = 'e'.repeat(64);
const AUTHOR = 'a'.repeat(64);
const CONFIG_KEY = 'test-app-config';
const COMMUNITY_ID = `nostr:${THEME_DEFINITION_KIND}:${AUTHOR}:harbour-dusk`;

/**
 * A signer that stamps events without any key material.
 *
 * Enough for the publish path to complete, the point of those tests is that a
 * write is ATTEMPTED and not silently dropped, never what it is signed with.
 */
function fakeUser(pubkey: string) {
  return {
    pubkey,
    signer: {
      getPublicKey: async () => pubkey,
      signEvent: async (template: Record<string, unknown>) => ({
        ...template,
        id: `signed-${published.length}`,
        pubkey,
        sig: 'test-sig',
      }),
    },
  } as unknown as { pubkey: string };
}

let currentUser: { pubkey: string } | undefined;
let stored: NostrEvent[] = [];
let published: NostrEvent[] = [];
/** Set to fail every read, the way an unreachable relay does. */
let relayDown = false;

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
        query: async (filters: NostrFilter[]) => {
          if (relayDown) throw new Error('relay unreachable');
          return stored.filter((e) => filters.some((f) => matches(e, f)));
        },
        req: async function* (filters: NostrFilter[]) {
          if (relayDown) throw new Error('relay unreachable');
          for (const event of stored.filter((e) => filters.some((f) => matches(e, f)))) {
            yield ['EVENT', 'sub', event];
          }
          yield ['EOSE', 'sub'];
        },
        event: async (event: NostrEvent) => {
          published.push(event);
          stored = stored.filter((e) => e.kind !== event.kind || e.pubkey !== event.pubkey);
          stored.push(event);
        },
      },
    }),
  };
});

/** A kind:16767 saying "this account is using <islandThemeId>". */
function activeThemeEvent(islandThemeId: string, createdAt: number, pubkey = ME): NostrEvent {
  return {
    id: `active-${islandThemeId}-${createdAt}`,
    pubkey,
    created_at: createdAt,
    kind: ACTIVE_THEME_KIND,
    content: '',
    sig: '',
    tags: [
      ['c', '#fff8ec', 'background'],
      ['c', '#38271a', 'text'],
      ['c', '#7c4dff', 'primary'],
      ['alt', 'Active profile theme'],
      ['title', islandThemeId],
      ['island-theme', islandThemeId],
    ],
  } as NostrEvent;
}

/** A community theme definition sitting on the relay. */
function themeDefinitionEvent(): NostrEvent {
  return {
    id: '9'.repeat(64),
    pubkey: AUTHOR,
    created_at: 1_700_000_000,
    kind: THEME_DEFINITION_KIND,
    content: '',
    sig: '',
    tags: [
      ['d', 'harbour-dusk'],
      ['title', 'Harbour Dusk'],
      ['c', '#141a24', 'background'],
      ['c', '#f2f5fa', 'text'],
      ['c', '#5b8cff', 'primary'],
      ['alt', 'A theme'],
    ],
  } as NostrEvent;
}

/** The picker, reduced to what it does: choose, through the real hook. */
function Picker() {
  const { theme, themeId, selectTheme } = useThemeSelection();
  const community = useCommunityThemes();
  const first = community.data?.themes[0];
  return (
    <div>
      <span data-testid="resolved">{theme.id}</span>
      <span data-testid="stored">{themeId}</span>
      <span data-testid="community-count">{community.data?.themes.length ?? -1}</span>
      <button type="button" onClick={() => selectTheme(resolveIslandTheme('lantern-night'))}>
        Lantern Night
      </button>
      <button type="button" onClick={() => selectTheme(resolveIslandTheme(DEFAULT_ISLAND_THEME_ID))}>
        Cozy Day
      </button>
      <button type="button" disabled={!first} onClick={() => first && selectTheme(first)}>
        Community
      </button>
    </div>
  );
}

const Island = () => (
  <TestApp>
    <IslandThemeSync />
    <Picker />
  </TestApp>
);

const config = (): AppConfig => JSON.parse(localStorage.getItem(CONFIG_KEY)!);
const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

/** Boot the island and wait for reconciliation to have had its chance. */
async function boot() {
  render(<Island />);
  await settle();
}

/** Close the tab and open it again. localStorage survives; nothing else does. */
async function reload() {
  cleanup();
  await boot();
}

function seed(overrides: Partial<AppConfig> = {}) {
  localStorage.setItem(
    CONFIG_KEY,
    JSON.stringify({ theme: 'cozy-day', relayUrl: 'wss://relay.nostr.band', ...overrides }),
  );
}

const pick = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const shown = () => screen.getByTestId('resolved').textContent;

beforeEach(() => {
  localStorage.clear();
  seed();
  stored = [];
  published = [];
  relayDown = false;
  currentUser = fakeUser(ME);
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-island-theme');
});

describe('a theme survives a reload', () => {
  it('starts on the default when nothing has ever been chosen', async () => {
    localStorage.clear();
    await boot();
    expect(shown()).toBe(DEFAULT_ISLAND_THEME_ID);
  });

  it('applies the chosen theme immediately', async () => {
    await boot();
    pick(/lantern night/i);
    expect(shown()).toBe('lantern-night');
    expect(document.documentElement.getAttribute('data-island-theme')).toBe('lantern-night');
  });

  it('records the choice, with when and by whom', async () => {
    await boot();
    pick(/lantern night/i);

    expect(config().theme).toBe('lantern-night');
    expect(config().themeChosenAt).toBeGreaterThan(0);
    expect(config().themeChosenBy).toBe(ME);
  });

  it('is still there after a reload', async () => {
    await boot();
    pick(/lantern night/i);
    await reload();

    expect(config().theme).toBe('lantern-night');
    expect(shown()).toBe('lantern-night');
    expect(document.documentElement.getAttribute('data-island-theme')).toBe('lantern-night');
  });

  it('THE REGRESSION: the account\'s previous selection does not reclaim it', async () => {
    /*
      The relay holds what the player was on BEFORE, the default, for almost
      everybody, because that is where every account starts. The new choice is
      published after a two-second debounce, so for that window (and forever, if
      the player reloads inside it) the account is still advertising the old one.

      Reconciliation used to read that as "you chose the default elsewhere".
    */
    stored = [activeThemeEvent('cozy-day', 1_700_000_000)];
    await boot();

    pick(/lantern night/i);
    expect(shown()).toBe('lantern-night');

    await reload();
    expect(config().theme).toBe('lantern-night');
    expect(shown()).toBe('lantern-night');
  });

  it('does not reclaim it within the same session either', async () => {
    // The same bug without a reload: the sync effect re-runs on every change to
    // the selection, and used to re-answer a question it had already settled.
    stored = [activeThemeEvent('cozy-day', 1_700_000_000)];
    await boot();

    pick(/lantern night/i);
    await settle();

    expect(shown()).toBe('lantern-night');
    expect(config().theme).toBe('lantern-night');
  });

  it('survives several changes of mind', async () => {
    stored = [activeThemeEvent('cozy-day', 1_700_000_000)];
    await boot();

    pick(/lantern night/i);
    pick(/cozy day/i);
    pick(/lantern night/i);
    await settle();
    await reload();

    expect(config().theme).toBe('lantern-night');
  });
});

describe('a community theme survives a reload', () => {
  it('keeps rendering it while the relay still has the definition', async () => {
    stored = [themeDefinitionEvent()];
    await boot();
    await waitFor(() => expect(screen.getByTestId('community-count').textContent).toBe('1'));

    pick(/community/i);
    expect(shown()).toBe(COMMUNITY_ID);

    await reload();
    expect(config().theme).toBe(COMMUNITY_ID);
    expect(shown()).toBe(COMMUNITY_ID);
  });

  it('keeps rendering it from the palette cache when the relay is gone', async () => {
    // A relay outage is not a theme change. The id stays, and the cached
    // palette is what paints, the default must never stand in silently.
    stored = [themeDefinitionEvent()];
    await boot();
    await waitFor(() => expect(screen.getByTestId('community-count').textContent).toBe('1'));
    pick(/community/i);

    cleanup();
    relayDown = true;
    await boot();

    expect(config().theme).toBe(COMMUNITY_ID);
    expect(shown()).toBe(COMMUNITY_ID);
  });
});

describe('a read that failed is not a choice', () => {
  it('changes nothing when the relay is unreachable', async () => {
    await boot();
    pick(/lantern night/i);
    const chosenAt = config().themeChosenAt;

    cleanup();
    relayDown = true;
    await boot();

    expect(config().theme).toBe('lantern-night');
    expect(config().themeChosenAt).toBe(chosenAt);
    expect(shown()).toBe('lantern-night');
  });

  it('changes nothing when the account has no theme at all', async () => {
    // A confirmed absence, not a failure, and still not a reason to write.
    stored = [];
    await boot();
    pick(/lantern night/i);
    await reload();

    expect(config().theme).toBe('lantern-night');
  });

  it('never publishes from a boot', async () => {
    // Rendering a fallback must not mutate what the player chose, locally or on
    // a relay. Only an explicit selection writes.
    stored = [activeThemeEvent('cozy-day', 1_700_000_000)];
    await boot();
    await reload();

    expect(published).toEqual([]);
  });
});

describe('an account really does outrank this browser', () => {
  it('adopts a selection genuinely made later somewhere else', async () => {
    await boot();
    pick(/lantern night/i);
    await settle();

    // The player chose something else on another device, AFTER this.
    cleanup();
    const later = Math.floor(Date.now() / 1000) + 3600;
    stored = [activeThemeEvent('cozy-day', later)];
    await boot();

    expect(config().theme).toBe('cozy-day');
  });

  it('adopts the new account\'s theme when the player switches account', async () => {
    // Per-browser selection, per-account publication: signing in as somebody
    // else adopts THEIR theme even though it is older than what is on screen.
    await boot();
    pick(/lantern night/i);
    await settle();
    expect(config().themeChosenBy).toBe(ME);

    cleanup();
    currentUser = fakeUser(OTHER_ACCOUNT);
    stored = [activeThemeEvent('cozy-day', 1_600_000_000, OTHER_ACCOUNT)];
    await boot();

    expect(config().theme).toBe('cozy-day');
    expect(config().themeChosenBy).toBe(OTHER_ACCOUNT);
  });

  it('adopts for an account this browser has never reconciled with', async () => {
    // A config written before provenance existed: unknown yields to the
    // account, which is the behaviour that shipped before this fix.
    seed({ theme: 'lantern-night' });
    stored = [activeThemeEvent('cozy-day', 1_600_000_000)];
    await boot();

    expect(config().theme).toBe('cozy-day');
  });
});

describe('signed out', () => {
  it('keeps the choice with no account to reconcile against', async () => {
    currentUser = undefined;
    await boot();
    pick(/lantern night/i);
    await reload();

    expect(config().theme).toBe('lantern-night');
    expect(config().themeChosenBy).toBeUndefined();
  });
});

describe('the selection still travels to the account', () => {
  it('publishes it, and publishes it once', async () => {
    await boot();
    pick(/lantern night/i);
    await new Promise((resolve) => setTimeout(resolve, 2600));

    const active = published.filter((e) => e.kind === ACTIVE_THEME_KIND);
    expect(active).toHaveLength(1);
    expect(active[0].tags).toContainEqual(['island-theme', 'lantern-night']);
    expect(active[0].kind).toBe(16767);
  }, 15000);

  it('publishes a choice made moments before the picker closed', async () => {
    // The debounce must not be a way to lose the write: closing the picker
    // inside it used to cancel the publish outright, which is what kept the
    // account advertising the previous theme.
    await boot();
    pick(/lantern night/i);
    cleanup();
    await settle();

    const active = published.filter((e) => e.kind === ACTIVE_THEME_KIND);
    expect(active).toHaveLength(1);
    expect(active[0].tags).toContainEqual(['island-theme', 'lantern-night']);
  });
});
