/**
 * The PORTABILITY proof for the pure renderer (Phase 4).
 *
 * Everything below renders `BlobbiRendererView` from plain, serializable data
 * with NO providers at all — no `TestApp`, no QueryClient, no Nostr provider,
 * no router, no world/presence context, no mocks. Nothing is stubbed out,
 * because there is nothing to stub: if the renderer's subtree reached any of
 * those, these renders would throw.
 *
 * That is the same guarantee `renderer-boundary.test.ts` proves statically, and
 * this file proves dynamically. The pair is deliberate: the static test catches
 * a forbidden import the moment it is written, and this one catches a runtime
 * dependency a static scan could miss (a global read, a context consumed
 * through a re-export).
 *
 * Every case here is also a case a future `@blobbi/react` consumer will hit on
 * day one — incomplete relay data, a stage nobody sent, an accessory whose
 * numbers are broken, several Blobbis on one page.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { BlobbiRendererView } from './BlobbiRendererView';
import { normalizeAccessoryPlacements } from './lib/accessory-normalize';
import type { EquipmentConfig } from './lib/accessory-types';
import type { BlobbiRenderSize } from './lib/blobbi-render-size';

/** JSON-round-trippable input: exactly what would cross a package boundary. */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const BABY = plain({
  stage: 'baby' as const,
  baseColor: '#ff6699',
  secondaryColor: '#66ccff',
  eyeColor: '#222222',
  name: 'Plain Baby',
});
const ADULT = plain({ ...BABY, stage: 'adult' as const, adultType: 'catti', name: 'Plain Adult' });
const EGG = plain({ ...BABY, stage: 'egg' as const, name: 'Plain Egg' });

function equip(code: string, overrides: Partial<EquipmentConfig> = {}): EquipmentConfig {
  return plain({
    code,
    x: 50,
    y: 30,
    scale: 1,
    rot: 0,
    flipX: false,
    refw: 100,
    refh: 100,
    form: 'default' as const,
    url: `https://example.test/${code}.png`,
    slot: 'headwear' as const,
    ...overrides,
  });
}

const box = (c: HTMLElement) => c.querySelector('[data-blobbi-renderer]') as HTMLElement;
const svgOf = (c: HTMLElement) => c.querySelector('[data-blobbi-body-box] svg');

describe('renders from plain data with no providers whatsoever', () => {
  it.each([
    ['egg', EGG],
    ['baby', BABY],
    ['adult', ADULT],
  ])('renders the %s stage', (label, visual) => {
    const { container } = render(
      <BlobbiRendererView visual={visual} instanceId={`plain-${label}`} />,
    );
    expect(svgOf(container), `${label} produced no body`).not.toBeNull();
    expect(box(container)).not.toBeNull();
  });

  it('renders front and rear facing, and the rear drawing carries no face', () => {
    const front = render(<BlobbiRendererView visual={BABY} instanceId="plain-front" />);
    const rear = render(
      <BlobbiRendererView visual={BABY} instanceId="plain-rear" facing="back" />,
    );

    expect(svgOf(front.container)).not.toBeNull();
    expect(svgOf(rear.container)).not.toBeNull();
    // Same Blobbi, different drawing — not a CSS mirror of the same markup.
    expect(rear.container.innerHTML).not.toBe(front.container.innerHTML);
    expect(rear.container.innerHTML).not.toContain('blobbi-pupil');
  });

  it('renders the sleeping and seated-eyes-closed poses', () => {
    const awake = render(<BlobbiRendererView visual={BABY} instanceId="plain-awake" />);
    const sleeping = render(
      <BlobbiRendererView visual={BABY} instanceId="plain-awake" isSleeping />,
    );
    const seated = render(
      <BlobbiRendererView visual={BABY} instanceId="plain-awake" eyesClosed />,
    );

    expect(sleeping.container.innerHTML).not.toBe(awake.container.innerHTML);
    // `isSleeping` and the legacy seated `eyesClosed` mean the same thing to
    // the drawing, and the render model collapses them — so they must produce
    // byte-identical markup.
    expect(seated.container.innerHTML).toBe(sleeping.container.innerHTML);
  });

  it('renders gaze as CSS variables only, leaving the body markup shared', () => {
    const left = render(
      <BlobbiRendererView visual={BABY} instanceId="plain-gaze" eyeOffset={plain({ x: -1, y: 0.4 })} />,
    );
    const right = render(
      <BlobbiRendererView visual={BABY} instanceId="plain-gaze" eyeOffset={plain({ x: 1, y: -0.4 })} />,
    );

    const varsOf = (c: HTMLElement) => {
      const body = c.querySelector('[data-blobbi-body-box]') as HTMLElement;
      return [
        body.style.getPropertyValue('--blobbi-eye-x'),
        body.style.getPropertyValue('--blobbi-eye-y'),
      ];
    };
    expect(varsOf(left.container)).toEqual(['-1', '0.4']);
    expect(varsOf(right.container)).toEqual(['1', '-0.4']);
    // Only the variables differ: the SVG itself is the same generated string,
    // which is what makes per-frame gaze cheap.
    const strip = (c: HTMLElement) => c.querySelector('[data-blobbi-body-box]')!.innerHTML;
    expect(strip(left.container)).toBe(strip(right.container));
  });

  it('renders multiple accessories, and none at all', () => {
    const many = render(
      <BlobbiRendererView
        visual={BABY}
        instanceId="plain-acc"
        accessories={normalizeAccessoryPlacements([
          equip('headwear-1'),
          equip('back-1', { slot: 'back' }),
          equip('neckwear-1', { slot: 'neckwear' }),
        ])}
      />,
    );
    expect(many.container.querySelectorAll('[data-accessory-code]')).toHaveLength(3);

    const none = render(
      <BlobbiRendererView visual={BABY} instanceId="plain-none" accessories={[]} />,
    );
    expect(none.container.querySelectorAll('[data-accessory-code]')).toHaveLength(0);
    // No accessories means no empty layer wrappers either.
    expect(none.container.querySelectorAll('[data-accessory-layer-group]')).toHaveLength(0);
  });

  it('renders an incomplete visual — the minimum a consumer can send', () => {
    // No stage, no colors, no name: everything a relay might omit.
    const { container } = render(<BlobbiRendererView visual={{}} instanceId="plain-empty" />);
    expect(svgOf(container)).not.toBeNull();

    // An unknown stage falls back to the same drawing rather than rendering
    // nothing. (The prop type forbids it; external JSON does not.)
    const bogus = render(
      <BlobbiRendererView
        visual={{ stage: 'wormhole' } as never}
        instanceId="plain-bogus"
      />,
    );
    expect(svgOf(bogus.container)).not.toBeNull();
  });

  it('renders every size token, each a fixed square box with no breakpoints', () => {
    for (const size of ['sm', 'md', 'lg', 'xl', '2xl', '3xl'] as BlobbiRenderSize[]) {
      const { container } = render(
        <BlobbiRendererView visual={BABY} instanceId={`plain-${size}`} size={size} />,
      );
      const root = box(container);
      expect(root.getAttribute('data-blobbi-size')).toBe(size);
      expect(root.className, `${size} must not be responsive`).not.toMatch(/\b(sm|md|lg|xl|2xl):/);
    }
  });
});

