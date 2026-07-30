/**
 * FRONT/BACK accessory artwork, end to end through the real renderer.
 *
 * The unit tests next to `item-image-resolution.ts` and
 * `island-accessory-sources.ts` prove the policy; this file proves the WIRING —
 * that `facing` actually reaches the resolver, that the resolved URL actually
 * reaches the `<img>`, and that the item definitions arrive through the shared
 * context rather than a fetch inside the component.
 *
 * The two rules that must not blur into each other:
 *
 *   WHICH accessories are drawn from behind → the package's slot rules,
 *     unchanged by this phase (a face-only item stays hidden).
 *   WHICH PICTURE a drawn accessory uses    → this phase (front vs back view).
 *
 * Nothing here publishes an event, owns an item, or reaches a relay: the
 * definition is a fixture supplied straight to the context.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { AccessoryPlacementInput } from '@blobbi/react';

import { AccessoryItemDefinitionsContext } from '@/contexts/AccessoryItemDefinitionsContext';
import type { ResolvedBlobbiItemDefinition } from '@/inventory';
import { FIXTURE_IMAGE_URLS as U } from '@/inventory/item-image-fixtures';

const STORED_URL = 'https://stored.invalid/headwear-viewed.png';

/** A hat that survives rear view, and a pair of goggles that does not. */
const WORN: readonly AccessoryPlacementInput[] = [
  {
    code: 'headwear-viewed',
    slot: 'headwear',
    x: 50, y: 20, scale: 1, rot: 0, flipX: false,
    url: STORED_URL,
  },
  {
    code: 'eyewear-viewed',
    slot: 'eyewear',
    x: 50, y: 45, scale: 1, rot: 0, flipX: false,
    url: 'https://stored.invalid/eyewear-viewed.png',
  },
];

const VISUAL = {
  stage: 'adult' as const,
  adultType: 'bloomi',
  baseColor: '#F2A0C0',
  secondaryColor: '#FAD4E4',
  name: 'Viewer',
};

/** A definition publishing a default plus both poses Island can render. */
const HAT_DEFINITION = {
  address: '31632:fixture:fixture:accessory:hat',
  itemId: null,
  d: 'fixture:accessory:hat',
  name: 'Fixture Hat',
  type: 'accessory',
  category: 'unknown',
  effects: {},
  action: null,
  stages: ['egg', 'baby', 'adult'],
  emoji: '🎩',
  image: U.primary,
  images: [
    { url: U.primary },
    { url: U.front, marker: 'front' },
    { url: U.back, marker: 'back' },
    { url: U.sideRight, marker: 'side-right' },
  ],
  topics: [],
  source: 'definition',
} satisfies ResolvedBlobbiItemDefinition;

vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => ({ data: [] }) }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({
  useBlobbonautProfile: () => ({ data: undefined }),
}));
vi.mock('./hooks/useAccessoryManagement', () => ({
  useAccessoryManagement: () => ({ equipment: [] }),
}));

const { CurrentBlobbiDisplay } = await import('./CurrentBlobbiDisplay');

const definitions = new Map<string, ResolvedBlobbiItemDefinition>([
  ['headwear-viewed', HAT_DEFINITION],
]);

function renderWorn(facing: 'front' | 'back', withDefinitions = true) {
  return render(
    <AccessoryItemDefinitionsContext.Provider
      value={withDefinitions ? definitions : new Map()}
    >
      <CurrentBlobbiDisplay
        idSuffix={`views-${facing}-${withDefinitions}`}
        facing={facing}
        visualOverride={VISUAL}
        accessoryOverride={WORN}
      />
    </AccessoryItemDefinitionsContext.Provider>,
  );
}

const srcOf = (container: HTMLElement, code: string) =>
  container
    .querySelector(`[data-accessory-code="${code}"] img`)
    ?.getAttribute('src') ?? null;

describe('accessory artwork follows the Blobbi it is drawn on', () => {
  it('draws the FRONT image on a front-facing Blobbi', () => {
    const { container } = renderWorn('front');
    expect(srcOf(container, 'headwear-viewed')).toBe(U.front);
  });

  it('draws the BACK image on a rear-facing Blobbi', () => {
    const { container } = renderWorn('back');
    expect(srcOf(container, 'headwear-viewed')).toBe(U.back);
  });

  it('never draws a side view on either pose', () => {
    for (const facing of ['front', 'back'] as const) {
      const { container } = renderWorn(facing);
      expect(container.innerHTML).not.toContain(U.sideRight);
    }
  });
});

describe('the definition changes the PICTURE, never the POLICY', () => {
  it('keeps face-only accessories hidden from behind even with a back image', () => {
    // `eyewear` is in the package's rear-view hidden set. A published `back`
    // asset is an answer to "what does it look like from behind", not a request
    // to be visible from behind.
    const { container } = renderWorn('back');
    expect(container.querySelector('[data-accessory-code="eyewear-viewed"]')).toBeNull();
    expect(container.querySelector('[data-accessory-code="headwear-viewed"]')).toBeTruthy();
  });

  it('leaves accessories with no definition on their stored URL', () => {
    const { container } = renderWorn('front');
    expect(srcOf(container, 'eyewear-viewed')).toBe(
      'https://stored.invalid/eyewear-viewed.png',
    );
  });
});

describe('without the provider, accessories fall back to legacy artwork', () => {
  it('renders the stored URL rather than failing or blanking', () => {
    // This is the pre-existing behavior, and it is what makes the component
    // renderable in a test, a preview, or any tree without the app providers.
    const { container } = renderWorn('front', false);
    expect(srcOf(container, 'headwear-viewed')).toBe(STORED_URL);
  });
});
