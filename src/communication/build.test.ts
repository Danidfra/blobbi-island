/**
 * The outbound payload.
 *
 * Two claims worth pinning: free text stays byte-compatible with the deployed
 * schema (so an older client keeps rendering it), and a structured payload
 * carries no free-text field at all (so no receiver, present or future, can be
 * tempted to read one).
 */
import { describe, expect, it } from 'vitest';

import { buildMessagePayload, messageAltText } from './build';
import { ISLAND_MESSAGE_VERSION } from './message';
import { parseIslandChatPayload } from './parse';

const options = { location: 'town', blobbiD: 'b1', ts: 1_800_000_000 } as const;

describe('free text keeps the deployed wire shape', () => {
  it('emits type "chat" with a text field and no version', () => {
    const payload = JSON.parse(buildMessagePayload({ type: 'text', text: 'hello' }, options));
    expect(payload).toEqual({
      type: 'chat',
      location: 'town',
      blobbiD: 'b1',
      ts: 1_800_000_000,
      text: 'hello',
    });
  });

  it('is exactly what a client that predates Communication V2 expects', () => {
    // That client checked `content.type === 'chat'` and read `content.text`.
    // Both still hold, which is why free text keeps working across the upgrade.
    const payload = JSON.parse(buildMessagePayload({ type: 'text', text: 'hi' }, options));
    expect(payload.type).toBe('chat');
    expect(typeof payload.text).toBe('string');
  });
});

describe('structured payloads carry ids and nothing else', () => {
  it('emits a quick phrase as an id', () => {
    const payload = JSON.parse(
      buildMessagePayload({ type: 'quick', phrase: 'want-to-play' }, options),
    );
    expect(payload).toEqual({
      type: 'quick',
      v: ISLAND_MESSAGE_VERSION,
      location: 'town',
      blobbiD: 'b1',
      ts: 1_800_000_000,
      phrase: 'want-to-play',
    });
  });

  it('emits a template as an id plus value ids', () => {
    const payload = JSON.parse(
      buildMessagePayload(
        { type: 'template', template: 'meet-at-in', params: { location: 'beach', time: '5m' } },
        options,
      ),
    );
    expect(payload.template).toBe('meet-at-in');
    expect(payload.params).toEqual({ location: 'beach', time: '5m' });
  });

  it('emits an emote as an id, never as a glyph', () => {
    const payload = JSON.parse(buildMessagePayload({ type: 'emote', emote: 'wave' }, options));
    expect(payload.emote).toBe('wave');
  });

  it.each([
    ['quick', { type: 'quick', phrase: 'hi' }],
    ['template', { type: 'template', template: 'going-to', params: { location: 'beach' } }],
    ['emote', { type: 'emote', emote: 'wave' }],
  ] as const)('emits no free-text field for a %s message', (_label, message) => {
    // The invariant the whole trusted-reconstruction argument rests on: there is
    // no `text` and no `fallback` to read, so a receiver cannot render one.
    const raw = buildMessagePayload(message, options);
    const payload = JSON.parse(raw);
    expect(payload.text).toBeUndefined();
    expect(payload.fallback).toBeUndefined();
    expect(Object.keys(payload).some((key) => /text|label|display|words/i.test(key))).toBe(false);
  });

  it('renders display labels nowhere in the payload', () => {
    const raw = buildMessagePayload(
      { type: 'template', template: 'meet-at-in', params: { location: 'arcade', time: '10m' } },
      options,
    );
    expect(raw).not.toContain('Meet me at');
    expect(raw).not.toContain('the Arcade');
    expect(raw).not.toContain('10 minutes');
  });
});

describe('round trip', () => {
  it.each([
    ['text', { type: 'text', text: 'hello there' }],
    ['quick', { type: 'quick', phrase: 'good-game' }],
    ['emote', { type: 'emote', emote: 'clap' }],
    ['template', { type: 'template', template: 'back-in', params: { time: '15m' } }],
  ] as const)('a built %s message parses back to itself', (_label, message) => {
    const result = parseIslandChatPayload(buildMessagePayload(message, options));
    expect(result.ok && result.message).toEqual(message);
  });

  it('omits blobbiD rather than emitting an empty one', () => {
    const payload = JSON.parse(
      buildMessagePayload({ type: 'emote', emote: 'wave' }, { location: 'town', ts: 1 }),
    );
    expect('blobbiD' in payload).toBe(false);
  });
});

describe('the alt tag', () => {
  it('describes the event for clients that do not know this kind', () => {
    expect(messageAltText('Want to play?')).toBe('Chat message: Want to play?');
  });

  it('truncates a long description', () => {
    // 'Chat message: ' + 50 characters + an ellipsis. Bounded, so a long
    // message cannot turn a descriptive tag into a payload of its own.
    const alt = messageAltText('x'.repeat(100));
    expect(alt.endsWith('...')).toBe(true);
    expect(alt.length).toBeLessThanOrEqual(70);
  });
});
