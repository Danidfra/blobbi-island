/**
 * The receive-side parser, where an arbitrary string from a relay becomes
 * either a message this client understands or nothing at all.
 *
 * ## What this module is for
 *
 * Everything arriving on kind 21201 was authored by someone else and signed by a
 * key that proves only who wrote it. This is the one place that decides whether
 * a payload has a shape the island recognises. Downstream code, the safety
 * admission check, the renderer, the components, sees a typed
 * {@link IslandMessage} or sees nothing, and never touches the raw object.
 *
 * ## Structure is validated; text is reconstructed
 *
 * For free text the payload IS the message, so the parser sanitises it and hands
 * it on. For every structured class the payload is a **reference**: a phrase id,
 * a template id, a set of parameter ids. The parser checks each one against the
 * local catalogs and, crucially, keeps only the ids. The words a structured
 * message renders as come from `render.ts` reading this build's own catalogs, so
 * a hostile client cannot make a Blobbi say anything that is not written in
 * `quick-phrases.ts`, `emotes.ts` or `templates.ts`: whatever extra fields it
 * attaches to the payload.
 *
 * That is the concrete answer to the attack this phase exists to prevent:
 * `{"type":"quick","phrase":"want-to-play","text":"<abuse>"}` parses to
 * `{type:'quick', phrase:'want-to-play'}`, and the `text` field is not
 * copied, not read, and not reachable from anything downstream.
 *
 * ## It never throws
 *
 * Every failure is a typed reason. This runs inside the multiplayer receive
 * path, where an exception would take out the subscription for every player in
 * the room, and a malformed event is an ordinary occurrence rather than an
 * exceptional one.
 */

import type { LocationId } from '@/lib/location-types';

import { isKnownEmote } from './emotes';
import {
  FREE_TEXT_WIRE_TYPES,
  ISLAND_MESSAGE_VERSION,
  MAX_MESSAGE_PAYLOAD_BYTES,
  MAX_TEMPLATE_PARAMS,
  type IslandMessage,
} from './message';
import { isKnownQuickPhrase } from './quick-phrases';
import { phraseTemplateById, templateParamValueById } from './templates';

/** Why a payload was not accepted. Every branch below names exactly one. */
export type MessageParseFailure =
  | 'oversized'
  | 'malformed-json'
  | 'not-an-object'
  | 'unknown-type'
  | 'unsupported-version'
  | 'invalid-text'
  | 'empty-text'
  | 'unknown-phrase'
  | 'unknown-emote'
  | 'unknown-template'
  | 'malformed-params'
  | 'missing-parameter'
  | 'unexpected-parameter'
  | 'invalid-parameter';

/** The envelope fields a caller needs to scope the message. */
export interface ParsedEnvelope {
  /** The location the sender claims to be in; the caller compares it to its own. */
  readonly location: string | null;
  readonly blobbiD: string | null;
  readonly ts: number | null;
}

export type MessageParseResult =
  | {
      readonly ok: true;
      readonly message: IslandMessage;
      readonly envelope: ParsedEnvelope;
      /**
       * True when the payload carried no version field; i.e. the shape every
       * currently deployed client emits. Free text is byte-identical whether it
       * came from an old client or a new one, which is deliberate: the
       * compatibility rule and the safety rule are the same rule
       * (`freeTextChat`), so nothing downstream needs to tell them apart.
       */
      readonly legacy: boolean;
    }
  | { readonly ok: false; readonly reason: MessageParseFailure };

function failure(reason: MessageParseFailure): MessageParseResult {
  return { ok: false, reason };
}

/**
 * Strip anything markup-shaped and collapse whitespace.
 *
 * To be clear about what protects this app: React escaping does, plus a CSP with
 * `default-src 'none'`. Chat text is rendered as a text node and never as
 * markup. This step is cosmetic tidying inherited from the previous
 * implementation: it stops a stray `<b>` from looking like a bug, and it is
 * deliberately NOT relied on as a security control, because it is trivially
 * evaded by an unclosed tag.
 */
