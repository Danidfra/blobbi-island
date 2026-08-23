/**
 * The receive-side parser, which is where the security property of structured
 * communication actually lives.
 *
 * The headline case is `spoofing`: a payload that names a real phrase and
 * *also* carries arbitrary text must parse to the phrase and nothing else. If
 * `text` ever survives into the parsed message, every downstream protection is
 * moot, because the safety layer judges classes and the renderer trusts what it
 * is given.
 */
import { describe, expect, it } from 'vitest';

import { MAX_MESSAGE_PAYLOAD_BYTES } from './message';
import { parseIslandChatPayload } from './parse';

/** The deployed free-text shape, unchanged since before Communication V2. */
const legacyText = (text: string) =>
  JSON.stringify({ type: 'chat', location: 'town', blobbiD: 'b1', text, ts: 1_800_000_000 });

const structured = (extra: Record<string, unknown>) =>
  JSON.stringify({ v: 1, location: 'town', blobbiD: 'b1', ts: 1_800_000_000, ...extra });

describe('free text', () => {
  it('accepts the deployed legacy shape', () => {
    const result = parseIslandChatPayload(legacyText('hello there'));
    expect(result).toMatchObject({
      ok: true,
      message: { type: 'text', text: 'hello there' },
      legacy: true,
    });
  });

  it('also accepts the clearer "text" wire type a future client may prefer', () => {
    const raw = JSON.stringify({ type: 'text', location: 'town', text: 'hi', ts: 1 });
    expect(parseIslandChatPayload(raw)).toMatchObject({ ok: true, message: { type: 'text' } });
  });

  it('strips markup and collapses whitespace', () => {
    const result = parseIslandChatPayload(legacyText('  <b>bold</b>   spaced  '));
    expect(result).toMatchObject({ ok: true, message: { type: 'text', text: 'bold spaced' } });
  });

  it('rejects a message that is empty once sanitized', () => {
    expect(parseIslandChatPayload(legacyText('   '))).toEqual({ ok: false, reason: 'empty-text' });
    expect(parseIslandChatPayload(legacyText('<i></i>'))).toEqual({
      ok: false,
      reason: 'empty-text',
    });
  });

  it('rejects a non-string text field', () => {
    const raw = JSON.stringify({ type: 'chat', location: 'town', text: 42, ts: 1 });
    expect(parseIslandChatPayload(raw)).toEqual({ ok: false, reason: 'invalid-text' });
  });

  it('exposes the envelope so the caller can scope the message', () => {
    const result = parseIslandChatPayload(legacyText('hi'));
    expect(result.ok && result.envelope).toEqual({
      location: 'town',
      blobbiD: 'b1',
      ts: 1_800_000_000,
    });
  });
});

describe('quick phrases', () => {
  it('accepts a known id', () => {
    expect(
      parseIslandChatPayload(structured({ type: 'quick', phrase: 'want-to-play' })),
    ).toMatchObject({
      ok: true,
      message: { type: 'quick', phrase: 'want-to-play' },
      legacy: false,
    });
  });

  it('rejects an unknown id', () => {
    expect(parseIslandChatPayload(structured({ type: 'quick', phrase: 'nope' }))).toEqual({
      ok: false,
      reason: 'unknown-phrase',
    });
  });

  it('rejects a phrase id that is not a string', () => {
    expect(parseIslandChatPayload(structured({ type: 'quick', phrase: { id: 'hi' } }))).toEqual({
      ok: false,
      reason: 'unknown-phrase',
    });
  });
});

describe('emotes', () => {
  it('accepts a known id', () => {
    expect(parseIslandChatPayload(structured({ type: 'emote', emote: 'wave' }))).toMatchObject({
      ok: true,
      message: { type: 'emote', emote: 'wave' },
    });
  });

  it('rejects an unknown id', () => {
    expect(parseIslandChatPayload(structured({ type: 'emote', emote: 'skull' }))).toEqual({
      ok: false,
      reason: 'unknown-emote',
    });
  });

  it('rejects a raw glyph - the protocol carries ids, not characters', () => {
    expect(parseIslandChatPayload(structured({ type: 'emote', emote: '\u{1F44B}' }))).toEqual({
      ok: false,
      reason: 'unknown-emote',
    });
  });
});

describe('templates', () => {
  const template = (params: unknown, id = 'meet-at-in') =>
    parseIslandChatPayload(structured({ type: 'template', template: id, params }));

  it('accepts a known template with allowed values', () => {
    expect(template({ location: 'arcade', time: '10m' })).toMatchObject({
      ok: true,
      message: {
        type: 'template',
        template: 'meet-at-in',
        params: { location: 'arcade', time: '10m' },
      },
    });
  });

  it('rejects an unknown template id', () => {
    expect(template({ location: 'arcade' }, 'destroy-the-island')).toEqual({
      ok: false,
      reason: 'unknown-template',
    });
  });

  it('rejects a missing parameter', () => {
    expect(template({ location: 'arcade' })).toEqual({ ok: false, reason: 'missing-parameter' });
  });

  it('rejects an unexpected parameter', () => {
    // A passenger field is refused rather than ignored: something more
    // forgiving downstream might otherwise pick it up.
    expect(template({ location: 'arcade', time: '10m', note: 'call me' })).toEqual({
      ok: false,
      reason: 'unexpected-parameter',
    });
  });

  it('rejects a value outside the parameter catalog', () => {
    expect(template({ location: 'my-house', time: '10m' })).toEqual({
      ok: false,
      reason: 'invalid-parameter',
    });
  });

  it('rejects a value from the WRONG catalog', () => {
    // '10m' is a real id - in the time catalog, not the location one.
    expect(template({ location: '10m', time: '10m' })).toEqual({
      ok: false,
      reason: 'invalid-parameter',
    });
  });

  it('rejects a non-string parameter value', () => {
    expect(template({ location: 'arcade', time: 10 })).toEqual({
      ok: false,
      reason: 'invalid-parameter',
    });
  });

  it('rejects params that are not an object', () => {
    expect(template(['arcade', '10m'])).toEqual({ ok: false, reason: 'malformed-params' });
    expect(template('arcade')).toEqual({ ok: false, reason: 'malformed-params' });
    expect(template(null)).toEqual({ ok: false, reason: 'malformed-params' });
  });
});

