/**
 * Blobbi Island — CANONICAL protocol registry.
 *
 * This module is the single machine-readable source of truth for:
 *
 *   1. every Nostr event kind Blobbi Island reads or writes, and
 *   2. every official kind:31632 Game Item Definition Blobbi Island recognises.
 *
 * Everything else derives from here:
 *
 * ```
 *                       src/protocol/event-registry.ts        (this file)
 *                                   │
 *          ┌────────────────────────┼───────────────────────────┐
 *          ▼                        ▼                           ▼
 *  src/inventory/registry.ts   src/inventory/            src/protocol/
 *  (addresses, id maps)        catalog-fallback.ts       registry-markdown.ts
 *          │                   (offline catalog)          (generated docs)
 *          ▼                                                    │
 *  src/inventory/shop-catalog.ts                                ▼
 *  (LOCAL coin prices,      docs/protocol/blobbi-island-event-registry.md
 *   validated against this
 *   registry — see below)
 * ```
 *
 * Before this file existed, the same facts were maintained by hand in four
 * places (`registry.ts`, `catalog-fallback.ts`, `shop-catalog.ts` and `NIP.md`)
 * and could silently drift. They cannot now: each is a projection of the data
 * below, and a test regenerates the Markdown and fails if it is stale.
 *
 * ## What this file deliberately does NOT contain
 *
 * - **No secrets.** No private key, nsec, seed, bunker URI or signing material.
 *   The issuer is identified by its PUBLIC key only. Publishing official
 *   definitions is a human, out-of-band process (see the generated document).
 * - **No prices.** A coin price is Island-local ECONOMY configuration with its
 *   own lifecycle (promotions, per-shop variation, a future ticket currency); it
 *   is not part of a kind:31632 definition and must not be presented as one.
 *   Prices live in `src/inventory/shop-catalog.ts`, a distinct domain that is
 *   VALIDATED against this registry at module load — a separate source, not a
 *   drifting duplicate.
 * - **No inferred semantics.** Every entry is grounded in code that exists or in
 *   a document in this repository. Two status axes keep that honest:
 *   {@link ClientImplementationStatus} says what THIS client does, and
 *   {@link ProtocolStatus} says what the wider Blobbi protocol says — the second
 *   may only claim `superseded` with a citation. "Island does not implement it"
 *   is never recorded as "the ecosystem retired it".
 * - **No ownership claims over external kinds.** `31632` / `31633` belong to
 *   `@nostr-games/inventory`; Blobbi Island is a consumer, not the definer.
 *
 * ## Recovery boundary
 *
 * See {@link RECOVERY_BOUNDARY}. In short: this registry holds enough canonical
 * information to recreate and republish the OFFICIAL, issuer-signed item
 * definitions. It cannot reconstruct anything a USER signed — inventory
 * quantities, coins, owned Blobbis, or history.
 */

import {
  KIND_GAME_ITEM_DEFINITION,
  KIND_GAME_INVENTORY,
  KIND_GAME_INVENTORY_FOLD,
  KIND_GAME_INVENTORY_SPEND,
  KIND_GAME_ITEM_PLACEMENT,
} from '@nostr-games/inventory';
import { buildGameItemAddress } from '@nostr-games/inventory';

import {
  KIND_BLOBBI_INTERACTION,
  KIND_BLOBBI_STATE,
  KIND_BLOBBONAUT_PROFILE,
  KIND_BLOBBONAUT_PROFILE_LEGACY,
} from '@/lib/blobbi-kinds';
import { CHAT_KIND } from '@/lib/chat-config';
import {
  KIND_SHARED_PLAYBACK_COMMAND,
  KIND_SHARED_PLAYBACK_SESSION,
} from '@/lib/shared-playback/constants';
import {
  OFFICIAL_ITEM_ISSUER_PUBKEY,
  OFFICIAL_ITEM_RELAYS,
} from '@/inventory/constants';

// ---------------------------------------------------------------------------
// Application event kinds
// ---------------------------------------------------------------------------

/**
 * Nostr storage class, per NIP-01 kind ranges. `addressable` is NIP-01's
 * "parameterized replaceable" (30000–39999).
 */
export type EventClass =
  | 'regular'
  | 'replaceable'
  | 'ephemeral'
  | 'addressable';

/**
 * How the code IN THIS REPOSITORY relates to a kind. Scoped to the Blobbi
 * Island client and nothing else.
 *
 * - `implemented`      — this client reads AND writes it.
 * - `read-only`        — this client reads it as a first-class part of the
 *                        product but never writes it (someone else publishes it).
 * - `read-compat`      — this client reads it only for backward compatibility
 *                        with superseded data, and never writes it.
 * - `not-implemented`  — no code in `src/` queries, parses or publishes it.
 *
 * `not-implemented` is a statement about THIS CLIENT ONLY. It says nothing
 * about whether the kind is alive elsewhere in the Blobbi ecosystem — that is
 * {@link ProtocolStatus}, which is a separate axis on purpose.
 */
export type ClientImplementationStatus =
  | 'implemented'
  | 'read-only'
  | 'read-compat'
  | 'not-implemented';

/**
 * What the wider Blobbi protocol says about a kind, as far as THIS REPOSITORY
 * can evidence.
 *
 * - `current`      — in use and not replaced.
 * - `superseded`   — a document in this repository names a replacement. Only
 *                    valid with {@link ApplicationEventKind.protocolStatusEvidence}
 *                    citing where that is stated.
 * - `undetermined` — this repository contains no statement either way. The kind
 *                    may still be live in another Blobbi client; absence of code
 *                    here is not evidence of deprecation anywhere else.
 *
 * The conservative default is `undetermined`. Claiming `superseded` without a
 * citation would turn "we don't implement it" into "the ecosystem dropped it",
 * which this repository is not in a position to assert.
 */
export type ProtocolStatus = 'current' | 'superseded' | 'undetermined';

/** Who defines the kind's schema. */
export type KindOwnership = 'blobbi-island' | 'external-package';

/** Who is expected to sign events of this kind. */
export type EventAuthority =
  | 'player'
  | 'official-item-issuer'
  | 'session-host'
  | 'player-or-ditto';

export interface ApplicationEventKind {
  /** The kind number. */
  kind: number;
  /** Canonical human-readable name. */
  name: string;
  /** What the kind is for, in one sentence. */
  purpose: string;
  eventClass: EventClass;
  /** Address template, or `null` for non-addressable kinds. */
  addressFormat: string | null;
  /** Expected signer. */
  authority: EventAuthority;
  /** How instances are created, renewed and retired. */
  lifecycle: string;
  /** NIP-40 expiration behaviour, or `null` when the kind does not expire. */
  expiration: string | null;
  /** What THIS client does with the kind. */
  clientStatus: ClientImplementationStatus;
  /** What the wider protocol says, as evidenced by this repository. */
  protocolStatus: ProtocolStatus;
  /**
   * Where `protocolStatus` comes from. REQUIRED for `superseded` — a claim that
   * a kind is retired must cite the document that says so. `null` for `current`
   * and `undetermined`.
   */
  protocolStatusEvidence: string | null;
  ownership: KindOwnership;
  /** Package that defines the schema, when `ownership` is `external-package`. */
  owningPackage?: string;
  /** Repo-relative files that implement or define this kind. */
  sourceFiles: readonly string[];
  /** Repo-relative documents describing this kind. */
  docs: readonly string[];
  /** Kind that replaced this one, when superseded. */
  supersededBy?: number;
  /** Anything a reader would otherwise have to discover by reading code. */
  notes?: string;
}

/**
 * Presence kind. Unlike every other kind here there is no exported constant to
 * import — `31950` is written as a literal in `src/lib/multiplayer.ts` and
 * `src/hooks/useIslandPresence.ts`. Recorded here as a literal with that fact
 * stated rather than silently duplicating a magic number.
 */
const KIND_ISLAND_PRESENCE = 31950;

/**
 * Kinds defined by the original NIP-BB draft (`MD/old-NIP.md`), which specifies
 * `31124`, `14919`, `14920` and `14921`. None of the three below is queried,
 * parsed or published by any code in `src/`.
 *
 * That is a fact about THIS CLIENT. Only `14919` additionally has a documented
 * replacement in this repository; for the other two, this repository simply does
 * not say. They are recorded so the numbers are neither reused nor mistaken for
 * retired.
 */
const KIND_DRAFT_INTERACTION = 14919;
const KIND_DRAFT_BREEDING = 14920;
const KIND_DRAFT_RECORD = 14921;

