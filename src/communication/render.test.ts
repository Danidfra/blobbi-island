/**
 * Trusted reconstruction: the other half of the spoofing defence.
 *
 * The parser guarantees a structured message contains only ids. This module
 * guarantees the words come from the local catalogs. Together they are the claim
 * that a hostile client cannot make a Blobbi say anything this build does not
 * already ship.
 */
import { describe, expect, it } from 'vitest';

import { EMOTES } from './emotes';
import { QUICK_PHRASES, quickPhraseById } from './quick-phrases';
import { bubbleTextEquivalent, renderMessage, renderTemplateText } from './render';
import { phraseTemplateById } from './templates';

describe('free text renders what was said', () => {
  it('keeps the sender words - which is exactly what freeTextChat governs', () => {
    expect(renderMessage({ type: 'text', text: 'hello there' })).toEqual({
      type: 'text',
      text: 'hello there',
    });
  });

  it('renders nothing for text that is empty once trimmed', () => {
    expect(renderMessage({ type: 'text', text: '   ' })).toBeNull();
  });
});

describe('structured messages render from the local catalog', () => {
  it.each(QUICK_PHRASES.map((phrase) => [phrase.id, phrase.text] as const))(
    'renders quick phrase %s as its catalog text',
    (id, text) => {
      expect(renderMessage({ type: 'quick', phrase: id })).toEqual({ type: 'phrase', text });
    },
  );

  it.each(EMOTES.map((emote) => [emote.id] as const))('renders emote %s with glyph and label', (id) => {
    const rendered = renderMessage({ type: 'emote', emote: id });
    const catalog = EMOTES.find((emote) => emote.id === id)!;
    expect(rendered).toEqual({
      type: 'emote',
      emote: id,
      glyph: catalog.glyph,
      label: catalog.label,
    });
  });

  it('reconstructs a template from value ids, never from wire strings', () => {
    expect(
      renderMessage({
        type: 'template',
        template: 'meet-at-in',
        params: { location: 'arcade', time: '10m' },
      }),
    ).toEqual({ type: 'phrase', text: 'Meet me at the Arcade in 10 minutes.' });
  });

  it('renders nothing for an id this build does not know', () => {
    // The older-client-meets-newer-catalog case. Not shown is the same outcome
    // as never received, and specifically not an error.
    expect(renderMessage({ type: 'quick', phrase: 'not-in-this-build' })).toBeNull();
    expect(renderMessage({ type: 'emote', emote: 'not-in-this-build' })).toBeNull();
    expect(renderMessage({ type: 'template', template: 'nope', params: {} })).toBeNull();
  });

  it('renders nothing when a template parameter is missing or unknown', () => {
    expect(renderMessage({ type: 'template', template: 'meet-at-in', params: {} })).toBeNull();
    expect(
      renderMessage({
        type: 'template',
        template: 'going-to',
        params: { location: 'somewhere-else' },
      }),
    ).toBeNull();
  });
});

describe('nothing from the wire reaches the screen', () => {
  it('ignores a value id that looks like a sentence', () => {
    // Even if a payload smuggled a display string in as an id, it resolves to
    // no catalog entry and renders nothing - it is never printed verbatim.
    const rendered = renderMessage({
      type: 'template',
      template: 'going-to',
      params: { location: 'MY HOUSE, come alone' },
    });
    expect(rendered).toBeNull();
  });

  it('renders a quick phrase identically no matter what the sender intended', () => {
    // Two clients rendering the same id must produce the same words; that is
    // what makes an id safe to trust and a string not.
    const local = quickPhraseById('want-to-play')!;
    expect(renderMessage({ type: 'quick', phrase: 'want-to-play' })).toEqual({
      type: 'phrase',
      text: local.text,
    });
  });
});

describe('text equivalents', () => {
  it('gives an emote its label, so a bubble is never a bare glyph to a reader', () => {
    const bubble = renderMessage({ type: 'emote', emote: 'clap' })!;
    expect(bubbleTextEquivalent(bubble)).toBe('Clap');
  });

  it('gives text and phrases their words', () => {
    expect(bubbleTextEquivalent({ type: 'text', text: 'hi' })).toBe('hi');
    expect(bubbleTextEquivalent({ type: 'phrase', text: 'Hi!' })).toBe('Hi!');
  });
});

describe('renderTemplateText is shared with the composer', () => {
  it('produces the same sentence the receiver will show', () => {
    // The builder previews with this function and the receiver renders with it,
    // so a preview cannot lie about what is being said.
    const template = phraseTemplateById('want-to-play')!;
    const preview = renderTemplateText(template, { activity: 'pool' });
    const received = renderMessage({
      type: 'template',
      template: 'want-to-play',
      params: { activity: 'pool' },
    });

    expect(preview).toBe('Want to play Pool?');
    expect(received).toEqual({ type: 'phrase', text: preview });
  });
});
