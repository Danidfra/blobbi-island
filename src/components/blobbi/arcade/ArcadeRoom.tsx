import React, { useCallback, useMemo, useReducer, useState } from 'react';
import { cn } from '@/lib/utils';

import { useLocation } from '@/hooks/useLocation';
import { usePendingInteraction } from '@/hooks/usePendingInteraction';
import { useCancelInteractionOnWorldClick } from '@/hooks/useCancelInteractionOnWorldClick';
import type { MovableBlobbiRef } from '../MovableBlobbi';
import { BackArrow } from '../BackArrow';
import { InteractiveElement } from '../InteractiveElement';
import { ArcadeTokenShopModal } from './ArcadeTokenShopModal';
import { ElevatorModal } from '../ElevatorModal';
import { ArcadeMachine } from './ArcadeMachine';
import { ArcadeGameShell } from './ArcadeGameShell';
import { PrizeCounter } from './prizes/PrizeCounter';
import { ArcadePassOffer } from './prizes/ArcadePassOffer';
import { ArcadeCosmeticRedeemAction } from './prizes/ArcadeCosmeticRedeemAction';
import { ArcadeCatalogueShell } from './ArcadeCatalogue';
import { ArcadeDedicatedPreview } from './ArcadeDedicatedPreview';
import { resolveNativeArcadeGame } from './native-games';
import { NativeGameHost } from './NativeGameHost';

import {
  arcadeBoundaryForFloor,
  arcadeMachinesForFloor,
  getArcadeMachine,
  type ArcadeFloorId,
} from '@/lib/arcade-machines-config';
import { canLaunchArcadeGame, getCatalogueEntry, sharedCabinetCatalogue } from '@/arcade/catalogue';
import {
  ARCADE_VIEW_CLOSED,
  closeArcadeView,
  exitGame,
  launchGame,
  openCatalogue,
  openDedicatedGame,
  openDedicatedPreview,
  openNotice,
  type ArcadeView,
} from '@/arcade/arcade-navigation';
import {
  ARCADE_ELEVATOR_DOOR_SRC,
  ARCADE_ELEVATOR_Z_INDEX,
  ARCADE_PRIZE_COUNTER,
  ARCADE_TICKET_COUNTER,
  arcadeBasementSeatGroups,
  arcadeElevatorByFloor,
  arcadeElevatorStandPoint,
  arcadePropsByFloor,
} from '@/lib/arcade-room-config';
import {
  INITIAL_ARCADE_MACHINE_STATE,
  arcadeMachineReducer,
} from '@/arcade/arcade-machine-state';

/**
 * ArcadeRoom: all three arcade floors, extracted from `InteractiveElements`.
 *
 * `InteractiveElements.tsx` was 1549 lines with twelve sequential location
 * branches and every room's modal state hoisted into one component. The arcade's
 * branch alone held nine machines, four chairs, two counters, an elevator, four
 * modals and the "which game is this?" dispatch, and adding a real game to that
 * would have compounded the problem rather than solved it.
 *
 * What lives here now:
 *  - the three floors' artwork, unchanged in placement and stacking;
 *  - the nine machines, from the registry, each with walk-to-interact;
 *  - the arcade lifecycle state machine and the shared game shell;
 *  - the pass / elevator / no-pass modals.
 *
 * What does NOT live here: any product copy (it is in the machine registry and
 * the catalogue), any game logic, and any inventory or Nostr write (the arcade
 * performs none).
 *
 * ## Two state machines, kept apart (Phase 4)
 *
 * - **`view`** (`arcade-navigation.ts`): which SCREEN is up: nothing, the
 *   catalogue, a game, or a notice panel. Walking up to a cabinet opens the
 *   catalogue and starts no run at all.
 * - **`lifecycle`** (`arcade-machine-state.ts`): whether a RUN exists, whether
 *   it may advance, and whether it may be rewarded. Untouched by this phase.
 *
 * They move together in exactly three handlers, arriving at a dedicated game
 * machine opens both, selecting from the catalogue opens both, and leaving a
 * game closes the run and steps the view back. There is no fourth place that
 * changes one of them, which is why they cannot drift.
 *
 * ## Three flows, because the arcade has two kinds of machine
 *
 * ```
 *   generic cabinet (×6)   Room ──► Shared catalogue ──► Room
 *   dance machine          Room ──► Blobbi Dance (preview → run → results) ──► Room
 *   pool / air hockey      Room ──► that game's own coming-soon screen ──► Room
 * ```
 *
 * `handleMachineArrival` switches on the machine's `activation` field and does
 * nothing else: no branch on an id, a filename or a display name. That is what
 * makes "a pool table is a pool table" a property of the data rather than of
 * this component.
 *
 * A run that is interrupted (tab hidden) does NOT jump back on its own: the game
 * shows what happened and offers Play again, and the player leaves when they
 * choose. A run the player explicitly leaves is aborted through the reducer and
 * lands wherever `exitGame` says, the catalogue it came from, or the room.
 */