export const APPLICATION_EVENT_KINDS: readonly ApplicationEventKind[] = [
  {
    kind: KIND_BLOBBI_INTERACTION, // 1124
    name: 'Blobbi Social Interaction',
    purpose:
      'Append-only log of a care/social action performed on a Blobbi (feed, play, clean, medicate, boost).',
    eventClass: 'regular',
    addressFormat: null,
    authority: 'player',
    lifecycle:
      'Written once per interaction; never edited. The resulting state change is reflected in kind 31124.',
    expiration: null,
    clientStatus: 'implemented',
    protocolStatus: 'current',
    protocolStatusEvidence: null,
    ownership: 'blobbi-island',
    sourceFiles: [
      'src/lib/blobbi-kinds.ts',
      'src/inventory/useUseItem.ts',
      'src/hooks/useBlobbiEvents.ts',
    ],
    docs: ['NIP.md'],
    notes:
      'Kind number and event builder come from @blobbi-kit/core (blobbi-interaction).',
  },
  {
    kind: KIND_BLOBBONAUT_PROFILE, // 11125
    name: 'Blobbonaut Owner Profile',
    purpose:
      "The player's account: owned Blobbis, achievements, current companion. (Historic `coins` tag deprecated by the Coin cutover.)",
    eventClass: 'replaceable',
    addressFormat: null,
    authority: 'player-or-ditto',
    lifecycle:
      'One per pubkey, republished in full on every change. Unknown tags are preserved on republish.',
    expiration: null,
    clientStatus: 'implemented',
    protocolStatus: 'current',
    protocolStatusEvidence: null,
    ownership: 'blobbi-island',
    sourceFiles: [
      'src/lib/blobbi-parsers.ts',
      'src/hooks/useBlobbiEvents.ts',
      'src/hooks/useBlobbonautProfile.ts',
      'src/hooks/useOptimizedStatus.ts',
      'src/hooks/useFirstEggAdoption.ts',
    ],
    docs: ['NIP.md', 'docs/INVENTORY_ARCHITECTURE.md', 'docs/blobbi-coin-cutover.md'],
    notes:
      'Consumable inventory is NOT stored here; it lives in kind 31633. Coins do NOT live here since the economy reset: the canonical balance is the official Blobbi Coin quantity in kind 31633, and a pre-existing `coins` tag is obsolete historical data — never migrated, never read for economic decisions, never displayed, never updated; it rides the unknown-tag passthrough verbatim on every republish. No production writer emits it.',
  },
  {
    kind: KIND_BLOBBONAUT_PROFILE_LEGACY, // 31125
    name: 'Blobbonaut Owner Profile (legacy)',
    purpose: 'Superseded owner-profile kind, still read for backward compatibility.',
    eventClass: 'addressable',
    addressFormat: '31125:<pubkey>:<d>',
    authority: 'player-or-ditto',
    lifecycle: 'Queried alongside 11125; never written by this client.',
    expiration: null,
    clientStatus: 'read-compat',
    protocolStatus: 'superseded',
    protocolStatusEvidence:
      "NIP.md, 'Legacy / superseded kinds': superseded by kind 11125. @blobbi-kit/core also marks KIND_BLOBBONAUT_PROFILE_LEGACY @deprecated.",
    ownership: 'blobbi-island',
    supersededBy: KIND_BLOBBONAUT_PROFILE,
    sourceFiles: ['src/lib/blobbi-kinds.ts', 'src/hooks/useOptimizedStatus.ts'],
    docs: ['NIP.md'],
    notes:
      'Included in BLOBBONAUT_PROFILE_KINDS, so profile queries still return it.',
  },
  {
    kind: KIND_BLOBBI_STATE, // 31124
    name: 'Blobbi Pet State',
    purpose:
      'Full state of one Blobbi creature: stats, stage, appearance, personality, care timestamps.',
    eventClass: 'addressable',
    addressFormat: '31124:<pubkey>:<blobbiD>',
    authority: 'player-or-ditto',
    lifecycle:
      'One per Blobbi, republished on every state change. Unknown tags are preserved.',
    expiration: null,
    clientStatus: 'implemented',
    protocolStatus: 'current',
    protocolStatusEvidence: null,
    ownership: 'blobbi-island',
    sourceFiles: [
      'src/lib/blobbi-parsers.ts',
      'src/hooks/useBlobbis.ts',
      'src/hooks/useBlobbiEvents.ts',
      'src/inventory/useUseItem.ts',
    ],
    docs: ['NIP.md'],
  },
  {
    kind: CHAT_KIND, // 21201
    name: 'Island Chat',
    purpose: 'In-world speech-bubble chat message shown above a player Blobbi.',
    eventClass: 'ephemeral',
    addressFormat: null,
    authority: 'player',
    lifecycle:
      'Transient; not expected to be stored. Deduplicated per pubkey+session within a short window.',
    expiration: 'NIP-40, ~10 seconds',
    clientStatus: 'implemented',
    protocolStatus: 'current',
    protocolStatusEvidence: null,
    ownership: 'blobbi-island',
    sourceFiles: ['src/lib/chat-config.ts', 'src/hooks/useChatBubbles.ts'],
    docs: ['NIP.md'],
  },
  {
    kind: KIND_ISLAND_PRESENCE, // 31950
    name: 'Island Presence',
    purpose:
      'Real-time multiplayer presence: location, position, movement goal, seat, hiding spot and shared activity.',
    eventClass: 'addressable',
    addressFormat: '31950:<pubkey>:session:<uuid>',
    authority: 'player',
    lifecycle:
      'One per browser session, renewed by a ~25 s heartbeat; stale players disappear when the event expires.',
    expiration: 'NIP-40, ~35 seconds',
    clientStatus: 'implemented',
    protocolStatus: 'current',
    protocolStatusEvidence: null,
    ownership: 'blobbi-island',
    sourceFiles: [
      'src/lib/multiplayer.ts',
      'src/hooks/useIslandPresence.ts',
      'src/lib/theater-occupancy.ts',
    ],
    docs: ['NIP.md'],
    notes:
      'The kind number is a literal in multiplayer.ts / useIslandPresence.ts; there is no exported constant to import.',
  },
  {
    kind: KIND_SHARED_PLAYBACK_SESSION, // 31951
    name: 'Shared Playback Session',
    purpose:
      'Canonical, host-authoritative state of a synchronized watch session in the theater.',
    eventClass: 'addressable',
    addressFormat: '31951:<host-pubkey>:<uuid>',
    authority: 'session-host',
    lifecycle:
      'Fresh UUID per session, republished every ~20 s with the same rev; status flips to "ended" on teardown.',
    expiration: 'NIP-40, 4 h while active, 10 min once ended',
    clientStatus: 'implemented',
    protocolStatus: 'current',
    protocolStatusEvidence: null,
    ownership: 'blobbi-island',
    sourceFiles: [
      'src/lib/shared-playback/constants.ts',
      'src/lib/shared-playback/parse.ts',
      'src/lib/shared-playback/publish.ts',
      'src/hooks/useSharedPlayback.ts',
    ],
    docs: [
      'NIP.md',
      'docs/protocol/shared-playback-session.md',
      'docs/theater-shared-watch-implementation.md',
    ],
    notes:
      'Experimental and application-private by convention only; consumers MUST validate structurally rather than trusting the kind number.',
  },
  {
    kind: KIND_SHARED_PLAYBACK_COMMAND, // 21951
    name: 'Shared Playback Command',
    purpose:
      'Low-latency playback command (play/pause/seek/set-media/set-rate/end-session) for a watch session.',
    eventClass: 'ephemeral',
    addressFormat: null,
    authority: 'session-host',
    lifecycle:
      'Fire-and-forget optimization. A client that never receives one is still correct: kind 31951 is the recoverable source of truth.',
    expiration: 'NIP-40, ~30 seconds',
    clientStatus: 'implemented',
    protocolStatus: 'current',
    protocolStatusEvidence: null,
    ownership: 'blobbi-island',
    sourceFiles: [
      'src/lib/shared-playback/constants.ts',
      'src/lib/shared-playback/parse.ts',
      'src/lib/shared-playback/publish.ts',
    ],
    docs: ['NIP.md', 'docs/protocol/shared-playback-session.md'],
    notes:
      'Absolute positions only, so a command is idempotent under duplicate delivery.',
  },
  {
    kind: KIND_GAME_ITEM_DEFINITION, // 31632
    name: 'Game Item Definition',
    purpose:
      'Canonical definition of an item. Blobbi Island trusts only definitions signed by the official issuer.',
    eventClass: 'addressable',
    addressFormat: '31632:<issuer>:<d>',
    authority: 'official-item-issuer',
    lifecycle:
      'Published out-of-band by the issuer; republished to update metadata. This client never writes it.',
    expiration: null,
    clientStatus: 'read-only',
    protocolStatus: 'current',
    protocolStatusEvidence: null,
    ownership: 'external-package',
    owningPackage: '@nostr-games/inventory',
    sourceFiles: [
      'src/inventory/useItemCatalog.ts',
      'src/inventory/protocol-adapter.ts',
      'src/inventory/registry.ts',
      'src/inventory/catalog-fallback.ts',
    ],
    docs: ['NIP.md', 'docs/INVENTORY_ARCHITECTURE.md'],
    notes:
      'Schema, parsing and validation are owned by @nostr-games/inventory. Blobbi Island is a consumer and adds only issuer enforcement plus an offline fallback.',
  },
  {
    kind: KIND_GAME_INVENTORY, // 31633
    name: 'Game Inventory',
    purpose:
      "The player's item inventory: kind:31632 addresses with integer quantities.",
    eventClass: 'addressable',
    addressFormat: '31633:<owner>:<d>',
    authority: 'player',
    lifecycle:
      'One per player for Blobbi Island (d = "blobbi:island"), rebuilt in full on every mutation from a fresh relay read.',
    expiration: null,
    clientStatus: 'implemented',
    protocolStatus: 'current',
    protocolStatusEvidence: null,
    ownership: 'external-package',
    owningPackage: '@nostr-games/inventory',
    sourceFiles: [
      'src/inventory/useIslandInventory.ts',
      'src/inventory/useInventoryMutation.ts',
      'src/inventory/constants.ts',
      'src/inventory/economy-entry.ts',
    ],
    docs: ['NIP.md', 'docs/INVENTORY_ARCHITECTURE.md'],
    notes:
      'Replaceable semantics mean concurrent writes from two clients resolve newest-wins; there is no relay-side locking. Every write is lossless for foreign data (content, contexts, grant refs, unknown tags). The economy-entry service publishes the exactly-once initial 200-Coin allocation with its durable allocation marker tag in the same replacement event (see src/inventory/economy-entry.ts for the canonical marker).',
  },
  {
    kind: KIND_GAME_INVENTORY_SPEND, // 1416
    name: 'Game Inventory Spend',
    purpose:
      'A player-signed debit of one item quantity from one kind:31633 inventory — how Island consumes an item owned in an inventory another game writes (first: Farm produce), without ever replacing that snapshot.',
    eventClass: 'regular',
    addressFormat: null,
    authority: 'player',
    lifecycle:
      'Immutable; the event id is the durable identity of the consumption. Published to the cross-game relay set; a retry after an ambiguous publish republishes the SAME signed event. Settled later by the owning game\'s kind:1417 fold.',
    expiration: null,
    clientStatus: 'implemented',
    protocolStatus: 'current',
    protocolStatusEvidence: null,
    ownership: 'external-package',
    owningPackage: '@nostr-games/inventory',
    sourceFiles: [
      'src/inventory/external-spend.ts',
      'src/inventory/useConsumeExternalItem.ts',
      'src/lib/external-spend-ledger.ts',
    ],
    docs: ['NIP.md', 'docs/INVENTORY_ARCHITECTURE.md'],
    notes:
      'Author MUST be the inventory owner (the package parser rejects anything else). Exactly one full inventory address, one full item address and one quantity; purpose/client/nonce/alt are informational and never affect accounting. Island signs at most one per player action and applies the Blobbi effect at most once per spend id (kind:31124 `blobbi_op` marker).',
  },
  {
    kind: KIND_GAME_INVENTORY_FOLD, // 1417
    name: 'Game Inventory Fold Manifest',
    purpose:
      "The owning game's record of exactly which kind:1416 spends a kind:31633 snapshot has incorporated (spend) or permanently closed (void).",
    eventClass: 'regular',
    addressFormat: null,
    authority: 'player',
    lifecycle:
      'Immutable, chained through `previous` references, written by the inventory OWNER before the snapshot that references it. Island only reads these to derive effective balances.',
    expiration: null,
    clientStatus: 'read-only',
    protocolStatus: 'current',
    protocolStatusEvidence: null,
    ownership: 'external-package',
    owningPackage: '@nostr-games/inventory',
    sourceFiles: [
      'src/inventory/external-inventory-state.ts',
      'src/inventory/external-inventory-events.ts',
      'src/inventory/useExternalInventoryEvents.ts',
    ],
    docs: ['docs/INVENTORY_ARCHITECTURE.md'],
    notes:
      'Island NEVER publishes one: folding is the owning game\'s act, and Island owns no external inventory. The builder is not re-exported from src/inventory/package.ts and a contract test asserts no production module reaches it. An unresolvable chain means no balance — the row is shown as unavailable and never spent against.',
  },
  {
    kind: KIND_GAME_ITEM_PLACEMENT, // 31634
    name: 'Game Item Placement',
    purpose:
      "Where a player's owned items are equipped or placed — Island uses one equipment document per Blobbi for wearable cosmetics and visual effects.",
    eventClass: 'addressable',
    addressFormat: '31634:<owner>:<d>',
    authority: 'player',
    lifecycle:
      'One document per Blobbi (d = "blobbi-island:character:<characterId>:equipment"), rebuilt in full on every mutation from a fresh relay read; unknown fields and unrelated entries are preserved.',
    expiration: null,
    clientStatus: 'implemented',
    protocolStatus: 'current',
    protocolStatusEvidence: null,
    ownership: 'external-package',
    owningPackage: '@nostr-games/inventory',
    sourceFiles: [
      'src/placement/identity.ts',
      'src/placement/usePlacementState.ts',
      'src/placement/useEquipmentMutation.ts',
      'src/placement/policy.ts',
      'src/placement/useCharacterEquipment.ts',
    ],
    docs: [
      'docs/blobbi-placement-activation-audit.md',
      'docs/blobbi-effect-activation.md',
    ],
    notes:
      'Placement is never possession: equipping requires kind:31633 quantity > 0 and never consumes it. Authorization (author, ownership, issuer, slot, form) is Island policy in src/placement/policy.ts; the package owns parsing/building only.',
  },
  {
    kind: KIND_DRAFT_INTERACTION, // 14919
    name: 'Blobbi Interaction (NIP-BB draft)',
    purpose:
      'Interaction log defined by the original NIP-BB draft; this client uses kind 1124 instead.',
    eventClass: 'regular',
    addressFormat: null,
    authority: 'player',
    lifecycle:
      'Not produced or consumed by this client. Recorded so the number is neither reused nor mistaken for available.',
    expiration: null,
    clientStatus: 'not-implemented',
    protocolStatus: 'superseded',
    protocolStatusEvidence:
      "NIP.md, 'Legacy / superseded kinds': \"14919 → superseded by 1124 — Old interaction kind from the original NIP-BB draft\".",
    ownership: 'blobbi-island',
    supersededBy: KIND_BLOBBI_INTERACTION,
    sourceFiles: [],
    docs: ['MD/old-NIP.md', 'NIP.md'],
    notes:
      'No code in src/ queries, parses or publishes this kind. NIP.md heads its legacy table "queried for backward compatibility"; that is accurate for kind 31125 but NOT for 14919, which nothing reads. Other Blobbi clients may still write it — this repository only evidences that Island replaced it with 1124.',
  },
  {
    kind: KIND_DRAFT_BREEDING, // 14920
    name: 'Blobbi Breeding Event (NIP-BB draft)',
    purpose:
      'Cross-breeding event between two adult Blobbis, defined by the original NIP-BB draft.',
    eventClass: 'regular',
    addressFormat: null,
    authority: 'player',
    lifecycle:
      'Not produced or consumed by this client. Recorded so the number is neither reused nor mistaken for available.',
    expiration: null,
    clientStatus: 'not-implemented',
    protocolStatus: 'undetermined',
    protocolStatusEvidence: null,
    ownership: 'blobbi-island',
    sourceFiles: [],
    docs: ['MD/old-NIP.md'],
    notes:
      'Blobbi Island has no breeding feature, so nothing here reads or writes it. NO document in this repository deprecates or replaces it, so its ecosystem status is undetermined: it may be live in another Blobbi client.',
  },
  {
    kind: KIND_DRAFT_RECORD, // 14921
    name: 'Blobbi Record (NIP-BB draft)',
    purpose:
      'Permanent milestone/lineage record (birth, hatching, evolution) defined by the original NIP-BB draft.',
    eventClass: 'regular',
    addressFormat: null,
    authority: 'player',
    lifecycle:
      'Not produced or consumed by this client. Recorded so the number is neither reused nor mistaken for available.',
    expiration: null,
    clientStatus: 'not-implemented',
    protocolStatus: 'undetermined',
    protocolStatusEvidence: null,
    ownership: 'blobbi-island',
    sourceFiles: [],
    docs: ['MD/old-NIP.md'],
    notes:
      'Blobbi Island publishes no hatch/milestone event: adoption publishes only the final kind 31124 baby state (src/hooks/useFirstEggAdoption.ts). NO document in this repository deprecates or replaces 14921, and NIP.md does not mention it at all, so its ecosystem status is undetermined — it may be live in another Blobbi client.',
  },
];

