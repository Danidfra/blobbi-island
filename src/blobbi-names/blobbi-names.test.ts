/**
 * The two naming rules, and the vocabularies they rest on.
 *
 * The assertion that carries the most weight is `rejects a clean sentence`: a
 * modified client does not send profanity, it sends "meet me outside", and a
 * curated naming rule that only checked for prohibited words would publish it.
 */
import { describe, expect, it } from 'vitest';

import { FAMILY_POLICY, STANDARD_POLICY, type IslandSafetyPolicy } from '@/safety';
import { containsProhibitedText } from '@/user-text';

import {
  CURATED_ADJECTIVES,
  CURATED_NAME_COMBINATIONS,
  CURATED_NOUNS,
  composeCuratedName,
  isCuratedBlobbiName,
  validateCuratedBlobbiName,
} from './curated-names';
import { resolveRemoteBlobbiDisplayName, safeBlobbiAlias } from './display-names';
import { MAX_BLOBBI_NAME_LENGTH, admitOwnBlobbiName } from './own-name';

const STRANGER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

const policy = (overrides: Partial<IslandSafetyPolicy>): IslandSafetyPolicy =>
  ({ ...STANDARD_POLICY, ...overrides }) as IslandSafetyPolicy;

// ── The curated vocabulary ─────────────────────────────────────────────────

describe('the curated vocabulary', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(CURATED_ADJECTIVES)).toBe(true);
    expect(Object.isFrozen(CURATED_NOUNS)).toBe(true);
  });

  it('has no duplicates', () => {
    expect(new Set(CURATED_ADJECTIVES).size).toBe(CURATED_ADJECTIVES.length);
    expect(new Set(CURATED_NOUNS).size).toBe(CURATED_NOUNS.length);
  });

  it('offers enough combinations to feel chosen rather than assigned', () => {
    expect(CURATED_NAME_COMBINATIONS).toBeGreaterThanOrEqual(200);
  });

  it('produces nothing prohibited, in any pairing', () => {
    // Every one of the 256 combinations, not a sample: a single unfortunate
    // pairing is exactly the kind of thing a curated list is supposed to make
    // impossible, and there are few enough to simply check them all.
    for (const adjective of CURATED_ADJECTIVES) {
      for (const noun of CURATED_NOUNS) {
        const name = `${adjective} ${noun}`;
        expect(containsProhibitedText(name), name).toBe(false);
      }
    }
  });

  it('always fits the existing name limit', () => {
    for (const adjective of CURATED_ADJECTIVES) {
      for (const noun of CURATED_NOUNS) {
        expect(`${adjective} ${noun}`.length).toBeLessThanOrEqual(MAX_BLOBBI_NAME_LENGTH);
      }
    }
  });
});

describe('composing', () => {
  it('joins two approved words', () => {
    expect(composeCuratedName('Sunny', 'Puff')).toBe('Sunny Puff');
  });

  it('refuses a word that is not approved', () => {
    expect(composeCuratedName('Evil', 'Puff')).toBeNull();
    expect(composeCuratedName('Sunny', 'Telegram')).toBeNull();
  });
});

