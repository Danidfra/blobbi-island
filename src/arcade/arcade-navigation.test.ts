/**
 * The navigation stack's rules, checked without a DOM.
 *
 * Every one of these corresponds to a way the old one-game-per-cabinet shell
 * behaved badly: leaving a game ejected the player to the room, a machine's
 * identity was lost the moment anything else opened, and "which screen am I on?"
 * was answered by inspecting a lifecycle status that describes a RUN.
 */
import { describe, it, expect } from 'vitest';

import {
  ARCADE_VIEW_CLOSED,
  arcadeViewMachineId,
  closeArcadeView,
  exitGame,
  isArcadeViewOpen,
  launchGame,
  openCatalogue,
  openDedicatedGame,
  openDedicatedPreview,
  openNotice,
  type ArcadeView,
} from './arcade-navigation';

const CABINET = 'arcade-cabinet-pink';
const OTHER_CABINET = 'arcade-cabinet-green';
const DANCE_MACHINE = 'arcade-dance-machine';

describe('opening', () => {
  it('opens a catalogue for the cabinet the player walked to', () => {
    const view = openCatalogue(CABINET);
    expect(view).toEqual({ kind: 'catalogue', machineId: CABINET });
    expect(isArcadeViewOpen(view)).toBe(true);
    expect(arcadeViewMachineId(view)).toBe(CABINET);
  });

  it('opens a dedicated machine straight onto its game, with no menu first', () => {
    expect(openDedicatedGame(DANCE_MACHINE, 'blobbi-dance')).toEqual({
      kind: 'game',
      machineId: DANCE_MACHINE,
      gameId: 'blobbi-dance',
      from: 'dedicated-machine',
    });
  });

  it('opens a dedicated machine onto its OWN coming-soon screen', () => {
    expect(openDedicatedPreview('arcade-pool-table', 'blobbi-pool')).toEqual({
      kind: 'preview',
      machineId: 'arcade-pool-table',
      experienceId: 'blobbi-pool',
    });
  });

  it('opens a notice panel for something that is not a game', () => {
    expect(openNotice('arcade-prize-counter')).toEqual({
      kind: 'notice',
      machineId: 'arcade-prize-counter',
    });
  });

  it('refuses to open anything without a machine', () => {
    expect(openCatalogue('')).toEqual(ARCADE_VIEW_CLOSED);
    expect(openNotice('')).toEqual(ARCADE_VIEW_CLOSED);
    expect(openDedicatedPreview('', 'blobbi-pool')).toEqual(ARCADE_VIEW_CLOSED);
    expect(openDedicatedPreview('arcade-pool-table', '')).toEqual(ARCADE_VIEW_CLOSED);
    expect(openDedicatedGame('', 'blobbi-dance')).toEqual(ARCADE_VIEW_CLOSED);
    expect(openDedicatedGame(DANCE_MACHINE, '')).toEqual(ARCADE_VIEW_CLOSED);
  });

  it('starts closed, and closed is closed', () => {
    expect(isArcadeViewOpen(ARCADE_VIEW_CLOSED)).toBe(false);
    expect(arcadeViewMachineId(ARCADE_VIEW_CLOSED)).toBeNull();
  });
});

describe('launching a game', () => {
  it('carries the cabinet into the game, and records where it came from', () => {
    const view = launchGame(openCatalogue(CABINET), 'a-cabinet-game');
    expect(view).toEqual({
      kind: 'game',
      machineId: CABINET,
      gameId: 'a-cabinet-game',
      from: 'shared-catalogue',
    });
  });

  it('keeps the SELECTED cabinet, whichever one it was', () => {
    // The reason this matters: the run's `machineId` is what a claim records,
    // and "the machine the player was standing at" must not degrade into "some
    // machine".
    for (const machineId of [CABINET, OTHER_CABINET]) {
      const view = launchGame(openCatalogue(machineId), 'a-cabinet-game');
      expect(arcadeViewMachineId(view)).toBe(machineId);
    }
  });

  it('is only reachable from a catalogue', () => {
    expect(launchGame(ARCADE_VIEW_CLOSED, 'a-cabinet-game')).toEqual(ARCADE_VIEW_CLOSED);

    const notice = openNotice(CABINET);
    expect(launchGame(notice, 'a-cabinet-game')).toBe(notice);

    const preview = openDedicatedPreview('arcade-pool-table', 'blobbi-pool');
    // A dedicated coming-soon screen is not a menu and never becomes one.
    expect(launchGame(preview, 'a-cabinet-game')).toBe(preview);

    const game = openDedicatedGame(DANCE_MACHINE, 'blobbi-dance');
    // No game may launch another game: leaving one is a separate, explicit step,
    // which is what stops a run from being replaced without being aborted.
    expect(launchGame(game, 'a-cabinet-game')).toBe(game);
  });

  it('refuses an empty game id', () => {
    const catalogue = openCatalogue(CABINET);
    expect(launchGame(catalogue, '')).toBe(catalogue);
  });
});