// ---------------------------------------------------------------------------
// Official item definitions
// ---------------------------------------------------------------------------

/**
 * Gameplay actions an item can trigger when used on a Blobbi.
 *
 * Exported as an array so the protocol adapter's validation set derives from
 * here instead of maintaining a parallel literal list.
 */
export const ITEM_ACTIONS = [
  'feed',
  'play',
  'medicine',
  'clean',
  'boost',
] as const;

/** Gameplay action an item triggers when used on a Blobbi. */
export type ItemActionName = (typeof ITEM_ACTIONS)[number];

/** Blobbi lifecycle stages an item may be used on. */
export const ITEM_STAGES = ['egg', 'baby', 'adult'] as const;

/** Blobbi lifecycle stage an item may be used on. */
export type ItemStageName = (typeof ITEM_STAGES)[number];

/**
 * Item categories recognised by Blobbi Island.
 *
 * `currency` is NOT a care category: currency items have `action: null`, carry
 * no stat effects, and are never offered as a consumable anywhere in the UI.
 * Every consumer that renders or filters categories derives its list from here.
 */
export const ITEM_CATEGORIES = [
  'food',
  'toy',
  'medicine',
  'hygiene',
  'energy',
  'currency',
] as const;

export type ItemCategoryName = (typeof ITEM_CATEGORIES)[number];

