import { describe, it, expect } from 'vitest';
import { toTitleCaseFromKebab, nameFromDTag, displayNameFromId } from './blobbi-name';

describe('blobbi-name utilities', () => {
  describe('toTitleCaseFromKebab', () => {
    it('should convert single word to Title Case', () => {
      expect(toTitleCaseFromKebab('pel')).toBe('Pel');
      expect(toTitleCaseFromKebab('foo')).toBe('Foo');
    });

    it('should convert kebab-case to Title Case with spaces', () => {
      expect(toTitleCaseFromKebab('foo-bar')).toBe('Foo Bar');
      expect(toTitleCaseFromKebab('blobbi-pel')).toBe('Blobbi Pel');
      expect(toTitleCaseFromKebab('hello-world-test')).toBe('Hello World Test');
    });

    it('should handle empty strings', () => {
      expect(toTitleCaseFromKebab('')).toBeUndefined();
      expect(toTitleCaseFromKebab(undefined)).toBeUndefined();
    });

    it('should handle multiple dashes', () => {
      expect(toTitleCaseFromKebab('foo-bar-baz')).toBe('Foo Bar Baz');
      expect(toTitleCaseFromKebab('a-b-c-d')).toBe('A B C D');
    });

    it('should filter out empty segments', () => {
      expect(toTitleCaseFromKebab('foo--bar')).toBe('Foo Bar');
      expect(toTitleCaseFromKebab('-foo-bar-')).toBe('Foo Bar');
    });
  });

  describe('nameFromDTag', () => {
    it('should extract name after first dash', () => {
      expect(nameFromDTag('blobbi-pel')).toBe('Pel');
      expect(nameFromDTag('blobbi-foo-bar')).toBe('Foo Bar');
    });

    it('should handle prefix without dash', () => {
      expect(nameFromDTag('blobbi')).toBeUndefined();
      expect(nameFromDTag('pel')).toBeUndefined();
    });

    it('should handle dash at end', () => {
      expect(nameFromDTag('blobbi-')).toBeUndefined();
      expect(nameFromDTag('foo-')).toBeUndefined();
    });

    it('should handle empty strings', () => {
      expect(nameFromDTag('')).toBeUndefined();
      expect(nameFromDTag(undefined)).toBeUndefined();
    });

    it('should handle complex d tags', () => {
      expect(nameFromDTag('blobbi-foo-bar-baz')).toBe('Foo Bar Baz');
      expect(nameFromDTag('pet-my-awesome-creature')).toBe('My Awesome Creature');
    });
  });

  describe('displayNameFromId', () => {
    it('should work the same as nameFromDTag', () => {
      expect(displayNameFromId('blobbi-pel')).toBe('Pel');
      expect(displayNameFromId('blobbi-foo-bar')).toBe('Foo Bar');
      expect(displayNameFromId('pet-my-creature')).toBe('My Creature');
    });

    it('should handle the same edge cases as nameFromDTag', () => {
      expect(displayNameFromId('')).toBeUndefined();
      expect(displayNameFromId(undefined)).toBeUndefined();
      expect(displayNameFromId('blobbi')).toBeUndefined();
      expect(displayNameFromId('blobbi-')).toBeUndefined();
    });
  });

  describe('acceptance criteria examples', () => {
    it('should convert blobbi-pel to Pel', () => {
      expect(nameFromDTag('blobbi-pel')).toBe('Pel');
    });

    it('should convert blobbi-foo-bar to Foo Bar', () => {
      expect(nameFromDTag('blobbi-foo-bar')).toBe('Foo Bar');
    });

    it('should convert multi-segment blobbi-foo-bar-baz to Foo Bar Baz', () => {
      expect(nameFromDTag('blobbi-foo-bar-baz')).toBe('Foo Bar Baz');
    });
  });
});