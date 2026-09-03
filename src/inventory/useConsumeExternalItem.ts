/**
 * Blobbi Island — consuming an item owned in an inventory ANOTHER GAME writes.
 *
 * This is the source-aware sibling of `useUseItem`. That hook debits
 * `blobbi:island` through Island's own kind:31633 transaction; this one
 * debits a foreign inventory by publishing a player-signed kind:1416 spend
 * and NEVER touches the foreign snapshot. The two share the effect planner
 * (`care-effect.ts`) and nothing else, on purpose: the Island path keeps its
 * existing semantics, tests and ordering untouched.
 *
 * ## Ordering — SPEND FIRST, and why
 *
 * ```
 *   1. validate: action, Blobbi exists, stage allowed, inventory is the player's
 *   2. FRESH derivation of the source inventory (snapshot + folds + spends)
 *      → unresolved or effective quantity < 1: stop, sign nothing
 *   3. build + sign ONE kind:1416  (durable identity = its event id)
 *   4. establish it: publish the same bytes to every cross-game relay;
 *      silent relays → look up the exact id; still unknown → stop, keep the
 *      signed event, and NEVER sign another for this action
 *   5. apply the Blobbi effect on kind:31124, carrying the spend id as an
 *      operation marker; a marker already present means it was applied before
 *   6. best-effort kind:1124 receipt referencing the spend id
 * ```
 *
 * `useUseItem` applies the effect first because its debit can fail without
 * losing anything. Here the debit is the DURABLE record: once a spend exists
 * its id is what every retry keys on, so the effect can always be recovered
 * from it, whereas an effect applied before a spend that then fails to
 * establish could never be reconciled with anything. Spend-first turns every
 * partial failure into a resumable state instead of a leak.
 *
 * ## Not atomic, but recoverable
 *
 * Three events (immutable 1416, replaceable 31124, regular 1124) cannot be
 * published atomically. What the ledger (`external-spend-ledger.ts`) makes
 * true instead:
 *
 * - a retry after an AMBIGUOUS spend publish republishes the SAME signed
 *   event, found or not; a second signature is a second debit and is never
 *   minted for one player action;
 * - a spend that is established but whose effect failed or is ambiguous is
 *   RESUMED on the next action for that row: no new spend, the effect is
 *   reconciled against the pet's newest state (marker present → done) or
 *   applied then;
 * - an effect is never applied twice for one spend id: the marker on the
 *   authoritative 31124 is checked inside the pet-state lock before publishing.
 *
 * ## What "success" means, honestly
 *
 * A spend accepted by one relay is established but not globally final: the
 * protocol orders pending spends by `(created_at, id)`, and a competing spend
 * from another device may take the last unit, in which case the owner's next
 * fold VOIDS this one. Island applies the effect as soon as the spend is
 * established because waiting for the owner to fold is not a browser-only
 * UX anyone would accept. The residual cost — a Blobbi fed from a spend that
 * is later voided — is bounded to that concurrent multi-device race, is
 * exactly the class of leak `useUseItem` already tolerates, and is documented
 * in `docs/INVENTORY_ARCHITECTURE.md`.
 */

import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { NUser } from '@nostrify/react/login';
import { buildInteractionEventTemplate } from '@blobbi-kit/core/blobbi-interaction';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import type { PetState } from '@/lib/blobbi-types';
import { withQueuedCrossTabLock } from '@/lib/cross-tab-op-lock';
import {
  openExternalSpendOps,
  persistExternalSpendOp,
  type ExternalSpendRecord,
  type ExternalSpendStatus,
} from '@/lib/external-spend-ledger';
import {
  PET_OP_MARKER_TAG,
  PetStateTransactionError,
  hasPetOpMarker,
  runPetStateTransaction,
  type PetStateNostr,
} from '@/lib/pet-state-transaction';
import { serializeByKey } from '@/lib/replaceable-write';

