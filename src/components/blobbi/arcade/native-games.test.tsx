/**
 * The launch resolver — every way it must refuse.
 *
 * This is the boundary between "a machine was reached" and "a game is running",
 * and therefore the boundary in front of the reward path. A resolver that
 * answers "is there a component for this id?" quietly implies every resolved
 * game can run anywhere, and that implication is what let Blobbi Dance be
 * launched from a pool table. It now takes the whole launch request — the game,
 * the machine and the kind of screen that asked — and refuses on any of them.
 *
 * These tests do not render anything. The resolver's job is to answer
 * "component or `null`?", and that answer is checkable without a DOM.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { NATIVE_ARCADE_GAME_IDS, resolveNativeArcadeGame } from './native-games';
import {
  ARCADE_AIR_HOCKEY_MACHINE_ID,
  ARCADE_CATALOGUE,
  ARCADE_POOL_MACHINE_ID,
  BLOBBI_DANCE_GAME_ID,
  BLOBBI_DANCE_MACHINE_ID,
  getCatalogueEntry,
  isNativeLaunchable,
  type ArcadeCatalogueEntry,
} from '@/arcade/catalogue';
import { arcadeMachines } from '@/lib/arcade-machines-config';

const SOURCE = readFileSync(
  join(process.cwd(), 'src/components/blobbi/arcade/native-games.tsx'),
  'utf8',
);

const DANCE = getCatalogueEntry(BLOBBI_DANCE_GAME_ID)!;

/** The one request that is supposed to work. */
const onTheDanceMachine = {
  game: DANCE,
  machineId: BLOBBI_DANCE_MACHINE_ID,
  surface: 'dedicated-machine' as const,
};

describe('what resolves', () => {
  it('resolves Blobbi Dance on the dance machine, and only there', () => {
    expect(resolveNativeArcadeGame(onTheDanceMachine)).toBeTypeOf('function');
  });

  it('implements exactly the three dedicated games that are built', () => {
    // Asserted whole rather than by length: adding a fourth is a decision that
    // has to be written down here, next to the registry entry that advertises
    // it.
    expect(NATIVE_ARCADE_GAME_IDS).toEqual([
      BLOBBI_DANCE_GAME_ID,
      'blobbi-air-hockey',
      'blobbi-pool',
    ]);
  });

  it('resolves Air Hockey on the air hockey table, and only there', () => {
    const entry = getCatalogueEntry('blobbi-air-hockey');
    expect(
      resolveNativeArcadeGame({
        game: entry,
        machineId: ARCADE_AIR_HOCKEY_MACHINE_ID,
        surface: 'dedicated-machine',
      }),
    ).toBeTypeOf('function');

    for (const machine of arcadeMachines.filter((m) => m.id !== ARCADE_AIR_HOCKEY_MACHINE_ID)) {
      expect(
        resolveNativeArcadeGame({
          game: entry,
          machineId: machine.id,
          surface: 'dedicated-machine',
        }),
        machine.id,
      ).toBeNull();
    }

    // And never from the shared catalogue, whatever a cabinet asks for.
    expect(
      resolveNativeArcadeGame({
        game: entry,
        machineId: ARCADE_AIR_HOCKEY_MACHINE_ID,
        surface: 'shared-catalogue',
      }),
    ).toBeNull();
  });

  it('gives every playable registry entry an implementation on its own machine', () => {
    // The direction that matters: the registry must never advertise a playable
    // game the app cannot start. A row added without a component fails here
    // rather than in front of a player.
    for (const entry of ARCADE_CATALOGUE.filter(isNativeLaunchable)) {
      for (const machineId of entry.machineIds ?? []) {
        expect(
          resolveNativeArcadeGame({ game: entry, machineId, surface: 'dedicated-machine' }),
          `${entry.id}@${machineId}`,
        ).toBeTypeOf('function');
      }
    }
  });

  it('implements nothing the registry does not list as launchable', () => {
    for (const id of NATIVE_ARCADE_GAME_IDS) {
      const entry = ARCADE_CATALOGUE.find((e) => e.id === id);
      expect(entry, id).toBeDefined();
      expect(isNativeLaunchable(entry), id).toBe(true);
    }
  });
});

describe('the machine is part of the answer', () => {
  it('refuses Blobbi Dance on every machine that is not the dance machine', () => {
    // The correction, at the resolver. Without it a run could carry a pool
    // table's id into a ticket claim.
    for (const machine of arcadeMachines.filter((m) => m.id !== BLOBBI_DANCE_MACHINE_ID)) {
      expect(
        resolveNativeArcadeGame({
          game: DANCE,
          machineId: machine.id,
          surface: 'dedicated-machine',
        }),
        machine.id,
      ).toBeNull();
    }
  });

  it('refuses Blobbi Dance with no machine at all', () => {
    expect(
      resolveNativeArcadeGame({ game: DANCE, machineId: null, surface: 'dedicated-machine' }),
    ).toBeNull();
    expect(
      resolveNativeArcadeGame({ game: DANCE, machineId: '', surface: 'dedicated-machine' }),
    ).toBeNull();
  });

  it('refuses Blobbi Dance from the shared catalogue, whichever cabinet asks', () => {
    for (const machineId of ['arcade-cabinet-pink', 'arcade-cabinet-red', BLOBBI_DANCE_MACHINE_ID]) {
      expect(
        resolveNativeArcadeGame({ game: DANCE, machineId, surface: 'shared-catalogue' }),
        machineId,
      ).toBeNull();
    }
  });
});

