/**
 * THE EXTERNAL CONSUMER TEST.
 *
 * This file is what an application that has never heard of Blobbi Island gets
 * when it installs `@blobbi/react`. It imports the package by NAME, from
 * outside the package's own source tree, and it renders — with:
 *
 *   no QueryClient, no router, no Nostr client, no relay, no signer,
 *   no current-user hook, no app context, no theme provider,
 *   no world coordinates, no movement, no presence, no test harness.
 *
 * There is deliberately no `TestApp` import here and no provider wrapper of any
 * kind. If one ever becomes necessary, the package has acquired a hidden
 * dependency and this file is where that shows up.
 *
 * Accessories come from `fixtures/accessory-fixtures.ts` — three tiny local
 * SVGs and plain placement data. Nothing here touches inventory, equipment
 * events, or any Nostr kind.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  BlobbiRendererView,
  normalizeAccessoryPlacements,
  loadBlobbiSvg,
  BLOBBI_RENDER_SIZE_PX,
  type BlobbiRenderVisual,
  type BlobbiRenderSize,
} from '@blobbi/react';
import {
  FIXTURE_ACCESSORIES,
  FIXTURE_BROKEN_PRIMARY,
  FIXTURE_CAPE,
  FIXTURE_GOGGLES,
  FIXTURE_IMAGE_URLS,
  FIXTURE_STAR_BADGE,
  fixtureSourceResolver,
} from '../fixtures/accessory-fixtures';

/** JSON round-trip: everything a consumer sends must be plain serializable. */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const EGG: BlobbiRenderVisual = plain({ stage: 'egg', baseColor: '#8E6BE8', name: 'Egg' });
const BABY: BlobbiRenderVisual = plain({
  stage: 'baby',
  baseColor: '#7ED0A8',
  secondaryColor: '#B7ECD2',
  eyeColor: '#26343F',
  name: 'Baby',
});
const ADULT: BlobbiRenderVisual = plain({
  stage: 'adult',
  adultType: 'bloomi',
  baseColor: '#F2A0C0',
  secondaryColor: '#FAD4E4',
  eyeColor: '#3A2A1A',
  name: 'Adult',
});

const box = (c: HTMLElement) => c.querySelector('[data-blobbi-renderer]') as HTMLElement;
const bodySvg = (c: HTMLElement) => c.querySelector('[data-blobbi-body-box] svg');
const accessoryImgs = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-accessory-code] img')] as HTMLImageElement[];

