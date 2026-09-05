/**
 * The DEV-only Adult V2 override through the real display wrapper: applied
 * after the companion is resolved, off by default, V1 untouched, accessories
 * suppressed while it is on, and the movement facing reaching the body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import type { AccessoryPlacementInput } from '@blobbi/renderer';
import { CharacterEquipmentContext } from '@/contexts/CharacterEquipmentContext';
import type { ResolvedBlobbiItemDefinition } from '@/inventory';
import { FIXTURE_IMAGE_URLS as U } from '@/inventory/item-image-fixtures';
import { BLOBBI_VISUAL_GENERATION_STORAGE_KEY } from '@/lib/blobbi-visual-dev';

const COMPANION = {
  id: 'blobbi-v2-probe',
  name: 'Probe',
  stage: 'adult',
  adultType: 'catti',
  baseColor: '#66AA33',
  secondaryColor: '#AADD88',
  eyeColor: '#223344',
};
vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => ({ data: [COMPANION] }) }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({
  useBlobbonautProfile: () => ({ data: { currentCompanion: 'blobbi-v2-probe' } }),
}));
const { CurrentBlobbiDisplay } = await import('./CurrentBlobbiDisplay');

const HAT = '31632:fixture:fixture:accessory:hat';
const WORN: readonly AccessoryPlacementInput[] = [{ code: HAT, slot: 'headwear', x: 50, y: 20, scale: 1, rot: 0, flipX: false }];
const HAT_DEFINITION = {
  address: HAT, itemId: null, d: 'fixture:accessory:hat', name: 'Fixture Hat', type: 'accessory', category: 'unknown',
  effects: {}, action: null, stages: ['egg', 'baby', 'adult'], emoji: '🎩', image: U.primary,
  images: [{ url: U.primary }, { url: U.front, marker: 'front' }, { url: U.back, marker: 'back' }],
  topics: [], slot: 'headwear', forms: null, visualDiagnostics: { slot: 'declared', forms: 'absent' }, source: 'definition',
} satisfies ResolvedBlobbiItemDefinition;

function renderDisplay(props: Partial<React.ComponentProps<typeof CurrentBlobbiDisplay>> = {}) {
  return render(
    <CharacterEquipmentContext.Provider
      value={{
        accessories: [...WORN],
        effects: [],
        activeEffects: [],
        rejectedEffects: [],
        definitionsByAddress: new Map([[HAT, HAT_DEFINITION]]),
        hidden: [],
        warnings: [],
        isLoading: false,
        isEmpty: false,
      }}
    >
      <CurrentBlobbiDisplay idSuffix="v2probe" {...props} />
    </CharacterEquipmentContext.Provider>,
  );
}
const box = (c: HTMLElement) => c.querySelector('[data-blobbi-renderer]') as HTMLElement;
const setQuery = (search: string) => window.history.replaceState({}, '', `${window.location.pathname}${search}`);

beforeEach(() => {
  setQuery('');
  localStorage.removeItem(BLOBBI_VISUAL_GENERATION_STORAGE_KEY);
});
afterEach(() => {
  setQuery('');
  localStorage.removeItem(BLOBBI_VISUAL_GENERATION_STORAGE_KEY);
});

describe('without the override (the default, and production)', () => {
  it('draws V1 with its accessories and effects, and ignores the movement facing', () => {
    const { container } = renderDisplay({ movementFacing: 'left', effectsOverride: [{ id: 'golden-sparkles' }] });
    expect(box(container).dataset.blobbiGeneration).toBe('v1');
    expect(box(container).dataset.blobbiFacing).toBe('front');
    expect(container.querySelector(`[data-accessory-code="${HAT}"]`)).not.toBeNull();
    expect(container.querySelector('[data-blobbi-effect]')).not.toBeNull();
  });
});

describe('with ?blobbiVisualGeneration=v2 in a dev build', () => {
  it('draws the V2 body for the SAME resolved companion, with its trait colours', () => {
    setQuery('?blobbiVisualGeneration=v2');
    const { container } = renderDisplay();
    expect(box(container).dataset.blobbiGeneration).toBe('v2');
    const svg = box(container).querySelector('svg')!;
    expect(svg.getAttribute('data-blobbi-generation')).toBe('v2');
    expect(svg.querySelector('[data-part="body-base"]')).not.toBeNull();
    expect(svg.innerHTML).toContain('stop-color="#66aa33"');
    // The companion itself was not touched: the tooltip still names it.
    expect(box(container).getAttribute('title')).toContain('Probe - adult stage');
  });

  it('turns the body with the movement facing; a rear seat still wins', () => {
    setQuery('?blobbiVisualGeneration=v2');
    const left = renderDisplay({ movementFacing: 'left' });
    expect(box(left.container).dataset.blobbiFacing).toBe('left');
    expect(box(left.container).querySelector('svg [data-blobbi-mirrored]')).not.toBeNull();
    const up = renderDisplay({ movementFacing: 'back' });
    expect(box(up.container).querySelector('svg')!.getAttribute('data-blobbi-view')).toBe('back');
    const seatedBack = renderDisplay({ facing: 'back', movementFacing: 'right' });
    expect(box(seatedBack.container).dataset.blobbiFacing).toBe('back');
  });

  it('suppresses accessories (no V2 anchoring yet) but keeps effects', () => {
    setQuery('?blobbiVisualGeneration=v2');
    const { container } = renderDisplay({ effectsOverride: [{ id: 'golden-sparkles' }] });
    expect(container.querySelector(`[data-accessory-code="${HAT}"]`)).toBeNull();
    expect(container.querySelector('[data-blobbi-effect]')).not.toBeNull();
  });

  it('sleeping closes the V2 eyes', () => {
    setQuery('?blobbiVisualGeneration=v2');
    const { container } = renderDisplay({ isSleeping: true });
    const svg = box(container).querySelector('svg')!;
    expect(svg.querySelectorAll('[data-part$="eye-closed"]')).toHaveLength(2);
    expect(svg.querySelector('[data-part$="eye-inner"]')).toBeNull();
  });

  it('is remembered for the browser and cleared by =v1', () => {
    setQuery('?blobbiVisualGeneration=v2');
    renderDisplay();
    setQuery('');
    expect(box(renderDisplay().container).dataset.blobbiGeneration).toBe('v2');
    setQuery('?blobbiVisualGeneration=v1');
    expect(box(renderDisplay().container).dataset.blobbiGeneration).toBe('v1');
    setQuery('');
    expect(box(renderDisplay().container).dataset.blobbiGeneration).toBe('v1');
  });
});
