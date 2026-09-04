/**
 * The shared catalogue's presentation contracts.
 *
 * `ArcadeRoom.test.tsx` covers which machine opens what. This file covers what
 * the cabinet catalogue is allowed to SAY and OFFER, and the first rule is the
 * one that was got wrong:
 *
 *  - it shows the games GENERIC cabinets offer, which today is none;
 *  - it never shows Blobbi Dance, which belongs to a machine two floors down;
 *  - it is attractive and intentional while empty, with no placeholder cards;
 *  - a coming-soon or guest entry is never pressable;
 *  - the ticket badge promises a possibility, not an outcome;
 *  - nothing states a reward amount.
 *
 * The fixtures include a hypothetical shared-cabinet game, because the card
 * layout has to be right before the first one exists.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { ArcadeCatalogue } from './ArcadeCatalogue';
import {
  ARCADE_CATALOGUE,
  BLOBBI_DANCE_GAME_ID,
  type ArcadeCatalogueEntry,
} from '@/arcade/catalogue';

/** A game a generic cabinet could offer. Nothing like it ships yet. */
const CABINET_GAME: ArcadeCatalogueEntry = {
  id: 'cabinet-game',
  title: 'Blobbi Blocks',
  shortDescription: 'Stack the falling blocks and clear a line before they reach the top.',
  category: 'island',
  availability: 'playable',
  launchMode: 'native',
  grantsTickets: true,
  controls: [{ scheme: 'keyboard', label: 'Arrow keys' }],
  estimatedDurationMs: 120_000,
  source: 'blobbi-internal',
  host: 'shared-cabinet',
};

const COMING_SOON_CABINET_GAME: ArcadeCatalogueEntry = {
  ...CABINET_GAME,
  id: 'cabinet-game-soon',
  title: 'Blobbi Bowling',
  availability: 'coming-soon',
  grantsTickets: false,
};

/** The worst case: a guest game whose record claims to be a native island game. */
const LYING_GUEST_ENTRY: ArcadeCatalogueEntry = {
  ...CABINET_GAME,
  id: 'guest-liar',
  title: 'A Lying Guest Game',
  category: 'guest',
  launchMode: 'native',
  availability: 'playable',
  grantsTickets: true,
};

function renderCatalogue(
  entries: readonly ArcadeCatalogueEntry[] = ARCADE_CATALOGUE,
  launchError: string | null = null,
) {
  const onSelect = vi.fn();
  const utils = render(
    <ArcadeCatalogue
      machineName="Pink Cabinet"
      machineImage="/assets/locations/arcade/level-1/arcade-machine-pink.png"
      entries={entries}
      onSelect={onSelect}
      launchError={launchError}
    />,
  );
  return { ...utils, onSelect };
}

const card = (id: string) =>
  document.querySelector(`[data-catalogue-card="${id}"]`) as HTMLElement | null;

describe('the shipped, empty state', () => {
  it('shows an intentional prepared panel, not an empty grid', () => {
    renderCatalogue();

    expect(screen.getByRole('heading', { name: 'Arcade Games' })).toBeInTheDocument();
    expect(screen.getByText(/new games are being prepared for these cabinets/i)).toBeInTheDocument();
    expect(document.querySelector('[data-arcade-catalogue]')).toHaveAttribute(
      'data-catalogue-games',
      '0',
    );
    // No cards, real or placeholder, and no lonely "0 games" grid.
    expect(document.querySelector('[data-catalogue-card]')).toBeNull();
    expect(document.querySelectorAll('ul')).not.toHaveLength(0); // the two notes are a list
  });

  it('never lists Blobbi Dance, which belongs to the dance machine', () => {
    renderCatalogue();
    expect(document.body.textContent).not.toMatch(/blobbi dance/i);
    expect(card(BLOBBI_DANCE_GAME_ID)).toBeNull();
    expect(screen.queryByRole('button', { name: /^play /i })).toBeNull();
  });

  it('names the cabinet the player is standing at', () => {
    renderCatalogue();
    expect(screen.getByText(/the pink cabinet will be ready for you/i)).toBeInTheDocument();
  });

  it('explains both kinds of game in one sentence each, not as sections', () => {
    renderCatalogue();
    const island = document.querySelector('[data-catalogue-note="island"]') as HTMLElement;
    const guest = document.querySelector('[data-catalogue-note="guest"]') as HTMLElement;

    expect(island.textContent).toMatch(/island games/i);
    expect(island.textContent).toMatch(/earn arcade tickets/i);
    expect(guest.textContent).toMatch(/guest games/i);
    expect(guest.textContent).toMatch(/just for fun/i);
    expect(guest.textContent).toMatch(/never give arcade tickets/i);
    expect(guest.textContent).toMatch(/coming soon/i);

    // One heading, not a stack of them. Categories are notes now, because two
    // headings over two empty grids read as an admin form, not a game menu.
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });

  it('states no reward amount and no technical term anywhere', () => {
    renderCatalogue();
    const text = document.body.textContent!;
    expect(text).not.toMatch(/\d+\s*tickets/i);
    for (const jargon of ['webxdc', 'nostr', 'npub', 'kind:', 'sandbox', 'iframe', 'issuer', 'relay']) {
      expect(text.toLowerCase(), jargon).not.toContain(jargon);
    }
    // No raw ids on screen.
    expect(text).not.toMatch(/blobbi-|arcade-cabinet-/);
  });
});

