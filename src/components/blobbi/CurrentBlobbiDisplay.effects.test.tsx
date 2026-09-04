/**
 * ACTIVE VISUAL EFFECTS, end to end through the real renderer (Phase 9).
 *
 * The pure resolver's tests prove which effects become active; this file
 * proves the WIRING; that the resolved effects arrive from the shared
 * equipment context, reach `BlobbiRendererView.effects`, and obey the
 * ownership table:
 *
 *   local companion              → context effects
 *   local companion + override   → exactly the override (preview)
 *   visualOverride, no override  → no effects (honest unknown)
 *   visualOverride + override    → exactly the override
 *
 * Nothing here publishes, owns or fetches anything: the context value is a
 * fixture, exactly like the accessory-views test beside this one.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { BlobbiVisualEffect } from '@blobbi/react';

import { CharacterEquipmentContext } from '@/contexts/CharacterEquipmentContext';
import { NO_CHARACTER_EQUIPMENT } from '@/contexts/CharacterEquipmentContext';

const COMPANION = {
  id: 'blobbi-fx-1',
  name: 'Fixture',
  stage: 'adult',
  adultType: 'bloomi',
  baseColor: '#F2A0C0',
  secondaryColor: '#FAD4E4',
  eyeColor: '#222222',
};

vi.mock('@/hooks/useBlobbis', () => ({
  useBlobbis: () => ({ data: [COMPANION] }),
}));
vi.mock('@/hooks/useBlobbonautProfile', () => ({
  useBlobbonautProfile: () => ({ data: { currentCompanion: 'blobbi-fx-1' } }),
}));
const { CurrentBlobbiDisplay } = await import('./CurrentBlobbiDisplay');

const ACTIVE: readonly BlobbiVisualEffect[] = [{ id: 'celestial-aura' }];

function equipmentWith(effects: readonly BlobbiVisualEffect[]) {
  return { ...NO_CHARACTER_EQUIPMENT, effects };
}

function effectIds(container: HTMLElement): string[] {
  // One effect renders in more than one layer group (behind/in front of the
  // body), so the DOM carries the marker several times per effect, the
  // DISTINCT ids are what identify which effects are drawn.
  return [
    ...new Set(
      [...container.querySelectorAll('[data-blobbi-effect]')].map(
        (el) => el.getAttribute('data-blobbi-effect') ?? '',
      ),
    ),
  ];
}

describe('local companion path', () => {
  it('renders the persisted active effects from the shared context', () => {
    const { container } = render(
      <CharacterEquipmentContext.Provider value={equipmentWith(ACTIVE)}>
        <CurrentBlobbiDisplay />
      </CharacterEquipmentContext.Provider>,
    );
    expect(effectIds(container)).toEqual(['celestial-aura']);
  });

  it('renders NO effect elements when nothing is active (Phase-8 baseline shape)', () => {
    const { container } = render(
      <CharacterEquipmentContext.Provider value={equipmentWith([])}>
        <CurrentBlobbiDisplay />
      </CharacterEquipmentContext.Provider>,
    );
    expect(container.querySelectorAll('[data-blobbi-effect]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-blobbi-effect-layer]')).toHaveLength(0);
  });

  it('an effectsOverride replaces the persisted effects, the preview path', () => {
    const { container } = render(
      <CharacterEquipmentContext.Provider value={equipmentWith(ACTIVE)}>
        <CurrentBlobbiDisplay effectsOverride={[{ id: 'mystic-fog' }]} />
      </CharacterEquipmentContext.Provider>,
    );
    expect(effectIds(container)).toEqual(['mystic-fog']);
  });

  it('an explicit empty effectsOverride means "preview with no effects"', () => {
    const { container } = render(
      <CharacterEquipmentContext.Provider value={equipmentWith(ACTIVE)}>
        <CurrentBlobbiDisplay effectsOverride={[]} />
      </CharacterEquipmentContext.Provider>,
    );
    expect(effectIds(container)).toEqual([]);
  });

  it('a bare-Blobbi render (showAccessories=false) draws no effects either', () => {
    const { container } = render(
      <CharacterEquipmentContext.Provider value={equipmentWith(ACTIVE)}>
        <CurrentBlobbiDisplay showAccessories={false} />
      </CharacterEquipmentContext.Provider>,
    );
    expect(effectIds(container)).toEqual([]);
  });
});

describe('visualOverride path: effects follow the visual, never the viewer', () => {
  const OVERRIDE_VISUAL = {
    stage: 'adult' as const,
    adultType: 'catti',
    baseColor: '#88CCEE',
    secondaryColor: '#BBE5F5',
    name: 'Remote',
  };

  it('draws NO effects for an override visual unless explicitly supplied', () => {
    // The local player's active aura must not appear on a preview of someone
    // else's Blobbi: same rule as accessories since Phase 5.
    const { container } = render(
      <CharacterEquipmentContext.Provider value={equipmentWith(ACTIVE)}>
        <CurrentBlobbiDisplay visualOverride={OVERRIDE_VISUAL} />
      </CharacterEquipmentContext.Provider>,
    );
    expect(effectIds(container)).toEqual([]);
  });

  it('draws exactly the supplied effectsOverride on an override visual', () => {
    const { container } = render(
      <CharacterEquipmentContext.Provider value={equipmentWith(ACTIVE)}>
        <CurrentBlobbiDisplay
          visualOverride={OVERRIDE_VISUAL}
          effectsOverride={[{ id: 'pixel-glitch' }]}
        />
      </CharacterEquipmentContext.Provider>,
    );
    expect(effectIds(container)).toEqual(['pixel-glitch']);
  });
});

describe('accessories and effects coexist', () => {
  it('an accessory and an active effect render together', () => {
    const equipment = {
      ...NO_CHARACTER_EQUIPMENT,
      accessories: [
        {
          code: '31632:fixture:fixture:accessory:hat',
          slot: 'headwear' as const,
          x: 50, y: 20, scale: 1, rot: 0, flipX: false,
          url: 'https://example.com/hat.png',
        },
      ],
      effects: ACTIVE,
    };
    const { container } = render(
      <CharacterEquipmentContext.Provider value={equipment}>
        <CurrentBlobbiDisplay />
      </CharacterEquipmentContext.Provider>,
    );
    expect(effectIds(container)).toEqual(['celestial-aura']);
    expect(
      container.querySelectorAll('[data-accessory-layer-group]').length,
    ).toBeGreaterThan(0);
  });
});
