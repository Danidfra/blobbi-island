/**
 * The chat capability at its enforcement point.
 *
 * The pair of expectations that matter:
 *
 *  - under Standard, admission is a no-op — the same hostile payload that Family
 *    refuses is admitted here, deliberately, because this is a capability check
 *    and not a content filter, and because wiring it into the live chat path
 *    must not change what a Standard player sees;
 *  - under Family, free text is refused whatever it looks like.
 */
import { describe, expect, it } from 'vitest';

import { admitChatMessage } from './chat-admission';
import { FAMILY_POLICY, STANDARD_POLICY } from './policies';

/** Payloads a moderation-shaped implementation would be tempted to treat differently. */
const MESSAGES = [
  ['ordinary friendly text', 'hi! want to play tag?'],
  ['an off-platform handle', 'add me on some-other-app, im xXx_gamer'],
  ['a bare URL', 'https://example.com/definitely-fine'],
  ['personal information', 'im 9 and i live in springfield'],
  ['sexual content', '[explicit solicitation]'],
  ['markup that survived sanitising', '<img src=x onerror=alert(1)'],
  ['whitespace only', '   '],
  ['empty', ''],
  ['far longer than the composer allows', 'a'.repeat(5000)],
] as const;

describe('Standard admits everything, unchanged', () => {
  it.each(MESSAGES)('admits %s', (_label, text) => {
    expect(admitChatMessage(STANDARD_POLICY, { text })).toEqual({ admitted: true });
  });

  it('applies no length limit of its own', () => {
    // The 120-character limit is a composer affordance (`CHAT_MAX_LEN`), not a
    // policy rule. Enforcing it here would silently change what Standard
    // renders for messages from other clients.
    expect(admitChatMessage(STANDARD_POLICY, { text: 'x'.repeat(100_000) }).admitted).toBe(true);
  });
});

describe('Family refuses free text', () => {
  it.each(MESSAGES)('refuses %s', (_label, text) => {
    expect(admitChatMessage(FAMILY_POLICY, { text })).toEqual({
      admitted: false,
      reason: 'free-text-not-permitted',
    });
  });

  it('refuses on the capability, never on the content', () => {
    // The same innocuous sentence is admitted under one policy and refused under
    // the other, which is what makes this a capability boundary rather than a
    // filter that could be tuned, evaded or argued with.
    const message = { text: 'hello friend' };
    expect(admitChatMessage(STANDARD_POLICY, message).admitted).toBe(true);
    expect(admitChatMessage(FAMILY_POLICY, message).admitted).toBe(false);
  });
});

describe('the decision is a discriminated union', () => {
  it('carries a reason only when it refuses', () => {
    const admitted = admitChatMessage(STANDARD_POLICY, { text: 'hi' });
    const refused = admitChatMessage(FAMILY_POLICY, { text: 'hi' });

    expect('reason' in admitted).toBe(false);
    expect(refused.admitted === false && refused.reason).toBe('free-text-not-permitted');
  });

  it('returns frozen results, so a caller cannot flip a refusal into consent', () => {
    const refused = admitChatMessage(FAMILY_POLICY, { text: 'hi' });
    expect(Object.isFrozen(refused)).toBe(true);
    expect(() => {
      (refused as { admitted: boolean }).admitted = true;
    }).toThrow();
  });
});
