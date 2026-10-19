/**
 * A V2 body through the display: the renderer's leg groups are in the
 * markup, its baked ground shadow is not (Island draws the one ground shadow
 * in `BlobbiActor`), and `motion` reaches the renderer as the word it is.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CharacterEquipmentContext } from '@/contexts/CharacterEquipmentContext';

vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => ({ data: [] }) }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({ useBlobbonautProfile: () => ({ data: null }) }));
const { CurrentBlobbiDisplay } = await import('./CurrentBlobbiDisplay');

const V2 = { stage: 'adult' as const, visualGeneration: 'v2' as const, baseColor: '#4F46E5', secondaryColor: '#7C3AED', eyeColor: '#1F2937', name: 'Probe' };
const V1 = { stage: 'adult' as const, visualGeneration: 'v1' as const, adultType: 'catti', baseColor: '#4F46E5', secondaryColor: '#7C3AED', eyeColor: '#1F2937', name: 'Probe' };

function renderDisplay(props: Partial<React.ComponentProps<typeof CurrentBlobbiDisplay>> = {}) {
  return render(
    <CharacterEquipmentContext.Provider value={{ accessories: [], effects: [], activeEffects: [], rejectedEffects: [], definitionsByAddress: new Map(), hidden: [], warnings: [], isLoading: false, isEmpty: true }}>
      <CurrentBlobbiDisplay idSuffix="gait" {...props} />
    </CharacterEquipmentContext.Provider>,
  );
}
const box = (c: HTMLElement) => c.querySelector('[data-blobbi-renderer]') as HTMLElement;
const body = (c: HTMLElement) => c.querySelector('[data-blobbi-body-box]') as HTMLElement;

describe('the V2 gait and the one ground shadow', () => {
  it('a V2 adult carries leg groups and no baked ground shadow; walking is an attribute the renderer animates, not Island markup', () => {
    const { container } = renderDisplay({ visualOverride: V2, movementFacing: 'right', motion: 'walking' });
    expect(box(container).dataset.blobbiGeneration).toBe('v2');
    expect(box(container).dataset.blobbiFacing).toBe('right');
    expect(body(container).dataset.blobbiMotion).toBe('walking');
    expect(container.querySelectorAll('[data-part="near-leg"], [data-part="far-leg"]')).toHaveLength(2);
    expect(container.querySelector('[data-part="ground-shadow"]')).toBeNull();
    expect(container.querySelector('[data-part="body-shadow"]')).not.toBeNull();
    expect(container.querySelector('style[data-blobbi-motion-styles]')?.textContent).toContain('[data-part="near-leg"]');
  });

  it('at rest an adult breathes where it stands (the grounded idle), a baby is still; a V1 adult walking keeps its bob and names no leg', () => {
    // An adult at rest is never `still`: it stands and breathes in place
    // (`blobbi-stage-motion.ts`), the renderer's idle, whose origin is the feet.
    const still = renderDisplay({ visualOverride: V2 });
    expect(body(still.container).dataset.blobbiMotion).toBe('idle');
    // A baby at rest is still: the Island floats it (the actor's bob) instead.
    const baby = renderDisplay({ visualOverride: { ...V2, stage: 'baby' as const } });
    expect(body(baby.container).hasAttribute('data-blobbi-motion')).toBe(false);
    const v1 = renderDisplay({ visualOverride: V1, motion: 'walking' });
    expect(box(v1.container).dataset.blobbiGeneration).toBe('v1');
    expect(body(v1.container).dataset.blobbiMotion).toBe('walking');
    expect(v1.container.querySelector('[data-part$="-leg"]')).toBeNull();
    expect(v1.container.querySelector('[data-part="ground-shadow"]')).toBeNull();
  });
});
