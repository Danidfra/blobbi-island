/**
 * Blobbi Island — the EFFECTIVE state of an inventory another game owns.
 *
 * A discovered kind:31633 snapshot is the owner's LAST CONSOLIDATED
 * statement, not the current balance. Any application — this one included —
 * may have published a player-signed kind:1416 spend against it that the
 * owner has not folded yet. So a reader derives:
 *
 * ```
 *   effective = snapshot − applied pending spends
 *   pending   = valid spends not settled by the kind:1417 chain the snapshot references
 * ```
 *
 * Every rule in that sentence — author must equal owner, `(created_at, id)`
 * order, overdraw rejected in full, folded ids excluded exactly once, voided
 * ids closed forever, chain walked head-first and verified — belongs to
 * `@nostr-games/inventory` (`resolveGameInventoryState`), whose
 * `docs/1416-1417-game-inventory-spend.md` is the canonical specification.
 * This module decides what to FETCH and how to PRESENT the answer. It
 * reimplements no protocol rule and publishes nothing.
 *
 * ## The unresolved state is a state
 *
 * If the snapshot references a manifest that cannot be retrieved or verified,
 * there is no balance. The package refuses to derive one and so does this
 * module: `status: 'unresolved'` carries the problems, the raw snapshot is
 * still available as "the last consolidated statement", and NOTHING downstream
 * may treat it as spendable. Falling back to the raw quantities would
 * resurrect items already consumed; treating every spend as pending would
 * debit the player twice. Neither is done.
 *
 * ## No timestamp shortcuts
 *
 * Spends are never filtered by `since`. A spend can carry a `created_at`
 * older than the snapshot and still be pending — it is settled by explicit id
 * through the fold chain, and by nothing else.
 */

import type { NostrEvent } from '@nostrify/nostrify';

import {
  getInventoryItemQuantity,
  resolveGameInventoryState,
  type GameInventory,
  type GameInventoryDerivedState,
  type GameInventoryFoldProblem,
  type GameInventoryFoldResolution,
} from './package';
import { dedupeEventsById, type ExternalReadResult } from './external-inventory-relays';

/** An event id plus the relay hint a reference carried for it (`''` when unknown). */
export interface EventReference {
  eventId: string;
  relay: string;
}

export type ExternalInventoryResolution =
  /**
   * The chain resolved and a balance was derived. `inventory` is the
   * EFFECTIVE state; `snapshot` is the raw kind:31633 it was derived from.
   */
  | {
      status: 'ready';
      snapshot: GameInventory;
      inventory: GameInventory;
      state: GameInventoryDerivedState;
      chain: GameInventoryFoldResolution;
      folds: NostrEvent[];
      spends: NostrEvent[];
    }
  /**
   * The snapshot references a fold chain that could not be verified. NO
   * balance exists. The raw snapshot may be shown as the last consolidated
   * statement, and MUST NOT be spent against.
   */
  | {
      status: 'unresolved';
      snapshot: GameInventory;
      chain: GameInventoryFoldResolution;
      problems: GameInventoryFoldProblem[];
      folds: NostrEvent[];
      spends: NostrEvent[];
    };

export interface ResolveExternalInventoryInput {
  snapshot: GameInventory;
  /** Candidate kind:1417 events, any order, duplicates tolerated. */
  folds: readonly NostrEvent[];
  /** Candidate kind:1416 events, any order, duplicates tolerated. */
  spends: readonly NostrEvent[];
}

/**
 * Derive the effective inventory from events already in hand. Pure.
 *
 * Wrong-author and foreign spends are invalid/ignored by the package's
 * parser; folded and voided ids are excluded by its chain walk; pending
 * spends are applied or rejected in the normative order. A spend of an item
 * the snapshot does not hold is an overdraw against zero and is rejected —
 * no balance is invented for it.
 */
export function resolveExternalInventoryState(
  input: ResolveExternalInventoryInput,
): ExternalInventoryResolution {
  const folds = dedupeEventsById(input.folds);
  const spends = dedupeEventsById(input.spends);
  const resolution = resolveGameInventoryState({ inventory: input.snapshot, folds, spends });

  if (resolution.status !== 'resolved') {
    return {
      status: 'unresolved',
      snapshot: input.snapshot,
      chain: resolution.chain,
      problems: resolution.chain.problems,
      folds,
      spends,
    };
  }

  return {
    status: 'ready',
    snapshot: input.snapshot,
    inventory: resolution.state.inventory,
    state: resolution.state,
    chain: resolution.chain,
    folds,
    spends,
  };
}