interface ArcadeRoomProps {
  blobbiRef: React.RefObject<MovableBlobbiRef>;
  /** Which floor to draw, resolved from the current background file. */
  floor: ArcadeFloorId;
  /** Selected Blobbi id, used only to invalidate pending walks when it changes. */
  selectedBlobbiId?: string | null;
}

export function ArcadeRoom({ blobbiRef, floor, selectedBlobbiId = null }: ArcadeRoomProps) {
  const { currentLocation, setCurrentLocation } = useLocation();

  const [isElevatorHovered, setIsElevatorHovered] = useState(false);
  const [isTokenShopOpen, setIsTokenShopOpen] = useState(false);
  const [isElevatorModalOpen, setIsElevatorModalOpen] = useState(false);
  /** Which screen is up. Never a run; see the two-state-machines note above. */
  const [view, setView] = useState<ArcadeView>(ARCADE_VIEW_CLOSED);
  /**
   * Why the last launch was refused, shown on the catalogue.
   *
   * It exists because "nothing happened" is the worst possible answer to a tap.
   * A coming-soon card has no button at all, so this is only reachable when the
   * catalogue and the resolver disagree, which is a bug, and should say so
   * plainly rather than silently doing nothing.
   */
  const [launchError, setLaunchError] = useState<string | null>(null);

  // The shared minigame lifecycle. It is opened only when a game is launched
  // from the catalogue, and closed whenever the player steps back out of one.
  const [lifecycle, dispatch] = useReducer(
    arcadeMachineReducer,
    INITIAL_ARCADE_MACHINE_STATE,
  );

  const pending = usePendingInteraction({
    blobbiRef,
    cancelKey: `${currentLocation}:${selectedBlobbiId ?? ''}`,
  });
  const { requestInteraction } = pending;
  useCancelInteractionOnWorldClick(pending, currentLocation);

  const machines = useMemo(() => arcadeMachinesForFloor(floor), [floor]);
  const cabinetsHaveGames = useMemo(() => sharedCabinetCatalogue().length > 0, []);
  const props = arcadePropsByFloor[floor];
  const elevator = arcadeElevatorByFloor[floor];
  /*
   * Every walk-to target in this room is clamped into the floor's boundary.
   *
   * Without it, the ticket and prize counters are unreachable: they are mounted
   * high on the back wall, above the walkable `y ≥ 48` floor, and
   * `MovableBlobbi` clamps each animation STEP rather than the target, so the
   * Blobbi slides along the floor's top edge until it hits a wall, never closes
   * the distance, and the pending interaction never fires. Browser-reproduced.
   */
  const walkBoundary = arcadeBoundaryForFloor(floor);
  const elevatorStand = arcadeElevatorStandPoint[floor];

  /**
   * Fired on CONFIRMED ARRIVAL at a machine, never on click.
   *
   * One `switch` over the machine's declared `activation`, and nothing else. No
   * branch on an id, a filename, a display name or a piece of artwork, which is
   * what makes "a pool table opens pool" a property of the registry that a test
   * can check, rather than a convention this component happens to follow.
   *
   * A dedicated game opens with NO menu in between, because the physical object
   * is the game. If its renderer cannot be resolved (a registry entry with no
   * implementation), it falls back to that same game's coming-soon screen,
   * which is the honest thing to show, and is never another game's.
   */
  const handleMachineArrival = useCallback((machineId: string) => {
    const machine = getArcadeMachine(machineId);
    if (!machine) return;
    setLaunchError(null);

    const activation = machine.activation;
    if (activation.type === 'shared-catalogue') {
      setView(openCatalogue(machineId));
      return;
    }

    if (activation.type === 'dedicated-preview') {
      setView(openDedicatedPreview(machineId, activation.experienceId));
      return;
    }

    const entry = getCatalogueEntry(activation.gameId);
    const canLaunch = resolveNativeArcadeGame({
      game: entry,
      machineId,
      surface: 'dedicated-machine',
    });
    if (!entry || !canLaunch) {
      setView(openDedicatedPreview(machineId, activation.gameId));
      return;
    }
    // Both state machines move together: the view opens the game, and the
    // lifecycle opens a run slot on THIS machine, which is what carries a
    // correct `machineId` into the result and the reward claim.
    dispatch({ type: 'open', machineId, gameId: entry.id });
    setView(openDedicatedGame(machineId, entry.id));
  }, []);

  const handlePrizeCounterArrival = useCallback(() => {
    setView(openNotice(ARCADE_PRIZE_COUNTER.id));
  }, []);

  /**
   * Launch a game from the SHARED catalogue, on the generic cabinet the player
   * walked to.
   *
   * Nothing reaches this today, no game is offered by the shared cabinets, and
   * the checks matter for exactly that reason: the first game added must not be
   * able to skip them. `canLaunchArcadeGame` refuses a dedicated-machine game
   * here on `host`, so Blobbi Dance can never be started from a cabinet however
   * a caller asks.
   */
  const handleSelectGame = useCallback(
    (gameId: string) => {
      if (view.kind !== 'catalogue') return;
      const entry = getCatalogueEntry(gameId);
      if (!entry) {
        setLaunchError('That game is not in the arcade.');
        return;
      }
      const request = {
        game: entry,
        machineId: view.machineId,
        surface: 'shared-catalogue' as const,
      };
      if (!canLaunchArcadeGame(request) || !resolveNativeArcadeGame(request)) {
        setLaunchError(`${entry.title} cannot be played on this cabinet.`);
        return;
      }
      setLaunchError(null);
      dispatch({ type: 'open', machineId: view.machineId, gameId: entry.id });
      setView((current) => launchGame(current, entry.id));
    },
    [view],
  );

  /**
   * Leave the game, landing where the player came from.
   *
   * `close` aborts a live run and records it as aborted, so leaving mid-song is
   * never silently forgiven. WHERE it lands is `exitGame`'s decision: back to
   * the catalogue for a catalogue-launched game, out to the room for a dedicated
   * machine's own game. Blobbi Dance is the second kind, so leaving it returns
   * the player to the arcade; not to a list that does not contain it.
   */
  const handleExitGame = useCallback(() => {
    dispatch({ type: 'close' });
    setLaunchError(null);
    setView((current) => exitGame(current));
  }, []);

  /** Dismiss everything and hand the room back. */
  const closeShell = useCallback(() => {
    dispatch({ type: 'close' });
    setLaunchError(null);
    setView(closeArcadeView());
  }, []);

  /**
   * The elevator is open to everyone.
   *
   * It used to demand a Coin-bought Arcade Pass, which made the pass a
   * TOLLGATE on the arcade itself. The redesign moves the cost to the games
   * (one Arcade Token each) and turns the pass into a premium Ticket reward
   * that waives that cost, so exploring the floors, reading the catalogues
   * and browsing the prize counter are free, as they should always have been.
   */
  const handleElevatorClick = useCallback(() => setIsElevatorModalOpen(true), []);

  /** The machine the open view belongs to, for its title and its artwork. */
  const openMachine = useMemo(
    () => (view.kind === 'closed' ? undefined : getArcadeMachine(view.machineId)),
    [view],
  );

  /**
   * The game to mount, resolved fresh from the view.
   *
   * `null` for anything that must not run, checked HERE as well as at every
   * entry point, and with the same surface the view was opened from, so a game
   * cannot be rendered under a rule looser than the one that let it in.
   */
  const activeGame = useMemo(() => {
    if (view.kind !== 'game') return null;
    const entry = getCatalogueEntry(view.gameId);
    const request = {
      game: entry,
      machineId: view.machineId,
      surface:
        view.from === 'shared-catalogue'
          ? ('shared-catalogue' as const)
          : ('dedicated-machine' as const),
    };
    const render = resolveNativeArcadeGame(request);
    return entry && render ? { entry, render, from: view.from } : null;
  }, [view]);

  return (
    <>
      <div className="w-full h-full relative">
        {/*
          Elevator. Fixed at `ARCADE_ELEVATOR_Z_INDEX` (8) on every floor, the
          explicit layering rule that replaces the old `z-10` tie with the
          ground floor's Blobbi depth band, which markup order resolved in the
          doors' favour and drew the Blobbi INSIDE a closed elevator.
        */}
        <div
          className={cn(
            'absolute flex left-1/2 -translate-x-1/2 overflow-hidden',
            elevator.containerClassName,
          )}
          style={{ zIndex: ARCADE_ELEVATOR_Z_INDEX }}
          onMouseEnter={() => setIsElevatorHovered(true)}
          onMouseLeave={() => setIsElevatorHovered(false)}
        >
          <InteractiveElement
            src={ARCADE_ELEVATOR_DOOR_SRC}
            alt="Elevator, left door"
            effect="slide"
            slideDirection="right"
            className="scale-x-[-1]"
            onClick={handleElevatorClick}
            requestInteraction={requestInteraction}
            walkTarget={elevatorStand}
            isHovered={isElevatorHovered}
          />
          <InteractiveElement
            src={ARCADE_ELEVATOR_DOOR_SRC}
            alt="Elevator, right door"
            effect="slide"
            slideDirection="right"
            onClick={handleElevatorClick}
            requestInteraction={requestInteraction}
            walkTarget={elevatorStand}
            isHovered={isElevatorHovered}
          />
        </div>

        {/*
          Decoration. Every one of these carried `alt="ticket counter"`; they are
          scenery, so they carry no label at all and are hidden from assistive
          technology. `pointer-events-none` keeps them from swallowing a click
          that should walk the Blobbi across the room.
        */}
        {props.map((prop) => (
          <img
            key={prop.id}
            src={prop.src}
            alt=""
            aria-hidden
            draggable={false}
            data-arcade-prop={prop.id}
            className={cn(prop.className, 'pointer-events-none select-none')}
          />
        ))}

        {/* Basement seating: two tables, four distinctly-named chairs. */}
        {floor === 'basement' &&
          arcadeBasementSeatGroups.map((group) => (
            <div key={group.id} className={group.className}>
              {group.seats.map((seat) => (
                <InteractiveElement
                  key={seat.id}
                  src={seat.src}
                  alt={seat.alt}
                  effect="scale"
                  className={cn('absolute', seat.className)}
                  /*
                    Walking to a chair and standing there is all these have ever
                    done: there is no seated pose or state in the arcade. They
                    now go through the shared walk-to-interact system instead of
                    a handler that located its container with
                    `closest('.w-full.h-full.relative')`, a class-string lookup
                    that would have silently stopped working on any refactor.
                  */
                  onClick={() => {}}
                  requestInteraction={requestInteraction}
                  walkBoundary={walkBoundary}
                />
              ))}
              <img
                src={group.tableSrc}
                alt=""
                aria-hidden
                draggable={false}
                className={cn(group.tableClassName, 'pointer-events-none select-none')}
              />
            </div>
          ))}

        {/* The machines. */}
        {machines.map((machine) => (
          <ArcadeMachine
            key={machine.id}
            config={machine}
            requestInteraction={requestInteraction}
            onActivate={handleMachineArrival}
            // A generic cabinet is only a machine while the shared catalogue has
            // something for it to run; until then it is part of the room.
            decorative={machine.activation.type === 'shared-catalogue' && !cabinetsHaveGames}
          />
        ))}

        {/* Ground-floor counters. */}
        {floor === 'ground' && (
          <>
            <div className={ARCADE_TICKET_COUNTER.containerClassName}>
              <img
                src={ARCADE_TICKET_COUNTER.baseSrc}
                alt=""
                aria-hidden
                draggable={false}
                className="absolute pointer-events-none select-none"
              />
              <InteractiveElement
                src={ARCADE_TICKET_COUNTER.windowSrc}
                alt={ARCADE_TICKET_COUNTER.alt}
                effect="opacity"
                className="absolute"
                onClick={() => setIsTokenShopOpen(true)}
                requestInteraction={requestInteraction}
                walkTarget={ARCADE_TICKET_COUNTER.interactionPoint}
              />
            </div>

            {/*
              The PRIZES counter. Its only previous effect was a `console.log`,
              it did not even walk the Blobbi over. It keeps its affordance
              because the prize shop is a real planned feature, and it now says
              so instead of doing nothing.
            */}
            <div className={ARCADE_PRIZE_COUNTER.containerClassName}>
              <InteractiveElement
                src={ARCADE_PRIZE_COUNTER.src}
                alt={ARCADE_PRIZE_COUNTER.alt}
                animated={false}
                effect="scale"
                onClick={handlePrizeCounterArrival}
                requestInteraction={requestInteraction}
                walkTarget={ARCADE_PRIZE_COUNTER.interactionPoint}
              />
            </div>
          </>
        )}
      </div>

      {/*
        Modals are mounted only while open. The pass modal used to be mounted
        unconditionally on all three floors, running two live TanStack queries
        behind a closed dialog.
      */}
      {isTokenShopOpen && (
        <ArcadeTokenShopModal isOpen onClose={() => setIsTokenShopOpen(false)} />
      )}
      {isElevatorModalOpen && (
        <ElevatorModal isOpen onClose={() => setIsElevatorModalOpen(false)} />
      )}

      {/*
        The shared catalogue: the SIX generic cabinets only. The dance machine,
        the pool table and the air hockey table never reach this branch, because
        their `activation` sends them somewhere else.
      */}
      {view.kind === 'catalogue' && (
        <ArcadeCatalogueShell
          open
          machineId={view.machineId}
          machineName={openMachine?.displayName ?? 'Arcade Cabinet'}
          machineImage={openMachine?.src}
          onSelect={handleSelectGame}
          onClose={closeShell}
          launchError={launchError}
        />
      )}

      {/*
        The running game, which brings its own shell: a playable game needs a
        pause control, footer actions and a reward panel that a catalogue has no
        use for. It is mounted only while a run slot is open, so closing one can
        never leave a timer or an audio node alive behind a hidden dialog.

        The dismiss label is decided HERE, because the room is what knows where
        leaving lands.
      */}
      {view.kind === 'game' && activeGame && lifecycle.status !== 'closed' && (
        <NativeGameHost
          render={activeGame.render}
          props={{
            machineId: view.machineId,
            entry: activeGame.entry,
            lifecycle,
            dispatch,
            onExit: handleExitGame,
            exitLabel:
              activeGame.from === 'shared-catalogue' ? 'Back to games' : 'Back to the arcade',
            exitAriaLabel:
              activeGame.from === 'shared-catalogue'
                ? 'Back to the game list'
                : 'Back to the arcade room',
          }}
        />
      )}

      {/*
        A dedicated machine whose game is not built: the pool table, the air
        hockey table. Each talks about ITS OWN game and offers no Start, because
        there is nothing to start.
      */}
      {view.kind === 'preview' && (
        <ArcadeDedicatedPreview
          open
          machineId={view.machineId}
          experienceId={view.experienceId}
          onClose={closeShell}
        />
      )}

      {/* The prize counter: not a game, and it does not pretend to be one. */}
      {view.kind === 'notice' && (
        <ArcadeGameShell
          open
          onClose={closeShell}
          title={ARCADE_PRIZE_COUNTER.displayName}
          description={ARCADE_PRIZE_COUNTER.blurb}
          machineId={ARCADE_PRIZE_COUNTER.id}
          surface="notice"
          closeLabel="Close"
          closeAriaLabel="Close and go back to the arcade"
          /*
            The counter owns its own scrolling (shelf and detail scroll
            independently) and fills the box, so the shell's padding is off and
            its scroll engages ONLY below the counter's minimum height (a squat
            desktop window): never as a second scrollbar in normal use.
          */
          contentClassName="overflow-y-auto p-0"
        >
          {/*
            Both live redemptions are passed IN rather than imported by the
            counter, so the shelf's write-free import graph stays provable
            while real ticket spending happens on the same surface: the Pass as
            a node above the shelf, the cosmetics as a render function the
            detail panel calls for whichever prize is selected.
          */}
          <PrizeCounter
            featureSlot={<ArcadePassOffer />}
            redeemSlot={(resolved) => (
              <ArcadeCosmeticRedeemAction key={resolved.prize.d} resolved={resolved} />
            )}
          />
        </ArcadeGameShell>
      )}

      <BackArrow
        onClick={() => setCurrentLocation('town')}
        className="absolute top-[5%] left-4 w-12 h-12 z-20 text-current"
      />
    </>
  );
}
