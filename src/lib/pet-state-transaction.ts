/**
 * Value-bearing kind:31124 writes — the pet-state counterpart of
 * `src/inventory/inventory-transaction.ts`.
 *
 * ## Why the generic pet writer is not enough
 *
 * `useUpdatePetState` is fine for care actions, where a lost update costs a
 * few hunger points. It is not fine for settling a Mine session's energy
 * cost, because it:
 *
 * - builds from the React Query cache instead of an authoritative read;
 * - has no per-pet serialization and no cross-tab lock;
 * - stamps a bare wall-clock `created_at`, so two writes in one second tie;
 * - publishes through `useNostrPublish`, which swallows a 5 s timeout and
 *   resolves — a timeout is reported as success;
 * - takes ABSOLUTE field values, so it has no notion of an operation that
 *   must apply exactly once.
 *
 * This module supplies the missing half. It deliberately does NOT own
 * idempotency or game policy: those live with the energy settler
 * (`src/mine/energy-settlement.ts`) and its durable ledger, exactly as the
 * Coin op ledger sits above the inventory transaction.
 *
 * ## What a transaction guarantees
 *
 * ```
 *   queued cross-tab Web Lock, keyed per OWNER+PET
 *   → shared per-tab chain on the same key
 *   → authoritative kind:31124 read (EOSE-aware; unknown ≠ absent)
 *   → caller mutates that ONE pet snapshot
 *   → mergePetStateTags: every unrelated field and unknown tag rides through
 *   → created_at = max(now, previous + 1)   ← no same-second ties
 *   → sign
 *   → STRICT publish (a timeout is AMBIGUOUS, never success)
 * ```
 *
 * The lock key is per-pet, not per-owner: settling one Blobbi's energy must
 * not queue behind an unrelated write to another Blobbi. It is deliberately a
 * DIFFERENT name space from the inventory lock — kind:31124 and kind:31633 are
 * separate replaceable domains and must not block each other.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import type { NUser } from '@nostrify/react/login';

import { withQueuedCrossTabLock } from '@/lib/cross-tab-op-lock';
import { serializeByKey, nextReplaceableCreatedAt } from '@/lib/replaceable-write';
import {
  readRelayConfirmed,
  type RelayReader,
  type RelayReadUnknownReason,
} from '@/lib/relay-read';
import { mergePetStateTags, parsePetState, validatePetStateEvent } from '@/lib/blobbi-parsers';
import { KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';
import type { PetState } from '@/lib/blobbi-types';

const READ_TIMEOUT_MS = 3000;
const PUBLISH_TIMEOUT_MS = 5000;

export interface PetStateNostr extends RelayReader {
  event: (event: NostrEvent, options?: { signal?: AbortSignal }) => Promise<void>;
}

/** The newest valid kind:31124 for one pet, with its revision timestamp. */
export interface PetStateWithMeta {
  readonly pet: PetState;
  readonly event: NostrEvent;
  readonly createdAt: number;
}

export type PetStateReadOutcome =
  /** A valid pet state was read. */
  | { readonly status: 'found'; readonly value: PetStateWithMeta }
  /**
   * The relay COMPLETED the read (EOSE), twice, and holds no such event. For a
   * pet the caller already knew about, this is still not a licence to write —
   * see {@link PetStateTransactionError}'s `pet-absent`.
   */
  | { readonly status: 'absent' }
  /** The state could not be established. Never write from this. */
  | { readonly status: 'unknown'; readonly reason: RelayReadUnknownReason };

/**
 * Read one pet's authoritative state.
 *
 * Confirmed-empty semantics (two completed reads) because "this Blobbi does
 * not exist" is exactly as destructive a conclusion here as "you own no
 * items" was for the inventory. Never fabricates a pet from an empty answer.
 */
export async function readPetState(
  nostr: RelayReader,
  pubkey: string,
  petId: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<PetStateReadOutcome> {
  const outcome = await readRelayConfirmed(
    nostr,
    [{ kinds: [KIND_BLOBBI_STATE], authors: [pubkey], '#d': [petId], limit: 1 }],
    { timeoutMs: options.timeoutMs ?? READ_TIMEOUT_MS, signal: options.signal },
  );
  if (outcome.status === 'unknown') {
    return { status: 'unknown', reason: outcome.reason };
  }

  const valid = outcome.events
    .filter(validatePetStateEvent)
    .map((event) => ({ event, pet: parsePetState(event) }))
    .filter((x): x is { event: NostrEvent; pet: PetState } => x.pet !== null)
    .filter((x) => x.pet.id === petId)
    .sort((a, b) => b.event.created_at - a.event.created_at);

  if (valid.length === 0) return { status: 'absent' };
  return {
    status: 'found',
    value: {
      pet: valid[0].pet,
      event: valid[0].event,
      createdAt: valid[0].event.created_at,
    },
  };
}

/** Failures whose timing is known. See each reason. */
export class PetStateTransactionError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'not-logged-in'
      /** The read could not be completed — publish nothing, stay pending. */
      | 'read-unknown'
      /**
       * The read COMPLETED and the pet is not there. For a settlement of a pet
       * the session started with, this is a refusal, not a blank base: this
       * module never creates a kind:31124 from scratch.
       */
      | 'pet-absent'
      | 'sign-failed'
      /** The publish MAY have landed. Reconcile; never blind-retry. */
      | 'publish-timeout'
      | 'publish-unknown',
  ) {
    super(message);
    this.name = 'PetStateTransactionError';
  }
}

