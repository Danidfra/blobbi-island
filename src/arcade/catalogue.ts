/**
 * The arcade's game registry; every game the arcade knows about, as data.
 *
 * ## Registry, not "the catalogue"
 *
 * This module is the GLOBAL registry: one record per game, whatever machine it
 * belongs to. The *shared cabinet catalogue*, the list a player sees when they
 * walk up to one of the six generic cabinets, is a SUBSET of it, produced by
 * {@link sharedCabinetCatalogue}. Conflating the two was the defect this file
 * was corrected for: it put Blobbi Dance, which is a dedicated machine's game,
 * into a list offered by every cabinet in the building.
 *
 * ## Two kinds of machine, two kinds of game
 *
 * The arcade is not nine interchangeable boxes. It has **generic cabinets**
 * (pink, black, classic, green, purple, red) whose screens can show anything,
 * and **dedicated machines**: a dance pad, a pool table, an air hockey table,
 * which are physical objects that are one specific game and can never be
 * another. `host` records which kind a game belongs to, and
 * {@link canLaunchArcadeGame} is the one function that answers "may this game
 * start here?".
 *
 * The player-facing consequence: walking to the dance machine starts Blobbi
 * Dance, not a menu. Walking to the pool table starts Pool, not a menu with a
 * rhythm game in it.
 *
 * ## Two categories, and the difference is not cosmetic
 *
 * - **Island Games** are part of Blobbi Island. They run inside the app, use the
 *   shared arcade lifecycle, return a validated {@link ArcadeGameResult}, and may
 *   grant Arcade Tickets through the existing reward boundary. They are written
 *   here or adapted from audited open source.
 * - **Guest Games** are curated packages made by other people. They will run in a
 *   restricted, Blobbi-owned runtime with no signer, no inventory, no coins, no
 *   profile and no ticket access. **No such runtime exists yet**, and nothing in
 *   this phase downloads, parses or executes one.
 *
 * The category is therefore a TRUST boundary, not a section header, and
 * {@link isNativeLaunchable} refuses a guest entry on category alone, before it
 * ever looks at `launchMode`. A mislabelled guest entry fails closed.
 *
 * ## What this module deliberately is not
 *
 * No React, no components, no hooks, no JSX. No Nostr: no kinds, no filters, no
 * relays, no publisher keys. No reward arithmetic: `grantsTickets` is a fact
 * ABOUT a game, and the number of tickets a run is worth is still
 * `reward-policy.ts`'s sole business. No package URLs and no runtime.
 *
 * `catalogue.test.ts` asserts those absences against this file's own source, so
 * "the registry stayed pure" is checked rather than promised.
 */

import { NEON_HOP_TRACK } from './dance/track';
import { TYPICAL_AIR_HOCKEY_MATCH_MS } from './hockey/table';
import { TYPICAL_POOL_MATCH_MS } from './pool/table';

/**
 * Where a game comes from, and therefore what it is allowed to touch.
 *
 * `island` games are ours; `guest` games are somebody else's. Nothing else in
 * the arcade needs to distinguish them, and nothing may treat a guest game as an
 * island one because its other fields happen to look right.
 */
export type ArcadeGameCategory = 'island' | 'guest';

/**
 * How ready a game is for a player.
 *
 * - `playable`: it can be launched right now.
 * - `coming-soon`: designed or intended, not built. Shown, never launchable.
 * - `disabled`: withdrawn (broken, or pulled). Hidden from the catalogue
 *   entirely rather than shown as a mystery, and never launchable.
 */
export type ArcadeGameAvailability = 'playable' | 'coming-soon' | 'disabled';

/**
 * How a game is executed.
 *
 * - `native`: a React component inside this app, resolved by the launch
 *   resolver in `native-games.tsx`.
 * - `guest-runtime`: a package inside the future restricted runtime. There is
 *   no such runtime in this phase, so nothing with this launch mode can start.
 */
export type ArcadeGameLaunchMode = 'native' | 'guest-runtime';

/**
 * Where a game can be reached from.
 *
 * - `shared-cabinet`: offered by every generic arcade cabinet, through the
 *   shared catalogue. Nothing ships with this yet, and that is honest: the
 *   catalogue says games are being prepared rather than borrowing one that
 *   belongs to a machine down the hall.
 * - `dedicated-machine`: belongs to specific physical machines, named in
 *   `machineIds`. A dedicated game is NEVER listed in the shared catalogue and
 *   can never be launched from a generic cabinet.
 */
export type ArcadeGameHost = 'shared-cabinet' | 'dedicated-machine';