function sanitizeText(raw: string): string {
  return raw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function readEnvelope(payload: Record<string, unknown>): ParsedEnvelope {
  const location = typeof payload.location === 'string' ? payload.location : null;
  const blobbiD = typeof payload.blobbiD === 'string' ? payload.blobbiD : null;
  const ts = typeof payload.ts === 'number' && Number.isFinite(payload.ts) ? payload.ts : null;
  return { location, blobbiD, ts };
}

/**
 * Version gate for structured messages.
 *
 * An unknown version is refused rather than best-effort parsed: a future version
 * exists precisely because something about the meaning changed, and guessing at
 * a schema is how a receiver ends up rendering a message it did not understand.
 */
function versionOk(payload: Record<string, unknown>): boolean {
  return payload.v === ISLAND_MESSAGE_VERSION;
}

/**
 * Validate a template's parameters against its declaration.
 *
 * Exact match in both directions: every declared parameter must be present with
 * an allowed value, and no parameter may be present that was not declared. The
 * second half matters more than it looks; it is what stops a payload from
 * carrying a passenger field that some later, more forgiving reader might pick
 * up.
 */
function parseTemplateParams(
  templateId: string,
  rawParams: unknown,
): { ok: true; params: Record<string, string> } | { ok: false; reason: MessageParseFailure } {
  const template = phraseTemplateById(templateId);
  if (!template) return { ok: false, reason: 'unknown-template' };

  if (rawParams === null || typeof rawParams !== 'object' || Array.isArray(rawParams)) {
    return { ok: false, reason: 'malformed-params' };
  }

  const received = rawParams as Record<string, unknown>;
  const receivedKeys = Object.keys(received);
  if (receivedKeys.length > MAX_TEMPLATE_PARAMS) {
    return { ok: false, reason: 'unexpected-parameter' };
  }

  const declared = new Set(template.params.map((param) => param.name));
  for (const key of receivedKeys) {
    if (!declared.has(key)) return { ok: false, reason: 'unexpected-parameter' };
  }

  const params: Record<string, string> = {};
  for (const param of template.params) {
    const value = received[param.name];
    if (value === undefined) return { ok: false, reason: 'missing-parameter' };
    if (typeof value !== 'string') return { ok: false, reason: 'invalid-parameter' };
    if (!templateParamValueById(param.catalog, value)) {
      return { ok: false, reason: 'invalid-parameter' };
    }
    // Only the id is kept. Nothing else from `received` survives this loop.
    params[param.name] = value;
  }

  return { ok: true, params };
}

/**
 * Turn a kind 21201 `content` string into a message, or into a reason it is not
 * one.
 *
 * @param raw - the event's `content`, exactly as it arrived
 */
export function parseIslandChatPayload(raw: string): MessageParseResult {
  if (typeof raw !== 'string') return failure('malformed-json');

  // Cheapest possible rejection first: a hostile flood should cost a length
  // check, not a JSON parse.
  if (new TextEncoder().encode(raw).length > MAX_MESSAGE_PAYLOAD_BYTES) {
    return failure('oversized');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failure('malformed-json');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return failure('not-an-object');
  }

  const payload = parsed as Record<string, unknown>;
  const type = payload.type;
  if (typeof type !== 'string') return failure('unknown-type');

  const envelope = readEnvelope(payload);

  // ── Free text ──────────────────────────────────────────────────────────
  // The deployed shape, unchanged. It carries no version, so `legacy` is true
  // for every free-text message including the ones this client sends; see the
  // note on the result type.
  if (FREE_TEXT_WIRE_TYPES.includes(type)) {
    if (typeof payload.text !== 'string') return failure('invalid-text');
    const text = sanitizeText(payload.text);
    if (!text) return failure('empty-text');
    return { ok: true, message: { type: 'text', text }, envelope, legacy: payload.v === undefined };
  }

  // ── Structured classes ─────────────────────────────────────────────────
  switch (type) {
    case 'quick': {
      if (!versionOk(payload)) return failure('unsupported-version');
      const phrase = payload.phrase;
      if (typeof phrase !== 'string' || !isKnownQuickPhrase(phrase)) {
        return failure('unknown-phrase');
      }
      return { ok: true, message: { type: 'quick', phrase }, envelope, legacy: false };
    }

    case 'emote': {
      if (!versionOk(payload)) return failure('unsupported-version');
      const emote = payload.emote;
      if (typeof emote !== 'string' || !isKnownEmote(emote)) return failure('unknown-emote');
      return { ok: true, message: { type: 'emote', emote }, envelope, legacy: false };
    }

    case 'template': {
      if (!versionOk(payload)) return failure('unsupported-version');
      const templateId = payload.template;
      if (typeof templateId !== 'string') return failure('unknown-template');
      const params = parseTemplateParams(templateId, payload.params);
      if (!params.ok) return failure(params.reason);
      return {
        ok: true,
        message: { type: 'template', template: templateId, params: params.params },
        envelope,
        legacy: false,
      };
    }

    default:
      // Includes every future class an older build will meet. Ignoring it is the
      // correct behaviour and the reason new classes were addable at all.
      return failure('unknown-type');
  }
}

/** Narrowing helper for callers that already know the location they expect. */
export function isFromLocation(envelope: ParsedEnvelope, location: LocationId): boolean {
  return envelope.location === location;
}