describe('accessory image sources are data, not renderer policy', () => {
  it('paints the resolved primary source and falls through the candidate list', () => {
    const placements = normalizeAccessoryPlacements([equip('headwear-1')]);
    const { container } = render(
      <BlobbiRendererView visual={BABY} instanceId="plain-src" accessories={placements} />,
    );
    const img = container.querySelector('[data-accessory-code="headwear-1"] img') as HTMLImageElement;

    expect(img.getAttribute('src')).toBe(placements[0].sources[0]);
    expect(placements[0].sources.length).toBeGreaterThan(1);

    // Each failure advances exactly one step, and the last one hides the image
    // instead of looping forever on a missing asset.
    for (let i = 1; i < placements[0].sources.length; i++) {
      img.dispatchEvent(new Event('error'));
      expect(img.getAttribute('src')).toBe(placements[0].sources[i]);
    }
    img.dispatchEvent(new Event('error'));
    expect(img.style.display).toBe('none');
  });

  it('accepts a caller-supplied resolver, so no Island asset layout is required', () => {
    const placements = normalizeAccessoryPlacements([equip('headwear-1')], {
      resolveSources: ({ code }) => [`cdn://mine/${code}.avif`],
    });
    const { container } = render(
      <BlobbiRendererView visual={BABY} instanceId="plain-cdn" accessories={placements} />,
    );
    const img = container.querySelector('[data-accessory-code="headwear-1"] img')!;
    expect(img.getAttribute('src')).toBe('cdn://mine/headwear-1.avif');
  });
});

describe('independent simultaneous instances stay isolated', () => {
  it('four Blobbis on one page share no SVG id, gradient, clip path or gaze marker', () => {
    const { container } = render(
      <div>
        <BlobbiRendererView visual={BABY} instanceId="multi-a" />
        <BlobbiRendererView visual={ADULT} instanceId="multi-b" eyeOffset={{ x: 1, y: 0 }} />
        <BlobbiRendererView visual={BABY} instanceId="multi-c" facing="back" />
        <BlobbiRendererView visual={BABY} instanceId="multi-d" isSleeping />
      </div>,
    );

    const ids = Array.from(container.querySelectorAll('svg [id]')).map((el) => el.id);
    expect(ids.length).toBeGreaterThan(3);
    expect(new Set(ids).size, 'duplicate SVG ids across instances').toBe(ids.length);

    // Every url(#…) reference resolves to an id that exists in the SAME
    // document — the failure mode of colliding ids is a reference silently
    // binding to another Blobbi's gradient.
    const refs = Array.from(container.innerHTML.matchAll(/url\(#([^)]+)\)/g)).map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of new Set(refs)) {
      expect(ids, `dangling reference url(#${ref})`).toContain(ref);
    }
  });

  it('two renderers given the SAME instance id are the caller getting what they asked for', () => {
    // Not a bug to defend against here — a documented contract. Callers that
    // need isolation pass distinct ids (remote actors key by pubkey+session);
    // callers that intentionally render the same Blobbi twice may share one.
    const { container } = render(
      <div>
        <BlobbiRendererView visual={BABY} instanceId="same" />
        <BlobbiRendererView visual={BABY} instanceId="same" />
      </div>,
    );
    const ids = Array.from(container.querySelectorAll('svg [id]')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length / 2);
  });

  it('normalizes hostile or punctuation-only instance ids into safe SVG ids', () => {
    const { container } = render(
      <div>
        <BlobbiRendererView visual={BABY} instanceId='a"/><script>x</script>' />
        <BlobbiRendererView visual={BABY} instanceId="" />
      </div>,
    );
    expect(container.querySelector('script')).toBeNull();
    for (const el of Array.from(container.querySelectorAll('svg [id]'))) {
      expect(el.id).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});