describe('a consumer with no providers at all can render every Blobbi', () => {
  it.each([
    ['egg', EGG],
    ['baby', BABY],
    ['adult', ADULT],
  ])('renders the %s stage', (label, visual) => {
    const { container } = render(
      <BlobbiRendererView visual={visual} instanceId={`consumer-${label}`} />,
    );
    expect(bodySvg(container)).toBeTruthy();
    expect(box(container).getAttribute('data-blobbi-size')).toBe('lg');
  });

  it('renders front and rear, and the rear drawing keeps no face', () => {
    const { container: front } = render(
      <BlobbiRendererView visual={ADULT} instanceId="consumer-front" facing="front" />,
    );
    const { container: rear } = render(
      <BlobbiRendererView visual={ADULT} instanceId="consumer-rear" facing="back" />,
    );

    const frontMarkup = bodySvg(front)!.outerHTML;
    const rearMarkup = bodySvg(rear)!.outerHTML;
    expect(rearMarkup).not.toBe(frontMarkup);
    expect(rearMarkup.length).toBeLessThan(frontMarkup.length);
    expect(frontMarkup).toMatch(/<!--\s*Pupils/i);
    expect(rearMarkup).not.toMatch(/<!--\s*Pupils/i);
  });

  it('renders closed eyes, from either flag', () => {
    // Same instance id in all three: SVG ids are namespaced by it, so differing
    // ids would make the markup differ for a reason that has nothing to do with
    // the eyes.
    const { container: sleeping } = render(
      <BlobbiRendererView visual={BABY} instanceId="consumer-eyes" isSleeping />,
    );
    const { container: seated } = render(
      <BlobbiRendererView visual={BABY} instanceId="consumer-eyes" eyesClosed />,
    );
    const { container: awake } = render(
      <BlobbiRendererView visual={BABY} instanceId="consumer-eyes" />,
    );
    // The two closed-eye flags select the same drawing; awake differs.
    expect(bodySvg(sleeping)!.innerHTML).toBe(bodySvg(seated)!.innerHTML);
    expect(bodySvg(sleeping)!.innerHTML).not.toBe(bodySvg(awake)!.innerHTML);
  });

  it('renders gaze as CSS variables over shared body markup', () => {
    const { container } = render(
      <BlobbiRendererView
        visual={ADULT}
        instanceId="consumer-gaze"
        eyeOffset={plain({ x: 0.8, y: -0.4 })}
      />,
    );
    const body = container.querySelector('[data-blobbi-body-box]') as HTMLElement;
    expect(body.style.getPropertyValue('--blobbi-eye-x')).toBe('0.8');
    expect(body.style.getPropertyValue('--blobbi-eye-y')).toBe('-0.4');
    expect(bodySvg(container)!.outerHTML).toContain('blobbi-pupil');
  });

  it('renders every size token as a fixed square box', () => {
    for (const size of Object.keys(BLOBBI_RENDER_SIZE_PX) as BlobbiRenderSize[]) {
      const { container } = render(
        <BlobbiRendererView visual={BABY} instanceId={`consumer-${size}`} size={size} />,
      );
      expect(box(container).getAttribute('data-blobbi-size')).toBe(size);
    }
  });
});

describe('a consumer supplies its own accessory data and its own artwork', () => {
  it('paints two accessories from local fixture images, in layer order', () => {
    const placements = normalizeAccessoryPlacements([FIXTURE_CAPE, FIXTURE_STAR_BADGE]);
    const { container } = render(
      <BlobbiRendererView
        visual={BABY}
        instanceId="consumer-two-accessories"
        accessories={placements}
      />,
    );

    const imgs = accessoryImgs(container);
    expect(imgs.map((img) => img.getAttribute('src'))).toEqual([
      FIXTURE_IMAGE_URLS.cape,
      FIXTURE_IMAGE_URLS.starBadge,
    ]);

    // The cape is back-mounted, so it paints in the BEHIND group; the badge in
    // the FRONT one. That is the whole point of the layer split.
    expect(
      container.querySelector('[data-accessory-layer-group="behind"] [data-accessory-code="back-devcape"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-accessory-layer-group="front"] [data-accessory-code="headwear-devstar"]'),
    ).toBeTruthy();
  });

  it('applies position, scale, rotation and flip from plain numbers', () => {
    const [cape] = normalizeAccessoryPlacements([FIXTURE_CAPE]);
    const { container } = render(
      <BlobbiRendererView visual={BABY} instanceId="consumer-transform" accessories={[cape]} />,
    );
    const wrapper = container.querySelector('[data-accessory-code="back-devcape"]') as HTMLElement;
    expect(wrapper.style.left).toBe('50%');
    expect(wrapper.style.top).toBe('62%');
    expect(wrapper.style.transform).toContain('scale(1.4)');
    expect(wrapper.style.transform).toContain('rotate(0deg)');
    expect(wrapper.style.transform).toContain('scaleX(-1)');
  });

  it('hides face-only accessories in rear view and keeps back-mounted ones', () => {
    const rear = normalizeAccessoryPlacements(FIXTURE_ACCESSORIES, { facing: 'back' });
    expect(rear.map((p) => p.code)).toEqual(['back-devcape', 'headwear-devstar']);
    expect(rear.map((p) => p.code)).not.toContain(FIXTURE_GOGGLES.code);

    const { container } = render(
      <BlobbiRendererView
        visual={BABY}
        instanceId="consumer-rear-accessories"
        facing="back"
        accessories={rear}
      />,
    );
    expect(container.querySelector('[data-accessory-code="eyewear-devgoggles"]')).toBeNull();
  });

  it('walks the candidate source list when the first image fails', () => {
    const [placement] = normalizeAccessoryPlacements([FIXTURE_BROKEN_PRIMARY], {
      resolveSources: fixtureSourceResolver,
    });
    expect(placement.sources.length).toBe(2);

    const { container } = render(
      <BlobbiRendererView visual={BABY} instanceId="consumer-fallback" accessories={[placement]} />,
    );
    const img = accessoryImgs(container)[0];
    expect(img.getAttribute('src')).toBe(FIXTURE_BROKEN_PRIMARY.url);

    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe(FIXTURE_IMAGE_URLS.starBadge);

    // Exhausting the list hides the image rather than looping forever.
    img.dispatchEvent(new Event('error'));
    expect(img.style.display).toBe('none');
  });

  it('renders nothing rather than a broken image when no source exists', () => {
    // The package's default resolver is "use the URL you gave me" — so a
    // placement with no URL resolves to an empty candidate list.
    const [placement] = normalizeAccessoryPlacements([
      { ...FIXTURE_STAR_BADGE, url: undefined },
    ]);
    expect(placement.sources).toEqual([]);
    expect(placement.imageUrl).toBe('');

    const { container } = render(
      <BlobbiRendererView visual={BABY} instanceId="consumer-nosource" accessories={[placement]} />,
    );
    const img = accessoryImgs(container)[0];
    img.dispatchEvent(new Event('error'));
    expect(img.style.display).toBe('none');
  });
});

