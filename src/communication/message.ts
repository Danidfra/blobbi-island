/**
 * The Island communication message model, the shape shared by every layer.
 *
 * ## One kind, four classes
 *
 * Communication V2 keeps kind `21201`. It does not introduce a Nostr kind,
 * because nothing about a structured message needs different storage,
 * expiration or routing than a free-text one: same ephemeral range, same NIP-40
 * expiry, same `l`/`i` location and island scoping, same subscription. A new
 * kind would have bought a second protocol to document and maintain in exchange
 * for nothing.
 *
 * What changes is the `content` JSON, and it changes in the one way the existing
 * receiver already tolerates. Today's client rejects anything whose
 * `content.type` is not `"chat"`, so adding new `type` values is invisible to
 * it: a deployed old tab ignores a phrase rather than mis-rendering it. See
 * {@link docs/communication-v2.md} for the interoperability consequences, which
 * are real and deliberate.
 *
 * ## Why free text still says `"chat"` on the wire
 *
 * The obvious modernisation, renaming it `"text"`, would break exactly the
 * compatibility the design is built on: an older client would stop showing free
 * text, which is the one message class it *can* show. So the wire keeps
 * `"chat"`, the parser also accepts `"text"` for a future client that prefers
 * it, and the internal model calls the class `text` regardless.
 *
 * ## Why structured messages carry no text field
 *
 * A quick phrase is `{"type":"quick","phrase":"want-to-play"}` and nothing else.
 * There is deliberately no `text` and no `fallback` alongside it, because the
 * security property this whole phase rests on is that **the discriminant is
 * unambiguous**: a message either is free text, or it is a reference into a
 * local catalog. A payload carrying both would force every receiver to hold the
 * invariant "ignore `text` when `phrase` is present": a rule that is one
 * careless edit away from being violated, in the exact code path that decides
 * what a child is shown.
 *
 * A `fallback` string was considered for legacy rendering and rejected: an old
 * client rejects the whole event on `type` before it could ever read one, so it
 * would add risk and buy nothing.
 */

import type { LocationId } from '@/lib/location-types';

/** Schema version carried by every structured message. */
export const ISLAND_MESSAGE_VERSION = 1;

/**
 * The wire `type` values that mean "free-form player text".
 *
 * `chat` is what every deployed client emits and understands; `text` is
 * accepted so a future client that prefers the clearer name interoperates
 * without a flag day. This client emits `chat`.
 */
export const FREE_TEXT_WIRE_TYPES = Object.freeze(['chat', 'text']);

/** The wire `type` this client emits for free text. */
export const FREE_TEXT_WIRE_TYPE = 'chat';

/**
 * The classes of thing a player can say.
 *
 * This union is what the safety layer discriminates on, so adding a class is a
 * compile error in `admitChatMessage` until a capability decision is made for
 * it. That is the intended friction: a new way to communicate is a new thing a
 * stranger can put on a child's screen.
 */
export type IslandMessageClass = 'text' | 'quick' | 'template' | 'emote';

/** Free-form player-authored text. */
export interface IslandTextMessage {
  readonly type: 'text';
  readonly text: string;
}

/** A reference to one entry in the local quick-phrase catalog. */
export interface IslandQuickMessage {
  readonly type: 'quick';
  readonly phrase: string;
}

/**
 * A reference to a local template plus one allowed value per parameter.
 *
 * Values are catalog IDs, never display strings: `{location: 'arcade'}`, not
 * `{location: 'Game Arcade'}`. That is what keeps the protocol translatable and
 * what keeps a receiver from ever rendering a string an author chose.
 */
export interface IslandTemplateMessage {
  readonly type: 'template';
  readonly template: string;
  readonly params: Readonly<Record<string, string>>;
}

/** A reference to one entry in the local emote catalog. */
export interface IslandEmoteMessage {
  readonly type: 'emote';
  readonly emote: string;
}

/**
 * Anything a player can send.
 *
 * Note the shape of the `type` field: it is what makes this union structurally
 * satisfy the safety layer's `ChatMessageCandidate` without either module
 * importing the other, which is how `src/safety/` stays free of application
 * dependencies while still discriminating on message class.
 */
export type IslandMessage =
  | IslandTextMessage
  | IslandQuickMessage
  | IslandTemplateMessage
  | IslandEmoteMessage;

/**
 * The envelope fields every kind 21201 content object carries, unchanged from
 * the deployed schema so that a legacy receiver keeps working.
 */
export interface IslandMessageEnvelope {
  readonly location: LocationId;
  readonly blobbiD?: string;
  readonly ts: number;
}

/**
 * The largest `content` string this client will even attempt to parse.
 *
 * A structural bound, not a policy one: the biggest legitimate payload is a
 * 120-character free-text message inside a small envelope, so 2 KiB is roughly
 * an order of magnitude of headroom and still makes hostile payloads cheap to
 * discard. It closes the receive-side gap the audit records as H-7, the send
 * path has always capped length and the receive path never did, without
 * pretending to be a content rule: a 500-character message from another client
 * still renders, exactly as it does today.
 */
export const MAX_MESSAGE_PAYLOAD_BYTES = 2048;

/** Upper bound on how many parameters any template may declare or receive. */
export const MAX_TEMPLATE_PARAMS = 4;