import { planCareEffect, type CareEffectPlan } from './care-effect';
import type { ResolvedBlobbiItemDefinition } from './catalog-fallback';
import { recordEstablishedSpend } from './established-spends';
import type { DiscoveredInventory } from './external-inventories';
import {
  externalInventoryRelays,
  readFromExternalRelays,
} from './external-inventory-relays';
import {
  effectiveQuantity,
  type ExternalInventoryResolution,
} from './external-inventory-state';
import type { ExternalItemCompatibility } from './external-item-compatibility';
import {
  buildSpendTemplate,
  establishSpend,
  mintSpendNonce,
  signSpend,
  spendByIdFilter,
  type SpendPublishDeps,
} from './external-spend';
import { publishToRelays } from './relay-fan-out';
import {
  externalInventoryStateQueryKey,
  fetchExternalInventoryState,
} from './useExternalInventoryStates';

/** The `e` tag marker linking a kind:1124 interaction to the spend it consumed. */
export const INTERACTION_SPEND_MARKER = 'inventory-spend';

const SPEND_PUBLISH_TIMEOUT_MS = 8000;
const RECEIPT_PUBLISH_TIMEOUT_MS = 5000;

export interface ConsumeExternalItemInput {
  /** The EXACT inventory the row came from. The spend targets this address. */
  inventory: DiscoveredInventory;
  /** The FULL `31632:<issuer>:<d>` item address. */
  itemAddress: string;
  /** The `a` tag's relay hint for the item, or `''`. */
  itemRelay?: string;
  /**
   * The definition WITH Island's interpretation applied
   * (`applyExternalCompatibility`): `action`, `effects` and `stages` are read
   * from it, exactly as `useUseItem` reads them from an official definition.
   */
  definition: ResolvedBlobbiItemDefinition;
  compatibility: ExternalItemCompatibility;
  /** Pet to apply the effect to. */
  petId: string;
}

export type ConsumeExternalItemResult =
  /** Spend established and effect confirmed on kind:31124. */
  | {
      status: 'applied';
      spendId: string;
      experienceGained: number;
      /** This action finished an earlier, unfinished consumption of this row. */
      resumed: boolean;
      /** The effect had already landed for this spend id; nothing republished. */
      alreadyApplied: boolean;
      warning?: string;
    }
  /**
   * The spend publish was ambiguous and the id was not found. The signed event
   * is kept; the next action on this row republishes it. NO effect applied.
   */
  | { status: 'spend-unconfirmed'; spendId: string; resumed: boolean; error: string }
  /**
   * The spend exists but the effect definitely did not publish. The next
   * action on this row applies it, with no new spend.
   */
  | { status: 'effect-pending'; spendId: string; resumed: boolean; error: string }
  /**
   * The spend exists and the effect MAY have landed. The next action on this
   * row reconciles against the pet's newest state, with no new spend.
   */
  | { status: 'effect-ambiguous'; spendId: string; resumed: boolean; error: string };

/** Everything the orchestration needs, injectable so every branch is testable. */
export interface ExternalConsumptionDeps {
  readonly user: Pick<NUser, 'pubkey' | 'signer'> | undefined;
  /** The pool: kind:31124 through the pet-state transaction, kind:1124 receipt. */
  readonly nostr: PetStateNostr;
  /** Cached pets, for the existence/stage pre-check. */
  readonly pets: readonly PetState[];
  /** The cross-game relays, for the spend publish and the id lookup. */
  readonly spendRelays: SpendPublishDeps;
  /** A FRESH derivation of the source inventory. Never a cached row. */
  readonly fetchState: (
    inventory: DiscoveredInventory,
  ) => Promise<ExternalInventoryResolution | { status: 'error'; error: string }>;
  /** A relay to put in the spend's and receipt's hint slots. */
  readonly relayHint?: string;
  readonly now?: () => number;
  /** The spend is on a relay: update caches so the effective quantity drops now. */
  readonly onSpendEstablished?: (record: ExternalSpendRecord) => void;
  /** The effect landed: reflect the new stats optimistically. */
  readonly onEffectApplied?: (petId: string, plan: CareEffectPlan) => void;
}

function advance(
  record: ExternalSpendRecord,
  status: ExternalSpendStatus,
  now: number,
  note?: string,
): ExternalSpendRecord {
  return { ...record, status, updatedAt: now, ...(note === undefined ? {} : { note }) };
}

