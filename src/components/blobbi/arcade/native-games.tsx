import type { ReactNode } from 'react';

import type { ArcadeEvent, ArcadeMachineState } from '@/arcade/arcade-machine-state';
import type { ArcadeGameEntry } from '@/arcade/tokens/game-entry';
import {
  BLOBBI_AIR_HOCKEY_GAME_ID,
  BLOBBI_DANCE_GAME_ID,
  BLOBBI_POOL_GAME_ID,
  canLaunchArcadeGame,
  type ArcadeCatalogueEntry,
  type ArcadeLaunchRequest,
} from '@/arcade/catalogue';

import { DanceMachine } from './dance/DanceMachine';
import { AirHockeyMachine } from './hockey/AirHockeyMachine';
import { PoolMachine } from './pool/PoolMachine';

/**
 * The launch resolver — the one place a game id becomes a React component.
 *
 * `catalogue.ts` is pure data and must stay that way: the moment it imports a
 * component, every consumer of the registry (a test, the reward boundary, a
 * future server-side check) drags the whole game tree in with it, and "the
 * catalogue is just data" stops being true. So the mapping lives here instead,
 * on the component side of the line, and the registry never learns that React
 * exists.
 *
 * ## Failing safely is the whole job
 *
 * The resolver takes a full {@link ArcadeLaunchRequest} — the game, the machine
 * the player is standing at, and which kind of screen asked — rather than a bare
 * id. That signature is the correction: a resolver that answers "is there a
 * component for this id?" quietly implies every resolved game can run anywhere,
 * and that implication is what let Blobbi Dance be launched from a pool table.
 *
 * Every refusal returns `null` rather than throwing or rendering something
 * approximate:
 *
 *  1. **Unknown or unlaunchable game.** `canLaunchArcadeGame` refuses a guest
 *     game on CATEGORY first, then a `guest-runtime` launch mode, then anything
 *     that is not `playable`. A guest entry mislabelled `launchMode: 'native'`
 *     and `availability: 'playable'` still fails on the first check.
 *  2. **Wrong machine.** A `dedicated-machine` game names the machines it
 *     belongs to; Blobbi Dance names `arcade-dance-machine` and nothing else, so
 *     no other machine can produce a Blobbi Dance run — and therefore no result
 *     can carry another machine's id.
 *  3. **Wrong surface.** A dedicated game is never launchable from the shared
 *     catalogue, and a shared-cabinet game is never launchable as if it were a
 *     machine's own.
 *  4. **No implementation.** A registry entry can be added before its component
 *     exists; the lookup misses and the launch is refused.
 *  5. **The caller ignored all of the above.** The room checks the same
 *     conditions before it changes view, so this is belt and braces — which is
 *     the correct amount for the boundary between "somebody else's code" and
 *     "our reward path".
 *
 * ## What is NOT here
 *
 * No dynamic import of remote code. No `iframe`. No WebXDC shim. No package
 * fetch. Guest Game execution is a later phase's problem and there is deliberately
 * nowhere in this file for it to be wired in by accident: the record below maps
 * ids to components that are imported statically at the top of this file.
 */

export interface NativeArcadeGameProps {
  /** The machine the player walked up to. Carried into the run's result. */
  readonly machineId: string;
  /** The registry entry being launched. Supplies the canonical id and title. */
  readonly entry: ArcadeCatalogueEntry;
  readonly lifecycle: ArcadeMachineState;
  readonly dispatch: (event: ArcadeEvent) => void;
  /**
   * Leave the game.
   *
   * WHERE that lands — the catalogue it was launched from, or the arcade room —
   * is the navigation model's decision (`exitGame`), not the game's. The room
   * aborts any live run through the reducer before changing view, so a game
   * never has to decide what leaving means either.
   */
  readonly onExit: () => void;
  /** Text for the game's single dismiss control, e.g. "Back to the arcade". */
  readonly exitLabel: string;
  /** Accessible name for that control. Describes the destination. */
  readonly exitAriaLabel: string;
  /**
   * The turnstile that charges Arcade Tokens for a run.
   *
   * Passed down rather than reached for, so `src/arcade` stays a domain layer
   * that cannot touch an inventory writer — the boundary test enforces that,
   * and this is the seam that respects it. Omitted, every machine plays free.
   */
  readonly gameEntry?: ArcadeGameEntry;
}

export type NativeArcadeGameRenderer = (props: NativeArcadeGameProps) => ReactNode;

/**
 * Every natively implemented game, by id.
 *
 * Three entries, all of them dedicated machines' games. That is the honest size
 * of the arcade, and the catalogue says the same thing to the player: the six
 * generic cabinets still have nothing, and their catalogue still says so rather
 * than borrowing one of these.
 *
 * Every renderer takes the same {@link NativeArcadeGameProps} and forwards it to
 * a controller with the same shape. That is not an accident of three games
 * looking alike — it is the dedicated-machine pattern, written down in
 * `docs/blobbi-air-hockey.md` §2 and followed here for the third time without
 * needing a single change to this file's structure.
 */
const NATIVE_ARCADE_GAMES: Readonly<Record<string, NativeArcadeGameRenderer>> = Object.freeze({
  [BLOBBI_DANCE_GAME_ID]: (props: NativeArcadeGameProps) => (
    <DanceMachine
      machineId={props.machineId}
      gameId={props.entry.id}
      title={props.entry.title}
      lifecycle={props.lifecycle}
      dispatch={props.dispatch}
      onExit={props.onExit}
      exitLabel={props.exitLabel}
      exitAriaLabel={props.exitAriaLabel}
      entry={props.gameEntry}
    />
  ),
  [BLOBBI_AIR_HOCKEY_GAME_ID]: (props: NativeArcadeGameProps) => (
    <AirHockeyMachine
      machineId={props.machineId}
      gameId={props.entry.id}
      title={props.entry.title}
      lifecycle={props.lifecycle}
      dispatch={props.dispatch}
      onExit={props.onExit}
      exitLabel={props.exitLabel}
      exitAriaLabel={props.exitAriaLabel}
      entry={props.gameEntry}
    />
  ),
  [BLOBBI_POOL_GAME_ID]: (props: NativeArcadeGameProps) => (
    <PoolMachine
      machineId={props.machineId}
      gameId={props.entry.id}
      title={props.entry.title}
      lifecycle={props.lifecycle}
      dispatch={props.dispatch}
      onExit={props.onExit}
      exitLabel={props.exitLabel}
      exitAriaLabel={props.exitAriaLabel}
      entry={props.gameEntry}
    />
  ),
});

/** Ids that have a native implementation. Read-only; used by tests and the harness. */
export const NATIVE_ARCADE_GAME_IDS: readonly string[] = Object.freeze(
  Object.keys(NATIVE_ARCADE_GAMES),
);

/**
 * Resolve a launch request to a renderer, or `null` when it must not be
 * launched.
 *
 * `null` is not an error state to recover from — it is the answer. The caller
 * shows the player a plain message and leaves them where they were.
 */
export function resolveNativeArcadeGame(
  request: ArcadeLaunchRequest,
): NativeArcadeGameRenderer | null {
  if (!canLaunchArcadeGame(request)) return null;
  const entry = request.game;
  if (!entry) return null;
  return NATIVE_ARCADE_GAMES[entry.id] ?? null;
}
