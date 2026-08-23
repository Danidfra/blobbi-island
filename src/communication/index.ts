/**
 * Island communication — the structured message layer for kind 21201.
 *
 * Everything here is pure: catalogs, a parser, a renderer, a payload builder and
 * rate limits. No React, no relay, no storage. The wiring lives in
 * `MultiplayerLayer` (transport), `PlayingView` (composition surface) and
 * `src/safety/` (capability admission).
 *
 * Protocol: `docs/communication-v2.md`.
 */

export type {
  IslandMessage,
  IslandMessageClass,
  IslandMessageEnvelope,
  IslandTextMessage,
  IslandQuickMessage,
  IslandTemplateMessage,
  IslandEmoteMessage,
} from './message';
export {
  FREE_TEXT_WIRE_TYPE,
  FREE_TEXT_WIRE_TYPES,
  ISLAND_MESSAGE_VERSION,
  MAX_MESSAGE_PAYLOAD_BYTES,
  MAX_TEMPLATE_PARAMS,
} from './message';

export type { QuickPhrase } from './quick-phrases';
export { QUICK_PHRASES, isKnownQuickPhrase, quickPhraseById } from './quick-phrases';

export type { Emote } from './emotes';
export { EMOTES, emoteById, isKnownEmote } from './emotes';

export type {
  DestinationValue,
  PhraseTemplate,
  TemplateParam,
  TemplateParamCatalogId,
  TemplateParamValue,
  TemplateSegment,
} from './templates';
export {
  ACTIVITY_VALUES,
  DESTINATION_VALUES,
  PHRASE_TEMPLATES,
  TIME_VALUES,
  isKnownPhraseTemplate,
  phraseTemplateById,
  templateParamValueById,
  templateParamValues,
} from './templates';

export type { MessageParseFailure, MessageParseResult, ParsedEnvelope } from './parse';
export { isFromLocation, parseIslandChatPayload } from './parse';

export type { CommunicationBubble } from './render';
export { bubbleTextEquivalent, renderMessage, renderTemplateText } from './render';

export type { BuildMessageOptions } from './build';
export { buildMessagePayload, messageAltText } from './build';

export type { InboundThrottle } from './rate-limit';
export { INBOUND_MIN_INTERVAL_MS, SEND_COOLDOWN_MS, createInboundThrottle } from './rate-limit';