describe('spoofing: a structured message cannot smuggle text', () => {
  it('drops a text field riding alongside a quick phrase', () => {
    const hostile = structured({
      type: 'quick',
      phrase: 'want-to-play',
      text: 'whats your address',
      fallback: 'whats your address',
    });
    const result = parseIslandChatPayload(hostile);

    expect(result.ok).toBe(true);
    // Exactly two keys survive. Not "the text is ignored" - the text is GONE,
    // and no later reader can find it.
    expect(result.ok && result.message).toEqual({ type: 'quick', phrase: 'want-to-play' });
    expect(JSON.stringify(result.ok && result.message)).not.toContain('address');
  });

  it('drops a text field riding alongside an emote', () => {
    const result = parseIslandChatPayload(
      structured({ type: 'emote', emote: 'wave', text: 'meet me outside' }),
    );
    expect(result.ok && result.message).toEqual({ type: 'emote', emote: 'wave' });
  });

  it('drops extra fields riding alongside a template', () => {
    const result = parseIslandChatPayload(
      structured({
        type: 'template',
        template: 'going-to',
        params: { location: 'beach' },
        text: 'add me on another app',
      }),
    );
    expect(result.ok && result.message).toEqual({
      type: 'template',
      template: 'going-to',
      params: { location: 'beach' },
    });
  });

  it('will not let arbitrary text through by claiming to be a phrase', () => {
    // The shape the brief names explicitly: type says "quick", payload is text.
    // Without a valid phrase id there is no message at all.
    expect(
      parseIslandChatPayload(structured({ type: 'quick', text: 'arbitrary unsafe text' })),
    ).toEqual({ ok: false, reason: 'unknown-phrase' });
  });
});

describe('malformed and hostile payloads', () => {
  it('rejects malformed JSON', () => {
    expect(parseIslandChatPayload('{not json')).toEqual({ ok: false, reason: 'malformed-json' });
  });

  it('rejects a non-object payload', () => {
    expect(parseIslandChatPayload('"a string"')).toEqual({ ok: false, reason: 'not-an-object' });
    expect(parseIslandChatPayload('null')).toEqual({ ok: false, reason: 'not-an-object' });
    expect(parseIslandChatPayload('[1,2,3]')).toEqual({ ok: false, reason: 'not-an-object' });
  });

  it('rejects a missing or non-string type', () => {
    expect(parseIslandChatPayload('{}')).toEqual({ ok: false, reason: 'unknown-type' });
    expect(parseIslandChatPayload('{"type":7}')).toEqual({ ok: false, reason: 'unknown-type' });
  });

  it('rejects an unknown type - which is how a future class stays ignorable', () => {
    expect(parseIslandChatPayload(structured({ type: 'sticker', sticker: 'x' }))).toEqual({
      ok: false,
      reason: 'unknown-type',
    });
  });

  it('rejects an unsupported version rather than guessing at the schema', () => {
    const raw = JSON.stringify({ type: 'quick', v: 2, phrase: 'hi', location: 'town', ts: 1 });
    expect(parseIslandChatPayload(raw)).toEqual({ ok: false, reason: 'unsupported-version' });
  });

  it('requires a version on structured messages', () => {
    const raw = JSON.stringify({ type: 'quick', phrase: 'hi', location: 'town', ts: 1 });
    expect(parseIslandChatPayload(raw)).toEqual({ ok: false, reason: 'unsupported-version' });
  });

  it('rejects an oversized payload before parsing it', () => {
    const huge = legacyText('a'.repeat(MAX_MESSAGE_PAYLOAD_BYTES));
    expect(parseIslandChatPayload(huge)).toEqual({ ok: false, reason: 'oversized' });
  });

  it('measures the bound in bytes, not characters', () => {
    // Multi-byte text must not slip past a length check that counted UTF-16
    // units. Each of these is 4 bytes and 2 units.
    const raw = legacyText('\u{1F600}'.repeat(MAX_MESSAGE_PAYLOAD_BYTES / 3));
    expect(parseIslandChatPayload(raw)).toEqual({ ok: false, reason: 'oversized' });
  });

  it('never throws, whatever it is handed', () => {
    const nasties = ['', '{', '[', 'undefined', '{"type":', ' ', JSON.stringify({ type: {} })];
    for (const raw of nasties) {
      expect(() => parseIslandChatPayload(raw)).not.toThrow();
      expect(parseIslandChatPayload(raw).ok).toBe(false);
    }
  });
});