describe('leaving a game', () => {
  it('returns a CATALOGUE-launched game to the catalogue it came from', () => {
    const view = exitGame(launchGame(openCatalogue(CABINET), 'a-cabinet-game'));
    expect(view).toEqual({ kind: 'catalogue', machineId: CABINET });
  });

  it('returns a DEDICATED machine game to the room, not to a catalogue', () => {
    // Blobbi Dance is not in the shared catalogue, so stepping "back" into one
    // would drop the player into a list that does not contain the game they
    // just left. It goes to the room.
    const view = exitGame(openDedicatedGame(DANCE_MACHINE, 'blobbi-dance'));
    expect(view).toEqual(ARCADE_VIEW_CLOSED);
    expect(isArcadeViewOpen(view)).toBe(false);
  });

  it('does nothing from anywhere else', () => {
    const catalogue = openCatalogue(CABINET);
    expect(exitGame(catalogue)).toBe(catalogue);

    const notice = openNotice(CABINET);
    expect(exitGame(notice)).toBe(notice);

    const preview = openDedicatedPreview('arcade-air-hockey', 'blobbi-air-hockey');
    expect(exitGame(preview)).toBe(preview);

    expect(exitGame(ARCADE_VIEW_CLOSED)).toBe(ARCADE_VIEW_CLOSED);
  });

  it('closes from every view in one step', () => {
    for (const view of [
      ARCADE_VIEW_CLOSED,
      openCatalogue(CABINET),
      openNotice(CABINET),
      openDedicatedPreview('arcade-pool-table', 'blobbi-pool'),
      openDedicatedGame(DANCE_MACHINE, 'blobbi-dance'),
      launchGame(openCatalogue(CABINET), 'a-cabinet-game'),
    ] as ArcadeView[]) {
      expect(isArcadeViewOpen(closeArcadeView()), view.kind).toBe(false);
    }
  });
});

describe('the three flows', () => {
  it('generic cabinet: room → catalogue → room', () => {
    let view: ArcadeView = ARCADE_VIEW_CLOSED;

    view = openCatalogue(CABINET);
    expect(view.kind).toBe('catalogue');
    expect(arcadeViewMachineId(view)).toBe(CABINET);

    view = closeArcadeView();
    expect(view.kind).toBe('closed');
  });

  it('generic cabinet with a game: room → catalogue → game → catalogue → room', () => {
    let view: ArcadeView = openCatalogue(CABINET);

    view = launchGame(view, 'a-cabinet-game');
    expect(view.kind).toBe('game');

    view = exitGame(view);
    expect(view).toEqual({ kind: 'catalogue', machineId: CABINET });

    view = closeArcadeView();
    expect(view.kind).toBe('closed');
  });

  it('dance machine: room → game → room, never touching a catalogue', () => {
    let view: ArcadeView = openDedicatedGame(DANCE_MACHINE, 'blobbi-dance');
    expect(view.kind).toBe('game');
    expect(arcadeViewMachineId(view)).toBe(DANCE_MACHINE);

    view = exitGame(view);
    expect(view.kind).toBe('closed');
  });

  it('pool / air hockey: room → that game’s own screen → room', () => {
    for (const [machineId, experienceId] of [
      ['arcade-pool-table', 'blobbi-pool'],
      ['arcade-air-hockey', 'blobbi-air-hockey'],
    ]) {
      const view = openDedicatedPreview(machineId, experienceId);
      expect(view).toEqual({ kind: 'preview', machineId, experienceId });
      expect(closeArcadeView().kind).toBe('closed');
    }
  });

  it('never mutates the view it is given', () => {
    const catalogue = Object.freeze(openCatalogue(CABINET));
    launchGame(catalogue, 'a-cabinet-game');
    expect(catalogue).toEqual({ kind: 'catalogue', machineId: CABINET });
  });
});