/** The ONE cross-tab lock name for pet-state writes. Per owner AND pet. */
/**
 * The tag name carrying an operation marker on kind:31124.
 *
 * `mergePetStateTags` preserves unknown tags verbatim, so a writer that puts
 * `[PET_OP_MARKER_TAG, <opId>]` on a revision can later read the newest state
 * and know whether THAT operation already landed — the Mine's energy
 * settlement and the external-item consumption both key on it. Exactly one
 * marker rides on the event at a time (`dropTagNames: [PET_OP_MARKER_TAG]`),
 * so it proves the most recent operation and nothing older.
 */
export const PET_OP_MARKER_TAG = 'blobbi_op';

/** Does this revision carry the marker of operation `opId`? */
export function hasPetOpMarker(tags: readonly (readonly string[])[], opId: string): boolean {
  return tags.some((tag) => tag[0] === PET_OP_MARKER_TAG && tag[1] === opId);
}

export function petStateLockName(pubkey: string, petId: string): string {
  return `blobbi-pet-state:${pubkey}:${petId}`;
}

export interface PetStateTransactionDeps {
  readonly nostr: PetStateNostr;
  readonly user: Pick<NUser, 'pubkey' | 'signer'>;
  /** Injectable clock for tests. */
  readonly now?: () => number;
}

export interface PetStatePublishOptions {
  /**
   * Managed tag overrides, passed straight to `mergePetStateTags` (e.g.
   * `{ energy: '30' }`). Every unrelated managed field and every unknown tag
   * from the source event rides through untouched.
   */
  readonly overrides?: Record<string, string>;
  /**
   * Extra tags appended to this revision (the settlement op marker).
   * Deduplicated against what survived the passthrough.
   */
  readonly extraTags?: readonly (readonly string[])[];
  /**
   * Tag names to DROP from the preserved unknown-tag passthrough before
   * appending `extraTags`. Used to keep exactly one settlement marker on the
   * event instead of accumulating one per session forever.
   */
  readonly dropTagNames?: readonly string[];
}

export interface PetStateTransactionContext {
  readonly pubkey: string;
  /**
   * The authoritative base. Throws `read-unknown` when the state cannot be
   * established and `pet-absent` when the read completed with no such pet.
   * Cached per transaction.
   */
  readBase(): Promise<PetStateWithMeta>;
  /** Build, sign and STRICTLY publish the next revision of this pet. */
  publish(
    pet: PetState,
    options?: PetStatePublishOptions,
  ): Promise<NostrEvent>;
}

/**
 * Run `body` as the only writer of this pet, in this tab and (where Web Locks
 * exist) across tabs.
 */
export async function runPetStateTransaction<T>(
  deps: PetStateTransactionDeps,
  petId: string,
  body: (ctx: PetStateTransactionContext) => Promise<T>,
): Promise<T> {
  const { nostr, user } = deps;
  const now = deps.now ?? Date.now;
  if (!user?.pubkey || !user.signer) {
    throw new PetStateTransactionError('User is not logged in', 'not-logged-in');
  }
  const pubkey = user.pubkey;

  const { value } = await withQueuedCrossTabLock(petStateLockName(pubkey, petId), () =>
    serializeByKey(petStateLockName(pubkey, petId), async (): Promise<T> => {
      let base: PetStateWithMeta | null = null;

      const readBase = async (): Promise<PetStateWithMeta> => {
        if (base) return base;
        const outcome = await readPetState(nostr, pubkey, petId);
        if (outcome.status === 'unknown') {
          throw new PetStateTransactionError(
            `pet-state-read-${outcome.reason}`,
            'read-unknown',
          );
        }
        if (outcome.status === 'absent') {
          throw new PetStateTransactionError(
            `No kind:31124 for ${petId}; refusing to create one`,
            'pet-absent',
          );
        }
        base = outcome.value;
        return base;
      };

      const publish = async (
        pet: PetState,
        options: PetStatePublishOptions = {},
      ): Promise<NostrEvent> => {
        // Publishing without the base would be the stale-replacement defect
        // this primitive exists to prevent.
        const meta = await readBase();

        const dropped = new Set(options.dropTagNames ?? []);
        const source: PetState = dropped.size
          ? { ...pet, rawTags: pet.rawTags.filter((tag) => !dropped.has(tag[0])) }
          : pet;

        const tags = mergePetStateTags(source, options.overrides);
        for (const extra of options.extraTags ?? []) {
          const key = JSON.stringify(extra);
          if (!tags.some((t) => JSON.stringify(t) === key)) tags.push([...extra]);
        }
        if (!tags.some(([name]) => name === 'client')) tags.push(['client', 'blobbi']);

        let signed: NostrEvent;
        try {
          signed = await user.signer.signEvent({
            kind: KIND_BLOBBI_STATE,
            // Preserve the original content (Ditto may carry evolution JSON).
            content: meta.pet.rawContent ?? '',
            tags,
            created_at: nextReplaceableCreatedAt(now(), meta.createdAt),
          });
        } catch (error) {
          throw new PetStateTransactionError(
            error instanceof Error ? error.message : 'The signer refused',
            'sign-failed',
          );
        }

        try {
          await nostr.event(signed, { signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS) });
        } catch (error) {
          const isTimeout =
            error instanceof Error &&
            (error.name === 'AbortError' || error.name === 'TimeoutError');
          throw new PetStateTransactionError(
            error instanceof Error ? error.message : 'The publish failed',
            isTimeout ? 'publish-timeout' : 'publish-unknown',
          );
        }
        return signed;
      };

      return body({ pubkey, readBase, publish });
    }),
  );
  return value;
}
