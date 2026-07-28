/**
 * Configuration tests for the arcade registry.
 *
 * The audit found nine machines that all opened the same "Dance Dance Blobbi"
 * modal, two cabinets sharing an `alt`, a pool table labelled as a green
 * cabinet, and thirty decorative sprites announcing themselves as a ticket
 * counter. Every one of those was a data mistake, so every one of them is
 * checkable here.
 */
import { describe, it, expect } from 'vitest';

import {
  ARCADE_BACKGROUND_FILES,
  ARCADE_FLOORS,
  ARCADE_WORLD_HEIGHT,
  ARCADE_WORLD_WIDTH,
  BLOBBI_DANCE_GAME_ID,
  arcadeBoundaryForFloor,
  arcadeFloorForBackground,
  arcadeMachines,
  arcadeMachinesForFloor,
  getArcadeMachine,
  isArcadeBackground,
  machineAnchorPosition,
  machineHeightPercent,
  machineLeftPercent,
  type ArcadeFloorId,
} from './arcade-machines-config';
import {
  ARCADE_ELEVATOR_Z_INDEX,
  ARCADE_PRIZE_COUNTER,
  ARCADE_TICKET_COUNTER,
  arcadeBasementSeatGroups,
  arcadeElevatorStandPoint,
  arcadePropsByFloor,
} from './arcade-room-config';
import { ARCADE_ELEVATOR_ALCOVE } from './location-initial-position';
import { backgroundZIndexConfigs } from './interactive-elements-config';
import { constrainPosition } from './boundaries';
import { arcadeRewardPolicies } from '@/arcade/reward-policy';

const FLOORS: ArcadeFloorId[] = ['ground', 'floor-1', 'basement'];

