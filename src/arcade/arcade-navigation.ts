/**
 * Where the player is inside an arcade machine — the arcade's navigation stack.
 *
 * Kept separate from `arcade-machine-state.ts` on purpose. That reducer owns a
 * RUN: whether one exists, whether it may advance, whether it may be rewarded.
 * This owns a SCREEN: the shared catalogue, a game, a dedicated coming-soon
 * screen, or an informational panel. They change for different reasons and at
 * different times — walking up to a generic cabinet opens a catalogue and starts
 * no run at all — and merging them would mean inventing lifecycle statuses like
 * `browsing` that no game will ever be in.
 *
 * ## Three flows, because the arcade has two kinds of machine
 *
 * ```
 *   generic cabinet (×6)
 *     Room ──arrive──► Shared catalogue ──[a shared-cabinet game]──► Game
 *      ▲                    │  ▲                                      │
 *      │                    │  └──────────── Back to games ───────────┘
 *      └────── Close ───────┘
 *
 *   dance machine
 *     Room ──arrive──► Blobbi Dance (preview → run → results) ──Leave──► Room
 *
 *   pool table / air hockey table
 *     Room ──arrive──► that game's own coming-soon screen ──Close──► Room
 * ```
 *
 * A dedicated machine never routes through the catalogue, and a game launched
 * from a dedicated machine never returns to one — which is why `game` records
 * `from`. Getting that wrong is how leaving Blobbi Dance dropped the player into
 * a list of games that does not contain Blobbi Dance.
 *
 * ## The rules
 *
 * 1. **A catalogue game is only reachable from a catalogue**, and a dedicated
 *    game only from its machine. `launchGame` refuses from anywhere but a
 *    catalogue; `openDedicatedGame` is the only other way to reach `game`.
 * 2. **The machine id survives the whole stack.** It is captured when the
 *    machine is opened and carried into the game, which is what makes "the run
 *    happened on the machine the player walked to" true rather than approximate
 *    — and, for a dedicated game, what makes its machine id *always* its own.
 * 3. **Exit goes where the player came from.** From a catalogue-launched game,
 *    back to the catalogue; from a dedicated machine, out to the room. One
 *    function, `exitGame`, decides it from `from` rather than from a component's
 *    memory of how it got there.
 * 4. **Closing is explicit and one step.** Only `closeArcadeView` reaches
 *    `closed`, and it does so from anywhere — so a confirmed leave, an
 *    interruption or a dismissed dialog all have exactly one way out.
 *
 * No React, no DOM, no components. The room holds one of these in `useState` and
 * derives everything it renders from it.
 */

/** How a running game was reached. Decides where leaving it goes. */
export type ArcadeGameOrigin = 'shared-catalogue' | 'dedicated-machine';

export type ArcadeView =
  /** Nothing is open; the player is walking around the room. */
  | { readonly kind: 'closed' }
  /** The shared game catalogue, opened from a generic cabinet. */
  | { readonly kind: 'catalogue'; readonly machineId: string }
  /** A game is mounted. All three fields are fixed for the life of the view. */
  | {
      readonly kind: 'game';
      readonly machineId: string;
      readonly gameId: string;
      readonly from: ArcadeGameOrigin;
    }
  /**
   * A dedicated machine whose game is not built: pool, air hockey. Shows that
   * game's own screen, and closing returns to the room — it is not a catalogue
   * and never becomes one.
   */
  | { readonly kind: 'preview'; readonly machineId: string; readonly experienceId: string }
  /**
   * A non-game panel opened by walking up to something (the prize counter).
   * Closing it returns to the room.
   */
  | { readonly kind: 'notice'; readonly machineId: string };

export const ARCADE_VIEW_CLOSED: ArcadeView = Object.freeze({ kind: 'closed' });

/** Open the shared catalogue for a generic cabinet. Always a fresh browse. */
export function openCatalogue(machineId: string): ArcadeView {
  if (!machineId) return ARCADE_VIEW_CLOSED;
  return { kind: 'catalogue', machineId };
}

/**
 * Launch a dedicated machine's own game, with no menu in between.
 *
 * The only path to a `game` view that does not pass through a catalogue, and the
 * only one the dance machine uses.
 */
export function openDedicatedGame(machineId: string, gameId: string): ArcadeView {
  if (!machineId || !gameId) return ARCADE_VIEW_CLOSED;
  return { kind: 'game', machineId, gameId, from: 'dedicated-machine' };
}

/** Open a dedicated machine's coming-soon screen for one specific game. */
export function openDedicatedPreview(machineId: string, experienceId: string): ArcadeView {
  if (!machineId || !experienceId) return ARCADE_VIEW_CLOSED;
  return { kind: 'preview', machineId, experienceId };
}

/** Open an informational panel for something that is not a game. */
export function openNotice(machineId: string): ArcadeView {
  if (!machineId) return ARCADE_VIEW_CLOSED;
  return { kind: 'notice', machineId };
}

/**
 * Launch a game from the shared catalogue.
 *
 * Refuses from any other view and refuses an empty id. It does NOT decide
 * whether the game is launchable HERE — that is `canLaunchArcadeGame` plus the
 * native resolver, and the caller must consult both. Keeping the rule out of
 * here is what stops this module from needing to know what a game is.
 */
export function launchGame(view: ArcadeView, gameId: string): ArcadeView {
  if (view.kind !== 'catalogue') return view;
  if (!gameId) return view;
  return { kind: 'game', machineId: view.machineId, gameId, from: 'shared-catalogue' };
}

/**
 * Leave a game, and land where the player came from.
 *
 * A catalogue-launched game steps back to its catalogue; a dedicated machine's
 * game goes out to the room, because there is no list behind it to return to.
 * Aborting the run is the LIFECYCLE's job and happens separately — this function
 * moves a screen, nothing else.
 */
export function exitGame(view: ArcadeView): ArcadeView {
  if (view.kind !== 'game') return view;
  return view.from === 'shared-catalogue'
    ? { kind: 'catalogue', machineId: view.machineId }
    : ARCADE_VIEW_CLOSED;
}

/** Dismiss everything and return to the room. Legal from any view. */
export function closeArcadeView(): ArcadeView {
  return ARCADE_VIEW_CLOSED;
}

/** True when a dialog surface should be on screen. */
export function isArcadeViewOpen(view: ArcadeView): boolean {
  return view.kind !== 'closed';
}

/** The machine this view belongs to, or `null` when nothing is open. */
export function arcadeViewMachineId(view: ArcadeView): string | null {
  return view.kind === 'closed' ? null : view.machineId;
}