describe('curated validation', () => {
  it('accepts every combination it can produce', () => {
    for (const adjective of CURATED_ADJECTIVES) {
      for (const noun of CURATED_NOUNS) {
        expect(isCuratedBlobbiName(`${adjective} ${noun}`)).toBe(true);
      }
    }
  });

  it('rejects a clean sentence', () => {
    // THE case. A modified client sends text that passes every filter; only a
    // closed vocabulary refuses it.
    expect(validateCuratedBlobbiName('Hello Friend')).toEqual({
      ok: false,
      reason: 'unapproved-adjective',
    });
    expect(validateCuratedBlobbiName('meet me outside')).toEqual({
      ok: false,
      reason: 'wrong-shape',
    });
    expect(validateCuratedBlobbiName('message me on telegram')).toEqual({
      ok: false,
      reason: 'wrong-shape',
    });
  });

  it('rejects prohibited text', () => {
    expect(validateCuratedBlobbiName('fuck off').ok).toBe(false);
  });

  it('rejects a half-approved pair', () => {
    expect(validateCuratedBlobbiName('Sunny Telegram')).toEqual({
      ok: false,
      reason: 'unapproved-noun',
    });
    expect(validateCuratedBlobbiName('Cool Puff')).toEqual({
      ok: false,
      reason: 'unapproved-adjective',
    });
  });

  it('rejects the words in the wrong order', () => {
    // The grammar is positional; `Puff Sunny` is not a name this can produce.
    expect(validateCuratedBlobbiName('Puff Sunny').ok).toBe(false);
  });

  it.each([
    ['one word', 'Sunny'],
    ['three words', 'Sunny Puff Star'],
    ['double spaced', 'Sunny  Puff'],
    ['newline separated', 'Sunny\nPuff'],
    ['tab separated', 'Sunny\tPuff'],
    ['lowercase', 'sunny puff'],
    ['empty', ''],
    ['whitespace', '   '],
  ])('rejects %s', (_label, value) => {
    expect(isCuratedBlobbiName(value)).toBe(false);
  });

  it('tolerates surrounding whitespace, because a writer trims', () => {
    expect(validateCuratedBlobbiName('  Sunny Puff  ')).toEqual({ ok: true, name: 'Sunny Puff' });
  });

  it.each([[null], [undefined], [42], [{}]])('rejects the non-string %s', (value) => {
    expect(() => validateCuratedBlobbiName(value)).not.toThrow();
    expect(isCuratedBlobbiName(value)).toBe(false);
  });
});

// ── Aliases ────────────────────────────────────────────────────────────────

describe('safe aliases', () => {
  it('is deterministic for a pubkey', () => {
    expect(safeBlobbiAlias(STRANGER)).toBe(safeBlobbiAlias(STRANGER));
  });

  it('differs between pubkeys', () => {
    expect(safeBlobbiAlias(STRANGER)).not.toBe(safeBlobbiAlias(OTHER));
  });

  it('takes no authored input at all', () => {
    // The whole point: the alias is a function of the KEY, so there is no path
    // by which a stranger influences it.
    expect(safeBlobbiAlias(STRANGER)).not.toContain('fuck');
  });

  it('is never prohibited, for any pubkey', () => {
    // The generator's output space is small enough to sample broadly.
    for (let i = 0; i < 500; i += 1) {
      const alias = safeBlobbiAlias(`${i}`.padStart(64, '0'));
      expect(containsProhibitedText(alias), alias).toBe(false);
      expect(alias.length).toBeGreaterThan(0);
      expect(alias.length).toBeLessThanOrEqual(MAX_BLOBBI_NAME_LENGTH);
      expect(alias).toMatch(/^[A-Za-z]+ [A-Za-z]+$/);
    }
  });

  it('has something to say even for an empty key', () => {
    expect(safeBlobbiAlias('')).toBe('Someone');
  });
});

// ── Remote display ─────────────────────────────────────────────────────────