describe('what is refused outright', () => {
  it('refuses an unknown or missing game, safely', () => {
    for (const game of [null, undefined, getCatalogueEntry('not-a-game')]) {
      expect(
        resolveNativeArcadeGame({
          game,
          machineId: BLOBBI_DANCE_MACHINE_ID,
          surface: 'dedicated-machine',
        }),
      ).toBeNull();
    }
  });

  it('refuses a coming-soon entry even on its own machine, with a component behind it', () => {
    /*
      Every dedicated machine now has a built game, so there is no shipped
      `coming-soon` entry left to iterate over. The rule still has to hold, and
      this is the harder version of it: take Pool — which DOES have a component
      registered — mark it coming-soon, and check the resolver refuses anyway.

      That is stronger than the old loop was. It proves the refusal comes from
      `availability`, not from the lookup happening to miss.
    */
    const pool = getCatalogueEntry('blobbi-pool')!;
    expect(NATIVE_ARCADE_GAME_IDS).toContain(pool.id);

    const unbuilt: ArcadeCatalogueEntry = { ...pool, availability: 'coming-soon' };
    expect(
      resolveNativeArcadeGame({
        game: unbuilt,
        machineId: ARCADE_POOL_MACHINE_ID,
        surface: 'dedicated-machine',
      }),
    ).toBeNull();

    // And `disabled` is refused for the same reason.
    expect(
      resolveNativeArcadeGame({
        game: { ...pool, availability: 'disabled' },
        machineId: ARCADE_POOL_MACHINE_ID,
        surface: 'dedicated-machine',
      }),
    ).toBeNull();

    // Whatever coming-soon entries the registry gains later are covered too.
    for (const entry of ARCADE_CATALOGUE.filter((e) => e.availability === 'coming-soon')) {
      for (const machineId of entry.machineIds ?? []) {
        expect(
          resolveNativeArcadeGame({ game: entry, machineId, surface: 'dedicated-machine' }),
          entry.id,
        ).toBeNull();
      }
    }
  });

  it('resolves Pool on the pool table, and only there', () => {
    const entry = getCatalogueEntry('blobbi-pool');
    expect(
      resolveNativeArcadeGame({
        game: entry,
        machineId: ARCADE_POOL_MACHINE_ID,
        surface: 'dedicated-machine',
      }),
    ).toBeTypeOf('function');

    // Not from another machine, and not from the shared catalogue.
    for (const machineId of [
      BLOBBI_DANCE_MACHINE_ID,
      ARCADE_AIR_HOCKEY_MACHINE_ID,
      'arcade-cabinet-pink',
    ]) {
      expect(
        resolveNativeArcadeGame({ game: entry, machineId, surface: 'dedicated-machine' }),
        machineId,
      ).toBeNull();
    }
    expect(
      resolveNativeArcadeGame({
        game: entry,
        machineId: ARCADE_POOL_MACHINE_ID,
        surface: 'shared-catalogue',
      }),
    ).toBeNull();
  });

  it('refuses a guest game however its record is filled in', () => {
    const lyingGuest: ArcadeCatalogueEntry = {
      ...DANCE,
      id: 'guest-liar',
      category: 'guest',
      // Every other field says go.
      launchMode: 'native',
      availability: 'playable',
      host: 'dedicated-machine',
      machineIds: [BLOBBI_DANCE_MACHINE_ID],
    };
    expect(
      resolveNativeArcadeGame({
        game: lyingGuest,
        machineId: BLOBBI_DANCE_MACHINE_ID,
        surface: 'dedicated-machine',
      }),
    ).toBeNull();
  });

  it('refuses a game with no implementation', () => {
    const orphan: ArcadeCatalogueEntry = {
      ...DANCE,
      id: 'no-code',
      machineIds: [BLOBBI_DANCE_MACHINE_ID],
    };
    expect(
      resolveNativeArcadeGame({
        game: orphan,
        machineId: BLOBBI_DANCE_MACHINE_ID,
        surface: 'dedicated-machine',
      }),
    ).toBeNull();
  });
});

describe('the resolver cannot become a runtime', () => {
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  it('imports its games statically and loads nothing at run time', () => {
    for (const forbidden of ['import(', 'iframe', 'webxdc', 'srcdoc', 'eval(', 'new Function']) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    expect(code).toContain("from './dance/DanceMachine'");
  });

  it('grants nothing itself', () => {
    for (const forbidden of ['useArcadeReward', 'reward-policy', 'inventory', 'publish']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});