/** The effective quantity of one item, or 0 when the state is not ready. */
export function effectiveQuantity(
  resolution: ExternalInventoryResolution | undefined,
  itemAddress: string,
): number {
  if (!resolution || resolution.status !== 'ready') return 0;
  return getInventoryItemQuantity(resolution.inventory, itemAddress);
}

/**
 * The manifests a failed resolution could not find, each with the best relay
 * hint the chain offers: the snapshot's own `fold` tag for the head, the
 * `previous` link of the manifest that named it for anything deeper.
 *
 * Only `missing-fold` problems are retrievable. An invalid, foreign or cyclic
 * manifest will not become valid by fetching it again.
 */
export function missingFoldReferences(
  snapshot: GameInventory,
  chain: GameInventoryFoldResolution,
): EventReference[] {
  const hints = new Map<string, string>();
  if (snapshot.fold) hints.set(snapshot.fold.eventId, snapshot.fold.relay);
  for (const fold of chain.chain) {
    if (fold.previous) hints.set(fold.previous.eventId, fold.previous.relay);
  }

  const references: EventReference[] = [];
  for (const problem of chain.problems) {
    if (problem.code !== 'missing-fold' || !problem.foldId) continue;
    if (references.some((reference) => reference.eventId === problem.foldId)) continue;
    references.push({ eventId: problem.foldId, relay: hints.get(problem.foldId) ?? '' });
  }
  return references;
}

/** How the read model reaches relays. Wired in `useExternalInventoryStates.ts`. */
export interface ExternalInventoryReadDeps {
  /** Every kind:1416 by the owner naming the FULL inventory address. No `since`. */
  readSpends(): Promise<ExternalReadResult>;
  /** Every kind:1417 by the owner scoped to the FULL inventory address. */
  readFolds(): Promise<ExternalReadResult>;
  /** Specific kind:1417 events by id, on the configured relays plus each hint. */
  readFoldsById(references: EventReference[]): Promise<ExternalReadResult>;
}

/** The events a derivation needs, once fetched. */
export interface ExternalInventoryEvents {
  spends: NostrEvent[];
  folds: NostrEvent[];
}

export type ExternalInventoryEventsLoad =
  | ({ status: 'ok' } & ExternalInventoryEvents)
  /** The network could not be read well enough to derive anything. */
  | { status: 'error'; error: string };

/** Upper bound on by-id fetch rounds while walking an unusually deep chain. */
const MAX_FOLD_FETCH_ROUNDS = 8;

/**
 * Fetch what a snapshot needs to be derived.
 *
 * 1. read every candidate spend and, when the snapshot references a fold,
 *    every manifest for the inventory — one round trip normally covers the
 *    chain;
 * 2. try to resolve; on `missing-fold`, fetch the named ids from the
 *    configured relays and the relay hints the chain carries, and try again;
 * 3. stop when resolved, when nothing is missing, or when a round finds
 *    nothing new. An unresolved chain is REPORTED by the derivation the caller
 *    runs on these events, never guessed around here.
 *
 * Returns events rather than a resolution so a caller can merge in spends it
 * established itself (see `established-spends.ts`) before deriving.
 */
export async function loadExternalInventoryEvents(
  deps: ExternalInventoryReadDeps,
  snapshot: GameInventory,
): Promise<ExternalInventoryEventsLoad> {
  const [spends, folds] = await Promise.all([
    deps.readSpends(),
    snapshot.fold
      ? deps.readFolds()
      : Promise.resolve<ExternalReadResult>({ events: [], answered: true }),
  ]);
  if (!spends.answered) {
    return { status: 'error', error: 'No relay answered when reading spends against this inventory.' };
  }
  if (!folds.answered) {
    return { status: 'error', error: "No relay answered when reading this inventory's settlement records." };
  }

  let known = dedupeEventsById(folds.events);
  let resolution = resolveExternalInventoryState({ snapshot, folds: known, spends: spends.events });

  for (let round = 0; round < MAX_FOLD_FETCH_ROUNDS && resolution.status === 'unresolved'; round += 1) {
    const missing = missingFoldReferences(snapshot, resolution.chain);
    if (missing.length === 0) break;

    const fetched = await deps.readFoldsById(missing);
    const before = known.length;
    known = dedupeEventsById([...known, ...fetched.events]);
    if (known.length === before) break;

    resolution = resolveExternalInventoryState({ snapshot, folds: known, spends: spends.events });
  }

  return { status: 'ok', spends: dedupeEventsById(spends.events), folds: known };
}

/** A one-line, user-readable account of why a chain did not resolve. */
export function describeUnresolved(problems: readonly GameInventoryFoldProblem[]): string {
  if (problems.length === 0) return 'The inventory settlement chain could not be verified.';
  return problems.map((problem) => problem.message).join('; ');
}