/** Provenance, recorded because "who wrote this?" decides what it may do. */
export type ArcadeGameSource =
  /** Written for Blobbi Island. */
  | 'blobbi-internal'
  /** Open source, read and adapted by us, shipped as part of the app. */
  | 'adapted-open-source'
  /** Somebody else's package, run in the restricted guest runtime. */
  | 'external-publisher';

export type ArcadeControlScheme = 'keyboard' | 'touch' | 'pointer';

/**
 * One line of "how do I play this?", in words a child can read.
 *
 * Deliberately NOT `ArcadeControlHint` from `arcade-input-map.ts`: that type is
 * the four-lane key mapping a rhythm game happens to use, and a pool game has no
 * lanes. This is the catalogue's summary, one entry per input device.
 */
export interface ArcadeCatalogueControl {
  readonly scheme: ArcadeControlScheme;
  readonly label: string;
}

export interface ArcadeCatalogueEntry {
  /**
   * Stable game identity. The same string the lifecycle, the result, the reward
   * policy and the claim ledger all use; never an alias, never a Nostr address,
   * never an item id.
   */
  readonly id: string;
  /** The name a player sees. */
  readonly title: string;
  /** One sentence saying what the player actually DOES. */
  readonly shortDescription: string;
  readonly category: ArcadeGameCategory;
  readonly availability: ArcadeGameAvailability;
  readonly launchMode: ArcadeGameLaunchMode;
  /**
   * Whether a run of this game can earn Arcade Tickets AT ALL.
   *
   * A fact about the game, not a promise about a run: whether a particular run
   * earns anything is decided by the reward policy, which lives elsewhere and is
   * the only thing that may compute a ticket count. True here means "a reward
   * policy has been approved for this game"; the catalogue never says how much.
   */
  readonly grantsTickets: boolean;
  readonly controls: readonly ArcadeCatalogueControl[];
  /** Typical length of one run, in ms. Absent when the game has no fixed length. */
  readonly estimatedDurationMs?: number;
  /** Cabinet-style artwork for the card. Decorative; never the only signal. */
  readonly thumbnail?: string;
  /** Short extra flag, e.g. "New". Never a development label. */
  readonly badge?: string;
  readonly source: ArcadeGameSource;
  /**
   * Where this game can be reached from. See {@link ArcadeGameHost}.
   */
  readonly host: ArcadeGameHost;
  /**
   * The machines this game belongs to. **Required and non-empty when `host` is
   * `dedicated-machine`**, meaningless otherwise, a registry test enforces
   * both directions.
   *
   * This was an unused optional field in the first Phase 4 pass, which is
   * precisely why the product rule it was supposed to express ("the dance game
   * lives on the dance machine") was not enforced anywhere. It is now the input
   * to {@link canLaunchArcadeGame} and therefore a real invariant.
   */
  readonly machineIds?: readonly string[];
}

/**
 * Blobbi Dance's stable id, and the single definition of it.
 *
 * It was declared twice before this phase, once in the machine registry and
 * once in the reward policy, with a comment in each saying it mirrored the
 * other. One of the two is now this constant and the other imports it.
 */
export const BLOBBI_DANCE_GAME_ID = 'blobbi-dance';

/**
 * Air Hockey's stable id, declared here for the same reason the dance game's is:
 * the machine registry, the launch resolver and the result all key off one
 * string, and a second spelling would split a game's identity in half.
 */
export const BLOBBI_AIR_HOCKEY_GAME_ID = 'blobbi-air-hockey';

/** Pool's stable id, declared here for the same reason the other two are. */
export const BLOBBI_POOL_GAME_ID = 'blobbi-pool';

/**
 * The machine ids the dedicated games belong to.
 *
 * Declared here rather than imported from `@/lib/arcade-machines-config`, in
 * that direction only: the machine registry imports THIS module (it needs the
 * game ids for its activation records), so importing back would be a cycle. The
 * registry test asserts both files agree, which is the check that matters, a
 * string that only one side knows is a bug either way round.
 */
export const BLOBBI_DANCE_MACHINE_ID = 'arcade-dance-machine';
export const ARCADE_POOL_MACHINE_ID = 'arcade-pool-table';
export const ARCADE_AIR_HOCKEY_MACHINE_ID = 'arcade-air-hockey';

/**
 * Every game the arcade knows about.
 *
 * Frozen, because it is read by the launch resolver and by the reward boundary's
 * neighbours; a module that could mutate it could make a coming-soon entry
 * playable at run time.
 *
 * All three entries are `dedicated-machine` today, which is why
 * {@link sharedCabinetCatalogue} is empty. That emptiness is the honest state of
 * the product: the six generic cabinets have no game yet, and the catalogue says
 * so rather than borrowing the dance machine's.
 *
 * All three are `playable` and all three now grant Arcade Tickets. Those are
 * separate facts and this registry is where the difference is kept honest; see
 * `grantsTickets`, which may only be true where an ACTIVE reward policy exists.
 */
