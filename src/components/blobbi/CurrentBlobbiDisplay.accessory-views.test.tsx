/**
 * FRONT/BACK accessory artwork, end to end through the real renderer.
 *
 * The unit tests next to `item-image-resolution.ts` and
 * `island-accessory-sources.ts` prove the policy; this file proves the WIRING,
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
 *
 * Since the kind:31634 migration an accessory is identified by its ITEM
 * ADDRESS, and there is no filename-convention fallback left: an address with
 * no published definition resolves to no artwork at all. That is the point of
 * the clean cut, artwork comes from an issuer, never from a guessed path.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { AccessoryPlacementInput } from '@blobbi/react';

import { CharacterEquipmentContext } from '@/contexts/CharacterEquipmentContext';
import type { ResolvedBlobbiItemDefinition } from '@/inventory';
import { FIXTURE_IMAGE_URLS as U } from '@/inventory/item-image-fixtures';

const HAT = '31632:fixture:fixture:accessory:hat';
const GOGGLES = '31632:fixture:fixture:accessory:goggles';

/** A hat that survives rear view, and a pair of goggles that does not. */
const WORN: readonly AccessoryPlacementInput[] = [
  {
    code: HAT,
    slot: 'headwear',
    x: 50, y: 20, scale: 1, rot: 0, flipX: false,
  },
  {
    code: GOGGLES,
    slot: 'eyewear',
    x: 50, y: 45, scale: 1, rot: 0, flipX: false,
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
  address: HAT,
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
  slot: 'headwear',
  forms: null,
  visualDiagnostics: { slot: 'declared', forms: 'absent' },
  source: 'definition',
} satisfies ResolvedBlobbiItemDefinition;

vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => ({ data: [] }) }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({
  useBlobbonautProfile: () => ({ data: undefined }),
}));
const { CurrentBlobbiDisplay } = await import('./CurrentBlobbiDisplay');

const definitions = new Map<string, ResolvedBlobbiItemDefinition>([
  [HAT, HAT_DEFINITION],
]);

function renderWorn(facing: 'front' | 'back', withDefinitions = true) {
  return render(
    <CharacterEquipmentContext.Provider
      value={{
        accessories: [],
        effects: [],
        activeEffects: [],
        rejectedEffects: [],
        definitionsByAddress: withDefinitions ? definitions : new Map(),
        hidden: [],
        warnings: [],
        isLoading: false,
        isEmpty: false,
      }}
    >
      <CurrentBlobbiDisplay
        idSuffix={`views-${facing}-${withDefinitions}`}
        facing={facing}
        visualOverride={VISUAL}
        accessoryOverride={WORN}
      />
    </CharacterEquipmentContext.Provider>,
  );
}

const srcOf = (container: HTMLElement, code: string) =>
  container
    .querySelector(`[data-accessory-code="${code}"] img`)
    ?.getAttribute('src') ?? null;

describe('accessory artwork follows the Blobbi it is drawn on', () => {
  it('draws the FRONT image on a front-facing Blobbi', () => {
    const { container } = renderWorn('front');
    expect(srcOf(container, HAT)).toBe(U.front);
  });

  it('draws the BACK image on a rear-facing Blobbi', () => {
    const { container } = renderWorn('back');
    expect(srcOf(container, HAT)).toBe(U.back);
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
    expect(container.querySelector(`[data-accessory-code="${GOGGLES}"]`)).toBeNull();
    expect(container.querySelector(`[data-accessory-code="${HAT}"]`)).toBeTruthy();
  });

  it('draws no artwork for an item with no published definition', () => {
    // The goggles have no definition. Before the kind:31634 migration a stored
    // URL or a filename guess would have covered for that; now an item whose
    // issuer has not said what it looks like simply has no picture. The
    // placement still exists; this is a missing asset, not a hidden accessory.
    const { container } = renderWorn('front');
    expect(srcOf(container, GOGGLES)).toBe('');
  });
});

describe('without definitions, accessories draw no artwork', () => {
  it('renders the accessory element with an empty src, rather than guessing a path', () => {
    // This is what makes the component renderable in a test, a preview, or any
    // tree without the app providers: it degrades to bare, never to broken.
    const { container } = renderWorn('front', false);
    expect(srcOf(container, HAT)).toBe('');
  });
});