describe('two simultaneous instances stay isolated', () => {
  it('shares no SVG id between two Blobbis on one page, and resolves every url(#…)', () => {
    const { container } = render(
      <div>
        <BlobbiRendererView
          visual={ADULT}
          instanceId="consumer-pair-a"
          accessories={normalizeAccessoryPlacements(FIXTURE_ACCESSORIES)}
        />
        <BlobbiRendererView
          visual={BABY}
          instanceId="consumer-pair-b"
          eyeOffset={{ x: -1, y: 1 }}
        />
      </div>,
    );

    const svgs = [...container.querySelectorAll('[data-blobbi-body-box] svg')];
    expect(svgs).toHaveLength(2);

    const idsOf = (svg: Element) =>
      [...svg.querySelectorAll('[id]')].map((el) => el.getAttribute('id')!);
    const [first, second] = svgs.map(idsOf);
    expect(first.length).toBeGreaterThan(0);
    expect(first.filter((id) => second.includes(id))).toEqual([]);

    // The failure mode of colliding ids is a reference resolving to the WRONG
    // element, so assert every reference resolves inside its own document.
    const allIds = new Set([...first, ...second]);
    const references = [...container.innerHTML.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(references.length).toBeGreaterThan(0);
    expect(references.filter((ref) => !allIds.has(ref))).toEqual([]);
  });

  it('gives each instance its own accessory DOM', () => {
    const placements = normalizeAccessoryPlacements(FIXTURE_ACCESSORIES);
    const { container } = render(
      <div>
        <BlobbiRendererView visual={BABY} instanceId="consumer-acc-a" accessories={placements} />
        <BlobbiRendererView visual={BABY} instanceId="consumer-acc-b" accessories={placements} />
      </div>,
    );
    expect(accessoryImgs(container)).toHaveLength(FIXTURE_ACCESSORIES.length * 2);
  });
});

describe('a consumer can render without React at all', () => {
  it('returns a complete SVG string from loadBlobbiSvg', () => {
    const svg = loadBlobbiSvg('adult', 'bloomi', '#F2A0C0', '#FAD4E4', '#3A2A1A', false, 'headless');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('b_headless_');
    // Synchronous by contract: a string, not a promise.
    expect(typeof svg).toBe('string');
  });
});
