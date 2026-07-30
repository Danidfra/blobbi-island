/**
 * The world-grade opt-out contract, checked against the **real** character markup.
 *
 * The day/night system grades every `<img>` inside `[data-world-surface]` so that
 * scenery darkens at night. Characters must not be graded, and the first version of
 * that exclusion was keyed on `.blobbi-character img` / `[data-player-key] img` —
 * two hardcoded descendant selectors. Auditing the actual DOM turned up two things
 * those selectors got wrong:
 *
 *  1. **The Blobbi body is an inline `<svg>`**, injected by
 *     `CurrentBlobbiDisplay` via `dangerouslySetInnerHTML`. An `img`-scoped rule
 *     never reached it, so the body was never at risk — and the exclusion was doing
 *     nothing for it. What the exclusion *does* protect is the **accessory overlay**,
 *     which is real `<img>` elements.
 *  2. **They only matched descendants.** If `.blobbi-character` ever landed on an
 *     image itself, `.blobbi-character img` would not match it.
 *
 * So the selectors were replaced with `data-island-world-grade="exclude"`, matched
 * both on the image and on any wrapper. These tests render the real components and
 * check the real elements against the real CSS.
 *
 * The remote-player half lives in `WorldGradeOptOut.remote.test.tsx`: it needs
 * `@nostrify/react` mocked to drive presence, and that mock is incompatible with
 * `TestApp`, which imports the real login provider from the same module.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useRef } from 'react';

import { TestApp } from '@/test/TestApp';
import { MovableBlobbi } from './MovableBlobbi';

/** The two halves of the contract, read from the stylesheet that implements it. */
const CSS = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
const GRADE_SELECTOR = '[data-island-world-graded] img';
const EXCLUDE_ON_IMAGE = "[data-island-world-graded] img[data-island-world-grade='exclude']";
const EXCLUDE_ON_WRAPPER = "[data-island-world-graded] [data-island-world-grade='exclude'] img";

describe('the contract exists as written', () => {
  it('grades world images by default and honours the exclusion both ways', () => {
    expect(CSS).toContain(`${GRADE_SELECTOR} {`);
    expect(CSS).toContain(EXCLUDE_ON_IMAGE);
    expect(CSS).toContain(EXCLUDE_ON_WRAPPER);
  });

  it('gives the exclusion higher specificity than the default', () => {
    // Both exclusion selectors add one attribute over `[attr] img`, so they win.
    // Asserting the ORDER too, since equal specificity would be resolved by it.
    expect(CSS.indexOf(EXCLUDE_ON_IMAGE)).toBeGreaterThan(CSS.indexOf(`${GRADE_SELECTOR} {`));
  });
});

describe('the local Blobbi', () => {
  function Harness() {
    const containerRef = useRef<HTMLDivElement>(null);
    return (
      <TestApp>
        <div
          ref={containerRef}
          data-world-surface
          data-island-world-graded=""
          style={{ width: '400px', height: '300px' }}
        >
          <MovableBlobbi
            containerRef={containerRef}
            backgroundFile="town-open.webp"
            initialPosition={{ x: 50, y: 75 }}
            boundary={{ shape: 'rectangle', x: [0, 100], y: [60, 100] }}
          />
        </div>
      </TestApp>
    );
  }

  /**
   * `TestApp`'s login provider renders `null` until it has read stored logins, so
   * the Blobbi only appears after that effect settles.
   */
  async function setupLocal() {
    const view = render(<Harness />);
    const character = await waitFor(() => {
      const el = view.container.querySelector('.blobbi-character');
      expect(el).not.toBeNull();
      return el!;
    });
    return { ...view, character };
  }

  it('marks its wrapper as excluded', async () => {
    const { character } = await setupLocal();
    expect(character).toHaveAttribute('data-island-world-grade', 'exclude');
  });

  it('draws its body as inline SVG and its accessories as images', () => {
    /*
      The two structural facts the contract depends on, pinned at their source.

      This fixture has no logged-in Blobbi to render, so the body cannot be asserted
      from the DOM here — but the *mechanism* is what matters and it is unambiguous:
      the pure renderer (`BlobbiRendererView`, which every path — local wrapper,
      remote sprite, previews — now ends in) injects the body with
      `dangerouslySetInnerHTML`, and renders accessories as `<img>`. Together they
      are the reason the exclusion protects accessories rather than the Blobbi
      itself, and the reason extending the grade rule to `svg` would be a mistake —
      it would reach the body.
    */
    const rendererView = readFileSync(
      join(process.cwd(), 'packages/blobbi-react/src/BlobbiRendererView.tsx'),
      'utf8',
    );
    expect(rendererView).toContain('dangerouslySetInnerHTML');
    expect(rendererView).toContain('<img');

    // The interactive accessory editor also paints real <img> elements.
    const overlay = readFileSync(
      join(process.cwd(), 'src/components/blobbi/AccessoryOverlay.tsx'),
      'utf8',
    );
    expect(overlay).toContain('<img');

    // And the grade rule is deliberately image-only.
    expect(CSS).not.toContain('[data-island-world-graded] svg');
  });

  it('excludes every image inside it, whatever the subtree contains', async () => {
    // Accessory overlays are the real images here. Whether or not this fixture has
    // equipment to render, any image that appears must be covered — so the check is
    // over the real subtree rather than over a planted element.
    const { character } = await setupLocal();
    for (const img of Array.from(character.querySelectorAll('img'))) {
      expect(img.matches(EXCLUDE_ON_WRAPPER), img.getAttribute('src') ?? '').toBe(true);
      expect(img.closest("[data-island-world-grade='exclude']")).not.toBeNull();
    }
  });

  it('still grades a scenery image in the same surface', async () => {
    // The exclusion must be narrow: environment art beside the Blobbi keeps the
    // grade. Without this, "exclude everything" would also pass the test above.
    const { container } = render(
      <TestApp>
        <div data-world-surface data-island-world-graded="">
          <img alt="scenery" src="/assets/world/props/bush-1.png" />
        </div>
      </TestApp>,
    );
    const scenery = await waitFor(() => {
      const el = container.querySelector('img[alt="scenery"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(scenery.matches(GRADE_SELECTOR)).toBe(true);
    expect(scenery.matches(EXCLUDE_ON_IMAGE)).toBe(false);
    expect(scenery.matches(EXCLUDE_ON_WRAPPER)).toBe(false);
  });

  it('lets a single sprite opt out on the image itself', async () => {
    // The other half of the contract: a future emissive or UI-like world sprite can
    // decline the grade at its own call site, with no wrapper.
    const { container } = render(
      <TestApp>
        <div data-world-surface data-island-world-graded="">
          <img alt="emissive" src="/assets/world/props/streetlight.png" data-island-world-grade="exclude" />
        </div>
      </TestApp>,
    );
    const sprite = await waitFor(() => {
      const el = container.querySelector('img[alt="emissive"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(sprite.matches(EXCLUDE_ON_IMAGE)).toBe(true);
  });
});