/**
 * Consume ONE unit of an external item for a Blobbi. See the module doc for
 * the ordering and the recovery contract.
 *
 * Throws only for outcomes where NOTHING was published: eligibility failures,
 * an unreadable or unresolved source inventory, an empty balance, a refused
 * signature, a local ledger that cannot record, or a spend every relay
 * definitely refused. Every outcome after the spend may exist is a returned
 * status, never an exception, so the caller cannot mistake it for "nothing
 * happened".
 */
export async function runExternalConsumption(
  deps: ExternalConsumptionDeps,
  input: ConsumeExternalItemInput,
): Promise<ConsumeExternalItemResult> {
  const { user } = deps;
  const now = deps.now ?? Date.now;
  if (!user?.pubkey || !user.signer) throw new Error('User not logged in');
  const pubkey = user.pubkey;

  const action = input.definition.action;
  if (!action) throw new Error(`Item has no usable action: ${input.itemAddress}`);

  const pet = deps.pets.find((p) => p.id === input.petId);
  if (!pet) throw new Error(`Blobbi ${input.petId} not found`);

  // Spend authority is the player key inside the inventory address. A row
  // from somebody else's inventory can never be spent by this signer, and it
  // is refused here rather than at the relay.
  if (input.inventory.owner !== pubkey) {
    throw new Error('This inventory belongs to another player');
  }

  const { value } = await withQueuedCrossTabLock(`blobbi-external-spend:${pubkey}`, () =>
    serializeByKey(
      `external-spend:${pubkey}:${input.inventory.address}`,
      async (): Promise<ConsumeExternalItemResult> => {
        // ── resume, or start ────────────────────────────────────────────────
        //
        // An unfinished consumption of THIS row owns the next action: the
        // debit already exists or may exist, and signing another would be a
        // second debit for one intent.
        const [open] = openExternalSpendOps(
          pubkey,
          input.inventory.address,
          input.itemAddress,
          input.petId,
        );
        let record: ExternalSpendRecord;
        let resumed = false;

        if (open) {
          record = open;
          resumed = true;
        } else {
          // Stage rule, before anything is signed. A stage-restricted feed
          // must never debit.
          if (pet.stage && !input.definition.stages.includes(pet.stage)) {
            throw new Error(
              `${input.definition.name} cannot be used on a ${pet.stage} Blobbi`,
            );
          }

          // FRESH derivation, not the cached row. Blocks the obvious
          // stale-click overspend; does not (cannot) serialize other devices.
          const state = await deps.fetchState(input.inventory);
          if (state.status === 'error') {
            throw new Error(`Could not read the ${input.inventory.id} inventory: ${state.error}`);
          }
          if (state.status === 'unresolved') {
            throw new Error(
              "This inventory's balance cannot be verified right now, so nothing was spent.",
            );
          }
          const have = effectiveQuantity(state, input.itemAddress);
          if (have < 1) {
            throw new Error(`No ${input.definition.name} left in ${input.inventory.id}`);
          }

          const template = buildSpendTemplate({
            inventoryAddress: input.inventory.address,
            inventoryRelay: deps.relayHint ?? '',
            itemAddress: input.itemAddress,
            itemRelay: input.itemRelay ?? '',
            quantity: 1,
            nonce: mintSpendNonce(),
          });
          const signed = await signSpend(user, template, Math.floor(now() / 1000));

          record = {
            spendId: signed.id,
            inventoryAddress: input.inventory.address,
            itemAddress: input.itemAddress,
            quantity: 1,
            petId: input.petId,
            status: 'signed',
            event: signed,
            createdAt: now(),
            updatedAt: now(),
          };
          // No durable record, no publish: an unrecorded ambiguous publish
          // could never be reconciled, and a refresh would ask for a second
          // signature.
          if (!persistExternalSpendOp(pubkey, record)) {
            throw new Error('Could not record the spend locally; nothing was published.');
          }
        }

        // ── establish the spend ─────────────────────────────────────────────
        if (
          record.status === 'signed' ||
          record.status === 'publishing' ||
          record.status === 'unconfirmed'
        ) {
          if (record.status === 'signed') {
            record = advance(record, 'publishing', now());
            persistExternalSpendOp(pubkey, record);
          }
          const outcome = await establishSpend(deps.spendRelays, record.event);
          if (outcome.status === 'established') {
            record = advance(record, 'established', now(), outcome.via);
            persistExternalSpendOp(pubkey, record);
            recordEstablishedSpend(record.inventoryAddress, record.event);
            deps.onSpendEstablished?.(record);
          } else if (outcome.status === 'unconfirmed') {
            record = advance(record, 'unconfirmed', now(), outcome.error);
            persistExternalSpendOp(pubkey, record);
            return { status: 'spend-unconfirmed', spendId: record.spendId, resumed, error: outcome.error };
          } else {
            record = advance(record, 'failed', now(), outcome.error);
            persistExternalSpendOp(pubkey, record);
            throw new Error(`The spend was refused by every relay: ${outcome.error}`);
          }
        }

        // ── apply the effect, keyed to the spend id ─────────────────────────
        const effect = await applyEffectForSpend(deps, record, input);
        if (effect.status === 'ambiguous') {
          record = advance(record, 'effect-ambiguous', now(), effect.error);
          persistExternalSpendOp(pubkey, record);
          return { status: 'effect-ambiguous', spendId: record.spendId, resumed, error: effect.error };
        }
        if (effect.status === 'failed') {
          // The spend exists; the effect is owed. Stay `established`.
          return { status: 'effect-pending', spendId: record.spendId, resumed, error: effect.error };
        }

        record = advance(record, 'applied', now(), effect.alreadyApplied ? 'marker-found' : undefined);
        persistExternalSpendOp(pubkey, record);
        if (effect.plan) deps.onEffectApplied?.(input.petId, effect.plan);

        // ── receipt: best effort, never a reason to fail ────────────────────
        let warning: string | undefined;
        if (!effect.alreadyApplied) {
          warning = await publishReceipt(deps, record, input, effect.plan);
        }

        return {
          status: 'applied',
          spendId: record.spendId,
          experienceGained: effect.plan?.experienceGained ?? 0,
          resumed,
          alreadyApplied: effect.alreadyApplied,
          ...(warning ? { warning } : {}),
        };
      },
    ),
  );
  return value;
}

