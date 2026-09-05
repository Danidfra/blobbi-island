/**
 * visual_generation, end to end through Island's real production path:
 *
 *   kind 31124 event → validatePetStateEvent / parsePetState (Island parser,
 *   reading the tag with @blobbi-kit/core's canonical semantics)
 *   → petStateToLegacyBlobbi (the collection object every surface uses)
 *   → CurrentBlobbiDisplay (the in-world actor's display wrapper)
 *   → @blobbi-kit/renderer (V1 or V2 canonical artwork).
 *
 * No dev override is involved here: the query string is empty and the
 * dev-only storage flag is cleared, so whatever generation the DOM shows came
 * from the event alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { KIND_BLOBBI_STATE, BLOBBI_ECOSYSTEM_NAMESPACE, getCanonicalBlobbiD, deriveBlobbiSeedV1 } from '@blobbi-kit/core';
import { parsePetState, validatePetStateEvent } from '@/lib/blobbi-parsers';
import { petStateToLegacyBlobbi, type Blobbi } from '@/hooks/useBlobbis';
import { BLOBBI_VISUAL_GENERATION_STORAGE_KEY } from '@/lib/blobbi-visual-dev';

const PUBKEY = 'c'.repeat(64);
const D = getCanonicalBlobbiD(PUBKEY, '0123456789');

/** A realistic adult kind 31124 as Island publishes it, plus the tags under test. */
function event(extra: string[][]): NostrEvent {
  const createdAt = 1_700_000_000;
  return {
    id: 'e'.repeat(64), pubkey: PUBKEY, created_at: createdAt, kind: KIND_BLOBBI_STATE, content: '', sig: 'f'.repeat(128),
    tags: [
      ['d', D], ['b', BLOBBI_ECOSYSTEM_NAMESPACE], ['name', 'Probe'], ['seed', deriveBlobbiSeedV1(PUBKEY, D, createdAt)],
      ['stage', 'adult'], ['state', 'active'], ['adult_type', 'catti'], ['breeding_ready', 'false'], ['generation', '1'],
      ['hunger', '80'], ['happiness', '80'], ['health', '80'], ['hygiene', '80'], ['energy', '80'],
      ['experience', '120'], ['care_streak', '3'], ['last_interaction', String(createdAt)],
      ['base_color', '#66AA33'], ['secondary_color', '#AADD88'], ['eye_color', '#223344'],
      ['client', 'blobbi'],
      ...extra,
    ],
  };
}

/** The collection object the world derives from the event. */
function collectionEntry(extra: string[][]): Blobbi {
  const ev = event(extra);
  expect(validatePetStateEvent(ev)).toBe(true);
  return petStateToLegacyBlobbi(parsePetState(ev)!);
}

// The display wrapper reads the collection and the profile through these hooks;
// the mocks are fed the object derived above, so the parser is exercised for real.
let current: Blobbi;
vi.mock('@/hooks/useBlobbis', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useBlobbis')>('@/hooks/useBlobbis');
  return { ...actual, useBlobbis: () => ({ data: [current] }) };
});
vi.mock('@/hooks/useBlobbonautProfile', () => ({ useBlobbonautProfile: () => ({ data: { currentCompanion: D } }) }));
const { CurrentBlobbiDisplay } = await import('./CurrentBlobbiDisplay');

const box = (c: HTMLElement) => c.querySelector('[data-blobbi-renderer]') as HTMLElement;
const svg = (c: HTMLElement) => c.querySelector('[data-blobbi-renderer] svg') as SVGSVGElement;

beforeEach(() => {
  window.history.replaceState({}, '', window.location.pathname);
  localStorage.removeItem(BLOBBI_VISUAL_GENERATION_STORAGE_KEY);
});

describe('the event decides the artwork generation', () => {
  it.each([
    ['no visual_generation tag', [], 'v1'],
    ['visual_generation = v1', [['visual_generation', 'v1']], 'v1'],
    ['visual_generation = future (unknown)', [['visual_generation', 'future']], 'v1'],
  ] as const)('%s → the actor draws V1 catti', (_label, extra, expected) => {
    current = collectionEntry(extra.map((tag) => [...tag]));
    expect(current.visualGeneration).toBe(expected);
    const { container } = render(<CurrentBlobbiDisplay idSuffix="vg" />);
    expect(box(container).dataset.blobbiGeneration).toBe('v1');
    expect(svg(container).getAttribute('data-blobbi-generation')).toBeNull();
    expect(svg(container).innerHTML).toContain('cattiBody3D');
    expect(svg(container).querySelector('[data-part]')).toBeNull();
  });

  it('visual_generation = v2 → the actor draws the canonical V2 anatomy, with the event colours', () => {
    current = collectionEntry([['visual_generation', 'v2']]);
    expect(current.visualGeneration).toBe('v2');
    const { container } = render(<CurrentBlobbiDisplay idSuffix="vg2" facing="front" />);
    expect(box(container).dataset.blobbiGeneration).toBe('v2');
    expect(svg(container).getAttribute('data-blobbi-generation')).toBe('v2');
    expect(svg(container).querySelector('[data-part="body-base"]')).not.toBeNull();
    expect(svg(container).innerHTML.toLowerCase()).toContain('#66aa33');
    // The form is carried with the identity but V2 is one anatomy: no V1 form artwork.
    expect(svg(container).innerHTML).not.toContain('cattiBody3D');
    // Movement-driven facing works on a REAL V2 Blobbi too, not only under the dev override.
    const left = render(<CurrentBlobbiDisplay idSuffix="vg2l" movementFacing="left" />);
    expect(box(left.container).dataset.blobbiFacing).toBe('left');
    expect(svg(left.container).querySelector('[data-blobbi-mirrored]')).not.toBeNull();
  });

  it('a real V2 Blobbi keeps its accessories: the accessory gate is the DEV override, not the generation', () => {
    // Documented decision (docs/blobbi-visual-v2-dev-override.md): only the
    // debug override suppresses accessories; production identity does not.
    current = collectionEntry([['visual_generation', 'v2']]);
    const { container } = render(<CurrentBlobbiDisplay idSuffix="vg2a" />);
    expect(box(container).dataset.blobbiGeneration).toBe('v2');
  });
});