describe('machine identity', () => {
  it('gives every machine a unique id', () => {
    const ids = arcadeMachines.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every machine a unique display name', () => {
    const names = arcadeMachines.map((m) => m.displayName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every machine a unique, non-empty accessible name', () => {
    const alts = arcadeMachines.map((m) => m.alt);
    expect(new Set(alts).size).toBe(alts.length);
    for (const alt of alts) expect(alt.trim().length).toBeGreaterThan(0);
  });

  it('does not derive identity from the artwork filename', () => {
    // `snooker.png` is a pool table and `arcade-machine-green.png` is a green
    // cabinet; the two used to share the alt "Arcade Machine Green".
    const pool = getArcadeMachine('arcade-pool-table');
    const green = getArcadeMachine('arcade-cabinet-green');

    expect(pool?.src).toContain('snooker.png');
    expect(pool?.displayName).toBe('Pool Table');
    expect(green?.displayName).toBe('Green Cabinet');
    expect(pool?.alt).not.toBe(green?.alt);
  });

  it('never labels a table as a cabinet, or a cabinet as a dance game', () => {
    for (const machine of arcadeMachines) {
      const label = `${machine.displayName} ${machine.alt}`.toLowerCase();
      if (machine.id === 'arcade-pool-table' || machine.id === 'arcade-air-hockey') {
        expect(label).not.toContain('cabinet');
      }
      if (machine.id !== 'arcade-dance-machine') {
        expect(label).not.toContain('dance');
      }
    }
  });

  it('resolves a machine by id and nothing for an unknown one', () => {
    expect(getArcadeMachine('arcade-dance-machine')?.id).toBe('arcade-dance-machine');
    expect(getArcadeMachine('nope')).toBeUndefined();
    expect(getArcadeMachine(null)).toBeUndefined();
  });

  it('registers exactly the nine machines the rooms draw', () => {
    expect(arcadeMachines).toHaveLength(9);
    expect(arcadeMachinesForFloor('floor-1')).toHaveLength(8);
    expect(arcadeMachinesForFloor('basement')).toHaveLength(1);
    expect(arcadeMachinesForFloor('ground')).toHaveLength(0);
  });
});

describe('game assignment', () => {
  it('assigns the dance game to the basement dance machine and to nothing else', () => {
    const withGames = arcadeMachines.filter((m) => m.gameId !== null);
    expect(withGames.map((m) => m.id)).toEqual(['arcade-dance-machine']);
    expect(withGames[0].gameId).toBe(BLOBBI_DANCE_GAME_ID);
    expect(withGames[0].floor).toBe('basement');
  });

  it('marks every machine without a game as coming-soon', () => {
    for (const machine of arcadeMachines) {
      if (machine.gameId === null) expect(machine.availability).toBe('coming-soon');
      else expect(machine.availability).toBe('preview');
    }
  });

  it('uses a game id that is not a Nostr address or an item id', () => {
    expect(BLOBBI_DANCE_GAME_ID).toBe('blobbi-dance');
    expect(BLOBBI_DANCE_GAME_ID).not.toMatch(/^\d+:/); // not an naddr coordinate
    expect(BLOBBI_DANCE_GAME_ID).not.toContain(':'); // not `blobbi:currency:...`
  });

  it('has a reward policy registered for the one game that exists', () => {
    expect(arcadeRewardPolicies.map((p) => p.gameId)).toContain(BLOBBI_DANCE_GAME_ID);
  });

  it('gives every machine an honest, non-empty blurb', () => {
    for (const machine of arcadeMachines) {
      expect(machine.blurb.trim().length).toBeGreaterThan(0);
      // No coming-soon machine may imply something is playable now.
      if (machine.availability === 'coming-soon') {
        expect(machine.blurb.toLowerCase()).toMatch(/not|no game|yet/);
      }
    }
  });
});

describe('floor ownership and render order', () => {
  it('places every machine on a real arcade floor', () => {
    for (const machine of arcadeMachines) {
      expect(FLOORS).toContain(machine.floor);
      expect(ARCADE_FLOORS[machine.floor]).toBeDefined();
    }
  });

  it('maps background files to floors both ways', () => {
    for (const floor of FLOORS) {
      const background = ARCADE_FLOORS[floor];
      expect(isArcadeBackground(background)).toBe(true);
      expect(arcadeFloorForBackground(background)).toBe(floor);
    }
    expect(isArcadeBackground('town-open.webp')).toBe(false);
    expect(arcadeFloorForBackground('stage-inside.png')).toBeNull();
  });

  it('knows a walk boundary for every arcade floor', () => {
    for (const floor of FLOORS) expect(arcadeBoundaryForFloor(floor)).toBeDefined();
    for (const file of ARCADE_BACKGROUND_FILES) {
      expect(backgroundZIndexConfigs.some((c) => c.backgroundFile === file)).toBe(true);
    }
  });

  it('returns machines in a deterministic back-to-front order', () => {
    for (const floor of FLOORS) {
      const zIndexes = arcadeMachinesForFloor(floor).map((m) => m.zIndex);
      expect(zIndexes).toEqual([...zIndexes].sort((a, b) => a - b));
    }
    // Stable across calls — the same array contents every time.
    expect(arcadeMachinesForFloor('floor-1').map((m) => m.id)).toEqual(
      arcadeMachinesForFloor('floor-1').map((m) => m.id),
    );
  });
});

describe('placement', () => {
  it('keeps every machine inside the world', () => {
    for (const machine of arcadeMachines) {
      const left = machineLeftPercent(machine);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + machine.widthPercent).toBeLessThanOrEqual(100);
      expect(machine.widthPercent).toBeGreaterThan(0);
      expect(machine.bottomPercent).toBeGreaterThanOrEqual(0);
      expect(machineHeightPercent(machine)).toBeGreaterThan(0);
      expect(machine.bottomPercent + machineHeightPercent(machine)).toBeLessThanOrEqual(100);
    }
  });

  it('derives sprite height from the real artwork ratio', () => {
    const dance = getArcadeMachine('arcade-dance-machine')!;
    // 162 × 162 art rendered at its intrinsic width inside a 1046 × 697 world.
    expect(dance.widthPercent).toBeCloseTo((162 / ARCADE_WORLD_WIDTH) * 100, 6);
    expect(machineHeightPercent(dance)).toBeCloseTo((162 / ARCADE_WORLD_HEIGHT) * 100, 6);
  });

  it('gives every machine an interaction anchor near its base, not its centre', () => {
    for (const machine of arcadeMachines) {
      const { x, y } = machine.interactionAnchor;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      // Aiming at the middle of a cabinet walks the Blobbi INTO the artwork.
      expect(y).toBeGreaterThan(0.75);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it('lands every interaction anchor on walkable floor', () => {
    for (const machine of arcadeMachines) {
      const boundary = arcadeBoundaryForFloor(machine.floor)!;
      const anchor = machineAnchorPosition(machine);
      const constrained = constrainPosition(anchor, boundary);

      // If the anchor were outside the walk boundary, `constrainPosition` would
      // move it — and the Blobbi would stop somewhere other than the machine.
      expect(constrained.x).toBeCloseTo(anchor.x, 6);
      expect(constrained.y).toBeCloseTo(anchor.y, 6);
    }
  });

  it('gives no two machines on a floor the same anchor point', () => {
    for (const floor of FLOORS) {
      const anchors = arcadeMachinesForFloor(floor).map((m) => {
        const p = machineAnchorPosition(m);
        return `${p.x.toFixed(3)}:${p.y.toFixed(3)}`;
      });
      expect(new Set(anchors).size).toBe(anchors.length);
    }
  });
});

describe('decorative art is not represented as a machine', () => {
  it('keeps every prop out of the machine registry', () => {
    const machineSrcs = new Set(arcadeMachines.map((m) => m.src));
    for (const floor of FLOORS) {
      for (const prop of arcadePropsByFloor[floor]) {
        expect(machineSrcs.has(prop.src)).toBe(false);
      }
    }
  });

  it('gives props no label at all — they cannot carry a wrong one', () => {
    for (const floor of FLOORS) {
      for (const prop of arcadePropsByFloor[floor]) {
        expect(prop).not.toHaveProperty('alt');
        expect(prop.id.trim().length).toBeGreaterThan(0);
        expect(prop.className.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('gives every prop a unique id within its floor', () => {
    for (const floor of FLOORS) {
      const ids = arcadePropsByFloor[floor].map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('treats the stage microphone as scenery, not as a machine', () => {
    const mic = arcadePropsByFloor.basement.find((p) => p.id === 'stage-microphone');
    expect(mic).toBeDefined();
    expect(arcadeMachines.some((m) => m.src.endsWith('/mic.png'))).toBe(false);
  });
});

describe('basement seating', () => {
  it('describes two tables with four distinctly named chairs', () => {
    expect(arcadeBasementSeatGroups).toHaveLength(2);

    const seats = arcadeBasementSeatGroups.flatMap((g) => g.seats);
    expect(seats).toHaveLength(4);

    const ids = seats.map((s) => s.id);
    const alts = seats.map((s) => s.alt);
    expect(new Set(ids).size).toBe(4);
    expect(new Set(alts).size).toBe(4);
    for (const alt of alts) expect(alt.trim().length).toBeGreaterThan(0);
  });
});

describe('counters and elevator', () => {
  it('names both ground-floor counters for what they do', () => {
    expect(ARCADE_TICKET_COUNTER.alt.toLowerCase()).toContain('arcade pass');
    expect(ARCADE_PRIZE_COUNTER.alt.toLowerCase()).toContain('prize');
    expect(ARCADE_PRIZE_COUNTER.blurb.toLowerCase()).toMatch(/not open yet/);
  });

  it('stands the player on open floor for every configured interaction point', () => {
    const points: Array<[string, ArcadeFloorId, { x: number; y: number }]> = [
      ['ticket counter', 'ground', ARCADE_TICKET_COUNTER.interactionPoint],
      ['prize counter', 'ground', ARCADE_PRIZE_COUNTER.interactionPoint],
      ...(FLOORS.map((floor) => [
        `elevator (${floor})`,
        floor,
        arcadeElevatorStandPoint[floor],
      ]) as Array<[string, ArcadeFloorId, { x: number; y: number }]>),
    ];

    for (const [name, floor, point] of points) {
      const boundary = arcadeBoundaryForFloor(floor)!;
      const constrained = constrainPosition(point, boundary);
      expect(constrained.x, `${name} x`).toBeCloseTo(point.x, 6);
      expect(constrained.y, `${name} y`).toBeCloseTo(point.y, 6);
    }
  });

  it('keeps the ground-floor stand points clear of the elevator alcove', () => {
    // The alcove (`x ∈ [45,55], y ∈ [36,48]`) can capture a walk that travels
    // along the floor's top edge, which is how the ticket counter became
    // unreachable in the first place.
    const inAlcove = (p: { x: number; y: number }) =>
      p.x >= ARCADE_ELEVATOR_ALCOVE.x[0] &&
      p.x <= ARCADE_ELEVATOR_ALCOVE.x[1] &&
      p.y >= ARCADE_ELEVATOR_ALCOVE.y[0] &&
      p.y <= ARCADE_ELEVATOR_ALCOVE.y[1];

    expect(inAlcove(ARCADE_TICKET_COUNTER.interactionPoint)).toBe(false);
    expect(inAlcove(ARCADE_PRIZE_COUNTER.interactionPoint)).toBe(false);
    expect(inAlcove(arcadeElevatorStandPoint.ground)).toBe(false);
    // ...and well below the walkable band's top edge, not on it.
    for (const point of [
      ARCADE_TICKET_COUNTER.interactionPoint,
      ARCADE_PRIZE_COUNTER.interactionPoint,
      arcadeElevatorStandPoint.ground,
    ]) {
      expect(point.y).toBeGreaterThan(ARCADE_ELEVATOR_ALCOVE.y[1] + 5);
    }
  });

  it('layers the elevator strictly below every Blobbi depth band', () => {
    for (const file of ARCADE_BACKGROUND_FILES) {
      const config = backgroundZIndexConfigs.find((c) => c.backgroundFile === file)!;
      const lowestBlobbiBand = Math.min(...config.thresholds.map((t) => t.zIndex));
      expect(ARCADE_ELEVATOR_Z_INDEX).toBeLessThan(lowestBlobbiBand);
    }
  });

  it('gives no machine the elevator’s z-index, so no depth is decided by DOM order', () => {
    // The elevator/Blobbi bug was exactly a tie broken by markup order. Every
    // machine must state a depth that is unambiguously above or below the doors.
    for (const machine of arcadeMachines) {
      expect(machine.zIndex).not.toBe(ARCADE_ELEVATOR_Z_INDEX);
    }
  });
});
