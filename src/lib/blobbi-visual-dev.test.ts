/**
 * The DEV-only V2 override: off by default, off in production by construction,
 * applied after parsing, and structurally unable to reach an event.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyDevVisualGeneration,
  parseDevVisualGenerationValue,
  readDevVisualGenerationOverride,
  BLOBBI_VISUAL_GENERATION_STORAGE_KEY,
  type DevVisualGenerationEnvironment,
} from './blobbi-visual-dev';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}
const env = (over: Partial<DevVisualGenerationEnvironment>): DevVisualGenerationEnvironment => ({
  dev: true,
  search: '',
  storage: null,
  ...over,
});

describe('parsing is strict', () => {
  it.each([
    ['v2', 'v2'], ['v1', 'v1'], ['V2', null], ['2', null], ['true', null], ['', null], [null, null], [undefined, null],
  ] as const)('%j → %j', (value, expected) => {
    expect(parseDevVisualGenerationValue(value)).toBe(expected);
  });
});

describe('readDevVisualGenerationOverride', () => {
  it('is null with no query and no stored flag: the default is production behaviour', () => {
    expect(readDevVisualGenerationOverride(env({ storage: memoryStorage() }))).toBeNull();
    expect(readDevVisualGenerationOverride(env({}))).toBeNull();
  });

  it('is ALWAYS null outside a dev build, whatever the query or storage say', () => {
    const storage = memoryStorage({ [BLOBBI_VISUAL_GENERATION_STORAGE_KEY]: 'v2' });
    expect(readDevVisualGenerationOverride(env({ dev: false, search: '?blobbiVisualGeneration=v2', storage }))).toBeNull();
    // And it did not even touch storage.
    expect(storage.map.size).toBe(1);
  });

  it('?blobbiVisualGeneration=v2 turns it on and remembers it', () => {
    const storage = memoryStorage();
    expect(readDevVisualGenerationOverride(env({ search: '?x=1&blobbiVisualGeneration=v2', storage }))).toBe('v2');
    expect(storage.getItem(BLOBBI_VISUAL_GENERATION_STORAGE_KEY)).toBe('v2');
  });

  it('?blobbiVisualGeneration=v1 turns it off and forgets it', () => {
    const storage = memoryStorage({ [BLOBBI_VISUAL_GENERATION_STORAGE_KEY]: 'v2' });
    expect(readDevVisualGenerationOverride(env({ search: '?blobbiVisualGeneration=v1', storage }))).toBeNull();
    expect(storage.getItem(BLOBBI_VISUAL_GENERATION_STORAGE_KEY)).toBeNull();
  });

  it('the remembered flag applies on a later load without the query', () => {
    const storage = memoryStorage({ [BLOBBI_VISUAL_GENERATION_STORAGE_KEY]: 'v2' });
    expect(readDevVisualGenerationOverride(env({ storage }))).toBe('v2');
  });

  it('a garbage query value neither turns it on nor clears the memory', () => {
    const storage = memoryStorage({ [BLOBBI_VISUAL_GENERATION_STORAGE_KEY]: 'v2' });
    expect(readDevVisualGenerationOverride(env({ search: '?blobbiVisualGeneration=yes', storage }))).toBe('v2');
    expect(readDevVisualGenerationOverride(env({ search: '?blobbiVisualGeneration=yes', storage: memoryStorage() }))).toBeNull();
  });

  it('works without any storage (private mode)', () => {
    expect(readDevVisualGenerationOverride(env({ search: '?blobbiVisualGeneration=v2', storage: null }))).toBe('v2');
  });
});

describe('applyDevVisualGeneration', () => {
  const visual = { stage: 'adult' as const, adultType: 'catti', baseColor: '#F2A0C0', secondaryColor: '#FAD4E4', eyeColor: '#222222', name: 'Puck' };

  it('returns the SAME object with no override: the production path is untouched', () => {
    expect(applyDevVisualGeneration(visual, null)).toBe(visual);
  });

  it('copies the visual with visualGeneration v2, mutating nothing', () => {
    const before = JSON.stringify(visual);
    const out = applyDevVisualGeneration(visual, 'v2');
    expect(out).not.toBe(visual);
    expect(out).toEqual({ ...visual, visualGeneration: 'v2' });
    expect(JSON.stringify(visual)).toBe(before);
    expect('visualGeneration' in visual).toBe(false);
  });

  it('leaves a visual that is already v2 alone', () => {
    const v2 = { ...visual, visualGeneration: 'v2' as const };
    expect(applyDevVisualGeneration(v2, 'v2')).toBe(v2);
  });
});

describe('the override is presentation only, by import graph', () => {
  it('imports nothing but React and the renderer types: no publisher, signer, relay, query or parser', () => {
    // Code only: the module's doc comment legitimately names what it must not touch.
    const source = readFileSync(join(__dirname, 'blobbi-visual-dev.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specifiers.sort()).toEqual(['@blobbi-kit/renderer', 'react']);
    expect(source).not.toMatch(/useNostrPublish|mutateAsync|signEvent|NostrEvent|31124|visual_generation|useBlobbis|parseBlobbi/);
  });
});
