/**
 * Blobbi Island — building, signing and ESTABLISHING a kind:1416 Game
 * Inventory Spend against an inventory another game owns.
 *
 * A spend is the one thing Island writes about a foreign inventory. It is
 * player-signed, immutable, names the FULL inventory and item addresses, and
 * debits exactly one item. Island never replaces the snapshot and never
 * publishes the kind:1417 manifest that settles the spend — the owner does,
 * on its next write. Spec: `docs/1416-1417-game-inventory-spend.md` in
 * `@nostr-games/inventory`.
 *
 * ## Why this is not `useNostrPublish`
 *
 * The generic publish hook signs internally and swallows a timeout as
 * success. Both are wrong for an economic event: signing inside a retry
 * mints a SECOND spend, and "probably landed" is not a state a debit can be
 * left in. So this module takes an already-signed event, offers the SAME
 * bytes to every relay in the cross-game policy, and classifies the result
 * three ways:
 *
 * ```
 *   accepted    ≥1 relay took it          → established
 *   ambiguous   every relay silent        → look for the exact id; found → established
 *                                          not found → unconfirmed (republish SAME event later)
 *   rejected    every relay said no       → not published, safe to sign anew
 * ```
 *
 * A caller MUST NOT build a fresh spend to retry an ambiguous one. The signed
 * event is the retry.
 */

import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import type { NUser } from '@nostrify/react/login';

import type { ExternalReadResult } from './external-inventory-relays';
import {
  buildGameInventorySpendEvent,
  type BuildGameInventorySpendInput,
  type UnsignedEventTemplate,
  buildGameInventorySpendFilter,
  KIND_GAME_INVENTORY_SPEND,
} from './package';
import type { RelayPublishOutcome } from './relay-fan-out';

/** The informational `client` tag Island puts on its spends. Not an authorization. */
export const SPEND_CLIENT_NAME = 'blobbi-island';

/** The informational `purpose` tag for feeding a Blobbi. Not an authorization. */
export const SPEND_PURPOSE_FEED = 'feed:blobbi';

export interface BuildSpendInput {
  /** The FULL `31633:<owner>:<d>` inventory to debit. */
  inventoryAddress: string;
  /** A relay the inventory is known to be on, or `''`. */
  inventoryRelay?: string;
  /** The FULL `31632:<issuer>:<d>` item to debit. */
  itemAddress: string;
  /** A relay the definition is known to be on, or `''`. */
  itemRelay?: string;
  /** Positive integer. */
  quantity: number;
  purpose?: string;
  /** Distinct per player action so two identical spends in one second stay two. */
  nonce: string;
}

/**
 * The unsigned kind:1416 template, through the canonical builder.
 *
 * Only the inventory address, the item address and the quantity are
 * accounting. `purpose`, `client`, `nonce` and `alt` are informational and,
 * by the spec, never affect whether the spend is valid or applies.
 */
export function buildSpendTemplate(
  input: BuildSpendInput,
): UnsignedEventTemplate<typeof KIND_GAME_INVENTORY_SPEND> {
  const build: BuildGameInventorySpendInput = {
    inventoryAddress: input.inventoryAddress,
    inventoryRelay: input.inventoryRelay ?? '',
    itemAddress: input.itemAddress,
    itemRelay: input.itemRelay ?? '',
    quantity: input.quantity,
    purpose: input.purpose ?? SPEND_PURPOSE_FEED,
    client: SPEND_CLIENT_NAME,
    nonce: input.nonce,
    alt: `Spent ${input.quantity} item from a game inventory`,
  };
  return buildGameInventorySpendEvent(build);
}

/** An opaque uniqueness value for one player action. */
export function mintSpendNonce(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Sign a spend template as the inventory owner.
 *
 * The signer IS the authority: a spend is valid only when `event.pubkey`
 * equals the owner inside the inventory address, and the package parser
 * rejects anything else. The check here is defence in depth — a caller that
 * hands a stranger's inventory to the player's signer gets an error before
 * the player is asked to sign a debit that could never apply.
 */
export async function signSpend(
  user: Pick<NUser, 'pubkey' | 'signer'>,
  template: UnsignedEventTemplate<typeof KIND_GAME_INVENTORY_SPEND>,
  createdAt: number,
): Promise<NostrEvent> {
  const ownerInAddress = template.tags.find(
    (tag) => tag[0] === 'a' && tag[3] === 'inventory',
  )?.[1]?.split(':')[1];
  if (ownerInAddress !== user.pubkey) {
    throw new Error('A spend must be signed by the inventory owner');
  }
  return user.signer.signEvent({
    kind: template.kind,
    content: template.content ?? '',
    tags: [...template.tags],
    created_at: createdAt,
  });
}

/** The relay surface establishing a spend needs. Injectable for tests. */
export interface SpendPublishDeps {
  /** Offer the exact signed event to every relay in the cross-game policy. */
  publish(event: NostrEvent): Promise<RelayPublishOutcome[]>;
  /** Look for a spend by exact id on the same relays. */
  findById(id: string): Promise<ExternalReadResult>;
}

export type SpendEstablishOutcome =
  /** The spend exists on at least one relay. The debit is real. */
  | { status: 'established'; acceptedRelays: string[]; via: 'accepted' | 'found' }
  /**
   * Every relay went silent and the id was not found. The event MAY exist.
   * The only correct retry is to publish this same signed event again.
   */
  | { status: 'unconfirmed'; error: string }
  /** Every relay answered with a definite refusal. Provably not published. */
  | { status: 'rejected'; error: string };

/** The filter that finds one spend by exact id. */
export function spendByIdFilter(id: string): NostrFilter {
  return buildGameInventorySpendFilter({ ids: [id] }) as unknown as NostrFilter;
}

/**
 * Offer a signed spend to the relays and decide whether it is established.
 *
 * Idempotent by construction: publishing an immutable event a relay already
 * holds is a no-op, so this may be called again with the same event after an
 * `unconfirmed` outcome. It must NEVER be called with a re-signed copy.
 */
export async function establishSpend(
  deps: SpendPublishDeps,
  signed: NostrEvent,
): Promise<SpendEstablishOutcome> {
  const outcomes = await deps.publish(signed);
  const acceptedRelays = outcomes.filter((o) => o.ok).map((o) => o.relay);
  if (acceptedRelays.length > 0) {
    return { status: 'established', acceptedRelays, via: 'accepted' };
  }

  const errors = outcomes
    .map((o) => `${o.relay}: ${o.error ?? 'refused'}`)
    .join('; ');
  const anyIndefinite = outcomes.some((o) => o.indefinite);
  if (!anyIndefinite) {
    return { status: 'rejected', error: errors || 'No relay accepted the spend.' };
  }

  // Silence is not refusal. Before reporting "unknown", ask for the exact id:
  // a relay that timed out on the acknowledgement may still hold the event.
  const found = await deps.findById(signed.id);
  const relaysHoldingIt = found.events.some((event) => event.id === signed.id);
  if (relaysHoldingIt) {
    return { status: 'established', acceptedRelays: [], via: 'found' };
  }
  return { status: 'unconfirmed', error: errors || 'Every relay went quiet.' };
}
