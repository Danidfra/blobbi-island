/**
 * The speech bubble's width comes from its text, not from the Blobbi it
 * hangs over.
 *
 * The bubble portals INTO the actor's anchor and is absolutely positioned
 * there, so its containing block is the Blobbi's own box (64 to 128 px). A
 * shrink-to-fit bubble could never be wider than that box, and a sentence
 * wrapped into a column one or two words tall: measured in the browser, a
 * 12-word phrase over an `xl` Blobbi rendered 106 px wide and 158 px tall.
 * jsdom lays nothing out, so this pins the sizing contract on the DOM: the
 * wrapper is content-sized and capped, and an unbroken string breaks inside
 * the cap instead of widening the bubble past it.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { ChatBubblesLayer, type ChatBubble } from './ChatBubblesLayer';

function bubble(content: ChatBubble['content'], id = 'b1'): Map<string, ChatBubble> {
  const now = Date.now();
  return new Map([[id, { id, playerKey: 'me', content, createdAt: now, expiresAt: now + 4000 }]]);
}

function renderOver(content: ChatBubble['content']) {
  const anchor = document.createElement('div');
  anchor.style.width = '64px';
  document.body.appendChild(anchor);
  const utils = render(<ChatBubblesLayer bubbles={bubble(content)} getAnchorEl={() => anchor} />);
  const status = anchor.querySelector('[role="status"]') as HTMLElement;
  return { ...utils, anchor, status, wrapper: status.parentElement as HTMLElement };
}

describe('speech bubble sizing', () => {
  it('sizes the wrapper to its text and caps it, instead of to the Blobbi box', () => {
    const { wrapper } = renderOver({ type: 'text', text: 'Want to come and play at the arcade with me this afternoon?' });
    expect(wrapper.className).toMatch(/\bw-max\b/);
    expect(wrapper.className).toMatch(/(^|\s)max-w-\[220px\](\s|$)/);
  });

  it('breaks an unbroken string inside the cap rather than widening the bubble', () => {
    const { status } = renderOver({ type: 'text', text: 'a'.repeat(80) });
    expect(status.className).toMatch(/\[overflow-wrap:anywhere\]/);
    expect(status.className).not.toMatch(/\bbreak-words\b/);
    expect(status.className).toMatch(/(^|\s)max-w-\[220px\](\s|$)/);
  });

  it('keeps a short message in a tight bubble (content-sized, no fixed width)', () => {
    const { wrapper } = renderOver({ type: 'text', text: 'Hi!' });
    expect(wrapper.className).not.toMatch(/(^|\s)w-\[/);
    expect(wrapper.className).not.toMatch(/\bw-full\b/);
  });

  it('leaves the emote bubble as a tight square', () => {
    const { status } = renderOver({ type: 'emote', emote: 'wave', glyph: '👋' } as ChatBubble['content']);
    expect(status.textContent).toContain('👋');
    expect(status.className).toMatch(/py-1\.5/);
  });
});