/**
 * Categories that represent consumable care items — i.e. everything that can be
 * used on a Blobbi and sold in the shop. Derived by exclusion so adding a new
 * non-care category cannot silently make it consumable.
 */
export const CONSUMABLE_ITEM_CATEGORIES: readonly ItemCategoryName[] =
  ITEM_CATEGORIES.filter((c) => c !== 'currency');

/** Stat effects applied when an item is used. */
export interface ItemEffectsShape {
  hunger?: number;
  energy?: number;
  hygiene?: number;
  happiness?: number;
  health?: number;
}

/**
 * Publication status of an official item definition.
 *
 * - `active`     — the issuer-signed kind:31632 event is published and live.
 * - `reserved`   — the identity (d/address) is claimed and the client can
 *                  already resolve it from the bundled fallback, but the
 *                  official event has NOT been published yet.
 * - `deprecated` — was published, no longer offered; kept so existing player
 *                  inventories still resolve.
 */
export type OfficialItemStatus = 'active' | 'reserved' | 'deprecated';

export interface OfficialItemDefinition {
  /** The kind:31632 `d` tag. Canonical identity together with the issuer. */
  d: string;
  /** Legacy/UI identifier. Never protocol identity. */
  itemId: string;
  /** `name` tag. */
  name: string;
  /**
   * Human-readable description.
   *
   * `null` for the 19 items whose published definitions carry no description —
   * inventing copy here would misrepresent what is on relays. Non-null values
   * are intended for the `alt` tag and `content.metadata.description` of a
   * definition that has not been published yet.
   */
  description: string | null;
  /** `type` tag. */
  type: string;
  /** `category` tag. */
  category: ItemCategoryName;
  /** Emoji used when no image is available. */
  emoji: string;
  /**
   * Official artwork URL (the `image` tag), or `null` when no artwork exists.
   *
   * When non-null this is BOTH what the published definition's `image` tag must
   * say and what the bundled fallback renders, so the client shows the same
   * artwork whether or not the definition can be fetched.
   */
  image: string | null;
  /** Gameplay action, or `null` for items that cannot be used on a Blobbi. */
  action: ItemActionName | null;
  /** Stages the item may be used on. Meaningless when `action` is null. */
  stages: readonly ItemStageName[];
  /** Stat effects. Empty for non-care items. */
  effects: Readonly<ItemEffectsShape>;
  /** `t` topic tags. */
  topics: readonly string[];
  status: OfficialItemStatus;
  /** Whether quantities stack in kind:31633. All Blobbi items stack today. */
  stackable: boolean;
  /** Repo-relative files that consume this item specifically, if any. */
  sourceFiles?: readonly string[];
  //
  // DELIBERATELY ABSENT: price.
  //
  // A coin price is Island-local ECONOMY configuration, not a protocol or
  // definition fact. It is not part of the kind:31632 event, it can change
  // independently of the definition, it may vary by shop or promotion, and a
  // second currency (ticket prices in the arcade prize shop) will need its own
  // price domain rather than a second field here. Prices live in
  // `src/inventory/shop-catalog.ts`, which validates every entry against this
  // registry — see `CONSUMABLE_ITEM_CATEGORIES` below for the rule that keeps
  // currency out of the coin shop.
}

/**
 * The canonical Arcade Ticket identity.
 *
 * Follows the established `blobbi:<category>:<slug>` convention used by all 19
 * existing official items (see `docs/arcade-audit.md` §11.1).
 */
export const ARCADE_TICKET_D = 'blobbi:currency:arcade-ticket';

/**
 * Production artwork for the Arcade Ticket — the single place this URL is
 * written.
 *
 * It is the exact value that must appear in the published definition's `image`
 * tag, and the value the bundled fallback renders when the definition cannot be
 * fetched. Served immutable (`cache-control: public, max-age=31536000,
 * immutable`) with `access-control-allow-origin: *`, so a new revision means a
 * new versioned filename (`-v2`), never a mutated `-v1`.
 *
 * It is deliberately NOT `/assets/items/tickets/arcade-ticket.png`: that asset
 * is the ARCADE PASS artwork (temporary floor-access state), and the Arcade
 * Ticket is a separate, persistent currency. Reusing it would conflate two
 * distinct concepts in the UI.
 *
 * NOTE: artwork existing does NOT make the item `active`. The ticket stays
 * `reserved` until the issuer-signed kind:31632 event is published AND fetched
 * back from both official relays — see `docs/protocol/arcade-ticket-publication.md`.
 */
export const ARCADE_TICKET_IMAGE_URL =
  'https://assets.blobbi.pet/items/arcade/arcade-ticket-v1.webp';

/**
 * The canonical Arcade Token identity — the arcade's PAY-TO-PLAY currency.
 *
 * Bought with Blobbi Coins, spent to start a game. Deliberately NOT the Arcade
 * Ticket, which travels the opposite way: Tickets are what a game PAYS OUT and
 * what the Prize Counter accepts. Two arcade currencies, opposite directions,
 * and the UI must never blur them.
 *
 * Identity is the stable address `31632:<issuer>:blobbi:currency:arcade-token`.
 * The published revision's event id is recorded as provenance in
 * `src/arcade/tokens/arcade-token.ts` and is never an ownership key — quantity
 * lives in the player's kind:31633 like every other item.
 */
export const ARCADE_TOKEN_D = 'blobbi:currency:arcade-token';

/**
 * The canonical Blobbi Coin identity — the island's OFFICIAL currency.
 *
 * The issuer-signed kind:31632 definition is published (see
 * `docs/blobbi-coin-cutover.md` for the verification record). Identity is the
 * stable address `31632:<issuer>:blobbi:currency:coin` — the event id of the
 * currently observed revision is a diagnostic in `src/inventory/coin.ts`,
 * never identity.
 *
 * The published definition intentionally omits `max_stack` (the inventory
 * spec makes it optional and games MAY ignore it); the application-level
 * balance ceiling lives in `src/inventory/coin.ts`, enforced by the wallet —
 * never by rejecting the definition.
 */
export const BLOBBI_COIN_D = 'blobbi:currency:coin';

/** Published front artwork (`image` tag + `front` view) of the Blobbi Coin. */
export const BLOBBI_COIN_IMAGE_URL =
  'https://blossom.primal.net/e18905da8edcf4d620be8b2106b6a890a29f073f35254b3241c53aded3917a27.webp';

/** Published back-view artwork of the Blobbi Coin. */
export const BLOBBI_COIN_IMAGE_BACK_URL =
  'https://blossom.primal.net/7e8046f5bc216ad0fdabc71fa91be2f241e9fa126ebade2c3c11375b0c7f968e.webp';