describe('a shared-cabinet game, when one exists', () => {
  it('offers one clearly named launch control', () => {
    const { onSelect } = renderCatalogue([...ARCADE_CATALOGUE, CABINET_GAME]);
    const play = screen.getByRole('button', { name: 'Play Blobbi Blocks' });

    fireEvent.click(play);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('cabinet-game');
    expect(play.className).toContain('min-h-[44px]');
  });

  it('says what the player does, how it is controlled and how long it takes', () => {
    renderCatalogue([...ARCADE_CATALOGUE, CABINET_GAME]);
    const el = card('cabinet-game')!;
    expect(within(el).getByText(/stack the falling blocks/i)).toBeInTheDocument();
    expect(el.textContent).toMatch(/arrow keys/i);
    expect(el.textContent).toMatch(/about 2 minutes/i);
  });

  it('says tickets are POSSIBLE, never that they are automatic', () => {
    renderCatalogue([...ARCADE_CATALOGUE, CABINET_GAME]);
    const badge = document.querySelector('[data-catalogue-tickets="cabinet-game"]') as HTMLElement;
    expect(badge.textContent).toMatch(/play well to earn tickets/i);
    expect(badge.textContent).not.toMatch(/\bwill earn\b|\bget \d/i);
  });

  it('still lists no Blobbi Dance beside it', () => {
    renderCatalogue([...ARCADE_CATALOGUE, CABINET_GAME]);
    expect(card(BLOBBI_DANCE_GAME_ID)).toBeNull();
    expect(screen.queryByRole('button', { name: /play blobbi dance/i })).toBeNull();
  });
});

describe('entries that must not be pressable', () => {
  it('gives a coming-soon cabinet game no button and no controls list', () => {
    renderCatalogue([...ARCADE_CATALOGUE, COMING_SOON_CABINET_GAME]);
    const el = card('cabinet-game-soon')!;

    expect(within(el).getByText('Coming soon')).toBeInTheDocument();
    expect(within(el).getByText(/not ready to play yet/i)).toBeInTheDocument();
    // Not a disabled button; no button, so nothing announces itself as
    // pressable and nothing invites a click that does nothing.
    expect(within(el).queryByRole('button')).toBeNull();
    // Controls and duration are metadata for a game you cannot start.
    expect(el.textContent).not.toMatch(/arrow keys|about 2 minutes/i);
  });

  it('gives a guest game no button and no ticket badge, however its record reads', () => {
    const { onSelect } = renderCatalogue([...ARCADE_CATALOGUE, LYING_GUEST_ENTRY]);
    const el = card('guest-liar')!;

    expect(within(el).queryByRole('button')).toBeNull();
    expect(el.querySelector('[data-catalogue-tickets]')).toBeNull();
    expect(within(el).getByText('Just for fun')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('a refused launch', () => {
  it('is announced, and leaves the player on the catalogue', () => {
    renderCatalogue(ARCADE_CATALOGUE, 'Blobbi Blocks cannot be played on this cabinet.');
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be played on this cabinet/i);
    expect(screen.getByRole('heading', { name: 'Arcade Games' })).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('labels the panel by its heading', () => {
    renderCatalogue();
    const section = document.querySelector('[data-catalogue-section="games"]') as HTMLElement;
    const labelledBy = section.getAttribute('aria-labelledby');
    expect(document.getElementById(labelledBy!)).toHaveTextContent('Arcade Games');
  });

  it('gives every card an accessible name of its own', () => {
    renderCatalogue([...ARCADE_CATALOGUE, CABINET_GAME, COMING_SOON_CABINET_GAME]);
    for (const entry of [CABINET_GAME, COMING_SOON_CABINET_GAME]) {
      const article = within(card(entry.id)!).getByRole('article');
      const labelledBy = article.getAttribute('aria-labelledby');
      expect(document.getElementById(labelledBy!), entry.id).toHaveTextContent(entry.title);
    }
  });

  it('treats the cabinet illustration as decoration', () => {
    renderCatalogue();
    const img = document.querySelector('[data-arcade-catalogue] img') as HTMLElement;
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('aria-hidden');
  });
});