describe('remote names', () => {
  const resolve = (p: IslandSafetyPolicy, authoredName: string | null, screen = false) =>
    resolveRemoteBlobbiDisplayName({
      policy: p,
      pubkey: STRANGER,
      authoredName,
      screenAuthoredText: screen,
    });

  it('shows the authored name where authored names are permitted', () => {
    expect(resolve(STANDARD_POLICY, 'Rocket')).toEqual({ name: 'Rocket', source: 'authored' });
  });

  it('never shows an authored name where they are not — even a clean one', () => {
    // The strong reading of the capability, and the one that matters: a filter
    // would pass "come find me on discord", which is the message that counts.
    expect(resolve(FAMILY_POLICY, 'Rocket')).toEqual({
      name: safeBlobbiAlias(STRANGER),
      source: 'alias',
    });
    expect(resolve(FAMILY_POLICY, 'come find me on discord').source).toBe('alias');
    expect(resolve(FAMILY_POLICY, 'come find me on discord').name).not.toContain('discord');
  });

  it('falls back to the alias for a missing or unusable name', () => {
    for (const value of [null, '', '   ']) {
      expect(resolve(STANDARD_POLICY, value).source).toBe('alias');
    }
  });

  it('leaves Standard alone rather than quietly censoring it', () => {
    // Screening is off by default: this phase does not add a restriction to an
    // existing experience.
    expect(resolve(STANDARD_POLICY, 'fuck you').source).toBe('authored');
  });

  it('substitutes prohibited text when a surface asks to be screened', () => {
    // The explicit middle setting, for a future profile that permits authored
    // names but wants obvious abuse filtered.
    expect(resolve(STANDARD_POLICY, 'fuck you', true).source).toBe('alias');
    expect(resolve(STANDARD_POLICY, 'Rocket', true)).toEqual({
      name: 'Rocket',
      source: 'authored',
    });
  });

  it('follows the capability, never a profile name', () => {
    const mislabelled = policy({ profile: 'family' } as Partial<IslandSafetyPolicy>);
    expect(resolve(mislabelled, 'Rocket').source).toBe('authored');

    const curatedStandard = policy({ strangerAuthoredNames: false });
    expect(resolve(curatedStandard, 'Rocket').source).toBe('alias');
  });

  it('never throws, whatever the authored value is', () => {
    for (const value of ['\u{1F600}', '\uD800', 'a'.repeat(10_000)]) {
      expect(() => resolve(FAMILY_POLICY, value)).not.toThrow();
    }
  });
});

// ── Own naming ─────────────────────────────────────────────────────────────

describe('own naming', () => {
  it('keeps free-text naming exactly as it was', () => {
    expect(admitOwnBlobbiName(STANDARD_POLICY, '  Rocket  ')).toEqual({
      ok: true,
      name: 'Rocket',
    });
  });

  it('does not screen a free-text name against the classifier', () => {
    // Standard's semantics are unchanged by this phase, deliberately.
    expect(admitOwnBlobbiName(STANDARD_POLICY, 'fuck').ok).toBe(true);
  });

  it('applies the existing empty and length rules', () => {
    expect(admitOwnBlobbiName(STANDARD_POLICY, '   ')).toEqual({ ok: false, reason: 'empty' });
    expect(admitOwnBlobbiName(STANDARD_POLICY, 'x'.repeat(33))).toEqual({
      ok: false,
      reason: 'too-long',
    });
  });

  it('accepts an approved combination under curated naming', () => {
    expect(admitOwnBlobbiName(FAMILY_POLICY, 'Sunny Puff')).toEqual({
      ok: true,
      name: 'Sunny Puff',
    });
  });

  it('rejects arbitrary clean text under curated naming', () => {
    expect(admitOwnBlobbiName(FAMILY_POLICY, 'message me on telegram').ok).toBe(false);
    expect(admitOwnBlobbiName(FAMILY_POLICY, 'Hello Friend').ok).toBe(false);
    expect(admitOwnBlobbiName(FAMILY_POLICY, 'Rocket').ok).toBe(false);
  });

  it('rejects prohibited text under curated naming', () => {
    expect(admitOwnBlobbiName(FAMILY_POLICY, 'fuck off').ok).toBe(false);
  });

  it('names the reason it refused, prefixed by which rule applied', () => {
    const result = admitOwnBlobbiName(FAMILY_POLICY, 'Sunny Telegram');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('curated:unapproved-noun');
  });

  it('follows the capability, never a profile name', () => {
    const curatedStandard = policy({ ownFreeTextNaming: false });
    expect(admitOwnBlobbiName(curatedStandard, 'Rocket').ok).toBe(false);
    expect(admitOwnBlobbiName(curatedStandard, 'Sunny Puff').ok).toBe(true);
  });
});