export const OFFICIAL_ITEM_DEFINITIONS: readonly OfficialItemDefinition[] = [
  // --- Food (action: feed; stages: baby, adult) ---
  {
    d: 'blobbi:food:apple',
    itemId: 'food_apple',
    name: 'Apple',
    description: null,
    type: 'consumable',
    category: 'food',
    emoji: '🍎',
    image: null,
    action: 'feed',
    stages: ['baby', 'adult'],
    effects: { hunger: 25, hygiene: -2, energy: 5 },
    topics: ['edible', 'food'],
    status: 'active',
    stackable: true,
  },
  {
    d: 'blobbi:food:burger',
    itemId: 'food_burger',
    name: 'Burger',
    description: null,
    type: 'consumable',
    category: 'food',
    emoji: '🍔',
    image: null,
    action: 'feed',
    stages: ['baby', 'adult'],
    effects: { hunger: 45, happiness: 10, hygiene: -8, energy: 8 },
    topics: ['edible', 'food'],
    status: 'active',
    stackable: true,
  },
  {
    d: 'blobbi:food:cake',
    itemId: 'food_cake',
    name: 'Cake',
    description: null,
    type: 'consumable',
    category: 'food',
    emoji: '🎂',
    image: null,
    action: 'feed',
    stages: ['baby', 'adult'],
    effects: { hunger: 25, happiness: 30, hygiene: -10, energy: 10 },
    topics: ['edible', 'food'],
    status: 'active',
    stackable: true,
  },
  {
    d: 'blobbi:food:pizza',
    itemId: 'food_pizza',
    name: 'Pizza',
    description: null,
    type: 'consumable',
    category: 'food',
    emoji: '🍕',
    image: null,
    action: 'feed',
    stages: ['baby', 'adult'],
    effects: { hunger: 40, happiness: 15, hygiene: -9, energy: 10 },
    topics: ['edible', 'food'],
    status: 'active',
    stackable: true,
  },
  {
    d: 'blobbi:food:sushi',
    itemId: 'food_sushi',
    name: 'Sushi',
    description: null,
    type: 'consumable',
    category: 'food',
    emoji: '🍣',
    image: null,
    action: 'feed',
    stages: ['baby', 'adult'],
    effects: { hunger: 35, health: 10, hygiene: -5, energy: 7 },
    topics: ['edible', 'food'],
    status: 'active',
    stackable: true,
  },

  // --- Toys (action: play; stages: baby, adult) ---
  {
    d: 'blobbi:toy:ball',
    itemId: 'toy_ball',
    name: 'Ball',
    description: null,
    type: 'consumable',
    category: 'toy',
    emoji: '⚽',
    image: null,
    action: 'play',
    stages: ['baby', 'adult'],
    effects: { happiness: 25, energy: -10, hygiene: -5 },
    topics: ['toy', 'playable'],
    status: 'active',
    stackable: true,
  },
  {
    d: 'blobbi:toy:teddy',
    itemId: 'toy_teddy',
    name: 'Teddy Bear',
    description: null,
    type: 'consumable',
    category: 'toy',
    emoji: '🧸',
    image: null,
    action: 'play',
    stages: ['baby', 'adult'],
    effects: { happiness: 45, energy: -5 },
    topics: ['toy', 'playable'],
    status: 'active',
    stackable: true,
  },
  {
    d: 'blobbi:toy:blocks',
    itemId: 'toy_blocks',
    name: 'Building Blocks',
    description: null,
    type: 'consumable',
    category: 'toy',
    emoji: '🧱',
    image: null,
    action: 'play',
    stages: ['baby', 'adult'],
    effects: { happiness: 30, energy: -10 },
    topics: ['toy', 'playable'],
    status: 'active',
    stackable: true,
  },

  // --- Medicine (action: medicine) ---
  {
    d: 'blobbi:medicine:vitamins',
    itemId: 'med_vitamins',
    name: 'Vitamins',
    description: null,
    type: 'consumable',
    category: 'medicine',
    emoji: '💊',
    image: null,
    action: 'medicine',
    stages: ['egg', 'baby', 'adult'],
    effects: { health: 25, energy: 5 },
    topics: ['medicine', 'healing'],
    status: 'active',
    stackable: true,
  },
  {
    d: 'blobbi:medicine:super',
    itemId: 'med_super',
    name: 'Super Medicine',
    description: null,
    type: 'consumable',
    category: 'medicine',
    emoji: '💉',
    image: null,
    action: 'medicine',
    stages: ['egg', 'baby', 'adult'],
    effects: { health: 50, energy: 20, happiness: -10 },
    topics: ['medicine', 'healing'],
    status: 'active',
    stackable: true,
  },
  {
    d: 'blobbi:medicine:bandage',
    itemId: 'med_bandage',
    name: 'Bandage',
    description: null,
    type: 'consumable',
    category: 'medicine',
    emoji: '🩹',
    image: null,
    action: 'medicine',
    stages: ['egg', 'baby', 'adult'],
    effects: { health: 25 },
    topics: ['medicine', 'healing'],
    status: 'active',
    stackable: true,
  },
  {
    d: 'blobbi:medicine:health-elixir',
    itemId: 'med_elixir',
    name: 'Health Elixir',
    description: null,
    type: 'consumable',
    category: 'medicine',
    emoji: '🧪',
    image: null,
    action: 'medicine',
    stages: ['egg', 'baby', 'adult'],
    effects: { health: 75, happiness: 20, energy: 10 },
    topics: ['medicine', 'healing'],
    status: 'active',
    stackable: true,
  },
  {
    d: 'blobbi:medicine:shell-repair-kit',
    itemId: 'med_shell_repair',
    name: 'Shell Repair Kit',
    description: null,
    type: 'consumable',
    category: 'medicine',
    emoji: '🥚',
    image: null,
    action: 'medicine',
    // Egg-only per the published definition.
    stages: ['egg'],
    effects: { health: 30 },
    topics: ['medicine', 'healing', 'egg'],
    status: 'active',
    stackable: true,
  },
  {
    d: 'blobbi:medicine:calcium',
    itemId: 'med_calcium',
    name: 'Calcium Supplement',
    description: null,
    type: 'consumable',
    category: 'medicine',
    emoji: '🦴',
    image: null,
    action: 'medicine',
    stages: ['egg', 'baby', 'adult'],
    effects: { health: 35 },
    topics: ['medicine', 'healing'],
    status: 'active',
    stackable: true,
  },

  // --- Hygiene (action: clean) ---
  {
    d: 'blobbi:hygiene:soap',
    itemId: 'hyg_soap',
    name: 'Soap',
    description: null,
    type: 'consumable',
    category: 'hygiene',
    emoji: '🧼',
    image: null,
    action: 'clean',
    stages: ['egg', 'baby', 'adult'],
    effects: { hygiene: 25 },
    topics: ['hygiene', 'cleaning'],
    status: 'active',
    stackable: true,
  },
  {
    d: 'blobbi:hygiene:shampoo',
    itemId: 'hyg_shampoo',
    name: 'Shampoo',
    description: null,
    type: 'consumable',
    category: 'hygiene',
    emoji: '🧴',
    image: null,
    action: 'clean',
    stages: ['egg', 'baby', 'adult'],
    effects: { hygiene: 50, happiness: 10 },
    topics: ['hygiene', 'cleaning'],
    status: 'active',
    stackable: true,
  },
  {
    d: 'blobbi:hygiene:bubble-bath',
    itemId: 'hyg_bubble',
    name: 'Bubble Bath',
    description: null,
    type: 'consumable',
    category: 'hygiene',
    emoji: '🛁',
    image: null,
    action: 'clean',
    stages: ['egg', 'baby', 'adult'],
    effects: { hygiene: 70, happiness: 25 },
    topics: ['hygiene', 'cleaning'],
    status: 'active',
    stackable: true,
  },
  {
    d: 'blobbi:hygiene:soft-towel',
    itemId: 'hyg_towel',
    name: 'Soft Towel',
    description: null,
    type: 'consumable',
    category: 'hygiene',
    emoji: '🏖️',
    image: null,
    action: 'clean',
    stages: ['egg', 'baby', 'adult'],
    effects: { hygiene: 25, happiness: 5 },
    topics: ['hygiene', 'cleaning'],
    status: 'active',
    stackable: true,
  },

  // --- Energy (action: boost) ---
  {
    d: 'blobbi:energy:drink',
    itemId: 'nrg_drink',
    name: 'Energy Drink',
    description: null,
    type: 'consumable',
    category: 'energy',
    emoji: '🧃',
    image: null,
    action: 'boost',
    stages: ['baby', 'adult'],
    effects: { energy: 35, happiness: 5 },
    topics: ['energy', 'boost'],
    status: 'active',
    stackable: true,
  },

  // --- Currency ---
  {
    d: ARCADE_TICKET_D,
    itemId: 'cur_arcade_ticket',
    name: 'Arcade Ticket',
    description:
      'Earned by playing games at the Blobbi Island Arcade. Exchange it for exclusive prizes.',
    type: 'currency',
    category: 'currency',
    emoji: '🎟️',
    image: ARCADE_TICKET_IMAGE_URL,
    // Currency is never used on a Blobbi. `useUseItem` rejects a null action, so
    // this single field is what keeps tickets out of every care flow.
    action: null,
    // Schema-required; carries no meaning while `action` is null.
    stages: ['egg', 'baby', 'adult'],
    // No care effects, by design.
    effects: {},
    topics: ['currency', 'arcade'],
    // ACTIVE: the issuer-signed kind:31632 definition is published and was
    // fetched back from BOTH official relays, with tags and content matching
    // this record byte-for-byte and a valid signature from the official issuer.
    // See `docs/protocol/arcade-ticket-publication.md` §7 for the verification
    // record. The bundled fallback below stays as the offline path.
    status: 'active',
    stackable: true,
    sourceFiles: [
      'src/components/blobbi/ArcadeTicketBalance.tsx',
      'src/components/blobbi/inventory/InventoryBrowser.tsx',
    ],
  },
  {
    d: ARCADE_TOKEN_D,
    itemId: 'arcade-token',
    name: 'Arcade Token',
    description:
      'Buy them with Blobbi Coins and spend them to play games at the Blobbi Island Arcade.',
    type: 'currency',
    category: 'currency',
    emoji: '🕹️',
    // The published definition carries the official front/back artwork; the
    // catalog fetches it from the relays and that revision wins. No bundled URL
    // is recorded here, so nothing can drift from what was actually published —
    // the emoji is the offline fallback.
    image: null,
    // Currency is never used on a Blobbi. `useUseItem` rejects a null action, so
    // this single field is what keeps tokens out of every care flow.
    action: null,
    // Schema-required; carries no meaning while `action` is null.
    stages: ['egg', 'baby', 'adult'],
    // No care effects, by design.
    effects: {},
    topics: ['currency', 'arcade'],
    status: 'active',
    stackable: true,
    sourceFiles: [
      'src/arcade/tokens/arcade-token.ts',
      'src/arcade/tokens/token-store.ts',
    ],
  },
  {
    d: BLOBBI_COIN_D,
    // Mirrors the published `content.metadata.itemId`. Never protocol identity.
    itemId: 'blobbi-coin',
    name: 'Blobbi Coin',
    description:
      'The official currency of Blobbi Island, minted for Blobbis who explore, play, discover treasures, and help the island thrive.',
    type: 'currency',
    category: 'currency',
    emoji: '🪙',
    image: BLOBBI_COIN_IMAGE_URL,
    // Currency is never used on a Blobbi; the null action keeps Coins out of
    // every care flow, exactly like the Arcade Ticket.
    action: null,
    stages: ['egg', 'baby', 'adult'],
    effects: {},
    topics: ['currency', 'coin', 'official-currency', 'spendable', 'earnable', 'blobbi-coin'],
    // ACTIVE: the issuer-signed kind:31632 definition (event id recorded in
    // `src/inventory/coin.ts` for diagnostics) is published with these exact
    // tags. The bundled fallback derived from this record is the offline path.
    status: 'active',
    stackable: true,
    sourceFiles: ['src/inventory/coin.ts', 'src/inventory/coin-wallet.ts'],
  },
];

