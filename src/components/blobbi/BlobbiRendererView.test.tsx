/**
 * Phase 1 coverage: the canonical renderer-box geometry contract and renderer
 * purity (docs/blobbi-renderer-contract.md).
 *
 * Every test renders `BlobbiRendererView` BARE — no providers, no mocks. That
 * is itself the purity proof: if the pure renderer called any Nostr, profile,
 * or equipment hook, these renders would throw.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { BlobbiRendererView } from './BlobbiRendererView';
import {
  BLOBBI_RENDER_SIZE_CLASSES,
  BLOBBI_RENDER_SIZE_PX,
  ACCESSORY_BASE_PERCENT,
  ACCESSORY_BASE_RATIO,
  accessoryBasePx,
  type BlobbiRenderSize,
} from './lib/blobbi-render-size';
import { normalizeAccessoryPlacements } from './lib/accessory-normalize';
import type { EquipmentConfig } from './lib/accessory-types';

const VISUAL = {
  stage: 'baby' as const,
  baseColor: '#ff0000',
  secondaryColor: '#00ff00',
  eyeColor: '#0000ff',
  name: 'Testy',
};

const ADULT_VISUAL = { ...VISUAL, stage: 'adult' as const, adultType: 'catti' };

function equip(code: string, overrides: Partial<EquipmentConfig> = {}): EquipmentConfig {
  return {
    code,
    x: 40,
    y: 30,
    scale: 1.2,
    rot: 10,
    flipX: false,
    refw: 100,
    refh: 100,
    form: 'default',
    url: `https://example.com/${code}.png`,
    slot: code.startsWith('back-') ? 'back' : 'headwear',
    ...overrides,
  };
}

const box = (container: HTMLElement) =>
  container.querySelector('[data-blobbi-renderer]') as HTMLElement;
const bodyBox = (container: HTMLElement) =>
  container.querySelector('[data-blobbi-body-box]') as HTMLElement;

describe('renderer-box geometry contract', () => {
  it('size tokens resolve deterministically, with no viewport breakpoints anywhere', () => {
    for (const [token, classes] of Object.entries(BLOBBI_RENDER_SIZE_CLASSES)) {
      expect(classes, `${token} must not contain responsive variants`).not.toMatch(
        /(sm|md|lg|xl|2xl):/,
      );
      expect(BLOBBI_RENDER_SIZE_PX[token as BlobbiRenderSize]).toBeGreaterThan(0);
    }
    // The class ladder and the px table agree (h-8=32 … h-72=288).
    expect(BLOBBI_RENDER_SIZE_PX).toEqual({
      sm: 32, md: 56, lg: 96, xl: 128, '2xl': 224, '3xl': 288,
    });
  });

  it('the body layout box IS the accessory coordinate box (both fill the renderer box)', () => {
    const accessories = normalizeAccessoryPlacements([equip('headwear-1'), equip('back-1')]);
    const { container } = render(
      <BlobbiRendererView visual={VISUAL} instanceId="t-geom" size="lg" accessories={accessories} />,
    );

    const root = box(container);
    expect(root.className).toContain('h-24');
    expect(root.className).toContain('w-24');

    // Body and both accessory layer groups are inset-0 children of the SAME
    // box — one shared local coordinate space.
    expect(bodyBox(container).parentElement).toBe(root);
    expect(bodyBox(container).className).toContain('inset-0');
    for (const group of Array.from(root.querySelectorAll('[data-accessory-layer-group]'))) {
      expect(group.parentElement).toBe(root);
      expect((group as HTMLElement).className).toContain('inset-0');
    }
  });

  it('the body SVG fills the box (width/height 100%, no distortion)', () => {
    const { container } = render(
      <BlobbiRendererView visual={VISUAL} instanceId="t-fill" size="lg" />,
    );
    const svg = bodyBox(container).querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('100%');
    expect(svg.getAttribute('height')).toBe('100%');
    expect(svg.getAttribute('viewBox')).toBeTruthy();
  });

  it('transparent and framed modes share identical geometry', () => {
    const transparent = render(
      <BlobbiRendererView visual={VISUAL} instanceId="t-a" size="xl" transparent />,
    );
    const framed = render(
      <BlobbiRendererView visual={VISUAL} instanceId="t-b" size="xl" transparent={false} />,
    );

    for (const view of [transparent, framed]) {
      const root = box(view.container);
      expect(root.className).toContain('h-32');
      expect(root.className).toContain('w-32');
      expect(bodyBox(view.container).className).toContain('inset-0');
    }
    // Only decoration differs.
    expect(box(framed.container).className).toContain('blobbi-gradient-frame');
    expect(box(transparent.container).className).not.toContain('blobbi-gradient-frame');
  });
});

describe('accessory sizing contract', () => {
  it('accessory base size is the same fraction of the box at every renderer size', () => {
    for (const size of ['lg', 'xl'] as const) {
      const accessories = normalizeAccessoryPlacements([equip('headwear-1')]);
      const { container } = render(
        <BlobbiRendererView
          visual={VISUAL}
          instanceId={`t-ratio-${size}`}
          size={size}
          accessories={accessories}
        />,
      );
      const item = container.querySelector('[data-accessory-code="headwear-1"]') as HTMLElement;
      // Percentage of the box — so the accessory/body ratio is identical for
      // every token, and resizing the renderer scales both together.
      expect(item.style.width).toBe(ACCESSORY_BASE_PERCENT);
      expect(item.style.height).toBe(ACCESSORY_BASE_PERCENT);
    }
    // The helper agrees: base px = box px × ratio.
    expect(accessoryBasePx('xl')).toBeCloseTo(128 * ACCESSORY_BASE_RATIO);
    expect(accessoryBasePx('lg')).toBeCloseTo(96 * ACCESSORY_BASE_RATIO);
    // And the legacy editor ratio (60px in the 128px xl box) is preserved.
    expect(accessoryBasePx('xl')).toBeCloseTo(60);
  });

  it("the accessory's own scale is applied exactly once (in the transform, not the size)", () => {
    const accessories = normalizeAccessoryPlacements([equip('headwear-1', { scale: 1.2 })]);
    const { container } = render(
      <BlobbiRendererView visual={VISUAL} instanceId="t-scale" size="lg" accessories={accessories} />,
    );
    const item = container.querySelector('[data-accessory-code="headwear-1"]') as HTMLElement;
    expect(item.style.transform).toContain('scale(1.2)');
    expect(item.style.transform.match(/scale\(/g)).toHaveLength(1);
    expect(item.style.width).toBe(ACCESSORY_BASE_PERCENT); // no scale baked in
    // Position is percentages of the same box.
    expect(item.style.left).toBe('40%');
    expect(item.style.top).toBe('30%');
  });
});

describe('accessory paint order in the DOM', () => {
  it('behind-body accessories render before the body, front after it', () => {
    const accessories = normalizeAccessoryPlacements([
      equip('headwear-1'),
      equip('back-1', { slot: 'back' }),
    ]);
    const { container } = render(
      <BlobbiRendererView visual={VISUAL} instanceId="t-order" size="lg" accessories={accessories} />,
    );
    const children = Array.from(box(container).children);
    const behindIdx = children.findIndex(
      (el) => el.getAttribute('data-accessory-layer-group') === 'behind',
    );
    const bodyIdx = children.findIndex((el) => el.hasAttribute('data-blobbi-body-box'));
    const frontIdx = children.findIndex(
      (el) => el.getAttribute('data-accessory-layer-group') === 'front',
    );

    expect(behindIdx).toBeGreaterThanOrEqual(0);
    expect(frontIdx).toBeGreaterThanOrEqual(0);
    expect(behindIdx).toBeLessThan(bodyIdx);
    expect(bodyIdx).toBeLessThan(frontIdx);
  });

  it('rear view suppresses face-only slots in the rendered output', () => {
    const accessories = (facing: 'front' | 'back') =>
      normalizeAccessoryPlacements(
        [equip('eyewear-1', { slot: 'eyewear' }), equip('headwear-1')],
        { facing },
      );

    const front = render(
      <BlobbiRendererView
        visual={VISUAL} instanceId="t-rear-a" size="lg"
        accessories={accessories('front')}
      />,
    );
    expect(front.container.querySelector('[data-accessory-code="eyewear-1"]')).not.toBeNull();

    const rear = render(
      <BlobbiRendererView
        visual={VISUAL} instanceId="t-rear-b" size="lg" facing="back"
        accessories={accessories('back')}
      />,
    );
    expect(rear.container.querySelector('[data-accessory-code="eyewear-1"]')).toBeNull();
    expect(rear.container.querySelector('[data-accessory-code="headwear-1"]')).not.toBeNull();
  });
});

describe('SVG behavior preserved (baby/adult, sleep, facing, gaze, instance ids)', () => {
  it('renders a baby and an adult form', () => {
    const baby = render(<BlobbiRendererView visual={VISUAL} instanceId="t-baby" />);
    const adult = render(<BlobbiRendererView visual={ADULT_VISUAL} instanceId="t-adult" />);
    expect(baby.container.querySelector('svg')).not.toBeNull();
    expect(adult.container.querySelector('svg')).not.toBeNull();
    expect(adult.container.innerHTML).not.toBe(baby.container.innerHTML);
  });

  it('sleeping selects different markup than awake', () => {
    const awake = render(<BlobbiRendererView visual={VISUAL} instanceId="t-awake" />);
    const asleep = render(
      <BlobbiRendererView visual={VISUAL} instanceId="t-awake" isSleeping />,
    );
    expect(asleep.container.innerHTML).not.toBe(awake.container.innerHTML);
  });

  it('rear facing removes the face (no pupils survive in the markup)', () => {
    const rear = render(
      <BlobbiRendererView visual={VISUAL} instanceId="t-rear" facing="back" eyeOffset={{ x: 1, y: 0 }} />,
    );
    expect(rear.container.innerHTML).not.toContain('blobbi-pupil');
  });

  it('gaze sets CSS variables and marks pupils; static render stays untouched', () => {
    const gazing = render(
      <BlobbiRendererView visual={VISUAL} instanceId="t-gaze" eyeOffset={{ x: 0.5, y: -0.25 }} />,
    );
    const wrapper = bodyBox(gazing.container);
    expect(wrapper.style.getPropertyValue('--blobbi-eye-x')).toBe('0.5');
    expect(wrapper.style.getPropertyValue('--blobbi-eye-y')).toBe('-0.25');
    expect(gazing.container.innerHTML).toContain('blobbi-pupil');

    const still = render(<BlobbiRendererView visual={VISUAL} instanceId="t-still" />);
    expect(bodyBox(still.container).style.getPropertyValue('--blobbi-eye-x')).toBe('');
    expect(still.container.innerHTML).not.toContain('blobbi-pupil');
  });

  it('two instances never share SVG ids', () => {
    const { container } = render(
      <div>
        <BlobbiRendererView visual={VISUAL} instanceId="inst-one" />
        <BlobbiRendererView visual={VISUAL} instanceId="inst-two" />
      </div>,
    );
    const ids = Array.from(container.querySelectorAll('svg [id]')).map((el) => el.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
