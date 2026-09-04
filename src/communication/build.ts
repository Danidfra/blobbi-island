/**
 * The outbound side: turning a message into the kind 21201 `content` string.
 *
 * One builder for all four classes, so the envelope is written once and cannot
 * drift between them. The alternative, a publisher per class, is how four
 * slightly different events end up on the wire claiming to be one protocol.
 *
 * ## What a structured payload deliberately does not contain
 *
 * No `text`, no `fallback`, no display label, no localized string. A quick
 * phrase is an id; a template is an id plus value ids. This is not only a size
 * decision: a payload that carried its own text would invite a receiver to read
 * it, and the moment any receiver reads it, the trusted-reconstruction property
 * that makes structured messages safe for a Family player is gone.
 *
 * A test asserts the emitted JSON for the structured classes contains no
 * free-text field, so this stays true rather than merely being intended.
 */

import type { LocationId } from '@/lib/location-types';

import {
  FREE_TEXT_WIRE_TYPE,
  ISLAND_MESSAGE_VERSION,
  type IslandMessage,
  type IslandMessageEnvelope,
} from './message';

/** Everything a payload needs beyond the message itself. */
export interface BuildMessageOptions extends IslandMessageEnvelope {
  readonly location: LocationId;
}

/**
 * The `content` string for a kind 21201 event.
 *
 * The envelope (`location`, `blobbiD`, `ts`) is identical across all classes and
 * identical to the deployed schema, so location scoping, the receiver's
 * same-room check and every existing tag continue to work unchanged.
 */
export function buildMessagePayload(
  message: IslandMessage,
  options: BuildMessageOptions,
): string {
  const envelope = {
    location: options.location,
    ...(options.blobbiD ? { blobbiD: options.blobbiD } : {}),
    ts: options.ts,
  };

  switch (message.type) {
    // Free text keeps the legacy wire type and carries no version, so a client
    // that predates Communication V2 renders it exactly as it does today.
    case 'text':
      return JSON.stringify({ type: FREE_TEXT_WIRE_TYPE, ...envelope, text: message.text });

    case 'quick':
      return JSON.stringify({
        type: 'quick',
        v: ISLAND_MESSAGE_VERSION,
        ...envelope,
        phrase: message.phrase,
      });

    case 'template':
      return JSON.stringify({
        type: 'template',
        v: ISLAND_MESSAGE_VERSION,
        ...envelope,
        template: message.template,
        params: message.params,
      });

    case 'emote':
      return JSON.stringify({
        type: 'emote',
        v: ISLAND_MESSAGE_VERSION,
        ...envelope,
        emote: message.emote,
      });
  }
}

/**
 * The NIP-31 `alt` tag: a human-readable description for clients that do not
 * understand this kind.
 *
 * Built from the LOCAL rendering, never from the payload, and truncated. For a
 * structured message this is the only place its words appear on the wire, as
 * documentation of the event, not as data any receiver in this app reads back.
 */
export function messageAltText(summary: string): string {
  const trimmed = summary.trim();
  return `Chat message: ${trimmed.slice(0, 50)}${trimmed.length > 50 ? '...' : ''}`;
}