// ---------------------------------------------------------------------------
// Derived views
// ---------------------------------------------------------------------------

/** The official issuer's PUBLIC key. No private material is stored anywhere. */
export const OFFICIAL_ISSUER_PUBKEY = OFFICIAL_ITEM_ISSUER_PUBKEY;

/** Relays known to carry the official kind:31632 definitions. */
export const OFFICIAL_DEFINITION_RELAYS = OFFICIAL_ITEM_RELAYS;

/**
 * Tag conventions shared by every official kind:31632 definition.
 *
 * These are not guesses: all 19 published definitions were fetched from BOTH
 * official relays and every one carries `context: game:blobbi`, `version: 1`
 * and an `alt` of the form `Game item definition: <name>` (19/19 on each relay).
 * A new official definition follows the same conventions so it is consistent
 * with the catalog it joins.
 *
 * They live here rather than on each item because they are identical for every
 * item — per-item copies would be 20 chances to drift.
 */
export const OFFICIAL_DEFINITION_CONVENTIONS = {
  /** `context` tag — scopes the item to this game and is relay-indexable. */
  context: 'game:blobbi',
  /** `version` tag — definition schema revision, not the item's revision. */
  version: 1,
  /** Prefix of the NIP-31 `alt` tag. */
  altPrefix: 'Game item definition: ',
} as const;

/** The NIP-31 `alt` text for an official definition, per the shared convention. */
export function officialDefinitionAlt(itemName: string): string {
  return `${OFFICIAL_DEFINITION_CONVENTIONS.altPrefix}${itemName}`;
}

/** Canonical kind:31632 address for an official item `d`. */
export function officialItemAddress(d: string): string {
  return buildGameItemAddress(OFFICIAL_ISSUER_PUBKEY, d);
}

/** An official item definition plus its derived canonical address. */
export interface AddressedOfficialItem extends OfficialItemDefinition {
  /** `31632:<issuer>:<d>`, derived — never hardcoded. */
  address: string;
}

/** Every official item, with its canonical address derived from issuer + `d`. */
export const ADDRESSED_OFFICIAL_ITEMS: readonly AddressedOfficialItem[] =
  OFFICIAL_ITEM_DEFINITIONS.map((item) => ({
    ...item,
    address: officialItemAddress(item.d),
  }));

/** Items whose issuer-signed definition is published and live. */
export const ACTIVE_OFFICIAL_ITEMS: readonly AddressedOfficialItem[] =
  ADDRESSED_OFFICIAL_ITEMS.filter((i) => i.status === 'active');

/** Items whose identity is claimed but whose definition is not published yet. */
export const RESERVED_OFFICIAL_ITEMS: readonly AddressedOfficialItem[] =
  ADDRESSED_OFFICIAL_ITEMS.filter((i) => i.status === 'reserved');

/** Items that are no longer offered but must still resolve for existing owners. */
export const DEPRECATED_OFFICIAL_ITEMS: readonly AddressedOfficialItem[] =
  ADDRESSED_OFFICIAL_ITEMS.filter((i) => i.status === 'deprecated');

/** Look up an official item by its `d` tag. */
export function officialItemByD(d: string): AddressedOfficialItem | null {
  return ADDRESSED_OFFICIAL_ITEMS.find((i) => i.d === d) ?? null;
}

/** Look up an official item by its canonical address. */
export function officialItemByAddress(
  address: string,
): AddressedOfficialItem | null {
  return ADDRESSED_OFFICIAL_ITEMS.find((i) => i.address === address) ?? null;
}

// ---------------------------------------------------------------------------
// Official COSMETICS (wearable accessories)
//
// A SECOND IDENTITY LIST, DELIBERATELY NOT A SECOND CATALOG.
//
// Cosmetics are official kind:31632 definitions signed by the same issuer, and
// they resolve through the SAME catalog query and the SAME cache as consumables
// (`useItemCatalog`). What they are not is CARE ITEMS, and that is why they are
// not entries in `OFFICIAL_ITEM_DEFINITIONS`:
//
//   - `CONSUMABLE_ITEM_CATEGORIES` is derived from `ITEM_CATEGORIES` BY
//     EXCLUSION (everything that is not `currency`). Adding a `headwear`
//     category to make a hat expressible would therefore also declare hats
//     consumable, and `shop-catalog.ts` would start treating them as sellable
//     care items.
//   - Every field that list requires — `action`, `stages`, `effects` — is
//     meaningless for a hat, so each entry would carry three null/empty fields
//     asserting something the item does not do.
//
// WHAT THIS LIST HOLDS is identity plus a minimal fallback projection, and
// nothing else. The published definition remains authoritative for category,
// rarity, description, topics, contexts and every image view; those fields are
// deliberately ABSENT here so they cannot drift. `name`, `symbol` and
// `primaryImage` exist for exactly one situation — the definition could not be
// fetched — and a fetched definition always outranks them
// (see `useItemCatalog`).
//
// The `slot` is NOT stored here either: since the kind:31634 migration the
// PUBLISHED DEFINITION is the only authority on where a cosmetic is worn
// (`content.visual.slot`). Recording a slot in this list would be a second
// answer that can disagree with the issuer's own, and Island would then have to
// pick one. The Item Studio's activation diagnostics report what the definition
// declares; nothing infers a slot from an id or a code prefix any more.
// ---------------------------------------------------------------------------