type EffectOutcome =
  | { status: 'applied'; alreadyApplied: boolean; plan: CareEffectPlan | null }
  | { status: 'ambiguous'; error: string }
  | { status: 'failed'; error: string };

/**
 * Apply the effect for ONE spend id, exactly once.
 *
 * Runs inside the pet-state transaction (per-pet lock, authoritative base,
 * monotonic `created_at`, strict publish). The spend id rides on the new
 * revision as the operation marker; a marker already on the newest state
 * means an earlier attempt landed even though the ledger never heard, and
 * nothing is republished.
 */
async function applyEffectForSpend(
  deps: ExternalConsumptionDeps,
  record: ExternalSpendRecord,
  input: ConsumeExternalItemInput,
): Promise<EffectOutcome> {
  const now = deps.now ?? Date.now;
  const action = input.definition.action;
  if (!action) return { status: 'failed', error: 'Item has no usable action' };
  try {
    return await runPetStateTransaction(
      { nostr: deps.nostr, user: deps.user as Pick<NUser, 'pubkey' | 'signer'>, now },
      record.petId,
      async (ctx): Promise<EffectOutcome> => {
        const base = await ctx.readBase();
        if (hasPetOpMarker(base.event.tags, record.spendId)) {
          return { status: 'applied', alreadyApplied: true, plan: null };
        }
        const plan = planCareEffect({
          pet: base.pet,
          action,
          effects: input.definition.effects,
          quantity: record.quantity,
          now: new Date(now()),
        });
        await ctx.publish(plan.updatedPet, {
          overrides: plan.streakOverrides,
          // Exactly one marker on the event at a time.
          dropTagNames: [PET_OP_MARKER_TAG],
          extraTags: [[PET_OP_MARKER_TAG, record.spendId]],
        });
        return { status: 'applied', alreadyApplied: false, plan };
      },
    );
  } catch (error) {
    if (error instanceof PetStateTransactionError) {
      if (error.reason === 'publish-timeout' || error.reason === 'publish-unknown') {
        return { status: 'ambiguous', error: error.message };
      }
      return { status: 'failed', error: error.message };
    }
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The kind:1124 interaction, carrying the spend id as an `e` reference marked
 * `inventory-spend`. kind:1124's canonical tags (`a`, `p`, `action`,
 * `source`, optional `blobbi`/`item`) are untouched; the reference is an
 * additional tag the parser ignores, and it makes the receipt queryable by
 * `#e` for anyone reconciling "was this spend ever fed to a Blobbi".
 */
async function publishReceipt(
  deps: ExternalConsumptionDeps,
  record: ExternalSpendRecord,
  input: ConsumeExternalItemInput,
  plan: CareEffectPlan | null,
): Promise<string | undefined> {
  if (!deps.user || !plan) return undefined;
  const now = deps.now ?? Date.now;
  try {
    const template = buildInteractionEventTemplate({
      ownerPubkey: deps.user.pubkey,
      blobbiDTag: record.petId,
      action: plan.interactionAction,
      source: 'blobbi-island',
    });
    const signed = await deps.user.signer.signEvent({
      kind: template.kind,
      content: template.content,
      tags: [
        ...template.tags,
        ['e', record.spendId, deps.relayHint ?? '', INTERACTION_SPEND_MARKER],
        ['client', 'blobbi'],
      ],
      created_at: Math.floor(now() / 1000),
    });
    await deps.nostr.event(signed, { signal: AbortSignal.timeout(RECEIPT_PUBLISH_TIMEOUT_MS) });
    return undefined;
  } catch (error) {
    return `The interaction receipt was not confirmed (${
      error instanceof Error ? error.message : String(error)
    }); the effect itself is applied.`;
  }
}

/**
 * The React hook: wires the pool, the signer, the cross-game relay policy and
 * the caches to {@link runExternalConsumption}.
 */
export function useConsumeExternalItem() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const { status, applyOptimisticUpdate } = useOptimizedStatus();
  const queryClient = useQueryClient();

  const relays = useMemo(() => externalInventoryRelays(config.relayUrl), [config.relayUrl]);

  const spendRelays = useMemo<SpendPublishDeps>(
    () => ({
      publish: (event: NostrEvent) =>
        publishToRelays(relays, event, { timeoutMs: SPEND_PUBLISH_TIMEOUT_MS }),
      findById: (id: string) => readFromExternalRelays(relays, [spendByIdFilter(id)]),
    }),
    [relays],
  );

  return useMutation({
    mutationFn: (input: ConsumeExternalItemInput): Promise<ConsumeExternalItemResult> =>
      runExternalConsumption(
        {
          user,
          nostr,
          pets: status.allPets,
          spendRelays,
          fetchState: (inventory) => fetchExternalInventoryState(relays, inventory),
          relayHint: relays[0],
          onSpendEstablished: (record) => {
            // The spend is on a relay. Put it in the SPEND cache for its
            // inventory so the effective quantity drops now — the raw
            // snapshot is never touched, which is what keeps the later
            // pending → folded transition from subtracting it twice.
            const key = externalInventoryStateQueryKey(
              input.inventory.address,
              input.inventory.fold?.eventId,
            );
            queryClient.setQueryData<{ spends: NostrEvent[]; folds: NostrEvent[] }>(
              key,
              (previous) =>
                previous && !previous.spends.some((s) => s.id === record.spendId)
                  ? { ...previous, spends: [...previous.spends, record.event] }
                  : previous,
            );
          },
          onEffectApplied: (petId, plan) => {
            applyOptimisticUpdate({
              petId,
              petUpdates: {
                ...plan.newStats,
                experience: plan.newExperience,
                careStreak: plan.newCareStreak,
                lastInteraction: plan.updatedPet.lastInteraction,
              },
            });
          },
        },
        input,
      ),
    onSettled: () => {
      if (!user?.pubkey) return;
      queryClient.invalidateQueries({
        queryKey: ['pet-states', user.pubkey],
        refetchType: 'none',
      });
    },
  });
}
