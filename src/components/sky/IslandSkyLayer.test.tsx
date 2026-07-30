/**
 * The sky's structural invariants, in a real DOM.
 *
 * The timing and colour maths are covered by `src/lib/island-sky.test.ts`. What
 * needs a DOM is the set of promises the sky makes to the rest of the world:
 * that it renders **behind** the location artwork, that it is above the players
 * only for the one capped veil, that it cannot receive input, and that a location
 * without sky support is left completely alone. Those are properties of the
 * rendered tree, and getting one of them wrong would break movement or hide the
 * Blobbi rather than merely look wrong.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import { LocationContext } from '@/contexts/LocationContextValue';
import type { LocationId } from '@/lib/location-types';
import { PlaceBackground } from '@/components/blobbi/PlaceBackground';
import {
  ISLAND_SKY_DEV_DEFAULTS,
  islandSkyDevCloudOverride,
  setIslandSkyDev,
  __resetIslandSkyDevStoreForTests,
} from '@/lib/island-sky-dev';
import { ISLAND_CLOUD_ACTORS } from '@/lib/island-sky-clouds';
import { getLocationSkyConfig, skyEnabledLocations } from '@/lib/island-sky-locations';
import {
  ISLAND_CLOUD_SHAPES,
  ISLAND_CLOUD_SHAPE_GEOMETRY,
  ISLAND_CLOUD_SIZES,
} from '@/lib/island-sky-cloud-shapes';
import { WORLD_WIDTH } from '@/lib/world-coordinates';
import { IslandSkyLayer } from './IslandSkyLayer';
import { IslandWorldLight } from './IslandWorldLight';

afterEach(() => {
  cleanup();
  // The DEV store is module-level, so one test's overrides would otherwise leak.
  __resetIslandSkyDevStoreForTests();
});

describe('IslandSkyLayer', () => {
  it('renders for a sky location and nothing at all for an interior', () => {
    const { container: outdoor } = render(<IslandSkyLayer location="town" />);
    expect(outdoor.firstChild).not.toBeNull();

    const { container: indoor } = render(<IslandSkyLayer location="home" />);
    expect(indoor.firstChild).toBeNull();
  });

  it('is hidden from assistive technology', () => {
    const { container } = render(<IslandSkyLayer location="plaza" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('opts out of pointer events, so it can never intercept world input', () => {
    // The one place a class name is the assertion, because the class IS the
    // mechanism: click-to-move, dragging and hover all reach the world through
    // this element's box.
    const { container } = render(<IslandSkyLayer location="town" />);
    expect(container.firstElementChild?.className).toContain('pointer-events-none');
  });

  it('contains nothing focusable, clickable or interactive', () => {
    const { container } = render(<IslandSkyLayer location="beach" />);
    expect(
      container.querySelectorAll('button, a, input, select, textarea, [tabindex], [role], [onclick]'),
    ).toHaveLength(0);
  });

  it('never claims the world surface', () => {
    // `data-world-surface` is what click-to-move looks for. A decorative layer
    // carrying it would make the sky a movement target.
    const { container } = render(<IslandSkyLayer location="town" />);
    expect(container.querySelectorAll('[data-world-surface]')).toHaveLength(0);
  });

  it('stays lightweight rather than drawing one node per star or puff', () => {
    // Stars are CSS gradients inside two elements; each cloud is one small SVG.
    // A regression to per-star or per-puff DOM nodes would show up here long
    // before it showed up on a phone. Worst case today is ~37 elements: root, ten
    // gradient layers, three star nodes, sun, moon, and three clouds of six.
    const { container } = render(<IslandSkyLayer location="town" />);
    expect(container.querySelectorAll('*').length).toBeLessThan(42);
  });

  it('renders exactly three cloud actors, never a tiled band', () => {
    const { container } = render(<IslandSkyLayer location="town" />);
    expect(container.querySelectorAll('[data-island-cloud]')).toHaveLength(3);
    // The band model is what produced the repeated-puff blanket and the sliced
    // shapes; nothing may reintroduce it.
    expect(container.querySelectorAll('.island-sky-cloud-band')).toHaveLength(0);
  });

  it('gives each cloud one self-contained shape', () => {
    const { container } = render(<IslandSkyLayer location="town" />);
    for (const actor of Array.from(container.querySelectorAll('[data-island-cloud]'))) {
      // One connected silhouette per actor, not a scatter of unrelated circles.
      expect(actor.querySelectorAll('svg')).toHaveLength(1);
      // …and nothing may clip it: a wrapper smaller than its own contents is
      // exactly what made the old clouds look permanently cut.
      expect((actor as HTMLElement).className).not.toContain('overflow-hidden');
      expect(actor.querySelectorAll('.overflow-hidden')).toHaveLength(0);
    }
  });

  it('sends two clouds one way and one the other', () => {
    const { container } = render(<IslandSkyLayer location="town" />);
    const directions = Array.from(container.querySelectorAll('[data-island-cloud-direction]')).map(
      (el) => el.getAttribute('data-island-cloud-direction'),
    );
    expect(directions.filter((d) => d === 'rightToLeft')).toHaveLength(2);
    expect(directions.filter((d) => d === 'leftToRight')).toHaveLength(1);
  });

  it('staggers the actors instead of launching them together', () => {
    const { container } = render(<IslandSkyLayer location="town" />);
    const actors = Array.from(
      container.querySelectorAll<HTMLElement>('[data-island-cloud]'),
    );
    const delays = actors.map((el) => el.style.animationDelay);
    const durations = actors.map((el) => el.style.animationDuration);
    // Negative delays start each mid-cycle; distinct durations keep them from
    // lining up again.
    expect(delays.every((d) => d.startsWith('-'))).toBe(true);
    expect(new Set(delays).size).toBe(3);
    expect(new Set(durations).size).toBe(3);
  });

  it('carries a resting position for when travel is switched off', () => {
    // With the animation disabled the actor falls back to its own transform, so
    // reduced motion must not leave all three stacked at the origin.
    const { container } = render(<IslandSkyLayer location="town" />);
    const rests = Array.from(container.querySelectorAll<HTMLElement>('[data-island-cloud]')).map(
      (el) => el.style.transform,
    );
    expect(rests.every((t) => /translate3d\(\d/.test(t))).toBe(true);
    expect(new Set(rests).size).toBe(3);
  });

  it('flags reduced motion on the root, which is what the CSS keys on', () => {
    const { container: normal } = render(<IslandSkyLayer location="town" />);
    expect(normal.firstElementChild).toHaveAttribute(
      'data-island-sky-reduced-motion',
      'false',
    );
    cleanup();

    setIslandSkyDev({ simulateReducedMotion: true });
    const { container: reduced } = render(<IslandSkyLayer location="town" />);
    expect(reduced.firstElementChild).toHaveAttribute(
      'data-island-sky-reduced-motion',
      'true',
    );
  });

  it('draws clouds for every scene whose config asks for them', () => {
    // Every enabled scene now has a real transparent sky, so all six get clouds.
    // `back-yard` had them off while its sky was still painted into the artwork;
    // this is driven by the config rather than a hardcoded scene either way.
    for (const location of skyEnabledLocations()) {
      const { container } = render(<IslandSkyLayer location={location} />);
      const expected = getLocationSkyConfig(location).showClouds ? 3 : 0;
      expect(container.querySelectorAll('[data-island-cloud]'), location).toHaveLength(expected);
      cleanup();
    }
  });

  it('draws no clouds for a location without sky support', () => {
    const { container } = render(<IslandSkyLayer location="home" />);
    expect(container.querySelectorAll('[data-island-cloud]')).toHaveLength(0);
  });

  it('drops the clouds when the DEV harness turns them off', () => {
    setIslandSkyDev({ cloudsEnabled: false });
    const { container } = render(<IslandSkyLayer location="town" />);
    expect(container.querySelectorAll('[data-island-cloud]')).toHaveLength(0);
  });
});

describe('IslandWorldLight', () => {
  it('renders a non-interactive veil for sky locations only', () => {
    const { container: outdoor } = render(<IslandWorldLight location="town" />);
    expect(outdoor.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(outdoor.firstElementChild?.className).toContain('pointer-events-none');
    expect(outdoor.querySelectorAll('[data-world-surface]')).toHaveLength(0);

    const { container: indoor } = render(<IslandWorldLight location="stage" />);
    expect(indoor.firstChild).toBeNull();
  });

  it('keeps its alpha inside the readability budget', () => {
    // Parsed from the rendered rgba() rather than from the model, so this covers
    // the component's own arithmetic (state × per-location strength).
    const { container } = render(<IslandWorldLight location="town" />);
    const background = (container.firstElementChild as HTMLElement).style.backgroundColor;
    const alpha = Number.parseFloat(/rgba\([^)]*,\s*([\d.]+)\)/.exec(background)?.[1] ?? '0');
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThanOrEqual(0.14);
  });
});

describe('composition inside PlaceBackground', () => {
  /**
   * `TestApp`'s login provider renders `null` until it has read stored logins, so
   * the world tree only appears after that effect — hence the `await`. Returns the
   * scaled world box, whose direct children are the paint order under test.
   */
  async function renderWorld(location: LocationId = 'town') {
    // The context is supplied directly rather than through LocationProvider so a
    // location can be chosen without driving the provider's 500 ms scene fade.
    const view = render(
      <TestApp>
        <LocationContext.Provider
          value={{
            currentLocation: location,
            setCurrentLocation: () => {},
            previousLocation: null,
            isMapModalOpen: false,
            setIsMapModalOpen: () => {},
            isTransitioning: false,
          }}
        >
          <PlaceBackground>
            <div data-testid="world-child">world</div>
          </PlaceBackground>
        </LocationContext.Provider>
      </TestApp>,
    );
    const surface = await view.findByTestId('world-child');
    const world = surface.closest('[data-world-surface]')!.parentElement!;
    return { ...view, world, layers: Array.from(world.children) };
  }

  it('paints the sky BEHIND the location artwork', async () => {
    // The whole feature depends on this order: the artwork composites its
    // transparent sky region against whatever is painted earlier in the same
    // stacking context.
    const { layers } = await renderWorld();

    const skyIndex = layers.findIndex((el) => el.querySelector('[data-island-cloud]'));
    const artworkIndex = layers.findIndex((el) => el.tagName === 'IMG');

    expect(skyIndex).toBeGreaterThanOrEqual(0);
    expect(artworkIndex).toBeGreaterThan(skyIndex);
  });

  it('grades world sprites from the same value as the plate', async () => {
    // The bright-shrub bug: only the plate was graded, so at night the sprites
    // standing on it stayed at full brightness. One custom property, published
    // beside the plate's own filter, is the whole fix.
    const { container, world } = await renderWorld();
    const surface = container.querySelector<HTMLElement>('[data-world-surface]')!;
    const plate = Array.from(world.querySelectorAll('img')).find((img) =>
      img.alt.includes('background'),
    )!;

    expect(surface).toHaveAttribute('data-island-world-graded');
    expect(surface.style.getPropertyValue('--island-world-grade')).toBe(plate.style.filter);
    expect(surface.style.getPropertyValue('--island-world-grade')).toMatch(
      /brightness\([\d.]+\) saturate\([\d.]+\)/,
    );
  });

  it('publishes the grade WITHOUT adding a wrapper around the world content', async () => {
    // A `filter` on a wrapper would create a stacking context and flatten this
    // layer's z-indexes — and the Blobbi's z-index is derived from its Y position
    // precisely so it can walk behind a bush. The grade therefore rides on the
    // existing surface element, and the children stay its direct descendants.
    const { container, getByTestId } = await renderWorld();
    const surface = container.querySelector<HTMLElement>('[data-world-surface]')!;

    // Same element carries both: no new node was inserted between them.
    expect(surface.hasAttribute('data-island-world-graded')).toBe(true);
    expect(getByTestId('world-child').parentElement).toBe(surface);
    // A custom property, not a filter: the surface must not become a stacking
    // context.
    expect(surface.style.filter).toBe('');
  });

  it('leaves an unsupported location completely ungraded', async () => {
    // `home` is an interior. Nothing about it may change: no property, no
    // attribute, no filter on its plate.
    const { container, world } = await renderWorld('home');
    const surface = container.querySelector<HTMLElement>('[data-world-surface]')!;
    expect(surface.hasAttribute('data-island-world-graded')).toBe(false);
    expect(surface.style.getPropertyValue('--island-world-grade')).toBe('');
    expect(world.querySelector('[data-island-cloud]')).toBeNull();
    const plate = Array.from(world.querySelectorAll('img')).find((img) =>
      img.alt.includes('background'),
    )!;
    expect(plate.style.filter).toBe('');
  });

  it('paints the world-lighting veil AFTER the world content', async () => {
    // Above the players on purpose, so the shared grade reaches them — see
    // IslandWorldLight's header for why, and why its alpha is capped.
    const { layers } = await renderWorld();

    const surfaceIndex = layers.findIndex((el) => el.hasAttribute('data-world-surface'));
    const veilIndex = layers.reduce(
      (found, el, index) =>
        el.getAttribute('aria-hidden') === 'true' && el.children.length === 0 ? index : found,
      -1,
    );

    expect(surfaceIndex).toBeGreaterThanOrEqual(0);
    expect(veilIndex).toBeGreaterThan(surfaceIndex);
  });

  it('keeps the world surface reachable and its children mounted', async () => {
    const { container, getByTestId } = await renderWorld();
    expect(container.querySelectorAll('[data-world-surface]')).toHaveLength(1);
    expect(getByTestId('world-child')).toBeInTheDocument();
  });

  it('grades the artwork with a filter instead of covering it', async () => {
    // Default location is `town`, which is sky-enabled. A filter leaves
    // transparent pixels transparent; an overlay would darken the sky through the
    // cut-out and wash the stars out.
    const { container } = await renderWorld();
    const artwork = Array.from(container.querySelectorAll('img')).find((img) =>
      img.alt.includes('background'),
    )!;
    expect(artwork.style.filter).toMatch(/brightness\([\d.]+\) saturate\([\d.]+\)/);
  });

  it('does not render the DEV harness by default, even in a dev build', async () => {
    // The panel is gated on `import.meta.env.DEV` AND on being switched on from
    // the Developer tools menu. Off by default means a dev session still sees the
    // production presentation until it asks not to.
    const { container } = await renderWorld();
    expect(container.textContent).not.toContain('Day progress');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('cloud shapes and sizes', () => {
  it('renders every shape when the DEV harness forces it', () => {
    // The production rate for a formation is ~1 in 20 passages, so waiting for one
    // is not an inspection strategy. Every silhouette must be reachable directly.
    for (const shape of ISLAND_CLOUD_SHAPES) {
      setIslandSkyDev(
        islandSkyDevCloudOverride({ cloudActorId: 'cloud-a', cloudShape: shape }, ISLAND_SKY_DEV_DEFAULTS),
      );
      const { container } = render(<IslandSkyLayer location="town" />);
      const cloud = container.querySelector('[data-island-cloud="cloud-a"]')!;
      expect(cloud.getAttribute('data-island-cloud-shape'), shape).toBe(shape);
      // Real geometry, not a relabelled copy: the part count and viewBox differ.
      const svg = cloud.querySelector('svg')!;
      expect(svg.getAttribute('viewBox')).toBe(
        `0 0 ${ISLAND_CLOUD_SHAPE_GEOMETRY[shape].viewBoxWidth} ${ISLAND_CLOUD_SHAPE_GEOMETRY[shape].viewBoxHeight}`,
      );
      expect(svg.querySelectorAll('circle, ellipse, rect, path').length).toBe(
        ISLAND_CLOUD_SHAPE_GEOMETRY[shape].parts.length,
      );
      cleanup();
    }
  });

  it('draws visibly different geometry for egg, baby and adult', () => {
    const fingerprints = new Set<string>();
    for (const shape of ['blobbi-egg', 'blobbi-baby', 'blobbi-adult'] as const) {
      setIslandSkyDev(
        islandSkyDevCloudOverride({ cloudActorId: 'cloud-a', cloudShape: shape }, ISLAND_SKY_DEV_DEFAULTS),
      );
      const { container } = render(<IslandSkyLayer location="town" />);
      fingerprints.add(container.querySelector('[data-island-cloud="cloud-a"] svg')!.innerHTML);
      cleanup();
    }
    expect(fingerprints.size).toBe(3);
  });

  it('renders every size when the DEV harness forces it, even a disallowed one', () => {
    // cloud-c is never large in production; the harness must still show a large one.
    const widths: number[] = [];
    for (const size of ISLAND_CLOUD_SIZES) {
      setIslandSkyDev(
        islandSkyDevCloudOverride({ cloudActorId: 'cloud-c', cloudSize: size }, ISLAND_SKY_DEV_DEFAULTS),
      );
      const { container } = render(<IslandSkyLayer location="town" />);
      const cloud = container.querySelector<HTMLElement>('[data-island-cloud="cloud-c"]')!;
      expect(cloud.getAttribute('data-island-cloud-size'), size).toBe(size);
      widths.push(Number.parseFloat(cloud.style.width));
      cleanup();
    }
    expect(widths[0]).toBeLessThan(widths[1]);
    expect(widths[1]).toBeLessThan(widths[2]);
  });

  it('can target each of the three actors', () => {
    for (const actor of ISLAND_CLOUD_ACTORS) {
      setIslandSkyDev(
        islandSkyDevCloudOverride(
          { cloudActorId: actor.id, cloudShape: 'heart' },
          ISLAND_SKY_DEV_DEFAULTS,
        ),
      );
      const { container } = render(<IslandSkyLayer location="town" />);
      // Preview hides the others, so the previewed actor is the only cloud left.
      const clouds = container.querySelectorAll('[data-island-cloud]');
      expect(clouds).toHaveLength(1);
      expect(clouds[0].getAttribute('data-island-cloud'), actor.id).toBe(actor.id);
      expect(clouds[0].getAttribute('data-island-cloud-shape')).toBe('heart');
      cleanup();
    }
  });

  it('parks a previewed cloud fully on screen instead of waiting for its passage', () => {
    setIslandSkyDev(
      islandSkyDevCloudOverride(
        { cloudActorId: 'cloud-b', cloudShape: 'blobbi-baby' },
        ISLAND_SKY_DEV_DEFAULTS,
      ),
    );
    const { container } = render(<IslandSkyLayer location="town" />);
    const cloud = container.querySelector<HTMLElement>('[data-island-cloud="cloud-b"]')!;
    const parkPx = Number.parseFloat(/translate3d\((-?[\d.]+)px/.exec(cloud.style.transform)![1]);
    const width = Number.parseFloat(cloud.style.width);
    expect(parkPx).toBeGreaterThanOrEqual(0);
    expect(parkPx + width).toBeLessThanOrEqual(WORLD_WIDTH);
    // …and the travel animation is switched off, so it stays put.
    expect(cloud.style.animationName).toBe('none');
  });

  it('keeps formations in the upper sky', () => {
    for (const shape of ISLAND_CLOUD_SHAPES) {
      setIslandSkyDev(
        islandSkyDevCloudOverride(
          { cloudActorId: 'cloud-a', cloudShape: shape, cloudSize: 'large' },
          ISLAND_SKY_DEV_DEFAULTS,
        ),
      );
      const { container } = render(<IslandSkyLayer location="town" />);
      const cloud = container.querySelector<HTMLElement>('[data-island-cloud="cloud-a"]')!;
      expect(Number.parseFloat(cloud.style.top), shape).toBeLessThan(20);
      cleanup();
    }
  });

  it('restores the UTC-derived shape and size the moment Auto comes back', () => {
    const production = render(<IslandSkyLayer location="town" />);
    const before = Array.from(
      production.container.querySelectorAll('[data-island-cloud]'),
    ).map((el) => `${el.getAttribute('data-island-cloud')}:${el.getAttribute('data-island-cloud-shape')}:${el.getAttribute('data-island-cloud-size')}`);
    cleanup();

    setIslandSkyDev(
      islandSkyDevCloudOverride({ cloudActorId: 'cloud-a', cloudShape: 'heart' }, ISLAND_SKY_DEV_DEFAULTS),
    );
    setIslandSkyDev(
      islandSkyDevCloudOverride(
        { cloudShape: 'auto', cloudSize: 'auto' },
        { ...ISLAND_SKY_DEV_DEFAULTS, cloudActorId: 'cloud-a', cloudShape: 'heart' },
      ),
    );
    const restored = render(<IslandSkyLayer location="town" />);
    const after = Array.from(restored.container.querySelectorAll('[data-island-cloud]')).map(
      (el) => `${el.getAttribute('data-island-cloud')}:${el.getAttribute('data-island-cloud-shape')}:${el.getAttribute('data-island-cloud-size')}`,
    );
    expect(after).toEqual(before);
  });

  it('leaves the other actors on production selection while one is forced', () => {
    // Placement stays automatic here, so the other two still render — and must be
    // untouched by the override.
    const production = render(<IslandSkyLayer location="town" />);
    const productionOf = (container: HTMLElement, id: string) => {
      const el = container.querySelector(`[data-island-cloud="${id}"]`);
      return el && `${el.getAttribute('data-island-cloud-shape')}:${el.getAttribute('data-island-cloud-size')}`;
    };
    const beforeB = productionOf(production.container, 'cloud-b');
    const beforeC = productionOf(production.container, 'cloud-c');
    cleanup();

    setIslandSkyDev({ cloudActorId: 'cloud-a', cloudShape: 'blobbi-egg', cloudPlacement: 'auto' });
    const forced = render(<IslandSkyLayer location="town" />);
    expect(productionOf(forced.container, 'cloud-a')).toContain('blobbi-egg');
    expect(productionOf(forced.container, 'cloud-b')).toBe(beforeB);
    expect(productionOf(forced.container, 'cloud-c')).toBe(beforeC);
  });

  it('does not touch the island clock', () => {
    // The sky root's background colour is driven purely by the clock, so comparing
    // it before and after a cloud preview proves the preview left the clock alone.
    const before = render(<IslandSkyLayer location="town" />);
    const skyColour = (container: HTMLElement) =>
      (container.firstElementChild as HTMLElement).style.backgroundColor;
    const originalColour = skyColour(before.container);
    expect(originalColour).not.toBe('');
    cleanup();

    setIslandSkyDev(
      islandSkyDevCloudOverride({ cloudShape: 'blobbi-adult' }, ISLAND_SKY_DEV_DEFAULTS),
    );
    const after = render(<IslandSkyLayer location="town" />);
    // The preview visibly took effect…
    expect(
      after.container.querySelector('[data-island-cloud]')!.getAttribute('data-island-cloud-shape'),
    ).toBe('blobbi-adult');
    // …and the clock-derived sky is byte-identical.
    expect(skyColour(after.container)).toBe(originalColour);
  });
});