/**
 * An official wearable cosmetic: its canonical `d`, the legacy accessory code it
 * is equipped as, and the little that must survive a relay outage.
 */
export interface OfficialCosmeticDefinition {
  /** The kind:31632 `d` tag. Canonical identity together with the issuer. */
  d: string;
  /** Display name — FALLBACK ONLY. The published `name` tag wins. */
  name: string;
  /** Emoji shown when no artwork loads — FALLBACK ONLY. */
  symbol: string;
  /**
   * The published primary (unmarked) `image` URL — FALLBACK ONLY, and `null`
   * until the definition is published.
   *
   * Recorded for the same reason `ARCADE_TICKET_IMAGE_URL` is: so a compact UI
   * still draws the right picture when the catalog query fails. Pose-specific
   * views (`front`/`back`/side) are never recorded here — they only ever come
   * from a fetched definition.
   */
  primaryImage: string | null;
  /**
   * The published `max_stack` tag as a number. STABLE ITEM POLICY, not display
   * fallback: normal client controls must never push a quantity above it. The
   * fixture tests assert this mirrors the signed events.
   */
  maxStack: number;
  status: OfficialItemStatus;
}

/**
 * Every official cosmetic this client recognises.
 *
 * An entry here does not grant, equip or price anything. It states that a `d` is
 * an official cosmetic identity and which legacy code wears it.
 */
export const OFFICIAL_COSMETIC_DEFINITIONS: readonly OfficialCosmeticDefinition[] =
  [
    {
      d: 'blobbi:cosmetic:block-builder-cap',
      name: 'Block Builder Cap',
      symbol: '🧢',
      // The unmarked `image` tag of the published definition, verified against
      // wss://relay.ditto.pub. The `front` view happens to carry the same URL;
      // the marked views are read from the definition, never from here.
      primaryImage:
        'https://blossom.primal.net/11ed179592981472e25b9a327d8c6bfd55b7a3bae0a8d805e071b8ba4e47d1dc.webp',
      // ACTIVE: the issuer-signed kind:31632 event was fetched back from
      // wss://relay.ditto.pub with a valid signature. NOTE it was NOT found on
      // wss://relay.dreamith.to — see docs/accessory-definition-migration.md.
      maxStack: 1,
      status: 'active',
    },
    // The three wearables below were published by the official issuer alongside
    // the twelve visual-effect items (Phase 9). Every value here was taken from
    // the signed events supplied with that phase, whose ids and signatures were
    // verified locally — see src/effects/official-item-event-fixtures.ts and
    // its tests, which assert this registry still agrees with the events.
    {
      d: 'blobbi:cosmetic:celestial-seraph-necklace',
      name: 'Celestial Seraph Necklace',
      symbol: '🪽',
      primaryImage:
        'https://blossom.primal.net/5f336dd3c25ba80f296bfabcce3a329b4418f9b00901a632e9c0385ca06add35.webp',
      maxStack: 1,
      status: 'active',
    },
    {
      d: 'blobbi:cosmetic:starlight-bow-tie',
      name: 'Starlight Bow Tie',
      symbol: '🎀',
      primaryImage:
        'https://blossom.primal.net/d82adf8e2004ef4ea93a44ddf3070c8885b961d71ac41eb3c3f8635ab6908448.webp',
      maxStack: 1,
      status: 'active',
    },
    {
      d: 'blobbi:cosmetic:stargazer-glasses',
      name: 'Stargazer Glasses',
      symbol: '👓',
      primaryImage:
        'https://blossom.primal.net/0f67191987cfbfd637c8eb57db2741dd48b2d74180ef187fdf8297674a80006c.webp',
      maxStack: 1,
      status: 'active',
    },
  ];

/** An official cosmetic plus its derived canonical address. */
export interface AddressedOfficialCosmetic extends OfficialCosmeticDefinition {
  /** `31632:<issuer>:<d>`, derived — never hardcoded. */
  address: string;
}

/** Every official cosmetic, with its address derived from issuer + `d`. */
export const ADDRESSED_OFFICIAL_COSMETICS: readonly AddressedOfficialCosmetic[] =
  OFFICIAL_COSMETIC_DEFINITIONS.map((item) => ({
    ...item,
    address: officialItemAddress(item.d),
  }));

/** Look up an official cosmetic by its `d` tag. */
export function officialCosmeticByD(
  d: string,
): AddressedOfficialCosmetic | null {
  return ADDRESSED_OFFICIAL_COSMETICS.find((i) => i.d === d) ?? null;
}

/** Look up an official cosmetic by its canonical address. */
export function officialCosmeticByAddress(
  address: string,
): AddressedOfficialCosmetic | null {
  return ADDRESSED_OFFICIAL_COSMETICS.find((i) => i.address === address) ?? null;
}

// ---------------------------------------------------------------------------
// Official VISUAL-EFFECT ITEMS
//
// A THIRD IDENTITY LIST, for the same reason cosmetics are a second one: effect
// items are official kind:31632 definitions from the same issuer, resolved
// through the same catalog query and cache, but they are neither care items nor
// image-drawn wearables. What an effect item grants is a LOCALLY IMPLEMENTED
// renderer effect, and the binding between an item address and that local
// effect is a TRUST decision this registry records as plain data.
//
// This list is stable identity + activation expectations + a minimal display
// fallback. It deliberately does NOT hold: event ids or signatures (a later
// addressable update changes both while the address stays), executable
// anything, inventory quantities, or placement state. The full signed events
// live in `src/effects/official-item-event-fixtures.ts` for tests and dev
// diagnostics only.
//
// `effectId`/`effectSlot` are plain strings HERE because this module must not
// import `@blobbi/react`. The typed projection with renderer-consistency checks
// is `src/effects/official-visual-effect-items.ts`, whose tests fail if any
// entry names an effect or slot the renderer does not implement.
// ---------------------------------------------------------------------------

/** An official visual-effect item: stable identity plus activation data. */
export interface OfficialEffectItemDefinition {
  /** The kind:31632 `d` tag. Canonical identity together with the issuer. */
  d: string;
  /** Display name — FALLBACK ONLY. The published `name` tag wins. */
  name: string;
  /** Emoji shown when no artwork loads — FALLBACK ONLY. */
  symbol: string;
  /** The published primary `image` URL — FALLBACK ONLY. */
  primaryImage: string | null;
  /** The published `rarity` tag — FALLBACK ONLY; the definition wins. */
  rarity: string;
  /** The LOCAL renderer effect this item entitles its owner to activate. */
  effectId: string;
  /** The only placement slot this item may be equipped into. */
  effectSlot: string;
  /** Blobbi forms the effect may be active on. Never empty. */
  forms: readonly string[];
  /**
   * Whether the published definition carries the `arcade-prize` topic.
   * ACQUISITION METADATA ONLY: it never affects rendering, ownership or
   * placement resolution, and granting is not implemented in this phase.
   */
  arcadePrize: boolean;
  /**
   * The published `max_stack` tag as a number. STABLE ITEM POLICY, not display
   * fallback: normal client controls must never push a quantity above it. The
   * fixture tests assert this mirrors the signed events.
   */
  maxStack: number;
  status: OfficialItemStatus;
}

const EFFECT_FORMS_BABY_ADULT: readonly string[] = ['baby', 'adult'];

/**
 * The twelve official visual-effect items, exactly as published (Phase 9).
 *
 * Values were taken from the signed kind:31632 events supplied with the phase
 * (ids and signatures verified locally against the official issuer). The
 * fixture tests assert this table still agrees with those events — including
 * that ONLY Golden Sparkles, Mystic Fog and Celestial Aura carry `arcade-prize`.
 */
