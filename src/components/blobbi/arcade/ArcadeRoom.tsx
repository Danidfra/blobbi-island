import React, { useCallback, useMemo, useReducer, useState } from 'react';
import { cn } from '@/lib/utils';

import { useLocation } from '@/hooks/useLocation';
import { useArcadePass } from '@/hooks/useArcadePass';
import { usePendingInteraction } from '@/hooks/usePendingInteraction';
import { useCancelInteractionOnWorldClick } from '@/hooks/useCancelInteractionOnWorldClick';
import type { MovableBlobbiRef } from '../MovableBlobbi';
import { BackArrow } from '../BackArrow';
import { InteractiveElement } from '../InteractiveElement';
import { ArcadePassModal } from '../ArcadePassModal';
import { ElevatorModal } from '../ElevatorModal';
import { NoPassModal } from '../NoPassModal';
import { ArcadeMachine } from './ArcadeMachine';
import { ArcadeGameShell } from './ArcadeGameShell';
import { ArcadeMachinePanel } from './ArcadeMachinePanel';
import { DanceMachine } from './dance/DanceMachine';

import {
  BLOBBI_DANCE_GAME_ID,
  arcadeBoundaryForFloor,
  arcadeMachinesForFloor,
  getArcadeMachine,
  type ArcadeFloorId,
} from '@/lib/arcade-machines-config';
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
 * ArcadeRoom — all three arcade floors, extracted from `InteractiveElements`.
 *
 * `InteractiveElements.tsx` was 1549 lines with twelve sequential location
 * branches and every room's modal state hoisted into one component. The arcade's
 * branch alone held nine machines, four chairs, two counters, an elevator, four
 * modals and the "which game is this?" dispatch — and adding a real game to that
 * would have compounded the problem rather than solved it.
 *
 * What lives here now:
 *  - the three floors' artwork, unchanged in placement and stacking;
 *  - the nine machines, from the registry, each with walk-to-interact;
 *  - the arcade lifecycle state machine and the shared game shell;
 *  - the pass / elevator / no-pass modals.
 *
 * What does NOT live here: any product copy (it is in the machine registry), any
 * game logic (there is none yet), and any inventory or Nostr write (the arcade
 * performs none).
 */

interface ArcadeRoomProps {
  blobbiRef: React.RefObject<MovableBlobbiRef>;
  /** Which floor to draw, resolved from the current background file. */
  floor: ArcadeFloorId;
  /** Selected Blobbi id, used only to invalidate pending walks when it changes. */
  selectedBlobbiId?: string | null;
}

/** Everything the shell can be opened for: a machine, or the prize counter. */
type ArcadeTarget =
  | { kind: 'machine'; id: string }
  | { kind: 'prize-counter' };