export const ARCADE_CATALOGUE: readonly ArcadeCatalogueEntry[] = Object.freeze([
  Object.freeze({
    id: BLOBBI_DANCE_GAME_ID,
    title: 'Blobbi Dance',
    shortDescription:
      'Arrows fall down four lanes. Tap each one the moment it reaches the line and keep your combo going.',
    category: 'island',
    availability: 'playable',
    launchMode: 'native',
    grantsTickets: true,
    controls: Object.freeze([
      Object.freeze({ scheme: 'keyboard', label: 'Arrow keys or WASD' }),
      Object.freeze({ scheme: 'touch', label: 'Four big buttons under the lanes' }),
    ]),
    // Read from the track rather than written out again, so the screen cannot
    // drift away from the song it describes.
    estimatedDurationMs: NEON_HOP_TRACK.durationMs,
    thumbnail: '/assets/locations/arcade/level-b1/dance-machine.png',
    source: 'blobbi-internal',
    host: 'dedicated-machine',
    machineIds: Object.freeze([BLOBBI_DANCE_MACHINE_ID]),
  }),
  Object.freeze({
    id: BLOBBI_POOL_GAME_ID,
    title: 'Pool',
    shortDescription:
      'Pull the cue back and let go. Sink your seven balls, then the 8-ball, before your rival does.',
    category: 'island',
    availability: 'playable',
    launchMode: 'native',
    /*
      `grantsTickets` is a statement about whether an ACTIVE REWARD POLICY
      exists, not about whether a game is finished. `POOL_REWARD_POLICY` in
      `pool/pool-reward.ts` is active, so this is true, the results screen shows
      the claim, and `catalogue.test.ts` checks the two agree in both directions.
    */
    grantsTickets: true,
    controls: Object.freeze([
      Object.freeze({ scheme: 'pointer', label: 'Drag back from the cue ball, then let go' }),
      Object.freeze({ scheme: 'touch', label: 'Drag back from the cue ball, then let go' }),
      Object.freeze({ scheme: 'keyboard', label: 'Arrow keys aim, space shoots' }),
    ]),
    // Read from the table's own tuning rather than written out again, so the
    // estimate on the machine's card cannot drift away from the game.
    estimatedDurationMs: TYPICAL_POOL_MATCH_MS,
    thumbnail: '/assets/locations/arcade/level-1/snooker.png',
    source: 'blobbi-internal',
    host: 'dedicated-machine',
    machineIds: Object.freeze([ARCADE_POOL_MACHINE_ID]),
  }),
  Object.freeze({
    id: BLOBBI_AIR_HOCKEY_GAME_ID,
    title: 'Air Hockey',
    shortDescription:
      'Slide the puck past your rival before they slide it past you. First to seven goals wins.',
    category: 'island',
    availability: 'playable',
    launchMode: 'native',
    /*
      `grantsTickets` is a statement about whether an ACTIVE REWARD POLICY
      exists, not about whether a game is finished. `HOCKEY_REWARD_POLICY` in
      `hockey/hockey-reward.ts` is active, so this is true, the results screen
      shows the claim, and `catalogue.test.ts` checks the two agree in both
      directions.
    */
    grantsTickets: true,
    controls: Object.freeze([
      Object.freeze({ scheme: 'pointer', label: 'Move the mouse over the table' }),
      Object.freeze({ scheme: 'touch', label: 'Press and drag inside the table' }),
      Object.freeze({ scheme: 'keyboard', label: 'Arrow keys or WASD' }),
    ]),
    // Read from the match rules rather than written out again, so the screen
    // cannot drift away from the match it describes.
    estimatedDurationMs: TYPICAL_AIR_HOCKEY_MATCH_MS,
    thumbnail: '/assets/locations/arcade/level-1/air-hockey.png',
    source: 'blobbi-internal',
    host: 'dedicated-machine',
    machineIds: Object.freeze([ARCADE_AIR_HOCKEY_MACHINE_ID]),
  }),
]) as readonly ArcadeCatalogueEntry[];

const CATALOGUE_BY_ID: ReadonlyMap<string, ArcadeCatalogueEntry> = new Map(
  ARCADE_CATALOGUE.map((entry) => [entry.id, entry]),
);

/** Look a game up by id. `null` for an id the catalogue does not know. */
export function getCatalogueEntry(
  id: string | null | undefined,
): ArcadeCatalogueEntry | null {
  if (!id) return null;
  return CATALOGUE_BY_ID.get(id) ?? null;
}

