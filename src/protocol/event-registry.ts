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
      "The player's account: coins, owned Blobbis, achievements, current companion.",
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
      'src/inventory/useCoinsMutation.ts',
      'src/hooks/useBlobbiEvents.ts',
      'src/hooks/useOptimizedStatus.ts',
      'src/hooks/useFirstEggAdoption.ts',
    ],
    docs: ['NIP.md', 'docs/INVENTORY_ARCHITECTURE.md'],
    notes:
      'Consumable inventory is NOT stored here; it lives in kind 31633. Coins do live here.',
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
    ],
    docs: ['NIP.md', 'docs/INVENTORY_ARCHITECTURE.md'],
    notes:
      'Replaceable semantics mean concurrent writes from two clients resolve newest-wins; there is no relay-side locking.',
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
      'src/components/blobbi/ItemBagModal.tsx',
    ],
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
// The `slot` is NOT stored: it is inferred from `legacyCode`'s prefix, so the
// mapping and the slot can never disagree with each other. Whether that inferred
// slot matches the definition's own `visual.slot` is a real question, and it is
// answered at runtime by the Item Studio's activation diagnostics rather than by
// a third copy of the value here.
// ---------------------------------------------------------------------------

/**
 * An official wearable cosmetic: its canonical `d`, the legacy accessory code it
 * is equipped as, and the little that must survive a relay outage.
 */
export interface OfficialCosmeticDefinition {
  /** The kind:31632 `d` tag. Canonical identity together with the issuer. */
  d: string;
  /**
   * The legacy accessory `code` this cosmetic is worn as.
   *
   * Equipment is still expressed by the pre-existing `equip` tag vocabulary
   * (see `src/components/blobbi/lib/accessory-types.ts`), which identifies an
   * accessory by bare code and carries its placement. This field is the join
   * between that vocabulary and the item protocol; it is NOT a claim that the
   * player owns or has equipped the item.
   */
  legacyCode: string;
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
      // TRANSITIONAL CODE. No pre-existing accessory code described this cap —
      // the legacy series is numeric (`headwear-1` … `headwear-21`, each backed
      // by a `public/assets/.../headwear/headwear-N.png`). A slug rather than
      // `headwear-22` on purpose: the numeric series is the LOCAL ARTWORK
      // series, and taking the next number would both imply a local file that
      // does not exist and collide with the next hat that does ship one. The
      // slug still matches `ACCESSORY_CODE_PATTERN` and still infers the
      // `headwear` slot from its prefix, so every existing parser accepts it
      // unchanged.
      legacyCode: 'headwear-block-builder-cap',
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