export function ArcadeRoom({ blobbiRef, floor, selectedBlobbiId = null }: ArcadeRoomProps) {
  const { currentLocation, setCurrentLocation } = useLocation();
  const hasPass = useArcadePass();

  const [isElevatorHovered, setIsElevatorHovered] = useState(false);
  const [isPassModalOpen, setIsPassModalOpen] = useState(false);
  const [isElevatorModalOpen, setIsElevatorModalOpen] = useState(false);
  const [isNoPassModalOpen, setIsNoPassModalOpen] = useState(false);
  const [target, setTarget] = useState<ArcadeTarget | null>(null);

  // The shared minigame lifecycle. In this phase it never leaves `closed` or
  // `preview` — no machine has a runnable game — but the shell, the room and the
  // future controller all read the same state value from day one.
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
  const props = arcadePropsByFloor[floor];
  const elevator = arcadeElevatorByFloor[floor];
  /*
   * Every walk-to target in this room is clamped into the floor's boundary.
   *
   * Without it, the ticket and prize counters are unreachable: they are mounted
   * high on the back wall, above the walkable `y ≥ 48` floor, and
   * `MovableBlobbi` clamps each animation STEP rather than the target — so the
   * Blobbi slides along the floor's top edge until it hits a wall, never closes
   * the distance, and the pending interaction never fires. Browser-reproduced.
   */
  const walkBoundary = arcadeBoundaryForFloor(floor);
  const elevatorStand = arcadeElevatorStandPoint[floor];

  /** Fired on CONFIRMED ARRIVAL at a machine, never on click. */
  const handleMachineArrival = useCallback((machineId: string) => {
    const machine = getArcadeMachine(machineId);
    if (!machine) return;
    setTarget({ kind: 'machine', id: machineId });
    dispatch({ type: 'open', machineId, gameId: machine.gameId });
  }, []);

  const handlePrizeCounterArrival = useCallback(() => {
    setTarget({ kind: 'prize-counter' });
    dispatch({ type: 'open', machineId: ARCADE_PRIZE_COUNTER.id });
  }, []);

  const closeShell = useCallback(() => {
    // `close` aborts a live run; nothing can be live in this phase, but the
    // controller must go through the reducer so that stays true when one can.
    dispatch({ type: 'close' });
    setTarget(null);
  }, []);

  const handleElevatorClick = useCallback(() => {
    if (hasPass) setIsElevatorModalOpen(true);
    else setIsNoPassModalOpen(true);
  }, [hasPass]);

  /**
   * The one machine with a real game.
   *
   * Resolved from the OPEN target's configured `gameId`, never from its id or
   * its artwork — so a machine becomes playable by being given a game, which is
   * the property that stops the other eight from opening a rhythm game the way
   * all nine used to.
   */
  const danceMachine = useMemo(() => {
    if (target?.kind !== 'machine') return null;
    const machine = getArcadeMachine(target.id);
    return machine?.gameId === BLOBBI_DANCE_GAME_ID ? machine : null;
  }, [target]);

  const shellContent = useMemo(() => {
    if (!target || danceMachine) return null;
    if (target.kind === 'prize-counter') {
      return {
        title: ARCADE_PRIZE_COUNTER.displayName,
        gameId: null as string | null,
        machineId: ARCADE_PRIZE_COUNTER.id,
        panel: (
          <ArcadeMachinePanel
            displayName={ARCADE_PRIZE_COUNTER.displayName}
            availability="coming-soon"
            blurb={ARCADE_PRIZE_COUNTER.blurb}
          />
        ),
      };
    }
    const machine = getArcadeMachine(target.id);
    if (!machine) return null;
    return {
      title: machine.displayName,
      gameId: machine.gameId,
      machineId: machine.id,
      panel: (
        <ArcadeMachinePanel
          displayName={machine.displayName}
          availability={machine.availability}
          blurb={machine.blurb}
          showControls={machine.availability === 'preview'}
        />
      ),
    };
  }, [target, danceMachine]);

  return (
    <>
      <div className="w-full h-full relative">
        {/*
          Elevator. Fixed at `ARCADE_ELEVATOR_Z_INDEX` (8) on every floor — the
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
                    done — there is no seated pose or state in the arcade. They
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
                onClick={() => setIsPassModalOpen(true)}
                requestInteraction={requestInteraction}
                walkTarget={ARCADE_TICKET_COUNTER.interactionPoint}
              />
            </div>

            {/*
              The PRIZES counter. Its only previous effect was a `console.log` —
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
        Modals are mounted only while open. `ArcadePassModal` used to be mounted
        unconditionally on all three floors, running two live TanStack queries
        behind a closed dialog.
      */}
      {isPassModalOpen && (
        <ArcadePassModal isOpen onClose={() => setIsPassModalOpen(false)} />
      )}
      {isElevatorModalOpen && (
        <ElevatorModal isOpen onClose={() => setIsElevatorModalOpen(false)} />
      )}
      {isNoPassModalOpen && (
        <NoPassModal isOpen onClose={() => setIsNoPassModalOpen(false)} />
      )}

      {/*
        The dance machine brings its own shell, because a playable game needs
        footer actions, a pause control and a reward panel that a coming-soon
        panel has no use for. Every other machine keeps the plain honest one.
      */}
      {danceMachine && lifecycle.status !== 'closed' && (
        <DanceMachine
          machine={danceMachine}
          lifecycle={lifecycle}
          dispatch={dispatch}
          onClose={closeShell}
        />
      )}

      {shellContent && (
        <ArcadeGameShell
          open={lifecycle.status !== 'closed'}
          onClose={closeShell}
          title={shellContent.title}
          machineId={shellContent.machineId}
          gameId={shellContent.gameId}
          status={lifecycle.status}
        >
          {shellContent.panel}
        </ArcadeGameShell>
      )}

      <BackArrow
        onClick={() => setCurrentLocation('town')}
        className="absolute top-[5%] left-4 w-12 h-12 z-20 text-current"
      />
    </>
  );
}