/**
 * The entries a player may see in one category, in registry order.
 *
 * `disabled` entries are excluded: a withdrawn game is not "coming soon", and
 * showing it as one would be a small lie repeated on every visit.
 */
export function arcadeCatalogueByCategory(
  category: ArcadeGameCategory,
  entries: readonly ArcadeCatalogueEntry[] = ARCADE_CATALOGUE,
): ArcadeCatalogueEntry[] {
  return entries.filter((e) => e.category === category && e.availability !== 'disabled');
}

/**
 * Whether this entry may be handed to the NATIVE launch resolver.
 *
 * Three independent conditions, all of which must hold, checked in the order
 * that fails safest:
 *
 *  1. it is an **island** game, a guest game may never reach a native
 *     component, whatever else its record claims;
 *  2. its launch mode is **native**: `guest-runtime` has no runtime in this
 *     phase and must not silently fall back to one that exists;
 *  3. it is **playable**: `coming-soon` and `disabled` cannot start.
 *
 * The resolver checks this before looking a component up, and the room checks it
 * before changing view, so an entry that lies about itself fails at the boundary
 * rather than inside a game.
 */
export function isNativeLaunchable(entry: ArcadeCatalogueEntry | null | undefined): boolean {
  if (!entry) return false;
  if (entry.category !== 'island') return false;
  if (entry.launchMode !== 'native') return false;
  return entry.availability === 'playable';
}

/**
 * The games a GENERIC arcade cabinet offers.
 *
 * This: not {@link ARCADE_CATALOGUE}, is what the shared catalogue renders.
 * Today it is empty, because every game the arcade has belongs to a dedicated
 * machine. An empty list is the correct product state and the UI is built for
 * it; padding it out with the dance machine's game is the mistake this function
 * exists to make impossible.
 */
export function sharedCabinetCatalogue(
  entries: readonly ArcadeCatalogueEntry[] = ARCADE_CATALOGUE,
): ArcadeCatalogueEntry[] {
  return entries.filter((e) => e.host === 'shared-cabinet' && e.availability !== 'disabled');
}

/** The games that belong to one specific machine, in registry order. */
export function dedicatedGamesForMachine(
  machineId: string | null | undefined,
  entries: readonly ArcadeCatalogueEntry[] = ARCADE_CATALOGUE,
): ArcadeCatalogueEntry[] {
  if (!machineId) return [];
  return entries.filter(
    (e) => e.host === 'dedicated-machine' && (e.machineIds ?? []).includes(machineId),
  );
}

/** Which kind of screen a launch was requested from. */
export type ArcadeLaunchSurface = 'shared-catalogue' | 'dedicated-machine';

export interface ArcadeLaunchRequest {
  readonly game: ArcadeCatalogueEntry | null | undefined;
  /** The machine the player is standing at. */
  readonly machineId: string | null | undefined;
  readonly surface: ArcadeLaunchSurface;
}

/**
 * May this game start, here, from this kind of screen?
 *
 * The single answer to that question, and the reason a machine's behaviour is
 * an invariant rather than a convention. It is checked by the launch resolver
 * and again by the room, and it enforces three separate rules:
 *
 *  1. **{@link isNativeLaunchable}**: a guest game, a coming-soon game or a
 *     withdrawn game never starts, whatever asked for it.
 *  2. **A dedicated game only starts on its own machine.** Blobbi Dance names
 *     `arcade-dance-machine` and nothing else, so a generic cabinet, the pool
 *     table and the air hockey table are all refused by the same clause, and a
 *     *result* can therefore only ever carry the dance machine's id.
 *  3. **A dedicated game is never launchable from the shared catalogue**, and a
 *     shared-cabinet game is never launchable as if it were a machine's own.
 *     The surface and the host must agree.
 */
export function canLaunchArcadeGame({ game, machineId, surface }: ArcadeLaunchRequest): boolean {
  if (!isNativeLaunchable(game) || !game) return false;

  if (surface === 'shared-catalogue') {
    // A shared-cabinet game runs on any generic cabinet, so the machine id is
    // context (analytics, future guest execution) rather than a constraint.
    return game.host === 'shared-cabinet';
  }

  if (game.host !== 'dedicated-machine') return false;
  if (!machineId) return false;
  const machines = game.machineIds ?? [];
  return machines.includes(machineId);
}

/**
 * "About 68 seconds", or `null` when a game has no typical length.
 *
 * Rounded here rather than in a card so two surfaces cannot round it two ways.
 */
export function catalogueDurationLabel(entry: ArcadeCatalogueEntry): string | null {
  const ms = entry.estimatedDurationMs;
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `About ${seconds} seconds`;
  return `About ${Math.round(seconds / 60)} minutes`;
}
