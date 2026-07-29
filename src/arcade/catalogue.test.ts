/**
 * The shared catalogue's invariants.
 *
 * Two kinds of assertion live here, and the second kind is the important one:
 *
 *  - **Data shape** — unique ids, real categories, honest copy. Cheap, and it
 *    catches the ordinary mistakes of adding a row.
 *  - **Trust** — that a Guest Game cannot become launchable by having the right
 *    fields, that a coming-soon entry cannot start, that `grantsTickets` is only
 *    set where a reward policy actually exists, and that this module has not
 *    quietly grown a relay query or a package URL. Those are the properties the
 *    architecture is FOR, so they are checked against the source, not assumed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  ARCADE_AIR_HOCKEY_MACHINE_ID,
  ARCADE_CATALOGUE,
  ARCADE_POOL_MACHINE_ID,
  BLOBBI_DANCE_GAME_ID,
  BLOBBI_DANCE_MACHINE_ID,
  arcadeCatalogueByCategory,
  canLaunchArcadeGame,
  catalogueDurationLabel,
  dedicatedGamesForMachine,
  getCatalogueEntry,
  isNativeLaunchable,
  sharedCabinetCatalogue,
  type ArcadeCatalogueEntry,
} from './catalogue';
import { arcadeRewardPolicies, getProductionRewardPolicy } from './reward-policy';
import { NEON_HOP_TRACK } from './dance/track';
import { arcadeMachines } from '@/lib/arcade-machines-config';

/**
 * The module with its prose removed.
 *
 * The purity checks below are about what the CODE does, and this file's own
 * documentation necessarily names the things it is documenting the absence of
 * ("no Nostr", "reward-policy.ts's business"). Scanning the comments would make
 * every explanation a test failure, which teaches the next person to delete the
 * explanation.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

const CATEGORIES = ['island', 'guest'];
const AVAILABILITIES = ['playable', 'coming-soon', 'disabled'];
const LAUNCH_MODES = ['native', 'guest-runtime'];

describe('identity', () => {
  it('gives every game a unique, plain string id', () => {
    const ids = ARCADE_CATALOGUE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.trim()).toBe(id);
      expect(id.length).toBeGreaterThan(0);
      // Not an naddr coordinate and not an item address: those identify protocol
      // objects with their own lifecycles, and a game must not inherit one.
      expect(id).not.toMatch(/^\d+:/);
      expect(id).not.toContain(':');
    }
  });

  it('gives every game a unique title and a description that says what you do', () => {
    const titles = ARCADE_CATALOGUE.map((e) => e.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const entry of ARCADE_CATALOGUE) {
      expect(entry.title.trim().length, entry.id).toBeGreaterThan(0);
      expect(entry.shortDescription.trim().length, entry.id).toBeGreaterThan(10);
    }
  });

  it('uses only real categories, availabilities and launch modes', () => {
    for (const entry of ARCADE_CATALOGUE) {
      expect(CATEGORIES, entry.id).toContain(entry.category);
      expect(AVAILABILITIES, entry.id).toContain(entry.availability);
      expect(LAUNCH_MODES, entry.id).toContain(entry.launchMode);
    }
  });

  it('resolves by id, and resolves nothing for an id it does not know', () => {
    expect(getCatalogueEntry(BLOBBI_DANCE_GAME_ID)?.title).toBe('Blobbi Dance');
    expect(getCatalogueEntry('not-a-game')).toBeNull();
    expect(getCatalogueEntry(null)).toBeNull();
    expect(getCatalogueEntry(undefined)).toBeNull();
    expect(getCatalogueEntry('')).toBeNull();
  });

  it('cannot be edited at runtime', () => {
    expect(Object.isFrozen(ARCADE_CATALOGUE)).toBe(true);
    for (const entry of ARCADE_CATALOGUE) expect(Object.isFrozen(entry), entry.id).toBe(true);
  });
});

describe('Blobbi Dance', () => {
  const dance = getCatalogueEntry(BLOBBI_DANCE_GAME_ID)!;

  it('uses the canonical game id — no alias', () => {
    expect(BLOBBI_DANCE_GAME_ID).toBe('blobbi-dance');
    expect(dance.id).toBe(BLOBBI_DANCE_GAME_ID);
    // The reward policy, the claim ledger and the result all key off this one
    // string; a second spelling would split a player's history in half.
    expect(getProductionRewardPolicy(dance.id)?.gameId).toBe(BLOBBI_DANCE_GAME_ID);
  });

  it('is the one playable island game', () => {
    expect(dance.category).toBe('island');
    expect(dance.availability).toBe('playable');
    expect(dance.launchMode).toBe('native');
    expect(isNativeLaunchable(dance)).toBe(true);

    const launchable = ARCADE_CATALOGUE.filter(isNativeLaunchable).map((e) => e.id);
    expect(launchable).toEqual([BLOBBI_DANCE_GAME_ID]);
  });

  it('belongs to the dance machine and to nothing else', () => {
    expect(dance.host).toBe('dedicated-machine');
    expect(dance.machineIds).toEqual([BLOBBI_DANCE_MACHINE_ID]);
  });

  it('cannot be launched from a generic cabinet, a table, or the shared catalogue', () => {
    // The correction, stated as four refusals. A Blobbi Dance run can therefore
    // only ever record `arcade-dance-machine`, which is what a ticket claim
    // carries.
    expect(
      canLaunchArcadeGame({
        game: dance,
        machineId: BLOBBI_DANCE_MACHINE_ID,
        surface: 'dedicated-machine',
      }),
    ).toBe(true);

    for (const machineId of [
      'arcade-cabinet-pink',
      'arcade-cabinet-red',
      ARCADE_POOL_MACHINE_ID,
      ARCADE_AIR_HOCKEY_MACHINE_ID,
    ]) {
      expect(
        canLaunchArcadeGame({ game: dance, machineId, surface: 'dedicated-machine' }),
        machineId,
      ).toBe(false);
    }

    // And never through the shared catalogue, whichever cabinet asks.
    expect(
      canLaunchArcadeGame({
        game: dance,
        machineId: 'arcade-cabinet-pink',
        surface: 'shared-catalogue',
      }),
    ).toBe(false);
    expect(
      canLaunchArcadeGame({
        game: dance,
        machineId: BLOBBI_DANCE_MACHINE_ID,
        surface: 'shared-catalogue',
      }),
    ).toBe(false);
  });

  it('describes both control schemes, because a phone player must not have to guess', () => {
    expect(dance.controls.map((c) => c.scheme).sort()).toEqual(['keyboard', 'touch']);
    for (const control of dance.controls) expect(control.label.trim().length).toBeGreaterThan(0);
  });

  it('takes its length from the track rather than repeating it', () => {
    expect(dance.estimatedDurationMs).toBe(NEON_HOP_TRACK.durationMs);
    expect(catalogueDurationLabel(dance)).toBe(
      `About ${Math.round(NEON_HOP_TRACK.durationMs / 1000)} seconds`,
    );
  });
});

describe('ticket eligibility is a fact, not a policy', () => {
  it('sets grantsTickets only where an active reward policy exists', () => {
    const paid = new Set(
      arcadeRewardPolicies.filter((p) => p.status === 'active').map((p) => p.gameId),
    );
    for (const entry of ARCADE_CATALOGUE) {
      if (entry.grantsTickets) expect(paid, entry.id).toContain(entry.id);
    }
  });

  it('never lets a guest game claim tickets', () => {
    for (const entry of arcadeCatalogueByCategory('guest')) {
      expect(entry.grantsTickets, entry.id).toBe(false);
    }
  });

  it('never lets a coming-soon game claim tickets', () => {
    for (const entry of ARCADE_CATALOGUE) {
      if (entry.availability !== 'playable') expect(entry.grantsTickets, entry.id).toBe(false);
    }
  });

  it('computes no reward anywhere in this module', () => {
    // The catalogue records THAT a game can pay; how much is `reward-policy.ts`'s
    // sole business, and it must stay that way even as rows are added.
    const source = codeOnly(readFileSync(join(process.cwd(), 'src/arcade/catalogue.ts'), 'utf8'));
    for (const forbidden of ['reward-policy', 'calculateTicketAward', 'calculateArcadeReward']) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

describe('launch refusals', () => {
  const base: ArcadeCatalogueEntry = {
    id: 'fixture',
    title: 'Fixture',
    shortDescription: 'A test fixture that does not ship.',
    category: 'island',
    availability: 'playable',
    launchMode: 'native',
    grantsTickets: false,
    controls: [],
    source: 'blobbi-internal',
    host: 'shared-cabinet',
  };

  it('refuses a coming-soon or disabled entry', () => {
    expect(isNativeLaunchable({ ...base, availability: 'coming-soon' })).toBe(false);
    expect(isNativeLaunchable({ ...base, availability: 'disabled' })).toBe(false);
  });

  it('refuses a guest game even when every other field says go', () => {
    // The exact shape the brief calls out: a guest entry that claims to be a
    // playable native game must STILL fail, and it must fail on category — the
    // first check — so a later field cannot rescue it.
    expect(
      isNativeLaunchable({
        ...base,
        category: 'guest',
        launchMode: 'native',
        availability: 'playable',
      }),
    ).toBe(false);
    expect(isNativeLaunchable({ ...base, category: 'guest' })).toBe(false);
  });

  it('refuses a guest-runtime launch mode, because there is no guest runtime', () => {
    expect(isNativeLaunchable({ ...base, launchMode: 'guest-runtime' })).toBe(false);
  });

  it('refuses nothing at all', () => {
    expect(isNativeLaunchable(null)).toBe(false);
    expect(isNativeLaunchable(undefined)).toBe(false);
  });
});

describe('hosts', () => {
  it('declares a host for every game, and machines for every dedicated one', () => {
    for (const entry of ARCADE_CATALOGUE) {
      expect(['shared-cabinet', 'dedicated-machine'], entry.id).toContain(entry.host);
      if (entry.host === 'dedicated-machine') {
        // The field that was optional-and-unused in the first pass, which is
        // exactly why "the dance game lives on the dance machine" was enforced
        // nowhere. It is now required in practice, and checked.
        expect(entry.machineIds, entry.id).toBeDefined();
        expect(entry.machineIds!.length, entry.id).toBeGreaterThan(0);
      } else {
        expect(entry.machineIds, entry.id).toBeUndefined();
      }
    }
  });

  it('names machine ids the machine registry actually has', () => {
    const known = new Set(arcadeMachines.map((m) => m.id));
    for (const entry of ARCADE_CATALOGUE) {
      for (const machineId of entry.machineIds ?? []) {
        expect(known, `${entry.id} → ${machineId}`).toContain(machineId);
      }
    }
  });

  it('gives each dedicated machine exactly its own game', () => {
    expect(dedicatedGamesForMachine(BLOBBI_DANCE_MACHINE_ID).map((e) => e.id)).toEqual([
      BLOBBI_DANCE_GAME_ID,
    ]);
    expect(dedicatedGamesForMachine(ARCADE_POOL_MACHINE_ID).map((e) => e.id)).toEqual([
      'blobbi-pool',
    ]);
    expect(dedicatedGamesForMachine(ARCADE_AIR_HOCKEY_MACHINE_ID).map((e) => e.id)).toEqual([
      'blobbi-air-hockey',
    ]);
    // A generic cabinet owns nothing.
    expect(dedicatedGamesForMachine('arcade-cabinet-pink')).toEqual([]);
    expect(dedicatedGamesForMachine(null)).toEqual([]);
  });
});

describe('the shared cabinet catalogue', () => {
  it('is empty, because every game today belongs to a dedicated machine', () => {
    // Not a defect — the honest product state. The screen is designed for it,
    // and padding it with the dance machine's game is the thing this function
    // exists to make impossible.
    expect(sharedCabinetCatalogue()).toEqual([]);
  });

  it('never contains Blobbi Dance', () => {
    expect(sharedCabinetCatalogue().map((e) => e.id)).not.toContain(BLOBBI_DANCE_GAME_ID);
    // Even if a caller hands in the whole registry explicitly.
    expect(sharedCabinetCatalogue(ARCADE_CATALOGUE).map((e) => e.id)).not.toContain(
      BLOBBI_DANCE_GAME_ID,
    );
  });

  it('would list a shared-cabinet game, and hide a disabled one', () => {
    const future: ArcadeCatalogueEntry = {
      ...getCatalogueEntry(BLOBBI_DANCE_GAME_ID)!,
      id: 'future-cabinet-game',
      host: 'shared-cabinet',
      machineIds: undefined,
    };
    expect(sharedCabinetCatalogue([...ARCADE_CATALOGUE, future]).map((e) => e.id)).toEqual([
      'future-cabinet-game',
    ]);
    expect(
      sharedCabinetCatalogue([{ ...future, availability: 'disabled' }]),
    ).toEqual([]);
  });

  it('lets a shared-cabinet game launch from any generic cabinet', () => {
    const future: ArcadeCatalogueEntry = {
      ...getCatalogueEntry(BLOBBI_DANCE_GAME_ID)!,
      id: 'future-cabinet-game',
      host: 'shared-cabinet',
      machineIds: undefined,
    };
    for (const machineId of ['arcade-cabinet-pink', 'arcade-cabinet-red']) {
      expect(
        canLaunchArcadeGame({ game: future, machineId, surface: 'shared-catalogue' }),
        machineId,
      ).toBe(true);
    }
    // But not as if it were a machine's own game.
    expect(
      canLaunchArcadeGame({
        game: future,
        machineId: 'arcade-cabinet-pink',
        surface: 'dedicated-machine',
      }),
    ).toBe(false);
  });
});

describe('coming-soon dedicated games', () => {
  it('are Pool and Air Hockey, each on its own table', () => {
    const comingSoon = ARCADE_CATALOGUE.filter((e) => e.availability === 'coming-soon');
    expect(comingSoon.map((e) => e.id)).toEqual(['blobbi-pool', 'blobbi-air-hockey']);
    for (const entry of comingSoon) {
      expect(entry.host, entry.id).toBe('dedicated-machine');
      expect(canLaunchArcadeGame({
        game: entry,
        machineId: entry.machineIds![0],
        surface: 'dedicated-machine',
      }), entry.id).toBe(false);
    }
  });

  it('describes its OWN game, never another', () => {
    const pool = getCatalogueEntry('blobbi-pool')!;
    const airHockey = getCatalogueEntry('blobbi-air-hockey')!;

    expect(pool.shortDescription.toLowerCase()).toMatch(/cue|balls|table/);
    expect(airHockey.shortDescription.toLowerCase()).toMatch(/puck/);
    for (const entry of [pool, airHockey]) {
      expect(entry.shortDescription.toLowerCase(), entry.id).not.toMatch(/dance|arrow|rhythm/);
    }
  });

  it('says plainly that it is not built, without promising a date', () => {
    for (const entry of ARCADE_CATALOGUE.filter((e) => e.availability === 'coming-soon')) {
      expect(entry.shortDescription.toLowerCase(), entry.id).toMatch(/still being built|not|yet/);
      expect(entry.shortDescription, entry.id).not.toMatch(
        /soon|next (week|month)|20\d\d|scheduled/i,
      );
    }
  });
});

describe('the registry stays pure', () => {
  const source = codeOnly(readFileSync(join(process.cwd(), 'src/arcade/catalogue.ts'), 'utf8'));

  it('imports no React and defines no component', () => {
    expect(source).not.toMatch(/from ['"]react['"]/);
    expect(source).not.toMatch(/\buse[A-Z]\w*\(/);
    expect(source).not.toContain('jsx');
    expect(source).not.toMatch(/<[A-Z]\w*[\s/>]/);
  });

  it('reaches no relay and no network', () => {
    for (const forbidden of ['nostr', 'nip19', 'npub', 'relay', 'fetch(', 'http://', 'https://']) {
      expect(source.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('references no package format and no runtime', () => {
    for (const forbidden of ['webxdc', 'iframe', 'sandbox', 'import(']) {
      expect(source.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it('carries no remote asset — every thumbnail is a local path', () => {
    for (const entry of ARCADE_CATALOGUE) {
      if (!entry.thumbnail) continue;
      expect(entry.thumbnail, entry.id).toMatch(/^\/assets\//);
    }
  });
});
