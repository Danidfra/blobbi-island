/**
 * The communication capability at its enforcement point.
 *
 * Three things are being pinned:
 *
 *  - **Standard is unchanged.** Every class is admitted, including free text,
 *    including hostile free text. Wiring admission into the live chat path must
 *    not change what a Standard player sees.
 *  - **Family substitutes rather than silences.** Free text is refused; quick
 *    phrases, templates and emotes are admitted, so the restricted experience
 *    still has a voice.
 *  - **The decision is about the class, never the content.** There is no field
 *    on the candidate that could carry words, which is what makes the spoofing
 *    attack a parser problem rather than an admission problem; see
 *    `src/communication/parse.test.ts` for the other half.
 */
import { describe, expect, it } from 'vitest';

import { admitChatMessage, type ChatMessageClass } from './chat-admission';
import { FAMILY_POLICY, STANDARD_POLICY } from './policies';

const ALL_CLASSES: readonly ChatMessageClass[] = ['text', 'quick', 'template', 'emote'];

describe('Standard admits every class', () => {
  it.each(ALL_CLASSES.map((type) => [type] as const))('admits %s', (type) => {
    expect(admitChatMessage(STANDARD_POLICY, { type })).toEqual({ admitted: true });
  });
});

describe('Family refuses free text and nothing else', () => {
  it('refuses free text', () => {
    expect(admitChatMessage(FAMILY_POLICY, { type: 'text' })).toEqual({
      admitted: false,
      reason: 'free-text-not-permitted',
    });
  });

  it.each([['quick'], ['template'], ['emote']] as const)('admits %s', (type) => {
    expect(admitChatMessage(FAMILY_POLICY, { type })).toEqual({ admitted: true });
  });

  it('leaves the player a way to speak', () => {
    // The invariant that makes restricting free text legitimate: at least one
    // class survives, so Family is a substitution rather than a silencing.
    const speakable = ALL_CLASSES.filter(
      (type) => admitChatMessage(FAMILY_POLICY, { type }).admitted,
    );
    expect(speakable.length).toBeGreaterThan(0);
  });
});

describe('capabilities, not profiles', () => {
  it('follows freeTextChat wherever it is set', () => {
    const permissive = { ...FAMILY_POLICY, freeTextChat: true };
    expect(admitChatMessage(permissive, { type: 'text' }).admitted).toBe(true);
  });

  it('follows predefinedPhrases', () => {
    const noPhrases = { ...STANDARD_POLICY, predefinedPhrases: false };
    expect(admitChatMessage(noPhrases, { type: 'quick' })).toEqual({
      admitted: false,
      reason: 'phrases-not-permitted',
    });
    expect(admitChatMessage(noPhrases, { type: 'template' }).admitted).toBe(false);
  });

  it('follows emotes', () => {
    const noEmotes = { ...STANDARD_POLICY, emotes: false };
    expect(admitChatMessage(noEmotes, { type: 'emote' })).toEqual({
      admitted: false,
      reason: 'emotes-not-permitted',
    });
  });

  it('never consults the profile name', () => {
    // A policy labelled 'family' whose capabilities are Standard's behaves as
    // Standard. If this ever fails, something started branching on identity.
    const mislabelled = { ...STANDARD_POLICY, profile: 'family' as const };
    for (const type of ALL_CLASSES) {
      expect(admitChatMessage(mislabelled, { type }).admitted).toBe(true);
    }
  });
});

describe('the decision is a discriminated union', () => {
  it('carries a reason only when it refuses', () => {
    const admitted = admitChatMessage(STANDARD_POLICY, { type: 'text' });
    const refused = admitChatMessage(FAMILY_POLICY, { type: 'text' });

    expect('reason' in admitted).toBe(false);
    expect(refused.admitted === false && refused.reason).toBe('free-text-not-permitted');
  });

  it('returns frozen results, so a caller cannot flip a refusal into consent', () => {
    const refused = admitChatMessage(FAMILY_POLICY, { type: 'text' });
    expect(Object.isFrozen(refused)).toBe(true);
    expect(() => {
      (refused as { admitted: boolean }).admitted = true;
    }).toThrow();
  });

  it('refuses an unrecognised class rather than admitting it', () => {
    // Defence for the case the type system cannot see: an event class added
    // without a capability decision must fail closed.
    const unknown = { type: 'sticker' } as unknown as { type: ChatMessageClass };
    expect(admitChatMessage(STANDARD_POLICY, unknown).admitted).toBe(false);
  });
});