export const OFFICIAL_EFFECT_ITEM_DEFINITIONS: readonly OfficialEffectItemDefinition[] =
  [
    {
      d: 'blobbi:effect:golden-sparkles',
      name: 'Golden Sparkles',
      symbol: '✨',
      primaryImage:
        'https://blossom.primal.net/02be7a6849c3599ded9261f3d2d346e6a88261510f052ee2638406fc64c04877.webp',
      rarity: 'rare',
      effectId: 'golden-sparkles',
      effectSlot: 'ambient-particles',
      forms: EFFECT_FORMS_BABY_ADULT,
      arcadePrize: true,
      maxStack: 1,
      status: 'active',
    },
    {
      d: 'blobbi:effect:bubble-bliss',
      name: 'Bubble Bliss',
      symbol: '🫧',
      primaryImage:
        'https://blossom.primal.net/3eb9f13c831adf9c916d32d0231b4cccdcb7edfdbbdb37d0ba25297d445c1b4f.webp',
      rarity: 'uncommon',
      effectId: 'bubble-bliss',
      effectSlot: 'ambient-particles',
      forms: EFFECT_FORMS_BABY_ADULT,
      arcadePrize: false,
      maxStack: 1,
      status: 'active',
    },
    {
      d: 'blobbi:effect:love-burst',
      name: 'Love Burst',
      symbol: '💖',
      primaryImage:
        'https://blossom.primal.net/359b7369a33a90d9a822bc2a82b27aad80ef777ec98cf863b0a8bbcb36e09301.webp',
      rarity: 'rare',
      effectId: 'love-burst',
      effectSlot: 'ambient-particles',
      forms: EFFECT_FORMS_BABY_ADULT,
      arcadePrize: false,
      maxStack: 1,
      status: 'active',
    },
    {
      d: 'blobbi:effect:firefly-friends',
      name: 'Firefly Friends',
      symbol: '🏮',
      primaryImage:
        'https://blossom.primal.net/fc287963f85d392b50eac59f45b32c30fff456d624691696d333256df5a27b16.webp',
      rarity: 'rare',
      effectId: 'firefly-friends',
      effectSlot: 'ambient-particles',
      forms: EFFECT_FORMS_BABY_ADULT,
      arcadePrize: false,
      maxStack: 1,
      status: 'active',
    },
    {
      d: 'blobbi:effect:mystic-fog',
      name: 'Mystic Fog',
      symbol: '🌫️',
      primaryImage:
        'https://blossom.primal.net/26d2c81643b914cda7418de76f38da83d3ba09497323f2528924e45c2e7ff732.webp',
      rarity: 'epic',
      effectId: 'mystic-fog',
      effectSlot: 'ground-local',
      forms: EFFECT_FORMS_BABY_ADULT,
      arcadePrize: true,
      maxStack: 1,
      status: 'active',
    },
    {
      d: 'blobbi:effect:frost-breath',
      name: 'Frost Breath',
      symbol: '❄️',
      primaryImage:
        'https://blossom.primal.net/af1e6d2e9b4dc835ae351ccd532d3837ad8b93e412818ecddda739ceb8e9e3a8.webp',
      rarity: 'epic',
      effectId: 'frost-breath',
      effectSlot: 'ground-local',
      forms: EFFECT_FORMS_BABY_ADULT,
      arcadePrize: false,
      maxStack: 1,
      status: 'active',
    },
    {
      d: 'blobbi:effect:pixel-glitch',
      name: 'Pixel Glitch',
      symbol: '👾',
      primaryImage:
        'https://blossom.primal.net/85c2d70642a4504cb2650a41c7f002727f28a18da2fe811388aa03620d6db3d1.webp',
      rarity: 'epic',
      effectId: 'pixel-glitch',
      effectSlot: 'body-overlay',
      forms: EFFECT_FORMS_BABY_ADULT,
      arcadePrize: false,
      maxStack: 1,
      status: 'active',
    },
    {
      d: 'blobbi:effect:electric-charge',
      name: 'Electric Charge',
      symbol: '⚡',
      primaryImage:
        'https://blossom.primal.net/5c6b68f354d627984555865820668cb6dd51acfdc5981405682eeddae0f341f5.webp',
      rarity: 'epic',
      effectId: 'electric-charge',
      effectSlot: 'body-overlay',
      forms: EFFECT_FORMS_BABY_ADULT,
      arcadePrize: false,
      maxStack: 1,
      status: 'active',
    },
    {
      d: 'blobbi:effect:celestial-aura',
      name: 'Celestial Aura',
      symbol: '🌌',
      primaryImage:
        'https://blossom.primal.net/509be399fc971a21831fb0d233800560be198e9284f09e27380b014a77ef1c59.webp',
      rarity: 'legendary',
      effectId: 'celestial-aura',
      effectSlot: 'aura',
      forms: EFFECT_FORMS_BABY_ADULT,
      arcadePrize: true,
      maxStack: 1,
      status: 'active',
    },
    {
      d: 'blobbi:effect:solar-radiance',
      name: 'Solar Radiance',
      symbol: '☀️',
      primaryImage:
        'https://blossom.primal.net/e3e1a8066656a685341ac9b0a9f4328f392ef00c795447bd50cc006dba753c4c.webp',
      rarity: 'legendary',
      effectId: 'solar-radiance',
      effectSlot: 'aura',
      forms: EFFECT_FORMS_BABY_ADULT,
      arcadePrize: false,
      maxStack: 1,
      status: 'active',
    },
    {
      d: 'blobbi:effect:void-whispers',
      name: 'Void Whispers',
      symbol: '🌑',
      primaryImage:
        'https://blossom.primal.net/e2f61dff13ee7baee7a15d4df4de8f96af8c439cbee295cfbb962b466269f043.webp',
      rarity: 'legendary',
      effectId: 'void-whispers',
      effectSlot: 'aura',
      forms: EFFECT_FORMS_BABY_ADULT,
      arcadePrize: false,
      maxStack: 1,
      status: 'active',
    },
    {
      d: 'blobbi:effect:rainbow-dream',
      name: 'Rainbow Dream',
      symbol: '🌈',
      primaryImage:
        'https://blossom.primal.net/9b1f04492087f138c27604b55feaa3264d6b4b00d2a77e9286319243317ae3bd.webp',
      rarity: 'mythic',
      effectId: 'rainbow-dream',
      effectSlot: 'aura',
      forms: EFFECT_FORMS_BABY_ADULT,
      arcadePrize: false,
      maxStack: 1,
      status: 'active',
    },
  ];

/** An official effect item plus its derived canonical address. */
export interface AddressedOfficialEffectItem extends OfficialEffectItemDefinition {
  /** `31632:<issuer>:<d>`, derived — never hardcoded. */
  address: string;
}

/** Every official effect item, with its address derived from issuer + `d`. */
export const ADDRESSED_OFFICIAL_EFFECT_ITEMS: readonly AddressedOfficialEffectItem[] =
  OFFICIAL_EFFECT_ITEM_DEFINITIONS.map((item) => ({
    ...item,
    address: officialItemAddress(item.d),
  }));

/** Look up an official effect item by its `d` tag. */
export function officialEffectItemByD(
  d: string,
): AddressedOfficialEffectItem | null {
  return ADDRESSED_OFFICIAL_EFFECT_ITEMS.find((i) => i.d === d) ?? null;
}

/**
 * Look up an official effect item by its canonical address.
 *
 * The WHOLE address, never the `d` tail: `31632:<stranger>:blobbi:effect:…` is
 * a different item by a different author and must answer `null`.
 */
export function officialEffectItemByAddress(
  address: string,
): AddressedOfficialEffectItem | null {
  return (
    ADDRESSED_OFFICIAL_EFFECT_ITEMS.find((i) => i.address === address) ?? null
  );
}

/**
 * The recovery boundary this registry guarantees — and the one it explicitly
 * does not. Rendered verbatim into the generated document so the two can never
 * disagree.
 */
export const RECOVERY_BOUNDARY = {
  canRestore: [
    'Every official kind:31632 Game Item Definition: its `d`, name, type, category, image, topics, effects, action, stages and emoji are all recorded here, so a definition lost from every relay can be rebuilt and republished by the issuer.',
    'The canonical address of every official item, derived from the issuer public key and the `d` tag.',
    'Which relays official definitions are expected to be found on.',
    'Which application kinds exist, what they are for, who signs them and how they expire.',
  ],
  cannotRestore: [
    "Any player's kind:31633 inventory quantities. Only the player can sign their inventory event; if it is lost from every relay, the balance is gone.",
    "Any player's coin balance, owned Blobbis, achievements or profile (kind:11125).",
    "Any Blobbi's state or history (kind:31124, kind:1124).",
    'Ownership or transaction history of any kind. Nothing here is a ledger.',
    'Any user-signed event whatsoever. This registry describes schemas and official issuer content only.',
  ],
} as const;
